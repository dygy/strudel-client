import React from 'react';
import { PlusIcon, ArrowDownTrayIcon, DocumentIcon } from '@heroicons/react/24/outline';
import { useTranslation } from '@src/i18n';

interface WelcomeScreenProps {
  onCreateTrack: () => void;
  onImportTracks: () => void;
}

export function WelcomeScreen({ onCreateTrack, onImportTracks }: WelcomeScreenProps) {
  const { t } = useTranslation(['welcome', 'common']);

  return (
    <div className="flex-1 flex items-center justify-center bg-background">
      <div className="text-center max-w-md mx-auto p-8">
        {/* Strudel Logo/Icon */}
        <div className="mb-8">
          <div className="w-16 h-16 mx-auto mb-4 bg-purple-600 rounded-full flex items-center justify-center">
            <DocumentIcon className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-foreground mb-2">
            {t('welcome:fileManager.welcomeTitle')}
          </h1>
          <p className="text-gray-400 text-sm">
            {t('welcome:fileManager.subtitle')}
          </p>
        </div>

        {/* Welcome Message */}
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-foreground mb-3">
            {t('welcome:fileManager.getStartedTitle')}
          </h2>
          <p className="text-gray-300 text-sm leading-relaxed">
            {t('welcome:fileManager.getStartedDescription')}
          </p>
        </div>

        {/* Action Buttons */}
        <div className="space-y-3">
          <button
            onClick={onCreateTrack}
            className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors font-medium"
          >
            <PlusIcon className="w-5 h-5" />
            {t('welcome:fileManager.createNewTrack')}
          </button>
          
          <button
            onClick={onImportTracks}
            className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors font-medium"
          >
            <ArrowDownTrayIcon className="w-5 h-5" />
            {t('welcome:fileManager.importTracks')}
          </button>
        </div>

        {/* Quick Tips */}
        <div className="mt-8 pt-6 border-t border-gray-700">
          <h3 className="text-sm font-semibold text-foreground mb-3">
            {t('welcome:fileManager.quickTipsTitle')}
          </h3>
          <div className="text-xs text-gray-400 space-y-2 text-left">
            <div className="flex items-start gap-2">
              <span className="text-purple-400 font-mono">•</span>
              <span>{t('welcome:fileManager.tip1', { key: 'Ctrl+Enter' })}</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-purple-400 font-mono">•</span>
              <span>{t('welcome:fileManager.tip2')}</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-purple-400 font-mono">•</span>
              <span>{t('welcome:fileManager.tip3')}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}