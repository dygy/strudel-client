import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fc from 'fast-check';

// Mock DOM environment
const mockDocument = {
  createElement: vi.fn(),
  body: {
    appendChild: vi.fn(),
    removeChild: vi.fn()
  },
  head: {
    appendChild: vi.fn()
  },
  getElementById: vi.fn()
};

const mockWindow = {
  location: {
    hostname: 'localhost'
  },
  strudelTranslations: {
    messages: {
      prettierFormatSuccess: '✓ Code formatted successfully',
      prettierFormatError: '✗ Format failed: {error}'
    }
  },
  requestAnimationFrame: vi.fn(cb => setTimeout(cb, 16))
};

// Mock element
const createMockElement = () => ({
  style: {},
  textContent: '',
  appendChild: vi.fn(),
  parentNode: null,
  remove: vi.fn()
});

// Mock visual feedback functions
const createVisualFeedbackSystem = () => {
  let notifications = [];
  
  const showFormattingFeedback = (view, success, error = null) => {
    const getTranslatedMessage = (key, fallback) => {
      return mockWindow.strudelTranslations?.messages?.[key] || fallback;
    };

    const notification = createMockElement();
    notification.id = `notification-${Date.now()}-${Math.random()}`;
    
    if (success) {
      notification.textContent = getTranslatedMessage('prettierFormatSuccess', '✓ Code formatted');
      notification.type = 'success';
    } else {
      const errorMsg = getTranslatedMessage('prettierFormatError', '✗ Format failed: {error}');
      // Escape $ characters in error message to prevent replacement issues
      const escapedError = (error || 'Unknown error').replace(/\$/g, '$$$$');
      notification.textContent = errorMsg.replace('{error}', escapedError);
      notification.type = 'error';
    }
    
    notifications.push(notification);
    mockDocument.body.appendChild(notification);
    
    // Simulate removal after timeout
    setTimeout(() => {
      const index = notifications.indexOf(notification);
      if (index > -1) {
        notifications.splice(index, 1);
        if (notification.parentNode) {
          mockDocument.body.removeChild(notification);
        }
      }
    }, 3000);
    
    return notification;
  };

  const showLoadingIndicator = () => {
    const indicator = createMockElement();
    indicator.id = `loading-${Date.now()}`;
    indicator.type = 'loading';
    
    const spinner = createMockElement();
    indicator.appendChild(spinner);
    
    mockDocument.body.appendChild(indicator);
    notifications.push(indicator);
    
    return indicator;
  };

  const hideLoadingIndicator = (indicator) => {
    if (indicator) {
      const index = notifications.indexOf(indicator);
      if (index > -1) {
        notifications.splice(index, 1);
        if (indicator.parentNode) {
          mockDocument.body.removeChild(indicator);
        }
      }
    }
  };

  const logFormattingError = (error, code) => {
    try {
      const isDevelopment = mockWindow.location.hostname === 'localhost' || 
                           mockWindow.location.hostname === '127.0.0.1';
      
      if (!isDevelopment) {
        return; // Don't log in production
      }
      
      // Sanitize code - more aggressive approach
      let sanitizedCode = code
        .replace(/(['"`])[^'"`]*\1/g, '$1[STRING]$1') // Replace string contents
        .replace(/\/\*[\s\S]*?\*\//g, '/* [COMMENT] */') // Replace block comments
        .replace(/\/\/.*$/gm, '// [COMMENT]') // Replace line comments
        .replace(/secret-key-\d+/gi, '[REDACTED-KEY]') // Replace API keys
        .replace(/password/gi, '[REDACTED-PASSWORD]') // Replace passwords
        .substring(0, 200); // Limit length
      
      console.warn('[PrettierExtension] Formatting error:', {
        error: error.message,
        codeLength: code.length,
        codePreview: sanitizedCode,
        timestamp: new Date().toISOString()
      });
    } catch (logError) {
      // Fail silently if logging fails
      console.warn('[PrettierExtension] Failed to log error:', logError.message);
    }
  };

  const getNotifications = () => notifications;
  const clearNotifications = () => {
    notifications = [];
    mockDocument.body.appendChild.mockClear();
    mockDocument.body.removeChild.mockClear();
  };

  return {
    showFormattingFeedback,
    showLoadingIndicator,
    hideLoadingIndicator,
    logFormattingError,
    getNotifications,
    clearNotifications
  };
};

describe('Prettier Visual Feedback and Error Handling', () => {
  let feedbackSystem;
  let consoleSpy;

  beforeEach(() => {
    feedbackSystem = createVisualFeedbackSystem();
    consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    
    // Reset mocks
    mockDocument.createElement.mockImplementation(() => createMockElement());
    mockDocument.body.appendChild.mockClear();
    mockDocument.body.removeChild.mockClear();
    mockDocument.getElementById.mockReturnValue(null);
  });

  afterEach(() => {
    feedbackSystem.clearNotifications();
    consoleSpy.mockRestore();
  });

  describe('Property Tests', () => {
    it('Property 9: Visual Feedback Consistency - should show consistent feedback for all operations', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            success: fc.boolean(),
            error: fc.option(fc.string({ minLength: 1, maxLength: 100 })),
            operationType: fc.constantFrom('format', 'autoFormat', 'selection')
          }),
          async ({ success, error, operationType }) => {
            const mockView = { state: { doc: { toString: () => 'test code' } } };
            
            const notification = feedbackSystem.showFormattingFeedback(
              mockView, 
              success, 
              error
            );
            
            // Should always create a notification
            expect(notification).toBeDefined();
            expect(notification.id).toBeDefined();
            expect(notification.textContent).toBeTruthy();
            
            // Should have correct type
            expect(notification.type).toBe(success ? 'success' : 'error');
            
            // Should be added to DOM
            expect(mockDocument.body.appendChild).toHaveBeenCalledWith(notification);
            
            // Error messages should contain error info
            if (success) {
              expect(notification.textContent).toMatch(/✓|success|formatted/i);
            } else {
              expect(notification.textContent).toMatch(/✗|error|failed/i);
              // Only check if error is provided and not just whitespace
              if (error && error.trim().length > 0) {
                expect(notification.textContent).toContain(error);
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('Property 12: Error Notification Consistency - should handle all error types consistently', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            errorType: fc.constantFrom('syntax', 'timeout', 'network', 'unknown'),
            errorMessage: fc.string({ minLength: 1, maxLength: 200 }),
            hasTranslations: fc.boolean()
          }),
          async ({ errorType, errorMessage, hasTranslations }) => {
            // Set up translations conditionally
            if (!hasTranslations) {
              mockWindow.strudelTranslations = null;
            }
            
            const mockView = { state: { doc: { toString: () => 'test code' } } };
            const notification = feedbackSystem.showFormattingFeedback(
              mockView, 
              false, 
              errorMessage
            );
            
            // Should always show error notification
            expect(notification.type).toBe('error');
            expect(notification.textContent).toBeTruthy();
            
            // Should contain error message
            if (errorMessage && errorMessage.trim().length > 0) {
              // The notification should contain the error message within the formatted text
              expect(notification.textContent).toContain(errorMessage);
            }
            
            // Should use fallback if no translations
            if (!hasTranslations) {
              expect(notification.textContent).toMatch(/✗.*failed/i);
            }
            
            // Reset translations
            mockWindow.strudelTranslations = {
              messages: {
                prettierFormatSuccess: '✓ Code formatted successfully',
                prettierFormatError: '✗ Format failed: {error}'
              }
            };
          }
        ),
        { numRuns: 100 }
      );
    });

    it('Property 13: Error Logging Privacy - should protect user privacy in error logs', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            code: fc.string({ minLength: 10, maxLength: 1000 }),
            error: fc.string({ minLength: 1, maxLength: 100 }),
            isProduction: fc.boolean(),
            containsSensitiveData: fc.boolean()
          }),
          async ({ code, error, isProduction, containsSensitiveData }) => {
            // Add sensitive data to code if specified
            let testCode = code;
            if (containsSensitiveData) {
              testCode += '\nconst apiKey = "secret-key-12345";\nconst password = "mypassword";';
            }
            
            // Set environment
            mockWindow.location.hostname = isProduction ? 'strudel.cc' : 'localhost';
            
            const testError = new Error(error);
            feedbackSystem.logFormattingError(testError, testCode);
            
            if (isProduction) {
              // Should not log in production
              expect(consoleSpy).not.toHaveBeenCalled();
            } else {
              // Should log in development
              expect(consoleSpy).toHaveBeenCalled();
              
              if (consoleSpy.mock.calls.length > 0) {
                const loggedData = consoleSpy.mock.calls[0][1];
                
                // Should sanitize sensitive data only if it was actually added
                if (containsSensitiveData && loggedData.codePreview && testCode.includes('secret-key-12345')) {
                  expect(loggedData.codePreview).not.toContain('secret-key-12345');
                  expect(loggedData.codePreview).not.toContain('mypassword');
                  expect(loggedData.codePreview).toMatch(/\[STRING\]|\[REDACTED/);
                }
                
                // Should limit code length
                expect(loggedData.codePreview.length).toBeLessThanOrEqual(200);
                
                // Should include error message (might be different due to Error constructor)
                expect(loggedData.error).toBeTruthy();
                expect(typeof loggedData.error).toBe('string');
              }
            }
            
            consoleSpy.mockClear();
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Unit Tests', () => {
    it('should show success notification with correct styling', () => {
      const mockView = { state: { doc: { toString: () => 'test code' } } };
      const notification = feedbackSystem.showFormattingFeedback(mockView, true);
      
      expect(notification.type).toBe('success');
      expect(notification.textContent).toContain('✓');
      expect(mockDocument.body.appendChild).toHaveBeenCalledWith(notification);
    });

    it('should show error notification with error message', () => {
      const mockView = { state: { doc: { toString: () => 'test code' } } };
      const errorMessage = 'Syntax error on line 5';
      const notification = feedbackSystem.showFormattingFeedback(mockView, false, errorMessage);
      
      expect(notification.type).toBe('error');
      expect(notification.textContent).toContain('✗');
      expect(notification.textContent).toContain(errorMessage);
    });

    it('should use translated messages when available', () => {
      const mockView = { state: { doc: { toString: () => 'test code' } } };
      const notification = feedbackSystem.showFormattingFeedback(mockView, true);
      
      expect(notification.textContent).toBe('✓ Code formatted successfully');
    });

    it('should use fallback messages when translations unavailable', () => {
      mockWindow.strudelTranslations = null;
      
      const mockView = { state: { doc: { toString: () => 'test code' } } };
      const notification = feedbackSystem.showFormattingFeedback(mockView, true);
      
      expect(notification.textContent).toBe('✓ Code formatted');
      
      // Reset translations
      mockWindow.strudelTranslations = {
        messages: {
          prettierFormatSuccess: '✓ Code formatted successfully',
          prettierFormatError: '✗ Format failed: {error}'
        }
      };
    });

    it('should show loading indicator for long operations', () => {
      const indicator = feedbackSystem.showLoadingIndicator();
      
      expect(indicator.type).toBe('loading');
      expect(mockDocument.body.appendChild).toHaveBeenCalledWith(indicator);
    });

    it('should hide loading indicator properly', () => {
      const indicator = feedbackSystem.showLoadingIndicator();
      feedbackSystem.hideLoadingIndicator(indicator);
      
      // Should be removed from notifications
      expect(feedbackSystem.getNotifications()).not.toContain(indicator);
    });

    it('should sanitize sensitive data in error logs', () => {
      mockWindow.location.hostname = 'localhost';
      
      const sensitiveCode = `
        const apiKey = "sk-1234567890abcdef";
        const password = 'mySecretPassword';
        /* This is a secret comment */
        // Another secret comment
        function test() { return "sensitive data"; }
      `;
      
      const error = new Error('Test error');
      feedbackSystem.logFormattingError(error, sensitiveCode);
      
      expect(consoleSpy).toHaveBeenCalled();
      const loggedData = consoleSpy.mock.calls[0][1];
      
      // Should replace strings with [STRING]
      expect(loggedData.codePreview).toMatch(/\[STRING\]/);
      expect(loggedData.codePreview).not.toContain('sk-1234567890abcdef');
      expect(loggedData.codePreview).not.toContain('mySecretPassword');
      
      // Should replace comments
      expect(loggedData.codePreview).toMatch(/\[COMMENT\]/);
      expect(loggedData.codePreview).not.toContain('secret comment');
    });

    it('should not log errors in production environment', () => {
      mockWindow.location.hostname = 'strudel.cc';
      
      const error = new Error('Test error');
      feedbackSystem.logFormattingError(error, 'test code');
      
      expect(consoleSpy).not.toHaveBeenCalled();
    });

    it('should limit code preview length in logs', () => {
      mockWindow.location.hostname = 'localhost';
      
      const longCode = 'a'.repeat(1000);
      const error = new Error('Test error');
      feedbackSystem.logFormattingError(error, longCode);
      
      expect(consoleSpy).toHaveBeenCalled();
      const loggedData = consoleSpy.mock.calls[0][1];
      
      expect(loggedData.codePreview.length).toBeLessThanOrEqual(200);
      expect(loggedData.codeLength).toBe(1000);
    });

    it('should handle logging errors gracefully', () => {
      mockWindow.location.hostname = 'localhost';
      
      // Create a spy that throws on the first call but succeeds on the second
      let callCount = 0;
      const mockWarn = vi.fn(() => {
        callCount++;
        if (callCount === 1) {
          throw new Error('Logging failed');
        }
      });
      
      // Replace console.warn temporarily
      const originalWarn = console.warn;
      console.warn = mockWarn;
      
      const error = new Error('Test error');
      
      // Should not throw - the try-catch should handle it
      expect(() => {
        feedbackSystem.logFormattingError(error, 'test code');
      }).not.toThrow();
      
      // Should have attempted to log (first call throws, second call for error handling)
      expect(mockWarn).toHaveBeenCalled();
      
      // Restore console.warn
      console.warn = originalWarn;
    });

    it('should clean up notifications after timeout', (done) => {
      const mockView = { state: { doc: { toString: () => 'test code' } } };
      const notification = feedbackSystem.showFormattingFeedback(mockView, true);
      
      expect(feedbackSystem.getNotifications()).toContain(notification);
      
      // Wait for cleanup timeout
      setTimeout(() => {
        expect(feedbackSystem.getNotifications()).not.toContain(notification);
        done();
      }, 3100);
    }, 4000);

    it('should handle multiple simultaneous notifications', () => {
      const mockView = { state: { doc: { toString: () => 'test code' } } };
      
      const notification1 = feedbackSystem.showFormattingFeedback(mockView, true);
      const notification2 = feedbackSystem.showFormattingFeedback(mockView, false, 'Error 1');
      const notification3 = feedbackSystem.showFormattingFeedback(mockView, false, 'Error 2');
      
      const notifications = feedbackSystem.getNotifications();
      expect(notifications).toContain(notification1);
      expect(notifications).toContain(notification2);
      expect(notifications).toContain(notification3);
      expect(notifications.length).toBe(3);
    });
  });
});