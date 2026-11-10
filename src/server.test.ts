import { beforeAll, describe, expect, it } from 'vitest';

import { registerService } from './core/router';
import type { Service } from './core/types';
import app from './server';

const TEST_SERVICE: Service = {
  code: '3615 TEST',
  title: 'Service test',
  description: 'Contenu de démonstration',
  async render() {
    return 'Bienvenue sur le service test';
  },
};

beforeAll(() => {
  registerService(TEST_SERVICE);
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
});
