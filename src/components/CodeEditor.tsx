/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, no-useless-escape */
import React, { useRef, useEffect, useState } from 'react';
import Editor from '@monaco-editor/react';
import { useTheme } from '../contexts/ThemeContext';

interface NoteEvent {
  note: string;
  velocity: number;
  time: number;
  color: string;
  line?: string; // The actual line of code that triggered this note
  lineNumber?: number; // The line number in the editor
  patternPosition?: number; // Position within the pattern (0-based index)
  patternLength?: number; // Total length of the pattern
}

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  onExecute?: (code: string) => void;
  language?: 'javascript' | 'strudel';
  placeholder?: string;
  height?: string;
  readOnly?: boolean;
}

export const CodeEditor: React.FC<CodeEditorProps> = ({
  value,
  onChange,
  onExecute,
  language = 'javascript',
  placeholder = '// Start coding your patterns here...',
  height = '100%',
  readOnly = false,
}) => {
  const { theme } = useTheme();
  const [isThemeReady, setIsThemeReady] = useState(false);
  const editorRef = useRef<any>(null);
  const [activeNotes, setActiveNotes] = useState<NoteEvent[]>([]);
  const [decorations, setDecorations] = useState<string[]>([]);
  const [executionContext, setExecutionContext] = useState<any>(null);

  // Listen for note events from Strudel and update execution context
  useEffect(() => {
    const handleNoteEvent = (event: CustomEvent<NoteEvent>) => {
      const noteData = event.detail;
      setActiveNotes(prev => {
        const newNotes = [...prev, noteData];
        // Keep only recent notes (last 2 seconds)
        const cutoff = Date.now() - 2000;
        return newNotes.filter(note => note.time > cutoff);
      });

      // Remove note after a short time
      setTimeout(() => {
        setActiveNotes(prev => prev.filter(note => note.time !== noteData.time));
      }, 500);
    };

    window.addEventListener('strudel-note', handleNoteEvent as EventListener);
    return () => {
      window.removeEventListener('strudel-note', handleNoteEvent as EventListener);
    };
  }, []);

  // Update execution context when code changes
  useEffect(() => {
    if (value) {
      const context = parseExecutionContext(value);
      setExecutionContext(context);
    }
  }, [value]);

  // Ensure theme is ready before rendering
  useEffect(() => {
    // Small delay to ensure persisted theme is loaded
    const timer = setTimeout(() => {
      setIsThemeReady(true);
    }, 50);
    
    return () => clearTimeout(timer);
  }, []);

  // Update editor decorations for active notes with intelligent context awareness
  useEffect(() => {
    if (!editorRef.current) return;

    const editor = editorRef.current;
    const model = editor.getModel();
    if (!model) return;

    if (activeNotes.length === 0) {
      if (decorations.length > 0) {
        const newDecorations = editor.deltaDecorations(decorations, []);
        setDecorations(newDecorations);
      }
      return;
    }

    const content = model.getValue();
    const lines = content.split('\n');
    const newDecorations: any[] = [];

    // Parse the code to understand execution context
    const executionContext = parseExecutionContext(content);

    activeNotes.forEach(note => {
      // Find lines containing the note/sound with context-aware matching
      lines.forEach((line: string, index: number) => {
        const lineNumber = index + 1;
        
        // Skip if line is commented out or not in executable context
        if (!isLineExecutable(line, lineNumber, executionContext)) {
          return;
        }
        
        // Extract the executable part of the line (before any inline comments)
        const executablePart = line.split('//')[0];
        
        // Enhanced pattern matching for various Strudel syntax
        const patterns = [
          // Standard sound/note patterns: sound("bd hh") or note("c3 e3")
          new RegExp(`(sound|note|s|n)\\s*\\(\\s*["']([^"']*\\b${note.note}\\b[^"']*)["']`, 'i'),
          // Bank patterns: .bank("RolandTR909")
          new RegExp(`\\.bank\\s*\\(\\s*["']([^"']*\\b${note.note}\\b[^"']*)["']`, 'i'),
          // Direct note references in patterns (only if in a pattern context)
          new RegExp(`\\b${note.note}\\b(?=.*\\.(gain|speed|pan|delay|every|sometimes))`, 'i'),
          // Sample names in await samples()
          new RegExp(`samples\\s*\\(\\s*{[^}]*${note.note}[^}]*}`, 'i'),
          // Variable assignments with the note (only if the variable is used)
          new RegExp(`\\w+\\s*:\\s*.*\\b${note.note}\\b`, 'i')
        ];
        
        const matchingPattern = patterns.find(pattern => pattern.test(executablePart));
        
        if (matchingPattern) {
          // If we have position information, highlight only the specific occurrence
          if (note.patternPosition !== undefined) {
            const specificMatch = findNoteAtPosition(line, note.note, note.patternPosition);
            if (specificMatch) {
              const startColumn = specificMatch.index + 1;
              const endColumn = specificMatch.index + note.note.length + 1;
              
              newDecorations.push({
                range: {
                  startLineNumber: lineNumber,
                  startColumn: startColumn,
                  endLineNumber: lineNumber,
                  endColumn: endColumn,
                },
                options: {
                  className: 'active-note-highlight',
                  inlineClassName: 'active-note-inline',
                },
              });
            }
          } else {
            // Fallback: highlight all occurrences if no position info
            const noteRegex = new RegExp(`\\b${note.note}\\b`, 'gi');
            let match;
            
            while ((match = noteRegex.exec(line)) !== null) {
              const startColumn = match.index + 1;
              const endColumn = match.index + note.note.length + 1;
              
              newDecorations.push({
                range: {
                  startLineNumber: lineNumber,
                  startColumn: startColumn,
                  endLineNumber: lineNumber,
                  endColumn: endColumn,
                },
                options: {
                  className: 'active-note-highlight',
                  inlineClassName: 'active-note-inline',
                },
              });
            }
          }

          // Add a line decoration for the whole line
          newDecorations.push({
            range: {
              startLineNumber: lineNumber,
              startColumn: 1,
              endLineNumber: lineNumber,
              endColumn: 1,
            },
            options: {
              isWholeLine: false,
              glyphMarginClassName: 'active-note-glyph',
              marginClassName: 'active-note-margin',
            },
          });
        }
      });
    });

    const decorationIds = editor.deltaDecorations(decorations, newDecorations);
    setDecorations(decorationIds);
  }, [activeNotes]); // Remove decorations from dependencies to prevent infinite loop

  // Helper function to parse code execution context
  const parseExecutionContext = (code: string) => {
    const lines = code.split('\n');
    const context = {
      commentedLines: new Set<number>(),
      blockCommentRanges: [] as Array<{start: number, end: number}>,
      activePatterns: new Set<string>(),
      inactivePatterns: new Set<string>()
    };

    let inBlockComment = false;
    let blockCommentStart = 0;

    lines.forEach((line, index) => {
      const lineNumber = index + 1;
      const trimmedLine = line.trim();

      // Handle block comments
      if (trimmedLine.includes('/*')) {
        inBlockComment = true;
        blockCommentStart = lineNumber;
      }
      if (trimmedLine.includes('*/')) {
        if (inBlockComment) {
          context.blockCommentRanges.push({
            start: blockCommentStart,
            end: lineNumber
          });
        }
        inBlockComment = false;
      }

      // Handle single line comments - only if the ENTIRE line starts with //
      if (trimmedLine.startsWith('//') || inBlockComment) {
        context.commentedLines.add(lineNumber);
      }

      // Detect pattern definitions and their state
      const patternMatch = line.match(/(\w+)\s*=\s*.*(?:sound|note|s|n)\s*\(/);
      if (patternMatch && !context.commentedLines.has(lineNumber)) {
        const patternName = patternMatch[1];
        context.activePatterns.add(patternName);
      }

      // Detect hush() calls that stop patterns
      if (line.includes('hush()') && !context.commentedLines.has(lineNumber)) {
        context.activePatterns.clear();
      }

      // Detect specific pattern stops
      const stopMatch = line.match(/(\w+)\.stop\(\)/);
      if (stopMatch && !context.commentedLines.has(lineNumber)) {
        const patternName = stopMatch[1];
        context.activePatterns.delete(patternName);
        context.inactivePatterns.add(patternName);
      }
    });

    return context;
  };

  // Helper function to check if a line is executable
  const isLineExecutable = (line: string, lineNumber: number, context: any) => {
    // Skip lines in block comment ranges
    for (const range of context.blockCommentRanges) {
      if (lineNumber >= range.start && lineNumber <= range.end) {
        return false;
      }
    }

    // Skip empty lines or lines with only whitespace
    if (!line.trim()) {
      return false;
    }

    // Check if the line starts with // (entire line is commented)
    if (line.trim().startsWith('//')) {
      return false;
    }

    // For lines with inline comments, extract the executable part
    const executablePart = line.split('//')[0].trim();
    if (!executablePart) {
      return false; // Nothing executable before the comment
    }

    // Check if line contains pattern references that are inactive
    const patternRefs = executablePart.match(/\b(\w+)\./g);
    if (patternRefs) {
      for (const ref of patternRefs) {
        const patternName = ref.slice(0, -1); // Remove the dot
        if (context.inactivePatterns.has(patternName)) {
          return false;
        }
      }
    }

    return true;
  };

  // Helper function to find a note at a specific position within a pattern
  const findNoteAtPosition = (line: string, noteName: string, position: number) => {
    // Extract the executable part of the line (before any inline comments)
    const executablePart = line.split('//')[0];
    
    // Extract the pattern string from common Strudel syntax
    const patternMatch = executablePart.match(/(sound|note|s|n)\s*\(\s*["']([^"']+)["']/);
    if (!patternMatch) return null;
    
    const patternString = patternMatch[2];
    const notes = patternString.split(/\s+/).filter(n => n && n !== '~');
    
    // Clean up note names for comparison (remove modifiers)
    const cleanNotes = notes.map(note => note.replace(/[:\*\[\]<>@!]/g, '').split(/[0-9]/)[0]);
    
    // Check if the position is valid and matches our note
    if (position >= 0 && position < cleanNotes.length && cleanNotes[position] === noteName) {
      // Find the actual position of this specific occurrence in the line
      const beforePattern = line.substring(0, line.indexOf(patternString));
      const patternStart = beforePattern.length;
      
      // Calculate position within the pattern string more accurately
      let searchStart = 0;
      for (let i = 0; i < position; i++) {
        const noteToFind = notes[i];
        const noteIndex = patternString.indexOf(noteToFind, searchStart);
        if (noteIndex !== -1) {
          searchStart = noteIndex + noteToFind.length;
        }
      }
      
      // Find the exact note at the target position
      const targetNote = notes[position];
      const noteIndex = patternString.indexOf(targetNote, searchStart);
      if (noteIndex !== -1) {
        return {
          index: patternStart + noteIndex,
          length: targetNote.length
        };
      }
    }
    
    return null;
  };

  // Listen for theme changes and update editor theme
  useEffect(() => {
    const handleThemeChange = () => {
      if (editorRef.current) {
        const newTheme = theme === 'dark' 
          ? (language === 'strudel' ? 'strudel-dark' : 'vs-dark')
          : (language === 'strudel' ? 'strudel-light' : 'vs');
        
        // Use monaco.editor.setTheme instead of updateOptions
        const monaco = (window as any).monaco;
        if (monaco) {
          monaco.editor.setTheme(newTheme);
          console.log('🎨 Theme changed to:', newTheme, 'for theme:', theme);
        }
      }
    };

    // Listen for custom theme change events
    window.addEventListener('theme-changed', handleThemeChange);
    
    // Also update immediately when theme changes
    handleThemeChange();

    return () => {
      window.removeEventListener('theme-changed', handleThemeChange);
    };
  }, [theme, language]);

  // Force theme application after mount to handle persistence loading
  useEffect(() => {
    if (editorRef.current) {
      const correctTheme = theme === 'dark' 
        ? (language === 'strudel' ? 'strudel-dark' : 'vs-dark') 
        : (language === 'strudel' ? 'strudel-light' : 'vs');
      
      // Small delay to ensure theme is properly applied
      const timer = setTimeout(() => {
        const monaco = (window as any).monaco;
        if (monaco) {
          monaco.editor.setTheme(correctTheme);
          console.log('🎨 Force applied theme:', correctTheme, 'for theme:', theme);
        }
      }, 100);

      return () => clearTimeout(timer);
    }
  }, [theme, language]);

  const handleEditorWillMount = (monaco: any) => {
    // Configure Strudel-specific syntax highlighting and themes BEFORE editor creation
    if (language === 'strudel') {
      monaco.languages.register({ id: 'strudel' });
      
      monaco.languages.setMonarchTokensProvider('strudel', {
        // Define regex patterns
        regexpctl: /[(){}\[\]\$\^|\-*+?\.]/,
        regexpesc: /\\(?:[bBdDfnrtv\\\/]|@regexpctl|c[A-Z]|x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4})/,
        escapes: /\\(?:[abfnrtv\\"']|x[0-9A-Fa-f]{1,4}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8})/,
        
        tokenizer: {
          root: [
            // JavaScript keywords
            [/\b(let|const|var|function|return|if|else|for|while|do|break|continue|switch|case|default|try|catch|finally|throw|new|this|typeof|instanceof|in|of|class|extends|super|static|async|await|import|export|from|as|default)\b/, 'keyword'],
            
            // JavaScript built-ins
            [/\b(console|Math|Date|Array|Object|String|Number|Boolean|RegExp|JSON|Promise|setTimeout|setInterval|clearTimeout|clearInterval)\b/, 'keyword.builtin'],
            
            // Strudel functions
            [/\b(sound|note|s|n|gain|pan|delay|reverb|lpf|hpf|speed|slow|fast|every|sometimes|often|rarely|never|stack|layer|seq|cat|fastcat|slowcat|rev|palindrome|iter|ply|stut|echo|room|size|orbit|cut|cutoff|resonance|attack|decay|sustain|release|setcps|hush|samples|osc|noise|solid|gradient|shape|voronoi|out|render)\b/, 'keyword.strudel'],
            
            // JavaScript literals
            [/\b(true|false|null|undefined|NaN|Infinity)\b/, 'constant.language'],
            
            // Numbers
            [/\d*\.\d+([eE][\-+]?\d+)?/, 'number.float'],
            [/0[xX][\da-fA-F]+/, 'number.hex'],
            [/\d+/, 'number'],
            
            // Strings
            [/"([^"\\]|\\.)*$/, 'string.invalid'],
            [/"/, 'string', '@string_double'],
            [/'([^'\\]|\\.)*$/, 'string.invalid'],
            [/'/, 'string', '@string_single'],
            [/`/, 'string', '@string_backtick'],
            
            // Regular expressions
            [/\/(?=([^\/\\]|\\.)+\/)/, 'regexp', '@regexp'],
            
            // Comments
            [/\/\/.*$/, 'comment'],
            [/\/\*/, 'comment', '@comment'],
            
            // Identifiers
            [/[a-zA-Z_$][\w$]*/, 'identifier'],
            
            // Brackets
            [/[{}()\[\]]/, '@brackets'],
            
            // Operators
            [/[<>=!]+/, 'operator'],
            [/[+\-*\/%&|^~<>!]/, 'operator'],
            [/[;,.]/, 'delimiter'],
          ],
          
          string_double: [
            [/[^\\"]+/, 'string'],
            [/\\./, 'string.escape'],
            [/"/, 'string', '@pop']
          ],
          
          string_single: [
            [/[^\\']+/, 'string'],
            [/\\./, 'string.escape'],
            [/'/, 'string', '@pop']
          ],
          
          string_backtick: [
            [/\$\{/, 'delimiter', '@bracketCounting'],
            [/[^\\`$]+/, 'string'],
            [/@escapes/, 'string.escape'],
            [/\\./, 'string.escape.invalid'],
            [/`/, 'string', '@pop']
          ],
          
          bracketCounting: [
            [/\{/, 'delimiter', '@bracketCounting'],
            [/\}/, 'delimiter', '@pop'],
            { include: 'root' }
          ],
          
          regexp: [
            [/(\{)(\d+(?:,\d*)?)(\})/, ['regexp.escape.control', 'regexp.escape.control', 'regexp.escape.control']],
            [/(\[)(\^?)(?=(?:[^\]\\\/]|\\.)+)/, ['regexp.escape.control', { token: 'regexp.escape.control', next: '@regexrange' }]],
            [/(\()(\?:|\?=|\?!)/, ['regexp.escape.control', 'regexp.escape.control']],
            [/[()]/, 'regexp.escape.control'],
            [/@regexpctl/, 'regexp.escape.control'],
            [/[^\\\/]/, 'regexp'],
            [/@regexpesc/, 'regexp.escape'],
            [/\\\./, 'regexp.invalid'],
            [/\/[gim]*/, 'regexp', '@pop'],
          ],
          
          regexrange: [
            [/-/, 'regexp.escape.control'],
            [/\^/, 'regexp.invalid'],
            [/@regexpesc/, 'regexp.escape'],
            [/[^\]]/, 'regexp'],
            [/\]/, 'regexp.escape.control', '@pop'],
          ],
          
          comment: [
            [/[^\/*]+/, 'comment'],
            [/\*\//, 'comment', '@pop'],
            [/[\/*]/, 'comment']
          ],
        },
      });

      // Set theme colors for Strudel with transparent backgrounds
      monaco.editor.defineTheme('strudel-dark', {
        base: 'vs-dark',
        inherit: true,
        rules: [
          // JavaScript keywords
          { token: 'keyword', foreground: '#569cd6', fontStyle: 'bold' },
          { token: 'keyword.builtin', foreground: '#4ec9b0' },
          { token: 'constant.language', foreground: '#569cd6' },
          
          // Strudel-specific keywords
          { token: 'keyword.strudel', foreground: '#c586c0', fontStyle: 'bold' },
          
          // Other tokens
          { token: 'number', foreground: '#b5cea8' },
          { token: 'number.hex', foreground: '#b5cea8' },
          { token: 'number.float', foreground: '#b5cea8' },
          { token: 'string', foreground: '#ce9178' },
          { token: 'string.escape', foreground: '#d7ba7d' },
          { token: 'regexp', foreground: '#d16969' },
          { token: 'regexp.escape', foreground: '#d7ba7d' },
          { token: 'comment', foreground: '#6a9955', fontStyle: 'italic' },
          { token: 'identifier', foreground: '#9cdcfe' },
          { token: 'operator', foreground: '#d4d4d4' },
          { token: 'delimiter', foreground: '#d4d4d4' },
        ],
        colors: {
          'editor.background': '#0f172a00', // Transparent background
          'editor.foreground': '#f1f5f9',
          'editor.lineHighlightBackground': '#1e293b20',
          'editor.selectionBackground': '#3b82f640',
        }
      });

      monaco.editor.defineTheme('strudel-light', {
        base: 'vs',
        inherit: true,
        rules: [
          // JavaScript keywords
          { token: 'keyword', foreground: '#0000ff', fontStyle: 'bold' },
          { token: 'keyword.builtin', foreground: '#267f99' },
          { token: 'constant.language', foreground: '#0000ff' },
          
          // Strudel-specific keywords
          { token: 'keyword.strudel', foreground: '#af00db', fontStyle: 'bold' },
          
          // Other tokens
          { token: 'number', foreground: '#098658' },
          { token: 'number.hex', foreground: '#098658' },
          { token: 'number.float', foreground: '#098658' },
          { token: 'string', foreground: '#a31515' },
          { token: 'string.escape', foreground: '#ee0000' },
          { token: 'regexp', foreground: '#811f3f' },
          { token: 'regexp.escape', foreground: '#ee0000' },
          { token: 'comment', foreground: '#008000', fontStyle: 'italic' },
          { token: 'identifier', foreground: '#001080' },
          { token: 'operator', foreground: '#000000' },
          { token: 'delimiter', foreground: '#000000' },
        ],
        colors: {
          'editor.background': '#ffffff00', // Transparent background
          'editor.foreground': '#000000',
          'editor.lineHighlightBackground': '#f1f5f920',
          'editor.selectionBackground': '#3b82f640',
        }
      });
    }
    
    console.log('🎨 Themes defined before mount for language:', language, 'theme:', theme);
  };

  const handleEditorDidMount = (editor: any, monaco: any) => {
    editorRef.current = editor;

    // Apply the correct theme immediately on mount
    const correctTheme = theme === 'dark' 
      ? (language === 'strudel' ? 'strudel-dark' : 'vs-dark') 
      : (language === 'strudel' ? 'strudel-light' : 'vs');
    
    monaco.editor.setTheme(correctTheme);
    console.log('🎨 Applied theme on mount:', correctTheme, 'for theme:', theme);

    // Add keyboard shortcuts
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      if (onExecute) {
        onExecute(editor.getValue());
      }
    });

    editor.addCommand(monaco.KeyMod.Shift | monaco.KeyCode.Enter, () => {
      if (onExecute) {
        onExecute(editor.getValue());
      }
    });

    // Auto-completion for Strudel and JavaScript
    if (language === 'strudel') {
      monaco.languages.registerCompletionItemProvider('strudel', {
        provideCompletionItems: (_model: any, _position: any) => {
          const suggestions = [
            // JavaScript keywords
            {
              label: 'let',
              kind: monaco.languages.CompletionItemKind.Keyword,
              insertText: 'let ${1:variable} = ${2:value}',
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              documentation: 'Declare a block-scoped variable'
            },
            {
              label: 'const',
              kind: monaco.languages.CompletionItemKind.Keyword,
              insertText: 'const ${1:variable} = ${2:value}',
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              documentation: 'Declare a constant'
            },
            {
              label: 'function',
              kind: monaco.languages.CompletionItemKind.Keyword,
              insertText: 'function ${1:name}(${2:params}) {\n\t${3:// body}\n}',
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              documentation: 'Declare a function'
            },
            {
              label: 'if',
              kind: monaco.languages.CompletionItemKind.Keyword,
              insertText: 'if (${1:condition}) {\n\t${2:// body}\n}',
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              documentation: 'Conditional statement'
            },
            {
              label: 'for',
              kind: monaco.languages.CompletionItemKind.Keyword,
              insertText: 'for (${1:let i = 0}; ${2:i < length}; ${3:i++}) {\n\t${4:// body}\n}',
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              documentation: 'For loop'
            },
            
            // Strudel functions
            {
              label: 'sound',
              kind: monaco.languages.CompletionItemKind.Function,
              insertText: 'sound("${1:bd}")',
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              documentation: 'Play a sound sample'
            },
            {
              label: 'note',
              kind: monaco.languages.CompletionItemKind.Function,
              insertText: 'note("${1:c4}")',
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              documentation: 'Play a musical note'
            },
            {
              label: 'n',
              kind: monaco.languages.CompletionItemKind.Function,
              insertText: 'n(${1:0})',
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              documentation: 'Select sample number'
            },
            {
              label: 'gain',
              kind: monaco.languages.CompletionItemKind.Function,
              insertText: 'gain(${1:0.7})',
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              documentation: 'Set volume/gain'
            },
            {
              label: 'speed',
              kind: monaco.languages.CompletionItemKind.Function,
              insertText: 'speed(${1:1})',
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              documentation: 'Change playback speed'
            },
            {
              label: 'every',
              kind: monaco.languages.CompletionItemKind.Function,
              insertText: 'every(${1:4}, ${2:x => x.gain(0.5)})',
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              documentation: 'Apply function every N cycles'
            },
            {
              label: 'sometimes',
              kind: monaco.languages.CompletionItemKind.Function,
              insertText: 'sometimes(${1:x => x.gain(0.5)})',
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              documentation: 'Apply function sometimes (50% chance)'
            },
            {
              label: 'stack',
              kind: monaco.languages.CompletionItemKind.Function,
              insertText: 'stack(${1:sound("bd"), sound("hh")})',
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              documentation: 'Layer multiple patterns'
            },
            {
              label: 'setcps',
              kind: monaco.languages.CompletionItemKind.Function,
              insertText: 'setcps(${1:120}/60/4)',
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              documentation: 'Set cycles per second (tempo)'
            },
            {
              label: 'hush',
              kind: monaco.languages.CompletionItemKind.Function,
              insertText: 'hush()',
              documentation: 'Stop all patterns'
            },
            
            // Hydra functions
            {
              label: 'osc',
              kind: monaco.languages.CompletionItemKind.Function,
              insertText: 'osc(${1:10}, ${2:0.1}, ${3:1.2})',
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              documentation: 'Oscillator visual source'
            },
            {
              label: 'noise',
              kind: monaco.languages.CompletionItemKind.Function,
              insertText: 'noise(${1:3})',
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              documentation: 'Noise visual source'
            },
          ];
          return { suggestions };
        }
      });
    }
  };

  const handleChange = (newValue: string | undefined) => {
    if (newValue !== undefined) {
      onChange(newValue);
    }
  };

  // Show loading state while theme is being determined
  if (!isThemeReady) {
    return (
      <div className="h-full border border-gray-200/50 dark:border-dark-700/50 rounded-md overflow-hidden bg-white/80 dark:bg-dark-900/80 backdrop-blur-sm flex items-center justify-center">
        <div className="text-gray-500 dark:text-gray-400">Loading editor...</div>
      </div>
    );
  }

  return (
    <div className="h-full border border-gray-200/50 dark:border-dark-700/50 rounded-md overflow-hidden bg-white/80 dark:bg-dark-900/80 backdrop-blur-sm">
      <Editor
        height={height}
        language={language === 'strudel' ? 'strudel' : 'javascript'}
        value={value || placeholder}
        theme={theme === 'dark' ? (language === 'strudel' ? 'strudel-dark' : 'vs-dark') : (language === 'strudel' ? 'strudel-light' : 'vs')}
        onChange={handleChange}
        beforeMount={handleEditorWillMount}
        onMount={handleEditorDidMount}
        options={{
          minimap: { enabled: false },
          fontSize: 14,
          fontFamily: 'JetBrains Mono, Fira Code, Monaco, Consolas, monospace',
          lineNumbers: 'on',
          roundedSelection: false,
          scrollBeyondLastLine: false,
          automaticLayout: true,
          tabSize: 2,
          insertSpaces: true,
          wordWrap: 'on',
          readOnly,
          contextmenu: true,
          selectOnLineNumbers: true,
          glyphMargin: false,
          folding: true,
          lineDecorationsWidth: 10,
          lineNumbersMinChars: 3,
          renderLineHighlight: 'line',
          scrollbar: {
            vertical: 'auto',
            horizontal: 'auto',
            useShadows: false,
            verticalHasArrows: false,
            horizontalHasArrows: false,
          },
        }}
      />
      
      {/* Status indicators - positioned to avoid code overlap */}
      <div className="absolute top-2 right-2 flex flex-col gap-1 items-end">
        {/* Execution status indicator */}
        {executionContext && executionContext.activePatterns.size > 0 && (
          <div className="text-xs text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 px-2 py-1 rounded border border-green-200 dark:border-green-700/50">
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
              <span>{executionContext.activePatterns.size} pattern{executionContext.activePatterns.size !== 1 ? 's' : ''} active</span>
            </div>
          </div>
        )}

        {/* Active notes indicator */}
        {activeNotes.length > 0 && (
          <div className="text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 px-2 py-1 rounded border border-blue-200 dark:border-blue-700/50">
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
              <span>{activeNotes.length} note{activeNotes.length !== 1 ? 's' : ''} playing</span>
            </div>
          </div>
        )}
      </div>

      {/* Keyboard shortcuts hint */}
      <div className="absolute bottom-2 right-2 text-xs text-gray-500 dark:text-gray-400 bg-white dark:bg-dark-800 px-2 py-1 rounded border border-gray-200 dark:border-dark-700">
        Ctrl+Enter or Shift+Enter to execute
      </div>


    </div>
  );
};