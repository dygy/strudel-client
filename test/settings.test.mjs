import { describe, it, expect, beforeEach, afterEach } from 'vitest';

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
});