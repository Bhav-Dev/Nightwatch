import { type AudioCapture, SimulatedCapture } from './audioCapture';

/**
 * The capture implementation for this build. Until the native module lands, development
 * builds use the simulator (one 30-second window per real second, so a "night" passes
 * quickly) and release builds have none.
 */
export function getAudioCapture(): AudioCapture | null {
  return __DEV__ ? new SimulatedCapture() : null;
}

export * from './audioCapture';
