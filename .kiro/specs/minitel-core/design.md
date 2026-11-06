# Design: Minitel AI Core Engine

## Overview

The Minitel AI Core Engine is a TypeScript application that transforms text content into 40-column by 24-line page format reminiscent of the classic Minitel terminal system. The system uses a Node.js server with Hono framework, with all core logic implemented as pure functions for easy testing. The design emphasizes modularity, testability, and adherence to the original Minitel constraints while handling modern web content.

## Architecture

The system follows a layered architecture with clear separation of concerns:

1. **Presentation Layer**: Hono web server that handles HTTP requests
2. **Service Layer**: Page transformer, service router, and homepage generator
3. **Core Layer**: Pure functions for text processing and routing logic
4. **Data Layer**: Service registry and configuration management

**Component Diagram:**
```
Client → Hono Server → Service Router → Page Transformer → Formatted Pages
                      ↓
               Homepage Generator → Numbered Menu
```

## Components and Interfaces

### Page Transformer (`src/core/formatter.ts`)
- `formatText(text: string, config?: PageConfig): Page[]`
  - Transforms input text into 40x24 formatted pages
  - Handles word wrapping at 40-character boundaries
  - Splits content across pages when exceeding 24 lines
  - Preserves paragraph structure where possible

### Service Router (`src/core/router.ts`)
- `registerService(service: Service): void`
  - Adds a service to the registry with validation
- `getService(code: string): Service | null`
  - Retrieves service by normalized code
- `route(input: string): Promise<Page[]>`
  - Main routing function that processes service requests

### Homepage Generator (`src/services/home.ts`)
- `generateHomepage(services: Service[]): Page[]`
  - Creates numbered menu of available services
  - Updates automatically when services change
- `Homepage_Generator`
  - Singleton component that manages homepage generation

### Web Server (`src/server.ts`)
- Hono application with routes for:
  - `/` - Homepage
  - `/service/:code` - Service access
  - `/api/services` - Service registry API

## Data Models

### Page Interface
```typescript
interface Page {
  content: string[];        // Array of lines (max 24)
  pageNumber: number;       // Current page (1-indexed)
  totalPages: number;       // Total pages in sequence
  metadata: {
    byteSize: number;       // UTF-8 size in bytes (< 2048)
    serviceCode?: string;   // Optional service identifier
  };
}
```

### Service Interface
```typescript
interface Service {
  code: string;             // Format: "NNNN WORD" (e.g., "3615 NEWS")
  title: string;            // Display name
  description?: string;     // Optional description for menu
  render(): Promise<string>; // Function that returns content
}
```

### Configuration Interface
```typescript
interface PageConfig {
  columns: number;          // Default: 40
  rows: number;            // Default: 24
  maxBytes: number;        // Default: 2048
  wordWrap: boolean;       // Default: true
}
```

### Service Registry
```typescript
interface ServiceRegistry {
  services: Map<string, Service>;  // Code → Service mapping
  register(service: Service): void;
  get(code: string): Service | null;
  getAll(): Service[];
  normalizeCode(code: string): string;
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Line Length Constraint

*For any* input text and configuration, every line produced by the page transformer SHALL contain at most 40 characters.

**Validates: Requirements 1.1**

### Property 2: Page Line Count Constraint

*For any* input text and configuration, every page produced by the page transformer SHALL contain at most 24 lines.

**Validates: Requirements 1.3**

### Property 3: Page Size Constraint

*For any* input text, every page produced by the page transformer SHALL weigh less than 2048 bytes in UTF-8 encoding.

**Validates: Requirements 2.1, 2.2**

### Property 4: Content Preservation

*For any* input text, the concatenation of all words in the output pages SHALL equal the concatenation of all words in the input text, preserving order.

**Validates: Requirements 1.4**

### Property 5: Code Normalization Consistency

*For any* service code string, normalizing it twice SHALL produce the same result as normalizing it once (idempotence property).

**Validates: Requirements 5.3**

## Error Handling

### Input Validation Errors
- Malformed input to page transformer → Returns descriptive error page
- Invalid service code format → Returns "Invalid service code" message
- Empty text input → Returns empty page with metadata

### Service Errors
- Unknown service code → Returns "Service not found" page with homepage link
- Service unreachable → Returns "Service temporarily unavailable" message
- Service render failure → Returns error page with retry option

### System Errors
- Memory constraints → Graceful degradation with simplified output
- Configuration errors → Fall back to safe defaults
- Network issues → Maintain responsive interface with error indicators

### Error Recovery
- All errors are logged for debugging
- User-facing errors are clear and actionable
- System maintains operation during partial failures
- Automatic retry for transient service failures

## Testing Strategy

### Dual Testing Approach
- **Unit Tests**: Verify specific examples, edge cases, and error conditions
- **Property-Based Tests**: Verify universal properties across all inputs using fast-check

### Test Framework Selection
- **Vitest**: For unit tests and integration tests
- **fast-check**: For property-based testing
- **Hono Testing Utilities**: For HTTP endpoint testing

### Property-Based Test Configuration
- Minimum 100 iterations per property test
- Each property test references its design document property
- Tag format: **Feature: minitel-core, Property {number}: {property_text}**

### Test Coverage Goals
- 100% coverage of core transformation logic
- 95% coverage of service routing logic
- 90% coverage of error handling paths
- Integration tests for all HTTP endpoints

### Performance Testing
- Response time < 500ms for page transformations (95th percentile)
- Service routing < 100ms resolution time
- Memory usage monitoring during load tests
- Concurrent user simulation (50+ users)