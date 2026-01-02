import React from 'react';
import { PlusIcon, FolderIcon, ArrowDownTrayIcon, DocumentIcon } from '@heroicons/react/24/outline';
import { BurgerMenuButton } from '../../ui/BurgerMenuButton';
import { tooltipActions } from '@src/stores/tooltipStore';

interface FileManagerHeaderProps {
  t: (key: string) => string;
  isCreating: boolean;
  isCreatingFolder: boolean;
  isCreatingStep: boolean;
  newTrackName: string;
  newFolderName: string;
  newStepName: string;
  selectedStepTrack: string | null;
  setNewTrackName: (name: string) => void;
  setNewFolderName: (name: string) => void;
  setNewStepName: (name: string) => void;
  onCreateTrack: () => void;
  onCreateFolder: () => void;
  onAddStep: (trackId: string) => void;
  onCancelCreate: () => void;
  onCancelCreateStep: () => void;
  getEmptySpaceContextItems: () => any[];
}

export function FileManagerHeader({
  t,
  isCreating,
  isCreatingFolder,
  isCreatingStep,
  newTrackName,
  newFolderName,
  newStepName,
  selectedStepTrack,
  setNewTrackName,
  setNewFolderName,
  setNewStepName,
  onCreateTrack,
  onCreateFolder,
  onAddStep,
  onCancelCreate,
  onCancelCreateStep,
  getEmptySpaceContextItems,
}: FileManagerHeaderProps) {
  return (
    <div className="p-3 border-b border-gray-600">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">{t('tabs:files')}</h3>
        <BurgerMenuButton
          items={getEmptySpaceContextItems()}
          size="sm"
        />
      </div>

      {/* Hidden file inputs */}
      <input
        id="file-import-input"
        type="file"
        accept=".js,.txt,.zip"
        className="hidden"
      />
      <input
        id="library-import-input"
        type="file"
        accept=".zip"
        className="hidden"
      />

      {/* New track input */}
      {isCreating && (
        <div className="flex space-x-1 mb-2">
          <input
            type="text"
            value={newTrackName}
            onChange={(e) => setNewTrackName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onCreateTrack();
              if (e.key === 'Escape') onCancelCreate();
            }}
            placeholder={t('files:trackName')}
            className="flex-1 px-2 py-1 text-xs bg-background border border-gray-600 rounded"
            autoFocus
          />
          <button
            onClick={onCreateTrack}
            className="px-2 py-1 text-xs bg-blue-600 hover:bg-blue-700 rounded"
            disabled={!newTrackName.trim()}
          >
            {t('files:create')}
          </button>
          <button
            onClick={onCancelCreate}
            className="px-2 py-1 text-xs bg-gray-600 hover:bg-gray-700 rounded"
            onMouseEnter={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              tooltipActions.show({
                id: 'cancel-create-track',
                content: t('common:cancel'),
                position: { x: rect.left + rect.width / 2, y: rect.top },
                type: 'info',
                delay: 500,
              });
            }}
            onMouseLeave={() => tooltipActions.hide()}
          >
            ✕
          </button>
        </div>
      )}

      {/* New folder input */}
      {isCreatingFolder && (
        <div className="flex space-x-1 mb-2">
          <input
            type="text"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onCreateFolder();
              if (e.key === 'Escape') onCancelCreate();
            }}
            placeholder={t('files:folderName')}
            className="flex-1 px-2 py-1 text-xs bg-background border border-gray-600 rounded"
            autoFocus
          />
          <button
            onClick={onCreateFolder}
            className="px-2 py-1 text-xs bg-green-600 hover:bg-green-700 rounded"
            disabled={!newFolderName.trim()}
          >
            {t('files:createFolder')}
          </button>
          <button
            onClick={onCancelCreate}
            className="px-2 py-1 text-xs bg-gray-600 hover:bg-gray-700 rounded"
            onMouseEnter={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              tooltipActions.show({
                id: 'cancel-create-folder',
                content: t('common:cancel'),
                position: { x: rect.left + rect.width / 2, y: rect.top },
                type: 'info',
                delay: 500,
              });
            }}
            onMouseLeave={() => tooltipActions.hide()}
          >
            ✕
          </button>
        </div>
      )}

      {/* New step input */}
      {isCreatingStep && selectedStepTrack && (
        <div className="flex space-x-1 mb-2">
          <input
            type="text"
            value={newStepName}
            onChange={(e) => setNewStepName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onAddStep(selectedStepTrack);
              if (e.key === 'Escape') onCancelCreateStep();
            }}
            placeholder={t('files:stepName')}
            className="flex-1 px-2 py-1 text-xs bg-background border border-gray-600 rounded"
            autoFocus
          />
          <button
            onClick={() => onAddStep(selectedStepTrack)}
            className="px-2 py-1 text-xs bg-purple-600 hover:bg-purple-700 rounded"
            disabled={!newStepName.trim()}
          >
            {t('files:addStep')}
          </button>
          <button
            onClick={onCancelCreateStep}
            className="px-2 py-1 text-xs bg-gray-600 hover:bg-gray-700 rounded"
            onMouseEnter={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              tooltipActions.show({
                id: 'cancel-create-step',
                content: t('common:cancel'),
                position: { x: rect.left + rect.width / 2, y: rect.top },
                type: 'info',
                delay: 500,
              });
            }}
            onMouseLeave={() => tooltipActions.hide()}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}