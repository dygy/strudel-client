# Implementation Plan: Enhanced Strudel Autocomplete

## Overview

This implementation plan breaks down the enhanced autocomplete feature into discrete, incremental tasks. The approach follows a bottom-up strategy: building core parsing and matching components first, then integrating them into the autocomplete system, and finally adding comprehensive testing.

## Tasks

- [x] 1. Set up testing infrastructure and utilities
  - Create test file structure in `packages/codemirror/test/`
  - Set up fast-check for property-based testing
  - Create test fixtures with sample soundMap data
  - Add test utilities for creating CodeMirror contexts
  - _Requirements: 8.1, 8.2, 9.1_

- [x] 2. Implement Case-Insensitive Sample Matcher
  - [x] 2.1 Create `CaseInsensitiveSampleMatcher` class in new file `packages/codemirror/sampleMatcher.mjs`
    - Implement `match(samples, fragment, maxResults)` method
    - Implement `calculateScore(sample, fragment)` method with scoring algorithm
    - Support exact match, prefix match, and substring match detection
    - Sort results by score descending
    - Limit results to maxResults parameter
    - _Requirements: 1.1, 1.2, 1.5, 8.4, 8.5_
  
  - [ ]* 2.2 Write property test for case-insensitive matching
    - **Property 1: Case-Insensitive Substring Matching**
    - **Validates: Requirements 1.1, 1.2, 1.5**
  
  - [ ]* 2.3 Write unit tests for sample matcher
    - Test exact matches
    - Test prefix matches with various cases
    - Test substring matches
    - Test capitalization preservation
    - Test result limiting to 100 items
    - Test score-based ranking
    - _Requirements: 1.1, 1.2, 1.5, 8.4, 8.5_

- [x] 3. Implement Mini-Notation Context Parser
  - [x] 3.1 Create `MiniNotationContextParser` class in new file `packages/codemirror/miniNotationParser.mjs`
    - Implement `parseContext(stringContent, cursorOffset)` method
    - Implement `findSeparators(content)` method
    - Implement `analyzeColonContext(content, position)` method
    - Handle pattern separators: space, comma, brackets, angle brackets
    - Track nesting depth for brackets and braces
    - Recognize special characters: ~, -, @, :
    - _Requirements: 2.5, 5.1, 5.2, 5.3, 5.4, 5.5, 5.7, 10.1, 10.2, 10.4, 10.5_
  
  - [ ]* 3.2 Write property test for pattern separator recognition
    - **Property 3: Pattern Separator Recognition**
    - **Validates: Requirements 2.5, 5.1, 5.2, 5.4, 5.5**
  
  - [ ]* 3.3 Write property test for colon syntax continuation
    - **Property 4: Colon Syntax Continuation**
    - **Validates: Requirements 2.2, 5.3**
  
  - [ ]* 3.4 Write property test for nested pattern parsing
    - **Property 10: Nested Pattern Parsing**
    - **Validates: Requirements 10.1, 10.2, 10.4, 10.5**
  
  - [ ]* 3.5 Write unit tests for mini-notation parser
    - Test simple patterns: "bd hh cp"
    - Test colon syntax: "bd:0:0.5"
    - Test nested brackets: "[bd [hh hh]]"
    - Test angle brackets: "<bd hh>"
    - Test polymeter: "{bd hh, cp sd}"
    - Test euclidean: "bd(3,8)"
    - Test weight syntax: "bd@3 hh@1"
    - Test special characters: "~ -"
    - Test malformed patterns (error handling)
    - _Requirements: 2.5, 5.1, 5.2, 5.3, 5.4, 5.5, 5.7, 10.1, 10.2, 10.3, 10.4, 10.5_

- [x] 4. Checkpoint - Ensure core parsing tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement Pattern Position Detector
  - [x] 5.1 Create `PatternPositionDetector` class in new file `packages/codemirror/positionDetector.mjs`
    - Implement `detectPositionType(content, position)` method
    - Implement `getCurrentElement(content, position)` method
    - Implement `isAfterSeparator(content, position)` method
    - Detect position types: sample_name, sample_number, gain, euclidean_param, weight
    - Handle nested structures correctly
    - _Requirements: 5.6, 10.3_
  
  - [ ]* 5.2 Write property test for euclidean rhythm context exclusion
    - **Property 6: Euclidean Rhythm Context Exclusion**
    - **Validates: Requirements 5.6, 10.3**
  
  - [ ]* 5.3 Write unit tests for position detector
    - Test detection of sample_name positions
    - Test detection of sample_number positions (after first colon)
    - Test detection of gain positions (after second colon)
    - Test detection of euclidean_param positions (inside parentheses)
    - Test detection of weight positions (after @)
    - Test isAfterSeparator for various separators
    - _Requirements: 5.6, 10.3_

- [ ] 6. Implement String Context Analyzer
  - [ ] 6.1 Create `StringContextAnalyzer` class in new file `packages/codemirror/stringContextAnalyzer.mjs`
    - Implement `analyzeContext(context)` method
    - Implement `detectMethodContext(text, methodNames)` method
    - Detect .s(), .sound(), .bank() method calls
    - Support all three quote types: single, double, backtick
    - Extract string content and cursor offset
    - Handle template strings with embedded expressions
    - _Requirements: 2.1, 3.1, 4.1, 4.5_
  
  - [ ]* 6.2 Write property test for method context detection
    - **Property 2: Method Context Detection**
    - **Validates: Requirements 2.1, 3.1, 4.1, 4.5**
  
  - [ ]* 6.3 Write unit tests for string context analyzer
    - Test .s() with double quotes
    - Test .sound() with single quotes
    - Test .bank() with backticks
    - Test template strings with angle brackets
    - Test nested method calls
    - Test non-string contexts (should return null)
    - Test escaped quotes
    - _Requirements: 2.1, 3.1, 4.1, 4.5_

- [ ] 7. Implement Sound Map Integration
  - [ ] 7.1 Create `SoundMapIntegration` class in new file `packages/codemirror/soundMapIntegration.mjs`
    - Implement `getAllSamples()` method
    - Implement `getAllBanks()` method
    - Implement `subscribe(callback)` method for reactive updates
    - Extract bank names from sample keys (prefix before underscore)
    - Cache sample and bank lists
    - Invalidate cache on soundMap updates
    - _Requirements: 3.5, 7.1, 7.2, 7.6_
  
  - [ ]* 7.2 Write property test for bank extraction
    - **Property 5: Bank Extraction from Sound Map**
    - **Validates: Requirements 3.5**
  
  - [ ]* 7.3 Write property test for dynamic sample source integration
    - **Property 8: Dynamic Sample Source Integration**
    - **Validates: Requirements 7.6**
  
  - [ ]* 7.4 Write unit tests for sound map integration
    - Test getAllSamples returns all soundMap keys
    - Test getAllBanks extracts unique prefixes
    - Test bank extraction with various naming patterns
    - Test cache invalidation on updates
    - Test subscribe callback is called on updates
    - _Requirements: 3.5, 7.1, 7.2, 7.6_

- [ ] 8. Checkpoint - Ensure all component tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 9. Implement Enhanced Sound Handler
  - [ ] 9.1 Create `enhancedSoundHandler` function in `packages/codemirror/autocomplete.mjs`
    - Use StringContextAnalyzer to detect .s() and .sound() contexts
    - Use MiniNotationContextParser to parse string interior
    - Use PatternPositionDetector to identify completion position
    - Use CaseInsensitiveSampleMatcher to filter samples
    - Return completions only for sample_name positions
    - Support all quote types and template strings
    - Handle colon syntax correctly
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 6.1, 6.2, 6.3_
  
  - [ ]* 9.2 Write integration tests for enhanced sound handler
    - Test with CodeMirror context for .s("bd ")
    - Test with colon syntax .s("pulse:1200,gm_")
    - Test with template strings .s(\`<bd hh \`)
    - Test with nested patterns .s("[bd [hh hh]]")
    - Test automatic activation on typing
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

- [ ] 10. Implement Enhanced Bank Handler
  - [ ] 10.1 Create `enhancedBankHandler` function in `packages/codemirror/autocomplete.mjs`
    - Use StringContextAnalyzer to detect .bank() contexts
    - Use MiniNotationContextParser to parse string interior
    - Use SoundMapIntegration to get bank list
    - Use CaseInsensitiveSampleMatcher to filter banks
    - Support template string patterns with angle brackets
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_
  
  - [ ]* 10.2 Write integration tests for enhanced bank handler
    - Test with .bank("roland")
    - Test with template strings .bank(\`<Emu\`)
    - Test with multiple banks .bank('<EmuSP12 Alesis')
    - Test case-insensitive matching
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [ ] 11. Integrate enhanced handlers into handler chain
  - [ ] 11.1 Update handler chain in `packages/codemirror/autocomplete.mjs`
    - Replace existing soundHandler with enhancedSoundHandler
    - Replace existing bankHandler with enhancedBankHandler
    - Ensure handlers are positioned correctly in chain (before fallback)
    - Maintain backward compatibility with existing handlers
    - _Requirements: 9.1, 9.2_
  
  - [ ]* 11.2 Write regression tests for existing functionality
    - Test function completions still work
    - Test method completions still work
    - Test scale completions still work
    - Test chord completions still work
    - Test mode completions still work
    - _Requirements: 9.1_

- [ ] 12. Implement special character recognition
  - [ ] 12.1 Update MiniNotationContextParser to handle special characters
    - Recognize ~ (silence) as complete element
    - Recognize - (rest) as complete element
    - Don't provide completions for these characters
    - _Requirements: 5.7_
  
  - [ ]* 12.2 Write property test for special character recognition
    - **Property 7: Special Character Recognition**
    - **Validates: Requirements 5.7**

- [ ] 13. Implement performance optimizations
  - [ ] 13.1 Add performance optimizations to all components
    - Cache compiled regex patterns as module constants
    - Implement early termination in sample matcher (stop at 100 results)
    - Add memoization for parser results
    - Optimize string operations (avoid repeated allocations)
    - _Requirements: 8.1, 8.2, 8.3_
  
  - [ ]* 13.2 Write property test for performance and result limiting
    - **Property 9: Performance and Result Limiting**
    - **Validates: Requirements 8.1, 8.2, 8.4, 8.5**
  
  - [ ]* 13.3 Write performance benchmark tests
    - Benchmark with 1000 samples
    - Benchmark with 5000 samples
    - Benchmark with 10000 samples
    - Verify all complete within 50ms
    - _Requirements: 8.1, 8.2_

- [ ] 14. Checkpoint - Ensure all integration tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 15. Add error handling and edge cases
  - [ ] 15.1 Implement error handling in all components
    - Handle malformed patterns gracefully in parser
    - Handle empty soundMap in integration
    - Handle invalid quote nesting in analyzer
    - Handle extremely long strings (limit parsing region)
    - Handle cursor at quote boundaries
    - Handle multiple colons in colon syntax
    - Handle escaped characters
    - Handle template string expressions
    - Handle whitespace variations
    - _Requirements: All error handling requirements_
  
  - [ ]* 15.2 Write unit tests for error handling
    - Test malformed pattern handling
    - Test empty soundMap handling
    - Test invalid quote nesting
    - Test extremely long strings
    - Test cursor at boundaries
    - Test multiple colons
    - Test escaped quotes
    - Test template expressions
    - Test whitespace variations

- [ ] 16. Update documentation and examples
  - [ ] 16.1 Add JSDoc comments to all new classes and functions
    - Document all public methods
    - Add usage examples in comments
    - Document parameters and return types
    - _Requirements: Documentation_
  
  - [ ] 16.2 Update README.md in packages/codemirror
    - Document new autocomplete features
    - Add examples of mini-notation autocomplete
    - Explain case-insensitive matching
    - Show template string support

- [ ] 17. Final checkpoint - Complete testing and validation
  - Run all unit tests
  - Run all property-based tests
  - Run all integration tests
  - Run performance benchmarks
  - Test manually in Strudel REPL
  - Verify backward compatibility
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test-related sub-tasks and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties (minimum 100 iterations each)
- Unit tests validate specific examples and edge cases
- Integration tests validate end-to-end workflows
- The implementation follows a bottom-up approach: core components first, then integration
- All new code should be in `packages/codemirror/` directory
- Use `.mjs` extension for ES modules
- Follow existing code style and conventions in the codemirror package
