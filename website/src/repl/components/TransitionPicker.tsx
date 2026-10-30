import cx from '@src/cx';
import { useTranslation } from '@src/i18n';
import { setTransitionSettings, useTransitionSettings } from '../../settings';
import {
  TRANSITION_LENGTH_OPTIONS,
  TRANSITION_TYPE_OPTIONS,
  isLengthDisabled,
  isTransitionType,
  transitionTypeLabelKey,
  type TransitionLength,
} from '../transitionSettings';

const selectClass = cx(
  // @tailwindcss/forms pads selects (py-2, end padding for its chevron, mirrored in RTL): zero the
  // vertical padding so the text fits h-7, and keep room at the end so the chevron never covers it.
  'h-7 rounded-md py-0 ps-2 pe-7 leading-none text-xs text-foreground bg-background border border-lineHighlight cursor-pointer',
  'hover:border-foreground focus:outline-none focus:ring-2 focus:ring-foreground',
  'disabled:opacity-40 disabled:cursor-not-allowed',
);

/**
 * The quick transition picker next to Update (spec 017 §2.4): type and length, bound to the same
 * persisted settings as Mixer Settings. Changing it never touches playback; the next switch
 * reads it when it begins. `touch` (spec 016's compact bar): a 44px type select only; Length
 * stays in Mixer Settings so the bar fits a phone.
 */
export function TransitionPicker({ className, touch = false }: { className?: string; touch?: boolean }) {
  const { t } = useTranslation('settings');
  const { type, length } = useTransitionSettings();

  return (
    <div className={cx('flex items-center gap-1', className)} data-transition-picker="">
      <select
        aria-label={t('transitionPicker')}
        title={t('transitionPicker')}
        className={cx(selectClass, 'max-w-[7.5rem]', touch && 'h-11 text-sm')}
        value={type}
        onChange={(e) => {
          const next = e.target.value;
          if (isTransitionType(next)) setTransitionSettings({ type: next });
        }}
      >
        {TRANSITION_TYPE_OPTIONS.map((option) => (
          <option key={option} value={option}>
            {t(transitionTypeLabelKey(option))}
          </option>
        ))}
      </select>
      {!touch && (
        <select
          aria-label={t('transitionPickerLength')}
          title={t('transitionPickerLength')}
          className={selectClass}
          value={length}
          disabled={isLengthDisabled(type)}
          onChange={(e) => setTransitionSettings({ length: Number(e.target.value) as TransitionLength })}
        >
          {TRANSITION_LENGTH_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
