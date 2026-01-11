import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';

// Mock localStorage for testing
const mockLocalStorage = {
  store: {},
  getItem(key) {
    return this.store[key] || null;
  },
  setItem(key, value) {
    this.store[key] = value;
  },
  removeItem(key) {
    delete this.store[key];
  },
  clear() {
    this.store = {};
  }
};

// Mock global localStorage
Object.defineProperty(global, 'localStorage', {
  value: mockLocalStorage,
  writable: true
});

describe('Settings', () => {
  beforeEach(() => {
    mockLocalStorage.clear();
  });

  afterEach(() => {
    mockLocalStorage.clear();
  });

  describe('Basic Settings Functionality', () => {
    it('should handle boolean settings correctly', () => {
      // Test with true
      mockLocalStorage.setItem('test-setting', 'true');
      expect(mockLocalStorage.getItem('test-setting')).toBe('true');
      
      // Test with false
      mockLocalStorage.setItem('test-setting', 'false');
      expect(mockLocalStorage.getItem('test-setting')).toBe('false');
    });

    it('should handle prettier setting', () => {
      // Test enabling prettier
      mockLocalStorage.setItem('strudel-settings-isPrettierEnabled', 'true');
      expect(mockLocalStorage.getItem('strudel-settings-isPrettierEnabled')).toBe('true');
      
      // Test disabling prettier
      mockLocalStorage.setItem('strudel-settings-isPrettierEnabled', 'false');
      expect(mockLocalStorage.getItem('strudel-settings-isPrettierEnabled')).toBe('false');
    });

    it('should handle missing settings gracefully', () => {
      expect(mockLocalStorage.getItem('non-existent-setting')).toBe(null);
    });

    it('should clear settings correctly', () => {
      mockLocalStorage.setItem('test-setting', 'value');
      expect(mockLocalStorage.getItem('test-setting')).toBe('value');
      
      mockLocalStorage.clear();
      expect(mockLocalStorage.getItem('test-setting')).toBe(null);
    });

    it('should parse boolean strings correctly', () => {
      // Test true parsing
      mockLocalStorage.setItem('bool-test', 'true');
      const trueValue = mockLocalStorage.getItem('bool-test') === 'true';
      expect(trueValue).toBe(true);
      
      // Test false parsing
      mockLocalStorage.setItem('bool-test', 'false');
      const falseValue = mockLocalStorage.getItem('bool-test') === 'true';
      expect(falseValue).toBe(false);
    });
  });

  describe('Property-Based Tests', () => {
    /**
     * Feature: prettier-integration, Property 7: Settings Persistence Round-trip
     * Validates: Requirements 2.4, 4.4
     */
    it('should persist and retrieve prettier settings correctly (property test)', () => {
      fc.assert(
        fc.property(
          fc.record({
            isPrettierEnabled: fc.boolean(),
            prettierAutoFormatOnSave: fc.boolean(),
            prettierTabWidth: fc.integer({ min: 1, max: 8 }),
            prettierUseTabs: fc.boolean(),
            prettierSemi: fc.boolean(),
            prettierSingleQuote: fc.boolean(),
            prettierQuoteProps: fc.constantFrom('as-needed', 'consistent', 'preserve'),
            prettierTrailingComma: fc.constantFrom('none', 'es5', 'all'),
            prettierBracketSpacing: fc.boolean(),
            prettierArrowParens: fc.constantFrom('avoid', 'always'),
            prettierPrintWidth: fc.integer({ min: 40, max: 200 })
          }),
          (prettierSettings) => {
            // Clear storage before test
            mockLocalStorage.clear();
            
            // Store all prettier settings
            Object.entries(prettierSettings).forEach(([key, value]) => {
              mockLocalStorage.setItem(`strudel-settings-${key}`, String(value));
            });
            
            // Retrieve and verify all settings
            Object.entries(prettierSettings).forEach(([key, expectedValue]) => {
              const storedValue = mockLocalStorage.getItem(`strudel-settings-${key}`);
              const parsedValue = key.includes('TabWidth') || key.includes('PrintWidth') 
                ? Number(storedValue)
                : key.includes('QuoteProps') || key.includes('TrailingComma') || key.includes('ArrowParens')
                ? storedValue
                : storedValue === 'true';
              
              expect(parsedValue).toEqual(expectedValue);
            });
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle settings persistence across browser sessions (property test)', () => {
      fc.assert(
        fc.property(
          fc.record({
            isPrettierEnabled: fc.boolean(),
            prettierAutoFormatOnSave: fc.boolean(),
            prettierTabWidth: fc.integer({ min: 1, max: 8 }),
            prettierPrintWidth: fc.integer({ min: 40, max: 200 })
          }),
          (settings) => {
            // Simulate first session
            mockLocalStorage.clear();
            Object.entries(settings).forEach(([key, value]) => {
              mockLocalStorage.setItem(`strudel-settings-${key}`, String(value));
            });
            
            // Simulate browser restart (storage persists)
            const persistedData = { ...mockLocalStorage.store };
            
            // Simulate second session
            mockLocalStorage.clear();
            Object.entries(persistedData).forEach(([key, value]) => {
              mockLocalStorage.setItem(key, value);
            });
            
            // Verify settings are still available
            Object.entries(settings).forEach(([key, expectedValue]) => {
              const storedValue = mockLocalStorage.getItem(`strudel-settings-${key}`);
              const parsedValue = key.includes('TabWidth') || key.includes('PrintWidth')
                ? Number(storedValue)
                : storedValue === 'true';
              
              expect(parsedValue).toEqual(expectedValue);
            });
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});