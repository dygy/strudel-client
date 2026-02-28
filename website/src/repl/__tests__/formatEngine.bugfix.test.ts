/**
 * Bug Condition Exploration Test for Prettier Strudel DSL Formatting
 * 
 * This test explores the bug condition where arrange() and stack() functions
 * with multiple arguments are NOT formatted as multi-line when they should be.
 * 
 * CRITICAL: This test is EXPECTED TO FAIL on unfixed code - failure confirms the bug exists.
 * DO NOT attempt to fix the test or the code when it fails.
 * 
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import { FormatEngine, type PrettierOptions } from '../formatEngine';

describe('Bug Condition Exploration: arrange() and stack() Multi-line Formatting', () => {
  let formatEngine: FormatEngine;
  let defaultOptions: PrettierOptions;

  beforeEach(() => {
    formatEngine = FormatEngine.getInstance();
    defaultOptions = {
      tabWidth: 2,
      useTabs: false,
      semi: true,
      singleQuote: true,
      quoteProps: 'as-needed',
      trailingComma: 'es5',
      bracketSpacing: true,
      arrowParens: 'always',
      printWidth: 80,
    };
  });

  /**
   * Helper function to check if a function call is formatted as multi-line
   */
  function isMultiLineFormatted(code: string, functionName: string): boolean {
    // Check if the function call spans multiple lines with proper formatting:
    // - Opening parenthesis on same line as function name
    // - Each argument on a new indented line
    // - Closing parenthesis on its own line
    
    const functionPattern = new RegExp(`${functionName}\\s*\\(`);
    if (!functionPattern.test(code)) {
      return false;
    }

    // Split into lines and find the function call
    const lines = code.split('\n');
    let functionLineIndex = -1;
    
    for (let i = 0; i < lines.length; i++) {
      if (functionPattern.test(lines[i])) {
        functionLineIndex = i;
        break;
      }
    }

    if (functionLineIndex === -1) {
      return false;
    }

    // Check if there are multiple lines after the function call line
    // and if the closing parenthesis is on its own line
    let hasMultipleArgumentLines = false;
    let hasClosingParenOnOwnLine = false;
    
    for (let i = functionLineIndex + 1; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Check for argument lines (should be indented and not just closing paren)
      if (line && !line.startsWith(')') && line !== '') {
        hasMultipleArgumentLines = true;
      }
      
      // Check for closing parenthesis on its own line
      if (line === ')' || line === '),') {
        hasClosingParenOnOwnLine = true;
        break;
      }
      
      // If we hit another function or statement, stop looking
      if (line.includes('function') || line.includes('const') || line.includes('let')) {
        break;
      }
    }

    return hasMultipleArgumentLines && hasClosingParenOnOwnLine;
  }

  /**
   * Helper function to check if each argument is on a new line
   */
  function eachArgumentOnNewLine(code: string, functionName: string): boolean {
    const lines = code.split('\n');
    const functionPattern = new RegExp(`${functionName}\\s*\\(`);
    
    let functionLineIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      if (functionPattern.test(lines[i])) {
        functionLineIndex = i;
        break;
      }
    }

    if (functionLineIndex === -1) {
      return false;
    }

    // Count argument lines (lines between function call and closing paren)
    let argumentLineCount = 0;
    for (let i = functionLineIndex + 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line === ')' || line === '),') {
        break;
      }
      if (line && line !== '') {
        argumentLineCount++;
      }
    }

    // Should have at least 2 argument lines for multi-argument functions
    return argumentLineCount >= 2;
  }

  describe('Property 1: Fault Condition - Multi-line Formatting for arrange() and stack()', () => {
    it('should format long arrange() with 2 array arguments as multi-line', async () => {
      // Test case from design document
      const code = `arrange([s("bd sd"), s("hh*4")], [s("bass:0 bass:1"), s("pad:2")])`;
      
      const result = await formatEngine.formatCode(code, defaultOptions);
      
      expect(result.success).toBe(true);
      expect(result.formattedCode).toBeDefined();
      
      const formatted = result.formattedCode!;
      
      // EXPECTED TO FAIL: The bug is that arrange() remains on a single line
      // When fixed, this should format as:
      // arrange(
      //   [s("bd sd"), s("hh*4")],
      //   [s("bass:0 bass:1"), s("pad:2")]
      // )
      
      expect(isMultiLineFormatted(formatted, 'arrange')).toBe(true);
      expect(eachArgumentOnNewLine(formatted, 'arrange')).toBe(true);
      
      // Verify closing parenthesis is on its own line
      expect(formatted).toMatch(/\n\s*\)/);
    });

    it('should format stack() with 3 pattern arguments as multi-line', async () => {
      // Test case from design document
      const code = `stack(s("bd sd hh"), s("bass:0 bass:1 bass:2"), s("pad:0").slow(2))`;
      
      const result = await formatEngine.formatCode(code, defaultOptions);
      
      expect(result.success).toBe(true);
      expect(result.formattedCode).toBeDefined();
      
      const formatted = result.formattedCode!;
      
      // EXPECTED TO FAIL: The bug is that stack() remains on a single line
      // When fixed, this should format as:
      // stack(
      //   s("bd sd hh"),
      //   s("bass:0 bass:1 bass:2"),
      //   s("pad:0").slow(2)
      // )
      
      expect(isMultiLineFormatted(formatted, 'stack')).toBe(true);
      expect(eachArgumentOnNewLine(formatted, 'stack')).toBe(true);
      
      // Verify closing parenthesis is on its own line
      expect(formatted).toMatch(/\n\s*\)/);
    });

    it('should format chained .stack() method with multiple arguments as multi-line', async () => {
      // Test case from design document
      const code = `pattern.stack(s("bd"), s("hh*4"), s("bass:0"))`;
      
      const result = await formatEngine.formatCode(code, defaultOptions);
      
      expect(result.success).toBe(true);
      expect(result.formattedCode).toBeDefined();
      
      const formatted = result.formattedCode!;
      
      // EXPECTED TO FAIL: The bug is that .stack() remains on a single line
      // When fixed, this should format as:
      // pattern.stack(
      //   s("bd"),
      //   s("hh*4"),
      //   s("bass:0")
      // )
      
      expect(isMultiLineFormatted(formatted, 'stack')).toBe(true);
      expect(eachArgumentOnNewLine(formatted, 'stack')).toBe(true);
      
      // Verify closing parenthesis is on its own line
      expect(formatted).toMatch(/\n\s*\)/);
    });

    it('should format arrange() exceeding print width as multi-line', async () => {
      // Create a long arrange() call that exceeds 80 characters
      const code = `arrange([s("bd sd cp"), s("hh*8 oh*4")], [s("bass:0 bass:1 bass:2"), s("pad:0 pad:1")])`;
      
      expect(code.length).toBeGreaterThan(80);
      
      const result = await formatEngine.formatCode(code, defaultOptions);
      
      expect(result.success).toBe(true);
      expect(result.formattedCode).toBeDefined();
      
      const formatted = result.formattedCode!;
      
      // EXPECTED TO FAIL: The bug is that arrange() remains on a single line even when exceeding print width
      expect(isMultiLineFormatted(formatted, 'arrange')).toBe(true);
      expect(eachArgumentOnNewLine(formatted, 'arrange')).toBe(true);
    });

    it('should format stack() exceeding print width as multi-line', async () => {
      // Create a long stack() call that exceeds 80 characters
      const code = `stack(s("bd sd hh cp"), s("bass:0 bass:1 bass:2 bass:3"), s("pad:0 pad:1").slow(2))`;
      
      expect(code.length).toBeGreaterThan(80);
      
      const result = await formatEngine.formatCode(code, defaultOptions);
      
      expect(result.success).toBe(true);
      expect(result.formattedCode).toBeDefined();
      
      const formatted = result.formattedCode!;
      
      // EXPECTED TO FAIL: The bug is that stack() remains on a single line even when exceeding print width
      expect(isMultiLineFormatted(formatted, 'stack')).toBe(true);
      expect(eachArgumentOnNewLine(formatted, 'stack')).toBe(true);
    });
  });

  describe('Property-Based Test: arrange() and stack() with multiple arguments', () => {
    it('should format any arrange() with 2+ arguments as multi-line', () => {
      fc.assert(
        fc.property(
          // Generate arrange() calls with 2-4 arguments
          fc.integer({ min: 2, max: 4 }),
          fc.array(fc.constantFrom('bd', 'sd', 'hh', 'cp', 'oh'), { minLength: 1, maxLength: 4 }),
          (argCount, sounds) => {
            // Build arrange() call with multiple array arguments
            const args = Array.from({ length: argCount }, (_, i) => {
              const soundPattern = sounds.slice(0, 2).join(' ');
              return `[s("${soundPattern}")]`;
            });
            
            const code = `arrange(${args.join(', ')})`;
            
            // Format the code
            return formatEngine.formatCode(code, defaultOptions).then(result => {
              expect(result.success).toBe(true);
              expect(result.formattedCode).toBeDefined();
              
              const formatted = result.formattedCode!;
              
              // EXPECTED TO FAIL: arrange() with multiple arguments should be multi-line
              expect(isMultiLineFormatted(formatted, 'arrange')).toBe(true);
            });
          }
        ),
        { numRuns: 50 } // Run 50 iterations to find counterexamples
      );
    });

    it('should format any stack() with 2+ arguments as multi-line', () => {
      fc.assert(
        fc.property(
          // Generate stack() calls with 2-4 arguments
          fc.integer({ min: 2, max: 4 }),
          fc.array(fc.constantFrom('bd', 'sd', 'hh', 'bass:0', 'pad:0'), { minLength: 1, maxLength: 4 }),
          (argCount, sounds) => {
            // Build stack() call with multiple pattern arguments
            const args = Array.from({ length: argCount }, (_, i) => {
              const soundPattern = sounds[i % sounds.length];
              return `s("${soundPattern}")`;
            });
            
            const code = `stack(${args.join(', ')})`;
            
            // Format the code
            return formatEngine.formatCode(code, defaultOptions).then(result => {
              expect(result.success).toBe(true);
              expect(result.formattedCode).toBeDefined();
              
              const formatted = result.formattedCode!;
              
              // EXPECTED TO FAIL: stack() with multiple arguments should be multi-line
              expect(isMultiLineFormatted(formatted, 'stack')).toBe(true);
            });
          }
        ),
        { numRuns: 50 } // Run 50 iterations to find counterexamples
      );
    });
  });

  describe('Property 2: Preservation - Existing Formatting Behavior', () => {
    /**
     * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7
     * 
     * These tests verify that the fix does NOT break existing formatting behavior
     * for code that doesn't involve multi-argument arrange() or stack() calls.
     * 
     * EXPECTED OUTCOME: All tests PASS on unfixed code (baseline behavior)
     */

    describe('Single-argument preservation (Requirement 3.1)', () => {
      it('should keep single-argument arrange() on one line', async () => {
        const code = `arrange([s("bd")])`;
        
        const result = await formatEngine.formatCode(code, defaultOptions);
        
        expect(result.success).toBe(true);
        expect(result.formattedCode).toBeDefined();
        
        const formatted = result.formattedCode!;
        
        // Single argument should remain on one line
        expect(formatted.split('\n').length).toBe(1);
        expect(formatted).toContain('arrange([s("bd")])');
      });

      it('should keep single-argument stack() on one line', async () => {
        const code = `stack(s("bd sd hh"))`;
        
        const result = await formatEngine.formatCode(code, defaultOptions);
        
        expect(result.success).toBe(true);
        expect(result.formattedCode).toBeDefined();
        
        const formatted = result.formattedCode!;
        
        // Single argument should remain on one line (may have trailing newline and semicolon)
        const lines = formatted.trim().split('\n');
        expect(lines.length).toBe(1);
        expect(formatted).toContain('stack(s(');
      });

      it('should keep single-argument chained .stack() on one line', async () => {
        const code = `pattern.stack(s("bd"))`;
        
        const result = await formatEngine.formatCode(code, defaultOptions);
        
        expect(result.success).toBe(true);
        expect(result.formattedCode).toBeDefined();
        
        const formatted = result.formattedCode!;
        
        // Single argument should remain on one line (may have trailing newline and semicolon)
        const lines = formatted.trim().split('\n');
        expect(lines.length).toBe(1);
        expect(formatted).toContain('pattern.stack(s(');
      });
    });

    describe('Other DSL functions preservation (Requirement 3.3)', () => {
      it('should format .sound().gain().lpf() method chains correctly', async () => {
        const code = `s("bd sd").sound("808").gain(0.8).lpf(2000)`;
        
        const result = await formatEngine.formatCode(code, defaultOptions);
        
        expect(result.success).toBe(true);
        expect(result.formattedCode).toBeDefined();
        
        const formatted = result.formattedCode!;
        
        // Should preserve method chaining
        expect(formatted).toContain('.sound(');
        expect(formatted).toContain('.gain(');
        expect(formatted).toContain('.lpf(');
      });

      it('should format .note().scale().slow() method chains correctly', async () => {
        const code = `note("c e g").scale("C:major").slow(2)`;
        
        const result = await formatEngine.formatCode(code, defaultOptions);
        
        expect(result.success).toBe(true);
        expect(result.formattedCode).toBeDefined();
        
        const formatted = result.formattedCode!;
        
        // Should preserve method chaining
        expect(formatted).toContain('.scale(');
        expect(formatted).toContain('.slow(');
      });

      it('should format .fast().rev().sometimes() method chains correctly', async () => {
        const code = `s("hh*8").fast(2).rev().sometimes(x => x.gain(0.5))`;
        
        const result = await formatEngine.formatCode(code, defaultOptions);
        
        expect(result.success).toBe(true);
        expect(result.formattedCode).toBeDefined();
        
        const formatted = result.formattedCode!;
        
        // Should preserve method chaining and arrow functions
        expect(formatted).toContain('.fast(');
        expect(formatted).toContain('.rev(');
        expect(formatted).toContain('.sometimes(');
      });
    });

    describe('Mini notation preservation (Requirement 3.5)', () => {
      it('should preserve "bd sd hh" patterns', async () => {
        const code = `s("bd sd hh")`;
        
        const result = await formatEngine.formatCode(code, defaultOptions);
        
        expect(result.success).toBe(true);
        expect(result.formattedCode).toBeDefined();
        
        const formatted = result.formattedCode!;
        
        // Mini notation should be preserved (formatter may convert quotes)
        expect(formatted).toMatch(/['"]bd sd hh['"]/);
      });

      it('should preserve "<0 1 2>" patterns', async () => {
        const code = `note("<0 1 2>")`;
        
        const result = await formatEngine.formatCode(code, defaultOptions);
        
        expect(result.success).toBe(true);
        expect(result.formattedCode).toBeDefined();
        
        const formatted = result.formattedCode!;
        
        // Mini notation should be preserved exactly
        expect(formatted).toContain('"<0 1 2>"');
      });

      it('should preserve "[a b c]" patterns', async () => {
        const code = `note("[c e g]")`;
        
        const result = await formatEngine.formatCode(code, defaultOptions);
        
        expect(result.success).toBe(true);
        expect(result.formattedCode).toBeDefined();
        
        const formatted = result.formattedCode!;
        
        // Mini notation should be preserved exactly
        expect(formatted).toContain('"[c e g]"');
      });

      it('should preserve complex mini notation patterns', async () => {
        const code = `s("bd*4 [sd cp] hh*8 <oh ch>")`;
        
        const result = await formatEngine.formatCode(code, defaultOptions);
        
        expect(result.success).toBe(true);
        expect(result.formattedCode).toBeDefined();
        
        const formatted = result.formattedCode!;
        
        // Complex mini notation should be preserved exactly
        expect(formatted).toContain('"bd*4 [sd cp] hh*8 <oh ch>"');
      });
    });

    describe('Standard JavaScript preservation (Requirement 3.4)', () => {
      it('should format function declarations correctly', async () => {
        const code = `function myPattern() { return s("bd sd"); }`;
        
        const result = await formatEngine.formatCode(code, defaultOptions);
        
        expect(result.success).toBe(true);
        expect(result.formattedCode).toBeDefined();
        
        const formatted = result.formattedCode!;
        
        // Should preserve function structure
        expect(formatted).toContain('function myPattern()');
        expect(formatted).toContain('return');
      });

      it('should format variable declarations correctly', async () => {
        const code = `const pattern = s("bd sd"); let gain = 0.8;`;
        
        const result = await formatEngine.formatCode(code, defaultOptions);
        
        expect(result.success).toBe(true);
        expect(result.formattedCode).toBeDefined();
        
        const formatted = result.formattedCode!;
        
        // Should preserve variable declarations
        expect(formatted).toContain('const pattern');
        expect(formatted).toContain('let gain');
      });

      it('should format loops correctly', async () => {
        const code = `for (let i = 0; i < 4; i++) { s("bd").gain(i * 0.25); }`;
        
        const result = await formatEngine.formatCode(code, defaultOptions);
        
        expect(result.success).toBe(true);
        expect(result.formattedCode).toBeDefined();
        
        const formatted = result.formattedCode!;
        
        // Should preserve loop structure
        expect(formatted).toContain('for');
        expect(formatted).toContain('i < 4');
      });
    });

    describe('String literals preservation (Requirement 3.7)', () => {
      it('should preserve URLs in strings', async () => {
        const code = `samples("https://example.com/samples/bd.wav")`;
        
        const result = await formatEngine.formatCode(code, defaultOptions);
        
        expect(result.success).toBe(true);
        expect(result.formattedCode).toBeDefined();
        
        const formatted = result.formattedCode!;
        
        // URLs should be preserved exactly
        expect(formatted).toContain('"https://example.com/samples/bd.wav"');
      });

      it('should preserve file paths in strings', async () => {
        const code = `samples("/path/to/samples/kick.wav")`;
        
        const result = await formatEngine.formatCode(code, defaultOptions);
        
        expect(result.success).toBe(true);
        expect(result.formattedCode).toBeDefined();
        
        const formatted = result.formattedCode!;
        
        // File paths should be preserved exactly
        expect(formatted).toContain('"/path/to/samples/kick.wav"');
      });
    });

    describe('Method chaining preservation (Requirement 3.6)', () => {
      it('should format long method chains correctly', async () => {
        const code = `s("bd").gain(0.8).lpf(2000).room(0.5).delay(0.25).pan(0.5)`;
        
        const result = await formatEngine.formatCode(code, defaultOptions);
        
        expect(result.success).toBe(true);
        expect(result.formattedCode).toBeDefined();
        
        const formatted = result.formattedCode!;
        
        // Should preserve all methods in the chain
        expect(formatted).toContain('.gain(');
        expect(formatted).toContain('.lpf(');
        expect(formatted).toContain('.room(');
        expect(formatted).toContain('.delay(');
        expect(formatted).toContain('.pan(');
      });
    });

    describe('Property-Based Preservation Tests', () => {
      it('should preserve formatting for any single-argument arrange() call', async () => {
        await fc.assert(
          fc.asyncProperty(
            fc.constantFrom('bd', 'sd', 'hh', 'cp', 'oh'),
            async (sound) => {
              const code = `arrange([s("${sound}")])`;
              
              const result = await formatEngine.formatCode(code, defaultOptions);
              
              expect(result.success).toBe(true);
              expect(result.formattedCode).toBeDefined();
              
              const formatted = result.formattedCode!;
              
              // Single argument should remain on one line (may have trailing newline)
              const lines = formatted.trim().split('\n');
              expect(lines.length).toBe(1);
            }
          ),
          { numRuns: 20 }
        );
      });

      it('should preserve formatting for any single-argument stack() call', async () => {
        await fc.assert(
          fc.asyncProperty(
            fc.constantFrom('bd', 'sd', 'hh', 'bass:0', 'pad:0'),
            async (sound) => {
              const code = `stack(s("${sound}"))`;
              
              const result = await formatEngine.formatCode(code, defaultOptions);
              
              expect(result.success).toBe(true);
              expect(result.formattedCode).toBeDefined();
              
              const formatted = result.formattedCode!;
              
              // Single argument should remain on one line (may have trailing newline)
              const lines = formatted.trim().split('\n');
              expect(lines.length).toBe(1);
            }
          ),
          { numRuns: 20 }
        );
      });

      it('should preserve mini notation patterns in any DSL function', async () => {
        await fc.assert(
          fc.asyncProperty(
            fc.constantFrom('bd sd hh', '<0 1 2>', '[c e g]', 'bd*4 sd*2'),
            fc.constantFrom('s', 'note', 'sound'),
            async (pattern, func) => {
              const code = `${func}("${pattern}")`;
              
              const result = await formatEngine.formatCode(code, defaultOptions);
              
              expect(result.success).toBe(true);
              expect(result.formattedCode).toBeDefined();
              
              const formatted = result.formattedCode!;
              
              // Mini notation should be preserved (formatter may convert quotes)
              expect(formatted).toMatch(new RegExp(`['"]${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`));
            }
          ),
          { numRuns: 30 }
        );
      });

      it('should preserve method chaining for any DSL methods', async () => {
        await fc.assert(
          fc.asyncProperty(
            fc.constantFrom('gain', 'lpf', 'room', 'delay', 'pan', 'slow', 'fast'),
            fc.float({ min: 0, max: 1 }),
            async (method, value) => {
              const code = `s("bd").${method}(${value})`;
              
              const result = await formatEngine.formatCode(code, defaultOptions);
              
              expect(result.success).toBe(true);
              expect(result.formattedCode).toBeDefined();
              
              const formatted = result.formattedCode!;
              
              // Method should be preserved
              expect(formatted).toContain(`.${method}(`);
            }
          ),
          { numRuns: 30 }
        );
      });
    });
  });
});
