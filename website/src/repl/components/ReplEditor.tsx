import Loader from '@src/repl/components/Loader';
import { HorizontalPanel, VerticalPanel } from '@src/repl/components/panel/Panel';
import { Code } from '@src/repl/components/Code';
import UserFacingErrorMessage from '@src/repl/components/UserFacingErrorMessage';
import { Header } from './Header';
import { useSettings } from '@src/settings';
import { ResizableSidebar } from './sidebar/ResizableSidebar';
import { FileManager } from './sidebar/FileManager';
import { WelcomeScreen } from './WelcomeScreen';
import { useActivePattern, userPattern } from '@src/user_pattern_utils';
import { DEFAULT_TRACK_CODE, isDefaultCode } from '@src/constants/defaultCode';
import React, { useState, useEffect } from 'react';

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
}

export default function ReplEditor({ context, ...editorProps }: ReplEditorProps) {
  const { containerRef, editorRef, error, init, pending } = context;
  const settings = useSettings();
  const { panelPosition, isZen, isFileManagerOpen } = settings;
  const activePattern = useActivePattern();
  
  // Check if there are any tracks in the FileManager system
  const [hasTracks, setHasTracks] = useState(() => {
    // Initialize state directly from localStorage (only in browser)
    if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
      const savedTracks = localStorage.getItem('strudel_tracks');
      if (savedTracks) {
        try {
          const tracks = JSON.parse(savedTracks);
          return Object.keys(tracks).length > 0;
        } catch (e) {
          return false;
        }
      }
    }
    return false;
  });
  
  const [hasUserData, setHasUserData] = useState(() => {
    // Initialize state directly from localStorage (only in browser)
    if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
      const savedTracks = localStorage.getItem('strudel_tracks');
      const userPatternsKey = localStorage.getItem('strudel-settingsuserPatterns');
      
      let hasTracksData = false;
      let hasUserPatternData = false;
      
      if (savedTracks) {
        try {
          const tracks = JSON.parse(savedTracks);
          hasTracksData = Object.keys(tracks).length > 0;
        } catch (e) {
          hasTracksData = false;
        }
      }
      
      if (userPatternsKey) {
        try {
          const patterns = JSON.parse(userPatternsKey);
          if (patterns && Object.keys(patterns).length > 0) {
            const patternValues = Object.values(patterns);
            const hasNonDefaultPatterns = patternValues.some((pattern: any) => {
              if (!pattern.code) return false;
              const code = pattern.code.toString();
              // Check if this is NOT the default welcome pattern
              return !isDefaultCode(code);
            });
            hasUserPatternData = hasNonDefaultPatterns;
          }
        } catch (e) {
          hasUserPatternData = false;
        }
      }
      
      return hasTracksData || hasUserPatternData;
    }
    return false;
  });
  
  const checkUserData = () => {
    if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
      const savedTracks = localStorage.getItem('strudel_tracks');
      const userPatternsKey = localStorage.getItem('strudel-settingsuserPatterns');
      
      let hasTracksData = false;
      let hasUserPatternData = false;
      
      if (savedTracks) {
        try {
          const tracks = JSON.parse(savedTracks);
          hasTracksData = Object.keys(tracks).length > 0;
          console.log('checkUserData - tracks found:', Object.keys(tracks).length, tracks);
        } catch (e) {
          hasTracksData = false;
          console.log('checkUserData - error parsing tracks:', e);
        }
      }
      
      if (userPatternsKey) {
        try {
          const patterns = JSON.parse(userPatternsKey);
          if (patterns && Object.keys(patterns).length > 0) {
            // Check if the user patterns contain only default/welcome code
            const patternValues = Object.values(patterns);
            const hasNonDefaultPatterns = patternValues.some((pattern: any) => {
              if (!pattern.code) return false;
              const code = pattern.code.toString();
              // Check if this is NOT the default welcome pattern
              return !isDefaultCode(code);
            });
            hasUserPatternData = hasNonDefaultPatterns;
            console.log('checkUserData - user patterns found:', Object.keys(patterns).length, 'non-default:', hasNonDefaultPatterns);
          }
        } catch (e) {
          hasUserPatternData = false;
          console.log('checkUserData - error parsing user patterns:', e);
        }
      }
      
      // Only consider tracks and non-default user patterns
      const hasAnyUserData = hasTracksData || hasUserPatternData;
      
      console.log('checkUserData - final result:', { hasTracksData, hasUserPatternData, hasAnyUserData });
      
      setHasTracks(hasTracksData);
      setHasUserData(hasAnyUserData);
    }
  };
  
  useEffect(() => {
    console.log('ReplEditor useEffect - calling checkUserData on mount');
    checkUserData();
    
    // Listen for localStorage changes
    const handleStorageChange = () => {
      console.log('ReplEditor - localStorage changed, calling checkUserData');
      checkUserData();
    };
    
    // Listen for when all tracks are deleted
    const handleAllTracksDeleted = () => {
      console.log('ReplEditor - all tracks deleted, showing welcome screen');
      setHasTracks(false);
      setHasUserData(false);
    };
    
    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('strudel-all-tracks-deleted', handleAllTracksDeleted);
    
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('strudel-all-tracks-deleted', handleAllTracksDeleted);
    };
  }, []);
  
  // Check if we should show the welcome screen
  // Show welcome if this is a fresh session with no user data
  const shouldShowWelcome = !hasUserData;
  
  // Debug logging
  console.log('Debug Welcome Screen:', {
    activePattern,
    hasTracks,
    hasUserData,
    shouldShowWelcome,
    localStorage_tracks: typeof localStorage !== 'undefined' ? localStorage.getItem('strudel_tracks') : 'undefined',
    localStorage_settings: typeof localStorage !== 'undefined' ? localStorage.getItem('strudel_settings') : 'undefined'
  });
  
  const handleCreateTrack = () => {
    // Create a new track with the default code
    const trackId = Date.now().toString();

    const newTrack = {
      id: trackId,
      name: 'My First Track',
      code: DEFAULT_TRACK_CODE,
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
    };
    
    // Save to FileManager's localStorage system
    if (typeof localStorage !== 'undefined') {
      const savedTracks = localStorage.getItem('strudel_tracks');
      const tracks = savedTracks ? JSON.parse(savedTracks) : {};
      tracks[trackId] = newTrack;
      localStorage.setItem('strudel_tracks', JSON.stringify(tracks));
      
      // Update state immediately
      setHasTracks(true);
      setHasUserData(true);
      
      // Trigger a custom event to notify FileManager
      window.dispatchEvent(new CustomEvent('strudel-tracks-updated', { 
        detail: { tracks } 
      }));
      
      // Also trigger a recheck to be sure
      setTimeout(() => {
        console.log('handleCreateTrack - triggering checkUserData');
        checkUserData();
      }, 100);
    }
    
    // Also create in user pattern system for consistency
    const newPattern = userPattern.update(trackId, { code: DEFAULT_TRACK_CODE });
    
    // Defer the editor update until after the component re-renders and shows the editor
    // Don't reset since that might cause issues with uninitialized editor
    setTimeout(() => {
      context.handleUpdate(newPattern.data, false);
    }, 100);
    
    // Also notify FileManager to select this track
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('strudel-select-track', { 
        detail: { trackId } 
      }));
    }, 200);
  };
  
  const handleImportTracks = () => {
    // Trigger the file manager's import functionality
    const importInput = document.getElementById('file-import-input') as HTMLInputElement;
    if (importInput) {
      importInput.click();
    } else {
      // Fallback: create a file input element
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,.md,.txt,.js';
      input.multiple = true;
      input.onchange = async (e) => {
        const files = (e.target as HTMLInputElement).files;
        if (files) {
          // Process files for FileManager system
          Array.from(files).forEach(file => {
            const reader = new FileReader();
            reader.onload = (event) => {
              const content = event.target?.result as string;
              const trackId = Date.now().toString() + Math.random().toString(36).substring(2, 11);
              const trackName = file.name.replace(/\.(js|txt|md)$/, '');
              
              const newTrack = {
                id: trackId,
                name: trackName,
                code: content,
                created: new Date().toISOString(),
                modified: new Date().toISOString(),
              };
              
              // Save to FileManager's localStorage
              if (typeof localStorage !== 'undefined') {
                const savedTracks = localStorage.getItem('strudel_tracks');
                const tracks = savedTracks ? JSON.parse(savedTracks) : {};
                tracks[trackId] = newTrack;
                localStorage.setItem('strudel_tracks', JSON.stringify(tracks));
                
                // Update state immediately
                setHasTracks(true);
                setHasUserData(true);
                
                // Also trigger a recheck to be sure
                setTimeout(() => checkUserData(), 100);
              }
              
              // Load the first imported track
              if (files && Array.from(files).indexOf(file) === 0) {
                context.handleUpdate({ code: content }, true);
              }
            };
            reader.readAsText(file);
          });
        }
      };
      input.click();
    }
  };

  return (
    <div className="h-full flex flex-col relative" {...editorProps}>
      <Loader active={pending} />
      <Header context={context} />
      <div className="grow flex relative overflow-hidden">
        {!isZen && isFileManagerOpen && (
          <ResizableSidebar defaultWidth={300} minWidth={200} maxWidth={500}>
            <FileManager context={context} />
          </ResizableSidebar>
        )}
        {shouldShowWelcome ? (
          <WelcomeScreen 
            onCreateTrack={handleCreateTrack}
            onImportTracks={handleImportTracks}
          />
        ) : (
          <Code containerRef={containerRef} editorRef={editorRef} init={init} />
        )}
        {!isZen && panelPosition === 'right' && <VerticalPanel context={context} />}
      </div>
      <UserFacingErrorMessage error={error} />
      {!isZen && panelPosition === 'bottom' && <HorizontalPanel context={context} />}
    </div>
  );
}