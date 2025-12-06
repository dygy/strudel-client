import React, { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface SimpleContextMenuProps {
  children: ReactNode;
}

export function SimpleContextMenu({ children }: SimpleContextMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    console.log('Right-click detected!');
    setPosition({ x: e.clientX, y: e.clientY });
    setIsOpen(true);
  };

  const handleClick = () => {
    setIsOpen(false);
  };

  return (
    <>
      <div onContextMenu={handleContextMenu}>
        {children}
      </div>
      
      {isOpen && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed z-[9999] bg-red-500 border-2 border-yellow-400 rounded-md p-4"
          style={{
            left: position.x,
            top: position.y,
          }}
          onClick={handleClick}
        >
          <div className="text-white">Context Menu Works!</div>
          <div className="text-white">Click to close</div>
        </div>,
        document.body
      )}
    </>
  );
}