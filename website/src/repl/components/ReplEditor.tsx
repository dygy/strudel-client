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
import { useState, useEffect, memo, useRef } from 'react';
import { getPendingCode, clearPendingCode, getEditorInstance, setPendingCode } from '../../stores/editorStore';
import { globalSaveManager } from '../globalSaveManager';

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
  readOnly?: boolean;
  mixer?: any; // AudioMixer instance for dual-stream support
}

function ReplEditor({ context, fileManagerHook, ssrData, readOnly = false, mixer, ...editorProps }: ReplEditorProps) {
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

      const hierarchicalData = (ssrData as any).hierarchical 
        ? { 
            ...ssrData, 
            children: (ssrData as any).hierarchical.children 
          }
        : ssrData;

      tracks.initializeWithCoordination(hierarchicalData, (selectedTrack) => {
        if (selectedTrack) {
          console.log('🔥 ReplEditor: Track selected:', selectedTrack.name, 'ID:', selectedTrack.id);

          if (fileManagerHook && typeof fileManagerHook === 'object' && fileManagerHook.setSelectedTrack) {
            fileManagerHook.setSelectedTrack(selectedTrack.id);

            if (selectedTrack.folder) {
              setTimeout(() => {
                const expandEvent = new CustomEvent('strudel-expand-folder', {
                  detail: {
                    trackId: selectedTrack.id,
                    folderPath: selectedTrack.folder,
                    trackName: selectedTrack.name
                  }
                });
                window.dispatchEvent(expandEvent);
              }, 100);
            }
          }

          // Set code immediately
          if (selectedTrack.code) {
            setPendingCode(selectedTrack.code);
            
            if (context.editorRef?.current?.setCode) {
              context.editorRef.current.setCode(selectedTrack.code);
            }

            if (getEditorInstance()?.setCode) {
              getEditorInstance().setCode(selectedTrack.code);
            }

            setTimeout(() => {
              const cmEditor = document.querySelector('.cm-editor');
              if (cmEditor) {
                const cmView = (cmEditor as any).cmView || getEditorInstance()?.editor;
                if (cmView && cmView.dispatch) {
                  const changes = { from: 0, to: cmView.state.doc.length, insert: selectedTrack.code };
                  cmView.dispatch({ changes });
                }
              }
            }, 100);
          }
        }
      });
    } else if (!ssrData && !tracks.isInitialized) {
      console.log('🔥 ReplEditor: No SSR data, initializing empty store');
      tracks.initializeWithSSR(null);
    }
  }, [ssrData, tracks.isInitialized]);

  // CRITICAL: Only initialize state once and prevent re-renders
  const [codeComponentKey] = useState(() => Math.random().toString(36));

  // Welcome screen logic - only show when we're sure there are no tracks
  // Show welcome screen when:
  // 1. Tracks are initialized (not loading initial data)
  // 2. There are no tracks
  // 3. Not currently loading
  const shouldShowWelcome = tracks.isInitialized && !tracks.hasTracks && !tracks.isLoading;

  useEffect(() => {
    // Listen for when tracks are imported
    const handleTracksImported = async () => {
      console.log('🔥 ReplEditor: Tracks imported, refreshing store');
      if (fileManagerHook?.isAuthenticated) {
        await tracks.loadFromAPI();
        
        // After loading, auto-select the first track if none is selected
        setTimeout(() => {
          const tracksArray = Object.values(fileManagerHook.tracks || {});
          if (tracksArray.length > 0 && !fileManagerHook.selectedTrack) {
            console.log('🔥 ReplEditor: Auto-selecting first track after import');
            const firstTrack = tracksArray[0];
            fileManagerHook.loadTrack(firstTrack);
          }
        }, 200);
      }
    };

    // Listen for track loading events
    const handleTrackLoaded = (event: CustomEvent) => {
      console.log('ReplEditor - track loaded event received:', event.detail);
      const { code } = event.detail;

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

  // CRITICAL: Register with global save manager to prevent data loss on page unload
  // Use refs to prevent unnecessary re-registrations
  const fileManagerRef = useRef(fileManagerHook);
  const contextRef = useRef(context);
  
  useEffect(() => {
    fileManagerRef.current = fileManagerHook;
    contextRef.current = context;
  }, [fileManagerHook, context]);

  useEffect(() => {
    if (fileManagerRef.current && contextRef.current) {
      console.log('ReplEditor: Registering with global save manager');
      globalSaveManager.register(fileManagerRef.current, contextRef.current);

      return () => {
        console.log('ReplEditor: Unregistering from global save manager');
        globalSaveManager.unregister();
      };
    }
  }, []); // Empty dependency array to register only once

  // Handle smooth track navigation without page reloads
  useEffect(() => {
    const handleSmoothNavigation = (event: CustomEvent) => {
      const { track, url } = event.detail;
      console.log('ReplEditor: Smooth navigation to track:', track.name, 'URL:', url);
      
      // Note: Track is already loaded by handleTrackSelect, no need to load again
      // Just update the document title
      if (!document.title.includes(track.name)) {
        document.title = `Strudel REPL - ${track.name}`;
      }
    };

    // Listen for smooth navigation events
    window.addEventListener('strudel-navigate-track', handleSmoothNavigation as EventListener);

    // Handle browser back/forward buttons with smooth navigation
    const handlePopState = () => {
      console.log('ReplEditor: Browser navigation detected, URL:', window.location.pathname);
      
      // Parse the current URL to find the track
      const currentPath = window.location.pathname;
      
      if (currentPath === '/repl') {
        // Navigated to main repl page
        console.log('ReplEditor: Navigated to main repl page');
        document.title = 'Strudel REPL';
        
        // Clear selection if needed
        if (fileManagerHook && typeof fileManagerHook === 'object' && fileManagerHook.setSelectedTrack) {
          fileManagerHook.setSelectedTrack(null);
        }
        
        return;
      }
      
      // Try to find the track from the URL path
      if (fileManagerHook && typeof fileManagerHook === 'object' && fileManagerHook.tracks) {
        const tracks = Object.values(fileManagerHook.tracks);
        
        // Parse the URL path to extract folder and track info
        const pathMatch = currentPath.match(/^\/repl\/(.+)$/);
        if (pathMatch) {
          const fullPath = pathMatch[1];
          const segments = fullPath.split('/');
          const trackSlug = segments.pop();
          const folderPath = segments.length > 0 ? segments.join('/') : null;
          
          // Find the track by folder and slug
          const track = tracks.find((t: any) => {
            const trackMatches = t.name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') === trackSlug;
            const folderMatches = (t.folder || null) === folderPath;
            return trackMatches && folderMatches;
          });
          
          if (track) {
            console.log('ReplEditor: Found track for browser navigation:', (track as any).name);
            fileManagerHook.loadTrack(track);
            document.title = `Strudel REPL - ${(track as any).name}`;
            return;
          }
        }
      }
      
      // If we can't find the track, stay on current page
      console.log('ReplEditor: Could not find track for URL, staying on current page');
    };

    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('strudel-navigate-track', handleSmoothNavigation as EventListener);
      window.removeEventListener('popstate', handlePopState);
    };
  }, [fileManagerHook]);

  // Update context with file manager hook for emergency save
  useEffect(() => {
    if (context && fileManagerHook) {
      // Store file manager hook in context for emergency save access
      (context as any).fileManagerHook = fileManagerHook;
    }
  }, [context, fileManagerHook]);

  return (
    <div className="h-full flex flex-col relative" {...editorProps}>
      <Loader active={pending} />
      <Header context={context} />
      
      <div className="grow flex relative overflow-hidden">
        {!isZen && isFileManagerOpen && (
          <ResizableSidebar defaultWidth={300} minWidth={200} maxWidth={500}>
            <FileManager context={context} fileManagerHook={fileManagerHook} readOnly={readOnly} />
          </ResizableSidebar>
        )}
        {shouldShowWelcome ? (
          <WelcomeScreen
            onCreateTrack={handleCreateTrack}
            onImportTracks={handleImportTracks}
          />
        ) : (
          <div className="flex-1 relative transition-all duration-200 flex flex-col overflow-hidden">
            <Code key={codeComponentKey} containerRef={containerRef} editorRef={editorRef} init={init} />
          </div>
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

export default memo(ReplEditor);
