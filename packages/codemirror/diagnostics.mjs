import { linter } from '@codemirror/lint';
import { parse } from 'acorn';

// Check for JavaScript syntax errors
function checkJavaScriptSyntax(doc) {
  const diagnostics = [];
  const code = doc.toString();
  
  try {
    parse(code, {
      ecmaVersion: 2022,
      allowAwaitOutsideFunction: true,
      locations: true,
    });
  } catch (error) {
    // Parse error found
    if (error.pos !== undefined) {
      diagnostics.push({
        from: error.pos,
        to: error.pos + 1,
        severity: 'error',
        message: error.message.replace(/\s*\(\d+:\d+\)$/, ''),
      });
    }
  }
  
  return diagnostics;
}

// Check for common Strudel-specific issues
function checkStrudelPatterns(doc) {
  const diagnostics = [];
  const code = doc.toString();
  
  // Check for unmatched brackets in mini-notation strings
  const stringRegex = /["']([^"']*?)["']/g;
  let match;
  
  while ((match = stringRegex.exec(code)) !== null) {
    const content = match[1];
    const start = match.index + 1; // After opening quote
    
    // Check bracket balance
    let bracketStack = [];
    for (let i = 0; i < content.length; i++) {
      const char = content[i];
      if (char === '[' || char === '<' || char === '{') {
        bracketStack.push({ char, pos: start + i });
      } else if (char === ']' || char === '>' || char === '}') {
        const expected = char === ']' ? '[' : char === '>' ? '<' : '{';
        const last = bracketStack[bracketStack.length - 1];
        
        if (!last || last.char !== expected) {
          diagnostics.push({
            from: start + i,
            to: start + i + 1,
            severity: 'error',
            message: `Unmatched closing bracket '${char}'`,
          });
        } else {
          bracketStack.pop();
        }
      }
    }
    
    // Report unclosed brackets
    for (const unclosed of bracketStack) {
      diagnostics.push({
        from: unclosed.pos,
        to: unclosed.pos + 1,
        severity: 'error',
        message: `Unclosed bracket '${unclosed.char}'`,
      });
    }
  }
  
  return diagnostics;
}

// Check for potential issues (warnings)
function checkWarnings(doc) {
  const diagnostics = [];
  const code = doc.toString();
  
  // Warn about very long lines (potential performance issue)
  const lines = code.split('\n');
  let pos = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length > 200) {
      diagnostics.push({
        from: pos,
        to: pos + line.length,
        severity: 'warning',
        message: 'Very long line may impact performance',
      });
    }
    pos += line.length + 1; // +1 for newline
  }
  
  // Warn about deprecated functions (example)
  const deprecatedFunctions = ['samples', 'setcps'];
  for (const func of deprecatedFunctions) {
    const regex = new RegExp(`\\b${func}\\b`, 'g');
    let match;
    while ((match = regex.exec(code)) !== null) {
      diagnostics.push({
        from: match.index,
        to: match.index + func.length,
        severity: 'warning',
        message: `'${func}' is deprecated, consider using alternatives`,
      });
    }
  }
  
  return diagnostics;
}

// Main linter function
const strudelLinter = linter((view) => {
  const diagnostics = [];
  
  // Check JavaScript syntax
  diagnostics.push(...checkJavaScriptSyntax(view.state.doc));
  
  // Check Strudel-specific patterns
  diagnostics.push(...checkStrudelPatterns(view.state.doc));
  
  // Check for warnings
  diagnostics.push(...checkWarnings(view.state.doc));
  
  return diagnostics;
}, {
  delay: 500, // Debounce for 500ms
});

export const isLinterEnabled = (on) => (on ? strudelLinter : []);
