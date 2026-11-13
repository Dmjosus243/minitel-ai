import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PAGE_CONFIG,
  formatText,
  registerPageTransformer,
} from './formatter';

describe("extensions du transformateur de pages", () => {
  it("applique une extension enregistrée avec la configuration active", () => {
    /** **Validates: Requirements 8.4** */
    const unregister = registerPageTransformer({
      name: 'replace-placeholder',
      transform(text, config) {
        return text.replace('{columns}', String(config.columns));
      },
    });

    try {
      const pages = formatText('Largeur: {columns}', {
        ...DEFAULT_PAGE_CONFIG,
        columns: 20,
      });

      expect(pages[0]?.content).toEqual(['Largeur: 20']);
    } finally {
      unregister();
    }
  });

  it("rejette deux extensions portant le même nom", () => {
    const unregister = registerPageTransformer({
      name: 'unique-transformer',
      transform: (text) => text,
    });

    try {
      expect(() => registerPageTransformer({
        name: 'unique-transformer',
        transform: (text) => text.toUpperCase(),
      })).toThrow(/Duplicate page transformer plugin/u);
    } finally {
      unregister();
    }
  });
});
