import { useTranslation } from '@src/i18n';
import type { EqualizerSlotName } from '@strudel/equalizer';

interface EqualizerListeningControlsProps {
  /** The slot heard and edited now. */
  activeSlot: EqualizerSlotName;
  onSwitchSlot: (slot: EqualizerSlotName) => void;
  /** Copy the active slot into the other one. */
  onCopySlot: () => void;
  spectrumOn: boolean;
  onSpectrumChange: (on: boolean) => void;
  recordPostEq: boolean;
  onRecordPostEqChange: (on: boolean) => void;
  /** Phone layout: 44px touch targets. */
  compact: boolean;
}

const SLOTS: readonly EqualizerSlotName[] = ['A', 'B'];

/**
 * The EQ's listening tools (spec 026), in both layouts: the A | B slots with the Copy button, the
 * Spectrum toggle, and Record as heard. UI only: the panel owns the state and the audio.
 */
export function EqualizerListeningControls({
  activeSlot,
  onSwitchSlot,
  onCopySlot,
  spectrumOn,
  onSpectrumChange,
  recordPostEq,
  onRecordPostEqChange,
  compact,
}: EqualizerListeningControlsProps) {
  const { t } = useTranslation('settings');
  const target = compact ? ' min-h-11 min-w-11' : '';
  const checkboxClass = `accent-green-500 cursor-pointer${compact ? ' w-6 h-6' : ' w-4 h-4'}`;
  const label = (slot: EqualizerSlotName) => t(slot === 'A' ? 'equalizerSlotA' : 'equalizerSlotB');

  return (
    <div className="space-y-2 p-3 bg-gray-900 border border-gray-700 rounded-lg" data-eq-listening>
      <div className="flex flex-wrap items-center gap-2">
        <div
          role="group"
          aria-label={t('equalizerSlotsHint')}
          title={t('equalizerSlotsHint')}
          className="inline-flex rounded-lg border border-gray-700 overflow-hidden"
          data-eq-slots
        >
          {SLOTS.map((slot) => (
            <button
              key={slot}
              type="button"
              data-eq-slot={slot}
              aria-pressed={slot === activeSlot}
              aria-label={label(slot)}
              onClick={() => onSwitchSlot(slot)}
              className={`px-4 py-1 text-sm font-mono font-medium transition-colors${target} ${
                slot === activeSlot ? 'bg-green-600 text-white' : 'bg-gray-800 text-foreground hover:bg-gray-700'
              }`}
            >
              {slot}
            </button>
          ))}
        </div>
        <button
          type="button"
          data-eq-slot-copy
          onClick={onCopySlot}
          className={`px-3 py-1 rounded-lg border border-gray-700 bg-gray-800 text-sm text-foreground hover:bg-gray-700 transition-colors${target}`}
        >
          {t(activeSlot === 'A' ? 'equalizerCopyAtoB' : 'equalizerCopyBtoA')}
        </button>
      </div>
      <p className="text-xs text-gray-500">{t('equalizerSlotsHint')}</p>

      <label
        className={`flex items-center gap-2 text-sm text-foreground cursor-pointer${compact ? ' min-h-11' : ''}`}
        title={t('equalizerSpectrumHint')}
      >
        <input
          type="checkbox"
          data-eq-spectrum
          checked={spectrumOn}
          onChange={(e) => onSpectrumChange(e.target.checked)}
          className={checkboxClass}
        />
        <span>{t('equalizerSpectrum')}</span>
      </label>

      <label className={`flex items-start gap-2 text-sm text-foreground cursor-pointer${compact ? ' min-h-11' : ''}`}>
        <input
          type="checkbox"
          data-record-post-eq
          checked={recordPostEq}
          onChange={(e) => onRecordPostEqChange(e.target.checked)}
          className={`${checkboxClass} mt-0.5`}
        />
        <span>
          <span className="block">{t('recordPostEq')}</span>
          <span className="block text-xs text-gray-500">{t('recordPostEqHint')}</span>
        </span>
      </label>
    </div>
  );
}
