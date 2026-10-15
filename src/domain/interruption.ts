export type InterruptCauseCopy = 'stalled' | 'microphone_taken' | 'app_closed';

/** Probable cause and advice for the "Recording stopped at 03:12" banner. */
export const INTERRUPTION_COPY: Record<InterruptCauseCopy, { cause: string; prevent: string }> = {
  stalled: {
    cause: 'Another app, a call or an alarm took over the audio.',
    prevent: 'Turn on Do Not Disturb before you start, and use a silent alarm or the phone’s own alarm.',
  },
  microphone_taken: {
    cause: 'Another app or a call used the microphone.',
    prevent: 'Turn on Do Not Disturb so calls do not come through overnight.',
  },
  app_closed: {
    cause: 'The phone closed the app, usually to save battery or memory.',
    prevent: 'Plug the phone in, turn off battery saver, and on Android allow Nightwatch to run in the background.',
  },
};

/** "03:12" from the night's start time (epoch s) and an offset into it. */
export function clockTimeAt(startedAtS: number, offsetS: number, opts: { seconds?: boolean } = {}): string {
  const d = new Date((startedAtS + offsetS) * 1000);
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return opts.seconds ? `${hm}:${String(d.getSeconds()).padStart(2, '0')}` : hm;
}
