import { DOMParser, type Element, type Node as XmlNode } from '@xmldom/xmldom';

import type { NewsConfig, NewsItem, NewsProvider } from './types';

export interface ParsedRssItem {
  title?: string;
  content?: string;
  description?: string;
  source?: string;
  publishedAt?: string;
}

export interface RssParser {
  parse(xml: string): readonly ParsedRssItem[];
}

export type FetchRss = (
  url: URL,
  options: { signal: AbortSignal; maxBytes: number },
) => Promise<{ status: number; body: Uint8Array }>;

export type RssFetchImplementation = (
  input: URL,
  init: RequestInit,
) => Promise<Response>;

export type RssSourceFailureKind =
  | 'aborted'
  | 'body-too-large'
  | 'content-type'
  | 'invalid-response'
  | 'invalid-rss'
  | 'network'
  | 'redirect'
  | 'status'
  | 'timeout';

const FAILURE_MESSAGES: Readonly<Record<RssSourceFailureKind, string>> = Object.freeze({
  aborted: 'RSS acquisition was aborted.',
  'body-too-large': 'RSS response exceeded the configured size limit.',
  'content-type': 'RSS source returned an unsupported content type.',
  'invalid-response': 'RSS source returned an invalid response.',
  'invalid-rss': 'RSS source returned an unusable document.',
  network: 'RSS source could not be reached.',
  redirect: 'RSS source returned an unsafe redirect.',
  status: 'RSS source returned a non-success status.',
  timeout: 'RSS acquisition exceeded the configured timeout.',
});

/** Erreur d'acquisition classée dont le diagnostic ne contient aucune donnée distante. */
export class RssSourceError extends Error {
  readonly kind: RssSourceFailureKind;

  constructor(kind: RssSourceFailureKind) {
    super(FAILURE_MESSAGES[kind]);
    this.name = 'RssSourceError';
    this.kind = kind;
  }
}

const XML_MEDIA_TYPES = new Set([
  'application/rss+xml',
  'application/xml',
  'text/xml',
]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;
const MAX_NORMALIZED_ARTICLES = 20;
const ACTIVE_CONTENT_PATTERN = /<(script|style)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/giu;
const COMMENT_PATTERN = /<!--[\s\S]*?-->/gu;
const PROCESSING_INSTRUCTION_PATTERN = /<\?[\s\S]*?\?>/gu;
const DECLARATION_PATTERN = /<![^>]*>/gu;
const MARKUP_PATTERN = /<\/?[A-Za-z][^<>]*>/gu;
const CHARACTER_REFERENCE_PATTERN = /&(#(?:x[\dA-F]+|\d+)|amp|apos|gt|lt|nbsp|quot);/giu;

function sourceError(kind: RssSourceFailureKind): RssSourceError {
  return new RssSourceError(kind);
}

function isXmlMediaType(contentType: string | null): boolean {
  if (contentType === null || contentType.trim() === '') {
    return true;
  }

  const mediaType = contentType.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  return XML_MEDIA_TYPES.has(mediaType) || mediaType.endsWith('+xml');
}

function assertSafeHttpsUrl(url: URL): void {
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') {
    throw sourceError('redirect');
  }
}

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // La fermeture de la réponse ne doit pas remplacer l'erreur classée.
  }
}

async function readBoundedBody(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  const declaredLength = response.headers.get('content-length')?.trim();
  if (declaredLength && /^\d+$/u.test(declaredLength)) {
    const parsedLength = Number(declaredLength);
    if (parsedLength > maxBytes) {
      await cancelResponseBody(response);
      throw sourceError('body-too-large');
    }
  }

  if (response.body === null) {
    return new Uint8Array();
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!(value instanceof Uint8Array)) {
        throw sourceError('invalid-response');
      }
      if (value.byteLength > maxBytes - totalBytes) {
        try {
          await reader.cancel();
        } catch {
          // La limite reste l'erreur prioritaire même si l'annulation échoue.
        }
        throw sourceError('body-too-large');
      }

      chunks.push(value);
      totalBytes += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return body;
}

async function fetchBoundedRss(
  initialUrl: URL,
  options: { signal: AbortSignal; maxBytes: number },
  fetchImplementation: RssFetchImplementation,
): Promise<{ status: number; body: Uint8Array }> {
  let currentUrl = new URL(initialUrl.href);

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    assertSafeHttpsUrl(currentUrl);

    const response = await fetchImplementation(currentUrl, {
      cache: 'no-store',
      credentials: 'omit',
      headers: {
        Accept: 'application/rss+xml, application/xml;q=0.9, text/xml;q=0.8',
      },
      redirect: 'manual',
      referrerPolicy: 'no-referrer',
      signal: options.signal,
    });

    if (REDIRECT_STATUSES.has(response.status)) {
      await cancelResponseBody(response);
      if (redirectCount === MAX_REDIRECTS) {
        throw sourceError('redirect');
      }

      const location = response.headers.get('location');
      if (!location) {
        throw sourceError('redirect');
      }

      try {
        currentUrl = new URL(location, currentUrl);
        assertSafeHttpsUrl(currentUrl);
      } catch {
        throw sourceError('redirect');
      }
      continue;
    }

    if (!response.ok) {
      await cancelResponseBody(response);
      throw sourceError('status');
    }
    if (!isXmlMediaType(response.headers.get('content-type'))) {
      await cancelResponseBody(response);
      throw sourceError('content-type');
    }

    return {
      status: response.status,
      body: await readBoundedBody(response, options.maxBytes),
    };
  }

  throw sourceError('redirect');
}

/** Crée le transport HTTP borné à partir de la primitive fetch injectée. */
export function createBoundedRssTransport(
  fetchImplementation: RssFetchImplementation = fetch,
): FetchRss {
  return async (url, options) => {
    try {
      return await fetchBoundedRss(url, options, fetchImplementation);
    } catch (error) {
      if (error instanceof RssSourceError) {
        throw error;
      }
      if (options.signal.aborted) {
        throw sourceError('aborted');
      }

      throw sourceError('network');
    }
  };
}

function findMarkupEnd(xml: string, start: number, terminator: string): number {
  const end = xml.indexOf(terminator, start);
  return end === -1 ? xml.length : end + terminator.length;
}

/** Détecte les déclarations avant de confier le document au parseur XML. */
function containsForbiddenDeclaration(xml: string): boolean {
  let cursor = 0;

  while (cursor < xml.length) {
    const markupStart = xml.indexOf('<', cursor);
    if (markupStart === -1) {
      return false;
    }
    if (xml.startsWith('<!--', markupStart)) {
      cursor = findMarkupEnd(xml, markupStart + 4, '-->');
      continue;
    }
    if (xml.startsWith('<![CDATA[', markupStart)) {
      cursor = findMarkupEnd(xml, markupStart + 9, ']]>');
      continue;
    }
    if (xml.startsWith('<?', markupStart)) {
      cursor = findMarkupEnd(xml, markupStart + 2, '?>');
      continue;
    }

    const declarationPrefix = xml.slice(markupStart, markupStart + 24);
    if (/^<!\s*(?:DOCTYPE|ENTITY)(?:\s|>|\[)/iu.test(declarationPrefix)) {
      return true;
    }

    cursor = markupStart + 1;
  }

  return false;
}

function directChildElements(parent: Element, name: string): Element[] {
  const matches: Element[] = [];

  for (let index = 0; index < parent.childNodes.length; index += 1) {
    const child = parent.childNodes.item(index);
    if (
      child !== null
      && child.nodeType === child.ELEMENT_NODE
      && child.nodeName === name
    ) {
      matches.push(child as Element);
    }
  }

  return matches;
}

function collectReadableText(node: XmlNode): string {
  if (node.nodeType === node.TEXT_NODE || node.nodeType === node.CDATA_SECTION_NODE) {
    return node.nodeValue ?? '';
  }
  if (node.nodeType === node.ELEMENT_NODE) {
    const elementName = (node.localName ?? node.nodeName).toLowerCase();
    if (elementName === 'script' || elementName === 'style') {
      return '';
    }
  }

  const parts: string[] = [];
  for (let index = 0; index < node.childNodes.length; index += 1) {
    const child = node.childNodes.item(index);
    if (child !== null) {
      parts.push(collectReadableText(child));
    }
  }

  return parts.join(' ');
}

function readDirectChild(parent: Element, name: string): string | undefined {
  const child = directChildElements(parent, name)[0];
  return child === undefined ? undefined : collectReadableText(child);
}

function parseRssItems(xml: string): readonly ParsedRssItem[] {
  if (xml.trim() === '' || containsForbiddenDeclaration(xml)) {
    throw sourceError('invalid-rss');
  }

  try {
    const document = new DOMParser({
      locator: false,
      onError: () => {
        throw new Error('invalid XML');
      },
    }).parseFromString(xml, 'application/xml');

    if (document.doctype !== null) {
      throw sourceError('invalid-rss');
    }

    const root = document.documentElement;
    if (root === null || root.nodeName !== 'rss') {
      throw sourceError('invalid-rss');
    }

    const channel = directChildElements(root, 'channel')[0];
    if (channel === undefined) {
      throw sourceError('invalid-rss');
    }

    return directChildElements(channel, 'item').map((item) => {
      const title = readDirectChild(item, 'title');
      const content = readDirectChild(item, 'content:encoded');
      const description = readDirectChild(item, 'description');
      const source = readDirectChild(item, 'source');
      const publishedAt = readDirectChild(item, 'pubDate');

      return {
        ...(title === undefined ? {} : { title }),
        ...(content === undefined ? {} : { content }),
        ...(description === undefined ? {} : { description }),
        ...(source === undefined ? {} : { source }),
        ...(publishedAt === undefined ? {} : { publishedAt }),
      };
    });
  } catch (error) {
    if (error instanceof RssSourceError) {
      throw error;
    }

    throw sourceError('invalid-rss');
  }
}

/** Crée un parseur RSS 2.0 strict qui refuse toute déclaration DTD ou ENTITY. */
export function createSafeRssParser(): RssParser {
  return {
    parse: parseRssItems,
  };
}

function decodeCharacterReference(reference: string, body: string): string {
  const normalizedBody = body.toLowerCase();
  const namedReferences: Readonly<Record<string, string>> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
  };
  const namedValue = namedReferences[normalizedBody];
  if (namedValue !== undefined) {
    return namedValue;
  }

  const hexadecimal = normalizedBody.startsWith('#x');
  const digits = normalizedBody.slice(hexadecimal ? 2 : 1);
  const codePoint = Number.parseInt(digits, hexadecimal ? 16 : 10);
  if (
    !Number.isInteger(codePoint)
    || codePoint < 0
    || codePoint > 0x10ffff
    || (codePoint >= 0xd800 && codePoint <= 0xdfff)
  ) {
    return ' ';
  }

  try {
    return String.fromCodePoint(codePoint);
  } catch {
    return reference;
  }
}

/** Convertit le texte RSS externe en texte simple sans commandes de contrôle. */
export function sanitizeRssText(value: string): string {
  return value
    .replace(
      CHARACTER_REFERENCE_PATTERN,
      (reference, body: string) => decodeCharacterReference(reference, body),
    )
    .replace(ACTIVE_CONTENT_PATTERN, ' ')
    .replace(COMMENT_PATTERN, ' ')
    .replace(PROCESSING_INSTRUCTION_PATTERN, ' ')
    .replace(DECLARATION_PATTERN, ' ')
    .replace(MARKUP_PATTERN, ' ')
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function sanitizeOptionalValue(value: unknown): string {
  return typeof value === 'string' ? sanitizeRssText(value) : '';
}

function parseOptionalDate(value: unknown): Date | undefined {
  const sanitizedValue = sanitizeOptionalValue(value);
  if (sanitizedValue === '') {
    return undefined;
  }

  const timestamp = Date.parse(sanitizedValue);
  return Number.isFinite(timestamp) ? new Date(timestamp) : undefined;
}

/** Normalise les premiers articles titrés en conservant strictement leur ordre. */
export function normalizeRssItems(
  parsedItems: readonly ParsedRssItem[],
  maxArticles: number,
): readonly NewsItem[] {
  if (
    !Number.isInteger(maxArticles)
    || maxArticles < 1
    || maxArticles > MAX_NORMALIZED_ARTICLES
  ) {
    throw new RangeError('maxArticles must be an integer between 1 and 20.');
  }

  const normalizedItems: NewsItem[] = [];
  for (const parsedItem of parsedItems) {
    const title = sanitizeOptionalValue(parsedItem.title);
    if (title === '') {
      continue;
    }

    const content = sanitizeOptionalValue(parsedItem.content);
    const description = sanitizeOptionalValue(parsedItem.description);
    const source = sanitizeOptionalValue(parsedItem.source);
    const publishedAt = parseOptionalDate(parsedItem.publishedAt);
    const normalizedItem: NewsItem = {
      title,
      sourceText: content || description || title,
      ...(source === '' ? {} : { source }),
      ...(publishedAt === undefined ? {} : { publishedAt }),
    };

    normalizedItems.push(normalizedItem);
    if (normalizedItems.length === maxArticles) {
      break;
    }
  }

  return normalizedItems;
}

async function fetchWithTimeout(
  fetchRss: FetchRss,
  url: URL,
  maxBytes: number,
  timeoutMs: number,
  callerSignal: AbortSignal,
): Promise<{ status: number; body: Uint8Array }> {
  if (callerSignal.aborted) {
    throw sourceError('aborted');
  }

  const controller = new AbortController();
  let timedOut = false;
  let callerAborted = false;
  let rejectLifecycle: (error: RssSourceError) => void = () => undefined;
  const lifecycleFailure = new Promise<never>((_resolve, reject) => {
    rejectLifecycle = reject;
  });
  const handleCallerAbort = (): void => {
    callerAborted = true;
    controller.abort();
    rejectLifecycle(sourceError('aborted'));
  };

  callerSignal.addEventListener('abort', handleCallerAbort, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
    rejectLifecycle(sourceError('timeout'));
  }, timeoutMs);

  try {
    const acquisition = Promise.resolve().then(() => fetchRss(url, {
      signal: controller.signal,
      maxBytes,
    }));
    return await Promise.race([acquisition, lifecycleFailure]);
  } catch (error) {
    if (timedOut) {
      throw sourceError('timeout');
    }
    if (callerAborted || callerSignal.aborted) {
      throw sourceError('aborted');
    }
    if (error instanceof RssSourceError) {
      throw error;
    }

    throw sourceError('network');
  } finally {
    clearTimeout(timeout);
    callerSignal.removeEventListener('abort', handleCallerAbort);
  }
}

function validateTransportResponse(
  response: { status: number; body: Uint8Array },
  maxBytes: number,
): void {
  if (!Number.isInteger(response.status)) {
    throw sourceError('invalid-response');
  }
  if (response.status < 200 || response.status > 299) {
    throw sourceError('status');
  }
  if (!(response.body instanceof Uint8Array)) {
    throw sourceError('invalid-response');
  }
  if (response.body.byteLength > maxBytes) {
    throw sourceError('body-too-large');
  }
}

/** Assemble le transport, le parseur et la normalisation derrière NewsProvider. */
export function createRssProvider(options: {
  config: Pick<
    NewsConfig,
    'rssUrl' | 'rssTimeoutMs' | 'rssMaxBytes' | 'maxArticles'
  >;
  fetchRss: FetchRss;
  parser: RssParser;
}): NewsProvider {
  const { config, fetchRss, parser } = options;

  return {
    async fetchLatest(signal: AbortSignal): Promise<readonly NewsItem[]> {
      const response = await fetchWithTimeout(
        fetchRss,
        config.rssUrl,
        config.rssMaxBytes,
        config.rssTimeoutMs,
        signal,
      );
      validateTransportResponse(response, config.rssMaxBytes);

      let xml: string;
      try {
        xml = new TextDecoder('utf-8', { fatal: true }).decode(response.body);
      } catch {
        throw sourceError('invalid-rss');
      }

      try {
        const parsedItems = parser.parse(xml);
        if (!Array.isArray(parsedItems)) {
          throw sourceError('invalid-rss');
        }

        return normalizeRssItems(parsedItems, config.maxArticles);
      } catch (error) {
        if (error instanceof RssSourceError) {
          throw error;
        }

        throw sourceError('invalid-rss');
      }
    },
  };
}
