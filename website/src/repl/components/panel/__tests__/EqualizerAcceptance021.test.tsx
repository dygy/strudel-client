// @vitest-environment jsdom
/**
 * @spec: 021-eq-genre-presets-transparency (functional §2.1–2.3, task 4.1)
 * Acceptance-level panel tests that EqualizerDescription021.test / presets.test / describe.test do
 * not already cover: every group's exact members in the picker, Amapiano on both EQs, a saved
 * Phonk (and a saved new preset) surviving a reload unchanged, a preset switch that glides and
 * stays within 3 dB of Flat, the Reset button reading "No change: flat", every language naming
 * every preset and family, and a signed-out user getting all families and descriptions.
 * Each test names the criterion it covers (AC <section>.<n>, in functional-spec order).
 * Audio continuity itself (no audible click) is browser-measured; here the unit-level part is that
 * every parameter change is a glide (setTargetAtTime), never a step.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

// Node >= 25 ships its own global `localStorage`, which shadows jsdom's (see EqualizerCompact.test).
vi.hoisted(() => {
  const jsdomStorage = (globalThis as { jsdom?: { window: Window } }).jsdom?.window.localStorage;
  if (jsdomStorage && !globalThis.localStorage) {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: jsdomStorage });
  }
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import i18n from '@src/i18n/i18n';
import { AudioEqualizer, EQUALIZER_PRESETS, getDefaultSettings, pinkNoiseLoudnessDb } from '@strudel/equalizer';
// @ts-expect-error untyped .mjs test helper shared with @strudel/mixer
import { MockAudioContext } from '../../../../../../packages/mixer/test/webAudioMock.mjs';
import { destroyMainEqualizer, initMainEqualizer } from '../../../mainEqualizer';
import { EqualizerUI } from '../EqualizerUI';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const STORAGE_KEY = 'strudel-equalizer-settings';
const LANGUAGES = ['en', 'es', 'fr', 'ru', 'sr', 'he', 'ar', 'zh', 'ko'];

/** Functional spec §2.1, as tech §2.1 keys, in picker order. */
const SPEC_GROUPS: Record<string, string[]> = {
  'Brazilian & Latin': [
    'brazilianFunk',
    'automotivo',
    'montagem',
    'funkAgressivo',
    'mandelao',
    'bruxaria',
    'mandelaoSlowed',
    'funkCariocaOldSchool',
    'baileFunk',
    'reggaeton',
    'dembow',
    'cumbia',
    'afroHouse',
    'amapiano',
  ],
  'Phonk, Hip-Hop & Trap': [
    'phonk',
    'driftPhonk',
    'trap',
    'brazilianPhonk',
    'housePhonk',
    'memphis',
    'boomBap',
    'lofiHipHop',
    'ukDrill',
    'nyDrill',
    'rage',
    'plugg',
    'cloudRap',
    'jerseyClub',
  ],
  'Electronic & Club': [
    'electro',
    'techno',
    'drumAndBass',
    'dubstep',
    'house',
    'deepHouse',
    'techHouse',
    'minimal',
    'hardTechno',
    'trance',
    'psytrance',
    'hardstyle',
    'gabber',
    'ukGarage',
    'jungle',
    'breakbeat',
    'synthwave',
    'hyperpop',
    'futureBass',
    'riddim',
  ],
  'Live & Other': [
    'rockGenre',
    'metal',
    'punk',
    'usFunk',
    'disco',
    'soul',
    'reggae',
    'dub',
    'ambient',
    'chillout',
    'lofi',
  ],
};
const GENRE_KEYS = Object.values(SPEC_GROUPS).flat();

/** Phonk exactly as spec 020 shipped it (literal, so a change to the preset itself shows up here). */
const PHONK_020 = { gains: [12, 10, 3, -2, -3, 0, 4, 5, 1, -2], highCut: 13000, outputGain: -6 };

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let ac: any;
let main: AudioEqualizer;
let preview: AudioEqualizer;

const q = <T extends Element = HTMLElement>(sel: string) => container!.querySelector<T>(sel);
const text = (sel: string) => (q(sel)?.textContent ?? '').replace(/[⁦-⁩]/g, '');
/** The why sentence alone, without its translated "Why:" label. */
const whySentence = () => {
  const why = q('[data-eq-describe="why"]');
  return (why?.textContent ?? '').replace(why?.querySelector('span')?.textContent ?? '', '').trim();
};
const selectValue = () => q<HTMLSelectElement>('select')!.value;
const appliedBands = (eq: AudioEqualizer) => (eq as any).bands.map((b: any) => b.filter.gain.value);
const outputLinear = (eq: AudioEqualizer) => (eq as any).outputGainNode.gain.value;
const toLinear = (db: number) => Math.pow(10, db / 20);

/** Every parameter a preset moves: ten band gains, the cut frequencies, the output level. */
const presetParams = (eq: AudioEqualizer): any[] => [
  ...(eq as any).bands.map((b: any) => b.filter.gain),
  ...(eq as any).lowCutFilters.map((f: any) => f.frequency),
  ...(eq as any).highCutFilters.map((f: any) => f.frequency),
  (eq as any).outputGainNode.gain,
];
const clearCalls = () => [main, preview].forEach((eq) => presetParams(eq).forEach((p) => (p.calls.length = 0)));
const steps = (eq: AudioEqualizer) =>
  presetParams(eq).flatMap((p) => p.calls.filter(([m]: [string]) => m === 'value=' || m === 'setValueAtTime'));
const glideCount = (eq: AudioEqualizer) =>
  presetParams(eq).reduce((n, p) => n + p.calls.filter(([m]: [string]) => m === 'setTargetAtTime').length, 0);
const allCalls = (eq: AudioEqualizer) => presetParams(eq).reduce((n, p) => n + p.calls.length, 0);

const setViewport = (width: number, height: number) => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: height });
};

function render() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<EqualizerUI previewEngine={{ equalizer: preview }} />));
}

function pick(preset: string) {
  act(() => {
    const select = q<HTMLSelectElement>('select')!;
    select.value = preset;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

/** Recreate the EQs and the panel, as a reload does (the main EQ loads the save when created). */
function reload() {
  act(() => root?.unmount());
  container?.remove();
  root = container = null;
  destroyMainEqualizer();
  main = initMainEqualizer(ac as unknown as AudioContext, { setOutputInsert: vi.fn() });
  preview = new AudioEqualizer(ac as unknown as AudioContext);
  render();
}

const resetButton = () =>
  [...container!.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('Reset to Flat'))!;

async function switchLanguage(lang: string) {
  await act(async () => {
    await i18n.changeLanguage(lang);
    await i18n.loadNamespaces('settings');
  });
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
  await i18n.loadNamespaces('settings');
  localStorage.clear();
  setViewport(1440, 900);
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  ac = new MockAudioContext();
  main = initMainEqualizer(ac as unknown as AudioContext, { setOutputInsert: vi.fn() });
  preview = new AudioEqualizer(ac as unknown as AudioContext);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(async () => {
  act(() => root?.unmount());
  container?.remove();
  root = container = null;
  destroyMainEqualizer();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  await i18n.changeLanguage('en');
});

describe('§2.1 genre presets in four families', () => {
  it('AC 2.1.1: each family group holds exactly the spec presets in the spec order, then the 22 profiles', () => {
    render();
    const groups = [...container!.querySelectorAll('optgroup')];
    const byLabel = Object.fromEntries(
      groups.map((g) => [g.getAttribute('label'), [...g.querySelectorAll('option')].map((o) => o.value)]),
    );
    expect(groups.map((g) => g.getAttribute('label'))).toEqual([...Object.keys(SPEC_GROUPS), 'Listening profiles']);
    for (const [label, keys] of Object.entries(SPEC_GROUPS)) expect([label, byLabel[label]]).toEqual([label, keys]);
    expect(byLabel['Listening profiles']).toHaveLength(22);
  });

  it('AC 2.1.1 (negative): no preset is listed twice, none sits outside a group, and no profile is in a family', () => {
    render();
    const values = [...container!.querySelectorAll('option')].map((o) => o.value);
    expect(new Set(values).size).toBe(values.length);
    expect(container!.querySelectorAll('select > option')).toHaveLength(0);
    const profiles = [...container!.querySelectorAll('optgroup:last-of-type option')].map((o) =>
      o.getAttribute('value'),
    );
    expect(profiles.filter((key) => GENRE_KEYS.includes(key!))).toEqual([]);
    expect(GENRE_KEYS.filter((key) => profiles.includes(key))).toEqual([]);
  });

  it('AC 2.1.2: picking Amapiano sets its bands, cuts and output on the speakers EQ too, and the picker shows it', () => {
    render();
    pick('amapiano');
    const p = EQUALIZER_PRESETS.amapiano;
    expect(selectValue()).toBe('amapiano');
    for (const eq of [main, preview]) {
      expect(appliedBands(eq)).toEqual(p.gains);
      expect(eq.getState().lowCut).toEqual({ enabled: p.lowCut != null, frequency: p.lowCut ?? 80 });
      expect(eq.getState().highCut.enabled).toBe(p.highCut != null);
      expect(outputLinear(eq)).toBeCloseTo(toLinear(p.outputGain!), 6);
    }
  });

  it('AC 2.1.2 (negative): a value that is not a preset changes nothing on either EQ and keeps the picker', () => {
    render();
    pick('amapiano');
    clearCalls();
    pick('notAPreset');
    expect(selectValue()).toBe('amapiano');
    expect([allCalls(main), allCalls(preview)]).toEqual([0, 0]);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).preset).toBe('amapiano');
  });

  it('AC 2.1.3: a Phonk selection saved before spec 021 is still Phonk after a reload, with the spec 020 sound', () => {
    // What spec 020's panel saved for Phonk.
    const bands = getDefaultSettings().bands.map((b, i) => ({ ...b, gain: PHONK_020.gains[i] }));
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        isEnabled: true,
        preset: 'phonk',
        bands,
        lowCut: { enabled: false, frequency: 80 },
        highCut: { enabled: true, frequency: PHONK_020.highCut },
        outputGain: PHONK_020.outputGain,
      }),
    );
    reload();

    expect(selectValue()).toBe('phonk');
    expect(text('[data-eq-describe="why"]')).not.toBe('');
    for (const eq of [main, preview]) {
      expect(appliedBands(eq)).toEqual(PHONK_020.gains);
      expect(eq.getState().highCut).toEqual({ enabled: true, frequency: PHONK_020.highCut });
      expect(eq.getState().lowCut.enabled).toBe(false);
      expect(outputLinear(eq)).toBeCloseTo(toLinear(PHONK_020.outputGain), 6);
    }
    // Picking Phonk again today gives the same sound as the save.
    pick('phonk');
    expect(appliedBands(main)).toEqual(PHONK_020.gains);
    expect(main.getState().outputGain).toBe(PHONK_020.outputGain);
  });

  it('AC 2.1.3: a new preset picked today (Amapiano) is still selected after a reload', () => {
    render();
    pick('amapiano');
    reload();
    expect(selectValue()).toBe('amapiano');
    expect(appliedBands(main)).toEqual(EQUALIZER_PRESETS.amapiano.gains);
    expect(text('[data-eq-describe="why"]')).toContain('log drum');
  });

  it('AC 2.1.3 (negative): a saved key that is no preset loads as Custom with its bands kept, not as a wrong preset', () => {
    const bands = getDefaultSettings().bands.map((b, i) => ({ ...b, gain: PHONK_020.gains[i] }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ isEnabled: true, preset: 'phonkGenre', bands }));
    reload();
    expect(selectValue()).toBe('custom');
    expect(q('[data-eq-describe="why"]')).toBeNull();
    expect(appliedBands(main)).toEqual(PHONK_020.gains);
  });

  it('AC 2.1.4 (unit level; the click itself is browser-measured): switching through every genre preset glides every band, cut and output on both EQs, and each lands within 3 dB of Flat', () => {
    render();
    pick('flat');
    const order = [...GENRE_KEYS, 'flat', 'pop', 'driftPhonk', 'bassBoost'];
    for (const key of order) {
      clearCalls();
      pick(key);
      for (const eq of [main, preview]) {
        expect([key, steps(eq)]).toEqual([key, []]);
        expect(glideCount(eq)).toBeGreaterThanOrEqual(10);
      }
      // Loudness is pinned for the genre presets and Flat (tech §2.1). Four listening profiles
      // (acoustic, bassBoost, piano, rnb) measure 3.2–3.7 dB and are out of scope (functional §3).
      if (key === 'flat' || GENRE_KEYS.includes(key)) {
        const loudness = pinkNoiseLoudnessDb(main.getState());
        expect([key, Math.abs(loudness) <= 3]).toEqual([key, true]);
      }
    }
  });

  it('AC 2.1.4 (negative): the loudness check bites: Amapiano as picked, but without its output level, is > 3 dB louder than Flat', () => {
    render();
    pick('amapiano');
    expect(pinkNoiseLoudnessDb({ ...main.getState(), outputGain: 0 })).toBeGreaterThan(3);
  });
});

describe('§2.2 what the preset does', () => {
  it('AC 2.2.3: the Reset to Flat button, confirmed, makes the description read "No change: flat"', () => {
    vi.stubGlobal('confirm', () => true);
    render();
    pick('driftPhonk');
    act(() => resetButton().click());
    expect(selectValue()).toBe('flat');
    expect(text('[data-eq-describe="flat"]')).toBe('No change: flat');
    expect(q('[data-eq-describe="regions"]')).toBeNull();
    expect(q('[data-eq-describe="strip"]')).toBeNull();
    expect(q('[data-eq-describe="why"]')).toBeNull();
  });

  it('AC 2.2.3 (negative): a cancelled reset keeps the preset and its description', () => {
    vi.stubGlobal('confirm', () => false);
    render();
    pick('driftPhonk');
    act(() => resetButton().click());
    expect(selectValue()).toBe('driftPhonk');
    expect(q('[data-eq-describe="flat"]')).toBeNull();
    expect(text('[data-eq-describe="strip"]')).toBe('Low cut 25 Hz · High cut 14 kHz · Output −8 dB');
  });

  it('AC 2.2.5 (negative): on a phone, a listening profile shows no why and Flat reads "No change: flat"', () => {
    setViewport(390, 844);
    render();
    expect(q('[data-eq-compact]')).not.toBeNull();
    expect(text('[data-eq-describe="flat"]')).toBe('No change: flat');
    pick('pop');
    expect(text('[data-eq-describe="regions"]')).toBe('Low mids +3 dB · Mids +3 dB');
    expect(q('[data-eq-describe="why"]')).toBeNull();
  });
});

describe('§2.3 languages and signed-out users', () => {
  it.each(LANGUAGES)(
    'AC 2.3.1: in %s every preset and family has a name and every genre preset a why sentence',
    async (lang) => {
      render();
      await switchLanguage(lang);
      const labels = [...container!.querySelectorAll('optgroup')].map((g) => g.getAttribute('label') ?? '');
      const names = [...container!.querySelectorAll('option')].map((o) => [o.value, o.textContent ?? '']);
      expect(labels.filter((l) => l.trim() === '' || /^equalizer/.test(l))).toEqual([]);
      expect(names.filter(([, n]) => n.trim() === '' || /^equalizer/.test(n))).toEqual([]);
      for (const key of GENRE_KEYS) {
        pick(key);
        const why = whySentence();
        expect([key, why.trim() !== '' && !/equalizerWhy/.test(why)]).toEqual([key, true]);
      }
    },
  );

  it.each(LANGUAGES.filter((lang) => lang !== 'en'))(
    'AC 2.3.1 (negative): in %s the families and the why are not left in English',
    async (lang) => {
      render();
      pick('driftPhonk');
      const english = {
        labels: [...container!.querySelectorAll('optgroup')].slice(0, 4).map((g) => g.getAttribute('label')),
        why: whySentence(),
      };
      expect(english.why).toContain('cowbell');
      await switchLanguage(lang);
      const labels = [...container!.querySelectorAll('optgroup')].slice(0, 4).map((g) => g.getAttribute('label'));
      expect(labels.filter((l, i) => l === english.labels[i])).toEqual([]);
      expect(whySentence()).not.toBe('');
      expect(whySentence()).not.toBe(english.why);
    },
  );

  // Rendered with no auth provider, no Supabase and no signed-in user (the store starts empty).
  it('AC 2.3.2: signed out, all four families with all 59 genre presets and their descriptions are there', () => {
    render();
    const familyGroups = [...container!.querySelectorAll('optgroup')].slice(0, 4);
    expect(familyGroups.map((g) => g.getAttribute('label'))).toEqual(Object.keys(SPEC_GROUPS));
    expect(familyGroups.flatMap((g) => [...g.querySelectorAll('option')])).toHaveLength(59);
    expect(text('[data-eq-describe="flat"]')).toBe('No change: flat');
    for (const key of GENRE_KEYS) {
      pick(key);
      expect([key, q('[data-eq-describe="why"]') !== null]).toEqual([key, true]);
      expect([key, q('[data-eq-describe="regions"]') ?? q('[data-eq-describe="strip"]')]).not.toEqual([key, null]);
    }
  });

  // SettingsTab-eq020.test.tsx shows the mixer section (which mounts the EQ) signed out and in the
  // admin read-only view; this pins that none of the spec 021 modules looks at sign-in either.
  it('AC 2.3.2 (negative): the description, the summary and the presets do not depend on sign-in', () => {
    const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');
    for (const file of [
      'website/src/repl/components/panel/EqualizerPresetDescription.tsx',
      'website/src/repl/components/panel/EqualizerUI.tsx',
      'packages/equalizer/describe.ts',
      'packages/equalizer/presets.ts',
    ]) {
      // Case-sensitive `readOnly` (the prop): TypeScript's `readonly` keyword is fine.
      expect([file, read(file)]).not.toEqual([
        file,
        expect.stringMatching(/useAuth|[Ss]upabase|isAuthenticated|readOnly/),
      ]);
    }
  });
});
