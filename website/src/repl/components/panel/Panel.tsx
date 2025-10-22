import cx from '@src/cx';
import { setPanelPinned, setActiveFooter as setTab, setIsPanelOpened, useSettings } from '../../../settings';
import { ConsoleTab } from './ConsoleTab';
import { FilesTab } from './FilesTab';
import { Reference } from './Reference';
import { SettingsTab } from './SettingsTab';
import { SoundsTab } from './SoundsTab';
import { useLogger } from '../useLogger';
import { WelcomeTab } from './WelcomeTab';
import { PatternsTab } from './PatternsTab';
import { ChevronLeftIcon } from '@heroicons/react/16/solid';
import { useTranslation } from '@src/i18n';

const TAURI = typeof window !== 'undefined' && window.__TAURI__;

interface ReplContext {
  started: boolean;
  pending: boolean;
  isDirty: boolean;
  activeCode: string;
  handleTogglePlay: () => void;
  handleEvaluate: () => void;
  handleShuffle: () => void;
  handleShare: () => void;
}

interface PanelProps {
  context: ReplContext;
}

interface Settings {
  isPanelOpen: boolean;
  activeFooter: string;
  togglePanelTrigger: 'click' | 'hover';
  isPanelPinned: boolean;
}

export function HorizontalPanel({ context }: PanelProps) {
  const settings = useSettings();
  const { isPanelOpen, activeFooter: tab } = settings;

  return (
    <PanelNav
      settings={settings}
      className={cx(isPanelOpen ? `min-h-[360px] max-h-[360px]` : 'min-h-12 max-h-12', 'overflow-hidden flex flex-col')}
    >
      {isPanelOpen && (
        <div className="flex h-full overflow-auto pr-10 ">
          <PanelContent context={context} tab={tab} />
        </div>
      )}

      <div className="absolute right-4 pt-4">
        <PanelActionButton settings={settings} />
      </div>

      <div className="flex  justify-between min-h-12 max-h-12 grid-cols-2 items-center">
        <Tabs setTab={setTab} tab={tab} />
      </div>
    </PanelNav>
  );
}

export function VerticalPanel({ context }: PanelProps) {
  const settings = useSettings();
  const { activeFooter: tab, isPanelOpen } = settings;

  return (
    <PanelNav
      settings={settings}
      className={cx(isPanelOpen ? `min-w-[min(600px,80vw)] max-w-[min(600px,80vw)]` : 'min-w-12 max-w-12')}
    >
      {isPanelOpen ? (
        <div className={cx('flex flex-col h-full')}>
          <div className="flex justify-between w-full ">
            <Tabs setTab={setTab} tab={tab} />
            <PanelActionButton settings={settings} />
          </div>

          <div className="overflow-auto h-full">
            <PanelContent context={context} tab={tab} />
          </div>
        </div>
      ) : (
        <button
          onClick={(e) => {
            setIsPanelOpened(true);
          }}
          aria-label="open menu panel"
          className={cx(
            'flex flex-col hover:bg-lineBackground items-center cursor-pointer justify-center w-full  h-full',
          )}
        >
          <ChevronLeftIcon className="text-foreground opacity-50 w-6 h-6" />
        </button>
      )}
    </PanelNav>
  );
}

// Tab configuration - keys are used for internal routing, values are translation keys
const getTabNames = (t: (key: string) => string) => {
  const tabs: Record<string, string> = {
    welcome: t('welcome'),
    patterns: t('patterns'),
    sounds: t('sounds'),
    reference: t('reference'),
    console: t('console'),
    settings: t('settings'),
  };
  
  if (TAURI) {
    tabs.files = t('files');
  }
  
  return tabs;
};

interface PanelNavProps {
  children: React.ReactNode;
  className?: string;
  settings: Settings;
  [key: string]: any;
}

function PanelNav({ children, className, settings, ...props }: PanelNavProps) {
  const isHoverBehavior = settings.togglePanelTrigger === 'hover';
  return (
    <nav
      onClick={() => {
        if (!settings.isPanelOpen) {
          setIsPanelOpened(true);
        }
      }}
      onMouseEnter={() => {
        if (isHoverBehavior && !settings.isPanelOpen) {
          setIsPanelOpened(true);
        }
      }}
      onMouseLeave={() => {
        if (isHoverBehavior && !settings.isPanelPinned) {
          setIsPanelOpened(false);
        }
      }}
      aria-label="Menu Panel"
      className={cx('bg-lineHighlight group overflow-x-auto', className)}
      {...props}
    >
      {children}
    </nav>
  );
}

interface PanelContentProps {
  context: ReplContext;
  tab: string;
}

function PanelContent({ context, tab }: PanelContentProps) {
  useLogger();
  switch (tab) {
    case 'welcome':
      return <WelcomeTab context={context} />;
    case 'patterns':
      return <PatternsTab context={context} />;
    case 'console':
      return <ConsoleTab />;
    case 'sounds':
      return <SoundsTab />;
    case 'reference':
      return <Reference />;
    case 'files':
      return <FilesTab />;
    case 'settings':
    default:
      return <SettingsTab started={context.started} />;
  }
}

interface PanelTabProps {
  label: string;
  isSelected: boolean;
  onClick: () => void;
}

function PanelTab({ label, isSelected, onClick }: PanelTabProps) {
  return (
    <>
      <button
        onClick={onClick}
        className={cx(
          'h-8 px-2 text-foreground cursor-pointer hover:opacity-50 flex items-center space-x-1 border-b',
          isSelected ? 'border-foreground' : 'border-transparent',
        )}
      >
        {label}
      </button>
    </>
  );
}

interface TabsProps {
  setTab: (tab: string) => void;
  tab: string;
  className?: string;
}

function Tabs({ setTab, tab, className }: TabsProps) {
  const { t } = useTranslation('tabs');
  const tabNames = getTabNames(t);
  
  return (
    <div className={cx('flex select-none max-w-full overflow-auto pb-2', className)}>
      {Object.entries(tabNames).map(([key, label]) => {
        return <PanelTab key={key} isSelected={tab === key} label={label} onClick={() => setTab(key)} />;
      })}
    </div>
  );
}

interface PanelActionButtonProps {
  settings: Settings;
}

function PanelActionButton({ settings }: PanelActionButtonProps) {
  const { togglePanelTrigger, isPanelPinned, isPanelOpen } = settings;
  const isHoverBehavior = togglePanelTrigger === 'hover';
  if (!isPanelOpen) {
    return null;
  }

  if (isHoverBehavior) {
    return <PinButton pinned={isPanelPinned} />;
  }
  return <CloseButton onClick={() => setIsPanelOpened(false)} />;
}

interface PinButtonProps {
  pinned: boolean;
}

function PinButton({ pinned }: PinButtonProps) {
  return (
    <button
      onClick={() => setPanelPinned(!pinned)}
      className={cx(
        'text-foreground max-h-8 min-h-8 max-w-8 min-w-8 items-center justify-center p-1.5 group-hover:flex',
        pinned ? 'flex' : 'hidden',
      )}
      aria-label="Pin Menu Panel"
    >
      <svg
        stroke="currentColor"
        fill={'currentColor'}
        strokeWidth="0"
        className="w-full h-full"
        opacity={pinned ? 1 : '.3'}
        viewBox="0 0 16 16"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path d="M9.828.722a.5.5 0 0 1 .354.146l4.95 4.95a.5.5 0 0 1 0 .707c-.48.48-1.072.588-1.503.588-.177 0-.335-.018-.46-.039l-3.134 3.134a6 6 0 0 1 .16 1.013c.046.702-.032 1.687-.72 2.375a.5.5 0 0 1-.707 0l-2.829-2.828-3.182 3.182c-.195.195-1.219.902-1.414.707s.512-1.22.707-1.414l3.182-3.182-2.828-2.829a.5.5 0 0 1 0-.707c.688-.688 1.673-.767 2.375-.72a6 6 0 0 1 1.013.16l3.134-3.133a3 3 0 0 1-.04-.461c0-.43.108-1.022.589-1.503a.5.5 0 0 1 .353-.146"></path>
      </svg>
    </button>
  );
}

interface CloseButtonProps {
  onClick: () => void;
}

function CloseButton({ onClick }: CloseButtonProps) {
  return (
    <button
      onClick={onClick}
      className={cx(
        'text-foreground max-h-8 min-h-8 max-w-8 min-w-8 items-center justify-center p-1.5 group-hover:flex hover:opacity-70 transition-opacity',
      )}
      aria-label="Close Menu"
    >
      <span className="text-lg font-normal leading-none">×</span>
    </button>
  );
}