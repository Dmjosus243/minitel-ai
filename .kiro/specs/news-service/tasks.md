# Implementation Plan: 3615 NEWS Service

## Overview

This plan adds a dependency-injected RSS news service without changing the core `Service` contract. Work proceeds from domain/configuration boundaries through bounded RSS acquisition, both summarization modes, one-page article fitting, service registration, and deterministic validation. No test or implementation may depend on a live RSS source or AI endpoint.

## Tasks

- [x] 1. Define news domain types and configuration
  - [x] 1.1 Create `src/services/news/types.ts`
    - Define `SummaryMode`, `NewsItem`, `SummaryBudget`, `NewsConfig`, `NewsProvider`, `ArticleSummarizer`, and `AiSummaryClient`
    - Keep raw XML and vendor-specific AI response types outside the domain model
    - _Requirements: 3.5, 8.5, 8.8_
  - [x] 1.2 Create `src/services/news/config.ts`
    - Parse `NEWS_RSS_URL` and require an absolute HTTPS URL
    - Normalize `NEWS_SUMMARIZER_MODE`, default blank input to `extractive`, and reject unsupported values
    - Parse article, timeout, response-size, and mode-specific AI settings with documented defaults and bounds
    - Return typed configuration errors without including secret values
    - _Requirements: 2.1, 2.2, 3.1, 3.2, 3.3, 3.4, 8.1, 8.2, 8.3, 8.4, 8.7_
  - [x] 1.3 Add configuration unit tests
    - Cover defaults, whitespace/case normalization, both modes, every numeric boundary, invalid URLs, missing AI settings, and secret-safe errors
    - _Requirements: 2.1, 2.2, 3.1, 3.2, 3.3, 3.4, 8.1, 8.2, 8.3, 8.4, 8.7_
  - [x] 1.4 Add the property test for Property 1: Summary Mode Selection
    - Run at least 100 generated environment-value cases
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 2. Implement bounded RSS acquisition and normalization
  - [x] 2.1 Add one lightweight RSS/XML parser dependency
    - Select a maintained package that can reject DTD and external-entity processing
    - Record the dependency in `package.json` and the lockfile; do not add a general scraping or HTTP SDK
    - _Requirements: 2.4, 8.6_
  - [x] 2.2 Create the bounded RSS transport in `src/services/news/rss-provider.ts`
    - Use an injected fetch function and `AbortController`
    - Send no cookies or unrelated credentials
    - Enforce timeout, successful status, HTTPS redirect policy, content checks, and the byte limit while reading the response
    - Classify acquisition failures without exposing response bodies or URL query strings
    - _Requirements: 2.2, 2.3, 2.9, 7.1, 7.5, 8.5, 8.7_
  - [x] 2.3 Implement safe RSS 2.0 parsing and NewsItem normalization
    - Reject DTDs, external entities, malformed whole documents, and unusable RSS structures
    - Extract title, `content:encoded` or description, optional source, and optional publication date
    - Strip markup and unsafe controls, discard untitled items, preserve order, and stop at `maxArticles`
    - Never fetch item links
    - _Requirements: 2.4, 2.5, 2.6, 2.7, 2.8, 7.3, 8.6_
  - [x] 2.4 Add RSS provider unit tests with injected byte streams and parser fixtures
    - Cover success, field precedence, Unicode, missing fields, malformed items, feed order, maximum count, timeout, redirect, statuses, oversized bodies, DTD/entity input, and malformed XML
    - Make no live network calls
    - _Requirements: 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 7.1, 7.3, 8.5, 8.6_
  - [x] 2.5 Add the property test for Property 2: RSS Item Filtering, Order, and Limit
    - Run at least 100 generated item sequences and valid maximum values
    - _Requirements: 2.5, 2.6, 2.7, 7.3_

- [x] 3. Implement extractive and AI summarizers
  - [x] 3.1 Create the deterministic extractive strategy in `src/services/news/summarizers.ts`
    - Segment sanitized text into sentences and select opening complete sentences in order
    - Fall back to title text when item body text is absent
    - Truncate an oversized first sentence at a word boundary with an ellipsis
    - Keep output non-empty, deterministic, and derived only from source text
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_
  - [x] 3.2 Implement the injected HTTP AI summary client
    - Send only sanitized title/text and the summary constraints to the configured HTTPS gateway
    - Support optional model and bearer credentials without logging them
    - Validate the `{ summary: string }` response and enforce timeout and a bounded response body
    - Keep gateway-specific request/response handling behind `AiSummaryClient`
    - _Requirements: 5.1, 5.2, 5.3, 5.6, 8.4, 8.5, 8.7_
  - [x] 3.3 Implement the resilient AI wrapper and mode factory
    - Select the configured strategy during dependency composition
    - Return sanitized AI text on success
    - On timeout, rejection, malformed data, or empty output, log a sanitized event and invoke the extractive strategy for that item
    - Ensure extractive mode never constructs or calls the AI transport
    - _Requirements: 3.5, 3.6, 5.4, 5.5, 5.6, 7.4_
  - [x] 3.4 Add summarizer unit tests
    - Cover sentence boundaries, long first sentences, title-only items, Unicode, deterministic output, AI success, adversarial source instructions, all fallback cases, and zero AI calls in extractive mode
    - _Requirements: 3.5, 3.6, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.1, 5.2, 5.3, 5.5, 5.6, 7.4_
  - [x] 3.5 Add the property test for Property 3: Extractive Prefix Preservation
    - Run at least 100 generated sanitized sources and positive budgets
    - _Requirements: 4.1, 4.2, 4.3, 4.5, 4.6_
  - [x] 3.6 Add the property test for Property 6: AI Failure Equivalence
    - Run at least 100 generated NewsItem and budget combinations with failing or unusable fake AI responses
    - _Requirements: 5.5, 7.4_

- [x] 4. Implement sanitization, article fitting, and news presentation
  - [x] 4.1 Create pure presentation helpers in `src/services/news/presenter.ts`
    - Strip HTML/script/style/XML content and disallowed controls, normalize whitespace, and retain readable Unicode
    - Render deterministic UTC dates and omit absent or invalid optional metadata cleanly
    - Render the `3615 NEWS` heading and numbered article blocks in feed order
    - Render `Aucune actualité disponible` for a valid empty list
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_
  - [x] 4.2 Implement `fitArticleBlock()` against the existing formatter
    - Bound title, source, and candidate summary according to the design
    - Remove trailing summary words until isolated `formatText()` output contains one page
    - If needed, reduce untrusted title/source text while preserving the article number
    - Verify line count, Unicode code-point width, and `pageWeight()` rather than estimating bytes
    - _Requirements: 4.3, 5.4, 6.2, 6.4, 6.6, 6.7, 6.8_
  - [x] 4.3 Add presenter and fitter unit tests
    - Cover missing metadata, invalid dates, markup, controls, accents, combining marks, emoji, long words, all-multibyte text, and summaries near every page boundary
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8_
  - [x] 4.4 Add the property test for Property 4: Article Block Fit
    - Run at least 100 generated item/summary combinations and assert with `formatText()` plus `pageWeight()`
    - _Requirements: 5.4, 6.2, 6.4, 6.6, 6.7, 6.8_

- [x] 5. Implement the 3615 NEWS service orchestration
  - [x] 5.1 Create `src/services/news.ts` and `createNewsService()`
    - Expose code `3615 NEWS`, title `Actualités`, and description `Les dernières actualités en bref`
    - Fetch once per render, summarize and fit each item, and combine plain-text blocks
    - Return the empty-feed text for a valid empty result
    - Keep provider, summarizer, and logger injectable
    - _Requirements: 1.1, 1.2, 1.5, 5.4, 6.1, 6.5, 8.5, 8.8_
  - [x] 5.2 Implement exact source-failure mapping
    - Export `NEWS_UNAVAILABLE_MESSAGE` with the exact value `Service temporairement indisponible`
    - Map classified source and degraded-configuration failures to only that service content
    - Skip malformed individual items, retain AI fallback behavior, and sanitize logs
    - Leave unrelated services and the homepage operational
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_
  - [x] 5.3 Add service unit tests
    - Verify metadata, orchestration order, valid empty feed, multiple items, exact unavailable output, partial item handling, AI fallback, and logger failures
    - _Requirements: 1.1, 1.2, 6.1, 6.5, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_
  - [x] 5.4 Add the property test for Property 7: Source Failure Mapping
    - Exercise all classified failure kinds and generated safe/unsafe error messages without leaking details
    - _Requirements: 7.1, 7.2, 7.5, 7.6_

- [x] 6. Compose and register the production service
  - [x] 6.1 Compose production dependencies from environment configuration
    - Build the bounded RSS provider, safe parser, extractive strategy, and optional AI strategy
    - If configuration is invalid, log safely and create the degraded service instead of terminating application startup
    - _Requirements: 2.1, 3.1, 3.2, 3.3, 3.4, 7.5, 7.6, 8.1, 8.4, 8.7_
  - [x] 6.2 Register `newsService` in `src/index.ts`
    - Register it once after `aideService` to preserve existing service order
    - Confirm it appears in the homepage menu and resolves through code and numbered navigation
    - _Requirements: 1.2, 1.3, 1.4_
  - [x] 6.3 Document runtime configuration
    - Add the NEWS environment variables, defaults, accepted modes, public-feed responsibility, and AI gateway contract to `README.md`
    - State that `extractive` is the no-AI default and that item links are not scraped
    - _Requirements: 2.1, 2.8, 3.1, 3.2, 8.1, 8.2, 8.4, 8.7_

- [x] 7. Add routing and HTTP integration coverage
  - [x] 7.1 Test code and menu integration
    - Use a fresh `ServiceRegistry` for route properties
    - Verify `3615 NEWS`, mixed case, extra spaces, registration order, homepage discovery, and numbered selection
    - _Requirements: 1.1, 1.3, 1.4_
  - [x] 7.2 Add the property test for Property 5: Routed Page Constraints
    - Generate finite normalized news lists and route them through the real core formatter
    - Assert no content loss and enforce 40 columns, 24 rows, and strictly less than 2048 bytes with at least 100 runs
    - _Requirements: 1.5, 6.7, 6.8, 6.9, 8.8_
  - [x] 7.3 Test the Hono endpoint with mocked external boundaries
    - Mock RSS transport before loading production registration
    - Request `/?q=3615%20NEWS` and the numbered menu entry
    - Verify heading, summaries, pagination, existing weight lines, valid empty state, and exact French source-failure content
    - Exercise both summary modes without a live RSS or AI request
    - _Requirements: 1.4, 3.6, 6.1, 6.5, 6.7, 6.8, 6.9, 7.1, 7.2, 7.4, 7.6_

- [ ] 8. Checkpoint - Validate the complete feature
  - Run `npm run typecheck`, `npm test`, and `npm run build`
  - Verify every correctness-property test runs at least 100 cases and uses matching property numbers and requirement references
  - Verify no test contacts a live feed or AI endpoint
  - Manually inspect routed output for 40-column readability, French labels, page weights, and the exact unavailable message
  - Confirm the existing AIDE service and homepage behavior remain unchanged
  - _Requirements: 1.1-1.5, 2.1-2.9, 3.1-3.6, 4.1-4.6, 5.1-5.6, 6.1-6.9, 7.1-7.6, 8.1-8.8_

## Notes

- All tasks are required for the feature; none are optional.
- Keep comments in French and names explicit, following the repository steering rules.
- Do not change `Service.render(): Promise<string>` or duplicate `formatText()` behavior in the NEWS module.
- Add only one XML/RSS parsing dependency. Use platform HTTP primitives unless the target Node runtime proves they are unavailable.
- Treat feed and AI content as untrusted data. Never place secrets, raw feed bodies, or full prompts in logs.
- Keep property names and numbers identical in this document, `design.md`, and future test names.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["1.3", "1.4", "2.1", "2.2", "3.1"] },
    { "id": 2, "tasks": ["2.3", "3.2"] },
    { "id": 3, "tasks": ["2.4", "2.5", "3.3", "3.4", "3.5", "3.6", "4.1"] },
    { "id": 4, "tasks": ["4.2"] },
    { "id": 5, "tasks": ["4.3", "4.4", "5.1", "5.2"] },
    { "id": 6, "tasks": ["5.3", "5.4", "6.1"] },
    { "id": 7, "tasks": ["6.2", "6.3", "7.1", "7.2"] },
    { "id": 8, "tasks": ["7.3"] },
    { "id": 9, "tasks": ["8"] }
  ]
}
```
