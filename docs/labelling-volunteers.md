# Recording nights for the snoring labelling study

This guide is for volunteers who record nights with SnoreHive for the labelling study, and for the person running the study (the study lead). Volunteers need the first part only. The second part covers turning the files into labelling inputs.

## What the study is

We are collecting about 30 nights of sound from 5 to 8 people to check and improve how SnoreHive picks out snoring. You record 3 to 6 ordinary nights with the app, then send them to the study lead. A named person on the team listens to parts of each night and marks where the snoring is. Those marks are what the detector is trained and tested on.

This is not a medical test, and the study does not tell you anything about your health.

## For volunteers

### 1. Agree to take part

Before your first night you sign a consent form. It covers:

- recording the whole night in your bedroom, including anyone else in the room (a bed partner has to agree too),
- a named person listening to parts of the recording to mark snoring,
- what is kept: the marks (start and end times only) and, for some nights, the recording itself, kept encrypted so that later versions of the detector can be tested on it (the form says which applies),
- when the recording is deleted: after labelling, or at the end of the keeping period on the form,
- that you can withdraw at any time, and your recordings and marks are then deleted.

You get a volunteer code such as `v03`. Your name never goes into file names or the dataset.

### 2. Install the test version

Whole-night recording needs an Android phone for now.

1. Open the install link the study lead sends you, on the phone you will record with.
2. Allow the install when Android asks (it may ask you to allow installs from your browser or messaging app).
3. Open SnoreHive and go through setup. Allow the microphone when asked.

If you already use SnoreHive from the Play Store, the test version is a separate app. Use the test version for study nights.

### 3. Turn on labelling mode

1. Tap the settings icon (the cog at the top of the screen).
2. Under **Recording**, check that **Record sounds during the night** is on.
3. Under **Labelling study**, turn on **Keep the whole night's sound (for labelling)**.

Normally the app keeps only the parts of the night with sound in them. Labelling mode keeps every second, so the whole night can be checked. It starts with your next recording and stays on until you turn it off.

A night takes about 11 MB an hour, so about 90 MB for an 8-hour night and about 650 MB for 7 nights. Make sure the phone has at least twice that free: exporting makes one more copy. The app deletes recordings older than 30 nights on its own, so send your nights well before then.

### 4. Record a night

Sleep as you normally would. You do not need to snore, or to try not to.

- Put the phone on the bedside table, face up, within about an arm's length of your head. Do not put it under the pillow or cover it.
- Plug it in. A whole night of recording uses battery.
- At bedtime, open the app and tap **Start recording** on Tonight. You can lock the phone; recording carries on with the screen off.
- In the morning, recording stops just before your alarm, or at the stop time in Settings. You can also stop it yourself by holding **Hold to stop** for a second.
- Avoid other apps that use the microphone overnight. A phone call during the night can pause recording for a while; the app keeps what it recorded.

In the morning the app shows your night as usual. If you have time, tap the loudest moments on the timeline and answer "Was this snoring?". It is optional, and your answers help the person labelling.

### 5. Export and send your nights

You can send nights one at a time or several together.

1. Open Settings and go to **Labelling study**.
2. Under **Nights to export**, choose **Last night**, **Last 3** or **Last 7**. Only nights with recorded sound are included.
3. Tap **Export nights for labelling**. The app tells you how big the file is. Tap **Export**.
4. Writing the file takes a moment. When the share sheet opens, send the file to the study lead the way you agreed, usually a private upload link. The files are large, so email usually will not work.

The file is called `snorehive-labelling-<date>.tar`. It holds the recorded sound of those nights and what the app noted about them: when each night started, when it heard snoring and your answers. It does not hold your name, email or account.

The app keeps a copy of the last export until you export again. To remove it sooner, clear SnoreHive's storage cache in your phone's app settings.

### 6. When you have finished

Once the study lead confirms they have your nights:

- turn off **Keep the whole night's sound (for labelling)**,
- if you want the recordings off your phone, tap **Delete sound recordings** under Recording in Settings. Scores and timelines stay.

### 7. Withdrawing

You can stop at any time without giving a reason. Tell the study lead, and they delete your recordings and marks from the dataset. On your phone, tap **Delete sound recordings** in Settings, or uninstall the test version.

## For the study lead

### Before the first night

- The consent form is signed by the volunteer and any bed partner, and the decision on keeping held-out recordings is made (see "Retention of held-out audio" in [tools/README.md](../tools/README.md)).
- Each volunteer has a code (`v01`, `v02`, ...). Keep the list of names and codes somewhere separate from the dataset.
- Send the internal build: the EAS `preview` profile (`EXPO_PUBLIC_INTERNAL_BUILD=1`). The Labelling study settings appear only in internal and development builds.

### Turning an export into labelling inputs

Store each file you receive in the dataset store, then run `fromApp.ts` (it needs [ffmpeg](https://ffmpeg.org/download.html) on PATH):

```bash
npx tsx tools/labelling/fromApp.ts incoming/snorehive-labelling-2026-10-17.tar --list
npx tsx tools/labelling/fromApp.ts incoming/snorehive-labelling-2026-10-17.tar --volunteer v03 --first 2 --out recordings
```

`--list` shows the nights in the file, oldest first, with how much of each night was recorded. The second command writes `v03-n2.wav`, `v03-n3.wav`, ... with a `.proposals.json` for each. Keep a note of the night numbers each volunteer has used so a number is never reused. Use `--nights 4,-,5` to number nights one by one and skip one (for example a night that was already sent).

A warning that only part of a night was recorded means labelling mode was off that night: the quiet stretches are silence in the WAV, so snoring there cannot be labelled. Leave such nights out of the test set, or ask the volunteer to record another night.

Then label each night with `tools/labelling/label.html` as in [tools/README.md](../tools/README.md) step 4. The proposals are already written, so skip `propose.ts`. Afterwards delete the archive and the WAV as in step 5 there (or keep them encrypted for held-out nights, if the consent form allows).

### If a volunteer withdraws

Delete their archives, WAVs, proposals and labels, and remove their nights from the manifest.
