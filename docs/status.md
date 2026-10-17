# Nightwatch: where we are

Last updated 15 October 2026. Tracks [project-plan.md](project-plan.md) item by item. Update it as work lands.

| Mark | Meaning |
| --- | --- |
| ✅ | Done: built, and checked by automated tests, a typecheck or a real-database run here |
| 🟡 | Built, but not yet checked where it matters (on a phone, against the real service, or by measurement) |
| 👤 | Needs you: a decision, an account or key, real people, or an outside reviewer |
| ⬜ | Not started |

## In one paragraph

Phases 0 to 3 are written: the app (recording, scoring, clips, morning screen, trends, Health data, remedy tests, doctor's report, paywall, sign-in, sync, community dashboard), the backend and nightly job, and the labelling tools. About 220 automated tests pass across app and server, and the backend has run end to end on a real Postgres database. **Nothing has run on a phone yet.** The backend is live in your shared Supabase project: database, both functions and the nightly job. The next steps are the accounts and keys and a development build, then the Phase 0 device gate.

## Next steps, in order

1. ✅ **Supabase connected** (15 October 2026, project `zezujcujwvnmzxvbchmy`), following `server/README.md`, "Deploy to Supabase":
   - schema and role, migration 001 and the 42-entry catalogue;
   - the three secrets the backend needs to start (database URL, session secret, aggregate secret; kept in the gitignored `supabase/.env.nightwatch.local`);
   - `nightwatch-api` and `nightwatch-aggregate` deployed; the API answers `/v1/health`;
   - `pg_cron` and `pg_net` enabled, and the 04:00 UTC job scheduled. It has run once, by hand, through the scheduled command.

   Secrets for the keys in step 2 are added as each key arrives (`npx supabase@latest secrets set --project-ref zezujcujwvnmzxvbchmy NIGHTWATCH_...=...`). The app's `EXPO_PUBLIC_API_URL` will be `https://zezujcujwvnmzxvbchmy.supabase.co/functions/v1/nightwatch-api`.
2. 👤 **Accounts and keys** (each part of the app stays switched off until its key is set). Placeholders for every value are in `.env.local` (app) and `supabase/.env.nightwatch.local` (server):
   - an Expo/EAS account;
   - a Resend key and sending domain;
   - ✅ Apple: App ID `com.threeft2.nightwatch` registered with Sign in with Apple and HealthKit (15 October 2026); the server accepts Apple sign-in;
   - Google OAuth client ids, in a Google Cloud project of Nightwatch's own (calmov's consent screen would show CalMov);
   - a RevenueCat project with the products;
   - Amazon Associates tracking ids.
3. 👤 **Development build** (`npx eas-cli@latest build --profile development`) on an iPhone 11-class phone and a 2020 mid-range Android.
   - Android: ✅ builds on EAS (15 October 2026, project `@vesuviuss-team/nightwatch`), first installed on a Samsung S24 Ultra. The first build failed on a duplicate Health Connect module; `expo-health-connect` was removed, since `react-native-health-connect` 4.x includes it.
   - iPhone: not built yet. Needs `eas device:create` and the first `eas build --platform ios` run from your own terminal (Apple login).
   - The battery test needs a `preview` build (release mode, no dev server); development builds use more power.
4. 👤 **Phase 0 gate:**
   - an 8-hour screen-off recording under 8% battery on both phones;
   - a phone call during recording should show "Recording stopped at…".
5. 👤 **Labelled test set:** record the 30 nights with 5 to 8 volunteers, label them with `tools/`, then train the detection model (Phase 1 gate).
6. 👤 **Morning review on a phone** (Snoring answers, scrubber, recap, review prompt): needs a new build, since `expo-store-review` is native. Test list and follow-ups in [morning-review-plan.md](morning-review-plan.md).
7. Then the Phase 1 to 3 gates with testers, and Phase 4 (launch).

## Phases and gates

### Phase 0: Foundations

| Item | Status | Notes |
| --- | --- | --- |
| Project on the shared stack | ✅ | Expo SDK 57, React Native, TypeScript, Expo Router |
| Native audio capture on both platforms | 🟡 | expo-audio PCM stream, plus our Android foreground-service module (`modules/nightwatch-recording-service`). The Kotlin compiles (Android builds on EAS). First real night recorded on a Samsung S24 Ultra (preview build, about 4 hours, 16 October 2026); the full 8-hour battery test is still to do |
| Interrupted recordings | 🟡 | Clock jumps, silent stretches and app kills become partial nights with a cause. Tested in code, not on a phone |
| 30-night test dataset | 👤 | Needs volunteers. Tools ready in `tools/` |
| Catalogue of about 40 entries with articles | ✅ | 42 entries. Articles are short drafts (see Content below) |
| **Gate:** 8-hour screen-off recording under 8% battery, both platforms | 👤 | Needs phones |

Acceptance criteria:

| Criterion | Status | Notes |
| --- | --- | --- |
| 8-hour recording on iPhone 11 and a mid-range Android, screen off, DND, under 8%, 96 bins | 🟡 | 96 bins per 8-hour night is tested; the device run is pending |
| A phone call gives the interrupted state with the right stop time and a partial night | 🟡 | Logic tested; device pending |
| CI builds both platforms and runs scoring unit tests | ✅ / 👤 | CI runs tests and the JS bundle for both platforms. Signed native builds need EAS credentials |
| 42-entry catalogue loads from the server and shows as Tonight chips | ✅ / 🟡 | Loading from the server is proven in the contract test; the chips have not been seen on a phone |

### Phase 1: Parity

| Item | Status | Notes |
| --- | --- | --- |
| Detection | ✅ / ⬜ | The heuristic (v0) is in place, as decided. The model is not trained yet; it plugs in through `OnlineSnoreScorer` |
| Score, timeline, clips, remedy and factor logging, 7-night history | 🟡 | All built and logic-tested; UI not seen on a phone |
| Tonight and This Morning screens | 🟡 | Built from the mockups |
| Clips | 🟡 | WAV, with groundwork for Opus (codec registry and transcoding, tested). Up to 5 snoring clips plus the 3 loudest "other sounds" a night. Share gives the audio file only; no card image yet |
| Sleep sounds (white, pink, brown noise with a fade-out timer) | 🟡 | Beyond the plan, decided 16 October 2026. Generated natively, steady sounds only; snoring under them is measured against the sound. Tested in code; not yet heard on a phone. Android only |
| Wake-up alarm (the phone's own alarm; recording stops just before it) | 🟡 | Beyond the plan, decided 16 October 2026. Uses the phone's existing alarm, or adds one to the Clock app if there is none. Seen working with Samsung Clock on the S24; first overnight use pending. Android only (iPhone would need AlarmKit) |
| Night-sky look (theme, moon, sunrise morning, Nunito, icons) | 🟡 | 16 October 2026; seen on the S24 (the morning was reworked from dusk to a sunrise) |
| SnoreHive: name, logo, and honeycomb touches | 🟡 | Renamed from Nightwatch, 17 October 2026 (internal IDs unchanged). Logo A (moon and wave in a honeycomb cell) on every icon, the splash, the welcome screen and the report. The score sits in a honeycomb cell on This Morning; Trends shows "Your hive of nights"; remedies and factors have icon cells (Tonight, This Morning's log, the picker and the Remedies tab); the accent is honey. Server copy (sign-in email, MET Norway user agent) renamed; the Supabase functions need redeploying for it. Not yet seen on a phone |
| Doctor's report restyled | 🟡 | 17 October 2026: prints on white in the app's colours, with an indigo header and logo, headline numbers, bars by score band and coloured differences. Not yet generated on a phone |
| App icon (iOS light, dark and tinted; Android adaptive and themed; notification), splash screen, and the logo in the app | 🟡 | 16 October 2026: every file generated by `npm run icons` (see README), now with logo A. Not yet seen on a phone. The iOS 26 Liquid Glass `.icon` needs Icon Composer on a Mac |
| Weather on This Morning, and as a factor | 🟡 | Beyond the plan, decided 16 October 2026. MET Norway via our server's public `/v1/weather` (live on Supabase, cached per ~10 km area); approximate location only; the sky follows the weather; each night's temperature and humidity saved and compared like a factor. Tested in code and the route live-tested; not yet run on a phone |
| Sound recording (listen back from the timeline) | 🟡 | Beyond the plan, decided 16 October 2026: the parts of the night with sound, AAC 24 kbps, kept 30 nights, on by default. Built and tested in code (Android native encoder, segments, retention, playback); not yet run on a phone. iOS ⬜ (needs the encoder in Swift) |
| Onboarding, Settings, export, delete, auto-stop, bedtime reminder | 🟡 | Built |
| "Was this snoring?" answers (a Snoring tick on every clip and moment) that correct the night | 🟡 | Beyond the plan, decided 17 October 2026. Ticked when we counted it as snoring; untick or tick to correct. The score, timeline and time snoring are worked out again; the detector's own events and score are kept, so every answer can be undone; answers are stored (`sound_label`) as labelled examples for training. Tested in code; not yet seen on a phone |
| Timeline scrubber, and previous and next through the night's moments | 🟡 | 17 October 2026. Drag along the timeline or its slider; the picked moment has previous, next, play and the Snoring tick. Moments are snoring, loud non-snoring sounds and other recorded sound. Not yet seen on a phone |
| Night recap notification later in the day, and the app store review prompt | 🟡 | 17 October 2026. The recap (mid-morning, lunchtime by default, evening or off) invites the user to look back and check moments; nothing is asked straight after waking. The review prompt (expo-store-review) only appears after the third night, 2 hours after stopping or from the recap, once the user has played or answered twice, not after a night they had to correct, and at most every 120 days. Not yet seen on a phone |
| Internal test with 5 snorers for 2 weeks, compared with SnoreLab | 👤 | |
| **Gate:** 85% event agreement, testers say the morning screen told them something new | 👤 | Needs labelled nights and a trained model |

Acceptance criteria:

| Criterion | Status | Notes |
| --- | --- | --- |
| Event agreement of 85% or more and frame F1 of 0.80 or more on held-out nights | ⬜ | The evaluator is built (`tools/eval`); it needs the labelled set and a model |
| Scoring fixture nights for each band within 1 point; partial night excluded from averages | ✅ | |
| This Morning renders in under 500 ms with 300 events; clips play within 300 ms | 🟡 | Not measured; needs a device |
| Ticks persist, pre-fill the next night, and stay editable until noon | ✅ | |
| Five testers, 10 nights each, four say they learned something | 👤 | |

### Phase 2: Personal insight

| Item | Status | Notes |
| --- | --- | --- |
| Health import and correlation timeline | 🟡 | Apple Health and Health Connect readers, alignment and nightly summary. Alignment and summary are tested; the readers are untested on a phone |
| Morning summary | ✅ | Template rules, 20 fixture nights |
| 14-night experiments | ✅ | Plan, progress and verdict with confidence |
| Doctor's report PDF | ✅ / 🟡 | Content and compliance header tested; the PDF render on a phone is not checked |
| Paywall and subscription | 🟡 / 👤 | Built on RevenueCat, with locks throughout. Needs a RevenueCat project and store products |
| **Gate:** 20 testers, half import Health, a GP or sleep clinician reviews the report wording | 👤 | |

Acceptance criteria:

| Criterion | Status | Notes |
| --- | --- | --- |
| Health aligns within 60 s and gives a summary; nights with no Health data show no overlay and no errors | ✅ / 🟡 | Alignment and summary tested; the screen not seen on a phone |
| Summary follows the template exactly for 20 fixture nights | ✅ | |
| Experiment gives the right with/without medians, and "not enough nights" below 5 a side | ✅ | |
| Report PDF has the header, date range, counts, chart and factor table; a clinician has reviewed the wording | ✅ / 👤 | Clinician review outstanding |
| Trial starts, status mirrors to the server within 5 minutes, features unlock, restore works on a second device | 🟡 | The server's webhook mirror is tested; the store flow is not |

### Phase 3: Community layer

| Item | Status | Notes |
| --- | --- | --- |
| Accounts and sync | ✅ | Account always required (Apple, Google, email link). Two-phone sync proven in the contract test |
| Contribution opt-in flow | ✅ / 🟡 | Server tested; screens built |
| Nightly aggregation job | ✅ | Matches an independent NumPy reference to 0.1 on 500 synthetic contributors |
| Dashboard screens with sample-size rules, "people like you" | 🟡 | Built; not seen on a phone |
| Affiliate links on catalogue items | ✅ / 👤 | Amazon only, as decided; needs your Associates tracking ids |
| Methods page on the site | ✅ / ⬜ | Written (`site/methods.html`); not hosted yet |
| Backend on Supabase | ✅ | Own `nightwatch` schema and role in your shared project, migrated and seeded; both functions deployed and answering; nightly job scheduled and run once. Supabase's API roles cannot read the schema |
| Closed beta of 100 | 👤 | |
| **Gate:** 60% opt in, 5 remedies past 30 users, sanity check against the literature | 👤 | The job runs the sanity checks itself; needs beta data |

Acceptance criteria:

| Criterion | Status | Notes |
| --- | --- | --- |
| Opt-in creates an unlinked contributor id; opt-out drops rows next run; account deletion removes synced data | ✅ | |
| Job on 500 seeded contributors matches a reference to 0.1; segments under 10 absent | ✅ | |
| Dashboard shows early and hidden states; free tier cannot request a profile segment | ✅ / 🟡 | Server enforced and tested; screens built |
| Affiliate links show the disclosure; ordering matches median_delta | ✅ / 🟡 | Logic done; not seen on a phone |
| Sanity assertions pass on beta data | 👤 | |

### Phase 4: Launch

| Item | Status |
| --- | --- |
| Store listings and screenshots that lead with the dashboard | ⬜ |
| Site pages for the top snoring and apnoea questions; press note from the first findings | ⬜ |
| Reviewer demo account seeded with 14 nights | ⬜ |
| Privacy policy, terms, affiliate disclosure page | ⬜ |
| App Store privacy labels, Play data-safety form, background-audio justification | ⬜ (the justification text is drafted in the plan) |
| **Gate:** zero crashes across the device matrix; reviewer demo path works end to end | ⬜ |

### After launch

| Item | Status |
| --- | --- |
| Partner mode (Household) | ⬜ Held for the first update, as the plan says; "coming soon" card in Settings |
| Night events: classify every sound (snoring, partner, talking, coughs, movement), possible wakes, watch sleep-stage lane, user corrections | ⬜ Proposed, not scheduled. Design in [night-events-design.md](night-events-design.md) |
| Monthly catalogue review, "what the data says" post, new slices | ⬜ |
| Localisation and non-UK affiliate programmes | ⬜ (Amazon links already work in 12 marketplaces once tags are set) |

## Open decisions

From the plan:

| Decision | Status |
| --- | --- |
| Name (Nightwatch is a placeholder; check store and domain availability) | 👤 |
| Detection model: fine-tune now, or heuristic first and collect labels | ✅ Decided: heuristic now, train later |
| Account-free contribution, or account required | ✅ Decided: account always required |
| Dashboard visible to free users, or paid only | ✅ Built as the plan suggests: top level free, slices paid |
| Which clinician reviews the report wording, and whether to pay them | 👤 |
| Partner mode at launch or in the first update | 👤 Built for the first update; confirm |
| Amazon only, or direct brand programmes too | ✅ Decided: Amazon only for now |

Raised during the build:

| Decision | Status |
| --- | --- |
| Backend host | ✅ Decided: your existing Supabase project, in a `nightwatch` schema |
| Clip format | ✅ Decided: WAV now, Opus later (groundwork in place) |
| Bundle id (iOS) and package (Android) | ✅ Decided: `com.threeft2.nightwatch` on both, independent of the final app name |
| Keeping held-out audio: the spec deletes recordings after labelling but also keeps the held-out set fixed for comparing models | 👤 Either consent covers keeping held-out audio (encrypted, restricted), or each model gets a new held-out set. See `tools/README.md` |
| Labelling: pauses under 20 s stay inside one snoring region | 👤 Confirm |
| Shared Supabase project: anyone with dashboard or owner access can read Nightwatch's health summaries | 👤 Accept, or use a separate project |

## Content

| Item | Status |
| --- | --- |
| Catalogue articles at 150 to 250 words, with "see a GP if" lines | ⬜ Short drafts exist; need writing and clinician review |
| Medical-device wording guide (one page) | ⬜ |
| "What we share" page | ✅ In the app (Settings, Data and sharing) |

## Operational checklist (from the plan)

| Item | Status | Notes |
| --- | --- | --- |
| Environments: local, staging, production | ⬜ | Staging can be a second schema (`nightwatch_staging`) with its own role |
| CI: lint, unit tests, scoring fixtures, build per platform | ✅ | Plus server tests and the NumPy check |
| Signed release builds from CI, keystore and certificates backed up | 👤 | EAS credentials |
| Crash reporting | ⬜ | No Sentry or Crashlytics yet |
| API error-rate alert, aggregation-job alert | ⬜ | Failures are logged in `nightwatch.aggregate_job_log`; nothing alerts yet |
| Nightly Postgres backup with a tested restore | 👤 | Supabase backups cover it; check the plan includes point-in-time recovery, and test a restore |
| Analytics (10 events, no health values) | ✅ / ⬜ | Defined and wired; no vendor connected |
| Store readiness: privacy labels, data-safety form, demo account | ⬜ | Phase 4 |
| Legal: privacy policy, terms, affiliate disclosure, methods page | ⬜ / ✅ | Methods page written; the rest are Phase 4 |

## Known gaps in what is built

- **Recording view:** no battery estimate.
- **Snoring answers:** the loudness of a stretch the user adds as snoring is estimated (per-second levels are not kept), and the answers themselves are not synced. See [morning-review-plan.md](morning-review-plan.md).
- **Clips:** sharing gives the audio file only; no card image yet.
- **Sleep sounds:** Android only (iOS needs the noise player in Swift). Playing them all night is not offered; an echo-cancellation test (pink noise and a snoring video, with and without the platform canceller) would show whether that could work.
- **Sound recording:** Android only; iOS needs the same AAC encoder in Swift. Battery has to be measured again with it on (the 8% gate). Clips are still WAV, though they could now use the AAC encoder.
- **Google sign-in** uses `expo-auth-session`'s Google helper, deprecated in SDK 57; Expo now points to a native Google sign-in library. Its Android flow relies on a custom-scheme redirect that Google turns off by default for new Android clients. Switch before testing Google on a phone.
- **Email sign-in links** open `nightwatch://auth?token=…`, which many email apps (Gmail included) will not open. Route them through an https page that opens the app (`NIGHTWATCH_APP_LINK_BASE`) before relying on email sign-in.
- **Sign in with Apple on account deletion:** Apple requires apps to revoke the user's Apple tokens when they delete their account (needs a Sign in with Apple key and a server call). Not done yet; needed before App Store submission. The optional server-to-server notification endpoint can be added at the same time.
