/**
 * @spec: 022-set-playlist (2.3 Cue and Go, 2.5 missing items; tech §2.3)
 * The set player's state machine: Cue → Go advances; no Go without a Cue; presses while cueing or
 * going are ignored; cancel / select keep or move Up next; Missing items are skipped; End of set;
 * a failed Go doesn't advance; reorder or remove keeps the position by item id.
 */
import { describe, expect, it } from 'vitest';
import {
  buttonMode,
  cancelCue,
  cueFailed,
  cueLanded,
  end,
  goFailed,
  goLanded,
  isEndOfSet,
  itemsChanged,
  NO_SET,
  press,
  restore,
  select,
  start,
  type PlayerSet,
  type SetPlayerState,
} from '../setPlayer';
import type { SetItem } from '../../../lib/setLists';

const it_ = (id: string, trackId = `t-${id}`): SetItem => ({ id, trackId, transition: null });
const set: PlayerSet = { id: 's1', items: [it_('a'), it_('b'), it_('c')] };
const all = () => true;

/** Cue then Go, landing both. */
function cueAndGo(state: SetPlayerState, s: PlayerSet = set): SetPlayerState {
  const cue = press(state, s, all);
  expect(cue.action.kind).toBe('cue');
  const cued = cueLanded(cue.state);
  const go = press(cued, s, all);
  expect(go.action.kind).toBe('go');
  return goLanded(go.state, s);
}

describe('start', () => {
  it('Up next is the first item, or the selected one; nothing on the speakers yet', () => {
    expect(start(set)).toEqual({ setId: 's1', nowItemId: null, nextItemId: 'a', cuedItemId: null, phase: 'idle' });
    expect(start(set, 'b').nextItemId).toBe('b');
    expect(start(set, 'not-in-set').nextItemId).toBe('a');
  });
});

describe('press: Cue then Go', () => {
  it('the first press Cues Up next and the button reads Go once it landed', () => {
    const { state, action } = press(start(set), set, all);
    expect(action).toEqual({ kind: 'cue', itemId: 'a', skippedMissing: false });
    expect(state.phase).toBe('cueing');
    expect(buttonMode(cueLanded(state))).toBe('go');
  });

  it('the second press Goes; then the cued item is Now playing and the next one Up next', () => {
    const after = cueAndGo(start(set));
    expect(after).toEqual({ setId: 's1', nowItemId: 'a', nextItemId: 'b', cuedItemId: null, phase: 'idle' });
    expect(buttonMode(after)).toBe('cue');
    expect(cueAndGo(after)).toMatchObject({ nowItemId: 'b', nextItemId: 'c' });
  });

  it('there is no Go without a Cue: from idle a press always Cues', () => {
    const after = cueAndGo(start(set));
    expect(press(after, set, all).action.kind).toBe('cue');
  });

  it('ignores presses while cueing or going (a double press is one Cue)', () => {
    const cueing = press(start(set), set, all).state;
    expect(press(cueing, set, all)).toEqual({ state: cueing, action: { kind: 'none', reason: 'busy' } });
    const going = press(cueLanded(cueing), set, all).state;
    expect(going.phase).toBe('going');
    expect(press(going, set, all).action).toEqual({ kind: 'none', reason: 'busy' });
  });

  it('does nothing when no set plays, or for another set', () => {
    expect(press(NO_SET, set, all).action).toEqual({ kind: 'none', reason: 'not-playing' });
    expect(press(start(set), { id: 's2', items: set.items }, all).action.kind).toBe('none');
    expect(press(start(set), null, all).action.kind).toBe('none');
  });
});

describe('failures', () => {
  it('a failed Cue goes back to Cue with Up next unchanged', () => {
    const cueing = press(start(set), set, all).state;
    expect(cueFailed(cueing)).toMatchObject({ phase: 'idle', nextItemId: 'a', cuedItemId: null });
  });

  it('a failed Go does not advance: Now playing unchanged and the button still reads Go', () => {
    const first = cueAndGo(start(set));
    const going = press(cueLanded(press(first, set, all).state), set, all).state;
    const failed = goFailed(going);
    expect(failed).toMatchObject({ phase: 'cued', nowItemId: 'a', cuedItemId: 'b' });
    expect(buttonMode(failed)).toBe('go');
    // Fixed and pressed again: Goes to the same item.
    expect(press(failed, set, all).action).toEqual({ kind: 'go', itemId: 'b' });
  });
});

describe('cancel and select', () => {
  it('cancelling a cue keeps Up next and the button reads Cue', () => {
    const cued = cueLanded(press(start(set), set, all).state);
    const cancelled = cancelCue(cued);
    expect(cancelled).toMatchObject({ phase: 'idle', nextItemId: 'a', cuedItemId: null });
    expect(buttonMode(cancelled)).toBe('cue');
  });

  it('cancel does nothing when nothing is cued', () => {
    const idle = start(set);
    expect(cancelCue(idle)).toBe(idle);
  });

  it('selecting an item while cued cancels the cue and makes it Up next', () => {
    const cued = cueLanded(press(cueAndGo(start(set)), set, all).state);
    const { state, cancelled } = select(cued, set, 'c');
    expect(cancelled).toBe(true);
    expect(state).toMatchObject({ phase: 'idle', nextItemId: 'c', cuedItemId: null, nowItemId: 'a' });
  });

  it('selecting while idle only moves Up next; an unknown item or another set is ignored', () => {
    const idle = start(set);
    expect(select(idle, set, 'c')).toEqual({ state: { ...idle, nextItemId: 'c' }, cancelled: false });
    expect(select(idle, set, 'zzz').state).toBe(idle);
    expect(select(idle, { id: 's2', items: set.items }, 'c').state).toBe(idle);
  });
});

describe('missing items and the end of the set', () => {
  it('skips a Missing Up next, cues the next playable one and says so', () => {
    const playable = (item: SetItem) => item.id !== 'b';
    const now = cueAndGo(start(set));
    const { state, action } = press(now, set, playable);
    expect(action).toEqual({ kind: 'cue', itemId: 'c', skippedMissing: true });
    expect(state.nextItemId).toBe('c');
  });

  it('with nothing playable left it is End of set and nothing happens', () => {
    const now = cueAndGo(start(set));
    const { state, action } = press(now, set, (item) => item.id === 'a');
    expect(action).toEqual({ kind: 'none', reason: 'end-of-set' });
    expect(isEndOfSet(state)).toBe(true);
  });

  it('when the last item is Now playing, the bar shows End of set and a press does nothing', () => {
    let state = start(set);
    for (let i = 0; i < 3; i++) state = cueAndGo(state);
    expect(state).toMatchObject({ nowItemId: 'c', nextItemId: null });
    expect(isEndOfSet(state)).toBe(true);
    expect(press(state, set, all).action).toEqual({ kind: 'none', reason: 'end-of-set' });
  });

  it('an empty set is End of set at once', () => {
    const empty = { id: 's1', items: [] };
    expect(isEndOfSet(start(empty))).toBe(true);
  });
});

describe('itemsChanged: the position follows item ids', () => {
  it('a reorder keeps Now playing, Up next and the cue', () => {
    const now = cueAndGo(start(set)); // now a, next b
    const reordered = { id: 's1', items: [it_('c'), it_('b'), it_('a')] };
    expect(itemsChanged(now, reordered).state).toMatchObject({ nowItemId: 'a', nextItemId: 'b' });
  });

  it('removing Up next makes the item after Now playing Up next', () => {
    const now = cueAndGo(start(set));
    const removed = { id: 's1', items: [it_('a'), it_('c')] };
    expect(itemsChanged(now, removed).state.nextItemId).toBe('c');
  });

  it('removing the cued item cancels the cue', () => {
    const cued = cueLanded(press(cueAndGo(start(set)), set, all).state); // b cued
    const { state, cueRemoved } = itemsChanged(cued, { id: 's1', items: [it_('a'), it_('c')] });
    expect(cueRemoved).toBe(true);
    expect(state).toMatchObject({ phase: 'idle', cuedItemId: null, nextItemId: 'c' });
  });

  it('adding an item after the last one ends End of set', () => {
    let state = start(set);
    for (let i = 0; i < 3; i++) state = cueAndGo(state);
    const grown = { id: 's1', items: [...set.items, it_('d')] };
    expect(itemsChanged(state, grown).state.nextItemId).toBe('d');
  });

  it('ignores another set', () => {
    const state = start(set);
    expect(itemsChanged(state, { id: 's2', items: [] }).state).toBe(state);
  });
});

describe('restore and end', () => {
  it('restores Now playing and Up next, nothing cued', () => {
    expect(restore(set, { nowItemId: 'b', nextItemId: 'c' })).toEqual({
      setId: 's1',
      nowItemId: 'b',
      nextItemId: 'c',
      cuedItemId: null,
      phase: 'idle',
    });
  });

  it('drops ids that are no longer in the set', () => {
    expect(restore(set, { nowItemId: 'gone', nextItemId: 'gone2' })).toMatchObject({
      nowItemId: null,
      nextItemId: 'a',
    });
    expect(restore(set, { nowItemId: 'b', nextItemId: 'gone' }).nextItemId).toBe('c');
  });

  it('end hides the set', () => {
    expect(end()).toEqual(NO_SET);
  });
});
