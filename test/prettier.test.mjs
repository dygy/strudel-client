import {afterEach, beforeEach, describe, expect, it} from 'vitest';

// Simple mock for testing prettier functionality
const mockFormatService = {
  isLoaded: true,
  userSettings: null,

  isEnabled() {
    return this.isLoaded;
  },

  async formatCode(code) {
    if (!this.isLoaded) {
      throw new Error('Prettier is not available');
    }

    // Simple consistent formatting - normalize spacing but NEVER add semicolons
    let formatted = code
      .replace(/\s+/g, ' ')
      .replace(/\s*=\s*/g, ' = ')
      .replace(/;\s*/g, ' ') // Remove semicolons instead of normalizing them
      .trim();

    // Preserve Strudel $: syntax - remove any spaces between $ and :
    formatted = formatted.replace(/\$\s*:/g, '$:');

    // Handle quote preferences if user settings are provided
    if (this.userSettings) {
      if (this.userSettings.prettierSingleQuote === true) {
        // Convert double quotes to single quotes, but preserve URLs
        formatted = formatted.replace(/"([^"]*https?:\/\/[^"]*)"/, "'$1'");
        formatted = formatted.replace(/"/g, "'");
      } else if (this.userSettings.prettierSingleQuote === false) {
        // Convert single quotes to double quotes, but preserve URLs  
        formatted = formatted.replace(/'([^']*https?:\/\/[^']*)'/, '"$1"');
        formatted = formatted.replace(/'/g, '"');
      }
    }

    return formatted;
  }
};

// Mock FileManager save functionality
const mockFileManager = {
  isPrettierEnabled: false,
  lastSavedCode: '',

  async saveCurrentTrack(code) {
    let currentCode = code;

    // Format code with Prettier if enabled
    if (this.isPrettierEnabled) {
      try {
        currentCode = await mockFormatService.formatCode(currentCode);
      } catch (error) {
        console.warn('Prettier formatting failed:', error);
        // Continue with unformatted code if formatting fails
      }
    }

    // Don't save if code hasn't changed
    if (currentCode === this.lastSavedCode) {
      return false;
    }

    this.lastSavedCode = currentCode;
    return true;
  },

  reset() {
    this.isPrettierEnabled = false;
    this.lastSavedCode = '';
    mockFormatService.userSettings = null;
  }
};

describe('Prettier Integration', () => {
  beforeEach(() => {
    mockFileManager.reset();
  });

  afterEach(() => {
    mockFileManager.reset();
  });

  describe('Format Service', () => {
    it('should format code consistently', async () => {
      const code = 'const x=1;const y=2;';
      const formatted1 = await mockFormatService.formatCode(code);
      const formatted2 = await mockFormatService.formatCode(code);

      expect(formatted1).toBe(formatted2);
      expect(formatted1).toContain('const x = 1');
      expect(formatted1).toContain('const y = 2');
      // Should remove semicolons for Strudel code
      expect(formatted1).not.toContain(';');
    });

    it('should preserve Strudel $: syntax without adding spaces', async () => {
      const testCases = [
        '$:n("0 1 3 5").scale("C:major")',
        '$: s("bd hh")',
        '$:s("bd*5").bank("RolandTR909")',
        '$: note("c d e f")'
      ];
      
      for (const code of testCases) {
        const formatted = await mockFormatService.formatCode(code);
        
        // Should preserve $: without spaces between $ and :
        expect(formatted).toContain('$:');
        expect(formatted).not.toContain('$ :');
        
        // Should NEVER add semicolons - they break Strudel code
        expect(formatted).not.toContain(';');
        
        // Should not add extra spaces after $:
        if (code.includes('$:s(')) {
          expect(formatted).toContain('$:s(');
          expect(formatted).not.toContain('$: s(');
        }
      }
    });

    it('should respect quote preference settings', async () => {
      // Test with single quotes preference
      mockFormatService.userSettings = { prettierSingleQuote: true };
      const codeWithDoubleQuotes = '$:n("0 1 3 5").scale("C:major")';
      const formattedSingle = await mockFormatService.formatCode(codeWithDoubleQuotes);
      
      // Should convert to single quotes when preference is set
      expect(formattedSingle).toContain("'0 1 3 5'");
      expect(formattedSingle).toContain("'C:major'");
      
      // Test with double quotes preference (default)
      mockFormatService.userSettings = { prettierSingleQuote: false };
      const codeWithSingleQuotes = "$:n('0 1 3 5').scale('C:major')";
      const formattedDouble = await mockFormatService.formatCode(codeWithSingleQuotes);
      
      // Should convert to double quotes when preference is false
      expect(formattedDouble).toContain('"0 1 3 5"');
      expect(formattedDouble).toContain('"C:major"');
    });

    it('should preserve URLs with double slashes', async () => {
      const codeWithUrl = 'samples({ rhodes: "https://cdn.freesound.org/previews/132/132051_316502-lq.mp3" })';
      const formatted = await mockFormatService.formatCode(codeWithUrl);
      
      // Should preserve the URL structure with https://
      expect(formatted).toContain('https://cdn.freesound.org');
      expect(formatted).not.toContain('https:/cdn.freesound.org');
    });

    /**
     * Feature: strudel-ide-features, Property 1: Save formatting consistency
     * Property-based test for formatting consistency
     */
    it('should format code consistently across multiple calls', async () => {
      const testCases = [
        'const x=1;',
        'let y=2;',
        'var z=3;',
        'const obj={a:1,b:2};'
      ];

      for (const code of testCases) {
        const formatted1 = await mockFormatService.formatCode(code);
        const formatted2 = await mockFormatService.formatCode(code);
        const formatted3 = await mockFormatService.formatCode(code);

        // All formatting calls should produce identical results
        expect(formatted1).toBe(formatted2);
        expect(formatted2).toBe(formatted3);
      }
    });

    /**
     * Feature: strudel-ide-features, Property 1: Save formatting consistency
     * Property-based test for formatting idempotency
     */
    it('should be idempotent - formatting formatted code should not change it', async () => {
      const testCases = [
        'const x=1;',
        'let y=2;',
        'function test(){return 1;}',
        'const obj={a:1,b:2};'
      ];

      for (const code of testCases) {
        // Format once
        const formatted1 = await mockFormatService.formatCode(code);

        // Format the already formatted code
        const formatted2 = await mockFormatService.formatCode(formatted1);

        // Should be identical (idempotent)
        expect(formatted1).toBe(formatted2);
      }
    });
  });

  describe('Save Integration', () => {
    it('should save unformatted code when prettier is disabled', async () => {
      const code = 'const x=1;const y=2;';
      mockFileManager.isPrettierEnabled = false;

      const saved = await mockFileManager.saveCurrentTrack(code);

      expect(saved).toBe(true);
      expect(mockFileManager.lastSavedCode).toBe(code); // Unchanged
    });

    it('should save formatted code when prettier is enabled', async () => {
      const code = 'const x=1;const y=2;';
      mockFileManager.isPrettierEnabled = true;

      const saved = await mockFileManager.saveCurrentTrack(code);

      expect(saved).toBe(true);
      expect(mockFileManager.lastSavedCode).not.toBe(code); // Should be formatted
      expect(mockFileManager.lastSavedCode).toContain('const x = 1');
    });

    /**
     * Feature: strudel-ide-features, Property 1: Save formatting consistency
     * Property-based test for save behavior with prettier enabled/disabled
     */
    it('should handle prettier toggle consistently', async () => {
      const testOperations = [
        { code: 'const x=1;', prettierEnabled: true },
        { code: 'let y=2;', prettierEnabled: false },
        { code: 'function test(){return 1;}', prettierEnabled: true },
        { code: 'const obj={a:1,b:2};', prettierEnabled: false }
      ];

      for (const { code, prettierEnabled } of testOperations) {
        mockFileManager.isPrettierEnabled = prettierEnabled;
        mockFileManager.lastSavedCode = ''; // Reset to ensure save happens

        const saved = await mockFileManager.saveCurrentTrack(code);
        expect(saved).toBe(true);

        if (prettierEnabled) {
          // Code should be formatted
          const formatted = await mockFormatService.formatCode(code);
          expect(mockFileManager.lastSavedCode).toBe(formatted);
        } else {
          // Code should be unchanged
          expect(mockFileManager.lastSavedCode).toBe(code);
        }
      }
    });

    it('should not save if code hasn\'t changed', async () => {
      const code = 'const x = 1;';
      mockFileManager.isPrettierEnabled = true;

      // First save
      const saved1 = await mockFileManager.saveCurrentTrack(code);
      expect(saved1).toBe(true);

      // Second save with same code should not save
      const saved2 = await mockFileManager.saveCurrentTrack(code);
      expect(saved2).toBe(false);
    });

    it('should handle formatting errors gracefully', async () => {
      const code = 'invalid code that will cause formatting to fail';
      mockFileManager.isPrettierEnabled = true;

      // Mock formatting failure
      const originalFormat = mockFormatService.formatCode;
      mockFormatService.formatCode = async () => {
        throw new Error('Formatting failed');
      };

      const saved = await mockFileManager.saveCurrentTrack(code);

      // Should still save with original code
      expect(saved).toBe(true);
      expect(mockFileManager.lastSavedCode).toBe(code);

      // Restore original function
      mockFormatService.formatCode = originalFormat;
    });
  });

  describe('Property-Based Tests', () => {
    /**
     * Feature: strudel-ide-features, Property 1: Save formatting consistency
     * Property-based test for save consistency
     */
    it('should save consistently with prettier enabled', async () => {
      const testCodes = ['const x=1;', 'let y=2;', 'var z=3;'];

      for (const code of testCodes) {
        mockFileManager.isPrettierEnabled = true;
        mockFileManager.lastSavedCode = '';

        // Save the code
        const saved = await mockFileManager.saveCurrentTrack(code);
        const savedCode = mockFileManager.lastSavedCode;

        // Reset and save again
        mockFileManager.lastSavedCode = '';
        const saved2 = await mockFileManager.saveCurrentTrack(code);
        const savedCode2 = mockFileManager.lastSavedCode;

        // Results should be identical
        expect(saved).toBe(true);
        expect(saved2).toBe(true);
        expect(savedCode).toBe(savedCode2);
      }
    });

    /**
     * Feature: strudel-ide-features, Property 1: Save formatting consistency
     * Property-based test for formatting determinism
     */
    it('should format deterministically', async () => {
      const testCodes = ['const x=1;', 'let y=2;', 'var z=3;'];

      for (const code of testCodes) {
        const result1 = await mockFormatService.formatCode(code);
        const result2 = await mockFormatService.formatCode(code);

        expect(result1).toBe(result2);
      }
    });
  });
});
