// Test the formatting logic in isolation
const code = `arrange([s("bd sd"), s("hh*4")], [s("bass:0 bass:1"), s("pad:2")])`;
const options = { printWidth: 80, tabWidth: 2, useTabs: false };

// Simulate formatCompositionFunctions
const functionPattern = /(\b(arrange|stack)|\.stack)\s*\(/g;
let result = code;
let match;

functionPattern.lastIndex = 0;

while ((match = functionPattern.exec(code)) !== null) {
  const functionName = match[1];
  const startIndex = match.index;
  const openParenIndex = match.index + match[0].length - 1;
  
  // Find closing paren
  let depth = 1;
  let closeParenIndex = -1;
  
  for (let i = openParenIndex + 1; i < code.length; i++) {
    const char = code[i];
    
    if (char === '"' || char === "'" || char === '`') {
      const quote = char;
      i++;
      while (i < code.length) {
        if (code[i] === '\\') {
          i += 2;
          continue;
        }
        if (code[i] === quote) {
          break;
        }
        i++;
      }
      continue;
    }
    
    if (char === '(') depth++;
    else if (char === ')') {
      depth--;
      if (depth === 0) {
        closeParenIndex = i;
        break;
      }
    }
  }
  
  console.log('closeParenIndex:', closeParenIndex);
  
  const fullCall = code.substring(startIndex, closeParenIndex + 1);
  const argsContent = code.substring(openParenIndex + 1, closeParenIndex);
  
  console.log('Full call:', fullCall);
  console.log('Args content:', argsContent);
  
  // Count arguments
  let argCount = 0;
  let argDepth = 0;
  let hasNonWhitespace = false;
  
  for (let i = 0; i < argsContent.length; i++) {
    const char = argsContent[i];
    
    if (char === '"' || char === "'" || char === '`') {
      const quote = char;
      i++;
      hasNonWhitespace = true;
      while (i < argsContent.length) {
        if (argsContent[i] === '\\') {
          i += 2;
          continue;
        }
        if (argsContent[i] === quote) {
          break;
        }
        i++;
      }
      continue;
    }
    
    if (char === '(' || char === '[' || char === '{') {
      argDepth++;
      hasNonWhitespace = true;
    } else if (char === ')' || char === ']' || char === '}') {
      argDepth--;
      hasNonWhitespace = true;
    } else if (char === ',' && argDepth === 0) {
      argCount++;
    } else if (char.trim() !== '') {
      hasNonWhitespace = true;
    }
  }
  
  if (hasNonWhitespace) {
    argCount++;
  }
  
  console.log('Argument count:', argCount);
  console.log('Full call length:', fullCall.length);
  console.log('Should format multi-line:', argCount > 1 || fullCall.length > options.printWidth);
  
  // Split arguments
  const args = [];
  let currentArg = '';
  argDepth = 0;
  
  for (let i = 0; i < argsContent.length; i++) {
    const char = argsContent[i];
    
    if (char === '"' || char === "'" || char === '`') {
      const quote = char;
      currentArg += char;
      i++;
      while (i < argsContent.length) {
        currentArg += argsContent[i];
        if (argsContent[i] === '\\') {
          i++;
          if (i < argsContent.length) {
            currentArg += argsContent[i];
          }
          i++;
          continue;
        }
        if (argsContent[i] === quote) {
          break;
        }
        i++;
      }
      continue;
    }
    
    if (char === '(' || char === '[' || char === '{') {
      argDepth++;
      currentArg += char;
    } else if (char === ')' || char === ']' || char === '}') {
      argDepth--;
      currentArg += char;
    } else if (char === ',' && argDepth === 0) {
      args.push(currentArg.trim());
      currentArg = '';
    } else {
      currentArg += char;
    }
  }
  
  if (currentArg.trim()) {
    args.push(currentArg.trim());
  }
  
  console.log('Arguments:', args);
  
  // Build formatted version
  const indentStr = '  ';
  const formattedArgs = args.map(arg => `${indentStr}${arg}`).join(',\n');
  const formattedCall = `${functionName}(\n${formattedArgs}\n)`;
  
  console.log('Formatted call:');
  console.log(formattedCall);
}
