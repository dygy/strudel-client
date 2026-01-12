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

  // Debug: Add a test button to manually show the menu
  const [debugMode, setDebugMode] = useState(false);

  const showMenu = (event: React.MouseEvent) => {
    console.log('WorkingContextMenu - showMenu called', { items: items.length });
    event.preventDefault();
    event.stopPropagation();

    // Close all other open menus
    openMenus.forEach(closeMenu => closeMenu());
    openMenus.clear();

    // Calculate smart positioning based on viewport
    const menuWidth = 200; // Estimated menu width
    const menuHeight = items.length * 40; // Estimated menu height (40px per item)
    const padding = 10; // Padding from viewport edges

    let menuX = event.pageX;
    let menuY = event.pageY;

    // Check if menu would overflow right edge
    if (menuX + menuWidth > window.innerWidth - padding) {
      menuX = event.pageX - menuWidth; // Show to the left of cursor
    }

    // Check if menu would overflow bottom edge
    if (menuY + menuHeight > window.innerHeight - padding) {
      menuY = event.pageY - menuHeight; // Show above cursor
    }

    // Ensure menu doesn't go off left edge
    if (menuX < padding) {
      menuX = padding;
    }

    // Ensure menu doesn't go off top edge
    if (menuY < padding) {
      menuY = padding;
    }

    setX(menuX);
    setY(menuY);
    setVisible(true);

    console.log('WorkingContextMenu - menu should be visible now', { x: menuX, y: menuY, visible: true });

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
      <div
        className="h-full"
        onContextMenu={showMenu}
        style={{ position: 'relative' }}
      >
        {children}
      </div>

      {visible && (
        <div
          ref={menuRef}
          className="fixed bg-background border border-lineHighlight rounded shadow-lg py-1"
          style={{
            left: x,
            top: y,
            minWidth: '150px',
            pointerEvents: 'auto',
            zIndex: 10000
          }}
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
                    console.log('WorkingContextMenu - item clicked:', item.label);
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
