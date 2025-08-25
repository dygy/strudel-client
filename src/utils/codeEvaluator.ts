/* eslint-disable @typescript-eslint/no-explicit-any */
import { strudelEngine } from '../audio/StrudelEngine';

interface EvaluationResult {
  success: boolean;
  error?: string;
  warnings?: string[];
}

interface EvaluationContext {
  sound: any;
  note: any;
  strudelEngine: typeof strudelEngine;
}

// Safe code evaluation with sandboxing
export class CodeEvaluator {
  private context: EvaluationContext;

  constructor() {
    this.context = {
      sound: (window as any).sound,
      note: (window as any).note,
      strudelEngine,
    };
  }

  async evaluateAudioCode(code: string): Promise<EvaluationResult> {
    try {
      // Basic syntax validation
      const syntaxCheck = this.validateSyntax(code);
      if (!syntaxCheck.success) {
        return syntaxCheck;
      }

      // Security check - prevent dangerous operations
      const securityCheck = this.validateSecurity(code);
      if (!securityCheck.success) {
        return securityCheck;
      }

      // Execute the code in a controlled environment
      await this.executeInSandbox(code);

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown evaluation error',
      };
    }
  }

  async evaluateVisualCode(code: string): Promise<EvaluationResult> {
    try {
      // For now, just validate syntax for Hydra code
      const syntaxCheck = this.validateSyntax(code);
      if (!syntaxCheck.success) {
        return syntaxCheck;
      }

      // TODO: Implement Hydra code execution
      console.log('Visual code evaluation not yet implemented:', code);

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown evaluation error',
      };
    }
  }

  private validateSyntax(code: string): EvaluationResult {
    try {
      // Basic JavaScript syntax validation
      new Function(code);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: `Syntax Error: ${error instanceof Error ? error.message : 'Invalid syntax'}`,
      };
    }
  }

  private validateSecurity(code: string): EvaluationResult {
    // List of dangerous patterns to block
    const dangerousPatterns = [
      /eval\s*\(/,
      /Function\s*\(/,
      /setTimeout\s*\(/,
      /setInterval\s*\(/,
      /XMLHttpRequest/,
      /fetch\s*\(/,
      /import\s*\(/,
      /require\s*\(/,
      /process\./,
      /global\./,
      /window\./,
      /document\./,
      /localStorage/,
      /sessionStorage/,
      /indexedDB/,
      /navigator\./,
      /location\./,
      /history\./,
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(code)) {
        return {
          success: false,
          error: `Security Error: Potentially dangerous operation detected: ${pattern.source}`,
        };
      }
    }

    return { success: true };
  }

  private async executeInSandbox(code: string): Promise<void> {
    // Create a sandboxed execution environment
    const sandbox = {
      sound: this.context.sound,
      note: this.context.note,
      console: {
        log: (...args: any[]) => console.log('[Strudel]', ...args),
        warn: (...args: any[]) => console.warn('[Strudel]', ...args),
        error: (...args: any[]) => console.error('[Strudel]', ...args),
      },
    };

    // Create a function with the sandboxed context
    const sandboxedFunction = new Function(
      ...Object.keys(sandbox),
      `
      "use strict";
      ${code}
      `
    );

    // Execute with the sandbox context
    await sandboxedFunction(...Object.values(sandbox));
  }

  // Pattern compilation and caching
  private patternCache = new Map<string, any>();

  compilePattern(code: string): any {
    // Check cache first
    if (this.patternCache.has(code)) {
      return this.patternCache.get(code);
    }

    try {
      // Simple pattern compilation
      const compiled = this.parseStrudelPattern(code);
      this.patternCache.set(code, compiled);
      return compiled;
    } catch (error) {
      console.error('Pattern compilation error:', error);
      return null;
    }
  }

  private parseStrudelPattern(code: string): any {
    // This is a simplified pattern parser
    // In a real implementation, this would be much more sophisticated
    
    const patterns: any[] = [];
    
    // Extract sound patterns
    const soundMatches = code.match(/sound\s*\(\s*["']([^"']+)["']\s*\)/g);
    if (soundMatches) {
      soundMatches.forEach(match => {
        const soundPattern = match.match(/["']([^"']+)["']/)?.[1];
        if (soundPattern) {
          patterns.push({
            type: 'sound',
            pattern: soundPattern,
            sounds: soundPattern.split(/\s+/).filter(s => s && s !== '~'),
          });
        }
      });
    }

    // Extract note patterns
    const noteMatches = code.match(/note\s*\(\s*["']([^"']+)["']\s*\)/g);
    if (noteMatches) {
      noteMatches.forEach(match => {
        const notePattern = match.match(/["']([^"']+)["']/)?.[1];
        if (notePattern) {
          patterns.push({
            type: 'note',
            pattern: notePattern,
            notes: notePattern.split(/\s+/).filter(n => n && n !== '~'),
          });
        }
      });
    }

    return {
      patterns,
      code,
      timestamp: Date.now(),
    };
  }

  clearCache() {
    this.patternCache.clear();
  }

  getCacheSize(): number {
    return this.patternCache.size;
  }
}

// Singleton instance
export const codeEvaluator = new CodeEvaluator();

// Helper functions for real-time evaluation
export const evaluateAudioCode = (code: string) => {
  return codeEvaluator.evaluateAudioCode(code);
};

export const evaluateVisualCode = (code: string) => {
  return codeEvaluator.evaluateVisualCode(code);
};

export const compilePattern = (code: string) => {
  return codeEvaluator.compilePattern(code);
};