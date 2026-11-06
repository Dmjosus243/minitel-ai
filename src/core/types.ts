export interface Page {
  content: string[];
  pageNumber: number;
  totalPages: number;
  metadata: {
    byteSize: number;
    serviceCode?: string;
  };
}

export interface Service {
  code: string;
  title: string;
  description?: string;
  render(): Promise<string>;
}

export interface PageConfig {
  columns: number;
  rows: number;
  maxBytes: number;
  wordWrap: boolean;
}
