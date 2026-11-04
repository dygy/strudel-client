import * as prettier from 'prettier';
import * as parserBabel from 'prettier/plugins/babel';
import * as parserTypeScript from 'prettier/plugins/typescript';
import * as parserEstree from 'prettier/plugins/estree';
import {
  formatStrudelCode,
  formatStrudelSelection,
  isStrudelCode,
} from '../../../packages/codemirror/strudelFormat.mjs';

// Prettier configuration types
export interface PrettierOptions {
  tabWidth: number;
  useTabs: boolean;
  semi: boolean;
  singleQuote: boolean;
  quoteProps: 'as-needed' | 'consistent' | 'preserve';
  trailingComma: 'none' | 'es5' | 'all';
  bracketSpacing: boolean;
  arrowParens: 'avoid' | 'always';
  printWidth: number;
}

// Format result interface
export interface FormatResult {
  success: boolean;
  formattedCode?: string;
  error?: string;
  cursorOffset?: number;
  // The formatter left the code as it was, because the result would not have been safe
  rejected?: boolean;
}

// Format request interface
export interface FormatRequest {
  code: string;
  selection?: {
    start: number;
    end: number;
  };
  options: PrettierOptions;
  preserveCursor: boolean;
}

// Performance thresholds
const LARGE_FILE_THRESHOLD = 5000; // characters
const DEBOUNCE_DELAY = 300; // milliseconds
const WORKER_TIMEOUT = 30000; // milliseconds

// A request the worker hasn't answered yet
interface PendingRequest {
  resolve: (result: FormatResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Core formatting engine that handles Prettier integration
 */
export class FormatEngine {
  private static instance: FormatEngine;
  private configCache: Map<string, any> = new Map();
  private worker: Worker | null = null;
  private workerPromises: Map<string, PendingRequest> = new Map();
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private requestCounter = 0;

  private constructor() {
    this.initializeWorker();
  }

  public static getInstance(): FormatEngine {
    if (!FormatEngine.instance) {
      FormatEngine.instance = new FormatEngine();
    }
    return FormatEngine.instance;
  }

  /**
   * Initializes the web worker for large file processing
   */
  private initializeWorker(): void {
    // Check if Worker is available (not in Node.js/test environment)
    if (typeof Worker !== 'undefined' && typeof window !== 'undefined') {
      try {
        // Create worker from the worker file
        this.worker = new Worker(new URL('../../../packages/codemirror/prettierWorker.mjs', import.meta.url), {
          type: 'module',
        });

        this.worker.onmessage = (e) => {
          const { id, success, result, error } = e.data;
          const promise = this.workerPromises.get(id);

          if (promise) {
            this.workerPromises.delete(id);
            clearTimeout(promise.timer);

            if (success) {
              promise.resolve(result);
            } else {
              promise.reject(new Error(error));
            }
          }
        };

        this.worker.onerror = (error) => {
          console.error('[FormatEngine] Worker error:', error);
          this.dropWorker(new Error('Worker failed'));
        };
      } catch (error) {
        console.warn('[FormatEngine] Failed to initialize worker:', error);
        this.worker = null;
      }
    }
  }

  /**
   * Sends a request to the web worker
   */
  private async sendToWorker(type: string, data: any): Promise<any> {
    if (!this.worker) {
      throw new Error('Worker not available');
    }

    const id = `req_${++this.requestCounter}`;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        // A worker that hangs on one request will on the next: no one should wait for it again
        this.dropWorker(new Error('Worker request timeout'));
      }, WORKER_TIMEOUT);

      this.workerPromises.set(id, { resolve, reject, timer });

      this.worker!.postMessage({
        id,
        type,
        data,
      });
    });
  }

  /**
   * Stops using the worker: what was waiting for it is rejected now, and from here on the main thread does the work
   */
  private dropWorker(reason: Error): void {
    this.worker?.terminate();
    this.worker = null;

    for (const promise of this.workerPromises.values()) {
      clearTimeout(promise.timer);
      promise.reject(reason);
    }
    this.workerPromises.clear();
  }

  /**
   * Debounces formatting requests to avoid excessive processing
   */
  private debounceRequest<T>(key: string, fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      // Clear existing timer
      const existingTimer = this.debounceTimers.get(key);
      if (existingTimer) {
        clearTimeout(existingTimer);
      }

      // For tests, execute immediately to avoid timeouts
      if (process.env.NODE_ENV === 'test' || (typeof global !== 'undefined' && (global as any).vitest)) {
        fn().then(resolve).catch(reject);
        return;
      }

      // Set new timer
      const timer = setTimeout(async () => {
        this.debounceTimers.delete(key);
        try {
          const result = await fn();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      }, DEBOUNCE_DELAY);

      this.debounceTimers.set(key, timer);
    });
  }

  /**
   * Determines if a file should be processed in a web worker
   */
  private shouldUseWorker(code: string): boolean {
    return this.worker !== null && code.length > LARGE_FILE_THRESHOLD;
  }

  /**
   * Formats code using Prettier with the provided options
   * @param code - The code to format
   * @param options - Prettier formatting options
   * @param debounce - Whether to debounce the request
   * @returns Promise<FormatResult>
   */
  public async formatCode(code: string, options: PrettierOptions, debounce: boolean = false): Promise<FormatResult> {
    const formatFn = async (): Promise<FormatResult> => {
      try {
        // Use web worker for large files
        if (this.shouldUseWorker(code)) {
          console.log('[FormatEngine] Using web worker for large file formatting');
          try {
            return await this.sendToWorker('format', { code, options });
          } catch (error: unknown) {
            console.warn('[FormatEngine] Worker failed, formatting on the main thread:', error);
          }
        }

        // Use main thread for smaller files
        return await this.formatCodeMainThread(code, options);
      } catch (error) {
        console.error('[FormatEngine] Formatting error:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown formatting error',
        };
      }
    };

    if (debounce) {
      const debounceKey = `format_${code.length}_${JSON.stringify(options)}`;
      return this.debounceRequest(debounceKey, formatFn);
    } else {
      return formatFn();
    }
  }

  /**
   * Formats code on the main thread
   */
  private async formatCodeMainThread(code: string, options: PrettierOptions): Promise<FormatResult> {
    // Check if this is Strudel code
    if (isStrudelCode(code)) {
      return { success: true, ...formatStrudelCode(code, options) };
    }

    // Validate syntax first
    if (!(await this.validateSyntax(code))) {
      return {
        success: false,
        error: 'Invalid JavaScript/TypeScript syntax',
      };
    }

    // Get cached or create prettier config
    const prettierConfig = this.getPrettierConfig(options);

    // Format the code
    const formattedCode = await prettier.format(code, prettierConfig);

    return {
      success: true,
      formattedCode: formattedCode,
    };
  }

  /**
   * Formats a selection of code
   * @param code - The full code content
   * @param start - Start position of selection
   * @param end - End position of selection
   * @param options - Prettier formatting options
   * @param debounce - Whether to debounce the request
   * @returns Promise<FormatResult>
   */
  public async formatSelection(
    code: string,
    start: number,
    end: number,
    options: PrettierOptions,
    debounce: boolean = false,
  ): Promise<FormatResult> {
    const formatFn = async (): Promise<FormatResult> => {
      try {
        // Use web worker for large files
        if (this.shouldUseWorker(code)) {
          console.log('[FormatEngine] Using web worker for large selection formatting');
          try {
            return await this.sendToWorker('formatSelection', { code, start, end, options });
          } catch (error: unknown) {
            console.warn('[FormatEngine] Worker failed, formatting on the main thread:', error);
          }
        }

        // Use main thread for smaller files
        return await this.formatSelectionMainThread(code, start, end, options);
      } catch (error) {
        console.error('[FormatEngine] Selection formatting error:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown selection formatting error',
        };
      }
    };

    if (debounce) {
      const debounceKey = `selection_${code.length}_${start}_${end}_${JSON.stringify(options)}`;
      return this.debounceRequest(debounceKey, formatFn);
    } else {
      return formatFn();
    }
  }

  /**
   * Formats a selection on the main thread
   */
  private async formatSelectionMainThread(
    code: string,
    start: number,
    end: number,
    options: PrettierOptions,
  ): Promise<FormatResult> {
    // Extract the selected text
    const selectedText = code.substring(start, end);

    // Check if the full code or selection contains Strudel syntax
    if (isStrudelCode(code) || isStrudelCode(selectedText)) {
      return { success: true, ...formatStrudelSelection(code, start, end, options) };
    }

    // Format only the selection
    const formatResult = await this.formatCodeMainThread(selectedText, options);

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
  }

  /**
   * Validates JavaScript/TypeScript syntax
   * @param code - Code to validate
   * @returns Promise of whether the code parses
   */
  public async validateSyntax(code: string): Promise<boolean> {
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
   * Gets or creates a cached Prettier configuration
   * @param options - Prettier options
   * @returns Prettier configuration object
   */
  private getPrettierConfig(options: PrettierOptions): any {
    const configKey = JSON.stringify(options);

    if (this.configCache.has(configKey)) {
      return this.configCache.get(configKey);
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
    this.configCache.set(configKey, config);

    return config;
  }

  /**
   * Clears the configuration cache
   */
  public clearCache(): void {
    this.configCache.clear();

    // Also clear worker cache if available
    if (this.worker) {
      this.sendToWorker('clearCache', {}).catch((error) => {
        console.warn('[FormatEngine] Failed to clear worker cache:', error);
      });
    }
  }

  /**
   * Gets cache size for debugging
   */
  public getCacheSize(): number {
    return this.configCache.size;
  }

  /**
   * Gets performance statistics
   */
  public getPerformanceStats(): {
    cacheSize: number;
    workerAvailable: boolean;
    pendingRequests: number;
    activeDebounceTimers: number;
  } {
    return {
      cacheSize: this.configCache.size,
      workerAvailable: this.worker !== null,
      pendingRequests: this.workerPromises.size,
      activeDebounceTimers: this.debounceTimers.size,
    };
  }

  /**
   * Cleanup method to dispose of resources
   */
  public dispose(): void {
    // Clear all debounce timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    // Reject all pending worker promises and terminate the worker
    this.dropWorker(new Error('FormatEngine disposed'));

    // Clear cache
    this.configCache.clear();
  }
}

// Export singleton instance
export const formatEngine = FormatEngine.getInstance();

// settingsMap is persisted, so booleans come back from a page reload as the strings 'true' and 'false'. Not
// parseBoolean: settings.ts pulls in repl/util.ts and every @strudel package with it.
const isOn = (value: unknown): boolean => value === true || value === 'true';

// Helper function to create prettier options from settings
export function createPrettierOptions(settings: any): PrettierOptions {
  return {
    tabWidth: Number(settings.prettierTabWidth) || 2,
    useTabs: isOn(settings.prettierUseTabs),
    semi: settings.prettierSemi !== undefined ? isOn(settings.prettierSemi) : true,
    singleQuote: isOn(settings.prettierSingleQuote),
    quoteProps: settings.prettierQuoteProps || 'as-needed',
    trailingComma: settings.prettierTrailingComma || 'es5',
    bracketSpacing: settings.prettierBracketSpacing !== undefined ? isOn(settings.prettierBracketSpacing) : true,
    arrowParens: settings.prettierArrowParens || 'always',
    printWidth: Number(settings.prettierPrintWidth) || 80,
  };
}
