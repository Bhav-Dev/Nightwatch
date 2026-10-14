/**
 * Detection is pluggable so the trained model can replace the heuristic without touching
 * capture, storage or scoring.
 *
 * - The heuristic (v0) needs the whole night's noise floor, so it runs once at Stop over the
 *   stored per-second features.
 * - A model (v1: a small CNN over 64-band log-mel spectrograms, Core ML / TFLite) sees each
 *   second's audio during capture and returns a snore probability, which is stored with the
 *   features (session_frame.snore_prob). If every second of a night has a probability, those
 *   are used; otherwise the night falls back to the heuristic.
 */
export interface OnlineSnoreScorer {
  /** Stored on the night (night.detector) so results can be compared across detectors. */
  id: string;
  /** Probability that this second is snoring, 0 to 1; null if the model could not run. */
  score(samples: Float32Array, sampleRate: number): number | null;
}

export const HEURISTIC_DETECTOR_ID = 'heuristic-v0';
