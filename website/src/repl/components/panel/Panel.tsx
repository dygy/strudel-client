import cx from '@src/cx';
import { setPanelPinned, setActiveFooter as setTab, useSettings } from '../../../settings';
import { ConsoleTab } from './ConsoleTab';
import { FilesTab } from './FilesTab';
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
import { clampPanelWidth, resolvePanelTrigger } from './panelViewport';
import { usePanelLayout } from './panelLayout';

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
  mixer?: any;
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
  const rawSettings = useSettings();
  const { activeFooter: tab } = rawSettings;
  const { compact, canHover, panelOpen: isPanelOpen, openPanel, closePanel } = usePanelLayout();
  const settings = {
    ...rawSettings,
    isPanelOpen,
    togglePanelTrigger: resolvePanelTrigger(rawSettings.togglePanelTrigger, { canHover, compact }),
  };

  return (
    <ToastContext.Provider value={toastActions}>
      <PanelNav
        settings={settings}
        onOpen={openPanel}
        onClose={closePanel}
        className="overflow-hidden flex flex-col"
        style={{
          // On a phone the open bottom sheet leaves at least half the screen to the editor.
          height: isPanelOpen ? (compact ? 'min(360px, 50vh)' : 360) : 48,
          transition: 'height 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        {isPanelOpen && (
          <div className="flex h-full overflow-auto pr-10 ">
            <PanelContent context={context} tab={tab} />
          </div>
        )}

        <div className={cx('absolute', compact ? 'end-4 pt-0.5' : 'right-4 pt-4')}>
          <PanelActionButton settings={settings} onClose={closePanel} large={compact} />
        </div>

        <div className={cx('flex  justify-between min-h-12 max-h-12 grid-cols-2 items-center', compact && 'pe-16')}>
          <Tabs setTab={setTab} tab={tab} />
        </div>
      </PanelNav>
    </ToastContext.Provider>
  );
}

export function VerticalPanel({ context }: PanelProps) {
  const rawSettings = useSettings();
  const { activeFooter: tab } = rawSettings;
  const { i18n } = useTranslation();
  const { t } = useTranslation('common');
  const { compact, canHover, viewportWidth, panelOpen: isPanelOpen, openPanel, closePanel } = usePanelLayout();
  const settings = {
    ...rawSettings,
    isPanelOpen,
    togglePanelTrigger: resolvePanelTrigger(rawSettings.togglePanelTrigger, { canHover, compact }),
  };
  const [width, setWidth] = useState(600);
  const [isResizing, setIsResizing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const minWidth = 400;
  const maxWidth = Math.min(1200, viewportWidth * 0.8);

  // Check if current language is RTL
  const isRTL = ['ar', 'he'].includes(i18n.language);

  const handleMouseDown = (e: React.MouseEvent) => {
    // Start from the width actually drawn: after a window shrink the stored width can be larger.
    const drawnWidth = clampPanelWidth(width, viewportWidth, minWidth);
    setWidth(drawnWidth);
    setIsResizing(true);
    startX.current = e.clientX;
    startWidth.current = drawnWidth;

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
      const newWidth = Math.max(
        minWidth,
        Math.min(maxWidth, isRTL ? startWidth.current + deltaX : startWidth.current - deltaX),
      );
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

  // Phones: the open panel is a full-width sheet over the editor area with a fixed header holding
  // the close button; the tab row scrolls on its own. Closed, it is the same 48px strip as desktop.
  if (compact && isPanelOpen) {
    return (
      <ToastContext.Provider value={toastActions}>
        {/* lineHighlight is translucent; an opaque underlay keeps the code from showing through.
            z-[15]: above the editor (.cm-editor is z-index 11 in Repl.css) and below the header
            (relative z-20), so header popovers such as the record menu stay on top. */}
        <div className="absolute inset-0 z-[15] bg-background" data-panel-sheet="">
          <PanelNav
            settings={settings}
            onOpen={openPanel}
            onClose={closePanel}
            className="h-full w-full flex flex-col overflow-hidden"
            ref={panelRef}
          >
            <div className="flex items-center shrink-0 gap-1 border-b border-lineBackground">
              <Tabs setTab={setTab} tab={tab} className="flex-1 min-w-0 overflow-x-auto pb-0" />
              <PanelActionButton settings={settings} onClose={closePanel} large />
            </div>
            <div className="overflow-auto flex-1 min-h-0">
              <PanelContent context={context} tab={tab} />
            </div>
          </PanelNav>
        </div>
      </ToastContext.Provider>
    );
  }

  return (
    <ToastContext.Provider value={toastActions}>
      <PanelNav
        settings={settings}
        onOpen={openPanel}
        onClose={closePanel}
        className={cx('relative flex-shrink-0 overflow-hidden')}
        style={{
          width: isPanelOpen ? clampPanelWidth(width, viewportWidth, minWidth) : 48,
          transition: isResizing ? 'none' : 'width 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
        ref={panelRef}
      >
        {isPanelOpen ? (
          <>
            {/* Resize handle - position based on RTL/LTR */}
            <div
              className={cx(
                'absolute top-0 w-1 h-full cursor-col-resize hover:bg-blue-500 transition-colors z-10',
                isRTL ? 'right-0' : 'left-0',
                isResizing && 'bg-blue-500',
              )}
              onMouseDown={handleMouseDown}
            />

            <div className={cx('flex flex-col h-full', isRTL ? 'pr-1' : 'pl-1')}>
              <div className="flex justify-between w-full ">
                <Tabs setTab={setTab} tab={tab} className="min-w-0" />
                <PanelActionButton settings={settings} onClose={closePanel} />
              </div>

              <div className="overflow-auto h-full">
                <PanelContent context={context} tab={tab} />
              </div>
            </div>
          </>
        ) : (
          <button
            onClick={() => openPanel()}
            aria-label={t('openPanel')}
            data-panel-open=""
            className={cx(
              'flex flex-col hover:bg-lineBackground items-center cursor-pointer justify-center w-full h-full',
              'transition-colors duration-200',
            )}
          >
            <ChevronLeftIcon
              className={cx(
                'text-foreground opacity-50 w-6 h-6 transition-transform duration-200 hover:scale-125',
                isRTL && 'rotate-180',
              )}
            />
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
  onOpen: () => void;
  onClose: () => void;
  style?: React.CSSProperties;
  [key: string]: any;
}

const PanelNav = React.forwardRef<HTMLElement, PanelNavProps>(
  ({ children, className, settings, onOpen, onClose, style, ...props }, ref) => {
    const isHoverBehavior = settings.togglePanelTrigger === 'hover';
    const { t } = useTranslation('common');
    return (
      <nav
        ref={ref}
        onClick={() => {
          if (!settings.isPanelOpen) {
            onOpen();
          }
        }}
        onMouseEnter={() => {
          if (isHoverBehavior && !settings.isPanelOpen) {
            onOpen();
          }
        }}
        onMouseLeave={() => {
          if (isHoverBehavior && !settings.isPanelPinned) {
            onClose();
          }
        }}
        aria-label={t('menuPanel')}
        className={cx('bg-lineHighlight group overflow-x-auto', className)}
        style={style}
        {...props}
      >
        {children}
      </nav>
    );
  },
);

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
        return <SettingsTab started={context.started} mixer={context.mixer} />;
    }
  };

  return (
    <div className="w-full h-full">
      <div
        className={cx(
          'w-full h-full',
          'transition-[opacity,transform] duration-200 ease-out',
          isTransitioning ? 'opacity-0 translate-y-1' : 'opacity-100 translate-y-0',
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
    <button
      onClick={onClick}
      className={cx(
        'relative h-8 px-2 text-foreground cursor-pointer flex items-center space-x-1 shrink-0 whitespace-nowrap',
        'transition-all duration-200 ease-out',
        isSelected ? 'opacity-100' : 'opacity-50 hover:opacity-75',
      )}
    >
      {label}
      {/* Animated underline */}
      <span
        className={cx(
          'absolute bottom-0 left-0 right-0 h-[2px] bg-foreground',
          'transition-transform duration-200 ease-out origin-center',
          isSelected ? 'scale-x-100' : 'scale-x-0',
        )}
      />
    </button>
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
  onClose: () => void;
  /** Touch-sized (44px) close control for compact viewports. */
  large?: boolean;
}

function PanelActionButton({ settings, onClose, large = false }: PanelActionButtonProps) {
  const { togglePanelTrigger, isPanelPinned, isPanelOpen } = settings;
  const isHoverBehavior = togglePanelTrigger === 'hover';
  if (!isPanelOpen) {
    return null;
  }

  if (isHoverBehavior) {
    return <PinButton pinned={isPanelPinned} />;
  }
  return <CloseButton onClick={onClose} large={large} />;
}

interface PinButtonProps {
  pinned: boolean;
}

function PinButton({ pinned }: PinButtonProps) {
  const { t } = useTranslation('common');
  return (
    <button
      onClick={() => setPanelPinned(!pinned)}
      className={cx(
        'text-foreground max-h-8 min-h-8 max-w-8 min-w-8 items-center justify-center p-1.5 group-hover:flex',
        pinned ? 'flex' : 'hidden',
      )}
      aria-label={t('pinPanel')}
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
  large?: boolean;
}

function CloseButton({ onClick, large = false }: CloseButtonProps) {
  const { t } = useTranslation('common');
  return (
    <button
      onClick={onClick}
      className={cx(
        'text-foreground items-center justify-center group-hover:flex hover:opacity-70 transition-opacity',
        large ? 'flex shrink-0 h-11 w-11 min-h-11 min-w-11 p-2' : 'max-h-8 min-h-8 max-w-8 min-w-8 p-1.5 flex-shrink-0',
      )}
      aria-label={t('closePanel')}
      data-panel-close=""
    >
      <span className={cx('font-normal leading-none', large ? 'text-3xl' : 'text-lg')}>×</span>
    </button>
  );
}
