/**
 * spec 008 (/fix 2026-11-12): the headphone PreviewEngine applies the saved EQ settings when it
 * initialises, so the preview is equalised without the settings panel having been opened.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getDefaultSettings, saveEqualizerSettings } from '@strudel/equalizer';
import { PreviewEngine } from '../PreviewEngine.mjs';
import { MockAudioContext, stubWebAudio, unstubWebAudio } from './webAudioMock.mjs';

const BAND_125 = 2;

class FakeController {
  constructor(ac) {
    this.output = { destinationGain: ac.createGain() };
  }
}

function engine(ac) {
  return new PreviewEngine(ac, {
    SuperdoughAudioController: FakeController,
    superdough: vi.fn(),
    repl: () => ({ evaluate: vi.fn(), stop: vi.fn() }),
    getTime: () => ac.currentTime,
  });
}

const applied = (eq) => eq.bands.map((b) => b.filter.gain.value);

function saveWithBand125(gain, isEnabled) {
  const settings = getDefaultSettings();
  settings.bands[BAND_125].gain = gain;
  saveEqualizerSettings({ ...settings, isEnabled, preset: 'custom' });
}

describe('PreviewEngine applies the saved EQ on initialize (spec 008)', () => {
  let ac;
  let preview;

  beforeEach(() => {
    stubWebAudio();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    ac = new MockAudioContext();
  });
  afterEach(() => {
    preview?.destroy();
    vi.restoreAllMocks();
    unstubWebAudio();
  });

  it('a saved +12 dB at 125 Hz is applied without opening the panel', async () => {
    saveWithBand125(12, true);
    preview = engine(ac);
    await preview.initialize();

    expect(applied(preview.equalizer)[BAND_125]).toBe(12);
  });

  it('an EQ saved as off stays flat but keeps the curve', async () => {
    saveWithBand125(12, false);
    preview = engine(ac);
    await preview.initialize();

    expect(applied(preview.equalizer)).toEqual(Array(10).fill(0));
    expect(preview.equalizer.getState().bands[BAND_125].gain).toBe(12);
  });

  it('without saved settings the preview EQ is flat', async () => {
    preview = engine(ac);
    await preview.initialize();

    expect(applied(preview.equalizer)).toEqual(Array(10).fill(0));
  });
});
