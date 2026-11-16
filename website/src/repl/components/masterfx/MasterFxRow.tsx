/**
 * The performance strip's Master FX row (spec 032 §2.8, tech §2.7): the filter knob, the repeat length
 * and the four hold buttons, compact. It wraps (flex-wrap, nothing wider than the strip), so it fits a
 * phone-width strip without scrolling sideways; logical spacing only, so an RTL language mirrors it
 * while the knob stays left-to-right. Same state as the Settings panel and MIDI.
 */
import { useStore } from '@nanostores/react';
import { useTranslation } from '@src/i18n';
import { masterFxRuntime, type MasterFxRuntime } from '../../masterFx/masterFxRuntime';
import { MASTER_FX_REPEAT_LENGTHS } from '../../masterFx/masterFxSettings';
import { FilterKnob } from './FilterKnob';
import { HoldButton } from './HoldButton';
import { FractionSelect } from './MasterFxPanel';

type Runtime = Pick<MasterFxRuntime, 'settings' | 'filter' | 'held' | 'setSettings' | 'setFilter' | 'hold' | 'release'>;

export function MasterFxRow({ runtime = masterFxRuntime }: { runtime?: Runtime }) {
  const { t } = useTranslation('settings');
  const settings = useStore(runtime.settings);
  return (
    <div
      role="group"
      aria-label={t('masterFx.title')}
      data-perf-master-fx=""
      className="flex flex-wrap items-center gap-1 min-w-0 max-w-full"
    >
      <FilterKnob runtime={runtime} strip />
      <FractionSelect
        id="perf-repeat-length"
        label={t('masterFx.repeatLength')}
        value={settings.repeatLength}
        choices={MASTER_FX_REPEAT_LENGTHS}
        onChange={(repeatLength) => runtime.setSettings({ repeatLength })}
        strip
      />
      <HoldButton effect="delay" label={t('masterFx.delay')} runtime={runtime} strip />
      <HoldButton effect="reverb" label={t('masterFx.reverb')} runtime={runtime} strip />
      <HoldButton effect="repeat" label={t('masterFx.repeat')} runtime={runtime} strip />
      <HoldButton effect="brake" label={t('masterFx.brake')} runtime={runtime} strip />
    </div>
  );
}
