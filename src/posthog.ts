import type { AnalyticsEvent, AnalyticsSink } from './analytics';

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number }>;

export interface PostHogOptions {
  /** The project API key (phc_…). Write-only, so it is safe in the app. */
  apiKey: string;
  /** For example https://eu.i.posthog.com (EU Cloud). */
  host: string;
  /** Added to every event: app version, platform, whether it is a test build. */
  properties: Record<string, string | number | boolean | null>;
  fetchFn?: Fetch;
  now?: () => Date;
  /** Runs fn after ms and returns a cancel function. Defaults to setTimeout. */
  schedule?: (fn: () => void, ms: number) => () => void;
  /** How long to gather events before sending them together. */
  flushAfterMs?: number;
}

interface Captured {
  event: string;
  properties: Record<string, unknown>;
  timestamp: string;
}

/** Events kept while offline or before start(); older ones are dropped first. */
const MAX_QUEUE = 100;
const MAX_BATCH = 50;

const defaultSchedule = (fn: () => void, ms: number) => {
  const t = setTimeout(fn, ms);
  return () => clearTimeout(t);
};

/**
 * Anonymous product analytics over PostHog's HTTP batch API, with no SDK. Events wait in memory
 * until start() gives the install id and whether the person allows it, then go in small batches
 * a few seconds apart. Every event is anonymous: a random install id that is never the account,
 * no person profile, no GeoIP lookup. Nothing is stored on the phone, and nothing throws.
 */
export class PostHogClient {
  private queue: Captured[] = [];
  private installId: string | null = null;
  private state: 'waiting' | 'on' | 'off' = 'waiting';
  private cancelTimer: (() => void) | null = null;
  private sending: Promise<boolean> | null = null;

  readonly sink: AnalyticsSink = (event) => this.capture(event);

  constructor(private readonly opts: PostHogOptions) {}

  /** Once the database is open: the install id and the person's choice. Events captured before it are sent or dropped then. */
  start(installId: string, enabled: boolean): void {
    this.installId = installId;
    this.setEnabled(enabled);
  }

  setEnabled(on: boolean): void {
    this.state = on ? 'on' : 'off';
    if (!on) {
      this.queue = [];
      this.cancel();
    } else if (this.queue.length > 0) {
      this.scheduleFlush();
    }
  }

  /** Sends what is waiting now, for when the app goes to the background. */
  async flush(): Promise<void> {
    this.cancel();
    if (this.sending) {
      await this.sending;
      return;
    }
    if (this.state !== 'on' || !this.installId || this.queue.length === 0) return;
    const batch = this.queue.splice(0, MAX_BATCH);
    this.sending = this.send(this.installId, batch).finally(() => {
      this.sending = null;
    });
    const sent = await this.sending;
    // Anything left (more than one batch, or captured meanwhile) follows shortly. After a
    // failure it waits for the next event or the next trip to the background instead.
    if (sent && this.state === 'on' && this.queue.length > 0) this.scheduleFlush();
  }

  private capture(event: AnalyticsEvent): void {
    if (this.state === 'off') return;
    const { name, ...properties } = event;
    this.queue.push({ event: name, properties, timestamp: (this.opts.now?.() ?? new Date()).toISOString() });
    if (this.queue.length > MAX_QUEUE) this.queue.splice(0, this.queue.length - MAX_QUEUE);
    if (this.state === 'on') this.scheduleFlush();
  }

  /** True when PostHog took the batch (or refused it for good); false when it is to be retried. */
  private async send(installId: string, batch: Captured[]): Promise<boolean> {
    const fetchFn: Fetch = this.opts.fetchFn ?? ((url, init) => fetch(url, init));
    const body = {
      api_key: this.opts.apiKey,
      historical_migration: false,
      batch: batch.map((e) => ({
        event: e.event,
        distinct_id: installId,
        timestamp: e.timestamp,
        properties: {
          ...this.opts.properties,
          ...e.properties,
          distinct_id: installId,
          $lib: 'snorehive-app',
          $process_person_profile: false,
          $geoip_disable: true,
        },
      })),
    };
    try {
      const res = await fetchFn(`${this.opts.host}/batch/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      // A 4xx is a wrong key or a refused body: sending again would not help.
      if (!res.ok && res.status >= 500) {
        this.putBack(batch);
        return false;
      }
      return true;
    } catch {
      // Offline: these go with the next send.
      this.putBack(batch);
      return false;
    }
  }

  private putBack(batch: Captured[]): void {
    if (this.state !== 'on') return;
    this.queue = [...batch, ...this.queue].slice(-MAX_QUEUE);
  }

  private scheduleFlush(): void {
    if (this.cancelTimer) return;
    const schedule = this.opts.schedule ?? defaultSchedule;
    this.cancelTimer = schedule(() => {
      this.cancelTimer = null;
      void this.flush();
    }, this.opts.flushAfterMs ?? 10_000);
  }

  private cancel(): void {
    this.cancelTimer?.();
    this.cancelTimer = null;
  }
}
