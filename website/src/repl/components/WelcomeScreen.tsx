import React from 'react';
import { PlusIcon, ArrowDownTrayIcon, DocumentIcon } from '@heroicons/react/24/outline';
import { useTranslation } from '@src/i18n';

interface WelcomeScreenProps {
  onCreateTrack: () => void;
  onImportTracks: () => void;
}

export function WelcomeScreen({ onCreateTrack, onImportTracks }: WelcomeScreenProps) {
  const { t } = useTranslation(['files', 'common']);

  return (
    <div className="flex-1 flex items-center justify-center bg-background">
      <div className="text-center max-w-md mx-auto p-8">
        {/* Strudel Logo/Icon */}
        <div className="mb-8">
          <div className="w-16 h-16 mx-auto mb-4 bg-purple-600 rounded-full flex items-center justify-center">
            <DocumentIcon className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-foreground mb-2">
            Welcome to Strudel
          </h1>
          <p className="text-gray-400 text-sm">
            Live coding patterns on the web
          </p>
        </div>

        {/* Welcome Message */}
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-foreground mb-3">
            Get Started
          </h2>
          <p className="text-gray-300 text-sm leading-relaxed">
            Create your first track to start live coding musical patterns, or import existing tracks to continue your work.
          </p>
        </div>

        {/* Action Buttons */}
        <div className="space-y-3">
          <button
            onClick={onCreateTrack}
            className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors font-medium"
          >
            <PlusIcon className="w-5 h-5" />
            Create New Track
          </button>
          
          <button
            onClick={onImportTracks}
            className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors font-medium"
          >
            <ArrowDownTrayIcon className="w-5 h-5" />
            Import Tracks
          </button>
        </div>

        {/* Quick Tips */}
        <div className="mt-8 pt-6 border-t border-gray-700">
          <h3 className="text-sm font-semibold text-foreground mb-3">
            Quick Tips
          </h3>
          <div className="text-xs text-gray-400 space-y-2 text-left">
            <div className="flex items-start gap-2">
              <span className="text-purple-400 font-mono">•</span>
              <span>Press <kbd className="px-1 py-0.5 bg-gray-800 rounded text-xs">Ctrl+Enter</kbd> to evaluate code</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-purple-400 font-mono">•</span>
              <span>Use the file manager to organize your patterns</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-purple-400 font-mono">•</span>
              <span>Check out the examples in the sidebar for inspiration</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}