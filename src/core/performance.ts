export const PERFORMANCE_TARGETS_MS = Object.freeze({
  pageTransformation: 500,
  httpResponse: 2_000,
  serviceResolution: 100,
});

export type PerformanceOperation = keyof typeof PERFORMANCE_TARGETS_MS;

export interface ResponseTimeSummary {
  operation: PerformanceOperation;
  sampleCount: number;
  latestMs: number | null;
  p95Ms: number | null;
  maximumMs: number | null;
  targetMs: number;
  withinTargetRate: number;
  meetsTarget: boolean;
}

const DEFAULT_SAMPLE_LIMIT = 500;

/** Conserve un échantillon borné des temps de réponse récents. */
export class ResponseTimeMonitor {
  private readonly samples = new Map<PerformanceOperation, number[]>();

  constructor(private readonly sampleLimit = DEFAULT_SAMPLE_LIMIT) {
    if (!Number.isSafeInteger(sampleLimit) || sampleLimit < 1) {
      throw new RangeError('Response time sample limit must be a positive integer.');
    }
  }

  record(operation: PerformanceOperation, durationMs: number): void {
    if (!Number.isFinite(durationMs) || durationMs < 0) {
      throw new RangeError('Response time duration must be a non-negative finite number.');
    }

    const operationSamples = this.samples.get(operation) ?? [];
    operationSamples.push(durationMs);

    if (operationSamples.length > this.sampleLimit) {
      operationSamples.splice(0, operationSamples.length - this.sampleLimit);
    }

    this.samples.set(operation, operationSamples);
  }

  getSummary(operation: PerformanceOperation): ResponseTimeSummary {
    const operationSamples = this.samples.get(operation) ?? [];
    const targetMs = PERFORMANCE_TARGETS_MS[operation];

    if (operationSamples.length === 0) {
      return {
        operation,
        sampleCount: 0,
        latestMs: null,
        p95Ms: null,
        maximumMs: null,
        targetMs,
        withinTargetRate: 0,
        meetsTarget: false,
      };
    }

    const sortedSamples = [...operationSamples].sort((left, right) => left - right);
    const p95Index = Math.ceil(sortedSamples.length * 0.95) - 1;
    const p95Ms = sortedSamples[p95Index] as number;
    const withinTargetCount = operationSamples.filter(
      (durationMs) => durationMs <= targetMs,
    ).length;

    return {
      operation,
      sampleCount: operationSamples.length,
      latestMs: operationSamples.at(-1) as number,
      p95Ms,
      maximumMs: sortedSamples.at(-1) as number,
      targetMs,
      withinTargetRate: withinTargetCount / operationSamples.length,
      meetsTarget: p95Ms <= targetMs,
    };
  }

  clear(operation?: PerformanceOperation): void {
    if (operation === undefined) {
      this.samples.clear();
      return;
    }

    this.samples.delete(operation);
  }
}

export const responseTimeMonitor = new ResponseTimeMonitor();
