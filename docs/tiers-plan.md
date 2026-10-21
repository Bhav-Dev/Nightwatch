# Bee and Hive: the free and paid tiers

**Status: decided 20 October 2026; the split confirmed and built 21 October 2026.** The website design shows it already. Tracked in [status.md](status.md).

## Names

- **Bee** is the free tier: you, on your own.
- **Hive** is the paid tier: £29.99 a year with 7 days free, or £4.99 a month with no trial (prices decided 20 October 2026; the year may move to £34.99 later, tested with RevenueCat). It is what the whole hive has found. It replaces the name "Insight".
- Buttons say "Join the Hive". Store subscription names: "SnoreHive Hive membership" (yearly, monthly). Internal product and entitlement ids stay as they are.

## Decided

- **Recording is free every night.** No every-other-night limit: the nightly habit keeps people coming back, remedy tests need nights in a row, and the community figures come mostly from free users.
- **Bee users log what they try** (remedies and factors on Tonight, last night's log). Their nights feed the community figures.
- **Bee users do not see the hive's results.** The Remedies tab (the community ranking, people like you, each remedy's figures) is Hive only. This changes the plan's "top level free, slices paid".
- Bee users see a locked preview, not an empty tab: the remedy names in honeycomb cells, the results blurred, and "Join the hive to see what worked for people like you".
- **The website stays public.** Remedy pages and articles show headline figures for search and press. The website gives the general answer; the Hive in the app gives the answer for people like you and for you.

## The split (confirmed 21 October 2026)

| Item | Bee | Hive |
| --- | --- | --- |
| Morning | Score, timeline, kept clips (snoring and other sounds), Snoring answers, first summary line | Full summary, whole-night playback and scrubbing, watch data on the timeline |
| History | Last 7 nights, one week of the hive of nights | Everything, 30 and 90-night trends, the full hive of nights |
| Remedy tests | Can start one and log it; the verdict at the end is locked | Tests with a verdict |
| Extras | Data export | Doctor's report |

- Clips and Snoring answers stay free, because the answers train the detector.
- The locked verdict asks at the best moment: after two weeks of effort, when they want the answer.
- Data export stays free for everyone: UK GDPR gives people the right to a copy of their own data, so it is not charged for.

## What was built (21 October 2026)

1. Remedies tab, Everyone: a Bee sees the remedy names in honeycomb cells with the results blurred (made-up figures, hidden from screen readers; nothing is fetched from the hive) and "Join the hive to see what worked for people like you". The tab shows a lock.
2. Remedy detail screen: the community figures and the by-group results are replaced by the same blurred preview for a Bee. The article and where to buy stay.
3. Paywall: "Join the Hive", a line matched to the lock that opened it, four bullets, and "Recording stays free every night as a Bee". Settings says Bee or Hive. Locks read "Part of the Hive" to screen readers.
4. This Morning: whole-night playback and scrubbing are Hive only. A Bee plays the kept clip for snoring and other moments; picking a stretch with no clip shows "Play back the whole night from any second". The full summary and watch data were already Hive only.
5. Remedy tests are open to a Bee: start, log, see "night X of 14". When it ends the verdict shows as a lock ("Your test is done. See its verdict").
6. History (7 nights, the one-week hive) and the doctor's report were already locked; the report screen now also guards a stray link.
7. Still to do outside the app: store listings with the subscription names and descriptions.
