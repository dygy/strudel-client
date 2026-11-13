import { useId } from 'react';
import { useTranslation } from '@src/i18n';
import type { ResolvedEqProfile } from '@strudel/equalizer';
import { describeLines } from './EqualizerPresetDescription';

/** Preset key → its label key, e.g. 'flat' → 'equalizerPresetFlat' (as in the picker). */
const presetLabelKey = (key: string) => `equalizerPreset${key.charAt(0).toUpperCase()}${key.slice(1)}`;

interface EqualizerRecommendationProps {
  /** The settings Apply sets (resolveEqProfile). */
  settings: ResolvedEqProfile;
  /** The preset the track names (a known key), or null. */
  preset: string | null;
  /** The track's own sentence, as written in its code. */
  why: string | null;
  /** The EQ is on and already sounds like the recommendation. */
  applied: boolean;
  /** The EQ is on (Apply turns it on when it is not). */
  isEnabled: boolean;
  compact: boolean;
  onApply: () => void;
}

/**
 * "Track recommends" (spec 024): the listening EQ that the playing track's `// @eq-profile` line
 * recommends: the preset it names, what the settings do in plain words (as under the picker), the
 * track's why sentence and Apply. Nothing changes until Apply. Shown in both layouts.
 */
export function EqualizerRecommendation({
  settings,
  preset,
  why,
  applied,
  isEnabled,
  compact,
  onApply,
}: EqualizerRecommendationProps) {
  const { t } = useTranslation('settings');
  const titleId = useId();
  const lines = describeLines(t, settings);

  return (
    <section
      data-eq-recommendation
      aria-labelledby={titleId}
      className="rounded-lg border border-green-700/60 bg-green-950/30 px-3 py-2 text-xs text-foreground space-y-1"
    >
      <h4 id={titleId} className="text-sm font-medium text-green-400">
        {t('equalizerRecommendTitle')}
      </h4>
      {preset && (
        <div data-eq-recommend="preset">{t('equalizerRecommendPreset', { name: t(presetLabelKey(preset)) })}</div>
      )}
      {lines.flat ? (
        <div data-eq-recommend="flat">{t('equalizerDescribeFlat')}</div>
      ) : (
        <>
          {lines.regions !== '' && <div data-eq-recommend="regions">{lines.regions}</div>}
          {lines.strip !== '' && <div data-eq-recommend="strip">{lines.strip}</div>}
        </>
      )}
      {why && (
        <div data-eq-recommend="why" className="opacity-80">
          <span className="font-medium">{t('equalizerDescribeWhy')}</span> <bdi>{why}</bdi>
        </div>
      )}
      <div className="flex items-center justify-between gap-2 pt-1">
        <span data-eq-recommend="note" className="opacity-60">
          {isEnabled ? '' : t('equalizerRecommendTurnsOn')}
        </span>
        <button
          type="button"
          data-eq-recommend="apply"
          onClick={onApply}
          disabled={applied}
          className={`shrink-0 px-3 py-1.5 rounded-lg font-medium transition-colors ${
            applied ? 'bg-gray-700 text-gray-400 cursor-default' : 'bg-green-600 text-white hover:bg-green-700'
          }${compact ? ' min-h-11 min-w-11' : ''}`}
        >
          {applied ? t('equalizerRecommendApplied') : t('equalizerRecommendApply')}
        </button>
      </div>
    </section>
  );
}
