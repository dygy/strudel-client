# Technical Specification: Safety Net for the Untested Fork Features

- **Functional Specification:** [`functional-spec.md`](./functional-spec.md)
- **Status:** Draft
- **Author(s):** Dygy (with Claude)

---

## 1. High-Level Technical Approach

This change only adds tests. **No production code changes**, apart from a trivial export if a unit can't be reached otherwise; any such export is listed in the report. Every acceptance criterion in the functional spec maps to a vitest test, written as a positive/negative pair and proven RED→GREEN.

All tests run under the root `vitest.config.mjs` (`isolate: false`, `unstubGlobals: true`). Browser APIs (Web Audio, `MediaRecorder`, `getDisplayMedia`, `localStorage`) and Supabase are mocked at the boundary, and the mocks are installed and removed per test so nothing leaks between files. No real network calls, and no Supabase project is touched.

Two independent areas, implemented in parallel:

| Area | Units under test | Agent |
|---|---|---|
| Audio | `packages/mixer/SmoothTransitionManager.mjs`, `packages/equalizer/*`, `website/src/repl/recording/ScreenRecorderEngine.ts` | `strudel-test-engineer` (audio brief) |
| Web / API | `website/src/pages/api/library/batch-import.ts`, `api/tracks/bulk-create.ts`, `website/src/lib/adminAuth.ts`, `api/admin/users.ts` | `strudel-test-engineer` (web brief) |

`strudel-test-engineer` owns both areas because its contract is tests only, with no production code. Two parallel dispatches replace one implementer per area plus a test slice.

---

## 2. Proposed Solution & Implementation Plan (The "How")

### 2.1 Test files (new)

| Path | Covers (functional spec §) |
|---|---|
| `packages/mixer/test/SmoothTransitionManager.test.mjs` (extend) | §2.1: settings clamp, persist and restore, corrupt fallback; fade ramps; queue keeps only the latest; volume restore on failure |
| `packages/equalizer/test/AudioEqualizer.test.ts` | §2.2: per-band gain, ±12 dB clamp, Q 0.5–4 clamp, `applyPreset` known/unknown, `setEnabled` off→flat, on→restore |
| `packages/equalizer/test/persistence.test.ts` | §2.2: save→load round trip, corrupt JSON → `null` / defaults, no throw |
| `packages/equalizer/test/utils.test.ts` | §2.2: `formatFrequency` (63, 1000→"1k", 16000→"16k"), log frequencies, coordinate maps |
| `website/src/repl/recording/__tests__/ScreenRecorderEngine.test.ts` | §2.3: start after pick; `NotAllowedError` → cancelled, no error, idle; stop → Blob plus tracks stopped; video track `ended` → stop with Blob; mime fallback; no supported mime → error and nothing left running |
| `website/src/pages/api/__tests__/import.test.ts` | §2.4: batch-import and bulk-create; 401 with no token or an invalid session; 400 on non-array; `user_id` always from the session (body `user_id` ignored); duplicate names get " 2"/" 3" case-insensitively, per folder, including within one batch |
| `website/src/pages/api/__tests__/admin.test.ts` | §2.5: `isAdmin`/`isAdminUser` exact match (case variant, `null`, `undefined` refused); `/api/admin/users` returns 401 with no token, 401 with an invalid token, 403 for a non-admin, 200 for the admin |

Adding `packages/equalizer/test/` is fine: the root vitest config has no include filter. The equalizer package is TypeScript, so its tests are `.ts`.

### 2.2 Mocking contracts

- **Web Audio:** reuse and extend `packages/mixer/test/webAudioMock.mjs`, which already has `createBiquadFilter`. Each `AudioParam` mock records the calls `setValueAtTime`, `linearRampToValueAtTime` and `cancelScheduledValues` in order. "Glides, never jumps" is asserted as: a ramp call to the target exists, and no `setValueAtTime(target)` happens at the start time.
- **Time:** `fadeDown`/`fadeUp` wait in wall-clock time (`setTimeout(duration*1000)`). Tests use `vi.useFakeTimers()` and advance by the duration, so no test sleeps.
- **`localStorage`:** an in-memory stub per test (`vi.stubGlobal`). Corrupt data means writing `'{not json'` under the real keys: `strudel-smooth-transitions`, and the equalizer's key as read from `persistence.ts`.
- **Screen capture:** `navigator.mediaDevices.getDisplayMedia` returns a fake `MediaStream` whose video track is an `EventTarget` with `stop()`. `MediaRecorder` is a fake class with a static `isTypeSupported` that is controllable per test, plus `start`/`stop`/`ondataavailable`/`onstop`. Cancel is simulated by rejecting with `new DOMException('', 'NotAllowedError')`.
- **Supabase:** `vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => fake) }))`. The `fake` exposes:
  - `auth.getUser(token)`
  - `auth.admin.listUsers()`
  - a chainable `from(table).select().eq().insert().select()` that records each call and returns per-test data.

  `batch-import.ts` caches its client at module scope. Tests therefore keep one `fake` and reset its recorded state per test, rather than relying on a fresh `createClient`.
- **Env:** `setRuntimeEnv({ PUBLIC_SUPABASE_URL: 'http://test', SUPABASE_SERVICE_ROLE_KEY: 'test-service' })` from `website/src/lib/server-env.ts`. No real keys are ever used.
- **Calling the handlers:** import `POST`/`GET` and call them with `{ request: new Request(url, { method, headers: { cookie: 'sb-access-token=…' }, body }), cookies: { get: (k) => … } }`, as an `APIContext`-shaped object. `bulk-create` reads `cookies.get`, while `batch-import` and `admin/users` parse the cookie header, so the test helper provides both.

### 2.3 Data

**None.** No schema, RLS, migration or `supabase_schema.sql` change. The tests never reach a database.

### 2.4 Runtime

- The API routes are Worker code (`prerender = false`). The tests call their exported handlers directly in node; no Worker is started and no SSR page is added, so the 3 MiB Worker limit is unaffected.
- No new env vars or secrets.

### 2.5 Audio graph

Mocked only. The tests assert on the recorded `AudioParam` schedule (ramps versus jumps) and on node wiring (the EQ chains its 10 filters in order, input → band0 → … → band9 → output). No real `AudioContext`, and no change to the graph itself.

### 2.6 Upstream impact

**None.** No `@strudel/*` public behaviour changes. `mixer` and `equalizer` are fork-only packages.

---

## 3. Impact and Risk Analysis

- **Dependencies:** none new. `vitest`, `fast-check` and `jsdom` are already present. `@testing-library/react` is **not** added, which is why the import conflict dialog is out of scope in the functional spec.
- **Risks and mitigations:**

| Risk | Mitigation |
|---|---|
| A mock leaks across files under `isolate: false`. This happened on 2026-10-09 with `window` stubs. | Install mocks per test with `vi.stubGlobal` and `vi.mock`, relying on `unstubGlobals: true`. Verify with a shuffled run (`vitest run --sequence.shuffle`) and a single-worker run. |
| Vacuous tests that pass with the behaviour removed. | RED proof per behaviour: copy the source aside, break the guarded line, see the test fail, restore. Quote both lines in the report. |
| `batch-import.ts` caches its Supabase client at module scope, so one test's fake leaks into the next. | Keep a single shared fake and reset its state per test, or use `vi.resetModules()` plus a re-import per test. |
| Slow tests from wall-clock fades or timers. | Fake timers. The whole suite should stay around 3 s; flag any test file that adds more than 0.5 s. |
| A test reveals that the current behaviour contradicts the functional spec. | Don't fix production code. Record it under functional spec §4 Findings, leave a clearly named failing test **out of** the committed suite (or mark it `it.fails`, with a comment linking the finding), and add a roadmap follow-up. |

---

## 4. Testing Strategy

- **Positive and negative tests** for every acceptance criterion, all 31 of them, with each test named after its criterion.
- **RED→GREEN** for at least one assertion per test file, with the evidence quoted in the agent report and spot-checked by the orchestrator.
- **Suite gates:**
  - `pnpm exec vitest run` passes with 0 failures, run 3 times plus once with `--sequence.shuffle.files`. A full `--sequence.shuffle` (shuffling tests within files) fails in `packages/mondo`, whose tests depend on their order; that was there before this change and is out of scope.
  - `pnpm run lint` reports 0 errors.
  - `pnpm run format-check` is clean.
- **`pnpm build:cloudflare`** isn't needed, because no shipped code changes. The orchestrator confirms with `git diff --stat`, which must show only test files, mocks and docs.
