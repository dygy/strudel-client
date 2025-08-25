/* eslint-disable @typescript-eslint/no-explicit-any */
// Visual engine for Hydra integration
// @ts-ignore - Strudel hydra types may not be fully available
import { initHydra } from '@strudel/hydra';

class VisualEngine {
  private initialized = false;
  private hydraInstance: any = null;
  private canvas: HTMLCanvasElement | null = null;

  async initialize(canvas?: HTMLCanvasElement) {
    if (this.initialized) return;

    try {
      console.log('VisualEngine: Starting initialization...');
      
      // Set up fallback first to prevent "Hydra is not defined" errors
      this.createHydraFallback();
      
      // Use provided canvas or find the hydra-canvas element
      this.canvas = canvas || document.getElementById('hydra-canvas') as HTMLCanvasElement;
      console.log('VisualEngine: Canvas found:', !!this.canvas, this.canvas?.id);
      
      if (this.canvas) {
        // Initialize Hydra with the canvas immediately
        console.log('VisualEngine: Attempting to initialize Hydra with canvas...');
        try {
          console.log('VisualEngine: Calling initHydra with canvas...');
          this.hydraInstance = await initHydra({
            canvas: this.canvas!,
            detectAudio: false,
            pixelated: true,
          });

          // Make Hydra instance available globally
          (window as any).hydra = this.hydraInstance;
          
          // Replace fallback Hydra class with real one
          if (this.hydraInstance && this.hydraInstance.constructor) {
            (window as any).Hydra = this.hydraInstance.constructor;
          }

          // Replace fallback functions with real Hydra functions
          this.replaceWithRealHydraFunctions();

          console.log('✅ Visual engine initialized with Hydra and canvas successfully!');
        } catch (canvasError) {
          console.warn('❌ Could not initialize Hydra with canvas:', canvasError);
          // Try without canvas
            try {
              console.log('VisualEngine: Trying without canvas...');
              this.hydraInstance = await initHydra({ 
                detectAudio: false 
              });

              // Make Hydra instance available globally
              (window as any).hydra = this.hydraInstance;
              
              if (this.hydraInstance && this.hydraInstance.constructor) {
                (window as any).Hydra = this.hydraInstance.constructor;
              }

              this.replaceWithRealHydraFunctions();

              console.log('✅ Visual engine initialized with Hydra (no canvas)');
            } catch (noCanvasError) {
              console.warn('❌ Could not initialize Hydra at all:', noCanvasError);
              // Keep using fallback
            }
          }
      } else {
        console.log('VisualEngine: No canvas found, trying without canvas...');
        // No canvas available, try to initialize without it
        try {
          this.hydraInstance = await initHydra({ 
            detectAudio: false 
          });

          // Make Hydra instance available globally
          (window as any).hydra = this.hydraInstance;
          
          if (this.hydraInstance && this.hydraInstance.constructor) {
            (window as any).Hydra = this.hydraInstance.constructor;
          }

          this.replaceWithRealHydraFunctions();

          console.log('✅ Visual engine initialized without canvas');
        } catch (error) {
          console.warn('❌ Could not initialize Hydra:', error);
          // Keep using fallback
        }
      }

      this.initialized = true;
    } catch (error) {
      console.error('❌ Failed to initialize visual engine:', error);
      // Create fallback mock if initialization fails
      this.createHydraFallback();
    }
  }

  private replaceWithRealHydraFunctions() {
    // If we have a real Hydra instance, try to get the real functions
    if (this.hydraInstance) {
      console.log('VisualEngine: Replacing fallback functions with real Hydra functions...');
      
      // Try to get real Hydra functions from the instance
      const hydraFunctions = ['osc', 'noise', 'solid', 'gradient', 'shape', 'voronoi'];
      
      hydraFunctions.forEach(funcName => {
        if (this.hydraInstance[funcName]) {
          (window as any)[funcName] = this.hydraInstance[funcName].bind(this.hydraInstance);
          console.log(`✅ Replaced ${funcName} with real Hydra function`);
        } else {
          console.log(`⚠️ Real ${funcName} function not found in Hydra instance`);
        }
      });
      
      // Also try to get output channels
      for (let i = 0; i < 4; i++) {
        const outputName = `o${i}`;
        if (this.hydraInstance[outputName]) {
          (window as any)[outputName] = this.hydraInstance[outputName];
          console.log(`✅ Replaced ${outputName} with real Hydra output`);
        }
      }
      
      // Get render function
      if (this.hydraInstance.render) {
        (window as any).render = this.hydraInstance.render.bind(this.hydraInstance);
        console.log('✅ Replaced render with real Hydra function');
      }
      
      // Get time if available
      if (this.hydraInstance.time !== undefined) {
        (window as any).time = this.hydraInstance.time;
        console.log('✅ Using Hydra time');
      }
    }
  }

  private createHydraFallback() {
    // Create a fallback Hydra class that doesn't throw errors
    (window as any).Hydra = class HydraFallback {
      constructor(config?: any) {
        console.log('Hydra fallback constructor called with config:', config);
        this.config = config;
      }
      
      config: any;
    };

    // Create comprehensive Hydra functions as fallbacks
    const createChainableMock = () => {
      const mock: any = {};
      
      // Comprehensive Hydra methods
      const hydraMethodNames = [
        'out', 'color', 'rotate', 'scale', 'blend', 'add', 'mult', 'modulate', 'repeat', 
        'kaleid', 'scrollX', 'scrollY', 'modulateRotate', 'modulateScrollX', 'modulateScrollY',
        'brightness', 'contrast', 'colorama', 'luma', 'thresh', 'invert', 'saturate',
        'hue', 'shift', 'r', 'g', 'b', 'a', 'pixelate', 'posterize', 'mask', 'diff',
        'layer', 'modulateScale', 'modulatePixelate', 'modulateRepeat', 'modulateKaleid',
        'modulateHue'
      ];
      
      hydraMethodNames.forEach(methodName => {
        mock[methodName] = (...args: any[]) => {
          console.log(`🎨 Hydra fallback: ${methodName}(${args.join(', ')})`);
          return createChainableMock();
        };
      });
      
      return mock;
    };

    // Create Hydra source functions
    (window as any).osc = (...args: any[]) => {
      console.log(`🎨 Hydra fallback: osc(${args.join(', ')})`);
      return createChainableMock();
    };
    (window as any).noise = (...args: any[]) => {
      console.log(`🎨 Hydra fallback: noise(${args.join(', ')})`);
      return createChainableMock();
    };
    (window as any).solid = (...args: any[]) => {
      console.log(`🎨 Hydra fallback: solid(${args.join(', ')})`);
      return createChainableMock();
    };
    (window as any).gradient = (...args: any[]) => {
      console.log(`🎨 Hydra fallback: gradient(${args.join(', ')})`);
      return createChainableMock();
    };
    (window as any).shape = (...args: any[]) => {
      console.log(`🎨 Hydra fallback: shape(${args.join(', ')})`);
      return createChainableMock();
    };
    (window as any).voronoi = (...args: any[]) => {
      console.log(`🎨 Hydra fallback: voronoi(${args.join(', ')})`);
      return createChainableMock();
    };
    
    // Create output channels (o0, o1, o2, o3)
    for (let i = 0; i < 4; i++) {
      (window as any)[`o${i}`] = createChainableMock();
    }
    
    // Create render function
    (window as any).render = (_channel?: any) => {
      console.log('Hydra fallback: render()');
    };
    
    // Create time variable that matches Hydra's time
    if (!(window as any).time) {
      (window as any).time = 0;
      setInterval(() => {
        (window as any).time += 0.016; // ~60fps
      }, 16);
    }

    console.log('Hydra fallback functions created');
  }

  async evaluateVisualCode(code: string) {
    await this.initialize();
    
    try {
      // Evaluate Hydra code
      // The code should be able to use global Hydra functions
      const func = new Function(code);
      func();
      console.log('Visual code evaluated successfully');
    } catch (error) {
      console.error('Visual code evaluation error:', error);
      throw error;
    }
  }

  getCanvas(): HTMLCanvasElement | null {
    return this.canvas;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  getHydraInstance(): any {
    return this.hydraInstance;
  }

  // Manual method to initialize Hydra with canvas when it's ready
  async initializeWithCanvas(canvas: HTMLCanvasElement) {
    try {
      this.canvas = canvas;
      this.hydraInstance = await initHydra({
        canvas: canvas,
        detectAudio: false,
        pixelated: true,
      });

      // Make Hydra instance available globally
      (window as any).hydra = this.hydraInstance;
      
      // Replace fallback Hydra class with real one
      if (this.hydraInstance && this.hydraInstance.constructor) {
        (window as any).Hydra = this.hydraInstance.constructor;
      }

      console.log('Hydra manually initialized with canvas');
      return this.hydraInstance;
    } catch (error) {
      console.error('Failed to manually initialize Hydra with canvas:', error);
      throw error;
    }
  }
}

// Singleton instance
export const visualEngine = new VisualEngine();

// Make the visual engine available globally
(window as any).visualEngine = visualEngine;

// Debug function to test Hydra from console
(window as any).testHydra = () => {
  console.log('🧪 Testing Hydra functions...');
  console.log('Canvas:', document.getElementById('hydra-canvas'));
  console.log('Hydra instance:', (window as any).hydra);
  console.log('Shape function:', (window as any).shape);
  console.log('Out function:', (window as any).o0);
  
  try {
    if ((window as any).shape && (window as any).o0) {
      console.log('🎨 Running test pattern: shape(4).out(o0)');
      (window as any).shape(4).out((window as any).o0);
    } else {
      console.log('❌ Hydra functions not available');
    }
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
};

// Export a function to manually connect Hydra to canvas
export const connectHydraToCanvas = async () => {
  const canvas = document.getElementById('hydra-canvas') as HTMLCanvasElement;
  console.log('🔗 Attempting to connect Hydra to canvas...', !!canvas);
  
  if (canvas && visualEngine) {
    try {
      await visualEngine.initializeWithCanvas(canvas);
      console.log('✅ Hydra manually connected to canvas');
      
      // Test if Hydra is working by running a simple pattern
      setTimeout(() => {
        try {
          console.log('🧪 Testing Hydra with simple pattern...');
          if ((window as any).osc && (window as any).o0) {
            (window as any).osc(10, 0.1, 0.8).out((window as any).o0);
            console.log('✅ Test pattern executed');
          } else {
            console.log('❌ Hydra functions not available for test');
          }
        } catch (testError) {
          console.error('❌ Test pattern failed:', testError);
        }
      }, 2000);
      
    } catch (error) {
      console.error('❌ Failed to manually connect Hydra to canvas:', error);
    }
  } else {
    console.log('❌ Canvas or visual engine not available');
  }
};