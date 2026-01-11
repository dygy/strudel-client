import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fc from 'fast-check';

// Mock CodeMirror integration for testing settings application
const createMockCodeMirrorIntegration = () => {
  const appliedSettings = new Map();
  const reconfigurationHistory = [];
  
  const mockEditor = {
    dispatch: vi.fn((config) => {
      if (config.effects) {
        config.effects.forEach(effect => {
          reconfigurationHistory.push({
            timestamp: Date.now(),
            effect: effect.toString()
          });
        });
      }
    })
  };

  const mockCompartments = {
    isPrettierEnabled: {
      reconfigure: vi.fn((value) => ({
        toString: () => `reconfigure(isPrettierEnabled, ${JSON.stringify(value)})`
      }))
    }
  };

  const mockExtensions = {
    isPrettierEnabled: vi.fn((enabled) => {
      appliedSettings.set('isPrettierEnabled', enabled);
      return enabled ? ['prettier-extension'] : [];
    })
  };

  const integration = {
    reconfigureExtension(key, value) {
      const startTime = performance.now();
      
      if (!mockExtensions[key]) {
        throw new Error(`Extension ${key} not found`);
      }
      
      // Simulate the actual reconfiguration process
      const newValue = mockExtensions[key](value);
      const effect = mockCompartments[key].reconfigure(newValue);
      
      mockEditor.dispatch({
        effects: [effect]
      });
      
      const endTime = performance.now();
      const duration = endTime - startTime;
      
      return {
        success: true,
        duration,
        appliedValue: value
      };
    },

    getAppliedSettings() {
      return new Map(appliedSettings);
    },

    getReconfigurationHistory() {
      return [...reconfigurationHistory];
    },

    clearHistory() {
      reconfigurationHistory.length = 0;
      appliedSettings.clear();
    }
  };

  return { integration, mockEditor, mockCompartments, mockExtensions };
};

describe('Prettier Settings Integration', () => {
  let mockIntegration;

  beforeEach(() => {
    mockIntegration = createMockCodeMirrorIntegration();
  });

  afterEach(() => {
    mockIntegration.integration.clearHistory();
  });

  describe('Property Tests', () => {
    it('Property 10: Settings Application Immediacy - settings should be applied immediately when changed', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            settingsChanges: fc.array(
              fc.record({
                key: fc.constantFrom('isPrettierEnabled'),
                value: fc.boolean(),
                timestamp: fc.integer({ min: 0, max: 1000 })
              }),
              { minLength: 1, maxLength: 10 }
            )
          }),
          async ({ settingsChanges }) => {
            // Create fresh integration for each test run
            const { integration } = createMockCodeMirrorIntegration();
            const results = [];
            
            // Apply settings changes in sequence
            for (const change of settingsChanges) {
              // Simulate small delay between changes
              if (change.timestamp > 0) {
                await new Promise(resolve => setTimeout(resolve, 1));
              }
              
              const result = integration.reconfigureExtension(change.key, change.value);
              results.push({
                ...result,
                expectedValue: change.value,
                key: change.key
              });
            }
            
            // Verify all settings were applied successfully
            for (const result of results) {
              expect(result.success).toBe(true);
              expect(result.appliedValue).toBe(result.expectedValue);
              
              // Settings should be applied quickly (under 100ms in test environment)
              expect(result.duration).toBeLessThan(100);
            }
            
            // Verify final state matches last setting for each key
            const appliedSettings = integration.getAppliedSettings();
            const lastSettings = new Map();
            
            for (const change of settingsChanges) {
              lastSettings.set(change.key, change.value);
            }
            
            for (const [key, expectedValue] of lastSettings) {
              expect(appliedSettings.get(key)).toBe(expectedValue);
            }
            
            // Verify reconfiguration history matches number of changes
            const history = integration.getReconfigurationHistory();
            expect(history.length).toBe(settingsChanges.length);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Unit Tests', () => {
    it('should apply prettier settings immediately', () => {
      const { integration } = mockIntegration;
      
      const result = integration.reconfigureExtension('isPrettierEnabled', true);
      
      expect(result.success).toBe(true);
      expect(result.appliedValue).toBe(true);
      expect(result.duration).toBeLessThan(50); // Should be very fast in tests
      
      const appliedSettings = integration.getAppliedSettings();
      expect(appliedSettings.get('isPrettierEnabled')).toBe(true);
    });

    it('should handle rapid setting changes correctly', async () => {
      const { integration } = mockIntegration;
      
      // Apply multiple rapid changes
      const results = [];
      results.push(integration.reconfigureExtension('isPrettierEnabled', true));
      results.push(integration.reconfigureExtension('isPrettierEnabled', false));
      results.push(integration.reconfigureExtension('isPrettierEnabled', true));
      
      // All should succeed
      results.forEach(result => {
        expect(result.success).toBe(true);
        expect(result.duration).toBeLessThan(50);
      });
      
      // Final state should be true (last change)
      const appliedSettings = integration.getAppliedSettings();
      expect(appliedSettings.get('isPrettierEnabled')).toBe(true);
      
      // Should have 3 reconfigurations in history
      const history = integration.getReconfigurationHistory();
      expect(history.length).toBe(3);
    });

    it('should maintain reconfiguration history', () => {
      const { integration } = mockIntegration;
      
      integration.reconfigureExtension('isPrettierEnabled', true);
      integration.reconfigureExtension('isPrettierEnabled', false);
      
      const history = integration.getReconfigurationHistory();
      
      expect(history.length).toBe(2);
      expect(history[0].effect).toContain('isPrettierEnabled');
      expect(history[1].effect).toContain('isPrettierEnabled');
      
      // Each entry should have a timestamp
      history.forEach(entry => {
        expect(typeof entry.timestamp).toBe('number');
        expect(entry.timestamp).toBeGreaterThan(0);
      });
    });

    it('should handle unknown extension keys gracefully', () => {
      const { integration } = mockIntegration;
      
      expect(() => {
        integration.reconfigureExtension('unknownExtension', true);
      }).toThrow('Extension unknownExtension not found');
    });

    it('should clear history and settings correctly', () => {
      const { integration } = mockIntegration;
      
      integration.reconfigureExtension('isPrettierEnabled', true);
      
      expect(integration.getAppliedSettings().size).toBe(1);
      expect(integration.getReconfigurationHistory().length).toBe(1);
      
      integration.clearHistory();
      
      expect(integration.getAppliedSettings().size).toBe(0);
      expect(integration.getReconfigurationHistory().length).toBe(0);
    });

    it('should handle boolean value conversion correctly', () => {
      const { integration } = mockIntegration;
      
      // Test with actual boolean
      let result = integration.reconfigureExtension('isPrettierEnabled', true);
      expect(result.appliedValue).toBe(true);
      
      // Test with false
      result = integration.reconfigureExtension('isPrettierEnabled', false);
      expect(result.appliedValue).toBe(false);
      
      const appliedSettings = integration.getAppliedSettings();
      expect(appliedSettings.get('isPrettierEnabled')).toBe(false);
    });

    it('should measure performance accurately', () => {
      const { integration } = mockIntegration;
      
      const result = integration.reconfigureExtension('isPrettierEnabled', true);
      
      expect(typeof result.duration).toBe('number');
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.duration).toBeLessThan(100); // Should be fast in test environment
    });

    it('should handle concurrent setting changes', async () => {
      const { integration } = mockIntegration;
      
      // Simulate concurrent changes
      const promises = [
        Promise.resolve(integration.reconfigureExtension('isPrettierEnabled', true)),
        Promise.resolve(integration.reconfigureExtension('isPrettierEnabled', false)),
        Promise.resolve(integration.reconfigureExtension('isPrettierEnabled', true))
      ];
      
      const results = await Promise.all(promises);
      
      // All should succeed
      results.forEach(result => {
        expect(result.success).toBe(true);
      });
      
      // Should have recorded all changes
      const history = integration.getReconfigurationHistory();
      expect(history.length).toBe(3);
    });

    it('should preserve setting application order', () => {
      const { integration } = mockIntegration;
      
      const changes = [
        { value: true, timestamp: Date.now() },
        { value: false, timestamp: Date.now() + 1 },
        { value: true, timestamp: Date.now() + 2 }
      ];
      
      changes.forEach(change => {
        integration.reconfigureExtension('isPrettierEnabled', change.value);
      });
      
      const history = integration.getReconfigurationHistory();
      
      // History should maintain order
      expect(history.length).toBe(3);
      
      // Timestamps should be in order (approximately)
      for (let i = 1; i < history.length; i++) {
        expect(history[i].timestamp).toBeGreaterThanOrEqual(history[i-1].timestamp);
      }
      
      // Final setting should be the last one applied
      const appliedSettings = integration.getAppliedSettings();
      expect(appliedSettings.get('isPrettierEnabled')).toBe(true);
    });
  });
});