import { describe, expect, it } from 'vitest';

import {
  createProductionNewsService,
  NEWS_UNAVAILABLE_MESSAGE,
} from './news';

const RSS_DOCUMENT = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<rss version="2.0">',
  '<channel>',
  '<title>Flux de test</title>',
  '<item>',
  '<title>Article composé</title>',
  '<description>Une première phrase. Une deuxième phrase.</description>',
  '</item>',
  '</channel>',
  '</rss>',
].join('');

function successfulRssResponse(): Response {
  return new Response(RSS_DOCUMENT, {
    status: 200,
    headers: { 'content-type': 'application/rss+xml; charset=utf-8' },
  });
}

function collectingLogger(logs: string[]): Pick<Console, 'error'> {
  return {
    error(...values: unknown[]): void {
      logs.push(values.map(String).join(' '));
    },
  };
}

describe('composition de production du service NEWS', () => {
  it('compose le transport borné, le parseur sûr et la stratégie extractive par défaut', async () => {
    /** **Validates: Requirements 2.1, 3.1, 3.2, 7.6, 8.1** */
    const rssRequests: Array<{ url: string; init: RequestInit }> = [];
    let aiRequests = 0;
    const service = createProductionNewsService({
      environment: {
        NEWS_RSS_URL: 'https://source.example/actualites.xml',
        NEWS_SUMMARIZER_MODE: '   ',
        NEWS_AI_ENDPOINT: 'https://ai.example/resumes',
      },
      rssFetchImplementation: async (url, init) => {
        rssRequests.push({ url: url.href, init });
        return successfulRssResponse();
      },
      aiFetchImplementation: async () => {
        aiRequests += 1;
        throw new Error('La stratégie IA ne doit pas être construite.');
      },
      logger: collectingLogger([]),
    });

    await expect(service.render()).resolves.toBe([
      '3615 NEWS',
      '',
      '1. Article composé',
      'Une première phrase. Une deuxième phrase.',
    ].join('\n'));
    expect(rssRequests).toHaveLength(1);
    expect(rssRequests[0]?.url).toBe(
      'https://source.example/actualites.xml',
    );
    expect(rssRequests[0]?.init).toMatchObject({
      credentials: 'omit',
      redirect: 'manual',
    });
    expect(aiRequests).toBe(0);
  });

  it('compose la stratégie IA optionnelle lorsque le mode ai est configuré', async () => {
    /** **Validates: Requirements 3.1, 3.3, 8.4** */
    const aiRequests: Array<{ url: string; init: RequestInit }> = [];
    const service = createProductionNewsService({
      environment: {
        NEWS_RSS_URL: 'https://source.example/actualites.xml',
        NEWS_SUMMARIZER_MODE: ' AI ',
        NEWS_AI_ENDPOINT: 'https://ai.example/resumes',
        NEWS_AI_MODEL: 'modele-fr',
        NEWS_AI_API_KEY: 'cle-privee',
      },
      rssFetchImplementation: async () => successfulRssResponse(),
      aiFetchImplementation: async (url, init) => {
        aiRequests.push({ url: url.href, init });
        return new Response(JSON.stringify({
          summary: '<strong>Résumé IA composé.</strong>',
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
      logger: collectingLogger([]),
    });

    const content = await service.render();

    expect(content).toContain('Résumé IA composé.');
    expect(content).not.toContain('<strong>');
    expect(aiRequests).toHaveLength(1);
    expect(aiRequests[0]?.url).toBe('https://ai.example/resumes');
    expect(aiRequests[0]?.init).toMatchObject({
      method: 'POST',
      credentials: 'omit',
      redirect: 'manual',
    });
  });

  it.each([
    {
      label: 'une URL RSS non HTTPS',
      environment: {
        NEWS_RSS_URL: 'http://source.example/rss?token=secret-rss',
      },
    },
    {
      label: 'une URL IA contenant des identifiants',
      environment: {
        NEWS_RSS_URL: 'https://source.example/actualites.xml',
        NEWS_SUMMARIZER_MODE: 'ai',
        NEWS_AI_ENDPOINT: 'https://utilisateur:secret-ai@ai.example/resumes',
      },
    },
  ])('crée le service dégradé sans divulgation pour $label', async ({ environment }) => {
    /** **Validates: Requirements 3.4, 7.5, 7.6, 8.4, 8.7** */
    const logs: string[] = [];
    let rssRequests = 0;
    const service = createProductionNewsService({
      environment,
      logger: collectingLogger(logs),
      rssFetchImplementation: async () => {
        rssRequests += 1;
        return successfulRssResponse();
      },
    });

    expect(service).toMatchObject({
      code: '3615 NEWS',
      title: 'Actualités',
      description: 'Les dernières actualités en bref',
    });
    await expect(service.render()).resolves.toBe(NEWS_UNAVAILABLE_MESSAGE);
    expect(rssRequests).toBe(0);
    expect(logs).toEqual(['NEWS configuration unavailable.']);
    expect(logs.join('\n')).not.toMatch(/secret|token|utilisateur/iu);
  });

  it('laisse démarrer le service dégradé lorsque le journal échoue', async () => {
    /** **Validates: Requirements 7.5, 7.6** */
    const service = createProductionNewsService({
      environment: {},
      logger: {
        error(): never {
          throw new Error('journal indisponible');
        },
      },
    });

    await expect(service.render()).resolves.toBe(NEWS_UNAVAILABLE_MESSAGE);
  });
});
