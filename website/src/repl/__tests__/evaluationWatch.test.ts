/**
 * @spec: 018-strudel-mcp-server (functional 2.8)
 * What assistants are told about evaluates in flight. It only ever watches: a human's Update must behave
 * as if it weren't there, so the promise and the timing are what's tested first.
 */
import { describe, expect, it, vi } from 'vitest';
import { createEvaluationWatch, isMusicChanging, STUCK_AFTER_MS } from '../evaluationWatch';

function setup() {
  let time = 1_000;
  const finishers: Array<{ resolve: (value?: unknown) => void; reject: (error: unknown) => void }> = [];
  const repl = {
    evaluate: vi.fn(
      (..._args: unknown[]) =>
        new Promise((resolve, reject) => {
          finishers.push({ resolve, reject });
        }),
    ),
  };
  const original = repl.evaluate;
  const watch = createEvaluationWatch(() => time);
  watch.watch(repl as never);
  return { repl, original, watch, finishers, advance: (ms: number) => (time += ms) };
}

const tick = () => new Promise((resolve) => setTimeout(resolve));

describe('watching changes nothing', () => {
  it('gives back the very promise the repl made, with the same arguments', async () => {
    const { repl, original, finishers } = setup();
    const returned: unknown[] = [];
    original.mockImplementationOnce((...args: unknown[]) => {
      const promise = new Promise((resolve, reject) => finishers.push({ resolve, reject }));
      returned.push(promise, args);
      return promise;
    });
    const result = repl.evaluate('code', false);
    expect(result).toBe(returned[0]);
    expect(returned[1]).toEqual(['code', false]);
  });

  it('calls the repl at once, before anything else can happen', () => {
    const { repl, original } = setup();
    repl.evaluate('code');
    expect(original).toHaveBeenCalledOnce();
  });

  it('leaves a rejection for the caller to see', async () => {
    const { repl, finishers, watch } = setup();
    const result = repl.evaluate('code');
    finishers[0].reject(new Error('no'));
    await expect(result).rejects.toThrow('no');
    await tick();
    expect(watch.isLive()).toBe(false);
  });

  it('does not wrap the same repl twice', () => {
    const { repl, watch, original } = setup();
    watch.watch(repl as never);
    repl.evaluate('code');
    expect(original).toHaveBeenCalledOnce();
  });
});

describe('what it says', () => {
  it('live while an evaluate is going, and not after', async () => {
    const { repl, watch, finishers } = setup();
    expect(watch.isLive()).toBe(false);
    repl.evaluate('code');
    expect(watch.isLive()).toBe(true);
    finishers[0].resolve();
    await tick();
    expect(watch.isLive()).toBe(false);
    expect(watch.hasStuck()).toBe(false);
  });

  it('stuck, and no longer live, past the bound', () => {
    const { repl, watch, advance } = setup();
    repl.evaluate('hangs');
    advance(STUCK_AFTER_MS - 1);
    expect(watch.isLive()).toBe(true);
    advance(1);
    expect(watch.isLive()).toBe(false);
    expect(watch.hasStuck()).toBe(true);
  });

  it('settled resolves when those going now have finished, and never rejects', async () => {
    const { repl, watch, finishers } = setup();
    repl.evaluate('one').catch(() => {});
    repl.evaluate('two');
    let settled = false;
    void watch.settled().then(() => (settled = true));
    finishers[0].reject(new Error('no'));
    await tick();
    expect(settled).toBe(false);
    finishers[1].resolve();
    await tick();
    expect(settled).toBe(true);
  });
});

describe('isMusicChanging', () => {
  const idle = { isLive: () => false, hasStuck: () => false };
  const live = { isLive: () => true, hasStuck: () => false };
  const stuck = { isLive: () => false, hasStuck: () => true };
  const none = { transitionActive: false, switchUnderWay: false };

  it('no while nothing is happening', () => {
    expect(isMusicChanging(idle, none)).toBe(false);
  });
  it('yes while an evaluate is going, with no transition at all (the Off type)', () => {
    expect(isMusicChanging(live, none)).toBe(true);
  });
  it('yes for a real transition, however long it takes, even with a hang behind it', () => {
    expect(isMusicChanging(stuck, { ...none, transitionActive: true })).toBe(true);
  });
  it('yes in the moments before an evaluate starts', () => {
    expect(isMusicChanging(idle, { ...none, switchUnderWay: true })).toBe(true);
  });
  it('no once a hang outlasts the bound, so assistants are unblocked', () => {
    expect(isMusicChanging(stuck, { ...none, switchUnderWay: true })).toBe(false);
  });
});
