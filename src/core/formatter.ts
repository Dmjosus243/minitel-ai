import { performance } from 'node:perf_hooks';

import {
  DEFAULT_PAGE_CONFIG,
  getPageConfig,
  resolvePageConfig,
} from './config';
import { responseTimeMonitor } from './performance';
import type { Page, PageConfig } from './types';

export { DEFAULT_PAGE_CONFIG } from './config';

export const PAGE_CACHE_CAPACITY = 100;

export interface PageCacheStats {
  entries: number;
  capacity: number;
  hits: number;
  misses: number;
}

export interface PageTransformerPlugin {
  readonly name: string;
  transform(text: string, config: Readonly<PageConfig>): string;
}

const transformedPageCache = new Map<string, Page[]>();
const pageTransformerPlugins = new Map<string, PageTransformerPlugin>();
let pageCacheHits = 0;
let pageCacheMisses = 0;
let pageTransformerRevision = 0;

function clonePages(pages: readonly Page[]): Page[] {
  return pages.map((page) => ({
    ...page,
    content: [...page.content],
    metadata: { ...page.metadata },
  }));
}

function pageCacheKey(text: string, config: PageConfig): string {
  return JSON.stringify([
    text,
    config.columns,
    config.rows,
    config.maxBytes,
    config.wordWrap,
    pageTransformerRevision,
  ]);
}

function readCachedPages(key: string): Page[] | null {
  const cachedPages = transformedPageCache.get(key);

  if (cachedPages === undefined) {
    pageCacheMisses += 1;
    return null;
  }

  // Reinsert the entry so iteration order tracks least-recently-used entries.
  transformedPageCache.delete(key);
  transformedPageCache.set(key, cachedPages);
  pageCacheHits += 1;
  return clonePages(cachedPages);
}

function cachePages(key: string, pages: readonly Page[]): void {
  if (transformedPageCache.size >= PAGE_CACHE_CAPACITY) {
    const oldestKey = transformedPageCache.keys().next().value as string | undefined;
    if (oldestKey !== undefined) {
      transformedPageCache.delete(oldestKey);
    }
  }

  transformedPageCache.set(key, clonePages(pages));
}

export function getPageCacheStats(): PageCacheStats {
  return {
    entries: transformedPageCache.size,
    capacity: PAGE_CACHE_CAPACITY,
    hits: pageCacheHits,
    misses: pageCacheMisses,
  };
}

export function clearPageCache(): void {
  transformedPageCache.clear();
  pageCacheHits = 0;
  pageCacheMisses = 0;
}

/** Enregistre une extension de texte appliquée avant la mise en page. */
export function registerPageTransformer(
  plugin: PageTransformerPlugin,
): () => void {
  if (
    typeof plugin !== 'object'
    || plugin === null
    || typeof plugin.name !== 'string'
    || plugin.name.trim().length === 0
    || typeof plugin.transform !== 'function'
  ) {
    throw new TypeError(
      'Page transformer plugins require a name and transform function.',
    );
  }

  const name = plugin.name.trim();
  if (pageTransformerPlugins.has(name)) {
    throw new Error(`Duplicate page transformer plugin: ${name}.`);
  }

  pageTransformerPlugins.set(name, plugin);
  pageTransformerRevision += 1;
  clearPageCache();

  return () => {
    unregisterPageTransformer(name);
  };
}

export function unregisterPageTransformer(name: string): boolean {
  const removed = pageTransformerPlugins.delete(name.trim());

  if (removed) {
    pageTransformerRevision += 1;
    clearPageCache();
  }

  return removed;
}

function applyPageTransformers(text: string, config: PageConfig): string {
  let transformedText = text;
  const pluginConfig = Object.freeze({ ...config });

  for (const plugin of pageTransformerPlugins.values()) {
    transformedText = plugin.transform(transformedText, pluginConfig);
    if (typeof transformedText !== 'string') {
      throw new TypeError(
        `Page transformer plugin ${plugin.name} must return a string.`,
      );
    }
  }

  return transformedText;
}

const MINITEL_EQUIVALENTS: ReadonlyArray<readonly [string, string]> = [
  ['\u00a0', ' '],
  ['\u202f', ' '],
  ['\u2018', "'"],
  ['\u2019', "'"],
  ['\u201a', "'"],
  ['\u201b', "'"],
  ['\u201c', '"'],
  ['\u201d', '"'],
  ['\u201e', '"'],
  ['\u201f', '"'],
  ['\u2010', '-'],
  ['\u2011', '-'],
  ['\u2012', '-'],
  ['\u2013', '-'],
  ['\u2014', '-'],
  ['\u2212', '-'],
  ['\u2026', '...'],
  ['\u2022', '*'],
  ['\u25e6', '*'],
];

function resolveConfig(config?: PageConfig): PageConfig {
  return config === undefined
    ? getPageConfig()
    : resolvePageConfig(config);
}

function convertSpecialCharacters(text: string): string {
  let converted = text
    .normalize('NFC')
    .replace(/\r\n?|\u2028|\u2029/gu, '\n')
    .replace(/[\u00ad\u200b\ufeff]/gu, '');

  for (const [character, equivalent] of MINITEL_EQUIVALENTS) {
    converted = converted.replaceAll(character, equivalent);
  }

  return converted;
}

function characterLength(value: string): number {
  return Array.from(value).length;
}

function splitByColumns(value: string, columns: number): string[] {
  const characters = Array.from(value);
  const parts: string[] = [];

  for (let offset = 0; offset < characters.length; offset += columns) {
    parts.push(characters.slice(offset, offset + columns).join(''));
  }

  return parts;
}

function normalizeLineWhitespace(line: string): string {
  return line.replace(/[\t\v\f ]+/gu, ' ').trim();
}

function wrapLine(line: string, config: PageConfig): string[] {
  const normalizedLine = normalizeLineWhitespace(line);

  if (normalizedLine.length === 0) {
    return [''];
  }

  if (!config.wordWrap) {
    return splitByColumns(normalizedLine, config.columns);
  }

  const output: string[] = [];
  let currentLine = '';

  for (const word of normalizedLine.split(' ')) {
    if (characterLength(word) > config.columns) {
      if (currentLine.length > 0) {
        output.push(currentLine);
        currentLine = '';
      }

      const chunks = splitByColumns(word, config.columns);
      const finalChunk = chunks.pop();
      output.push(...chunks);
      currentLine = finalChunk ?? '';
      continue;
    }

    if (currentLine.length === 0) {
      currentLine = word;
      continue;
    }

    const candidate = `${currentLine} ${word}`;
    if (characterLength(candidate) <= config.columns) {
      currentLine = candidate;
    } else {
      output.push(currentLine);
      currentLine = word;
    }
  }

  if (currentLine.length > 0) {
    output.push(currentLine);
  }

  return output;
}

function wrapText(text: string, config: PageConfig): string[] {
  const converted = convertSpecialCharacters(text);
  if (converted.length === 0) {
    return [];
  }

  return converted
    .split('\n')
    .flatMap((line) => wrapLine(line, config));
}

/** Calcule le poids UTF-8 de la page telle qu'elle sera sérialisée. */
export function pageWeight(page: Page): number {
  return Buffer.byteLength(JSON.stringify(page), 'utf8');
}

function createPage(content: string[], pageNumber: number, totalPages: number): Page {
  const page: Page = {
    content,
    pageNumber,
    totalPages,
    metadata: {
      byteSize: 0,
    },
  };

  // byteSize fait partie de la charge utile; on le recalcule jusqu'à stabilisation.
  while (true) {
    const byteSize = pageWeight(page);
    if (page.metadata.byteSize === byteSize) {
      return page;
    }
    page.metadata.byteSize = byteSize;
  }
}

function fitsByteLimit(
  content: string[],
  pageNumber: number,
  totalPages: number,
  maxBytes: number,
): boolean {
  return createPage(content, pageNumber, totalPages).metadata.byteSize < maxBytes;
}

function largestFittingPrefix(
  line: string,
  pageNumber: number,
  totalPages: number,
  maxBytes: number,
): [string, string] | null {
  const characters = Array.from(line);
  let lowerBound = 1;
  let upperBound = characters.length;
  let fittingLength = 0;

  while (lowerBound <= upperBound) {
    const midpoint = Math.floor((lowerBound + upperBound) / 2);
    const prefix = characters.slice(0, midpoint).join('');

    if (fitsByteLimit([prefix], pageNumber, totalPages, maxBytes)) {
      fittingLength = midpoint;
      lowerBound = midpoint + 1;
    } else {
      upperBound = midpoint - 1;
    }
  }

  if (fittingLength === 0) {
    return null;
  }

  return [
    characters.slice(0, fittingLength).join(''),
    characters.slice(fittingLength).join(''),
  ];
}

function partitionLines(
  lines: string[],
  config: PageConfig,
  totalPagesHint: number,
): string[][] {
  const pages: string[][] = [];
  const pendingLines = [...lines].reverse();
  let currentPage: string[] = [];

  if (pendingLines.length === 0) {
    if (!fitsByteLimit([], 1, 1, config.maxBytes)) {
      throw new RangeError('Page maxBytes is too small for pagination metadata.');
    }
    return [[]];
  }

  while (pendingLines.length > 0) {
    const line = pendingLines.pop() as string;
    const pageNumber = pages.length + 1;
    const knownTotalPages = Math.max(totalPagesHint, pageNumber);

    if (currentPage.length >= config.rows) {
      pages.push(currentPage);
      currentPage = [];
      pendingLines.push(line);
      continue;
    }

    const candidate = [...currentPage, line];
    if (fitsByteLimit(candidate, pageNumber, knownTotalPages, config.maxBytes)) {
      currentPage = candidate;
      continue;
    }

    if (currentPage.length > 0) {
      pages.push(currentPage);
      currentPage = [];
      pendingLines.push(line);
      continue;
    }

    const splitLine = largestFittingPrefix(
      line,
      pageNumber,
      knownTotalPages,
      config.maxBytes,
    );

    if (splitLine === null) {
      throw new RangeError('Page maxBytes is too small to contain one character.');
    }

    const [prefix, remainder] = splitLine;
    pages.push([prefix]);
    if (remainder.length > 0) {
      pendingLines.push(remainder);
    }
  }

  if (currentPage.length > 0) {
    pages.push(currentPage);
  }

  return pages;
}

function paginate(lines: string[], config: PageConfig): Page[] {
  let totalPagesHint = Math.max(1, Math.ceil(Math.max(1, lines.length) / config.rows));

  while (true) {
    const pageContents = partitionLines(lines, config, totalPagesHint);
    const totalPages = pageContents.length;

    if (totalPages === totalPagesHint) {
      return pageContents.map((content, index) =>
        createPage(content, index + 1, totalPages),
      );
    }

    totalPagesHint = totalPages;
  }
}

function formatErrorPage(message: string): Page[] {
  const safeConfig = { ...DEFAULT_PAGE_CONFIG };
  return paginate(wrapText(message, safeConfig), safeConfig);
}

export function formatText(text: string, config?: PageConfig): Page[] {
  const startedAt = performance.now();

  try {
    if (typeof text !== 'string') {
      return formatErrorPage('Invalid text input: expected a string.');
    }

    try {
      const resolvedConfig = resolveConfig(config);
      const cacheKey = pageCacheKey(text, resolvedConfig);
      const cachedPages = readCachedPages(cacheKey);

      if (cachedPages !== null) {
        return cachedPages;
      }

      const transformedText = applyPageTransformers(text, resolvedConfig);
      const lines = wrapText(transformedText, resolvedConfig);
      const pages = paginate(lines, resolvedConfig);
      cachePages(cacheKey, pages);
      return pages;
    } catch (error) {
      if (error instanceof RangeError) {
        return formatErrorPage(
          `Unable to format content with the requested resource limits. ${error.message}`,
        );
      }

      throw error;
    }
  } finally {
    responseTimeMonitor.record(
      'pageTransformation',
      performance.now() - startedAt,
    );
  }
}
