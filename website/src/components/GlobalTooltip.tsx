import React, { useEffect, useState } from 'react';
import { useStore } from '@nanostores/react';
import { tooltipStore } from '@src/stores/tooltipStore';
import cx from '@src/cx';

export function GlobalTooltip() {
  const { activeTooltip, isVisible } = useStore(tooltipStore);
  const [showTooltip, setShowTooltip] = useState(false);

  useEffect(() => {
    if (isVisible && activeTooltip) {
      // Small delay to prevent flickering when moving between elements
      const timer = setTimeout(() => {
        setShowTooltip(true);
      }, activeTooltip.delay || 500);

      return () => clearTimeout(timer);
    } else {
      setShowTooltip(false);
    }
  }, [isVisible, activeTooltip]);

  if (!showTooltip || !activeTooltip) {
    return null;
  }

  const tooltipStyles = {
    info: 'bg-gray-800 text-white border-gray-600',
    warning: 'bg-yellow-800 text-yellow-100 border-yellow-600',
    error: 'bg-red-800 text-red-100 border-red-600',
    success: 'bg-green-800 text-green-100 border-green-600',
  };

  const style = tooltipStyles[activeTooltip.type || 'info'];

  return (
    <div
      className={cx(
        'fixed z-[10002] px-2 py-1 text-xs rounded shadow-lg border pointer-events-none',
        'max-w-xs break-words',
        style
      )}
      style={{
        left: activeTooltip.position.x,
        top: activeTooltip.position.y - 30, // Position above the cursor
        transform: 'translateX(-50%)', // Center horizontally
      }}
    >
      {typeof activeTooltip.content === 'string' ? (
        <span>{activeTooltip.content}</span>
      ) : (
        activeTooltip.content
      )}
    </div>
  );
}