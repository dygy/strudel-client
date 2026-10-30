import { useState, useRef, useEffect } from 'react';
import PlayCircleIcon from '@heroicons/react/20/solid/PlayCircleIcon';
import StopCircleIcon from '@heroicons/react/20/solid/StopCircleIcon';
import { Bars3Icon, ArrowPathIcon, EyeIcon, MicrophoneIcon, VideoCameraIcon } from '@heroicons/react/24/outline';
import cx from '@src/cx';
import { useTranslation } from '@src/i18n';
import { useTransitionPhase } from '../transitionPhase';
import { TransitionPicker } from './TransitionPicker';
import { useSettings } from '../../settings';
import { usePanelLayout } from './panel/panelLayout';
import { AuthButton } from '../../components/auth/AuthButton';
import { formatElapsedTime } from '../recording/formatUtils';
import {
  activeRecordingSeconds,
  isAnyRecording as anyRecording,
  isAudioRecordDisabled,
  isScreenRecordDisabled,
  toggleAudioRecording,
  toggleScreenRecording,
} from './recordActions';
import { CompactTitleBar } from './compact/CompactTitleBar';
import '../Repl.css';

const { BASE_URL } = import.meta.env;
const baseNoTrailing = BASE_URL.endsWith('/') ? BASE_URL.slice(0, -1) : BASE_URL;

export interface ReplContext {
  started?: boolean;
  pending?: boolean;
  isDirty?: boolean;
  activeCode?: string;
  handleTogglePlay: () => void;
  handleEvaluate: () => void;
  handleShuffle: () => void;
  handleShare: () => void;
  mixer?: any;
  isPreviewing?: boolean;
  handlePreviewToggle?: () => void;
  isRecording?: boolean;
  recordingElapsedSeconds?: number;
  handleRecordToggle?: () => void;
  isScreenRecording?: boolean;
  screenRecordingElapsedSeconds?: number;
  handleScreenRecordToggle?: () => void;
  isScreenRecordingSupported?: boolean;
}

interface HeaderProps {
  context: ReplContext;
  embedded?: boolean;
  /** The open track's name, shown by the compact title bar (spec 016). */
  trackName?: string;
}

/* ------------------------------------------------------------------ */
/*  Reusable icon button with hover glow + scale                      */
/* ------------------------------------------------------------------ */
function IconBtn({
  onClick,
  title,
  disabled,
  active,
  glow,
  pulse,
  className,
  children,
}: {
  onClick?: () => void;
  title: string;
  disabled?: boolean;
  active?: boolean;
  glow?: 'blue' | 'red' | 'green' | 'orange';
  pulse?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      title={title}
      className={cx(
        'relative w-7 h-7 flex items-center justify-center rounded-md',
        'transition-all duration-200 ease-out select-none',
        disabled
          ? 'opacity-25 cursor-not-allowed'
          : 'hover:bg-lineHighlight hover:scale-110 active:scale-90 cursor-pointer',
        active && glow === 'blue' && 'bg-blue-500 bg-opacity-10 shadow-[0_0_10px_rgba(59,130,246,0.45)]',
        active && glow === 'red' && 'bg-red-500 bg-opacity-10 shadow-[0_0_10px_rgba(239,68,68,0.45)]',
        active && glow === 'green' && 'bg-green-500 bg-opacity-10 shadow-[0_0_10px_rgba(34,197,94,0.45)]',
        active && glow === 'orange' && 'bg-orange-400 bg-opacity-10 shadow-[0_0_10px_rgba(251,146,60,0.45)]',
        pulse && 'animate-pulse',
        className,
      )}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Recording popover (audio / screen)                                */
/* ------------------------------------------------------------------ */
function RecordPopover({
  context,
  open,
  onClose,
  anchorRef,
}: {
  context: ReplContext;
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLButtonElement>;
}) {
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        popRef.current &&
        !popRef.current.contains(e.target as Node) &&
        anchorRef.current &&
        !anchorRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, onClose, anchorRef]);

  if (!open) return null;

  return (
    <div
      ref={popRef}
      className={cx(
        'absolute right-0 top-full mt-2 z-[100]',
        'min-w-[200px] rounded-lg overflow-hidden',
        'bg-background border border-lineHighlight',
        'shadow-[0_8px_32px_rgba(0,0,0,0.6)]',
        'animate-[popoverIn_0.18s_ease-out]',
      )}
    >
      {/* Audio recording */}
      <button
        onClick={() => toggleAudioRecording(context, onClose)}
        disabled={isAudioRecordDisabled(context)}
        className={cx(
          'w-full flex items-center gap-3 px-4 py-3 text-sm text-foreground',
          'transition-all duration-150',
          isAudioRecordDisabled(context) ? 'opacity-30 cursor-not-allowed' : 'hover:bg-lineHighlight cursor-pointer',
          context.isRecording && 'bg-red-500 bg-opacity-10',
        )}
      >
        <MicrophoneIcon
          className={cx('w-4 h-4', context.isRecording ? 'text-red-400' : 'text-foreground opacity-70')}
        />
        <span className="flex-1 text-left">{context.isRecording ? 'Stop Audio' : 'Record Audio'}</span>
        {context.isRecording && (
          <span className="text-xs font-mono text-red-400 tabular-nums">
            {formatElapsedTime(context.recordingElapsedSeconds ?? 0)}
          </span>
        )}
      </button>

      {/* Divider */}
      <div className="h-px bg-lineHighlight mx-3" />

      {/* Screen recording */}
      <button
        onClick={() => toggleScreenRecording(context, onClose)}
        disabled={isScreenRecordDisabled(context)}
        className={cx(
          'w-full flex items-center gap-3 px-4 py-3 text-sm text-foreground',
          'transition-all duration-150',
          isScreenRecordDisabled(context) ? 'opacity-30 cursor-not-allowed' : 'hover:bg-lineHighlight cursor-pointer',
          context.isScreenRecording && 'bg-red-500 bg-opacity-10',
        )}
      >
        <VideoCameraIcon
          className={cx('w-4 h-4', context.isScreenRecording ? 'text-red-400' : 'text-foreground opacity-70')}
        />
        <span className="flex-1 text-left">{context.isScreenRecording ? 'Stop Screen' : 'Record Screen'}</span>
        {context.isScreenRecording && (
          <span className="text-xs font-mono text-red-400 tabular-nums">
            {formatElapsedTime(context.screenRecordingElapsedSeconds ?? 0)}
          </span>
        )}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Update, with the waiting state of a snapped switch (spec 017)     */
/* ------------------------------------------------------------------ */
export function UpdateButton({ context }: { context: ReplContext }) {
  const { t } = useTranslation('settings');
  const waiting = useTransitionPhase() === 'waiting';
  return (
    <IconBtn
      onClick={() => context.handleEvaluate()}
      title={waiting ? `Update (Ctrl+U) — ${t('transitionWaiting')}` : 'Update (Ctrl+U)'}
      active={context.isDirty || waiting}
      glow={waiting ? 'blue' : context.isDirty ? 'orange' : undefined}
      pulse={waiting}
    >
      <ArrowPathIcon className="w-4 h-4 text-foreground opacity-70" />
    </IconBtn>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Header                                                       */
/* ------------------------------------------------------------------ */
export function Header({ context, embedded, trackName }: HeaderProps) {
  const { isZen } = useSettings();
  // On phones the file sidebar and the panel sheet are mutually exclusive (session-only hides).
  const { filesOpen: isFileManagerOpen, toggleFileManager, compact } = usePanelLayout();
  const [recordPopoverOpen, setRecordPopoverOpen] = useState(false);
  const recordBtnRef = useRef<HTMLButtonElement>(null);

  const isAnyRecording = anyRecording(context);
  const recordingSeconds = activeRecordingSeconds(context);

  useEffect(() => {
    if (!isAnyRecording) setRecordPopoverOpen(false);
  }, [isAnyRecording]);

  if (isZen) return null;

  // Phones and upright tablets: a thin title bar; the main controls live in the bottom bar.
  // The /embed REPL keeps the desktop header (out of scope for spec 016).
  if (compact && !embedded) return <CompactTitleBar context={context} trackName={trackName} />;

  return (
    <header
      className={cx(
        'relative z-20 flex items-center h-10 px-3 select-none',
        'bg-background border-b border-lineHighlight',
        'transition-all duration-300',
      )}
    >
      {/* ---- LEFT SIDE ---- */}
      <div className="flex items-center gap-2 min-w-0">
        {/* Logo spinner */}
        <a
          href={`${baseNoTrailing}/`}
          title="Strudel home"
          className={cx(
            'text-lg leading-none text-foreground transition-transform duration-500 hover:rotate-[360deg]',
            context.pending && 'animate-spin',
          )}
        >
          ꩜
        </a>

        {/* Brand */}
        <a
          href={`${baseNoTrailing}/`}
          className="text-sm font-medium text-foreground opacity-80 hover:opacity-100 transition-opacity duration-200 hidden sm:inline"
        >
          strudel
        </a>
        <span className="text-[10px] text-foreground opacity-30 hidden sm:inline">by Dygy</span>

        {/* Files toggle */}
        <IconBtn
          onClick={toggleFileManager}
          title={isFileManagerOpen ? 'Hide files' : 'Show files'}
          active={isFileManagerOpen}
          glow="blue"
        >
          <Bars3Icon className="w-4 h-4 text-foreground opacity-70" />
        </IconBtn>
      </div>

      {/* ---- SPACER ---- */}
      <div className="flex-1" />

      {/* ---- RIGHT SIDE (macOS menu bar style) ---- */}
      <div className="flex items-center gap-1">
        {/* Play / Stop */}
        <IconBtn
          onClick={() => context.handleTogglePlay()}
          title={context.started ? 'Stop (Ctrl+P)' : 'Play (Ctrl+P)'}
          active={context.started}
          glow={context.started ? 'green' : undefined}
        >
          {context.started ? (
            <StopCircleIcon className="w-4 h-4 text-foreground" />
          ) : (
            <PlayCircleIcon className="w-4 h-4 text-foreground" />
          )}
        </IconBtn>

        {/* Update / Evaluate, and the transition the next track switch uses */}
        <UpdateButton context={context} />
        {/* Too wide for a phone header: there, Mixer Settings has the same choices (spec 016's
            compact bar is where the picker goes on phones). */}
        <div className="hidden sm:block">
          <TransitionPicker />
        </div>

        {/* Preview (headphones) — only when mixer is available */}
        {context.mixer && (
          <IconBtn
            onClick={() => context.handlePreviewToggle?.()}
            title={context.isPreviewing ? 'Stop preview' : 'Preview on headphones'}
            active={context.isPreviewing}
            glow={context.isPreviewing ? 'blue' : undefined}
          >
            <EyeIcon className="w-4 h-4 text-foreground opacity-70" />
          </IconBtn>
        )}

        {/* Record button with popover */}
        <div className="relative">
          <button
            ref={recordBtnRef}
            onClick={() => setRecordPopoverOpen((v) => !v)}
            title="Recording options"
            className={cx(
              'relative flex items-center gap-1.5 h-7 rounded-md px-2',
              'transition-all duration-200 ease-out select-none',
              'hover:bg-lineHighlight hover:scale-105 active:scale-95 cursor-pointer',
              isAnyRecording && 'bg-red-500 bg-opacity-10 shadow-[0_0_12px_rgba(239,68,68,0.35)]',
            )}
          >
            <span
              className={cx(
                'w-2 h-2 rounded-full transition-all duration-300',
                isAnyRecording
                  ? 'bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.8)] recording-pulse'
                  : 'bg-foreground opacity-40',
              )}
            />
            {isAnyRecording && (
              <span className="text-[11px] font-mono text-red-400 tabular-nums leading-none">
                {formatElapsedTime(recordingSeconds)}
              </span>
            )}
          </button>

          <RecordPopover
            context={context}
            open={recordPopoverOpen}
            onClose={() => setRecordPopoverOpen(false)}
            anchorRef={recordBtnRef}
          />
        </div>

        {/* Auth */}
        <div className="ml-1">
          <AuthButton className="!p-0" showProfile={true} />
        </div>
      </div>
    </header>
  );
}
