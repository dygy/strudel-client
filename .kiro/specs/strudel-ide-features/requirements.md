# Requirements Document - Strudel IDE Features

## Introduction

This feature adds IDE-like capabilities to the Strudel CodeMirror editor, including syntax validation, error highlighting, intelligent autocomplete, and contextual method suggestions. The goal is to provide developers with real-time feedback and assistance while writing Strudel code.

## Glossary

- **Parser**: A component that analyzes Strudel code structure and builds an Abstract Syntax Tree (AST)
- **Linter**: A tool that checks code for errors and potential issues
- **Autocomplete**: Intelligent code completion suggestions based on context
- **Type Inference**: Determining the type of expressions to provide relevant suggestions
- **Diagnostics**: Error and warning messages displayed in the editor
- **Language Server**: A service that provides language intelligence features

## Requirements

### Requirement 1

**User Story:** As a Strudel user, I want to see syntax errors highlighted in real-time, so that I can fix mistakes before running the code.

#### Acceptance Criteria

1. WHEN the user types invalid Strudel syntax, THE editor SHALL highlight the error with a red underline
2. WHEN the user hovers over an error, THE editor SHALL display a tooltip with the error message
3. THE error detection SHALL run in real-time as the user types (with debouncing)
4. THE editor SHALL detect common errors such as:
   - Unclosed parentheses, brackets, or quotes
   - Invalid function names
   - Incorrect number of arguments
   - Invalid mini-notation syntax
5. THE error highlighting SHALL not interfere with code execution

### Requirement 2

**User Story:** As a Strudel user, I want autocomplete suggestions for available methods, so that I can discover and use functions more easily.

#### Acceptance Criteria

1. WHEN the user types a dot (.) after a pattern, THE editor SHALL show available pattern methods
2. WHEN the user types a function name, THE editor SHALL show matching function suggestions
3. THE autocomplete SHALL show:
   - Function name
   - Brief description
   - Parameter hints
4. THE autocomplete SHALL filter suggestions based on what the user has typed
5. THE user SHALL be able to navigate suggestions with arrow keys and select with Enter/Tab

### Requirement 3

**User Story:** As a Strudel user, I want context-aware method suggestions, so that I only see relevant methods for the current expression type.

#### Acceptance Criteria

1. WHEN the user types after a pattern expression, THE editor SHALL suggest pattern methods
2. WHEN the user types after a sound function, THE editor SHALL suggest sound-specific methods
3. WHEN the user types after a note function, THE editor SHALL suggest note-specific methods
4. THE editor SHALL use type inference to determine the expression type
5. THE suggestions SHALL be filtered based on the inferred type

### Requirement 4

**User Story:** As a Strudel user, I want to see function signatures and documentation on hover, so that I can understand how to use functions without leaving the editor.

#### Acceptance Criteria

1. WHEN the user hovers over a function name, THE editor SHALL display a tooltip with:
   - Function signature
   - Parameter descriptions
   - Return type
   - Usage examples (if available)
2. THE tooltip SHALL appear after a short delay (300ms)
3. THE tooltip SHALL disappear when the user moves the cursor away
4. THE tooltip SHALL be styled consistently with the editor theme
5. THE tooltip SHALL support markdown formatting for documentation

### Requirement 5

**User Story:** As a Strudel user, I want parameter hints while typing function calls, so that I know what arguments to provide.

#### Acceptance Criteria

1. WHEN the user types an opening parenthesis after a function name, THE editor SHALL show parameter hints
2. THE parameter hints SHALL highlight the current parameter being typed
3. THE parameter hints SHALL show:
   - Parameter names
   - Parameter types
   - Optional vs required parameters
4. THE parameter hints SHALL update as the user types commas
5. THE parameter hints SHALL disappear when the function call is complete

### Requirement 6

**User Story:** As a Strudel user, I want mini-notation syntax validation, so that I can catch errors in pattern strings.

#### Acceptance Criteria

1. WHEN the user types a mini-notation string, THE editor SHALL validate the syntax
2. THE editor SHALL highlight errors in mini-notation such as:
   - Unmatched brackets
   - Invalid operators
   - Malformed patterns
3. THE error highlighting SHALL work inside string literals
4. THE editor SHALL provide helpful error messages for mini-notation errors
5. THE validation SHALL not break existing mini-notation highlighting

### Requirement 7

**User Story:** As a Strudel user, I want to see warnings for potential issues, so that I can write better code.

#### Acceptance Criteria

1. THE editor SHALL show warnings (yellow underline) for potential issues such as:
   - Unused variables
   - Deprecated functions
   - Performance concerns (e.g., very complex patterns)
2. THE warnings SHALL not prevent code execution
3. THE user SHALL be able to hover over warnings to see details
4. THE warnings SHALL be distinguishable from errors (different color/style)
5. THE user SHALL be able to configure which warnings to show

## Technical Considerations

### Parser Implementation

- Use existing JavaScript parser (acorn) for JavaScript syntax
- Extend with Strudel-specific syntax understanding
- Parse mini-notation strings separately
- Build AST for type inference

### Performance

- Debounce parsing to avoid performance issues
- Use web workers for heavy parsing if needed
- Cache parse results when possible
- Limit autocomplete suggestions to reasonable number

### Integration

- Integrate with existing CodeMirror setup
- Use CodeMirror's diagnostic system
- Leverage existing autocomplete infrastructure
- Maintain compatibility with current features

### Data Sources

- Extract function signatures from @strudel/core
- Use JSDoc comments for documentation
- Maintain separate documentation database
- Support user-defined functions

## Future Enhancements

- Jump to definition
- Find all references
- Rename refactoring
- Code formatting
- Snippet support
- Multi-file support
- Import suggestions
