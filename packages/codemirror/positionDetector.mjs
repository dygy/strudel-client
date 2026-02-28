/*
positionDetector.mjs - Pattern position detector for autocomplete context
Copyright (C) 2024 Strudel contributors - see <https://codeberg.org/uzu/strudel>
This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License for more details. You should have received a copy of the GNU Affero General Public License along with this program. If not, see <https://www.gnu.org/licenses/>.
*/

/**
 * Pattern position detector for determining completion context
 * 
 * Identifies the exact position within a mini-notation pattern to determine
 * what type of completions are appropriate (sample names, numbers, etc.)
 */
export class PatternPositionDetector {
  /**
   * Detect current position type in pattern
   * @param {string} content - String content
   * @param {number} position - Cursor position
   * @returns {string} Position type: 'sample_name' | 'sample_number' | 'gain' | 'euclidean_param' | 'weight' | 'none'
   */
  detectPositionType(content, position) {
    // Check if inside parentheses (euclidean rhythm parameters)
    if (this._isInsideParentheses(content, position)) {
      return 'euclidean_param';
    }
    
    // Get element boundaries without recursion
    const elementBounds = this._getElementBounds(content, position);
    const elementText = content.slice(elementBounds.start, elementBounds.end);
    const relativePosition = position - elementBounds.start;
    
    // Check if after @ (weight syntax)
    if (this._isAfterWeight(elementText, relativePosition)) {
      return 'weight';
    }
    
    // Check colon syntax position
    const colonInfo = this._analyzeColonPosition(elementText, relativePosition);
    if (colonInfo.inColonSyntax) {
      if (colonInfo.parameterIndex === 0) {
        return 'sample_name';
      } else if (colonInfo.parameterIndex === 1) {
        return 'sample_number';
      } else {
        return 'gain';
      }
    }
    
    // Default: sample name context
    return 'sample_name';
  }
  
  /**
   * Find the current pattern element at position
   * @param {string} content - String content
   * @param {number} position - Cursor position
   * @returns {{start: number, end: number, text: string, type: string}} Current element information
   */
  getCurrentElement(content, position) {
    const bounds = this._getElementBounds(content, position);
    const text = content.slice(bounds.start, bounds.end);
    const type = this.detectPositionType(content, position);
    
    return { start: bounds.start, end: bounds.end, text, type };
  }
  
  /**
   * Get element boundaries without type detection (avoids recursion)
   * @private
   */
  _getElementBounds(content, position) {
    let start = 0;
    let end = content.length;
    
    // Calculate parentheses depth at current position
    let initialParenDepth = 0;
    for (let i = 0; i < position; i++) {
      if (content[i] === '(') initialParenDepth++;
      if (content[i] === ')') initialParenDepth--;
    }
    
    // Find element start by working backwards
    let parenDepth = initialParenDepth;
    for (let i = position - 1; i >= 0; i--) {
      const char = content[i];
      
      // Track parentheses (backwards)
      if (char === ')') parenDepth++;
      if (char === '(') parenDepth--;
      
      // Only consider separators outside parentheses
      if (parenDepth === 0) {
        // Separators mark element boundaries
        if (this._isSeparator(char)) {
          start = i + 1;
          break;
        }
        
        // Opening brackets mark boundaries
        if (char === '[' || char === '<' || char === '{') {
          start = i + 1;
          break;
        }
      }
    }
    
    // Find element end by working forwards
    parenDepth = initialParenDepth;
    for (let i = position; i < content.length; i++) {
      const char = content[i];
      
      // Track parentheses (forwards)
      if (char === '(') parenDepth++;
      if (char === ')') parenDepth--;
      
      // Only consider separators outside parentheses
      if (parenDepth === 0) {
        // Separators mark element boundaries
        if (this._isSeparator(char)) {
          end = i;
          break;
        }
        
        // Closing brackets mark boundaries
        if (char === ']' || char === '>' || char === '}') {
          end = i;
          break;
        }
      }
    }
    
    return { start, end };
  }
  
  /**
   * Check if position is after a pattern separator
   * @param {string} content - String content
   * @param {number} position - Cursor position
   * @returns {boolean} True if after separator
   */
  isAfterSeparator(content, position) {
    if (position === 0) return true;
    
    const prevChar = content[position - 1];
    return this._isSeparator(prevChar) || 
           prevChar === '[' || prevChar === '<' || prevChar === '{';
  }
  
  /**
   * Check if character is a separator
   * @private
   */
  _isSeparator(char) {
    return char === ' ' || char === ',';
  }
  
  /**
   * Check if position is inside nested structure
   * @private
   */
  _isInsideNested(content, position) {
    let depth = 0;
    for (let i = 0; i < position; i++) {
      const char = content[i];
      if (char === '[' || char === '<' || char === '{' || char === '(') {
        depth++;
      } else if (char === ']' || char === '>' || char === '}' || char === ')') {
        depth--;
      }
    }
    return depth > 0;
  }
  
  /**
   * Check if position is inside parentheses
   * @private
   */
  _isInsideParentheses(content, position) {
    let parenDepth = 0;
    
    // Work through the string up to (but not including) position
    // This way, being AT a closing paren still counts as inside
    for (let i = 0; i < position; i++) {
      if (content[i] === '(') {
        parenDepth++;
      } else if (content[i] === ')') {
        parenDepth--;
      }
    }
    
    // Check if current position is an opening paren - if so, we're inside
    if (content[position] === '(') {
      parenDepth++;
    }
    
    return parenDepth > 0;
  }
  
  /**
   * Check if position is after @ (weight syntax)
   * @private
   */
  _isAfterWeight(elementText, relativePosition) {
    // Look backwards in the element for @
    for (let i = relativePosition - 1; i >= 0; i--) {
      if (elementText[i] === '@') {
        return true;
      }
      // Stop if we hit a separator or colon
      if (this._isSeparator(elementText[i]) || elementText[i] === ':') {
        return false;
      }
    }
    return false;
  }
  
  /**
   * Analyze colon syntax position
   * @private
   */
  _analyzeColonPosition(elementText, relativePosition) {
    // Count colons before position
    const colons = [];
    for (let i = 0; i < relativePosition; i++) {
      if (elementText[i] === ':') {
        colons.push(i);
      }
    }
    
    if (colons.length === 0) {
      return {
        inColonSyntax: false,
        parameterIndex: 0
      };
    }
    
    // Determine parameter index based on colon count
    // Format: sample:n:gain
    // 0 colons = sample (index 0)
    // 1 colon = n (index 1)
    // 2+ colons = gain (index 2)
    const parameterIndex = Math.min(colons.length, 2);
    
    return {
      inColonSyntax: true,
      parameterIndex
    };
  }
}
