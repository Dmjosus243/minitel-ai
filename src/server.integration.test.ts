import { performance } from 'node:perf_hooks';

import { serve, type ServerType } from '@hono/node-server';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';

import {
  clearPageCache,
  getPageCacheStats,
} from './core/formatter';
import { responseTimeMonitor } from './core/performance';
import { registerService } from './core/router';
import type { Service } from './core/types';
import app from './server';

const CONCURRENT_REQUESTS = 50;
const SERVICE_CONTENT = Array.from(
  { length: 12 },
  (_, index) => `Actualité ${index + 1}: contenu de test pour le service Minitel.`,
).join('\n');

const INTEGRATION_SERVICE: Service = {
  code: '3699 INTEGRATION',
  title: 'Service intégration',
  description: 'Service utilisé par les tests HTTP',
  async render() {
    return SERVICE_CONTENT;
  },
};

let httpServer: ServerType | undefined;
let baseUrl = '';

function serviceUrl(): URL {
  const url = new URL('/', baseUrl);
  url.searchParams.set('q', INTEGRATION_SERVICE.code);
  return url;
}

function percentile95(samples: readonly number[]): number {
  const sortedSamples = [...samples].sort((left, right) => left - right);
  const index = Math.ceil(sortedSamples.length * 0.95) - 1;
  return sortedSamples[index] ?? Number.POSITIVE_INFINITY;
}

beforeAll(async () => {
  registerService(INTEGRATION_SERVICE);

  await new Promise<void>((resolve, reject) => {
    httpServer = serve(
      {
        fetch: app.fetch,
        hostname: '127.0.0.1',
        port: 0,
      },
      ({ port }) => {
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      },
    );
    httpServer.once('error', reject);
  });
});

afterAll(async () => {
  if (httpServer === undefined) {
    return;
  }

  await new Promise<void>((resolve) => {
    httpServer?.close(() => resolve());
  });
});

beforeEach(() => {
  clearPageCache();
  responseTimeMonitor.clear();
});

describe('serveur HTTP de bout en bout', () => {
  it("sert l'accueil puis un service à travers l'adaptateur Node", async () => {
    const homepageResponse = await fetch(baseUrl);
    const homepageBody = await homepageResponse.text();

    expect(homepageResponse.status).toBe(200);
    expect(homepageResponse.headers.get('content-type')).toMatch(/^text\/plain/u);
    expect(homepageBody).toContain('MINITEL IA');
    expect(homepageBody.replace(/\s+/gu, ' ')).toContain(
      INTEGRATION_SERVICE.code,
    );

    const serviceResponse = await fetch(serviceUrl());
    const serviceBody = await serviceResponse.text();

    expect(serviceResponse.status).toBe(200);
    expect(serviceResponse.headers.get('content-type')).toMatch(/^text\/plain/u);
    expect(serviceResponse.headers.get('x-response-time')).toMatch(
      /^\d+\.\d{2}ms$/u,
    );
    expect(serviceBody).toContain('Actualité 1: contenu de test');
    expect(serviceBody).toContain('Poids:');
  });

  it('respecte les cibles à froid et réutilise les pages transformées', async () => {
    /** **Validates: Requirements 7.1, 7.3, 7.4** */
    const coldResponse = await fetch(serviceUrl());
    await coldResponse.text();

    expect(coldResponse.status).toBe(200);
    expect(getPageCacheStats()).toMatchObject({
      entries: 1,
      hits: 0,
      misses: 1,
    });

    const coldTransformation = responseTimeMonitor.getSummary(
      'pageTransformation',
    );
    const coldResolution = responseTimeMonitor.getSummary('serviceResolution');

    expect(coldTransformation).toMatchObject({
      sampleCount: 1,
      targetMs: 500,
      meetsTarget: true,
    });
    expect(coldTransformation.p95Ms ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(
      coldTransformation.targetMs,
    );
    expect(coldResolution).toMatchObject({
      sampleCount: 2,
      targetMs: 100,
      meetsTarget: true,
    });
    expect(coldResolution.p95Ms ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(
      coldResolution.targetMs,
    );

    const cachedResponse = await fetch(serviceUrl());
    await cachedResponse.text();

    expect(cachedResponse.status).toBe(200);
    expect(getPageCacheStats()).toMatchObject({
      entries: 1,
      hits: 1,
      misses: 1,
    });
  });
});

describe('performance HTTP sous charge simulée', () => {
  it('maintient le 95e percentile sous deux secondes pour 50 clients', async () => {
    /** **Validates: Requirements 7.1, 7.2, 7.3, 7.4** */
    const primingResponse = await fetch(serviceUrl());
    await primingResponse.text();
    responseTimeMonitor.clear();

    const results = await Promise.all(
      Array.from({ length: CONCURRENT_REQUESTS }, async () => {
        const startedAt = performance.now();
        const response = await fetch(serviceUrl());
        const body = await response.text();

        return {
          body,
          durationMs: performance.now() - startedAt,
          status: response.status,
        };
      }),
    );

    expect(results.every(({ status }) => status === 200)).toBe(true);
    expect(
      results.every(({ body }) => body.includes('Actualité 1: contenu de test')),
    ).toBe(true);

    const clientDurations = results.map(({ durationMs }) => durationMs);
    const clientWithinTargetRate = clientDurations.filter(
      (durationMs) => durationMs < 2_000,
    ).length / CONCURRENT_REQUESTS;

    expect(clientWithinTargetRate).toBeGreaterThanOrEqual(0.95);
    expect(percentile95(clientDurations)).toBeLessThan(2_000);

    const httpSummary = responseTimeMonitor.getSummary('httpResponse');
    const transformationSummary = responseTimeMonitor.getSummary(
      'pageTransformation',
    );
    const resolutionSummary = responseTimeMonitor.getSummary(
      'serviceResolution',
    );

    expect(httpSummary).toMatchObject({
      sampleCount: CONCURRENT_REQUESTS,
      targetMs: 2_000,
      meetsTarget: true,
    });
    expect(httpSummary.withinTargetRate).toBeGreaterThanOrEqual(0.95);
    expect(transformationSummary).toMatchObject({
      sampleCount: CONCURRENT_REQUESTS,
      targetMs: 500,
      meetsTarget: true,
    });
    expect(resolutionSummary).toMatchObject({
      sampleCount: CONCURRENT_REQUESTS * 2,
      targetMs: 100,
      meetsTarget: true,
    });
    expect(getPageCacheStats()).toMatchObject({
      entries: 1,
      hits: CONCURRENT_REQUESTS,
      misses: 1,
    });
  });
});
