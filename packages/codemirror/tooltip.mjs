import { hoverTooltip } from '@codemirror/view';
import jsdoc from '../../doc.json';
import { Autocomplete, getSynonymDoc, hydraFunctionDocs, parseHydraDoc } from './autocomplete.mjs';

const getDocLabel = (doc) => doc.name || doc.longname;

let ctrlDown = false;

if (typeof window !== 'undefined') {
  // Record Control key event to trigger or block the tooltip depending on the state
  window.addEventListener(
    'keyup',
    function (e) {
      if (e.key == 'Control') {
        ctrlDown = false;
      }
    },
    true,
  );

  window.addEventListener(
    'keydown',
    function (e) {
      if (e.key == 'Control') {
        ctrlDown = true;
      }
    },
    true,
  );
}

export const strudelTooltip = hoverTooltip(
  (view, pos, side) => {
    // Show tooltip on hover
    
    let { from, to, text } = view.state.doc.lineAt(pos);
    let start = pos,
      end = pos;
    
    // Expand to include full word (including dots for method calls)
    while (start > from && /[\w.]/.test(text[start - from - 1])) {
      start--;
    }
    while (end < to && /[\w.]/.test(text[end - from])) {
      end++;
    }
    
    if ((start == pos && side < 0) || (end == pos && side > 0)) {
      return null;
    }
    
    let fullText = text.slice(start - from, end - from);
    
    // Check if this is a method call (starts with dot or contains dot)
    const isMethod = fullText.startsWith('.') || (fullText.includes('.') && !fullText.startsWith('_'));
    
    // Handle method calls like "pattern.gain" or ".color" - show docs for the method name
    let word = fullText;
    if (fullText.includes('.')) {
      const parts = fullText.split('.');
      word = parts[parts.length - 1]; // Get the method name after the last dot
    }
    
    // Skip if word is empty or looks like a number
    if (word.length < 1 || /^\d+$/.test(word)) {
      return null;
    }
    

    
    // Check if this is a function call (followed by parenthesis)
    const afterWord = text.slice(end - from, Math.min(to - from, end - from + 5));
    if (/^\s*\(/.test(afterWord)) {
      // This is a function call, show function docs instead of variable info
      // Continue to function documentation lookup below
    } else {
      // Try to find variable declaration in the document
      const fullDoc = view.state.doc.toString();
      // Match variable declaration - for arrays/objects, capture until closing bracket
      let varPattern, varMatch;
      
      // First try to match arrays or objects (multi-line)
      varPattern = new RegExp(`\\b(const|let|var)\\s+${word}\\s*=\\s*(\\[[^\\]]*\\]|\\{[^\\}]*\\})`, 'g');
      varMatch = varPattern.exec(fullDoc);
      
      // If not found, try simple single-line values
      if (!varMatch) {
        varPattern = new RegExp(`\\b(const|let|var)\\s+${word}\\s*=\\s*([^/\\n;]+)`, 'g');
        varMatch = varPattern.exec(fullDoc);
      }
      
      if (varMatch) {
        // Found a variable declaration
        const declType = varMatch[1]; // const, let, or var
        const declPos = varMatch.index;
        
        // Look for comment on same line (after the value)
        const fullLine = fullDoc.slice(declPos, fullDoc.indexOf('\n', declPos));
        const lineCommentMatch = fullLine.match(/\/\/\s*(.+)$/);
        const comment = lineCommentMatch ? lineCommentMatch[1].trim() : '';
        
        const value = varMatch[2].trim();
        
        // Infer type - improved number detection
        let type = 'unknown';
        if (/^['"`]/.test(value)) type = 'String';
        else if (/^-?\d+(\.\d+)?$/.test(value)) type = 'Number';
        else if (/^(true|false)$/.test(value)) type = 'Boolean';
        else if (/^\[/.test(value)) type = 'Array';
        else if (/^\{/.test(value)) type = 'Object';
        else if (/^\(/.test(value) || /=>/.test(value)) type = 'Function';
        
        return {
          pos: start,
          end,
          above: true,
          arrow: true,
          create() {
            let dom = document.createElement('div');
            dom.className = 'strudel-tooltip variable-tooltip';
            dom.innerHTML = `
              <div class="autocomplete-info-container">
                <h3 class="autocomplete-info-function-name">${word}</h3>
                <div style="margin-bottom: 8px;">
                  <span class="autocomplete-info-param-type" style="background: rgba(79, 195, 247, 0.2); color: #4fc3f7;">${declType}</span>
                  <span class="autocomplete-info-param-type">${type}</span>
                  <span style="margin-left: 8px; color: #81c784;">= ${value.slice(0, 50)}${value.length > 50 ? '...' : ''}</span>
                </div>
                ${comment ? `<div class="autocomplete-info-function-description">${comment}</div>` : ''}
              </div>
            `;
            return { dom };
          },
        };
      }
    }
    
    // Check if it's a Hydra function
    // Show Hydra docs if: 1) it's a standalone call, OR 2) it's a method but Strudel docs don't exist
    if (hydraFunctionDocs[word]) {
      // First check if Strudel has docs for this
      const hasStrudelDocs = jsdoc.docs.some((doc) => getDocLabel(doc) === word || doc.synonyms?.includes(word));
      
      // Show Hydra tooltip if: standalone call OR (method call but no Strudel docs)
      if (!isMethod || !hasStrudelDocs) {
        // Parse Hydra documentation into structured format
        const hydraDoc = parseHydraDoc(word, hydraFunctionDocs[word]);
        
        // Build params list HTML
        const paramsHTML = hydraDoc.params.length > 0 ? `
          <div class="autocomplete-info-params-section">
            <h4 class="autocomplete-info-section-title">Parameters</h4>
            <ul class="autocomplete-info-params-list">
              ${hydraDoc.params.map(param => `
                <li class="autocomplete-info-param-item">
                  <span class="autocomplete-info-param-name">${param.name}</span>
                  <span class="autocomplete-info-param-type">${param.type}</span>
                  ${param.default ? `<span class="autocomplete-info-param-type" style="background: rgba(129, 199, 132, 0.2); color: #81c784;">default: ${param.default}</span>` : ''}
                  ${param.description ? `<div class="autocomplete-info-param-desc">${param.description}</div>` : ''}
                </li>
              `).join('')}
            </ul>
          </div>
        ` : '';
        
        // Build examples HTML
        const examplesHTML = hydraDoc.examples.length > 0 ? `
          <div class="autocomplete-info-examples-section">
            <h4 class="autocomplete-info-section-title">Examples</h4>
            ${hydraDoc.examples.map(example => `
              <pre class="autocomplete-info-example-code">${example}</pre>
            `).join('')}
          </div>
        ` : '';
        
        return {
          pos: start,
          end,
          above: true,
          arrow: true,
          create() {
            let dom = document.createElement('div');
            dom.className = 'strudel-tooltip hydra-tooltip';
            dom.innerHTML = `
              <div class="autocomplete-info-container">
                <h3 class="autocomplete-info-function-name">${word}</h3>
                <div style="margin-bottom: 12px;">
                  <span class="autocomplete-info-param-type" style="background: rgba(255, 107, 107, 0.2); color: #ff6b6b; border: 1px solid rgba(255, 107, 107, 0.3);">Hydra</span>
                </div>
                <div class="autocomplete-info-function-description">${hydraDoc.description}</div>
                ${paramsHTML}
                ${examplesHTML}
              </div>
            `;
            return { dom };
          },
        };
      }
    }
    
    // Get entry from Strudel documentation
    // Handle underscore prefix (e.g., _pianoroll -> pianoroll)
    const cleanWord = word.startsWith('_') ? word.slice(1) : word;
    
    let entry = jsdoc.docs.filter((doc) => getDocLabel(doc) === cleanWord)[0];
    if (!entry) {
      // Try for synonyms
      const doc = jsdoc.docs.filter((doc) => doc.synonyms && doc.synonyms.includes(cleanWord))[0];
      if (!doc) {
        return null;
      }
      entry = getSynonymDoc(doc, cleanWord);
    }

    return {
      pos: start,
      end,
      above: true, // Show above by default for better visibility
      arrow: true,
      create(view) {
        let dom = document.createElement('div');
        dom.className = 'strudel-tooltip';
        const ac = Autocomplete(entry);
        dom.appendChild(ac);
        return { dom };
      },
    };
  },
  { hoverTime: 500 }, // 500ms delay to avoid annoying popups
);

export const isTooltipEnabled = (on) => (on ? strudelTooltip : []);
