import React from 'react';
import { useTranslation } from '@src/i18n';
import { CommandLineIcon, PlayIcon, PauseIcon, DocumentArrowUpIcon } from '@heroicons/react/24/outline';

interface ShortcutItemProps {
  keys: string[];
  description: string;
  icon?: React.ReactNode;
}

function ShortcutItem({ keys, description, icon }: ShortcutItemProps) {
  return (
    <div className="flex items-center justify-between py-3 px-4 hover:bg-gray-800/30 rounded-lg transition-colors">
      <div className="flex items-center gap-3">
        {icon && <div className="text-purple-400 flex-shrink-0">{icon}</div>}
        <span className="text-gray-300 text-sm">{description}</span>
      </div>
      <div className="flex items-center gap-1">
        {keys.map((key, index) => (
          <React.Fragment key={key}>
            {index > 0 && <span className="text-gray-500 text-xs mx-1">+</span>}
            <kbd className="px-2 py-1 text-xs font-mono bg-gray-700 text-gray-200 rounded border border-gray-600 shadow-sm">
              {key}
            </kbd>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

interface ShortcutSectionProps {
  title: string;
  children: React.ReactNode;
}

function ShortcutSection({ title, children }: ShortcutSectionProps) {
  return (
    <div className="mb-6">
      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3 px-4">
        {title}
      </h3>
      <div className="space-y-1">
        {children}
      </div>
    </div>
  );
}

export function ShortcutsTab() {
  const { t } = useTranslation(['shortcuts', 'common']);
  
  // Detect platform for showing correct modifier key
  const isMac = typeof navigator !== 'undefined' && (
    navigator.userAgent.includes('Mac') || 
    navigator.userAgent.includes('iPhone') || 
    navigator.userAgent.includes('iPad')
  );
  const modKey = isMac ? 'Cmd' : 'Ctrl';

  return (
    <div className="h-full overflow-auto bg-background text-foreground">
      <div className="p-4">
        <div className="mb-6">
          <h2 className="text-lg font-bold text-foreground mb-2">
            {t('shortcuts:title', 'Keyboard Shortcuts')}
          </h2>
          <p className="text-sm text-gray-400">
            {t('shortcuts:description', 'Speed up your live coding workflow with these keyboard shortcuts')}
          </p>
        </div>

        <ShortcutSection title={t('shortcuts:sections.essential', 'Essential')}>
          <ShortcutItem
            keys={[modKey, 'Enter']}
            description={t('shortcuts:evaluate', 'Evaluate/run pattern')}
            icon={<PlayIcon className="w-4 h-4" />}
          />
          <ShortcutItem
            keys={[modKey, 'U']}
            description={t('shortcuts:update', 'Update pattern (alternative)')}
            icon={<DocumentArrowUpIcon className="w-4 h-4" />}
          />
          <ShortcutItem
            keys={[modKey, 'P']}
            description={t('shortcuts:playPause', 'Toggle play/pause')}
            icon={<PauseIcon className="w-4 h-4" />}
          />
        </ShortcutSection>

        <ShortcutSection title={t('shortcuts:sections.file', 'File Management')}>
          <ShortcutItem
            keys={[modKey, 'S']}
            description={t('shortcuts:save', 'Save current track')}
            icon={<DocumentArrowUpIcon className="w-4 h-4" />}
          />
        </ShortcutSection>

        <ShortcutSection title={t('shortcuts:sections.editor', 'Code Editor')}>
          <ShortcutItem
            keys={[modKey, '/']}
            description={t('shortcuts:comment', 'Toggle line comment')}
            icon={<CommandLineIcon className="w-4 h-4" />}
          />
          <ShortcutItem
            keys={[modKey, 'Q']}
            description={t('shortcuts:format', 'Format code with Prettier')}
            icon={<CommandLineIcon className="w-4 h-4" />}
          />
        </ShortcutSection>

        <ShortcutSection title={t('shortcuts:sections.mixer', 'Audio Mixer')}>
          <ShortcutItem
            keys={[modKey, 'Shift', 'M']}
            description={t('shortcuts:toggleMixerMode', 'Toggle Live/Preview mode')}
          />
          <ShortcutItem
            keys={[modKey, 'Shift', 'I']}
            description={t('shortcuts:instantTransition', 'Instant transition to live')}
          />
          <ShortcutItem
            keys={[modKey, 'Shift', 'X']}
            description={t('shortcuts:crossfadeTransition', 'Crossfade transition to live')}
          />
          <ShortcutItem
            keys={[modKey, 'Shift', 'S']}
            description={t('shortcuts:stopPreview', 'Stop preview stream')}
          />
        </ShortcutSection>

        <div className="mt-8 p-4 bg-gray-800/30 rounded-lg">
          <h4 className="text-sm font-semibold text-gray-300 mb-2">
            {t('shortcuts:tip.title', 'Pro Tip')}
          </h4>
          <p className="text-xs text-gray-400 leading-relaxed">
            {t('shortcuts:tip.description', 'Use Ctrl+Enter or Ctrl+U frequently during live coding to hear your changes instantly. Ctrl+P lets you quickly stop everything when needed.')}
          </p>
        </div>

        <div className="mt-6 p-4 bg-blue-900/20 border border-blue-700/30 rounded-lg">
          <h4 className="text-sm font-semibold text-blue-300 mb-2">
            {t('shortcuts:keybindings.title', 'Editor Keybindings')}
          </h4>
          <p className="text-xs text-blue-200/80 leading-relaxed mb-2">
            {t('shortcuts:keybindings.description', 'You can change editor keybindings in Settings:')}
          </p>
          <div className="flex flex-wrap gap-2">
            {['CodeMirror', 'Vim', 'Emacs', 'VSCode'].map((mode) => (
              <span key={mode} className="px-2 py-1 text-xs bg-blue-800/40 text-blue-200 rounded">
                {mode}
              </span>
            ))}
          </div>
        </div>

        {isMac && (
          <div className="mt-4 p-3 bg-gray-800/20 rounded-lg">
            <p className="text-xs text-gray-500">
              {t('shortcuts:platform.mac', 'On Mac, use Cmd instead of Ctrl for all shortcuts')}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}