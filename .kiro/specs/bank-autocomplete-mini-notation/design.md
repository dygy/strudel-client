# Bank Autocomplete Mini-notation Bugfix Design

## Overview

This bugfix addresses two critical issues in the bank autocomplete feature: (1) failure to detect mini-notation context inside `.bank()` strings, and (2) case-sensitive filtering that causes mismatches with lowercase sound file names. The fix will enhance the `bankHandler` function to parse mini-notation syntax and use case-insensitive matching with lowercase suggestions.

## Glossary

- **Bug_Condition (C)**: The condition that triggers the bug - when autocomplete fails inside mini-notation or uses case-sensitive matching
- **Property (P)**: The desired behavior - autocomplete should work inside mini-notation with case-insensitive filtering and lowercase suggestions
- **Preservation**: Existing direct `.bank("` autocomplete behavior that must remain unchanged
- **bankHandler**: The function in `packages/codemirror/autocomplete.mjs` that provides bank name completions
- **Mini-notation**: Strudel's pattern syntax using brackets `[...]`, angle brackets `<...>`, and braces `{...}` for sequencing and alternation
- **MiniNotationContextParser**: Existing parser class in `packages/codemirror/miniNotationParser.mjs` that analyzes pattern context

## Bug Details

### Bug Condition

The bug manifests when a user types inside mini-notation syntax within a `.bank()` call, or when typing bank names with different casing than the suggestions. The `bankHandler` function uses a simple regex pattern that only matches the direct `.bank("` context and fails to detect when the cursor is inside mini-notation structures like `<...>`, `[...]`, or `{...}`. Additionally, the filter uses case-sensitive `startsWith` matching.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type AutocompleteContext
  OUTPUT: boolean
  
  LET textBeforeCursor = input.state.doc.sliceString(0, input.pos)
  LET insideBankCall = textBeforeCursor.contains('.bank("') OR textBeforeCursor.contains(".bank('")
  LET insideMiniNotation = cursorIsInsideBrackets(textBeforeCursor, ['<', '>', '[', ']', '{', '}'])
  LET hasTypedFragment = fragmentAtCursor(textBeforeCursor).length > 0
  LET fragmentCaseDiffers = fragmentAtCursor(textBeforeCursor).toLowerCase() != fragmentAtCursor(textBeforeCursor)
  
  RETURN (insideBankCall AND insideMiniNotation AND NOT autocompleteSuggestionsShown)
         OR (insideBankCall AND hasTypedFragment AND fragmentCaseDiffers AND NOT matchingBanksShown)
END FUNCTION
```

### Examples

- **Mini-notation bug**: User types `s("bd sd").bank("<Roland")` with cursor after `<Roland` - no suggestions appear (expected: show banks starting with "roland")
- **Case sensitivity bug**: User types `s("bd").bank("roland")` - no suggestions appear because banks are stored as "RolandTR909" (expected: show "rolandtr909" suggestion)
- **Nested mini-notation**: User types `s("bd").bank("[casio <yamaha]")` with cursor after `<yamaha` - no suggestions appear (expected: show banks starting with "yamaha")
- **Edge case**: User types `s("bd").bank("RolandTR909")` - suggestion shows "RolandTR909" but should show "rolandtr909" to match actual file names

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Direct `.bank("` autocomplete must continue to work exactly as before
- Autocomplete outside of `.bank()` calls must remain unchanged
- Other autocomplete handlers (sound, chord, scale, mode) must function independently
- The filtering logic for matching bank names must preserve the same matching semantics (prefix matching)

**Scope:**
All inputs that do NOT involve typing inside `.bank()` strings should be completely unaffected by this fix. This includes:
- Autocomplete in `.sound()`, `.chord()`, `.scale()`, `.mode()` calls
- Method chaining autocomplete (after `.`)
- Global function autocomplete
- Autocomplete outside of any function call context

## Hypothesized Root Cause

Based on the bug description and code analysis, the most likely issues are:

1. **Insufficient Context Detection**: The `BANK_WITH_QUOTES_REGEX` pattern (`/bank\(\s*['"][^'"]*$/`) only matches text that starts with `bank(` and doesn't account for mini-notation brackets between the opening quote and the cursor position. When the cursor is inside `<...>` or `[...]`, the regex fails to match because the pattern `[^'"]*` doesn't allow for the full context.

2. **No Mini-notation Parsing**: The `bankHandler` doesn't use the existing `MiniNotationContextParser` class to analyze the string content and determine if the cursor is inside a valid completion context within mini-notation structures.

3. **Case-sensitive Filtering**: The filter uses `b.label.startsWith(fragment)` which is case-sensitive, causing mismatches when users type lowercase but banks are stored with capital letters.

4. **Incorrect Suggestion Casing**: The `bankCompletions()` function returns bank names with their original casing from the `soundMap`, but the actual sound files use lowercase names, creating a mismatch between suggestions and runtime behavior.

## Correctness Properties

Property 1: Bug Condition - Mini-notation Context Detection

_For any_ keyboard input where the cursor is positioned inside a `.bank()` string that contains mini-notation syntax (brackets, angle brackets, or braces), the fixed bankHandler function SHALL detect the context and provide bank autocomplete suggestions using case-insensitive filtering with lowercase bank names.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4**

Property 2: Preservation - Direct Bank Call Behavior

_For any_ input where the cursor is positioned directly after `.bank("` without any mini-notation syntax, the fixed bankHandler function SHALL produce the same autocomplete behavior as the original function, preserving the existing direct completion functionality.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

**File**: `packages/codemirror/autocomplete.mjs`

**Function**: `bankHandler`

**Specific Changes**:

1. **Enhanced Context Detection**: Modify the regex matching to detect `.bank()` calls more broadly, then use string parsing to determine if we're inside the string quotes
   - Change from simple regex to a two-phase approach: detect `.bank(` in the text before cursor, then parse the string content
   - Extract the string content between the opening quote and the cursor position

2. **Mini-notation Parsing Integration**: Use the existing `MiniNotationContextParser` to analyze the string content
   - Import `MiniNotationContextParser` from `./miniNotationParser.mjs`
   - Create a parser instance and call `parseContext(stringContent, cursorOffset)`
   - Use the returned `fragment` for filtering instead of the simple extraction

3. **Case-insensitive Filtering**: Update the filter logic to use lowercase comparison
   - Convert both the fragment and bank labels to lowercase for comparison: `b.label.toLowerCase().startsWith(fragment.toLowerCase())`
   - This allows matching regardless of how the user types

4. **Lowercase Suggestions**: Modify `bankCompletions()` to return lowercase bank names
   - Change the mapping to: `Array.from(banks).sort().map((name) => ({ label: name.toLowerCase(), type: 'bank' }))`
   - This ensures suggestions match the actual sound file naming convention

5. **Backward Compatibility**: Ensure the enhanced detection still works for direct `.bank("` calls
   - Test that the new parsing logic correctly handles simple cases without mini-notation
   - Verify that the `from` position calculation is correct for both simple and complex cases

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code, then verify the fix works correctly and preserves existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm or refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: Write tests that simulate typing inside mini-notation patterns within `.bank()` calls and typing with different casing. Run these tests on the UNFIXED code to observe failures and understand the root cause.

**Test Cases**:
1. **Mini-notation Angle Brackets Test**: Type `s("bd").bank("<roland")` with cursor after `<roland` (will fail on unfixed code - no suggestions)
2. **Mini-notation Square Brackets Test**: Type `s("bd").bank("[casio yamaha]")` with cursor after `[casio ` (will fail on unfixed code - no suggestions)
3. **Case Sensitivity Test**: Type `s("bd").bank("roland")` (will fail on unfixed code - no suggestions due to case mismatch)
4. **Nested Mini-notation Test**: Type `s("bd").bank("<[casio yamaha] roland>")` with cursor after `<[casio ` (will fail on unfixed code - no suggestions)

**Expected Counterexamples**:
- No autocomplete suggestions appear when typing inside mini-notation brackets
- No autocomplete suggestions appear when typing lowercase but banks are capitalized
- Possible causes: regex doesn't match mini-notation context, case-sensitive filtering, no parsing of string content

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := bankHandler_fixed(input)
  ASSERT result.options.length > 0
  ASSERT result.options.every(opt => opt.label === opt.label.toLowerCase())
  ASSERT result.options.every(opt => opt.label.startsWith(input.fragment.toLowerCase()))
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT bankHandler_original(input) = bankHandler_fixed(input)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain
- It catches edge cases that manual unit tests might miss
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs

**Test Plan**: Observe behavior on UNFIXED code first for direct `.bank("` calls and other autocomplete contexts, then write property-based tests capturing that behavior.

**Test Cases**:
1. **Direct Bank Call Preservation**: Verify `s("bd").bank("roland")` continues to work with direct typing (observe current behavior, then verify it's preserved)
2. **Other Autocomplete Preservation**: Verify `.sound()`, `.chord()`, `.scale()` autocomplete continues to work independently
3. **Outside Bank Context Preservation**: Verify autocomplete outside `.bank()` calls continues to work
4. **Empty Fragment Preservation**: Verify behavior when cursor is at `.bank("` with no typed fragment

### Unit Tests

- Test mini-notation context detection for angle brackets, square brackets, and braces
- Test case-insensitive filtering with various casing combinations
- Test lowercase suggestion generation
- Test edge cases (empty string, cursor at quote, cursor at closing bracket)
- Test that direct `.bank("` calls continue to work

### Property-Based Tests

- Generate random mini-notation patterns and verify autocomplete works at various cursor positions
- Generate random bank name fragments with random casing and verify case-insensitive matching
- Generate random autocomplete contexts outside `.bank()` and verify preservation of existing behavior
- Test that all suggestions are lowercase across many scenarios

### Integration Tests

- Test full REPL flow with typing inside mini-notation patterns
- Test switching between different mini-notation structures and using autocomplete
- Test that accepting a lowercase suggestion works correctly at runtime (sound files load)
- Test that visual feedback (autocomplete popup) appears correctly in mini-notation context
