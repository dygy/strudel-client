# Tasks: Safety Net for the Untested Fork Features

Spec: [functional-spec.md](./functional-spec.md) · Tech: [technical-considerations.md](./technical-considerations.md)
Test-only. Every task: positive + negative cases, RED→GREEN proof quoted, no production code changes.

## Slice 1 — Audio coverage **[Agent: strudel-test-engineer]**

- [x] 1.1 Extend `packages/mixer/test/webAudioMock.mjs` so every AudioParam records `cancelScheduledValues` / `setValueAtTime` / `linearRampToValueAtTime` in order (tech §2.2).
- [x] 1.2 `packages/mixer/test/SmoothTransitionManager.test.mjs`: settings clamp (30 → 10, 0.1 → 0.5), enabled + duration persist across a new instance, corrupt stored settings → off / 2 s without throwing (func §2.1).
- [x] 1.3 Same file: fadeDown ramps to 0 and fadeUp ramps to 1 over the duration, never a jump; fake timers (func §2.1).
- [x] 1.4 Same file: two queued transitions during a running one → only the last code is evaluated; failure after fade-out → gain set back to 1 (func §2.1).
- [x] 1.5 `packages/equalizer/test/AudioEqualizer.test.ts`: 10 filters chained in order; setting one band leaves the other nine; gain clamp ±12; Q clamp 0.5–4; known preset sets all 10; unknown preset changes nothing; setEnabled(false) → all 0, setEnabled(true) → restored (func §2.2).
- [x] 1.6 `packages/equalizer/test/persistence.test.ts` + `utils.test.ts`: round-trip, corrupt data → fallback no throw; formatFrequency 63 / 1000 / 16000 (func §2.2).
- [x] 1.7 `website/src/repl/recording/__tests__/ScreenRecorderEngine.test.ts`: start after pick; NotAllowedError → idle, no error; stop → Blob + tracks stopped; video track `ended` → stop with Blob; preferred mime unsupported → fallback used; none supported → error, nothing running (func §2.3).

## Slice 2 — Web / API coverage **[Agent: strudel-test-engineer]**

- [x] 2.1 Shared test helper: Supabase fake (`vi.mock('@supabase/supabase-js')`), `setRuntimeEnv` test env, APIContext builder with cookie header + `cookies.get` (tech §2.2).
- [x] 2.2 `website/src/pages/api/__tests__/import.test.ts`: batch-import + tracks/bulk-create → 401 no token, 401 invalid session, 400 non-array; inserted rows carry the session user id even when the body names another; nothing inserted on refusal (func §2.4).
- [x] 2.3 Same file: existing "Beat" + import "beat" → "beat 2"; two "Beat" in one batch → "Beat", "Beat 2"; different folder → no suffix (func §2.4).
- [x] 2.4 `website/src/pages/api/__tests__/admin.test.ts`: isAdmin exact / case variant / null / undefined; GET /api/admin/users → 401 no token, 401 invalid token, 403 non-admin with `listUsers` and `from('tracks')` never called, 200 admin with users + track counts (func §2.5).

## Slice 3 — Verification **[Agent: orchestrator]**

- [x] 3.1 Whole suite ×3 + `--sequence.shuffle`, 0 failures; lint 0; format clean; `git diff --stat` shows tests/mocks/docs only.
- [x] 3.2 RED spot-check one test per area independently of the agent's proof.

## Slice 4 — Bookkeeping **[Agent: orchestrator]**

- [ ] 4.1 `context/product/feature-map.md`: Tests column for smooth transitions, EQ, screen recorder, import, admin.
- [ ] 4.2 Functional spec §4 Findings final; roadmap follow-up items for each finding (import per-track validation; transition error not surfaced; any new).
- [ ] 4.3 No i18n strings, no migration (test-only) — confirm and record.
