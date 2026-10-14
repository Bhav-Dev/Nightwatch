import { requireOptionalNativeModule } from 'expo';

interface NightwatchRecordingServiceModule {
  start(title: string, body: string): void;
  stop(): void;
  isRunning(): boolean;
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
