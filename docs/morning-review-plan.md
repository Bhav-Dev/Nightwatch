# Morning review: notes and plan

**Status: built 17 October 2026, not yet run on a phone.** This covers the Snoring answers, the timeline scrubber with previous and next, the night recap notification and the app store review prompt. How they work is in the README ("Checking the night"); progress is tracked in [status.md](status.md).

## Notes

- **A new build is needed.** `expo-store-review` has native code, so an over-the-air update does not bring it. Make a new development or preview build before testing.
- **Loudness of added snoring is an estimate.** Per-second levels are deleted once the night is saved. When the user ticks Snoring on a stretch the detector left out, its loudness comes from the clip's peak (when there is a clip) or from the 5-minute bins. The score uses that loudness, so it is slightly approximate for these stretches.
- **"Not snoring" on a clip covers the whole stretch of snoring the clip is part of**, not only the clip's 15 seconds.
- **Clips stay in their card after an answer.** A clip that was counted as snoring stays under "Loudest moments" when it is unticked, so rows do not move under the user's finger. The pill shows the current answer.
- **Answers stay on the phone.** The corrected night (score, time snoring, event count) syncs; the answers themselves do not, so a new phone keeps the corrected numbers but not the per-moment answers. The export includes them.
- **The recap needs notification permission.** It never asks at Stop. Without permission, nothing is scheduled; choosing a recap time in Settings asks. It is on by default (12:30), which is fine as it can be turned off in Settings (decided 17 October 2026). Permission is asked in setup (step 3, Notifications), whose text now mentions the recap.
- **A tapped recap is cleared once handled**, so a later remount (Android can rebuild the screen) does not open This Morning again.
- **The recap's count** is the number of kept clips (at most 8), not every moment, so it never reads like a long to-do list.
- **The review prompt is rate-limited by the stores too.** iOS shows the sheet at most 3 times a year and always in development builds; Android only shows it for apps installed from Google Play (internal testing track or internal app sharing), never in a sideloaded build.
- **Analytics:** three events beyond the spec's 10: `snoring_answered`, `recap_opened`, `review_asked`. Counts and flags only.

## Plan

1. 👤 **New build** (preview for Android; iPhone when its first build is done).
2. 👤 **Test on a phone**, on a night with recorded sound and on an older night with clips only:
   - drag along the timeline and the slider: the time shows, letting go plays from there, the page does not scroll sideways mid-drag and still scrolls up and down;
   - previous and next step through moments, and the panel follows playback;
   - untick Snoring on a snoring moment: score, time snoring and timeline change, "Was N before your answers" shows, Undo restores the night;
   - tick Snoring on an "other sound": it becomes snoring and joins nearby snoring;
   - the Snoring pill on clip rows does the same;
   - the recap arrives at the chosen time and opens This Morning; it is cancelled after answering;
   - the review sheet appears only under the rules (3+ nights, later in the day, after using the screen), on a Play internal testing build.
3. **Keep a compact loudness track** (one value per second, about 30 KB a night) so added snoring gets its real loudness. Needs a small migration and a change at Stop.
4. **Use the answers for training:** export `sound_label` with the night's audio stretches into the `tools/labelling` format, with the user's consent (see the open question in [night-events-design.md](night-events-design.md)).
5. **Tune the detector per user** from their answers (for example, raising the threshold for a room where fans are often counted as snoring). Part of the night-events work, not scheduled.
6. **"That was my partner"** as a third answer, once partner snoring is picked up (night-events design, section 2).
7. **Sync the answers** (optional): only if a new phone should keep them. Not needed for the community data, which uses the corrected nightly figures.
