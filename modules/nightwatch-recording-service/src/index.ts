import { requireOptionalNativeModule } from 'expo';

interface NightwatchRecordingServiceModule {
  start(title: string, body: string): void;
  stop(): void;
  isRunning(): boolean;
  // Sound segments (AAC .m4a). Missing on builds made before they existed.
  beginSegment?(path: string, sampleRate: number, bitrate: number): void;
  appendPcm?(pcm: Uint8Array): void;
  endSegment?(): Promise<number>;
}

// Android only. On iOS (and in Expo Go) this is null and the calls below are no-ops.
const native = requireOptionalNativeModule<NightwatchRecordingServiceModule>('NightwatchRecordingService');

export const RecordingService = {
  available: native !== null,
  start(title: string, body: string): void {
    native?.start(title, body);
  },
  stop(): void {
    native?.stop();
  },
  isRunning(): boolean {
    return native?.isRunning() ?? false;
  },
};

/**
 * The platform AAC encoder, one segment at a time. Calls are queued natively in order, so a new
 * segment can begin as soon as the previous end() has been called.
 */
export const SoundEncoder = {
  available: typeof native?.beginSegment === 'function',
  begin(path: string, sampleRate: number, bitrate: number): void {
    native?.beginSegment?.(path, sampleRate, bitrate);
  },
  append(pcm: Int16Array): void {
    native?.appendPcm?.(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength));
  },
  async end(): Promise<number> {
    return (await native?.endSegment?.()) ?? 0;
  },
};
