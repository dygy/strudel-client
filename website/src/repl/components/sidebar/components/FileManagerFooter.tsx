import React from 'react';
import { tooltipActions } from '@src/stores/tooltipStore';
import { PencilIcon, MusicalNoteIcon, DocumentArrowDownIcon } from '@heroicons/react/24/outline';
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
          <div className="flex items-center gap-1">
            <PencilIcon className="w-3 h-3" />
            <span>Editing: {tracks[selectedTrack].name}</span>
          </div>
          <button
            onClick={onSaveCurrentTrack}
            className="flex items-center gap-1 px-3 py-1.5 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 rounded-md text-white text-xs font-medium transition-all duration-200 shadow-sm hover:shadow-md"
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
            <DocumentArrowDownIcon className="w-3 h-3" />
            <span>{t('files:saveChanges')}</span>
          </button>
        </div>
      )}
      {activePattern && tracks[activePattern] && (
        <div className="flex items-center gap-1">
          <MusicalNoteIcon className="w-3 h-3" />
          <span>Playing: {tracks[activePattern].name}</span>
        </div>
      )}
      {saveStatus && (
        <div className={`text-xs ${saveStatus === 'Saved!' ? 'text-green-400' : 'text-yellow-400'}`}>
          {saveStatus}
        </div>
      )}
    </div>
  );
}