# Coverage: acceptance criteria of spec 018

One row per checkbox in [functional-spec.md](./functional-spec.md). A test is written as `file` > "test name". **(new)** marks a test added in slice 10.

**Status**
- **test:** held by the tests named.
- **test + browser:** the tests hold the logic, and the rest needs a real browser, for the reason given.
- **test + prod:** the tests hold our side, and the rest needs a real assistant, or Supabase, on prod.
- **GAP:** the criterion doesn't hold. Its test fails.

**Files**

| Short name | Path |
|---|---|
| `auth` | `packages/mcp-worker/test/auth.test.ts` |
| `accept` | `packages/mcp-worker/test/acceptance.test.ts` |
| `bundle` | `packages/mcp-worker/test/bundleRules.test.ts` |
| `know` | `packages/mcp-worker/test/knowledge.test.ts` |
| `lib` | `packages/mcp-worker/test/library.test.ts` |
| `relay` | `packages/mcp-worker/test/tabRelay.test.ts` |
| `writes` | `packages/mcp-worker/test/writes.test.ts` |
| `helper` | `packages/mcp-local/test/tarball.test.mjs` |
| `undo` | `packages/codemirror/test/replaceCodeUndo.test.mjs` |
| `consent` | `website/src/components/oauth/__tests__/ConsentPage.test.tsx` |
| `consentLang` | `website/src/components/oauth/__tests__/ConsentPage-languages.test.tsx` |
| `strings` | `website/src/i18n/__tests__/assistantStrings.test.ts` |
| `adminApi` | `website/src/pages/api/__tests__/adminAssistantScope.test.ts` |
| `createOpen` | `website/src/pages/api/__tests__/assistantCreateThenOpen.test.ts` |
| `folderApi` | `website/src/pages/api/__tests__/folderDelete.test.ts` |
| `versionApi` | `website/src/pages/api/__tests__/trackVersion.test.ts` |
| `conflict` | `website/src/repl/__tests__/trackConflict.test.ts` |
| `allow` | `website/src/repl/assistantControl/__tests__/AllowAssistantSwitch.test.tsx` |
| `client` | `website/src/repl/assistantControl/__tests__/client.test.ts` |
| `wiring` | `website/src/repl/assistantControl/__tests__/commandWiring.test.tsx` |
| `handlers` | `website/src/repl/assistantControl/__tests__/handlers.test.ts` |
| `setup` | `website/src/repl/assistantControl/__tests__/setupPage.test.ts` |
| `hook` | `website/src/repl/assistantControl/__tests__/useAssistantControl.test.tsx` |
| `notice` | `website/src/repl/components/__tests__/TrackConflictNotice.test.tsx` |
| `assistants` | `website/src/repl/components/panel/__tests__/ConnectedAssistants.test.tsx` |
| `settings` | `website/src/repl/components/panel/__tests__/SettingsTab-assistants.test.tsx` |
| `saving` | `website/src/repl/components/sidebar/hooks/__tests__/useSupabaseFileManager-conflict.test.tsx` |

## 2.1 Connecting an assistant

| Criterion | Status | Tests | The rest |
|---|---|---|---|
| Signed out: sign in with Google, then the consent page | test + prod | `consent` > "goes to login without asking Supabase, and the login round trip comes back with the id" | Prod only: the real Google sign-in |
| **Allow:** the assistant reports it is connected | test + prod | `consent` > "says it is returning after Allow, not that access was refused"; `auth` > "gets whoami, with the identity Supabase answered" | Prod only: what a real assistant reports |
| **Deny:** the assistant reports access was refused | test + prod | `consent` > "says access was refused after Deny, and still returns to the assistant" | Prod only: what a real assistant reports |
| No sign-in: told to sign in, and no data | test | `auth` > "answers 401 with a challenge pointing to the resource metadata, and no data"; `auth` > "the SDK client is refused at connect" | |
| Two users of one assistant each see only their own library | test | `auth` > "two users of one client each get their own identity"; `lib` > "shows nobody else's folders" | |

## 2.2 Connecting from the app, seeing and ending connections

| Criterion | Status | Tests | The rest |
|---|---|---|---|
| **Copy** puts the address on the clipboard and confirms for 2 seconds | test | `assistants` > "puts the address on the clipboard and confirms for 2 seconds" | |
| Clipboard refused: the text is selected, with a message | test | `assistants` > "if the browser refuses, selects the text and says so" | |
| The Claude Code steps connect with no other instructions | test + prod | `assistants` > "gives Claude Code a whole command for an HTTP server, needing nothing else" **(new)**; `setup` > "gives the address and the commands the app gives" | Prod only: running the command in Claude Code |
| A new assistant appears within 30 seconds, with no reload | test | `assistants` > "refreshes the list while open, so a new assistant appears within 30 seconds" | |
| The section shows each assistant's name and when it connected | test | `assistants` > "lists each assistant with its name and when it was connected" | |
| **Disconnect:** within 1 minute the next action is refused | test + prod | `assistants` > "Disconnect revokes that one and takes it off the list"; `auth` > "is checked on every request, so a revocation applies to the next one" | Prod only: real revocation. Measured at 89 ms in the slice 1 spike, tech spec 2.3 |
| No assistant: the section says so, with the steps open | test | `assistants` > "with no assistant says so, and shows the connect steps open" | |
| At least one assistant: the steps are collapsed | test | `assistants` > "with assistants connected keeps the steps collapsed under Connect another assistant" | |

The rule that the section isn't shown signed out or in the admin view: `settings` > "is not there signed out" and "is not there in the admin view, which is read-only" **(new)**.

## 2.3 Browsing and reading the library

| Criterion | Status | Tests | The rest |
|---|---|---|---|
| A word in a name or in code finds the track, with its folder and address | test | `accept` > "a word in the code finds the track, with its folder and its address" **(new)**; `lib` > "finds by name and by text in the code, whatever the case" | |
| A multitrack comes with every step's name and code, in order | test | `lib` > "reads a multitrack: every step in order, and the active one" | |
| Missing or someone else's: "Track not found", and no telling which | test | `lib` > "answers the same for another user's track as for one that never existed" | |
| Paging reaches every track, each exactly once | test | `lib` > "pages to the end with each track once, including tracks changed at the same moment" | |

## 2.4 Changing the library

| Criterion | Status | Tests | The rest |
|---|---|---|---|
| A created track appears in its folder after a reload, and its address opens it | **GAP**, test + browser | `createOpen` > "after a reload it is in that folder, and its address opens it: %s" **(new)**, failing for a folder called Untitled | Browser only: drawing the sidebar. Gap: see below |
| Edited after reading: nothing saved, told "This track changed since you read it" | test | `accept` > "a save is told in those words, and nothing is saved" **(new)**; `accept` > "a save the route refuses, because a write got in first, is told the same" **(new)**; `writes` > "refuses a stale version, says to read again, and writes nothing" | |
| A name already used in that folder: nothing changes, told it's taken | test | `writes` > "is one request for code and name together, so it is all or nothing"; `writes` > "refuses %s at the top level, which the route alone would let through"; `writes` > "refuses a name already used there" | |
| Over 512 KB: nothing saved, told the limit | test | `accept` > "is told the limit, and nothing is saved" **(new)**; `writes` > "refuses code over 512 KB before anything is read" | |
| Several fields, one invalid: nothing at all is saved | test | `accept` > "saves nothing at all with %s beside good code" **(new)**; `accept` > "saves nothing at all with one bad step beside good ones" **(new)** | |

## 2.5 An open tab must never overwrite an assistant's change, or the reverse

| Criterion | Status | Tests | The rest |
|---|---|---|---|
| Within 30 seconds the tab shows the message and stops autosaving | test | `conflict` > "finds out within 30 seconds of a change, by polling every 20"; `conflict` > "raises the notice and pauses saving when the content changed elsewhere" | |
| **Load the new version:** the editor shows it, and the music continues until Update | test + browser | `saving` > "Load the new version only changes the editor: no evaluate, no reset, no save"; `conflict` > "changes the editor and local state, saves nothing, and resumes" | Browser only: hearing that the music carries on needs real audio |
| **Keep mine:** the tab's text is saved, and the next reader gets it | test | `conflict` > "saves the tab text on top of the current version"; `saving` > "Keep mine saves the text on the current version, and normal saving resumes" | |
| Reloading with unsaved typing: the text is still offered | test + browser | `conflict` > "never arrived: on screen, said to be unsaved, and saved by nobody until chosen"; `conflict` > "says so, instead of saying the text never arrived"; `notice` > "text that never reached the server says that, and only that" | Browser only: a real reload with real `localStorage` |
| No assistant involved: typing and autosave as today, no new message | test | `conflict` > "raises nothing while nothing changed: normal typing has no notice"; `saving` > "a poll right after a save agrees with it: no notice" | |

The rule on kept text older than 30 days: `conflict` > "after 30 days an only copy goes, and is reported so the user can be told".

## 2.6 Deleting

| Criterion | Status | Tests | The rest |
|---|---|---|---|
| Deleting with the version it read: gone after a reload | test | `writes` > "deletes one track, naming the version"; `versionApi` > "filters the delete by the version" | |
| Changed after reading: not deleted, told it changed | test | `accept` > "a delete is told the same, and the track stays" **(new)**; `writes` > "requires a version, and keeps a track that has changed"; `versionApi` > "answers 409 when the track changed, and leaves it" | |
| A folder with anything in it: nothing deleted, told what's inside | test | `writes` > "refuses a folder with something in it, saying what"; `folderApi` > "refuses a folder holding a track, by id or by the path older rows hold, and says what" | |
| Deleted while open in a tab: the same message, and **Keep mine** saves it again | test | `conflict` > "raises the notice and keeps the text, with enough to save it again"; `conflict` > "Keep mine saves the text as a track again"; `saving` > "Keep mine creates it again, in place of the old one" | |

## 2.7 Looking things up and checking code

| Criterion | Status | Tests | The rest |
|---|---|---|---|
| An existing function: description, parameters and the reference's examples | test | `accept` > "gives every parameter and every example in the site's reference" **(new)**; `know` > "answers with what the site's reference says" | |
| A function that doesn't exist: told so, with the closest names | test | `know` > "answers a name it does not have with the closest ones"; `accept` > "gives no parameters or examples for a function that does not exist" **(new)** | |
| A syntax mistake: line and column | test | `know` > "finds a syntax mistake, with line and column" | |
| Unbalanced brackets in mini-notation: that string's line and column | test | `know` > "places a mini-notation mistake on the line of the string" | |
| `.lowpas(`: warned, and `.lpf` suggested | test | `know` > "sends .%s( to the real name, %s" | |
| Over 768 bytes online: told to use the helper, and how to install it | test + prod | `know` > "takes code of exactly the limit, and answers one byte more with use_local_helper" | Prod only: the command works once the package is published, its own approved step |

## 2.8 Controlling an open tab

| Criterion | Status | Tests | The rest |
|---|---|---|---|
| No tab allows control: told to ask the user, no sound | test | `relay` > "tells an assistant with no tab to ask the user" | |
| Update on the playing track: no drop or jump, and the new code is heard | test + browser | `wiring` > "on the track playing: the undoable replacement, then the Update button" **(new)**; `handlers` > "on the track playing: replaces the text, then Update, and says so" | Browser only: master gain over time, tech spec 4. jsdom has no audio graph |
| Another track opened and played: the tab's selected transition | test + browser | `wiring` > "another track playing: the Update button, which is what uses the selected transition" **(new)**; `handlers` > "with another track playing: what Update does, so it's the selected transition" | Browser only: which transition is heard |
| Code with a mistake: the music continues, and the error comes with its line | test + browser | `handlers` > "gives back a mistake with its line, keeps going, and says so in the tab"; `relay` > "gives the line of a code mistake" | Browser only: that the music really continues |
| Unsaved typing: saved first, and Undo brings it back | test | `wiring` > "with typing unsaved: the file manager's save, with no toast, before the text is replaced" **(new)**; `undo` > "puts the assistant's code in the editor, and Undo brings back what was typed just before" **(new)**; `handlers` > "refuses, and leaves the editor and the music alone, when that save fails" | |
| During a transition: refused with "A transition is in progress", undisturbed | test | `wiring` > "a transition the REPL announced refuses a command until it ends" **(new)**; `handlers` > "is refused during a transition, without touching anything"; `relay` > "says \"A transition is in progress\" in those words" | |
| Two tabs and none named: nothing happens, told to choose, both listed | test | `relay` > "refuses with both listed when two tabs could mean it, and sends neither the command"; `relay` > "lists both tabs when it can not tell which, so the assistant can choose" | |
| Switch off or reload: the next action is refused within 5 seconds | test + browser | `client` > "closes the socket at once, so the relay refuses the next action"; `relay` > "answers at once when the tab closes while asked"; `hook` > "turns off when the REPL goes away"; `allow` > "starts off in a new page, because nothing keeps it" | Browser only: a real socket closing on a real reload |
| Another user's tab can't be seen or reached | test | `relay` > "asks for the relay of the user the token is for"; `relay` > "takes who it is from the token check, not from anything the request says" | |

## 2.9 Running patterns on the user's computer

| Criterion | Status | Tests | The rest |
|---|---|---|---|
| `s("bd sd")` for 2 cycles: 4 events with times, and a summary | test | `helper` > "s(\"bd sd\") for 2 cycles gives 4 events with times and lists both sounds" | |
| A mistake: the error with its line, and nothing else stops | test | `helper` > "a syntax error returns its line and column, and the server carries on" | |
| Never finishes: stops within 10 seconds and says so, and the next run works | test | `helper` > "while(true){} that really runs stops within 10 s, even if the environment asks for longer, and the next run works" | |
| Reading a file or the network fails, and the contents never appear | test | `helper` > "%s fails and leaks nothing"; `helper` > "the code really sees no capability: it can look, and finds nothing" | |
| Over 2,000 events: the first 2,000, and says it was cut off | test | `helper` > "over 2,000 events gives the first 2,000 and says it was cut off" | |
| Notes and sounds match what the browser's engine schedules | test | `helper` > describe "parity with the real engine" | |

## 2.10 Limits and failures

| Criterion | Status | Tests | The rest |
|---|---|---|---|
| Over 120 a minute: refused, told when to retry, and the app stays usable | test + prod | `accept` > "is what the binding enforces and what the assistant is told" **(new)**; `accept` > "a request past it counts against that user, through the deployed Worker's own binding" **(new)**; `accept` > "a request that is not a tool call gets a 429 saying when to retry" **(new)**; `lib` > "answers a tool call over the limit with a result saying what to do" | Prod only: Cloudflare's own limiter, which is per location and eventually consistent |
| Connection expired: asked to reconnect, and no data lost | test | `auth` > "a %i from /auth/v1/user (revoked or expired) gives a challenge"; `lib` > "asks to connect again on a %i from the database"; `writes` > "maps a %i from a route to %s" | |
| Storage unreachable: told it failed and may be retried, nothing half-saved | test | `writes` > "says nothing was changed"; `lib` > "says the library could not be reached, as a result rather than a protocol error"; `auth` > "a %i gives a retryable 503, not a sign-in challenge" | |
| Other pages behave and load as before | test + prod | `bundle` > "is the strudel-mcp Worker on the two path routes, with no custom domain" | Prod only: pages actually loading next to the deployed Worker. Checked in the slice 1 spike |

## 2.11 Setup instructions

| Criterion | Status | Tests | The rest |
|---|---|---|---|
| A signed-out visitor can read all of the page | test | `setup` > "can be read signed out: prerendered, like the rest of the docs" | |
| Following the page's steps for Claude connects | test + prod | `setup` > "gives the address and the commands the app gives" | Prod only: a fresh user with a real Claude |

## 2.12 Behaviour in other parts of the product

| Criterion | Status | Tests | The rest |
|---|---|---|---|
| New text in all 9 languages, and right-to-left lays out correctly | test + browser | `strings` > "%s has its own words for it, not the English" **(new)**; `strings` > "has a message for every short message a tab can show" **(new)**; `consentLang` > "in %s lays out right to left, in that language" **(new)**; `consentLang` > "in %s lays out left to right" **(new)**; `notice` > "is translated"; `website/src/i18n/__tests__/localeCompleteness.test.ts` > "has exactly the same keys as en" | Browser only: how right-to-left looks. jsdom does no layout |
| An admin's assistant reaches only the admin's own library | test | `accept` > "reaches the admin's own library" **(new)**; `accept` > "can't read another user's track, or tell that it exists" **(new)**; `accept` > "can't change another user's track, and the route is never asked" **(new)**; `adminApi` > "gets 404 for another user's track, and changes nothing" **(new)**; `adminApi` > "gets 404 deleting another user's folder, and nothing is deleted" **(new)** | |

The rule that the embed page has no assistant control: `allow` > "is not there where control is not possible (embed, admin view)" holds the switch once control isn't available. `EmbeddedReplEditor` never mounts `useAssistantControl`, and that part is browser only.

## Also asked for in slice 10

| Item | Tests |
|---|---|
| Protocol conformance with the official SDK client | `packages/mcp-worker/test/conformance.test.ts`, `packages/mcp-worker/test/protocol.test.ts` |
| CPU budget for each tool | `packages/mcp-worker/test/budget.test.ts` > "%s stays inside 10 ms" |
| Service-role key out of the new package | `bundle` > "never mentions the service-role key"; `bundle` > "holds the public Supabase values only". `website/src/pages/api/__tests__/serviceKeyScope.test.ts` itself scans `website/src` only |

## Gaps

- **A track in a folder called Untitled has an address that doesn't open it (2.3, 2.4).** The same goes for any top-level folder whose name has no letters or digits. `folderPathToSlug` drops the segment (`website/src/lib/slugUtils.ts:44`), so the address has no folder in it (`packages/mcp-worker/src/library.ts:63`). `trackMatchesUrlPath` then refuses a track that has a folder (`website/src/lib/slugUtils.ts:172`). The site's own URLs use the same functions.
