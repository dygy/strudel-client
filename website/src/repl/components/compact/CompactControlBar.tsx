import PlayCircleIcon from '@heroicons/react/20/solid/PlayCircleIcon';
import StopCircleIcon from '@heroicons/react/20/solid/StopCircleIcon';
import { ArrowPathIcon, Bars3Icon, Cog6ToothIcon } from '@heroicons/react/24/outline';
import cx from '@src/cx';
import { useTranslation } from '@src/i18n';
import { usePanelLayout } from '../panel/panelLayout';

export interface CompactControlBarContext {
  started?: boolean;
  isDirty?: boolean;
  handleTogglePlay: () => void;
  handleEvaluate: () => void;
}

function BarButton({
  onClick,
  label,
  text,
  active,
  glow,
  children,
  ...data
}: {
  onClick: () => void;
  label: string;
  text: string;
  active?: boolean;
  glow?: 'green' | 'orange' | 'blue';
  children: React.ReactNode;
  [dataAttr: `data-${string}`]: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={cx(
        'min-h-11 min-w-11 flex-1 max-w-24 flex flex-col items-center justify-center gap-0.5 rounded-lg',
        'text-foreground select-none transition-colors duration-150 active:bg-lineHighlight',
        active && glow === 'green' && 'bg-green-500 bg-opacity-10 shadow-[0_0_10px_rgba(34,197,94,0.45)]',
        active && glow === 'orange' && 'bg-orange-400 bg-opacity-10 shadow-[0_0_10px_rgba(251,146,60,0.45)]',
        active && glow === 'blue' && 'bg-blue-500 bg-opacity-10 shadow-[0_0_10px_rgba(59,130,246,0.45)]',
      )}
      {...data}
    >
      {children}
      <span className="text-[10px] leading-none opacity-70 first-letter:uppercase">{text}</span>
    </button>
  );
}

/**
 * Compact screens (spec 016 2.1): the controls used during a set, along the bottom edge in thumb
 * reach. It sits in the REPL column's flow below the editor, so it never covers code, and the
 * column follows `--app-height` (the visual viewport), which puts it right above the on-screen
 * keyboard. Each button calls the same handler as the desktop header and shortcuts.
 */
export function CompactControlBar({ context }: { context: CompactControlBarContext }) {
  const { t } = useTranslation('common');
  const { filesOpen, panelOpen, openPanel, closePanel, toggleFileManager } = usePanelLayout();

  return (
    <nav
      data-compact-control-bar=""
      aria-label={t('menuPanel')}
      // min-h-14 = CONTROL_BAR_HEIGHT (56px); min-h-12 = CONTROL_BAR_HEIGHT_SHORT (48px) on a phone
      // held sideways (max-height = COMPACT_LANDSCAPE_MAX_HEIGHT - 1), so both bars stay <= 25%.
      className={cx(
        'relative z-20 shrink-0 flex items-center justify-around gap-1 px-2',
        'min-h-14 [@media(max-height:499px)]:min-h-12 bg-background border-t border-lineHighlight',
        // Above the home indicator (spec 016 review #5); the REPL column pads left and right.
        'pb-[env(safe-area-inset-bottom)]',
      )}
    >
      <BarButton
        data-bar-play=""
        onClick={() => context.handleTogglePlay()}
        label={context.started ? t('stop') : t('play')}
        text={context.started ? t('stop') : t('play')}
        active={context.started}
        glow="green"
      >
        {context.started ? <StopCircleIcon className="w-6 h-6" /> : <PlayCircleIcon className="w-6 h-6" />}
      </BarButton>
      <BarButton
        data-bar-update=""
        onClick={() => context.handleEvaluate()}
        label={t('update')}
        text={t('update')}
        active={context.isDirty}
        glow="orange"
      >
        <ArrowPathIcon className="w-6 h-6 opacity-80" />
      </BarButton>
      <BarButton
        data-bar-library=""
        onClick={toggleFileManager}
        label={filesOpen ? t('closeLibrary') : t('openLibrary')}
        text={t('library')}
        active={filesOpen}
        glow="blue"
      >
        <Bars3Icon className="w-6 h-6 opacity-80" />
      </BarButton>
      <BarButton
        data-bar-settings=""
        onClick={() => (panelOpen ? closePanel() : openPanel())}
        label={panelOpen ? t('closePanel') : t('settings')}
        text={t('settings')}
        active={panelOpen}
        glow="blue"
      >
        <Cog6ToothIcon className="w-6 h-6 opacity-80" />
      </BarButton>
    </nav>
  );
}
