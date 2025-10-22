import { Fragment, useEffect } from 'react';
import React, { useMemo, useState } from 'react';
import { isAudioFile, readDir, dir, playFile } from '../../files';
import { logger } from '@strudel/core';
import { WorkingContextMenu } from '../ui/WorkingContextMenu';
import { InfoModal } from '../ui/InfoModal';
import { useToast } from '../ui/Toast';
import { 
  PlayIcon, 
  CopyIcon, 
  FolderIcon, 
  FileIcon, 
  CodeIcon, 
  InfoIcon,
  DownloadIcon 
} from '../ui/FileIcons';
import { useTranslation } from '@src/i18n';
import { BurgerMenuButton } from '../ui/BurgerMenuButton';

interface FileEntry {
  name: string;
  children?: FileEntry[];
}

interface PathEntry {
  name: string;
  children: FileEntry[];
}

export function FilesTab() {
  const [path, setPath] = useState<PathEntry[]>([]);
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [infoModalData, setInfoModalData] = useState<{ title: string; items: Array<{ label: string; value: string }> }>({ title: '', items: [] });
  const { t } = useTranslation('files');
  const toast = useToast();
  
  useEffect(() => {
    let init = false;
    readDir('', { dir, recursive: true })
      .then((children: FileEntry[]) => setPath([{ name: '~/music', children }]))
      .catch((err) => {
        logger('Error loading files from filesystem', 'error');
        console.error(err);
      });
    return () => {
      init = true;
    };
  }, []);

  const current = useMemo(() => path[path.length - 1], [path]);
  
  const subpath = useMemo(
    () =>
      path
        .slice(1)
        .map((p) => p.name)
        .join('/'),
    [path],
  );
  
  const folders = useMemo(() => current?.children.filter((e) => !!e.children), [current]);
  const files = useMemo(() => current?.children.filter((e) => !e.children && isAudioFile(e.name)), [current]);
  
  const select = (e: FileEntry) => setPath((p) => p.concat([e as PathEntry]));

  // Helper functions for context menu actions
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      toast.success(t('pathCopied'));
      logger(`Copied "${text}" to clipboard`, 'success');
    }).catch(() => {
      toast.error(t('copyFailed'));
      logger('Failed to copy to clipboard', 'error');
    });
  };

  const getFileInfo = (fileName: string, isFolder: boolean) => {
    const fullPath = subpath ? `${subpath}/${fileName}` : fileName;
    
    const items = isFolder 
      ? [
          { label: t('type'), value: t('folder') },
          { label: t('name'), value: fileName },
          { label: t('path'), value: fullPath },
        ]
      : [
          { label: t('type'), value: t('audioFile') },
          { label: t('name'), value: fileName },
          { label: t('path'), value: fullPath },
          { label: t('extension'), value: fileName.split('.').pop()?.toUpperCase() || t('unknown') },
        ];

    setInfoModalData({
      title: `${isFolder ? t('folderProperties') : t('fileProperties')}`,
      items
    });
    setShowInfoModal(true);
  };

  const generateSampleCode = (fileName: string) => {
    const sampleName = fileName.replace(/\.[^/.]+$/, ''); // Remove extension
    return `s("${sampleName}")`;
  };

  // Context menu items for folders
  const getFolderContextItems = (folder: FileEntry) => [
    {
      label: t('openFolder'),
      icon: <FolderIcon />,
      onClick: () => select(folder),
    },
    {
      label: t('copyPath'),
      icon: <CopyIcon />,
      onClick: () => copyToClipboard(subpath ? `${subpath}/${folder.name}` : folder.name),
    },
    {
      label: t('copySampleCode'),
      icon: <CodeIcon />,
      onClick: () => copyToClipboard(`samples("${subpath ? `${subpath}/${folder.name}` : folder.name}")`),
    },
    { separator: true, label: '', onClick: () => {} },
    {
      label: t('info'),
      icon: <InfoIcon />,
      onClick: () => getFileInfo(folder.name, true),
    },
  ];

  // Context menu items for files
  const getFileContextItems = (file: FileEntry) => [
    {
      label: t('playFile'),
      icon: <PlayIcon />,
      onClick: () => playFile(`${subpath}/${file.name}`),
    },
    {
      label: t('copyPath'),
      icon: <CopyIcon />,
      onClick: () => copyToClipboard(subpath ? `${subpath}/${file.name}` : file.name),
    },
    {
      label: t('copySampleCode'),
      icon: <CodeIcon />,
      onClick: () => copyToClipboard(generateSampleCode(file.name)),
    },
    { separator: true, label: '', onClick: () => {} },
    {
      label: t('info'),
      icon: <InfoIcon />,
      onClick: () => getFileInfo(file.name, false),
    },
  ];
  
  return (
    <div className="px-4 flex flex-col h-full">
      <div className="flex justify-between font-mono pb-1">
        <div>
          <span>{`samples('`}</span>
          {path?.map((p, i) => {
            if (i < path.length - 1) {
              return (
                <Fragment key={i}>
                  <span className="cursor-pointer underline" onClick={() => setPath((p) => p.slice(0, i + 1))}>
                    {p.name}
                  </span>
                  <span>/</span>
                </Fragment>
              );
            } else {
              return (
                <span className="cursor-pointer underline" key={i}>
                  {p.name}
                </span>
              );
            }
          })}
          <span>{`')`}</span>
        </div>
      </div>
      <div className="overflow-auto">
        {!folders?.length && !files?.length && (
          <span className="text-foreground/50">{t('empty')}</span>
        )}
        
        {/* Folders with context menu */}
        {folders?.map((folder, i) => (
          <WorkingContextMenu key={`folder-${i}`} items={getFolderContextItems(folder)}>
            <div 
              className="group cursor-pointer hover:bg-lineHighlight px-2 py-1 rounded flex items-center justify-between transition-colors"
              onClick={() => select(folder)}
            >
              <div className="flex items-center gap-2">
                <FolderIcon />
                <span>{folder.name}</span>
              </div>
              <div>
                <BurgerMenuButton
                  items={getFolderContextItems(folder)}
                  size="sm"
                />
              </div>
            </div>
          </WorkingContextMenu>
        ))}
        
        {/* Files with context menu */}
        {files?.map((file, i) => (
          <WorkingContextMenu key={`file-${i}`} items={getFileContextItems(file)}>
            <div
              className="group text-foreground/70 cursor-pointer hover:bg-lineHighlight px-2 py-1 rounded flex items-center justify-between transition-colors select-none"
              onClick={async () => playFile(`${subpath}/${file.name}`)}
            >
              <div className="flex items-center gap-2">
                <FileIcon />
                <span>{file.name}</span>
              </div>
              <div>
                <BurgerMenuButton
                  items={getFileContextItems(file)}
                  size="sm"
                />
              </div>
            </div>
          </WorkingContextMenu>
        ))}
      </div>
      
      {/* Help text */}
      <div className="mt-2 pt-2 border-t border-lineHighlight text-xs text-foreground/50">
        <p>{t('helpText')}</p>
      </div>

      {/* Modals */}
      <InfoModal
        isOpen={showInfoModal}
        onClose={() => setShowInfoModal(false)}
        title={infoModalData.title}
        items={infoModalData.items}
      />

      {/* Toast notifications */}
      <toast.ToastContainer />
    </div>
  );
}