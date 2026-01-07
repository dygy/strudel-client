import React, { useState, useEffect, useCallback } from 'react';
import Loader from '@src/repl/components/Loader';
import { HorizontalPanel, VerticalPanel } from '@src/repl/components/panel/Panel';
import { Code } from '@src/repl/components/Code';
import UserFacingErrorMessage from '@src/repl/components/UserFacingErrorMessage';
import { Header } from './Header';
import { useSettings } from '@src/settings';
import { ResizableSidebar } from './sidebar/ResizableSidebar';
import { FileManagerRefactored as FileManager } from './sidebar/FileManagerRefactored';
import { WelcomeScreen } from './WelcomeScreen';
import { useActivePattern, userPattern } from '@src/user_pattern_utils';
import { useTracks } from '@src/hooks/useTracks';
import { DEFAULT_TRACK_CODE } from '@src/constants/defaultCode';
import { nanoid } from 'nanoid';

interface ReplContext {
  containerRef: React.RefObject<HTMLDivElement>;
  editorRef: React.RefObject<any>;
  error?: Error | null;
  init: () => void;
  pending?: boolean;
  started?: boolean;
  isDirty?: boolean;
  activeCode?: string;
  handleTogglePlay: () => void;
  handleEvaluate: () => void;
  handleShuffle: () => void;
  handleShare: () => void;
  handleUpdate: (data: any, reset?: boolean) => void;
}

interface ReplEditorProps extends React.HTMLAttributes<HTMLDivElement> {
  context: ReplContext;
  fileManagerHook?: any; // Optional Supabase file manager hook
  ssrData?: {
    id: string;
    name: string;
    type: 'folder';
    children?: any[];
  } | null;
}

function ReplEditorClean({ context, fileManagerHook, ssrData, ...editorProps }: ReplEditorProps) {
  const { containerRef, editorRef, error, init, pending } = context;
  const settings = useSettings();
  const { panelPosition, isZen, isFileManagerOpen } = settings;

  // Use the tracks store
  const tracks = useTracks();

  // Initialize tracks store with SSR data
  useEffect(() => {
    if (ssrData && !tracks.isInitialized) {
      console.log('🔥 ReplEditor: Initializing tracks store with SSR data');
      tracks.initializeWithSSR(ssrData);
    } else if (!ssrData && !tracks.isInitialized) {
      console.log('🔥 ReplEditor: No SSR data, initializing empty store');
      tracks.initializeWithSSR(null);
    }
  }, [ssrData, tracks.isInitialized]);

  // Listen for import events and refresh store
  useEffect(() => {
    const handleTracksImported = async () => {
      console.log('🔥 ReplEditor: Tracks imported, refreshing store');
      if (fileManagerHook?.isAuthenticated) {
        await tracks.loadFromAPI();
      }
    };

    window.addEventListener('strudel-tracks-imported', handleTracksImported);
    return () => window.removeEventListener('strudel-tracks-imported', handleTracksImported);
  }, [tracks, fileManagerHook?.isAuthenticated]);

  // CRITICAL: Only initialize state once and prevent re-renders
  const [codeComponentKey] = useState(() => Math.random().toString(36));

  // Simple welcome screen logic using tracks store
  const shouldShowWelcome = tracks.isInitialized && !tracks.hasTracks && !tracks.isLoading;

  const handleCreateTrack = useCallback(async (trackName?: string) => {
    const name = trackName || 'New Track';

    if (fileManagerHook?.createTrack) {
      console.log('ReplEditor - creating track via Supabase:', name);
      await fileManagerHook.createTrack(name, DEFAULT_TRACK_CODE);

      // Refresh store after creation
      await tracks.loadFromAPI();
    } else {
      // Fallback for unauthenticated users
      console.log('ReplEditor - creating track locally:', name);
      const newTrackId = nanoid();
      const newPattern = userPattern.update(newTrackId, { code: DEFAULT_TRACK_CODE });

      // Add to store
      tracks.addTrack({
        id: newTrackId,
        name,
        code: DEFAULT_TRACK_CODE,
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
        folder: null,
        isMultitrack: false,
        steps: [],
        activeStep: 0,
        user_id: 'local',
      });
    }
  }, [fileManagerHook, tracks]);

  const handleImportTracks = useCallback(() => {
    // Trigger the file manager's import functionality if available
    const importInput = document.getElementById('file-import-input') as HTMLInputElement;
    if (importInput) {
      importInput.click();
    }
  }, []);

  if (error) {
    return <UserFacingErrorMessage error={error} />;
  }

  if (pending) {
    return <Loader active={pending} />;
  }

  const sidebarContent = (
    <FileManager
      context={context}
      fileManagerHook={fileManagerHook}
    />
  );

  const mainContent = shouldShowWelcome ? (
    <WelcomeScreen
      onCreateTrack={handleCreateTrack}
      onImportTracks={handleImportTracks}
    />
  ) : (
    <Code key={codeComponentKey} containerRef={containerRef} editorRef={editorRef} init={init} />
  );

  console.log('🔥 ReplEditor: Rendering', shouldShowWelcome ? 'WelcomeScreen' : 'Code component');

  if (isZen) {
    return (
      <div className="h-full flex flex-col" {...editorProps}>
        <Header context={context} />
        <div className="flex-1 overflow-hidden">
          {mainContent}
        </div>
      </div>
    );
  }

  if (panelPosition === 'bottom') {
    return (
      <div className="h-full flex flex-col" {...editorProps}>
        <Header context={context} />
        <div className="flex-1 overflow-hidden">
          <div className="flex h-full">
            {isFileManagerOpen && (
              <ResizableSidebar>
                {sidebarContent}
              </ResizableSidebar>
            )}
            <div className="flex-1 overflow-hidden">
              {mainContent}
            </div>
          </div>
        </div>
        <HorizontalPanel context={context} />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col" {...editorProps}>
      <Header context={context} />
      <div className="flex-1 overflow-hidden">
        <div className="flex h-full">
          {isFileManagerOpen && (
            <ResizableSidebar>
              {sidebarContent}
            </ResizableSidebar>
          )}
          <div className="flex-1 overflow-hidden">
            {mainContent}
          </div>
          <VerticalPanel context={context} />
        </div>
      </div>
    </div>
  );
}

export default ReplEditorClean;
