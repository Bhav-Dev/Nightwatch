> **Where we are:** [status.md](status.md) tracks every phase, gate, acceptance criterion, open decision and ops item in this plan against what is built. The screen mockups are in [screens.html](screens.html) (open it in a browser). This plan is kept as written; where the build departs from it, the reason is in status.md and the README.

# Snoring App — Project Plan

Oct 14, 2026 · @Someone

## Vision and positioning

**Working title:** Nightwatch (placeholder). **One line:** record your snoring like SnoreLab, see it against your watch's data, and find out what actually helped thousands of people like you, not just what helped you.

**The gap.** SnoreLab records, scores and plays back your snoring, lets you log remedies and lifestyle factors, and shows how they affect your own results, with expert remedy content alongside. Everything it learns about remedies stays inside each user's phone. Nobody shows the snorer the aggregate: which remedies cut snoring for people with a similar profile, by how much, and over how many nights of evidence. That aggregate is the product, and every night a user records makes it better.

**Pillars**

1. **Match SnoreLab on the basics, then beat it on insight.** Recording, score, clips and remedy testing have to be at least as good before anyone cares about the extras.
2. **Your night in context.** A user's own data sits next to their wearable data and next to the community's results, on the same screens.
3. **Crowd-sourced evidence, shown honestly.** Effectiveness figures carry sample sizes and confidence; small samples say "not enough data yet" rather than a number.
4. **Privacy as a feature.** Audio stays on the phone; only derived, de-identified night summaries and remedy logs leave it, with explicit opt-in to contribute to the community dataset.
5. **Monetise the help, not the data.** Subscription for the insight features, affiliate links on remedies the data supports, and no selling of data to anyone.

**Who it is for**

- Snorers who want to stop, usually nudged by a partner, and who have tried one or two things without knowing if they worked.
- People worried about sleep apnoea who want evidence before a GP visit.
- Partners, as the second user in a household and often the one who installs it.

**Working assumptions**

| Decision | Choice | Why |
| --- | --- | --- |
| Platforms | iOS and Android from day one | Snoring skews male 35+, Android-heavy in the UK |
| App framework | Cross-platform UI with native modules for audio capture and Health access | Shared stack with the rest of the roster |
| Backend | Postgres on the existing VPS behind a thin API, nightly aggregation job | Small data volumes per user; the dashboard is a batch product |
| Detection | On-device classifier | Audio never needs to leave the phone |
| Pricing | About £29.99 a year, £3.99 a month, 7-day trial | In line with the category; annual is the default |
| Launch market | UK first, English-speaking markets second | Remedy availability and affiliate programmes differ by country |

## Feature set

Three layers: parity with SnoreLab so the app is a credible replacement, personal insight that SnoreLab cannot give, and the community layer that nobody gives.

**Layer 1 — Parity (must match SnoreLab)**

| Feature | Detail |
| --- | --- |
| Overnight recording | Phone on the bedside table; one tap to start, auto-stop in the morning; works with screen off and in low-power mode |
| Snore detection | On-device classifier marks snore events, intensity (quiet, light, loud, epic) and duration |
| Night score | 0 to 100 intensity score, time snoring as a percentage, loudest episode, trend over 7 and 30 nights |
| Timeline and clips | Intensity graph across the night; tap to hear the loudest moments; save and share clips |
| Remedy and factor logging | Tick what you tried (mouth tape, nasal strips, side pillow, no alcohol, late meal, humidifier, and so on) each night; see your own before and after |
| Full-night recording | Optional, for people who want everything, stored compressed |
| Expert content | Short articles on each remedy, written once and linked from the dashboard |

**Layer 2 — Personal insight (the SnoreLab upgrade)**

| Feature | Detail |
| --- | --- |
| Wearable correlation | Sleep stages, heart rate, HRV, SpO2 and respiratory rate from Apple Health / Health Connect on the same timeline as the snore events |
| Morning summary | Plain-English: "Loud snoring 1:40 to 2:30, oxygen dipped twice during it, heart rate spiked; you'd had alcohol" |
| Remedy experiments | A guided 14-night A/B: 7 nights with, 7 without, randomised order where possible, with a verdict and a confidence level rather than a single number |
| Doctor's report | PDF over 14 to 30 nights: event counts, intensity trend, oxygen-dip frequency, factor comparisons, worded as a screening summary to discuss with a GP |
| Partner mode | Second phone or watch in the same household attributes who snored and who was disturbed |
| Saved snapshots | Lock a 30-night baseline, then compare later periods against it |

**Layer 3 — Community insight (the moat)**

| Feature | Detail |
| --- | --- |
| Remedy effectiveness dashboard | Every remedy ranked by median change in snore score across contributing users, with number of users, number of nights and a confidence band; filterable by profile (age band, BMI band, sleep position, alcohol habits, apnoea symptoms) |
| "People like you" view | The same ranking restricted to users whose profile matches, with the sample size shown and a plain fallback when it is too small |
| Your result vs the crowd | On any remedy you've tested, your personal change against the community distribution |
| Remedy stacks | Which combinations show the best results together (side pillow plus nasal strip, and so on), once the data supports it |
| Trends and new entries | Remedies rising in use, newly added products, what the community is trying this month |
| Contribute toggle | Opt in to share de-identified night summaries and remedy logs; see what you've contributed and withdraw at any time |

**Everyday screens**

1. **Tonight** — start recording, tick tonight's remedies and factors (pre-filled from last night).
2. **This morning** — score, timeline, clips, the summary, and the wearable overlay.
3. **Remedies** — your experiments and the community dashboard, with the shop links on remedies the data supports.
4. **Trends** — 7, 30 and 90 nights, your snapshots, the doctor's report.
5. **Household** — partner mode and shared nights.

## Remedies data and the shared dashboard

The dashboard is only as good as the logging is easy and the statistics are honest. This section is the design for both.

**What gets logged each night**

| Field | Source | Notes |
| --- | --- | --- |
| Night summary | Detection | Snore score, percent time snoring, event count, loudest intensity, duration in bed |
| Wearable summary | Health import, if present | Sleep efficiency, SpO2 minimum and dip count, mean and max heart rate, HRV |
| Remedies used | User, one tap each | From a curated catalogue: devices (nasal strips, dilators, chin straps, mouth tape, mandibular devices, anti-snore pillows, positional trainers, humidifiers), habits (side sleeping, head elevation, nasal rinse, throat exercises), and a free-text "other" that gets reviewed into the catalogue |
| Lifestyle factors | User, one tap each | Alcohol (units band), late meal, caffeine after 2pm, exercise, illness or congestion, smoking, sleeping pills |
| Profile (once, editable) | User | Age band, sex, height and weight bands, usual sleep position, partner-reported breathing pauses, diagnosed apnoea or CPAP use |

Logging happens on the Tonight screen before recording and takes under 10 seconds because last night's ticks are pre-filled. Nights with no log still count as "nothing tried" baselines.

**How effectiveness is computed**

1. **Within-user first.** For each user and remedy, compare nights with the remedy against that user's own baseline nights (same factors where possible, at least 5 nights on each side). This controls for the fact that heavy snorers try more remedies.
2. **Then aggregate.** The community figure for a remedy is the median within-user change in snore score (and percent time snoring), with an interquartile range and the counts behind it: contributing users and nights.
3. **Minimum sample rules.** Below 30 users or 300 nights a remedy shows "early data" with a muted number; below 10 users it shows nothing but "being tested by N people".
4. **Confounders flagged, not hidden.** Alcohol and congestion nights are shown separately; the dashboard says when a remedy's apparent effect disappears once alcohol nights are removed.
5. **Profile slices.** The same calculation per profile segment, with the same minimum-sample rules, powers the "people like you" view.
6. **Recompute nightly** in a batch job; nothing is computed live.

**What the dashboard shows**

- A ranked list of remedies: name, median reduction in snore score, interquartile band drawn as a bar, users and nights, trend arrow, and a tag for whether the result holds after removing alcohol nights.
- Tap a remedy: the distribution of outcomes, the breakdown by profile, the expert article, the user's own result if they have tested it, and the shop link.
- Filters: by profile match ("people like you"), by remedy type, by time window.
- A plain note at the top of every view: these are self-reported, uncontrolled results from app users and not medical evidence.

**Privacy and consent**

- Contribution is opt-in with a clear screen explaining exactly what leaves the phone (night summaries, remedy and factor ticks, profile bands) and what never does (audio, precise location, name).
- Data is pseudonymous: a random contributor id, profile fields in bands only, nights stored without timestamps finer than the date.
- Users can see their contributions and withdraw; withdrawal removes their rows from the next aggregation.
- Aggregates never show segments smaller than 10 users, so no slice can identify a person.
- No sale or licensing of the raw data. Published summaries (blog posts, a public dashboard) use aggregates only.

**Why this is defensible**

- Every night recorded by a contributing user is a data point SnoreLab does not have in a form it shows users. After a year with 5,000 contributing users logging 100 nights each, the dataset is half a million remedy-nights, which is more than any published snoring study, and the "people like you" view improves with every one of them.

## Monetisation

Two lines: a subscription for the insight features, and affiliate commission on the remedies the dashboard points people to. The free tier must be good enough to recruit contributors, because contributors are what make the paid tier worth paying for.

**Free vs paid**

| Free | Paid (annual, 7-day trial) |
| --- | --- |
| Record, detect, score, clips, 7 nights of history | Unlimited history and snapshots |
| Log remedies and factors; your own before and after | Guided 14-night experiments with verdicts |
| Community dashboard, top-level ranking with sample sizes | "People like you" slices, remedy stacks, your result vs the crowd |
| Contribute to the dataset (always free, never gated) | Wearable correlation and the morning summary |
| Expert articles | Doctor's report, partner mode |

Price about £29.99 a year or £3.99 a month. Paywall moments: the first time a user taps a "people like you" slice, the first doctor's report, and the first correlation view after a Health import.

**Affiliate links**

- Each catalogue remedy that is a product carries a "where to buy" link: Amazon Associates for most devices, and direct programmes where the brand has one (mouth tape, anti-snore pillows, nasal dilators, positional trainers). Typical commission is 3 to 10% on physical goods; a £25 pillow pays about £1 to £2.
- Links appear only on remedies with real community data behind them and are ordered by the data, not by commission. The one editorial rule that keeps the dashboard trustworthy.
- Clear labelling: "we may earn a commission" on every link and on the dashboard page; UK ASA and CMA rules require it.
- Expect affiliate to be 10 to 20% of revenue at scale: useful, and a reason to keep the catalogue current, but the subscription is the business.

**What is not for sale**

- The dataset itself. Aggregates can be published for marketing and PR; raw contributions are never licensed, which is a promise the opt-in screen makes.
- Rankings, placement or badges to remedy brands. Sponsorship, if ever, is a labelled banner away from the data.

**Revenue shape**

- At 2,000 installs a month: roughly 60 to 100 new annual subscribers a month, which is £1,500 to £2,500 a month in subscription after the store cut by the end of year one, plus a few hundred in affiliate.
- At 10,000 installs a month the same ratios give a five-figure monthly business; snoring search volume is large enough for that if the dashboard earns press and links.

## Technical architecture

Audio and detection stay on the phone; only summaries sync; the community numbers are computed in a nightly batch on the VPS.

&#91;embedded content: data flow · phone to community dashboard\]

Capture and detection run on the phone and write to the local store; only night summaries and remedy logs sync to Postgres, where a nightly job computes the community aggregates that the app reads back as a snapshot.

**On the phone**

- **Capture:** native audio module (iOS background audio session, Android foreground service), 16 kHz mono, chunked into 30-second windows, screen-off safe, battery target under 8% for an 8-hour night.
- **Detection:** a small on-device classifier over mel spectrograms (start from an open audio-event model fine-tuned on snoring; a spectral heuristic as the fallback). Outputs snore events with intensity; clips kept only around events, everything else discarded on the fly, so a night is a few MB.
- **Health import:** HealthKit and Health Connect read access for sleep, heart rate, HRV, SpO2 and respiratory rate; pulled the next morning and aligned by timestamp.
- **Local store:** SQLite with nights, events, clips, remedy logs, factor logs, profile. The app works fully offline with no account.
- **Shared UI** in the cross-platform framework used by the roster; native modules only for capture, Health and notifications.

**Sync and backend**

- Optional account for cross-device history and contribution. Sync sends night summaries, remedy and factor logs and profile bands; never audio.
- Postgres on the VPS: `users`, `nights`, `remedy_logs`, `factor_logs`, `profiles`, `catalogue`, `aggregates`.
- A thin API (auth, sync, catalogue, aggregates read, report generation) with rate limits.
- Nightly aggregation job: within-user deltas, then community medians and bands per remedy and per profile segment, written to `aggregates` with sample counts; the app reads a cached snapshot.
- PDF report generated server-side from the user's synced summaries (or on device for users without an account).

**Catalogue management**

- Remedies and factors live in a server-side catalogue the app fetches, so new products appear without a release. Free-text "other" entries go to a review queue; a weekly pass promotes recurring ones into the catalogue with an article and a link.

**Performance and reliability**

- Detection latency does not matter; battery and storage do. Measure both on a 2020 mid-range Android and an iPhone 11 every milestone.
- A "recording interrupted" state that explains what happened (call, alarm, battery saver) and how to avoid it, since this is the top complaint in every snoring app's reviews.
- Aggregation job idempotent and re-runnable; a bad night of data can be excluded and the numbers rebuilt.

## Compliance

Four areas, each with a rule that keeps the app on the right side of the line without weakening the product.

**Medical-device boundary**

- The app measures snoring and shows patterns; it never diagnoses or claims to detect sleep apnoea. Wording everywhere: "screening summary", "patterns to discuss with your doctor", "self-reported community results". Claiming detection or diagnosis makes it a medical device under MHRA (UK MDR) and FDA rules with a regulatory process the roster cannot afford.
- The doctor's report carries a header stating it is a consumer app summary, not a clinical test.
- No treatment recommendations in the app's own voice; the dashboard reports what users tried and what happened. Expert articles are general information with a "see a GP if" line.

**Health data**

- HealthKit and Health Connect data stays on device unless the user turns on sync, and is then stored under UK GDPR as special-category data: explicit consent, a stated purpose, a retention period, and deletion on request.
- No third-party analytics SDK ever receives health values; analytics events are counts and flags only.
- Apple's rules forbid using HealthKit data for advertising or selling it; design the affiliate layer so it uses the community aggregate, never an individual's Health data.
- A privacy policy written for a human, linked from the opt-in screen, plus the App Store privacy labels and Play data-safety form filled to match.

**Community dataset ethics**

- Opt-in, pseudonymous, bands not values, minimum segment size of 10, withdrawal honoured at the next aggregation, no raw data licensing. Say all of this on the contribution screen in plain words.
- Present effect sizes with sample counts and uncertainty; never a single confident number from a small sample.
- A short methods page on the website so journalists and clinicians can see how the numbers are made; this is also what makes the data quotable.

**Affiliate and advertising rules**

- Every affiliate link labelled as such, with a disclosure on the dashboard page, per UK ASA and CMA guidance on commercial content.
- Remedy ordering driven by the data; no paid placement. If brand sponsorship is ever taken, it is a labelled banner separate from the ranking.
- Amazon Associates requires its own disclosure wording and prohibits showing prices that are not pulled live; link out rather than display prices.

**Store review**

- Background audio must have a visible, honest purpose (recording while you sleep); Apple rejects apps that keep the mic on without clear user benefit.
- Account deletion in-app, Sign in with Apple if any third-party sign-in is offered, and a working demo path for reviewers that includes a sample night so they can see the morning screen without sleeping.

## Development phases

Five phases over about 16 weeks of part-time work. Parity ships first because nobody contributes remedy data to an app that records badly; the community dashboard launches with the app but only shows numbers once the sample rules are met.

&#91;embedded content: roadmap · 5 phases, a gate on each\]

Each diamond is a gate the next phase waits on; the community layer is the one that decides whether the app is a SnoreLab alternative or something new.

**Phase 0 — Foundations (weeks 1 to 2)**

- Project on the shared roster stack; native audio capture module on both platforms; a 30-night test dataset recorded on your own phone.
- Catalogue of remedies and factors drafted (about 40 entries) with one-paragraph articles.
- *Gate:* an 8-hour recording completes on both platforms with the screen off and under 8% battery.

**Phase 1 — Parity (weeks 3 to 6)**

- Detection, score, timeline, clips, remedy and factor logging, 7-night history, Tonight and This Morning screens.
- Internal test with 5 snorers for 2 weeks; compare scores against SnoreLab on the same nights.
- *Gate:* detection agrees with manual labelling on 85% of events across the test set, and testers say the morning screen tells them something SnoreLab did not.

**Phase 2 — Personal insight (weeks 7 to 10)**

- Health import and correlation timeline, morning summary, 14-night experiments, doctor's report PDF, paywall and subscription.
- *Gate:* 20 testers; at least half import Health data; the report is reviewed by one GP or sleep clinician for wording.

**Phase 3 — Community layer (weeks 11 to 14)**

- Accounts and sync, contribution opt-in flow, nightly aggregation job, dashboard screens with sample-size rules, "people like you", affiliate links on catalogue items, methods page on the site.
- Closed beta of 100 via Reddit and sleep communities, with contribution on by default for beta testers who agree.
- *Gate:* 60% of beta users opt in; at least 5 remedies cross the 30-user threshold; dashboard numbers survive a sanity check against the published literature (side sleeping and alcohol should point the expected way).

**Phase 4 — Launch (weeks 15 to 16)**

- Store listings, screenshots that lead with the dashboard, site pages for the top snoring and apnoea questions, press note built on the first community findings, partner mode held for the first update after launch.
- *Gate:* zero crashes across the device matrix; a reviewer demo path works end to end.

**After launch**

- Monthly: catalogue review, a published "what the data says" post, one new slice or remedy stack as the sample grows. Partner mode in month 2. Localisation and non-UK affiliate programmes once UK numbers justify it.

## Marketing and launch

The community dashboard is the marketing. A public, methods-backed answer to "what actually stops snoring" is something journalists, forums and search engines all want, and it exists nowhere else.

**Store search (the main channel)**

- Title and subtitle carry "snoring", "snore recorder", "sleep apnoea"; screenshots lead with the dashboard and the morning summary, not the recording screen everyone has seen.
- Review prompt after the first morning summary; respond to every review in the first three months.
- Localise the listing for the US, Australia and Canada early even if affiliate programmes come later.

**The dashboard as a public asset**

- A website version of the community dashboard, updated monthly, with the methods page beside it. Pages per remedy ("does mouth tape stop snoring: what 2,000 nights say") answer exactly the questions people type into Google and into AI assistants, and they link to the app.
- A quarterly "state of snoring" post with two or three findings, sent to health and sleep journalists; a data story gets covered where a product launch doesn't.

**Communities and partners**

- r/sleepapnea, r/snoring and CPAP forums as a participant, with the methods page as the credibility.
- GPs and sleep clinics see the brand on every doctor's report; a one-page leaflet for clinics that want patients to bring data.
- Remedy brands whose products rank well will want to share the result; let them, with the disclosure, and take the affiliate link.
- Partner-facing content ("how to get your partner to try it") because the partner is often the buyer.

**Launch sequence**

1. Closed beta findings become the first press note and the first site pages.
2. Launch on both stores in the same week with a Product Hunt post and the Reddit communities.
3. First monthly data post four weeks later, when the sample has grown enough for new slices to appear.

**What to skip**

- Paid installs, influencer deals and daily social posting. A monthly data post and reactive community participation are enough; everything else is store search.

## Metrics, risks and open decisions

**Metrics that matter**

| Metric | Target at 90 days after launch | Why it matters |
| --- | --- | --- |
| Installs a month (organic) | 1,500+ | Snoring search volume supports it if the listing converts |
| Second-night recording rate | 60%+ | The first night is curiosity; the second is a habit |
| Contribution opt-in | 50%+ of active users | The dataset is the moat |
| Nights logged with at least one remedy or factor | 40%+ | Logging is what makes the dashboard real |
| Trial start / trial to paid | 15% / 30% | Standard health-app funnel |
| Day-30 retention | 20%+ | People stop once they've found a remedy; that's fine if they've paid annually |
| Remedies past the 30-user threshold | 10 by month 3, 25 by month 6 | The dashboard's usefulness in one number |
| Affiliate click-through on remedy pages | 8%+ | Confirms the links are placed where intent is |

**Risks**

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Detection is worse than SnoreLab's and reviews say so | Medium | Phase 1 gate against labelled nights; ship parity only when it holds |
| Too few contributors for the dashboard to show anything at launch | High at launch | Beta contributions seed it; honest "early data" states; publish the first findings as soon as 5 remedies qualify |
| Users log remedies inconsistently | Medium | Pre-filled ticks, one-tap logging, nothing-tried baselines, gentle morning prompt |
| Self-reported data draws criticism | Medium | Methods page, uncertainty shown, within-user design; never overclaim in press |
| SnoreLab adds a community dashboard | Low to medium | The dataset compounds; being first with a public, cited dashboard is the defence |
| Medical-device wording drifts under marketing pressure | Medium | A one-page wording guide; every store listing and press note checked against it |
| Background recording breaks on an OS update | High over time | Device matrix tests each OS beta; a clear interrupted-recording state |
| Affiliate links undermine trust | Low if labelled | Data-ordered, disclosed, no paid placement |

**Open decisions**

- [ ] Name (Nightwatch is a placeholder; check store and domain availability).
- [ ] Detection model: fine-tune an open audio model or start with the heuristic and collect labels first?
- [ ] Account-free contribution (device-keyed) or require an account to contribute?
- [ ] Launch with the dashboard visible to free users (recruits contributors) or paid-only (drives conversion)? Current plan: top level free, slices paid.
- [ ] Which clinician reviews the report wording, and whether to pay for an hour of their time.
- [ ] Partner mode at launch or in the first update?
- [ ] Amazon Associates only, or add direct brand programmes from day one?

# Development spec

Everything below is written so that a developer, or a coding agent, can build Phases 0 to 2 (foundations, parity, personal insight) without asking what was meant. Phase 3's community layer is specified at the data and algorithm level; its screens follow the same patterns.

**Conventions**

- Units: snore score 0 to 100; intensity in dB SPL relative to the phone's calibrated floor; times in UTC on the wire, local in the UI; nights keyed by the local calendar date the recording started.
- Every screen has four states to design and test: empty, loading, normal, error. Recording screens add interrupted.
- Copy is sentence case, no exclamation marks, no medical claims (see Compliance). Every piece of copy in this spec is final unless marked draft.
- Identifiers: `uuid v4` for everything; a `contributor_id` is a separate random uuid never linked to `user_id` in the aggregates store.
- Paid features show a lock glyph and open the paywall sheet on tap; the free tier never shows a blank space where a paid feature would be.

## Screen map

Five tabs plus three flows that sit on top of them.

| Tab | Purpose | Entry points |
| --- | --- | --- |
| Tonight | Start and stop recording; log tonight's remedies and factors | Default tab in the evening (after 6pm local) |
| This Morning | Last night's score, timeline, clips, summary, wearable overlay | Default tab before 2pm if a night exists |
| Remedies | Your experiments and the community dashboard; shop links | Tab bar; deep link from summary and from articles |
| Trends | 7, 30, 90-night charts, snapshots, doctor's report | Tab bar; deep link from summary |
| Household | Partner mode, shared nights | Tab bar (hidden until Phase 3 ships; Phase 1 shows a "coming soon" card in Settings) |

| Flow | Purpose | Trigger |
| --- | --- | --- |
| Onboarding | Permissions (mic, notifications, Health), profile bands, contribution opt-in | First launch; re-entered from Settings |
| Paywall | Trial start and plan choice | First lock tap; first doctor's report; first "people like you" slice |
| Settings | Account, data and contribution, export, delete, support, legal | Gear icon on every tab |

**Navigation rules**

- Tab bar always visible except during recording, where the whole screen is the recording view and the tab bar is hidden to avoid accidental taps.
- The app chooses the landing tab by time of day and whether last night exists; the user can override in Settings.
- Back always returns to the tab, never into a modal stack deeper than two.

## Screens

### Onboarding (first launch)

1. **Welcome.** One sentence: "Record your snoring, see what changes it, and compare with thousands of other snorers." Button: Get started.
2. **Microphone.** Why we need it ("to hear snoring while you sleep; audio stays on this phone"). System prompt follows. Denied state: an explanation screen with a button to Settings; the app is unusable without it, so this screen cannot be skipped.
3. **Notifications.** Optional; used for the morning summary and the bedtime nudge. Skippable.
4. **About you.** Age band (18-29, 30-39, 40-49, 50-59, 60+), sex (optional), height and weight as bands (or exact, converted to bands locally and never synced), usual sleep position, "has anyone said you stop breathing at night?" (yes / no / not sure), diagnosed sleep apnoea or CPAP (yes / no). Skippable; a banner on Remedies asks again until completed because "people like you" needs it.
5. **Health.** Explains the overlay; system permission for sleep, heart rate, HRV, SpO2, respiratory rate. Skippable; re-prompted after the third night.
6. **Contribute.** The opt-in screen (wording in the operational checklist). Default off; a single toggle; "you can change this any time in Settings".
7. Lands on Tonight.

### Tonight

- **Header:** date, gear icon.
- **Remedies strip:** horizontally scrolling chips from the catalogue, pre-selected from last night; tap toggles; last chip is "+ Add" which opens a searchable sheet of the full catalogue with an "Other" free-text option.
- **Factors strip:** same pattern (alcohol with a units band picker, late meal, caffeine after 2pm, exercise, congestion or cold, smoking, sleep aid).
- **Primary button:** Start recording (full width, bottom). Secondary text: "Place the phone on the bedside table, screen down is fine."
- **Tips card:** one rotating tip (charger plugged in, Do Not Disturb, airplane mode is fine).
- States: empty (first use: chips are the top 8 remedies and factors, none selected); normal; recording (replaced by the Recording view).

### Recording view

- Full screen, dark, tab bar hidden. Large elapsed time, a quiet live level meter (last 60 seconds), battery estimate, a Stop button that requires a 1-second hold.
- Keeps the screen off after 20 seconds; tapping wakes it.
- **Interrupted state:** if the OS kills the session (call, battery saver, memory), the next launch shows "Recording stopped at 03:12" with the probable cause and a "How to prevent this" link; the partial night is kept and marked partial.
- On stop: a 2-second "analysing" state, then This Morning.

### This Morning

- **Score card:** snore score as a big number with a label (Quiet 0-20, Light 21-40, Moderate 41-60, Loud 61-80, Epic 81-100), time snoring as a percentage, time in bed, loudest intensity. Arrow versus the 7-night average.
- **Timeline:** intensity across the night as a bar chart in 5-minute bins; tap a bin to hear its loudest clip; wearable overlay toggles (sleep stages as a band under the chart, SpO2 and heart rate as thin lines) — locked on free.
- **Clips:** the five loudest moments with play, save, share; share produces an audio file and a card image.
- **Summary card:** two to four sentences generated from a template (rules in the scoring section), for example "You snored for 38% of the night, mostly between 1:40 and 2:30. Oxygen dipped twice during the loudest stretch. You logged alcohol; your alcohol nights average 22 points higher." Locked on free beyond the first sentence.
- **Last night's log:** the remedies and factors ticked, editable until noon.
- **Prompt (first morning only):** "Was this your typical night?" yes / no, used to flag outliers.
- States: no night yet (illustration plus "Start tonight"); partial night (banner); normal.

### Remedies

- **Segmented control:** Mine / Everyone.
- **Mine:** each remedy you've logged with nights-with vs nights-without averages, a sparkline, and the experiment status (none, running day 6 of 14, verdict). Start experiment button opens a sheet explaining the 14-night pattern.
- **Everyone (community dashboard):** ranked list; each row is name, median change in score (negative is good, shown green), an interquartile band bar, users and nights, a "holds without alcohol" tick, and a shop glyph if a link exists. Filter chips: People like you (locked on free), Devices, Habits, Last 90 days. Header note: "Self-reported results from app users, not medical evidence. How we calculate this."
- **Remedy detail:** distribution chart, profile breakdown, your result vs the crowd, the article, the "where to buy" button with the disclosure line.
- States: Everyone with no qualified remedies yet ("Early days: 212 people are testing 14 remedies; results appear when 30 people have tried one"); normal.

### Trends

- Range picker 7 / 30 / 90; score line chart with the 7-night moving average; percent-time-snoring as a second series toggle.
- Snapshot list (name, date range, average); Save snapshot button (locked on free).
- Doctor's report card: date range picker and Generate (locked on free; first one opens the paywall).

### Household (Phase 3)

- Pair a partner by QR; shared nights show two timelines; attribution label per event (You / Partner / Unsure).

### Paywall sheet

- Title: "See what actually helps". Three bullets: wearable overlay and morning summary; people-like-you results and experiments; doctor's report and unlimited history. Plan toggle: Yearly £29.99 (badge: 7 days free, then £2.50 a month) / Monthly £3.99. Primary: Start free trial. Small: Restore purchases, Terms, Privacy. The sheet is dismissable; nothing is lost by dismissing it.

### Settings

- Account (sign in, sign out, delete account), Data (contribution toggle with a "what we share" page, export my data as CSV and JSON, delete all local data), Recording (sensitivity, keep full-night audio, storage used), Notifications, Landing tab, Support, Legal.

## Data model

Two stores: SQLite on the phone (the source of truth for a user's own data) and Postgres on the server (accounts, synced summaries, catalogue, aggregates). Audio and clips exist only in the phone's file system.

### Local (SQLite)

| Table | Columns | Notes |
| --- | --- | --- |
| `night` | `id` uuid, `date` text (local yyyy-mm-dd), `started_at` int (epoch s), `ended_at` int, `duration_s` int, `score` int, `pct_snoring` real, `event_count` int, `max_db` real, `partial` bool, `typical` bool nullable, `summary_text` text, `synced_at` int nullable | One row per recording; a second recording on the same date gets `date` plus a suffix and is merged in the UI |
| `event` | `id` uuid, `night_id` uuid, `start_s` int (offset from night start), `end_s` int, `peak_db` real, `mean_db` real, `intensity` text (quiet, light, loud, epic), `clip_path` text nullable | A contiguous snoring episode; clips kept for the top 5 by `peak_db` plus any the user saves |
| `bin` | `night_id` uuid, `index` int (5-minute bins), `mean_db` real, `max_db` real, `snore_s` int | Drives the timeline; 96 rows per 8-hour night |
| `health_sample` | `night_id` uuid, `kind` text (sleep\_stage, hr, hrv, spo2, resp), `start_s` int, `end_s` int, `value` real, `stage` text nullable | Imported from Health; never synced raw, only the per-night summary below |
| `health_summary` | `night_id` uuid, `sleep_efficiency` real, `spo2_min` real, `spo2_dips` int (count below 90% for 10 s or more), `hr_mean` real, `hr_max` real, `hrv_mean` real, `resp_mean` real | Computed on import |
| `remedy_log` | `night_id` uuid, `remedy_id` text | One row per ticked remedy |
| `factor_log` | `night_id` uuid, `factor_id` text, `value` text nullable | Value carries bands such as alcohol units |
| `experiment` | `id` uuid, `remedy_id` text, `started` text, `pattern` text (json of with/without by day), `status` text, `verdict` text nullable | 14-night A/B |
| `snapshot` | `id` uuid, `name` text, `from` text, `to` text, `avg_score` real | Paid |
| `profile` | single row: `age_band`, `sex`, `height_band`, `weight_band`, `bmi_band`, `position`, `pauses_reported`, `apnoea_dx`, `cpap` | Bands only |
| `catalogue` | `id` text, `type` text (remedy, factor), `category` text, `name` text, `article_md` text, `link_url` text nullable, `active` bool, `version` int | Cached from the server |
| `settings` | key-value | Sensitivity, keep-full-night, landing tab, contribution flag |

### Server (Postgres)

| Table | Columns | Notes |
| --- | --- | --- |
| `user` | `id`, `auth_provider`, `auth_subject`, `email` nullable, `created_at`, `deleted_at` | Apple, Google, email magic link |
| `device` | `id`, `user_id`, `platform`, `app_version`, `last_seen` |  |
| `subscription` | `user_id`, `provider` (revenuecat), `status`, `plan`, `expires_at` | Mirrored from the subscription provider webhook |
| `night_summary` | `id`, `user_id`, `date`, `duration_s`, `score`, `pct_snoring`, `event_count`, `max_db`, `partial`, `typical`, plus the `health_summary` columns nullable | Synced from the phone; one row per night |
| `remedy_log`, `factor_log` | as local, keyed by `night_summary.id` |  |
| `profile` | `user_id` plus the band columns |  |
| `contribution` | `user_id`, `contributor_id` (random uuid), `opted_in_at`, `withdrawn_at` nullable | The only link between a user and their contributor id; the aggregation job reads contributor ids only |
| `catalogue` | as local plus `created_at`, `review_notes` | The app fetches rows with `version` greater than its cache |
| `catalogue_suggestion` | `id`, `contributor_id`, `text`, `count`, `status` | Free-text "other" entries awaiting review |
| `aggregate` | `remedy_id`, `segment` text (all, or a profile slice key), `window` text (all, 90d), `users` int, `nights` int, `median_delta` real, `p25` real, `p75` real, `holds_without_alcohol` bool, `computed_at` | Rebuilt nightly; the app reads a JSON snapshot of this table |
| `report` | `id`, `user_id`, `from`, `to`, `pdf_path`, `created_at` | Doctor's reports; deleted after 30 days |

### Sync payload

- The phone sends a batch of `night_summary` rows (with embedded `remedy_log`, `factor_log` and `health_summary`) for nights whose `synced_at` is null or older than `updated_at`. Server replies with the ids accepted. Idempotent by `night.id`.
- Profile and settings sync as whole documents with a version number; last write wins.
- Nothing in the payload identifies the device beyond `device.id`; no audio, no raw Health samples, no timestamps finer than minutes.

## API contract

REST over HTTPS, JSON, bearer token from the auth provider exchanged for an app session token. Base path `/v1`. All timestamps ISO 8601 UTC. Errors return `{ "error": { "code": "string", "message": "string" } }`.

| Method and path | Purpose | Request | Response |
| --- | --- | --- | --- |
| `POST /auth/exchange` | Swap an Apple, Google or magic-link token for a session | `{ provider, token }` | `{ session_token, user_id, expires_at }` |
| `DELETE /account` | Delete account and all server data; contribution rows are retired at the next aggregation | — | `204` |
| `GET /catalogue?since=<version>` | Fetch catalogue rows newer than the cached version | — | `{ version, items: [ { id, type, category, name, article_md, link_url, active } ] }` |
| `POST /catalogue/suggest` | Submit a free-text "other" remedy | `{ text }` | `202` |
| `POST /sync/nights` | Upsert night summaries | `{ nights: [ { id, date, duration_s, score, pct_snoring, event_count, max_db, partial, typical, health: { … } or null, remedies: [id], factors: [ { id, value } ] } ] }` | `{ accepted: [id], rejected: [ { id, reason } ] }` |
| `GET /sync/nights?since=<iso>` | Pull nights for a second device | — | Same shape as the request above |
| `PUT /profile` | Replace profile bands | `{ version, age_band, sex, height_band, weight_band, position, pauses_reported, apnoea_dx, cpap }` | `{ version }` |
| `PUT /contribution` | Opt in or out | `{ opted_in: bool }` | `{ opted_in, contributor_id_exists: bool }` |
| `GET /contribution/summary` | What the user has contributed | — | `{ nights, remedies_logged, since }` |
| \`GET /aggregates?segment=\<key>&window=\<all | 90d>\` | Community dashboard snapshot | — |
| `GET /aggregates/<remedy_id>` | Remedy detail | — | `{ distribution: [ { bucket, count } ], by_segment: [ … ], article_md, link_url }` |
| `POST /reports` | Generate a doctor's report | `{ from, to }` | `{ report_id, url, expires_at }` |
| `POST /subscription/webhook` | Subscription provider events | Provider payload | `200` |

**Rules**

- Segment keys are built client-side from the profile (`age:40-49|bmi:25-30|position:back`) and the server returns `hidden` for any segment under 10 users. The free tier may only request `segment=all`.
- Aggregates are cached for 24 hours with an ETag; the app sends `If-None-Match`.
- Rate limits: sync 60 requests an hour per device; aggregates 120 an hour; reports 5 a day.
- Report PDFs are served from signed URLs that expire in 24 hours.

## Scoring and detection

### Definitions

- **Frame:** 1 second of audio at 16 kHz mono. **Window:** 30 seconds, 30 frames.
- **Snore frame:** a frame the classifier labels as snoring with probability at or above 0.6 (user sensitivity setting shifts this to 0.5 or 0.7).
- **Event:** a run of snore frames allowing gaps of up to 5 seconds, lasting at least 10 seconds. Events separated by less than 20 seconds merge.
- **Intensity of a frame:** A-weighted RMS level in dB relative to the night's noise floor (the 5th percentile of frame levels over the night). Reported as `dB above floor`; no absolute SPL claims.
- **Intensity labels:** quiet 0 to 10 dB above floor, light 10 to 20, loud 20 to 30, epic 30 and above. An event's label uses its peak.
- **Time in bed:** from Start to Stop, minus any interrupted gap.
- **Percent time snoring:** total event seconds divided by time in bed.

### Snore score (0 to 100)

`score = clamp( 0.6 × pct_component + 0.4 × loudness_component, 0, 100 )`

- `pct_component = 100 × min(pct_snoring / 0.5, 1)` (50% of the night snoring saturates this part).
- `loudness_component = 100 × min(mean_event_db / 30, 1)` where `mean_event_db` is the event-duration-weighted mean of event mean levels above floor.
- Labels: Quiet 0-20, Light 21-40, Moderate 41-60, Loud 61-80, Epic 81-100.
- A partial night under 3 hours in bed gets a score but is excluded from averages, trends, experiments and contribution.

This formula is a starting point and is versioned (`score_version` stored with each night). When the formula changes, old nights are recomputed from stored `bin` and `event` rows, never from audio.

### Timeline bins

- 5-minute bins; each stores mean and max level above floor and snore seconds. The chart draws snore seconds as bar height and colours by max intensity label.

### Summary text rules (template, no LLM at runtime)

1. Sentence 1 always: percent time snoring and the longest stretch ("mostly between 1:40 and 2:30" if one stretch holds 40% or more of events, else "spread across the night").
2. Sentence 2 if Health data exists: SpO2 dips during loud events, or heart-rate spikes within 60 seconds of epic events, else "Your watch data showed no oxygen dips."
3. Sentence 3 if any factor logged has at least 5 nights on each side: the factor with the largest absolute difference versus the user's average.
4. Sentence 4 if a remedy was logged: that remedy's running with/without difference, or "Night 3 of your mouth tape test."

### Detection approach

- **v0 (Phase 0, for the test set):** energy-and-periodicity heuristic: a frame is snore-like if its level is 8 dB or more above floor, its spectral centroid is under 1.5 kHz, and the envelope shows periodicity between 0.2 and 1.0 Hz across the surrounding 10 seconds. Good enough to label candidate regions for human review, not for release.
- **v1 (Phase 1, for release):** a small convolutional classifier over 64-band log-mel spectrograms of 1-second frames, exported to Core ML and TensorFlow Lite. Start from an open audio-event model (YAMNet-class) fine-tuned on the labelled set below; target under 2 MB and under 5 ms per frame on a 2020 mid-range Android.
- Non-snore classes the model must reject explicitly: speech, coughing, traffic, fan and air-conditioning noise, a partner's snoring at a distance (lower level, treated as snore at reduced confidence and flagged for partner mode later), pets, rain.

### Labelled test set and the 85% gate

- Collect 30 full nights from 5 to 8 volunteers (consented, recordings deleted after labelling). Run v0 to propose regions; a human confirms or corrects each region in a simple labelling tool, producing per-second labels.
- Split: 20 nights train, 10 nights held out, no volunteer in both.
- Metrics on the held-out nights: frame-level F1 for the snore class, and event-level agreement (an event counts as matched if it overlaps a labelled event by 50% or more). The Phase 1 gate is event-level agreement of 85% or more and frame-level F1 of 0.80 or more.
- Keep the held-out set fixed across releases so numbers are comparable; add new volunteers to training only.

### Battery and storage budget

- Under 8% battery over 8 hours on the test devices; audio processed in 30-second windows and discarded; clips kept as 48 kbps Opus, up to 10 per night, so a night costs under 5 MB.

## Aggregation algorithm

Runs nightly at 04:00 UTC as one job; idempotent; writes a fresh `aggregate` table and swaps it in. Input is every synced `night_summary` from opted-in contributors, read by `contributor_id` only.

### Step 1 — Eligible nights

- Exclude partial nights, nights under 3 hours in bed, and nights flagged `typical = false`.
- Exclude a contributor's first 2 nights (first-use effect).
- Exclude nights from contributors with fewer than 7 eligible nights in total.

### Step 2 — Within-user delta per remedy

For each contributor and each remedy R they have logged:

1. `with` = eligible nights where R was logged. `without` = eligible nights where R was not logged and no other remedy introduced in the same 14-day window was logged (so a stack of three new remedies does not credit one of them).
2. Require at least 5 nights on each side; otherwise skip this contributor for R.
3. Prefer matched comparisons: pair each `with` night to the nearest-in-time `without` night with the same alcohol band and congestion flag; if fewer than 5 pairs exist, fall back to the unmatched sets and mark the delta `unmatched`.
4. `delta_score = median(with.score) − median(without.score)`; same for `pct_snoring`.
5. Record `{ contributor_id, remedy_id, delta_score, delta_pct, nights_with, nights_without, matched: bool, segment_key }` where `segment_key` is built from the contributor's profile bands.

### Step 3 — Community aggregation

For each remedy, for segment `all` and for each profile slice present:

1. Collect the per-contributor deltas (one row per contributor, so heavy users do not dominate).
2. `users` = count; `nights` = sum of `nights_with`.
3. `median_delta`, `p25`, `p75` over the deltas.
4. `holds_without_alcohol` = recompute `median_delta` using only matched deltas; true if its sign matches and its magnitude is at least half of the unmatched figure.
5. Status: `ok` if `users >= 30` and `nights >= 300`; `early` if `users >= 10`; `hidden` otherwise. Slices under 10 users are never written.
6. Repeat for window `90d` using only deltas whose `with` nights fall in the last 90 days.

### Step 4 — Remedy stacks (Phase 3, later)

- For pairs of remedies logged together on at least 5 nights by a contributor, compute the delta of the pair versus nights with neither; aggregate as above; show only pairs with status `ok`.

### Step 5 — Publish

- Write all rows to `aggregate_next`, then rename to `aggregate` in one transaction. Record `computed_at`, row counts and the number of contributors included in a job log.
- Build the JSON snapshot the app fetches and set the ETag.

### Withdrawal and deletion

- A contributor who opts out or deletes their account has their `contributor_id` added to an exclusion list read at Step 1; their rows disappear at the next run. Synced summaries are deleted at account deletion.

### Edge cases

- A remedy logged every single night: no `without` nights, so no delta; the Remedies tab tells the user to try nights without it to get a result.
- A remedy with only `unmatched` deltas: shown with the `holds_without_alcohol` tick absent and a note.
- Score formula version change: the job recomputes from stored per-night figures only; deltas are always computed within one `score_version`, and nights from older versions are rescored before the job runs.
- Clock changes and travel: nights are keyed by local date at start; a contributor with two nights on one date keeps both, and the job treats them as separate nights.

### Sanity checks the job asserts before publishing

- Alcohol (as a factor) must show a positive median delta on score in `all`; side sleeping must show a negative one. If either fails with status `ok`, the job publishes nothing and alerts, because something upstream is broken.

## Catalogue (initial)

Forty-two entries at launch. `id` is stable and never reused; `link` says whether a shop link applies (product remedies only). Articles are 150 to 250 words each, written once, with a "see a GP if" line where relevant.

### Remedies — devices and products (shop links)

| id | Name | Category |
| --- | --- | --- |
| `nasal_strips` | Nasal strips | Nasal |
| `nasal_dilator` | Internal nasal dilator | Nasal |
| `nasal_spray_saline` | Saline nasal spray | Nasal |
| `nasal_spray_decongestant` | Decongestant spray (short-term) | Nasal |
| `mouth_tape` | Mouth tape | Mouth and jaw |
| `chin_strap` | Chin strap | Mouth and jaw |
| `mad_device` | Mandibular advancement device | Mouth and jaw |
| `tongue_retainer` | Tongue retaining device | Mouth and jaw |
| `anti_snore_pillow` | Anti-snore pillow | Position |
| `wedge_pillow` | Wedge pillow (head elevation) | Position |
| `positional_trainer` | Positional trainer (vibrating) | Position |
| `tennis_ball` | Tennis ball or backpack method | Position |
| `humidifier` | Bedroom humidifier | Environment |
| `air_purifier` | Air purifier | Environment |
| `throat_spray` | Throat spray | Throat |
| `cpap` | CPAP (prescribed) | Medical |

### Remedies — habits (no shop links)

| id | Name | Category |
| --- | --- | --- |
| `side_sleeping` | Slept on side | Position |
| `head_elevated` | Head elevated (bed or extra pillow) | Position |
| `nasal_rinse` | Nasal rinse (neti pot) | Nasal |
| `throat_exercises` | Throat and tongue exercises | Throat |
| `singing_didgeridoo` | Singing or wind instrument practice | Throat |
| `no_alcohol_evening` | No alcohol after 6pm | Lifestyle |
| `early_dinner` | Finished eating 3 hours before bed | Lifestyle |
| `weight_programme` | On a weight-loss programme | Lifestyle |
| `steam_shower` | Hot shower or steam before bed | Environment |
| `window_open` | Window open or cooler room | Environment |
| `allergen_bedding` | Anti-allergen bedding | Environment |

### Factors (lifestyle, logged separately; never ranked as remedies)

| id | Name | Value |
| --- | --- | --- |
| `alcohol` | Alcohol | Units band: 1-2, 3-4, 5+ |
| `late_meal` | Ate within 2 hours of bed | — |
| `caffeine_late` | Caffeine after 2pm | — |
| `exercise` | Exercised today | — |
| `congestion` | Blocked nose or cold | — |
| `allergies` | Allergy symptoms today | — |
| `smoking` | Smoked today | — |
| `sleep_aid` | Took a sleep aid or sedative | — |
| `very_tired` | Unusually tired | — |
| `stress` | Stressful day | — |
| `travel` | Away from home | — |
| `partner_absent` | Slept alone | — |
| `late_bedtime` | Bed after 1am | — |
| `nap` | Napped today | — |
| `illness` | Unwell (other than a cold) | — |

**Review queue rule:** a free-text "other" entry that appears from 20 different contributors in a month is promoted to the catalogue with an article and, if it is a product, a link. Promoted entries get a new `id`; prior free-text logs are mapped to it by a one-off migration.

## Acceptance criteria, analytics and operations

### Acceptance criteria by phase

**Phase 0**

- [ ] An 8-hour recording completes on iPhone 11 and a 2020 mid-range Android with the screen off, Do Not Disturb on, under 8% battery, and produces a `night` with 96 bins.
- [ ] A phone call during recording produces the interrupted state with the correct stop time and a partial night.
- [ ] CI builds both platforms from a clean checkout and runs the unit tests for scoring on a fixture night.
- [ ] Catalogue of 42 entries loads from the server and renders in the Tonight chips.

**Phase 1**

- [ ] Event-level agreement of 85% or more and frame F1 of 0.80 or more on the held-out nights.
- [ ] Scoring unit tests: fixture nights for each label band produce the expected score within 1 point; a partial night is excluded from averages.
- [ ] This Morning renders in under 500 ms for a night with 300 events; clips play within 300 ms of tap.
- [ ] Remedy and factor ticks persist, pre-fill the next night, and remain editable until noon.
- [ ] Five testers record 10 nights each; at least four say the morning screen told them something new, recorded in the test log.

**Phase 2**

- [ ] Health import aligns samples to the night within 60 seconds and produces a `health_summary`; a night with no Health data renders with the overlay hidden and no errors.
- [ ] Summary text follows the template rules exactly for 20 fixture nights (snapshot tests).
- [ ] A 14-night experiment produces a verdict with the correct with/without medians on a fixture sequence, and "not enough nights" when a side has fewer than 5.
- [ ] Doctor's report PDF renders with the compliance header, date range, counts, trend chart and factor table; a clinician has reviewed the wording.
- [ ] Paywall: trial starts, subscription status mirrors to the server within 5 minutes, locked features unlock, restore purchases works on a second device.

**Phase 3**

- [ ] Opt-in creates a `contributor_id` unlinked in the aggregates store; opt-out excludes rows at the next run; account deletion removes synced data.
- [ ] The aggregation job runs on a seeded dataset of 500 contributors and matches a reference implementation's medians to 0.1; segments under 10 users are absent from output.
- [ ] Dashboard shows `early` and `hidden` states correctly; the free tier cannot request a profile segment.
- [ ] Affiliate links open with the disclosure line visible; link ordering matches `median_delta`.
- [ ] Sanity assertions (alcohol positive, side sleeping negative) pass on the beta data.

### Analytics events (10, no health values)

`app_open`, `onboarding_complete` (with permission flags), `recording_start`, `recording_complete` (duration band, partial flag), `morning_viewed`, `log_saved` (count of remedies, count of factors), `contribution_toggled` (on/off), `paywall_shown` (trigger), `trial_started`, `subscription_converted`.

### Operational checklist

- [ ] Environments: local, staging (separate database and subscription sandbox), production; secrets in the host's secret store, never in the repo.
- [ ] CI: lint, unit tests, scoring fixtures, a build per platform on every merge; release builds signed from CI with the keystore and certificates backed up off the laptop.
- [ ] Monitoring: crash reporting, API error rate alert, aggregation job success alert, nightly backup of Postgres with a tested restore.
- [ ] Store readiness: Family Controls not needed; background audio justification text ready for review; privacy labels and data-safety form; a reviewer demo account seeded with 14 nights.
- [ ] Legal: privacy policy, terms, affiliate disclosure page, methods page, the "what we share" page.

### Store listing copy (draft)

- **Title:** Nightwatch: Snore Recorder
- **Subtitle:** Track snoring. See what helps.
- **Short description:** Record your snoring, compare nights with your watch's data, and see which remedies worked for thousands of other snorers.

### Contribution opt-in wording (final)

> **Help find out what actually stops snoring.** If you turn this on, we'll add a summary of each night (your snore score, how long you snored, and which remedies and factors you ticked) to a shared, anonymous dataset. We never share your recordings, your name, or exact measurements like your weight; only broad bands. You can see what you've contributed and turn this off at any time in Settings, and we never sell this data.

### Reviewer notes (draft)

> Nightwatch records audio only while the user has started a recording session from the Tonight tab, to detect snoring while they sleep. Audio is processed on the device and is not uploaded. A demo account with sample nights is provided so the morning screens can be reviewed without an overnight recording.
