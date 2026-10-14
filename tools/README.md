# Labelling and detector evaluation

Tools for building the 30-night labelled test set and scoring detectors against it. They run on a laptop and never ship in the app.

```
tools/
  labelling/propose.ts      WAV → proposed snore regions (detection v0)
  labelling/label.html      browser page: confirm, correct and add regions → labels.json
  labelling/wavStream.ts    chunked WAV reader used by propose
  eval/metrics.ts           frame and event metrics, Phase 1 gate (pure, unit tested)
  eval/manifest.ts          manifest, labels and predictions formats
  eval/split.ts             train / held-out assignment by volunteer
  eval/evaluate.ts          scores a detector on held-out nights; exits 1 if the gate fails
  eval/manifest.example.json
```

The scripts are TypeScript run with [tsx](https://tsx.is) (`npx tsx`, fetched on first use). They reuse the app's own feature extraction, v0 heuristic and event rules from `src/domain`, so proposals match what the app would find.

## Workflow

### 1. Consent

Before recording, each volunteer agrees in writing to:

- full-night audio recording in their bedroom, including anyone else in the room (a bed partner must agree too),
- a named person listening to parts of the recording to label snoring,
- what is kept: the labels (start and end times only) and, for held-out nights, see the retention note below,
- when the audio is deleted (after labelling, or at the end of the retention period),
- withdrawal at any time, which deletes their audio and labels.

Give each volunteer a code (`v01`, `v02`, ...). Do not put names in file names, manifests or labels.

### 2. Record full nights as WAV

Aim for 30 nights from 5 to 8 volunteers, 3 to 6 nights each. Record with the phone on the bedside table, as the app would be used. Any sample rate and channel count works (channels are averaged to mono); 16 kHz mono 16-bit matches the app and keeps an 8-hour night to about 920 MB. 8, 16, 24 and 32-bit integer PCM and 32 or 64-bit float WAV are supported, including WAVE_FORMAT_EXTENSIBLE and files whose recorder died before fixing the header size. RF64 (over 4 GB) is not; split such nights.

Name files `<volunteer>-n<k>.wav`, e.g. `v03-n2.wav`. The file name becomes the `source` that ties proposals, labels and predictions together.

### 3. Propose regions

```bash
npx tsx tools/labelling/propose.ts recordings/v03-n2.wav            # writes recordings/v03-n2.proposals.json
npx tsx tools/labelling/propose.ts recordings/v03-n2.wav --out proposals/v03-n2.proposals.json
```

The WAV is read in 30-second chunks and only per-second features are kept, so an 8-hour 16 kHz night needs about 150 MB of memory and takes about 20 seconds. (Decoding the whole file at once would need about 3 GB.) A trailing part-second is dropped, as on the device.

### 4. Label

Open `tools/labelling/label.html` in Chrome, Edge or Firefox straight from disk (no server, no network). Choose the WAV and its proposals file and enter your initials.

- The top chart is the whole night's loudness with regions marked: amber undecided, green snoring, grey not snoring. Click it to move the detail view.
- The detail view shows the waveform (or per-second loudness when zoomed out past 10 minutes). Drag to select a span, drag the edges of the selected region to move them, click to set the play cursor.
- Play each region (Space), then mark it snoring (Y) or not snoring (X); both move on to the next undecided region. Adjust edges with A/S (start) and D/F (end), 1 s per press or 5 s with Shift. Add missed snoring with N. All shortcuts are listed on the page and every action also has a button.
- Playback is normalised by default so quiet snoring is audible; switch to original level to judge loudness.
- Progress is saved in the browser (localStorage, keyed by the recording's file name) after every change, so reloading or closing the tab loses nothing. Use "Start over from proposals" to discard it.

**Per-second labels come only from the regions marked snoring.** Every other second counts as not snoring, so scan the whole night for snoring the detector missed, not only the proposed regions. Labelling rule of thumb: a region starts at the first audible snore and ends at the last, and pauses of under 20 seconds between snores stay inside one region (the app merges events closer than 20 s, so labelling them separately would only measure that rule).

Export writes `<source>.labels.json`. Undecided regions are left out, and the page asks before exporting with any left. To review someone else's labels, load their labels file as "Existing labels to review".

### 5. Delete the recording

Once the labels file is exported and checked into the dataset store, delete the WAV (and any copies) for train nights. See the retention note for held-out nights.

### 6. Split

```bash
npx tsx tools/eval/split.ts dataset/manifest.json            # dry run, prints the plan
npx tsx tools/eval/split.ts dataset/manifest.json --write    # updates the manifest
```

Splits are by volunteer, never by night, so no voice is in both sets. The first split picks the volunteers whose nights add up closest to a third of the total (10 of 30; `--heldout-nights N` to change), preferring more held-out volunteers on a tie, chosen with a seeded random pick (`--seed`, default 1) so the result is reproducible. After that the held-out set is frozen: held-out volunteers never move and every new volunteer goes to train. New nights from an existing volunteer join that volunteer's split. `evaluate.ts` refuses a manifest with any volunteer in both sets.

### 7. Evaluate

```bash
npx tsx tools/eval/evaluate.ts dataset/manifest.json                       # held-out, built-in detector
npx tsx tools/eval/evaluate.ts dataset/manifest.json --predictions out/v1  # held-out, any detector
npx tsx tools/eval/evaluate.ts dataset/manifest.json --split train         # for information
npx tsx tools/eval/evaluate.ts dataset/manifest.json --json report.json    # also write the full report
```

For each night the predictions come from, in order: `<predictions dir>/<night id>.json`, the night's `predictions` file in the manifest, or running the built-in detector (v0) on the night's `wav`. It prints per-night and pooled metrics and the gate result. Exit code 0 means the Phase 1 gate passed, 1 failed, 2 bad input.

## Retention of held-out audio

The spec asks for recordings to be deleted after labelling and for the held-out set to stay fixed across releases so that later detectors are compared on it. These conflict: a new model cannot be run on audio that no longer exists, and frozen v0 predictions only ever score v0. Either the consent form covers keeping the held-out nights' audio (encrypted, access-limited, deleted when the on-device model is retired or on withdrawal), or every model must be scored at labelling time and the held-out set rebuilt for each new model. The tools support both, but this needs a product and privacy decision before recording starts.

## Metrics

Defined in `eval/metrics.ts`.

- **Events** are half-open intervals `[startS, endS)` in seconds from the start of the recording.
- **Per-second labels.** Second `t` is snore when its midpoint `t + 0.5` lies inside an event. The same rule turns labelled and predicted events into per-second arrays covering the labelled night's whole seconds.
- **Frame level** (snore is the positive class): precision, recall and F1 over seconds. Pooled values sum true and false positives and negatives over all nights, so longer nights count for more. A value with a zero denominator is reported as n/a, not 0 or 1.
- **Event agreement** (the gate metric): a labelled event is matched when one predicted event overlaps it by at least 50% of the labelled event's duration. Agreement is matched labelled events divided by labelled events. Fragments do not add up: two predictions each covering 30% of an event do not match it. One long prediction can match several labelled events.
- **Event precision**: a predicted event is correct when one labelled event overlaps it by at least 50% of the predicted event's duration; precision is correct predicted events divided by predicted events. This is what catches a detector that merges separate bouts or runs long.
- Pooled event figures are ratios of summed counts across nights.
- **Phase 1 gate**, on pooled held-out nights: event agreement at least 85% and frame F1 at least 0.80. An undefined metric (no labelled snoring at all) fails.

## File formats

All files are JSON with `version: 1`. Times are seconds from the start of the recording.

**Proposals / predictions** (`propose.ts` output, and what any detector must write):

```json
{
  "version": 1,
  "source": "v03-n2.wav",
  "durationS": 28812.5,
  "sampleRate": 16000,
  "detector": "heuristic-v0",
  "regions": [{ "startS": 1203, "endS": 1460, "peakDb": 21.4 }],
  "levelDb": [-58.6, -58.7]
}
```

`regions` is required; `peakDb` (dB above the night's noise floor), `levelDb` (A-weighted level per second, used by the labelling page to draw the overview without reading the whole WAV), `sampleRate` and `durationS` are optional for predictions. `--no-levels` leaves `levelDb` out.

**Labels** (exported by `label.html`):

```json
{
  "version": 1,
  "source": "v03-n2.wav",
  "durationS": 28812.5,
  "labeller": "AB",
  "events": [{ "startS": 1198, "endS": 1466 }],
  "labelledAt": "2026-10-14T07:12:00.000Z"
}
```

Events are the regions marked snoring, sorted, with overlapping or touching ones merged.

**Manifest** (see `eval/manifest.example.json`). Paths are relative to the manifest file.

```json
{
  "version": 1,
  "nights": [
    {
      "id": "v03-n2",
      "volunteer": "v03",
      "split": "heldout",
      "wav": "recordings/v03-n2.wav",
      "labels": "labels/v03-n2.labels.json",
      "predictions": "predictions/v03-n2.proposals.json"
    }
  ]
}
```

`split` is filled in by `split.ts`. `wav` and `predictions` are each optional, but evaluating a night needs one of them or a `--predictions` directory.

## Plugging in a new detector

A detector, whatever it is (the on-device model run on a laptop, a Python prototype), writes one predictions file per night in the format above, named `<night id>.json`, into a directory, then:

```bash
npx tsx tools/eval/evaluate.ts dataset/manifest.json --predictions out/model-v1
```

Write `detector` as a name and version (`"ondevice-v1.2"`) so reports say what was scored. Turn per-second outputs into regions with the app's event rules (`detectEventSpans` in `src/domain/scoring/events.ts`: bridge gaps up to 5 s, drop runs under 10 s, merge events under 20 s apart) so the evaluation measures what users would see. A TypeScript detector can instead return regions from a function shaped like `heuristicRegions` in `labelling/propose.ts` and be called from `evaluate.ts` in place of v0.

## Tests

```bash
npx jest __tests__/tools
```

`tools.metrics.test.ts` covers the metric definitions; `tools.pipeline.test.ts` writes a synthetic night (`synthesiseNightAudio` + `encodeWav`) to a temp directory and runs the chunked reader, propose, evaluate and split on it.
