/**
 * Amazon Associates links. Amazon is the only affiliate programme for now because it works
 * in every launch market. Links are built per marketplace from a search phrase (always) or a
 * marketplace-specific ASIN (when a product has been chosen). Prices are never shown in the
 * app: Associates rules forbid prices that are not pulled live.
 */

export const AMAZON_MARKETPLACES = {
  GB: 'www.amazon.co.uk',
  US: 'www.amazon.com',
  CA: 'www.amazon.ca',
  AU: 'www.amazon.com.au',
  IE: 'www.amazon.co.uk',
  DE: 'www.amazon.de',
  FR: 'www.amazon.fr',
  ES: 'www.amazon.es',
  IT: 'www.amazon.it',
  NL: 'www.amazon.nl',
  IN: 'www.amazon.in',
  JP: 'www.amazon.co.jp',
} as const;

export type AmazonCountry = keyof typeof AMAZON_MARKETPLACES;

export interface AmazonProduct {
  /** Search phrase used when no ASIN is set for the marketplace, e.g. "nasal strips". */
  search: string;
  /** Marketplace-specific product ids, keyed by country. */
  asin?: Partial<Record<AmazonCountry, string>>;
}

/** Associates tracking ids per marketplace, e.g. { GB: "nightwatch-21" }. Served with the catalogue. */
export type AmazonTags = Partial<Record<AmazonCountry, string>>;

export const AMAZON_DISCLOSURE = 'As an Amazon Associate we earn from qualifying purchases.';
export const LINK_DISCLOSURE = 'We may earn a commission if you buy through this link.';

/** The marketplace for a region code, falling back to the UK store (launch market). */
export function marketplaceFor(region: string | null | undefined): AmazonCountry {
  const r = (region ?? '').toUpperCase();
  return r in AMAZON_MARKETPLACES ? (r as AmazonCountry) : 'GB';
}

/**
 * The shop link for a product in the user's region, or null when that marketplace has no
 * tracking id configured (no untagged links are ever shown).
 */
export function amazonUrl(product: AmazonProduct, region: string | null | undefined, tags: AmazonTags): string | null {
  const country = marketplaceFor(region);
  const tag = tags[country];
  if (!tag) return null;
  const host = AMAZON_MARKETPLACES[country];
  const asin = product.asin?.[country];
  const t = encodeURIComponent(tag);
  return asin
    ? `https://${host}/dp/${encodeURIComponent(asin)}?tag=${t}`
    : `https://${host}/s?k=${encodeURIComponent(product.search)}&tag=${t}`;
}
