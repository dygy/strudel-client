# Implementation Plan

- [x] 1. Write bug condition exploration test
  - **Property 1: Fault Condition** - Multi-line Formatting for arrange() and stack()
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate the bug exists
  - **Scoped PBT Approach**: Scope the property to concrete failing cases: arrange() and stack() calls with multiple arguments
  - Test that formatStrudelCode formats arrange() and stack() calls with multiple arguments as multi-line (from Fault Condition in design)
  - Test cases:
    - Long arrange() with 2 array arguments exceeding print width 80
    - stack() with 3 pattern arguments
    - Chained .stack() method with multiple arguments
  - The test assertions should match the Expected Behavior Properties from design:
    - Each argument on a new indented line
    - Closing parenthesis on its own line
  - Run test on UNFIXED code in website/src/repl/formatEngine.ts
  - **EXPECTED OUTCOME**: Test FAILS (this is correct - it proves the bug exists)
  - Document counterexamples found (e.g., "arrange([s('bd sd'), s('hh*4')], [s('bass:0 bass:1'), s('pad:2')]) remains on single line instead of multi-line format")
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 2.1, 2.2, 2.3, 2.4_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Existing Formatting Behavior
  - **IMPORTANT**: Follow observation-first methodology
  - Observe behavior on UNFIXED code for non-buggy inputs:
    - Single-argument arrange() and stack() calls
    - Other DSL functions (.sound(), .gain(), .lpf(), etc.)
    - Mini notation patterns ("bd sd hh", "<0 1 2>", "[a b c]")
    - Standard JavaScript syntax
    - Method chaining on patterns
    - String literals with URLs and file paths
    - Comments (line and block)
  - Write property-based tests capturing observed behavior patterns from Preservation Requirements
  - Property-based testing generates many test cases for stronger guarantees
  - Test cases:
    - Single argument preservation: arrange([s("bd")]) remains single line
    - Other DSL functions: .sound().gain().lpf() chains format correctly
    - Mini notation: "bd sd hh" and <0 1 2> patterns preserved
    - Standard JavaScript: functions, variables, loops format correctly
  - Run tests on UNFIXED code in website/src/repl/formatEngine.ts
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

- [x] 3. Fix for arrange() and stack() multi-line formatting

  - [x] 3.1 Implement the fix in formatStrudelCode method
    - Add function call detection for arrange() and stack() patterns
    - Implement argument list parsing to count arguments and calculate line length
    - Apply multi-line formatting when argument count > 1 or line exceeds print width
    - Preserve string placeholders during preprocessing
    - Integrate with existing indentation logic
    - _Bug_Condition: isBugCondition(input) where code contains "arrange(" OR "stack(" OR ".stack(" AND (functionCallLength > printWidth OR argumentCount > 1) AND NOT isFormattedMultiLine_
    - _Expected_Behavior: Multi-line format with opening parenthesis on same line, each argument on new indented line, closing parenthesis on own line (from design)_
    - _Preservation: All non-arrange/stack code, single-argument cases, short multi-argument cases within print width, other DSL functions, mini notation, standard JavaScript (from Preservation Requirements in design)_
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

  - [x] 3.2 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Multi-line Formatting for arrange() and stack()
    - **IMPORTANT**: Re-run the SAME test from task 1 - do NOT write a new test
    - The test from task 1 encodes the expected behavior
    - When this test passes, it confirms the expected behavior is satisfied
    - Run bug condition exploration test from step 1
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed)
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [x] 3.3 Verify preservation tests still pass
    - **Property 2: Preservation** - Existing Formatting Behavior
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - Run preservation property tests from step 2
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - Confirm all tests still pass after fix (no regressions)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.
