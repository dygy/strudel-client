/**
 * Debug test to see actual formatter output
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { FormatEngine, type PrettierOptions } from '../formatEngine';

describe('Debug Format Output', () => {
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

  it('should show actual output for arrange()', async () => {
    const code = `arrange([s("bd sd"), s("hh*4")], [s("bass:0 bass:1"), s("pad:2")])`;
    
    const result = await formatEngine.formatCode(code, defaultOptions);
    
    // Also test the formatCompositionFunctions directly
    const testFormatComposition = (input: string) => {
      const functionPattern = /(\b(arrange|stack)|\.stack)\s*\(/g;
      const matches = [];
      let match;
      while ((match = functionPattern.exec(input)) !== null) {
        matches.push({ match: match[0], index: match.index });
      }
      return matches;
    };
    
    const matches = testFormatComposition(result.formattedCode || '');
    
    const fs = await import('fs');
    const output = `=== INPUT ===\n${code}\n\n=== OUTPUT ===\n${result.formattedCode}\n\n=== LINES ===\n${JSON.stringify(result.formattedCode?.split('\n'), null, 2)}\n\n=== MATCHES ===\n${JSON.stringify(matches, null, 2)}`;
    fs.writeFileSync('/tmp/format-output.txt', output);
    
    expect(result.success).toBe(true);
  });
});
