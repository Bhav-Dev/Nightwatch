export type LandingTab = 'tonight' | 'morning';

/**
 * Tonight in the evening (from 6pm local), This Morning before 2pm if last night exists,
 * otherwise Tonight. A user override from Settings wins.
 */
export function landingTab(now: Date, hasLastNight: boolean, override?: LandingTab | null): LandingTab {
  if (override) return override;
  const hour = now.getHours();
  if (hour >= 18) return 'tonight';
  if (hour < 14 && hasLastNight) return 'morning';
  return 'tonight';
}
