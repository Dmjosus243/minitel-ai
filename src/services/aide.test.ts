import { describe, expect, it } from 'vitest';

import { getService, route } from '../core/router';
import { app } from '../index';
import { aideService } from './aide';

describe('service 3615 AIDE', () => {
  it('explique le menu et la navigation par numéros ou codes', async () => {
    const content = await aideService.render();

    expect(aideService).toMatchObject({
      code: '3615 AIDE',
      title: 'Aide',
      description: "Mode d'emploi",
    });
    expect(content).toContain('MENU');
    expect(content).toContain('NUMEROS');
    expect(content).toContain('CODES');
    expect(content).toContain('?q=1');
    expect(content).toContain('3615 AIDE');
  });

  it('est enregistré auprès du routeur', async () => {
    expect(getService(' 3615 aide ')).toMatchObject({
      code: '3615 AIDE',
      title: 'Aide',
    });

    const pages = await route('3615 aide');

    expect(pages).toHaveLength(1);
    expect(pages[0]?.content).toContain("MODE D'EMPLOI");
    expect(pages[0]?.content).toContain('NUMEROS');
    expect(pages[0]?.content).toContain('CODES');
  });

  it("apparaît dans le menu d'accueil et répond au numéro 1", async () => {
    const homepageResponse = await app.request('/');
    const homepage = await homepageResponse.text();

    expect(homepageResponse.status).toBe(200);
    expect(homepage).toContain("1. Aide (3615 AIDE) - Mode d'emploi");

    const serviceResponse = await app.request('/?q=1');
    const servicePage = await serviceResponse.text();

    expect(serviceResponse.status).toBe(200);
    expect(servicePage).toContain("MODE D'EMPLOI");
  });
});
