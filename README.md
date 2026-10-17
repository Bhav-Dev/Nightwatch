# SnoreHive

Formerly Nightwatch; renamed on 17 October 2026 for a community of snorers working on it together. Internal names (the app ID `com.threeft2.nightwatch`, the Expo slug and link scheme, the `nightwatch` database schema and the `NIGHTWATCH_*` secrets) are unchanged, so installed apps update in place; the name people see comes from `app.json` and `src/brand.ts`.

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
docs/                      project plan, screen mockups, status against the plan, design notes
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
scripts/make-icons.mjs     draws the app icon and renders every icon file (npm run icons)
assets/icon-src/           the icon as SVG, and its layers for Apple's Icon Composer
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
| `EXPO_PUBLIC_WEATHER_URL` | Where `/v1/weather` lives, if not the API server (set in the preview profile, whose builds sign in with the development account) |

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
                            loud seconds feed the clip collector; seconds with sound feed the sound recorder
  → SoundRecorder           stretches of sound (lead-in, quiet tail, 5-minute cap) → native AAC .m4a segments
  → SQLite session_frame    written every 30 s, so a killed app loses at most 30 s
  → at Stop or auto-stop    detector → analyseNight → night, events, bins, clips, sound segments, tonight's log
```

- **iOS:** the expo-audio plugin adds the `audio` background mode.
- **Android:** `modules/nightwatch-recording-service` runs a microphone foreground service (notification, partial wake lock). Without it Android hands a backgrounded app silence.
- **Interruptions:** a jump in the session clock is a `stalled` gap; two or more all-zero seconds are `microphone_taken`; a watchdog restarts a silent stream. A recording the app never stopped becomes a partial night at next launch (`app_closed`). This Morning shows "Recording stopped at 03:12" with the cause and how to prevent it.
- **Auto-stop:** at 11:00 by default (Settings: 9 to 12), or after 12 hours, followed by a "your night is ready" notification.

## Clips, WAV now, Opus later

Clips are 15-second 16 kHz WAV (about 480 KB each). A night keeps up to five clips of snoring plus the three loudest moments that were not counted as snoring ("Other sounds", so the user can check what the detector left out): at most eight clips, about 3.8 MB, within the plan's ten-clip, 5 MB budget. Every clip row stores its codec, and all encoding goes through `src/clips/codec.ts`. To move to Opus: register an Opus encoder (a native module or a WASM libopus build), call `setPreferredCodec('opus')`, and run `transcodeClips` once; it converts old WAV clips and is safe to re-run. A test covers this path with a stand-in encoder. Clips could now use the native AAC encoder below; they are still WAV.

## Labelling study (internal builds)

Development and preview builds have a "Labelling study" card in Settings, so volunteers can record nights for the labelled test set with the app itself:

- **"Keep the whole night's sound (for labelling)"** makes the recorder keep every second of the night, not only the parts with sound, in the same 5-minute AAC segments. That is about 11 MB an hour, and it needs "Record sounds during the night" on.
- **"Export nights for labelling"** writes the last 1, 3 or 7 nights with sound into one uncompressed tar archive (`snorehive-labelling-<date>.tar`), says how big it is, and opens the share sheet. Each night is a folder holding its .m4a segments and a `night.json`: local start time, duration, segment times, the detector's events, the user's answers and clips.
- **On the laptop,** `tools/labelling/fromApp.ts` turns the archive into `<volunteer>-n<k>.wav` and `.proposals.json` for `label.html` (it needs ffmpeg).

The volunteer guide is `docs/labelling-volunteers.md`. Decisions:

- Answered stretches go into the proposals as undecided regions with an `answer` field, because the format has no decided state.
- v0 in `propose.ts` and `evaluate.ts` ignores exactly-silent seconds, so filled-in gaps don't pull the noise floor down. The app's own detector is unchanged.
- The tar writer and reader live in `src/data/tar.ts` and are shared by the app and the tools.

## Sound recording (listen back from the timeline)

The parts of each night with sound in them are kept, compressed, so the morning timeline can be played from any point; silence is never written (`src/recording/soundRecorder.ts`). A second at least 6 dB above the room's running quiet level starts or extends a segment; each segment begins 3 seconds before the first loud second, runs on through pauses of up to 8 seconds (the gaps between snores), and is capped at 5 minutes so a phone that dies loses at most the segment being written. Segments are AAC-LC at 24 kbps, 16 kHz mono (`.m4a`, about 11 MB per hour of sound), encoded by the platform encoder in `modules/nightwatch-recording-service` (`AacSegmentWriter.kt`: MediaCodec and MediaMuxer, on one background thread). Rows are in `sound_segment`; files in the document directory's `sounds/`. They stay on the phone, are never synced, and are deleted after 30 nights (`soundRetention.ts`, at launch, along with any half-written file). Settings has an on/off switch (on by default), the storage used and "Delete sound recordings". On the morning screen a thin line under the timeline marks recorded stretches; a tap plays from that moment, a playhead follows, and playback carries on into the next stretch. Android only so far: iOS needs the same encoder in Swift, and the switch is shown as unavailable there. Builds made before this feature simply keep no sound.

## Checking the night: Snoring answers, moments and the recap

Every clip, and every moment picked on the timeline, has a Snoring tick: on when the night counted it as snoring. Unticking says it was not snoring; ticking says it was. Each answer is a row in `sound_label` (a time range and the answer), and the night is rebuilt from the detector's own events with the answers applied in order (`src/domain/scoring/corrections.ts`, `src/data/labelRepo.ts`): "not snoring" cuts that stretch out of the snoring (an event can be split; pieces under 10 s are dropped), "snoring" adds it and merges with snoring it touches. Score, time snoring, event count and the timeline's bins are worked out again with the usual formula, and the night is marked for sync, so trends, tests and community figures use the corrected night. The detector's events are copied to `event_detected` the first time a night is answered, and its score to `night.detector_score` (shown as "Was 41 before your answers"); undoing every answer restores both. Answers are kept on the phone as labelled examples for training and checking the detector, and are included in the export. Per-second levels are not kept after Stop, so the loudness of a stretch the user adds comes from the clip's peak, or the 5-minute bins.

The timeline is a scrubber: drag along it or the slider under it (the time shows while dragging) and let go to play from there. The night is a list of moments (`src/domain/moments.ts`): each stretch of snoring, each loud sound not counted as snoring, and other recorded sound. Under the timeline, the picked moment has previous and next, play, and the Snoring tick; moments are marked on the slider.

Notes, the phone test list and follow-ups are in [`docs/morning-review-plan.md`](docs/morning-review-plan.md).

Nothing is asked of the user straight after waking. At Stop, a night recap notification is scheduled for later in the day (`src/domain/recap.ts`: mid-morning, lunchtime by default, or evening, at least 90 minutes after stopping and never after 9pm; a newer night replaces it; it is cancelled once the user has answered for that night). Tapping it opens This Morning. The app store review prompt (`src/domain/reviewPrompt.ts`, via expo-store-review) is only asked at such a leisurely moment: after the third night, at least 2 hours after stopping or from the recap, once the user has played or answered twice on that visit, not when most answers were corrections, not after a short night, at most every 120 days and 3 times a year. It is tried after a clip plays to its end or an answer is saved.

## Sleep sounds

Tonight offers white, pink or brown noise to fall asleep to, with a 15 to 60 minute timer (`src/domain/sleepSounds.ts`). The noise is generated live by `NoisePlayer.kt` (an `AudioTrack` on the media stream, inside the process the recording service keeps alive), so there are no audio files and no loop seam; it fades in over 3 seconds, fades out over the last minute and stops by itself. Only steady sounds are offered: the phone's own microphone hears whatever plays, and rhythmic sounds (waves, music) rise and fall at breathing pace like snoring. The recording session notes which sound played and until when (`sleep_sound`, `sleep_sound_until_s`, copied to the night); during that stretch the detector and the scoring measure each second against the sound's own level rather than the quiet room, and a model's score must clear a higher bar (`MASKED_THRESHOLD_BUMP`). The morning timeline shades the stretch. Echo cancellation was considered and left out: call-style processing suppresses steady low sounds like quiet snoring and rides the gain, which would break the loudness measures. Android only so far.

## What else happened in the night

Beyond snoring, This Morning shows estimates found without a model (`src/domain/activity.ts`; design in `docs/night-events-design.md`):

- **Movement.** Turning over is a short rustle: at least 6 dB over the room's floor, broadband (spectral centroid over 1.5 kHz, above snoring), uneven within the second, not counted as snoring, and over within 15 seconds. Rustles up to 2 seconds apart are one movement. The first and last 2 minutes of the night are skipped, and during sleep sounds a rustle must stand out from the sound. Detected at Stop from the per-second features already kept, and stored in `night_activity`.
- **Restless stretches:** three or more movements within 10 minutes.
- **Possibly awake:** the phone was picked up (the app came back to the front while recording; the first 2 minutes and the last 3 are ignored, as settling down and stopping), or a watch said awake for 2 minutes or more. Never stated as certain.
- **"Turned over, and the snoring stopped":** a movement after at least 2 minutes of snoring in the 10 minutes before it, with the snoring not carrying on a minute past it and then at least 15 minutes of quiet. It becomes a summary sentence ("Snoring stopped after we heard you turn over at 3:10, and it stayed quiet for 40 minutes"), and is the most direct evidence for side sleeping.

They appear as lanes under the timeline, on its time scale (`src/ui/NightLanes.tsx`): Movement (restless stretches shaded), Possibly awake, and Sleep stages from your watch (deep, light, REM, awake), which follows the existing watch overlay and needs Insight. Tapping a lane plays the night from that moment. Sound alone cannot tell deep from light sleep, so without a watch there is no stage lane. None of this changes the score or syncs.

## Wake-up alarm

The wake-up alarm is the phone's own. Nightwatch has no alarm of its own and stores no alarm time; it reads the phone's next alarm, whichever app set it (`AlarmManager.getNextAlarmClock`, which needs no permission; `nextAlarmTime` in the native module).

- **On Tonight,** under sleep sounds, a row shows tomorrow morning's alarm. Tapping it opens the Clock app's alarms to change it (`ACTION_SHOW_ALARMS`). The row counts an alarm 1 to 18 hours ahead; a bedtime reminder, or a weekday alarm seen on a Saturday, does not count. With no alarm, the row offers "Set". That opens the system time dialog (`@expo/ui`) and adds a one-off alarm to the Clock app straight away, without opening it (`ACTION_SET_ALARM` with skip-UI, the `SET_ALARM` permission). So people who already have alarms get no duplicates, and the Clock app rings the alarm whatever happens to Nightwatch overnight, including in Do Not Disturb and on battery saver.
- **While recording,** the recording stops 30 seconds before the phone's next alarm when it rings at least an hour in and within the 12-hour limit. Otherwise it stops at the auto-stop hour. Stopping early keeps the alarm out of the recording, and the night is ready as it rings. The alarm is read again every minute, so moving it in the night is followed. Stopping for an alarm sends no "Your night is ready" notification, which would wake them a moment early (`src/domain/wakeAlarm.ts`).

There is no "smart" alarm, because Nightwatch does not measure sleep stages. Android only; on iPhone this would use Apple's AlarmKit (iOS 26).

## Weather

This Morning follows the weather: a sunrise when it is clear, then partly cloudy, cloudy, rain (and thunder), snow and fog skies, with "Light rain, 9°C · overnight 11°C, 82% humidity" under the date. The forecast comes from MET Norway's Locationforecast (free, commercial use allowed, CC BY 4.0, so the credit line shows wherever the weather does) through our server's public `GET /v1/weather` (`server/src/weather.ts`), never from the phone directly: the server caches per area, revalidates with `If-Modified-Since`, sends MET at most 2 requests a second in total, and identifies the app (`WEATHER_CONTACT`). Location is approximate only (precise location is blocked in `app.json`), rounded to a 0.1° area (about 11 km) on the phone and again on the server (`shared/weather.ts`), and not stored. The app fetches once a night, at a random point in the first minute of recording, and once more on This Morning if that forecast is old. At Stop the night's mean and lowest temperature, mean humidity and the morning's conditions are saved (`night_weather`). Weather bands (cold under 5°C, warm from 18°C, humid from 90%, dry to 60%) are compared like factors, among nights that have weather, and the summary says so once there are 5 nights each side ("It was a cold night; your cold nights average 6 points higher."); this stays on the phone. Asked on Tonight, switchable in Settings.

## Look

A calm night sky (`src/ui/theme.ts`, `src/ui/NightSky.tsx`): an indigo gradient with a fixed, faint star field (a few stars twinkle unless the system asks for reduced motion), frosted see-through cards, and honey for the one thing to tap. Tonight has a crescent moon and a greeting; Recording is nearly black with a slowly breathing moon so the screen does not light the room; This Morning has a sunrise that follows the weather. Remedies, Trends and the screens opened from them (remedy detail, remedy test, doctor's report) use the same indigo without the night sky (`sky="plain"`). Headings use Nunito (`@expo-google-fonts/nunito`, loaded in the root layout); icons are Ionicons.

Honeycomb touches (`src/ui/Hive.tsx`) appear where the hive means something, while buttons and chips stay rounded so they are easy to tap. This Morning shows the score in a honey-outlined cell, Trends has "Your hive of nights" (one cell a day, brighter for louder; a week on the free plan, four with Insight), and remedies and factors show as icon cells: honey for remedies, outlined for factors (`src/ui/remedyIcons.ts` maps each catalogue item to a Material Community Icons glyph, with a fallback per category for items added later). What you chose for tonight, and last night's log, sit together as a small hive with the names underneath. The cells run across as many as fit, then wrap to an offset row.

## App icon

A crescent moon over a lavender sound wave inside a honeycomb cell outlined in honey, on indigo with a faint comb (option A of three concepts, chosen 17 October 2026). It is drawn as vectors in `scripts/make-icons.mjs`. That one script draws every version, so change the drawing there and run `npm run icons`. It writes:

| File | Used for |
| --- | --- |
| `assets/icon.png` | iOS (light), and the default everywhere. Full square, no rounding, no alpha channel, as the App Store requires |
| `assets/ios-icon-dark.png`, `ios-icon-tinted.png` | iOS 18 and later in dark and tinted mode (`ios.icon`). The tinted icon is greyscale; iOS colours it |
| `assets/android-icon-foreground.png`, `-background.png` | Android adaptive icon: the moon, wave and sea on transparent, over the sky. The moon and stars sit inside the 66-unit safe zone, so every launcher shape keeps them |
| `assets/android-icon-monochrome.png` | Android 13 and later themed icons: one colour, recoloured to match the wallpaper |
| `assets/notification-icon.png` | Notification icon (expo-notifications plugin), white on transparent |
| `assets/splash-icon.png` | Splash screen (expo-splash-screen plugin), on the night sky's colour. Sized to fit the circle Android 12 and later crop splash images to. Expo Router keeps it up until the first screen is ready |
| `assets/favicon.png`, `store/play-store-icon.png` | Web, and the Play Store listing (512 px) |
| `src/ui/logoArt.ts` | The same shapes for the app: `Logo` (`src/ui/Logo.tsx`) on the welcome screen, the doctor's report header, and the crescent in `Moon` on Tonight and Recording |
| `docs/icon-preview.png` | Every version as a phone shows it, on light and dark home screens |

For iOS 26's Liquid Glass look, Apple's Icon Composer (a Mac app) builds a layered `.icon` file. Import `assets/icon-src/layers/` in order (background with the comb, cell, moon, wave). Save the result as `assets/app.icon` and set `"ios": { "icon": "./assets/app.icon" }`. Icon Composer then handles dark, tinted and clear itself. The Recording foreground notification keeps Android's microphone icon, because it is the microphone that is in use.

## Detection

The heuristic (v0) labels nights at Stop. The trained model will plug in through `OnlineSnoreScorer` (`src/domain/detection/classifier.ts`): it scores each second during capture, its output is stored per second, and a night fully covered by the model uses it instead of the heuristic. Each night records which detector produced it. `tools/` has the labelling page and the evaluator for the Phase 1 gate (event agreement of at least 85% and frame F1 of at least 0.80).

## Decisions taken where the spec was open

- **Account required, always** (product decision), so the brief's "works with no account" no longer applies. Recording and the morning screen still work offline after sign-in.
- **Amazon only, global.** Links are built per marketplace from a search phrase or a marketplace ASIN, with tracking ids served by the server. Links appear only on remedies with full community results ("ok"), never untagged, never with prices; both disclosures are shown.
- **Co-introduced remedies.** The spec's 14-day rule would stop anything logged from a user's first night (an everyday pillow) from ever letting a later remedy be measured. A remedy logged on at least 80% of nights on both sides now counts as background and excludes nothing (`BACKGROUND_SHARE` in `shared/remedyEffect.ts`). The server's independent Python reference implements the same rule.
- **Experiment confidence** uses a seeded permutation test on the difference in means. With 7 nights a side, a test on medians reads "low confidence" even for a perfectly clean result. The verdict text still reports medians.
- **"Was this your typical night?"** is asked for each night (dismissable by answering), not only on the first morning, because the aggregation excludes atypical nights.
- **Events:** bridge gaps of up to 5 s, drop runs under 10 s, then merge events less than 20 s apart.
- **Sound is kept, on by default** (product decision, 16 October 2026). The plan processed audio and discarded it, keeping only clips; users could not check whether the detector missed snoring. Nights now keep their sound (silence dropped, AAC at 24 kbps, about 5 to 20 MB a night) for 30 nights on the phone, never uploaded, with a switch to turn it off. The microphone onboarding step says so.
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
