import { describe, expectTypeOf, it } from 'vitest';

import type { Page, PageConfig, Service } from './types';

type ExpectedPage = {
  content: string[];
  pageNumber: number;
  totalPages: number;
  metadata: {
    byteSize: number;
    serviceCode?: string;
  };
};

type ExpectedService = {
  code: string;
  title: string;
  description?: string;
  render: () => Promise<string>;
};

type ExpectedPageConfig = {
  columns: number;
  rows: number;
  maxBytes: number;
  wordWrap: boolean;
};

describe('core type contracts', () => {
  it('defines the complete page shape', () => {
    expectTypeOf<Page>().toEqualTypeOf<ExpectedPage>();
  });

  it('defines services with asynchronous rendering', () => {
    expectTypeOf<Service>().toEqualTypeOf<ExpectedService>();
  });

  it('defines all page configuration fields', () => {
    expectTypeOf<PageConfig>().toEqualTypeOf<ExpectedPageConfig>();
  });
});
