# Handoff: where The Dawn Project stands

Read this first in a new session. It says where the project is, how the
work is done and what comes next, then keeps the technical notes (the
native engine's techniques, and what each finished item changed).
Updated 2026-11-04, at `main` = `3d3dbb5`, with step 31 not yet
committed.

## Start here

- **Where we are:** Phase 9 (plugins) of `nextSteps.md` is under way:
  steps 1-32 and 34 are done (step 6, NAM in the engine, was dropped;
  step 33, Audio Units, waits for a Mac). The last
  few:
  - step 22, the mixer view (2026-11-02, `0078489`);
  - step 23, the mixer and piano roll in windows of their own
    (2026-11-02, `4b1d2c7`; the desktop's windows fixed in `612a0c2`);
  - step 24, sidechains in the engine (2026-11-03, `fdc436b`).
  - Not a listed step: the menu bar, and the browser shown or hidden
    (2026-11-03, `5a380da`; asked for by the user).
  - step 25, automation in the engine (2026-11-03, `d0bfbb7`).
  - Not a listed step: `DAWN_ASIO=1` in `.env` builds the desktop app
    with ASIO, for testing on the user's machine (2026-11-04, `f750344`;
    `scripts/desktop.mjs`, docs/desktop.md "ASIO"). The user has
    LLVM installed and it builds; the installers stay without it.
  - step 26, monitoring modes per track (2026-11-04, `f750344`).
  - step 27, punch-in and punch-out (2026-11-04, `2331049`).
  - step 28, input channels on multi-input interfaces (2026-11-04,
    `9c63222`).
  - step 29, live input and recording through the engine (2026-11-04,
    `e1f0a41`). Not yet tried on the user's interface.
  - step 30, CLAP effects in the engine (2026-11-04, `3d3dbb5`). Not
    yet tried with a real plugin: only the test plugin.
  - step 31, VST3 effects in the engine (2026-11-04, `222a5da`). Not
    yet tried with a real plugin either (NAM's is the first to try).
  - step 32, plugin instruments in the engine (2026-11-07, `6b3be82`).
    Only the test plugin's tone so far, in both formats.
  - step 33, Audio Units, put off (2026-11-08): this machine is Windows,
    so AU code couldn't be built or tried; the user chose to leave it for
    when a Mac is at hand.
  - step 34, export through the engine (2026-11-08, `6e7c555`).
  - Not a listed step: the Crusher, a character compressor after the
    classic 90s distortion compressor (2026-11-08, `4bfd503`; asked
    for by the user, who named it). `src/effects/crusher/`, ported in
    `crates/dawn-engine/src/effects/crusher.rs` (`tests/crusher_parity.rs`
    matches the JavaScript exactly). No sidechain (yet).
  - Not a listed step: the Furnace's Amp selector (2026-11-09, `77d1fb6`;
    asked for by the user). Clean American, Chime, British Crunch,
    British Lead and High Gain (the head that was the only amp, still the
    default, so older projects sound the same). The kernel gained
    `stackAt` (which stage the tone stack follows) and `powerBias` (class
    A); the head renders exactly as before. Three new factory cabinets go
    with the classic amps (`ampMatchingCab`), and the Clean and Crunch
    chains now use the Furnace, with new Chime and Lead chains. Ported in
    `amp.rs` (`CLASSICS`); `tests/amp_parity.rs` has a case per amp and
    one that switches amps mid-render.
  - Not a listed step: the Tremor, a bass amp (2026-11-09, commit to come;
    asked for by the user, who named it), after the SGT-DI, the B7K /
    Vintage Ultra and the Parallax X: Tube, Grind and Split voices.
    `src/effects/tremor/`, sharing the Furnace's filters and oversampling
    (`AMP_PARTS_SOURCE`; in Rust, `amp.rs`'s parts made `pub(crate)`).
    Ported in `crates/dawn-engine/src/effects/tremor.rs`
    (`tests/tremor_parity.rs` matches the JavaScript exactly). The Bass
    chain now uses it, and there's a Heavy Bass chain.
- **Next listed: step 35, native file dialogs.** Wait for the user to say "go"
  before starting a step: they ask for each one ("Lets go with step N").
- **What's left after that,** in order (the full list, with sizes, is in
  `nextSteps.md`; a summary is under "The road ahead" below):
  plugins (AU, on a Mac), shipping (native dialogs, signed installers), an accessibility pass, and last the desktop's driver,
  device and inputs picker, which waits for ASIO.
- **Known loose ends:**
  - With the native engine on, the loudness readout still reads the
    browser's audio, which is silent then (the track and input meters read
    the engine's).
  - Native recording, not yet: recording another track's audio ("Audio
    from"), and an interface's inputs in stereo (a pair as one take).
  - `e2e/recording.spec.ts` and two piano-roll tests have failed now and
    then under load and pass when run again. Nothing to fix so far.
  - Autosave into a real project folder hasn't been tried end to end (the
    tests can't pick a folder).
  - `scripts/fix-export-segments.mjs` works around a Next export bug on
    Windows; drop it once Next fixes it (see the item log).
  - The next release's "What's new" (`src/content/whatsNew.ts`) has to be
    written: everything since section markers (`23dbe29`) is new.

### Each step, the routine

1. Read the step in `nextSteps.md` and its item in `IMPROVEMENTS.md`, then
   the code it touches. For Next-specific code, read
   `node_modules/next/dist/docs/` first (`AGENTS.md`).
2. Build it in both engines where it's about sound (the browser's
   `src/engine/`, the native `crates/dawn-engine/`), with unit, component
   and e2e tests.
3. Run the checks (below).
4. Tick it off in three places: `nextSteps.md` ("Done <date>", with a
   line on what changed from the plan), `IMPROVEMENTS.md` (`[x]`, then
   "(commit to come)", filled in with the hash once the user has
   committed), and this file (an entry in the item log, and "Start here").
5. Leave everything uncommitted. Report what was done and the test
   results (failures included), and give the commit command.

## The project, briefly

The Dawn Project is a browser DAW, also built as a desktop app.

- **Web app:** Next.js 16 (static export), React, TypeScript, Tailwind v4,
  Tone.js. `AGENTS.md` says this Next.js has breaking changes: read
  `node_modules/next/dist/docs/` before writing Next-specific code.
- **Desktop app:** Tauri 2 (`src-tauri/`). It shows the same studio in a
  native window, and adds a Rust audio engine that plays through the
  interface's own driver (Core Audio, WASAPI; ASIO behind the cargo
  feature `asio`, off; `DAWN_ASIO=1` in `.env` turns it on for local
  builds, see docs/desktop.md).
- **Rust workspace:**
  - `crates/dawn-engine`: the engine. Plain Rust, no dependencies.
  - `crates/dawn-plugins`: VST3/CLAP plugin scanning.
  - `crates/dawn-test-plugin`: a test plugin.
  - `src-tauri`: the desktop app (crate `dawn-desktop`).
- **Repo:** `angelzxz1/The_Dawn_Proyect`. Default branch `main`.
- **Where things are in the studio:**
  - `src/studio/Daw.tsx`: the studio, which wires everything together.
  - `src/state/`: the project store (`projectStore`: `push` for an undo
    step, then `set`/`get`) and the actions on it (`trackActions`,
    `effectActions`, `clipActions`...).
  - `src/project/`: the project's types, `projectSchema.ts`
    (`normalizeProject`, which every saved field goes through), templates.
  - `src/engine/`: the browser engine (`audioEngine.ts`), `engineSync.ts`
    (makes the engine follow the project, the same calls for playback and
    the bounce), and `native/describe.ts` (what's sent to the native
    engine).
  - `src/effects/`, `src/instruments/`: each device's model, kernel and UI.
- **Docs:**
  - `IMPROVEMENTS.md`: the improvement items, ticked with their commits.
  - `nextSteps.md`: the order to do what's left. It's local only (in
    `.gitignore`), so if it's missing, "The road ahead" below has it.
  - `docs/desktop.md`: the desktop app and porting kernels.

## Goals and the user's decisions

- **Original goals:** ASIO, and third-party plugins (VST3, CLAP, AU) on
  Windows and macOS.
- **Order:** the user chose "Native engine first". The native engine
  should play everything the browser engine plays before the plugin work
  continues. The stages:
  1. Playback through the device. Done.
  2. Instruments. Done (PRs #7, #8).
  3. Effects. Done: every effect, its own DSP kernel or built from Web
     Audio nodes (PRs #9–#13, then `fd0e076` to `cd4775f`). The NAM Amp
     stays out (below).
  4. Sidechains and automation (Phase 7). Delay compensation was planned
     here and was brought forward into stage 3 (PR #11). Sidechains done
     2026-11-03 (step 24); automation next.
  5. Live input and recording (Phase 8).
  6. Then the plugins: P2 CLAP effects, P3 VST3 effects, P4 plugin
     instruments, P5 Audio Units (Phase 9).

  The studio's UX items (Phases 3-6) fit between the stages, since they
  don't wait on the engine. Where both need a feature, the studio settles
  the model first and the engine ports it.
- **NAM (2026-10-31):** not in the native engine. On the desktop, NAM
  models play through NAM's own plugin once VST3 plugins run; the
  built-in NAM Amp stays a browser effect.
- **ASIO: decided later.** The options:
  - Steinberg's ASIO licence agreement, signed by the owner (my
    recommendation, since `LICENSE.md` keeps Dawn proprietary). It's
    free; once both sides sign, the About window and the site's download
    and legal pages must carry "ASIO is a trademark of Steinberg Media
    Technologies GmbH, registered in Europe and other countries" (with
    the ASIO compatible logo on the site), and the SDK must never go in
    the repository.
  - The GPLv3 ASIO SDK, which would make every build with ASIO GPLv3.
  - Staying on WASAPI.

  On 2026-10-30 the user said they'll take this up once they consider
  the DAW finished. Keep ASIO off (cargo feature `asio`) until they
  confirm Steinberg has signed. The desktop driver/device/inputs picker
  (step 38) is the very last step, so it's built with ASIO in it.
- **Standing constraint (the user's words):** "Remove any github links or
  sponsors or any link related to github as well any message saying
  github. All feedback will be done via discord." This applies to app and
  site content. Repository docs may mention GitHub (CI, installers), but
  prefer other links.

## How the work is done (conventions)

**Branch and commits:**

- Work on `main` (since 2026-10-29): the user said "Let's work for now on
  main always. I'll let you now when we'll create a new branch." Don't
  branch until they say so.
- Don't commit. The user commits; give them the command, in PowerShell,
  with several `-m` flags: a short title and a paragraph on what changed (in
  the user's terms):

  ```powershell
  git add -A
  git commit -m "Title" -m "What it does."
  ```

- Before 2026-10-29, work went through PRs from `claude/busy-rubin-wagwyi`
  (one per stage, merged when CI was green). That's paused.

**Checks before handing a step over:**

- `npx tsc --noEmit` and `npm run lint` (both clean).
- `npx vitest run`: 835 unit and component tests on 2026-11-04, in the
  projects `unit` (Node), `components` (Chromium) and `web-audio`. The
  component tests have a 30 s limit (`vitest.config.ts`), and the slow
  unit tests their own; no `--testTimeout` needed.
- `npm run build`, then `npx playwright test --workers=2`: 183 tests, 1
  skipped, all passing on 2026-11-03 (about 10 minutes). It serves `out/`,
  so build first or it tests the last build. Use 2 workers: a full run
  with more was once stopped because the computer ran low on memory. Run a
  single spec while working (`npx playwright test e2e/<name>.spec.ts`).
- When the Rust changes: `cargo fmt --all --check`,
  `cargo clippy --workspace --all-targets -- -D warnings`,
  `cargo test --workspace`. In PowerShell put cargo on the path first:
  `$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"`.

CI (`.github/workflows/ci.yml`) runs `cargo test -p dawn-engine -p dawn-plugins`,
clippy and fmt. `desktop.yml` builds on Windows, macOS and Linux.

**Gotchas:**

- Playwright's `getByTitle("Stop")` (and `getByRole` names) match any
  substring, ignoring case. A new tooltip with "stop", "play", "close" and
  the like in it breaks tests that look for those buttons (a loudness
  tooltip with "stop" in it broke 19 tests in step 18). Check new titles
  against the e2e tests.
- The shell is Windows (PowerShell, with Git Bash for the Bash tool). A
  heredoc with an apostrophe in it fails in Bash, so put multi-line edit
  scripts (Python, `assert s.count(a) == 1` before each replace) in the
  session's scratchpad and run them from there.
- The repo isn't Prettier-formatted: don't run `prettier --write`.
- `next dev` re-adds the block in `AGENTS.md`; leave it be.
- This machine (2026-11-02) has Node 26, and Playwright 1.56.1's
  installer breaks on it (`rmdir` with `recursive` is gone): it downloads,
  then stops unpacking. The browser was installed by hand: the zips from
  `cdn.playwright.dev/dbazure/download/playwright/builds/` (`chromium/1194/chromium-headless-shell-win64.zip`
  into `%LOCALAPPDATA%/ms-playwright/chromium_headless_shell-1194`,
  `winldd/1007/winldd-win64.zip` into `winldd-1007`), unpacked with
  Windows' `tar`, each with an empty `INSTALLATION_COMPLETE` file. A
  Playwright update, or Node 24 (fnm), would fix the installer.
- Rust (cargo 1.99.1) was installed on 2026-11-03, in
  `%USERPROFILE%\.cargo\bin`, which a shell opened before that may not
  have on its Path: `$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"`.
  The cargo checks (fmt, clippy with `-D warnings`, test) pass: 164
  tests, 1 ignored, on 2026-11-03 (step 24).

**Writing style for code and docs:** plain, short sentences in the
codebase's voice. Comments say what something is for. Match the
surrounding comment density. Reports to the user are plain too: what
changed, in their terms, then the tests.

## The road ahead

A summary of `nextSteps.md` from step 21 on (sizes: S a session, M a few,
L a stage of its own).

- **Phase 6, mixing (the rest):**
  - 21. Part 2 #23, one style for every window (M). Done 2026-11-02.
  - 22. Part 2 #10, the mixer view (L). Done 2026-11-02.
  - 23. Part 2 #26, detached or second-screen windows for the mixer and
    the piano roll: Tauri windows on the desktop, pop-outs in the browser
    (L). Done 2026-11-02.
- **Phase 7, native stage 4:** 24, sidechains in the engine. 25,
  automation in the engine. Both done 2026-11-03.
- **Phase 8, recording, then native stage 5 (done 2026-11-04):** 26, monitoring
  modes per track (In, Auto, Off; #14). 27, punch-in and punch-out in the loop
  (#15). 28, input channels on multi-input interfaces (#17). 29, live
  input and recording through the engine.
- **Phase 9, plugins:** 30, CLAP effects (windows in #23's style, state
  saved). 31, VST3 effects (NAM's own plugin first). 32, plugin
  instruments. 33, Audio Units.
- **Phase 10, shipping:** 34, export through the engine. 35, native file
  dialogs. 36, signed installers.
- **Throughout:** 37, Part 2 #27, accessibility (labels and focus as each
  piece is built, a full pass after Phase 6).
- **Last:** 38, the desktop's driver type, then device, then its inputs,
  as Ableton does, once ASIO can be turned on. The user's words: the
  desktop version "will ask for the controller or driver and will show the
  inputs for the driver or controller like in ableton, where you choose
  asio as the driver type and then the audio device, which in my case is
  UMC Asio Driver." The browser keeps listing every input.

## Key techniques

### Parity ports (how a kernel moves to Rust)

Each JavaScript kernel (kept as source text so worklets and tests run the
same code) is ported step for step:

- `f64` state and `f32` buffers, with `as f32` wherever the JavaScript
  writes to a Float32Array.
- The arithmetic in the same order.
- `js_round(x) = (x + 0.5).floor()`, `pub(crate)` in `instruments/mod.rs`.
- AudioParams are float32 and clamped to their ranges, so ports clamp and
  round to f32 the same way (see `pitch_shift.rs`, `ShifterParams`).

A fixture holds each port to the JavaScript:

- `src/effects/<name>/<name>Parity.ts` renders the cases with the JS
  kernel, the way its worklet runs it (128-frame blocks, meters every N
  frames).
- `<name>Parity.test.ts` calls
  `describeEngineFixture(what, fixtureName, testName, render)`
  (`src/test/engineFixtures.ts`).
- The output is `crates/dawn-engine/tests/fixtures/<name>.{rs,bin}`.
  Remake it with `UPDATE_ENGINE_FIXTURES=1 npx vitest run --project unit <testName>`.
- `crates/dawn-engine/tests/<name>_parity.rs` renders the same cases in
  Rust with `FixtureReader` and `Signal` (`tests/common/mod.rs`), with a
  tolerance of 1e-5. Run with `-- --nocapture` to see the largest
  difference per case.
- Shared constants (`src/test/kernelParity.ts`): SR 48000, FRAMES 19200,
  BLOCK 128, STRIDE 17. Kernels are evaluated with
  `new Function(SOURCE + "; return Kernel")()`.
- Results so far: bit-exact everywhere except the Furnace amp, which is
  within one float32 step (at most 1.5e-8). That's probably last-bit
  differences between V8's `tanh`/`pow` and libm, compounded at 4x rate.

To add an effect, follow `docs/desktop.md` → "Porting the next kernel":

1. Write `effects/<name>.rs` and register it in `effects/mod.rs`, adding
   its key to `PORTED`.
2. Add an `EffectSettings`/`Kernel` variant in `mix/fx.rs` (box large
   settings), and its `latency()` if it has any.
3. Add the key to `NATIVE_EFFECTS` in `src/engine/native/describe.ts`. A
   test checks it matches `PORTED`.
4. Update the panel text (`src/studio/transport/NativeEngineSection.tsx`)
   and `docs/desktop.md`.

### Engine model (`crates/dawn-engine/src/mix/`)

**Preparing a song:**

- `Song::prepare(previous, sr)` runs off the audio thread. It builds
  every buffer, instrument (`Player`), effect, delay line and the
  compensation plan.
- `Engine::set_song` swaps in, from the version already playing, the
  instruments (by track id and kind), effects (by effect id and kind) and
  delay lines (by id and length), so an edit never cuts audio off.
- The audio thread never allocates. The amp's tone-stack refit uses
  fixed arrays for that reason.

**Effect chains (`mix/fx.rs`):**

- Where they run:
  - a track's after its sources, before its fader;
  - a bus's on its sends;
  - the master's after its fader, before the limiter.
- A bypassed effect is skipped and keeps its state.
- Multiband kernels work out their glide per call, so they run in
  128-frame chunks.

**Delay compensation (`mix/latency.rs`):**

- A port of `src/engine/latency.ts` `planCompensation`, in frames.
- The delays: own (a group's own sources), channel (after a track's
  effects), send, bus, and a shared direct path to the master.
- Live tracks (the armed MIDI track, and what it plays through) skip
  compensation and go straight to the master.
- The clicks wait the total.
- The studio sends `compensation` (the Audio panel's setting) and
  per-track `live` through the follower (`src/engine/follower.ts`
  `compensation()`).

**Effect latencies:**

- Limiter: its lookahead, 240 frames at 48 kHz.
- Glue Compressor with oversampling: 15.
- Crusher: 15 (always oversampled).
- Tremor: 16 (always oversampled).
- Pitch Shift: window·sr/2 + 2.
- Furnace: 16.

**Sidechains** (`keys.rs`, step 24): the studio sends a keyed effect's
`sidechain` (its source's id and tap) only for the keys the browser
connects (`describe.ts` `connectedKeys`, `resolveSidechains` over the
routing, inputs from other tracks included). The engine resolves them
again in the same order (`keys::resolve`; a key that would loop is
dropped and its effect hears its own input), points each detector at
its key (`EffectSettings::set_external`), and mixes the tracks and buses
in an order where every source comes before what it keys
(`keys::order`, keeping the tracks' depth order otherwise; a bus can key
a track). Each key is copied at its tap as its source goes by (pre-FX:
the source's input; post-FX: after its effects, ahead of its
compensation; post-fader: its strip's output) and waits
`keys::Timing::key_delay` frames, the port of `keyDelay`, from the
engine's own plan; it carries into the next version of the song as the
other delays do. The kernels' `process_keyed` (Gate, Glue, the
multiband two) and the Compressor's `process_in_place` take the key.

**Automation** (`automation.rs`, step 25): the studio sends each track's
lanes with points (`describe.ts` `nativeLanes`: the fader's in dB, the
pan's, and those of its effects the engine plays; each point's `curve`).
`automation::value_at` is `interpolateAutomation`, `curve_shape` is
`curveShape`. `Track::volume_at` and `pan_at` read the lanes in place of
the fader and pan, at the block's end, and the strip glides there over
the block; a new version of the song glides on from the level and pan
last applied (`Engine::set_song` carries `track_applied` over by id), so
an edit doesn't dip an automated fader. An effect's lanes go in its `EffectSpec::automation`, with its
type and parameters: `Song::prepare_effects` makes its settings every
`STEP` (50 ms, the studio's control rate) where the lanes move, as
`Stage`s (deduplicated; at most 12,000, further apart past that), each
prepared (impulses, LFO tables) and taking what the stage before, the
version playing or the effect's own already made when it's the same
(`EffectSettings::prepared_alike`); unchanged lanes keep the stages
made. At each block's start the engine gives an automated effect the
stage for the transport's position (`stage_at`, `Prepared::fx_stage`
remembering which it has), through `Effect::configure`, as a new
version of the song does. The parameters that shape an impulse or a
chorus's tables (`fx::stepped`: a reverb's decay, damping, early, width
and mode, a chorus's spread and waveform, an IR Loader's normalize) take
each point's value once it's passed rather than gliding: making them
every 50 ms would take too long and too much memory, and the browser's
reverb rebuilds its impulse only once its decay stops moving. A stage's
detector switch follows `keys::resolve` (`EffectAutomation::set_external`).
Delay compensation reads the effect's own setting (as in the browser).

### Testing in the real desktop app (the "probe")

Temporary, never committed:

1. Back up `src-tauri/src/lib.rs` (and `src-tauri/src/audio/mod.rs` if
   you add logging).
2. Add a `probe_log` command, plus an `on_page_load` hook that evals the
   JavaScript file named by the `DAWN_PROBE` environment variable:

   ```rust
   #[tauri::command]
   fn probe_log(message: String) { eprintln!("[probe] {message}"); }
   // in run(), on the Builder:
   .on_page_load(|webview, payload| {
       if payload.event() == tauri::webview::PageLoadEvent::Finished
           && let Ok(path) = std::env::var("DAWN_PROBE")
           && let Ok(js) = std::fs::read_to_string(path)
       { let _ = webview.eval(js); }
   })
   // and add probe_log to invoke_handler, next to engine_info.
   ```

   For song details, an `eprintln!` in `engine_set_song` (`audio/mod.rs`)
   printing `built.compensation`, `prepared.latency()` and the chain
   kinds works well.

3. Build with `npm run build`, then
   `cargo build -p dawn-desktop --features tauri/custom-protocol`, then
   restore the backed-up files at once and check `git diff`.
4. Run under
   `xvfb-run -a -s "-screen 0 1600x1000x24" target/debug/dawn-desktop`,
   with `XDG_DATA_HOME`, `XDG_CONFIG_HOME` and `XDG_CACHE_HOME` pointed
   into a scratch folder.
   - The probe JavaScript sets
     `localStorage["dawn.audioPrefs.v1"] = {nativeEngine:false, nativeDevice:"alsa:null"}`
     and reloads.
   - Then it opens the Beat template, turns the Native engine switch on in
     the Audio panel, adds effects by clicking
     `div[title^="Drag onto the FX rack"]` entries, plays, calls
     `invoke('engine_loop', {start:0,end:30})`, and logs
     `invoke('engine_status')`.
   - Headless runs sometimes stall ("IPC custom protocol failed"). Retry
     up to 4 times.
   - The probe scripts lived in the old container's scratchpad and are
     gone. Rebuild them from this description.

## Files touched in stage 3 (PRs #10-#13)

**PR #10 (Gate, Glue, Parametric EQ, multiband effects):**

- `crates/dawn-engine/src/effects/{gate,glue,param_eq,multiband,mb_dynamics}.rs`
- `effects/sidechain.rs` (`KeyFilter::active()`, `gain()`)
- `mix/fx.rs`
- `tests/{gate,glue,param_eq,multiband,mb_dynamics}_parity.rs` and
  their fixtures
- `src/effects/{gate,glue,parametric-eq,multiband,multiband-dynamics}/*Parity{,.test}.ts`
- `describe.ts` and `describe.test.ts` (the test that compares
  `NATIVE_EFFECTS` with `PORTED`)
- `NativeEngineSection.tsx`, `docs/desktop.md`

**PR #11 (delay compensation):**

- `mix/latency.rs` (new; planner, `Ring`, `Delay`, unit tests)
- `mix/song.rs`: `Track.live`, `Song.compensation`, and on `Prepared` the
  `plan`, the delays and `latency()`
- `mix/engine.rs` (runs and swaps the delays; the clicks wait the total)
- `mix/fx.rs` (`EffectSettings::latency`, `fx::latency`)
- `effects/limiter.rs` (`lookahead_frames`)
- `tests/latency.rs`
- `src-tauri/src/audio/song.rs`: `live` and `compensation`, which
  defaults to true
- `src/engine/follower.ts`, `audioEngine.ts` (`refreshMix` and
  `setFollower` call `follower.compensation`)
- `native/nativeEngine.ts`, `describe.ts` (`NativeSession`)

**PR #12 (Pitch Shift):**

- `effects/pitch_shift.rs` (`PitchShiftKernel`, `ShifterParams`,
  `PitchShifter`)
- `src/effects/pitch-shift/pitchShiftKernel.ts` (the worklet source,
  moved unchanged out of `pitchShifter.ts`)
- `pitchShiftParity{,.test}.ts`, `tests/pitch_shift_parity.rs`

**PR #13 (Furnace amp):**

- `effects/amp.rs`: `AmpSettings::from_params` with the voicings,
  `AmpKernel`, and `AmpEffect` (mono mix to both sides)
- `src/effects/furnace/ampParity{,.test}.ts`, `tests/amp_parity.rs`
- `tests/effects.rs`: the every-type chain test now feeds a 220 Hz tone,
  because the amp blocks DC

## The native engine today

- **It plays:**
  - audio clips;
  - every instrument (piano, Drum Rack, synth), from clips and live keys;
  - the mix: volume, pan, mute, solo, groups, sends (post- or pre-fader,
    `Send.pre`), buses;
  - every effect but the NAM Amp: `PORTED` = chorus, compressor, crusher, delay,
    distortion (the Saturator), eq3, filter, gate, glue, irLoader,
    limiter, mbDynamics, multiband, paramEq, pitchShift, reverb, tremor,
    tubeAmp, tuner, utility;
  - delay compensation, the master limiter and the metronome (its four
    click sounds).
- **The Audio panel lists what it doesn't play:**
  - instruments it lacks;
  - effects: the NAM Amp;
  - tracks with automation.
- **It records** (step 29): the interface's input, opened with the
  output; monitored tracks hear their input channel through their
  effects; takes are written to disk and handed back from their downbeat
  (docs/desktop.md, "Recording").
- **Not yet in the engine:** recording another track's audio, stereo
  takes from an input pair, the loudness readout's levels, Audio Units
  (VST3 and CLAP effects and instruments play, steps 30-32). The
  NAM Amp won't be (NAM's own plugin will play it).

## The native engine plan, stage by stage

Notes on each stage's work, done and to come (the order is in "The road
ahead" above).

1. **The Web Audio-node effects (done).** Their parity can't be checked in node,
   because the nodes don't run there, so their fixtures are rendered in
   Chromium: `src/test/webAudioParity.ts` plays the test signal through
   the studio's own nodes in an OfflineAudioContext, in Vitest's
   `web-audio` project (`<name>Parity.webaudio.test.ts`). Done, on ports
   of Chromium's nodes:
   - The Filter and the EQ Three: BiquadFilterNode (`effects/biquad_node.rs`).
   - The Chorus and the Delay: DelayNode (`effects/delay_node.rs`) and
     Tone's LFO (`effects/tone_lfo.rs`: Chromium's wave-table oscillator,
     AudioToGain's WaveShaper, Scale). The Filter's LFO uses it too.
   - The Saturator: WaveShaperNode with its 2x/4x oversampling
     (`effects/wave_shaper.rs`, Blink's `UpSampler`/`DownSampler`).
   - The Reverb and the IR Loader: ConvolverNode (`effects/convolver.rs`),
     done 2026-10-30. Chromium's is the plain convolution with no latency
     (probed: a mono impulse convolves each side; four channels mix
     L←L·h0+R·h2, R←L·h1+R·h3; a mono input acts as stereo). The port
     works it out its own way: the first 128 taps directly, then FFT
     partitions of 128 (to tap 2048), 1024 (to 16384) and 8192, the longer
     two starting two blocks in so their work (FFT steps and products, as
     jobs) spreads over a block's quanta. A 10 s Reverb takes about 3% of
     a core in release, a 20 s true-stereo IR about 5%; the worst
     256-frame block about 1 ms.
     - The Reverb's impulse is `renderImpulse` ported step for step
       (`reverb.rs`). It matches Chromium to 1e-7 in every case, swaps
       included.
     - A new impulse is made when the song is prepared, off the audio
       thread (`EffectSettings::prepare`, now given the same effect's
       settings in the previous song, so an unchanged impulse is kept).
       The app prepares effects on the song it keeps to follow
       (`Song::prepare_effects` in `engine_set_song`), or every song would
       re-render it. An `ImpulseSlot` carries the impulse and a convolver
       made for it; the audio thread takes it (`Convolution::take`, a
       `try_lock`), and the replaced one rings out (up to 2 at once);
       those rung out go back into the slot, to be freed off the audio
       thread.
     - The IR Loader's file is sent like a clip's (`${rate}:file:<id>`,
       `NativeAudioIds.effectFile`, decoded by `decodeEffectFileAudio`);
       while a new one is on its way the effect keeps the one it had, as
       the browser does.
     - Chromium quirk ported: a ConvolverNode whose input is gone works on
       a mono input, so a mono impulse rings out mono (the left tail on
       both sides).
     - Chromium races, not ported and kept out of the fixture: after a new
       ConvolverNode is connected (an IR swapped in), or one turns mono
       (a mono IR taken out), the BiquadFilters after it sometimes start
       afresh and sometimes not, run to run (their channel count changes
       for a quantum or not). The port carries the filters on.
     - The IR Loader's low cut comes after the convolver, and Off is a
       5 Hz high pass, which turns last-bit differences into drift:
       `ir_loader_parity.rs` holds cases with the cut on to 5e-5 and those
       at Off to 5e-3.
     - The parity harness (`webAudioParity.ts`) now takes files
       (`WebAudioFiles`, a case's `file`), and waits 150 ms at a change
       before resuming, so the Reverb's 40 ms rebuild lands on the
       change's frame.

   They match Chromium to the last bit or a float32 rounding, except where
   an LFO sweeps: Chromium's wave tables come from its FFT, ours are
   summed, so they differ in the last bit. That's under 6e-6 on the Filter,
   and up to 2e-4 on the Chorus (it moves a delay's read position by one
   float32 step now and then); `chorus_parity.rs` allows 5e-4.

   The Saturator is exact without oversampling. With it,
   `saturator_parity.rs` allows 5e-3: the Chromium the tests run (141)
   downsamples with an FFT convolution, the port with the direct one
   Chromium's main branch now uses, and that last-bit difference grows
   into a slow drift of a few 1e-4 in the DC blocker after the shaper (a
   float32 10 Hz high pass with its poles right by DC; Chromium's own
   output drifts as much with its input's last bits). Its latency is what
   the studio measures in Chrome: 128 frames at 2x, 192 at 4x. The
   studio's fallback said 129/193 until this change.

   The ports copy Chromium's graph quirks, since that's what the studio
   plays:
   - A feedback loop runs a block at a time, so what comes back is 128
     frames late. With Ping-Pong only the right side waits.
   - The Chorus's right delay reads its splitter in place. That gives it
     no input in its first block, and odd input for one block whenever the
     feedback loop is wired or unwired (`RightInput` in `chorus.rs`).
   - Tone's LFO sets its "stopped" value whenever its type or phase
     changes, even while running. After a Spread or waveform change, that
     offset stays added to the wave (`initial_value` in `tone_lfo.rs`).

   - The Tuner (`effects/tuner.rs`), done 2026-10-31. It passes its input
     through; Mute fades over 10 ms (Tone's linear `rampTo`; a Tuner made
     muted fades out from its start), matching Chromium to 2e-7. It keeps
     the last 4096 samples of the left side (a one-channel Tone.Analyser
     goes through a ChannelSplitterNode, whose "discrete" mix keeps only
     the first channel) in a `TunerTap` (atomics, no locks), which the
     settings carry and `prepare` keeps from one version to the next. The
     app's `engine_tuner` command reads it from the song it keeps (raw
     f32 bytes; nothing for a bypassed Tuner, which the engine skips), and
     `useTuner` reads from it while the native engine is on
     (`nativeEngine.tunerInput`).

   That's every effect built from Web Audio nodes.

2. **NAM: not in the native engine (the user's decision, 2026-10-31).**
   NAM has its own plugin, and the desktop app will host VST3 plugins, so
   desktop users will play NAM models through it; the built-in NAM Amp
   stays a browser effect. The native panel lists it as played without,
   as now. Building NeuralAmpModelerCore v0.5.4 (with Eigen and
   nlohmann/json) into the engine was tried and worked with MSVC, then
   dropped. If it's ever wanted again, the browser's build is TONE3000's
   `neural-amp-modeler-wasm` 2.0.1, and its `wasm/nam-engine.cpp` does
   more than run the model: fast tanh on, a prewarm on load, loudness
   normalized to -18 dB (within ±12 dB, smoothed), a 10 Hz DC blocker,
   and the worklet fades a new model in over 1024 frames. The core's
   architectures register from static initializers, so a static library
   of it must be linked whole-archive.

   **Fixed 2026-10-31 (the user asked):** that wasm build normalizes a
   model's loudness to -18 dB itself (within ±12 dB), and the studio's NAM
   Amp did it again with Normalize on, so a model that reports its
   loudness was corrected twice, and Normalize Off still normalized. The
   amp now takes the engine's own gain back off (`namModel.ts`
   `engineNormalizationDb`, `namOutputGainDb`): Normalize On normalizes
   once, unclamped as the official plugin does, and Off doesn't. Models
   that report their loudness sound different from before.
3. **Sidechains:** keys routed from other tracks, with the browser's tap
   points and latency alignment (`mixGraph.ts` `resolveSidechains`,
   `keyDelay`). Done 2026-11-03 (step 24, `fdc436b`; see "Engine
   model" above). Tests: `crates/dawn-engine/tests/sidechain.rs` (a gate
   keyed by another track, in the same block whatever the track order; a
   post-fader key; a loop left out; a bus keying a track; the key waiting
   for a limiter ahead of the gate), `keys.rs`'s unit tests (the studio's
   `sidechainRouting.test.ts` cases), `describe.test.ts`, and a test of
   the desktop's reader in `src-tauri/src/audio/song.rs`. Then
   **automation**: done 2026-11-03 (step 25, `d0bfbb7`; see
   "Engine model" above). Tests: `crates/dawn-engine/tests/automation.rs`
   (the fader and pan following their lanes in place of their settings,
   a bent segment, an effect's parameter, an automated effect carrying
   into the song's next version, an automated gate still hearing its key,
   an edit leaving an automated fader where it is),
   `automation.rs`'s unit tests (`interpolateAutomation`'s and
   `curveShape`'s cases, the settings made every 50 ms, a reverb's decay
   stepping), `describe.test.ts`, and a test of the desktop's reader.
4. **Live input and recording through the engine:** done 2026-11-04
   (step 29, `e1f0a41`). `src-tauri/src/audio/stream.rs` opens the
   input (`Request.input`; none named: the output device if it records,
   else its driver's default) at the output's rate; its callback puts
   samples on a ring, and the output's callback takes a block's worth
   (`read_input`; more than two callbacks' worth waiting and the oldest
   go), meters each channel and gives it to the take. The engine adds the
   input to each monitored track's buffer ahead of its effects
   (`Engine::render_with_input`, `LiveInput`, `input_sample`: a channel,
   the last past the device's, or all mixed). A take (`take.rs`): the
   `Capture` on the audio thread pushes the input's channel onto a 30 s
   ring and the waveform's 64-frame buckets onto another; the writer
   thread writes a 32-bit float WAV in the app's cache (`takes/`),
   rewriting its header every second. Each take has its own end flag
   (shared by its capture and writer). `engine_finish_take` waits for the
   writer, then reads from `take_start` = (downbeat - capture start) +
   the mix's latency + the round trip the studio sends, and removes the
   file. `engine_record(probe)` plays the probe's clicks straight to the
   output for **Measure latency**. In the studio, `nativeEngine.ts` is
   the follower that records (`EngineFollower`'s input members); the
   browser engine hands it the interface's monitors (moving them over
   when it starts following, back when it stops), the input meters, takes
   and the measurement; `getRecordingLatency` leaves the mix's latency to
   the engine. The round trip: `measuredNativeRoundTrip`, else the
   drivers' (`Status::round_trip`). Tests: `tests/mix.rs` (a monitored
   track's channel through its fader, the input's mix, the count-in's
   end), `take.rs`'s (a WAV written and read from its downbeat, where a
   take starts, the click), `nativeTake.test.ts`, `nativeEngine.test.tsx`
   (the input opened and metered, monitoring, a take, the measurement),
   `NativeEngineSection.test.tsx`, `TrackHeader.test.tsx`,
   `audioPrefs.test.ts`.
5. **Plugins:** P2 CLAP effects in the engine: done 2026-11-04 (step 30,
   `3d3dbb5`). `crates/dawn-plugins/src/host.rs` hosts a CLAP plugin
   with clack (`ClapPlugin` on the main thread: state, latency, audio
   ports, GUI; `ClapProcessor` on the audio thread, which goes back to its
   `Home` when dropped, and `reclaim` stops and deactivates it). The engine
   has `EffectSettings::Plugin` (`PluginSettings`: a `PluginSlot` and the
   latency) and `Kernel::Plugin`; `Song::prepare` makes a plugin's effect
   only when its slot holds a processor, so the one playing carries on
   otherwise (set_song swaps it in by id and kind).
   `src-tauri/src/audio/hosted.rs` keeps the instances in a thread-local
   on the main thread (the sync commands run there): `make` from
   `song::build_with`, `begin_song`/`end_song` around it (instances of
   gone effects are destroyed once home), `tick` from `engine_status`
   (callbacks, GUI resizes, closed windows, and the dirty states it
   reports), and the windows (`tauri::window::WindowBuilder`, the
   `unstable` feature; the GUI embedded via raw-window-handle). In the
   studio: effect type `plugin` (`src/effects/plugin/`, `hidden` from the
   effect list), `EffectInstance.plugin` (`PluginRef`, with `state` in
   base64, checked by the schema), `effectActions.addPlugin` and
   `setPluginState` (no undo step), the Plugins tab's click to add, and
   `nativeEngine.ts` keeping a dirty plugin's state. The test plugin's
   gain saves its level as its state. Tests: `crates/dawn-plugins/tests/
   host.rs`, `tests/effects.rs`'s plugin test, the desktop's song reader
   test, `describe.test.ts`, `effectActions.test.ts`,
   `PluginBrowser.test.tsx`, `PluginEffectCard.test.tsx`,
   `nativeEngine.test.tsx`, `projectSchema.test.ts`. Not yet: automating
   a plugin's parameters, its sidechain input. Then P3 VST3 effects: done
   2026-11-04 (step 31, `222a5da`). `crates/dawn-plugins/src/
   vst3_host.rs` (`Vst3Plugin`, `Vst3Processor`, the same home-and-reclaim
   lifecycle as CLAP's, a shared `AtomicBool` for home): the component
   from the factory (`initialize` with the host), its `IAudioProcessor`,
   the controller (the component cast, or its controller class made and
   initialized, connected both ways through `IConnectionPoint`, given the
   component's state with `setComponentState`). The host objects are Rust
   COM classes: `Host` (IHostApplication, whose `createInstance` makes
   `Message`/`Attributes`; IComponentHandler, whose edits go on an rtrb
   ring to the processor, which builds `Changes`/`Queue`
   (IParameterChanges, made beforehand) each block; IPlugFrame, whose
   resize is taken in `tick`) and `Stream` (IBStream). State: component
   then controller, each length-prefixed. Activation: stereo bus
   arrangements asked for, every audio bus activated, `setupProcessing`
   (realtime, 32-bit, 2048), `setActive`, `setProcessing`. The editor:
   `createView("editor")`, `setFrame`, `attached(HWND or NSView)`.
   `hosted.rs` wraps both formats in `Instance`. The test plugin's VST3
   gain now runs (a processor with its level as its state and parameter
   0, and a separate controller). Tests: `tests/host.rs` (state, a block,
   an edit from its window, home and out again). Then P4 plugin
   instruments: done 2026-11-07 (step 32, `6b3be82`). The engine:
   `InstrumentSpec::Plugin` (a `PluginSettings`, its slot as an effect's),
   the player's `PluginKernel` (notes by their frame on the engine's
   clock until their block, then each at its offset in it through
   `PluginProcessor::play`; the keys it was told are down, so stopping
   lets go of each; the bend and mod wheel), a new processor (another
   plugin, or another rate) playing at once in `set_song` where the
   others keep the one playing, and its latency in the track's chain
   (`Track::chain_latency`). The hosts: `NoteEvent` in dawn-plugins;
   CLAP's `play` (note events or MIDI, by the first note port's
   dialects; `HostNotePorts`), VST3's (an `IEventList` of its own on the
   first event bus; bend and mod wheel through `IMidiMapping`). The
   studio: `src/instruments/plugin/` (hidden from the picker until the
   track has one), `pluginInstrument` on the track, `trackActions.
   setPluginInstrument` / `setPluginInstrumentState`, the Plugins tab's
   instruments clickable for the MIDI track open in the rack. The test
   plugin's tone now plays (a key's velocity while it's down). Tests:
   `crates/dawn-engine/tests/plugin_instruments.rs`, `tests/host.rs`, the
   desktop's `song.rs`, `describe.test.ts`, `registry.test.ts`,
   `FxRack.test.tsx`, `PluginBrowser.test.tsx`. Then P5 Audio Units
   (put off: it needs a Mac to build on).
6. **Export** through the engine: done 2026-11-08 (step 34, `6e7c555`).
   `dawn_engine::mix::bounce` (an engine of its own, played from
   the range's start, stopped at its end, the tail rendered, the song's
   latency trimmed off the front), `engine_bounce` (built on the main
   thread with the files sent and `export:` plugin instances, rendered on
   a blocking thread, the instances forgotten after; missing files come
   back as an error starting `missing files:`), `nativeEngine.render`
   (stems: only their tracks audible; no master chain: no master effects,
   limiter ceiling at +120 dB), `exportProject`'s `renderer`, and the
   export dialog's note. Tests: `crates/dawn-engine/tests/bounce.rs`,
   `nativeEngine.test.tsx`. Then native file dialogs, signed installers.

## Item log: the studio's improvements

What each finished `IMPROVEMENTS.md` item changed, and where, roughly in
the order they were done, with the fixes made along the way.

- **IMPROVEMENTS.md** (checked against the code on 2026-10-29). It has
  checkboxes, and each finished item names the commit that did it.
  - Part 1 (code) is all done.
  - Part 2 (UX): items 1–13, 16, 18–26 and 28 are done.
    Item 8 (2026-10-31): an Adaptive
    snap setting that follows the zoom, and clips snapping to other
    clips' edges (`clipSnap.ts`; Alt drags free). Item 9 (2026-10-31):
    automation segments bend (`AutomationPoint.curve`, `curveShape` in
    `engine/automation.ts`), lines, freehand and erasing on the lane
    (`project/curveEdits.ts`), and lines or freehand in the velocity lane.
    Item 22 (2026-10-31): track headers say why a track is silent
    (`project/silentStates.ts`: solo elsewhere, a muted group or track it
    plays into, its fader down, no instrument), "No input" while
    monitoring silence (`useNoInputSignal.ts`), and bypassed effects are
    labelled in the rack and counted on the FX button. Item 16
    (2026-10-31): the count-in shows in the transport (`CountIn.tsx`), and
    the click has four sounds (`metronomeKernel.ts` `makeClick`, ported
    in `mix/metronome.rs` with every set made up front; the parity
    session switches between them; `engine_metronome` takes `sound`, sent
    to the audio thread as a `&'static str`). Item 7, section markers, was added
    on 2026-10-30 (`src/project/markers.ts`, `src/state/markerActions.ts`,
    `src/studio/transport/MarkerLane.tsx`, `e2e/markers.spec.ts`), in
    `23dbe29`. The next release's "What's new" (`src/content/whatsNew.ts`)
    should mention it.
  - Item 21 (2026-10-31): a Podcast template (`templates.ts` `podcast`).
  - Item 19 (2026-10-31): a track's header menu does everything its
    header does (rename, color, mute, solo, arm, monitor, effects,
    automation, .mid in and out, move, clear); an effect card has a menu
    (`rack/effectMenu.tsx`: open, bypass, move, duplicate, reset, remove;
    `effectActions.duplicate`). Menu items show their shortcut beside them
    (`ContextMenuItem.shortcut`), and tooltips name theirs through
    `ui/keyLabel.ts` (`withKeys`, "⌘" on a Mac). Every shortcut in the
    registry has a label, for the coming command palette and cheat sheet.
  - Item 18 (2026-10-31): Ctrl/Cmd+K opens the command palette
    (`shell/CommandPalette.tsx`) and `?` the cheat sheet
    (`shell/ShortcutSheet.tsx`), both also in the Help menu. Both list
    `shortcuts.active()` as it was when they opened (`ui/commandSearch.ts`
    finds and groups); the palette runs a command as its keys would
    (`keyEventFor`) once it has closed, and says so when there was nothing
    to do. A shortcut with no keys (`keys: []`) is a palette-only command
    (Daw.tsx has a few: add a track, export, the Keys window...);
    `palette: false` keeps a key-only one (the arrows) out of it.
  - Item 20 (2026-10-31): the browser previews before adding. Effects and
    presets play a phrase through a throwaway copy of the effect
    (`audioEngine.previewEffect`; `library/previews.ts` picks a drum
    groove or a plucked riff, none for the Tuner); the NAM Amp and IR
    Loader list their tones (Dawn's cabinets, the packs') to hear and add;
    the Grooves tab lists the packs' samples (`packSamples`) to hear
    (`previewSample`), add at the playhead or drag onto an audio track
    (`SAMPLE_DRAG_MIME`). Stars and the last 8 things added show as
    Favorites and Recent in both tabs (`library/browserPicks.ts`, in
    localStorage). Bundled tones (none ship yet) aren't previewed: they're
    downloaded only when added.
  - Item 28 (2026-11-01): a Preferences window (`dialogs/PreferencesWindow.tsx`;
    Options > Preferences… (the header's gear until `5a380da`),
    Ctrl/Cmd+, or `openPreferences(tab)` from
    anywhere). Audio: the desktop's native engine section, else the
    browser's output device (`setSinkId`, where the browser has it;
    `audioPrefs.outputDevice`) and buffer size (`browserLatency`, the
    context's latencyHint, read at page load in `context.ts`, so a change
    offers a reload), and delay compensation. Recording: measuring, the
    offset, the note after a take. Metronome: the click's sound and level.
    Projects (`state/studioPrefs.ts`): autosave into a project's folder
    every 1-10 minutes while it has unsaved changes (not while
    recording), and the count-in for templates without their own
    (`ProjectTemplate.ownCountIn`). The CPU panel keeps only its
    readouts, with a link to the window. The theme comes with item 24
    (step 16), as an Appearance tab. Autosave into a real folder hasn't
    been tried end to end (the tests can't pick a folder).
  - Item 24 (2026-11-01): a light theme and the UI size, in Preferences >
    Appearance (`studioPrefs.theme`: system, dark or light; `uiScale`).
    The colors are roles in `globals.css` (`:root`, retuned under
    `html[data-theme="light"]`; new ones: `--warn`, `--marker`, `--tempo`,
    `--switch-*`, `--loop-off`, `--on-accent`, `--row-*`, `--overview-*`);
    the studio's hard-coded hex colors went to them. `shell/theme.ts` puts
    the theme on the page while the studio is open, and `themeBoot.ts`
    does it before the first draw (in `app/app/layout.tsx`). Effect and
    instrument windows, rack cards and the instrument slot keep their dark
    device look in either theme (`.device-skin` resets the roles to dark;
    their own colors stay hex). The size is the desktop app's window zoom
    (`setZoom`, permission `core:webview:allow-set-webview-zoom`): CSS
    `zoom` was tried and puts pointer positions and element boxes in
    different units (1.5x off), which the timeline's ~167 pointer
    reads would all need fixing for, so a browser uses its own zoom
    (Preferences says how). Several effect windows had no
    `role="dialog"`; they got one with item 23.
  - Item 25 (2026-11-01): a project keeps its layout (`SerializedProject.layout`,
    `ProjectLayout`: the zoom, the scroll across and down, the selected
    track or the open bus or master rack, the rack folded, the automation
    lane), and opens with it; a template or an older project opens with
    the standard one. The layout is read when saving (`useProjectFiles`'s
    `LayoutSource`), so changing it isn't an unsaved change, but it
    autosaves the working copy a moment later. The FX rack's fold moved
    from FxRack to the studio. A resizable rack was tried and dropped: its
    cards are a fixed height, so a taller rack was empty space.
  - Item 11 (2026-11-01, `67ea045`): the meters show dB (-60 to +6,
    `tracks/meterScale.ts`), each side's RMS with its peaks over it, the
    loudest peak held 1.5 s, and a clip light that stays on until it's
    clicked (`tracks/Meter.tsx`, on tracks, buses and the master). The
    engine's `LevelMeter` (`engine/levelMeter.ts`) replaced Tone's Meter,
    which gave a smoothed level on a linear scale: it reads each side's
    sample peak and RMS over 1024 samples (`getMeter`, `getBusMeter`,
    `getMasterMeter`). The master's loudness (`engine/loudness.ts`, an
    AudioWorklet running `loudnessKernel.ts`: BS.1770-4 K-weighting and
    EBU R128 gating) gives momentary, short-term and integrated LUFS and
    the loudest sample, shown in the master row (`LoudnessReadout`); it
    starts afresh when playback starts from a stop or a recording starts.
    The kernel matches BS.1770's coefficients and EBU Tech 3341 cases 1
    and 3, and `e2e/meters.spec.ts` checks the studio reads a -23 dBFS
    1 kHz tone as -23 LUFS. In the desktop app with the native engine
    on, the meters still read the browser's audio, which is silent then:
    the engine needs to send its levels (with Phase 7 or 8).
  - Item 13 (2026-11-01, `66c9526`): a send can be taken before the fader
    (`ChannelConfig.preSends`, bus ids; `trackActions.setSendPre`, one undo
    step): after the track's effects and its mute and solo, but not its
    fader or pan. The browser engine taps it after `muteGain`
    (`preSendTap`, delayed as long as the post-fader `sendTap`); the
    native engine takes it from the strip's input with the same mute glide
    (`Send.pre`, `Prepared.track_heard`, `pre_send_delays`;
    `crates/dawn-engine/tests/mix.rs` checks it, as `e2e/routing.spec.ts`
    does by ear for the browser's). The Sends card has a Post/Pre switch
    per send that's on. Hovering a track lights up where its audio goes
    (its group or target track, the master, the buses it sends to, pre or
    post, the tracks taking it as their input) and what plays into it;
    hovering a bus, the tracks sending to it (`tracks/routeHighlight.ts`).
  - Item 12 (2026-11-01, `bfa84ac`): faster effect handling. A rack's card dragged
    onto another track's header, a bus or the master moves there, or with
    Ctrl/Alt/Cmd held is copied (`studio/rack/effectDrag.ts` carries it:
    `RACK_EFFECTS_MIME` is `{ host, ids }`; `effectActions.transfer`, one
    undo step; a copied sidechain that would listen to its new host is
    dropped). The browser's effects and chains drop there too, and a chain
    into a gap in the rack; the studio says what went where. A card's menu
    copies it or the whole chain and pastes (`state/effectClipboard.ts`,
    in memory, across projects). The rack's Save chain keeps a chain under
    a name in localStorage (`effects/userChains.ts`, like user presets),
    listed first under Chains with a delete button; only factory cabinets
    are kept with it, since other files belong to their project.
  - Item 23 (2026-11-02, `54dd0d8`): one frame for every device window,
    `src/ui/DeviceWindow.tsx`. It draws the dark panel and the title row
    (`mark`, `title` or a styled `heading`, `subtitle` for the track,
    `tools` after the name, `actions` on the right, `bypass`, close titled
    `CLOSE_TITLE`, "Close (Esc)"). It also handles Escape (the "window"
    shortcut layer), `role="dialog"` named "Device — Track", `aria-modal`,
    focus in on open, a Tab trap, and focus back on close. Effects use it
    through `PluginWindow` (`effects/ui/PluginChrome.tsx`, with the preset
    menu and bypass); the 14 effect windows that drew their own frame now
    use it too, and `EffectWindow` no longer binds Escape. The Drum Rack
    (kits as `tools`, volume as `actions`) and the synth (`fit` scales its
    fixed 1200x734 panel to small screens; its own `background`) use it
    directly. The Keys window (`NoteInputWindow`) is `floating`: no
    backdrop, not modal, no Escape, dragged by its title row, position in
    `dawn.noteInputPos`; it's now named "Keys — Track". Parametric EQ and
    Multiband pass `onPanelKeyDown` for Delete. Tests:
    `src/ui/DeviceWindow.test.tsx`; `e2e/effects.spec.ts` looks for
    "Close (Esc)", `e2e/instruments.spec.ts` for "Keys — Bass".
  - Item 10 (2026-11-02, `0078489`): the mixer view,
    `src/studio/mixer/Mixer.tsx`. The toolbar's Arrange / Mixer buttons
    (or F3: letters play notes, and Cmd+M minimizes on a Mac) swap the
    arrangement for it; the arrangement is hidden, not unmounted, and
    its scroll is kept in `arrangeScrollRef` meanwhile (hidden, it reads
    as 0). The view is saved in the layout (`ProjectLayout.view`). The
    master/bus row goes while the mixer shows: the mixer has their strips
    and the loudness readout. Strips: every shown track (a folded group
    hides its tracks), the buses, "+ Bus", and the master pinned at the
    right. Each has Audio from, inserts (instrument first; a click opens
    the effect's or instrument's window, the light bypasses), sends with a
    pre switch, pan, M/S/arm, `Fader` (`studio/mixer/Fader.tsx`: -60 to
    +6 dB on the meter's own scale, so the cap lines up with `Meter
    scale`; drag, Shift fine, wheel, arrows 0.5 dB, Page 3 dB, Home/End,
    double-click 0 dB) and Audio to. A click on a strip selects it (its
    FX rack shows), hovering lights its routing, and effects dropped on
    it are added. The studio passes `MixerActions` through
    `useStableActions`. Buses gained a fader, pan and mute
    (`BusConfig.volume`/`pan`/`muted`, saved only when not the default):
    `busActions.setVolume`/`setPan`/`toggleMute`, `engineSync`
    (`syncBusMix`), `audioEngine.setBusMute`, the bounce, and the native
    song (`describe.ts` sends `volumeDb`, `pan`, `audible`; `BusSpec`
    in `src-tauri/src/audio/song.rs` reads `audible`, default true, and
    shuts the bus when false; the engine already had bus volume and pan).
    Tests: `src/studio/mixer/Mixer.test.tsx`, `e2e/mixer.spec.ts`,
    `engineSync.test.ts`, `describe.test.ts`, `projectSchema.test.ts`,
    and a Rust test in `song.rs`. The Rust was built and tested on
    2026-11-03, once Rust was installed.
  - Item 26 (2026-11-02, `4b1d2c7`): the mixer and the piano roll
    in windows of their own, for a second screen. "Pop out" in the
    mixer's bar and in the piano roll's title row; "Back to the main
    window" there, or closing the window (for the piano roll, closing
    also stops editing). One React tree: `src/ui/Popout.tsx` opens a
    blank window (`openPopout`, from the click, or browsers block it) and
    portals into it, so the project, undo and the engine are the same.
    It copies the main page's stylesheets in as rules (`<style>`, url()s
    made absolute: a blank window's `<link>` didn't load under
    Playwright's request routing, and rules need no loading) and mirrors
    the `<html>` and `<body>` attributes (the theme). Size and place are
    kept per window in localStorage (`dawn.popout.<name>`); which windows
    are open isn't saved (no click on load). They close with the main
    page. What's in a window uses that window's frames, timers, listeners
    and ResizeObserver (`src/ui/hostWindow.ts`: `useHostWindow`,
    `useDetachedWindow`): the piano roll, `ClipOverview`, `Meter`,
    `LoudnessReadout`; a minimized main window would stop its own.
    Shortcuts are scoped by window (`ShortcutRegistry.attach`,
    `keyDown(e, from)`): keys in a window go to what's in it, then to
    shortcuts marked `everywhere` (play, undo, redo, save). The main
    window's layers don't wait for a detached piano roll (it's modal only
    in its own window), and the command palette lists the main window's.
    The mixer popped out leaves the arrangement; the Mixer button or F3
    brings its window forward. The piano roll's window stays open between
    clips and fills the window (its grid's height isn't fixed there).
    Desktop: `src-tauri/src/lib.rs` builds the main window in `setup`
    (`"create": false` in `tauri.conf.json`) with `on_new_window`: an
    about:blank request gets a Tauri window
    (`WebviewWindowBuilder::window_features`, its title from the page,
    file drop off for effect drags); anything else is left to the
    webview, as before. Built, linted and tested on 2026-11-03. Tried in
    `npm run desktop` by the user that day: "Back to the main window" left
    the native window open and empty, and popping out again opened another
    (wry's `window.close()` destroys the webview, not the window). Fixed
    (2026-11-03, `612a0c2`): the desktop opens them at
    `about:blank#dawn-<name>`, labels the window after it, and closes it
    with the `close_studio_window` command (`Popout.tsx` `closeWindow`);
    the main window going closes the others (`on_window_event`). The user
    tried the fix in `npm run desktop` the same day: it works. On the
    desktop a detached window isn't zoomed with the UI size (that's the main webview's zoom). Effect and
    instrument windows opened from a detached mixer open in the main
    window. Tests: `e2e/popout.spec.ts`, `src/ui/Popout.test.ts`,
    `src/ui/shortcuts.test.ts`, `Mixer.test.tsx`.
  - The menu bar (2026-11-03, `5a380da`; the user asked for it, not
    a listed step): File, Edit, Create, View, Options, Help across the top
    of the studio, as desktop DAWs have it (`src/studio/shell/MenuBar.tsx`:
    menus of items with their keys, checks for settings, links, notes;
    pointing at another menu while one is open opens it; the arrows, Enter
    and Escape work, and the studio's keys wait while a menu is open). The
    old header went: the logo and "The Dawn Project" (the user: the tab,
    or the desktop's title bar, has the name), the File dropdown (now
    `dialogs/FileMenu.tsx` `useFileMenu`, which also gives the Save As
    dialog and the file picker; "Export Audio…" was added to it), the gear
    (Options > Preferences…), Help (`HelpMenu.tsx` removed; its items are
    in Help), Feedback, Support and About (all in Help). The project's name
    and its unsaved dot sit at the bar's right, with the errors and the
    project notices. Create adds MIDI, audio and group tracks; View has the
    Arrangement and the Mixer, the browser, the Keys window, the master's
    effects and the zoom; Options the metronome, the loop, MIDI overdub
    and Preferences. The browser down the left (effects, grooves,
    plugins) shows and hides from the button at the bar's left, View >
    Browser or Ctrl+Alt+B, remembered in localStorage
    (`dawn.browserOpen`); the tour shows it while it runs. Tests:
    `e2e/menubar.spec.ts`, `MenuBar.test.tsx`; `e2e/studio.ts` has
    `menu(menu, item)`, and the tests that used the header's buttons go
    through the menus.
  - Item 14, monitoring modes per track (2026-11-04, `f750344`;
    step 26): each audio track is In, Auto or Off, as in Ableton, in place
    of the one toggle. `src/studio/tracks/monitoring.ts` decides which
    tracks hear their input now (`monitoredNow`): In always, Auto while
    armed and stopped or paused, or recording onto it (playing back, the
    clips play instead), Off never; the clips play in every mode. Daw.tsx
    keeps the modes and opens and closes each track's input from that set,
    which also feeds delay compensation's live tracks and the export. The
    headphones button goes Off → In → Auto → Off (filled for In, dashed
    for Auto, filled while Auto hears); the track's menu has a Monitor row.
    A project saves In as `monitoredTracks` (so an older version still
    hears them) and Auto as `autoMonitoredTracks`. Only the studio has
    modes so far: the native engine takes no input until step 29, which
    uses this model. Tests: `monitoring.test.ts`, `contextMenus.test.tsx`,
    `projectSchema.test.ts`, `TrackHeader.test.tsx`, `e2e/tracks.spec.ts`.
  - Item 15, punch-in and punch-out (2026-11-04, `2331049`; step
    27): Punch (the brackets button in the transport, Options > Punch
    In/Out, saved with the project as `punch`) makes a recording keep only
    what's between the loop brace's ends, loop on or off.
    `src/project/punch.ts`: `punchedPasses` cuts each of a recording's
    passes (`recordingPasses`) to the range, for audio and MIDI alike
    (overdub included), and `punchRecordFrom` starts recording at the
    marker, or a bar before the punch-in when the marker is at or past the
    punch-out. The transport plays on after the punch-out; the live take
    still draws from where recording started, and Auto monitoring hears
    the input for the whole recording (a DAW that switches to the input
    only inside the range would need the playhead's position in
    `monitoredNow`). The lanes show the range with dashed red ends. Tests:
    `punch.test.ts`, `projectSchema.test.ts`, `e2e/recording.spec.ts`.
  - Item 17, input channels on multi-input interfaces (2026-11-04,
    `9c63222`; step 28): an audio track keeps `inputChannel` (0 =
    input 1; unset, the device as one channel, as before), picked in a
    small list beside its Input (In 1, In 2... or All), shown when the
    browser lists the device with more than one channel
    (`InputDeviceInfo.getCapabilities().channelCount`, Chrome and Edge;
    `inputChannels.ts`). `src/engine/inputs.ts` opens each input under a
    key (`inputKey`: the device's id, then `#n`): the device as one
    channel is its own mono stream, as before; a channel comes from a
    second stream of the device opened with all its channels and split,
    shared by every track taking a channel of it and closed when none
    does. A channel past the device's last gives its last. The meter,
    monitor and recording all take the track's key. Tests:
    `inputChannels.test.ts`, `TrackHeader.test.tsx`,
    `projectSchema.test.ts`, `e2e/recording.spec.ts` (input 2 of the
    fake microphone, which has two channels).
  - Item 27 is open. Next in `nextSteps.md` is Phase 10, step 35 (native
    file dialogs; step 33, Audio Units, waits for a Mac); steps 24, 25,
    29-32 and 34 (sidechains, automation, recording, CLAP and VST3 effects
    and instruments, and export in the engine) are logged under "The
    native engine plan".
  - Fixed 2026-10-31: on Windows, Next's static export wrote each page's
    prefetch files as folders (`__next.!KHNpdGUp/__PAGE__.txt`, from a
    backslash it doesn't turn into a dot) where its router asks for
    `__next.!KHNpdGUp.__PAGE__.txt`, so every site prefetch 404'd (and
    `e2e/site.spec.ts` failed). `scripts/fix-export-segments.mjs` runs
    after the build (`postbuild`) and flattens them; on macOS and Linux
    there's nothing to fix. Check whether a Next update fixes it
    (`export/index.js`, `collectSegmentPaths`) and drop the script then.
  - Fixed 2026-10-31 (the user found it): changing one audio track's
    Input changed every audio track's, as the studio kept one device for
    all and the engine one stream. Each audio track now keeps its own
    (`ChannelConfig.inputDevice`, saved with the project; a device that
    isn't there reads "Not connected" and records from the default), and
    `InputManager` opens a stream per device in use (`setTrackDevices`,
    `inputSource(channelId)`, `getInputPeak(channelId)`), closing those no
    track uses. Measuring the latency listens on the armed track's
    device.
  - On 2026-10-31 the user asked for one loop switch: the arrangement
    toolbar's "Loop" stays; the transport bar's and the small one above
    the tempo lane are gone. The automation lane's row is now as wide as
    the song (it stopped at the view's width once scrolled).
  - `e2e/recording.spec.ts` failed now and then with several workers on
    2026-10-31 (each test's time swinging 14-36 s); with one worker, and
    in most runs, it passes. On 2026-11-01 two piano-roll tests (the
    Draw/Select switch, Follow) failed once in a full run and passed 12
    of 12 when repeated: load, not a bug.
  - The project document now has `markers` (in beats). The native engine
    ignores them; they only move the playhead and the loop.
- **Phases done** (of `nextSteps.md`): 1, housekeeping (2026-10-30); 2,
  the engine's effects (2026-10-31; NAM dropped from it); 3, editing; 4,
  finding things (both 2026-10-31); 5, settings and look (2026-11-01);
  6, mixing (steps 18-20 on 2026-11-01, 21-23 on 2026-11-02). Next is
  Phase 7, step 24.
