import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { DEFAULT_PAGE_CONFIG, formatText, pageWeight } from './formatter';

const randomTextArbitrary = fc
  .array(
    fc.oneof(
      fc.string({ maxLength: 160 }),
      fc.constantFrom('\n', '\r\n', '\u2028', '\u2029'),
      fc.constantFrom('é', '界', '😀', '—', '…', '\u00a0'),
    ),
    { maxLength: 80 },
  )
  .map((fragments) => fragments.join(''));

describe('page transformer properties', () => {
  it('Feature: minitel-core, Property 1: Line Length Constraint', () => {
    /** **Validates: Requirements 1.1, 1.2** */
    fc.assert(
      fc.property(randomTextArbitrary, (text) => {
        const pages = formatText(text);

        for (const page of pages) {
          for (const line of page.content) {
            expect(Array.from(line).length).toBeLessThanOrEqual(
              DEFAULT_PAGE_CONFIG.columns,
            );
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it('Feature: minitel-core, Property 2: Page Line Count Constraint', () => {
    /** **Validates: Requirements 1.3** */
    fc.assert(
      fc.property(randomTextArbitrary, (text) => {
        const pages = formatText(text);

        for (const page of pages) {
          expect(page.content.length).toBeLessThanOrEqual(
            DEFAULT_PAGE_CONFIG.rows,
          );
        }
      }),
      { numRuns: 100 },
    );
  });

  it('Feature: minitel-core, Property 3: Page Size Constraint', () => {
    /** **Validates: Requirements 2.1, 2.2, 2.3** */
    fc.assert(
      fc.property(randomTextArbitrary, (text) => {
        const pages = formatText(text);

        for (const page of pages) {
          const serializedByteSize = pageWeight(page);

          expect(page.metadata.byteSize).toBe(serializedByteSize);
          expect(serializedByteSize).toBeLessThan(
            DEFAULT_PAGE_CONFIG.maxBytes,
          );
        }
      }),
      { numRuns: 100 },
    );
  });
});

describe('page transformer edge cases', () => {
  it('returns one empty page for empty input', () => {
    const pages = formatText('');

    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({
      content: [],
      pageNumber: 1,
      totalPages: 1,
    });
    expect(pages[0].metadata.byteSize).toBe(pageWeight(pages[0]));
    expect(pages[0].metadata.byteSize).toBeLessThan(
      DEFAULT_PAGE_CONFIG.maxBytes,
    );
  });

  it('splits a very long word at the column boundary without losing content', () => {
    const word = 'x'.repeat(DEFAULT_PAGE_CONFIG.columns * 2 + 5);
    const pages = formatText(word);

    expect(pages).toHaveLength(1);
    expect(pages[0].content).toEqual([
      'x'.repeat(DEFAULT_PAGE_CONFIG.columns),
      'x'.repeat(DEFAULT_PAGE_CONFIG.columns),
      'x'.repeat(5),
    ]);
    expect(pages[0].content.join('')).toBe(word);
  });

  it('converts special formatting characters to Minitel-compatible equivalents', () => {
    /** **Validates: Requirements 1.5** */
    const pages = formatText(
      '\u201cBonjour\u201d\u00a0\u2014\u202fc\u2019est\u2026 \u2022',
    );

    expect(pages).toHaveLength(1);
    expect(pages[0].content).toEqual([`"Bonjour" - c'est... *`]);
  });

  it('keeps an exactly 40-character line intact', () => {
    const line = '1234567890'.repeat(4);
    const pages = formatText(line);

    expect(Array.from(line)).toHaveLength(DEFAULT_PAGE_CONFIG.columns);
    expect(pages).toHaveLength(1);
    expect(pages[0].content).toEqual([line]);
  });

  it('keeps exactly 24 fitting lines on one near-limit page', () => {
    /** **Validates: Requirements 2.4** */
    const lines = Array.from(
      { length: DEFAULT_PAGE_CONFIG.rows },
      (_, index) => `Line ${String(index + 1).padStart(2, '0')}`,
    );
    const text = lines.join('\n');
    const baselinePage = formatText(text)[0];
    const maxBytes = baselinePage.metadata.byteSize + 1;
    const pages = formatText(text, {
      ...DEFAULT_PAGE_CONFIG,
      maxBytes,
    });

    expect(pages).toHaveLength(1);
    expect(pages[0].content).toEqual(lines);
    expect(pages[0].content).toHaveLength(DEFAULT_PAGE_CONFIG.rows);
    expect(pages[0].metadata.byteSize).toBe(maxBytes - 1);
    expect(pageWeight(pages[0])).toBeLessThan(maxBytes);
  });
});