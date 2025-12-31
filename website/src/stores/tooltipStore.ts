import { atom } from 'nanostores';

export interface TooltipData {
  id: string;
  content: string | React.ReactNode;
  position: { x: number; y: number };
  type?: 'info' | 'warning' | 'error' | 'success';
  delay?: number;
}

interface TooltipState {
  activeTooltip: TooltipData | null;
  hoveredElement: string | null;
  isVisible: boolean;
}

// Create the tooltip store using nanostores
export const tooltipStore = atom<TooltipState>({
  activeTooltip: null,
  hoveredElement: null,
  isVisible: false,
});

// Tooltip actions for easier access
export const tooltipActions = {
  show: (tooltip: TooltipData) => {
    const state = tooltipStore.get();
    
    // Don't show tooltip if we're already showing the same one
    if (state.activeTooltip?.id === tooltip.id && state.isVisible) {
      return;
    }

    tooltipStore.set({
      activeTooltip: tooltip,
      isVisible: true,
      hoveredElement: tooltip.id,
    });
  },

  hide: () => {
    tooltipStore.set({
      activeTooltip: null,
      isVisible: false,
      hoveredElement: null,
    });
  },

  setHovered: (elementId: string | null) => {
    const state = tooltipStore.get();
    
    // If we're hovering over the same element, don't change anything
    if (state.hoveredElement === elementId) {
      return;
    }

    tooltipStore.set({
      ...state,
      hoveredElement: elementId,
    });

    // Hide tooltip if we're no longer hovering over any element
    if (!elementId) {
      tooltipStore.set({
        activeTooltip: null,
        isVisible: false,
        hoveredElement: null,
      });
    }
  },

  updatePosition: (position: { x: number; y: number }) => {
    const state = tooltipStore.get();
    if (state.activeTooltip) {
      tooltipStore.set({
        ...state,
        activeTooltip: {
          ...state.activeTooltip,
          position,
        },
      });
    }
  },
};