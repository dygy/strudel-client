import { useEffect, useState } from 'react';
import { useTranslation } from '@src/i18n';
import { describeSettings, EQUALIZER_PRESETS, type CutConfig, type EqualizerRegion } from '@strudel/equalizer';

const REGION_KEYS: Record<EqualizerRegion, string> = {
  sub: 'equalizerRegionSub',
  bass: 'equalizerRegionBass',
  lowMid: 'equalizerRegionLowMid',
  mid: 'equalizerRegionMid',
  presence: 'equalizerRegionPresence',
  air: 'equalizerRegionAir',
};

/** The live region repeats the description this long after the last change (ms), once per gesture. */
export const ANNOUNCE_DELAY_MS = 500;

/** Left-to-right isolate: keeps "−8 dB" and "14 kHz" in order inside Hebrew and Arabic text. */
const ltr = (text: string) => `\u2066${text}\u2069`;

const trimNumber = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, ''));

/** "+16 dB", "−4 dB" (a real minus sign), "−5.5 dB". */
export function formatDescribeDb(db: number): string {
  const sign = db > 0 ? '+' : db < 0 ? '−' : '';
  return `${sign}${trimNumber(Math.abs(db))} dB`;
}

/** "25 Hz", "14 kHz", "12.5 kHz". */
export function formatDescribeHz(hz: number): string {
  return hz < 1000 ? `${Math.round(hz)} Hz` : `${trimNumber(Math.round(hz / 100) / 10)} kHz`;
}

/** `equalizerWhy<Key>`, for a preset key. */
export const whyKey = (preset: string) => `equalizerWhy${preset.charAt(0).toUpperCase()}${preset.slice(1)}`;

/** The settings a description is written from. */
export interface DescribedSettings {
  bands: { frequency: number; gain: number }[];
  lowCut: CutConfig;
  highCut: CutConfig;
  outputGain: number;
}

/**
 * The description's lines for `settings`, in the app language: `regions` ("Sub +16 dB · Low mids −4 dB")
 * and `strip` (cuts and output), each '' when there is nothing in it, and `flat` when there is nothing
 * at all. Used under the picker and in the track's recommendation (spec 024).
 */
export function describeLines(t: (key: string, options?: any) => string, settings: DescribedSettings) {
  const description = describeSettings(settings);
  const regions = description.regions.map(({ region, dB }) =>
    t('equalizerDescribeRegion', { region: t(REGION_KEYS[region]), value: ltr(formatDescribeDb(dB)) }),
  );
  const strip: string[] = [];
  if (description.lowCut !== undefined) {
    strip.push(t('equalizerDescribeLowCut', { value: ltr(formatDescribeHz(description.lowCut)) }));
  }
  if (description.highCut !== undefined) {
    strip.push(t('equalizerDescribeHighCut', { value: ltr(formatDescribeHz(description.highCut)) }));
  }
  if (description.outputGain !== undefined) {
    strip.push(t('equalizerDescribeOutput', { value: ltr(formatDescribeDb(description.outputGain)) }));
  }
  return { flat: description.flat, regions: regions.join(' · '), strip: strip.join(' · ') };
}

interface EqualizerPresetDescriptionProps {
  bands: { frequency: number; gain: number }[];
  lowCut: CutConfig;
  highCut: CutConfig;
  outputGain: number;
  /** The selected preset key, or 'custom'. */
  activePreset: string;
}

/**
 * Under the preset picker (spec 021): what the current settings do, in plain words (the regions
 * boosted or cut by 2 dB or more, the cuts that are on, the output level), and, while a genre preset
 * is selected, one sentence on why that shaping suits the genre. Shown in both layouts. Screen readers
 * get the summary and the why (not the title) from one polite, atomic live region, debounced.
 */
export function EqualizerPresetDescription({
  bands,
  lowCut,
  highCut,
  outputGain,
  activePreset,
}: EqualizerPresetDescriptionProps) {
  const { t } = useTranslation('settings');
  const description = describeLines(t, { bands, lowCut, highCut, outputGain });

  const isGenre = EQUALIZER_PRESETS[activePreset]?.group === 'genre';
  const why = isGenre ? `${t('equalizerDescribeWhy')} ${t(whyKey(activePreset))}` : null;

  // What a screen reader hears: the summary lines and the why, without the title. A slider drag
  // re-renders this on every input, so the live text follows ANNOUNCE_DELAY_MS after the last
  // change (one announcement per gesture); the visible lines update at once.
  const lines = description.flat
    ? [t('equalizerDescribeFlat')]
    : [description.regions, description.strip].filter((line) => line !== '');
  const liveText = [...lines, ...(why ? [why] : [])].join('. ');
  const [announced, setAnnounced] = useState(liveText);
  useEffect(() => {
    if (liveText === announced) return;
    const timer = setTimeout(() => setAnnounced(liveText), ANNOUNCE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [liveText, announced]);

  return (
    <div
      data-eq-description
      className="mt-2 rounded-lg border border-gray-700 bg-gray-900/60 px-3 py-2 text-xs text-foreground space-y-1"
    >
      <div className="font-medium opacity-70">{t('equalizerDescribeTitle')}</div>
      {/* Visible lines: hidden from screen readers, which read the live region below instead. */}
      <div aria-hidden="true" className="space-y-1">
        {description.flat ? (
          <div data-eq-describe="flat">{t('equalizerDescribeFlat')}</div>
        ) : (
          <>
            {description.regions !== '' && <div data-eq-describe="regions">{description.regions}</div>}
            {description.strip !== '' && <div data-eq-describe="strip">{description.strip}</div>}
          </>
        )}
        {isGenre && (
          <div data-eq-describe="why" className="text-green-400">
            <span className="font-medium">{t('equalizerDescribeWhy')}</span> {t(whyKey(activePreset))}
          </div>
        )}
      </div>
      <div data-eq-describe-live role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announced}
      </div>
    </div>
  );
}
