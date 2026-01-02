import React from 'react';
import { tooltipActions } from '@src/stores/tooltipStore';
import type { Track } from '../hooks/useFileManager';

interface FileManagerFooterProps {
  selectedTrack: string | null;
  activePattern: string;
  tracks: Record<string, Track>;
  saveStatus: string;
  t: (key: string) => string;
  onSaveCurrentTrack: () => Promise<void>;
}

export function FileManagerFooter({
  selectedTrack,
  activePattern,
  tracks,
  saveStatus,
  t,
  onSaveCurrentTrack,
}: FileManagerFooterProps) {
  if (!selectedTrack && !activePattern) {
    return null;
  }

  return (
    <div className="p-2 border-t border-gray-600 text-xs text-gray-400 space-y-1">
      {selectedTrack && tracks[selectedTrack] && (
        <div className="flex items-center justify-between">
          <div>📝 Editing: {tracks[selectedTrack].name}</div>
          <button
            onClick={onSaveCurrentTrack}
            className="px-2 py-1 bg-blue-600 hover:bg-blue-700 rounded text-white text-xs"
            onMouseEnter={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              tooltipActions.show({
                id: 'save-button',
                content: t('files:saveChanges'),
                position: { x: rect.left + rect.width / 2, y: rect.top },
                type: 'info',
                delay: 500,
              });
            }}
            onMouseLeave={() => tooltipActions.hide()}
          >
            {t('files:saveChanges')}
          </button>
        </div>
      )}
      {activePattern && tracks[activePattern] && (
        <div>🎵 Playing: {tracks[activePattern].name}</div>
      )}
      {saveStatus && (
        <div className={`text-xs ${saveStatus === 'Saved!' ? 'text-green-400' : 'text-yellow-400'}`}>
          {saveStatus}
        </div>
      )}
    </div>
  );
}