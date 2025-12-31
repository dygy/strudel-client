import * as prettier from 'prettier';
import * as parserBabel from 'prettier/plugins/babel';
import * as parserEstree from 'prettier/plugins/estree';

/**
 * Default Prettier configuration for Strudel code formatting
 */
const DEFAULT_PRETTIER_CONFIG = {
  printWidth: 120,
  useTabs: false,
  tabWidth: 2,
  semi: false, // NEVER add semicolons - they break Strudel code
  singleQuote: false, // Default to double quotes
  jsxSingleQuote: false,
  trailingComma: 'all',
  bracketSpacing: true,
  bracketSameLine: false,
  arrowParens: 'always',
  proseWrap: 'preserve',
  htmlWhitespaceSensitivity: 'css',
  endOfLine: 'lf',
  parser: 'babel',
  plugins: [parserBabel, parserEstree],
};

/**
 * Format service for handling code formatting with Prettier
 */
export class FormatService {
  constructor() {
    this.config = DEFAULT_PRETTIER_CONFIG;
    this.cache = new Map();
    this.isLoaded = false;
    this.loadPromise = null;
    this.userSettingsProvider = null;
  }

  /**
   * Set a function to provide user settings
   * @param {Function} provider - Function that returns user settings
   */
  setUserSettingsProvider(provider) {
    this.userSettingsProvider = provider;
    // Clear cache when settings provider changes
    this.cache.clear();
  }

  /**
   * Get current configuration with user settings applied
   * @returns {Object} Prettier configuration
   */
  getCurrentConfig() {
    let config = { ...this.config };
    
    // Apply user settings if available
    if (this.userSettingsProvider) {
      try {
        const userSettings = this.userSettingsProvider();
        if (userSettings) {
          config = {
            ...config,
            printWidth: userSettings.prettierPrintWidth || config.printWidth,
            useTabs: userSettings.prettierUseTabs !== undefined ? userSettings.prettierUseTabs : config.useTabs,
            tabWidth: userSettings.prettierTabWidth || config.tabWidth,
            // semi: NEVER allow semicolons to be enabled - they break Strudel code
            singleQuote: userSettings.prettierSingleQuote !== undefined ? userSettings.prettierSingleQuote : config.singleQuote,
            quoteProps: userSettings.prettierQuoteProps || config.quoteProps,
            trailingComma: userSettings.prettierTrailingComma || config.trailingComma,
            bracketSpacing: userSettings.prettierBracketSpacing !== undefined ? userSettings.prettierBracketSpacing : config.bracketSpacing,
            arrowParens: userSettings.prettierArrowParens || config.arrowParens,
          };
        }
      } catch (error) {
        console.warn('[FormatService] Failed to get user settings:', error);
      }
    }
    
    return config;
  }

  /**
   * Initialize the format service and load Prettier
   */
  async initialize() {
    if (this.loadPromise) {
      return this.loadPromise;
    }

    this.loadPromise = this._loadPrettier();
    return this.loadPromise;
  }

  /**
   * Load Prettier asynchronously
   */
  async _loadPrettier() {
    try {
      // Prettier is already imported at the top, but we can add additional setup here
      this.isLoaded = true;
      console.log('[FormatService] Prettier loaded successfully');
    } catch (error) {
      console.error('[FormatService] Failed to load Prettier:', error);
      this.isLoaded = false;
      throw error;
    }
  }

  /**
   * Check if the format service is enabled and ready
   */
  isEnabled() {
    return this.isLoaded;
  }

  /**
   * Get the current Prettier configuration
   */
  getConfig() {
    return { ...this.config };
  }

  /**
   * Update the Prettier configuration
   */
  setConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    // Clear cache when config changes
    this.cache.clear();
  }

  /**
   * Format code using Prettier
   * @param {string} code - The code to format
   * @param {Object} options - Optional formatting options
   * @returns {Promise<string>} - The formatted code
   */
  async formatCode(code, options = {}) {
    if (!this.isLoaded) {
      await this.initialize();
    }

    if (!this.isLoaded) {
      throw new Error('Prettier is not available');
    }

    // Get current config with user settings
    const currentConfig = this.getCurrentConfig();
    
    // Create cache key including user settings
    const cacheKey = JSON.stringify({ code, config: currentConfig, options });
    
    // Check cache first
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    try {
      const formatConfig = { ...currentConfig, ...options };
      
      // Pre-process: Temporarily replace $: with a placeholder to prevent Prettier from adding spaces
      const STRUDEL_LABEL_PLACEHOLDER = 'strudelLabel';
      const URL_PROTOCOL_PLACEHOLDER = 'URLPROTOCOL';
      
      // More comprehensive $: protection - replace the entire $: pattern including what follows
      let preprocessedCode = code.replace(/\$:\s*/g, STRUDEL_LABEL_PLACEHOLDER + ':');
      
      // Protect URLs from being processed incorrectly - replace https:// and http:// with placeholders
      preprocessedCode = preprocessedCode.replace(/https:\/\//g, URL_PROTOCOL_PLACEHOLDER + 'HTTPS');
      preprocessedCode = preprocessedCode.replace(/http:\/\//g, URL_PROTOCOL_PLACEHOLDER + 'HTTP');
      
      // Add timeout wrapper
      const formatPromise = prettier.format(preprocessedCode, formatConfig);
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Formatting timeout')), 5000);
      });

      const formatted = await Promise.race([formatPromise, timeoutPromise]);
      
      // Post-process: Restore $: syntax without spaces and restore URLs
      let finalFormatted = formatted.replace(new RegExp(STRUDEL_LABEL_PLACEHOLDER + ':', 'g'), '$:');
      finalFormatted = finalFormatted.replace(new RegExp(URL_PROTOCOL_PLACEHOLDER + 'HTTPS', 'g'), 'https://');
      finalFormatted = finalFormatted.replace(new RegExp(URL_PROTOCOL_PLACEHOLDER + 'HTTP', 'g'), 'http://');
      
      // Cache the result
      this.cache.set(cacheKey, finalFormatted);
      
      // Limit cache size
      if (this.cache.size > 100) {
        const firstKey = this.cache.keys().next().value;
        this.cache.delete(firstKey);
      }

      return finalFormatted;
    } catch (error) {
      console.error('[FormatService] Formatting error:', error);
      
      // Handle different types of errors
      if (error.message.includes('Formatting timeout')) {
        throw new FormatError('timeout', 'Formatting operation timed out');
      } else if (error.loc) {
        // Syntax error with location
        throw new FormatError('syntax', error.message, error.loc.line, error.loc.column);
      } else {
        throw new FormatError('unknown', error.message);
      }
    }
  }

  /**
   * Clear the formatting cache
   */
  clearCache() {
    this.cache.clear();
  }

  /**
   * Check if code is likely to be valid JavaScript/Strudel code
   * @param {string} code - The code to validate
   * @returns {boolean} - Whether the code appears valid
   */
  isValidCode(code) {
    // Basic validation - check for balanced brackets
    const brackets = { '(': ')', '[': ']', '{': '}' };
    const stack = [];
    
    for (const char of code) {
      if (brackets[char]) {
        stack.push(brackets[char]);
      } else if (Object.values(brackets).includes(char)) {
        if (stack.pop() !== char) {
          return false;
        }
      }
    }
    
    return stack.length === 0;
  }
}

/**
 * Custom error class for formatting errors
 */
export class FormatError extends Error {
  constructor(type, message, line = null, column = null) {
    super(message);
    this.name = 'FormatError';
    this.type = type; // 'syntax', 'config', 'timeout', 'unknown'
    this.line = line;
    this.column = column;
  }
}

/**
 * Global format service instance
 */
export const formatService = new FormatService();

/**
 * Initialize the format service when the module is loaded
 */
if (typeof window !== 'undefined') {
  formatService.initialize().catch(error => {
    console.warn('[FormatService] Failed to initialize:', error);
  });
}