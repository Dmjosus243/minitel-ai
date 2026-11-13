import { beforeEach, describe, expect, it } from 'vitest';

import {
  clearPageCache,
  formatText,
  getPageCacheStats,
  PAGE_CACHE_CAPACITY,
} from './formatter';
import {
  ResponseTimeMonitor,
  responseTimeMonitor,
} from './performance';
import { ServiceRegistry } from './router';

describe('response time monitoring', () => {
  beforeEach(() => {
    responseTimeMonitor.clear();
  });

  it('calculates the rolling 95th percentile against each operation target', () => {
    /** **Validates: Requirements 7.1, 7.2, 7.3** */
    const monitor = new ResponseTimeMonitor(20);

    for (let sample = 0; sample < 19; sample += 1) {
      monitor.record('httpResponse', 1_500);
    }
    monitor.record('httpResponse', 2_500);

    expect(monitor.getSummary('httpResponse')).toEqual({
      operation: 'httpResponse',
      sampleCount: 20,
      latestMs: 2_500,
      p95Ms: 1_500,
      maximumMs: 2_500,
      targetMs: 2_000,
      withinTargetRate: 0.95,
      meetsTarget: true,
    });

    monitor.record('httpResponse', 2_500);
    expect(monitor.getSummary('httpResponse')).toMatchObject({
      sampleCount: 20,
      p95Ms: 2_500,
      withinTargetRate: 0.9,
      meetsTarget: false,
    });
  });

  it('rejects invalid sample limits and durations', () => {
    expect(() => new ResponseTimeMonitor(0)).toThrow(RangeError);

    const monitor = new ResponseTimeMonitor();
    expect(() => monitor.record('pageTransformation', Number.NaN)).toThrow(
      RangeError,
    );
    expect(() => monitor.record('serviceResolution', -1)).toThrow(RangeError);
  });

  it('records page transformations and service-code resolution separately', () => {
    /** **Validates: Requirements 7.1, 7.3** */
    const registry = new ServiceRegistry();
    registry.register({
      code: '3615 SPEED',
      title: 'Rapidité',
      async render() {
        return 'Réponse rapide';
      },
    });

    formatText('Contenu typique');
    expect(registry.get('3615 SPEED')?.title).toBe('Rapidité');

    const transformation = responseTimeMonitor.getSummary('pageTransformation');
    const resolution = responseTimeMonitor.getSummary('serviceResolution');

    expect(transformation).toMatchObject({ sampleCount: 1, targetMs: 500 });
    expect(transformation.latestMs).toBeGreaterThanOrEqual(0);
    expect(resolution).toMatchObject({ sampleCount: 1, targetMs: 100 });
    expect(resolution.latestMs).toBeGreaterThanOrEqual(0);
  });
});

describe('transformed page cache', () => {
  beforeEach(() => {
    clearPageCache();
    responseTimeMonitor.clear('pageTransformation');
  });

  it('reuses pages for identical text and configuration without sharing mutations', () => {
    /** **Validates: Requirements 7.1, 7.4** */
    const firstResult = formatText('Contenu mis en cache');

    expect(getPageCacheStats()).toEqual({
      entries: 1,
      capacity: PAGE_CACHE_CAPACITY,
      hits: 0,
      misses: 1,
    });

    firstResult[0]?.content.splice(0, 1, 'Contenu modifié');
    const cachedResult = formatText('Contenu mis en cache');

    expect(cachedResult[0]?.content).toEqual(['Contenu mis en cache']);
    expect(cachedResult).not.toBe(firstResult);
    expect(getPageCacheStats()).toMatchObject({
      entries: 1,
      hits: 1,
      misses: 1,
    });

    const differentlyConfigured = formatText('Contenu mis en cache', {
      columns: 10,
      rows: 24,
      maxBytes: 2048,
      wordWrap: true,
    });
    expect(differentlyConfigured[0]?.content).toEqual([
      'Contenu',
      'mis en',
      'cache',
    ]);
    expect(getPageCacheStats()).toMatchObject({
      entries: 2,
      hits: 1,
      misses: 2,
    });
  });

  it('evicts least-recently-used entries when the cache reaches capacity', () => {
    /** **Validates: Requirements 7.4** */
    for (let index = 0; index <= PAGE_CACHE_CAPACITY; index += 1) {
      formatText(`Entrée de cache ${index}`);
    }

    expect(getPageCacheStats()).toMatchObject({
      entries: PAGE_CACHE_CAPACITY,
      hits: 0,
      misses: PAGE_CACHE_CAPACITY + 1,
    });

    formatText('Entrée de cache 0');
    expect(getPageCacheStats()).toMatchObject({
      entries: PAGE_CACHE_CAPACITY,
      hits: 0,
      misses: PAGE_CACHE_CAPACITY + 2,
    });
  });
});
