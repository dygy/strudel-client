import React, { useRef, useEffect } from 'react';
import { useAppStore } from '../stores/appStore';

interface BackgroundVisualsProps {
  className?: string;
}

export const BackgroundVisuals: React.FC<BackgroundVisualsProps> = ({ className = '' }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const { theme } = useAppStore();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const updateCanvasSize = () => {
      const rect = canvas.getBoundingClientRect();
      const devicePixelRatio = window.devicePixelRatio || 1;
      
      canvas.width = rect.width * devicePixelRatio;
      canvas.height = rect.height * devicePixelRatio;
      
      ctx.scale(devicePixelRatio, devicePixelRatio);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
    };

    const animate = () => {
      if (!canvas || !ctx) return;

      const rect = canvas.getBoundingClientRect();
      const time = Date.now() * 0.001;

      // Clear with subtle background
      const isDark = theme === 'dark';
      ctx.fillStyle = isDark ? 'rgba(15, 23, 42, 0.95)' : 'rgba(248, 250, 252, 0.95)';
      ctx.fillRect(0, 0, rect.width, rect.height);

      // Draw subtle animated background patterns
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;

      // Animated grid
      ctx.strokeStyle = isDark ? 'rgba(100, 116, 139, 0.1)' : 'rgba(148, 163, 184, 0.1)';
      ctx.lineWidth = 1;
      
      const gridSize = 50;
      const offsetX = (time * 10) % gridSize;
      const offsetY = (time * 8) % gridSize;

      for (let x = -gridSize + offsetX; x < rect.width + gridSize; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, rect.height);
        ctx.stroke();
      }

      for (let y = -gridSize + offsetY; y < rect.height + gridSize; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(rect.width, y);
        ctx.stroke();
      }

      // Floating particles
      for (let i = 0; i < 20; i++) {
        const x = centerX + Math.sin(time * 0.5 + i) * (rect.width * 0.3);
        const y = centerY + Math.cos(time * 0.3 + i * 0.5) * (rect.height * 0.3);
        const size = 2 + Math.sin(time * 2 + i) * 1;
        
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fillStyle = isDark 
          ? `rgba(59, 130, 246, ${0.3 + Math.sin(time + i) * 0.2})` 
          : `rgba(37, 99, 235, ${0.2 + Math.sin(time + i) * 0.1})`;
        ctx.fill();
      }

      // Audio-reactive elements (placeholder for now)
      const pulseSize = 20 + Math.sin(time * 4) * 10;
      ctx.beginPath();
      ctx.arc(centerX, centerY, pulseSize, 0, Math.PI * 2);
      ctx.strokeStyle = isDark ? 'rgba(59, 130, 246, 0.3)' : 'rgba(37, 99, 235, 0.2)';
      ctx.lineWidth = 2;
      ctx.stroke();

      animationFrameRef.current = requestAnimationFrame(animate);
    };

    const handleResize = () => {
      updateCanvasSize();
    };

    updateCanvasSize();
    animate();

    window.addEventListener('resize', handleResize);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      window.removeEventListener('resize', handleResize);
    };
  }, [theme]);

  return (
    <canvas
      ref={canvasRef}
      className={`fixed inset-0 pointer-events-none z-0 ${className}`}
      style={{ 
        mixBlendMode: theme === 'dark' ? 'screen' : 'multiply',
        opacity: 0.6 
      }}
    />
  );
};