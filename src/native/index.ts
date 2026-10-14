import { type AudioCapture, SimulatedCapture } from './audioCapture';
import { ExpoAudioCapture } from './expoAudioCapture';

/**
 * The capture implementation for this build: the real microphone through expo-audio, or the
 * simulator when EXPO_PUBLIC_SIMULATE_CAPTURE=1 (30 seconds of synthetic night per real
 * second, for demos and for working on the morning screens without sleeping).
 */
export function getAudioCapture(): AudioCapture {
  if (process.env.EXPO_PUBLIC_SIMULATE_CAPTURE === '1') return new SimulatedCapture();
  return new ExpoAudioCapture();
}

export * from './audioCapture';
