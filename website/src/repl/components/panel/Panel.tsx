import cx from '@src/cx';
import { setPanelPinned, setActiveFooter as setTab, setIsPanelOpened, useSettings } from '../../../settings';
import { ConsoleTab } from './ConsoleTab';
import { FilesTab } from './FilesTab';
import { Reference } from './Reference';
import { EnhancedReference } from './EnhancedReference';
import { SettingsTab } from './SettingsTab';
import { SoundsTab } from './SoundsTab';
import { ShortcutsTab } from './ShortcutsTab';
import { useLogger } from '../useLogger';
import { WelcomeTab } from './WelcomeTab';
import { PatternsTab } from './PatternsTab';
import { ChevronLeftIcon } from '@heroicons/react/16/solid';
import { useTranslation } from '@src/i18n';
import { useState, useRef, useEffect, createContext, useContext } from 'react';
import React from 'react';
import { toastActions } from '@src/stores/toastStore';

// Toast context for sharing toast actions across panel components
const ToastContext = createContext<typeof toastActions | null>(null);

export const useToastContext = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToastContext must be used within a ToastProvider');
  }
  return context;
};

declare global {
  interface Window {
    __TAURI__?: any;
  }
}

const TAURI = typeof window !== 'undefined' && window.__TAURI__;

interface ReplContext {
  started?: boolean;
  pending?: boolean;
  isDirty?: boolean;
  activeCode?: string;
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
    <ToastContext.Provider value={toastActions}>
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
    </ToastContext.Provider>
  );
}

export function VerticalPanel({ context }: PanelProps) {
  const settings = useSettings();
  const { activeFooter: tab, isPanelOpen } = settings;
  const { i18n } = useTranslation();
  const [width, setWidth] = useState(600);
  const [isResizing, setIsResizing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const minWidth = 400;
  const maxWidth = Math.min(1200, typeof window !== 'undefined' ? window.innerWidth * 0.8 : 1200);
  
  // Check if current language is RTL
  const isRTL = ['ar', 'he'].includes(i18n.language);

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsResizing(true);
    startX.current = e.clientX;
    startWidth.current = width;
    
    // Prevent text selection during resize
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      
      // For RTL: resize from right edge (add deltaX)
      // For LTR: resize from left edge (subtract deltaX)
      const deltaX = e.clientX - startX.current;
      const newWidth = Math.max(minWidth, Math.min(maxWidth, 
        isRTL ? startWidth.current + deltaX : startWidth.current - deltaX
      ));
      setWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, minWidth, maxWidth, isRTL]);

  return (
    <ToastContext.Provider value={toastActions}>
      <PanelNav
        settings={settings}
        className={cx(
          'relative',
          isPanelOpen ? `flex-shrink-0` : 'min-w-12 max-w-12'
        )}
        style={isPanelOpen ? { width: `${width}px` } : undefined}
        ref={panelRef}
      >
        {isPanelOpen ? (
          <>
            {/* Resize handle - position based on RTL/LTR */}
            <div
              className={cx(
                'absolute top-0 w-1 h-full cursor-col-resize hover:bg-blue-500 transition-colors z-10',
                isRTL ? 'right-0' : 'left-0',
                isResizing && 'bg-blue-500'
              )}
              onMouseDown={handleMouseDown}
            />
            
            <div className={cx('flex flex-col h-full', isRTL ? 'pr-1' : 'pl-1')}>
              <div className="flex justify-between w-full ">
                <Tabs setTab={setTab} tab={tab} />
                <PanelActionButton settings={settings} />
              </div>

              <div className="overflow-auto h-full">
                <PanelContent context={context} tab={tab} />
              </div>
            </div>
          </>
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
            <ChevronLeftIcon className={cx(
              'text-foreground opacity-50 w-6 h-6',
              isRTL && 'rotate-180'
            )} />
          </button>
        )}
      </PanelNav>
    </ToastContext.Provider>
  );
}

// Tab configuration - keys are used for internal routing, values are translation keys
const getTabNames = (t: (key: string) => string) => {
  const tabs: Record<string, string> = {
    welcome: t('welcome'),
    patterns: t('patterns'),
    sounds: t('sounds'),
    reference: t('reference'),
    shortcuts: t('shortcuts'),
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
  style?: React.CSSProperties;
  [key: string]: any;
}

const PanelNav = React.forwardRef<HTMLElement, PanelNavProps>(({ children, className, settings, style, ...props }, ref) => {
  const isHoverBehavior = settings.togglePanelTrigger === 'hover';
  return (
    <nav
      ref={ref}
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
      style={style}
      {...props}
    >
      {children}
    </nav>
  );
});

interface PanelContentProps {
  context: ReplContext;
  tab: string;
}

function PanelContent({ context, tab }: PanelContentProps) {
  useLogger();
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [displayTab, setDisplayTab] = useState(tab);

  useEffect(() => {
    if (tab !== displayTab) {
      setIsTransitioning(true);
      
      // Quick fade out, then change content, then fade in
      const timer = setTimeout(() => {
        setDisplayTab(tab);
        setIsTransitioning(false);
      }, 150);
      
      return () => clearTimeout(timer);
    }
  }, [tab, displayTab]);

  const renderTabContent = (tabKey: string) => {
    switch (tabKey) {
      case 'welcome':
        return <WelcomeTab context={context} />;
      case 'patterns':
        return <PatternsTab context={context} />;
      case 'console':
        return <ConsoleTab />;
      case 'sounds':
        return <SoundsTab />;
      case 'reference':
        return <EnhancedReference />;
      case 'shortcuts':
        return <ShortcutsTab />;
      case 'files':
        return <FilesTab />;
      case 'settings':
      default:
        return <SettingsTab started={context.started} />;
    }
  };

  return (
    <div className="w-full h-full">
      <div
        className={cx(
          'w-full h-full transition-opacity duration-150 ease-out',
          isTransitioning ? 'opacity-0' : 'opacity-100'
        )}
      >
        {renderTabContent(displayTab)}
      </div>
    </div>
  );
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