import { keymap } from '@codemirror/view';
import { Prec } from '@codemirror/state';
import { formattedReplacement } from './replaceCode.mjs';

/**
 * Prettier extension for CodeMirror
 * Provides formatting commands and keyboard shortcuts
 */

let formatEngine = null;
let createPrettierOptions = null;
let settingsMap = null;
let i18n = null;

// settingsMap is persisted, so booleans come back from a page reload as the strings 'true' and 'false'.
const isOn = (value) => value === true || value === 'true';

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

// Lazy load the translations, like the rest. Without them the messages stay in English.
async function loadTranslations() {
  if (!i18n) {
    try {
      i18n = (await import('../../website/src/i18n/i18n.ts')).default;
    } catch (error) {
      console.warn('[PrettierExtension] Failed to load translations:', error);
    }
  }
}

function translate(key, fallback) {
  const text = i18n?.t(`messages:${key}`);
  // i18next answers with the key while a language is still loading
  return text && !text.endsWith(key) ? text : fallback;
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
 * Shows a loading indicator for formatting operations
 */
function showLoadingIndicator(text) {
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
  indicator.appendChild(document.createTextNode(text));

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
    const isDevelopment =
      typeof window !== 'undefined' &&
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
      timestamp: new Date().toISOString(),
    });
  } catch (logError) {
    // Fail silently if logging fails
    console.warn('[PrettierExtension] Failed to log error:', logError.message);
  }
}
function showFormattingFeedback(view, success, error = null, notice = null) {
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
    ${
      success
        ? 'background: linear-gradient(135deg, #10b981, #059669); border: 1px solid rgba(16, 185, 129, 0.3);'
        : 'background: linear-gradient(135deg, #ef4444, #dc2626); border: 1px solid rgba(239, 68, 68, 0.3);'
    }
  `;

  if (notice) {
    notification.textContent = notice;
    notification.style.background = 'linear-gradient(135deg, #f59e0b, #d97706)';
    notification.style.border = '1px solid rgba(245, 158, 11, 0.3)';
  } else if (success) {
    notification.textContent = translate('prettierFormatSuccess', 'Code formatted successfully');
  } else {
    // A callback, so `$` in the error stays literal
    notification.textContent = translate('prettierFormatError', 'Format failed: {error}').replace(
      '{error}',
      () => error || 'Unknown error',
    );
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

const FORMAT_REJECTED =
  "Code left unchanged: it could not be formatted safely. It may have unfinished syntax or something the formatter doesn't support.";

/**
 * Format command that formats the entire document or selection
 */
const formatCommand = {
  // Not Mod-q: Cmd-Q and Ctrl-Q quit the browser
  key: 'Shift-Alt-f',
  preventDefault: true,
  run: async (view) => {
    try {
      const settings = await getCurrentSettings();
      await loadTranslations();

      // Check if prettier is enabled
      if (!isOn(settings.isPrettierEnabled)) {
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

      // Show loading indicator for large files
      let loadingIndicator = null;
      if (originalCode.length > 1000) {
        loadingIndicator = showLoadingIndicator(translate('prettierFormatting', 'Formatting...'));
      }

      try {
        if (hasSelection) {
          // Format selection
          const selectedText = state.sliceDoc(selection.from, selection.to);
          result = await formatEngine.formatSelection(originalCode, selection.from, selection.to, prettierOptions);
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

      // The result is for the text it was given. The user may have typed or changed track during the wait, and the
      // next autosave would write what's in the editor to the track now open.
      if (view.state.doc.toString() !== originalCode) {
        return true;
      }

      if (result.success && result.rejected) {
        showFormattingFeedback(view, false, null, translate('prettierFormatRejected', FORMAT_REJECTED));
      } else if (result.success && result.formattedCode) {
        // Apply formatting: the cursor, the selection and the scroll position stay on the same code
        view.dispatch(formattedReplacement(view, result.formattedCode));

        if (result.cursorOffset !== undefined) {
          view.dispatch({
            selection: { anchor: result.cursorOffset, head: result.cursorOffset },
          });
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
  },
};

/**
 * Auto-format on save functionality
 */
export async function autoFormatOnSave(code, settings = null) {
  try {
    // Get settings if not provided
    const currentSettings = settings || (await getCurrentSettings());

    // Check if auto-format on save is enabled
    if (!isOn(currentSettings.isPrettierEnabled) || !isOn(currentSettings.prettierAutoFormatOnSave)) {
      return { success: true, formattedCode: code };
    }

    const { formatEngine, createPrettierOptions } = await getFormatEngine();
    const prettierOptions = createPrettierOptions(currentSettings);

    const result = await formatEngine.formatCode(code, prettierOptions);

    if (result.success && result.formattedCode) {
      return { success: true, formattedCode: result.formattedCode, ...(result.rejected && { rejected: true }) };
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

  return [prettierKeymap()];
}

// Export the format command for external use
export { formatCommand };
