/**
 * Web Worker for Prettier formatting operations
 * Handles large file formatting to avoid blocking the main thread
 */

// Import Prettier and plugins
import * as prettier from 'prettier';
import * as parserBabel from 'prettier/plugins/babel';
import { formatStrudelCode, formatStrudelSelection, isStrudelCode } from './strudelFormat.mjs';
import * as parserTypeScript from 'prettier/plugins/typescript';
import * as parserEstree from 'prettier/plugins/estree';

// Configuration cache
const configCache = new Map();

/**
 * Gets or creates a cached Prettier configuration
 */
function getPrettierConfig(options) {
  const configKey = JSON.stringify(options);

  if (configCache.has(configKey)) {
    return configCache.get(configKey);
  }

  const config = {
    parser: 'babel',
    plugins: [parserBabel, parserTypeScript, parserEstree],
    tabWidth: options.tabWidth,
    useTabs: options.useTabs,
    semi: options.semi,
    singleQuote: options.singleQuote,
    quoteProps: options.quoteProps,
    trailingComma: options.trailingComma,
    bracketSpacing: options.bracketSpacing,
    arrowParens: options.arrowParens,
    printWidth: options.printWidth,
  };

  // Cache the configuration
  configCache.set(configKey, config);

  return config;
}

/**
 * Validates JavaScript/TypeScript syntax
 */
export async function validateSyntax(code) {
  try {
    // Try to parse with Babel parser (supports both JS and TS)
    await prettier.format(code, {
      parser: 'babel',
      plugins: [parserBabel, parserEstree],
    });
    return true;
  } catch {
    // Try TypeScript parser as fallback
    try {
      await prettier.format(code, {
        parser: 'typescript',
        plugins: [parserTypeScript, parserEstree],
      });
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Formats code using Prettier
 */
export async function formatCode(code, options) {
  try {
    // Check if this is Strudel code
    if (isStrudelCode(code)) {
      return { success: true, ...formatStrudelCode(code, options) };
    }

    // Validate syntax first
    if (!(await validateSyntax(code))) {
      return {
        success: false,
        error: 'Invalid JavaScript/TypeScript syntax',
      };
    }

    // Get cached or create prettier config
    const prettierConfig = getPrettierConfig(options);

    // Format the code
    const formattedCode = await prettier.format(code, prettierConfig);

    return {
      success: true,
      formattedCode: formattedCode,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Formats a selection of code
 */
export async function formatSelection(code, start, end, options) {
  try {
    // Extract the selected text
    const selectedText = code.substring(start, end);

    // Check if the full code or selection contains Strudel syntax
    if (isStrudelCode(code) || isStrudelCode(selectedText)) {
      return { success: true, ...formatStrudelSelection(code, start, end, options) };
    }

    // Format only the selection
    const formatResult = await formatCode(selectedText, options);

    if (!formatResult.success || !formatResult.formattedCode) {
      return formatResult;
    }

    // Reconstruct the full code with formatted selection
    const beforeSelection = code.substring(0, start);
    const afterSelection = code.substring(end);
    const fullFormattedCode = beforeSelection + formatResult.formattedCode + afterSelection;

    return {
      success: true,
      formattedCode: fullFormattedCode,
      cursorOffset: start + formatResult.formattedCode.length,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

// Handle messages from main thread
self.onmessage = async function (e) {
  const { id, type, data } = e.data;

  try {
    let result;

    switch (type) {
      case 'format':
        result = await formatCode(data.code, data.options);
        break;

      case 'formatSelection':
        result = await formatSelection(data.code, data.start, data.end, data.options);
        break;

      case 'validate':
        result = {
          success: true,
          isValid: await validateSyntax(data.code),
        };
        break;

      case 'clearCache':
        configCache.clear();
        result = {
          success: true,
          message: 'Cache cleared',
        };
        break;

      default:
        result = {
          success: false,
          error: `Unknown operation: ${type}`,
        };
    }

    // Send result back to main thread
    self.postMessage({
      id,
      success: true,
      result,
    });
  } catch (error) {
    // Send error back to main thread
    self.postMessage({
      id,
      success: false,
      error: error.message,
    });
  }
};
