import React, { useState, useRef, useEffect } from 'react';
import { EllipsisVerticalIcon } from '@heroicons/react/24/outline';

interface MenuItem {
  label: string;
  onClick: () => void;
  icon?: React.ReactNode;
  separator?: boolean;
  disabled?: boolean;
  className?: string;
}

interface BurgerMenuButtonProps {
  items: MenuItem[];
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

export function BurgerMenuButton({ items, className = '', size = 'sm' }: BurgerMenuButtonProps) {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const sizeClasses = {
    sm: 'w-4 h-4',
    md: 'w-5 h-5', 
    lg: 'w-6 h-6'
  };

  const showMenu = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setPosition({
        x: rect.right - 150, // Align menu to right edge of button
        y: rect.bottom + 4
      });
    }
    
    setVisible(true);
  };

  const hideMenu = () => {
    setVisible(false);
  };

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node) &&
          buttonRef.current && !buttonRef.current.contains(e.target as Node)) {
        hideMenu();
      }
    };
    
    const handleScroll = () => hideMenu();
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hideMenu();
    };
    
    if (visible) {
      document.addEventListener('click', handleClick);
      document.addEventListener('scroll', handleScroll);
      document.addEventListener('keydown', handleEscape);
    }
    
    return () => {
      document.removeEventListener('click', handleClick);
      document.removeEventListener('scroll', handleScroll);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [visible]);

  return (
    <>
      <button
        ref={buttonRef}
        onClick={showMenu}
        className={`p-1 rounded hover:bg-lineHighlight transition-colors ${className}`}
        title="More options"
      >
        <EllipsisVerticalIcon className={sizeClasses[size]} />
      </button>
      
      {visible && (
        <div
          ref={menuRef}
          className="fixed bg-background border border-lineHighlight rounded shadow-lg py-1 z-[10000]"
          style={{ left: position.x, top: position.y, minWidth: '150px' }}
        >
          {items.map((item, index) => (
            <React.Fragment key={index}>
              {item.separator ? (
                <div className="border-t border-lineHighlight my-1" />
              ) : (
                <button
                  className={`w-full text-left px-3 py-2 flex items-center gap-2 text-sm transition-colors ${
                    item.disabled 
                      ? 'text-foreground/50 cursor-not-allowed' 
                      : 'text-foreground hover:bg-lineHighlight cursor-pointer'
                  } ${item.className || ''}`}
                  onClick={() => {
                    if (!item.disabled) {
                      item.onClick();
                      hideMenu();
                    }
                  }}
                  disabled={item.disabled}
                >
                  {item.icon && <span className="w-4 h-4 flex-shrink-0">{item.icon}</span>}
                  {item.label}
                </button>
              )}
            </React.Fragment>
          ))}
        </div>
      )}
    </>
  );
}