# Implementation Plan

- [x] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - Mini-notation Context and Case Sensitivity
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate the bug exists
  - **Scoped PBT Approach**: Scope the property to concrete failing cases: typing inside mini-notation brackets and typing with different casing
  - Test that bankHandler provides no suggestions when cursor is inside mini-notation syntax (e.g., `s("bd").bank("<roland")` with cursor after `<roland`)
  - Test that bankHandler provides no suggestions when typing lowercase but banks are capitalized (e.g., `s("bd").bank("roland")` when banks are "RolandTR909")
  - Test that bankHandler provides no suggestions in nested mini-notation (e.g., `s("bd").bank("<[casio yamaha] roland>")` with cursor after `<[casio `)
  - The test assertions should match the Expected Behavior Properties from design: suggestions should appear with case-insensitive filtering and lowercase bank names
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS (this is correct - it proves the bug exists)
  - Document counterexamples found to understand root cause
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Direct Bank Call and Other Autocomplete Behavior
  - **IMPORTANT**: Follow observation-first methodology
  - Observe behavior on UNFIXED code for direct `.bank("` calls without mini-notation (e.g., `s("bd").bank("roland")` with cursor after `"roland`)
  - Observe behavior on UNFIXED code for autocomplete outside `.bank()` context
  - Observe behavior on UNFIXED code for other autocomplete handlers (`.sound()`, `.chord()`, `.scale()`, `.mode()`)
  - Write property-based tests capturing observed behavior patterns from Preservation Requirements
  - Property-based testing generates many test cases for stronger guarantees
  - Test that direct `.bank("` autocomplete continues to work exactly as before
  - Test that autocomplete outside `.bank()` calls remains unchanged
  - Test that other autocomplete handlers function independently
  - Test that filtering logic preserves the same matching semantics (prefix matching)
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 3. Fix for bank autocomplete mini-notation and case sensitivity bugs

  - [x] 3.1 Implement the fix in bankHandler function
    - Enhance context detection to detect `.bank()` calls more broadly using two-phase approach
    - Extract string content between opening quote and cursor position
    - Import and integrate MiniNotationContextParser from `./miniNotationParser.mjs`
    - Create parser instance and call `parseContext(stringContent, cursorOffset)` to get fragment
    - Update filter logic to use case-insensitive comparison: `b.label.toLowerCase().startsWith(fragment.toLowerCase())`
    - Modify `bankCompletions()` to return lowercase bank names: `Array.from(banks).sort().map((name) => ({ label: name.toLowerCase(), type: 'bank' }))`
    - Ensure backward compatibility for direct `.bank("` calls without mini-notation
    - Verify `from` position calculation is correct for both simple and complex cases
    - _Bug_Condition: isBugCondition(input) where (insideBankCall AND insideMiniNotation AND NOT autocompleteSuggestionsShown) OR (insideBankCall AND hasTypedFragment AND fragmentCaseDiffers AND NOT matchingBanksShown)_
    - _Expected_Behavior: For any input where cursor is inside .bank() string with mini-notation, bankHandler SHALL provide suggestions using case-insensitive filtering with lowercase bank names_
    - _Preservation: Direct .bank(" autocomplete, autocomplete outside .bank() calls, other autocomplete handlers, and filtering semantics must remain unchanged_
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4_

  - [x] 3.2 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Mini-notation Context and Case Sensitivity
    - **IMPORTANT**: Re-run the SAME test from task 1 - do NOT write a new test
    - The test from task 1 encodes the expected behavior
    - When this test passes, it confirms the expected behavior is satisfied
    - Run bug condition exploration test from step 1
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed)
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [x] 3.3 Verify preservation tests still pass
    - **Property 2: Preservation** - Direct Bank Call and Other Autocomplete Behavior
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - Run preservation property tests from step 2
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - Confirm all tests still pass after fix (no regressions)

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.
