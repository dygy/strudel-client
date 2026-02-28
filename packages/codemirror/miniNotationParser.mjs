/*
miniNotationParser.mjs - Mini-notation context parser for autocomplete
Copyright (C) 2024 Strudel contributors - see <https://codeberg.org/uzu/strudel>
This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License for more details. You should have received a copy of the GNU Affero General Public License along with this program. If not, see <https://www.gnu.org/licenses/>.
*/

/**
 * Mini-notation context parser for intelligent autocomplete
 * 
 * Parses Strudel's mini-notation syntax to identify pattern elements,
 * separators, and the current cursor context for providing appropriate completions.
 */
export class MiniNotationContextParser {
  /**
   * Parse string context to find current pattern element
   * @param {string} stringContent - Content inside the string quotes
   * @param {number} cursorOffset - Cursor position relative to string start
   * @returns {PatternContext} Context information for completion
   */
  parseContext(stringContent, cursorOffset) {
    // Find all separators in the content
    const separators = this.findSeparators(stringContent);
    
    // Analyze colon context
    const colonContext = this.analyzeColonContext(stringContent, cursorOffset);
    
    // Find the current element boundaries
    const { elementStart, elementEnd } = this._findElementBoundaries(
      stringContent,
      cursorOffset,
      separators,
      colonContext
    );
    
    // Extract the fragment being typed
    const fragment = stringContent.slice(elementStart, cursorOffset);
    
    // Determine context type based on position and syntax
    const contextType = this._determineContextType(
      stringContent,
      cursorOffset,
      colonContext,
      elementStart
    );
    
    // Calculate nesting depth
    const nestingDepth = this._calculateNestingDepth(stringContent, cursorOffset);
    
    return {
      elementStart,
      elementEnd,
      fragment,
      contextType,
      inColonSyntax: colonContext.inColonSyntax,
      colonPosition: colonContext.colonPosition,
      parameterIndex: colonContext.parameterIndex,
      nestingDepth
    };
  }
  
  /**
   * Identify pattern separators and boundaries
   * @param {string} content - String content to analyze
   * @returns {number[]} Array of separator positions at top level only
   */
  findSeparators(content) {
    const separators = [];
    let nestingDepth = 0;
    let inParens = false;
    
    for (let i = 0; i < content.length; i++) {
      const char = content[i];
      
      // Track nesting depth
      if (char === '[' || char === '<' || char === '{') {
        nestingDepth++;
      } else if (char === ']' || char === '>' || char === '}') {
        nestingDepth--;
      } else if (char === '(') {
        inParens = true;
      } else if (char === ')') {
        inParens = false;
      }
      
      // Only consider separators at depth 0 and outside parentheses
      if (nestingDepth === 0 && !inParens) {
        if (char === ' ' || char === ',') {
          separators.push(i);
        }
      }
      
      // Commas inside braces are polymeter separators (depth 1)
      if (nestingDepth === 1 && content[i - 1] === '{' && char === ',') {
        separators.push(i);
      }
    }
    
    return separators;
  }
  
  /**
   * Find all separators including those inside nested structures
   * @private
   * @param {string} content - String content to analyze
   * @returns {number[]} Array of all separator positions
   */
  _findAllSeparators(content) {
    const separators = [];
    let inParens = false;
    
    for (let i = 0; i < content.length; i++) {
      const char = content[i];
      
      // Track parentheses
      if (char === '(') {
        inParens = true;
      } else if (char === ')') {
        inParens = false;
      }
      
      // Find all separators except those in parentheses
      if (!inParens && (char === ' ' || char === ',')) {
        separators.push(i);
      }
    }
    
    return separators;
  }
  
  /**
   * Determine if position is in colon syntax context
   * @param {string} content - String content
   * @param {number} position - Current position
   * @returns {ColonContext} Information about colon syntax
   */
  analyzeColonContext(content, position) {
    // Find the current element start (work backwards to last separator)
    let elementStart = 0;
    let nestingDepth = 0;
    let inParens = false;
    
    for (let i = position - 1; i >= 0; i--) {
      const char = content[i];
      
      // Track nesting (backwards)
      if (char === ']' || char === '>' || char === '}') {
        nestingDepth++;
      } else if (char === '[' || char === '<' || char === '{') {
        nestingDepth--;
      } else if (char === ')') {
        inParens = true;
      } else if (char === '(') {
        inParens = false;
      }
      
      // Found a separator at depth 0
      if (nestingDepth === 0 && !inParens && (char === ' ' || char === ',')) {
        elementStart = i + 1;
        break;
      }
    }
    
    // Extract the current element
    const element = content.slice(elementStart, position);
    
    // Count colons in the element
    const colons = [];
    for (let i = 0; i < element.length; i++) {
      if (element[i] === ':') {
        colons.push(elementStart + i);
      }
    }
    
    if (colons.length === 0) {
      return {
        inColonSyntax: false,
        colonPosition: -1,
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
      colonPosition: colons[colons.length - 1],
      parameterIndex
    };
  }
  
  /**
   * Find element boundaries around cursor position
   * @private
   */
  _findElementBoundaries(content, position, separators, colonContext) {
    // Use all separators (including nested ones) for element boundary detection
    const allSeparators = this._findAllSeparators(content);
    
    // If in colon syntax, element continues across colons
    if (colonContext.inColonSyntax) {
      // Find element start (last separator before first colon)
      let elementStart = 0;
      for (let i = allSeparators.length - 1; i >= 0; i--) {
        if (allSeparators[i] < colonContext.colonPosition) {
          elementStart = allSeparators[i] + 1;
          break;
        }
      }
      
      // Find element end (next separator after position)
      let elementEnd = content.length;
      for (const sep of allSeparators) {
        if (sep > position) {
          elementEnd = sep;
          break;
        }
      }
      
      return { elementStart, elementEnd };
    }
    
    // Not in colon syntax - find boundaries using separators and brackets
    let elementStart = position;
    let elementEnd = content.length;
    
    // Work backwards to find element start
    // Priority: separators first, then opening brackets
    let foundSeparator = false;
    for (let i = position - 1; i >= 0; i--) {
      const char = content[i];
      
      // Check if this position is a separator (highest priority)
      if (allSeparators.includes(i)) {
        elementStart = i + 1;
        foundSeparator = true;
        break;
      }
      
      // Opening brackets mark boundaries only if no separator found yet
      if (!foundSeparator && (char === '[' || char === '<' || char === '{')) {
        elementStart = i + 1;
        break;
      }
      
      // If we reach the start
      if (i === 0) {
        elementStart = 0;
        break;
      }
    }
    
    // Work forwards to find element end
    for (let i = position; i < content.length; i++) {
      const char = content[i];
      
      // Check if this position is a separator
      if (allSeparators.includes(i)) {
        elementEnd = i;
        break;
      }
      
      // Closing brackets also mark element boundaries
      if (char === ']' || char === '>' || char === '}') {
        elementEnd = i;
        break;
      }
    }
    
    return { elementStart, elementEnd };
  }
  
  /**
   * Determine context type based on position
   * @private
   */
  _determineContextType(content, position, colonContext, elementStart) {
    // Check if inside parentheses (euclidean rhythm parameters)
    let parenDepth = 0;
    for (let i = elementStart; i < position; i++) {
      if (content[i] === '(') parenDepth++;
      if (content[i] === ')') parenDepth--;
    }
    if (parenDepth > 0) {
      return 'euclidean_param';
    }
    
    // Check if after @ (weight syntax)
    for (let i = position - 1; i >= elementStart; i--) {
      if (content[i] === '@') {
        return 'weight';
      }
      if (content[i] === ' ' || content[i] === ',') {
        break;
      }
    }
    
    // Check colon syntax position
    if (colonContext.inColonSyntax) {
      if (colonContext.parameterIndex === 0) {
        return 'sample_name';
      } else if (colonContext.parameterIndex === 1) {
        return 'sample_number';
      } else {
        return 'gain';
      }
    }
    
    // Default: sample name context
    return 'sample_name';
  }
  
  /**
   * Calculate nesting depth at position
   * @private
   */
  _calculateNestingDepth(content, position) {
    let depth = 0;
    for (let i = 0; i < position; i++) {
      const char = content[i];
      if (char === '[' || char === '<' || char === '{') {
        depth++;
      } else if (char === ']' || char === '>' || char === '}') {
        depth--;
      }
    }
    return Math.max(0, depth);
  }
}
