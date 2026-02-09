/**
 * KeyboardShortcutManager - Manages keyboard shortcuts for mixer operations
 * 
 * Provides a flexible system for registering, handling, and customizing
 * keyboard shortcuts with conflict detection.
 * 
 * @class KeyboardShortcutManager
 * @license AGPL-3.0-or-later
 */

export class KeyboardShortcutManager {
  /**
   * Create a KeyboardShortcutManager
   */
  constructor() {
    this.shortcuts = new Map();
    this.isEnabled = true;
    this.handleKeyDown = this.handleKeyDown.bind(this);
  }

  /**
   * Register a keyboard shortcut
   * 
   * @param {string} id - Unique identifier for the shortcut
   * @param {Object} config - Shortcut configuration
   * @param {string} config.key - Key code (e.g., 'KeyM', 'KeyI', 'KeyX')
   * @param {boolean} config.ctrl - Requires Ctrl key
   * @param {boolean} config.shift - Requires Shift key
   * @param {boolean} config.alt - Requires Alt key
   * @param {Function} config.handler - Function to call when shortcut is triggered
   * @param {string} config.description - Human-readable description
   */
  register(id, config) {
    const { key, ctrl = false, shift = false, alt = false, handler, description } = config;

    if (!key || !handler) {
      throw new Error('Shortcut must have key and handler');
    }

    // Check for conflicts
    const conflictId = this.findConflict(key, ctrl, shift, alt);
    if (conflictId) {
      console.warn(`Shortcut conflict: ${id} conflicts with ${conflictId}`);
    }

    this.shortcuts.set(id, {
      key,
      ctrl,
      shift,
      alt,
      handler,
      description: description || id,
    });

    console.log(`Registered shortcut: ${id} (${this.formatShortcut(config)})`);
  }

  /**
   * Unregister a keyboard shortcut
   * 
   * @param {string} id - Shortcut identifier
   */
  unregister(id) {
    this.shortcuts.delete(id);
    console.log(`Unregistered shortcut: ${id}`);
  }

  /**
   * Find conflicting shortcut
   * 
   * @param {string} key - Key code
   * @param {boolean} ctrl - Ctrl key required
   * @param {boolean} shift - Shift key required
   * @param {boolean} alt - Alt key required
   * @returns {string|null} ID of conflicting shortcut or null
   */
  findConflict(key, ctrl, shift, alt) {
    for (const [id, config] of this.shortcuts.entries()) {
      if (
        config.key === key &&
        config.ctrl === ctrl &&
        config.shift === shift &&
        config.alt === alt
      ) {
        return id;
      }
    }
    return null;
  }

  /**
   * Format shortcut for display
   * 
   * @param {Object} config - Shortcut configuration
   * @returns {string} Formatted shortcut string
   */
  formatShortcut(config) {
    const parts = [];
    if (config.ctrl) parts.push('Ctrl');
    if (config.shift) parts.push('Shift');
    if (config.alt) parts.push('Alt');
    parts.push(config.key.replace('Key', ''));
    return parts.join('+');
  }

  /**
   * Handle keydown event
   * 
   * @param {KeyboardEvent} event - Keyboard event
   */
  handleKeyDown(event) {
    if (!this.isEnabled) return;

    // Don't trigger shortcuts when typing in input fields
    const target = event.target;
    if (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable
    ) {
      return;
    }

    // Find matching shortcut
    for (const [id, config] of this.shortcuts.entries()) {
      if (
        event.code === config.key &&
        event.ctrlKey === config.ctrl &&
        event.shiftKey === config.shift &&
        event.altKey === config.alt
      ) {
        event.preventDefault();
        event.stopPropagation();

        try {
          config.handler(event);
          console.log(`Executed shortcut: ${id}`);
        } catch (err) {
          console.error(`Shortcut handler failed for ${id}:`, err);
        }

        break;
      }
    }
  }

  /**
   * Enable keyboard shortcuts
   */
  enable() {
    if (this.isEnabled) return;

    this.isEnabled = true;
    document.addEventListener('keydown', this.handleKeyDown, true);
    console.log('Keyboard shortcuts enabled');
  }

  /**
   * Disable keyboard shortcuts
   */
  disable() {
    if (!this.isEnabled) return;

    this.isEnabled = false;
    document.removeEventListener('keydown', this.handleKeyDown, true);
    console.log('Keyboard shortcuts disabled');
  }

  /**
   * Get all registered shortcuts
   * 
   * @returns {Array} Array of shortcut info objects
   */
  getShortcuts() {
    const shortcuts = [];
    for (const [id, config] of this.shortcuts.entries()) {
      shortcuts.push({
        id,
        key: this.formatShortcut(config),
        description: config.description,
      });
    }
    return shortcuts;
  }

  /**
   * Load custom shortcuts from localStorage
   * 
   * @param {string} storageKey - localStorage key
   */
  loadCustomShortcuts(storageKey = 'strudel-mixer-shortcuts') {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const customShortcuts = JSON.parse(stored);
        
        for (const [id, config] of Object.entries(customShortcuts)) {
          if (this.shortcuts.has(id)) {
            // Update existing shortcut
            const existing = this.shortcuts.get(id);
            this.shortcuts.set(id, {
              ...existing,
              ...config,
            });
          }
        }
        
        console.log('Custom shortcuts loaded');
      }
    } catch (err) {
      console.error('Failed to load custom shortcuts:', err);
    }
  }

  /**
   * Save custom shortcuts to localStorage
   * 
   * @param {string} storageKey - localStorage key
   */
  saveCustomShortcuts(storageKey = 'strudel-mixer-shortcuts') {
    try {
      const customShortcuts = {};
      
      for (const [id, config] of this.shortcuts.entries()) {
        customShortcuts[id] = {
          key: config.key,
          ctrl: config.ctrl,
          shift: config.shift,
          alt: config.alt,
        };
      }
      
      localStorage.setItem(storageKey, JSON.stringify(customShortcuts));
      console.log('Custom shortcuts saved');
    } catch (err) {
      console.error('Failed to save custom shortcuts:', err);
    }
  }

  /**
   * Cleanup and destroy the manager
   */
  destroy() {
    this.disable();
    this.shortcuts.clear();
    console.log('KeyboardShortcutManager destroyed');
  }
}
