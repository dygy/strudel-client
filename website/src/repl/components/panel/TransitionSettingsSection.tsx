import type { ReactNode } from 'react';
import cx from '@src/cx';
import { useTranslation } from '@src/i18n';
import { setTransitionSettings, useTransitionSettings } from '../../../settings';
import {
  TRANSITION_LENGTH_OPTIONS,
  TRANSITION_SNAP_OPTIONS,
  TRANSITION_TYPE_OPTIONS,
  areModifiersDisabled,
  isGlideDisabled,
  isLengthDisabled,
  transitionSnapLabelKey,
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
  children,
}: {
  name: string;
  checked: boolean;
  onSelect: () => void;
  touch: boolean;
  children: ReactNode;
}) {
  return (
    <label
      className={cx(
        'relative flex items-center justify-center px-2 py-1.5 rounded-md text-sm text-foreground cursor-pointer select-none',
        'border transition-colors duration-150 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-foreground',
        checked
          ? 'border-foreground bg-lineHighlight font-medium'
          : 'border-lineHighlight opacity-80 hover:opacity-100',
        touch && 'min-h-11',
      )}
    >
      <input type="radio" name={name} checked={checked} onChange={onSelect} className="sr-only" />
      {children}
    </label>
  );
}

/**
 * Mixer Settings → Transition (spec 017 §2.1–2.3): the type, Length in cycles, Snap to, Tempo
 * glide and Match loudness. Bound to the persisted settings store, so the picker next to Update
 * shows the same choice. Never disabled while music plays: the type can change mid-set.
 */
export function TransitionSettingsSection() {
  const { t } = useTranslation('settings');
  const { compact } = usePanelViewport();
  const settings = useTransitionSettings();
  const lengthDisabled = isLengthDisabled(settings.type);
  const modifiersDisabled = areModifiersDisabled(settings.type);
  const glideDisabled = isGlideDisabled(settings.type);

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
          <div role="radiogroup" aria-label={t('transitionSnap')} className="grid grid-cols-2 sm:grid-cols-4 gap-1">
            {TRANSITION_SNAP_OPTIONS.map((snap) => (
              <Choice
                key={snap}
                name="transition-snap"
                checked={settings.snap === snap}
                onSelect={() => setTransitionSettings({ snap })}
                touch={compact}
              >
                {t(transitionSnapLabelKey(snap))}
              </Choice>
            ))}
          </div>
        </div>

        <label
          className={cx('flex items-start gap-2 cursor-pointer', glideDisabled && 'opacity-40 cursor-not-allowed')}
          data-transition-glide=""
        >
          <input
            type="checkbox"
            className={cx('mt-0.5 accent-foreground', compact && 'w-5 h-5')}
            checked={settings.glide}
            disabled={glideDisabled}
            onChange={(e) => setTransitionSettings({ glide: e.target.checked })}
          />
          <span>
            <span className="block text-sm text-foreground">{t('transitionGlide')}</span>
            <span className="block text-xs text-foreground opacity-70">{t('transitionGlideDescription')}</span>
          </span>
        </label>

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
