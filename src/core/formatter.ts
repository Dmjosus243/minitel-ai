import type { Page, PageConfig } from './types';

export const DEFAULT_PAGE_CONFIG: Readonly<PageConfig> = Object.freeze({
  columns: 40,
  rows: 24,
  maxBytes: 2048,
  wordWrap: true,
});

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
  const resolved = { ...DEFAULT_PAGE_CONFIG, ...config };

  if (!Number.isInteger(resolved.columns) || resolved.columns < 1) {
    throw new RangeError('Page columns must be a positive integer.');
  }

  if (!Number.isInteger(resolved.rows) || resolved.rows < 1) {
    throw new RangeError('Page rows must be a positive integer.');
  }

  if (!Number.isInteger(resolved.maxBytes) || resolved.maxBytes < 1) {
    throw new RangeError('Page maxBytes must be a positive integer.');
  }

  return resolved;
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

export function formatText(text: string, config?: PageConfig): Page[] {
  const resolvedConfig = resolveConfig(config);
  const lines = wrapText(text, resolvedConfig);
  return paginate(lines, resolvedConfig);
}
