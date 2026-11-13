import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

const RSS_URL = 'https://source.example/actualites.xml';
const AI_URL = 'https://ai.example/resumes';

interface RssFixtureItem {
  title: string;
  description: string;
  source?: string;
  publishedAt?: string;
}

interface SerializedPage {
  content: string[];
  weight: number;
}

type ExternalFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

function rssDocument(items: readonly RssFixtureItem[]): string {
  const renderedItems = items.map((item) => [
    '<item>',
    `<title>${item.title}</title>`,
    `<description>${item.description}</description>`,
    ...(item.source === undefined ? [] : [`<source>${item.source}</source>`]),
    ...(item.publishedAt === undefined
      ? []
      : [`<pubDate>${item.publishedAt}</pubDate>`]),
    '</item>',
  ].join(''));

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0">',
    '<channel>',
    '<title>Flux d’intégration</title>',
    ...renderedItems,
    '</channel>',
    '</rss>',
  ].join('');
}

function rssResponse(document: string, status = 200): Response {
  return new Response(document, {
    status,
    headers: { 'content-type': 'application/rss+xml; charset=utf-8' },
  });
}

function requestUrl(input: string | URL | Request): string {
  return input instanceof Request ? input.url : String(input);
}

async function loadProductionApplication(
  fetchImplementation: ExternalFetch,
  environment: Readonly<Record<string, string>> = {},
) {
  vi.resetModules();

  const testEnvironment = {
    NODE_ENV: 'test',
    MINITEL_PAGE_COLUMNS: '40',
    MINITEL_PAGE_ROWS: '24',
    MINITEL_PAGE_MAX_BYTES: '2048',
    MINITEL_PAGE_WORD_WRAP: 'true',
    NEWS_RSS_URL: RSS_URL,
    NEWS_SUMMARIZER_MODE: 'extractive',
    NEWS_MAX_ARTICLES: '5',
    NEWS_RSS_TIMEOUT_MS: '5000',
    NEWS_RSS_MAX_BYTES: '1048576',
    NEWS_AI_ENDPOINT: AI_URL,
    NEWS_AI_MODEL: 'modele-test',
    NEWS_AI_API_KEY: 'cle-test',
    NEWS_AI_TIMEOUT_MS: '5000',
    ...environment,
  };

  for (const [name, value] of Object.entries(testEnvironment)) {
    vi.stubEnv(name, value);
  }
  vi.stubGlobal('fetch', vi.fn(fetchImplementation));

  // Le transport externe est remplacé avant le chargement de l’enregistrement.
  const indexModule = await import('./index.js');
  const routerModule = await import('./core/router.js');

  return {
    app: indexModule.app,
    registry: routerModule.defaultRegistry,
    externalFetch: vi.mocked(fetch),
  };
}

function parseSerializedPages(body: string): SerializedPage[] {
  const parts = body.split(/\n\nPoids: (\d+) octets(?:\n\n|$)/gu);
  const tail = parts.at(-1);

  if (tail !== '' || parts.length < 3 || (parts.length - 1) % 2 !== 0) {
    throw new Error('La réponse HTTP ne contient pas les lignes de poids attendues.');
  }

  const pages: SerializedPage[] = [];
  for (let index = 0; index < parts.length - 1; index += 2) {
    const pageContent = parts[index] ?? '';
    const weight = Number(parts[index + 1]);
    pages.push({
      content: pageContent === '' ? [] : pageContent.split('\n'),
      weight,
    });
  }

  return pages;
}

function normalizedPageContent(pages: readonly SerializedPage[]): string {
  return pages
    .flatMap(({ content }) => content)
    .join('\n')
    .trim()
    .replace(/\s+/gu, ' ');
}

function expectMinitelConstraints(pages: readonly SerializedPage[]): void {
  expect(pages.length).toBeGreaterThan(0);

  for (const page of pages) {
    expect(page.content.length).toBeLessThanOrEqual(24);
    expect(page.content.every((line) => Array.from(line).length <= 40)).toBe(true);
    expect(page.weight).toBeLessThan(2048);
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('intégration HTTP de 3615 NEWS', () => {
  it('sert le flux extractif paginé par code et par numéro sans appel IA', async () => {
    /** **Validates: Requirements 1.4, 3.6, 6.1, 6.7, 6.8, 6.9** */
    const items = Array.from({ length: 5 }, (_, index) => {
      const articleNumber = index + 1;
      const repeatedDetails = Array.from(
        { length: 7 },
        (_, detailIndex) => (
          `Le détail ${detailIndex + 1} de l’article ${articleNumber} reste lisible `
          + 'sur une connexion limitée.'
        ),
      ).join(' ');

      return {
        title: `Titre public ${articleNumber}`,
        description: `Résumé ${articleNumber} commence ici. ${repeatedDetails}`,
        source: 'Agence test',
        publishedAt: `Mon, ${String(articleNumber).padStart(2, '0')} Jan 2024 12:00:00 GMT`,
      };
    });
    const document = rssDocument(items);
    const externalFetch = vi.fn<ExternalFetch>(async (input) => {
      const url = requestUrl(input);
      if (url !== RSS_URL) {
        throw new Error(`Appel externe inattendu: ${url}`);
      }
      return rssResponse(document);
    });
    const { app, registry } = await loadProductionApplication(externalFetch);

    expect(registry.getAll().map(({ code }) => code)).toEqual([
      '3615 AIDE',
      '3615 NEWS',
    ]);

    const homepageResponse = await app.request('/');
    const homepage = (await homepageResponse.text()).replace(/\s+/gu, ' ');
    expect(homepage).toContain("1. Aide (3615 AIDE) - Mode d'emploi");
    expect(homepage).toContain(
      '2. Actualités (3615 NEWS) - Les dernières actualités en bref',
    );

    const codeResponse = await app.request('/?q=3615%20NEWS');
    const numberedResponse = await app.request('/?q=2');
    const codeBody = await codeResponse.text();
    const numberedBody = await numberedResponse.text();
    const pages = parseSerializedPages(codeBody);
    const content = normalizedPageContent(pages);

    expect(codeResponse.status).toBe(200);
    expect(numberedResponse.status).toBe(200);
    expect(numberedBody).toBe(codeBody);
    expect(pages.length).toBeGreaterThan(1);
    expect(content).toContain('3615 NEWS');
    for (let articleNumber = 1; articleNumber <= items.length; articleNumber += 1) {
      expect(content).toContain(`Titre public ${articleNumber}`);
      expect(content).toContain(`Résumé ${articleNumber} commence ici.`);
    }
    expectMinitelConstraints(pages);
    expect(codeBody.match(/^Poids: \d+ octets$/gmu)).toHaveLength(pages.length);

    expect(externalFetch).toHaveBeenCalledTimes(2);
    expect(
      externalFetch.mock.calls.every(([input]) => requestUrl(input) === RSS_URL),
    ).toBe(true);
  });

  it('rend l’état vide valide depuis un flux RSS utilisable', async () => {
    /** **Validates: Requirements 6.5, 7.6** */
    const externalFetch = vi.fn<ExternalFetch>(async () => rssResponse(
      rssDocument([]),
    ));
    const { app } = await loadProductionApplication(externalFetch);

    const response = await app.request('/?q=3615%20NEWS');
    const body = await response.text();
    const pages = parseSerializedPages(body);

    expect(response.status).toBe(200);
    expect(pages).toHaveLength(1);
    expect(pages[0]?.content).toEqual(['Aucune actualité disponible']);
    expect(body).not.toContain('Service temporairement indisponible');
    expectMinitelConstraints(pages);
    expect(externalFetch).toHaveBeenCalledTimes(1);
  });

  it('rend exactement l’indisponibilité française et garde le reste du serveur actif', async () => {
    /** **Validates: Requirements 7.1, 7.2, 7.6** */
    const logger = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const externalFetch = vi.fn<ExternalFetch>(async () => rssResponse(
      '<rss>detail distant confidentiel</rss>',
      503,
    ));
    const { app } = await loadProductionApplication(externalFetch);

    const failedResponse = await app.request('/?q=3615%20NEWS');
    const failedBody = await failedResponse.text();
    const failedPages = parseSerializedPages(failedBody);

    expect(failedResponse.status).toBe(200);
    expect(failedPages).toHaveLength(1);
    expect(failedPages[0]?.content).toEqual([
      'Service temporairement indisponible',
    ]);
    expect(failedBody).not.toContain('detail distant confidentiel');
    expect(logger).toHaveBeenCalledWith('NEWS RSS source unavailable.');

    const homepageResponse = await app.request('/');
    const aideResponse = await app.request('/?q=1');
    expect(homepageResponse.status).toBe(200);
    await expect(homepageResponse.text()).resolves.toContain('3615 NEWS');
    expect(aideResponse.status).toBe(200);
    await expect(aideResponse.text()).resolves.toContain('3615 AIDE');
    expect(externalFetch).toHaveBeenCalledTimes(1);
  });

  it('utilise le résumé IA puis le repli extractif sans rendre NEWS indisponible', async () => {
    /** **Validates: Requirements 3.6, 6.1, 7.4, 7.6** */
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const document = rssDocument([
      {
        title: 'Article résumé par IA',
        description: 'Texte source du premier article.',
      },
      {
        title: 'Article avec repli',
        description: 'Résumé extractif de secours. Deuxième phrase conservée.',
      },
    ]);
    let aiRequestCount = 0;
    const externalFetch = vi.fn<ExternalFetch>(async (input) => {
      const url = requestUrl(input);
      if (url === RSS_URL) {
        return rssResponse(document);
      }
      if (url === AI_URL) {
        aiRequestCount += 1;
        if (aiRequestCount === 1) {
          return new Response(JSON.stringify({
            summary: '<strong>Résumé IA validé.</strong>',
          }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }

        return new Response('échec fournisseur privé', {
          status: 502,
          headers: { 'content-type': 'text/plain' },
        });
      }

      throw new Error(`Appel externe inattendu: ${url}`);
    });
    const { app } = await loadProductionApplication(externalFetch, {
      NEWS_SUMMARIZER_MODE: 'ai',
    });

    const response = await app.request('/?q=3615%20NEWS');
    const body = await response.text();
    const pages = parseSerializedPages(body);
    const content = normalizedPageContent(pages);

    expect(response.status).toBe(200);
    expect(content).toContain('Résumé IA validé.');
    expect(content).toContain(
      'Résumé extractif de secours. Deuxième phrase conservée.',
    );
    expect(content).not.toContain('<strong>');
    expect(content).not.toContain('échec fournisseur privé');
    expect(content).not.toContain('Service temporairement indisponible');
    expectMinitelConstraints(pages);

    expect(aiRequestCount).toBe(2);
    expect(externalFetch.mock.calls.map(([input]) => requestUrl(input))).toEqual([
      RSS_URL,
      AI_URL,
      AI_URL,
    ]);
  });
});
