/**
 * @spec: 032-master-fx (functional §2.1 before the first note, §2.3 Stop closes the throws, §2.5 brake on
 *   the speakers' deck, §2.8 the panel after Mixer settings; tech §2.5; task 5.1)
 * The app wiring of the Master FX runtime, checked at the seam as scratchReplWiring.test.ts does
 * (rendering useReplContext would need the whole REPL under mocks; comments are stripped, so a
 * commented-out call counts as removed). The runtime's own behaviour is in masterFxRuntime032.test.ts.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('useReplContext wires the Master FX runtime', () => {
  const source = read('website/src/repl/useReplContext.tsx');

  /** Every `useEffect(() => { … }, [deps]);` body whose dependency list is exactly `deps`. */
  const effectsOn = (deps: string) =>
    [...source.matchAll(/useEffect\(\(\) => \{([\s\S]*?)\}, \[([^\]]*)\]\);/g)]
      .filter((m) => m[2].trim() === deps)
      .map((m) => m[1]);

  it('§2.3: the main repl’s Play/Stop state reaches setPlaying (Stop releases the holds and fades the tails)', () => {
    expect(effectsOn('started').some((body) => /masterFxRuntime\.setPlaying\(Boolean\(started\)\)/.test(body))).toBe(
      true,
    );
  });

  it('§2.3 negative: the headphones’ preview starting or stopping does not drive it', () => {
    expect(source).not.toMatch(/masterFxRuntime\.setPlaying\([^)]*isPreviewing/);
    for (const body of effectsOn('isPreviewing')) expect(body).not.toContain('masterFxRuntime');
  });

  it('§2.1: installed when audio is ready, next to the main EQ (before the first note), and released on unmount', () => {
    expect(source).toMatch(/const releaseMasterFx = masterFxRuntime\.installWhenReady\(audioReady\)/);
    const install = source.indexOf('masterFxRuntime.installWhenReady(audioReady)');
    const eq = source.indexOf('installMainEqualizerWhenReady(audioReady)');
    const cleanup = source.indexOf('releaseMasterFx();');
    expect(eq).toBeGreaterThan(-1);
    expect(install).toBeGreaterThan(eq);
    expect(cleanup).toBeGreaterThan(install);
  });

  it('§2.5: Brake goes through the scratch runtime’s brake (the speakers’ deck), not the selected deck', () => {
    expect(source).toMatch(/brake: \(down\) => scratchRuntime\.brake\(down\)/);
    expect(source).not.toMatch(/masterFxRuntime[\s\S]{0,200}scratchRuntime\.(grab|press)\(/);
  });
});

describe('§2.8: where the panel and the row are mounted', () => {
  it('Settings: Master FX comes right after Mixer settings, before MIDI', () => {
    const tab = read('website/src/repl/components/panel/SettingsTab.tsx');
    const mixer = tab.indexOf('<MixerSettings');
    const fx = tab.indexOf('<MasterFxPanel');
    const midi = tab.indexOf('<MidiSettings');
    expect(mixer).toBeGreaterThan(-1);
    expect(fx).toBeGreaterThan(mixer);
    expect(midi).toBeGreaterThan(fx);
  });

  it('negative: the panel is not disabled while playing (it is played live)', () => {
    const tab = read('website/src/repl/components/panel/SettingsTab.tsx');
    expect(tab).toMatch(/<MasterFxPanel\s*\/>/);
  });

  it('the performance strip shows the Master FX row', () => {
    expect(read('website/src/repl/components/performance/PerformanceStrip.tsx')).toMatch(/<MasterFxRow\s*\/>/);
  });
});
