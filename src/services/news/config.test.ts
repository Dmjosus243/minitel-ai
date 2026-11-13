import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  loadNewsConfig,
  NEWS_CONFIG_DEFAULTS,
  NEWS_CONFIG_LIMITS,
  NewsConfigurationError,
  normalizeSummaryMode,
} from './config';
import type { NewsConfig } from './types';

const RSS_URL = 'https://actualites.example/rss.xml';
const AI_ENDPOINT = 'https://resume.example/v1/summaries';

const BASE_ENVIRONMENT = Object.freeze({
  NEWS_RSS_URL: RSS_URL,
});

function readConfigurationError(action: () => unknown): NewsConfigurationError {
  try {
    action();
  } catch (error) {
    if (error instanceof NewsConfigurationError) {
      return error;
    }

    throw error;
  }

  throw new Error('Une erreur de configuration était attendue.');
}

interface NumericSetting {
  variableName: string;
  minimum: number;
  maximum: number;
  additionalEnvironment?: Readonly<Record<string, string>>;
  readValue(config: NewsConfig): number;
}

const NUMERIC_SETTINGS: readonly NumericSetting[] = [
  {
    variableName: 'NEWS_MAX_ARTICLES',
    ...NEWS_CONFIG_LIMITS.maxArticles,
    readValue: (config) => config.maxArticles,
  },
  {
    variableName: 'NEWS_RSS_TIMEOUT_MS',
    ...NEWS_CONFIG_LIMITS.rssTimeoutMs,
    readValue: (config) => config.rssTimeoutMs,
  },
  {
    variableName: 'NEWS_RSS_MAX_BYTES',
    ...NEWS_CONFIG_LIMITS.rssMaxBytes,
    readValue: (config) => config.rssMaxBytes,
  },
  {
    variableName: 'NEWS_AI_TIMEOUT_MS',
    ...NEWS_CONFIG_LIMITS.aiTimeoutMs,
    additionalEnvironment: {
      NEWS_SUMMARIZER_MODE: 'ai',
      NEWS_AI_ENDPOINT: AI_ENDPOINT,
    },
    readValue: (config) => {
      if (config.ai === undefined) {
        throw new Error('La configuration IA était attendue.');
      }

      return config.ai.timeoutMs;
    },
  },
];

function numericEnvironment(
  setting: NumericSetting,
  value: number | string,
): Record<string, string> {
  return {
    ...BASE_ENVIRONMENT,
    ...setting.additionalEnvironment,
    [setting.variableName]: String(value),
  };
}

const environmentWhitespaceArbitrary = fc
  .array(fc.constantFrom(' ', '\t', '\n', '\r'), { maxLength: 8 })
  .map((characters) => characters.join(''));

function mixedCaseArbitrary(value: SummaryModeLiteral): fc.Arbitrary<string> {
  return fc
    .array(fc.boolean(), { minLength: value.length, maxLength: value.length })
    .map((uppercaseCharacters) => Array.from(value, (character, index) => (
      uppercaseCharacters[index] ? character.toUpperCase() : character
    )).join(''));
}

type SummaryModeLiteral = 'extractive' | 'ai';

const supportedModeArbitrary = fc.oneof(
  mixedCaseArbitrary('extractive'),
  mixedCaseArbitrary('ai'),
);

const summaryModeEnvironmentValueArbitrary: fc.Arbitrary<string | undefined> = fc.oneof(
  fc.constant(undefined),
  fc.string(),
  environmentWhitespaceArbitrary,
  fc.tuple(
    environmentWhitespaceArbitrary,
    supportedModeArbitrary,
    environmentWhitespaceArbitrary,
  ).map(([prefix, mode, suffix]) => `${prefix}${mode}${suffix}`),
);

describe('configuration du service NEWS', () => {
  it('applique les valeurs par défaut en mode extractif', () => {
    /** **Validates: Requirements 2.1, 3.2, 8.1, 8.2** */
    expect(loadNewsConfig(BASE_ENVIRONMENT)).toEqual({
      rssUrl: new URL(RSS_URL),
      summaryMode: 'extractive',
      maxArticles: NEWS_CONFIG_DEFAULTS.maxArticles,
      rssTimeoutMs: NEWS_CONFIG_DEFAULTS.rssTimeoutMs,
      rssMaxBytes: NEWS_CONFIG_DEFAULTS.rssMaxBytes,
    });
  });

  it.each([
    [undefined, 'extractive'],
    ['', 'extractive'],
    [' \t\n ', 'extractive'],
    [' ExTrAcTiVe ', 'extractive'],
    ['\nAI\t', 'ai'],
  ] as const)(
    'normalise le mode %j en %s',
    (environmentValue, expectedMode) => {
      /** **Validates: Requirements 3.1, 3.2, 3.3** */
      expect(normalizeSummaryMode(environmentValue)).toBe(expectedMode);
    },
  );

  it('charge le mode extractif sans exiger ni exposer une configuration IA', () => {
    /** **Validates: Requirements 3.3, 8.4** */
    const config = loadNewsConfig({
      ...BASE_ENVIRONMENT,
      NEWS_SUMMARIZER_MODE: ' extractive ',
    });

    expect(config.summaryMode).toBe('extractive');
    expect(config.ai).toBeUndefined();
  });

  it('charge le mode IA et normalise ses réglages optionnels', () => {
    /** **Validates: Requirements 3.3, 8.4** */
    const config = loadNewsConfig({
      ...BASE_ENVIRONMENT,
      NEWS_SUMMARIZER_MODE: ' AI ',
      NEWS_AI_ENDPOINT: ` ${AI_ENDPOINT} `,
      NEWS_AI_MODEL: ' modele-fr ',
      NEWS_AI_API_KEY: ' cle-test ',
    });

    expect(config).toEqual({
      rssUrl: new URL(RSS_URL),
      summaryMode: 'ai',
      maxArticles: NEWS_CONFIG_DEFAULTS.maxArticles,
      rssTimeoutMs: NEWS_CONFIG_DEFAULTS.rssTimeoutMs,
      rssMaxBytes: NEWS_CONFIG_DEFAULTS.rssMaxBytes,
      ai: {
        endpoint: new URL(AI_ENDPOINT),
        model: 'modele-fr',
        apiKey: 'cle-test',
        timeoutMs: NEWS_CONFIG_DEFAULTS.aiTimeoutMs,
      },
    });
  });

  it('rejette un mode non pris en charge avec une erreur typée', () => {
    /** **Validates: Requirements 3.4** */
    const error = readConfigurationError(() => normalizeSummaryMode('local'));

    expect(error).toMatchObject({
      name: 'NewsConfigurationError',
      code: 'unsupported-summary-mode',
      variableName: 'NEWS_SUMMARIZER_MODE',
    });
  });

  it.each([
    ['absente', undefined, 'missing-value'],
    ['vide', '  ', 'missing-value'],
    ['HTTP', 'http://actualites.example/rss.xml', 'invalid-url'],
    ['relative', '/rss.xml', 'invalid-url'],
    ['mal formée', 'pas une URL', 'invalid-url'],
    ['sans double barre', 'https:actualites.example/rss.xml', 'invalid-url'],
  ] as const)(
    'rejette une URL RSS %s',
    (_description, rssUrl, expectedCode) => {
      /** **Validates: Requirements 2.1, 2.2** */
      const error = readConfigurationError(() => loadNewsConfig({
        NEWS_RSS_URL: rssUrl,
      }));

      expect(error).toMatchObject({
        code: expectedCode,
        variableName: 'NEWS_RSS_URL',
      });
    },
  );

  it('accepte une URL RSS HTTPS absolue après suppression des espaces', () => {
    /** **Validates: Requirements 2.2** */
    const config = loadNewsConfig({
      NEWS_RSS_URL: ' HTTPS://actualites.example/rss.xml ',
    });

    expect(config.rssUrl.href).toBe(RSS_URL);
  });

  it('exige le point de terminaison HTTPS en mode IA', () => {
    /** **Validates: Requirements 8.4** */
    const missingEndpointError = readConfigurationError(() => loadNewsConfig({
      ...BASE_ENVIRONMENT,
      NEWS_SUMMARIZER_MODE: 'ai',
    }));
    const insecureEndpointError = readConfigurationError(() => loadNewsConfig({
      ...BASE_ENVIRONMENT,
      NEWS_SUMMARIZER_MODE: 'ai',
      NEWS_AI_ENDPOINT: 'http://resume.example/v1/summaries',
    }));

    expect(missingEndpointError).toMatchObject({
      code: 'missing-value',
      variableName: 'NEWS_AI_ENDPOINT',
    });
    expect(insecureEndpointError).toMatchObject({
      code: 'invalid-url',
      variableName: 'NEWS_AI_ENDPOINT',
    });
  });

  it('rejette un nom de modèle vide lorsqu’il est fourni en mode IA', () => {
    /** **Validates: Requirements 8.4** */
    const error = readConfigurationError(() => loadNewsConfig({
      ...BASE_ENVIRONMENT,
      NEWS_SUMMARIZER_MODE: 'ai',
      NEWS_AI_ENDPOINT: AI_ENDPOINT,
      NEWS_AI_MODEL: ' \t ',
    }));

    expect(error).toMatchObject({
      code: 'empty-value',
      variableName: 'NEWS_AI_MODEL',
    });
  });

  describe.each(NUMERIC_SETTINGS)('$variableName', (setting) => {
    it('accepte ses bornes inférieure et supérieure', () => {
      /** **Validates: Requirements 8.2, 8.3, 8.4** */
      const lowerConfig = loadNewsConfig(numericEnvironment(
        setting,
        setting.minimum,
      ));
      const upperConfig = loadNewsConfig(numericEnvironment(
        setting,
        setting.maximum,
      ));

      expect(setting.readValue(lowerConfig)).toBe(setting.minimum);
      expect(setting.readValue(upperConfig)).toBe(setting.maximum);
    });

    it('rejette les valeurs immédiatement hors limites', () => {
      /** **Validates: Requirements 8.3, 8.4** */
      for (const value of [setting.minimum - 1, setting.maximum + 1]) {
        const error = readConfigurationError(() => loadNewsConfig(
          numericEnvironment(setting, value),
        ));

        expect(error).toMatchObject({
          code: 'out-of-range',
          variableName: setting.variableName,
        });
      }
    });

    it('rejette une valeur qui n’est pas un entier décimal', () => {
      /** **Validates: Requirements 8.3, 8.4** */
      const error = readConfigurationError(() => loadNewsConfig(
        numericEnvironment(setting, '1.5'),
      ));

      expect(error).toMatchObject({
        code: 'invalid-integer',
        variableName: setting.variableName,
      });
    });
  });

  it('rejette un entier numérique qui dépasse la précision sûre', () => {
    /** **Validates: Requirements 8.3** */
    const error = readConfigurationError(() => loadNewsConfig({
      ...BASE_ENVIRONMENT,
      NEWS_RSS_TIMEOUT_MS: '999999999999999999999999',
    }));

    expect(error).toMatchObject({
      code: 'invalid-integer',
      variableName: 'NEWS_RSS_TIMEOUT_MS',
    });
  });

  it('ne place aucune valeur secrète ou URL fautive dans une erreur', () => {
    /** **Validates: Requirements 8.7** */
    const secret = 'cle-ultra-secrete-123';
    const unsafeUrl = `http://actualites.example/rss.xml?jeton=${secret}`;
    const error = readConfigurationError(() => loadNewsConfig({
      NEWS_RSS_URL: unsafeUrl,
      NEWS_SUMMARIZER_MODE: 'ai',
      NEWS_AI_API_KEY: secret,
    }));
    const diagnostic = [error.message, error.stack, JSON.stringify(error)].join('\n');

    expect(diagnostic).not.toContain(secret);
    expect(diagnostic).not.toContain(unsafeUrl);
    expect(error.variableName).toBe('NEWS_RSS_URL');
  });
});

describe('propriété de sélection du mode de résumé', () => {
  it('Feature: news-service, Property 1: Summary Mode Selection', () => {
    /** **Validates: Requirements 3.1, 3.2, 3.3, 3.4** */
    fc.assert(
      fc.property(summaryModeEnvironmentValueArbitrary, (environmentValue) => {
        const normalizedValue = environmentValue?.trim().toLowerCase();

        if (!normalizedValue) {
          expect(normalizeSummaryMode(environmentValue)).toBe('extractive');
          return;
        }

        if (normalizedValue === 'extractive' || normalizedValue === 'ai') {
          expect(normalizeSummaryMode(environmentValue)).toBe(normalizedValue);
          return;
        }

        const error = readConfigurationError(
          () => normalizeSummaryMode(environmentValue),
        );
        expect(error).toMatchObject({
          code: 'unsupported-summary-mode',
          variableName: 'NEWS_SUMMARIZER_MODE',
        });
      }),
      { numRuns: 100 },
    );
  });
});
