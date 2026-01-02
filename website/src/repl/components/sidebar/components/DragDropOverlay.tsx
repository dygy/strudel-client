import React from 'react';

interface DragDropOverlayProps {
  isDragOver: boolean;
  t: (key: string) => string;
}

export function DragDropOverlay({ isDragOver, t }: DragDropOverlayProps) {
  if (!isDragOver) {
    return null;
  }

  return (
    <div className="absolute inset-0 bg-blue-500/10 flex items-center justify-center z-50 pointer-events-none">
      <div className="bg-blue-600 text-white px-4 py-2 rounded-lg shadow-lg">
        {t('files:dropToImport')}
      </div>
    </div>
  );
}