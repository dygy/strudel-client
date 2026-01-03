import React, { useState, useCallback } from 'react';
import type {TreeNode, Track} from '@src/lib/FileSystemGraph.ts';

interface GraphFileTreeProps {
  treeNodes: TreeNode[];
  selectedTrack: string | null;
  activePattern?: string;
  onTrackSelect: (track: Track) => void;
  onTrackRename: (trackId: string) => void;
  onTrackDelete: (trackId: string) => void;
  onTrackDuplicate: (trackId: string) => void;
  onTrackInfo: (track: Track) => void;
  onTrackDownload: (trackId: string) => void;
  onFolderDownload: (folderId: string) => void;
  onTrackCreate: (parentId?: string) => void;
  onFolderCreate: (parentId?: string) => void;
  onFolderRename: (folderId: string) => void;
  onFolderDelete: (folderId: string) => void;
  onMoveItem: (itemId: string, targetFolderId: string | null) => void;
  renamingTrack: string | null;
  renamingFolder: string | null;
  renameValue: string;
  setRenameValue: (value: string) => void;
  onRenameFinish: () => void;
  onRenameCancel: () => void;
  emptySpaceContextItems: Array<{
    label: string;
    icon: React.ReactNode;
    onClick: () => void;
    className?: string;
  }>;
  onConvertToMultitrack?: (trackId: string) => void;
  onAddStep?: (trackId: string) => void;
  onSwitchStep?: (trackId: string, stepIndex: number) => void;
  onRenameStep?: (trackId: string, stepIndex: number) => void;
  onDeleteStep?: (trackId: string, stepIndex: number) => void;
  renamingStep?: { trackId: string; stepIndex: number } | null;
  onRenameStepFinish?: () => void;
  onRenameStepCancel?: () => void;
}

export function GraphFileTree({
  treeNodes,
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
}: GraphFileTreeProps) {
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    items: Array<{
      label: string;
      icon: React.ReactNode;
      onClick: () => void;
      className?: string;
    }>;
  } | null>(null);

  const toggleFolder = useCallback((folderId: string) => {
    setExpandedFolders(prev => {
      const newSet = new Set(prev);
      if (newSet.has(folderId)) {
        newSet.delete(folderId);
      } else {
        newSet.add(folderId);
      }
      return newSet;
    });
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent, node?: TreeNode) => {
    e.preventDefault();
    e.stopPropagation();

    const rect = e.currentTarget.getBoundingClientRect();
    let items: Array<{
      label: string;
      icon: React.ReactNode;
      onClick: () => void;
      className?: string;
    }> = [];

    if (node) {
      if (node.type === 'track') {
        const track = node.data as Track;
        items = [
          {
            label: 'Rename',
            icon: <span>✏️</span>,
            onClick: () => {
              onTrackRename(node.id);
              setContextMenu(null);
            },
          },
          {
            label: 'Duplicate',
            icon: <span>📋</span>,
            onClick: () => {
              onTrackDuplicate(node.id);
              setContextMenu(null);
            },
          },
          {
            label: 'Download',
            icon: <span>💾</span>,
            onClick: () => {
              onTrackDownload(node.id);
              setContextMenu(null);
            },
          },
          {
            label: 'Info',
            icon: <span>ℹ️</span>,
            onClick: () => {
              onTrackInfo(track);
              setContextMenu(null);
            },
          },
          ...(track.isMultitrack && onAddStep ? [
            {
              label: 'Add Step',
              icon: <span>➕</span>,
              onClick: () => {
                onAddStep(node.id);
                setContextMenu(null);
              },
            }
          ] : []),
          ...(onConvertToMultitrack && !track.isMultitrack ? [
            {
              label: 'Convert to Multitrack',
              icon: <span>🔄</span>,
              onClick: () => {
                onConvertToMultitrack(node.id);
                setContextMenu(null);
              },
            }
          ] : []),
          {
            label: 'Delete',
            icon: <span>🗑️</span>,
            onClick: () => {
              onTrackDelete(node.id);
              setContextMenu(null);
            },
            className: 'text-red-400 hover:text-red-300',
          },
        ];
      } else if (node.type === 'folder') {
        items = [
          {
            label: 'New Track',
            icon: <span>+</span>,
            onClick: () => {
              onTrackCreate(node.id);
              setContextMenu(null);
            },
          },
          {
            label: 'New Folder',
            icon: <span>📁</span>,
            onClick: () => {
              onFolderCreate(node.id);
              setContextMenu(null);
            },
          },
          {
            label: 'Rename',
            icon: <span>✏️</span>,
            onClick: () => {
              onFolderRename(node.id);
              setContextMenu(null);
            },
          },
          {
            label: 'Download',
            icon: <span>💾</span>,
            onClick: () => {
              onFolderDownload(node.id);
              setContextMenu(null);
            },
          },
          {
            label: 'Delete',
            icon: <span>🗑️</span>,
            onClick: () => {
              onFolderDelete(node.id);
              setContextMenu(null);
            },
            className: 'text-red-400 hover:text-red-300',
          },
        ];
      }
    } else {
      // Empty space context menu
      items = emptySpaceContextItems;
    }

    setContextMenu({
      x: rect.left,
      y: rect.bottom,
      items,
    });
  }, [
    onTrackRename,
    onTrackDuplicate,
    onTrackDownload,
    onTrackInfo,
    onTrackDelete,
    onTrackCreate,
    onFolderCreate,
    onFolderRename,
    onFolderDownload,
    onFolderDelete,
    onConvertToMultitrack,
    onAddStep,
    emptySpaceContextItems,
  ]);

  const renderNode = useCallback((node: TreeNode, depth: number = 0): React.ReactNode => {
    const isExpanded = expandedFolders.has(node.id);
    const isSelected = selectedTrack === node.id;
    const isActive = activePattern === node.id;

    if (node.type === 'folder') {
      return (
        <div key={node.id} className="select-none">
          <div
            className={`flex items-center py-1 px-2 hover:bg-gray-700 cursor-pointer ${
              isSelected ? 'bg-blue-600' : ''
            }`}
            style={{ paddingLeft: `${depth * 16 + 8}px` }}
            onClick={() => toggleFolder(node.id)}
            onContextMenu={(e) => handleContextMenu(e, node)}
          >
            <span className="mr-2 text-xs">
              {isExpanded ? '📂' : '📁'}
            </span>
            {renamingFolder === node.id ? (
              <input
                type="text"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={onRenameFinish}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onRenameFinish();
                  if (e.key === 'Escape') onRenameCancel();
                }}
                className="bg-gray-800 text-white px-1 py-0 text-sm border border-gray-600 rounded flex-1"
                autoFocus
              />
            ) : (
              <span className="text-sm text-gray-300 flex-1">{node.name}</span>
            )}
          </div>
          {isExpanded && node.children && (
            <div>
              {node.children.map(child => renderNode(child, depth + 1))}
            </div>
          )}
        </div>
      );
    } else if (node.type === 'track') {
      const track = node.data as Track;
      return (
        <div key={node.id} className="select-none">
          <div
            className={`flex items-center py-1 px-2 hover:bg-gray-700 cursor-pointer ${
              isSelected ? 'bg-blue-600' : isActive ? 'bg-green-600' : ''
            }`}
            style={{ paddingLeft: `${depth * 16 + 8}px` }}
            onClick={() => onTrackSelect(track)}
            onContextMenu={(e) => handleContextMenu(e, node)}
          >
            <span className="mr-2 text-xs">
              {track.isMultitrack ? '🎵' : '📄'}
            </span>
            {renamingTrack === node.id ? (
              <input
                type="text"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={onRenameFinish}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onRenameFinish();
                  if (e.key === 'Escape') onRenameCancel();
                }}
                className="bg-gray-800 text-white px-1 py-0 text-sm border border-gray-600 rounded flex-1"
                autoFocus
              />
            ) : (
              <span className="text-sm text-white flex-1">{node.name}</span>
            )}
          </div>

          {/* Render multitrack steps */}
          {track.isMultitrack && track.steps && isExpanded && (
            <div>
              {track.steps.map((step, stepIndex) => (
                <div
                  key={`${node.id}-step-${stepIndex}`}
                  className={`flex items-center py-1 px-2 hover:bg-gray-700 cursor-pointer ${
                    track.activeStep === stepIndex ? 'bg-yellow-600' : ''
                  }`}
                  style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }}
                  onClick={() => onSwitchStep?.(node.id, stepIndex)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    // TODO: Add step context menu
                  }}
                >
                  <span className="mr-2 text-xs">🎼</span>
                  {renamingStep?.trackId === node.id && renamingStep?.stepIndex === stepIndex ? (
                    <input
                      type="text"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={onRenameStepFinish}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') onRenameStepFinish?.();
                        if (e.key === 'Escape') onRenameStepCancel?.();
                      }}
                      className="bg-gray-800 text-white px-1 py-0 text-sm border border-gray-600 rounded flex-1"
                      autoFocus
                    />
                  ) : (
                    <span className="text-sm text-gray-300 flex-1">{step.name}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      );
    }

    return null;
  }, [
    expandedFolders,
    selectedTrack,
    activePattern,
    renamingTrack,
    renamingFolder,
    renamingStep,
    renameValue,
    setRenameValue,
    onRenameFinish,
    onRenameCancel,
    onRenameStepFinish,
    onRenameStepCancel,
    onTrackSelect,
    onSwitchStep,
    toggleFolder,
    handleContextMenu,
  ]);

  return (
    <div
      className="flex-1 overflow-y-auto"
      onContextMenu={(e) => handleContextMenu(e)}
      onClick={() => setContextMenu(null)}
    >
      {treeNodes.length === 0 ? (
        <div className="p-4 text-center text-gray-400">
          <p>No files yet</p>
          <p className="text-sm mt-2">Right-click to create your first track or folder</p>
        </div>
      ) : (
        <div>
          {treeNodes.map(node => renderNode(node))}
        </div>
      )}

      {/* Context Menu */}
      {contextMenu && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setContextMenu(null)}
          />
          <div
            className="fixed z-50 bg-gray-800 border border-gray-600 rounded shadow-lg py-1 min-w-48"
            style={{
              left: contextMenu.x,
              top: contextMenu.y,
            }}
          >
            {contextMenu.items.map((item, index) => (
              <button
                key={index}
                className={`w-full text-left px-3 py-2 hover:bg-gray-700 flex items-center text-sm ${
                  item.className || 'text-white'
                }`}
                onClick={item.onClick}
              >
                <span className="mr-2">{item.icon}</span>
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
