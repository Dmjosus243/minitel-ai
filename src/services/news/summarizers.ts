import { sanitizeRssText } from './rss-provider';
import type {
  AiSummaryClient,
  ArticleSummarizer,
  NewsConfig,
  NewsItem,
  SummaryBudget,
} from './types';

const ELLIPSIS = '...';
const SENTENCE_SEGMENTER = new Intl.Segmenter('fr', {
  granularity: 'sentence',
});
const AI_REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export const DEFAULT_AI_RESPONSE_MAX_BYTES = 16_384;
export const AI_SUMMARY_FALLBACK_EVENT = 'NEWS AI summary unavailable; extractive fallback used.';

export type AiFetchImplementation = (
  input: URL,
  init: RequestInit,
) => Promise<Response>;

export type AiSummaryClientFailureKind =
  | 'body-too-large'
  | 'invalid-response'
  | 'network'
  | 'status'
  | 'timeout'
  | 'unsafe-endpoint';

const AI_CLIENT_FAILURE_MESSAGES: Readonly<Record<
  AiSummaryClientFailureKind,
  string
>> = Object.freeze({
  'body-too-large': 'AI response exceeded the configured size limit.',
  'invalid-response': 'AI endpoint returned an invalid response.',
  network: 'AI endpoint could not be reached.',
  status: 'AI endpoint returned a non-success status.',
  timeout: 'AI request exceeded the configured timeout.',
  'unsafe-endpoint': 'AI endpoint must be an HTTPS URL without credentials.',
});

/** Erreur IA classée qui ne conserve ni contenu distant, ni URL, ni secret. */
export class AiSummaryClientError extends Error {
  readonly kind: AiSummaryClientFailureKind;

  constructor(kind: AiSummaryClientFailureKind) {
    super(AI_CLIENT_FAILURE_MESSAGES[kind]);
    this.name = 'AiSummaryClientError';
    this.kind = kind;
  }
}

export interface HttpAiSummaryClientOptions {
  endpoint: URL;
  model?: string;
  apiKey?: string;
  timeoutMs: number;
  maxResponseBytes?: number;
  fetchImplementation?: AiFetchImplementation;
}

export interface SummarizerFactoryOptions {
  config: Pick<NewsConfig, 'summaryMode' | 'ai'>;
  logger?: Pick<Console, 'error'>;
  aiClientFactory?: (
    config: NonNullable<NewsConfig['ai']>,
  ) => AiSummaryClient;
  fetchImplementation?: AiFetchImplementation;
  aiResponseMaxBytes?: number;
}

function aiClientError(kind: AiSummaryClientFailureKind): AiSummaryClientError {
  return new AiSummaryClientError(kind);
}

function normalizeSourceText(value: string): string {
  return value.trim().replace(/\s+/gu, ' ');
}

function countCodePoints(value: string): number {
  return Array.from(value).length;
}

function takeCodePoints(value: string, maximum: number): string {
  return Array.from(value).slice(0, maximum).join('');
}

function validatePositiveSafeInteger(value: number, fieldName: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${fieldName} must be a positive safe integer.`);
  }
}

function validateMaximumCharacters(maximum: number): void {
  validatePositiveSafeInteger(maximum, 'Summary budget');
}

function selectSummarySource(item: NewsItem): string {
  const sourceText = normalizeSourceText(item.sourceText);
  const title = normalizeSourceText(item.title);
  const selectedSource = sourceText || title;

  if (!selectedSource) {
    throw new RangeError('A news item must contain source text or a title.');
  }

  return selectedSource;
}

function segmentSentences(source: string): readonly string[] {
  return Array.from(
    SENTENCE_SEGMENTER.segment(source),
    ({ segment }) => segment.trim(),
  ).filter((sentence) => sentence.length > 0);
}

function truncateFirstSentence(
  sentence: string,
  maximumCharacters: number,
): string {
  if (maximumCharacters < ELLIPSIS.length) {
    return takeCodePoints(sentence, maximumCharacters);
  }

  const availableCharacters = maximumCharacters - ELLIPSIS.length;
  const words = sentence.split(' ');
  let prefix = '';

  for (const word of words) {
    const candidate = prefix ? `${prefix} ${word}` : word;
    if (countCodePoints(candidate) > availableCharacters) {
      break;
    }
    prefix = candidate;
  }

  return prefix ? `${prefix}${ELLIPSIS}` : ELLIPSIS;
}

function summarizeSource(source: string, maximumCharacters: number): string {
  if (countCodePoints(source) <= maximumCharacters) {
    return source;
  }

  const sentences = segmentSentences(source);
  const firstSentence = sentences[0] ?? source;
  let summary = '';

  for (const sentence of sentences) {
    const candidate = summary ? `${summary} ${sentence}` : sentence;
    if (countCodePoints(candidate) > maximumCharacters) {
      break;
    }
    summary = candidate;
  }

  return summary || truncateFirstSentence(firstSentence, maximumCharacters);
}

/** Produit un résumé déterministe à partir des premières phrases de l'article. */
export function createExtractiveSummarizer(): ArticleSummarizer {
  return {
    async summarize(item: NewsItem, budget: SummaryBudget): Promise<string> {
      validateMaximumCharacters(budget.maxCharacters);
      const source = selectSummarySource(item);
      return summarizeSource(source, budget.maxCharacters);
    },
  };
}

function copySafeEndpoint(endpoint: URL): URL {
  const copiedEndpoint = new URL(endpoint.href);
  if (
    copiedEndpoint.protocol !== 'https:'
    || copiedEndpoint.username !== ''
    || copiedEndpoint.password !== ''
  ) {
    throw aiClientError('unsafe-endpoint');
  }

  return copiedEndpoint;
}

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // L'échec de fermeture ne doit pas masquer l'erreur IA classée.
  }
}

async function readBoundedResponseBody(
  response: Response,
  maxResponseBytes: number,
): Promise<Uint8Array> {
  const declaredLength = response.headers.get('content-length')?.trim();
  if (declaredLength && /^\d+$/u.test(declaredLength)) {
    const parsedLength = Number(declaredLength);
    if (parsedLength > maxResponseBytes) {
      await cancelResponseBody(response);
      throw aiClientError('body-too-large');
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
        throw aiClientError('invalid-response');
      }
      if (value.byteLength > maxResponseBytes - totalBytes) {
        try {
          await reader.cancel();
        } catch {
          // La limite reste prioritaire même si l'annulation échoue.
        }
        throw aiClientError('body-too-large');
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

function createGatewayRequestBody(
  item: NewsItem,
  budget: SummaryBudget,
  model: string | undefined,
): string {
  return JSON.stringify({
    ...(model === undefined ? {} : { model }),
    input: {
      title: sanitizeRssText(item.title),
      text: sanitizeRssText(item.sourceText),
    },
    constraints: {
      language: 'fr',
      maxCharacters: budget.maxCharacters,
      columns: 40,
      rows: 24,
      maxBytes: 2_048,
    },
  });
}

function parseGatewayResponse(body: Uint8Array): string {
  let decodedBody: string;
  try {
    decodedBody = new TextDecoder('utf-8', { fatal: true }).decode(body);
  } catch {
    throw aiClientError('invalid-response');
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(decodedBody) as unknown;
  } catch {
    throw aiClientError('invalid-response');
  }

  if (
    typeof parsedBody !== 'object'
    || parsedBody === null
    || Array.isArray(parsedBody)
    || typeof (parsedBody as { summary?: unknown }).summary !== 'string'
  ) {
    throw aiClientError('invalid-response');
  }

  return (parsedBody as { summary: string }).summary;
}

async function requestGatewaySummary(
  endpoint: URL,
  item: NewsItem,
  budget: SummaryBudget,
  options: {
    model?: string;
    apiKey?: string;
    maxResponseBytes: number;
    fetchImplementation: AiFetchImplementation;
    signal: AbortSignal;
  },
): Promise<string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  if (options.apiKey !== undefined) {
    headers.Authorization = `Bearer ${options.apiKey}`;
  }

  const response = await options.fetchImplementation(endpoint, {
    method: 'POST',
    cache: 'no-store',
    credentials: 'omit',
    headers,
    redirect: 'manual',
    referrerPolicy: 'no-referrer',
    signal: options.signal,
    body: createGatewayRequestBody(item, budget, options.model),
  });

  if (AI_REDIRECT_STATUSES.has(response.status) || !response.ok) {
    await cancelResponseBody(response);
    throw aiClientError('status');
  }

  const body = await readBoundedResponseBody(
    response,
    options.maxResponseBytes,
  );
  return parseGatewayResponse(body);
}

async function withRequestTimeout<T>(
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  let rejectTimeout: (error: AiSummaryClientError) => void = () => undefined;
  const timeoutFailure = new Promise<never>((_resolve, reject) => {
    rejectTimeout = reject;
  });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
    rejectTimeout(aiClientError('timeout'));
  }, timeoutMs);

  try {
    const request = Promise.resolve().then(() => operation(controller.signal));
    return await Promise.race([request, timeoutFailure]);
  } catch (error) {
    if (timedOut) {
      throw aiClientError('timeout');
    }
    if (error instanceof AiSummaryClientError) {
      throw error;
    }

    throw aiClientError('network');
  } finally {
    clearTimeout(timeout);
  }
}

/** Crée l'adaptateur HTTP borné du contrat de passerelle de résumés. */
export function createHttpAiSummaryClient(
  options: HttpAiSummaryClientOptions,
): AiSummaryClient {
  const endpoint = copySafeEndpoint(options.endpoint);
  validatePositiveSafeInteger(options.timeoutMs, 'AI timeout');
  const maxResponseBytes = options.maxResponseBytes
    ?? DEFAULT_AI_RESPONSE_MAX_BYTES;
  validatePositiveSafeInteger(maxResponseBytes, 'AI response limit');
  const fetchImplementation = options.fetchImplementation ?? fetch;

  return {
    async summarize(item: NewsItem, budget: SummaryBudget): Promise<string> {
      validateMaximumCharacters(budget.maxCharacters);
      return withRequestTimeout(options.timeoutMs, (signal) => (
        requestGatewaySummary(endpoint, item, budget, {
          ...(options.model === undefined ? {} : { model: options.model }),
          ...(options.apiKey === undefined ? {} : { apiKey: options.apiKey }),
          maxResponseBytes,
          fetchImplementation,
          signal,
        })
      ));
    },
  };
}

function logAiFallback(logger: Pick<Console, 'error'>): void {
  try {
    logger.error(AI_SUMMARY_FALLBACK_EVENT);
  } catch {
    // Une panne du journal ne doit jamais empêcher le résumé de secours.
  }
}

/** Entoure le client IA d'un repli extractif déterministe par article. */
export function createAiSummarizer(options: {
  client: AiSummaryClient;
  fallback: ArticleSummarizer;
  logger: Pick<Console, 'error'>;
}): ArticleSummarizer {
  return {
    async summarize(item: NewsItem, budget: SummaryBudget): Promise<string> {
      try {
        const candidate = await options.client.summarize(item, budget);
        if (typeof candidate !== 'string') {
          throw aiClientError('invalid-response');
        }

        const sanitizedCandidate = sanitizeRssText(candidate);
        if (sanitizedCandidate === '') {
          throw aiClientError('invalid-response');
        }

        return sanitizedCandidate;
      } catch {
        logAiFallback(options.logger);
        return options.fallback.summarize(item, budget);
      }
    },
  };
}

/** Sélectionne une seule stratégie lors de la composition des dépendances. */
export function createSummarizer(
  options: SummarizerFactoryOptions,
): ArticleSummarizer {
  const fallback = createExtractiveSummarizer();
  if (options.config.summaryMode === 'extractive') {
    return fallback;
  }

  const aiConfig = options.config.ai;
  if (aiConfig === undefined) {
    throw new RangeError('AI configuration is required in AI mode.');
  }

  const client = options.aiClientFactory === undefined
    ? createHttpAiSummaryClient({
      ...aiConfig,
      ...(options.fetchImplementation === undefined
        ? {}
        : { fetchImplementation: options.fetchImplementation }),
      ...(options.aiResponseMaxBytes === undefined
        ? {}
        : { maxResponseBytes: options.aiResponseMaxBytes }),
    })
    : options.aiClientFactory(aiConfig);

  return createAiSummarizer({
    client,
    fallback,
    logger: options.logger ?? console,
  });
}
