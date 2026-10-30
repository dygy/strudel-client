/**
 * @vitest-environment jsdom
 *
 * Regression (spec 015 finding 2, fixed 2026-10-10): a failed smooth track transition restored
 * the volume and fell back to an instant switch, but nothing told the user. The manager's
 * error event had no listener. Spec 017: the event now comes from TrackTransitionController,
 * and a broken new track leaves the old one playing (so the message says so).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TrackTransitionController } from '../../../../packages/mixer/TrackTransitionController.mjs';
import { listenForSmoothTransitionErrors, SMOOTH_TRANSITION_ERROR_EVENT } from '../smoothTransitionNotifier';

// The old descriptions said transitions happen "when updating code". Since 2026-10-09 Update on
// the current track is a pure hot-swap and transitions apply only when switching tracks.
const OLD_DESCRIPTIONS: Record<string, string> = {
  en: 'Fade between tracks when updating code',
  ar: 'تلاشي بين المقاطع عند تحديث الكود',
  he: 'דהייה בין רצועות בעת עדכון קוד',
  ru: 'Затухание между треками при обновлении кода',
  zh: '更新代码时在音轨之间淡入淡出',
  ko: '코드 업데이트 시 트랙 간 페이드',
  fr: 'Fondu entre les pistes lors de la mise à jour du code',
  sr: 'Постепено прелажење између нумера при ажурирању кода',
  es: 'Fundido entre pistas al actualizar código',
};
const LOCALES = Object.keys(OLD_DESCRIPTIONS);
// vitest runs from the repo root; import.meta.url is root-relative under Vite, not a file path.
const settingsOf = (locale: string) =>
  JSON.parse(readFileSync(resolve(process.cwd(), `website/src/i18n/locales/${locale}/settings.json`), 'utf-8'));

let stop: (() => void) | undefined;

afterEach(() => {
  stop?.();
  stop = undefined;
  vi.restoreAllMocks();
});

function listen() {
  const warn = vi.fn();
  const translate = vi.fn((key: string) => `t(${key})`);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  stop = listenForSmoothTransitionErrors({ warn, translate });
  return { warn, translate };
}

describe('a failed smooth track transition is shown to the user', () => {
  it('shows a warning with the translated "switched without a fade" message', () => {
    const { warn, translate } = listen();

    window.dispatchEvent(new CustomEvent(SMOOTH_TRANSITION_ERROR_EVENT, { detail: { error: 'boom' } }));

    expect(translate).toHaveBeenCalledWith('settings:smoothTransitionFailed');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      't(settings:smoothTransitionFailed)',
      undefined,
      undefined,
      'smooth-transition-error',
    );
  });

  it('a new track whose code fails says the old track keeps playing, not "switched without a fade"', () => {
    const { warn, translate } = listen();

    window.dispatchEvent(
      new CustomEvent(SMOOTH_TRANSITION_ERROR_EVENT, {
        detail: { error: 'The new track failed to evaluate', evaluateFailed: true },
      }),
    );

    expect(translate).toHaveBeenCalledWith('settings:transitionNewTrackFailed');
    expect(translate).not.toHaveBeenCalledWith('settings:smoothTransitionFailed');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      't(settings:transitionNewTrackFailed)',
      undefined,
      undefined,
      'smooth-transition-new-track-error',
    );
  });

  it('end to end: a new track that fails to evaluate raises the new-track message', async () => {
    const { translate } = listen();
    const scheduler = { started: true, cps: 0.5, pattern: {}, now: () => 9.5, setCps: vi.fn() };
    // Like the real repl: a broken evaluate resolves without ever calling setPattern.
    const repl = { scheduler, state: {}, evaluate: vi.fn(async () => {}), setPattern: vi.fn() };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const controller = new TrackTransitionController({ repl });

    const err = await controller.switchTo('s("bd").nope()', { type: 'crossfade' }).catch((e: unknown) => e);

    expect((err as { evaluateFailed?: boolean }).evaluateFailed).toBe(true);
    expect(repl.setPattern).not.toHaveBeenCalled();
    expect(translate).toHaveBeenCalledWith('settings:transitionNewTrackFailed');
    controller.destroy();
  });

  it('shows nothing when no transition fails, and nothing after it stops listening', () => {
    const { warn } = listen();

    window.dispatchEvent(new CustomEvent('smooth-transition-something-else'));
    stop!();
    stop = undefined;
    window.dispatchEvent(new CustomEvent(SMOOTH_TRANSITION_ERROR_EVENT, { detail: { error: 'boom' } }));

    expect(warn).not.toHaveBeenCalled();
  });

  // The failure that really happens: the audio output is stuck suspended, resume() never
  // settles, and the controller gives up after its 5 s timeout. (repl.evaluate never throws: it
  // reports pattern errors in the editor itself, so a broken pattern is not this path.)
  it('end to end: audio stuck suspended times out, the volume is restored and the warning shows', async () => {
    vi.useFakeTimers();
    try {
      const { warn } = listen();
      const gain = {
        value: 0,
        cancelScheduledValues: vi.fn(),
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
      };
      const repl = { evaluate: vi.fn(async () => {}) };
      vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const stuck = { currentTime: 0, state: 'suspended', resume: () => new Promise(() => {}) };
      const controller = new TrackTransitionController({
        repl,
        audioContext: stuck as unknown as AudioContext,
        destinationGain: { gain } as unknown as GainNode,
      });

      const transition = controller.switchTo('s("bd")', { type: 'dip' });
      const outcome = expect(transition).rejects.toThrow('AudioContext resume timeout');
      await vi.advanceTimersByTimeAsync(5000);
      await outcome;

      // Restored by a short ramp from the current level, never a one-step jump to full.
      expect(gain.setValueAtTime).not.toHaveBeenCalledWith(1, expect.anything());
      expect(gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(1, expect.any(Number));
      expect(repl.evaluate).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('locales', () => {
  it.each(LOCALES)('%s has both failure messages, and they differ', (locale) => {
    const settings = settingsOf(locale);

    expect(typeof settings.smoothTransitionFailed).toBe('string');
    expect(settings.smoothTransitionFailed.length).toBeGreaterThan(0);
    expect(typeof settings.transitionNewTrackFailed).toBe('string');
    expect(settings.transitionNewTrackFailed.length).toBeGreaterThan(0);
    expect(settings.transitionNewTrackFailed).not.toBe(settings.smoothTransitionFailed);
  });

  it.each(LOCALES)('%s no longer has the on/off switch strings or the old "track was stopped" message', (locale) => {
    const settings = settingsOf(locale);

    expect(settings.smoothTransitions).toBeUndefined();
    expect(settings.smoothTransitionsDescription).toBeUndefined();
    expect(settings.smoothTransitionNewTrackFailed).toBeUndefined();
    expect(Object.values(settings)).not.toContain(OLD_DESCRIPTIONS[locale]);
  });

  it('the English message says the previous track keeps playing', () => {
    expect(settingsOf('en').transitionNewTrackFailed).toMatch(/keeps playing/);
  });
});
