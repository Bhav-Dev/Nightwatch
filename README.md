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
| `EXPO_PUBLIC_POSTHOG_KEY`, `EXPO_PUBLIC_POSTHOG_HOST` | Anonymous usage counts to PostHog (EU host by default). Nothing is sent when the key is unset, in development builds, or when Settings → Share anonymous usage counts is off. Give `update:preview` the same key |

Server configuration (secrets, Amazon tracking ids, Apple and Google audiences, RevenueCat webhook secret) is in `server/README.md`.

## Over-the-air updates

Builds include `expo-updates` (from 17 October 2026). Changes that aren't native code, such as screens, text, colours and logic, reach installed builds without a new build:

```bash
npm run update:preview -- "What changed"   # to preview builds (the internal APK and iPhone builds)
```

- **The runtime version uses the fingerprint policy,** so an update only reaches builds with the same native code. Anything native needs a new build: a new module, a config plugin, or native settings in app.json.
- **Each build profile has a channel of the same name.**
- **The `env` in a build profile applies to builds only,** so `update:preview` passes the same `EXPO_PUBLIC_*` values itself. Keep the two in step.
- **Builds made before 17 October have no `expo-updates`,** and need one new build.
- **The free plan covers 1,000 monthly active users.**

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
  → SQLite session_frame    one transaction a minute (and when the app leaves the screen), so a killed app loses at most a minute
  → at Stop or auto-stop    detector → analyseNight → night, events, bins, clips, sound segments, tonight's log
```

- **iOS:** the expo-audio plugin adds the `audio` background mode.
- **Android:** `modules/nightwatch-recording-service` runs a microphone foreground service (notification, partial wake lock). Without it Android hands a backgrounded app silence.
- **Interruptions:** a jump in the session clock is a `stalled` gap; two or more all-zero seconds are `microphone_taken`; a watchdog restarts a silent stream. A recording the app never stopped becomes a partial night at next launch (`app_closed`). This Morning shows "Recording stopped at 03:12" with the cause and how to prevent it.
- **Auto-stop:** at 11:00 by default (Settings: 9 to 12), or after 12 hours, followed by a "your night is ready" notification.

## Clips, WAV now, Opus later

Clips are 15-second 16 kHz WAV (about 480 KB each). A night keeps up to five clips of snoring plus the three loudest moments that were not counted as snoring (other sounds, so the user can check what the detector left out): at most eight clips, about 3.8 MB, within the plan's ten-clip, 5 MB budget. Every clip row stores its codec, and all encoding goes through `src/clips/codec.ts`. To move to Opus: register an Opus encoder (a native module or a WASM libopus build), call `setPreferredCodec('opus')`, and run `transcodeClips` once; it converts old WAV clips and is safe to re-run. A test covers this path with a stand-in encoder. Clips could now use the native AAC encoder below; they are still WAV.

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

The parts of each night with sound in them are kept, compressed, so the morning timeline can be played from any point; silence is never written (`src/recording/soundRecorder.ts`). A second at least 6 dB above the room's running quiet level starts or extends a segment; each segment begins 3 seconds before the first loud second, runs on through pauses of up to 8 seconds (the gaps between snores), and is capped at 5 minutes so a phone that dies loses at most the segment being written. Segments are AAC-LC at 24 kbps, 16 kHz mono (`.m4a`, about 11 MB per hour of sound), encoded by the platform encoder in `modules/nightwatch-recording-service` (`AacSegmentWriter.kt`: MediaCodec and MediaMuxer, on one background thread). Rows are in `sound_segment`; files in the document directory's `sounds/`. They stay on the phone, are never synced, and are deleted after 30 nights (`soundRetention.ts`, at launch, along with any half-written file). Settings has an on/off switch (on by default), the storage used and "Delete sound recordings". On the morning screen a thin line under the timeline marks recorded stretches; a tap plays from that moment, a playhead follows, and playback carries on into the next stretch. On iOS the same module encodes with the system AAC encoder (see "iPhone" below). Builds made before this feature simply keep no sound.

## Checking the night: Snoring answers, moments and the recap

Every snoring or other-sound moment, in the list and when picked on the timeline, has a Snoring tick: on when the night counted it as snoring. Unticking says it was not snoring; ticking says it was. Each answer is a row in `sound_label` (a time range and the answer), and the night is rebuilt from the detector's own events with the answers applied in order (`src/domain/scoring/corrections.ts`, `src/data/labelRepo.ts`): "not snoring" cuts that stretch out of the snoring (an event can be split; pieces under 10 s are dropped), "snoring" adds it and merges with snoring it touches. Score, time snoring, event count and the timeline's bins are worked out again with the usual formula, and the night is marked for sync, so trends, tests and community figures use the corrected night. The detector's events are copied to `event_detected` the first time a night is answered, and its score to `night.detector_score` (shown as "Was 41 before your answers"); undoing every answer restores both. Answers are kept on the phone as labelled examples for training and checking the detector, and are included in the export. Per-second levels are not kept after Stop, so the loudness of a stretch the user adds comes from the clip's peak, or the 5-minute bins.

**The timeline (redesigned 20 October 2026).** One chart instead of a chart and lanes. Every kind of moment is on it in its own colour and shape (`momentColor` in `src/ui/theme.ts`):

| Kind | Colour | How it's drawn |
|---|---|---|
| Snoring | honey | the loudness outline filled by intensity, with a honey mark above each stretch |
| Movement | orange | ticks under the outline, restless stretches shaded |
| Possibly awake | red | bands behind |
| Other loud sounds | blue | marks above |

The colours differ in lightness as well as hue. Hours are clock times. Drag along the chart, and the time shows in a bubble; let go to play from there. The picked or playing second is a line.

**Chips under the chart (`src/ui/MomentFilter.tsx`)** are its legend and its filter: All, Snoring, Movement, Possibly awake and Other, each with a count.

- Any mix can be on, but not none.
- The chart, the previous and next arrows, and the Moments list all follow them.
- Nights from before the night-events check only offer Snoring and Other.
- When Possibly awake is on and there was none, a note says where it comes from: picking up the phone, or a watch.

**Moments.** The night is a list of moments (`src/domain/moments.ts`): each stretch of snoring, each loud sound not counted as snoring, each movement, each stretch of possibly being awake, and other recorded sound. Recorded sound with nothing else in it is left out of the arrows and the list (`shownMoments`); dragging plays it.

- **Under the chart:** the picked moment, with previous and next, play, and the Snoring tick for snoring and other sounds.
- **The Moments card (`src/screens/MomentList.tsx`)** replaces "Loudest moments" and "Other sounds". It lists the shown moments in order, six at first, then "Show all". Each row has:
  - a play cell in its kind's colour, which plays the night's recorded sound from that moment (or its clip on nights without sound recording);
  - the Snoring tick, for snoring and other sounds;
  - Save and Share, when a clip was kept for it.
- **Why the list matters:** clips are the loudest few of the night, so quieter snoring can be left without one. In the list, every snoring stretch can still be played.

Notes, the phone test list and follow-ups are in [`docs/morning-review-plan.md`](docs/morning-review-plan.md).

Nothing is asked of the user straight after waking. At Stop, a night recap notification is scheduled for later in the day (`src/domain/recap.ts`: mid-morning, lunchtime by default, or evening, at least 90 minutes after stopping and never after 9pm; a newer night replaces it; it is cancelled once the user has answered for that night). Tapping it opens This Morning. The app store review prompt (`src/domain/reviewPrompt.ts`, via expo-store-review) is only asked at such a leisurely moment: after the third night, at least 2 hours after stopping or from the recap, once the user has played or answered twice on that visit, not when most answers were corrections, not after a short night, at most every 120 days and 3 times a year. It is tried after a clip plays to its end or an answer is saved.

## Share cards

A night, a week or a month can be shared as an image, for posts on r/snoring, Instagram or a group chat. Every card carries the logo, the name and "Track your snoring free with SnoreHive · On iPhone and Android", so each share is a quiet advert. Cards are 4:5 (laid out at 360 × 450 points, saved at 1080 × 1350), which feeds show uncropped.

- **Night** (Share on This Morning's score card): the score in its honey cell, its label, one headline, the night's timeline in colour, and time snoring, time in bed and the loudest snoring. The headline (`src/domain/shareCard.ts`) is the most share-worthy true thing: "My quietest night in 12 nights" (a run of at least 7), then "8 below my average, with nasal strips" (when a remedy was logged and the night beat the 7-night average by 3 or more), then the change against the average, else the time snoring.
- **Week** (Share on Trends' hive of nights, or from the night's sheet): the last 7 days as seven cells with their scores and days, the average in a honey cell, and the change against the week before (or how many nights were recorded).
- **Month:** the last 30 days as a honeycomb, the average and the change against the 30 days before. Hive members only, since a Bee keeps 7 nights; a Bee tapping it sees the paywall.

Cards hold snoring figures only: never audio, watch data or anything about a partner. Remedy names appear only in the night headline, from the person's own log, and the preview shows exactly what will be shared. The card is drawn in `src/ui/ShareCard.tsx`, captured with `react-native-view-shot` and handed to the phone's share sheet (`src/screens/ShareSheet.tsx`). Shares are counted (`card_shared`, with the kind only). `react-native-view-shot` is native, so cards need a new build; the fingerprint runtime keeps the update off older builds.

## Sleep sounds

Tonight offers white, pink or brown noise to fall asleep to, with a 15 to 60 minute timer (`src/domain/sleepSounds.ts`). The noise is generated live by `NoisePlayer.kt` (an `AudioTrack` on the media stream, inside the process the recording service keeps alive), so there are no audio files and no loop seam; it fades in over 3 seconds, fades out over the last minute and stops by itself. Only steady sounds are offered: the phone's own microphone hears whatever plays, and rhythmic sounds (waves, music) rise and fall at breathing pace like snoring. The recording session notes which sound played and until when (`sleep_sound`, `sleep_sound_until_s`, copied to the night); during that stretch the detector and the scoring measure each second against the sound's own level rather than the quiet room, and a model's score must clear a higher bar (`MASKED_THRESHOLD_BUMP`). The morning timeline shades the stretch. Echo cancellation was considered and left out: call-style processing suppresses steady low sounds like quiet snoring and rides the gain, which would break the loudness measures. Android only so far.

## What else happened in the night

Beyond snoring, This Morning shows estimates found without a model (`src/domain/activity.ts`; design in `docs/night-events-design.md`):

- **Movement.** Turning over is a short rustle: at least 6 dB over the room's floor, broadband (spectral centroid over 1.5 kHz, above snoring), uneven within the second, not counted as snoring, and over within 15 seconds. Rustles up to 2 seconds apart are one movement. The first and last 2 minutes of the night are skipped, and during sleep sounds a rustle must stand out from the sound. Detected at Stop from the per-second features already kept, and stored in `night_activity`.
- **Restless stretches:** three or more movements within 10 minutes.
- **Possibly awake:** the phone was picked up (the app came back to the front while recording; the first 2 minutes and the last 3 are ignored, as settling down and stopping), or a watch said awake for 2 minutes or more. Never stated as certain.
- **"Turned over, and the snoring stopped":** a movement after at least 2 minutes of snoring in the 10 minutes before it, with the snoring not carrying on a minute past it and then at least 15 minutes of quiet. It becomes a summary sentence ("Snoring stopped after we heard you turn over at 3:10, and it stayed quiet for 40 minutes"), and is the most direct evidence for side sleeping.

Movement and possibly awake are drawn on the timeline itself and listed as moments (see the timeline, above). Sleep stages from a watch (deep, light, REM, awake) are a strip under the timeline (`src/ui/SleepStages.tsx`). It follows the existing watch overlay and needs Insight, and tapping it plays the night from that moment. Sound alone cannot tell deep from light sleep, so without a watch there is no stage strip. None of this changes the score or syncs.

## iPhone

`modules/nightwatch-recording-service/ios` gives the same JS API as Android (built 17 October 2026; it compiles on EAS but has not run on an iPhone yet):

- **Sound segments** use the system AAC encoder through AVAudioFile (AAC-LC .m4a, 16 kHz mono, 24 kbps), on one serial queue in call order.
- **Sleep sounds** come from an AVAudioEngine source node, with the same white, pink and brown filters, gain, 3-second fade-in and timed fade-out as Android.
- **There is no recording service on iOS**, because the audio background mode keeps capture alive.
- **There are no alarm functions**, so the alarm row is hidden. An iPhone alarm would need Apple's AlarmKit.

**Playing sound while recording.** expo-audio's microphone stream asks for the record category, which silences all playback. So the module swaps AVAudioSession's `setCategory(_:mode:options:)`, as expo-font does for UIFont, and turns that one request into play-and-record (`PlaybackWhileRecording.swift`):

- The measurement mode stays the same.
- Output goes to the speaker by default, and Bluetooth is used for output only.
- If play-and-record is refused, the original request goes ahead, so recording never depends on it.
- Drop it once expo-audio can record in play-and-record itself.

**The silent switch.** Recording sets `playsInSilentMode`, which iOS requires for recording, and listening back on This Morning does the same, so the silent switch doesn't mute either. The preview on Tonight briefly switches the session to playback, then puts it back.

**Listening back after a recording.** On both platforms, after a recording stopped, play buttons did nothing until the app restarted. The player on This Morning had been created before the night and lived through the recording. `useClipPlayer` now handles it like this:

- Each file gets a new player when it starts.
- If a play request still hasn't started after 1.2 s, the hook switches audio back on (`setIsAudioActiveAsync(true)`), sets the playback mode again, and tries once more on a fresh player from the same point.
- In test builds, anything that goes wrong is listed under Settings, Playback log.

**TestFlight.** `npm run testflight` builds on EAS and uploads to TestFlight. It signs in to Apple with the App Store Connect API key in `credentials/AuthKey.p8` (not committed) and the ids in `.env.local`. Notes:

- The first run must be interactive, because EAS only creates the distribution certificate and provisioning profile after asking.
- Capability syncing is off (`EXPO_NO_CAPABILITY_SYNC=1`). With an API key, Apple rejects EAS's request to turn on Push Notifications.
- The App ID `com.threeft2.nightwatch` therefore has its capabilities ticked by hand in the Apple developer portal: HealthKit, Push Notifications and Sign in with Apple, matching the entitlements from `npx expo config --type introspect`.
- Push Notifications is only there because expo-notifications adds `aps-environment`. The app sends local notifications only.
- If a plugin adds an entitlement, tick it in the portal too.

## Wake-up alarm

The wake-up alarm is the phone's own. Nightwatch has no alarm of its own and stores no alarm time; it reads the phone's next alarm, whichever app set it (`AlarmManager.getNextAlarmClock`, which needs no permission; `nextAlarmTime` in the native module).

- **On Tonight,** under sleep sounds, a row shows tomorrow morning's alarm. Tapping it opens the Clock app's alarms to change it (`ACTION_SHOW_ALARMS`). The row counts an alarm 1 to 18 hours ahead; a bedtime reminder, or a weekday alarm seen on a Saturday, does not count. With no alarm, the row offers "Set". That opens the system time dialog (`@expo/ui`) and adds a one-off alarm to the Clock app straight away, without opening it (`ACTION_SET_ALARM` with skip-UI, the `SET_ALARM` permission). So people who already have alarms get no duplicates, and the Clock app rings the alarm whatever happens to Nightwatch overnight, including in Do Not Disturb and on battery saver.
- **While recording,** the recording stops 30 seconds before the phone's next alarm when it rings at least an hour in and within the 12-hour limit. Otherwise it stops at the auto-stop hour. Stopping early keeps the alarm out of the recording, and the night is ready as it rings. The alarm is read again every minute, so moving it in the night is followed. Stopping for an alarm sends no "Your night is ready" notification, which would wake them a moment early (`src/domain/wakeAlarm.ts`).

There is no "smart" alarm, because SnoreHive does not measure sleep stages. Android only; on iPhone this would use Apple's AlarmKit (iOS 26).

## Weather

This Morning follows the weather: a sunrise when it is clear, then partly cloudy, cloudy, rain (and thunder), snow and fog skies, with "Light rain, 9°C · overnight 11°C, 82% humidity" under the date. The forecast comes from MET Norway's Locationforecast (free, commercial use allowed, CC BY 4.0, so the credit line shows wherever the weather does) through our server's public `GET /v1/weather` (`server/src/weather.ts`), never from the phone directly: the server caches per area, revalidates with `If-Modified-Since`, sends MET at most 2 requests a second in total, and identifies the app (`WEATHER_CONTACT`). Location is approximate only (precise location is blocked in `app.json`), rounded to a 0.1° area (about 11 km) on the phone and again on the server (`shared/weather.ts`), and not stored. The app fetches once a night, at a random point in the first minute of recording, and once more on This Morning if that forecast is old. At Stop the night's mean and lowest temperature, mean humidity and the morning's conditions are saved (`night_weather`). Weather bands (cold under 5°C, warm from 18°C, humid from 90%, dry to 60%) are compared like factors, among nights that have weather, and the summary says so once there are 5 nights each side ("It was a cold night; your cold nights average 6 points higher."); this stays on the phone. Asked on Tonight, switchable in Settings.

## Look

A calm night sky (`src/ui/theme.ts`, `src/ui/NightSky.tsx`), frosted see-through cards, and honey for the one thing to tap. The skies were made honeycomb on 21 October 2026, from an approved mockup.

- **Night:** an indigo gradient with a fixed field of tiny hexagon stars, some of them honey. A few larger ones twinkle.
- **Tonight:** a honeycomb moon and a greeting. The moon is round and honey-coloured with a faint comb across it, shaped into a crescent by a round shadow.
- **Recording:** nearly black, with the same moon slowly breathing, so the screen does not light the room.
- **This Morning:** a sunrise that follows the weather.
  - Clear and partly cloudy have a hexagon sun with two slowly swelling rings and six small cells circling it.
  - Clouds are honeycomb clusters of eleven cells, drifting steadily across.
  - Rain and snow fall without stopping, in near and far sheets. Snowflakes are six-sided and sway as they fall.
  - Fog is drifting bands of faint cells.

Every movement is a native loop of a single timing, or a two-step swing. An earlier per-drop "wait, then fall" loop stopped on iOS and left the rain heaped at the bottom. If the system asks for reduced motion, everything stays still. Remedies, Trends and the screens opened from them (remedy detail, remedy test, doctor's report) use the same indigo without the night sky (`sky="plain"`). Headings use Nunito (`@expo-google-fonts/nunito`, loaded in the root layout); icons are Ionicons.

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

- **Heavy breathing** takes the Snoring answer: "snoring" turns the stretch into snoring through the normal corrections; "not snoring" keeps it as heavy breathing.
- **Snore pitch** is each second's strongest frequency between 70 Hz and 2 kHz, kept as a median per stretch in `snore_pitch` (apart from `event`, because answers rebuild events). The profile's cut-offs, 300 Hz and 800 Hz, follow published peak frequencies (soft palate around 140 Hz, tongue base over 1 kHz), and it says "often linked with", never a finding. The profile card sits on Trends.
- **Find your type** runs up to three remedy tests together with crossed plans, so each verdict stands on its own.
- **The website** is a static Astro site in `website/` with its own package; see `website/README.md` for running, adding articles and deploying on Vercel.

- **Analytics:** anonymous PostHog counts over plain HTTP, with no SDK and a random install id that is never the account. On by default, with a switch in Settings.
- **Apple sign-in tokens** are kept, sealed, only so they can be revoked when someone deletes their account.
- **Alerts** are emails through the existing mailer to `ALERT_EMAIL`, at most one per kind per hour.
- **Bee and Hive:** data export stays free for everyone (UK GDPR right to a copy of your own data).

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
- **Paid vs free** (being changed: Bee and Hive, with community results Hive only; see [`docs/tiers-plan.md`](docs/tiers-plan.md)) follows the brief's table: free has 7 nights of history, the first sentence of the summary and the top-level ranking; paid unlocks 30/90-night trends, snapshots, the full summary and watch overlay, tests, people-like-you, profile breakdowns, your result against the crowd, and the report.
- **Column names:** `bin.idx`, `snapshot.from_date/to_date` (app); `app_user`, `time_window` (server), to avoid SQL keywords.

## Not verified, or still to do

- **Devices:** nothing has run on a phone. Also untested: the Kotlin module (no Android SDK here), the Health and RevenueCat libraries, and Sign in with Apple and Google.
- **Phase gates that need people:** the 8-hour battery test, the labelled test set, 5 then 20 testers, a clinician review of the report wording, and the 100-person beta.
- **Content:** catalogue articles are short drafts that need the 150 to 250 word versions and clinician review. The privacy policy, terms and affiliate disclosure pages are Phase 4.
- **Smaller gaps:** the Recording view has no battery estimate. Clip sharing does not yet make a card image. Analytics events are defined and wired but go to no vendor (`setAnalyticsSink`).
- **Retention of held-out audio (needs a decision):** the spec deletes recordings after labelling but also keeps the held-out set fixed so later models are compared on it. A future model cannot run on deleted audio. Either the consent form covers keeping the held-out nights' audio (encrypted, restricted), or each model gets a new held-out set. See `tools/README.md`.
