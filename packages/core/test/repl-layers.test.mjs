/*
repl-layers.test.mjs - fork addition (spec 017): repl.state.layers exposes the `$:` / `.p(id)` layers
*/

import { describe, it, expect, beforeAll } from 'vitest';
import { repl } from '../repl.mjs';
import { evalScope } from '../evaluate.mjs';
import * as core from '../index.mjs';

const noop = () => {};

// No transpiler: the code must be a single JS expression, so layers are chained with the comma operator.
const makeRepl = (opts = {}) =>
  repl({
    getTime: () => 0,
    defaultOutput: noop,
    setInterval: () => 0,
    clearInterval: noop,
    ...opts,
  });

const values = (pat) =>
  pat
    .queryArc(0, 1)
    .map((h) => h.value.s)
    .sort();

describe('repl state.layers (fork addition for @strudel/mixer transitions)', () => {
  beforeAll(async () => {
    await evalScope(core);
  });

  it('starts with an empty layer list', () => {
    expect(makeRepl().state.layers).toEqual([]);
  });

  it('lists two $: layers in order, each querying only its own haps', async () => {
    const r = makeRepl();
    await r.evaluate(`(s(seq("a", "a")).p('$'), s("b").p('$'))`, false);
    const { layers } = r.state;
    expect(layers.map((l) => l.id)).toEqual(['$0', '$1']);
    expect(values(layers[0].pattern)).toEqual(['a', 'a']);
    expect(values(layers[1].pattern)).toEqual(['b']);
    expect(core.isPattern(layers[1].pattern)).toBe(true);
    // the stacked pattern is unchanged: it still holds both layers
    expect(values(r.state.pattern)).toEqual(['a', 'a', 'b']);
  });

  it('uses the given id for a named .p() layer', async () => {
    const r = makeRepl();
    await r.evaluate(`(s("bd").p('drums'), s("c").p('$'))`, false);
    expect(r.state.layers.map((l) => l.id)).toEqual(['drums', '$0']);
    expect(values(r.state.layers[0].pattern)).toEqual(['bd']);
  });

  it('leaves muted layers (_x / x_) out of the list', async () => {
    const r = makeRepl();
    await r.evaluate(`(s("bd").p('drums'), s("m").p('_muted'), s("n").p('muted_'))`, false);
    expect(r.state.layers.map((l) => l.id)).toEqual(['drums']);
  });

  it('is empty when the code has no $: / .p() layers', async () => {
    const r = makeRepl();
    await r.evaluate(`s(seq("a", "b"))`, false);
    expect(r.state.layers).toEqual([]);
    expect(values(r.state.pattern)).toEqual(['a', 'b']);
  });

  it('replaces the list on re-evaluate instead of appending', async () => {
    const r = makeRepl();
    await r.evaluate(`(s("a").p('$'), s("b").p('$'))`, false);
    expect(r.state.layers).toHaveLength(2);
    await r.evaluate(`s("c").p('$')`, false);
    expect(r.state.layers.map((l) => l.id)).toEqual(['$0']);
    expect(values(r.state.layers[0].pattern)).toEqual(['c']);
    await r.evaluate(`s("d")`, false);
    expect(r.state.layers).toEqual([]);
  });

  it('exposes the new layers to editPattern while setPattern runs', async () => {
    const seen = [];
    let r;
    r = makeRepl({
      editPattern: (pat) => {
        seen.push(r.state.layers.map((l) => l.id));
        return pat;
      },
    });
    await r.evaluate(`(s("a").p('$'), s("b").p('drums'))`, false);
    await r.evaluate(`s("c")`, false);
    expect(seen).toEqual([['$0', 'drums'], []]);
  });
});
