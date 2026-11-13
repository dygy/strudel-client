/**
 * ScratchController - one API for every scratch input (spec 019, tech §2.4).
 *
 * Platter pointer, wheel, keyboard and MIDI jog all call `grab / moveBy / setMotor / release`
 * here; the controller forwards them to the selected deck (`'main'` speakers or `'preview'`
 * headphones). The website creates one instance (a module singleton); the package does not.
 *
 * Holds are per input source: the deck stays grabbed while any source holds it, and a
 * source's release or auto-release drops only that source. So a pointer-up does not let go of
 * a record the keyboard holds, and a wheel's idle release does not let go of one the mouse holds.
 *
 * @license AGPL-3.0-or-later
 */

/** Deck names. */
export const SCRATCH_DECKS = Object.freeze(['main', 'preview']);

/**
 * The input sources the website uses. Any non-empty string works as a source; calls without
 * one use `'default'` (the pre-per-source behaviour).
 */
export const SCRATCH_SOURCES = Object.freeze(['pointer', 'key', 'wheel', 'midi', 'default']);

const DEFAULT_SOURCE = 'default';
const sourceOf = (source) => (typeof source === 'string' && source !== '' ? source : DEFAULT_SOURCE);

/**
 * @typedef {object} ScratchState
 * @property {boolean} grabbed - Any deck is held.
 * @property {'main'|'preview'} selected - The deck inputs act on.
 * @property {{main: boolean, preview: boolean}} available - Which decks are attached.
 */

/**
 * Routes scratch input to the selected deck and reports state changes.
 *
 * Events (`on('change', fn)`): `fn(state)` whenever {@link ScratchState} changes (grab,
 * release, selection, a deck added, attached or removed). Moves do not emit.
 *
 * @example
 * const scratch = new ScratchController();
 * scratch.setDeck('main', mainDeck);
 * scratch.grab('wheel');
 * scratch.moveBy(-0.06, 'wheel');
 * scratch.autoRelease(250, 'wheel'); // the wheel lets go 250 ms after its last move
 */
export class ScratchController {
  constructor() {
    /** @type {{main: import('./ScratchDeck.mjs').ScratchDeck|null, preview: import('./ScratchDeck.mjs').ScratchDeck|null}} */
    this._decks = { main: null, preview: null };
    this._deckUnsubs = { main: null, preview: null };
    this._selected = 'main';
    this._listeners = new Set();
    /** Sources holding the selected deck. */
    this._holds = new Set();
    /** Per-source auto-release: source → { ms, timer }. */
    this._auto = new Map();
    this._lastKey = '';
  }

  /**
   * Set or clear (`null`) a deck. A replaced deck is released first.
   * @param {'main'|'preview'} name
   * @param {import('./ScratchDeck.mjs').ScratchDeck|null} deck
   */
  setDeck(name, deck) {
    if (!SCRATCH_DECKS.includes(name)) {
      console.warn(`[ScratchController] unknown deck "${name}"`);
      return;
    }
    const old = this._decks[name];
    if (old === deck) return;
    if (old) {
      this._deckUnsubs[name]?.();
      this._deckUnsubs[name] = null;
      if (name === this._selected) this._dropAllHolds();
      old.release();
    }
    this._decks[name] = deck ?? null;
    if (deck && typeof deck.on === 'function') {
      this._deckUnsubs[name] = deck.on('change', () => this._onDeckChange(name));
    }
    this._emit();
  }

  /**
   * The deck registered under `name`, or null.
   * @param {'main'|'preview'} name
   */
  getDeck(name) {
    return this._decks[name] ?? null;
  }

  /** The deck inputs act on: `'main'` (speakers, default) or `'preview'` (headphones). */
  get selected() {
    return this._selected;
  }

  /** Select a deck. Switching while held lets go of the previous deck (every source). Unknown names are ignored. */
  set selected(name) {
    if (!SCRATCH_DECKS.includes(name)) {
      console.warn(`[ScratchController] unknown deck "${name}"`);
      return;
    }
    if (name === this._selected) return;
    this._dropAllHolds();
    this._decks[this._selected]?.release();
    this._selected = name;
    this._emit();
  }

  /** @returns {ScratchState} */
  get state() {
    const { main, preview } = this._decks;
    return {
      grabbed: Boolean(main?.isGrabbed || preview?.isGrabbed),
      selected: this._selected,
      available: { main: Boolean(main?.isAttached), preview: Boolean(preview?.isAttached) },
    };
  }

  /** True while any deck is held. */
  get isGrabbed() {
    return this.state.grabbed;
  }

  /** The sources currently holding the selected deck. */
  get holders() {
    return [...this._holds];
  }

  /**
   * Grab the selected deck on behalf of `source`. No-op when the deck is missing or not attached.
   * @param {string} [source='default'] - e.g. `'pointer' | 'key' | 'wheel' | 'midi'`.
   * @returns {boolean} Whether the selected deck is now held.
   */
  grab(source) {
    const deck = this._decks[this._selected];
    if (!deck) return false;
    const ok = deck.grab();
    if (ok) this._holds.add(sourceOf(source));
    return ok;
  }

  /**
   * Move the selected deck by `seconds` of audio; re-arms `source`'s pending {@link autoRelease}.
   * @param {number} seconds
   * @param {string} [source='default']
   */
  moveBy(seconds, source) {
    const deck = this._decks[this._selected];
    if (!deck) return;
    deck.moveBy(seconds);
    const auto = this._auto.get(sourceOf(source));
    if (auto && deck.isGrabbed) this._armAuto(sourceOf(source), auto.ms);
  }

  /**
   * Turn the selected deck continuously at `rate` × normal speed.
   * @param {number} rate
   * @param {string} [source='default'] - Accepted for symmetry; the motor belongs to the deck.
   */
  // eslint-disable-next-line no-unused-vars
  setMotor(rate, source) {
    this._decks[this._selected]?.setMotor(rate);
  }

  /**
   * `source` lets go (and its auto-release is cancelled). The deck is released only when no
   * other source still holds it.
   * @param {string} [source='default']
   */
  release(source) {
    const src = sourceOf(source);
    this._clearAuto(src);
    this._holds.delete(src);
    if (this._holds.size === 0) this._decks[this._selected]?.release();
  }

  /**
   * Every source lets go of every deck (before stop, evaluate and track switches).
   *
   * A release that was already spinning up (spec 023) is cancelled by default: the deck goes
   * back to live and its lag is never applied, so nothing pending can shift a pattern after a
   * stop or switch. With `commitPending` (an Update or Ctrl+Enter is about to evaluate), its
   * planned lag is applied now instead, with a quick hand-over, so the track keeps the scratch;
   * a track switch then drops it anyway (the new track starts at its own cycle 0). A record
   * still held when this is called is let go and its release cancelled either way.
   * @param {{commitPending?: boolean}} [options]
   */
  releaseAll(options) {
    this._dropAllHolds();
    for (const name of SCRATCH_DECKS) {
      const deck = this._decks[name];
      const spinningUp = deck?.phase === 'releasing';
      deck?.release();
      if (options?.commitPending && spinningUp && typeof deck?.commitPending === 'function') deck.commitPending();
      else deck?.cancelPending?.();
    }
  }

  /**
   * Arm (or re-arm) an idle release for `source`: it lets go `ms` after its last
   * {@link moveBy}. Wheel and MIDI jog use 250 ms. It drops only `source`, so a deck another
   * source holds stays grabbed. Cleared by that source's release, releaseAll and selection.
   * @param {number} ms
   * @param {string} [source='default']
   */
  autoRelease(ms, source) {
    if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return;
    this._armAuto(sourceOf(source), ms);
  }

  /**
   * Subscribe to state changes.
   * @param {'change'} event
   * @param {(state: ScratchState) => void} fn
   * @returns {() => void} Unsubscribe.
   */
  on(event, fn) {
    if (event !== 'change' || typeof fn !== 'function') return () => {};
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  /** @private */
  _armAuto(source, ms) {
    this._clearAuto(source);
    const timer = setTimeout(() => {
      this._auto.delete(source);
      this.release(source);
    }, ms);
    this._auto.set(source, { ms, timer });
  }

  /** @private */
  _clearAuto(source) {
    const auto = this._auto.get(source);
    if (auto) clearTimeout(auto.timer);
    this._auto.delete(source);
  }

  /** @private */
  _dropAllHolds() {
    for (const { timer } of this._auto.values()) clearTimeout(timer);
    this._auto.clear();
    this._holds.clear();
  }

  /** @private A deck let go by itself (destroy, direct release): its holds are gone. */
  _onDeckChange(name) {
    if (name === this._selected && !this._decks[name]?.isGrabbed) this._dropAllHolds();
    this._emit();
  }

  /** @private Emit only when the state actually changed. */
  _emit() {
    const state = this.state;
    const key = `${state.grabbed}|${state.selected}|${state.available.main}|${state.available.preview}`;
    if (key === this._lastKey) return;
    this._lastKey = key;
    for (const fn of [...this._listeners]) {
      try {
        fn(state);
      } catch (err) {
        console.error('[ScratchController] change listener failed:', err);
      }
    }
  }
}
