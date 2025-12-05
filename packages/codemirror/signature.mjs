import { StateField, StateEffect } from '@codemirror/state';
import { showTooltip } from '@codemirror/view';
import jsdoc from '../../doc.json';

const getDocLabel = (doc) => doc.name || doc.longname;

// Find the function call context at cursor position
function getFunctionContext(state, pos) {
  const line = state.doc.lineAt(pos);
  const textBefore = line.text.slice(0, pos - line.from);
  
  // Find the last opening parenthesis
  let parenDepth = 0;
  let funcStart = -1;
  let commaCount = 0;
  
  for (let i = textBefore.length - 1; i >= 0; i--) {
    const char = textBefore[i];
    
    if (char === ')') {
      parenDepth++;
    } else if (char === '(') {
      if (parenDepth === 0) {
        funcStart = i;
        break;
      }
      parenDepth--;
    } else if (char === ',' && parenDepth === 0) {
      commaCount++;
    }
  }
  
  if (funcStart === -1) return null;
  
  // Extract function name before the parenthesis
  let nameEnd = funcStart;
  let nameStart = funcStart;
  
  // Go back to find the start of the function name
  while (nameStart > 0 && /[\w.]/.test(textBefore[nameStart - 1])) {
    nameStart--;
  }
  
  const fullName = textBefore.slice(nameStart, nameEnd);
  
  // Handle method calls like "pattern.gain" - get just "gain"
  const funcName = fullName.includes('.') 
    ? fullName.split('.').pop() 
    : fullName;
  
  if (!funcName || funcName.length < 2) return null;
  
  return {
    funcName,
    paramIndex: commaCount,
    pos: line.from + funcStart,
  };
}

// Create tooltip content for function signature
function createSignatureTooltip(funcName, paramIndex) {
  // Find function in documentation
  const doc = jsdoc.docs.find(d => getDocLabel(d) === funcName);
  if (!doc || !doc.params || doc.params.length === 0) return null;
  
  const params = doc.params;
  
  // Build signature string
  const paramStrings = params.map((param, idx) => {
    const name = param.name;
    const type = param.type?.names?.join(' | ') || 'any';
    const optional = param.optional ? '?' : '';
    const isActive = idx === paramIndex;
    
    return isActive 
      ? `<strong style="color:#4a9eff">${name}${optional}: ${type}</strong>`
      : `${name}${optional}: ${type}`;
  });
  
  const signature = `${funcName}(${paramStrings.join(', ')})`;
  
  // Add current parameter description if available
  const currentParam = params[paramIndex];
  const description = currentParam?.description 
    ? `<div style="margin-top:8px;font-size:11px;color:#aaa">${currentParam.description}</div>`
    : '';
  
  return `
    <div style="padding:8px 12px;font-family:monospace;font-size:12px;max-width:500px">
      <div>${signature}</div>
      ${description}
    </div>
  `;
}

// State field to track signature help
const signatureHelpState = StateField.define({
  create() {
    return null;
  },
  
  update(value, tr) {
    // Only show signature help when typing
    if (!tr.docChanged && !tr.selection) return value;
    
    const pos = tr.state.selection.main.head;
    const context = getFunctionContext(tr.state, pos);
    
    if (!context) return null;
    
    const content = createSignatureTooltip(context.funcName, context.paramIndex);
    if (!content) return null;
    
    return {
      pos: context.pos,
      content,
    };
  },
  
  provide: f => showTooltip.computeN([f], state => {
    const value = state.field(f);
    if (!value) return [];
    
    return [{
      pos: value.pos,
      above: true,
      strictSide: true,
      arrow: false,
      create: () => {
        const dom = document.createElement('div');
        dom.className = 'cm-signature-help';
        dom.innerHTML = value.content;
        dom.style.cssText = 'background:#2a2a2a;border:1px solid #555;border-radius:4px;box-shadow:0 2px 8px rgba(0,0,0,0.3)';
        return { dom };
      },
    }];
  }),
});

export const signatureHelp = [signatureHelpState];

export const isSignatureHelpEnabled = (on) => (on ? signatureHelp : []);
