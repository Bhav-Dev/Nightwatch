# Nightwatch

Record your snoring, see it against your watch's data, and find out which remedies helped people like you. The product plan and development spec are in [`docs/project-plan.md`](docs/project-plan.md), the screen mockups in [`docs/screens.html`](docs/screens.html) (open in a browser), and progress against every item in the plan in [`docs/status.md`](docs/status.md). This README covers what is built, how to run it, and the decisions taken where the spec was open.

## Status

Phases 0 to 3 are built. Nothing has run on a phone yet: everything below is checked by unit and integration tests, typechecks, lint, JS bundle builds for both platforms and `expo prebuild`, but not on a device.

| Phase | What is in the repo |
| --- | --- |
| 0 Foundations | Expo app, local SQLite schema, 42-entry catalogue, scoring, detection v0, overnight capture (expo-audio stream plus an Android foreground service), interruption handling, labelling and evaluation tools (`tools/`) |
| 1 Parity | Clips of the loudest moments (WAV, with groundwork for Opus), full This Morning screen (score, timeline, clips, editable log, typical-night prompt, interrupted banner), Trends (7/30/90 nights, moving average, snapshots), onboarding, Settings (export, delete, sensitivity, auto-stop, reminders), automatic stop in the morning |
| 2 Personal insight | Apple Health and Health Connect import, aligned overlay and nightly summary, template morning summary, 14-night remedy tests with a verdict and confidence, doctor's report PDF on the phone, RevenueCat paywall and locks |
| 3 Community | Required sign-in (Apple, Google, email link), two-way sync, contribution opt-in, community dashboard (Everyone, People like you, early and hidden states, combinations), remedy detail with your result against the crowd, Amazon links with disclosures, the backend (`server/`, runs on a VPS or Supabase), nightly aggregation job, methods page (`site/methods.html`) |

Partner mode (Household) is not built: the brief holds it for the first update after launch.

## Layout

```
docs/                      project plan, screen mockups, status against the plan
shared/                    code used by both app and server
  api.ts                   the /v1 API contract
  remedyEffect.ts          the remedy-effect algorithm (eligibility, within-person deltas, community figures)
  profile.ts, amazon.ts, stats.ts
catalogue/catalogue.json   launch catalogue (app seed and server seed)
src/                       the app
  app/                     routes (Expo Router)
  domain/                  pure logic: scoring, detection, audio features, health, summary, experiments
  data/                    SQLite schema and repositories (behind the Db interface)
  recording/               RecordingSession: capture → features → SQLite → scored night; launch recovery
  clips/                   clip collection, codec registry, transcoding
  native/                  capture: expo-audio stream, simulator
  health/                  Apple Health and Health Connect readers
  sync/, api/, community/  server client, sync engine, cached community snapshot
  billing/, auth/, state/  RevenueCat, session storage, app-wide state
  report/                  doctor's report
  screens/, ui/            shared screen components, UI kit and charts
modules/nightwatch-recording-service/   Android foreground service (Kotlin)
server/                    API (Hono) and nightly job; see server/README.md
supabase/                  Supabase function wrappers and migrations (same server code)
tools/                     labelling and detector evaluation; see tools/README.md
site/methods.html          public methods page
__tests__/                 app tests (Jest); data-layer tests run on node:sqlite
```

## Running it

The app has native modules, so it needs a development build rather than Expo Go.

```bash
npm install
npm run ios                # or: npm run android (local Xcode / Android Studio)
                           # or in the cloud: npx eas-cli@latest build --profile development
npm start                  # dev server for an installed development build
npm run start:simulated    # same, with the simulated microphone (30 s of night per real second)
npm test && npm run typecheck && npm run lint

cd server && npm install && npm test        # API and aggregation (PGlite, no database needed)
```

In development builds, with no server configured, sign-in offers a development account, and Settings has a switch to unlock paid features.

### App configuration (EXPO_PUBLIC_* at build time)

| Variable | What |
| --- | --- |
| `EXPO_PUBLIC_API_URL` | Server base URL without `/v1`. VPS: `https://api.example.com`. Supabase: `https://<ref>.supabase.co/functions/v1/nightwatch-api` |
| `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`, `_ANDROID_CLIENT_ID`, `_WEB_CLIENT_ID` | Google sign-in (the button is hidden when unset) |
| `EXPO_PUBLIC_REVENUECAT_IOS_KEY`, `_ANDROID_KEY` | RevenueCat public SDK keys. Entitlement id `insight`; offering with annual and monthly packages |
| `EXPO_PUBLIC_SITE_URL` | Website for methods, privacy, terms, affiliate disclosure (default `https://nightwatch.app`) |
| `EXPO_PUBLIC_SUPPORT_EMAIL` | Support address |
| `EXPO_PUBLIC_SIMULATE_CAPTURE` | `1` swaps the microphone for the simulator |

Server configuration (secrets, Amazon tracking ids, Apple and Google audiences, RevenueCat webhook secret) is in `server/README.md`.

## Backend: Supabase, in a shared project

The backend runs on Supabase, inside an existing project used by other apps. Nightwatch is kept to itself there:

- **Database:** every table is in a `nightwatch` schema owned by a `nightwatch_app` role, which cannot touch `public` or other apps' tables. `server/sql/setup.sql` creates both, once. The server refuses to start on a connection that would resolve tables outside that schema.
- **Migrations:** applied by the server's own runner (`npm run migrate` as `nightwatch_app`), not `supabase db push`, so the project's migration history stays the other app's.
- **Functions:** `nightwatch-api` and `nightwatch-aggregate` (the nightly job, run by pg_cron).
- **Secrets:** all `NIGHTWATCH_`-prefixed, since function secrets are project-wide. Supabase's own owner connection is never used.
- **Not used:** Supabase Auth, the REST API and storage. Nightwatch has its own sign-in and session tokens.

The app's `EXPO_PUBLIC_API_URL` is `https://<ref>.supabase.co/functions/v1/nightwatch-api`. Step-by-step setup is in `server/README.md`, "Deploy to Supabase". The same code still runs on a VPS, and moving is a dump and restore of the `nightwatch` schema.

**Deployed** to the shared project on 15 October 2026: schema and role, migrations and catalogue, secrets, both functions (deployed with `--use-api`, so no Docker), `pg_cron` and `pg_net`, and the 04:00 UTC job. The API answers `/v1/health`, and the nightly job has run once through the scheduled command.

## How overnight capture works

```
expo-audio AudioStream (16 kHz mono int16, ~100 ms buffers)
  → ExpoAudioCapture        session clock = wall clock at stream start + stream timestamp
  → FrameAssembler          whole 1-second frames; clock jumps and all-zero seconds become gaps
  → RecordingSession        per-second features (level, centroid, 10 Hz envelope) and an optional model score;
                            loud seconds feed the clip collector; audio is then dropped
  → SQLite session_frame    written every 30 s, so a killed app loses at most 30 s
  → at Stop or auto-stop    detector → analyseNight → night, events, bins, clips, tonight's log
```

- **iOS:** the expo-audio plugin adds the `audio` background mode.
- **Android:** `modules/nightwatch-recording-service` runs a microphone foreground service (notification, partial wake lock). Without it Android hands a backgrounded app silence.
- **Interruptions:** a jump in the session clock is a `stalled` gap; two or more all-zero seconds are `microphone_taken`; a watchdog restarts a silent stream. A recording the app never stopped becomes a partial night at next launch (`app_closed`). This Morning shows "Recording stopped at 03:12" with the cause and how to prevent it.
- **Auto-stop:** at 11:00 by default (Settings: 9 to 12), or after 12 hours, followed by a "your night is ready" notification.

## Clips, WAV now, Opus later

Clips are 15-second 16 kHz WAV (about 480 KB each; five a night is well under the 5 MB budget). Every clip row stores its codec, and all encoding goes through `src/clips/codec.ts`. To move to Opus: register an Opus encoder (a native module or a WASM libopus build), call `setPreferredCodec('opus')`, and run `transcodeClips` once; it converts old WAV clips and is safe to re-run. A test covers this path with a stand-in encoder. "Keep full-night audio" is shown but disabled until compressed audio exists.

## Detection

The heuristic (v0) labels nights at Stop. The trained model will plug in through `OnlineSnoreScorer` (`src/domain/detection/classifier.ts`): it scores each second during capture, its output is stored per second, and a night fully covered by the model uses it instead of the heuristic. Each night records which detector produced it. `tools/` has the labelling page and the evaluator for the Phase 1 gate (event agreement of at least 85% and frame F1 of at least 0.80).

## Decisions taken where the spec was open

- **Account required, always** (product decision), so the brief's "works with no account" no longer applies. Recording and the morning screen still work offline after sign-in.
- **Amazon only, global.** Links are built per marketplace from a search phrase or a marketplace ASIN, with tracking ids served by the server. Links appear only on remedies with full community results ("ok"), never untagged, never with prices; both disclosures are shown.
- **Co-introduced remedies.** The spec's 14-day rule would stop anything logged from a user's first night (an everyday pillow) from ever letting a later remedy be measured. A remedy logged on at least 80% of nights on both sides now counts as background and excludes nothing (`BACKGROUND_SHARE` in `shared/remedyEffect.ts`). The server's independent Python reference implements the same rule.
- **Experiment confidence** uses a seeded permutation test on the difference in means. With 7 nights a side, a test on medians reads "low confidence" even for a perfectly clean result. The verdict text still reports medians.
- **"Was this your typical night?"** is asked for each night (dismissable by answering), not only on the first morning, because the aggregation excludes atypical nights.
- **Events:** bridge gaps of up to 5 s, drop runs under 10 s, then merge events less than 20 s apart.
- **Short nights:** any night under 3 hours in bed is scored and shown but left out of averages and trends, whether or not it was interrupted (short test recordings were counting). Remedy tests and the community aggregation already skip nights under 3 hours, and the aggregation also leaves out every partial night.
- **Sync versions:** a night's `updated_at` always increases, even within one second, and sync records the version it sent, so an edit made during a sync is never lost.
- **Free-text "Other" remedies** are logged as `other:<text>` and sent to the review queue; they are never ranked.
- **Paid vs free** follows the brief's table: free has 7 nights of history, the first sentence of the summary and the top-level ranking; paid unlocks 30/90-night trends, snapshots, the full summary and watch overlay, tests, people-like-you, profile breakdowns, your result against the crowd, and the report.
- **Column names:** `bin.idx`, `snapshot.from_date/to_date` (app); `app_user`, `time_window` (server), to avoid SQL keywords.

## Not verified, or still to do

- **Devices:** nothing has run on a phone. Also untested: the Kotlin module (no Android SDK here), the Health and RevenueCat libraries, and Sign in with Apple and Google.
- **Phase gates that need people:** the 8-hour battery test, the labelled test set, 5 then 20 testers, a clinician review of the report wording, and the 100-person beta.
- **Content:** catalogue articles are short drafts that need the 150 to 250 word versions and clinician review. The privacy policy, terms and affiliate disclosure pages are Phase 4.
- **Smaller gaps:** the Recording view has no battery estimate. Clip sharing does not yet make a card image. Analytics events are defined and wired but go to no vendor (`setAnalyticsSink`).
- **Retention of held-out audio (needs a decision):** the spec deletes recordings after labelling but also keeps the held-out set fixed so later models are compared on it. A future model cannot run on deleted audio. Either the consent form covers keeping the held-out nights' audio (encrypted, restricted), or each model gets a new held-out set. See `tools/README.md`.
