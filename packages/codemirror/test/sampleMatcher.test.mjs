/*
sampleMatcher.test.mjs - Tests for CaseInsensitiveSampleMatcher
Copyright (C) 2024 Strudel contributors - see <https://codeberg.org/uzu/strudel>
This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License for more details. You should have received a copy of the GNU Affero General Public License along with this program. If not, see <https://www.gnu.org/licenses/>.
*/

import { describe, it, expect } from 'vitest';
import { CaseInsensitiveSampleMatcher } from '../sampleMatcher.mjs';
import * as fc from 'fast-check';

describe('CaseInsensitiveSampleMatcher', () => {
  const matcher = new CaseInsensitiveSampleMatcher();

  describe('Unit Tests', () => {
    it('should match exact names case-insensitively', () => {
      const samples = ['bd', 'hh', 'cp', 'RolandTR909'];
      const results = matcher.match(samples, 'roland');
      
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].name).toBe('RolandTR909');
      expect(results[0].matchType).toBe('prefix');
    });

    it('should match prefixes case-insensitively', () => {
      const samples = ['bd', 'bass', 'bassline', 'RolandTR909'];
      const results = matcher.match(samples, 'bas');
      
      const names = results.map(r => r.name);
      expect(names).toContain('bass');
      expect(names).toContain('bassline');
    });

    it('should match substrings case-insensitively', () => {
      const samples = ['bd', 'RolandTR909', 'gm_church_organ'];
      const results = matcher.match(samples, 'roland');
      
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].name).toBe('RolandTR909');
    });

    it('should preserve original capitalization', () => {
      const samples = ['RolandTR909', 'PULSE', 'gm_Church_Organ'];
      const results = matcher.match(samples, 'roland');
      
      expect(results[0].name).toBe('RolandTR909'); // Original case preserved
    });

    it('should rank exact matches highest', () => {
      const samples = ['bd', 'bd_long', 'subd'];
      const results = matcher.match(samples, 'bd');
      
      expect(results[0].name).toBe('bd'); // Exact match first
      expect(results[0].score).toBeGreaterThan(results[1].score);
    });

    it('should rank prefix matches over substring matches', () => {
      const samples = ['subd', 'bd', 'bd_long'];
      const results = matcher.match(samples, 'bd');
      
      // 'bd' (exact) should be first, then 'bd_long' (prefix), then 'subd' (substring)
      expect(results[0].name).toBe('bd');
      expect(results[1].name).toBe('bd_long');
      expect(results[2].name).toBe('subd');
    });

    it('should limit results to maxResults', () => {
      const samples = Array.from({ length: 200 }, (_, i) => `sample${i}`);
      const results = matcher.match(samples, 'sample', 50);
      
      expect(results.length).toBeLessThanOrEqual(50);
    });

    it('should handle empty fragment by returning all samples', () => {
      const samples = ['bd', 'hh', 'cp'];
      const results = matcher.match(samples, '');
      
      expect(results.length).toBe(3);
    });

    it('should handle no matches gracefully', () => {
      const samples = ['bd', 'hh', 'cp'];
      const results = matcher.match(samples, 'xyz');
      
      expect(results.length).toBe(0);
    });

    it('should match case variations correctly', () => {
      const samples = ['RolandTR909', 'PULSE', 'gm_church_organ'];
      
      const results1 = matcher.match(samples, 'ROLAND');
      const results2 = matcher.match(samples, 'roland');
      const results3 = matcher.match(samples, 'Roland');
      
      expect(results1[0].name).toBe('RolandTR909');
      expect(results2[0].name).toBe('RolandTR909');
      expect(results3[0].name).toBe('RolandTR909');
    });
  });

  describe('Property-Based Tests', () => {
    // Feature: enhanced-strudel-autocomplete, Property 1: Case-Insensitive Substring Matching
    it('case-insensitive substring matching preserves capitalization', () => {
      fc.assert(
        fc.property(
          fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 1, maxLength: 100 }),
          fc.string({ minLength: 1, maxLength: 10 }),
          (samples, fragment) => {
            const results = matcher.match(samples, fragment);
            
            // All results must contain fragment (case-insensitive)
            results.forEach(result => {
              expect(result.name.toLowerCase()).toContain(fragment.toLowerCase());
            });
            
            // Original capitalization must be preserved
            results.forEach(result => {
              expect(samples).toContain(result.name);
            });
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should always return results sorted by score descending', () => {
      fc.assert(
        fc.property(
          fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 1, maxLength: 100 }),
          fc.string({ minLength: 1, maxLength: 10 }),
          (samples, fragment) => {
            const results = matcher.match(samples, fragment);
            
            // Check that scores are in descending order
            for (let i = 0; i < results.length - 1; i++) {
              expect(results[i].score).toBeGreaterThanOrEqual(results[i + 1].score);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should respect maxResults limit', () => {
      fc.assert(
        fc.property(
          fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 1, maxLength: 200 }),
          fc.string({ minLength: 1, maxLength: 10 }),
          fc.integer({ min: 1, max: 100 }),
          (samples, fragment, maxResults) => {
            const results = matcher.match(samples, fragment, maxResults);
            expect(results.length).toBeLessThanOrEqual(maxResults);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
