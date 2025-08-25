import React, { useState, useEffect } from 'react';
import { CodeEditor } from '../components/CodeEditor';
import { AudioEngine, useAudioEngine } from '../components/AudioEngine';
import { ActiveNotes } from '../components/ActiveNotes';
import { VisualizationManager } from '../components/visualizations/VisualizationManager';
import { useAutoSave } from '../hooks/useAutoSave';
import { useAppStore } from '../stores/appStore';
import type { PatternData, NoteEvent } from '../types';

export const EditorPage: React.FC = () => {
  const { code, setCode, currentProject } = useAppStore();
  const { executeCode } = useAudioEngine();
  // TODO: Get audioContext and analyser from proper source
  const audioContext = undefined;
  const analyser = undefined;
  const { manualSave } = useAutoSave();
  const [audioError, setAudioError] = useState<string | null>(null);
  const [showVisualizations, setShowVisualizations] = useState(false);
  const [patterns] = useState<PatternData[]>([]);
  const [notes, setNotes] = useState<NoteEvent[]>([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [currentStep, setCurrentStep] = useState(0);

  // Listen for visualization events from Strudel
  useEffect(() => {
    const handleVisualizationEvent = (event: CustomEvent) => {
      console.log('Visualization event received:', event.detail);
      setShowVisualizations(true);
    };

    const handleNoteEvent = (event: CustomEvent) => {
      const noteData = event.detail;
      setNotes(prev => {
        const newNotes = [...prev, noteData];
        // Keep only recent notes (last 5 seconds)
        const cutoff = Date.now() - 5000;
        return newNotes.filter(note => note.time > cutoff);
      });
    };

    window.addEventListener('strudel-visualization', handleVisualizationEvent as EventListener);
    window.addEventListener('strudel-note', handleNoteEvent as EventListener);

    return () => {
      window.removeEventListener('strudel-visualization', handleVisualizationEvent as EventListener);
      window.removeEventListener('strudel-note', handleNoteEvent as EventListener);
    };
  }, []);

  // Update current time for visualizations
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(Date.now() / 1000);
      setCurrentStep(prev => (prev + 1) % 16);
    }, 125); // 8th notes at 120 BPM

    return () => clearInterval(interval);
  }, []);

  const handleExecuteCode = async (strudelCode: string) => {
    try {
      setAudioError(null);
      
      // Execute the Strudel code (handles both audio and visuals)
      await executeCode(strudelCode);
      
      // Update the store with the new code
      setCode(strudelCode);
      
    } catch (error) {
      setAudioError(error instanceof Error ? error.message : 'Strudel execution failed');
      console.error('Strudel execution error:', error);
    }
  };

  const handleAudioError = (error: Error) => {
    setAudioError(error.message);
  };

  return (
    <div className="h-full flex flex-col relative">
      {/* Audio Engine */}
      <AudioEngine onError={handleAudioError} />
      
      {/* Error Display */}
      {audioError && (
        <div className="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-500 p-4">
          <div className="flex">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3">
              <p className="text-sm text-red-700 dark:text-red-400">
                Audio Error: {audioError}
              </p>
            </div>
            <div className="ml-auto pl-3">
              <button
                onClick={() => setAudioError(null)}
                className="text-red-400 hover:text-red-600"
              >
                <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Background Visual Canvas */}
      <div className="absolute inset-0 z-0">
        <canvas 
          id="hydra-canvas"
          className="w-full h-full object-cover"
          style={{ background: 'black' }}
        />
      </div>

      <div className="flex-1 flex flex-col relative z-10">
        {/* Header with project info */}
        <div className="flex border-b border-gray-200 dark:border-dark-700 bg-gray-50/80 dark:bg-dark-800/80 backdrop-blur-sm">
          <div className="flex items-center px-4 py-2">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Strudel REPL
            </h2>
          </div>
          
          {/* Project Info and Controls */}
          <div className="ml-auto flex items-center space-x-4 px-4 text-sm text-gray-600 dark:text-gray-400">
            {/* Active Notes Indicator */}
            <div className="flex items-center space-x-2">
              <ActiveNotes className="h-8" />
            </div>

            {/* Debug: Test Note Events */}
            <button
              onClick={() => {
                const testNote = new CustomEvent('strudel-note', {
                  detail: {
                    note: 'bd',
                    velocity: 0.8,
                    time: Date.now(),
                    color: '#ef4444'
                  }
                });
                window.dispatchEvent(testNote);
              }}
              className="px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
              title="Test note highlighting"
            >
              Test
            </button>

            {currentProject && (
              <button
                onClick={manualSave}
                className="flex items-center space-x-1 px-2 py-1 rounded hover:bg-gray-200 dark:hover:bg-dark-700 transition-colors"
                title="Save project (Ctrl+S)"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <span>Save</span>
              </button>
            )}
            
            {currentProject ? (
              <span>Project: {currentProject.name}</span>
            ) : (
              <span>No project loaded</span>
            )}
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 flex">
          {/* Code Editor */}
          <div className="flex-1 p-4 bg-white/90 dark:bg-dark-900/90 backdrop-blur-sm">
            <CodeEditor
              value={code}
              onChange={setCode}
              onExecute={handleExecuteCode}
              language="strudel"
              placeholder={`// Welcome to Strudel! 🎵🌈
// This is working code - press play to hear it!

// Basic drum pattern - try this first!
sound("bd hh sd hh")

// More examples to try (uncomment by removing //):
// sound("bd sd").gain(0.8).room(0.3)
// setcps(160/60/4)
// sound("bd!4 sd:2 hh*8")
// note("c3 e3 g3").s("triangle")

// Visual patterns (uncomment to try):
// osc(10, 0.1, 1.2).out()

// Try visualizations:
// sound("bd hh sd hh").pianoroll({fold:1})
// sound("bd sd").scope()
// note("c3 e3 g3").spectrum()

// Press Ctrl+Enter or Shift+Enter to execute!`}
            />
          </div>

          {/* Visualizations Panel */}
          {showVisualizations && (
            <div className="w-1/2 border-l border-gray-200 dark:border-dark-700 bg-white/95 dark:bg-dark-900/95 backdrop-blur-sm overflow-y-auto">
              <div className="p-4">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold">Visualizations</h3>
                  <button
                    onClick={() => setShowVisualizations(false)}
                    className="p-1 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                
                <VisualizationManager
                  audioContext={audioContext}
                  analyser={analyser}
                  patterns={patterns}
                  notes={notes}
                  isPlaying={true}
                  currentTime={currentTime}
                  currentStep={currentStep}
                />
              </div>
            </div>
          )}
        </div>

        {/* Visualization Toggle Button */}
        <button
          onClick={() => setShowVisualizations(!showVisualizations)}
          className="fixed bottom-4 right-4 bg-blue-600 hover:bg-blue-700 text-white p-3 rounded-full shadow-lg transition-colors z-20"
          title="Toggle Visualizations"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
        </button>
      </div>
    </div>
  );
};