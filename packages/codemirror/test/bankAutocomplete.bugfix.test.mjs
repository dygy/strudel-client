/*
bankAutocomplete.bugfix.test.mjs - Bug condition exploration tests for bank autocomplete
Copyright (C) 2024 Strudel contributors - see <https://codeberg.org/uzu/strudel>
This program is free software: you can redistribute it and/or modify it under the terms of the
GNU Affero General Public License as published by the Free Software Foundation, either version 3
of the License, or (at your option) any later version. This program is distributed in the hope
that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License
for more details. You should have received a copy of the GNU Affero General Public License along
with this program. If not, see <https://www.gnu.org/licenses/>.
*/

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';

/**
 * **Validates: Requirements 1.1, 1.2, 1.3, 1.4**
 *
 * Bug Condition Exploration Test - Mini-notation Context and Case Sensitivity
 *
 * This test encodes the EXPECTED (correct) behavior for bankHandler:
 * - Suggestions should appear when typing inside mini-notation syntax within .bank()
 * - Suggestions should use case-insensitive filtering
 * - Suggestions should be returned in lowercase to match actual sound file names
 *
 * On UNFIXED code, these tests are EXPECTED TO FAIL because:
 * - bankCompletions() returns original casing (e.g., "RolandTR909") not lowercase
 * - MiniNotationContextParser is NOT integrated into bankHandler
 */

// We need to mock superdough's soundMap before importing autocomplete
// because bankCompletions() reads from soundMap.get()
const mockSoundMap = new Map();
const mockSoundDict = {
  RolandTR909_bd: '/samples/RolandTR909/bd.wav',
  RolandTR909_sd: '/samples/RolandTR909/sd.wav',
  RolandTR909_hh: '/samples/RolandTR909/hh.wav',
  CasioRZ1_bd: '/samples/CasioRZ1/bd.wav',
  CasioRZ1_sd: '/samples/CasioRZ1/sd.wav',
  YamahaRX5_bd: '/samples/YamahaRX5/bd.wav',
  YamahaRX5_hh: '/samples/YamahaRX5/hh.wav',
  EmuSP12_bd: '/samples/EmuSP12/bd.wav',
  EmuSP12_sd: '/samples/EmuSP12/sd.wav',
};

vi.mock('superdough', () => ({
  soundMap: {
    get: () => mockSoundDict,
  },
}));

// Mock @tonaljs/tonal to avoid loading issues
vi.mock('@tonaljs/tonal', () => ({
  Scale: { names: () => [] },
}));

// Mock @strudel/tonal
vi.mock('@strudel/tonal', () => ({
  complex: {},
}));

// Mock the jsdoc import
vi.mock('../../doc.json', () => ({
  default: { docs: [] },
}));

// Now import the functions under test
const { bankHandler, bankCompletions } = await import('../autocomplete.mjs').then((mod) => {
  // bankHandler is not exported, so we need to test via strudelAutocomplete
  return mod;
});

const { strudelAutocomplete } = await import('../autocomplete.mjs');

/**
 * Create a mock CodeMirror autocomplete context.
 *
 * The key method is `matchBefore(regex)` which tests the text before the cursor
 * against a regex and returns { text, from, to } if it matches, or null.
 *
 * @param {string} fullText - The full text in the editor
 * @param {number} cursorPos - The cursor position (0-indexed)
 * @returns {object} Mock context object
 */
function createMockContext(fullText, cursorPos, explicit = false) {
  const textBeforeCursor = fullText.slice(0, cursorPos);
  return {
    pos: cursorPos,
    explicit,
    state: {
      doc: {
        sliceString: (from, to) => fullText.slice(from, to),
      },
    },
    matchBefore(regex) {
      const match = textBeforeCursor.match(regex);
      if (!match) return null;
      const matchStart = match.index;
      const matchEnd = matchStart + match[0].length;
      return {
        text: match[0],
        from: matchStart,
        to: matchEnd,
      };
    },
  };
}

describe('Bank Autocomplete Bug Condition Exploration', () => {
  beforeEach(() => {
    // Suppress console.log from autocomplete handler
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Property 1: Bug Condition - Mini-notation Context and Case Sensitivity', () => {
    /**
     * **Validates: Requirements 1.1, 1.2**
     *
     * Property: When cursor is inside mini-notation syntax within .bank(),
     * bankHandler SHALL provide suggestions using case-insensitive filtering
     * with lowercase bank names.
     */
    it('should provide suggestions when typing inside mini-notation angle brackets', () => {
      // User types: s("bd").bank("<roland
      // Cursor is after "<roland" - inside angle brackets
      const text = 's("bd").bank("<roland';
      const cursorPos = text.length;
      const context = createMockContext(text, cursorPos);

      const result = strudelAutocomplete(context);

      // EXPECTED: result should have suggestions matching "roland" (case-insensitive)
      expect(result).not.toBeNull();
      expect(result.options.length).toBeGreaterThan(0);

      // All suggestions should be lowercase (requirement 2.4)
      const allLowercase = result.options.every((opt) => opt.label === opt.label.toLowerCase());
      expect(allLowercase).toBe(true);

      // Should include rolandtr909 (lowercase version of RolandTR909)
      const hasRoland = result.options.some((opt) => opt.label.toLowerCase().startsWith('roland'));
      expect(hasRoland).toBe(true);
    });

    /**
     * **Validates: Requirements 1.3, 1.4**
     *
     * Property: When typing lowercase but banks are capitalized,
     * bankHandler SHALL show matching suggestions with case-insensitive filtering
     * and lowercase bank names.
     */
    it('should provide lowercase suggestions when typing lowercase fragment', () => {
      // User types: s("bd").bank("roland
      // Banks are stored as "RolandTR909" - case mismatch
      const text = 's("bd").bank("roland';
      const cursorPos = text.length;
      const context = createMockContext(text, cursorPos);

      const result = strudelAutocomplete(context);

      expect(result).not.toBeNull();
      expect(result.options.length).toBeGreaterThan(0);

      // All suggestion labels MUST be lowercase (requirement 2.4)
      // On unfixed code, bankCompletions() returns "RolandTR909" (original casing)
      const allLowercase = result.options.every((opt) => opt.label === opt.label.toLowerCase());
      expect(allLowercase).toBe(true);

      // Should have a suggestion starting with "roland"
      const hasRoland = result.options.some((opt) => opt.label.startsWith('roland'));
      expect(hasRoland).toBe(true);
    });

    /**
     * **Validates: Requirements 1.2**
     *
     * Property: When cursor is inside nested mini-notation structures,
     * bankHandler SHALL provide suggestions.
     */
    it('should provide suggestions in nested mini-notation', () => {
      // User types: s("bd").bank("<[casio
      // Cursor is inside nested brackets within angle brackets
      const text = 's("bd").bank("<[casio';
      const cursorPos = text.length;
      const context = createMockContext(text, cursorPos);

      const result = strudelAutocomplete(context);

      expect(result).not.toBeNull();
      expect(result.options.length).toBeGreaterThan(0);

      // All suggestions should be lowercase
      const allLowercase = result.options.every((opt) => opt.label === opt.label.toLowerCase());
      expect(allLowercase).toBe(true);

      // Should include casiorz1 (lowercase version of CasioRZ1)
      const hasCasio = result.options.some((opt) => opt.label.toLowerCase().startsWith('casio'));
      expect(hasCasio).toBe(true);
    });

    /**
     * **Validates: Requirements 1.1, 1.2, 1.3, 1.4**
     *
     * Property-based test: For any bank name fragment typed inside mini-notation
     * within .bank(), suggestions should be returned in lowercase with
     * case-insensitive filtering.
     */
    it('PBT: mini-notation context with case-insensitive matching', () => {
      // Known bank names from our mock
      const knownBanks = ['RolandTR909', 'CasioRZ1', 'YamahaRX5', 'EmuSP12'];

      // Generate mini-notation wrappers
      const miniNotationWrapper = fc.constantFrom('<', '[', '{');

      // Generate a lowercase prefix of a known bank name
      const bankFragment = fc.constantFrom(...knownBanks).chain((bank) => {
        const lower = bank.toLowerCase();
        return fc.integer({ min: 1, max: lower.length }).map((len) => ({
          fragment: lower.slice(0, len),
          originalBank: bank,
        }));
      });

      fc.assert(
        fc.property(miniNotationWrapper, bankFragment, (wrapper, { fragment, originalBank }) => {
          const text = `s("bd").bank("${wrapper}${fragment}`;
          const cursorPos = text.length;
          const context = createMockContext(text, cursorPos);

          const result = strudelAutocomplete(context);

          // EXPECTED: Should get suggestions
          expect(result).not.toBeNull();
          expect(result.options.length).toBeGreaterThan(0);

          // All suggestions must be lowercase
          result.options.forEach((opt) => {
            expect(opt.label).toBe(opt.label.toLowerCase());
          });

          // Should include the matching bank (lowercase)
          const expectedLabel = originalBank.toLowerCase();
          const hasMatch = result.options.some((opt) => opt.label === expectedLabel);
          expect(hasMatch).toBe(true);
        }),
        { numRuns: 50 },
      );
    });
  });
});

/**
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4**
 *
 * Preservation Property Tests - Direct Bank Call and Other Autocomplete Behavior
 *
 * These tests capture the CURRENT (unfixed) behavior for non-buggy inputs.
 * They must PASS on unfixed code to confirm baseline behavior to preserve.
 *
 * Observed behavior on unfixed code:
 * - Direct .bank(" calls return suggestions with ORIGINAL casing (e.g., "RolandTR909")
 * - Case-insensitive filtering IS applied (partial fix already in place)
 * - Empty fragment returns all banks sorted alphabetically
 * - Autocomplete outside .bank() falls through to other handlers (sound, jsdoc, etc.)
 * - Other handlers (soundHandler, scaleHandler) work independently
 */
describe('Bank Autocomplete Preservation Tests', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Property 2: Preservation - Direct Bank Call and Other Autocomplete Behavior', () => {
    /**
     * **Validates: Requirements 3.1, 3.2**
     *
     * Direct .bank("ro returns bank suggestions with case-insensitive filtering.
     * On current unfixed code: returns ["RolandTR909"] with original casing.
     */
    it('direct .bank("ro returns bank suggestions with prefix matching', () => {
      const text = 's("bd").bank("ro';
      const ctx = createMockContext(text, text.length);
      const result = strudelAutocomplete(ctx);

      expect(result).not.toBeNull();
      expect(result.options.length).toBeGreaterThan(0);
      // from position is right after the opening quote
      expect(result.from).toBe(14);
      // All returned options should have type 'bank'
      result.options.forEach((opt) => {
        expect(opt.type).toBe('bank');
      });
      // Case-insensitive prefix matching: "ro" matches "RolandTR909"
      const hasRoland = result.options.some((opt) => opt.label.toLowerCase().startsWith('ro'));
      expect(hasRoland).toBe(true);
    });

    /**
     * **Validates: Requirements 3.1**
     *
     * .bank(" with empty fragment returns all bank completions.
     * On current unfixed code: returns all 4 banks sorted alphabetically.
     */
    it('.bank(" with empty fragment returns all banks', () => {
      const text = 's("bd").bank("';
      const ctx = createMockContext(text, text.length);
      const result = strudelAutocomplete(ctx);

      expect(result).not.toBeNull();
      expect(result.from).toBe(14);
      // Should return all 4 banks from our mock
      expect(result.options.length).toBe(4);
      // All options should be bank type
      result.options.forEach((opt) => {
        expect(opt.type).toBe('bank');
      });
      // Banks should be sorted alphabetically
      const labels = result.options.map((o) => o.label);
      const sorted = [...labels].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
      expect(labels).toEqual(sorted);
    });

    /**
     * **Validates: Requirements 3.3**
     *
     * Autocomplete for s("bd returns sound completions, NOT bank completions.
     * soundHandler should match before bankHandler in the handler chain.
     */
    it('s("bd returns sound completions, not bank', () => {
      const text = 's("bd';
      const ctx = createMockContext(text, text.length);
      const result = strudelAutocomplete(ctx);

      expect(result).not.toBeNull();
      expect(result.options.length).toBeGreaterThan(0);
      // Sound handler returns type 'sound'
      result.options.forEach((opt) => {
        expect(opt.type).toBe('sound');
      });
      // Should NOT contain bank-type completions
      const hasBankType = result.options.some((opt) => opt.type === 'bank');
      expect(hasBankType).toBe(false);
    });

    /**
     * **Validates: Requirements 3.3**
     *
     * Plain text "bd" outside any function call returns jsdoc/fallback completions.
     */
    it('plain text returns jsdoc completions, not bank', () => {
      const text = 'bd';
      const ctx = createMockContext(text, text.length);
      const result = strudelAutocomplete(ctx);

      expect(result).not.toBeNull();
      expect(result.from).toBe(0);
      // Fallback handler returns many jsdoc completions
      expect(result.options.length).toBeGreaterThan(0);
      // Should NOT contain bank-type completions
      const hasBankType = result.options.some((opt) => opt.type === 'bank');
      expect(hasBankType).toBe(false);
    });

    /**
     * **Validates: Requirements 3.1, 3.2, 3.3, 3.4**
     *
     * PBT: For any direct bank fragment (lowercase prefix of a known bank),
     * suggestions are returned with prefix matching and bank type.
     * This captures the preservation property across many inputs.
     */
    it('PBT: direct bank calls return suggestions with prefix matching for any fragment', () => {
      const knownBanks = ['RolandTR909', 'CasioRZ1', 'YamahaRX5', 'EmuSP12'];

      // Generate fragments: lowercase prefixes of known bank names of varying lengths
      const bankFragmentArb = fc.constantFrom(...knownBanks).chain((bank) => {
        const lower = bank.toLowerCase();
        return fc.integer({ min: 1, max: lower.length }).map((len) => ({
          fragment: lower.slice(0, len),
          originalBank: bank,
        }));
      });

      fc.assert(
        fc.property(bankFragmentArb, ({ fragment, originalBank }) => {
          const text = `s("bd").bank("${fragment}`;
          const ctx = createMockContext(text, text.length);
          const result = strudelAutocomplete(ctx);

          // Should always return a result for direct .bank(" calls
          expect(result).not.toBeNull();
          expect(result.options.length).toBeGreaterThan(0);

          // from position should be right after the opening quote
          expect(result.from).toBe(14);

          // All options should be bank type
          result.options.forEach((opt) => {
            expect(opt.type).toBe('bank');
          });

          // Case-insensitive prefix matching: the original bank should be in results
          const hasMatch = result.options.some(
            (opt) => opt.label.toLowerCase().startsWith(fragment.toLowerCase()),
          );
          expect(hasMatch).toBe(true);
        }),
        { numRuns: 50 },
      );
    });
  });
});
