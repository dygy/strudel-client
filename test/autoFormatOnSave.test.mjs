import { describe, it, expect, beforeEach, vi } from 'vitest';
import fc from 'fast-check';

// Mock prettier and format engine
const mockFormatEngine = {
  formatCode: vi.fn(),
  validateSyntax: vi.fn()
};

const mockAutoFormatOnSave = vi.fn();

// Mock settings
const createMockSettings = (overrides = {}) => ({
  isPrettierEnabled: true,
  prettierAutoFormatOnSave: true,
  prettierTabWidth: 2,
  prettierUseTabs: false,
  prettierSemi: true,
  prettierSingleQuote: false,
  prettierQuoteProps: 'as-needed',
  prettierTrailingComma: 'es5',
  prettierBracketSpacing: true,
  prettierArrowParens: 'always',
  prettierPrintWidth: 80,
  ...overrides
});

// Mock save function that includes auto-format logic
const createMockSaveFunction = (settings) => {
  return async (code, showToast = true) => {
    let codeToSave = code;
    
    // Auto-format on save if enabled and code is not empty/whitespace
    if (settings?.isPrettierEnabled && settings?.prettierAutoFormatOnSave && code.trim().length > 0) {
      try {
        const formatResult = await mockAutoFormatOnSave(code, settings);
        
        if (formatResult.success && formatResult.formattedCode) {
          codeToSave = formatResult.formattedCode;
        } else if (formatResult.error) {
          // Continue with original code if formatting fails
          console.warn('Auto-format failed:', formatResult.error);
        }
      } catch (error) {
        // Handle formatting exceptions gracefully
        console.warn('Auto-format exception:', error.message);
      }
    }
    
    return {
      success: true,
      savedCode: codeToSave,
      originalCode: code,
      wasFormatted: codeToSave !== code
    };
  };
};

describe('Auto-format on Save Functionality', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Default successful formatting
    mockAutoFormatOnSave.mockImplementation(async (code, settings) => ({
      success: true,
      formattedCode: code.replace(/;/g, '').replace(/\s+/g, ' ').trim() + ';'
    }));
  });

  describe('Property Tests', () => {
    it('Property 5: Auto-format Conditional Behavior - should only format when both prettier and auto-format are enabled', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            isPrettierEnabled: fc.boolean(),
            prettierAutoFormatOnSave: fc.boolean(),
            code: fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0)
          }),
          async ({ isPrettierEnabled, prettierAutoFormatOnSave, code }) => {
            const settings = createMockSettings({
              isPrettierEnabled,
              prettierAutoFormatOnSave
            });
            
            const saveFunction = createMockSaveFunction(settings);
            const result = await saveFunction(code);
            
            const shouldFormat = isPrettierEnabled && prettierAutoFormatOnSave;
            
            if (shouldFormat) {
              // Should call auto-format function
              expect(mockAutoFormatOnSave).toHaveBeenCalledWith(code, settings);
              // Code might be formatted (depending on mock implementation)
              expect(result.success).toBe(true);
            } else {
              // Should not call auto-format function
              expect(mockAutoFormatOnSave).not.toHaveBeenCalled();
              // Code should remain unchanged
              expect(result.savedCode).toBe(code);
              expect(result.wasFormatted).toBe(false);
            }
            
            // Reset mock for next iteration
            mockAutoFormatOnSave.mockClear();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('Property 6: Save Error Recovery - should save original code when formatting fails', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            code: fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0),
            shouldFormatFail: fc.boolean(),
            errorMessage: fc.string({ minLength: 1, maxLength: 50 })
          }),
          async ({ code, shouldFormatFail, errorMessage }) => {
            const settings = createMockSettings({
              isPrettierEnabled: true,
              prettierAutoFormatOnSave: true
            });
            
            // Mock formatting failure conditionally
            if (shouldFormatFail) {
              mockAutoFormatOnSave.mockImplementationOnce(async () => ({
                success: false,
                error: errorMessage
              }));
            } else {
              mockAutoFormatOnSave.mockImplementationOnce(async (code) => ({
                success: true,
                formattedCode: code + ' // formatted'
              }));
            }
            
            const saveFunction = createMockSaveFunction(settings);
            const result = await saveFunction(code);
            
            // Save should always succeed
            expect(result.success).toBe(true);
            
            if (shouldFormatFail) {
              // Should save original code when formatting fails
              expect(result.savedCode).toBe(code);
              expect(result.wasFormatted).toBe(false);
            } else {
              // Should save formatted code when formatting succeeds
              expect(result.savedCode).toBe(code + ' // formatted');
              expect(result.wasFormatted).toBe(true);
            }
            
            // Reset mock for next iteration
            mockAutoFormatOnSave.mockClear();
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Unit Tests', () => {
    it('should format code when both prettier and auto-format are enabled', async () => {
      const settings = createMockSettings({
        isPrettierEnabled: true,
        prettierAutoFormatOnSave: true
      });
      
      const code = 'const x=1;const y=2';
      const formattedCode = 'const x = 1;\nconst y = 2;';
      
      mockAutoFormatOnSave.mockResolvedValueOnce({
        success: true,
        formattedCode
      });
      
      const saveFunction = createMockSaveFunction(settings);
      const result = await saveFunction(code);
      
      expect(mockAutoFormatOnSave).toHaveBeenCalledWith(code, settings);
      expect(result.savedCode).toBe(formattedCode);
      expect(result.wasFormatted).toBe(true);
    });

    it('should not format when prettier is disabled', async () => {
      const settings = createMockSettings({
        isPrettierEnabled: false,
        prettierAutoFormatOnSave: true
      });
      
      const code = 'const x=1;const y=2';
      
      const saveFunction = createMockSaveFunction(settings);
      const result = await saveFunction(code);
      
      expect(mockAutoFormatOnSave).not.toHaveBeenCalled();
      expect(result.savedCode).toBe(code);
      expect(result.wasFormatted).toBe(false);
    });

    it('should not format when auto-format on save is disabled', async () => {
      const settings = createMockSettings({
        isPrettierEnabled: true,
        prettierAutoFormatOnSave: false
      });
      
      const code = 'const x=1;const y=2';
      
      const saveFunction = createMockSaveFunction(settings);
      const result = await saveFunction(code);
      
      expect(mockAutoFormatOnSave).not.toHaveBeenCalled();
      expect(result.savedCode).toBe(code);
      expect(result.wasFormatted).toBe(false);
    });

    it('should save original code when formatting fails', async () => {
      const settings = createMockSettings({
        isPrettierEnabled: true,
        prettierAutoFormatOnSave: true
      });
      
      const code = 'const x=1;const y=2';
      const errorMessage = 'Syntax error in code';
      
      mockAutoFormatOnSave.mockResolvedValueOnce({
        success: false,
        error: errorMessage
      });
      
      const saveFunction = createMockSaveFunction(settings);
      const result = await saveFunction(code);
      
      expect(mockAutoFormatOnSave).toHaveBeenCalledWith(code, settings);
      expect(result.savedCode).toBe(code);
      expect(result.wasFormatted).toBe(false);
      expect(result.success).toBe(true);
    });

    it('should handle formatting exceptions gracefully', async () => {
      const settings = createMockSettings({
        isPrettierEnabled: true,
        prettierAutoFormatOnSave: true
      });
      
      const code = 'const x=1;const y=2';
      
      mockAutoFormatOnSave.mockRejectedValueOnce(new Error('Formatting crashed'));
      
      const saveFunction = createMockSaveFunction(settings);
      const result = await saveFunction(code);
      
      expect(mockAutoFormatOnSave).toHaveBeenCalledWith(code, settings);
      expect(result.savedCode).toBe(code);
      expect(result.wasFormatted).toBe(false);
      expect(result.success).toBe(true);
    });

    it('should pass all prettier settings to format function', async () => {
      const settings = createMockSettings({
        isPrettierEnabled: true,
        prettierAutoFormatOnSave: true,
        prettierTabWidth: 4,
        prettierUseTabs: true,
        prettierSemi: false,
        prettierSingleQuote: true,
        prettierQuoteProps: 'consistent',
        prettierTrailingComma: 'all',
        prettierBracketSpacing: false,
        prettierArrowParens: 'avoid',
        prettierPrintWidth: 120
      });
      
      const code = 'const x=1';
      
      mockAutoFormatOnSave.mockResolvedValueOnce({
        success: true,
        formattedCode: 'const x = 1'
      });
      
      const saveFunction = createMockSaveFunction(settings);
      await saveFunction(code);
      
      expect(mockAutoFormatOnSave).toHaveBeenCalledWith(code, settings);
      
      const passedSettings = mockAutoFormatOnSave.mock.calls[0][1];
      expect(passedSettings.prettierTabWidth).toBe(4);
      expect(passedSettings.prettierUseTabs).toBe(true);
      expect(passedSettings.prettierSemi).toBe(false);
      expect(passedSettings.prettierSingleQuote).toBe(true);
      expect(passedSettings.prettierQuoteProps).toBe('consistent');
      expect(passedSettings.prettierTrailingComma).toBe('all');
      expect(passedSettings.prettierBracketSpacing).toBe(false);
      expect(passedSettings.prettierArrowParens).toBe('avoid');
      expect(passedSettings.prettierPrintWidth).toBe(120);
    });

    it('should handle empty or whitespace-only code', async () => {
      const settings = createMockSettings({
        isPrettierEnabled: true,
        prettierAutoFormatOnSave: true
      });
      
      const testCases = ['', '   ', '\n\n', '\t\t'];
      
      for (const code of testCases) {
        mockAutoFormatOnSave.mockClear();
        
        const saveFunction = createMockSaveFunction(settings);
        const result = await saveFunction(code);
        
        // Should not attempt to format empty/whitespace code
        expect(mockAutoFormatOnSave).not.toHaveBeenCalled();
        expect(result.savedCode).toBe(code);
        expect(result.wasFormatted).toBe(false);
      }
    });
  });
});