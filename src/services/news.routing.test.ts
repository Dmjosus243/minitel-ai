import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { DEFAULT_PAGE_CONFIG } from '../core/config';
import { pageWeight } from '../core/formatter';
import { ServiceRegistry } from '../core/router';
import type { Page } from '../core/types';
import { aideService } from './aide';
import { generateHomepage } from './home';
import { createNewsService } from './news';
import type { NewsItem } from './news/types';

const NORMALIZED_CHARACTERS = Array.from(
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789éàçùôî🙂',
);

const normalizedWordArbitrary = fc
  .array(fc.constantFrom(...NORMALIZED_CHARACTERS), {
    minLength: 1,
    maxLength: 12,
  })
  .map((characters) => characters.join(''));

function normalizedPhraseArbitrary(maxWords: number): fc.Arbitrary<string> {
  return fc
    .array(normalizedWordArbitrary, { minLength: 1, maxLength: maxWords })
    .map((words) => words.join(' '));
}

const optionalDateArbitrary = fc.option(
  fc.integer({ min: 0, max: 20_000 }).map(
    (dayOffset) => new Date(Date.UTC(2000, 0, 1 + dayOffset)),
  ),
  { nil: undefined },
);

const normalizedNewsItemArbitrary: fc.Arbitrary<NewsItem> = fc.record({
  title: normalizedPhraseArbitrary(4),
  sourceText: normalizedPhraseArbitrary(8),
  source: fc.option(normalizedPhraseArbitrary(2), { nil: undefined }),
  publishedAt: optionalDateArbitrary,
});

const normalizedNewsListArbitrary = fc.array(normalizedNewsItemArbitrary, {
  maxLength: 5,
});

function pageText(pages: readonly Page[]): string {
  return pages.flatMap(({ content }) => content).join('\n');
}

function normalizedFlow(text: string): string {
  return text.trim().replace(/\s+/gu, ' ');
}

function createStaticNewsService(items: readonly NewsItem[]) {
  return createNewsService({
    provider: {
      async fetchLatest() {
        return items;
      },
    },
    summarizer: {
      async summarize(item) {
        return item.sourceText;
      },
    },
    logger: { error() {} },
  });
}

describe('intégration du routage de 3615 NEWS', () => {
  it('préserve l’ordre, la découverte et la sélection par code ou numéro', async () => {
    /** **Validates: Requirements 1.1, 1.3, 1.4** */
    const registry = new ServiceRegistry();
    const newsService = createStaticNewsService([{
      title: 'Actualité routée',
      sourceText: 'Résumé routé sans perte.',
    }]);

    registry.register(aideService);
    registry.register(newsService);

    expect(registry.getAll().map(({ code }) => code)).toEqual([
      '3615 AIDE',
      '3615 NEWS',
    ]);
    expect(registry.get('3615 NEWS')).toBe(registry.get('  3615   nEwS  '));

    const exactPages = await registry.route('3615 NEWS');
    const mixedCasePages = await registry.route('3615 nEwS');
    const extraSpacePages = await registry.route('  3615    news  ');
    const numberedService = registry.getAll()[1];

    expect(numberedService?.code).toBe('3615 NEWS');
    const numberedPages = await registry.route(numberedService?.code ?? '');

    expect(mixedCasePages).toEqual(exactPages);
    expect(extraSpacePages).toEqual(exactPages);
    expect(numberedPages).toEqual(exactPages);
    expect(pageText(exactPages)).toContain('3615 NEWS');
    expect(pageText(exactPages)).toContain('Actualité routée');

    const homepage = pageText(generateHomepage(registry.getAll(), {
      layout: { header: 'MINITEL IA' },
    }));
    const normalizedHomepage = normalizedFlow(homepage);

    expect(normalizedHomepage).toContain("1. Aide (3615 AIDE) - Mode d'emploi");
    expect(normalizedHomepage).toContain(
      '2. Actualités (3615 NEWS) - Les dernières actualités en bref',
    );
  });

  it('Feature: news-service, Property 5: Routed Page Constraints', async () => {
    /** **Validates: Requirements 1.5, 6.7, 6.8, 6.9, 8.8** */
    await fc.assert(
      fc.asyncProperty(normalizedNewsListArbitrary, async (items) => {
        const registry = new ServiceRegistry();
        const newsService = createStaticNewsService(items);
        let renderedServiceText = '';

        registry.register({
          ...newsService,
          async render() {
            renderedServiceText = await newsService.render();
            return renderedServiceText;
          },
        });

        const pages = await registry.route(' 3615   nEwS ');

        expect(pages.length).toBeGreaterThan(0);
        expect(normalizedFlow(pageText(pages))).toBe(
          normalizedFlow(renderedServiceText),
        );

        for (const page of pages) {
          expect(page.content.length).toBeLessThanOrEqual(
            DEFAULT_PAGE_CONFIG.rows,
          );
          expect(
            page.content.every(
              (line) => Array.from(line).length <= DEFAULT_PAGE_CONFIG.columns,
            ),
          ).toBe(true);
          expect(pageWeight(page)).toBe(page.metadata.byteSize);
          expect(pageWeight(page)).toBeLessThan(DEFAULT_PAGE_CONFIG.maxBytes);
        }
      }),
      { numRuns: 100 },
    );
  });
});
