import type MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ComponentProps } from 'react';

import type { CatalogueItem } from '../domain/catalogue';

export type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

/** An icon for every remedy and factor in the catalogue (Material Community Icons). */
const BY_ID: Record<string, IconName> = {
  nasal_strips: 'bandage',
  nasal_dilator: 'weather-windy',
  nasal_spray_saline: 'spray',
  nasal_spray_decongestant: 'spray-bottle',
  mouth_tape: 'emoticon-neutral-outline',
  chin_strap: 'face-man-profile',
  mad_device: 'tooth-outline',
  tongue_retainer: 'emoticon-tongue-outline',
  anti_snore_pillow: 'bed-outline',
  wedge_pillow: 'slope-uphill',
  positional_trainer: 'vibrate',
  tennis_ball: 'tennis-ball',
  humidifier: 'air-humidifier',
  air_purifier: 'air-purifier',
  throat_spray: 'bottle-tonic-plus-outline',
  cpap: 'lungs',
  side_sleeping: 'sleep',
  head_elevated: 'arrow-up-bold-outline',
  nasal_rinse: 'water-outline',
  throat_exercises: 'account-voice',
  singing_didgeridoo: 'trumpet',
  no_alcohol_evening: 'glass-cocktail-off',
  early_dinner: 'silverware-clean',
  weight_programme: 'scale-bathroom',
  steam_shower: 'shower-head',
  window_open: 'window-open-variant',
  allergen_bedding: 'bed-double-outline',
  alcohol: 'glass-wine',
  late_meal: 'silverware-fork-knife',
  caffeine_late: 'coffee',
  exercise: 'run',
  congestion: 'emoticon-sick-outline',
  allergies: 'flower-pollen-outline',
  smoking: 'smoking',
  sleep_aid: 'pill',
  very_tired: 'battery-low',
  stress: 'head-flash-outline',
  travel: 'bag-suitcase',
  partner_absent: 'account-outline',
  late_bedtime: 'clock-time-one-outline',
  nap: 'sofa-outline',
  illness: 'thermometer',
};

/** A remedy or factor added to the catalogue later gets its category's icon until it has its own. */
const BY_CATEGORY: Record<string, IconName> = {
  Nasal: 'weather-windy',
  'Mouth and jaw': 'tooth-outline',
  Position: 'bed-outline',
  Environment: 'home-outline',
  Throat: 'account-voice',
  Medical: 'medical-bag',
  Lifestyle: 'heart-outline',
  Health: 'medical-bag',
  Context: 'map-marker-outline',
};

export function iconFor(item: Pick<CatalogueItem, 'id' | 'category'>): IconName {
  if (item.id.startsWith('other:')) return 'pencil-outline';
  return BY_ID[item.id] ?? BY_CATEGORY[item.category] ?? 'hexagon-outline';
}
