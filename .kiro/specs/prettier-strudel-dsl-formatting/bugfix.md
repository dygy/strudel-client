# Bugfix Requirements Document

## Introduction

The Prettier integration in Strudel's CodeMirror editor is not properly formatting code that uses `arrange()` and `stack()` functions according to Strudel's DSL conventions. These functions, which are commonly used for composing multiple patterns together, should have their arguments formatted with each argument on a new line when the code becomes long or complex. Currently, the formatter leaves these functions as single long lines, making the code difficult to read and maintain during live coding sessions.

This bug affects code readability and the live coding experience, as users expect the formatter to apply consistent DSL-aware formatting rules to pattern composition functions.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN code contains `arrange()` with multiple array arguments on a single line THEN the system leaves the code as a single long line without breaking arguments onto separate lines

1.2 WHEN code contains `stack()` with multiple pattern arguments on a single line THEN the system leaves the code as a single long line without breaking arguments onto separate lines

1.3 WHEN code contains chained `.stack()` method calls with multiple arguments on a single line THEN the system leaves the code as a single long line without breaking arguments onto separate lines

1.4 WHEN the `arrange()` or `stack()` function call exceeds a reasonable line length (e.g., 80 characters) THEN the system does not automatically format it into a multi-line structure

### Expected Behavior (Correct)

2.1 WHEN code contains `arrange()` with multiple array arguments on a single line THEN the system SHALL format it with the opening parenthesis on the same line as the function name, each argument on a new indented line, and the closing parenthesis on its own line

2.2 WHEN code contains `stack()` with multiple pattern arguments on a single line THEN the system SHALL format it with the opening parenthesis on the same line as the function name, each argument on a new indented line, and the closing parenthesis on its own line

2.3 WHEN code contains chained `.stack()` method calls with multiple arguments on a single line THEN the system SHALL format it with the opening parenthesis on the same line as the method name, each argument on a new indented line, and the closing parenthesis on its own line aligned with the method

2.4 WHEN the `arrange()` or `stack()` function call exceeds the configured print width (default 80 characters) THEN the system SHALL automatically apply multi-line formatting

### Unchanged Behavior (Regression Prevention)

3.1 WHEN code contains `arrange()` or `stack()` with a single argument THEN the system SHALL CONTINUE TO format it on a single line

3.2 WHEN code contains `arrange()` or `stack()` with multiple short arguments that fit within the print width THEN the system SHALL CONTINUE TO allow single-line formatting

3.3 WHEN code contains other Strudel DSL functions not related to `arrange()` or `stack()` THEN the system SHALL CONTINUE TO format them according to existing Strudel formatting rules

3.4 WHEN code contains standard JavaScript/TypeScript without Strudel DSL syntax THEN the system SHALL CONTINUE TO use standard Prettier formatting

3.5 WHEN code contains mini notation patterns (e.g., `"bd sd hh"`, `<0 1 2>`, `[a b c]`) THEN the system SHALL CONTINUE TO preserve them without modification

3.6 WHEN code contains method chaining on patterns (e.g., `.sound().gain().lpf()`) THEN the system SHALL CONTINUE TO format them according to existing method chaining rules

3.7 WHEN code contains string literals with URLs, file paths, or other sensitive content THEN the system SHALL CONTINUE TO preserve them exactly as written
