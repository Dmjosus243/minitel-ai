import type { PageConfig } from './types';

export const DEFAULT_PAGE_CONFIG: Readonly<PageConfig> = Object.freeze({
  columns: 40,
  rows: 24,
  maxBytes: 2048,
  wordWrap: true,
});

export type PageConfigUpdate = Partial<PageConfig>;

type ConfigurationEnvironment = Readonly<Record<string, string | undefined>>;

type PageConfigField = keyof PageConfig;

const PAGE_CONFIG_FIELDS: readonly PageConfigField[] = [
  'columns',
  'rows',
  'maxBytes',
  'wordWrap',
];

const PAGE_CONFIG_ENVIRONMENT_KEYS: Readonly<
  Record<PageConfigField, string>
> = Object.freeze({
  columns: 'MINITEL_PAGE_COLUMNS',
  rows: 'MINITEL_PAGE_ROWS',
  maxBytes: 'MINITEL_PAGE_MAX_BYTES',
  wordWrap: 'MINITEL_PAGE_WORD_WRAP',
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parsePositiveInteger(value: unknown, field: string): number {
  if (
    typeof value !== 'number'
    || !Number.isSafeInteger(value)
    || value < 1
  ) {
    throw new RangeError(`Page ${field} must be a positive integer.`);
  }

  return value;
}

/** Valide une mise à jour provenant d'une frontière non typée, telle que l'API. */
export function parsePageConfigUpdate(value: unknown): PageConfigUpdate {
  if (!isRecord(value)) {
    throw new TypeError('Page configuration must be an object.');
  }

  const unknownField = Object.keys(value).find(
    (field) => !PAGE_CONFIG_FIELDS.includes(field as PageConfigField),
  );
  if (unknownField !== undefined) {
    throw new TypeError(`Unknown page configuration field: ${unknownField}.`);
  }

  const update: PageConfigUpdate = {};

  if (Object.hasOwn(value, 'columns')) {
    update.columns = parsePositiveInteger(value.columns, 'columns');
  }
  if (Object.hasOwn(value, 'rows')) {
    update.rows = parsePositiveInteger(value.rows, 'rows');
  }
  if (Object.hasOwn(value, 'maxBytes')) {
    update.maxBytes = parsePositiveInteger(value.maxBytes, 'maxBytes');
  }
  if (Object.hasOwn(value, 'wordWrap')) {
    if (typeof value.wordWrap !== 'boolean') {
      throw new TypeError('Page wordWrap must be a boolean.');
    }
    update.wordWrap = value.wordWrap;
  }

  return update;
}

/** Fusionne puis valide une configuration sans modifier la configuration de base. */
export function resolvePageConfig(
  update: PageConfigUpdate = {},
  base: Readonly<PageConfig> = DEFAULT_PAGE_CONFIG,
): PageConfig {
  return {
    ...base,
    ...parsePageConfigUpdate(update),
  };
}

function parseEnvironmentInteger(
  environment: ConfigurationEnvironment,
  field: 'columns' | 'rows' | 'maxBytes',
): number | undefined {
  const key = PAGE_CONFIG_ENVIRONMENT_KEYS[field];
  const rawValue = environment[key];

  if (rawValue === undefined) {
    return undefined;
  }

  const normalizedValue = rawValue.trim();
  if (!/^\d+$/u.test(normalizedValue)) {
    throw new RangeError(`${key} must be a positive integer.`);
  }

  return parsePositiveInteger(Number(normalizedValue), field);
}

function parseEnvironmentBoolean(
  environment: ConfigurationEnvironment,
): boolean | undefined {
  const key = PAGE_CONFIG_ENVIRONMENT_KEYS.wordWrap;
  const rawValue = environment[key];

  if (rawValue === undefined) {
    return undefined;
  }

  switch (rawValue.trim().toLowerCase()) {
    case 'true':
      return true;
    case 'false':
      return false;
    default:
      throw new TypeError(`${key} must be true or false.`);
  }
}

/** Charge la configuration initiale depuis les variables d'environnement Minitel. */
export function loadPageConfig(
  environment: ConfigurationEnvironment = process.env,
): PageConfig {
  const update: PageConfigUpdate = {};
  const columns = parseEnvironmentInteger(environment, 'columns');
  const rows = parseEnvironmentInteger(environment, 'rows');
  const maxBytes = parseEnvironmentInteger(environment, 'maxBytes');
  const wordWrap = parseEnvironmentBoolean(environment);

  if (columns !== undefined) {
    update.columns = columns;
  }
  if (rows !== undefined) {
    update.rows = rows;
  }
  if (maxBytes !== undefined) {
    update.maxBytes = maxBytes;
  }
  if (wordWrap !== undefined) {
    update.wordWrap = wordWrap;
  }

  return resolvePageConfig(update);
}

/** Stockage atomique de la configuration de page modifiable à l'exécution. */
export class RuntimePageConfiguration {
  private current: Readonly<PageConfig>;

  constructor(initial: PageConfigUpdate = {}) {
    this.current = Object.freeze(resolvePageConfig(initial));
  }

  get(): PageConfig {
    return { ...this.current };
  }

  update(value: unknown): PageConfig {
    const update = parsePageConfigUpdate(value);
    const next = resolvePageConfig(update, this.current);

    this.current = Object.freeze(next);
    return this.get();
  }
}

function loadInitialPageConfig(): PageConfig {
  try {
    return loadPageConfig();
  } catch (error) {
    console.error(
      'Invalid startup page configuration; using safe defaults.',
      error,
    );
    return { ...DEFAULT_PAGE_CONFIG };
  }
}

export const runtimePageConfiguration = new RuntimePageConfiguration(
  loadInitialPageConfig(),
);

export function getPageConfig(): PageConfig {
  return runtimePageConfiguration.get();
}

export function updatePageConfig(value: unknown): PageConfig {
  return runtimePageConfiguration.update(value);
}
