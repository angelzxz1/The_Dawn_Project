# The desktop app

Dawn is becoming an installable desktop app as well as a website. The
desktop app is built with [Tauri 2](https://v2.tauri.app): the same studio
(the static site `npm run build` makes) in a native window, with a Rust side
that will take over the audio from Web Audio. That's the way to low-latency
recording through audio interface drivers (ASIO on Windows, Core Audio on
macOS) and, later, hosting installed VST3 and CLAP plugins.

It's early. Today:

- **The window works**: `npm run desktop` opens the studio in its own
  window, and `npm run desktop:build` makes installers.
- **The native engine plays audio (beta)**: turned on in the Audio panel
  (the CPU meter in the transport bar), it plays the song through the audio
  interface's own driver - Core Audio on macOS, WASAPI on Windows (ASIO once
  its licence is signed, below). So far it plays the audio clips and every
  instrument through the mix (volume, pan, mute, solo, groups, sends), the
  dynamics and EQ effects, the Filter, the Chorus, the Delay, the Reverb,
  the Saturator, the Pitch Shift, the Furnace amp, the IR Loader and the
  Tuner, with sidechains, automation, delay compensation, the master
  limiter and the metronome. It records too: the interface's inputs,
  monitored through the track's effects and written to disk as they come
  in (below). Recording another track's audio still needs the browser's
  engine, and the NAM Amp stays a browser effect (on the desktop, NAM
  models are meant to play through NAM's own plugin, once plugins run in
  the engine): the panel says what of the project it doesn't play yet.
- **The DSP is moving over**: `crates/dawn-engine` holds the kernels ported
  to Rust so far - the instruments, the dynamics and EQ effects, the
  Filter, the Chorus, the Delay, the Reverb, the Saturator, the Pitch
  Shift, the Furnace amp, the IR Loader, the Tuner, the metronome and clip
  playback - each tested against the JavaScript's own output, or for the
  effects built from Web Audio nodes, Chromium's (below).

## Getting the installers

GitHub makes them on every push to `main`
(`.github/workflows/installers.yml`): a `.dmg` for macOS, one app for both
Apple Silicon and Intel Macs, and an `.msi` and a setup `.exe` for Windows.

1. On the repository's page on GitHub (signed in), open **Actions →
   Desktop installers**, and the newest run with a green check.
2. Under **Artifacts** at the bottom, download **Dawn-macOS** or
   **Dawn-Windows** (a `.zip` with the installer in it). Runs keep them for
   30 days; **Run workflow** on that page makes a fresh set.

They aren't signed with a developer certificate yet (that takes an Apple
Developer account and a Windows code-signing certificate), so each system
asks once:

- **macOS**: open the `.dmg` and drag Dawn to Applications. The first time
  you open it, macOS says it can't verify the developer: click **Done**,
  then **System Settings → Privacy & Security**, scroll down to the note
  about The Dawn Project and click **Open Anyway**. (On macOS 14 and older,
  right-click the app → **Open** does it.) The Mac app is signed ad hoc
  (`signingIdentity: "-"` in `tauri.conf.json`), which is what lets it open
  this way instead of being called damaged; a Developer ID replaces it
  later.
- **Windows**: run the `.msi` or the setup `.exe`. If SmartScreen says it
  protected your PC, click **More info → Run anyway**.

## Running it

You need, once:

- **Rust** (stable, 1.90 or newer), from [rustup.rs](https://rustup.rs).
- **Windows**: Microsoft C++ Build Tools ("Desktop development with C++")
  and WebView2, which Windows 10 and 11 already have.
- **macOS**: Xcode's command line tools (`xcode-select --install`).
- **Linux**: Tauri's libraries, e.g. on Ubuntu
  `sudo apt install libwebkit2gtk-4.1-dev libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev libasound2-dev build-essential`.

Then:

```bash
npm run desktop          # the dev server in the app's window, with hot reload
npm run desktop:build    # installers, in target/release/bundle/
npm run test:engine      # the native engine's tests (cargo test -p dawn-engine)
```

Both `desktop` scripts run the Tauri CLI through `npx`. The first build
compiles a few hundred Rust crates and takes several minutes; later ones
only rebuild what changed. `Cargo.lock` is committed, so every machine
builds the same dependencies.

## How it's put together

- `Cargo.toml`: the Rust workspace (the engine, plugin hosting and the
  app).
- `src-tauri/`: the app.
  - `tauri.conf.json`: the window (opening the studio at `/app`), the site
    it serves (`out/`, built by `npm run build` before each app build), and
    the bundle (name, icons, macOS entitlements). Its version is
    `package.json`'s.
  - `src/lib.rs`: starts the app; lets the studio's own pages use the
    microphone and MIDI without the webview asking on every launch; and the
    commands the studio can call.
  - `src/audio/`: the native engine's side in the app - the audio devices
    (`devices.rs`, through [cpal](https://github.com/RustAudio/cpal)), the
    stream that plays the engine (`stream.rs`), and the commands the studio
    drives it with (`mod.rs`).
  - `src/plugins.rs`: the plugin scan in the background, its cache and the
    folders searched, and the commands the studio's Plugins tab calls.
    `src/main.rs` runs the scan's side when the app is started with
    `--scan-plugin` (below).
  - `capabilities/default.json`: what the window may use of Tauri's own API.
  - `Info.plist`, `Entitlements.plist`: macOS's microphone prompt text and
    permission, and the hardened runtime's leave to load plugins signed by
    others (library validation off, and the JIT some plugins use).
  - `icons/`: made from `public/icons/icon-512.png`. To remake them from a
    new image: `npx @tauri-apps/cli@2 icon path/to/icon.png`.
- `crates/dawn-engine/`: the native engine.
- `crates/dawn-plugins/`: VST3 and CLAP plugin hosting (so far, finding
  them), and `crates/dawn-test-plugin/`, a small plugin in both formats
  that its tests load.
- `src/engine/native/`: the native engine from the studio's side (below).
- `src/services/desktop.ts`: `isDesktopApp()`, for the studio to tell where
  it's running. The service worker stays off in the app (`AppUpdater.tsx`):
  its files are already on disk, and it updates with its installer.

The window turns off Tauri's own file drop handling (`dragDropEnabled`) so
that dropping audio files on the timeline works as in the browser.

The main window is built in `src-tauri/src/lib.rs` (`setup`), from its
entry in `tauri.conf.json` (which has `"create": false`), so it can take
the studio's own windows: "Pop out" in the mixer or the piano roll calls
`window.open`, and `on_new_window` answers a blank page with a Tauri
window the studio then draws into (`src/ui/Popout.tsx`), for a second
screen. Other pages asked for that way are left to the webview. The
studio opens them at `about:blank#dawn-<name>` (`dawn-mixer`,
`dawn-piano-roll`), and the window is labelled after it (`dawn-mixer-0`).
To close one, the studio calls `close_studio_window` with that name:
`window.close()` in it would destroy only the webview (wry), leaving an
empty window. When the main window goes, the app closes the others, or it
would keep running for them.

## What's different in the app today

The window is the system's webview, not Chrome, so a few browser features
depend on the platform:

- **Windows** uses WebView2, which is Chromium: the studio should behave as
  in Chrome or Edge.
- **macOS** uses WKWebView (Safari's engine) and **Linux** WebKitGTK. Neither
  has the File System Access API, so projects save as a single
  `.dawnproject` file rather than to folders, nor Web MIDI, so MIDI
  controllers don't work there yet. On macOS the system asks once for the
  microphone. Recording on Linux is untested.
- Links to other sites don't open in your browser yet; that needs Tauri's
  opener plugin.

These differences go away as the native side takes over each job: audio
and MIDI devices through the engine, files through native dialogs.

## The native engine

`crates/dawn-engine` is plain Rust with no dependencies:

- `mix/`: what plays the song - the transport (play with a count-in, stop,
  seek, the loop), audio clips, the strips (fader, Web Audio's stereo
  panner, mute), tracks feeding other tracks, post-fader sends, buses, the
  master fader and limiter, and the metronome after the limiter. Delay
  compensation (`mix/latency.rs`, planned as the browser's `latency.ts`)
  lines every path up at the master: effects that delay their audio (a
  limiter's lookahead, oversampling) hold the other tracks, sends and buses
  back to match, the armed MIDI track plays without waiting, and the clicks
  wait as long as the mix. It renders for whatever asks for samples: the
  app's audio stream, or (later) a file.
- `effects/`: the DSP kernels, each a port of a JavaScript one from
  `src/effects/` that computes the same thing step for step: the same `f64`
  state and `f32` buffers as the JavaScript's numbers and Float32Arrays, the
  arithmetic in the same order. So far the Compressor, the Glue Compressor,
  the Noise Gate, the Limiter, the Multiband Compressor, Multiband Dynamics,
  the Parametric EQ, the Pitch Shift, the Furnace amp and the Utility. The
  Filter, the EQ Three, the Chorus, the Delay, the Reverb, the Saturator
  and the IR Loader are built from the browser's nodes (BiquadFilter,
  Delay, WaveShaper, Convolver, and Tone.js's LFO), so they're ports of
  Chromium's (`biquad_node.rs`, `delay_node.rs`, `wave_shaper.rs`,
  `convolver.rs`, `tone_lfo.rs`)
  and the studio's wiring of them, down to how Chromium runs a feedback
  loop a block at a time. They
  run in the tracks', buses' and master's chains where the browser's do
  (`mix/fx.rs`): a track's on what it plays and what's routed into it, ahead
  of its fader; a bus's on its sends; the master's after its fader, ahead of
  the limiter. Each effect lives on from one version of the song to the next
  by its id, and a bypassed one is skipped, keeping its state.
- `instruments/`: the instruments, the same way: the Drum Rack's kernel
  (a port of `drumKernel.ts`), the synth's (a port of `synthKernel.ts`,
  playing the wavetables the studio builds), and the piano, a sampler that
  plays as Tone.js's Sampler does (the nearest sample, pitched by its
  playback rate, the velocity as its gain, Tone's release curve). A MIDI
  track's
  instrument plays its clips' notes on their sample and the keys played
  live; it lives on from one version of the song to the next
  (`mix/player.rs`), so an edit doesn't cut off what's ringing, and
  stopping, jumping or looping back releases the clips' notes.

The rules for what runs on the audio thread: no allocation, locks, I/O or
panics. Everything it needs is made beforehand (`Song::prepare`), and what
it replaces goes back to be freed elsewhere.

### How the studio drives it

The studio describes the song (`src/engine/native/describe.ts`): every
track's level, pan and clips, whether it's heard (mute and solo, worked out
by the same code as the browser's engine), where it goes, its sends, and a
MIDI track's notes (as the browser plays them: clamped or tiled to their
clips) and instrument (the Drum Rack's compiled kit, the synth's compiled
patch, or the piano); the buses, the master and the tempo map.
`nativeEngine.ts` sends that whenever the project changes, and each audio
file once, decoded at the device's rate: a clip's (a warped clip sends its
rendering), a sample pad's, the piano's samples, and a synth's wavetables
(its mip levels one after another, as one channel). Until a synth's tables
are in it waits to play, as in the browser, and while a new table is on its
way it keeps the one it had. The browser's engine keeps running, silently:
its transport tells the native engine everything it does
(`src/engine/follower.ts`), as do the keys played live (the on-screen keys,
the computer keyboard, a MIDI controller), the sustain pedal, pitch bend
and the mod wheel, and the playhead takes the native engine's position. So
the rest of the studio doesn't change while parts move over.

The studio sends each chain's effects the engine has (with their
parameters as the project keeps them, `NATIVE_EFFECTS` in `describe.ts`);
a chain plays without the others. What it doesn't play yet - those
effects - the Audio panel names for the project open.

Sidechains: the studio sends each keyed effect's source (a track's or
bus's id) and tap, for the keys the browser's engine connects (those that
make no loop, `resolveSidechains`). The engine checks them again the same
way (`crates/dawn-engine/src/mix/keys.rs`), mixes every source before the
effects it keys (a bus can key a track), copies each key at its tap
(before the source's effects, after them, or after its fader) and delays
it to line up with the effect's input, from its own latencies, as
`keyDelay` does.

Automation: the studio sends each track's lanes that have points (its
fader's in dB, its pan's, and those of its effects the engine plays), with
each point's bend. The engine reads them as the browser's engine does
(`crates/dawn-engine/src/mix/automation.rs`, a port of
`src/engine/automation.ts`): flat before the first point and after the
last, each segment bent by `curveShape`. The fader and pan follow their
lanes on the audio thread, in place of their own settings, gliding over
each block to where the lane is at its end. An effect's settings are
made from its parameters, and some make impulses or tables, so they're
made beforehand, off the audio thread: one every 50 ms where its lanes
move (the browser's control rate), and the engine switches to the one for
where the transport is. A reverb's decay, damping, early reflections,
width and mode, a chorus's spread and waveform and an IR Loader's
normalize step at each point instead of gliding (`fx::stepped`): they
shape an impulse or an LFO's tables, which take too long to make every
50 ms, and the browser's reverb, too, rebuilds its impulse only once its
decay stops moving. Delay compensation reads an effect's own setting, so
automating a Pitch Shift's window or a Saturator's oversampling doesn't
move it, in either engine.

### Recording

The engine opens the interface's input with its output: the Audio panel's
**Input** picks it, and **Automatic** takes the output device itself when
it records (an interface on ASIO or Core Audio is one device both ways),
else its driver's default input. It's opened at the output's rate; an
input that runs at another says so in the panel, and playing goes on
without it. Its callback puts what comes in on a ring, and the output's
callback takes as much as it renders (`src-tauri/src/audio/stream.rs`),
keeping only the newest waiting, so the input stays as close as it can.

- **Monitoring**: the tracks hearing the input (their monitoring mode,
  `src/studio/tracks/monitoring.ts`) get it as a source ahead of their
  effects, like their clips, on the audio thread
  (`Engine::render_with_input`): their input channel, or all of the
  input's mixed to one. They play live, skipping delay compensation.
- **The track's input**: with the engine on, a track records from its
  input (shown, greyed, in its Input list) and picks a channel of it, In 1,
  In 2..., or All. The browser device a track had is kept for when the
  engine is off.
- **Takes**: Record starts a capture of the armed track's input
  (`take.rs`) and then the transport, with its count-in. The audio thread
  copies the input into a ring, and a thread of its own writes it to a WAV
  file (32-bit float, mono) in the app's cache folder (`takes/`), keeping
  its header up to date, so a take survives the app going down. Stopped,
  the studio gets the take from where its downbeat came back in: the wait
  for the count-in, the mix's latency (its compensation and the
  limiter's lookahead), then the round trip and the recording offset. The
  file goes once it's read; the take is the project's, as one recorded in
  the browser is. Its live waveform comes with the engine's status.
- **The round trip**: the drivers say how late their output and input are
  (cpal's timestamps, or a buffer's length if they say less), plus the
  input's wait on its ring. **Measure latency** (Preferences → Recording)
  plays five clicks straight to the output and finds them on the input, as
  in the browser; it's kept apart from the browser's measurement, since
  the paths differ.

Recording another track's audio ("Audio from") still needs the browser's
engine, and an interface's inputs are recorded in mono.

### ASIO

cpal's ASIO backend builds with Steinberg's ASIO SDK, which is GPLv3 or
Steinberg's own licence. Dawn isn't GPL, so it needs Steinberg's licence
agreement, signed, before an installer with ASIO goes to anyone. Until then
it's off: the app builds with `--features asio` (on Windows, with LLVM
installed for the SDK's bindings; cpal fetches the SDK itself, or reads it
from `CPAL_ASIO_DIR`), and the installers are made without it. WASAPI works
in the meantime.

To try it locally, put `DAWN_ASIO=1` in `.env` (which git ignores):
`npm run desktop` and `npm run desktop:build` (`scripts/desktop.mjs`) then
add `--features asio`. On Windows the script looks for libclang in
`LIBCLANG_PATH` (which `.env` can set) or `C:\Program Files\LLVM\bin`
(`winget install LLVM.LLVM`), and says so if it isn't there. Builds made
this way are for testing only; the installers' workflow has no `.env`.

### Parity tests

A kernel's parity test proves the port renders what the JavaScript renders:

1. A `<name>Parity.ts` next to the JavaScript (`src/effects/<effect>/`,
   or `src/engine/` for the metronome and clips) defines cases (parameters,
   which inputs and sidechain are connected, a settings change midway, a
   session of transport commands) and renders them with the JavaScript the
   way the browser runs it (128-frame blocks, meters read every 512
   frames).
2. That's stored as a fixture in `crates/dawn-engine/tests/fixtures/`: a
   generated Rust file with the cases and the settings the JavaScript made
   of their parameters, and a binary file with the rendered samples and
   meters.
3. `npm test` checks the fixture is still what the JavaScript kernel
   renders, so a change to the kernel fails until the fixture is remade:
   `UPDATE_ENGINE_FIXTURES=1 npx vitest run --project unit <effect>Parity`.
4. `cargo test -p dawn-engine` renders the same cases with the Rust kernel
   and compares, sample by sample, to within -100 dB. (The Limiter, the
   metronome and clips match to the last bit; the Compressor too, but for
   its meters, by around 1e-14.)

Both sides build the test signal themselves, from the same steps
(`src/test/kernelParity.ts` and `crates/dawn-engine/tests/common/mod.rs`);
the fixture keeps its hash to catch the two drifting apart.

The effects built from Web Audio nodes (the Filter, the EQ Three, the
Chorus, the Delay, the Reverb, the Saturator, the IR Loader) have no
kernel of ours to run in Node, so their fixtures are rendered in Chromium
instead (`src/test/webAudioParity.ts`): an OfflineAudioContext plays the
test signal through the same nodes the studio builds, and a midway change
is made through their `set()` while the render is suspended. The tests are
`<name>Parity.webaudio.test.ts`, in Vitest's `web-audio` project; remake
a fixture with
`UPDATE_ENGINE_FIXTURES=1 npx vitest run --project web-audio <name>Parity`.
The ports follow Chromium's code (`biquad.cc`, `biquad_filter_handler.cc`,
`delay.cc`, `oscillator_handler.cc`, `periodic_wave_handler.cc`,
`wave_shaper_handler.cc`, `up_sampler.cc`, `down_sampler.cc`), and match
it to the last bit or within a float32 rounding, with these exceptions:

- Where an LFO sweeps something: Chromium makes the LFO's wave tables with
  its FFT and the port sums them, so they differ in the last bit. That's a
  few millionths on the Filter, and up to two ten-thousandths on the
  Chorus, where it now and then moves a delay's read position by one
  float32 step.
- The Saturator's oversampling. The Chromium the tests run (141) downsamples
  with an FFT convolution; the port runs the direct one Chromium has moved
  to. That's a float32 rounding on the shaped signal, but the DC blocker
  after it (a float32 10 Hz high pass, its poles right by DC) turns roundings
  into a slow drift, in Chromium too: a few ten-thousandths, up to two
  thousandths after a +12 dB Output. Without oversampling it's exact.
- The convolutions (the Reverb, the IR Loader). Chromium convolves in
  partitions through float32 FFTs; `convolver.rs` works out the same
  convolution, with no latency, its own way: the first 128 taps directly,
  then FFT partitions of 128 and of 1024, the long ones' work spread over
  a block's quanta. The sums differ in their last bit. That's all the
  Reverb shows (its cuts come before the convolver), but the IR Loader's
  low cut comes after it, a float32 high pass that turns last bits into
  drift as the Saturator's DC blocker does: a few hundred-thousandths at
  50 Hz, a few thousandths at Off (5 Hz).

The IR Loader's fixture loads test impulses made from the same arithmetic
on both sides (`parityImpulse`, and `impulse` in `ir_loader_parity.rs`).
It has no case that swaps an IR in, or takes a mono one out: Chromium
renders those differently from run to run (the cuts after a new
ConvolverNode, or after one whose output turns mono, sometimes start
afresh). The port carries the cuts on, which is one of the ways Chromium
renders it; its unit tests cover the swap.

The Tuner passes its input through (Mute fades it, as its Gain's
`rampTo` does) and keeps the last 4096 samples of the left side, as its
one-channel Analyser does, in a `TunerTap` the settings carry. The app
keeps the song, so `engine_tuner` reads the tap from there, off the audio
thread, and the Tuner's window finds the pitch in it while the native
engine plays (`useTuner`, `nativeEngine.tunerInput`).

A new impulse (the Reverb's shape knobs, another IR file, Normalize) is
made off the audio thread when the song is prepared, and kept from one
version to the next while it's the same (the app prepares the effects on
the song it keeps to follow, `Song::prepare_effects`). The audio thread
takes it from an `ImpulseSlot`, and the convolver it replaces rings out
its tail with no more input, as the studio's does; those done ringing go
back with the song, to be freed off the audio thread.

### Porting the next kernel

1. Copy the JavaScript kernel into `crates/dawn-engine/src/effects/<name>.rs`
   line by line, keeping its order of operations and its `f64`/`f32` split,
   and add the effect's key to `effects::PORTED`.
2. Write `<name>Parity.ts` and `<name>Parity.test.ts` next to the effect,
   like the Compressor's, and make the fixture with
   `UPDATE_ENGINE_FIXTURES=1`.
3. Add `crates/dawn-engine/tests/<name>_parity.rs` like
   `compressor_parity.rs`, and make it pass.
4. To play it in the chains: give `mix::fx` its settings (from the
   effect's parameters, as its `audio.ts` turns them into the kernel's) and
   its kernel, and add its key to `NATIVE_EFFECTS` in `describe.ts`.

## Plugins

The app finds the VST3 and CLAP plugins on the computer and lists them in
the browser's **Plugins** tab (instruments, effects and note effects, each
with its format). VST3 and CLAP effects and instruments play in the
native engine (below); Audio Units come next.

### Where it looks

The folders each format names for the system, plus any the user adds in
the Plugins tab (kept in `plugin-folders.json` in the app's data folder),
and their sub-folders:

| System  | VST3                                                                                   | CLAP                                                                        |
| ------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Windows | `%LOCALAPPDATA%\Programs\Common\VST3`, `C:\Program Files\Common Files\VST3`            | the same with `CLAP`                                                        |
| macOS   | `~/Library/Audio/Plug-Ins/VST3`, `/Library/Audio/Plug-Ins/VST3`                         | the same with `CLAP`                                                        |
| Linux   | `~/.vst3`, `/usr/lib/vst3`, `/usr/local/lib/vst3`                                      | `~/.clap`, `/usr/lib/clap`                                                  |

`CLAP_PATH`'s folders come first, as CLAP asks.

### How a plugin is read

A plugin's own code runs as it's loaded, and some crash or hang, so the
app never loads one into itself to read it: it runs itself again as
`<app> --scan-plugin <vst3|clap> <path>` for each file (a few at a time),
and that process loads the plugin, writes what it found on its output and
exits. A plugin that crashes takes only that process with it, and one that
takes more than a minute is stopped; the Plugins tab lists those files and
why, and can try them again. On Windows that process shows no crash
dialogs, and on macOS it stays out of the Dock.

- **VST3** (`crates/dawn-plugins/src/vst3.rs`): a bundle's
  `Contents/Resources/moduleinfo.json`, which plugins since VST 3.7.5 ship
  for hosts to read instead of loading them, when it has one. Otherwise its
  binary for this system (`Contents/x86_64-win/`, `Contents/MacOS/` through
  CFBundle, `Contents/x86_64-linux/`, or an older single-file `.vst3`) is
  loaded the way the SDK's own hosting code does it (`InitDll`,
  `bundleEntry`, `ModuleEntry` and their exits), and its factory lists the
  plugins (IPluginFactory2 for each one's categories, maker and version).
  Class ids are written as the SDK writes them, so a plugin has the same id
  on every system and either way it was read.
- **CLAP** (`crates/dawn-plugins/src/clap.rs`, through
  [clack](https://crates.io/crates/clack-host)): the entry's plugin factory
  lists each plugin and its features.

What a scan finds is cached in `plugins.json` in the app's data folder, by
file, with each binary's size and time: the next scan (each time the studio
opens, or the Rescan button) only reads what's new or changed.

### Running a plugin effect

With a track's (or a bus's, or the master's) FX rack open, clicking an
effect (VST3 or CLAP) in the Plugins tab adds it to that chain as a
**plugin effect**: the
project keeps which plugin it is (its format, id, name, maker and file) and
the state it saved last, and nothing of Dawn's own. Its rack card has
**Open its window**, which opens the plugin's own window. It plays in the
native engine; in the browser's engine it passes the sound through, and the
card says so.

- **The host** (`crates/dawn-plugins/src/host.rs`, through clack): an
  instance of the plugin is made on the app's main thread (CLAP asks for
  one thread for its main-thread calls, and Tauri runs the commands that
  aren't async there), given its saved state, and activated at the
  device's rate. Its audio processor goes to the audio thread, in the
  effect's slot (`PluginSlot` in `crates/dawn-engine/src/mix/fx.rs`), and
  processes the track's sound in place, its main ports taking the stereo
  pair (a mono one, the two mixed). When the engine drops it (the effect
  went, or the device opened anew) it goes home, and the instance takes it
  back, stopped and deactivated; an instance whose effect is gone is
  destroyed then. Its latency counts for delay compensation.
- **The app's side** (`src-tauri/src/audio/hosted.rs`): the instances by
  the studio's effect ids. Making the song asks each plugin effect for its
  processor; the one playing carries on while its slot is empty. The status
  the studio reads says whose state changed (the plugin marks it so, or its
  window closed), and the studio fetches it and keeps it in the project,
  without an undo step. A plugin that can't run (its file gone, or it won't
  load) says why on its card.
- **Its window**: a window of the app's with no web page in it (Tauri's
  `unstable` windows), the plugin's GUI put in it as CLAP's GUI extension
  says (embedded, at the size it asks for, and resized when it asks).
  Closing the window closes the plugin's GUI first.

A **VST3** effect runs the same way (`crates/dawn-plugins/src/vst3_host.rs`,
on the `vst3` bindings): its component is made from the module's factory
and given the host application, its audio processor goes to the audio
thread, and its edit controller is the component itself or an object of its
own (made from the component's controller class, the two connected and
kept in step: the controller is given the component's state). What a VST3
host gives a plugin is made here: the host application (it also makes the
messages a component and its controller send each other), a component
handler (a knob turned in the plugin's window is an edit, carried to the
processor with the next block, and makes its state to be saved), a plug
frame (its window asks to be resized) and memory streams for its state,
which is the component's and the controller's, each after its length. Its
window is the controller's editor view, put in the app's window by its
handle (an HWND, an NSView). NAM's own plugin is a VST3 one: on the
desktop, it's how NAM models play.

### Playing a plugin instrument

With a MIDI track's FX rack open, clicking an instrument (VST3 or CLAP) in
the Plugins tab puts it on that track in place of the one it had (one undo
step): the track keeps which plugin it is and the state it saved
(`pluginInstrument`), and the picker in the rack's instrument slot offers
**Plugin** from then on, to go back to it after trying another. Its card
in the slot has **Open its window**, as an effect's has. It plays in the
native engine, the track's clips and the keys played live (the computer
keyboard, the on-screen piano, a MIDI keyboard); in the browser's engine
it's silent.

- **The engine** (`crates/dawn-engine/src/mix/player.rs`): a plugin is a
  track's instrument like the Drum Rack or the synth (`InstrumentSpec::
  Plugin`), its processor taken from a slot as an effect's is. The notes
  it's given each block are those the others get (a clip's notes on their
  frame, stopping, jumping and looping back letting go of them, a key held
  live until it's let go), each at its frame in the block
  (`PluginProcessor::play`); the sustain pedal is worked out before it
  hears them (a key let go with the pedal down is let go when it lifts),
  and it's told the pitch bend and mod wheel. Its latency counts for delay
  compensation, as its track's chain's.
- **CLAP**: notes go as CLAP's own note events when the plugin's first note
  port takes them, as MIDI when it only takes MIDI; the bend and mod wheel
  as MIDI. The host offers both dialects (its note-ports extension).
- **VST3**: notes go as note-on and note-off events on the plugin's first
  event bus (activated); the bend and mod wheel go to the parameters its
  controller maps them to (IMidiMapping), as VST3 has no MIDI controller
  events of its own. One with no audio input (most instruments) is fine.
- **The app's side**: the instance is kept by the track's id (tracks' ids
  and effects' never meet), and its state is kept on the track as an
  effect's is on the effect.

Not yet: parameters automated from Dawn's lanes, a plugin's sidechain
input, note effects (arpeggiators), a plugin instrument's several outputs
(only its first, as a stereo pair), and plugin presets in Dawn's preset
menu (the plugin's own work in its window).

### Testing it

`cargo test -p dawn-plugins` builds `crates/dawn-test-plugin` (a gain effect
and a tone, an instrument that plays a key's velocity as a constant level
while it's down, as both a CLAP plugin and a VST3 module, in one library), lays it out as this system keeps plugins, and scans it for real,
along with a bundle that's only a `moduleinfo.json` and two CLAP files that
crash and hang on purpose. CI runs it on Windows, macOS and Linux
(`desktop.yml`).

## Next steps

1. **Plugins**: finding them, and VST3 and CLAP effects and instruments,
   are done (above). Next, Audio Units on macOS.
2. **Export through the engine**, native file dialogs, signed installers.

## Checks

Every push tests the engine and plugin hosting (the `engine` job in
`.github/workflows/ci.yml`). `.github/workflows/desktop.yml` builds the app
and tests the plugin scan on Windows, macOS and Linux whenever
`src-tauri/`, `crates/` or the workspace's `Cargo.toml` changes, or when
run by hand from the Actions tab.
`.github/workflows/installers.yml` makes the installers on every push to
`main` (above).
