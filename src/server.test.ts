import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  getPageConfig,
  updatePageConfig,
} from './core/config';
import { registerService } from './core/router';
import type { Service } from './core/types';
import app, { responseTimeMonitor } from './server';

const INITIAL_PAGE_CONFIG = getPageConfig();

const TEST_SERVICE: Service = {
  code: '3615 TEST',
  title: 'Service test',
  description: 'Contenu de démonstration',
  async render() {
    return 'Bienvenue sur le service test';
  },
};

const FAILING_SERVICE: Service = {
  code: '3615 FAILURE',
  title: 'Service indisponible',
  async render() {
    throw new Error('service endpoint unreachable');
  },
};

beforeAll(() => {
  registerService(TEST_SERVICE);
  registerService(FAILING_SERVICE);
});

afterEach(() => {
  updatePageConfig(INITIAL_PAGE_CONFIG);
});

describe('serveur Hono', () => {
  it("affiche le titre et le menu numéroté sur l'accueil", async () => {
    const response = await app.request('/');
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/^text\/plain/u);
    expect(body).toContain('MINITEL IA');
    expect(body).toContain('1. Service test (3615 TEST)');
    expect(body).toContain('Poids:');
  });

  it("affiche une erreur française et un retour à l'accueil pour un code inconnu", async () => {
    const response = await app.request('/?q=abc');
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('Code inconnu');
    expect(body).toContain("Retour à l'accueil");
    expect(body).not.toContain('Internal Server Error');
    expect(body).not.toContain('Service not found');
  });

  it('affiche une erreur suivie du menu pour un numéro invalide', async () => {
    const response = await app.request('/?q=99');
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('Numéro invalide');
    expect(body).toContain('MINITEL IA');
    expect(body).toContain('1. Service test (3615 TEST)');
    expect(body.indexOf('Numéro invalide')).toBeLessThan(
      body.indexOf('1. Service test (3615 TEST)'),
    );
  });

  it('publie et enregistre le temps de réponse de chaque requête', async () => {
    /** **Validates: Requirements 7.2** */
    responseTimeMonitor.clear('httpResponse');

    const response = await app.request('/');
    const responseTime = response.headers.get('x-response-time');

    expect(responseTime).toMatch(/^\d+\.\d{2}ms$/u);
    expect(response.headers.get('server-timing')).toMatch(
      /^total;dur=\d+\.\d{2}$/u,
    );
    expect(responseTimeMonitor.getSummary('httpResponse')).toMatchObject({
      sampleCount: 1,
      targetMs: 2_000,
    });
  });
});

describe('résilience du serveur', () => {
  it("reste disponible lorsqu'un service échoue", async () => {
    /** **Validates: Requirements 6.2, 6.3** */
    const failedResponse = await app.request('/?q=3615%20FAILURE');
    const failedBody = await failedResponse.text();

    expect(failedResponse.status).toBe(200);
    expect(failedBody).toContain('Service temporarily unavailable');
    expect(failedBody).not.toContain('Internal Server Error');

    const homepageResponse = await app.request('/');
    expect(homepageResponse.status).toBe(200);
    await expect(homepageResponse.text()).resolves.toContain('MINITEL IA');
  });
});

describe('API de configuration', () => {
  const TEST_ADMIN_TOKEN = 'jeton-admin-test';

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function patchPageConfig(
    body: string,
    authorization?: string,
  ): Promise<Response> {
    return await app.request('/api/config', {
      method: 'PATCH',
      headers: {
        ...(authorization === undefined ? {} : { authorization }),
        'content-type': 'application/json',
      },
      body,
    });
  }

  it('retourne la configuration de page active', async () => {
    /** **Validates: Requirements 8.1** */
    const response = await app.request('/api/config');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(INITIAL_PAGE_CONFIG);
  });

  it('applique immédiatement une mise à jour partielle valide avec le jeton administrateur', async () => {
    /** **Validates: Requirements 8.1** */
    vi.stubEnv('ADMIN_TOKEN', TEST_ADMIN_TOKEN);

    const updateResponse = await patchPageConfig(
      JSON.stringify({ columns: 10, rows: 12 }),
      `Bearer ${TEST_ADMIN_TOKEN}`,
    );

    expect(updateResponse.status).toBe(200);
    await expect(updateResponse.json()).resolves.toEqual({
      ...INITIAL_PAGE_CONFIG,
      columns: 10,
      rows: 12,
    });

    const serviceResponse = await app.request('/?q=3615%20TEST');
    const serviceBody = await serviceResponse.text();

    expect(serviceResponse.status).toBe(200);
    expect(serviceBody).toContain('Bienvenue\nsur le\nservice\ntest');
  });

  it('rejette une mise à jour invalide sans modifier la configuration', async () => {
    vi.stubEnv('ADMIN_TOKEN', TEST_ADMIN_TOKEN);

    const response = await patchPageConfig(
      JSON.stringify({ columns: 0, rows: 12 }),
      `Bearer ${TEST_ADMIN_TOKEN}`,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Page columns must be a positive integer.',
    });
    expect(getPageConfig()).toEqual(INITIAL_PAGE_CONFIG);
  });

  it('répond 403 lorsque ADMIN_TOKEN n\'est pas défini', async () => {
    delete process.env.ADMIN_TOKEN;

    const response = await patchPageConfig(
      JSON.stringify({ columns: 10, rows: 12 }),
      `Bearer ${TEST_ADMIN_TOKEN}`,
    );

    expect(response.status).toBe(403);
    expect(getPageConfig()).toEqual(INITIAL_PAGE_CONFIG);
  });

  it('répond 403 pour un jeton administrateur absent ou invalide', async () => {
    vi.stubEnv('ADMIN_TOKEN', TEST_ADMIN_TOKEN);

    const missingResponse = await patchPageConfig('{}');
    const invalidResponse = await patchPageConfig('{}', 'Bearer mauvais-jeton');

    expect(missingResponse.status).toBe(403);
    expect(invalidResponse.status).toBe(403);
    expect(getPageConfig()).toEqual(INITIAL_PAGE_CONFIG);
  });

  it('répond 413 lorsque le corps de la mise à jour dépasse 4 Kio', async () => {
    vi.stubEnv('ADMIN_TOKEN', TEST_ADMIN_TOKEN);

    const oversizedBody = JSON.stringify({ padding: 'x'.repeat(4 * 1024) });
    const response = await patchPageConfig(
      oversizedBody,
      `Bearer ${TEST_ADMIN_TOKEN}`,
    );

    expect(response.status).toBe(413);
    expect(getPageConfig()).toEqual(INITIAL_PAGE_CONFIG);
  });
});