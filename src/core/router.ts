import { formatText } from './formatter';
import type { Page, Service } from './types';

const SERVICE_CODE_PATTERN = /^\d{4} [A-Za-z]+$/u;
const SERVICE_CODE_FORMAT = '"NNNN WORD"';

/** Normalise un code tout en rejetant les caractères hors du format Minitel. */
export function normalizeCode(code: string): string {
  if (typeof code !== 'string') {
    throw new TypeError(`Invalid service code: expected a string in ${SERVICE_CODE_FORMAT} format.`);
  }

  const normalizedWhitespace = code.trim().replace(/\s+/gu, ' ');

  if (!SERVICE_CODE_PATTERN.test(normalizedWhitespace)) {
    throw new Error(`Invalid service code: expected ${SERVICE_CODE_FORMAT} using four digits and ASCII letters.`);
  }

  return normalizedWhitespace.toUpperCase();
}

/** Registre en mémoire, mis à jour immédiatement lors de chaque enregistrement. */
export class ServiceRegistry {
  private readonly services = new Map<string, Service>();

  register(service: Service): void {
    const normalizedCode = normalizeCode(service.code);

    if (this.services.has(normalizedCode)) {
      throw new Error(`Duplicate service code: ${normalizedCode}.`);
    }

    this.services.set(normalizedCode, {
      ...service,
      code: normalizedCode,
    });
  }

  get(code: string): Service | null {
    return this.services.get(normalizeCode(code)) ?? null;
  }

  getAll(): Service[] {
    return Array.from(this.services.values());
  }

  normalizeCode(code: string): string {
    return normalizeCode(code);
  }

  async route(input: string): Promise<Page[]> {
    const service = this.get(input);

    if (service === null) {
      return formatText('Service not found');
    }

    return formatText(await service.render());
  }
}

export const defaultRegistry = new ServiceRegistry();

export function registerService(service: Service): void {
  defaultRegistry.register(service);
}

export function getService(code: string): Service | null {
  return defaultRegistry.get(code);
}

export async function route(input: string): Promise<Page[]> {
  return defaultRegistry.route(input);
}
