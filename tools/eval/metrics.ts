/**
 * Detector evaluation metrics. Pure functions, no I/O, so they can be unit tested and
 * reused by any detector's predictions.
 *
 * Conventions
 * - Events are half-open intervals [startS, endS) in seconds from the start of the night.
 *   Fractional seconds are allowed.
 * - Per-second labels: second t is snore when its midpoint (t + 0.5) lies inside an event.
 *   This rounds an event edge to the nearest second boundary in both directions alike.
 *
 * Frame level (snore is the positive class)
 *   precision = TP / (TP + FP), recall = TP / (TP + FN), F1 = 2PR / (P + R).
 *   Undefined values (nothing predicted, nothing labelled) are null, not 0 or 1, so they
 *   cannot flatter or sink a pooled result. Pooled metrics sum TP/FP/FN over nights,
 *   which weights each night by its length.
 *
 * Event level
 *   A labelled event is matched when a single predicted event overlaps it by at least
 *   50% of the labelled event's duration. One predicted event may match several labelled
 *   events (a detector that merges two close bouts is not penalised twice here; it shows
 *   up in event precision and frame F1 instead).
 *   agreement = matched labelled events / labelled events (the Phase 1 gate metric).
 *   A predicted event is correct when a single labelled event overlaps it by at least 50%
 *   of the predicted event's duration.
 *   event precision = correct predicted events / predicted events.
 *   Pooled values are ratios of summed counts across nights, not means of per-night ratios.
 */

export interface Span {
  startS: number;
  endS: number;
}

export const EVENT_OVERLAP_FRACTION = 0.5;

/** Phase 1 gate, measured on pooled held-out nights. */
export const PHASE1_GATE = { eventAgreement: 0.85, frameF1: 0.8 } as const;

export function perSecondLabels(events: Span[], durationS: number): Uint8Array {
  const n = Math.max(0, Math.floor(durationS));
  const out = new Uint8Array(n);
  for (const e of events) {
    // Midpoint rule: t + 0.5 ∈ [start, end)  ⇔  t ∈ [ceil(start - 0.5), ceil(end - 0.5)).
    const from = Math.max(0, Math.ceil(e.startS - 0.5));
    const to = Math.min(n, Math.ceil(e.endS - 0.5));
    if (to > from) out.fill(1, from, to);
  }
  return out;
}

export interface FrameCounts {
  tp: number;
  fp: number;
  fn: number;
  tn: number;
}

export function frameCounts(labelled: Uint8Array, predicted: Uint8Array): FrameCounts {
  if (labelled.length !== predicted.length) {
    throw new Error(`label arrays differ in length (${labelled.length} vs ${predicted.length})`);
  }
  const c = { tp: 0, fp: 0, fn: 0, tn: 0 };
  for (let t = 0; t < labelled.length; t++) {
    if (predicted[t]) {
      if (labelled[t]) c.tp++;
      else c.fp++;
    } else if (labelled[t]) c.fn++;
    else c.tn++;
  }
  return c;
}

export interface FrameMetrics extends FrameCounts {
  precision: number | null;
  recall: number | null;
  f1: number | null;
}

const ratio = (num: number, den: number): number | null => (den > 0 ? num / den : null);

export function frameMetrics(c: FrameCounts): FrameMetrics {
  const precision = ratio(c.tp, c.tp + c.fp);
  const recall = ratio(c.tp, c.tp + c.fn);
  // F1 = 2TP / (2TP + FP + FN): defined whenever anything was labelled or predicted.
  const f1 = ratio(2 * c.tp, 2 * c.tp + c.fp + c.fn);
  return { ...c, precision, recall, f1 };
}

export function overlapS(a: Span, b: Span): number {
  return Math.max(0, Math.min(a.endS, b.endS) - Math.max(a.startS, b.startS));
}

/** Indices of `targets` that some single event in `others` covers by at least `fraction` of the target's duration. */
function coveredIndices(targets: Span[], others: Span[], fraction: number): boolean[] {
  return targets.map((t) => {
    const need = fraction * (t.endS - t.startS);
    if (need <= 0) return false;
    return others.some((o) => overlapS(t, o) >= need - 1e-9);
  });
}

export interface EventCounts {
  labelled: number;
  matchedLabelled: number;
  predicted: number;
  correctPredicted: number;
}

export function eventCounts(labelled: Span[], predicted: Span[], fraction = EVENT_OVERLAP_FRACTION): EventCounts {
  return {
    labelled: labelled.length,
    matchedLabelled: coveredIndices(labelled, predicted, fraction).filter(Boolean).length,
    predicted: predicted.length,
    correctPredicted: coveredIndices(predicted, labelled, fraction).filter(Boolean).length,
  };
}

export interface EventMetrics extends EventCounts {
  agreement: number | null;
  precision: number | null;
}

export function eventMetrics(c: EventCounts): EventMetrics {
  return { ...c, agreement: ratio(c.matchedLabelled, c.labelled), precision: ratio(c.correctPredicted, c.predicted) };
}

export interface NightMetrics {
  frame: FrameMetrics;
  event: EventMetrics;
}

/** Metrics for one night. Per-second arrays cover the labelled night's duration. */
export function evaluateNight(labelled: Span[], predicted: Span[], durationS: number): NightMetrics {
  return {
    frame: frameMetrics(frameCounts(perSecondLabels(labelled, durationS), perSecondLabels(predicted, durationS))),
    event: eventMetrics(eventCounts(labelled, predicted)),
  };
}

export function poolNights(nights: NightMetrics[]): NightMetrics {
  const f: FrameCounts = { tp: 0, fp: 0, fn: 0, tn: 0 };
  const e: EventCounts = { labelled: 0, matchedLabelled: 0, predicted: 0, correctPredicted: 0 };
  for (const n of nights) {
    f.tp += n.frame.tp;
    f.fp += n.frame.fp;
    f.fn += n.frame.fn;
    f.tn += n.frame.tn;
    e.labelled += n.event.labelled;
    e.matchedLabelled += n.event.matchedLabelled;
    e.predicted += n.event.predicted;
    e.correctPredicted += n.event.correctPredicted;
  }
  return { frame: frameMetrics(f), event: eventMetrics(e) };
}

export interface GateResult {
  pass: boolean;
  reasons: string[];
}

/** An undefined metric fails the gate: a held-out set with no labelled snoring proves nothing. */
export function phase1Gate(pooled: NightMetrics, gate = PHASE1_GATE): GateResult {
  const reasons: string[] = [];
  const { agreement } = pooled.event;
  const { f1 } = pooled.frame;
  if (agreement === null) reasons.push('event agreement is undefined (no labelled events)');
  else if (agreement < gate.eventAgreement) reasons.push(`event agreement ${pct(agreement)} is below ${pct(gate.eventAgreement)}`);
  if (f1 === null) reasons.push('frame F1 is undefined (nothing labelled or predicted)');
  else if (f1 < gate.frameF1) reasons.push(`frame F1 ${f1.toFixed(3)} is below ${gate.frameF1.toFixed(2)}`);
  return { pass: reasons.length === 0, reasons };
}

export const pct = (x: number | null): string => (x === null ? 'n/a' : `${(100 * x).toFixed(1)}%`);
export const fixed = (x: number | null, digits = 3): string => (x === null ? 'n/a' : x.toFixed(digits));
