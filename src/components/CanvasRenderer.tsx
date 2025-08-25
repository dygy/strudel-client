import React, { useRef, useEffect, useCallback, useState } from 'react';
import { useAppStore } from '../stores/appStore';
import { connectHydraToCanvas } from '../audio/VisualEngine';

interface CanvasRendererProps {
  width?: number;
  height?: number;
  fullscreen?: boolean;
  onResize?: (width: number, height: number) => void;
}

export const CanvasRenderer: React.FC<CanvasRendererProps> = ({
  width: propWidth,
  height: propHeight,
  fullscreen: _fullscreen = false, // eslint-disable-line @typescript-eslint/no-unused-vars
  onResize,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const { fullscreenCanvas, setFullscreenCanvas } = useAppStore();

  // Handle canvas resizing
  const updateCanvasSize = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    
    if (!canvas || !container) return;

    let newWidth = propWidth;
    let newHeight = propHeight;

    // If no explicit dimensions, use container size
    if (!newWidth || !newHeight) {
      const containerRect = container.getBoundingClientRect();
      newWidth = containerRect.width;
      newHeight = containerRect.height;
    }

    // Maintain aspect ratio if needed
    const aspectRatio = 16 / 9;
    if (newWidth / newHeight > aspectRatio) {
      newWidth = newHeight * aspectRatio;
    } else {
      newHeight = newWidth / aspectRatio;
    }

    // Update canvas dimensions
    canvas.width = newWidth;
    canvas.height = newHeight;
    canvas.style.width = `${newWidth}px`;
    canvas.style.height = `${newHeight}px`;

    setDimensions({ width: newWidth, height: newHeight });
    onResize?.(newWidth, newHeight);
  }, [propWidth, propHeight, onResize]);

  // Initialize canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set up canvas for high DPI displays
    const devicePixelRatio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    
    canvas.width = rect.width * devicePixelRatio;
    canvas.height = rect.height * devicePixelRatio;
    
    // Don't scale the 2D context if we're going to use WebGL (Hydra)
    // ctx.scale(devicePixelRatio, devicePixelRatio);
    
    // Initial clear
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Make sure canvas supports WebGL for Hydra
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (gl) {
      console.log('✅ Canvas supports WebGL for Hydra');
    } else {
      console.warn('⚠️ Canvas does not support WebGL - Hydra may not work');
    }

    updateCanvasSize();
    
    // Try to connect Hydra to this canvas
    setTimeout(() => {
      connectHydraToCanvas();
    }, 1000);
  }, [updateCanvasSize]);

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      updateCanvasSize();
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [updateCanvasSize]);

  // Animation loop for visual updates
  useEffect(() => {
    const animate = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      // Check if Hydra is actively rendering
      const hydraInstance = (window as any).hydra || (window as any).visualEngine?.getHydraInstance();
      
      if (!hydraInstance) {
        // Only draw placeholder if Hydra is not available
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Clear canvas
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Show a simple animation as placeholder
        const time = Date.now() * 0.001;
        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;
        
        // Draw a pulsing circle as placeholder
        ctx.beginPath();
        ctx.arc(centerX, centerY, 50 + Math.sin(time * 2) * 20, 0, Math.PI * 2);
        ctx.fillStyle = `hsl(${time * 50 % 360}, 70%, 50%)`;
        ctx.fill();
        
        // Add text to indicate Hydra is not active
        ctx.fillStyle = '#ffffff';
        ctx.font = '16px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('Hydra visuals will appear here', centerX, centerY + 100);
      }
      // If Hydra is active, let it handle the rendering

      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  const toggleFullscreen = () => {
    setFullscreenCanvas(!fullscreenCanvas);
  };

  const handleCanvasClick = () => {
    // Handle canvas interactions
    console.log('Canvas clicked');
  };

  return (
    <div
      ref={containerRef}
      className={`relative bg-black ${
        fullscreenCanvas 
          ? 'fixed inset-0 z-50' 
          : 'w-full h-full'
      }`}
    >
      {/* Canvas Controls */}
      <div className="absolute top-2 right-2 z-10 flex space-x-2">
        <button
          onClick={toggleFullscreen}
          className="p-2 bg-black bg-opacity-50 text-white rounded-md hover:bg-opacity-70 transition-colors"
          title={fullscreenCanvas ? 'Exit fullscreen' : 'Enter fullscreen'}
        >
          {fullscreenCanvas ? (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
            </svg>
          )}
        </button>
      </div>

      {/* Canvas */}
      <canvas
        ref={canvasRef}
        id="hydra-canvas"
        onClick={handleCanvasClick}
        className="block mx-auto cursor-pointer"
        style={{
          maxWidth: '100%',
          maxHeight: '100%',
          objectFit: 'contain',
        }}
      />

      {/* Canvas Info */}
      <div className="absolute bottom-2 left-2 text-xs text-gray-400 bg-black bg-opacity-50 px-2 py-1 rounded">
        {dimensions.width} × {dimensions.height}
      </div>

      {/* Fullscreen overlay controls */}
      {fullscreenCanvas && (
        <div className="absolute top-4 left-4 text-white">
          <h3 className="text-lg font-semibold mb-2">Visual Output</h3>
          <p className="text-sm text-gray-300">Press ESC or click × to exit fullscreen</p>
        </div>
      )}
    </div>
  );
};

// Hook for canvas utilities
// eslint-disable-next-line react-refresh/only-export-components
export const useCanvas = () => {
  const getCanvas = useCallback(() => {
    return document.getElementById('hydra-canvas') as HTMLCanvasElement;
  }, []);

  const getContext = useCallback(() => {
    const canvas = getCanvas();
    return canvas?.getContext('2d') || null;
  }, [getCanvas]);

  const clearCanvas = useCallback(() => {
    const ctx = getContext();
    const canvas = getCanvas();
    if (ctx && canvas) {
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }, [getContext, getCanvas]);

  const resizeCanvas = useCallback((width: number, height: number) => {
    const canvas = getCanvas();
    if (canvas) {
      canvas.width = width;
      canvas.height = height;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }
  }, [getCanvas]);

  return {
    getCanvas,
    getContext,
    clearCanvas,
    resizeCanvas,
  };
};