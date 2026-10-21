/**
 * The 10 analytics events from the spec, plus three for the morning review flow. Counts and flags only: no health values, no scores,
 * no remedy names, nothing that could identify a night. The sink is pluggable: release builds
 * with EXPO_PUBLIC_POSTHOG_KEY send to PostHog, anonymously, unless the person turns usage
 * counts off in Settings (usageAnalytics.ts); otherwise events go nowhere (or the console in
 * development).
 */
export type AnalyticsEvent =
  | { name: 'app_open' }
  | { name: 'onboarding_complete'; mic: boolean; notifications: boolean; health: boolean; contribute: boolean }
  | { name: 'recording_start' }
  | { name: 'recording_complete'; duration_band: '<3h' | '3-6h' | '6-9h' | '9h+'; partial: boolean }
  | { name: 'morning_viewed' }
  | { name: 'log_saved'; remedies: number; factors: number }
  | { name: 'contribution_toggled'; on: boolean }
  | { name: 'paywall_shown'; trigger: string }
  | { name: 'trial_started'; plan: 'yearly' | 'monthly' }
  | { name: 'subscription_converted'; plan: 'yearly' | 'monthly' }
  | { name: 'snoring_answered'; snoring: boolean; source: 'clip' | 'moment' }
  | { name: 'recap_opened' }
  | { name: 'review_asked' };

export type AnalyticsSink = (event: AnalyticsEvent) => void;

let sink: AnalyticsSink = __DEV__ ? (e) => console.log('[analytics]', e) : () => undefined;

export function setAnalyticsSink(s: AnalyticsSink): void {
  sink = s;
}

export function track(event: AnalyticsEvent): void {
  try {
    sink(event);
  } catch {
    // Analytics must never break the app.
  }
}

export function durationBand(seconds: number): '<3h' | '3-6h' | '6-9h' | '9h+' {
  const h = seconds / 3600;
  return h < 3 ? '<3h' : h < 6 ? '3-6h' : h < 9 ? '6-9h' : '9h+';
}
