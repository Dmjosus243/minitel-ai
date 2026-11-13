import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PAGE_CONFIG,
  loadPageConfig,
  RuntimePageConfiguration,
} from './config';

describe('chargement de la configuration des pages', () => {
  it('utilise les dimensions et la limite de taille par défaut', () => {
    /** **Validates: Requirements 8.1** */
    expect(loadPageConfig({})).toEqual(DEFAULT_PAGE_CONFIG);
  });

  it("charge les dimensions, la limite et le mode de coupure depuis l'environnement", () => {
    /** **Validates: Requirements 8.1** */
    expect(loadPageConfig({
      MINITEL_PAGE_COLUMNS: '32',
      MINITEL_PAGE_ROWS: '18',
      MINITEL_PAGE_MAX_BYTES: '1024',
      MINITEL_PAGE_WORD_WRAP: 'false',
    })).toEqual({
      columns: 32,
      rows: 18,
      maxBytes: 1024,
      wordWrap: false,
    });
  });

  it('rejette une valeur de démarrage invalide', () => {
    expect(() => loadPageConfig({
      MINITEL_PAGE_COLUMNS: '40.5',
    })).toThrow(/MINITEL_PAGE_COLUMNS must be a positive integer/u);
  });
});

describe("mise à jour de la configuration à l'exécution", () => {
  it('fusionne une mise à jour partielle sans exposer son état interne', () => {
    /** **Validates: Requirements 8.1** */
    const configuration = new RuntimePageConfiguration();
    const updated = configuration.update({ columns: 20, rows: 12 });

    expect(updated).toEqual({
      ...DEFAULT_PAGE_CONFIG,
      columns: 20,
      rows: 12,
    });

    updated.columns = 1;
    expect(configuration.get().columns).toBe(20);
  });

  it('rejette atomiquement une mise à jour invalide', () => {
    const configuration = new RuntimePageConfiguration({ columns: 30 });
    const beforeUpdate = configuration.get();

    expect(() => configuration.update({ columns: 0, rows: 10 })).toThrow(
      /Page columns must be a positive integer/u,
    );
    expect(configuration.get()).toEqual(beforeUpdate);
  });

  it('rejette les champs inconnus à la frontière de configuration', () => {
    const configuration = new RuntimePageConfiguration();

    expect(() => configuration.update({ theme: 'crt' })).toThrow(
      /Unknown page configuration field: theme/u,
    );
  });
});
