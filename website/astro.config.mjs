// @ts-check
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import { defineConfig } from 'astro/config';

/**
 * The site's address, used for canonical links, Open Graph tags, the sitemap and robots.txt.
 * SITE_URL wins when set. On Vercel, VERCEL_PROJECT_PRODUCTION_URL (set at build time, without
 * the protocol) gives the production domain with no setup. Local builds fall back to a
 * placeholder.
 */
const PLACEHOLDER_SITE = 'https://snorehive.example';
const vercelDomain = process.env.VERCEL_PROJECT_PRODUCTION_URL;
const site = (process.env.SITE_URL || (vercelDomain ? `https://${vercelDomain}` : PLACEHOLDER_SITE)).replace(/\/$/, '');

export default defineConfig({
  site,
  // URLs have no trailing slash (/methods), the form the app links to. vercel.json redirects
  // /methods/ to /methods to match.
  trailingSlash: 'never',
  // Astro 7 defaults to 'jsx' whitespace handling, which drops spaces between inline elements.
  compressHTML: true,
  // Left to itself, Vite looks for the nearest tsconfig.json and can walk up past website/ to the
  // app's tsconfig.json, which extends expo/tsconfig.base. Vercel installs only website/'s
  // packages, so that file is missing there and the build fails. Pin this folder's tsconfig.
  vite: { tsconfig: './tsconfig.json' },
  integrations: [
    mdx(),
    sitemap({
      filter: (page) => !/\/(auth|404)\/?$/.test(page),
    }),
  ],
});
