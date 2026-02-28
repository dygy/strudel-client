/*
sampleMatcher.mjs - Case-insensitive sample name matcher with scoring
Copyright (C) 2024 Strudel contributors - see <https://codeberg.org/uzu/strudel>
This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License for more details. You should have received a copy of the GNU Affero General Public License along with this program. If not, see <https://www.gnu.org/licenses/>.
*/

/**
 * Case-insensitive sample matcher with intelligent scoring
 * 
 * Performs efficient case-insensitive matching of sample names with substring support.
 * Results are ranked by match quality: exact matches first, then prefix matches, then substring matches.
 */
export class CaseInsensitiveSampleMatcher {
  /**
   * Filter samples by case-insensitive matching
   * @param {string[]} samples - Available sample names
   * @param {string} fragment - User-typed fragment
   * @param {number} maxResults - Maximum results to return (default 100)
   * @returns {Array<{name: string, score: number, matchType: string}>} Sorted matching results
   */
  match(samples, fragment, maxResults = 100) {
    if (!fragment) {
      // No fragment - return all samples up to max
      return samples.slice(0, maxResults).map(name => ({
        name,
        score: 0,
        matchType: 'all'
      }));
    }

    const fragmentLower = fragment.toLowerCase();
    const results = [];

    for (const sample of samples) {
      const sampleLower = sample.toLowerCase();
      
      // Check if fragment appears in sample (case-insensitive)
      if (sampleLower.includes(fragmentLower)) {
        const score = this.calculateScore(sample, fragment, sampleLower, fragmentLower);
        const matchType = this._getMatchType(sampleLower, fragmentLower);
        
        results.push({
          name: sample, // Preserve original capitalization
          score,
          matchType
        });

        // Early termination for performance
        if (results.length >= maxResults * 2) {
          break;
        }
      }
    }

    // Sort by score descending and limit to maxResults
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, maxResults);
  }

  /**
   * Calculate match score for ranking
   * @param {string} sample - Sample name (original case)
   * @param {string} fragment - Search fragment (original case)
   * @param {string} sampleLower - Sample name (lowercase)
   * @param {string} fragmentLower - Search fragment (lowercase)
   * @returns {number} Match score (higher is better)
   */
  calculateScore(sample, fragment, sampleLower, fragmentLower) {
    // Exact match (case-insensitive)
    if (sampleLower === fragmentLower) {
      return 10000; // Much higher score for exact matches
    }

    // Prefix match
    if (sampleLower.startsWith(fragmentLower)) {
      // Prefer shorter samples (more specific)
      // Score range: 5000-6000
      return 5000 + (1000 - Math.min(sample.length, 1000));
    }

    // Substring match
    const matchPosition = sampleLower.indexOf(fragmentLower);
    if (matchPosition !== -1) {
      // Prefer matches earlier in the string
      // Score range: 100-1100
      return 100 + (1000 - Math.min(matchPosition, 1000));
    }

    return 0;
  }

  /**
   * Determine match type for a given sample and fragment
   * @private
   * @param {string} sampleLower - Sample name (lowercase)
   * @param {string} fragmentLower - Search fragment (lowercase)
   * @returns {string} Match type: 'exact' | 'prefix' | 'substring'
   */
  _getMatchType(sampleLower, fragmentLower) {
    if (sampleLower === fragmentLower) {
      return 'exact';
    }
    if (sampleLower.startsWith(fragmentLower)) {
      return 'prefix';
    }
    return 'substring';
  }
}
