# Requirements Document: Enhanced Strudel Autocomplete

## Introduction

This document specifies requirements for enhancing Strudel's code autocomplete system to better support the live coding workflow. The current autocomplete system has limitations when working with Strudel's mini-notation syntax, particularly around sample name suggestions inside string contexts. This enhancement will improve the developer experience by providing intelligent, context-aware autocomplete that understands mini-notation patterns, supports case-insensitive matching, and works seamlessly within both regular and template strings.

## Glossary

- **Autocomplete_System**: The CodeMirror 6-based code completion system that suggests code completions to users
- **Mini_Notation**: Strudel's terse pattern syntax for expressing rhythmic sequences, inherited from TidalCycles
- **Sample_Name**: An identifier for an audio sample or synthesizer sound (e.g., "bd", "RolandTR909", "gm_church_organ")
- **Sample_Bank**: A collection of related samples with a common prefix (e.g., "RolandTR909" is a bank containing samples like "RolandTR909_kick")
- **Colon_Syntax**: Mini-notation syntax using colons to separate sample name, sample number, and gain (e.g., "bd:0:0.5")
- **Template_String**: JavaScript template literals using backticks with angle brackets for pattern alternation (e.g., \`<EmuSP12 AlesisSR16>\`)
- **String_Context**: The interior of a quoted string where mini-notation patterns are written
- **Completion_Context**: The current position and surrounding code that determines what completions are appropriate
- **Sound_Map**: The runtime registry of all available samples and synthesizers maintained by superdough

## Requirements

### Requirement 1: Case-Insensitive Sample Matching

**User Story:** As a live coder, I want to find samples by typing lowercase letters, so that I can code faster without worrying about exact capitalization.

#### Acceptance Criteria

1. WHEN a user types lowercase characters in a sample context, THE Autocomplete_System SHALL suggest samples that match case-insensitively
2. WHEN displaying suggestions, THE Autocomplete_System SHALL preserve the original capitalization of the Sample_Name
3. WHEN a user types "roland", THE Autocomplete_System SHALL suggest "RolandTR909" and other Roland samples
4. WHEN a user types "PULSE", THE Autocomplete_System SHALL suggest "pulse" and other matching samples
5. WHEN filtering suggestions, THE Autocomplete_System SHALL match any substring case-insensitively, not just prefixes

### Requirement 2: Autocomplete Inside .s() Method Strings

**User Story:** As a live coder, I want autocomplete to work inside .s() method strings with colon syntax, so that I can quickly compose complex sample patterns.

#### Acceptance Criteria

1. WHEN a user types inside a string argument to .s() or .sound(), THE Autocomplete_System SHALL provide sample name suggestions
2. WHEN a user types a colon after a Sample_Name, THE Autocomplete_System SHALL recognize this as Colon_Syntax and continue providing suggestions
3. WHEN a user types `.s("pulse:1200,gm_")`, THE Autocomplete_System SHALL suggest samples starting with "gm_" after the comma
4. WHEN a user types `.s("bd:0:0.5 ")`, THE Autocomplete_System SHALL suggest new samples after the space
5. WHEN parsing String_Context, THE Autocomplete_System SHALL recognize spaces, commas, and square brackets as pattern separators

### Requirement 3: Autocomplete Inside .bank() Method Strings

**User Story:** As a live coder, I want autocomplete to work inside .bank() method strings, so that I can quickly select sample banks.

#### Acceptance Criteria

1. WHEN a user types inside a string argument to .bank(), THE Autocomplete_System SHALL provide Sample_Bank suggestions
2. WHEN a user types `.bank("roland")`, THE Autocomplete_System SHALL suggest "RolandTR909" and other Roland banks
3. WHEN a user types `.bank('<Emu')`, THE Autocomplete_System SHALL suggest banks starting with "Emu" inside the template pattern
4. WHEN a user types `.bank('<EmuSP12 Alesis')`, THE Autocomplete_System SHALL suggest banks starting with "Alesis" after the space
5. THE Autocomplete_System SHALL extract Sample_Bank names from the Sound_Map by identifying samples with underscore-separated prefixes

### Requirement 4: Template String Pattern Support

**User Story:** As a live coder, I want autocomplete to work inside template string patterns with angle brackets, so that I can use pattern alternation syntax.

#### Acceptance Criteria

1. WHEN a user types inside angle brackets within a template string, THE Autocomplete_System SHALL provide sample suggestions
2. WHEN a user types \`.bank(\`<Emu\`)\`, THE Autocomplete_System SHALL suggest banks starting with "Emu"
3. WHEN a user types \`.s(\`<bd hh \`)\`, THE Autocomplete_System SHALL suggest samples after the space inside the pattern
4. WHEN a user types \`.s(\`[bd:0 pulse:\`)\`, THE Autocomplete_System SHALL suggest samples after the colon inside square brackets
5. THE Autocomplete_System SHALL recognize both single quotes, double quotes, and backticks as valid string delimiters

### Requirement 5: Mini-Notation Special Character Handling

**User Story:** As a live coder, I want autocomplete to understand mini-notation syntax, so that suggestions appear at the right positions within complex patterns.

#### Acceptance Criteria

1. WHEN a user types after a space in Mini_Notation, THE Autocomplete_System SHALL treat it as a new pattern element
2. WHEN a user types after a comma in Mini_Notation, THE Autocomplete_System SHALL treat it as a new pattern element
3. WHEN a user types after a colon in Colon_Syntax, THE Autocomplete_System SHALL continue in the same context
4. WHEN a user types inside square brackets, THE Autocomplete_System SHALL provide suggestions for pattern elements
5. WHEN a user types inside angle brackets, THE Autocomplete_System SHALL provide suggestions for alternating patterns
6. WHEN a user types after opening parentheses, THE Autocomplete_System SHALL provide suggestions for euclidean rhythm parameters
7. THE Autocomplete_System SHALL recognize `~` (silence) and `-` (rest) as valid pattern elements that don't require completion

### Requirement 6: Context-Aware Completion Triggering

**User Story:** As a live coder, I want autocomplete to appear automatically when I'm in a sample context, so that I don't have to manually trigger it.

#### Acceptance Criteria

1. WHEN a user types inside a string argument to .s(), .sound(), or .bank(), THE Autocomplete_System SHALL automatically activate
2. WHEN a user types after a pattern separator (space, comma), THE Autocomplete_System SHALL automatically activate
3. WHEN a user types after a colon in Colon_Syntax, THE Autocomplete_System SHALL automatically activate
4. WHEN a user is outside a string context, THE Autocomplete_System SHALL provide standard JavaScript/Strudel function completions
5. WHEN a user explicitly triggers autocomplete (Ctrl+Space), THE Autocomplete_System SHALL show all available completions for the current context

### Requirement 7: Sample Source Integration

**User Story:** As a developer, I want the autocomplete system to access all available samples, so that users can discover samples from all loaded sources.

#### Acceptance Criteria

1. WHEN the Autocomplete_System initializes, THE Autocomplete_System SHALL query the Sound_Map for all available samples
2. WHEN new samples are loaded at runtime, THE Autocomplete_System SHALL update its completion list
3. THE Autocomplete_System SHALL include samples from built-in synthesizers (sine, sawtooth, pulse, etc.)
4. THE Autocomplete_System SHALL include samples from loaded sample banks (bd, hh, cp, etc.)
5. THE Autocomplete_System SHALL include samples from soundfonts (gm_piano, gm_church_organ, etc.)
6. THE Autocomplete_System SHALL include samples from custom loaded sources

### Requirement 8: Performance and Responsiveness

**User Story:** As a live coder, I want autocomplete to respond instantly, so that it doesn't interrupt my creative flow.

#### Acceptance Criteria

1. WHEN a user types in a sample context, THE Autocomplete_System SHALL display suggestions within 50 milliseconds
2. WHEN filtering thousands of samples, THE Autocomplete_System SHALL use efficient string matching algorithms
3. WHEN parsing String_Context, THE Autocomplete_System SHALL use cached regular expressions
4. THE Autocomplete_System SHALL limit displayed suggestions to a maximum of 100 items
5. THE Autocomplete_System SHALL prioritize exact prefix matches over substring matches in the suggestion list

### Requirement 9: Backward Compatibility

**User Story:** As a Strudel user, I want the enhanced autocomplete to work with existing code, so that my workflow isn't disrupted.

#### Acceptance Criteria

1. THE Autocomplete_System SHALL maintain all existing autocomplete functionality for functions, methods, and scales
2. THE Autocomplete_System SHALL continue to support the existing handler chain architecture
3. WHEN a user disables autocomplete in settings, THE Autocomplete_System SHALL respect that preference
4. THE Autocomplete_System SHALL not break existing keyboard shortcuts or editor behaviors
5. THE Autocomplete_System SHALL work with all existing CodeMirror 6 extensions in Strudel

### Requirement 10: Multi-Context Pattern Parsing

**User Story:** As a live coder, I want autocomplete to work correctly in nested and complex mini-notation patterns, so that I can write sophisticated musical patterns.

#### Acceptance Criteria

1. WHEN a user types in a nested pattern like `"[bd [hh hh]]"`, THE Autocomplete_System SHALL provide suggestions at each position
2. WHEN a user types in a polymeter pattern like `"{bd hh, cp sd}"`, THE Autocomplete_System SHALL recognize the comma as a polymeter separator
3. WHEN a user types in a euclidean pattern like `"bd(3,8)"`, THE Autocomplete_System SHALL not provide sample suggestions inside the parentheses
4. WHEN a user types in a weighted pattern like `"bd@3 hh@1"`, THE Autocomplete_System SHALL recognize `@` as a weight operator
5. THE Autocomplete_System SHALL correctly identify the current pattern element position regardless of nesting depth
