import React from 'react';
import { audioEngineTargets } from '../../../settings';
import { SelectInput } from './SelectInput';
import { usePanelViewport } from './panelViewport';

interface AudioEngineTargetSelectorProps {
  target: string;
  onChange: (target: string) => void;
  isDisabled?: boolean;
}

// Allows the user to select an audio interface for Strudel to play through
export function AudioEngineTargetSelector({ target, onChange, isDisabled }: AudioEngineTargetSelectorProps) {
  const { compact } = usePanelViewport();
  const onTargetChange = (target: string) => {
    onChange(target);
  };

  const options = new Map([
    [audioEngineTargets.webaudio, audioEngineTargets.webaudio],
    [audioEngineTargets.osc, audioEngineTargets.osc],
  ]);

  return (
    // Compact: a 44px touch target for the shared SelectInput, set from this wrapper.
    <div className={compact ? ' flex flex-col gap-1 [&_select]:min-h-11' : ' flex flex-col gap-1'}>
      <SelectInput isDisabled={!!isDisabled} options={options} value={target} onChange={onTargetChange} />
      {target === audioEngineTargets.osc && (
        <div>
          <p className="text-sm italic">
            ⚠ All events routed to OSC, audio is silenced! See{' '}
            <a className="text-blue-500" href="https://strudel.cc/learn/input-output/">
              Docs
            </a>
          </p>
        </div>
      )}
    </div>
  );
}
