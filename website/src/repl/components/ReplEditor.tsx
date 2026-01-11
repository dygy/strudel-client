import Loader from '@src/repl/components/Loader';
import { HorizontalPanel, VerticalPanel } from '@src/repl/components/panel/Panel';
import { Code } from '@src/repl/components/Code';
import UserFacingErrorMessage from '@src/repl/components/UserFacingErrorMessage';
import { Header } from './Header';
import { useSettings } from '@src/settings';
import { ResizableSidebar } from './sidebar/ResizableSidebar';
import { FileManagerRefactored as FileManager } from './sidebar/FileManagerRefactored';
import { WelcomeScreen } from './WelcomeScreen';
import { userPattern } from '@src/user_pattern_utils';
import { useTracks } from '@src/hooks/useTracks';
import { DEFAULT_TRACK_CODE } from '@src/constants/defaultCode';
import { GlobalToastContainer } from '@src/components/GlobalToastContainer';
import { useTranslation } from '@src/i18n';
import { nanoid } from 'nanoid';
import React, { useState, useEffect } from 'react';
import { getPendingCode, clearPendingCode, getEditorInstance } from '../../stores/editorStore';

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
    tracks: any[];
    folders: any[];
  } | null;
}

function ReplEditor({ context, fileManagerHook, ssrData, ...editorProps }: ReplEditorProps) {
  const { containerRef, editorRef, error, init, pending } = context;
  const settings = useSettings();
  const { panelPosition, isZen, isFileManagerOpen } = settings;
  const { t } = useTranslation(['files']);

  // Use the tracks store instead of complex state management
  const tracks = useTracks();

  // Initialize tracks store with SSR data and coordination
  useEffect(() => {
    if (ssrData && !tracks.isInitialized) {
      console.log('🔥 ReplEditor: Initializing tracks store with SSR data and coordination');
      
      // Use the hierarchical format for tracksStore coordination
      const hierarchicalData = (ssrData as any).hierarchical || ssrData;
      
      // Use the new coordination method that includes random track selection
      tracks.initializeWithCoordination(hierarchicalData, (randomTrack) => {
        if (randomTrack) {
          console.log('🔥 ReplEditor: Random track selected:', randomTrack.name);
          
          // Update the file manager's selected track state
          if (fileManagerHook && typeof fileManagerHook === 'object' && fileManagerHook.setSelectedTrack) {
            console.log('🔥 ReplEditor: Updating file manager selected track');
            console.log('🔥 ReplEditor: Random track folder:', randomTrack.folder);
            console.log('🔥 ReplEditor: FileManager tracks count:', Object.keys(fileManagerHook.tracks || {}).length);
            
            fileManagerHook.setSelectedTrack(randomTrack.id);
            
            // Force folder expansion by dispatching a custom event
            // This will trigger any listeners that need to expand folders
            if (randomTrack.folder) {
              setTimeout(() => {
                const expandEvent = new CustomEvent('strudel-expand-folder', {
                  detail: { 
                    trackId: randomTrack.id,
                    folderPath: randomTrack.folder,
                    trackName: randomTrack.name
                  }
                });
                window.dispatchEvent(expandEvent);
                console.log('🔥 ReplEditor: Dispatched folder expansion event for:', randomTrack.folder);
              }, 100);
            }
            
            // Small delay to ensure the FileTree component processes the selectedTrack change
            // and expands the necessary folders
            setTimeout(() => {
              console.log('🔥 ReplEditor: FileTree should have expanded folders for track:', randomTrack.name);
              if (randomTrack.folder) {
                console.log('🔥 ReplEditor: Track is in folder:', randomTrack.folder);
              } else {
                console.log('🔥 ReplEditor: Track is in root folder');
              }
            }, 200);
          }
          
          // Load the random track code into the editor
          if (randomTrack.code) {
            // Method 1: Use context.editorRef
            if (context.editorRef?.current?.setCode) {
              context.editorRef.current.setCode(randomTrack.code);
            }

            // Method 2: Use stored editor instance
            if (getEditorInstance()?.setCode) {
              getEditorInstance().setCode(randomTrack.code);
            }

            // Method 3: Direct CodeMirror manipulation as fallback
            setTimeout(() => {
              const cmEditor = document.querySelector('.cm-editor');
              if (cmEditor) {
                const cmView = (cmEditor as any).cmView || getEditorInstance()?.editor;
                if (cmView && cmView.dispatch) {
                  const changes = { from: 0, to: cmView.state.doc.length, insert: randomTrack.code };
                  cmView.dispatch({ changes });
                }
              }
            }, 100);
          }
        } else {
          console.log('🔥 ReplEditor: No random track selected (no tracks available)');
        }
      });
    } else if (!ssrData && !tracks.isInitialized) {
      console.log('🔥 ReplEditor: No SSR data, initializing empty store');
      tracks.initializeWithSSR(null);
    }
  }, [ssrData, tracks.isInitialized]);

  // CRITICAL: Only initialize state once and prevent re-renders
  const [codeComponentKey] = useState(() => Math.random().toString(36));
  const [showWelcomeDelayed, setShowWelcomeDelayed] = useState(false);

  // Delay showing welcome screen to give time for authentication and track loading
  useEffect(() => {
    const timer = setTimeout(() => {
      setShowWelcomeDelayed(true);
    }, 2000); // Wait 2 seconds before showing welcome screen

    return () => clearTimeout(timer);
  }, []);

  // Welcome screen logic - only show after delay and when we're sure there are no tracks
  const shouldShowWelcome = showWelcomeDelayed && tracks.isInitialized && !tracks.hasTracks && !tracks.isLoading;

  useEffect(() => {
    // Listen for when tracks are imported
    const handleTracksImported = async () => {
      console.log('🔥 ReplEditor: Tracks imported, refreshing store');
      if (fileManagerHook?.isAuthenticated) {
        await tracks.loadFromAPI();
      }
    };

    // Listen for track loading events
    const handleTrackLoaded = (event: CustomEvent) => {
      console.log('ReplEditor - track loaded event received:', event.detail);
      const { trackId, code } = event.detail;

      // AGGRESSIVE: Ensure the editor shows the loaded code using multiple methods
      if (code) {
        console.log('ReplEditor - setting loaded track code in editor');

        // Method 1: Use context.editorRef
        if (context.editorRef?.current?.setCode) {
          context.editorRef.current.setCode(code);
          context.editorRef.current.code = code;
        }

        // Method 2: Use stored editor instance
        if (getEditorInstance()?.setCode && code) {
          console.log('ReplEditor - setting code via stored editor instance');
          getEditorInstance().setCode(code);
        }

        // Method 3: Direct CodeMirror manipulation
        setTimeout(() => {
          const cmEditor = document.querySelector('.cm-editor');
          if (cmEditor) {
            const cmView = (cmEditor as any).cmView || getEditorInstance()?.editor;
            if (cmView && cmView.dispatch) {
              console.log('ReplEditor - dispatching CodeMirror changes directly');
              const changes = { from: 0, to: cmView.state.doc.length, insert: code };
              cmView.dispatch({ changes });
            }
          }
        }, 50);
      }
    };

    // Listen for editor ready events
    const handleEditorReady = (event: CustomEvent) => {
      console.log('ReplEditor - editor ready event received:', event.detail);
      const { activePattern } = event.detail;

      // Check if there's pending code to load
      const pendingCode = getPendingCode();
      if (pendingCode && context.editorRef?.current?.setCode) {
        console.log('ReplEditor - setting pending code in editor:', pendingCode.substring(0, 50) + '...');
        context.editorRef.current.setCode(pendingCode);
        clearPendingCode(); // Clear it
      }
    };

    window.addEventListener('strudel-tracks-imported', handleTracksImported);
    window.addEventListener('strudel-track-loaded', handleTrackLoaded as EventListener);
    window.addEventListener('strudel-editor-ready', handleEditorReady as EventListener);

    return () => {
      window.removeEventListener('strudel-tracks-imported', handleTracksImported);
      window.removeEventListener('strudel-track-loaded', handleTrackLoaded as EventListener);
      window.removeEventListener('strudel-editor-ready', handleEditorReady as EventListener);
    };
  }, [tracks, fileManagerHook?.isAuthenticated]);

  const handleCreateTrack = async () => {
    // For authenticated users, use the FileManager's direct track creation
    if (fileManagerHook && typeof fileManagerHook === 'object') {
      console.log('handleCreateTrack - using FileManager direct track creation');

      try {
        const newTrack = await fileManagerHook.createTrack(
          `Track ${nanoid().substring(0, 8)}`,
          DEFAULT_TRACK_CODE,
          undefined, // folder
          false, // isMultitrack
          undefined, // steps
          undefined // activeStep
        );

        if (newTrack) {
          console.log('handleCreateTrack - track created successfully in Supabase:', newTrack.id);

          // Refresh store after creation
          await tracks.loadFromAPI();

          // Load the newly created track
          fileManagerHook.loadTrack(newTrack);

          return;
        }
      } catch (error) {
        console.error('handleCreateTrack - failed to create track in Supabase:', error);
        // Fall through to local creation
      }
    }

    // For unauthenticated users or if Supabase creation fails
    console.log('handleCreateTrack - track created but not persisted for unauthenticated users');

    // Also create in user pattern system for consistency
    const newTrackId = nanoid();
    const newPattern = userPattern.update(newTrackId, { code: DEFAULT_TRACK_CODE });

    // Add to store
    tracks.addTrack({
      id: newTrackId,
      name: `Track ${nanoid().substring(0, 8)}`,
      code: DEFAULT_TRACK_CODE,
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      folder: null,
      isMultitrack: false,
      steps: [],
      activeStep: 0,
      user_id: 'local',
    });

    // Defer the editor update until after the component re-renders and shows the editor
    // Don't reset since that might cause issues with uninitialized editor
    setTimeout(() => {
      context.handleUpdate(newPattern.data, false);
    }, 100);
  };

  const handleImportTracks = () => {
    // For authenticated users, this will be handled by the Supabase FileManager
    // For unauthenticated users, show a message that they need to sign in
    console.log('handleImportTracks - import not available for unauthenticated users');

    // Trigger the file manager's import functionality if available
    const importInput = document.getElementById('file-import-input') as HTMLInputElement;
    if (importInput) {
      importInput.click();
    }
  };

  return (
    <div className="h-full flex flex-col relative" {...editorProps}>
      <Loader active={pending} />
      <Header context={context} />
      <div className="grow flex relative overflow-hidden">
        {!isZen && isFileManagerOpen && (
          <ResizableSidebar defaultWidth={300} minWidth={200} maxWidth={500}>
            <FileManager context={context} fileManagerHook={fileManagerHook} />
          </ResizableSidebar>
        )}
        {shouldShowWelcome ? (
          <WelcomeScreen
            onCreateTrack={handleCreateTrack}
            onImportTracks={handleImportTracks}
          />
        ) : tracks.isLoading ? (
          <div className="h-full w-full flex items-center justify-center">
            <div className="text-center">
              <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
              <p className="text-lg text-gray-600 mb-2">{t('files:loadingTracks')}</p>
              <p className="text-sm text-gray-500">{t('files:loadingTracksDescription')}</p>
            </div>
          </div>
        ) : (
          <>
            <Code key={codeComponentKey} containerRef={containerRef} editorRef={editorRef} init={init} />
          </>
        )}
        {!isZen && panelPosition === 'right' && <VerticalPanel context={context} />}
      </div>
      <UserFacingErrorMessage error={error} />
      {!isZen && panelPosition === 'bottom' && <HorizontalPanel context={context} />}

      {/* Global Toast Container */}
      <GlobalToastContainer />

      {/* Global Tooltip - Temporarily disabled for cleaner UX */}
      {/* <GlobalTooltip /> */}
    </div>
  );
}

export default React.memo(ReplEditor);
