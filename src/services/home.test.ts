import { describe, expect, it } from 'vitest';

import { ServiceRegistry } from '../core/router';
import type { Service } from '../core/types';
import { generateHomepage, HomepageGenerator } from './home';

function service(
  code: string,
  title: string,
  description?: string,
): Service {
  return {
    code,
    title,
    description,
    async render() {
      return title;
    },
  };
}

const SERVICES = [
  service('3615 NEWS', 'News', 'Latest'),
  service('3616 WEATHER', 'Weather', 'Rain'),
];

describe('homepage generator', () => {
  it.each([0, 1, 25])(
    'lists and consistently numbers all %i registered services',
    (serviceCount) => {
      /** **Validates: Requirements 4.1, 4.2** */
      const registry = new ServiceRegistry();
      const expectedLines = Array.from({ length: serviceCount }, (_, index) => {
        const itemNumber = index + 1;
        const code = `${3600 + itemNumber} SERVICE`;
        const title = `Service ${itemNumber}`;

        registry.register(service(code, title));
        return `${itemNumber}. ${title} (${code})`;
      });

      const pages = new HomepageGenerator(registry).generateHomepage();

      expect(pages).toHaveLength(Math.max(1, Math.ceil(serviceCount / 24)));
      expect(pages.flatMap(({ content }) => content)).toEqual(expectedLines);
    },
  );

  it('reads the registry on every generation so newly registered services appear', () => {
    /** **Validates: Requirements 4.3** */
    const registry = new ServiceRegistry();
    const generator = new HomepageGenerator(registry);

    expect(generator.generateHomepage()[0]?.content).toEqual([]);

    registry.register(service('3615 NEWS', 'News'));
    expect(generator.generateHomepage()[0]?.content).toEqual([
      '1. News (3615 NEWS)',
    ]);

    registry.register(service('3616 WEATHER', 'Weather'));
    expect(generator.generateHomepage()[0]?.content).toEqual([
      '1. News (3615 NEWS)',
      '2. Weather (3616 WEATHER)',
    ]);
  });

  it('includes available descriptions without changing entries that omit them', () => {
    /** **Validates: Requirements 4.2, 4.4** */
    const pages = generateHomepage([
      service('3615 NEWS', 'News', 'Latest updates'),
      service('3616 WEATHER', 'Weather'),
      service('3617 GAMES', 'Games', '   '),
    ]);

    expect(pages).toHaveLength(1);
    expect(pages[0]?.content).toEqual([
      '1. News (3615 NEWS) - Latest updates',
      '2. Weather (3616 WEATHER)',
      '3. Games (3617 GAMES)',
    ]);
  });
});

describe('homepage menu customization', () => {
  it('preserves the existing numbered inline format by default', () => {
    const pages = generateHomepage(SERVICES);

    expect(pages).toHaveLength(1);
    expect(pages[0]?.content).toEqual([
      '1. News (3615 NEWS) - Latest',
      '2. Weather (3616 WEATHER) - Rain',
    ]);
  });

  it('applies configurable layout sections, spacing, and textual style', () => {
    /** **Validates: Requirements 8.3** */
    const pages = generateHomepage(SERVICES, {
      layout: {
        header: '=== SERVICES ===',
        footer: 'Select a number',
        itemSeparator: '\n---\n',
        sectionSeparator: '\n\n',
      },
      style: {
        numberPrefix: '[',
        numberSuffix: ']',
        codePrefix: '<',
        codeSuffix: '>',
        descriptionPrefix: ' :: ',
      },
    });

    expect(pages).toHaveLength(1);
    expect(pages[0]?.content).toEqual([
      '=== SERVICES ===',
      '',
      '[1] News <3615 NEWS> :: Latest',
      '---',
      '[2] Weather <3616 WEATHER> :: Rain',
      '',
      'Select a number',
    ]);
  });

  it('supports compact and detailed menu formats without dropping descriptions', () => {
    /** **Validates: Requirements 8.3** */
    const compact = generateHomepage(SERVICES, {
      layout: { format: 'compact' },
    });
    const detailed = generateHomepage(SERVICES, {
      layout: { format: 'detailed' },
    });

    expect(compact[0]?.content).toEqual([
      '1. (3615 NEWS) News - Latest',
      '2. (3616 WEATHER) Weather - Rain',
    ]);
    expect(detailed[0]?.content).toEqual([
      '1. News (3615 NEWS)',
      '- Latest',
      '2. Weather (3616 WEATHER)',
      '- Rain',
    ]);
  });

  it('uses constructor configuration while reading the current registry', () => {
    const registry = new ServiceRegistry();
    const generator = new HomepageGenerator(registry, {
      layout: { format: 'compact', header: 'DIRECTORY' },
      style: { numberPrefix: '[', numberSuffix: ']' },
    });

    registry.register(service('3615 NEWS', 'News', 'Latest'));

    expect(generator.generateHomepage()[0]?.content).toEqual([
      'DIRECTORY',
      '[1] (3615 NEWS) News - Latest',
    ]);
  });
});
