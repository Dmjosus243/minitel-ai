# Requirements Document

## Introduction

The 3615 NEWS service brings recent public news-feed content into Minitel AI through the existing service router. It reads a configurable public RSS feed, converts feed entries to safe plain text, and produces concise article summaries suited to the existing 40-column, 24-row, strictly-less-than-2-KB page format. Summary generation can use a deterministic first-sentences strategy with no AI dependency or an AI strategy selected through an environment variable. The non-AI strategy remains the default and the fallback if AI summarization fails.

## Glossary

- **News_Service**: The service registered under the exact code `3615 NEWS`
- **RSS_Source**: The operator-configured, publicly reachable HTTPS RSS feed
- **RSS_Provider**: The component that downloads, bounds, parses, and normalizes the RSS feed
- **News_Item**: A normalized feed entry containing a title, source text, and optional source and publication date
- **Sanitized_Content**: Plain text obtained after removing markup, unsafe XML constructs, control characters, and redundant whitespace
- **Summary_Mode**: The configured summary strategy, either `extractive` or `ai`
- **Extractive_Summarizer**: The deterministic summarizer that selects the first sentences from Sanitized_Content and does not call an AI service
- **AI_Summarizer**: The summarizer that delegates generation to the configured AI summary endpoint
- **Article_Block**: The title, optional metadata, and fitted summary rendered for one News_Item
- **Page_Transformer**: The existing core formatter that wraps and paginates text using Minitel page constraints
- **Service_Router**: The existing registry and router that invokes a service and sends its text through the Page_Transformer
- **Source_Unavailable_Message**: The exact user-facing text `Service temporairement indisponible`

## Requirements

### Requirement 1: Service Identity and Router Integration

**User Story:** As a Minitel AI user, I want to open a discoverable 3615 NEWS service, so that I can read current news through the existing navigation model.

#### Acceptance Criteria

1. THE News_Service SHALL expose the exact service code `3615 NEWS`
2. THE News_Service SHALL expose the title `Actualités` and a French description suitable for the numbered homepage menu
3. WHEN the application starts, THE application SHALL register the News_Service once in the existing Service_Router without changing the relative order of already registered services
4. WHEN a user selects the News_Service by its normalized code or numbered menu entry, THE Service_Router SHALL invoke the same News_Service
5. WHEN the News_Service returns content, THE News_Service SHALL return plain text and SHALL delegate line wrapping, pagination, and final page-size enforcement to the existing Page_Transformer

### Requirement 2: Public RSS Acquisition

**User Story:** As a service operator, I want 3615 NEWS to read a configurable public RSS feed, so that I can choose a lawful source without changing application code.

#### Acceptance Criteria

1. THE RSS_Provider SHALL obtain the RSS_Source URL from the `NEWS_RSS_URL` environment variable
2. THE RSS_Provider SHALL accept only an absolute HTTPS URL as the RSS_Source and SHALL NOT derive the URL from user request data
3. WHEN the News_Service requires current content, THE RSS_Provider SHALL request the configured RSS_Source without sending application cookies or unrelated credentials
4. WHEN the RSS_Source returns a successful RSS response, THE RSS_Provider SHALL parse its channel items into News_Item values
5. THE RSS_Provider SHALL map each valid item title, the first available item content or description, and optional source and publication date into Sanitized_Content
6. WHEN an RSS item has no non-empty title, THE RSS_Provider SHALL discard that item without failing the complete feed
7. THE RSS_Provider SHALL preserve feed order and SHALL return no more than the configured maximum number of valid items
8. THE RSS_Provider SHALL NOT fetch or scrape the article links referenced by RSS items
9. THE RSS_Provider SHALL stop acquisition when the configured timeout or maximum response-body size is reached

### Requirement 3: Environment-Selected Summary Mode

**User Story:** As a service operator, I want to select AI or non-AI summaries through configuration, so that the service can run in environments with or without AI access.

#### Acceptance Criteria

1. THE News_Service SHALL select its Summary_Mode from the `NEWS_SUMMARIZER_MODE` environment variable when application dependencies are composed
2. WHEN `NEWS_SUMMARIZER_MODE` is absent or blank, THE News_Service SHALL select `extractive`
3. WHEN `NEWS_SUMMARIZER_MODE` equals `extractive` or `ai` after trimming and case normalization, THE News_Service SHALL select the corresponding summarizer
4. WHEN `NEWS_SUMMARIZER_MODE` has any other value, THE configuration loader SHALL report a configuration error and SHALL NOT silently select a different mode
5. THE Extractive_Summarizer and AI_Summarizer SHALL implement the same summarizer interface so that the News_Service orchestration does not depend on the selected strategy
6. WHILE `extractive` mode is selected, THE News_Service SHALL make no request to an AI endpoint

### Requirement 4: Non-AI Extractive Summaries

**User Story:** As a user of a deployment without AI, I want useful summaries made from the opening sentences, so that 3615 NEWS remains fully functional without an AI provider.

#### Acceptance Criteria

1. WHEN the Extractive_Summarizer receives a News_Item, THE Extractive_Summarizer SHALL use the item's Sanitized_Content as its only factual source
2. THE Extractive_Summarizer SHALL select complete opening sentences in their original order while they fit within the supplied summary budget
3. WHEN the first complete sentence exceeds the supplied summary budget, THE Extractive_Summarizer SHALL shorten it at a word boundary and append an ellipsis when space permits
4. WHEN item content and description are absent, THE Extractive_Summarizer SHALL use the sanitized title as the summary source
5. FOR the same News_Item and summary budget, THE Extractive_Summarizer SHALL always return the same result
6. THE Extractive_Summarizer SHALL NOT add facts, interpretations, or text that does not originate in the News_Item, except for an ellipsis marking truncation

### Requirement 5: AI Summaries and Safe Fallback

**User Story:** As a service operator with an AI endpoint, I want concise generated summaries, so that I can improve readability without making the service depend on AI availability.

#### Acceptance Criteria

1. WHILE `ai` mode is selected, THE AI_Summarizer SHALL send only the sanitized title and sanitized source text required to summarize a News_Item to the configured AI endpoint
2. THE AI_Summarizer SHALL request a concise French plain-text summary constrained by the supplied summary budget
3. THE AI_Summarizer SHALL treat all News_Item content as untrusted source material and SHALL NOT interpret instructions contained in that content as control instructions
4. WHEN the AI endpoint returns a summary, THE News_Service SHALL sanitize and fit that summary with the same Article_Block post-processing used for extractive output
5. IF the AI endpoint times out, rejects the request, returns malformed data, or returns an empty summary, THEN THE News_Service SHALL use the Extractive_Summarizer for that News_Item
6. THE News_Service SHALL NOT expose AI credentials, endpoint response details, or prompts in user-visible output or logs

### Requirement 6: News Presentation and Minitel Limits

**User Story:** As a user on a constrained connection, I want short, readable news pages, so that each response remains compatible with the Minitel format.

#### Acceptance Criteria

1. WHEN one or more News_Item values are available, THE News_Service SHALL render the heading `3615 NEWS` followed by numbered Article_Block values in feed order
2. EACH Article_Block SHALL contain a sanitized title, an optional source and publication date when supplied by the feed, and a non-empty summary
3. THE News_Service SHALL render dates in a short, deterministic format and SHALL omit optional metadata that is absent or invalid
4. THE News_Service SHALL render no HTML tags, script content, XML markup, or disallowed control characters from the RSS_Source or AI endpoint
5. WHEN a valid RSS feed contains no valid items, THE News_Service SHALL render `Aucune actualité disponible`
6. THE News_Service SHALL shorten untrusted display fields and the candidate summary at word boundaries until each Article_Block, when formatted in isolation with the default Page_Transformer configuration, fits on one Page
7. WHEN the complete service text is routed, THE Page_Transformer SHALL produce lines of no more than 40 Unicode code points and Pages of no more than 24 lines
8. EACH routed Page SHALL have a serialized UTF-8 size strictly less than 2048 bytes according to the existing core page-weight calculation
9. WHEN the complete service text exceeds one Page, THE Page_Transformer SHALL paginate it without discarding Article_Block content

### Requirement 7: Source Failure and Resilience

**User Story:** As a user, I want a clear French status when news cannot be loaded, so that a provider failure does not break the Minitel interface.

#### Acceptance Criteria

1. IF the RSS_Source is unreachable, times out, returns a non-success status, exceeds the response-size limit, or returns an unusable RSS document, THEN THE News_Service SHALL return only the Source_Unavailable_Message as its user-visible service content
2. THE News_Service SHALL use the exact capitalization and spelling `Service temporairement indisponible` for the Source_Unavailable_Message
3. WHEN an individual RSS item is malformed, THE RSS_Provider SHALL discard that item and continue with the remaining valid items
4. IF AI summarization fails while RSS content remains usable, THEN THE News_Service SHALL use the extractive fallback and SHALL NOT show the Source_Unavailable_Message for that AI failure
5. WHEN an acquisition or configuration failure occurs, THE News_Service SHALL log a sanitized diagnostic without secrets or raw feed content
6. WHEN the News_Service cannot produce news, THE existing router, homepage, and other registered services SHALL remain responsive

### Requirement 8: Configuration, Security, and Testability

**User Story:** As a maintainer, I want bounded and injectable external dependencies, so that the service is safe to operate and deterministic to test.

#### Acceptance Criteria

1. THE configuration loader SHALL support `NEWS_RSS_URL`, `NEWS_SUMMARIZER_MODE`, `NEWS_MAX_ARTICLES`, `NEWS_RSS_TIMEOUT_MS`, and `NEWS_RSS_MAX_BYTES`
2. WHEN optional numeric configuration is absent, THE configuration loader SHALL use 5 articles, a 5000-millisecond RSS timeout, and a 1048576-byte RSS response limit
3. THE configuration loader SHALL accept `NEWS_MAX_ARTICLES` only from 1 through 20 and SHALL require timeout and byte limits to be positive bounded integers
4. WHILE `ai` mode is selected, THE configuration loader SHALL require the AI endpoint settings used by the injected AI client; WHILE `extractive` mode is selected, those settings SHALL remain optional
5. THE News_Service SHALL obtain RSS transport, RSS parsing, AI access, and logging through replaceable interfaces or injected functions
6. THE RSS parser SHALL disable or reject DTDs and external entities and SHALL enforce bounded input before XML parsing
7. THE implementation SHALL keep source URLs, credentials, and provider secrets out of source code and user-visible output
8. THE implementation SHALL use the existing formatter and router contracts without changing the core `Service` return type or duplicating core pagination logic
