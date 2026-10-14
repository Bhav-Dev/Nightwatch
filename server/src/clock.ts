/** Injected so tests can move time (session expiry, magic-link expiry, rate-limit windows). */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

/** yyyy-mm-dd in UTC. */
export const isoDate = (d: Date) => d.toISOString().slice(0, 10);
