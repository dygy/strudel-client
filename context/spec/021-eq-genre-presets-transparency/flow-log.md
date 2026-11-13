# Flow log — 021 EQ genre presets and transparency

## 2026-11-13 — spec, tech, tasks
- Owner request in chat: "add all possible genres, be transparent". The owner picked all 4 families and chose "show what each preset does" as the meaning of "transparent".
- Spec, tech and tasks were written inline. It is a data and UI change with no audio-graph change, and the area was read this session for specs 008 and 020. Flow deviation: no Explore or specialist consult.
- Next: one `strudel-audio-engineer` dispatch (slices 1–3).

## 2026-11-13 — implementation, testing, review
- Implementation: 1 `strudel-audio-engineer` dispatch. 47 presets, `describe.ts`, `EqualizerPresetDescription.tsx`, 123 keys × 9 locales.
  - `rock` collided with a profile key, so the genre preset is `rockGenre`.
  - Every genre preset is within ±0.25 dB of Flat.
- Main-session RED proof: `Tests 113 failed | 63 passed (176)`; after restoring, `188 passed`.
- Feature testing: 1 `strudel-test-engineer` dispatch. `EqualizerAcceptance021.test.tsx` (31 tests), RED under 18 mutations. Suite: 183/183 files, 3961 tests.
- Spec amended: AC 2.1.4 now applies to genre presets only, because four profiles exceed 3 dB (see the Change Log).
- Review: 1 `strudel-reviewer`, 4 Minor findings. The owner accepted all 4:
  - the 2 dB threshold applied before rounding;
  - the live region debounced;
  - an RTL isolate test;
  - the picker test checking members.
  These went back to the same implementer.
- Screenshots: `docs/screenshots/021-*.png` (18 files).

## 2026-11-13 — delivered: b72c1dd on prod
- The review fixes were made by the same implementer and proven red→green. Suite: 189/189 files, 4035 tests; lint and build clean.
  - The format-check failures were only in the uncommitted spec 023 files.
- 021 was committed apart from 023's in-progress `scratchSnap` keys: the index was built per locale with those lines filtered out.
- Pushed e8df3f8, which also carried another session's 6cc8e17 spec 022 docs. The push gate was advisory because the tree was dirty from 023.
  - CI / Deploy run 43373102498 succeeded.
- Prod check in Chrome:
  - the picker shows 5 groups, 14/14/20/11/22, 81 options in all;
  - the owner's saved Phonk still loads;
  - the live region reads its summary, "High cut 13 kHz · Output −6 dB" and the why sentence.
- Agents: audio engineer 1 (2 rounds), test engineer 1, reviewer 1.
- Flow defect: the implementer's claim that Amapiano lost "Low mids" was wrong. `describeSettings` keeps the −2.5 dB mean, checked in the main session.
