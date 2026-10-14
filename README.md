# Nightwatch

Record your snoring, see it against your watch's data, and find out which remedies helped people like you. The full product brief and development spec live outside the repo; this README covers what is built and how to work on it.

## Status: Phase 0 (foundations)

| Piece | State |
| --- | --- |
| Expo app (React Native, TypeScript, Expo Router) with Tonight, This Morning, Remedies, Trends tabs | Scaffolded. Tonight and a basic This Morning work; Remedies and Trends are placeholders |
| Local SQLite schema (every table in the spec) with versioned migrations | Done, `src/data/schema.ts` |
| Catalogue of 42 remedies and factors, with draft one-paragraph articles | Done, `catalogue/catalogue.json`; seeded on first launch, refreshed from `GET /v1/catalogue?since=` when an API base URL is set |
| Scoring: events, intensity labels, 5-minute bins, 0 to 100 score, partial-night rule | Done and unit tested, `src/domain/scoring` |
| Detection v0: energy, spectral centroid and breathing-rhythm heuristic | Done and tested on synthetic audio, `src/domain/detection/heuristic.ts`; a labelling aid, not for release |
| Audio capture | expo-audio's PCM stream (16 kHz mono) with a local Android foreground-service module; features saved to SQLite every 30 s; interruptions detected and shown on This Morning. **Not yet run on a device** |
| CI: typecheck, lint, tests, JS bundle per platform | `.github/workflows/ci.yml` |

## Running it

The app contains a local native module, so it needs a development build rather than Expo Go.

```bash
npm install
npm run ios        # or: npm run android  (local Xcode / Android Studio)
# or build in the cloud: npx eas-cli@latest build --profile development
npm start          # dev server for an installed development build
npm test
npm run typecheck
npm run lint
```

Set `EXPO_PUBLIC_SIMULATE_CAPTURE=1` (or `npm run start:simulated`, or the `simulated` EAS profile) to swap the microphone for `SimulatedCapture`, which plays 30 seconds of synthetic night (background noise plus a snoring stretch every 10 minutes) for every real second. Hold Stop for one second to analyse it and land on This Morning.

## How overnight capture works

```
expo-audio AudioStream (16 kHz mono int16, ~100 ms buffers)
  → ExpoAudioCapture        session clock = wall clock at stream start + stream timestamp
  → FrameAssembler          whole 1-second frames; clock jumps and all-zero seconds become gaps
  → RecordingSession        per-second features (level, centroid, 10 Hz envelope); audio dropped
  → SQLite session_frame    written every 30 s, so a killed app loses at most 30 s
  → at Stop: heuristic → analyseNight → night + events + bins + tonight's log
```

- **iOS:** the expo-audio config plugin adds the `audio` background mode, which keeps the stream running with the screen locked.
- **Android:** a backgrounded app only gets real microphone audio while it runs a foreground service of type `microphone` started while visible. `modules/nightwatch-recording-service` is that service (ongoing notification, partial wake lock, no audio of its own). Without it Android delivers silence, which the assembler would report as `microphone_taken`.
- **Interruptions.** Streams are not told when they are interrupted. A jump in the session clock is a `stalled` gap; two or more all-zero seconds are `microphone_taken` (Android silences a call-preempted app); a watchdog restarts a stream that has delivered nothing for 10 s. A recording the app never stopped (killed overnight) is turned into a partial night at next launch, marked `app_closed`. This Morning then shows "Recording stopped at 03:12" with the probable cause and how to prevent it.

## Layout

```
catalogue/catalogue.json   launch catalogue, shared with the server later
src/app/                   routes (Expo Router); each file is a screen
src/domain/                pure logic, no React Native imports
  scoring/                 frames → events → bins → score
  audio/                   FFT, A-weighted level, centroid, envelope per 1-second frame
  detection/               v0 heuristic
src/data/                  SQLite schema, repositories, catalogue client
src/native/                capture interface, expo-audio capture, simulator
src/recording/             RecordingSession: capture → features → SQLite → scored night; launch recovery
modules/nightwatch-recording-service/   Android foreground service (Kotlin), no-op on iOS
src/ui/                    theme and shared components
__tests__/                 Jest; data-layer tests run on node:sqlite through the same Db interface
```

## Decisions made while scaffolding

- **Pipeline.** Capture hands JS 30-second PCM windows; JS reduces each second to a few features (level, centroid, a 10 Hz loudness envelope) and drops the audio. The noise floor (5th percentile of frame levels) needs the whole night, so detection and scoring run once at Stop over those features. Clips around events will be cut by the native module, which keeps a short ring buffer.
- **Event rule order.** Bridge gaps of up to 5 s, drop runs under 10 s, then merge events less than 20 s apart. The spec does not say whether merging happens before the 10-second filter; doing it after stops short blips from joining into an event.
- **Partial nights.** Following the scoring section literally: a night is kept out of averages only when it is partial *and* under 3 hours in bed. The aggregation job excludes all partial nights separately.
- **Column names.** `bin.index` is `bin.idx` and `snapshot.from/to` are `from_date/to_date`, to avoid SQL keywords. `night` also stores `time_in_bed_s`, `floor_db`, `score_version` and `updated_at`, which the scoring and sync sections rely on.
- **Tonight pre-fill.** Tonight's ticks live in `pending_log` and are copied from last night once per local date, so clearing a chip sticks. At Stop they are written to the night's `remedy_log` and `factor_log`.
- **Alcohol band.** Tapping the chip cycles 1-2, 3-4, 5+ units, then off. A proper picker comes with the Phase 1 screen work.

## Next

1. Run the Phase 0 gate on real devices: an 8-hour screen-off recording under 8% battery on an iPhone 11 and a 2020 mid-range Android, plus a phone call mid-recording producing the interrupted state. The Kotlin module has not been compiled yet (no Android SDK in the environment it was written in), so the first Android build may need small fixes.
2. Clips: keep a short rolling PCM buffer in JS and write the five loudest moments as audio files.
3. Record the 30-night test dataset and a small labelling tool driven by the v0 heuristic.
4. Onboarding (microphone, notifications, profile bands, Health, contribution opt-in).
5. Manrope font and icons to match the mockups.
6. EAS project and signing credentials, so CI can produce signed native builds.

Catalogue articles are drafts: they need the full 150 to 250 word versions and clinician review before release.
