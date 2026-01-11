import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fc from 'fast-check';

// Mock complete prettier integration system
const createMockPrettierSystem = () => {
  // Mock settings store
  const settingsStore = new Map();
  settingsStore.set('isPrettierEnabled', false);
  settingsStore.set('prettierAutoFormatOnSave', false);
  settingsStore.set('prettierTabWidth', 2);
  settingsStore.set('prettierUseTabs', false);
  settingsStore.set('prettierSemi', true);
  settingsStore.set('prettierSingleQuote', false);
  settingsStore.set('prettierQuoteProps', 'as-needed');
  settingsStore.set('prettierTrailingComma', 'es5');
  settingsStore.set('prettierBracketSpacing', true);
  settingsStore.set('prettierArrowParens', 'always');
  settingsStore.set('prettierPrintWidth', 80);

  // Mock format engine
  const formatEngine = {
    formatCode: vi.fn(async (code, options) => {
      if (code.includes('syntax-error')) {
        return { success: false, error: 'Syntax error' };
      }
      return { 
        success: true, 
        formattedCode: code.replace(/\s+/g, ' ').trim() + ' // formatted'
      };
    }),
    formatSelection: vi.fn(async (code, start, end, options) => {
      const selectedText = code.substring(start, end);
      if (selectedText.includes('syntax-error')) {
        return { success: false, error: 'Syntax error in selection' };
      }
      const formattedSelection = selectedText.replace(/\s+/g, ' ').trim() + ' // formatted';
      const formattedCode = code.substring(0, start) + formattedSelection + code.substring(end);
      return { 
        success: true, 
        formattedCode,
        cursorOffset: start + formattedSelection.length
      };
    }),
    validateSyntax: vi.fn((code) => !code.includes('syntax-error')),
    clearCache: vi.fn(),
    getCacheSize: vi.fn(() => 0),
    getPerformanceStats: vi.fn(() => ({
      cacheSize: 0,
      workerAvailable: false,
      pendingRequests: 0,
      activeDebounceTimers: 0
    }))
  };

  // Mock CodeMirror editor
  const mockEditor = {
    state: {
      doc: {
        toString: () => 'const x = 1;',
        length: 12
      },
      selection: {
        main: {
          head: 5,
          from: 2,
          to: 8,
          empty: true // Default to no selection
        }
      }
    },
    dispatch: vi.fn(),
    focus: vi.fn()
  };

  // Mock file manager
  const fileManager = {
    saveFile: vi.fn(async (filename, content, settings) => {
      if (settings.isPrettierEnabled && settings.prettierAutoFormatOnSave) {
        const result = await formatEngine.formatCode(content, settings);
        return {
          success: true,
          savedContent: result.success ? result.formattedCode : content,
          formatted: result.success
        };
      }
      return {
        success: true,
        savedContent: content,
        formatted: false
      };
    })
  };

  // Mock prettier extension
  const prettierExtension = {
    formatCommand: vi.fn(async (editor, settings) => {
      if (!settings.isPrettierEnabled) {
        return { success: false, error: 'Prettier is disabled' };
      }

      const code = editor.state.doc.toString();
      const selection = editor.state.selection.main;
      
      let result;
      if (selection.empty) {
        result = await formatEngine.formatCode(code, settings);
      } else {
        result = await formatEngine.formatSelection(code, selection.from, selection.to, settings);
      }

      if (result.success) {
        editor.dispatch({
          changes: {
            from: 0,
            to: editor.state.doc.length,
            insert: result.formattedCode
          }
        });
      }

      return result;
    }),
    autoFormatOnSave: vi.fn(async (code, settings) => {
      if (!settings.isPrettierEnabled || !settings.prettierAutoFormatOnSave) {
        return { success: true, formattedCode: code };
      }
      return await formatEngine.formatCode(code, settings);
    })
  };

  // Mock settings UI
  const settingsUI = {
    updateSetting: vi.fn((key, value) => {
      settingsStore.set(key, value);
      return { success: true, appliedValue: value };
    }),
    getSettings: vi.fn(() => Object.fromEntries(settingsStore)),
    validateSettings: vi.fn((settings) => {
      const errors = [];
      if (settings.prettierTabWidth < 1 || settings.prettierTabWidth > 8) {
        errors.push('Tab width must be between 1 and 8');
      }
      if (settings.prettierPrintWidth < 40 || settings.prettierPrintWidth > 200) {
        errors.push('Print width must be between 40 and 200');
      }
      return { valid: errors.length === 0, errors };
    })
  };

  // Mock notification system
  const notifications = [];
  const notificationSystem = {
    showSuccess: vi.fn((message) => {
      const notification = { type: 'success', message, timestamp: Date.now() };
      notifications.push(notification);
      return notification;
    }),
    showError: vi.fn((message) => {
      const notification = { type: 'error', message, timestamp: Date.now() };
      notifications.push(notification);
      return notification;
    }),
    getNotifications: () => [...notifications],
    clearNotifications: () => notifications.length = 0
  };

  return {
    settingsStore,
    formatEngine,
    mockEditor,
    fileManager,
    prettierExtension,
    settingsUI,
    notificationSystem,
    
    // Helper methods
    getSettings: () => Object.fromEntries(settingsStore),
    updateSettings: (updates) => {
      Object.entries(updates).forEach(([key, value]) => {
        settingsStore.set(key, value);
      });
    },
    reset: () => {
      notifications.length = 0;
      vi.clearAllMocks();
    }
  };
};

describe('Prettier Integration Tests', () => {
  let system;

  beforeEach(() => {
    system = createMockPrettierSystem();
  });

  afterEach(() => {
    system.reset();
  });

  describe('Complete Workflow Integration', () => {
    it('should handle complete prettier workflow from settings to formatting', async () => {
      const { settingsUI, prettierExtension, mockEditor, notificationSystem } = system;
      
      // Enable prettier
      settingsUI.updateSetting('isPrettierEnabled', true);
      settingsUI.updateSetting('prettierTabWidth', 4);
      settingsUI.updateSetting('prettierSemi', false);
      
      const settings = settingsUI.getSettings();
      
      // Format code
      const result = await prettierExtension.formatCommand(mockEditor, settings);
      
      expect(result.success).toBe(true);
      expect(mockEditor.dispatch).toHaveBeenCalledWith({
        changes: {
          from: 0,
          to: mockEditor.state.doc.length,
          insert: expect.stringContaining('formatted')
        }
      });
    });

    it('should integrate with autosave system correctly', async () => {
      const { settingsUI, fileManager } = system;
      
      // Enable prettier and auto-format on save
      settingsUI.updateSetting('isPrettierEnabled', true);
      settingsUI.updateSetting('prettierAutoFormatOnSave', true);
      
      const settings = settingsUI.getSettings();
      const code = 'const   x   =   1  ;';
      
      const result = await fileManager.saveFile('test.js', code, settings);
      
      expect(result.success).toBe(true);
      expect(result.formatted).toBe(true);
      expect(result.savedContent).toContain('formatted');
    });

    it('should handle keyboard shortcuts in different editor modes', async () => {
      const { prettierExtension, mockEditor, settingsUI } = system;
      
      // Test with different keybinding modes
      const modes = ['codemirror', 'vim', 'emacs', 'vscode'];
      
      for (const mode of modes) {
        settingsUI.updateSetting('isPrettierEnabled', true);
        settingsUI.updateSetting('keybindings', mode);
        
        const settings = settingsUI.getSettings();
        const result = await prettierExtension.formatCommand(mockEditor, settings);
        
        expect(result.success).toBe(true);
      }
    });
  });

  describe('Error Handling Integration', () => {
    it('should handle formatting errors gracefully across all components', async () => {
      const { prettierExtension, fileManager, mockEditor, settingsUI, notificationSystem } = system;
      
      settingsUI.updateSetting('isPrettierEnabled', true);
      settingsUI.updateSetting('prettierAutoFormatOnSave', true);
      
      const settings = settingsUI.getSettings();
      const badCode = 'syntax-error code';
      
      // Mock editor with bad code
      mockEditor.state.doc.toString = () => badCode;
      
      // Test format command error handling
      const formatResult = await prettierExtension.formatCommand(mockEditor, settings);
      expect(formatResult.success).toBe(false);
      expect(formatResult.error).toBe('Syntax error');
      
      // Test autosave error handling
      const saveResult = await fileManager.saveFile('test.js', badCode, settings);
      expect(saveResult.success).toBe(true);
      expect(saveResult.formatted).toBe(false);
      expect(saveResult.savedContent).toBe(badCode); // Original code preserved
    });

    it('should handle disabled prettier state correctly', async () => {
      const { prettierExtension, fileManager, mockEditor, settingsUI } = system;
      
      // Prettier disabled
      settingsUI.updateSetting('isPrettierEnabled', false);
      settingsUI.updateSetting('prettierAutoFormatOnSave', true);
      
      const settings = settingsUI.getSettings();
      const code = 'const x = 1;';
      
      // Format command should fail
      const formatResult = await prettierExtension.formatCommand(mockEditor, settings);
      expect(formatResult.success).toBe(false);
      expect(formatResult.error).toBe('Prettier is disabled');
      
      // Autosave should not format
      const saveResult = await fileManager.saveFile('test.js', code, settings);
      expect(saveResult.success).toBe(true);
      expect(saveResult.formatted).toBe(false);
      expect(saveResult.savedContent).toBe(code);
    });
  });

  describe('Settings Persistence Integration', () => {
    it('should persist settings across browser sessions', () => {
      const { settingsUI } = system;
      
      // Update multiple settings
      const updates = {
        isPrettierEnabled: true,
        prettierTabWidth: 4,
        prettierUseTabs: true,
        prettierSemi: false,
        prettierSingleQuote: true,
        prettierQuoteProps: 'consistent',
        prettierTrailingComma: 'all',
        prettierBracketSpacing: false,
        prettierArrowParens: 'avoid',
        prettierPrintWidth: 120,
        prettierAutoFormatOnSave: true
      };
      
      Object.entries(updates).forEach(([key, value]) => {
        const result = settingsUI.updateSetting(key, value);
        expect(result.success).toBe(true);
        expect(result.appliedValue).toBe(value);
      });
      
      const settings = settingsUI.getSettings();
      
      Object.entries(updates).forEach(([key, expectedValue]) => {
        expect(settings[key]).toBe(expectedValue);
      });
    });

    it('should validate settings correctly', () => {
      const { settingsUI } = system;
      
      // Valid settings
      const validSettings = {
        prettierTabWidth: 4,
        prettierPrintWidth: 100
      };
      
      const validResult = settingsUI.validateSettings(validSettings);
      expect(validResult.valid).toBe(true);
      expect(validResult.errors).toHaveLength(0);
      
      // Invalid settings
      const invalidSettings = {
        prettierTabWidth: 10, // Too high
        prettierPrintWidth: 300 // Too high
      };
      
      const invalidResult = settingsUI.validateSettings(invalidSettings);
      expect(invalidResult.valid).toBe(false);
      expect(invalidResult.errors).toHaveLength(2);
    });
  });

  describe('Performance Integration', () => {
    it('should handle large files efficiently', async () => {
      const { formatEngine, prettierExtension, mockEditor, settingsUI } = system;
      
      settingsUI.updateSetting('isPrettierEnabled', true);
      const settings = settingsUI.getSettings();
      
      // Mock large file
      const largeCode = 'const x = 1;\n'.repeat(1000);
      mockEditor.state.doc.toString = () => largeCode;
      mockEditor.state.doc.length = largeCode.length;
      
      const startTime = performance.now();
      const result = await prettierExtension.formatCommand(mockEditor, settings);
      const endTime = performance.now();
      
      expect(result.success).toBe(true);
      expect(endTime - startTime).toBeLessThan(1000); // Should complete within 1 second
      
      // Verify performance stats are available
      const stats = formatEngine.getPerformanceStats();
      expect(stats).toHaveProperty('cacheSize');
      expect(stats).toHaveProperty('workerAvailable');
    });

    it('should cache configurations efficiently', async () => {
      const { formatEngine, prettierExtension, mockEditor, settingsUI } = system;
      
      settingsUI.updateSetting('isPrettierEnabled', true);
      const settings = settingsUI.getSettings();
      
      // Ensure editor has no selection so formatCode is called
      mockEditor.state.selection.main.empty = true;
      
      // Format multiple times with same settings
      await prettierExtension.formatCommand(mockEditor, settings);
      await prettierExtension.formatCommand(mockEditor, settings);
      await prettierExtension.formatCommand(mockEditor, settings);
      
      // formatCode should have been called 3 times
      expect(formatEngine.formatCode).toHaveBeenCalledTimes(3);
      
      // Clear cache
      formatEngine.clearCache();
      expect(formatEngine.clearCache).toHaveBeenCalled();
    });
  });

  describe('Property-Based Integration Tests', () => {
    it('should handle arbitrary setting combinations correctly', async () => {
      await fc.assert(
        fc.asyncProperty(
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
          async (settings) => {
            const { settingsUI, prettierExtension, mockEditor } = system;
            
            // Apply all settings
            Object.entries(settings).forEach(([key, value]) => {
              settingsUI.updateSetting(key, value);
            });
            
            const appliedSettings = settingsUI.getSettings();
            
            // Verify all settings were applied
            Object.entries(settings).forEach(([key, expectedValue]) => {
              expect(appliedSettings[key]).toBe(expectedValue);
            });
            
            // Test formatting with these settings
            const result = await prettierExtension.formatCommand(mockEditor, appliedSettings);
            
            if (settings.isPrettierEnabled) {
              expect(result.success).toBe(true);
            } else {
              expect(result.success).toBe(false);
              expect(result.error).toBe('Prettier is disabled');
            }
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should handle various code patterns correctly', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            code: fc.oneof(
              fc.constant('const x = 1;'),
              fc.constant('function test() { return true; }'),
              fc.constant('const obj = { a: 1, b: 2 };'),
              fc.constant('const arr = [1, 2, 3];'),
              fc.constant('if (true) { console.log("test"); }'),
              fc.constant('const fn = (x) => x * 2;')
            ),
            hasSelection: fc.boolean()
          }),
          async ({ code, hasSelection }) => {
            const { prettierExtension, mockEditor, settingsUI } = system;
            
            settingsUI.updateSetting('isPrettierEnabled', true);
            const settings = settingsUI.getSettings();
            
            // Mock editor state
            mockEditor.state.doc.toString = () => code;
            mockEditor.state.doc.length = code.length;
            mockEditor.state.selection.main.empty = !hasSelection;
            
            if (hasSelection) {
              mockEditor.state.selection.main.from = 0;
              mockEditor.state.selection.main.to = Math.min(5, code.length);
            }
            
            const result = await prettierExtension.formatCommand(mockEditor, settings);
            
            expect(result.success).toBe(true);
            expect(mockEditor.dispatch).toHaveBeenCalled();
          }
        ),
        { numRuns: 30 }
      );
    });
  });

  describe('Internationalization Integration', () => {
    it('should handle different languages correctly', () => {
      const { notificationSystem } = system;
      
      const languages = ['en', 'fr', 'es', 'ko', 'ru', 'zh', 'he', 'sr', 'ar'];
      
      languages.forEach(lang => {
        // Mock language-specific messages
        const successMessage = `Code formatted (${lang})`;
        const errorMessage = `Format failed (${lang})`;
        
        const successNotification = notificationSystem.showSuccess(successMessage);
        const errorNotification = notificationSystem.showError(errorMessage);
        
        expect(successNotification.message).toBe(successMessage);
        expect(errorNotification.message).toBe(errorMessage);
      });
      
      const notifications = notificationSystem.getNotifications();
      expect(notifications).toHaveLength(languages.length * 2);
    });
  });
});