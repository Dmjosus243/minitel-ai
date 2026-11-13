import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

const RSS_DOCUMENT = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<rss version="2.0">',
  '<channel>',
  '<title>Flux de test</title>',
  '<item>',
  '<title>Article enregistré</title>',
  '<description>Contenu reçu par le service enregistré.</description>',
  '</item>',
  '</channel>',
  '</rss>',
].join('');

const rssFetch = vi.fn(async () => new Response(RSS_DOCUMENT, {
  status: 200,
  headers: { 'content-type': 'application/rss+xml; charset=utf-8' },
}));

let app: (typeof import('./server'))['app'];
let registry: (typeof import('./core/router'))['defaultRegistry'];

beforeAll(async () => {
  vi.resetModules();
  vi.stubEnv('NEWS_RSS_URL', 'https://source.example/actualites.xml');
  vi.stubEnv('NEWS_SUMMARIZER_MODE', 'extractive');
  vi.stubEnv('NEWS_MAX_ARTICLES', '5');
  vi.stubEnv('NEWS_RSS_TIMEOUT_MS', '5000');
  vi.stubEnv('NEWS_RSS_MAX_BYTES', '1048576');
  vi.stubGlobal('fetch', rssFetch);

  const routerModule = await import('./core/router.js');
  const indexModule = await import('./index.js');
  registry = routerModule.defaultRegistry;
  app = indexModule.app;
});

afterAll(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('enregistrement de production de 3615 NEWS', () => {
  it('enregistre NEWS une fois après AIDE et l’affiche dans le menu', async () => {
    /** **Validates: Requirements 1.2, 1.3** */
    const services = registry.getAll();

    expect(services.map(({ code }) => code)).toEqual([
      '3615 AIDE',
      '3615 NEWS',
    ]);
    expect(services.filter(({ code }) => code === '3615 NEWS')).toHaveLength(1);
    expect(services[1]).toMatchObject({
      title: 'Actualités',
      description: 'Les dernières actualités en bref',
    });

    const response = await app.request('/');
    const normalizedBody = (await response.text()).replace(/\s+/gu, ' ');

    expect(response.status).toBe(200);
    expect(normalizedBody).toContain(
      "1. Aide (3615 AIDE) - Mode d'emploi",
    );
    expect(normalizedBody).toContain(
      '2. Actualités (3615 NEWS) - Les dernières actualités en bref',
    );
  });

  it('résout le même service par code normalisé et par numéro', async () => {
    /** **Validates: Requirements 1.4** */
    const codeResponse = await app.request(
      '/?q=%20%203615%20news%20%20',
    );
    const numberResponse = await app.request('/?q=2');
    const codeBody = await codeResponse.text();
    const numberBody = await numberResponse.text();

    expect(codeResponse.status).toBe(200);
    expect(numberResponse.status).toBe(200);
    expect(codeBody).toBe(numberBody);
    expect(codeBody).toContain('3615 NEWS');
    expect(codeBody).toContain('Article enregistré');
    expect(rssFetch).toHaveBeenCalledTimes(2);
  });
});
