import { EditorView, keymap } from '@codemirror/view';
import { StateEffect, StateField } from '@codemirror/state';
import { formatService } from './format.mjs';

/**
 * State effect for triggering formatting
 */
const formatEffect = StateEffect.define();

/**
 * State field to track formatting state
 */
const formatState = StateField.define({
  create() {
    return { isFormatting: false, lastFormatTime: 0 };
  },
  update(state, tr) {
    for (const effect of tr.effects) {
      if (effect.is(formatEffect)) {
        return { isFormatting: effect.value, lastFormatTime: Date.now() };
      }
    }
    return state;
  },
});

/**
 * Format the current document
 * @param {EditorView} view - The CodeMirror editor view
 * @returns {Promise<boolean>} - Whether formatting was successful
 */
async function formatDocument(view) {
  if (!formatService.isEnabled()) {
    console.warn('[PrettierExtension] Format service not available');
    return false;
  }

  const state = view.state;
  const code = state.doc.toString();

  // Don't format if already formatting or if code is empty
  if (state.field(formatState).isFormatting || !code.trim()) {
    return false;
  }

  // Basic validation before attempting to format
  if (!formatService.isValidCode(code)) {
    console.warn('[PrettierExtension] Code appears to have syntax errors, skipping format');
    return false;
  }

  try {
    // Set formatting state
    view.dispatch({
      effects: formatEffect.of(true),
    });

    // Store cursor position
    const selection = state.selection;
    const cursorPos = selection.main.head;

    // Format the code
    const formatted = await formatService.formatCode(code);

    // Only update if the code actually changed
    if (formatted !== code) {
      // Calculate new cursor position (simple approach - try to maintain relative position)
      const lines = code.split('\n');
      const formattedLines = formatted.split('\n');
      let newCursorPos;

      // If the number of lines changed significantly, just put cursor at the end
      if (Math.abs(lines.length - formattedLines.length) > 5) {
        newCursorPos = formatted.length;
      } else {
        // Try to maintain cursor position relative to content
        newCursorPos = Math.min(cursorPos, formatted.length);
      }

      // Apply the formatting
      view.dispatch({
        changes: {
          from: 0,
          to: state.doc.length,
          insert: formatted,
        },
        selection: { anchor: newCursorPos },
        effects: formatEffect.of(false),
      });

      console.log('[PrettierExtension] Code formatted successfully');
      return true;
    } else {
      // Clear formatting state even if no changes
      view.dispatch({
        effects: formatEffect.of(false),
      });
      return false;
    }
  } catch (error) {
    console.error('[PrettierExtension] Formatting failed:', error);

    // Clear formatting state on error
    view.dispatch({
      effects: formatEffect.of(false),
    });

    // Show user-friendly error message
    if (error.type === 'syntax') {
      console.warn(`[PrettierExtension] Syntax error at line ${error.line}: ${error.message}`);
    } else if (error.type === 'timeout') {
      console.warn('[PrettierExtension] Formatting timed out - code may be too complex');
    }

    return false;
  }
}

/**
 * Command to format the document manually
 */
const formatCommand = {
  key: 'Mod-Shift-f',
  run: (view) => {
    formatDocument(view);
    return true;
  },
};

/**
 * Extension that provides manual formatting command
 */
export const prettierManualFormat = [
  formatState,
  keymap.of([formatCommand]),
];

/**
 * Extension that formats before save operations
 * This listens for save events and formats the code before saving
 */
export const prettierFormatOnSave = [
  formatState,
  EditorView.domEventHandlers({
    // Listen for custom save events
    'strudel-save': async (event, view) => {
      // Format before the save operation completes
      await formatDocument(view);
      return false; // Don't prevent the save event
    },
    // Listen for autosave events
    'strudel-autosave': async (event, view) => {
      // Format before the autosave operation completes
      await formatDocument(view);
      return false; // Don't prevent the autosave event
    },
  }),
];

/**
 * Extension that formats on document changes (for autosave integration)
 * This provides a debounced formatting that can be triggered by external systems
 */
export const prettierFormatOnAutosave = [
  formatState,
  EditorView.updateListener.of((update) => {
    // This will be triggered by external autosave systems
    if (update.docChanged) {
      const view = update.view;

      // Check if prettier is enabled via a data attribute or global state
      const isPrettierEnabled = view.dom.dataset.prettierEnabled === 'true';
      if (!isPrettierEnabled) return;

      // Debounce formatting to avoid excessive calls
      const formatStateValue = view.state.field(formatState);
      const now = Date.now();

      if (now - formatStateValue.lastFormatTime > 2000) { // 2 second debounce
        // Use a timeout to avoid formatting on every keystroke
        setTimeout(() => {
          if (view.hasFocus) { // Only format if editor is still focused
            formatDocument(view);
          }
        }, 1000); // 1 second delay after last change
      }
    }
  }),
];

/**
 * Main prettier extension that can be configured
 * @param {boolean} enabled - Whether prettier formatting is enabled
 * @returns {Extension[]} - Array of CodeMirror extensions
 */
export function isPrettierEnabled(enabled) {
  if (!enabled) {
    return [];
  }

  return [
    prettierManualFormat,
    prettierFormatOnSave,
    // Set data attribute to indicate prettier is enabled
    EditorView.theme({}, { dark: false }),
    EditorView.updateListener.of((update) => {
      // Set data attribute on the editor DOM element
      if (update.view.dom) {
        update.view.dom.dataset.prettierEnabled = 'true';
      }
    }),
  ];
}

/**
 * Utility function to format code outside of the editor
 * @param {string} code - Code to format
 * @returns {Promise<string>} - Formatted code
 */
export async function formatCode(code) {
  return formatService.formatCode(code);
}

/**
 * Utility function to trigger formatting on an editor view
 * @param {EditorView} view - The editor view to format
 * @returns {Promise<boolean>} - Whether formatting was successful
 */
export async function triggerFormat(view) {
  return formatDocument(view);
}
