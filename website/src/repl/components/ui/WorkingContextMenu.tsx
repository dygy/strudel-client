import React, { useState, useRef, useEffect } from 'react';

interface MenuItem {
  label: string;
  onClick: () => void;
  icon?: React.ReactNode;
  separator?: boolean;
  disabled?: boolean;
  className?: string;
}

interface WorkingContextMenuProps {
  items: MenuItem[];
  children: React.ReactNode;
}

// Global state to track open menus
let openMenus: Set<() => void> = new Set();

export function WorkingContextMenu({ items, children }: WorkingContextMenuProps) {
  const [visible, setVisible] = useState(false);
  const [x, setX] = useState(0);
  const [y, setY] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);

  const showMenu = (event: React.MouseEvent) => {
    event.preventDefault();
    
    // Close all other open menus
    openMenus.forEach(closeMenu => closeMenu());
    openMenus.clear();
    
    setX(event.pageX);
    setY(event.pageY);
    setVisible(true);
    
    // Add this menu to the open menus set
    openMenus.add(() => setVisible(false));
  };

  const hideMenu = () => {
    setVisible(false);
    openMenus.delete(() => setVisible(false));
  };

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
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
      <div className="h-full" onContextMenu={showMenu}>
        {children}
      </div>
      
      {visible && (
        <div
          ref={menuRef}
          className="fixed bg-background border border-lineHighlight rounded shadow-lg py-1 z-[10000]"
          style={{ left: x, top: y, minWidth: '150px' }}
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