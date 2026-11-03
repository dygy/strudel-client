import { useEffect, useRef } from 'react';
import { EyeIcon, MicrophoneIcon, ShareIcon, SparklesIcon, VideoCameraIcon } from '@heroicons/react/24/outline';
import { useStore } from '@nanostores/react';
import cx from '@src/cx';
import { useTranslation } from '@src/i18n';
import { AuthButton } from '../../../components/auth/AuthButton';
import { turnOn } from '../../assistantControl/AllowAssistantSwitch';
import { assistantControlAvailable, assistantControlOn, setAssistantControl } from '../../assistantControl/store';
import { formatElapsedTime } from '../../recording/formatUtils';
import {
  isAudioRecordDisabled,
  isScreenRecordDisabled,
  toggleAudioRecording,
  toggleScreenRecording,
  type RecordContext,
} from '../recordActions';

export interface MoreMenuContext extends RecordContext {
  handleShare: () => void;
  mixer?: unknown;
  isPreviewing?: boolean;
  handlePreviewToggle?: () => void;
}

function MenuItem({
  onClick,
  disabled,
  active,
  icon,
  label,
  trailing,
  ...data
}: {
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  icon: React.ReactNode;
  label: string;
  trailing?: React.ReactNode;
  [dataAttr: `data-${string}`]: string;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={cx(
        'w-full min-h-11 flex items-center gap-3 px-4 text-sm text-foreground text-start',
        disabled ? 'opacity-30 cursor-not-allowed' : 'active:bg-lineHighlight cursor-pointer',
        active && 'bg-red-500 bg-opacity-10',
      )}
      {...data}
    >
      {icon}
      <span className="flex-1 min-w-0 leading-tight">{label}</span>
      {trailing}
    </button>
  );
}

/**
 * The "More" menu of the compact title bar (spec 016 2.1): the header actions used less often
 * during a set. Recording goes through recordActions.ts, the same code as the desktop popover.
 * Closes on an outside pointerdown (mouse, touch or pen) and on Escape.
 */
export function CompactMoreMenu({
  context,
  open,
  onClose,
  anchorRef,
}: {
  context: MoreMenuContext;
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
}) {
  const { t } = useTranslation('common');
  const { t: tSettings } = useTranslation('settings');
  const assistantOn = useStore(assistantControlOn);
  const assistantAvailable = useStore(assistantControlAvailable);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose, anchorRef]);

  if (!open) return null;

  return (
    <div
      ref={menuRef}
      role="menu"
      data-compact-more-menu=""
      className={cx(
        'absolute end-0 top-full mt-1 z-[100] w-64 max-w-[calc(100vw-1rem)] py-1 rounded-lg',
        'bg-background border border-lineHighlight shadow-[0_8px_32px_rgba(0,0,0,0.6)]',
      )}
    >
      <MenuItem
        data-more-record-audio=""
        onClick={() => toggleAudioRecording(context, onClose)}
        disabled={isAudioRecordDisabled(context)}
        active={context.isRecording}
        icon={<MicrophoneIcon className={cx('w-5 h-5', context.isRecording ? 'text-red-400' : 'opacity-70')} />}
        label={context.isRecording ? t('stopRecording') : t('recordAudio')}
        trailing={
          context.isRecording && (
            <span className="text-xs font-mono text-red-400 tabular-nums">
              {formatElapsedTime(context.recordingElapsedSeconds ?? 0)}
            </span>
          )
        }
      />
      <MenuItem
        data-more-record-screen=""
        onClick={() => toggleScreenRecording(context, onClose)}
        disabled={isScreenRecordDisabled(context)}
        active={context.isScreenRecording}
        icon={<VideoCameraIcon className={cx('w-5 h-5', context.isScreenRecording ? 'text-red-400' : 'opacity-70')} />}
        label={context.isScreenRecording ? t('stopRecording') : t('recordScreen')}
        trailing={
          context.isScreenRecording && (
            <span className="text-xs font-mono text-red-400 tabular-nums">
              {formatElapsedTime(context.screenRecordingElapsedSeconds ?? 0)}
            </span>
          )
        }
      />
      {!!context.mixer && (
        <MenuItem
          data-more-preview=""
          onClick={() => {
            context.handlePreviewToggle?.();
            onClose();
          }}
          icon={<EyeIcon className={cx('w-5 h-5', context.isPreviewing ? 'text-blue-400' : 'opacity-70')} />}
          label={context.isPreviewing ? t('stopPreview') : t('preview')}
        />
      )}
      {assistantAvailable && (
        <MenuItem
          data-more-assistant-control=""
          onClick={() => {
            if (assistantOn) setAssistantControl(false);
            else turnOn();
            onClose();
          }}
          active={assistantOn}
          icon={
            <SparklesIcon className={cx('w-5 h-5', assistantOn ? 'text-green-400' : 'text-foreground opacity-70')} />
          }
          label={tSettings('assistantControl.allow')}
          trailing={
            assistantOn && <span className="text-xs text-green-400">{tSettings('assistantControl.onLabel')}</span>
          }
        />
      )}
      <MenuItem
        data-more-share=""
        onClick={() => {
          context.handleShare();
          onClose();
        }}
        icon={<ShareIcon className="w-5 h-5 opacity-70" />}
        label={t('share')}
      />
      <div className="h-px bg-lineHighlight mx-3 my-1" />
      <div className="min-h-11 flex items-center px-4" data-more-auth="">
        <AuthButton showProfile={true} />
      </div>
    </div>
  );
}
