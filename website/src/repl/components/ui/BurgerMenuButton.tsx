import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
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

/**
 * A 44x44 touch target on touch screens and narrow (phone) windows, spec 016 2.2. The icon keeps
 * its size, and a mouse on a wide screen keeps the original small button.
 */
export const TOUCH_TARGET_CLASSES = [
  '[@media(pointer:coarse)]:min-h-11',
  '[@media(pointer:coarse)]:min-w-11',
  '[@media(pointer:coarse)]:inline-flex',
  '[@media(pointer:coarse)]:items-center',
  '[@media(pointer:coarse)]:justify-center',
  'max-md:min-h-11',
  'max-md:min-w-11',
  'max-md:inline-flex',
  'max-md:items-center',
  'max-md:justify-center',
].join(' ');

const VIEWPORT_PADDING = 10;
/** The desktop menu's assumed width: LTR keeps aligning the menu's left edge 150px before the button's right edge. */
const ALIGN_WIDTH = 150;

/**
 * Where the "⋮" menu goes, in viewport coordinates (it is fixed and portalled to body): below the
 * button, its start edge aligned as on the desktop (LTR: 150px left of the button's right edge;
 * RTL: at the button's left edge, opening inwards), above the button when it would not fit below
 * (the last rows), and always inside the viewport.
 */
export function placeBurgerMenu(
  button: { left: number; right: number; top: number; bottom: number },
  menu: { width: number; height: number },
  viewport: { width: number; height: number },
  rtl: boolean,
  padding = VIEWPORT_PADDING,
): { x: number; y: number } {
  let x = rtl ? button.left : button.right - ALIGN_WIDTH;
  let y = button.bottom + 4;
  if (y + menu.height > viewport.height - padding) y = button.top - 4 - menu.height;
  x = Math.max(padding, Math.min(x, viewport.width - padding - menu.width));
  y = Math.max(padding, y);
  return { x, y };
}

const stopPropagation = (event: React.SyntheticEvent) => event.stopPropagation();
const viewportSize = () => ({ width: window.innerWidth, height: window.innerHeight });

export function BurgerMenuButton({ items, className = '', size = 'sm' }: BurgerMenuButtonProps) {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const anchor = useRef<{ rect: DOMRect; rtl: boolean } | null>(null);

  const sizeClasses = {
    sm: 'w-4 h-4',
    md: 'w-5 h-5',
    lg: 'w-6 h-6',
  };

  const showMenu = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();

    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const rtl = getComputedStyle(buttonRef.current).direction === 'rtl';
      anchor.current = { rect, rtl };
      // First guess; the layout effect corrects it with the menu's measured size.
      setPosition(placeBurgerMenu(rect, { width: ALIGN_WIDTH, height: 0 }, viewportSize(), rtl));
    }

    setVisible(true);
  };

  useLayoutEffect(() => {
    if (!visible || !menuRef.current || !anchor.current) return;
    const { width, height } = menuRef.current.getBoundingClientRect();
    setPosition(placeBurgerMenu(anchor.current.rect, { width, height }, viewportSize(), anchor.current.rtl));
  }, [visible]);

  const hideMenu = () => {
    setVisible(false);
  };

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
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
        onClick={(e) => {
          e.stopPropagation(); // Prevent parent row click
          showMenu(e);
        }}
        className={`p-1 rounded hover:bg-lineHighlight transition-colors ${TOUCH_TARGET_CLASSES} ${className}`}
        title="More options"
      >
        <EllipsisVerticalIcon className={sizeClasses[size]} />
      </button>

      {/* Portalled: an ancestor with a transform (the compact library drawer) would otherwise become
          the containing block of this fixed menu (spec 016 review #2). Its events stop here, so a
          choice never also selects the row the button sits in, or starts the row's long press. */}
      {visible &&
        createPortal(
          <div
            ref={menuRef}
            className="fixed bg-background border border-lineHighlight rounded shadow-lg py-1 z-[10000]"
            style={{ left: position.x, top: position.y, minWidth: '150px' }}
            onClick={stopPropagation}
            onPointerDown={stopPropagation}
            onContextMenu={stopPropagation}
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
          </div>,
          document.body,
        )}
    </>
  );
}
