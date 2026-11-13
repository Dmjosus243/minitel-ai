import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { ServiceRegistry } from '../core/router';
import type { Service } from '../core/types';
import {
  NewsConfigurationError,
  type NewsConfigurationErrorCode,
} from './news/config';
import { generateHomepage } from './home';
import {
  createNewsService,
  NEWS_UNAVAILABLE_MESSAGE,
} from './news';
import {
  RssSourceError,
  type RssSourceFailureKind,
} from './news/rss-provider';
import {
  createAiSummarizer,
  createExtractiveSummarizer,
} from './news/summarizers';
import type {
  ArticleSummarizer,
  NewsItem,
  NewsProvider,
  SummaryBudget,
} from './news/types';

const FIRST_ITEM: NewsItem = {
  title: 'Première actualité',
  sourceText: 'Premier texte source.',
  source: 'Agence Une',
  publishedAt: new Date('2026-01-02T10:30:00.000Z'),
};
const SECOND_ITEM: NewsItem = {
  title: 'Deuxième actualité',
  sourceText: 'Deuxième texte source.',
};

function providerReturning(items: readonly NewsItem[]): NewsProvider {
  return {
    async fetchLatest(): Promise<readonly NewsItem[]> {
      return items;
    },
  };
}

function providerFailing(error: unknown): NewsProvider {
  return {
    async fetchLatest(): Promise<readonly NewsItem[]> {
      throw error;
    },
  };
}

function collectingLogger(logs: string[]): Pick<Console, 'error'> {
  return {
    error(...values: unknown[]): void {
      logs.push(values.map(String).join(' '));
    },
  };
}

function pageText(pages: Awaited<ReturnType<ServiceRegistry['route']>>): string {
  return pages.flatMap((page) => page.content).join('\n');
}

describe('service 3615 NEWS', () => {
  it('expose ses métadonnées et orchestre une acquisition unique dans l’ordre du flux', async () => {
    /** **Validates: Requirements 1.1, 1.2, 1.5, 5.4, 6.1, 8.5, 8.8** */
    const events: string[] = [];
    const signals: AbortSignal[] = [];
    const budgets: SummaryBudget[] = [];
    const provider: NewsProvider = {
      async fetchLatest(signal): Promise<readonly NewsItem[]> {
        events.push('fetch');
        signals.push(signal);
        return [FIRST_ITEM, SECOND_ITEM];
      },
    };
    const summarizer: ArticleSummarizer = {
      async summarize(item, budget): Promise<string> {
        events.push(`summarize:${item.title}`);
        budgets.push({ ...budget });
        return `<p>Résumé de ${item.title}.</p><script>secret()</script>`;
      },
    };
    const service = createNewsService({ provider, summarizer });

    const content = await service.render();

    expect(service).toMatchObject({
      code: '3615 NEWS',
      title: 'Actualités',
      description: 'Les dernières actualités en bref',
    });
    expect(events).toEqual([
      'fetch',
      'summarize:Première actualité',
      'summarize:Deuxième actualité',
    ]);
    expect(signals).toHaveLength(1);
    expect(signals[0]).toBeInstanceOf(AbortSignal);
    expect(signals[0]?.aborted).toBe(false);
    expect(budgets).toEqual([
      { maxCharacters: 600, language: 'fr' },
      { maxCharacters: 600, language: 'fr' },
    ]);
    expect(content).toBe([
      '3615 NEWS',
      '',
      '1. Première actualité',
      'Agence Une - 2026-01-02',
      'Résumé de Première actualité.',
      '',
      '2. Deuxième actualité',
      'Résumé de Deuxième actualité.',
    ].join('\n'));
    expect(content).not.toContain('<');
    expect(content).not.toContain('secret');
  });

  it('rend le message vide exact sans appeler le résumeur', async () => {
    /** **Validates: Requirements 6.5** */
    let summaryCalls = 0;
    const service = createNewsService({
      provider: providerReturning([]),
      summarizer: {
        async summarize(): Promise<string> {
          summaryCalls += 1;
          return 'Résumé inattendu';
        },
      },
    });

    await expect(service.render()).resolves.toBe(
      'Aucune actualité disponible',
    );
    expect(summaryCalls).toBe(0);
  });

  it('ignore les éléments mal formés et conserve les articles valides', async () => {
    /** **Validates: Requirements 6.1, 6.5, 7.3** */
    const providerItems = [
      null,
      { title: '<script>titre caché</script>', sourceText: 'Corps ignoré.' },
      FIRST_ITEM,
      { title: 'Source invalide', sourceText: 42 },
    ] as unknown as readonly NewsItem[];
    const summarizedTitles: string[] = [];
    const service = createNewsService({
      provider: providerReturning(providerItems),
      summarizer: {
        async summarize(item): Promise<string> {
          summarizedTitles.push(item.title);
          return 'Résumé conservé.';
        },
      },
    });

    const content = await service.render();

    expect(summarizedTitles).toEqual(['Première actualité']);
    expect(content).toBe([
      '3615 NEWS',
      '',
      '1. Première actualité',
      'Agence Une - 2026-01-02',
      'Résumé conservé.',
    ].join('\n'));
  });

  it.each([
    {
      label: 'une panne RSS classée',
      createFailure: (): Error => {
        const error = new RssSourceError('network');
        error.message = 'https://source.example/rss?token=secret; <rss>privé</rss>';
        return error;
      },
    },
    {
      label: 'une configuration dégradée',
      createFailure: (): Error => new NewsConfigurationError(
        'invalid-url',
        'NEWS_RSS_URL',
        'URL privée https://source.example/rss?token=secret',
      ),
    },
  ])('mappe $label vers le seul message indisponible', async ({ createFailure }) => {
    /** **Validates: Requirements 7.1, 7.2, 7.5, 7.6** */
    const logs: string[] = [];
    const service = createNewsService({
      provider: providerFailing(createFailure()),
      summarizer: createExtractiveSummarizer(),
      logger: collectingLogger(logs),
    });

    const content = await service.render();
    const diagnostic = logs.join('\n');

    expect(content).toBe(NEWS_UNAVAILABLE_MESSAGE);
    expect(content).toBe('Service temporairement indisponible');
    expect(logs).toHaveLength(1);
    expect(diagnostic).toMatch(/^NEWS (?:RSS source|configuration) unavailable\.$/u);
    expect(diagnostic).not.toContain('secret');
    expect(diagnostic).not.toContain('token=');
    expect(diagnostic).not.toContain('<rss>');
  });

  it('conserve le repli extractif lorsqu’un résumé IA échoue', async () => {
    /** **Validates: Requirements 5.4, 7.4** */
    let aiCalls = 0;
    const aiLogs: string[] = [];
    const serviceLogs: string[] = [];
    const summarizer = createAiSummarizer({
      client: {
        async summarize(): Promise<string> {
          aiCalls += 1;
          throw new Error('réponse IA privée');
        },
      },
      fallback: createExtractiveSummarizer(),
      logger: collectingLogger(aiLogs),
    });
    const service = createNewsService({
      provider: providerReturning([{
        title: 'Repli IA',
        sourceText: 'Le texte source reste utilisable.',
      }]),
      summarizer,
      logger: collectingLogger(serviceLogs),
    });

    const content = await service.render();

    expect(aiCalls).toBe(1);
    expect(aiLogs).toHaveLength(1);
    expect(serviceLogs).toEqual([]);
    expect(content).toBe([
      '3615 NEWS',
      '',
      '1. Repli IA',
      'Le texte source reste utilisable.',
    ].join('\n'));
    expect(content).not.toContain(NEWS_UNAVAILABLE_MESSAGE);
  });

  it('retourne le repli même lorsque le journal échoue', async () => {
    /** **Validates: Requirements 7.1, 7.2, 7.5, 7.6** */
    const service = createNewsService({
      provider: providerFailing(new RssSourceError('timeout')),
      summarizer: createExtractiveSummarizer(),
      logger: {
        error(): never {
          throw new Error('journal indisponible');
        },
      },
    });

    await expect(service.render()).resolves.toBe(NEWS_UNAVAILABLE_MESSAGE);
  });

  it('laisse le routeur, l’accueil et les autres services répondre après une panne NEWS', async () => {
    /** **Validates: Requirements 7.1, 7.2, 7.6** */
    const registry = new ServiceRegistry(collectingLogger([]));
    const newsService = createNewsService({
      provider: providerFailing(new RssSourceError('status')),
      summarizer: createExtractiveSummarizer(),
      logger: collectingLogger([]),
    });
    const healthyService: Service = {
      code: '3615 TEST',
      title: 'Service témoin',
      description: 'Toujours disponible',
      async render(): Promise<string> {
        return 'Service témoin opérationnel';
      },
    };
    registry.register(newsService);
    registry.register(healthyService);

    const failedNews = pageText(await registry.route('3615 NEWS'));
    const healthyContent = pageText(await registry.route('3615 TEST'));
    const homepage = pageText(generateHomepage(registry.getAll()));

    expect(failedNews).toBe(NEWS_UNAVAILABLE_MESSAGE);
    expect(healthyContent).toBe('Service témoin opérationnel');
    expect(homepage).toContain('1. Actualités (3615 NEWS)');
    expect(homepage).toContain('2. Service témoin (3615 TEST)');
  });

  it('ne transforme pas une erreur interne non classée en panne de source', async () => {
    /** **Validates: Requirements 7.1, 7.6** */
    const internalError = new Error('erreur de programmation');
    const service = createNewsService({
      provider: providerFailing(internalError),
      summarizer: createExtractiveSummarizer(),
      logger: collectingLogger([]),
    });

    await expect(service.render()).rejects.toBe(internalError);
  });
});

const RSS_SOURCE_FAILURE_KIND_COVERAGE = {
  aborted: true,
  'body-too-large': true,
  'content-type': true,
  'invalid-response': true,
  'invalid-rss': true,
  network: true,
  redirect: true,
  status: true,
  timeout: true,
} as const satisfies Record<RssSourceFailureKind, true>;

const CONFIGURATION_ERROR_CODE_COVERAGE = {
  'missing-value': true,
  'invalid-url': true,
  'unsupported-summary-mode': true,
  'invalid-integer': true,
  'out-of-range': true,
  'empty-value': true,
} as const satisfies Record<NewsConfigurationErrorCode, true>;

type ClassifiedFailureCase =
  | { boundary: 'rss'; kind: RssSourceFailureKind }
  | { boundary: 'configuration'; code: NewsConfigurationErrorCode };

const CLASSIFIED_FAILURE_CASES: readonly ClassifiedFailureCase[] = [
  ...Object.keys(RSS_SOURCE_FAILURE_KIND_COVERAGE).map((kind) => ({
    boundary: 'rss' as const,
    kind: kind as RssSourceFailureKind,
  })),
  ...Object.keys(CONFIGURATION_ERROR_CODE_COVERAGE).map((code) => ({
    boundary: 'configuration' as const,
    code: code as NewsConfigurationErrorCode,
  })),
];

function classifiedFailure(
  failureCase: ClassifiedFailureCase,
  message: string,
): RssSourceError | NewsConfigurationError {
  if (failureCase.boundary === 'rss') {
    const error = new RssSourceError(failureCase.kind);
    error.message = message;
    return error;
  }

  return new NewsConfigurationError(
    failureCase.code,
    'NEWS_RSS_URL',
    message,
  );
}

const diagnosticPartsArbitrary = fc.record({
  marker: fc.uuid(),
  payload: fc.string({ maxLength: 80 }),
});

describe('propriétés du service NEWS', () => {
  it('Feature: news-service, Property 7: Source Failure Mapping', async () => {
    /** **Validates: Requirements 7.1, 7.2, 7.5, 7.6** */
    await fc.assert(
      fc.asyncProperty(
        diagnosticPartsArbitrary,
        async ({ marker, payload }) => {
          const generatedMessages = [
            `Incident de source ${marker}: ${payload}`,
            `GET https://source.example/rss?token=${marker}; corps=<rss>${payload}</rss>`,
          ];

          for (const failureCase of CLASSIFIED_FAILURE_CASES) {
            for (const message of generatedMessages) {
              const logs: string[] = [];
              const service = createNewsService({
                provider: providerFailing(classifiedFailure(
                  failureCase,
                  message,
                )),
                summarizer: createExtractiveSummarizer(),
                logger: collectingLogger(logs),
              });

              const content = await service.render();
              const diagnostic = logs.join('\n');

              expect(content).toBe(NEWS_UNAVAILABLE_MESSAGE);
              expect(logs).toHaveLength(1);
              expect(content).not.toContain(marker);
              expect(diagnostic).not.toContain(marker);
              expect(diagnostic).not.toContain(message);
              expect(diagnostic).not.toContain('token=');
              expect(diagnostic).not.toContain('<rss>');
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
