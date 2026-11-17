# Flow log: 033 Loudness meter and analyser

## 2026-11-17: Spec, tech and tasks
- **Inputs:** no issue; roadmap Phase 6 "Loudness meter and analyser".
- **Owner decisions (AskUserQuestion):**
  - a strip in the header and the performance view, plus a Settings panel;
  - measure after the EQ and before the speakers volume, with a pre-limiter check;
  - a pre-EQ spectrum layer behind the EQ curve;
  - Integrated resets on Play after Stop, and with a button.
- **Existing work found:** the 030 peak meter (`performance/levelMeter.ts`, kept unchanged), the 026 spectrum (`createAnalyserTap`) and the 017 RMS `LoudnessMeter`, which stays independent.
- **Produced:** `functional-spec.md`, `technical-considerations.md`, `tasks.md`.
- **Worktree:** `../strudel-client-meter`, branch `feat/loudness-meter`. Spec 033 needed no claim: no other strudel session is running.
- **Next:** dispatch the audio engineer (slice 1), then the web engineer (slice 2).
