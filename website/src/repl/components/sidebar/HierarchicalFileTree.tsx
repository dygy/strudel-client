/**
 * HierarchicalFileTree Component
 * Renders a hierarchical file tree with proper folder/track nesting
 */

import React, { useState } from 'react';
import { useHierarchicalFileTree } from './hooks/useHierarchicalFileTree';
import type { TreeItem } from '../../../lib/TreeDataTransformer';

interface HierarchicalFileTreeProps {
  tracks: Record<string, any>;
  folders: Record<string, any>;
  onTrackSelect?: (trackId: string) => void;
  onFolderSelect?: (folderId: string) => void;
  selectedTrackId?: string | null;
  className?: string;
}

interface TreeNodeProps {
  item: TreeItem;
  level: number;
  onTrackSelect?: (trackId: string) => void;
  onFolderSelect?: (folderId: string) => void;
  selectedTrackId?: string | null;
}

const TreeNode: React.FC<TreeNodeProps> = ({
  item,
  level,
  onTrackSelect,
  onFolderSelect,
  selectedTrackId
}) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const hasChildren = item.children && item.children.length > 0;
  const isSelected = item.type === 'track' && item.id === selectedTrackId;

  const handleClick = () => {
    if (item.type === 'folder') {
      setIsExpanded(!isExpanded);
      onFolderSelect?.(item.id);
    } else {
      onTrackSelect?.(item.id);
    }
  };

  const getIcon = () => {
    if (item.type === 'folder') {
      return isExpanded ? '📂' : '📁';
    } else {
      return item.isMultitrack ? '🎵' : '🎶';
    }
  };

  return (
    <div className="tree-node">
      <div
        className={`tree-node-content ${isSelected ? 'selected' : ''}`}
        style={{ 
          paddingLeft: `${level * 20}px`,
          cursor: 'pointer',
          padding: '4px 8px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          backgroundColor: isSelected ? '#e3f2fd' : 'transparent',
          borderRadius: '4px',
          margin: '1px 0'
        }}
        onClick={handleClick}
      >
        <span style={{ minWidth: '16px' }}>
          {getIcon()}
        </span>
        <span style={{ flex: 1 }}>
          {item.name}
        </span>
        {item.type === 'track' && item.isMultitrack && (
          <span style={{ 
            fontSize: '12px', 
            color: '#666',
            backgroundColor: '#f0f0f0',
            padding: '2px 6px',
            borderRadius: '10px'
          }}>
            {item.steps?.length || 0} steps
          </span>
        )}
        {item.type === 'folder' && hasChildren && (
          <span style={{ fontSize: '12px', color: '#666' }}>
            ({item.children!.length})
          </span>
        )}
      </div>
      
      {item.type === 'folder' && hasChildren && isExpanded && (
        <div className="tree-node-children">
          {item.children!.map((child) => (
            <TreeNode
              key={child.id}
              item={child}
              level={level + 1}
              onTrackSelect={onTrackSelect}
              onFolderSelect={onFolderSelect}
              selectedTrackId={selectedTrackId}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export const HierarchicalFileTree: React.FC<HierarchicalFileTreeProps> = ({
  tracks,
  folders,
  onTrackSelect,
  onFolderSelect,
  selectedTrackId,
  className = ''
}) => {
  const { tree, rootItems, getTreeStats } = useHierarchicalFileTree({
    tracks,
    folders
  });

  const stats = getTreeStats();

  return (
    <div className={`hierarchical-file-tree ${className}`}>
      <div className="tree-header" style={{ 
        padding: '8px',
        borderBottom: '1px solid #eee',
        fontSize: '12px',
        color: '#666'
      }}>
        {stats.totalFolders} folders, {stats.totalTracks} tracks
      </div>
      
      <div className="tree-content" style={{ padding: '8px' }}>
        {rootItems.map((item) => (
          <TreeNode
            key={item.id}
            item={item}
            level={0}
            onTrackSelect={onTrackSelect}
            onFolderSelect={onFolderSelect}
            selectedTrackId={selectedTrackId}
          />
        ))}
        
        {rootItems.length === 0 && (
          <div style={{ 
            textAlign: 'center', 
            color: '#999', 
            padding: '20px',
            fontStyle: 'italic'
          }}>
            No files or folders
          </div>
        )}
      </div>
    </div>
  );
};

export default HierarchicalFileTree;