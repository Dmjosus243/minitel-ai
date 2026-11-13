import type { Service } from '../core/types';
import {
  loadNewsConfig,
  NewsConfigurationError,
} from './news/config';
import {
  renderNews,
  sanitizeExternalText,
} from './news/presenter';
import {
  createBoundedRssTransport,
  createRssProvider,
  createSafeRssParser,
  RssSourceError,
  type RssFetchImplementation,
} from './news/rss-provider';
import {
  AiSummaryClientError,
  createSummarizer,
  type AiFetchImplementation,
} from './news/summarizers';
import type {
  ArticleSummarizer,
  NewsItem,
  NewsProvider,
  SummaryBudget,
} from './news/types';

export const NEWS_UNAVAILABLE_MESSAGE = 'Service temporairement indisponible';

const NEWS_SERVICE_METADATA = Object.freeze({
  code: '3615 NEWS',
  title: 'Actualités',
  description: 'Les dernières actualités en bref',
});
const NEWS_SUMMARY_MAX_CHARACTERS = 600;
const NEWS_SOURCE_FAILURE_EVENT = 'NEWS RSS source unavailable.';
const NEWS_CONFIGURATION_FAILURE_EVENT = 'NEWS configuration unavailable.';

type ErrorLogger = Pick<Console, 'error'>;

export interface NewsServiceOptions {
  provider: NewsProvider;
  summarizer: ArticleSummarizer;
  logger?: ErrorLogger;
}

function createSummaryBudget(): SummaryBudget {
  return {
    maxCharacters: NEWS_SUMMARY_MAX_CHARACTERS,
    language: 'fr',
  };
}

/** Vérifie défensivement les articles fournis par une implémentation injectée. */
function isRenderableNewsItem(value: unknown): value is NewsItem {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const item = value as Readonly<Record<string, unknown>>;
  if (
    typeof item.title !== 'string'
    || sanitizeExternalText(item.title) === ''
    || typeof item.sourceText !== 'string'
  ) {
    return false;
  }
  if (item.source !== undefined && typeof item.source !== 'string') {
    return false;
  }

  return item.publishedAt === undefined || item.publishedAt instanceof Date;
}

function isUnavailableFailure(
  error: unknown,
): error is RssSourceError | NewsConfigurationError {
  return error instanceof RssSourceError
    || error instanceof NewsConfigurationError;
}

/** Journalise seulement un événement fixe, jamais le détail externe. */
function logSanitizedEvent(logger: ErrorLogger, event: string): void {
  try {
    logger.error(event);
  } catch {
    // Une panne du journal ne doit pas modifier le contenu du service.
  }
}

/** Journalise seulement la frontière en panne, jamais le détail externe. */
function logUnavailableFailure(
  logger: ErrorLogger,
  error: RssSourceError | NewsConfigurationError,
): void {
  const event = error instanceof RssSourceError
    ? NEWS_SOURCE_FAILURE_EVENT
    : NEWS_CONFIGURATION_FAILURE_EVENT;

  logSanitizedEvent(logger, event);
}

/** Assemble le fournisseur, le résumeur et le rendu du service 3615 NEWS. */
export function createNewsService(options: NewsServiceOptions): Service {
  const logger = options.logger ?? console;

  return {
    ...NEWS_SERVICE_METADATA,
    async render(): Promise<string> {
      try {
        const items = await options.provider.fetchLatest(
          new AbortController().signal,
        );
        const summarizedItems: Array<{
          item: NewsItem;
          summary: string;
        }> = [];

        for (const item of items) {
          if (!isRenderableNewsItem(item)) {
            continue;
          }

          summarizedItems.push({
            item,
            summary: await options.summarizer.summarize(
              item,
              createSummaryBudget(),
            ),
          });
        }

        return renderNews(summarizedItems);
      } catch (error) {
        if (!isUnavailableFailure(error)) {
          throw error;
        }

        logUnavailableFailure(logger, error);
        return NEWS_UNAVAILABLE_MESSAGE;
      }
    },
  };
}

export interface ProductionNewsServiceOptions {
  environment?: Readonly<Record<string, string | undefined>>;
  logger?: ErrorLogger;
  rssFetchImplementation?: RssFetchImplementation;
  aiFetchImplementation?: AiFetchImplementation;
}

function isConfigurationCompositionFailure(error: unknown): boolean {
  return error instanceof NewsConfigurationError
    || (
      error instanceof AiSummaryClientError
      && error.kind === 'unsafe-endpoint'
    );
}

/** Crée un service enregistré mais indisponible après une configuration invalide. */
function createDegradedNewsService(): Service {
  return {
    ...NEWS_SERVICE_METADATA,
    async render(): Promise<string> {
      return NEWS_UNAVAILABLE_MESSAGE;
    },
  };
}

/** Compose toutes les dépendances de production à partir de l'environnement. */
export function createProductionNewsService(
  options: ProductionNewsServiceOptions = {},
): Service {
  const logger = options.logger ?? console;

  try {
    const config = loadNewsConfig(options.environment ?? process.env);
    const provider = createRssProvider({
      config,
      fetchRss: createBoundedRssTransport(options.rssFetchImplementation),
      parser: createSafeRssParser(),
    });
    const summarizer = createSummarizer({
      config,
      logger,
      ...(options.aiFetchImplementation === undefined
        ? {}
        : { fetchImplementation: options.aiFetchImplementation }),
    });

    return createNewsService({ provider, summarizer, logger });
  } catch (error) {
    if (!isConfigurationCompositionFailure(error)) {
      throw error;
    }

    logSanitizedEvent(logger, NEWS_CONFIGURATION_FAILURE_EVENT);
    return createDegradedNewsService();
  }
}

export const newsService = createProductionNewsService();