import { useState, useEffect } from 'react';
import { 
  DocumentIcon, 
  FolderIcon, 
  PlusIcon, 
  TrashIcon, 
  ArrowDownTrayIcon,
  DocumentDuplicateIcon,
  PencilIcon,
  InformationCircleIcon,
  ClipboardDocumentIcon
} from '@heroicons/react/24/outline';
import cx from '@src/cx';
import { useTranslation } from 'react-i18next';
import { WorkingContextMenu } from '../ui/WorkingContextMenu';
import { InfoModal } from '../ui/InfoModal';
import { ConfirmModal } from '../ui/ConfirmModal';
import { useToast } from '../ui/Toast';

const STORAGE_KEY = 'strudel_tracks';

interface Track {
  id: string;
  name: string;
  code: string;
  created: string;
  modified: string;
}

interface ReplContext {
  activeCode?: string;
  editorRef?: React.RefObject<{ code: string }>;
  handleUpdate: (update: { code: string }, replace?: boolean) => void;
}

interface FileManagerProps {
  context: ReplContext;
}

export function FileManager({ context }: FileManagerProps) {
  const [tracks, setTracks] = useState<Record<string, Track>>({});
  const [selectedTrack, setSelectedTrack] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [newTrackName, setNewTrackName] = useState('');
  const [saveStatus, setSaveStatus] = useState('');
  const [renamingTrack, setRenamingTrack] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [infoModalData, setInfoModalData] = useState<{ title: string; items: Array<{ label: string; value: string }> }>({ title: '', items: [] });
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [trackToDelete, setTrackToDelete] = useState<string | null>(null);
  const { t } = useTranslation('files');
  const toast = useToast();

  // Helper function for better date formatting
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - date.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    // If it's today, show time
    if (diffDays === 1) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    
    // If it's this year, show month and day
    if (date.getFullYear() === now.getFullYear()) {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
    
    // Otherwise show full date with month name
    return date.toLocaleDateString([], { 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric' 
    });
  };

  // Load tracks from localStorage on mount
  useEffect(() => {
    const savedTracks = localStorage.getItem(STORAGE_KEY);
    if (savedTracks) {
      try {
        setTracks(JSON.parse(savedTracks));
      } catch (e) {
        console.error('Failed to load tracks from localStorage:', e);
      }
    }
  }, []);

  // Save tracks to localStorage whenever tracks change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tracks));
  }, [tracks]);

  const createNewTrack = () => {
    if (!newTrackName.trim()) return;
    
    const trackId = Date.now().toString();
    const newTrack: Track = {
      id: trackId,
      name: newTrackName.trim(),
      code: '// New track\n',
      created: new Date().toISOString(),
      modified: new Date().toISOString()
    };
    
    setTracks(prev => ({ ...prev, [trackId]: newTrack }));
    setNewTrackName('');
    setIsCreating(false);
    loadTrack(newTrack);
  };

  const loadTrack = (track: Track) => {
    setSelectedTrack(track.id);
    context.handleUpdate({ code: track.code }, true);
  };

  const saveCurrentTrack = () => {
    if (!selectedTrack) return;
    
    // Get current code from the editor
    const currentCode = context.editorRef?.current?.code || context.activeCode || '';
    if (!currentCode.trim()) {
      toast.warning(t('noCodeToSave'));
      return;
    }
    
    setTracks(prev => ({
      ...prev,
      [selectedTrack]: {
        ...prev[selectedTrack],
        code: currentCode,
        modified: new Date().toISOString()
      }
    }));
    
    toast.success(t('trackSaved'));
  };

  const deleteTrack = (trackId: string) => {
    setTrackToDelete(trackId);
    setShowDeleteModal(true);
  };

  const confirmDelete = () => {
    if (trackToDelete) {
      const trackName = tracks[trackToDelete]?.name;
      setTracks(prev => {
        const newTracks = { ...prev };
        delete newTracks[trackToDelete];
        return newTracks;
      });
      if (selectedTrack === trackToDelete) {
        setSelectedTrack(null);
      }
      setTrackToDelete(null);
      toast.success(t('files.trackDeleted') || 'Track deleted successfully!');
    }
  };

  const duplicateTrack = (track: Track) => {
    const trackId = Date.now().toString();
    const duplicatedTrack: Track = {
      ...track,
      id: trackId,
      name: `${track.name} (copy)`,
      created: new Date().toISOString(),
      modified: new Date().toISOString()
    };
    
    setTracks(prev => ({ ...prev, [trackId]: duplicatedTrack }));
    toast.success(t('trackDuplicated'));
  };

  const downloadTrack = (track: Track) => {
    const blob = new Blob([track.code], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${track.name}.js`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    toast.success(t('trackDownloaded'));
  };

  const importTrack = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const code = e.target?.result as string;
      const trackId = Date.now().toString();
      const trackName = file.name.replace(/\.(js|txt)$/, '');
      
      const newTrack: Track = {
        id: trackId,
        name: trackName,
        code,
        created: new Date().toISOString(),
        modified: new Date().toISOString()
      };
      
      setTracks(prev => ({ ...prev, [trackId]: newTrack }));
      loadTrack(newTrack);
    };
    reader.readAsText(file);
    event.target.value = ''; // Reset input
  };

  const startRename = (track: Track) => {
    setRenamingTrack(track.id);
    setRenameValue(track.name);
  };

  const finishRename = () => {
    if (renamingTrack && renameValue.trim()) {
      const oldName = tracks[renamingTrack]?.name;
      setTracks(prev => ({
        ...prev,
        [renamingTrack]: {
          ...prev[renamingTrack],
          name: renameValue.trim(),
          modified: new Date().toISOString()
        }
      }));
      
      if (oldName !== renameValue.trim()) {
        toast.success(t('trackRenamed'));
      }
    }
    setRenamingTrack(null);
    setRenameValue('');
  };

  const cancelRename = () => {
    setRenamingTrack(null);
    setRenameValue('');
  };

  const exportAllTracks = () => {
    const tracksData = JSON.stringify(tracks, null, 2);
    const blob = new Blob([tracksData], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'strudel-tracks.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const trackList = Object.values(tracks).sort((a, b) => 
    new Date(b.modified).getTime() - new Date(a.modified).getTime()
  );

  // Context menu items for tracks
  const getTrackContextItems = (track: Track) => [
    {
      label: selectedTrack === track.id ? t('save') : t('load'),
      icon: selectedTrack === track.id ? <span>💾</span> : <DocumentIcon className="w-4 h-4" />,
      onClick: () => {
        if (selectedTrack === track.id) {
          saveCurrentTrack();
        } else {
          loadTrack(track);
        }
      },
    },
    { separator: true, label: '', onClick: () => {} },
    {
      label: t('rename'),
      icon: <PencilIcon className="w-4 h-4" />,
      onClick: () => startRename(track),
    },
    {
      label: t('files.duplicate') || 'Duplicate',
      icon: <DocumentDuplicateIcon className="w-4 h-4" />,
      onClick: () => duplicateTrack(track),
    },
    {
      label: t('files.copyCode') || 'Copy Code',
      icon: <ClipboardDocumentIcon className="w-4 h-4" />,
      onClick: () => {
        navigator.clipboard.writeText(track.code).then(() => {
          toast.success(t('files.codeCopied') || 'Code copied to clipboard!');
        }).catch(() => {
          toast.error(t('files.copyFailed') || 'Failed to copy code');
        });
      },
    },
    { separator: true, label: '', onClick: () => {} },
    {
      label: t('files.download') || 'Download',
      icon: <ArrowDownTrayIcon className="w-4 h-4" />,
      onClick: () => downloadTrack(track),
    },
    {
      label: t('files.info') || 'Properties',
      icon: <InformationCircleIcon className="w-4 h-4" />,
      onClick: () => {
        setInfoModalData({
          title: `${t('files.trackProperties') || 'Track Properties'} - ${track.name}`,
          items: [
            { label: t('files.name') || 'Name', value: track.name },
            { label: t('files.created') || 'Created', value: new Date(track.created).toLocaleString([], { 
              year: 'numeric', 
              month: 'long', 
              day: 'numeric', 
              hour: '2-digit', 
              minute: '2-digit' 
            }) },
            { label: t('files.modified') || 'Modified', value: new Date(track.modified).toLocaleString([], { 
              year: 'numeric', 
              month: 'long', 
              day: 'numeric', 
              hour: '2-digit', 
              minute: '2-digit' 
            }) },
            { label: t('files.linesOfCode') || 'Lines of code', value: track.code.split('\n').length.toString() },
            { label: t('files.characters') || 'Characters', value: track.code.length.toString() },
            { label: t('files.size') || 'Size', value: `${(new Blob([track.code]).size / 1024).toFixed(2)} KB` },
          ]
        });
        setShowInfoModal(true);
      },
    },
    { separator: true, label: '', onClick: () => {} },
    {
      label: t('files.delete') || 'Delete',
      icon: <TrashIcon className="w-4 h-4" />,
      onClick: () => deleteTrack(track.id),
    },
  ];

  return (
    <div className="h-full flex flex-col bg-lineHighlight text-foreground">
      {/* Header */}
      <div className="p-3 border-b border-gray-600">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold">{t('tabs.files')}</h3>
          <div className="flex space-x-1">
            <button
              onClick={() => setIsCreating(true)}
              className="p-1 hover:bg-gray-600 rounded"
              title={t('files.newTrack') || 'New track'}
            >
              <PlusIcon className="w-4 h-4" />
            </button>
            <label className="p-1 hover:bg-gray-600 rounded cursor-pointer" title={t('files.importTrack') || 'Import track'}>
              <input
                type="file"
                accept=".js,.txt"
                onChange={importTrack}
                className="hidden"
              />
              <ArrowDownTrayIcon className="w-4 h-4 rotate-180" />
            </label>
          </div>
        </div>
        
        {/* New track input */}
        {isCreating && (
          <div className="flex space-x-1">
            <input
              type="text"
              value={newTrackName}
              onChange={(e) => setNewTrackName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') createNewTrack();
                if (e.key === 'Escape') {
                  setIsCreating(false);
                  setNewTrackName('');
                }
              }}
              placeholder={t('files.trackName') || 'Track name'}
              className="flex-1 px-2 py-1 text-xs bg-background border border-gray-600 rounded"
              autoFocus
            />
            <button
              onClick={createNewTrack}
              className="px-2 py-1 text-xs bg-blue-600 hover:bg-blue-700 rounded"
            >
              {t('files.create') || 'Create'}
            </button>
          </div>
        )}
      </div>

      {/* Track list */}
      <div className="flex-1 overflow-auto">
        {trackList.length === 0 ? (
          <div className="p-4 text-center text-gray-400 text-sm">
            {t('files.noTracksYet') || 'No tracks yet. Create your first track!'}
          </div>
        ) : (
          <div className="p-2 space-y-1">
            {trackList.map((track) => (
              <WorkingContextMenu key={track.id} items={getTrackContextItems(track)}>
                <div
                  className={cx(
                    'flex items-center p-2 gap-1   rounded cursor-pointer hover:bg-gray-600',
                    selectedTrack === track.id && 'bg-selection'
                  )}
                  onClick={() => renamingTrack !== track.id && loadTrack(track)}
                >
                  <DocumentIcon className="w-4 h-4 mr-2 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    {renamingTrack === track.id ? (
                      <input
                        type="text"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') finishRename();
                          if (e.key === 'Escape') cancelRename();
                        }}
                        onBlur={finishRename}
                        className="w-full px-1 py-0 text-sm bg-background border border-gray-600 rounded"
                        autoFocus
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <div className="text-sm truncate">{track.name}</div>
                    )}
                    <div className="text-xs text-gray-400">
                      {formatDate(track.modified)}
                    </div>
                  </div>
                  {/* Clean interface - no side buttons, just context menu */}
                </div>
              </WorkingContextMenu>
            ))}
            
            {/* Help text */}
            <div className="p-2 text-xs text-gray-400 text-center border-t border-gray-600 mt-2">
              {t('files.rightClickForOptions') || 'Right-click tracks for more options'}
            </div>
          </div>
        )}
      </div>

      {/* Footer with current track info */}
      {selectedTrack && tracks[selectedTrack] && (
        <div className="p-2 border-t border-gray-600 text-xs text-gray-400">
          <div>{t('files.currentTrack') || 'Current'}: {tracks[selectedTrack].name}</div>
          <div className="flex items-center justify-between mt-1">
            <button
              onClick={saveCurrentTrack}
              className="px-2 py-1 bg-blue-600 hover:bg-blue-700 rounded text-white text-xs"
              title={t('files.saveChanges') || 'Save Changes'}
            >
              {t('files.saveChanges') || 'Save Changes'}
            </button>
            {saveStatus && (
              <span className={cx(
                'text-xs',
                saveStatus === 'Saved!' ? 'text-green-400' : 'text-yellow-400'
              )}>
                {saveStatus}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Modals */}
      <InfoModal
        isOpen={showInfoModal}
        onClose={() => setShowInfoModal(false)}
        title={infoModalData.title}
        items={infoModalData.items}
      />

      <ConfirmModal
        isOpen={showDeleteModal}
        onClose={() => {
          setShowDeleteModal(false);
          setTrackToDelete(null);
        }}
        onConfirm={confirmDelete}
        title={t('files.deleteTrack') || 'Delete Track'}
        message={`${t('files.confirmDeleteTrack') || 'Are you sure you want to delete'} "${trackToDelete ? tracks[trackToDelete]?.name : ''}"? ${t('files.actionCannotBeUndone') || 'This action cannot be undone.'}`}
        confirmText={t('common.delete') || 'Delete'}
        cancelText={t('common.cancel') || 'Cancel'}
        variant="danger"
      />

      {/* Toast notifications */}
      <toast.ToastContainer />
    </div>
  );
}