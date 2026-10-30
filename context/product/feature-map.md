# Feature Map

This is the single inventory of what strudel-client does. Each feature gets one row, giving where it lives, which spec describes it, which tests cover it, and which specialist agent owns it. Use it to scope a `/ship` or `/fix`, and to see which tests guard a change.

**Keep it current.** `/ship` adds a row, or updates the existing one, in its close-out step. A feature with no row is invisible to every later session.

The **Owner** column names a specialist agent:
- `engine` = `strudel-engine-engineer`
- `audio` = `strudel-audio-engineer`
- `web` = `strudel-web-engineer`

The **Origin** column says where the feature came from:
- **U** = inherited from upstream Strudel
- **F** = added in this fork, after commit `ada58dd` (the upstream import)

Last surveyed: 2026-10-08.

## Pattern engine

| Feature | Origin | Code | Spec | Tests | Owner |
|---|---|---|---|---|---|
| Pattern core, mini-notation, mondo, tonal, xen, transpiler, tidal/hs2js | U | `packages/{core,mini,mondo,mondough,tonal,xen,transpiler,tidal,hs2js}` | none | `packages/{core,mini,mondo,tonal,transpiler,xen}/test`  | engine |

## Audio

| Feature | Origin | Code | Spec | Tests | Owner |
|---|---|---|---|---|---|
| Synthesis and sample engine | U | `packages/{superdough,supradough,webaudio,sampler,soundfonts,csound}` | none | none | audio |
| I/O: MIDI, OSC, MQTT, serial, gamepad, motion | U | `packages/{midi,osc,mqtt,serial,gamepad,motion}` | none | none | audio |
| Mixer and headphone preview on a second engine, plus device selection | F | `packages/mixer/{AudioMixer,PreviewEngine,KeyboardShortcutManager}.mjs`; `website/src/repl/components/{MixerControls,MixerHealthIndicator}.tsx`; `panel/{MixerSettings,AudioDeviceSelector,AudioEngineTargetSelector}.tsx` | [006](../spec/006-audio-mixer-preview/) | `packages/mixer/test/AudioMixer.test.mjs` (16, incl. EQ routing; mock in `webAudioMock.mjs`) | audio |
| Track transition types (Off, Dip, Cut, Crossfade, Filter sweep, Bass swap, Echo-out, Layered intro; Snap / Tempo glide / Match loudness) | F | `packages/mixer/TrackTransitionController.mjs`, `packages/mixer/transitions/{buildTransition,envelopes,loudness}.mjs` (pattern-level via the repl `editPattern` hook); `packages/core/repl.mjs` `state.layers` and `packages/superdough/superdough.mjs` `getActiveSoundIds`/`releaseSounds` (fork additions); switch vs same-track decision `website/src/repl/trackSwitch.ts`; settings `website/src/settings.ts` + `website/src/repl/transitionSettings.ts`; UI `panel/TransitionSettingsSection.tsx`, `components/TransitionPicker.tsx` (header + compact bar), waiting state `website/src/repl/transitionPhase.ts`; failure warning `website/src/repl/smoothTransitionNotifier.ts` | [009](../spec/009-smooth-track-transitions/), [015](../spec/015-fork-feature-test-coverage/), [017](../spec/017-track-transition-types/) | `packages/mixer/test/{TrackTransitionController,buildTransition,loudness,voiceRelease,transitionAcceptance}.test.mjs`, `packages/core/test/repl-layers.test.mjs`, `website/src/repl/__tests__/{transitionSettings,smoothTransitionNotifier,trackSwitch}.test.ts`, `components/__tests__/TransitionPicker*`, `compact/__tests__/CompactTransitionPicker.test.tsx`, `panel/__tests__/TransitionSettingsSection.test.tsx`, `i18n/__tests__/transitionTranslations.test.ts` | audio |
| 10-band parametric EQ, presets and visualisation | F | `packages/equalizer/*`; `panel/EqualizerUI.tsx` | [008](../spec/008-audio-equalizer/), [015](../spec/015-fork-feature-test-coverage/) | `packages/equalizer/test/*`: chain, per-band, ±12 dB / Q clamps, presets, on/off (incl. changes made while off stay silent until switched on: fixed 2026-10-09), persistence (damaged or out-of-range saved settings fall back flat; unknown preset → custom: fixed 2026-10-09), utils | audio |
| Sample cache settings | F | `panel/SampleCacheSettings.tsx` | none | none | audio |

## Editor

| Feature | Origin | Code | Spec | Tests | Owner |
|---|---|---|---|---|---|
| CodeMirror editor: highlight, flash, sliders, themes, keybindings, tooltip | U | `packages/codemirror` | none | none | web |
| Enhanced autocomplete (mini-notation, banks, samples) | F | `packages/codemirror/{autocomplete,miniNotationParser,positionDetector,sampleMatcher,hydra-docs}.mjs` | [010](../spec/010-enhanced-strudel-autocomplete/), [012](../spec/012-bank-autocomplete-mini-notation/) | `packages/codemirror/test/*` (4 files) | web |
| Prettier formatting (worker, placeholder scheme, format on save) | F | `packages/codemirror/{prettierExtension,prettierWorker}.mjs`; `website/src/repl/formatEngine.ts` | [004](../spec/004-prettier-integration/), [011](../spec/011-prettier-strudel-dsl-formatting/) | `website/src/repl/__tests__/*format*` | web |
| Toggle and radio widgets | F | `packages/codemirror/{toggle,radio}.mjs` | none | none | web |
| Shortcuts (Ctrl+U update, Ctrl+P play/pause) and the Shortcuts tab | F | `panel/ShortcutsTab.tsx` | none | none | web |

## REPL UI

| Feature | Origin | Code | Spec | Tests | Owner |
|---|---|---|---|---|---|
| REPL shell and panels | U | `website/src/repl/{Repl.tsx,useReplContext.tsx,panel/*}` | none | none | web |
| Responsive REPL on phones and tablets (compact layout) | F | `website/src/repl/components/compact/{CompactControlBar,CompactTitleBar,CompactMoreMenu,LibraryDrawer}.tsx`; `recordActions.ts`; `panel/{Panel.tsx,panelViewport.ts,panelLayout.ts,EqualizerCompact.tsx}`; `Header.tsx`; `ReplEditor.tsx`; `sidebar/{FileTree,FileManagerRefactored}.tsx`; `ui/{WorkingContextMenu,BurgerMenuButton}.tsx`; `components/{HeadCommon.astro,LoginPage.tsx}` | [016](../spec/016-responsive-repl-layout/) | `compact/__tests__/{CompactLayout,LibraryDrawer,CompactAcceptance}`; `ui/__tests__/WorkingContextMenu-{longpress,placement}`; `panel/__tests__/{Panel-compact,EqualizerCompact,MixerSettings-compact,LanguageSelector-compact}`; `repl/__tests__/panelViewport`; `components/__tests__/{LoginPage-compact,HeadCommon-safeArea,Code-timer}`; `i18n/__tests__/compactLayoutKeys` | web (EQ/mixer UI: audio) |
| Authenticated REPL, welcome screen, toasts and tooltips, burger and context menus | F | `website/src/repl/{useAuthenticatedReplContext.tsx,AuthenticatedReplEditor.tsx,WelcomeScreen.tsx}`; `stores/{toastStore,tooltipStore}.ts` | none | `stores/__tests__/toastStore.test.ts` (5-toast cap, trimmed toasts can show again, de-dup) | web |
| Global save manager and emergency save | F | `website/src/repl/globalSaveManager.ts`; `hooks/useEmergencySave.ts` | none | `repl/__tests__/globalSaveManager.test.ts` | web |
| i18n: 9 locales, lazy loading, RTL | F | `website/src/i18n/*`; `I18nProvider.tsx`; `LanguageSelector.tsx` | none | `i18n/__tests__/localeCompleteness.test.ts` (every locale has every en key, non-empty, same placeholders) | web |

## Library: file manager and tracks

| Feature | Origin | Code | Spec | Tests | Owner |
|---|---|---|---|---|---|
| Sidebar file tree, with folders, multitracks/steps and drag and drop | F | `website/src/repl/components/sidebar/*`; folder rename/move plan `website/src/lib/folderRename.ts` (`parent` may hold an id or an older row's parent path: read it through `resolveParentId`); `/api/folders/update`; `/api/folders/create` (parent stored as id, path built server-side, sibling name/slug clash → 409) | none | `lib/__tests__/folderRename`, `pages/api/__tests__/folderRename`, `pages/api/__tests__/folderCreate`, `sidebar/hooks/__tests__/folderRename` (rename and drag-move rebuild paths of the folder, descendants and path-holding tracks; same-name clash → 409; rollback; the open track URL follows); `sidebar/__tests__/FileTree-expanded-state`; track rename/move `lib/trackRename.ts` + `/api/tracks/update` (also every code save: allowlisted fields only): `lib/__tests__/trackRename`, `pages/api/__tests__/trackUpdate`, `sidebar/hooks/__tests__/trackRename` | web |
| Strict autosave | F | `sidebar/hooks/useStrictAutosave*` | none | `sidebar/hooks/__tests__/strictAutosave*` | web |
| ZIP and folder import with conflict modal; folder and multitrack export | F | `ui/ImportConflictModal.tsx`; `/api/library/batch-import`; `/api/{tracks,folders}/bulk-create` | [003](../spec/003-supabase-import-fix/), [015](../spec/015-fork-feature-test-coverage/) | `pages/api/__tests__/import.test.ts`: auth (401 before the body is read), session-owned `user_id`, malformed or unreadable bodies → 400 on all 3 routes (shared `lib/apiBody.ts`), duplicate-name suffixes | web |
| Track routing (`/repl/<folder>/<track>/<step>`) | F | `website/src/routing/{TrackRouter,URLParser,NavigationState,TrackPersistence}.ts`; `stores/tracksStore.ts` | [001](../spec/001-track-routing-navigation/) | `routing/__tests__/*` (path `/repl/<slug>` contract); `stores/__tests__/tracksStore-url-fix`; `lib/__tests__/slugUtils-folder-match` + `stores/__tests__/tracksStore-folder-url` (folder-id / non-slug folder URLs resolve on reload) | web |
| Random track on `/repl` | F | `pages/repl/[...trackPath].astro` | [005](../spec/005-random-track-loading-fix/) | none | web |
| Scalable tree filesystem (`tree_*` tables, `/api/tree/*`) | F | `website/src/lib/{TreeManager,TreeSystem,FileSystemGraph,TreeDataTransformer}.ts`; `lib/database/tree-schema.sql` | [002](../spec/002-scalable-tree-filesystem/) | none | web. **Partial**: the API went back to the `tracks` table in `d8b4bdf` and `4d671f2`. |

## Auth, cloud and admin

| Feature | Origin | Code | Spec | Tests | Owner |
|---|---|---|---|---|---|
| Google OAuth through Supabase: session restore, refresh, health monitoring | F | `contexts/AuthContext.tsx`; `stores/authStore.ts`; `lib/{supabase,supabaseClient,authUtils,authListener,secureApi,authCookies,authRedirect,authCheck}.ts`; `/api/auth/*`; `/login`; `/auth/callback`. The client supabase-js is the only refresh owner: only the access token is mirrored to a cookie, and no server route refreshes | none | `lib/__tests__/{authCookies,authRedirect}`; `stores/__tests__/authStore-session`; `pages/api/__tests__/authSession` | web |
| Data model (`profiles`, `tracks`, `folders`, `file_system_nodes`, `tree_*`; RLS by `auth.uid()`) | F | `supabase_schema.sql`; `website/src/lib/database/tree-schema.sql`; types in `website/database.types.ts` | none | none | web |
| Admin read-only dashboard | F | `pages/admin.astro`; `components/admin/AdminDashboard.tsx`; `/api/admin/users`; `lib/adminAuth.ts` (hardcoded admin email) | none | `pages/api/__tests__/admin.test.ts`: exact-match admin, 401/403/200, no service-role reads before the admin check | web |

## Recording and embed

| Feature | Origin | Code | Spec | Tests | Owner |
|---|---|---|---|---|---|
| Audio recorder (WAV, or MP3 encoded in a worker) | F | `website/src/repl/recording/{AudioRecorderEngine,mp3Encoder,mp3Worker,wavEncoder,useAudioRecorder}.ts` | [013](../spec/013-audio-recorder/) | `recording/__tests__/formatUtils` | audio |
| Screen and tab recorder (WebM) with export dialog | F | `recording/{ScreenRecorderEngine,useScreenRecorder}.ts`; `components/ExportDialog.tsx` | [014](../spec/014-screen-recorder/), [015](../spec/015-fork-feature-test-coverage/) | `recording/__tests__/ScreenRecorderEngine.test.ts`: lifecycle, cancel, Stop sharing, mime fallback | audio |
| `/embed` REPL with no auth, for MIDI-grep and Puppeteer | F | `pages/embed.astro`; `repl/components/EmbeddedReplEditor.tsx` | [007](../spec/007-midi-grep-embed-integration/) | none | web |

## Site, desktop and platform

| Feature | Origin | Code | Spec | Tests | Owner |
|---|---|---|---|---|---|
| Docs site (learn, workshop, recipes, functions, blog), Algolia search, MiniRepl | U | `website/src/pages/*`; `website/src/docs` | none | none | web |
| PWA (off in the Cloudflare build) | U | `website/src/pwa*.ts`; `astro.config.mjs` | none | none | web |
| Desktop app (Tauri) | U | `src-tauri/`; `packages/desktopbridge`; `website/src/tauri.ts` | none | none | web |
| Cloudflare Workers deploy | F | `website/astro.config.cloudflare.mjs`; `website/wrangler.jsonc`; `.github/workflows/deploy.yml` | none | none | web |
| Weaver analytics | F | `website/src/components/HeadCommon.astro` | none | none | web |
