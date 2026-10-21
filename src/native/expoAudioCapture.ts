import { AudioModule, requestRecordingPermissionsAsync, setAudioModeAsync } from 'expo-audio';
import type { AudioStream, AudioStreamBuffer } from 'expo-audio';

import { RecordingService } from '../../modules/nightwatch-recording-service/src';
import { FrameAssembler, int16ToFloat32 } from '../domain/audio/frameAssembler';
import { type AudioCapture, CAPTURE_SAMPLE_RATE, type CaptureListener } from './audioCapture';

/** No buffers for this long means capture has stalled (iOS interruption, OS pause). */
const STALL_MS = 10_000;
const WATCHDOG_MS = 5_000;

/**
 * Capture on top of expo-audio's AudioStream (16 kHz mono int16 PCM in ~100 ms buffers).
 *
 * - iOS keeps the stream alive with the screen off through the "audio" background mode
 *   (enabled by the expo-audio config plugin); RecordingService start and stop do nothing there.
 * - Android needs a microphone foreground service for that; the local
 *   nightwatch-recording-service module provides it and must be started while visible.
 * - Neither platform tells a stream it was interrupted. Session offsets come from the wall
 *   clock at each stream start plus the stream's own timestamp, so the frame assembler sees
 *   any pause as a clock jump; a watchdog restarts a stream that has gone quiet.
 */
export class ExpoAudioCapture implements AudioCapture {
  private stream: AudioStream | null = null;
  private subscription: { remove(): void } | null = null;
  private assembler: FrameAssembler | null = null;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private sessionStartMs = 0;
  private streamBaseS = 0;
  private lastBufferAtMs = 0;
  private restarting = false;

  async requestPermission(): Promise<boolean> {
    const res = await requestRecordingPermissionsAsync();
    return res.granted;
  }

  async start(listener: CaptureListener): Promise<void> {
    await setAudioModeAsync({
      // iOS refuses allowsRecording without it (and it is already the default on Android).
      playsInSilentMode: true,
      allowsRecording: true,
      allowsBackgroundRecording: true,
      shouldPlayInBackground: false,
      interruptionMode: 'doNotMix',
    });
    RecordingService.start('Recording your night', 'Listening for snoring. Audio stays on this phone.');

    this.sessionStartMs = Date.now();
    this.assembler = new FrameAssembler({
      onFrame: (t, samples, sampleRate) => listener.onWindow({ startS: t, samples, sampleRate }),
      onGap: (gap) => listener.onInterrupted?.(gap),
    });
    try {
      await this.startStream();
    } catch (e) {
      RecordingService.stop();
      throw e;
    }
    this.watchdog = setInterval(() => void this.restartIfStalled(), WATCHDOG_MS);
  }

  async stop(): Promise<void> {
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = null;
    this.stopStream();
    this.assembler?.finish();
    this.assembler = null;
    RecordingService.stop();
    // Say what playback should do as well: on Android a mode without playsInSilentMode can leave
    // play() doing nothing while the phone is on silent, until the app restarts.
    await setAudioModeAsync({ allowsRecording: false, allowsBackgroundRecording: false, playsInSilentMode: true, shouldPlayInBackground: false });
  }

  isRecording(): boolean {
    return this.assembler !== null;
  }

  private async startStream(): Promise<void> {
    // AudioModule is the native module object, not an ES namespace; the lint rule misreads it.
    // eslint-disable-next-line import/namespace
    const stream = new AudioModule.AudioStream({ sampleRate: CAPTURE_SAMPLE_RATE, channels: 1, encoding: 'int16' });
    this.subscription = stream.addListener('audioStreamBuffer', (buffer) => this.onBuffer(buffer));
    this.streamBaseS = (Date.now() - this.sessionStartMs) / 1000;
    this.lastBufferAtMs = Date.now();
    this.stream = stream;
    await stream.start();
  }

  private stopStream(): void {
    this.subscription?.remove();
    this.subscription = null;
    try {
      this.stream?.stop();
    } finally {
      this.stream?.release();
      this.stream = null;
    }
  }

  private onBuffer(buffer: AudioStreamBuffer): void {
    if (!this.assembler) return;
    this.lastBufferAtMs = Date.now();
    // Read in place rather than copying the buffer first: this runs ten times a second all night.
    let samples = int16ToFloat32(buffer.data, buffer.data.byteLength - (buffer.data.byteLength % 2));
    if (buffer.channels > 1) samples = samples.filter((_, i) => i % buffer.channels === 0);
    this.assembler.push(samples, buffer.sampleRate, this.streamBaseS + buffer.timestamp);
  }

  private async restartIfStalled(): Promise<void> {
    if (this.restarting || !this.assembler) return;
    if (Date.now() - this.lastBufferAtMs < STALL_MS) return;
    this.restarting = true;
    try {
      this.stopStream();
      await this.startStream();
    } catch {
      // Still interrupted (a call in progress); try again on the next tick.
      this.stream = null;
    } finally {
      this.restarting = false;
    }
  }
}
