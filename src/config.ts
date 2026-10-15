/**
 * Build-time configuration (EXPO_PUBLIC_* variables are inlined by Expo at build time).
 *
 * EXPO_PUBLIC_API_URL is the server's base URL without /v1, so the same app works against
 * either backend:
 *   VPS:      https://api.nightwatch.app
 *   Supabase: https://<project-ref>.supabase.co/functions/v1/nightwatch-api
 */
export const config = {
  apiUrl: (process.env.EXPO_PUBLIC_API_URL ?? '').replace(/\/$/, ''),
  googleIosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? '',
  googleAndroidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID ?? '',
  googleWebClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '',
  revenueCatIosKey: process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY ?? '',
  revenueCatAndroidKey: process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY ?? '',
  siteUrl: (process.env.EXPO_PUBLIC_SITE_URL ?? 'https://nightwatch.app').replace(/\/$/, ''),
  supportEmail: process.env.EXPO_PUBLIC_SUPPORT_EMAIL ?? 'support@nightwatch.app',
  /**
   * The development account (when no server is set) and the "unlock paid features" switches.
   * On in development builds, and in internal test builds whose eas.json profile sets
   * EXPO_PUBLIC_INTERNAL_BUILD=1 (preview), so overnight tests can run in release mode.
   * Never set it for production.
   */
  internalTools: __DEV__ || process.env.EXPO_PUBLIC_INTERNAL_BUILD === '1',
};
