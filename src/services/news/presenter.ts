import {
  DEFAULT_PAGE_CONFIG,
  formatText,
  pageWeight,
} from '../../core/formatter';
import type { NewsItem } from './types';

export const NEWS_HEADING = '3615 NEWS';
export const NO_NEWS_MESSAGE = 'Aucune actualité disponible';

const MAX_TITLE_CODE_POINTS = 120;
const MAX_SOURCE_CODE_POINTS = 40;
const MAX_SUMMARY_CODE_POINTS = 600;
const ELLIPSIS = '...';
const MIN_TRUNCATED_CODE_POINTS = ELLIPSIS.length + 1;

const ACTIVE_CONTENT_PATTERN = /<(script|style)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/giu;
const CDATA_PATTERN = /<!\[CDATA\[([\s\S]*?)\]\]>/giu;
const COMMENT_PATTERN = /<!--[\s\S]*?(?:-->|$)/gu;
const PROCESSING_INSTRUCTION_PATTERN = /<\?[\s\S]*?(?:\?>|$)/gu;
const DECLARATION_PATTERN = /<![^>]*(?:>|$)/gu;
const CLOSING_MARKUP_PATTERN = /<\/[A-Za-z_][^<>]*>/gu;
const OPENING_MARKUP_PATTERN = /<[A-Za-z_][^<>]*>/gu;
const RESIDUAL_ANGLE_BRACKET_PATTERN = /[<>]/gu;
const CHARACTER_REFERENCE_PATTERN = /&(#(?:x[\dA-F]+|\d+)|amp|apos|gt|lt|nbsp|quot);/giu;
const DISALLOWED_CONTROL_PATTERN = /[\p{Cc}\u00ad\u061c\u200b\u200e\u200f\u202a-\u202e\u2060-\u2069\ufeff]/gu;

interface SanitizedArticle {
  articleNumber: number;
  title: string;
  summary: string;
  source?: string;
  publishedAt?: string;
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

/** Nettoie un texte externe tout en conservant les caractères Unicode lisibles. */
export function sanitizeExternalText(value: string): string {
  return value
    .replace(
      CHARACTER_REFERENCE_PATTERN,
      (reference, body: string) => decodeCharacterReference(reference, body),
    )
    .replace(ACTIVE_CONTENT_PATTERN, ' ')
    .replace(CDATA_PATTERN, '$1')
    .replace(COMMENT_PATTERN, ' ')
    .replace(PROCESSING_INSTRUCTION_PATTERN, ' ')
    .replace(DECLARATION_PATTERN, ' ')
    .replace(CLOSING_MARKUP_PATTERN, '')
    .replace(OPENING_MARKUP_PATTERN, ' ')
    .replace(RESIDUAL_ANGLE_BRACKET_PATTERN, ' ')
    .replace(DISALLOWED_CONTROL_PATTERN, ' ')
    .normalize('NFC')
    .replace(/\s+/gu, ' ')
    .trim();
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function shortenAtWordBoundary(value: string, maximum: number): string {
  if (maximum <= 0) {
    return '';
  }

  const codePoints = Array.from(value);
  if (codePoints.length <= maximum) {
    return value;
  }
  if (maximum < MIN_TRUNCATED_CODE_POINTS) {
    return codePoints.slice(0, maximum).join('');
  }

  const availableCodePoints = maximum - ELLIPSIS.length;
  const availablePrefix = codePoints.slice(0, availableCodePoints);
  const lastWordBoundary = availablePrefix.lastIndexOf(' ');
  const prefix = (
    lastWordBoundary > 0
      ? availablePrefix.slice(0, lastWordBoundary)
      : availablePrefix
  ).join('').trimEnd();

  return `${prefix}${ELLIPSIS}`;
}

function validateArticleNumber(articleNumber: number): void {
  if (!Number.isSafeInteger(articleNumber) || articleNumber < 1) {
    throw new RangeError('Article number must be a positive safe integer.');
  }
}

function formatPublishedAt(value: Date | undefined): string | undefined {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    return undefined;
  }

  const year = value.getUTCFullYear();
  if (year < 0 || year > 9_999) {
    return undefined;
  }

  const month = String(value.getUTCMonth() + 1).padStart(2, '0');
  const day = String(value.getUTCDate()).padStart(2, '0');
  return `${String(year).padStart(4, '0')}-${month}-${day}`;
}

function sanitizeArticle(
  item: NewsItem,
  candidateSummary: string,
  articleNumber: number,
): SanitizedArticle {
  validateArticleNumber(articleNumber);

  const title = sanitizeExternalText(item.title);
  if (title === '') {
    throw new RangeError('A news article must contain a readable title.');
  }

  const sourceText = sanitizeExternalText(item.sourceText);
  const requestedSummary = sanitizeExternalText(candidateSummary);
  const summary = requestedSummary || sourceText || title;
  const source = item.source === undefined
    ? ''
    : sanitizeExternalText(item.source);
  const publishedAt = formatPublishedAt(item.publishedAt);

  return {
    articleNumber,
    title,
    summary,
    ...(source === '' ? {} : { source }),
    ...(publishedAt === undefined ? {} : { publishedAt }),
  };
}

function renderSanitizedArticle(article: SanitizedArticle): string {
  const lines = [`${article.articleNumber}. ${article.title}`];
  const metadata = [article.source, article.publishedAt]
    .filter((value): value is string => value !== undefined);

  if (metadata.length > 0) {
    lines.push(metadata.join(' - '));
  }
  lines.push(article.summary);

  return lines.join('\n');
}

/** Produit un bloc numéroté nettoyé sans effectuer la mise en page finale. */
export function renderArticleBlock(
  item: NewsItem,
  summary: string,
  articleNumber = 1,
): string {
  return renderSanitizedArticle(sanitizeArticle(item, summary, articleNumber));
}

function fitsOnOneDefaultPage(block: string): boolean {
  const pages = formatText(block, { ...DEFAULT_PAGE_CONFIG });
  if (pages.length !== 1) {
    return false;
  }

  const page = pages[0];
  return page !== undefined
    && page.content.length <= DEFAULT_PAGE_CONFIG.rows
    && page.content.every(
      (line) => codePointLength(line) <= DEFAULT_PAGE_CONFIG.columns,
    )
    && pageWeight(page) < DEFAULT_PAGE_CONFIG.maxBytes;
}

function findLongestFittingText(
  value: string,
  maximum: number,
  minimum: number,
  renderCandidate: (candidate: string) => string,
): string | undefined {
  let lowerBound = Math.min(minimum, maximum);
  let upperBound = maximum;
  let fittingText: string | undefined;

  while (lowerBound <= upperBound) {
    const midpoint = Math.floor((lowerBound + upperBound) / 2);
    const candidate = shortenAtWordBoundary(value, midpoint);
    const block = renderCandidate(candidate);

    if (fitsOnOneDefaultPage(block)) {
      fittingText = candidate;
      lowerBound = midpoint + 1;
    } else {
      upperBound = midpoint - 1;
    }
  }

  return fittingText;
}

/** Réduit un article jusqu'à ce que le formateur existant le place sur une page. */
export function fitArticleBlock(
  item: NewsItem,
  candidateSummary: string,
  articleNumber = 1,
): string {
  const sanitized = sanitizeArticle(item, candidateSummary, articleNumber);
  const originalTitle = sanitized.title;
  const originalSummary = sanitized.summary;
  const originalSource = sanitized.source;
  const titleMaximum = Math.min(
    MAX_TITLE_CODE_POINTS,
    codePointLength(originalTitle),
  );
  const summaryMaximum = Math.min(
    MAX_SUMMARY_CODE_POINTS,
    codePointLength(originalSummary),
  );
  const sourceMaximum = originalSource === undefined
    ? 0
    : Math.min(MAX_SOURCE_CODE_POINTS, codePointLength(originalSource));

  const boundedArticle: SanitizedArticle = {
    ...sanitized,
    title: shortenAtWordBoundary(originalTitle, titleMaximum),
    summary: shortenAtWordBoundary(originalSummary, summaryMaximum),
    ...(originalSource === undefined
      ? {}
      : { source: shortenAtWordBoundary(originalSource, sourceMaximum) }),
  };
  const boundedBlock = renderSanitizedArticle(boundedArticle);
  if (fitsOnOneDefaultPage(boundedBlock)) {
    return boundedBlock;
  }

  const minimumSummaryLength = Math.min(
    summaryMaximum,
    MIN_TRUNCATED_CODE_POINTS,
  );
  const fittedSummary = findLongestFittingText(
    originalSummary,
    summaryMaximum,
    minimumSummaryLength,
    (summary) => renderSanitizedArticle({
      ...boundedArticle,
      summary,
    }),
  );
  if (fittedSummary !== undefined) {
    return renderSanitizedArticle({
      ...boundedArticle,
      summary: fittedSummary,
    });
  }

  const minimumSummary = shortenAtWordBoundary(
    originalSummary,
    minimumSummaryLength,
  );
  const articleWithoutSource: SanitizedArticle = {
    ...boundedArticle,
    summary: minimumSummary,
  };
  delete articleWithoutSource.source;
  const blockWithoutSource = renderSanitizedArticle(articleWithoutSource);

  if (fitsOnOneDefaultPage(blockWithoutSource)) {
    if (originalSource === undefined || sourceMaximum === 0) {
      return blockWithoutSource;
    }

    const fittedSource = findLongestFittingText(
      originalSource,
      sourceMaximum,
      Math.min(sourceMaximum, MIN_TRUNCATED_CODE_POINTS),
      (source) => renderSanitizedArticle({
        ...articleWithoutSource,
        source,
      }),
    );

    return fittedSource === undefined
      ? blockWithoutSource
      : renderSanitizedArticle({
        ...articleWithoutSource,
        source: fittedSource,
      });
  }

  const fittedTitle = findLongestFittingText(
    originalTitle,
    titleMaximum,
    Math.min(titleMaximum, MIN_TRUNCATED_CODE_POINTS),
    (title) => renderSanitizedArticle({
      ...articleWithoutSource,
      title,
    }),
  );
  if (fittedTitle !== undefined) {
    return renderSanitizedArticle({
      ...articleWithoutSource,
      title: fittedTitle,
    });
  }

  throw new RangeError('A news article cannot fit the default page limits.');
}

/** Assemble le titre du service et les articles dans l'ordre du flux. */
export function renderNews(
  items: readonly { item: NewsItem; summary: string }[],
): string {
  if (items.length === 0) {
    return NO_NEWS_MESSAGE;
  }

  const articleBlocks = items.map(({ item, summary }, index) => (
    fitArticleBlock(item, summary, index + 1)
  ));
  return `${NEWS_HEADING}\n\n${articleBlocks.join('\n\n')}`;
}
