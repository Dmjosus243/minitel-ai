# Implementation Plan: Minitel AI Core Engines

## Overview

The Minitel AI Core Engine transforms text content into 40-column by 24-line page format with automatic line wrapping, pagination, service routing, and a homepage with numbered menus. The implementation will be in TypeScript with Hono for the web server, using property-based testing with fast-check.

## Tasks

- [x] 1. Set up project structure and configuration
  - Configure TypeScript (strict mode), Vitest, and npm scripts
  - Create directory structure (src/core, src/services, src/server)
  - Install dependencies (Hono, fast-check, Vitest)
  - Create configuration files (tsconfig.json, package.json scripts)
  - _Requirements: 8.1_

- [x] 2. Implement core types and interfaces
  - [x] 2.1 Create Page interface in src/core/types.ts
    - Define Page type with content, pageNumber, totalPages, etc.
    - _Requirements: 1.1-1.4_
  
  - [x] 2.2 Create Service interface in src/core/types.ts
    - Define Service type with code, title, description, render function
    - _Requirements: 5.1_
  
  - [x] 2.3 Create configuration interfaces
    - Define PageConfig for dimensions and size limits
    - _Requirements: 8.1_

- [ ] 3. Implement page transformer with size constraints
  - [x] 3.1 Implement formatText function in src/core/formatter.ts
    - Break text into 40-character lines with word wrapping
    - Handle paragraphs and special characters
    - _Requirements: 1.1, 1.2, 1.4, 1.5_
  
  - [x] 3.2 Implement pagination logic
    - Split content into 24-line pages
    - Add pagination metadata (page X of Y)
    - _Requirements: 1.3_
  
  - [x] 3.3 Implement pageWeight function
    - Calculate UTF-8 byte size of pages
    - Ensure each page < 2048 bytes
    - _Requirements: 2.1, 2.2, 2.3_
  
  - [ ]* 3.4 Write property tests for page transformer
    - **Property 1: Line length constraint**
    - **Property 2: Page line count constraint**
    - **Property 3: Page size constraint**
    - **Validates: Requirements 1.1-1.3, 2.1-2.3**
    - Use fast-check to generate random text inputs
  
  - [ ]* 3.5 Write unit tests for edge cases
    - Test empty input, very long words, special characters
    - Test boundary conditions (exactly 40 chars, exactly 24 lines)
    - _Requirements: 1.5, 2.4_

- [ ] 4. Implement service router with validation
  - [ ] 4.1 Create service registry in src/core/router.ts
    - Implement registerService and getService methods
    - Support dynamic registration without restart
    - _Requirements: 3.2, 8.2_
  
  - [ ] 4.2 Implement service code validation
    - Validate format "NNNN WORD" (4-digit number + uppercase descriptor)
    - Normalize to uppercase, trim whitespace
    - Reject invalid characters and duplicates
    - _Requirements: 5.1, 5.2, 5.3, 5.4_
  
  - [ ] 4.3 Implement route function
    - Map service codes to service endpoints
    - Handle unknown codes with "Service not found" message
    - _Requirements: 3.1, 3.3_
  
  - [ ]* 4.4 Write property tests for service router
    - **Property 4: Code normalization consistency**
    - **Validates: Requirements 5.1, 5.3**
  
  - [ ]* 4.5 Write unit tests for router
    - Test valid/invalid codes, duplicate registration
    - Test error cases and edge conditions
    - _Requirements: 5.2, 5.4_

- [ ] 5. Implement homepage generator
  - [ ] 5.1 Create Homepage_Generator in src/services/home.ts
    - Generate numbered menu from registered services
    - Include service descriptions when available
    - Update automatically when services change
    - _Requirements: 4.1, 4.2, 4.3, 4.4_
  
  - [ ] 5.2 Implement menu customization
    - Allow configuration of layout and styling
    - Support different menu formats
    - _Requirements: 8.3_
  
  - [ ]* 5.3 Write tests for homepage generator
    - Test menu generation with varying numbers of services
    - Test description inclusion and formatting
    - _Requirements: 4.1-4.4_

- [ ] 6. Checkpoint - Core functionality validation
  - Ensure all core components work together
  - Run existing tests and fix any issues
  - Ask the user if questions arise

- [ ] 7. Implement error handling and resilience
  - [ ] 7.1 Add error handling to page transformer
    - Handle malformed input with descriptive errors
    - _Requirements: 6.1_
  
  - [ ] 7.2 Add error handling to service router
    - Handle unreachable services with "Service temporarily unavailable"
    - Log errors for debugging
    - _Requirements: 3.4, 6.2_
  
  - [ ] 7.3 Implement graceful degradation
    - Maintain responsive interface during errors
    - Handle resource constraints gracefully
    - _Requirements: 6.3, 6.4_
  
  - [ ]* 7.4 Write error handling tests
    - Test error messages and system resilience
    - _Requirements: 6.1-6.4_

- [ ] 8. Implement web server and API
  - [ ] 8.1 Create Hono server in src/server.ts
    - Set up routes for service codes and homepage
    - _Requirements: 3.1, 4.2_
  
  - [ ] 8.2 Implement performance optimizations
    - Add response time monitoring
    - Implement caching for transformed pages
    - _Requirements: 7.1, 7.2, 7.3, 7.4_
  
  - [ ] 8.3 Add configuration system
    - Load page dimensions and size limits from config
    - Support runtime configuration updates
    - _Requirements: 8.1, 8.4_
  
  - [ ]* 8.4 Write integration tests
    - Test end-to-end HTTP requests
    - Test performance under simulated load
    - _Requirements: 7.1-7.4_

- [ ] 9. Final checkpoint - System integration
  - Ensure all components work together seamlessly
  - Run full test suite (unit, property, integration)
  - Verify all requirements are met
  - Ask the user if questions arise

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Property tests validate universal correctness properties from the design
- Unit tests validate specific examples and edge cases
- Checkpoints ensure incremental validation
- The system should maintain <500ms response time for page transformations
- Page size must stay under 2048 bytes per page
- Service codes must follow "NNNN WORD" format

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "2.2", "2.3"] },
    { "id": 1, "tasks": ["3.1", "3.2", "4.1"] },
    { "id": 2, "tasks": ["3.3", "4.2", "5.1"] },
    { "id": 3, "tasks": ["3.4", "3.5", "4.3", "4.4", "4.5", "5.2", "5.3"] },
    { "id": 4, "tasks": ["6.1", "7.1", "7.2"] },
    { "id": 5, "tasks": ["7.3", "8.1"] },
    { "id": 6, "tasks": ["7.4", "8.2", "8.3"] },
    { "id": 7, "tasks": ["8.4"] }
  ]
}
```
