/**
 * Short forms of catalogue names for use inside sentences ("your alcohol nights", "your
 * side-sleeping nights"). Anything not listed uses its catalogue name in lower case.
 */
const SHORT: Record<string, string> = {
  alcohol: 'alcohol',
  late_meal: 'late-meal',
  caffeine_late: 'late-caffeine',
  exercise: 'exercise',
  congestion: 'blocked-nose',
  allergies: 'allergy',
  smoking: 'smoking',
  sleep_aid: 'sleep-aid',
  very_tired: 'very-tired',
  stress: 'stressful-day',
  travel: 'away-from-home',
  partner_absent: 'sleeping-alone',
  late_bedtime: 'late-bedtime',
  nap: 'nap',
  illness: 'unwell',
  side_sleeping: 'side-sleeping',
  head_elevated: 'head-raised',
  nasal_rinse: 'nasal-rinse',
  throat_exercises: 'throat-exercise',
  singing_didgeridoo: 'singing or playing',
  no_alcohol_evening: 'alcohol-free',
  early_dinner: 'early-dinner',
  weight_programme: 'weight-programme',
  steam_shower: 'steam',
  window_open: 'open-window',
  allergen_bedding: 'anti-allergen bedding',
  nasal_spray_decongestant: 'decongestant',
  mad_device: 'jaw device',
  tongue_retainer: 'tongue retainer',
};

export function shortLabel(id: string, name: string): string {
  return SHORT[id] ?? name.toLowerCase();
}
