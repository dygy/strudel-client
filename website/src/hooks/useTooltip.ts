import { useCallback, useRef } from 'react';
import { tooltipActions, type TooltipData } from '@src/stores/tooltipStore';
import React from 'react';

interface UseTooltipOptions {
  content: string | React.ReactNode;
  type?: 'info' | 'warning' | 'error' | 'success';
  delay?: number;
  disabled?: boolean;
}

export function useTooltip(elementId: string, options: UseTooltipOptions) {
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const showTooltip = useCallback((event: React.MouseEvent) => {
    if (options.disabled) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const tooltip: TooltipData = {
      id: elementId,
      content: options.content,
      position: {
        x: rect.left + rect.width / 2,
        y: rect.top,
      },
      type: options.type || 'info',
      delay: options.delay || 500,
    };

    tooltipActions.show(tooltip);
  }, [elementId, options]);

  const hideTooltip = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    tooltipActions.hide();
  }, []);

  const updatePosition = useCallback((event: React.MouseEvent) => {
    if (options.disabled) return;

    const rect = event.currentTarget.getBoundingClientRect();
    tooltipActions.updatePosition({
      x: rect.left + rect.width / 2,
      y: rect.top,
    });
  }, [options.disabled]);

  return {
    onMouseEnter: showTooltip,
    onMouseLeave: hideTooltip,
    onMouseMove: updatePosition,
  };
}

// Simplified hook for track tooltips
export function useTrackTooltip(track: { id: string; name: string; modified?: string }, options: Partial<UseTooltipOptions> = {}) {
  const content = options.content || React.createElement('div', null,
    React.createElement('div', { className: 'font-medium' }, track.name),
    track.modified && React.createElement('div', { className: 'text-xs opacity-75 mt-1' },
      `Modified: ${new Date(track.modified).toLocaleDateString()}`
    )
  );

  return useTooltip(`track-${track.id}`, {
    content,
    type: 'info',
    delay: 300,
    ...options,
  });
}