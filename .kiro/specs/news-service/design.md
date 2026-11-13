# Design: 3615 NEWS Service

## Overview

3615 NEWS is an asynchronous `Service` implementation that turns a configured public RSS feed into concise French plain text. It fits the current architecture without changing the core `Service` contract: `render()` returns a string, the existing `ServiceRegistry` catches unexpected service failures, and `formatText()` remains the sole final authority for 40-column wrapping, 24-row pagination, and the strictly-less-than-2048-byte `Page` limit.

The service has two summary strategies selected once during application composition through `NEWS_SUMMARIZER_MODE`:

- `extractive` is the default. It deterministically selects the first complete sentences and requires no AI or network call beyond the RSS feed.
- `ai` calls an injected AI summary client. Every AI result passes through the same sanitization and size-fitting stage. Any per-item AI failure falls back to the extractive strategy.

The RSS URL is operator configuration rather than user input. The first implementation reads RSS content embedded in the feed and deliberately does not scrape article pages. This limits latency, licensing exposure, SSRF surface, and dependency count.

## Scope and Design Decisions

- The source is one configurable RSS 2.0 feed identified by `NEWS_RSS_URL`.
- `NEWS_RSS_URL` has no hard-coded production default because the operator must choose a public feed whose terms permit the deployment's use.
- The default maximum is five valid entries, retained in feed order.
- A successful but empty feed produces `Aucune actualité disponible`.
- RSS transport, HTTP status, size, timeout, and whole-document parse failures produce exactly `Service temporairement indisponible` as the service content.
- AI failure does not make the news source unavailable; it triggers a per-item extractive fallback.
- Each Article_Block is reduced until it fits one default Minitel page when formatted by itself. The existing formatter may place or split blocks differently when it paginates the combined service text, but every resulting page still satisfies the core limits.
- This feature uses the server's existing `Poids: N octets` output and does not redefine page-weight or savings metadata.
- The AI vendor is isolated behind `AiSummaryClient`. A thin production HTTP adapter targets an operator-provided summary gateway instead of adding a vendor SDK to service-domain code.

## Architecture

```text
Environment variables
        |
        v
 loadNewsConfig() -----> strategy selection
        |                       |
        |              +--------+---------+
        |              |                  |
        |      ExtractiveSummarizer   AiSummarizer
        |                                 |
        |                         AiSummaryClient
        |                                 |
        |                         HTTPS AI gateway
        v
 createNewsService(dependencies, config)
        |
GET /?q=3615%20NEWS
        |
 existing Hono server
        |
 existing ServiceRegistry.route()
        |
 NewsService.render()
        |
 HttpRssProvider -> bounded fetch -> safe RSS parser -> NewsItem[]
        |
 summarize each item -> sanitize -> fit ArticleBlock
        |
 plain service text
        |
 existing formatText() -> Page[] -> pagesToPlainText()
```

Numbered-menu navigation reaches the same service through `defaultRegistry.getAll()`. Registration remains in `src/index.ts`, after existing registrations, so current menu ordering is preserved.

## Components and Interfaces

### 1. News Domain Types (`src/services/news/types.ts`)

```ts
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
```

`NewsItem` contains only normalized plain text. Raw XML nodes and provider-specific types do not cross the `RssParser` boundary.

### 2. Configuration (`src/services/news/config.ts`)

```ts
export function loadNewsConfig(env: NodeJS.ProcessEnv): NewsConfig;
export function normalizeSummaryMode(value: string | undefined): SummaryMode;
```

Configuration is read only during composition, not inside pure parsing, summarization, or presentation functions.

| Variable | Required | Default | Validation |
| --- | --- | --- | --- |
| `NEWS_RSS_URL` | yes | none | absolute HTTPS URL |
| `NEWS_SUMMARIZER_MODE` | no | `extractive` | `extractive` or `ai`, trim/case normalized |
| `NEWS_MAX_ARTICLES` | no | `5` | integer from 1 through 20 |
| `NEWS_RSS_TIMEOUT_MS` | no | `5000` | positive bounded integer |
| `NEWS_RSS_MAX_BYTES` | no | `1048576` | positive bounded integer |
| `NEWS_AI_ENDPOINT` | in `ai` mode | none | absolute HTTPS URL |
| `NEWS_AI_MODEL` | provider-dependent | omitted | non-empty when supplied |
| `NEWS_AI_API_KEY` | provider-dependent | omitted | never logged |
| `NEWS_AI_TIMEOUT_MS` | no | `5000` | positive bounded integer |

An invalid configuration is represented as a typed configuration error. Application composition catches it, logs a sanitized diagnostic, and registers a degraded `3615 NEWS` service whose `render()` returns the French unavailable message. This keeps startup and other services responsive while avoiding a silent mode change.

### 3. Bounded RSS Provider (`src/services/news/rss-provider.ts`)

```ts
export interface ParsedRssItem {
  title?: string;
  content?: string;
  description?: string;
  source?: string;
  publishedAt?: string;
}

export interface RssParser {
  parse(xml: string): readonly ParsedRssItem[];
}

export type FetchRss = (
  url: URL,
  options: { signal: AbortSignal; maxBytes: number },
) => Promise<{ status: number; body: Uint8Array }>;

export function createRssProvider(options: {
  config: Pick<NewsConfig, 'rssUrl' | 'rssTimeoutMs' | 'rssMaxBytes' | 'maxArticles'>;
  fetchRss: FetchRss;
  parser: RssParser;
}): NewsProvider;
```

The production transport uses `fetch` with an `AbortController`. It rejects redirects to non-HTTPS locations, non-success statuses, unsupported or clearly non-XML responses, and bodies that exceed `rssMaxBytes` while streaming. The body limit is enforced before constructing the XML string.

The production parser uses one maintained lightweight XML/RSS dependency configured to reject DTD and external-entity processing. It supports the RSS 2.0 `channel/item` shape and extracts `title`, `content:encoded` when available, `description`, `source`, and `pubDate`. The normalizer:

1. strips markup and script/style content;
2. decodes safe character entities through the XML parser;
3. removes disallowed control characters;
4. collapses whitespace;
5. requires a non-empty title;
6. chooses `content`, then `description`, then title as `sourceText`;
7. parses a valid date when possible and otherwise omits it;
8. preserves input order and stops after `maxArticles` valid items.

The provider never requests item links.

### 4. Summarizers (`src/services/news/summarizers.ts`)

```ts
export function createExtractiveSummarizer(): ArticleSummarizer;

export function createAiSummarizer(options: {
  client: AiSummaryClient;
  fallback: ArticleSummarizer;
  logger: Pick<Console, 'error'>;
}): ArticleSummarizer;
```

The extractive implementation uses a deterministic French sentence segmentation helper. It appends opening sentences while they remain within `SummaryBudget.maxCharacters`. If the first sentence is too large, it truncates at the final fitting word boundary and adds `...` when possible. A non-empty sanitized source always yields non-empty output.

The AI wrapper asks the client for a French plain-text summary. It treats item text as quoted data, not instructions. Empty, malformed, timed-out, or rejected AI results are logged without source text or secrets and replaced by the exact output of the extractive fallback for the same item and budget.

The production `HttpAiSummaryClient` is kept in this module or a small adjacent adapter. It sends an HTTPS `POST` to `NEWS_AI_ENDPOINT` using this deployment-gateway contract:

```json
{
  "model": "optional-model-name",
  "input": {
    "title": "sanitized title",
    "text": "sanitized source text"
  },
  "constraints": {
    "language": "fr",
    "maxCharacters": 600,
    "columns": 40,
    "rows": 24,
    "maxBytes": 2048
  }
}
```

A successful response has the shape `{ "summary": "..." }`. `NEWS_AI_API_KEY`, when configured, is sent as a bearer token. This small adapter is replaceable if a deployment talks directly to a vendor API.

### 5. Sanitization and Presentation (`src/services/news/presenter.ts`)

```ts
export function sanitizeExternalText(value: string): string;
export function renderArticleBlock(item: NewsItem, summary: string): string;
export function fitArticleBlock(item: NewsItem, candidateSummary: string): string;
export function renderNews(items: readonly { item: NewsItem; summary: string }[]): string;
```

Display limits before fitting are:

- title: 120 Unicode code points;
- source: 40 Unicode code points;
- candidate summary: 600 Unicode code points;
- publication date: UTC `YYYY-MM-DD`.

`fitArticleBlock()` first normalizes and bounds display fields. It calls the existing `formatText()` on the isolated block. If the result has more than one page, it removes trailing summary words and retries. It uses an ellipsis to indicate truncation. If metadata alone would exceed one page, it further shortens the title and source, without removing the article number. The function stops only when `formatText(block)` returns one page whose `pageWeight()` is strictly below 2048 bytes.

`renderNews()` produces:

```text
3615 NEWS

1. Titre de l'article
Source - 2026-11-11
Résumé court...

2. Autre titre
Résumé court...
```

Absent metadata is omitted without empty separators. Article text contains no raw URL because the current server has no article-link navigation and long URLs consume the page budget.

### 6. Service Orchestration (`src/services/news.ts`)

```ts
export const NEWS_UNAVAILABLE_MESSAGE = 'Service temporairement indisponible';

export function createNewsService(options: {
  provider: NewsProvider;
  summarizer: ArticleSummarizer;
  logger?: Pick<Console, 'error'>;
}): Service;

export const newsService: Service;
```

The service has this fixed metadata:

```ts
{
  code: '3615 NEWS',
  title: 'Actualités',
  description: 'Les dernières actualités en bref'
}
```

`render()` performs one provider call, summarizes valid items, fits each block, and returns combined text. It returns `Aucune actualité disponible` for a valid empty result. It catches typed RSS transport/parser/configuration failures and returns only `NEWS_UNAVAILABLE_MESSAGE`. Unexpected internal programming errors may still propagate to the existing router's global protection.

### 7. Application Registration (`src/index.ts`)

`newsService` is registered after `aideService`. This preserves the existing AIDE menu position and makes NEWS the next numbered entry. No new Hono route is needed: `/?q=3615%20NEWS` and its current normalized variants already pass through the router.

## Data Flow

1. `src/index.ts` loads configuration and composes the production provider and summarizer.
2. The user enters `3615 NEWS` or its numbered homepage option.
3. The existing router invokes `newsService.render()`.
4. The provider performs one bounded RSS fetch and parses valid items.
5. The selected summarizer creates one candidate per item. In AI mode, failures fall back per item.
6. The presenter sanitizes each candidate and reduces its Article_Block until it fits one isolated default page.
7. The service joins the heading and Article_Block values into plain text.
8. The existing router calls `formatText()` on the complete text.
9. The server serializes the resulting Pages with the existing per-page weight display.

## Correctness Properties

### Property 1: Summary Mode Selection

*For any* environment value, normalization SHALL select `extractive` for absent or blank input, select the matching supported mode regardless of surrounding whitespace or case, and reject every other non-blank value.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4**

### Property 2: RSS Item Filtering, Order, and Limit

*For any* parsed RSS item sequence and valid maximum, normalization SHALL return exactly the first valid titled items in source order, up to the configured maximum, with no untitled item included.

**Validates: Requirements 2.5, 2.6, 2.7, 7.3**

### Property 3: Extractive Prefix Preservation

*For any* non-empty sanitized source and positive summary budget, the extractive result SHALL be a deterministic prefix composed of opening source sentences or a word-boundary truncation of the first sentence, with no added content except a truncation ellipsis.

**Validates: Requirements 4.1, 4.2, 4.3, 4.5, 4.6**

### Property 4: Article Block Fit

*For any* normalized News_Item and candidate summary, `fitArticleBlock()` SHALL return a non-empty sanitized block for which the existing default `formatText()` produces exactly one Page, no line exceeds 40 Unicode code points, the Page has no more than 24 lines, and `pageWeight()` is strictly less than 2048 bytes.

**Validates: Requirements 5.4, 6.2, 6.4, 6.6, 6.7, 6.8**

### Property 5: Routed Page Constraints

*For any* finite normalized News_Item list within the configured maximum, routing the resulting News_Service text through a fresh `ServiceRegistry` SHALL preserve all rendered article text while producing only Pages that satisfy the core column, row, and byte limits.

**Validates: Requirements 1.5, 6.7, 6.8, 6.9, 8.8**

### Property 6: AI Failure Equivalence

*For any* normalized News_Item and summary budget, if the AI client fails or returns unusable output, the AI summarizer wrapper SHALL return the same summary as the extractive strategy invoked directly with that item and budget.

**Validates: Requirements 5.5, 7.4**

### Property 7: Source Failure Mapping

*For any* classified RSS transport, status, size, timeout, or whole-document parse failure, the News_Service SHALL return exactly `Service temporairement indisponible` and SHALL not include technical error details.

**Validates: Requirements 7.1, 7.2, 7.5, 7.6**

## Error Handling

| Failure | Boundary | Behavior |
| --- | --- | --- |
| Missing or invalid RSS configuration | composition | Log sanitized configuration error; register degraded NEWS service; render French unavailable message |
| DNS/network/TLS failure | RSS transport | Abort/close work; wrap as source-unavailable error |
| RSS timeout | RSS transport | Abort through `AbortController`; wrap as source-unavailable error |
| Redirect to non-HTTPS URL | RSS transport | Reject as source-unavailable error |
| Non-success HTTP status | RSS transport | Do not parse body; wrap as source-unavailable error |
| Oversized body | RSS transport | Stop streaming at the limit; wrap as source-unavailable error |
| DTD/external entity or malformed RSS | RSS parser | Reject document as source-unavailable error |
| Malformed individual item | normalization | Skip item and continue |
| Valid feed with no valid items | service | Return `Aucune actualité disponible` |
| AI timeout/status/malformed or empty output | AI wrapper | Log sanitized event; run extractive fallback for that item |
| Unexpected programming error | service/router | Let existing router protection keep the interface responsive |

Errors must not log API keys, authorization headers, raw RSS content, full AI prompts, or endpoint query strings. Logging failures must not affect user output.

## Testing Strategy

### Unit Tests

- `src/services/news/config.test.ts`: defaults, case/whitespace normalization, ranges, required mode-specific settings, secret-safe errors.
- `src/services/news/rss-provider.test.ts`: successful RSS mapping, content precedence, order, limits, item skipping, timeout, status, redirect, body limit, DTD/entity rejection, and malformed XML.
- `src/services/news/summarizers.test.ts`: complete first sentences, oversized first sentence, no body, determinism, AI success, malformed AI output, timeout, and exact extractive fallback.
- `src/services/news/presenter.test.ts`: sanitization, optional metadata, deterministic UTC dates, long Unicode content, HTML/control characters, and one-page fitting.
- `src/services/news.test.ts`: fixed service metadata, empty feed, source-unavailable message, multi-item rendering, and sanitized logging.

All transport tests use injected fakes. No automated test calls a live RSS feed or AI endpoint.

### Property-Based Tests

Use `fast-check` with at least 100 runs for each property. Test names use the exact pattern:

```ts
it('Feature: news-service, Property 4: Article Block Fit', () => {
  // **Validates: Requirements 5.4, 6.2, 6.4, 6.6, 6.7, 6.8**
});
```

Generators must include empty and repeated whitespace, accents, combining characters, emoji, very long words, markup-like strings, control characters, malformed optional dates, and multi-byte UTF-8 text.

### Integration Tests

- Register a dependency-injected News_Service in a fresh `ServiceRegistry` and verify code normalization plus routed page constraints.
- Mock RSS transport before importing the production entry point, then verify that NEWS appears after existing services in the homepage menu.
- Request `/?q=3615%20NEWS` through Hono and verify heading, summaries, pagination, and the existing weight lines.
- Simulate each classified RSS failure and verify that page content contains the exact French unavailable message.
- Exercise both summary modes with fake AI clients and verify that extractive mode performs zero AI calls.

### Validation Commands

Run the existing non-watch commands after implementation:

```text
npm run typecheck
npm test
npm run build
```
