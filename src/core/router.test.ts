import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  getService,
  normalizeCode,
  registerService,
  route,
  ServiceRegistry,
} from './router';
import type { Service } from './types';

const ASCII_LETTERS = Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ');

const descriptorArbitrary = fc
  .array(fc.constantFrom(...ASCII_LETTERS), { minLength: 1, maxLength: 20 })
  .map((letters) => letters.join(''));

const optionalWhitespaceArbitrary = fc
  .array(fc.constantFrom(' ', '\t'), { maxLength: 3 })
  .map((characters) => characters.join(''));

const requiredWhitespaceArbitrary = fc
  .array(fc.constantFrom(' ', '\t'), { minLength: 1, maxLength: 3 })
  .map((characters) => characters.join(''));

const validServiceCodeArbitrary = fc
  .record({
    number: fc.integer({ min: 0, max: 9999 }),
    descriptor: descriptorArbitrary,
    lowercase: fc.boolean(),
    leadingWhitespace: optionalWhitespaceArbitrary,
    separator: requiredWhitespaceArbitrary,
    trailingWhitespace: optionalWhitespaceArbitrary,
  })
  .map(({ number, descriptor, lowercase, leadingWhitespace, separator, trailingWhitespace }) => {
    const casedDescriptor = lowercase ? descriptor.toLowerCase() : descriptor;
    return `${leadingWhitespace}${number.toString().padStart(4, '0')}${separator}${casedDescriptor}${trailingWhitespace}`;
  });

function service(code: string, content = 'Contenu du service'): Service {
  return {
    code,
    title: `Service ${code}`,
    async render() {
      return content;
    },
  };
}

describe('service code normalization', () => {
  it('normalizes casing and surrounding or repeated whitespace', () => {
    expect(normalizeCode(' \t3615   news\n')).toBe('3615 NEWS');
  });

  it.each([
    '',
    '361 NEWS',
    '36155 NEWS',
    '3615',
    '3615 TWO WORDS',
    '3615 NEWS!',
    '3615 NEW-S',
    '3615 NEWS2',
    '3615 MÉTÉO',
  ])('rejects an invalid code: %j', (code) => {
    expect(() => normalizeCode(code)).toThrow(/Invalid service code.*"NNNN WORD"/u);
  });

  it('rejects non-string values at runtime with a descriptive error', () => {
    expect(() => normalizeCode(null as unknown as string)).toThrow(TypeError);
    expect(() => normalizeCode(null as unknown as string)).toThrow(/Invalid service code/u);
  });

  it('Feature: minitel-core, Property 5: Code Normalization Consistency', () => {
    /** **Validates: Requirements 5.1, 5.3** */
    fc.assert(
      fc.property(validServiceCodeArbitrary, (code) => {
        const normalized = normalizeCode(code);

        expect(normalized).toMatch(/^\d{4} [A-Z]+$/u);
        expect(normalizeCode(normalized)).toBe(normalized);
      }),
      { numRuns: 100 },
    );
  });
});

describe('ServiceRegistry', () => {
  it('makes a newly registered service available immediately', async () => {
    const registry = new ServiceRegistry();

    expect(registry.get('3615 NEWS')).toBeNull();
    registry.register(service('3615 news', 'Dernières nouvelles'));

    const registered = registry.get(' 3615  NEWS ');
    expect(registered?.code).toBe('3615 NEWS');
    expect(await registered?.render()).toBe('Dernières nouvelles');
  });

  it('lists dynamically registered services with normalized codes', () => {
    const registry = new ServiceRegistry();
    registry.register(service('3615 news'));
    registry.register(service('3616 WEATHER'));

    expect(registry.getAll().map(({ code }) => code)).toEqual([
      '3615 NEWS',
      '3616 WEATHER',
    ]);
  });

  it('rejects duplicate codes after normalization', () => {
    const registry = new ServiceRegistry();
    registry.register(service('3615 NEWS'));

    expect(() => registry.register(service(' 3615   news '))).toThrow(
      'Duplicate service code: 3615 NEWS.',
    );
  });

  it('rejects invalid codes during registration and lookup', () => {
    const registry = new ServiceRegistry();

    expect(() => registry.register(service('3615 BAD!'))).toThrow(/Invalid service code/u);
    expect(() => registry.get('3615 BAD!')).toThrow(/Invalid service code/u);
  });

  it('routes a known service and formats its rendered text', async () => {
    const registry = new ServiceRegistry();
    registry.register(service('3615 NEWS', 'Une information disponible'));

    const pages = await registry.route('3615 news');

    expect(pages).toHaveLength(1);
    expect(pages[0]?.content).toEqual(['Une information disponible']);
  });

  it('returns a Service not found page for an unknown valid code', async () => {
    const registry = new ServiceRegistry();

    const pages = await registry.route('9999 UNKNOWN');

    expect(pages).toHaveLength(1);
    expect(pages[0]?.content).toEqual(['Service not found']);
  });

  it('propagates rendering errors without hiding their cause', async () => {
    const registry = new ServiceRegistry();
    const failingService: Service = {
      code: '3615 FAILURE',
      title: 'Failure',
      async render() {
        throw new Error('render failed');
      },
    };
    registry.register(failingService);

    await expect(registry.route('3615 FAILURE')).rejects.toThrow('render failed');
  });
});

describe('default service router functions', () => {
  it('share one live registry for registration, lookup, and routing', async () => {
    registerService(service('4827 DYNAMIC', 'Ajouté à chaud'));

    expect(getService('4827 dynamic')?.code).toBe('4827 DYNAMIC');
    await expect(route('4827 DYNAMIC')).resolves.toMatchObject([
      { content: ['Ajouté à chaud'] },
    ]);
  });
});
