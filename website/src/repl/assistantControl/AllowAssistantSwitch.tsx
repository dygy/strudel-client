/** The switch, and the indicator that shows while it's on, with its one-press way to turn it off. */
import { useStore } from '@nanostores/react';
import { getAudioContext } from '@strudel/webaudio';
import cx from '@src/cx';
import { useTranslation } from '@src/i18n';
import { assistantControlAvailable, assistantControlOn, setAssistantControl } from './store';

/** Pressing the switch counts as the click a browser asks for before a page may make sound. */
export function turnOn() {
  setAssistantControl(true);
  void getAudioContext()
    .resume()
    .catch((error: unknown) => console.warn('[assistant control] the audio could not start yet:', error));
}

export function AllowAssistantSwitch() {
  const { t } = useTranslation('settings');
  const on = useStore(assistantControlOn);
  const available = useStore(assistantControlAvailable);
  if (!available) return null;
  return (
    <div className="space-y-1" data-testid="allow-assistant-control">
      <label className="flex items-center gap-2 min-h-11 sm:min-h-0 text-sm text-foreground cursor-pointer">
        <input
          type="checkbox"
          role="switch"
          checked={on}
          onChange={(event) => (event.target.checked ? turnOn() : setAssistantControl(false))}
        />
        {t('assistantControl.allow')}
      </label>
      <p className="text-xs text-foreground opacity-70 leading-relaxed">{t('assistantControl.help')}</p>
    </div>
  );
}

export function AssistantControlIndicator({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation('settings');
  const on = useStore(assistantControlOn);
  if (!on) return null;
  return (
    <div
      data-testid="assistant-control-indicator"
      role="status"
      className={cx(
        'flex items-center gap-1 text-xs text-foreground whitespace-nowrap',
        compact ? 'ps-2 pe-0' : 'ps-2 pe-1 py-0.5 rounded-md border border-green-500/60',
      )}
    >
      <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" aria-hidden="true" />
      <span className={compact ? 'sr-only' : undefined}>{t('assistantControl.indicator')}</span>
      <button
        type="button"
        data-testid="assistant-control-off"
        onClick={() => setAssistantControl(false)}
        aria-label={t('assistantControl.turnOff')}
        className={cx(
          'rounded text-foreground hover:bg-lineHighlight active:bg-lineHighlight',
          compact ? 'h-11 px-2' : 'px-1.5',
        )}
      >
        {t('assistantControl.off')}
      </button>
    </div>
  );
}
