import { PostHogClient, type PostHogOptions } from '../src/posthog';

/** A PostHog stand-in and a timer the test fires by hand. */
function setup(responses: (number | 'offline')[] = []) {
  const sent: { url: string; body: { api_key: string; historical_migration: boolean; batch: Record<string, unknown>[] } }[] = [];
  const fetchFn: PostHogOptions['fetchFn'] = async (url, init) => {
    const next = responses.shift() ?? 200;
    if (next === 'offline') throw new TypeError('Network request failed');
    sent.push({ url, body: JSON.parse(init.body) });
    return { ok: next < 300, status: next };
  };
  let timer: (() => void) | null = null;
  const client = new PostHogClient({
    apiKey: 'phc_test',
    host: 'https://eu.i.posthog.com',
    properties: { $os: 'iOS', $app_version: '0.3.0', internal_build: false },
    fetchFn,
    now: () => new Date('2026-10-21T07:30:00Z'),
    schedule: (fn) => {
      timer = fn;
      return () => {
        timer = null;
      };
    },
  });
  /** Fires the pending send and waits for it. */
  const tick = async () => {
    const fn = timer;
    timer = null;
    fn?.();
    await new Promise((r) => setTimeout(r, 0));
  };
  return { client, sent, tick, pending: () => timer !== null };
}

describe('PostHog usage counts', () => {
  it('hold events until the install id is known, then send them anonymously in one batch', async () => {
    const { client, sent, tick } = setup();
    client.sink({ name: 'app_open' });
    client.sink({ name: 'recording_complete', duration_band: '6-9h', partial: false });
    await tick();
    expect(sent).toEqual([]);

    client.start('install-1', true);
    await tick();
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe('https://eu.i.posthog.com/batch/');
    expect(sent[0].body.api_key).toBe('phc_test');
    expect(sent[0].body.batch).toEqual([
      {
        event: 'app_open',
        distinct_id: 'install-1',
        timestamp: '2026-10-21T07:30:00.000Z',
        properties: {
          $os: 'iOS',
          $app_version: '0.3.0',
          internal_build: false,
          distinct_id: 'install-1',
          $lib: 'snorehive-app',
          $process_person_profile: false,
          $geoip_disable: true,
        },
      },
      expect.objectContaining({
        event: 'recording_complete',
        properties: expect.objectContaining({ duration_band: '6-9h', partial: false, $process_person_profile: false }),
      }),
    ]);
  });

  it('send nothing, and keep nothing, when turned off', async () => {
    const { client, sent, tick, pending } = setup();
    client.sink({ name: 'app_open' });
    client.start('', false);
    client.sink({ name: 'morning_viewed' });
    await tick();
    expect(pending()).toBe(false);
    expect(sent).toEqual([]);

    // Turning it back on sends only what happens from then on.
    client.start('install-2', true);
    client.sink({ name: 'recap_opened' });
    await tick();
    expect(sent.flatMap((s) => s.body.batch.map((e) => e.event))).toEqual(['recap_opened']);
  });

  it('stop at once when turned off, dropping what was waiting', async () => {
    const { client, sent, tick } = setup();
    client.start('install-3', true);
    client.sink({ name: 'app_open' });
    client.setEnabled(false);
    await tick();
    await client.flush();
    expect(sent).toEqual([]);
  });

  it('try again with the next send when offline or PostHog is down, but not after a refusal', async () => {
    const { client, sent, tick } = setup(['offline', 503, 200, 400, 200]);
    client.start('install-4', true);
    client.sink({ name: 'app_open' });
    await tick(); // offline: kept
    expect(sent).toHaveLength(0);
    client.sink({ name: 'morning_viewed' });
    await tick(); // 503: kept
    await client.flush(); // to the background: sent together
    expect(sent.at(-1)!.body.batch.map((e) => e.event)).toEqual(['app_open', 'morning_viewed']);

    client.sink({ name: 'recap_opened' });
    await tick(); // 400: dropped, not retried
    client.sink({ name: 'review_asked' });
    await tick();
    expect(sent.at(-1)!.body.batch.map((e) => e.event)).toEqual(['review_asked']);
  });

  it('send at most 50 at a time and keep at most the latest 100', async () => {
    const { client, sent, tick } = setup();
    for (let i = 0; i < 130; i++) client.sink({ name: 'log_saved', remedies: i, factors: 0 });
    client.start('install-5', true);
    await tick();
    await tick();
    await tick();
    expect(sent.map((s) => s.body.batch.length)).toEqual([50, 50]);
    const first = sent[0].body.batch[0].properties as { remedies: number };
    expect(first.remedies).toBe(30);
  });
});
