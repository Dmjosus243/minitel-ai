import type { NewsConfig, SummaryMode } from './types';

type ConfigurationEnvironment = Readonly<Record<string, string | undefined>>;

export const NEWS_CONFIG_DEFAULTS = Object.freeze({
  maxArticles: 5,
  rssTimeoutMs: 5_000,
  rssMaxBytes: 1_048_576,
  aiTimeoutMs: 5_000,
});

/** Bornes opérationnelles appliquées aux valeurs numériques de l'environnement. */
export const NEWS_CONFIG_LIMITS = Object.freeze({
  maxArticles: Object.freeze({ minimum: 1, maximum: 20 }),
  rssTimeoutMs: Object.freeze({ minimum: 1, maximum: 60_000 }),
  rssMaxBytes: Object.freeze({ minimum: 1, maximum: 10_485_760 }),
  aiTimeoutMs: Object.freeze({ minimum: 1, maximum: 60_000 }),
});

export type NewsConfigurationErrorCode =
  | 'missing-value'
  | 'invalid-url'
  | 'unsupported-summary-mode'
  | 'invalid-integer'
  | 'out-of-range'
  | 'empty-value';

/** Erreur sûre à journaliser : elle ne conserve jamais la valeur fautive. */
export class NewsConfigurationError extends Error {
  readonly code: NewsConfigurationErrorCode;
  readonly variableName: string;

  constructor(
    code: NewsConfigurationErrorCode,
    variableName: string,
    message: string,
  ) {
    super(message);
    this.name = 'NewsConfigurationError';
    this.code = code;
    this.variableName = variableName;
  }
}

const ENVIRONMENT_KEYS = Object.freeze({
  rssUrl: 'NEWS_RSS_URL',
  summaryMode: 'NEWS_SUMMARIZER_MODE',
  maxArticles: 'NEWS_MAX_ARTICLES',
  rssTimeoutMs: 'NEWS_RSS_TIMEOUT_MS',
  rssMaxBytes: 'NEWS_RSS_MAX_BYTES',
  aiEndpoint: 'NEWS_AI_ENDPOINT',
  aiModel: 'NEWS_AI_MODEL',
  aiApiKey: 'NEWS_AI_API_KEY',
  aiTimeoutMs: 'NEWS_AI_TIMEOUT_MS',
});

function missingValueError(variableName: string): NewsConfigurationError {
  return new NewsConfigurationError(
    'missing-value',
    variableName,
    `${variableName} is required.`,
  );
}

function parseRequiredHttpsUrl(
  value: string | undefined,
  variableName: string,
): URL {
  const normalizedValue = value?.trim();

  if (!normalizedValue) {
    throw missingValueError(variableName);
  }

  try {
    const url = new URL(normalizedValue);
    if (
      url.protocol !== 'https:'
      || url.hostname.length === 0
      || !/^https:\/\//iu.test(normalizedValue)
    ) {
      throw new Error('invalid HTTPS URL');
    }

    return url;
  } catch {
    throw new NewsConfigurationError(
      'invalid-url',
      variableName,
      `${variableName} must be an absolute HTTPS URL.`,
    );
  }
}

function parseBoundedInteger(
  value: string | undefined,
  variableName: string,
  defaultValue: number,
  bounds: Readonly<{ minimum: number; maximum: number }>,
): number {
  if (value === undefined) {
    return defaultValue;
  }

  const normalizedValue = value.trim();
  if (!/^\d+$/u.test(normalizedValue)) {
    throw new NewsConfigurationError(
      'invalid-integer',
      variableName,
      `${variableName} must be an integer.`,
    );
  }

  const parsedValue = Number(normalizedValue);
  if (!Number.isSafeInteger(parsedValue)) {
    throw new NewsConfigurationError(
      'invalid-integer',
      variableName,
      `${variableName} must be a safe integer.`,
    );
  }

  if (parsedValue < bounds.minimum || parsedValue > bounds.maximum) {
    throw new NewsConfigurationError(
      'out-of-range',
      variableName,
      `${variableName} must be between ${bounds.minimum} and ${bounds.maximum}.`,
    );
  }

  return parsedValue;
}

function parseOptionalNonEmptyValue(
  value: string | undefined,
  variableName: string,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalizedValue = value.trim();
  if (!normalizedValue) {
    throw new NewsConfigurationError(
      'empty-value',
      variableName,
      `${variableName} must be non-empty when provided.`,
    );
  }

  return normalizedValue;
}

function parseOptionalSecret(value: string | undefined): string | undefined {
  const normalizedValue = value?.trim();
  return normalizedValue || undefined;
}

export function normalizeSummaryMode(
  value: string | undefined,
): SummaryMode {
  const normalizedValue = value?.trim().toLowerCase();

  if (!normalizedValue) {
    return 'extractive' as const;
  }
  if (normalizedValue === 'extractive' || normalizedValue === 'ai') {
    return normalizedValue;
  }

  throw new NewsConfigurationError(
    'unsupported-summary-mode',
    ENVIRONMENT_KEYS.summaryMode,
    `${ENVIRONMENT_KEYS.summaryMode} must be extractive or ai.`,
  );
}

/** Charge et valide toute la configuration NEWS à la frontière du processus. */
export function loadNewsConfig(
  environment: ConfigurationEnvironment = process.env,
): NewsConfig {
  const summaryMode = normalizeSummaryMode(environment[ENVIRONMENT_KEYS.summaryMode]);
  const commonConfig = {
    rssUrl: parseRequiredHttpsUrl(
      environment[ENVIRONMENT_KEYS.rssUrl],
      ENVIRONMENT_KEYS.rssUrl,
    ),
    maxArticles: parseBoundedInteger(
      environment[ENVIRONMENT_KEYS.maxArticles],
      ENVIRONMENT_KEYS.maxArticles,
      NEWS_CONFIG_DEFAULTS.maxArticles,
      NEWS_CONFIG_LIMITS.maxArticles,
    ),
    rssTimeoutMs: parseBoundedInteger(
      environment[ENVIRONMENT_KEYS.rssTimeoutMs],
      ENVIRONMENT_KEYS.rssTimeoutMs,
      NEWS_CONFIG_DEFAULTS.rssTimeoutMs,
      NEWS_CONFIG_LIMITS.rssTimeoutMs,
    ),
    rssMaxBytes: parseBoundedInteger(
      environment[ENVIRONMENT_KEYS.rssMaxBytes],
      ENVIRONMENT_KEYS.rssMaxBytes,
      NEWS_CONFIG_DEFAULTS.rssMaxBytes,
      NEWS_CONFIG_LIMITS.rssMaxBytes,
    ),
  };

  if (summaryMode === 'extractive') {
    return {
      ...commonConfig,
      summaryMode,
    };
  }

  const model = parseOptionalNonEmptyValue(
    environment[ENVIRONMENT_KEYS.aiModel],
    ENVIRONMENT_KEYS.aiModel,
  );
  const apiKey = parseOptionalSecret(environment[ENVIRONMENT_KEYS.aiApiKey]);

  return {
    ...commonConfig,
    summaryMode,
    ai: {
      endpoint: parseRequiredHttpsUrl(
        environment[ENVIRONMENT_KEYS.aiEndpoint],
        ENVIRONMENT_KEYS.aiEndpoint,
      ),
      ...(model === undefined ? {} : { model }),
      ...(apiKey === undefined ? {} : { apiKey }),
      timeoutMs: parseBoundedInteger(
        environment[ENVIRONMENT_KEYS.aiTimeoutMs],
        ENVIRONMENT_KEYS.aiTimeoutMs,
        NEWS_CONFIG_DEFAULTS.aiTimeoutMs,
        NEWS_CONFIG_LIMITS.aiTimeoutMs,
      ),
    },
  };
}
