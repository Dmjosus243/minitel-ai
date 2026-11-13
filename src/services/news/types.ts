export type SummaryMode = 'extractive' | 'ai';

export interface NewsItem {
  title: string;
  sourceText: string;
  source?: string;
  publishedAt?: Date;
}

export interface SummaryBudget {
  maxCharacters: number;
  language: 'fr';
}

export interface NewsConfig {
  rssUrl: URL;
  summaryMode: SummaryMode;
  maxArticles: number;
  rssTimeoutMs: number;
  rssMaxBytes: number;
  ai?: {
    endpoint: URL;
    model?: string;
    apiKey?: string;
    timeoutMs: number;
  };
}

export interface NewsProvider {
  fetchLatest(signal: AbortSignal): Promise<readonly NewsItem[]>;
}

export interface ArticleSummarizer {
  summarize(item: NewsItem, budget: SummaryBudget): Promise<string>;
}

export interface AiSummaryClient {
  summarize(item: NewsItem, budget: SummaryBudget): Promise<string>;
}
