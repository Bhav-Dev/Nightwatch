/**
 * Everything the site points at outside itself, in one place.
 */

/** The store listings. Neither is public yet: they open once the app is released. */
export const stores = {
  appStore: 'https://apps.apple.com/app/id6824668787',
  googlePlay: 'https://play.google.com/store/apps/details?id=com.threeft2.nightwatch',
  /** Set to true on launch day. While false, a line under the badges says they are coming soon. */
  live: false,
};

/** The app's URL scheme. Sign-in links hand over to `${appScheme}://auth?token=…`. */
export const appScheme = 'nightwatch';

/** How long a sign-in link lasts (the server's magicLinkTtlMinutes). */
export const signInLinkMinutes = 15;

/** Where people can write to us. Set PUBLIC_CONTACT_EMAIL when the domain's mailbox exists. */
export const contactEmail: string = import.meta.env.PUBLIC_CONTACT_EMAIL || 'hello@snorehive.example';

/**
 * Who is responsible for the data (the controller, under UK GDPR), for the privacy policy and terms.
 * Fill these in before launch: the registered company name and address, and the ICO registration
 * number once the data protection fee is paid.
 */
export const legal = {
  controller: import.meta.env.PUBLIC_LEGAL_NAME || '[Company name]',
  address: import.meta.env.PUBLIC_LEGAL_ADDRESS || '[Registered address]',
  icoNumber: import.meta.env.PUBLIC_ICO_NUMBER || '[ICO registration number]',
  /** The date the current privacy policy took effect. */
  privacyUpdated: '21 October 2026',
};

/** The Hive membership prices (decided 20 October 2026, see docs/tiers-plan.md). */
export const pricing = {
  yearly: 29.99,
  monthly: 4.99,
  trialDays: 7,
  currency: 'GBP',
};
