/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, @typescript-eslint/ban-ts-comment */
// Real Strudel engine integration
// @ts-ignore - Strudel types may not be fully available
import { initStrudel, evaluate, hush, getAudioContext } from '@strudel/web';
// @ts-ignore - Strudel hydra types may not be fully available  
import { initHydra } from '@strudel/hydra';
import { visualEngine } from './VisualEngine';

// Declare global Hydra functions that might be available
declare global {
  interface Window {
    initHydra?: (config?: any) => void;
    Hydra?: any;
    osc?: (...args: any[]) => any;
    noise?: (...args: any[]) => any;
    solid?: (...args: any[]) => any;
    gradient?: (...args: any[]) => any;
    shape?: (...args: any[]) => any;
    voronoi?: (...args: any[]) => any;
    samples?: (source: string) => void;
    render?: (channel?: any) => void;
    o0?: any;
    o1?: any;
    o2?: any;
    o3?: any;
    time?: number;
  }
}

// Real Strudel engine wrapper
class StrudelEngine {
  private initialized = false;
  private isPlaying = false;

  async initialize() {
    if (this.initialized) return;
    
    try {
      // Make Hydra available immediately before Strudel initialization
      this.setupHydraGlobals();
      
      // Initialize the real Strudel engine with default samples and Hydra
      await initStrudel({
        prebake: async () => {
          // Load comprehensive sample libraries
          try {
            if (window.samples) {
              // Load multiple sample libraries like the official Strudel REPL
              const ds = 'https://raw.githubusercontent.com/felixroos/dough-samples/main/';

              await Promise.all([
                window.samples('github:tidalcycles/dirt-samples'),
                window.samples(`${ds}/tidal-drum-machines.json`),
                window.samples(`${ds}/piano.json`),
                window.samples(`${ds}/Dirt-Samples.json`),
                window.samples(`${ds}/vcsl.json`),
              ]);
              
              console.log('Comprehensive sample libraries loaded');
            }
          } catch (e) {
            console.warn('Could not load sample libraries:', e);
            // Try loading just the basic samples as fallback
            try {
              if (window.samples) {
                window.samples('github:tidalcycles/dirt-samples');
                console.log('Basic samples loaded as fallback');
              }
            } catch (fallbackError) {
              console.warn('Could not load even basic samples:', fallbackError);
            }
          }
          
          // Initialize Hydra with canvas after Strudel is ready
          await this.initializeHydra();
        }
      });
      // Add missing Strudel methods immediately after initialization
      this.addMissingStrudelMethods();
      
      this.initialized = true;
      console.log('Strudel engine initialized successfully');
      
      // Initialize visual engine immediately after main initialization
      await visualEngine.initialize();
    } catch (error) {
      console.error('Failed to initialize Strudel:', error);
      throw error;
    }
  }

  private setupHydraGlobals() {
    // Create a custom initHydra that uses our canvas
    (window as any).initHydra = async (config?: any) => {
      console.log('🎨 Custom initHydra called with config:', config);
      
      // Get our canvas
      const canvas = document.getElementById('hydra-canvas') as HTMLCanvasElement;
      console.log('🎨 Canvas found for initHydra:', !!canvas);
      
      if (canvas) {
        try {
          // Use the real initHydra with our canvas
          const hydraInstance = await initHydra({
            canvas: canvas,
            detectAudio: false,
            pixelated: true,
            ...config // Allow override of config
          });
          
          // Make instance globally available
          (window as any).hydra = hydraInstance;
          
          // Replace all global Hydra functions with real ones
          if (hydraInstance) {
            this.replaceWithRealHydraFunctions(hydraInstance);
          }
          
          console.log('✅ Custom initHydra successful with canvas!');
          return hydraInstance;
        } catch (error) {
          console.error('❌ Custom initHydra failed:', error);
          throw error;
        }
      } else {
        console.warn('⚠️ No canvas found, using default initHydra');
        return await initHydra(config);
      }
    };
    
    // Create Hydra class immediately to prevent "Hydra is not defined" errors
    if (!(window as any).Hydra) {
      (window as any).Hydra = class HydraWrapper {
        constructor(config?: any) {
          console.log('Hydra constructor called with config:', config);
          // Store config for later use when real Hydra is initialized
          this.config = config;
        }
        
        config: any;
      };
    }
    
    // Create basic Hydra functions immediately
    this.createHydraMocks();
    
    // Also set up Strudel function patches
    this.setupStrudelPatches();
    
    console.log('Hydra globals set up immediately');
  }

  private replaceWithRealHydraFunctions(hydraInstance: any) {
    console.log('🔄 Replacing fallback functions with real Hydra functions...');
    
    // Replace source functions
    const hydraFunctions = ['osc', 'noise', 'solid', 'gradient', 'shape', 'voronoi'];
    
    hydraFunctions.forEach(funcName => {
      if (hydraInstance[funcName]) {
        (window as any)[funcName] = hydraInstance[funcName].bind(hydraInstance);
        console.log(`✅ Replaced ${funcName} with real Hydra function`);
      } else {
        console.log(`⚠️ Real ${funcName} function not found in Hydra instance`);
      }
    });
    
    // Replace output channels
    for (let i = 0; i < 4; i++) {
      const outputName = `o${i}`;
      if (hydraInstance[outputName]) {
        (window as any)[outputName] = hydraInstance[outputName];
        console.log(`✅ Replaced ${outputName} with real Hydra output`);
      }
    }
    
    // Replace render function
    if (hydraInstance.render) {
      (window as any).render = hydraInstance.render.bind(hydraInstance);
      console.log('✅ Replaced render with real Hydra function');
    }
    
    // Replace time if Hydra has it
    if (hydraInstance.time !== undefined) {
      (window as any).time = hydraInstance.time;
      console.log('✅ Using Hydra time');
    }
  }

  private setupStrudelPatches() {
    // Create a comprehensive method patcher for both Strudel and Hydra
    const addMissingMethodsToObject = (obj: any) => {
      if (!obj || typeof obj !== 'object') return obj;
      
      // Strudel methods
      const strudelMethods = [
        '_pianoroll', '_scope', '_spectrum', '_waveform', '_grid',
        'pianoroll', 'scope', 'spectrum', 'waveform', 'grid',
        'hush', 'euclidRot', 'crush', 'loopAt', 'dec', 'lpf', 'attack', 'release',
        'transpose', 'speed', 'slow', 'pan', 'delay', 'decay', 'dict', 'voicing',
        'room', 'color', 'every', 'bank', 'gain'
      ];
      
      // Hydra methods
      const hydraMethods = [
        'out', 'rotate', 'scale', 'blend', 'add', 'mult', 'modulate', 'repeat', 
        'kaleid', 'scrollX', 'scrollY', 'modulateRotate', 'modulateScrollX', 'modulateScrollY',
        'brightness', 'contrast', 'colorama', 'luma', 'thresh', 'invert', 'saturate',
        'hue', 'shift', 'r', 'g', 'b', 'a', 'pixelate', 'posterize', 'mask', 'diff',
        'layer', 'modulateScale', 'modulatePixelate', 'modulateRepeat', 'modulateKaleid',
        'modulateHue'
      ];

      const allMethods = [...strudelMethods, ...hydraMethods];

      allMethods.forEach(methodName => {
        if (!obj[methodName]) {
          obj[methodName] = function(...methodArgs: any[]) {
            console.log(`${methodName} called with args:`, methodArgs);
            return addMissingMethodsToObject(this); // Return this with methods for chaining
          };
        }
      });
      
      return obj;
    };

    // Patch common Strudel functions
    const strudelFunctions = ['s', 'sound', 'note', 'chord'];
    
    strudelFunctions.forEach(funcName => {
      const originalFunc = (window as any)[funcName];
      if (originalFunc && typeof originalFunc === 'function') {
        (window as any)[funcName] = function(...args: any[]) {
          const result = originalFunc.apply(this, args);
          return addMissingMethodsToObject(result);
        };
      }
    });

    // Patch common Hydra functions
    const hydraFunctions = ['osc', 'noise', 'solid', 'gradient', 'shape', 'voronoi'];
    
    hydraFunctions.forEach(funcName => {
      const originalFunc = (window as any)[funcName];
      if (originalFunc && typeof originalFunc === 'function') {
        (window as any)[funcName] = function(...args: any[]) {
          const result = originalFunc.apply(this, args);
          return addMissingMethodsToObject(result);
        };
      }
    });

    // Set up a timer to patch functions that might be created later
    setTimeout(() => {
      this.setupStrudelPatches();
    }, 2000);
  }

  private async initializeHydra() {
    try {
      // Don't initialize Hydra with canvas during Strudel prebake to avoid circular reference
      // Just initialize without canvas first
      const hydraInstance = await initHydra({ 
        detectAudio: false 
      });
      
      // Replace the mock Hydra class with the real one
      if (hydraInstance && hydraInstance.constructor) {
        (window as any).Hydra = hydraInstance.constructor;
      }
      
      console.log('Hydra initialized without canvas during Strudel prebake');
    } catch (e) {
      console.warn('Could not initialize Hydra during prebake:', e);
      // Keep the mock functions if real Hydra fails to initialize
      console.log('Using Hydra mock functions as fallback');
    }
  }



  private createHydraMocks() {
    // Create chainable mock objects for Hydra functions with comprehensive method coverage
    const createChainableMock = () => {
      const mock: any = {};
      
      // Common Hydra methods
      const hydraMethodNames = [
        'out', 'color', 'rotate', 'scale', 'blend', 'add', 'mult', 'modulate', 'repeat', 
        'kaleid', 'scrollX', 'scrollY', 'modulateRotate', 'modulateScrollX', 'modulateScrollY',
        'brightness', 'contrast', 'colorama', 'luma', 'thresh', 'invert', 'saturate',
        'hue', 'shift', 'r', 'g', 'b', 'a', 'pixelate', 'posterize', 'mask', 'diff',
        'layer', 'modulateScale', 'modulatePixelate', 'modulateRepeat', 'modulateKaleid',
        'modulateHue', 'modulate', 'blend', 'mult', 'add', 'sub', 'diff', 'layer'
      ];
      
      hydraMethodNames.forEach(methodName => {
        mock[methodName] = (...args: any[]) => {
          console.log(`Hydra mock: ${methodName}(${args.join(', ')})`);
          return createChainableMock();
        };
      });
      
      return mock;
    };

    // Create Hydra source functions
    (window as any).osc = (..._args: any[]) => createChainableMock();
    (window as any).noise = (..._args: any[]) => createChainableMock();
    (window as any).solid = (..._args: any[]) => createChainableMock();
    (window as any).gradient = (..._args: any[]) => createChainableMock();
    (window as any).shape = (..._args: any[]) => createChainableMock();
    (window as any).voronoi = (..._args: any[]) => createChainableMock();
    
    // Create output channels (o0, o1, o2, o3)
    for (let i = 0; i < 4; i++) {
      (window as any)[`o${i}`] = createChainableMock();
    }
    
    // Create render function
    (window as any).render = (_channel?: any) => {
      console.log('Hydra mock: render()');
    };
    
    // Create time variable that matches Hydra's time
    if (!(window as any).time) {
      (window as any).time = 0;
      setInterval(() => {
        (window as any).time += 0.016; // ~60fps
      }, 16);
    }
    
    // Create Hydra class mock
    (window as any).Hydra = class MockHydra {
      constructor(config?: any) {
        console.log('Mock Hydra constructor called with config:', config);
      }
    };
    
    console.log('Hydra mock functions, output channels, and Hydra class created');
  }

  async play(code: string) {
    await this.initialize();
    
    // Check if code is empty or just whitespace
    if (!code || !code.trim()) {
      console.warn('No code to evaluate');
      return;
    }
    
    try {
      // Ensure missing methods are added right before evaluation
      this.addMissingStrudelMethods();
      
      // Ensure visual engine is initialized for Hydra code
      if (!visualEngine.isInitialized()) {
        await visualEngine.initialize();
      }
      
      // Use the real Strudel evaluate function to play code
      await evaluate(code);
      this.isPlaying = true;
      console.log('Strudel code executed successfully');
      
      // Try to hook into Strudel's event system for note visualization
      this.setupNoteVisualization();
    } catch (error) {
      console.error('Strudel execution error:', error);
      throw error;
    }
  }

  private setupNoteVisualization() {
    try {
      // Try multiple approaches to hook into Strudel's event system
      
      // Approach 1: Hook into the global scheduler if available
      const globalScheduler = (window as any).scheduler || (window as any).repl?.scheduler;
      if (globalScheduler && !globalScheduler._visualizationHooked) {
        const originalTrigger = globalScheduler.trigger;
        if (originalTrigger) {
          globalScheduler.trigger = function(event: any) {
            // Try to extract position information from the event
            let patternPosition = undefined;
            let patternLength = undefined;
            
            // Strudel events might contain pattern context information
            if (event.pattern && event.pattern.value) {
              // Try to determine position within the pattern
              const patternValue = event.pattern.value;
              if (Array.isArray(patternValue)) {
                patternLength = patternValue.length;
                // Try to find current position (this is a best guess)
                const currentNote = event.note || event.sound || event.s;
                patternPosition = patternValue.findIndex(v => v === currentNote);
              }
            }
            
            // Emit custom event for visualization with enhanced information
            const noteEvent = new CustomEvent('strudel-note', {
              detail: {
                note: event.note || event.sound || event.s || 'unknown',
                velocity: event.velocity || event.gain || 0.7,
                time: Date.now(),
                color: event.color || '#3b82f6',
                patternPosition: patternPosition,
                patternLength: patternLength
              }
            });
            window.dispatchEvent(noteEvent);
            
            // Call original trigger
            return originalTrigger.call(this, event);
          };
          globalScheduler._visualizationHooked = true;
          console.log('Note visualization hooked into global scheduler with position tracking');
          return;
        }
      }

      // Approach 2: Hook into Web Audio context events
      this.getAudioContext().then(audioContext => {
        if (audioContext) {
          // Create a simple note event simulator for testing
          this.simulateNoteEvents();
        }
      });

      // Approach 3: Try to hook into Strudel's pattern evaluation with context awareness
      const originalEvaluate = (window as any).evaluate;
      if (originalEvaluate && !(window as any)._evaluateHooked) {
        (window as any).evaluate = async function(code: string) {
          // Parse code to understand execution context
          const executionContext = parseCodeExecutionContext(code);
          
          // Only extract notes from executable lines
          const executableLines = getExecutableLines(code, executionContext);
          
          // Enhanced parsing for various Strudel patterns on executable lines only
          const patterns = [
            // Standard sound/note patterns
            /(sound|note|s|n)\s*\(\s*["']([^"']+)["']\s*\)/g,
            // Bank patterns
            /\.bank\s*\(\s*["']([^"']+)["']\s*\)/g,
            // Sample loading patterns
            /samples\s*\(\s*{\s*(\w+):\s*["'][^"']*["']\s*}\s*\)/g,
            // Variable assignments with sounds
            /(\w+)\s*:\s*s\s*\(\s*["']([^"']+)["']\s*\)/g
          ];

          executableLines.forEach(line => {
            patterns.forEach(pattern => {
              let match;
              while ((match = pattern.exec(line)) !== null) {
                const notePattern = match[2] || match[1]; // Get the note pattern or sample name
                if (notePattern) {
                  // Handle different types of patterns
                  let notes: string[] = [];
                  
                  if (notePattern.includes(' ')) {
                    // Space-separated pattern like "bd hh sd hh"
                    notes = notePattern.split(/\s+/).filter(n => n && n !== '~');
                  } else {
                    // Single note/sample
                    notes = [notePattern];
                  }
                  
                  notes.forEach((note, index) => {
                    // Clean up note names (remove modifiers like :2, *4, etc.)
                    const cleanNote = note.replace(/[:\*\[\]<>@!]/g, '').split(/[0-9]/)[0];
                    
                    setTimeout(() => {
                      // Find the line number in the original code
                      const codeLines = code.split('\n');
                      const lineNumber = codeLines.findIndex(codeLine => 
                        codeLine.trim() === line.trim()
                      ) + 1;

                      const noteEvent = new CustomEvent('strudel-note', {
                        detail: {
                          note: cleanNote,
                          velocity: 0.7,
                          time: Date.now(),
                          color: '#3b82f6',
                          line: line.trim(), // Include the actual line for better context
                          lineNumber: lineNumber > 0 ? lineNumber : undefined,
                          patternPosition: index, // Position within the pattern
                          patternLength: notes.length // Total pattern length
                        }
                      });
                      window.dispatchEvent(noteEvent);
                    }, index * 150); // Stagger the events
                  });
                }
              }
            });
          });
          
          // Call original evaluate
          return originalEvaluate.call(this, code);
        };
        (window as any)._evaluateHooked = true;
        console.log('Note visualization hooked into evaluate function with context awareness');
      }

      // Helper functions for code context parsing
      function parseCodeExecutionContext(code: string) {
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

          // Handle single line comments
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
      }

      function getExecutableLines(code: string, context: any): string[] {
        const lines = code.split('\n');
        const executableLines: string[] = [];

        lines.forEach((line, index) => {
          const lineNumber = index + 1;

          // Skip commented lines
          if (context.commentedLines.has(lineNumber)) {
            return;
          }

          // Skip lines in block comment ranges
          for (const range of context.blockCommentRanges) {
            if (lineNumber >= range.start && lineNumber <= range.end) {
              return;
            }
          }

          // Skip empty lines or lines with only whitespace
          if (!line.trim()) {
            return;
          }

          // Check if line contains pattern references that are inactive
          const patternRefs = line.match(/\b(\w+)\./g);
          if (patternRefs) {
            for (const ref of patternRefs) {
              const patternName = ref.slice(0, -1); // Remove the dot
              if (context.inactivePatterns.has(patternName)) {
                return;
              }
            }
          }

          executableLines.push(line);
        });

        return executableLines;
      }

    } catch (e) {
      console.warn('Could not setup note visualization:', e);
    }
  }

  addMissingStrudelMethods() {
    // Add missing methods to Strudel patterns
    try {
      // Try multiple times with different delays to catch when Pattern becomes available
      const tryAddMethods = (attempt: number = 0) => {
        const Pattern = (window as any).Pattern;
        if (Pattern && Pattern.prototype) {
          // Add visualization methods
          if (!Pattern.prototype._pianoroll) {
            Pattern.prototype._pianoroll = function(options: any = {}) {
              console.log('🎹 Pianoroll visualization enabled with options:', options);
              
              // Store visualization config on the pattern
              this._visualizations = this._visualizations || {};
              this._visualizations.pianoroll = {
                enabled: true,
                options: {
                  fold: options.fold || 1,
                  range: options.range || [0, 8],
                  height: options.height || 300,
                  showGrid: options.showGrid !== false,
                  showLabels: options.showLabels !== false,
                  ...options
                }
              };
              
              // Emit visualization event
              window.dispatchEvent(new CustomEvent('strudel-visualization', {
                detail: {
                  type: 'pianoroll',
                  pattern: this,
                  options: this._visualizations.pianoroll.options
                }
              }));
              
              return this;
            };
          }

          if (!Pattern.prototype._scope) {
            Pattern.prototype._scope = function(options: any = {}) {
              console.log('📊 Scope visualization enabled with options:', options);
              
              this._visualizations = this._visualizations || {};
              this._visualizations.scope = {
                enabled: true,
                options: {
                  timeWindow: options.timeWindow || 0.1,
                  amplitude: options.amplitude || 1.0,
                  color: options.color || '#00ff00',
                  ...options
                }
              };
              
              window.dispatchEvent(new CustomEvent('strudel-visualization', {
                detail: {
                  type: 'scope',
                  pattern: this,
                  options: this._visualizations.scope.options
                }
              }));
              
              return this;
            };
          }

          if (!Pattern.prototype._spectrum) {
            Pattern.prototype._spectrum = function(options: any = {}) {
              console.log('🌈 Spectrum visualization enabled with options:', options);
              
              this._visualizations = this._visualizations || {};
              this._visualizations.spectrum = {
                enabled: true,
                options: {
                  fftSize: options.fftSize || 2048,
                  smoothing: options.smoothing || 0.8,
                  scale: options.scale || 'log',
                  showPeaks: options.showPeaks !== false,
                  ...options
                }
              };
              
              window.dispatchEvent(new CustomEvent('strudel-visualization', {
                detail: {
                  type: 'spectrum',
                  pattern: this,
                  options: this._visualizations.spectrum.options
                }
              }));
              
              return this;
            };
          }

          if (!Pattern.prototype._waveform) {
            Pattern.prototype._waveform = function(options: any = {}) {
              console.log('〰️ Waveform visualization enabled with options:', options);
              
              this._visualizations = this._visualizations || {};
              this._visualizations.waveform = {
                enabled: true,
                options: {
                  zoom: options.zoom || 1,
                  showEnvelope: options.showEnvelope !== false,
                  color: options.color || '#00aaff',
                  ...options
                }
              };
              
              window.dispatchEvent(new CustomEvent('strudel-visualization', {
                detail: {
                  type: 'waveform',
                  pattern: this,
                  options: this._visualizations.waveform.options
                }
              }));
              
              return this;
            };
          }

          if (!Pattern.prototype._grid) {
            Pattern.prototype._grid = function(options: any = {}) {
              console.log('⬜ Pattern grid visualization enabled with options:', options);
              
              this._visualizations = this._visualizations || {};
              this._visualizations.grid = {
                enabled: true,
                options: {
                  steps: options.steps || 16,
                  subdivision: options.subdivision || 4,
                  showVelocity: options.showVelocity !== false,
                  colorMode: options.colorMode || 'pattern',
                  ...options
                }
              };
              
              window.dispatchEvent(new CustomEvent('strudel-visualization', {
                detail: {
                  type: 'grid',
                  pattern: this,
                  options: this._visualizations.grid.options
                }
              }));
              
              return this;
            };
          }

          // Add convenience aliases
          if (!Pattern.prototype.pianoroll) {
            Pattern.prototype.pianoroll = Pattern.prototype._pianoroll;
          }
          if (!Pattern.prototype.scope) {
            Pattern.prototype.scope = Pattern.prototype._scope;
          }
          if (!Pattern.prototype.spectrum) {
            Pattern.prototype.spectrum = Pattern.prototype._spectrum;
          }
          if (!Pattern.prototype.waveform) {
            Pattern.prototype.waveform = Pattern.prototype._waveform;
          }
          if (!Pattern.prototype.grid) {
            Pattern.prototype.grid = Pattern.prototype._grid;
          }

          // Add other potentially missing methods
          const missingMethods = [
            'hush', 'euclidRot', 'crush', 'loopAt', 'dec', 'lpf', 'attack', 'release',
            'transpose', 'speed', 'slow', 'pan', 'delay', 'decay', 'dict', 'voicing',
            'room', 'color', 'every', 'bank', 'gain'
          ];

          missingMethods.forEach(methodName => {
            if (!Pattern.prototype[methodName]) {
              Pattern.prototype[methodName] = function(...args: any[]) {
                console.log(`${methodName} called with args:`, args);
                // Return the pattern for chaining
                return this;
              };
            }
          });

          console.log('Missing Strudel methods added to Pattern prototype');
        } else if (attempt < 10) {
          // If Pattern is not available, try again with increasing delays
          const delay = Math.min(100 * Math.pow(2, attempt), 5000); // Exponential backoff, max 5s
          setTimeout(() => tryAddMethods(attempt + 1), delay);
        } else {
          console.warn('Could not find Pattern prototype after 10 attempts');
        }
      };

      // Try immediately first
      tryAddMethods(0);
    } catch (e) {
      console.warn('Could not add missing Strudel methods:', e);
    }
  }

  private simulateNoteEvents() {
    // Enhanced simulation that demonstrates position-based highlighting
    console.log('🎵 Starting note event simulation...');
    let counter = 0;
    const interval = setInterval(() => {
      if (!this.isPlaying) {
        console.log('🎵 Stopping note event simulation (not playing)');
        clearInterval(interval);
        return;
      }
      
      // Simulate a pattern like "bd hh sd hh"
      const testPattern = ['bd', 'hh', 'sd', 'hh'];
      const position = counter % testPattern.length;
      const note = testPattern[position];
      
      console.log(`🎵 Simulating note: ${note} at position ${position}`);
      
      const noteEvent = new CustomEvent('strudel-note', {
        detail: {
          note: note,
          velocity: 0.7,
          time: Date.now(),
          color: '#3b82f6',
          patternPosition: position,
          patternLength: testPattern.length
        }
      });
      window.dispatchEvent(noteEvent);
      
      counter++;
    }, 600); // Every 600ms for testing (slightly slower for better visibility)
  }

  stop() {
    if (this.initialized) {
      hush(); // Stop all patterns
      this.isPlaying = false;
    }
  }

  getIsPlaying(): boolean {
    return this.isPlaying;
  }

  // BPM is now controlled from within the song code using setcps()
  // Example: setcps(175/60/4) for 175 BPM

  async getAudioContext(): Promise<AudioContext | null> {
    await this.initialize();
    return getAudioContext();
  }
}

// Singleton instance
export const strudelEngine = new StrudelEngine();

// Make the engine available globally for the code editor
(window as any).strudelEngine = strudelEngine;

// The real Strudel engine will provide all the functions globally
// We just need to make sure they're available after initialization
export const initializeStrudelGlobals = async () => {
  // Set up Hydra globals immediately before any async operations
  (window as any).initHydra = initHydra;
  
  // Create Hydra class immediately to prevent "Hydra is not defined" errors
  if (!(window as any).Hydra) {
    (window as any).Hydra = class HydraWrapper {
      constructor(config?: any) {
        console.log('Hydra constructor called with config:', config);
        this.config = config;
      }
      
      config: any;
    };
  }
  
  // Initialize the engine (this will replace mocks with real implementations)
  await strudelEngine.initialize();
  
  // Ensure missing methods are added after initialization
  strudelEngine.addMissingStrudelMethods();
  
  // The @strudel/web package should make all functions available globally
  console.log('Strudel globals initialized');
};