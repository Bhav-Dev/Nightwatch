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
| Audio capture | **Interface plus a simulator only**, `src/native/audioCapture.ts`. The native module is the next task |
| CI: typecheck, lint, tests, JS bundle per platform | `.github/workflows/ci.yml` |

## Running it

```bash
npm install
npm start          # then press i or a; Expo Go is enough while capture is simulated
npm test
npm run typecheck
npm run lint
```

In development builds, Start recording uses `SimulatedCapture`, which plays 30 seconds of synthetic night (background noise plus a snoring stretch every 10 minutes) for every real second. Hold Stop for one second to analyse it and land on This Morning. Release builds have no capture until the native module exists, and the button says so.

## Layout

```
catalogue/catalogue.json   launch catalogue, shared with the server later
src/app/                   routes (Expo Router); each file is a screen
src/domain/                pure logic, no React Native imports
  scoring/                 frames → events → bins → score
  audio/                   FFT, A-weighted level, centroid, envelope per 1-second frame
  detection/               v0 heuristic
src/data/                  SQLite schema, repositories, catalogue client
src/native/                capture interface (native module goes here)
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

1. Native capture module (Expo Modules API): iOS background audio session, Android foreground service with the microphone type, interruption reporting, clip ring buffer. Then the Phase 0 gate: an 8-hour screen-off recording under 8% battery on an iPhone 11 and a 2020 mid-range Android.
2. Record the 30-night test dataset and a small labelling tool driven by the v0 heuristic.
3. Onboarding (microphone, notifications, profile bands, Health, contribution opt-in).
4. Manrope font and icons to match the mockups.
5. EAS project and signing credentials, so CI can produce signed native builds.

Catalogue articles are drafts: they need the full 150 to 250 word versions and clinician review before release.
