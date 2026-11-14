/**
 * @spec: 027-tempo-phrase-sync (2.1; tech §2.1 step 4, §2.2)
 * Snap boundaries count from the playing track's own cycle 0, which includes the speakers deck's
 * scratch shift. useReplContext hands the transition controller a getTrackShift that reads it
 * from the scratch runtime (checked in its source, comments stripped, like the 019/023 wiring
 * tests, because rendering the hook needs the whole REPL).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const strip = (code: string) =>
  code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\s+/g, ' ');
const flat = strip(readFileSync(resolve(__dirname, '../useReplContext.tsx'), 'utf8'));

/** The options object of `new TrackTransitionController({ ... })`. */
function controllerOptions(source: string): string {
  const match = source.match(/new TrackTransitionController\(\{(.*?)\}\);/);
  return match?.[1] ?? '';
}

const GET_TRACK_SHIFT = /getTrackShift: \(\) => scratchRuntime\.mainShift\(\),/;

describe('useReplContext gives the transition controller the speakers scratch shift', () => {
  it('the controller is constructed with getTrackShift reading scratchRuntime.mainShift()', () => {
    const options = controllerOptions(flat);
    expect(options).toMatch(/getSettings: getTransitionSettings,/);
    expect(options).toMatch(GET_TRACK_SHIFT);
  });

  it('negative: a construction without it (or reading another deck) is caught', () => {
    const without = strip(
      `controller = new TrackTransitionController({ repl, audioContext, getSettings: getTransitionSettings, });`,
    );
    expect(controllerOptions(without)).not.toMatch(GET_TRACK_SHIFT);
    const otherDeck = strip(
      `controller = new TrackTransitionController({ repl, getTrackShift: () => scratchRuntime.previewShiftCycles(), });`,
    );
    expect(controllerOptions(otherDeck)).not.toMatch(GET_TRACK_SHIFT);
  });
});
