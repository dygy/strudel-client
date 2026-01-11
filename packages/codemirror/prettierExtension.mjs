import { keymap } from '@codemirror/view';
import { Prec } from '@codemirror/state';

/**
 * Prettier extension for CodeMirror
 * Provides formatting commands and keyboard shortcuts
 */

let formatEngine = null;
let createPrettierOptions = null;
let settingsMap = null;

// Lazy load the format engine and settings to avoid circular dependencies
async function getFormatEngine() {
  if (!formatEngine) {
    try {
      const module = await import('../../website/src/repl/formatEngine.ts');
      formatEngine = module.formatEngine;
      createPrettierOptions = module.createPrettierOptions;
    } catch (error) {
      console.error('[PrettierExtension] Failed to load format engine:', error);
      throw error;
    }
  }
  return { formatEngine, createPrettierOptions };
}

// Lazy load the settings store
async function getSettingsMap() {
  if (!settingsMap) {
    try {
      const module = await import('../../website/src/settings.ts');
      settingsMap = module.settingsMap;
    } catch (error) {
      console.error('[PrettierExtension] Failed to load settings store:', error);
      throw error;
    }
  }
  return settingsMap;
}

/**
 * Gets current settings from the settings store
 */
async function getCurrentSettings() {
  try {
    const store = await getSettingsMap();
    return store.get();
  } catch (error) {
    console.warn('[PrettierExtension] Failed to get settings from store, using defaults:', error);
    // Fallback to default settings if store is not available
    return {
      isPrettierEnabled: false,
      prettierTabWidth: 2,
      prettierUseTabs: false,
      prettierSemi: true,
      prettierSingleQuote: false,
      prettierQuoteProps: 'as-needed',
      prettierTrailingComma: 'es5',
      prettierBracketSpacing: true,
      prettierArrowParens: 'always',
      prettierPrintWidth: 80,
    };
  }
}

/**
 * Preserves cursor position after formatting
 */
function preserveCursorPosition(view, originalCode, formattedCode, originalCursor) {
  try {
    // Simple cursor preservation: try to maintain relative position
    const ratio = originalCursor / originalCode.length;
    const newCursor = Math.min(
      Math.round(ratio * formattedCode.length),
      formattedCode.length
    );
    
    view.dispatch({
      selection: { anchor: newCursor, head: newCursor }
    });
  } catch (error) {
    console.warn('[PrettierExtension] Cursor preservation failed:', error);
  }
}

/**
 * Shows a loading indicator for formatting operations
 */
function showLoadingIndicator() {
  const indicator = document.createElement('div');
  indicator.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 12px 20px;
    border-radius: 8px;
    background: linear-gradient(135deg, #3b82f6, #1d4ed8);
    color: white;
    font-size: 14px;
    font-weight: 500;
    z-index: 10000;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    backdrop-filter: blur(10px);
    border: 1px solid rgba(59, 130, 246, 0.3);
    display: flex;
    align-items: center;
    gap: 8px;
  `;
  
  // Add spinner
  const spinner = document.createElement('div');
  spinner.style.cssText = `
    width: 16px;
    height: 16px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-top: 2px solid white;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  `;
  
  // Add CSS animation for spinner
  if (!document.getElementById('prettier-spinner-style')) {
    const style = document.createElement('style');
    style.id = 'prettier-spinner-style';
    style.textContent = `
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);
  }
  
  indicator.appendChild(spinner);
  indicator.appendChild(document.createTextNode('Formatting...'));
  
  document.body.appendChild(indicator);
  
  return indicator;
}

/**
 * Hides the loading indicator
 */
function hideLoadingIndicator(indicator) {
  if (indicator && indicator.parentNode) {
    indicator.style.opacity = '0';
    indicator.style.transform = 'translateX(100%)';
    setTimeout(() => {
      if (indicator.parentNode) {
        indicator.parentNode.removeChild(indicator);
      }
    }, 300);
  }
}

/**
 * Logs formatting errors with privacy protection
 */
function logFormattingError(error, code) {
  try {
    // Only log in development or when explicitly enabled
    const isDevelopment = typeof window !== 'undefined' && 
      (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
    
    if (!isDevelopment) {
      return; // Don't log in production to protect user privacy
    }
    
    // Sanitize code to remove potentially sensitive information
    const sanitizedCode = code
      .replace(/(['"`])(?:(?!\1)[^\\]|\\.)*\1/g, '$1[STRING]$1') // Replace string contents
      .replace(/\/\*[\s\S]*?\*\//g, '/* [COMMENT] */') // Replace block comments
      .replace(/\/\/.*$/gm, '// [COMMENT]') // Replace line comments
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
}
function showFormattingFeedback(view, success, error = null) {
  // Get translated messages if available
  const getTranslatedMessage = (key, fallback) => {
    if (typeof window !== 'undefined' && window.strudelTranslations) {
      return window.strudelTranslations.messages?.[key] || fallback;
    }
    return fallback;
  };

  // Create a temporary notification element
  const notification = document.createElement('div');
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 12px 20px;
    border-radius: 8px;
    color: white;
    font-size: 14px;
    font-weight: 500;
    z-index: 10000;
    transition: all 0.3s ease;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    backdrop-filter: blur(10px);
    ${success 
      ? 'background: linear-gradient(135deg, #10b981, #059669); border: 1px solid rgba(16, 185, 129, 0.3);' 
      : 'background: linear-gradient(135deg, #ef4444, #dc2626); border: 1px solid rgba(239, 68, 68, 0.3);'
    }
  `;
  
  if (success) {
    notification.textContent = getTranslatedMessage('prettierFormatSuccess', '✓ Code formatted');
  } else {
    const errorMsg = getTranslatedMessage('prettierFormatError', '✗ Format failed: {error}');
    // Escape $ characters in error message to prevent replacement issues
    const escapedError = (error || 'Unknown error').replace(/\$/g, '$$$$');
    notification.textContent = errorMsg.replace('{error}', escapedError);
  }
  
  document.body.appendChild(notification);
  
  // Animate in
  requestAnimationFrame(() => {
    notification.style.transform = 'translateX(0)';
    notification.style.opacity = '1';
  });
  
  // Remove after 3 seconds with fade out
  setTimeout(() => {
    notification.style.opacity = '0';
    notification.style.transform = 'translateX(100%)';
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 300);
  }, 3000);
}

/**
 * Format command that formats the entire document or selection
 */
const formatCommand = {
  key: 'Ctrl-q',
  mac: 'Cmd-q',
  preventDefault: true,
  run: async (view) => {
    try {
      const settings = await getCurrentSettings();
      
      // Check if prettier is enabled
      if (!settings.isPrettierEnabled) {
        console.log('[PrettierExtension] Prettier is disabled in settings');
        return false;
      }

      const { formatEngine, createPrettierOptions } = await getFormatEngine();
      const prettierOptions = createPrettierOptions(settings);
      
      const state = view.state;
      const selection = state.selection.main;
      const hasSelection = !selection.empty;
      
      let result;
      const originalCode = state.doc.toString();
      const originalCursor = selection.head;
      
      // Show loading indicator for large files
      let loadingIndicator = null;
      if (originalCode.length > 1000) {
        loadingIndicator = showLoadingIndicator();
      }
      
      try {
        if (hasSelection) {
          // Format selection
          const selectedText = state.sliceDoc(selection.from, selection.to);
          result = await formatEngine.formatSelection(
            originalCode,
            selection.from,
            selection.to,
            prettierOptions
          );
        } else {
          // Format entire document
          result = await formatEngine.formatCode(originalCode, prettierOptions);
        }
      } finally {
        // Hide loading indicator
        if (loadingIndicator) {
          hideLoadingIndicator(loadingIndicator);
        }
      }
      
      if (result.success && result.formattedCode) {
        // Apply formatting
        const changes = {
          from: 0,
          to: state.doc.length,
          insert: result.formattedCode
        };
        
        view.dispatch({ changes });
        
        // Preserve cursor position
        if (result.cursorOffset !== undefined) {
          view.dispatch({
            selection: { anchor: result.cursorOffset, head: result.cursorOffset }
          });
        } else {
          preserveCursorPosition(view, originalCode, result.formattedCode, originalCursor);
        }
        
        showFormattingFeedback(view, true);
      } else {
        console.warn('[PrettierExtension] Formatting failed:', result.error);
        logFormattingError(new Error(result.error || 'Unknown error'), originalCode);
        showFormattingFeedback(view, false, result.error);
      }
      
      return true;
    } catch (error) {
      console.error('[PrettierExtension] Format command error:', error);
      logFormattingError(error, view.state.doc.toString());
      showFormattingFeedback(view, false, error.message);
      return false;
    }
  }
};

/**
 * Auto-format on save functionality
 */
export async function autoFormatOnSave(code, settings = null) {
  try {
    // Get settings if not provided
    const currentSettings = settings || await getCurrentSettings();
    
    // Check if auto-format on save is enabled
    if (!currentSettings.isPrettierEnabled || !currentSettings.prettierAutoFormatOnSave) {
      return { success: true, formattedCode: code };
    }

    const { formatEngine, createPrettierOptions } = await getFormatEngine();
    const prettierOptions = createPrettierOptions(currentSettings);
    
    const result = await formatEngine.formatCode(code, prettierOptions);
    
    if (result.success && result.formattedCode) {
      return { success: true, formattedCode: result.formattedCode };
    } else {
      // If formatting fails, return original code and log error
      console.warn('[PrettierExtension] Auto-format on save failed:', result.error);
      return { success: false, formattedCode: code, error: result.error };
    }
  } catch (error) {
    console.error('[PrettierExtension] Auto-format on save error:', error);
    return { success: false, formattedCode: code, error: error.message };
  }
}

/**
 * Creates the prettier keymap extension
 */
export function prettierKeymap() {
  return Prec.high(keymap.of([formatCommand]));
}

/**
 * Main prettier extension that can be enabled/disabled
 */
export function prettierExtension(enabled = true) {
  if (!enabled) {
    return [];
  }
  
  return [
    prettierKeymap()
  ];
}

// Export the format command for external use
export { formatCommand };