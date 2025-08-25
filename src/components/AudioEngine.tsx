import React, { useEffect, useRef } from 'react';
import { useAppStore } from '../stores/appStore';
import { strudelEngine, initializeStrudelGlobals } from '../audio/StrudelEngine';

interface AudioEngineProps {
  onError?: (error: Error) => void;
}

export const AudioEngine: React.FC<AudioEngineProps> = ({ onError }) => {
  const { isPlaying, volume, code } = useAppStore();
  const lastCodeRef = useRef<string>('');
  const isInitializedRef = useRef(false);

  // Initialize audio engine
  useEffect(() => {
    const initializeAudio = async () => {
      try {
        await initializeStrudelGlobals();
        isInitializedRef.current = true;
      } catch (error) {
        console.error('Failed to initialize audio engine:', error);
        onError?.(error as Error);
      }
    };

    initializeAudio();
  }, [onError]);

  // BPM is now controlled from within the song code using setcps()
  // No need for external BPM control

  // Handle playback state changes
  useEffect(() => {
    const handlePlayback = async () => {
      if (!isInitializedRef.current) return;

      try {
        if (isPlaying) {
          // If code has changed or we're starting fresh, evaluate new pattern
          if (code !== lastCodeRef.current || !strudelEngine.getIsPlaying()) {
            await strudelEngine.play(code);
            lastCodeRef.current = code;
          }
        } else {
          strudelEngine.stop();
        }
      } catch (error) {
        console.error('Audio playback error:', error);
        onError?.(error as Error);
      }
    };

    handlePlayback();
  }, [isPlaying, code, onError]);

  // Handle volume changes
  useEffect(() => {
    const setMasterVolume = async () => {
      const audioContext = await strudelEngine.getAudioContext();
      if (audioContext) {
        // In a real implementation, you'd connect to a master gain node
        console.log('Setting master volume to:', volume);
      }
    };

    if (isInitializedRef.current) {
      setMasterVolume();
    }
  }, [volume]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      strudelEngine.stop();
    };
  }, []);

  return null; // This component doesn't render anything
};

// Hook for audio engine utilities
// eslint-disable-next-line react-refresh/only-export-components
export const useAudioEngine = () => {
  const { isPlaying, togglePlayback, setVolume } = useAppStore();

  const executeCode = async (code: string) => {
    try {
      await strudelEngine.play(code);
    } catch (error) {
      console.error('Failed to execute audio code:', error);
      throw error;
    }
  };

  const stopAudio = () => {
    strudelEngine.stop();
  };

  const getAudioContext = () => {
    return strudelEngine.getAudioContext();
  };

  return {
    isPlaying,
    togglePlayback,
    setVolume,
    executeCode,
    stopAudio,
    getAudioContext,
  };
};