import React, { useState, useEffect } from 'react';
import {
  ArrowDownTrayIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  DocumentIcon,
  FolderIcon,
  FolderOpenIcon,
  InformationCircleIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { useTranslation } from '@src/i18n';
import { WorkingContextMenu } from '../ui/WorkingContextMenu';
import { BurgerMenuButton } from '../ui/BurgerMenuButton';
import { tooltipActions } from '@src/stores/tooltipStore';

interface ContextMenuItem {
  label: string
  icon?: JSX.Element
  onClick: () => void
  separator?: false
}

interface Separator  { separator: true, label: string, onClick: () => void }

interface Track {
  id: string;
  name: string;
  code: string;
  created: string;
  modified: string;
  folder?: string;
  isMultitrack?: boolean;
  steps?: TrackStep[];
  activeStep?: number;
}

interface TrackStep {
  id: string;
  name: string;
  code: string;
  created: string;
  modified: string;
}

interface Folder {
  id: string;
  name: string;
  path: string;
  parent?: string;
  created: string;
}

interface TreeNode {
  id: string;
  name: string;
  type: 'folder' | 'track';
  path?: string;
  children?: TreeNode[];
  data?: Track | Folder;
}

interface FileTreeProps {
  tracks: Record<string, Track>;
  folders: Record<string, Folder>;
  selectedTrack: string | null; // Track opened for editing
  activePattern: string; // Track currently playing
  onTrackSelect: (track: Track) => void;
  onTrackRename: (trackId: string) => void;
  onTrackDelete: (trackId: string) => void;
  onTrackDuplicate: (track: Track) => void;
  onTrackInfo: (track: Track) => void;
  onTrackDownload: (track: Track) => void;
  onFolderDownload: (folderPath: string) => void;
  onTrackCreate: (parentPath?: string) => void;
  onFolderCreate: (parentPath?: string) => void;
  onFolderRename: (folderPath: string) => void;
  onFolderDelete: (folderPath: string) => void;
  onMoveItem: (itemId: string, itemType: 'track' | 'folder', targetPath: string) => void;
  renamingTrack: string | null;
  renamingFolder: string | null;
  renameValue: string;
  setRenameValue: (value: string) => void;
  onRenameFinish: () => void;
  onRenameCancel: () => void;
  emptySpaceContextItems: Array<ContextMenuItem | Separator>;
  onConvertToMultitrack: (track: Track) => void;
  onAddStep: (trackId: string) => void;
  onSwitchStep: (trackId: string, stepIndex: number) => void;
  onRenameStep: (trackId: string, stepIndex: number) => void;
  onDeleteStep: (trackId: string, stepIndex: number) => void;
  renamingStep: { trackId: string; stepIndex: number } | null;
  onRenameStepFinish: () => void;
  onRenameStepCancel: () => void;
}

export function FileTree({
  tracks,
  folders,
  selectedTrack,
  activePattern,
  onTrackSelect,
  onTrackRename,
  onTrackDelete,
  onTrackDuplicate,
  onTrackInfo,
  onTrackDownload,
  onFolderDownload,
  onTrackCreate,
  onFolderCreate,
  onFolderRename,
  onFolderDelete,
  onMoveItem,
  renamingTrack,
  renamingFolder,
  renameValue,
  setRenameValue,
  onRenameFinish,
  onRenameCancel,
  emptySpaceContextItems,
  onConvertToMultitrack,
  onAddStep,
  onSwitchStep,
  onRenameStep,
  onDeleteStep,
  renamingStep,
  onRenameStepFinish,
  onRenameStepCancel,
}: FileTreeProps) {
  const { t } = useTranslation(['files', 'common']);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['root'])); // Root is expanded by default
  const [draggedItem, setDraggedItem] = useState<{ id: string; type: 'track' | 'folder' } | null>(null);
  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null);

  // Auto-expand parent directories when a track is selected
  React.useEffect(() => {
    if (selectedTrack && tracks[selectedTrack]) {
      const track = tracks[selectedTrack];
      if (track.folder) {
        expandParentDirectories(track.folder);
      }
    }
  }, [selectedTrack, tracks, folders]);

  // Function to expand all parent directories for a given folder path
  const expandParentDirectories = (folderPath: string) => {
    const pathsToExpand = new Set<string>();

    // Find folder by path and get its UUID chain
    const findFolderByPath = (path: string) => {
      return Object.values(folders).find(f => f.path === path);
    };

    const folder = findFolderByPath(folderPath);
    if (folder) {
      // Add this folder's UUID
      pathsToExpand.add(folder.id);

      // Walk up the parent chain using UUIDs
      let currentFolder = folder;
      while (currentFolder && currentFolder.parent) {
        pathsToExpand.add(currentFolder.parent);
        currentFolder = folders[currentFolder.parent];
      }
    }

    // Add root folder
    pathsToExpand.add('root');

    // Update expanded folders state
    setExpandedFolders(prev => {
      const newSet = new Set(prev);
      pathsToExpand.forEach(id => newSet.add(id));
      return newSet;
    });
  };

  // Build proper tree structure
  const buildTree = (): TreeNode[] => {
    const tree: TreeNode[] = [];
    const folderNodesById: Record<string, TreeNode> = {};

    // Step 1: Create all folder nodes and index them by UUID only
    Object.values(folders).forEach(folder => {
      // CRITICAL: Validate folder data to prevent corruption
      let folderPath: string;
      if (typeof folder.path === 'string' && folder.path.trim()) {
        folderPath = folder.path.trim();
      } else if (typeof folder.name === 'string' && folder.name.trim()) {
        folderPath = folder.name.trim();
        console.warn('FileTree - buildTree: Using folder.name as path fallback for folder:', folder.id, folder.name);
      } else {
        folderPath = folder.id;
        console.error('FileTree - buildTree: Both folder.path and folder.name are corrupted, using folder.id:', {
          folderId: folder.id,
          corruptedPath: folder.path,
          pathType: typeof folder.path,
          corruptedName: folder.name,
          nameType: typeof folder.name
        });
      }

      const node: TreeNode = {
        id: folder.id,
        name: folder.name || 'Unnamed Folder',
        type: 'folder',
        path: folderPath,
        children: [],
        data: {
          ...folder,
          path: folderPath // Ensure the data object has clean path
        },
      };

      folderNodesById[folder.id] = node;
    });

    // Step 2: Build folder hierarchy using UUIDs for parent-child relationships
    Object.values(folders).forEach(folder => {
      const node = folderNodesById[folder.id];

      if (folder.parent) {
        // Try to find parent by UUID first
        let parentNode = folderNodesById[folder.parent];

        if (!parentNode) {
          // Fallback: try to find parent by path (for backward compatibility)
          parentNode = Object.values(folderNodesById).find(f => f.path === folder.parent);

          if (parentNode) {
            console.log(`FileTree - buildTree: Found parent by path fallback: "${folder.parent}" -> UUID: ${parentNode.id}`);
          } else {
            console.warn(`FileTree - buildTree: Parent not found for folder "${folder.name}" (${folder.id}), parent reference: "${folder.parent}"`);
          }
        }

        if (parentNode) {
          // This folder has a parent - add it to parent's children
          parentNode.children!.push(node);
        } else {
          // Parent not found - add to tree root
          tree.push(node);
        }
      } else {
        // This is a root folder - add to tree root
        tree.push(node);
      }
    });

    // Step 3: Add tracks to their folders using UUIDs first, then paths as fallback
    Object.values(tracks).forEach(track => {
      const trackNode: TreeNode = {
        id: track.id,
        name: track.name,
        type: 'track',
        data: track,
      };

      // Try to find folder by UUID first (if track.folder is a UUID)
      let targetFolder = folderNodesById[track.folder || ''];

      if (!targetFolder && track.folder) {
        // Fallback: find folder by path (for backward compatibility)
        // CRITICAL FIX: Find the most specific path match, prioritizing root-level folders
        const candidateFolders = Object.values(folderNodesById).filter(f => f.path === track.folder);

        if (candidateFolders.length === 1) {
          // Only one match - use it
          targetFolder = candidateFolders[0];
        } else if (candidateFolders.length > 1) {
          // Multiple matches - prioritize root-level folders (shorter paths)
          targetFolder = candidateFolders.reduce((best, current) => {
            const bestDepth = (best.path?.split('/') || []).length;
            const currentDepth = (current.path?.split('/') || []).length;
            return currentDepth < bestDepth ? current : best;
          });

          console.warn(`FileTree - buildTree: Multiple folders found for path "${track.folder}", using root-level folder:`, targetFolder.id, targetFolder.path);
        }
      }

      if (targetFolder) {
        // Track belongs to a folder
        targetFolder.children!.push(trackNode);
      } else {
        // Track is at root level
        tree.push(trackNode);

        if (track.folder) {
          console.warn(`FileTree - buildTree: Folder not found for track "${track.name}", folder reference: "${track.folder}", placing in root`);
        }
      }
    });

    // Step 4: Sort everything (folders first, then alphabetically)
    const sortTree = (nodes: TreeNode[]) => {
      nodes.sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === 'folder' ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });

      nodes.forEach(node => {
        if (node.children && node.children.length > 0) {
          sortTree(node.children);
        }
      });
    };

    sortTree(tree);
    console.log({tree})
    return tree;
  };

  const toggleFolder = (folderId: string) => {
    setExpandedFolders(prev => {
      const newSet = new Set(prev);
      if (newSet.has(folderId)) {
        newSet.delete(folderId);
      } else {
        newSet.add(folderId);
      }
      return newSet;
    });
  };

  const handleDragStart = (e: React.DragEvent, item: TreeNode) => {
    setDraggedItem({ id: item.id, type: item.type });
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, targetNode?: TreeNode) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    if (targetNode) {
      // Only allow dropping on folders or tracks (which will use their parent folder)
      if (targetNode.type === 'folder' || targetNode.type === 'track') {
        setDragOverTarget(targetNode.id);
      }
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    // Only clear drag over if we're actually leaving the element
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;

    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      setDragOverTarget(null);
    }
  };

  const handleDrop = (e: React.DragEvent, targetNode: TreeNode) => {
    e.preventDefault();
    setDragOverTarget(null);

    if (!draggedItem || draggedItem.id === targetNode.id) {
      console.log('handleDrop: Invalid drop - same item or no dragged item');
      return;
    }

    // Determine the target based on the target node type
    let targetId: string;

    if (targetNode.type === 'folder') {
      // Dropping onto a folder - use the folder's UUID
      targetId = targetNode.id;
      console.log('handleDrop: Dropping onto folder', { targetNodeId: targetNode.id, targetId });
    } else {
      // Dropping onto a track - use the track's parent folder UUID (if any)
      const track = targetNode.data as Track;
      if (track.folder) {
        // Try to find the folder by path first, then by UUID
        const targetFolder = Object.values(folders).find(f => f.path === track.folder) ||
                             Object.values(folders).find(f => f.id === track.folder);
        targetId = targetFolder?.id || '';
        console.log('handleDrop: Dropping onto track', { trackFolder: track.folder, targetFolder, targetId });
      } else {
        targetId = ''; // Root level
        console.log('handleDrop: Dropping onto root level track');
      }
    }

    console.log('handleDrop: Calling onMoveItem', {
      draggedItemId: draggedItem.id,
      draggedItemType: draggedItem.type,
      targetId,
      availableFolders: Object.keys(folders)
    });

    onMoveItem(draggedItem.id, draggedItem.type, targetId);
    setDraggedItem(null);
  };

  const getTrackContextItems = (track: Track) => {

    const baseItems: (ContextMenuItem | Separator)[] = [
      {
        label: t('files:load'),
        icon: <DocumentIcon className="w-4 h-4" />,
        onClick: () => onTrackSelect(track),
      },
      {
        label: t('files:rename'),
        icon: <PencilIcon className="w-4 h-4" />,
        onClick: () => onTrackRename(track.id),
      },
      {
        label: t('files:duplicate'),
        icon: <DocumentIcon className="w-4 h-4" />,
        onClick: () => onTrackDuplicate(track),
      },
    ];

    // Add multitrack-specific options
    if (track.isMultitrack) {
      baseItems.push(
        { separator: true, label: '', onClick: () => {} },
        {
          label: t('files:addStep'),
          icon: <PlusIcon className="w-4 h-4" />,
          onClick: () => onAddStep(track.id),
        }
      );
    } else {
      baseItems.push(
        { separator: true, label: '', onClick: () => {} },
        {
          label: t('files:convertToMultitrack'),
          icon: <DocumentIcon className="w-4 h-4" />,
          onClick: () => onConvertToMultitrack(track),
        }
      );
    }

    baseItems.push(
      { separator: true, label: '', onClick: () => {} },
      {
        label: t('files:download'),
        icon: <ArrowDownTrayIcon className="w-4 h-4" />,
        onClick: () => onTrackDownload(track),
      },
      {
        label: t('files:info'),
        icon: <InformationCircleIcon className="w-4 h-4" />,
        onClick: () => onTrackInfo(track),
      },
      { separator: true, label: '', onClick: () => {} },
      {
        label: t('files:delete'),
        icon: <TrashIcon className="w-4 h-4" />,
        onClick: () => onTrackDelete(track.id),
      }
    );

    return baseItems;
  };

  const getFolderContextItems = (folder: Folder) => {
    // CRITICAL: Validate folder.path to prevent corrupted data usage
    let folderPath: string;
    if (typeof folder.path === 'string' && folder.path.trim()) {
      folderPath = folder.path.trim();
    } else if (typeof folder.name === 'string' && folder.name.trim()) {
      // Fallback to folder.name if path is corrupted
      folderPath = folder.name.trim();
      console.warn('FileTree - folder.path is corrupted, using folder.name as fallback:', {
        folderId: folder.id,
        folderName: folder.name,
        corruptedPath: folder.path,
        pathType: typeof folder.path
      });
    } else {
      // Both path and name are corrupted - use folder ID as last resort
      folderPath = folder.id;
      console.error('FileTree - both folder.path and folder.name are corrupted, using folder.id:', {
        folderId: folder.id,
        corruptedPath: folder.path,
        corruptedName: folder.name
      });
    }

    return [
    {
      label: t('files:newTrack'),
      icon: <PlusIcon className="w-4 h-4" />,
      onClick: () => onTrackCreate(folderPath),
    },
    {
      label: t('files:newFolder'),
      icon: <FolderIcon className="w-4 h-4" />,
      onClick: () => onFolderCreate(folderPath),
    },
    { separator: true, label: '', onClick: () => {} },
    {
      label: t('files:downloadFolder'),
      icon: <ArrowDownTrayIcon className="w-4 h-4" />,
      onClick: () => onFolderDownload(folderPath),
    },
    {
      label: t('files:rename'),
      icon: <PencilIcon className="w-4 h-4" />,
      onClick: () => onFolderRename(folderPath),
    },
    {
      label: t('files:delete'),
      icon: <TrashIcon className="w-4 h-4" />,
      onClick: () => onFolderDelete(folderPath),
    },
  ];
  };

  const getStepContextItems = (trackId: string, stepIndex: number, step: TrackStep) => [
    {
      label: t('files:load'),
      icon: <DocumentIcon className="w-4 h-4" />,
      onClick: () => onSwitchStep(trackId, stepIndex),
    },
    {
      label: t('files:rename'),
      icon: <PencilIcon className="w-4 h-4" />,
      onClick: () => onRenameStep(trackId, stepIndex),
    },
    { separator: true, label: '', onClick: () => {} },
    {
      label: t('files:delete'),
      icon: <TrashIcon className="w-4 h-4" />,
      onClick: () => onDeleteStep(trackId, stepIndex),
    },
  ];

  const renderNode = (node: TreeNode, depth: number = 0): React.ReactNode => {
    const isExpanded = expandedFolders.has(node.id); // Use node ID for expansion state
    const hasChildren = node.children && node.children.length > 0;
    const hasSteps = node.type === 'track' && (node.data as Track).isMultitrack && (node.data as Track).steps && (node.data as Track).steps!.length > 0;
    const isSelected = node.type === 'track' && selectedTrack === node.id; // Opened for editing
    const isPlaying = node.type === 'track' && activePattern === node.id; // Currently playing

    const isRenaming = (node.type === 'track' && renamingTrack === node.id) ||
                      (node.type === 'folder' && renamingFolder === node.path);

    // Create tooltip props manually for tracks without using hooks
    const getTooltipProps = () => {
      if (node.type !== 'track' || isRenaming) {
        return {};
      }

      const track = node.data as Track;
      return {
        onMouseEnter: (event: React.MouseEvent) => {
          const rect = event.currentTarget.getBoundingClientRect();
          tooltipActions.show({
            id: `track-${track.id}`,
            content: React.createElement('div', null,
              React.createElement('div', { className: 'font-medium' }, track.name),
              track.modified && React.createElement('div', { className: 'text-xs opacity-75 mt-1' },
                `Modified: ${new Date(track.modified).toLocaleDateString()}`
              )
            ),
            position: {
              x: rect.left + rect.width / 2,
              y: rect.top,
            },
            type: 'info',
            delay: 300,
          });
        },
        onMouseLeave: () => {
          tooltipActions.hide();
        },
      };
    };

    return (
      <div key={node.id}>
        <WorkingContextMenu
          items={node.type === 'track'
            ? getTrackContextItems(node.data as Track)
            : getFolderContextItems(node.data as Folder)
          }
        >
          <div
            className={`group flex items-center py-1 px-2 cursor-pointer ${
              isSelected ? 'bg-selection' : // Opened for editing (blue background)
              isPlaying ? 'bg-green-600/30 border-l-2 border-green-500' : // Currently playing (green accent)
              'hover:bg-gray-600' // Default hover
            } ${draggedItem?.id === node.id ? 'opacity-50' : ''} ${
              dragOverTarget === node.id ? 'bg-blue-600/30 border-2 border-blue-400 border-dashed' : ''
            }`}
            style={{ paddingLeft: `${depth * 16 + 8}px` }}
            draggable={!isRenaming}
            onDragStart={(e) => handleDragStart(e, node)}
            onDragOver={(e) => handleDragOver(e, node)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, node)}
            {...getTooltipProps()}
            onClick={() => {
              if (node.type === 'folder') {
                toggleFolder(node.id); // Use node ID instead of path
              } else if (node.type === 'track' && !isRenaming) {
                if ((node.data as Track).isMultitrack && hasSteps) {
                  toggleFolder(node.id); // Use track ID for multitrack expansion
                }
                onTrackSelect(node.data as Track);
              }
            }}
          >
            {/* Expand/collapse icon for folders and multitrack */}
            {(node.type === 'folder' || (node.type === 'track' && hasSteps)) && (
              <div className="w-4 h-4 me-1 flex items-center justify-center ">
                {(hasChildren || hasSteps) ? (
                  isExpanded ? (
                    <ChevronDownIcon className="w-3 h-3" />
                  ) : (
                    <ChevronRightIcon className="w-3 h-3" />
                  )
                ) : null}
              </div>
            )}

            {/* Icon */}
            <div className="w-4 h-4 flex-shrink-0 me-1">
              {node.type === 'folder' ? (
                isExpanded ? (
                  <FolderOpenIcon className="w-4 h-4 text-yellow-400" />
                ) : (
                  <FolderIcon className="w-4 h-4 text-yellow-400" />
                )
              ) : (
                <DocumentIcon className="w-4 h-4 text-blue-400" />
              )}
            </div>

            {/* Name or rename input */}
            <div className="flex-1 min-w-0">
              {isRenaming ? (
                <input
                  type="text"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      onRenameFinish();
                    }
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      onRenameCancel();
                    }
                  }}
                  onBlur={(e) => {
                    // Only finish rename if the input still has the same value and wasn't cancelled
                    if (e.target.value.trim()) {
                      onRenameFinish();
                    } else {
                      onRenameCancel();
                    }
                  }}
                  className="w-full px-1 py-0 text-sm bg-background border border-gray-600 rounded"
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <div className="flex items-center justify-between w-full">
                  <div className="flex items-center space-x-2 flex-1 min-w-0">
                    <span className="text-sm truncate">{node.name}</span>
                    {node.type === 'track' && (node.data as Track).isMultitrack && (
                      <span className="text-xs bg-purple-600 text-white px-1 rounded">
                        M
                      </span>
                    )}
                  </div>
                  {/* Burger menu button */}
                  <div className="ml-2">
                    <BurgerMenuButton
                      items={node.type === 'track'
                        ? getTrackContextItems(node.data as Track)
                        : getFolderContextItems(node.data as Folder)
                      }
                      size="sm"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </WorkingContextMenu>

        {/* Render multitrack steps */}
        {node.type === 'track' && (node.data as Track).isMultitrack && isExpanded && (node.data as Track).steps && (
          <div>
            {(node.data as Track).steps!.map((step, stepIndex) => {
              const isRenamingThisStep = renamingStep?.trackId === node.id && renamingStep?.stepIndex === stepIndex;

              return (
                <WorkingContextMenu
                  key={step.id}
                  items={getStepContextItems(node.id, stepIndex, step)}
                >
                  <div
                    className={`group flex items-center py-1 px-2 hover:bg-gray-600 cursor-pointer ${
                      (node.data as Track).activeStep === stepIndex ? 'bg-purple-700/30' : ''
                    }`}
                    style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }}
                    onClick={() => !isRenamingThisStep && onSwitchStep(node.id, stepIndex)}
                  >
                    <div className="w-4 h-4 mr-2 flex-shrink-0">
                      <div className="w-2 h-2 bg-purple-400 rounded-full mx-auto"></div>
                    </div>

                    {/* Step name or rename input */}
                    <div className="flex-1 min-w-0">
                      {isRenamingThisStep ? (
                        <input
                          type="text"
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              onRenameStepFinish();
                            }
                            if (e.key === 'Escape') {
                              e.preventDefault();
                              onRenameStepCancel();
                            }
                          }}
                          onBlur={(e) => {
                            // Only finish rename if the input still has the same value and wasn't cancelled
                            if (e.target.value.trim()) {
                              onRenameStepFinish();
                            } else {
                              onRenameStepCancel();
                            }
                          }}
                          className="w-full px-1 py-0 text-xs bg-background border border-gray-600 rounded"
                          autoFocus
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <div className="flex items-center justify-between w-full">
                          <span className="text-xs truncate">{step.name}</span>
                          <div className="flex items-center gap-1">
                            {(node.data as Track).activeStep === stepIndex && (
                              <span className="text-xs text-purple-400">●</span>
                            )}
                            {/* Burger menu button for steps */}
                            <div className="ml-1">
                              <BurgerMenuButton
                                items={getStepContextItems(node.id, stepIndex, step)}
                                size="sm"
                              />
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </WorkingContextMenu>
              );
            })}
          </div>
        )}

        {/* Render children */}
        {node.type === 'folder' && isExpanded && node.children && (
          <div>
            {node.children.map(child => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  const tree = buildTree();

  return (
    <div className="flex-1 overflow-auto min-h-0 h-full">
      {tree.length === 0 ? (
        <WorkingContextMenu items={emptySpaceContextItems}>
          <div className="p-4 text-center text-gray-400 text-sm h-full flex flex-col justify-center">
            {t('files:noTracksYet')}
            <div className="mt-2 text-xs">
              {t('files:rightClickToCreate')}
            </div>
          </div>
        </WorkingContextMenu>
      ) : (
        <div className="py-2 min-h-full flex flex-col">
          <div>
            {tree.map(node => renderNode(node))}
          </div>
          {/* Flexible empty space for context menu that fills remaining height */}
          <WorkingContextMenu items={emptySpaceContextItems}>
            <div
              className={`flex-1 h-full ${
                dragOverTarget === 'root' ? 'bg-blue-600/20 border-2 border-blue-400 border-dashed' : ''
              }`}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                setDragOverTarget('root');
              }}
              onDragLeave={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const x = e.clientX;
                const y = e.clientY;

                if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
                  setDragOverTarget(null);
                }
              }}
              onDrop={(e) => {
                e.preventDefault();
                setDragOverTarget(null);

                if (draggedItem) {
                  onMoveItem(draggedItem.id, draggedItem.type, ''); // Empty string for root
                  setDraggedItem(null);
                }
              }}
            ></div>
          </WorkingContextMenu>
        </div>
      )}
    </div>
  );
}
