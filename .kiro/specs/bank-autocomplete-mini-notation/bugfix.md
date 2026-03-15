# Bugfix Requirements Document

## Introduction

The bank autocomplete feature in the Strudel REPL has two critical bugs that prevent proper usage:

1. **Mini-notation context bug**: Autocomplete suggestions do not appear when typing inside mini-notation patterns (e.g., within `<...>`, `[...]`, or other pattern structures). The `bankHandler` function only recognizes the direct `.bank("` context and fails to detect when the cursor is inside mini-notation syntax.

2. **Case sensitivity bug**: Bank names are suggested with their original casing (e.g., `RolandTR909`) but the actual sound files use lowercase names (e.g., `rolandtr909`). The filter uses case-sensitive `startsWith` matching, causing mismatches between suggested names and actual file names.

These bugs significantly impact the user experience, as mini-notation is a core feature of Strudel's pattern language, and case mismatches lead to runtime errors when users accept autocomplete suggestions.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN the cursor is positioned inside mini-notation syntax after `.bank("` (e.g., `s("bd sd").bank("<RolandTR909, s>")` with cursor after `<`) THEN the system fails to provide any autocomplete suggestions

1.2 WHEN the cursor is positioned inside nested mini-notation structures like `[...]` or `{...}` within a bank string THEN the system fails to provide any autocomplete suggestions

1.3 WHEN a user types a bank name fragment that matches the lowercase version of a bank (e.g., typing "roland" when the bank is "RolandTR909") THEN the system fails to show matching suggestions due to case-sensitive filtering

1.4 WHEN the autocomplete suggests a bank name with capital letters (e.g., "RolandTR909") and the user accepts it THEN the system may fail at runtime because the actual sound files use lowercase names (e.g., "rolandtr909")

### Expected Behavior (Correct)

2.1 WHEN the cursor is positioned inside mini-notation syntax after `.bank("` (e.g., `s("bd sd").bank("<RolandTR909, s>")` with cursor after `<`) THEN the system SHALL provide bank autocomplete suggestions

2.2 WHEN the cursor is positioned inside nested mini-notation structures like `[...]` or `{...}` within a bank string THEN the system SHALL provide bank autocomplete suggestions

2.3 WHEN a user types a bank name fragment in any case (e.g., "roland", "Roland", "ROLAND") THEN the system SHALL show all matching bank suggestions using case-insensitive filtering

2.4 WHEN the autocomplete suggests bank names THEN the system SHALL suggest them in lowercase format to match the actual sound file naming convention

### Unchanged Behavior (Regression Prevention)

3.1 WHEN the cursor is positioned directly after `.bank("` without any mini-notation syntax THEN the system SHALL CONTINUE TO provide bank autocomplete suggestions as it currently does

3.2 WHEN a user types a complete bank name that matches exactly THEN the system SHALL CONTINUE TO filter and show that bank in the suggestions

3.3 WHEN the cursor is outside of a `.bank()` call context THEN the system SHALL CONTINUE TO not provide bank autocomplete suggestions

3.4 WHEN other autocomplete handlers (sound, chord, scale, mode) are triggered THEN the system SHALL CONTINUE TO function independently without interference from bank autocomplete changes
