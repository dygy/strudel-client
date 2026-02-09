/**
 * ErrorNotifier - Centralized error notification system for AudioMixer
 * 
 * Manages error notifications with listeners, history tracking,
 * and typed error interfaces.
 * 
 * @class ErrorNotifier
 * @license AGPL-3.0-or-later
 */

export class ErrorNotifier {
  constructor() {
    this.listeners = new Set();
    this.errorHistory = [];
    this.maxHistorySize = 50;
  }

  /**
   * Notify all listeners of an error
   * 
   * @param {ErrorNotification} error - Error details
   */
  notify(error) {
    // Add timestamp if not present
    if (!error.timestamp) {
      error.timestamp = Date.now();
    }

    // Log to console
    const logLevel = error.recoverable ? 'warn' : 'error';
    console[logLevel](`[AudioMixer] ${error.type}:`, error.message, error.details || '');

    // Notify all listeners
    this.listeners.forEach(listener => {
      try {
        listener(error);
      } catch (err) {
        console.error('Error in error listener:', err);
      }
    });

    // Add to history
    this.errorHistory.push(error);
    if (this.errorHistory.length > this.maxHistorySize) {
      this.errorHistory.shift();
    }
  }

  /**
   * Subscribe to error notifications
   * 
   * @param {Function} listener - Callback function to receive errors
   * @returns {Function} Unsubscribe function
   */
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Get error history
   * 
   * @param {number} limit - Maximum number of errors to return
   * @returns {Array<ErrorNotification>} Recent errors
   */
  getHistory(limit = 10) {
    return this.errorHistory.slice(-limit);
  }

  /**
   * Clear error history
   */
  clearHistory() {
    this.errorHistory = [];
  }

  /**
   * Get error count by type
   * 
   * @returns {Object} Error counts by type
   */
  getErrorCounts() {
    const counts = {};
    this.errorHistory.forEach(error => {
      counts[error.type] = (counts[error.type] || 0) + 1;
    });
    return counts;
  }
}

/**
 * @typedef {Object} ErrorNotification
 * @property {string} type - Error type ('device-failure', 'evaluation-error', 'transition-error', 'resource-warning', 'permission-denied')
 * @property {string} message - Human-readable error message
 * @property {string} [details] - Additional error details
 * @property {boolean} recoverable - Whether the error is recoverable
 * @property {string} [action] - Suggested action to resolve the error
 * @property {number} timestamp - Error timestamp
 */
