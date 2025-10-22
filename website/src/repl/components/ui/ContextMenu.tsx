import React, { useState, useRef, useEffect, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import cx from '@src/cx';

interface ContextMenuItem {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  separator?: boolean;
}

interface ContextMenuProps {
  items: ContextMenuItem[];
  children: ReactNode;
  className?: string;
}

export function ContextMenu({ items, children, className }: ContextMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    setPosition({
      x: e.clientX,
      y: e.clientY,
    });
    setIsOpen(true);
  };

  const handleClick = (item: ContextMenuItem) => {
    if (!item.disabled) {
      item.onClick();
      setIsOpen(false);
    }
  };

  const handleClickOutside = (e: MouseEvent) => {
    if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
      setIsOpen(false);
    }
  };

  const handleEscape = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscape);
      
      // Adjust position if menu would go off screen
      if (menuRef.current) {
        const menuRect = menuRef.current.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        
        let adjustedX = position.x;
        let adjustedY = position.y;
        
        if (position.x + menuRect.width > viewportWidth) {
          adjustedX = viewportWidth - menuRect.width - 10;
        }
        
        if (position.y + menuRect.height > viewportHeight) {
          adjustedY = viewportHeight - menuRect.height - 10;
        }
        
        if (adjustedX !== position.x || adjustedY !== position.y) {
          setPosition({ x: adjustedX, y: adjustedY });
        }
      }
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, position]);

  return (
    <>
      <div
        ref={triggerRef}
        onContextMenu={handleContextMenu}
        className={cx('relative', className)}
      >
        {children}
      </div>
      
      {isOpen && typeof document !== 'undefined' && createPortal(
        <div
          ref={menuRef}
          className="fixed z-[9999] bg-background border border-lineHighlight rounded-md shadow-xl py-1 min-w-[160px]"
          style={{
            left: position.x,
            top: position.y,
            boxShadow: '0 10px 25px rgba(0, 0, 0, 0.3)',
          }}
        >
          {items.map((item, index) => (
            <React.Fragment key={index}>
              {item.separator && (
                <div className="border-t border-lineHighlight my-1" />
              )}
              <button
                className={cx(
                  'w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors',
                  item.disabled
                    ? 'text-foreground/50 cursor-not-allowed'
                    : 'text-foreground hover:bg-lineHighlight cursor-pointer'
                )}
                onClick={() => handleClick(item)}
                disabled={item.disabled}
              >
                {item.icon && <span className="w-4 h-4 flex-shrink-0">{item.icon}</span>}
                <span>{item.label}</span>
              </button>
            </React.Fragment>
          ))}
        </div>,
        document.body
      )}
    </>
  );
}