# Night events: design note

**Status: proposed, not scheduled.** Nothing here is being built yet. It records the agreed direction so it is ready when the work is picked up. Tracked in [status.md](status.md), under "After launch".

The question: today the app detects one thing, snoring. How do we (1) make sure what we count really is snoring, (2) tell the user's snoring from a partner's, (3) show sleep stages, and (4) report other things that happened in the night, such as turning over or waking up?

## In short

- **Sound can tell us:** snoring, sleep talking, coughs, tossing and turning, and roughly when someone was awake.
- **Partner snoring** is reliable with two phones (the plan's partner mode), and only a rough guess with one.
- **Deep and light sleep** cannot be measured from sound. Only a watch estimates stages, and the app already imports them.
- **Everything is an estimate.** The app says "we heard", "probably", "possibly awake", and the user can correct any event.

## 1. Make sure it is snoring: classify every sound

Detection today asks one question per second: is this snoring? Instead, it should ask what each sound is, choosing between these classes:

| Class | What it sounds like |
| --- | --- |
| Snoring (user) | Loud, low-pitched, repeats with each breath, every 2 to 5 seconds |
| Snoring (partner) | The same rhythm, but quieter and more reverberant (further away) |
| Breathing | Quiet and rhythmic, not loud enough to count as snoring |
| Sleep talking | Speech-like pitch, no breathing rhythm |
| Cough or sneeze | A single sharp burst |
| Movement | Bedding rustle: short, broadband, no rhythm |
| Room sounds | Fan, air conditioning, traffic, rain, pets, alarms, TV, sleep sounds |

How:

- **Multi-class model.** The trained model (Phase 1, v1) becomes a multi-class audio classifier rather than snore/not-snore. YAMNet, the planned starting model, already has AudioSet classes for snoring, breathing, cough, speech and rustling. Fine-tune it on the labelled nights. The spec already lists most of these as sounds the model must reject.
- **Two checks must agree.** A second counts as snoring only when the model says snoring *and* the existing breathing-rhythm check (`src/domain/detection/heuristic.ts`) agrees. Disagreement goes to an "unsure" bucket: not scored, but shown.
- **Show what was left out.** The app already keeps the three loudest "other sounds" (`selectClips`). Each event and clip gets a one-tap correction. The snoring yes/no part is built (17 October 2026: the Snoring tick, `src/domain/scoring/corrections.ts`, stored in `sound_label`); *That was my partner* is not. A correction:
  - fixes that night's score straight away;
  - tunes the detector to that person and room;
  - with consent, becomes training data.
- **Measure it per class.** The Phase 1 gate checks snoring only. `tools/eval` should also report confusion between classes, for example how often a partner's snoring, a fan or sleep talking is counted as the user's snoring. That number is the real answer to "is it snoring".
- **Labelling.** `tools/labelling` labels only "snoring" today. It needs the classes above, so the labelled set can train and test them.

## 2. Partner snoring

| Approach | How it works | Reliability |
| --- | --- | --- |
| **Two phones** (the plan's partner mode) | Each person runs the app on their own bedside. Both phones hear the same snore; it is louder on the snorer's phone. The per-second loudness and envelope already stored are enough. Matching the two envelopes also lines up the phones' clocks | **High.** The main solution |
| **One phone, distance cues** | A partner's snore arrives quieter, more reverberant and with less high-frequency detail | Medium to low. Good enough for a "probably your partner" label, not for scoring |
| **One phone, learned snore signature** | Each person's snore has its own sound. After a few corrections, a small model learns the user's snore and the partner's | Medium, improving with corrections. Experimental |
| **Watch as a tie-breaker** | If the user's watch says they were awake while snoring was heard, it was not them | Helps only occasionally |

Rules:
- Partner snoring is shown on the timeline but never counted in the user's score, averages, remedy tests or community contribution.
- Partner mode records a second person, so it needs that person's consent: a clear note at pairing, and the same rule as now that audio stays on the phone.

## 3. Sleep stages

Real sleep staging needs EEG. Apps that claim stages from sound alone estimate them from movement and breathing noise, and are not accurate.

- **With a watch:** show its stages as their own lane on the timeline, labelled "from your watch". The Health import already brings in stages (`health_sample`, kind `sleep_stage`).
- **Without a watch:** no stages. Show restless and still stretches from sound instead (section 4).

This keeps the app honest and clear of medical-sounding claims (see the plan's compliance section).

## 4. Turning over, restlessness and waking

| Event | Signal | Notes |
| --- | --- | --- |
| **Turning over** | A rustle burst in the audio: short, broadband, no rhythm | Works with the phone on the bedside table; no need to put the phone on the mattress |
| **Restlessness** | Movement bursts per hour | A timeline lane, and a nightly figure |
| **Possibly awake** | Combined evidence, strongest first: | Never stated as certain |
| | 1. the watch reports awake | |
| | 2. the phone was picked up during recording (screen on, app opened); the app can log this for free | |
| | 3. talking, or getting-up sounds followed by a long gap | |
| | 4. snoring stopping after a long stretch, together with movement | |
| **"Turned over, snoring stopped"** | A movement burst followed by snoring stopping or starting | Direct evidence for the side-sleeping remedy. A good summary sentence: "You were restless around 3:10 and the snoring stopped after you turned over." |

## 5. How it would look on This Morning

The timeline becomes stacked lanes:
1. Snoring (yours): what is scored;
2. Partner or other snoring;
3. Other sounds: talking, coughs, room noise;
4. Movement: restlessness;
5. Possibly awake;
6. Sleep stages, from your watch (only with a watch).

Every event can be tapped to hear it (the night's sound is now kept) and corrected. Copy matches the certainty: "we heard", "probably", "possibly awake".

## 6. Data changes

- **`event`** gains:
  - `kind`: snore, partner_snore, breathing, talk, cough, movement, awake, other;
  - `confidence`, 0 to 1;
  - `source`: sound, watch or phone;
  - `user_label`: the user's correction, when given.
- **`session_frame.snore_prob`** becomes a small vector of class probabilities, one per class above. That is a few extra numbers per second: negligible storage.
- **Scoring, averages, remedy tests and community data** use only events where `kind = snore`, the user is the snorer, and confidence is above the threshold. The score formula itself does not change.
- **Sync** sends only nightly counts (for example movement events per hour, possible wakes) if they are ever wanted in the community data, never the events themselves.

## 7. Suggested order, when picked up

1. **No model needed:**
   - movement detection from sound;
   - logging when the phone is picked up;
   - the "possibly awake" rule;
   - correction buttons on events and clips;
   - the extra timeline lanes, including the watch stage lane.
2. **With the labelled nights:**
   - extend the labelling tool to the classes;
   - train the multi-class model;
   - add per-class accuracy to the Phase 1 gate.
3. **Two-phone partner mode** (the plan holds it for the first update after launch).
4. **Experimental:** single-phone partner attribution from learned snore signatures.

## Open questions

- Should corrections from contributors feed a shared training set (opt-in, audio clips uploaded), or stay on the phone only? Uploading clips breaks the current "audio never leaves the phone" promise, so it would need its own consent screen.
- Should restlessness and possible wakes become lifestyle-style signals in the community data (for example "remedies that reduce restlessness")?
- For two-phone partner mode: one account per person (each sees their own nights), or one household account?
