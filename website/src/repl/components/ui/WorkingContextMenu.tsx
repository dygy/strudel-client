import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';

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

const VIEWPORT_PADDING = 10;

/**
 * Where a menu opened at (x, y) goes so it stays fully inside the viewport: to the left of / above
 * the point when it would overflow the right / bottom edge, never closer than `padding` to an edge.
 * All in viewport (client) coordinates, as the menu is `position: fixed` in document.body.
 */
export function fitMenuInViewport(
  x: number,
  y: number,
  menu: { width: number; height: number },
  viewport: { width: number; height: number },
  padding = VIEWPORT_PADDING,
): { left: number; top: number } {
  let left = x;
  let top = y;
  if (left + menu.width > viewport.width - padding) left = x - menu.width;
  if (top + menu.height > viewport.height - padding) top = y - menu.height;
  left = Math.max(padding, Math.min(left, viewport.width - padding - menu.width));
  top = Math.max(padding, Math.min(top, viewport.height - padding - menu.height));
  return { left, top };
}

// Global state to track open menus
let openMenus: Set<() => void> = new Set();

/** Touch/pen long press (spec 016 2.2): hold this long to open the menu without a right-click. */
export const LONG_PRESS_MS = 500;
/** Moving the finger further than this (px) is a scroll or drag, not a long press. */
export const LONG_PRESS_MOVE_TOLERANCE = 10;
// Menus nest (a tree row inside the tree's empty-space menu): the innermost one claims the press,
// without stopping propagation (the library drawer's swipe-to-close listens above).
const claimedPresses = new WeakSet<Event>();

export function WorkingContextMenu({ items, children }: WorkingContextMenuProps) {
  const [visible, setVisible] = useState(false);
  const [x, setX] = useState(0);
  const [y, setY] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);

  // Debug: Add a test button to manually show the menu
  const [debugMode, setDebugMode] = useState(false);

  const longPress = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);
  // The click that ends a long press must not also select the row (or close the menu again).
  const suppressNextClick = useRef(false);

  // The point the menu was opened at, in viewport coordinates.
  const anchor = useRef({ x: 0, y: 0 });
  const isInMenu = (target: EventTarget | null) => !!menuRef.current?.contains(target as Node);

  const showMenu = (event: React.MouseEvent) => {
    // A right-click inside the open menu (it is portalled, but React events still bubble here).
    if (isInMenu(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    openMenuAt(event.clientX, event.clientY);
  };

  const openMenuAt = (clientX: number, clientY: number) => {
    console.log('WorkingContextMenu - showMenu called', { items: items.length });

    // Close all other open menus
    openMenus.forEach((closeMenu) => closeMenu());
    openMenus.clear();

    // First guess from estimated sizes; the layout effect below corrects it with the real size.
    anchor.current = { x: clientX, y: clientY };
    const { left: menuX, top: menuY } = fitMenuInViewport(
      clientX,
      clientY,
      { width: 200, height: items.length * 40 },
      { width: window.innerWidth, height: window.innerHeight },
    );

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

  const cancelLongPress = () => {
    if (longPress.current) clearTimeout(longPress.current.timer);
    longPress.current = null;
  };

  // Mouse keeps the native right-click (onContextMenu); touch and pen get a long press.
  const handlePointerDown = (event: React.PointerEvent) => {
    if (isInMenu(event.target)) return;
    suppressNextClick.current = false;
    cancelLongPress();
    if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
    if (claimedPresses.has(event.nativeEvent)) return;
    claimedPresses.add(event.nativeEvent);
    const { clientX: x, clientY: y } = event;
    longPress.current = {
      x,
      y,
      timer: setTimeout(() => {
        longPress.current = null;
        suppressNextClick.current = true;
        openMenuAt(x, y);
      }, LONG_PRESS_MS),
    };
  };

  const handlePointerMove = (event: React.PointerEvent) => {
    const press = longPress.current;
    if (!press) return;
    if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > LONG_PRESS_MOVE_TOLERANCE) cancelLongPress();
  };

  const handleClickCapture = (event: React.MouseEvent) => {
    if (!suppressNextClick.current || isInMenu(event.target)) return;
    suppressNextClick.current = false;
    event.preventDefault();
    event.stopPropagation();
  };

  useEffect(() => cancelLongPress, []);

  // Fit the menu with its measured size (separators and long labels make the estimate wrong).
  useLayoutEffect(() => {
    if (!visible || !menuRef.current) return;
    const { width, height } = menuRef.current.getBoundingClientRect();
    const { left, top } = fitMenuInViewport(
      anchor.current.x,
      anchor.current.y,
      { width, height },
      { width: window.innerWidth, height: window.innerHeight },
    );
    setX(left);
    setY(top);
  }, [visible]);

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
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={cancelLongPress}
        onPointerCancel={cancelLongPress}
        onClickCapture={handleClickCapture}
        // iOS: a long press shows the system callout instead of our menu without this.
        style={{ position: 'relative', WebkitTouchCallout: 'none' }}
      >
        {children}
      </div>

      {/* Portalled: an ancestor with a transform (the compact library drawer) would otherwise become
          the containing block of this fixed menu, offsetting and clipping it (spec 016 review #2). */}
      {visible &&
        createPortal(
          <div
            ref={menuRef}
            className="fixed bg-background border border-lineHighlight rounded shadow-lg py-1"
            // React events from the portal still bubble to the parents (an outer empty-space menu,
            // the drawer's swipe): a press in this menu is not a long press or a swipe there.
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.stopPropagation()}
            style={{
              left: x,
              top: y,
              minWidth: '150px',
              pointerEvents: 'auto',
              zIndex: 10000,
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
          </div>,
          document.body,
        )}
    </>
  );
}
