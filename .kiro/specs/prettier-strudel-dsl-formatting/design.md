# Prettier Strudel DSL Formatting Bugfix Design

## Overview

The Prettier integration in Strudel's CodeMirror editor currently uses a custom `formatStrudelCode` method that applies basic formatting while preserving DSL syntax. However, this method does not handle multi-line formatting for `arrange()` and `stack()` functions, which are commonly used for composing multiple patterns together. When these functions contain multiple arguments or exceed the configured print width, they remain as single long lines, making the code difficult to read during live coding sessions.

The fix will enhance the `formatStrudelCode` method in `website/src/repl/formatEngine.ts` to detect `arrange()` and `stack()` function calls and apply multi-line formatting when appropriate, while preserving all existing formatting behavior for other Strudel DSL features.

## Glossary

- **Bug_Condition (C)**: The condition that triggers the bug - when `arrange()` or `stack()` function calls with multiple arguments exceed the print width or contain multiple arguments, but remain formatted as single lines
- **Property (P)**: The desired behavior - `arrange()` and `stack()` functions should be formatted with each argument on a new indented line when they exceed print width or have multiple arguments
- **Preservation**: Existing formatting behavior for all other Strudel DSL features, single-argument cases, and short multi-argument cases that fit within print width
- **formatStrudelCode**: The method in `website/src/repl/formatEngine.ts` that applies Strudel-specific formatting while preserving DSL syntax
- **arrange()**: A Strudel function that arranges multiple pattern arrays in sequence
- **stack()**: A Strudel function (and method) that stacks multiple patterns to play simultaneously
- **Print Width**: The maximum line length before formatting should break lines (default 80 characters, configurable via `prettierPrintWidth`)

## Bug Details

### Fault Condition

The bug manifests when the `formatStrudelCode` method processes code containing `arrange()` or `stack()` function calls with multiple arguments. The method applies basic line-breaking and indentation rules but does not have specific logic to detect and format these composition functions with multi-line argument lists.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type { code: string, options: PrettierOptions }
  OUTPUT: boolean
  
  RETURN (code contains "arrange(" OR code contains "stack(" OR code contains ".stack(")
         AND (functionCallLength > options.printWidth OR argumentCount > 1)
         AND NOT isFormattedMultiLine(functionCall)
END FUNCTION
```

### Examples

- **Example 1**: `arrange([s("bd sd"), s("hh*4")], [s("bass:0 bass:1"), s("pad:2")])` with print width 80
  - Current: Remains on single line (length ~80 characters)
  - Expected: Multi-line format with each array argument on new line

- **Example 2**: `stack(s("bd sd hh"), s("bass:0 bass:1 bass:2"), s("pad:0").slow(2))` with print width 80
  - Current: Remains on single line (length ~70 characters)
  - Expected: Multi-line format with each pattern argument on new line

- **Example 3**: `pattern.stack(s("bd"), s("hh*4"), s("bass:0"))` (chained method call)
  - Current: Remains on single line
  - Expected: Multi-line format with each argument on new line

- **Edge Case**: `arrange([s("bd")])` (single argument)
  - Expected: Remains on single line (no formatting change needed)

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Single-argument `arrange()` or `stack()` calls must continue to format on a single line
- Short multi-argument calls that fit within print width may remain on a single line (configurable behavior)
- All other Strudel DSL functions (`.sound()`, `.note()`, `.gain()`, etc.) must continue to format according to existing rules
- Mini notation patterns (`"bd sd hh"`, `<0 1 2>`, `[a b c]`) must continue to be preserved without modification
- Method chaining on patterns must continue to format according to existing method chaining rules
- String literals with URLs, file paths, or other content must continue to be preserved exactly as written
- Comments (line and block) must continue to be preserved in their original positions
- All non-Strudel JavaScript/TypeScript code must continue to use standard Prettier formatting

**Scope:**
All code that does NOT involve `arrange()` or `stack()` function calls with multiple arguments exceeding print width should be completely unaffected by this fix. This includes:
- Other Strudel DSL functions and methods
- Mini notation patterns
- Standard JavaScript syntax
- Single-argument composition functions
- Short composition functions that fit within print width

## Hypothesized Root Cause

Based on the bug description and code analysis, the root cause is:

1. **Missing Function-Specific Formatting Logic**: The `formatStrudelCode` method applies generic line-breaking rules (after semicolons, closing parentheses, etc.) but does not have specific logic to detect `arrange()` and `stack()` function calls and format their argument lists.

2. **No Argument List Detection**: The current implementation does not parse function call argument lists to determine when multi-line formatting should be applied based on argument count or line length.

3. **Generic Indentation Rules**: The existing indentation logic handles opening/closing brackets and method chaining, but does not handle the specific case of multi-line function arguments where each argument should be on its own line.

4. **No Print Width Consideration**: The `formatStrudelCode` method receives the `options.printWidth` parameter but does not use it to make formatting decisions about when to break lines for long function calls.

## Correctness Properties

Property 1: Fault Condition - Multi-line Formatting for arrange() and stack()

_For any_ code input where `arrange()` or `stack()` function calls contain multiple arguments and either exceed the print width or have more than one argument, the fixed formatStrudelCode function SHALL format the function call with the opening parenthesis on the same line as the function name, each argument on a new indented line, and the closing parenthesis on its own line aligned with the function name.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4**

Property 2: Preservation - Existing Formatting Behavior

_For any_ code input that does NOT contain `arrange()` or `stack()` function calls with multiple arguments exceeding print width, the fixed formatStrudelCode function SHALL produce exactly the same formatted output as the original function, preserving all existing formatting behavior for other Strudel DSL features, single-argument cases, and standard JavaScript syntax.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

**File**: `website/src/repl/formatEngine.ts`

**Method**: `formatStrudelCode`

**Specific Changes**:

1. **Add Function Call Detection**: Before the line-by-line formatting loop, add a preprocessing step that detects `arrange()` and `stack()` function calls using regex patterns:
   - Pattern for standalone functions: `/\b(arrange|stack)\s*\(/g`
   - Pattern for chained methods: `/\.(stack)\s*\(/g`

2. **Implement Argument List Parsing**: For each detected function call, parse the argument list to:
   - Count the number of arguments (by counting commas at the correct nesting level)
   - Calculate the total length of the function call
   - Determine if multi-line formatting is needed based on argument count and print width

3. **Apply Multi-line Formatting**: When multi-line formatting is needed, transform the function call:
   - Keep opening parenthesis on same line as function name
   - Insert newline after opening parenthesis
   - Place each argument on its own line with proper indentation
   - Insert newline before closing parenthesis
   - Place closing parenthesis on its own line

4. **Preserve String Placeholders**: Ensure the existing string placeholder mechanism continues to work correctly during the new preprocessing step to avoid modifying content inside quotes

5. **Integrate with Existing Indentation**: The multi-line formatted function calls should respect the existing indentation level and work correctly with the line-by-line indentation logic that follows

### Implementation Strategy

The fix will be implemented as a new preprocessing step in `formatStrudelCode` that runs after string protection but before the line-by-line formatting loop:

```typescript
// Pseudo-code structure
private formatStrudelCode(code: string, options: PrettierOptions): string {
  // 1. Protect strings (existing)
  let protectedCode = protectStrings(code);
  
  // 2. NEW: Format arrange() and stack() calls
  protectedCode = formatCompositionFunctions(protectedCode, options);
  
  // 3. Apply line break preprocessing (existing)
  let preprocessedCode = applyLineBreaks(protectedCode);
  
  // 4. Restore strings (existing)
  preprocessedCode = restoreStrings(preprocessedCode);
  
  // 5. Line-by-line formatting (existing)
  return formatLines(preprocessedCode, options);
}
```

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code, then verify the fix works correctly and preserves existing behavior.

### Exploratory Fault Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm or refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: Write tests that format code containing `arrange()` and `stack()` calls with multiple arguments using the UNFIXED `formatStrudelCode` method. Assert that the output should be multi-line formatted. Run these tests on the UNFIXED code to observe failures and confirm the bug.

**Test Cases**:
1. **Long arrange() Test**: Format `arrange([s("bd sd"), s("hh*4")], [s("bass:0 bass:1"), s("pad:2")])` with print width 80 (will fail on unfixed code - remains single line)
2. **Multiple stack() Arguments Test**: Format `stack(s("bd sd hh"), s("bass:0 bass:1 bass:2"), s("pad:0").slow(2))` with print width 80 (will fail on unfixed code - remains single line)
3. **Chained stack() Method Test**: Format `pattern.stack(s("bd"), s("hh*4"), s("bass:0"))` (will fail on unfixed code - remains single line)
4. **Short arrange() Test**: Format `arrange([s("bd")])` (may pass on unfixed code - should remain single line)

**Expected Counterexamples**:
- Function calls with multiple arguments remain on single lines instead of being formatted multi-line
- Possible causes: missing function-specific formatting logic, no argument list detection, no print width consideration

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := formatStrudelCode_fixed(input.code, input.options)
  ASSERT isMultiLineFormatted(result, "arrange") OR isMultiLineFormatted(result, "stack")
  ASSERT eachArgumentOnNewLine(result)
  ASSERT closingParenthesisOnOwnLine(result)
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT formatStrudelCode_original(input.code, input.options) = formatStrudelCode_fixed(input.code, input.options)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain
- It catches edge cases that manual unit tests might miss
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs

**Test Plan**: Observe behavior on UNFIXED code first for various Strudel patterns and JavaScript code, then write property-based tests capturing that behavior.

**Test Cases**:
1. **Single Argument Preservation**: Observe that `arrange([s("bd")])` formats correctly on unfixed code, then verify this continues after fix
2. **Other DSL Functions Preservation**: Observe that `.sound().gain().lpf()` method chains format correctly on unfixed code, then verify this continues after fix
3. **Mini Notation Preservation**: Observe that `"bd sd hh"` and `<0 1 2>` patterns are preserved on unfixed code, then verify this continues after fix
4. **Standard JavaScript Preservation**: Observe that standard JavaScript (functions, variables, loops) formats correctly on unfixed code, then verify this continues after fix

### Unit Tests

- Test `arrange()` with 2 arguments exceeding print width
- Test `arrange()` with 3+ arguments
- Test `stack()` with 2 arguments exceeding print width
- Test `stack()` with 3+ arguments
- Test chained `.stack()` method with multiple arguments
- Test `arrange()` with single argument (should remain single line)
- Test `stack()` with single argument (should remain single line)
- Test short `arrange()` with multiple arguments within print width (configurable behavior)
- Test nested `arrange()` and `stack()` calls
- Test `arrange()` and `stack()` with complex pattern expressions as arguments
- Test edge cases: empty arguments, trailing commas, comments within arguments

### Property-Based Tests

- Generate random Strudel code with various `arrange()` and `stack()` patterns and verify multi-line formatting is applied when conditions are met
- Generate random Strudel code without `arrange()` or `stack()` and verify formatting is unchanged from original implementation
- Generate random combinations of `arrange()`, `stack()`, and other DSL functions to verify they work correctly together
- Generate random print width values and verify formatting adapts correctly

### Integration Tests

- Test full Strudel code examples from documentation with `arrange()` and `stack()` functions
- Test live coding scenarios where users type long `arrange()` calls and trigger formatting
- Test that formatted code can be successfully evaluated by the Strudel engine
- Test that cursor position is preserved correctly after formatting `arrange()` and `stack()` calls
- Test formatting performance with large files containing many `arrange()` and `stack()` calls
