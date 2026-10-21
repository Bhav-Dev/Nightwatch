/**
 * Turns a phone screenshot into the hero's images in public/screens/:
 *
 *   node scripts/make-screens.mjs <screenshot.png> [--top <px>] [--name morning]
 *
 * --top trims that many pixels off the top, which removes the status bar (the time, the
 * battery and any notification icons): about 120 on the Samsung S24 Ultra, about 160 on an
 * iPhone 16 Pro. The hero's frame draws no status bar of its own.
 *
 * Writes <name>-320.webp, <name>-640.webp, <name>-960.webp (1x, 2x, 3x for a 320 px wide screen)
 * and <name>-640.jpg for browsers without WebP, and prints the size to put in PhoneMorning.astro.
 */
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const args = process.argv.slice(2);
const source = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
if (!source) {
  console.error('usage: node scripts/make-screens.mjs <screenshot.png> [--top <px>] [--name morning]');
  process.exit(1);
}
const top = Number(flag('top', '0'));
const name = flag('name', 'morning');
const outDir = fileURLToPath(new URL('../public/screens/', import.meta.url));
await mkdir(outDir, { recursive: true });

const { width, height } = await sharp(source).metadata();
const cropped = sharp(source).extract({ left: 0, top, width, height: height - top });

for (const w of [320, 640, 960]) {
  await cropped.clone().resize({ width: w }).webp({ quality: 82 }).toFile(`${outDir}${name}-${w}.webp`);
}
await cropped.clone().resize({ width: 640 }).jpeg({ quality: 80, mozjpeg: true }).toFile(`${outDir}${name}-640.jpg`);

console.log(`wrote public/screens/${name}-{320,640,960}.webp and ${name}-640.jpg`);
console.log(`aspect ratio for PhoneMorning.astro: ${width} / ${height - top}`);
