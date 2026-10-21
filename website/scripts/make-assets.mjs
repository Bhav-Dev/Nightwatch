/**
 * Makes the generated images in public/. Run it again only when a source changes:
 *
 *   node scripts/make-assets.mjs <Google's en_badge_web_generic.png> <Nunito[wght].ttf>
 *
 * Either path can be left out to skip the step that needs it. The Nunito TTF is only used to
 * draw the share card's text: https://github.com/google/fonts/tree/main/ofl/nunito
 *
 * - public/badges/google-play.png: Google's official badge with its transparent margin
 *   trimmed, so it lines up with the App Store badge. The badge itself is not altered.
 * - public/apple-touch-icon.png and public/favicon-32.png: the logo as PNGs.
 * - public/og.png: the 1200 x 630 card shown when a page is shared.
 *
 * Download the badge from https://play.google.com/intl/en_gb/badges/ (the PNG is the only
 * official format). The App Store badge (public/badges/app-store.svg) is Apple's own SVG from
 * https://developer.apple.com/app-store/marketing/guidelines/ and needs no processing.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const [googleBadge, nunitoTtf] = process.argv.slice(2);
const out = (name) => fileURLToPath(new URL(`../public/${name}`, import.meta.url));

if (googleBadge) {
  await sharp(googleBadge).trim().png().toFile(out('badges/google-play.png'));
  console.log('wrote public/badges/google-play.png');
}

const logo = await readFile(out('favicon.svg'));

await sharp(logo, { density: 400 }).resize(180, 180).flatten({ background: '#0B1026' }).png().toFile(out('apple-touch-icon.png'));
await sharp(logo, { density: 200 }).resize(32, 32).png().toFile(out('favicon-32.png'));
console.log('wrote public/apple-touch-icon.png, public/favicon-32.png');

if (!nunitoTtf) {
  console.log('no Nunito TTF given: kept the existing public/og.png');
  process.exit(0);
}

// The share card: night gradient, a faded honeycomb, the logo and the promise.
const W = 1200;
const H = 630;
const backdrop = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1E2459"/><stop offset="0.6" stop-color="#111639"/><stop offset="1" stop-color="#0B1026"/></linearGradient>
    <pattern id="comb" width="69.28" height="120" patternUnits="userSpaceOnUse">
      <path d="M34.64,0 L69.28,20 L69.28,60 L34.64,80 L0,60 L0,20 Z M34.64,80 L34.64,120" fill="none" stroke="#F6C85F" stroke-opacity="0.16" stroke-width="1.5" stroke-linejoin="round"/>
    </pattern>
    <radialGradient id="fade" cx="78%" cy="40%" r="65%"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
    <mask id="fadeMask"><rect width="${W}" height="${H}" fill="url(#fade)"/></mask>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#sky)"/>
  <rect width="${W}" height="${H}" fill="url(#comb)" mask="url(#fadeMask)"/>
</svg>`;

const text = (markup, font, width) =>
  sharp({ text: { text: markup, font, fontfile: nunitoTtf, width, rgba: true, dpi: 72, spacing: 6 } })
    .png()
    .toBuffer();

const wordmark = await text('<span foreground="#F4F1FF">SnoreHive</span>', 'Nunito ExtraBold 58', 600);
const headline = await text(
  '<span foreground="#F4F1FF">Find out what actually stops your snoring</span>',
  'Nunito ExtraBold 80',
  1000,
);
const line = await text(
  '<span foreground="#AAB1D6">Record every night free, and see what worked for people like you.</span>',
  'Nunito Bold 32',
  1040,
);
const mark = await sharp(logo, { density: 600 }).resize(120, 120).png().toBuffer();

await sharp(Buffer.from(backdrop))
  .composite([
    { input: mark, left: 80, top: 72 },
    { input: wordmark, left: 220, top: 98 },
    { input: headline, left: 80, top: 250 },
    { input: line, left: 80, top: 488 },
  ])
  .png()
  .toFile(out('og.png'));
console.log('wrote public/og.png');
