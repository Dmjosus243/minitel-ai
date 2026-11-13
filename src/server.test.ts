import { afterEach, beforeAll, describe, expect, it } from 'vitest';

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
  it('retourne la configuration de page active', async () => {
    /** **Validates: Requirements 8.1** */
    const response = await app.request('/api/config');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(INITIAL_PAGE_CONFIG);
  });

  it('applique immédiatement une mise à jour partielle valide', async () => {
    /** **Validates: Requirements 8.1** */
    const updateResponse = await app.request('/api/config', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ columns: 10, rows: 12 }),
    });

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
    const response = await app.request('/api/config', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ columns: 0, rows: 12 }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Page columns must be a positive integer.',
    });
    expect(getPageConfig()).toEqual(INITIAL_PAGE_CONFIG);
  });
});