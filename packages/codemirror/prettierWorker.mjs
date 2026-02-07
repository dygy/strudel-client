/**
 * Web Worker for Prettier formatting operations
 * Handles large file formatting to avoid blocking the main thread
 */

// Import Prettier and plugins
import * as prettier from 'prettier';
import * as parserBabel from 'prettier/plugins/babel';
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
function validateSyntax(code) {
  try {
    // Try to parse with Babel parser (supports both JS and TS)
    prettier.format(code, {
      parser: 'babel',
      plugins: [parserBabel, parserTypeScript]
    });
    return true;
  } catch (error) {
    // Try TypeScript parser as fallback
    try {
      prettier.format(code, {
        parser: 'typescript',
        plugins: [parserTypeScript]
      });
      return true;
    } catch (tsError) {
      return false;
    }
  }
}

/**
 * Detects if code contains Strudel-specific syntax
 */
function isStrudelCode(code) {
  // Check for common Strudel patterns
  const strudelPatterns = [
    /\$:/,                           // Strudel pattern syntax
    /\.s\(/,                         // .s() method
    /\.sound\(/,                     // .sound() method
    /\.note\(/,                      // .note() method
    /\.scale\(/,                     // .scale() method
    /\.euclidRot\(/,                 // .euclidRot() method
    /\._pianoroll\(/,                // ._pianoroll() method
    /setcps\(/,                      // setcps() function
    /samples\(/,                     // samples() function
    /initHydra\(/,                   // initHydra() function
    /\.gain\(/,                      // .gain() method
    /\.lpf\(/,                       // .lpf() method
    /\.room\(/,                      // .room() method
    /\.slow\(/,                      // .slow() method
    /\.fast\(/,                      // .fast() method
    /\.rev\(/,                       // .rev() method
    /\.sometimes\(/,                 // .sometimes() method
    /\.every\(/,                     // .every() method
    /\.bank\(/,                      // .bank() method
    /\.crush\(/,                     // .crush() method
    /\.distort\(/,                   // .distort() method
    /\.delay\(/,                     // .delay() method
    /\.sustain\(/,                   // .sustain() method
    /\.legato\(/,                    // .legato() method
    /\.clip\(/,                      // .clip() method
    /\.pan\(/,                       // .pan() method
    /\.speed\(/,                     // .speed() method
    /\.decay\(/,                     // .decay() method
    /\.add\(/,                       // .add() method
    /\.color\(/,                     // .color() method (Hydra)
    /\.rotate\(/,                    // .rotate() method (Hydra)
    /\.kaleid\(/,                    // .kaleid() method (Hydra)
    /\.modulate\(/,                  // .modulate() method (Hydra)
    /\.brightness\(/,                // .brightness() method (Hydra)
    /\.blend\(/,                     // .blend() method (Hydra)
    /\.out\(/,                       // .out() method (Hydra)
    /shape\(/,                       // shape() function (Hydra)
    /osc\(/,                         // osc() function (Hydra)
    /src\(/,                         // src() function (Hydra)
    /sine\.range\(/,                 // sine.range() (Strudel)
    /perlin\.range\(/,               // perlin.range() (Strudel)
    /<[^>]*>/,                       // Mini notation patterns like <0 1 2>
    /\[[^\]]*\]/,                    // Array-like patterns [c5 e5 g5]
    /@\d+/,                          // Duration patterns like @3
    /!\d+/,                          // Repeat patterns like !4
    /~+/,                            // Rest patterns
    /gm_\w+/,                        // General MIDI sounds
    /RolandTR\d+/,                   // Roland drum machine sounds
  ];
  
  return strudelPatterns.some(pattern => pattern.test(code));
}

/**
 * Formats Strudel code with basic formatting while preserving DSL syntax
 */
function formatStrudelCode(code, options) {
  // First, protect strings from preprocessing by replacing them with placeholders
  // Use placeholders that won't be affected by preprocessing regexes
  const globalStringParts = [];
  let globalStringIndex = 0;
  
  let protectedCode = code.replace(/(["'`])((?:\\.|(?!\1)[^\\])*?)\1/g, (match) => {
    const placeholder = `__STRUDEL_STRING_${globalStringIndex}_PLACEHOLDER__`;
    globalStringParts[globalStringIndex] = match;
    globalStringIndex++;
    return placeholder;
  });

  // Now apply line break preprocessing to the protected code
  let preprocessedCode = protectedCode
    // Add line breaks after function calls that end with ) followed by await/let/const/var/function
    .replace(/\)(await|let|const|var|function)\s/g, ')\n$1 ')
    // Add line breaks after semicolons followed by await/let/const/var/function
    .replace(/;(await|let|const|var|function)\s/g, ';\n$1 ')
    // Add line breaks after ) followed by any identifier (more general)
    .replace(/\)([a-zA-Z_$][a-zA-Z0-9_$]*)/g, ')\n$1')
    // Add line breaks after numbers followed by identifiers (like "175let")
    .replace(/([0-9])([a-zA-Z_$][a-zA-Z0-9_$]*)/g, '$1\n$2')
    // Add line breaks before Strudel patterns (identifier:) when they follow ) or numbers
    .replace(/(\)|[0-9])([a-zA-Z_$][a-zA-Z0-9_$]*\s*:)/g, '$1\n$2')
    // Add line breaks after } followed by identifiers
    .replace(/\}([a-zA-Z_$][a-zA-Z0-9_$]*)/g, '}\n$1');

  // Restore global strings after preprocessing
  for (let i = 0; i < globalStringParts.length; i++) {
    const placeholder = `__STRUDEL_STRING_${i}_PLACEHOLDER__`;
    preprocessedCode = preprocessedCode.replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), globalStringParts[i]);
  }

  const lines = preprocessedCode.split('\n');
  const formattedLines = [];
  let indentLevel = 0;
  const indentStr = options.useTabs ? '\t' : ' '.repeat(options.tabWidth);

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    
    if (line === '') {
      formattedLines.push('');
      continue;
    }

    // Handle closing brackets/parentheses - decrease indent before the line
    if (line.match(/^[\}\)\]]/)) {
      indentLevel = Math.max(0, indentLevel - 1);
    }

    // Apply current indentation
    let indentedLine = indentStr.repeat(indentLevel) + line;
    
    // Add proper spacing around operators and after commas
    let spacedLine = indentedLine;
    
    // Split by strings to avoid modifying content inside quotes
    const stringParts = [];
    let tempLine = spacedLine;
    let stringIndex = 0;
    
    // Replace strings with placeholders (improved regex to handle all quote types)
    tempLine = tempLine.replace(/(["'`])((?:\\.|(?!\1)[^\\])*?)\1/g, (match) => {
      const placeholder = `__STRING_${stringIndex}__`;
      stringParts[stringIndex] = match;
      stringIndex++;
      return placeholder;
    });
    
    // Apply formatting to non-string parts only
    tempLine = tempLine
      .replace(/([^=!<>+\-*\/])=([^=>])/g, '$1 = $2')  // Add spaces around = (but not ==, !=, =>, +=, -=, *=, /=)
      .replace(/([0-9])\s*([\+\-\*\/])\s*([0-9])/g, '$1 $2 $3')  // Add spaces around math operators between numbers only
      .replace(/,([^\s])/g, ', $1')              // Add space after commas
      .replace(/\s+/g, ' ')                      // Normalize multiple spaces to single
      .replace(/\s*;\s*/g, ';')                  // Normalize semicolons
      .replace(/\(\s+/g, '(')                    // Remove space after opening parentheses
      .replace(/\s+\)/g, ')')                    // Remove space before closing parentheses
      .replace(/\{\s+/g, '{ ')                   // Normalize space after opening braces
      .replace(/\s+\}/g, ' }');                  // Normalize space before closing braces
    
    // Restore strings (this preserves original content including URLs)
    for (let i = 0; i < stringParts.length; i++) {
      tempLine = tempLine.replace(`__STRING_${i}__`, stringParts[i]);
    }
    
    spacedLine = tempLine;

    // Handle opening brackets/parentheses - increase indent after the line
    if (line.match(/[\{\(\[]$/)) {
      indentLevel++;
    }

    // Handle method chaining - add proper indentation for continued lines
    if (line.startsWith('.') && i > 0) {
      // This is a chained method, add extra indentation
      spacedLine = indentStr.repeat(Math.max(0, indentLevel - 1)) + indentStr + line;
    }

    formattedLines.push(spacedLine);
  }

  let result = formattedLines.join('\n');
  
  // Restore global strings at the very end
  for (let i = 0; i < globalStringParts.length; i++) {
    const placeholder = `__STRUDEL_STRING_${i}_PLACEHOLDER__`;
    result = result.replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), globalStringParts[i]);
  }

  return result;
}

/**
 * Formats code using Prettier
 */
async function formatCode(code, options) {
  try {
    // Check if this is Strudel code
    if (isStrudelCode(code)) {
      console.log('[PrettierWorker] Strudel code detected, applying Strudel-specific formatting');
      const formattedCode = formatStrudelCode(code, options);
      return {
        success: true,
        formattedCode: formattedCode
      };
    }

    // Validate syntax first
    if (!validateSyntax(code)) {
      return {
        success: false,
        error: 'Invalid JavaScript/TypeScript syntax'
      };
    }

    // Get cached or create prettier config
    const prettierConfig = getPrettierConfig(options);

    // Format the code
    const formattedCode = await prettier.format(code, prettierConfig);

    return {
      success: true,
      formattedCode: formattedCode
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Formats a selection of code
 */
async function formatSelection(code, start, end, options) {
  try {
    // Extract the selected text
    const selectedText = code.substring(start, end);
    
    // Check if the full code or selection contains Strudel syntax
    if (isStrudelCode(code) || isStrudelCode(selectedText)) {
      console.log('[PrettierWorker] Strudel code detected in selection, applying Strudel-specific formatting');
      const formattedCode = formatStrudelCode(code, options);
      return {
        success: true,
        formattedCode: formattedCode
      };
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
      cursorOffset: start + formatResult.formattedCode.length
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

// Handle messages from main thread
self.onmessage = async function(e) {
  const { id, type, data } = e.data;
  
  try {
    let result;
    
    switch (type) {
      case 'format':
        result = await formatCode(data.code, data.options);
        break;
        
      case 'formatSelection':
        result = await formatSelection(
          data.code, 
          data.start, 
          data.end, 
          data.options
        );
        break;
        
      case 'validate':
        result = {
          success: true,
          isValid: validateSyntax(data.code)
        };
        break;
        
      case 'clearCache':
        configCache.clear();
        result = {
          success: true,
          message: 'Cache cleared'
        };
        break;
        
      default:
        result = {
          success: false,
          error: `Unknown operation: ${type}`
        };
    }
    
    // Send result back to main thread
    self.postMessage({
      id,
      success: true,
      result
    });
    
  } catch (error) {
    // Send error back to main thread
    self.postMessage({
      id,
      success: false,
      error: error.message
    });
  }
};