# Implementation Plan: Prettier Integration

## Overview

This implementation plan breaks down the prettier integration feature into discrete coding tasks that build incrementally. Each task focuses on a specific component while ensuring integration with Strudel's existing architecture.

## Tasks

- [x] 1. Extend settings system for prettier configuration
  - Add prettier settings to Settings interface in `website/src/settings.ts`
  - Add default prettier settings to defaultSettings
  - Update useSettings hook to handle prettier settings parsing
  - _Requirements: 2.4, 4.4_

- [x] 1.1 Write property test for settings persistence
  - **Property 7: Settings Persistence Round-trip**
  - **Validates: Requirements 2.4, 4.4**

- [x] 2. Create format engine core functionality
  - Create `website/src/repl/formatEngine.ts` with FormatEngine interface
  - Implement formatCode and formatSelection methods
  - Add syntax validation using prettier parser
  - Handle formatting errors gracefully
  - _Requirements: 1.1, 1.2, 1.4_

- [x] 2.1 Write property test for core formatting consistency
  - **Property 1: Core Formatting Consistency**
  - **Validates: Requirements 1.1**

- [x] 2.2 Write property test for error handling preservation
  - **Property 2: Error Handling Preservation**
  - **Validates: Requirements 1.2**

- [x] 2.3 Write property test for language support completeness
  - **Property 4: Language Support Completeness**
  - **Validates: Requirements 1.4**

- [x] 3. Implement CodeMirror prettier extension
  - Create `packages/codemirror/prettierExtension.mjs` 
  - Add format command that integrates with format engine
  - Implement cursor position preservation logic
  - Add keyboard shortcut (Ctrl+Q/Cmd+Q) for manual formatting
  - _Requirements: 3.1, 3.2, 3.3, 1.3_

- [x] 3.1 Write property test for cursor position preservation
  - **Property 3: Cursor Position Preservation**
  - **Validates: Requirements 1.3**

- [x] 3.2 Write property test for keyboard shortcut formatting
  - **Property 8: Keyboard Shortcut Formatting**
  - **Validates: Requirements 3.1, 3.2, 3.3**

- [x] 4. Add prettier settings UI components
  - Extend `website/src/repl/components/panel/SettingsTab.tsx`
  - Add prettier settings section with toggle for enable/disable
  - Add configuration options for tab width, quotes, semicolons, trailing commas
  - Add auto-format on save toggle
  - Include settings preview functionality
  - _Requirements: 4.1, 4.2, 4.5_

- [x] 4.1 Write unit tests for settings UI components
  - Test prettier settings section renders correctly
  - Test all configuration options are present
  - Test preview functionality works
  - _Requirements: 4.1, 4.2, 4.5_

- [x] 5. Implement auto-format on save functionality
  - Modify save logic to check auto-format setting
  - Integrate format engine with save operations
  - Handle formatting errors during save gracefully
  - _Requirements: 2.1, 2.2, 2.3_

- [x] 5.1 Write property test for auto-format conditional behavior
  - **Property 5: Auto-format Conditional Behavior**
  - **Validates: Requirements 2.1, 2.2**

- [x] 5.2 Write property test for save error recovery
  - **Property 6: Save Error Recovery**
  - **Validates: Requirements 2.3**

- [x] 6. Add internationalization support
  - Create prettier translation keys in `website/src/i18n/locales/en/settings.json`
  - Add translations for all prettier settings labels and descriptions
  - Add error message translations
  - Update existing language files with prettier translations
  - _Requirements: 5.1, 5.2, 5.4_

- [x] 6.1 Write property test for internationalization completeness
  - **Property 11: Internationalization Completeness**
  - **Validates: Requirements 5.1, 5.2, 5.3, 5.4**

- [x] 7. Implement visual feedback and error handling
  - Add loading indicators for formatting operations
  - Create non-intrusive error notifications
  - Add success feedback for formatting operations
  - Implement error logging with privacy protection
  - _Requirements: 3.4, 6.1, 6.2, 6.3, 6.4_

- [x] 7.1 Write property test for visual feedback consistency
  - **Property 9: Visual Feedback Consistency**
  - **Validates: Requirements 3.4, 6.2, 6.3**

- [x] 7.2 Write property test for error notification consistency
  - **Property 12: Error Notification Consistency**
  - **Validates: Requirements 6.1**

- [x] 7.3 Write property test for error logging privacy
  - **Property 13: Error Logging Privacy**
  - **Validates: Requirements 6.4**

- [x] 8. Add performance optimizations
  - Implement web worker for large file formatting
  - Add request debouncing for rapid formatting requests
  - Implement prettier configuration caching
  - Add size thresholds for web worker usage
  - _Requirements: 7.2, 7.3, 7.4_

- [x] 8.1 Write property test for web worker usage
  - **Property 14: Web Worker Usage for Large Files**
  - **Validates: Requirements 7.2**

- [x] 8.2 Write property test for request debouncing
  - **Property 15: Request Debouncing**
  - **Validates: Requirements 7.3**

- [x] 8.3 Write property test for configuration caching
  - **Property 16: Configuration Caching**
  - **Validates: Requirements 7.4**

- [x] 9. Integrate with existing CodeMirror setup
  - Update `packages/codemirror/codemirror.mjs` to include prettier extension
  - Ensure prettier extension works with existing keybindings
  - Test integration with different keybinding modes (vim, emacs, vscode)
  - _Requirements: 3.1, 4.3_

- [x] 9.1 Write property test for settings application immediacy
  - **Property 10: Settings Application Immediacy**
  - **Validates: Requirements 4.3**

- [x] 10. Add prettier shortcut to shortcuts documentation
  - Update `website/src/repl/components/panel/ShortcutsTab.tsx`
  - Add Ctrl+Q/Cmd+Q shortcut to editor section
  - Add translations for format shortcut description
  - _Requirements: 3.1_

- [x] 11. Final integration and testing
  - Ensure all components work together seamlessly
  - Test prettier integration with autosave functionality
  - Verify settings persistence across browser sessions
  - Test error handling in various scenarios
  - _Requirements: All_

- [x] 11.1 Write integration tests
  - Test complete prettier workflow from settings to formatting
  - Test interaction with autosave system
  - Test keyboard shortcuts in different editor modes
  - _Requirements: All_

- [x] 12. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- All tasks are required for comprehensive prettier integration
- Each task references specific requirements for traceability
- Property tests validate universal correctness properties using fast-check
- Unit tests validate specific examples and edge cases
- Integration tests ensure components work together properly
- Tests should run minimum 100 iterations per property test