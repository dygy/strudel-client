import React, { useState } from 'react';
import {
  ChevronRightIcon,
  ChevronDownIcon,
  FolderIcon,
  FolderOpenIcon,
  DocumentIcon,
  PlusIcon,
  PencilIcon,
  TrashIcon,
  InformationCircleIcon,
  ArrowDownTrayIcon,
} from '@heroicons/react/24/outline';
import { useTranslation } from '@src/i18n';
import { WorkingContextMenu } from '../ui/WorkingContextMenu';

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
  selectedTrack: string | null;
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
  emptySpaceContextItems: Array<{ label: string; icon?: React.ReactNode; onClick: () => void; separator?: boolean }>;
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
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set([''])); // Root is expanded by default
  const [draggedItem, setDraggedItem] = useState<{ id: string; type: 'track' | 'folder' } | null>(null);

  // Build tree structure
  const buildTree = (): TreeNode[] => {
    const tree: TreeNode[] = [];
    const folderNodes: Record<string, TreeNode> = {};

    // Create folder nodes
    Object.values(folders).forEach(folder => {
      const node: TreeNode = {
        id: folder.path,
        name: folder.name,
        type: 'folder',
        path: folder.path,
        children: [],
        data: folder,
      };
      folderNodes[folder.path] = node;
    });

    // Build folder hierarchy
    Object.values(folders).forEach(folder => {
      const node = folderNodes[folder.path];
      if (folder.parent && folderNodes[folder.parent]) {
        folderNodes[folder.parent].children!.push(node);
      } else {
        tree.push(node);
      }
    });

    // Add tracks to appropriate folders
    Object.values(tracks).forEach(track => {
      const trackNode: TreeNode = {
        id: track.id,
        name: track.name,
        type: 'track',
        data: track,
      };

      if (track.folder && folderNodes[track.folder]) {
        folderNodes[track.folder].children!.push(trackNode);
      } else {
        tree.push(trackNode);
      }
    });

    // Sort children (folders first, then tracks, both alphabetically)
    const sortChildren = (nodes: TreeNode[]) => {
      nodes.sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === 'folder' ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });
      nodes.forEach(node => {
        if (node.children) {
          sortChildren(node.children);
        }
      });
    };

    sortChildren(tree);
    return tree;
  };

  const toggleFolder = (path: string) => {
    setExpandedFolders(prev => {
      const newSet = new Set(prev);
      if (newSet.has(path)) {
        newSet.delete(path);
      } else {
        newSet.add(path);
      }
      return newSet;
    });
  };

  const handleDragStart = (e: React.DragEvent, item: TreeNode) => {
    setDraggedItem({ id: item.id, type: item.type });
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, targetNode: TreeNode) => {
    e.preventDefault();
    if (!draggedItem || draggedItem.id === targetNode.id) return;

    const targetPath = targetNode.type === 'folder' ? targetNode.path! : 
                     (targetNode.data as Track).folder || '';

    onMoveItem(draggedItem.id, draggedItem.type, targetPath);
    setDraggedItem(null);
  };

  const getTrackContextItems = (track: Track) => {
    const baseItems = [
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

  const getFolderContextItems = (folder: Folder) => [
    {
      label: t('files:newTrack'),
      icon: <PlusIcon className="w-4 h-4" />,
      onClick: () => onTrackCreate(folder.path),
    },
    {
      label: t('files:newFolder'),
      icon: <FolderIcon className="w-4 h-4" />,
      onClick: () => onFolderCreate(folder.path),
    },
    { separator: true, label: '', onClick: () => {} },
    {
      label: t('files:downloadFolder'),
      icon: <ArrowDownTrayIcon className="w-4 h-4" />,
      onClick: () => onFolderDownload(folder.path),
    },
    {
      label: t('files:rename'),
      icon: <PencilIcon className="w-4 h-4" />,
      onClick: () => onFolderRename(folder.path),
    },
    {
      label: t('files:delete'),
      icon: <TrashIcon className="w-4 h-4" />,
      onClick: () => onFolderDelete(folder.path),
    },
  ];

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
    const isExpanded = expandedFolders.has(node.path || node.id);
    const hasChildren = node.children && node.children.length > 0;
    const hasSteps = node.type === 'track' && (node.data as Track).isMultitrack && (node.data as Track).steps && (node.data as Track).steps!.length > 0;
    const isSelected = node.type === 'track' && selectedTrack === node.id;
    const isRenaming = (node.type === 'track' && renamingTrack === node.id) ||
                      (node.type === 'folder' && renamingFolder === node.path);

    return (
      <div key={node.id}>
        <WorkingContextMenu
          items={node.type === 'track' 
            ? getTrackContextItems(node.data as Track)
            : getFolderContextItems(node.data as Folder)
          }
        >
          <div
            className={`flex items-center py-1 px-2 hover:bg-gray-600 cursor-pointer ${
              isSelected ? 'bg-selection' : ''
            } ${draggedItem?.id === node.id ? 'opacity-50' : ''}`}
            style={{ paddingLeft: `${depth * 16 + 8}px` }}
            draggable={!isRenaming}
            onDragStart={(e) => handleDragStart(e, node)}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, node)}
            onClick={() => {
              if (node.type === 'folder') {
                toggleFolder(node.path!);
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
              <div className="w-4 h-4 mr-1 flex items-center justify-center">
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
            <div className="w-4 h-4 mr-2 flex-shrink-0">
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
                <div className="flex items-center space-x-2">
                  <span className="text-sm truncate">{node.name}</span>
                  {node.type === 'track' && (node.data as Track).isMultitrack && (
                    <span className="text-xs bg-purple-600 text-white px-1 rounded">
                      M
                    </span>
                  )}
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
                    className={`flex items-center py-1 px-2 hover:bg-gray-600 cursor-pointer ${
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
                        <span className="text-xs truncate">{step.name}</span>
                      )}
                    </div>
                    
                    {(node.data as Track).activeStep === stepIndex && (
                      <span className="text-xs text-purple-400 ml-1">●</span>
                    )}
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
            <div className="flex-1 min-h-[200px]"></div>
          </WorkingContextMenu>
        </div>
      )}
    </div>
  );
}