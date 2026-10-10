/**
 * @vitest-environment jsdom
 *
 * Regression (spec 015 finding 2, fixed 2026-10-10): a failed smooth track transition restored
 * the volume and fell back to an instant switch, but nothing told the user. The manager's
 * error event had no listener.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SmoothTransitionManager } from '../../../../packages/mixer/SmoothTransitionManager.mjs';
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

  it('shows nothing when no transition fails, and nothing after it stops listening', () => {
    const { warn } = listen();

    window.dispatchEvent(new CustomEvent('smooth-transition-something-else'));
    stop!();
    stop = undefined;
    window.dispatchEvent(new CustomEvent(SMOOTH_TRANSITION_ERROR_EVENT, { detail: { error: 'boom' } }));

    expect(warn).not.toHaveBeenCalled();
  });

  // The failure that really happens: the audio output is stuck suspended, resume() never
  // settles, and the manager gives up after its 5 s timeout. (repl.evaluate never throws: it
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
      const manager = new SmoothTransitionManager(stuck, repl, {
        destinationGain: { gain },
        enabled: true,
        duration: 0.5,
      });

      const transition = manager.executeTransition('s("bd")');
      const outcome = expect(transition).rejects.toThrow('AudioContext resume timeout');
      await vi.advanceTimersByTimeAsync(5000);
      await outcome;

      expect(gain.setValueAtTime).toHaveBeenLastCalledWith(1, 0);
      expect(repl.evaluate).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('locales', () => {
  it.each(LOCALES)('%s has the failure message and a description that no longer says "updating code"', (locale) => {
    const settings = settingsOf(locale);

    expect(typeof settings.smoothTransitionFailed).toBe('string');
    expect(settings.smoothTransitionFailed.length).toBeGreaterThan(0);
    expect(settings.smoothTransitionsDescription).toBeTruthy();
    expect(settings.smoothTransitionsDescription).not.toBe(OLD_DESCRIPTIONS[locale]);
  });

  it('the English description says transitions apply when switching tracks, not when updating code', () => {
    expect(settingsOf('en').smoothTransitionsDescription).toMatch(/switching tracks/);
    expect(settingsOf('en').smoothTransitionsDescription).not.toMatch(/updating code/);
  });
});
