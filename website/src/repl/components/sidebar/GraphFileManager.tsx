import React from 'react';
import { GraphFileTree } from './GraphFileTree';
import { InfoModal } from '../ui/InfoModal';
import { ConfirmModal } from '../ui/ConfirmModal';
import { formatDateTimeIntl } from '@src/i18n/dateFormat';
import { useTranslation } from '@src/i18n';
import { toastActions } from '@src/stores/toastStore';
import { useGraphFileManager } from './hooks/useGraphFileManager';
import type {Track} from '@src/lib/FileSystemGraph.ts';

interface ReplContext {
  activeCode?: string;
  editorRef?: React.RefObject<{ code: string; setCode?: (code: string) => void }>;
  handleUpdate: (update: { id?: string; code: string; [key: string]: any }, replace?: boolean) => void;
  trackRouter?: any;
}

interface GraphFileManagerProps {
  context: ReplContext;
}

export function GraphFileManager({ context }: GraphFileManagerProps) {
  const { t, i18n } = useTranslation(['files', 'common', 'tabs', 'auth']);

  // Use the graph file manager hook
  const fileManager = useGraphFileManager(context);

  // UI state for modals
  const [showInfoModal, setShowInfoModal] = React.useState(false);
  const [infoModalData, setInfoModalData] = React.useState<{
    title: string;
    items: Array<{ label: string; value: string }>
  }>({ title: '', items: [] });

  // If not authenticated, show sign-in prompt
  if (!fileManager.isAuthenticated) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 text-center bg-lineHighlight">
        <div className="mb-6">
          <svg className="w-16 h-16 mx-auto mb-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <h3 className="text-xl font-semibold text-foreground mb-2">
            {t('auth:signInRequired')}
          </h3>
          <p className="text-gray-400 mb-6">
            {t('auth:signInDescription')}
          </p>
        </div>
        <div className="text-sm text-gray-500">
          <p>{t('common:clickAuthButtonToSignIn')}</p>
        </div>
      </div>
    );
  }

  // Show loading state
  if (fileManager.isLoading || !fileManager.isInitialized) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 text-center bg-lineHighlight">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mb-4"></div>
        <p className="text-gray-400">Loading file system...</p>
      </div>
    );
  }

  // Show error state
  if (fileManager.syncError) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 text-center bg-lineHighlight">
        <div className="mb-6">
          <svg className="w-16 h-16 mx-auto mb-4 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
          <h3 className="text-xl font-semibold text-red-400 mb-2">
            Error Loading Files
          </h3>
          <p className="text-gray-400 mb-6">
            {fileManager.syncError}
          </p>
        </div>
        <button
          onClick={fileManager.loadGraphFromAPI}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          Retry
        </button>
      </div>
    );
  }

  const handleTrackInfo = (track: Track) => {
    setInfoModalData({
      title: `${t('files:trackProperties')} - ${track.name}`,
      items: [
        { label: t('files:name'), value: track.name },
        { label: t('files:created'), value: formatDateTimeIntl(new Date(track.created), i18n.language) },
        { label: t('files:modified'), value: formatDateTimeIntl(new Date(track.modified), i18n.language) },
        { label: t('files:linesOfCode'), value: track.code.split('\n').length.toString() },
        { label: t('files:characters'), value: track.code.length.toString() },
        { label: t('files:size'), value: `${(new Blob([track.code]).size / 1024).toFixed(2)} KB` },
        { label: t('files:folder'), value: track.parentId ? fileManager.getPath(track.parentId) : t('files:rootFolder') },
      ]
    });
    setShowInfoModal(true);
  };

  const handleTrackCreate = (parentId?: string) => {
    fileManager.setNewItemParentId(parentId || null);
    fileManager.setIsCreating(true);
  };

  const handleFolderCreate = (parentId?: string) => {
    fileManager.setNewItemParentId(parentId || null);
    fileManager.setIsCreatingFolder(true);
  };

  const handleTrackRename = (trackId: string) => {
    const track = fileManager.getTrack(trackId);
    if (track) {
      fileManager.setSelectedTrack(trackId);
      // TODO: Implement rename state
    }
  };

  const handleFolderRename = (folderId: string) => {
    const folder = fileManager.getFolder(folderId);
    if (folder) {
      // TODO: Implement rename state
    }
  };

  const handleTrackDelete = (trackId: string) => {
    fileManager.setNodeToDelete(trackId);
    fileManager.setShowDeleteModal(true);
  };

  const handleFolderDelete = (folderId: string) => {
    fileManager.setNodeToDelete(folderId);
    fileManager.setShowDeleteModal(true);
  };

  const handleTrackDuplicate = async (trackId: string) => {
    const track = fileManager.getTrack(trackId);
    if (track) {
      const newName = `${track.name} (copy)`;
      await fileManager.createTrack(
        newName,
        track.code,
        track.parentId,
        track.isMultitrack,
        track.steps,
        track.activeStep
      );
    }
  };

  const handleTrackDownload = (trackId: string) => {
    const track = fileManager.getTrack(trackId);
    if (track) {
      const blob = new Blob([track.code], { type: 'text/javascript' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${track.name}.js`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  };

  const handleFolderDownload = (folderId: string) => {
    // TODO: Implement folder download as ZIP
    toastActions.info('Folder download not yet implemented');
  };

  const handleMoveItem = async (itemId: string, targetFolderId: string | null) => {
    await fileManager.moveNode(itemId, targetFolderId);
  };

  const confirmDelete = async () => {
    if (fileManager.nodeToDelete) {
      await fileManager.deleteNode(fileManager.nodeToDelete);
      fileManager.setNodeToDelete(null);
      fileManager.setShowDeleteModal(false);
    }
  };

  const createNewTrack = async () => {
    if (fileManager.newTrackName.trim()) {
      const track = await fileManager.createTrack(
        fileManager.newTrackName.trim(),
        '',
        fileManager.newItemParentId
      );

      if (track) {
        fileManager.loadTrack(track);
      }

      fileManager.setNewTrackName('');
      fileManager.setIsCreating(false);
      fileManager.setNewItemParentId(null);
    }
  };

  const createNewFolder = async () => {
    if (fileManager.newFolderName.trim()) {
      await fileManager.createFolder(
        fileManager.newFolderName.trim(),
        fileManager.newItemParentId
      );

      fileManager.setNewFolderName('');
      fileManager.setIsCreatingFolder(false);
      fileManager.setNewItemParentId(null);
    }
  };

  const cancelCreate = () => {
    fileManager.setNewTrackName('');
    fileManager.setNewFolderName('');
    fileManager.setIsCreating(false);
    fileManager.setIsCreatingFolder(false);
    fileManager.setNewItemParentId(null);
  };

  const getEmptySpaceContextItems = () => [
    {
      label: t('files:newTrack'),
      icon: <span>+</span>,
      onClick: () => handleTrackCreate(),
    },
    {
      label: t('files:newFolder'),
      icon: <span>📁</span>,
      onClick: () => handleFolderCreate(),
    },
    // TODO: Add more context menu items like export, import, delete all
  ];

  return (
    <div className="h-full flex flex-col bg-lineHighlight text-foreground">
      {/* Header */}
      <div className="p-3 border-b border-gray-600">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-gray-300">Files</h3>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => handleTrackCreate()}
              className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-white"
              title="New Track"
            >
              <span className="text-sm">+</span>
            </button>
            <button
              onClick={() => handleFolderCreate()}
              className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-white"
              title="New Folder"
            >
              <span className="text-sm">📁</span>
            </button>
          </div>
        </div>

        {/* Create Track Input */}
        {fileManager.isCreating && (
          <div className="mt-2">
            <input
              type="text"
              value={fileManager.newTrackName}
              onChange={(e) => fileManager.setNewTrackName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') createNewTrack();
                if (e.key === 'Escape') cancelCreate();
              }}
              placeholder="Track name..."
              className="w-full px-2 py-1 text-sm bg-gray-800 border border-gray-600 rounded text-white"
              autoFocus
            />
            <div className="flex justify-end space-x-2 mt-1">
              <button
                onClick={cancelCreate}
                className="px-2 py-1 text-xs text-gray-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={createNewTrack}
                className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                Create
              </button>
            </div>
          </div>
        )}

        {/* Create Folder Input */}
        {fileManager.isCreatingFolder && (
          <div className="mt-2">
            <input
              type="text"
              value={fileManager.newFolderName}
              onChange={(e) => fileManager.setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') createNewFolder();
                if (e.key === 'Escape') cancelCreate();
              }}
              placeholder="Folder name..."
              className="w-full px-2 py-1 text-sm bg-gray-800 border border-gray-600 rounded text-white"
              autoFocus
            />
            <div className="flex justify-end space-x-2 mt-1">
              <button
                onClick={cancelCreate}
                className="px-2 py-1 text-xs text-gray-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={createNewFolder}
                className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                Create
              </button>
            </div>
          </div>
        )}
      </div>

      {/* File Tree */}
      <GraphFileTree
        treeNodes={fileManager.treeNodes}
        selectedTrack={fileManager.selectedTrack}
        activePattern={context.activeCode}
        onTrackSelect={fileManager.loadTrack}
        onTrackRename={handleTrackRename}
        onTrackDelete={handleTrackDelete}
        onTrackDuplicate={handleTrackDuplicate}
        onTrackInfo={handleTrackInfo}
        onTrackDownload={handleTrackDownload}
        onFolderDownload={handleFolderDownload}
        onTrackCreate={handleTrackCreate}
        onFolderCreate={handleFolderCreate}
        onFolderRename={handleFolderRename}
        onFolderDelete={handleFolderDelete}
        onMoveItem={handleMoveItem}
        renamingTrack={null} // TODO: Implement rename state
        renamingFolder={null} // TODO: Implement rename state
        renameValue=""
        setRenameValue={() => {}} // TODO: Implement rename state
        onRenameFinish={() => {}} // TODO: Implement rename state
        onRenameCancel={() => {}} // TODO: Implement rename state
        emptySpaceContextItems={getEmptySpaceContextItems()}
      />

      {/* Footer */}
      <div className="p-2 border-t border-gray-600 text-xs text-gray-400">
        <div className="flex justify-between items-center">
          <span>
            {fileManager.getStats().tracks} tracks, {fileManager.getStats().folders} folders
          </span>
          {fileManager.saveStatus && (
            <span className="text-green-400">{fileManager.saveStatus}</span>
          )}
        </div>
      </div>

      {/* Modals */}
      <InfoModal
        isOpen={showInfoModal}
        onClose={() => setShowInfoModal(false)}
        title={infoModalData.title}
        items={infoModalData.items}
      />

      <ConfirmModal
        isOpen={fileManager.showDeleteModal}
        onClose={() => {
          fileManager.setShowDeleteModal(false);
          fileManager.setNodeToDelete(null);
        }}
        onConfirm={confirmDelete}
        title="Delete Item"
        message={`Are you sure you want to delete this item? This action cannot be undone.`}
        confirmText={t('common:delete')}
        cancelText={t('common:cancel')}
        variant="danger"
      />
    </div>
  );
}
