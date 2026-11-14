import type { ReactNode } from 'react';
import cx from '@src/cx';
import { useTranslation } from '@src/i18n';
import { setTransitionSettings, useTransitionSettings } from '../../../settings';
import {
  TRANSITION_LENGTH_OPTIONS,
  TRANSITION_SNAP_OPTIONS,
  TRANSITION_TEMPO_OPTIONS,
  TRANSITION_TYPE_OPTIONS,
  areModifiersDisabled,
  isLengthDisabled,
  isTempoOptionDisabled,
  transitionSnapLabelKey,
  transitionTempoDescriptionKey,
  transitionTempoLabelKey,
  transitionTypeDescriptionKey,
  transitionTypeLabelKey,
} from '../../transitionSettings';
import { usePanelViewport } from './panelViewport';

/** One radio option drawn as a button-like chip (the input stays reachable by keyboard). */
function Choice({
  name,
  checked,
  onSelect,
  touch,
  disabled = false,
  dimmed = disabled,
  align = 'center',
  children,
}: {
  name: string;
  checked: boolean;
  onSelect: () => void;
  touch: boolean;
  /** One option that can't be chosen (the fieldset disables a whole group). */
  disabled?: boolean;
  /**
   * Draw the option greyed out. Defaults to `disabled`; false while the enclosing fieldset is
   * already dimmed, so the option isn't dimmed twice (review 027, finding 2).
   */
  dimmed?: boolean;
  /** `start`: a label with a description line under it (Tempo). */
  align?: 'center' | 'start';
  children: ReactNode;
}) {
  return (
    <label
      className={cx(
        'relative flex min-w-0 px-2 py-1.5 rounded-md text-sm text-foreground select-none',
        align === 'center' ? 'items-center justify-center text-center' : 'flex-col items-start text-start',
        'border transition-colors duration-150 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-foreground',
        checked
          ? 'border-foreground bg-lineHighlight font-medium'
          : 'border-lineHighlight opacity-80 hover:opacity-100',
        disabled ? 'cursor-not-allowed' : 'cursor-pointer',
        dimmed && '!opacity-40',
        touch && 'min-h-11',
      )}
    >
      <input type="radio" name={name} checked={checked} disabled={disabled} onChange={onSelect} className="sr-only" />
      {children}
    </label>
  );
}

/**
 * Mixer Settings → Transition (spec 017 §2.1–2.3, spec 027): the type, Length in cycles, Snap to
 * (phrases counted from the playing track's start), Tempo and Match loudness. Bound to the persisted settings store, so the picker next to Update
 * shows the same choice. Never disabled while music plays: the type can change mid-set.
 */
export function TransitionSettingsSection() {
  const { t } = useTranslation('settings');
  const { compact } = usePanelViewport();
  const settings = useTransitionSettings();
  const lengthDisabled = isLengthDisabled(settings.type);
  const modifiersDisabled = areModifiersDisabled(settings.type);

  return (
    <div className="p-4 bg-background border border-lineHighlight rounded-lg space-y-4" data-transition-settings="">
      <fieldset>
        <legend className="text-sm font-medium text-foreground mb-2">{t('transition')}</legend>
        <div role="radiogroup" aria-label={t('transition')} className="grid grid-cols-2 gap-1">
          {TRANSITION_TYPE_OPTIONS.map((type) => (
            <Choice
              key={type}
              name="transition-type"
              checked={settings.type === type}
              onSelect={() => setTransitionSettings({ type })}
              touch={compact}
            >
              <span data-transition-type={type}>{t(transitionTypeLabelKey(type))}</span>
            </Choice>
          ))}
        </div>
        <p className="text-xs text-foreground opacity-70 mt-2" aria-live="polite" data-transition-description="">
          {t(transitionTypeDescriptionKey(settings.type))}
        </p>
      </fieldset>

      <fieldset disabled={lengthDisabled} className={cx(lengthDisabled && 'opacity-40')} data-transition-length="">
        <legend className="text-sm font-medium text-foreground mb-2">{t('transitionLength')}</legend>
        <div role="radiogroup" aria-label={t('transitionLength')} className="grid grid-cols-5 gap-1">
          {TRANSITION_LENGTH_OPTIONS.map((length) => (
            <Choice
              key={length}
              name="transition-length"
              checked={settings.length === length}
              onSelect={() => setTransitionSettings({ length })}
              touch={compact}
            >
              {length}
            </Choice>
          ))}
        </div>
      </fieldset>

      <fieldset disabled={modifiersDisabled} className={cx('space-y-3', modifiersDisabled && 'opacity-40')}>
        <div data-transition-snap="">
          <div className="text-sm font-medium text-foreground mb-2">{t('transitionSnap')}</div>
          <div role="radiogroup" aria-label={t('transitionSnap')} className="grid grid-cols-3 sm:grid-cols-5 gap-1">
            {TRANSITION_SNAP_OPTIONS.map((snap) => (
              <Choice
                key={snap}
                name="transition-snap"
                checked={settings.snap === snap}
                onSelect={() => setTransitionSettings({ snap })}
                touch={compact}
              >
                <span data-transition-snap-option={snap}>{t(transitionSnapLabelKey(snap))}</span>
              </Choice>
            ))}
          </div>
          <p className="text-xs text-foreground opacity-70 mt-2" data-transition-snap-description="">
            {t('transitionSnapDescription')}
          </p>
        </div>

        <div data-transition-tempo="">
          <div className="text-sm font-medium text-foreground mb-2">{t('transitionTempo')}</div>
          <div role="radiogroup" aria-label={t('transitionTempo')} className="grid grid-cols-1 sm:grid-cols-2 gap-1">
            {TRANSITION_TEMPO_OPTIONS.map((tempo) => (
              <Choice
                key={tempo}
                name="transition-tempo"
                checked={settings.tempo === tempo}
                disabled={isTempoOptionDisabled(settings.type, tempo)}
                dimmed={!modifiersDisabled && isTempoOptionDisabled(settings.type, tempo)}
                onSelect={() => setTransitionSettings({ tempo })}
                touch={compact}
                align="start"
              >
                <span className="block" data-transition-tempo-option={tempo}>
                  {t(transitionTempoLabelKey(tempo))}
                </span>
                <span className="block text-xs font-normal opacity-70">{t(transitionTempoDescriptionKey(tempo))}</span>
              </Choice>
            ))}
          </div>
        </div>

        <label className="flex items-start gap-2 cursor-pointer" data-transition-match-loudness="">
          <input
            type="checkbox"
            className={cx('mt-0.5 accent-foreground', compact && 'w-5 h-5')}
            checked={settings.matchLoudness}
            onChange={(e) => setTransitionSettings({ matchLoudness: e.target.checked })}
          />
          <span>
            <span className="block text-sm text-foreground">{t('transitionMatchLoudness')}</span>
            <span className="block text-xs text-foreground opacity-70">{t('transitionMatchLoudnessDescription')}</span>
          </span>
        </label>
      </fieldset>
    </div>
  );
}
