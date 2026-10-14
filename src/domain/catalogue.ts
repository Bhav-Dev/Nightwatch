import bundled from '../../catalogue/catalogue.json';

export type CatalogueType = 'remedy' | 'factor';
export type CatalogueKind = 'device' | 'habit' | 'factor';

export interface CatalogueItem {
  id: string;
  type: CatalogueType;
  kind: CatalogueKind;
  category: string;
  name: string;
  article_md: string;
  /** Present only for product remedies that may carry a shop link. */
  link_url: string | null;
  /** Whether this item is a product that can carry a shop link at all. */
  shop: boolean;
  /** Allowed values for factors that carry a band (alcohol units). */
  value_options?: string[];
  active: boolean;
  version: number;
}

interface BundledItem {
  id: string;
  type: string;
  kind: string;
  category: string;
  name: string;
  shop: boolean;
  article_md: string;
  value_options?: string[];
}

export const BUNDLED_CATALOGUE_VERSION: number = bundled.version;

/** The catalogue shipped inside the app, used until the server copy has been fetched. */
export const bundledCatalogue: CatalogueItem[] = (bundled.items as BundledItem[]).map((item) => ({
  id: item.id,
  type: item.type as CatalogueType,
  kind: item.kind as CatalogueKind,
  category: item.category,
  name: item.name,
  article_md: item.article_md,
  link_url: null,
  shop: item.shop,
  value_options: item.value_options,
  active: true,
  version: bundled.version,
}));

/** Ids shown as chips on first use, before anything has been logged (Tonight, empty state). */
export const DEFAULT_REMEDY_CHIPS = [
  'side_sleeping',
  'nasal_strips',
  'mouth_tape',
  'anti_snore_pillow',
  'head_elevated',
  'no_alcohol_evening',
  'nasal_rinse',
  'humidifier',
];

export const DEFAULT_FACTOR_CHIPS = [
  'alcohol',
  'late_meal',
  'caffeine_late',
  'exercise',
  'congestion',
  'smoking',
  'sleep_aid',
  'very_tired',
];
