/**
 * Draws the SnoreHive logo, a crescent moon over a sound wave inside a honeycomb cell, and renders
 * every icon file from it: the iOS light, dark and tinted icons, the Android adaptive layers and
 * themed icon, the notification icon, the splash image, the store icon and favicon, the separate
 * layers for Apple's Icon Composer, the shapes the app draws its logo from, and a preview sheet.
 * Run `npm run icons` after changing anything here.
 *
 * Everything is drawn on a 1024 canvas. Each target places the same drawing with its own scale:
 * Android crops the outer third of its icons, so the cell sits further in there.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { Resvg } from '@resvg/resvg-js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const S = 1024;
const f = (n) => String(Math.round(n * 10) / 10);

const COLOUR = {
  sky: ['#222970', '#383690'],
  /** The faint honeycomb behind the cell. */
  comb: '#F6C85F',
  cell: ['#353C99', '#2A2F7F'],
  honey: ['#FFE9AE', '#F6C85F', '#E9A23F'],
  wave: ['#9C98EE', '#BAB6FA', '#8F8AE6'],
  moon: ['#FFF2C2', '#F7D990', '#F2B088'],
};
/** iOS dark mode: the same cell and moon on a night with the lights off. */
const DARK = { ...COLOUR, sky: ['#0B0D26', '#17183D'], cell: ['#1C2158', '#141845'], wave: ['#8985DC', '#A6A2EE', '#7F7AD4'] };
/** iOS tinted: greyscale, which iOS recolours with the tint the person picks. */
const TINTED = { ...COLOUR, sky: '#000000', comb: null, cell: null, honey: '#A0A0A0', moon: '#FFFFFF', wave: '#C8C8C8' };
/** Android themed icon and the notification icon: one colour, the shape is all that is used. */
const WHITE = { ...COLOUR, comb: null, cell: null, honey: '#FFFFFF', moon: '#FFFFFF', wave: '#FFFFFF' };

/** The wave: a gentle swell, two crests. */
const WAVE = { y: 630, amp: 32, length: 500, peakX: 280, width: 40 };
/** Where the wave starts and stops. */
const SHORT_WAVE = [205, 855];
/** The space between the moon and the wave, which hides the moon's lower edge. */
const GAP = 14;
/**
 * A crescent: the moon's edge, and a shadow ellipse that touches it at both horns, as a real
 * crescent does, so the horns come to points. `from` and `to` place the horns (degrees around the
 * centre, clockwise from the right); a larger `shadow` makes the ellipse smaller and the crescent
 * fuller.
 */
function crescent({ cx, cy, r, from, to, shadow }) {
  const rad = (d) => (d * Math.PI) / 180;
  const horn = (d) => `${f(cx + r * Math.cos(rad(d)))},${f(cy + r * Math.sin(rad(d)))}`;
  const toChord = r * Math.cos(rad((to - from) / 2));
  const along = Math.sqrt(r * r - (shadow * toChord * toChord) / (1 + shadow));
  const across = along / Math.sqrt(1 + shadow);
  const tilt = (from + to) / 2 + 90;
  return `M${horn(from)} A${r},${r} 0 1,0 ${horn(to)} A${f(along)},${f(across)} ${f(tilt)} 1,1 ${horn(from)}Z`;
}
/** The thick side faces the lower left and the lower horn just clears the wave. */
const MOON_SHAPE = { cx: 500, cy: 440, r: 235, from: -86, to: 16, shadow: 1.7 };
const MOON = crescent(MOON_SHAPE);
const MOON_GRADIENT = [430, 240, 610, 700];

/** The honeycomb cell: a pointy-topped hexagon with rounded corners, outlined in honey. */
const CELL = { cx: 512, cy: 512, r: 340, corner: 64, stroke: 30 };
/** The moon and wave sit in the cell at this scale, centred a little below the cell's centre. */
const GLYPH_IN_CELL = { s: 0.7, cx: 512, cy: 530 };

/** Placements: iOS shows the whole square; Android keeps the cell inside its safe zone. */
const IOS = { s: 1, dx: 0, dy: 0 };
const ANDROID = { s: 0.8, dx: 0, dy: 0 };

function hexPoints(cx, cy, r) {
  return Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 180) * (60 * i - 90);
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  });
}
/** A polygon with each corner rounded off over `rc` along both edges. */
function roundedPoly(pts, rc) {
  let d = '';
  pts.forEach((p, i) => {
    const toward = (q) => {
      const [dx, dy] = [q[0] - p[0], q[1] - p[1]];
      const len = Math.hypot(dx, dy);
      return [p[0] + (dx / len) * rc, p[1] + (dy / len) * rc];
    };
    const [a, b] = [toward(pts[(i + pts.length - 1) % pts.length]), toward(pts[(i + 1) % pts.length])];
    d += `${i ? ' L' : 'M'}${f(a[0])},${f(a[1])} Q${f(p[0])},${f(p[1])} ${f(b[0])},${f(b[1])}`;
  });
  return `${d}Z`;
}
const CELL_PATH = roundedPoly(hexPoints(CELL.cx, CELL.cy, CELL.r), CELL.corner);
/** The cell with its outline: the logo's own box. */
const CELL_BOX = [
  CELL.cx - (Math.sqrt(3) / 2) * CELL.r - CELL.stroke / 2,
  CELL.cy - CELL.r - CELL.stroke / 2,
  CELL.cx + (Math.sqrt(3) / 2) * CELL.r + CELL.stroke / 2,
  CELL.cy + CELL.r + CELL.stroke / 2,
].map((n) => Math.round(n));

function wavePath(x0, x1, { lift = 0 } = {}) {
  const k = (2 * Math.PI) / WAVE.length;
  const y = (x) => WAVE.y - lift - WAVE.amp * Math.cos(k * (x - WAVE.peakX));
  const slope = (x) => WAVE.amp * k * Math.sin(k * (x - WAVE.peakX));
  const n = Math.max(1, Math.round((x1 - x0) / (WAVE.length / 8)));
  const h = (x1 - x0) / n;
  let d = `M${f(x0)},${f(y(x0))}`;
  for (let i = 0; i < n; i++) {
    const a = x0 + i * h;
    const b = a + h;
    d += ` C${f(a + h / 3)},${f(y(a) + (slope(a) * h) / 3)} ${f(b - h / 3)},${f(y(b) - (slope(b) * h) / 3)} ${f(b)},${f(y(b))}`;
  }
  return d;
}
/** Everything above the wave, less the gap: the moon is cut off just above it. */
const ABOVE_WAVE = `${wavePath(0, S, { lift: WAVE.width / 2 + GAP })} L${S},0 L0,0Z`;
/** The moon and wave's own box: the wave's round ends, the moon's top horn. */
const GLYPH_BOX = [SHORT_WAVE[0] - WAVE.width / 2, 200, SHORT_WAVE[1] + WAVE.width / 2, WAVE.y + WAVE.amp + WAVE.width / 2];

function paint(id, colours, [x1, y1, x2, y2]) {
  if (typeof colours === 'string') return { def: '', fill: colours };
  const stops = colours.map((c, i) => `<stop offset="${f(i / (colours.length - 1))}" stop-color="${c}"/>`).join('');
  return {
    def: `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stops}</linearGradient>`,
    fill: `url(#${id})`,
  };
}

const place = ({ s, dx, dy }, inner) =>
  `<g transform="translate(${f(512 + dx)} ${f(512 + dy)}) scale(${s}) translate(-512 -512)">${inner}</g>`;
const inCell = (inner) =>
  `<g transform="translate(${GLYPH_IN_CELL.cx} ${GLYPH_IN_CELL.cy}) scale(${GLYPH_IN_CELL.s}) translate(${-(GLYPH_BOX[0] + GLYPH_BOX[2]) / 2} ${-(GLYPH_BOX[1] + GLYPH_BOX[3]) / 2})">${inner}</g>`;

// Layers, bottom to top.

function sky(p) {
  const g = paint('sky', p.sky, [0, 0, 0, 700]);
  return { defs: g.def, body: `<rect width="${S}" height="${S}" fill="${g.fill}"/>` };
}

/** A faint honeycomb across the background, strongest in the middle. */
function comb(p, opacity) {
  if (!p.comb) return { body: '' };
  const R = 74;
  const w = Math.sqrt(3) * R;
  const cells = [];
  for (let row = 0; row * 1.5 * R < S + R; row++) {
    for (let col = -1; col * w < S + w; col++) cells.push(`<path d="${roundedPoly(hexPoints(col * w + (row % 2 ? w / 2 : 0), row * 1.5 * R, R - 7), 12)}"/>`);
  }
  return {
    defs:
      '<radialGradient id="comb-fade" gradientUnits="userSpaceOnUse" cx="512" cy="512" r="560"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0.25"/></radialGradient>' +
      `<mask id="comb-mask"><rect width="${S}" height="${S}" fill="url(#comb-fade)"/></mask>`,
    body: `<g mask="url(#comb-mask)" fill="none" stroke="${p.comb}" stroke-opacity="${opacity}" stroke-width="4">${cells.join('')}</g>`,
  };
}

function cell(p, at) {
  const fill = p.cell ? paint('cell', p.cell, [0, 170, 0, 860]) : null;
  const line = paint('honey', p.honey, [300, 170, 720, 860]);
  return {
    defs: (fill ? fill.def : '') + line.def,
    body: place(
      at,
      (fill ? `<path d="${CELL_PATH}" fill="${fill.fill}"/>` : '') +
        `<path d="${CELL_PATH}" fill="none" stroke="${line.fill}" stroke-width="${CELL.stroke}" stroke-linejoin="round"/>`,
    ),
  };
}

function moon(p, at) {
  const g = paint('moon', p.moon, MOON_GRADIENT);
  return {
    defs: g.def + `<clipPath id="above-wave" clipPathUnits="userSpaceOnUse"><path d="${ABOVE_WAVE}"/></clipPath>`,
    body: place(at, inCell(`<path d="${MOON}" fill="${g.fill}" clip-path="url(#above-wave)"/>`)),
  };
}

function wave(p, at) {
  const line = paint('wave', p.wave, [0, 0, S, 0]);
  return {
    defs: line.def,
    body: place(at, inCell(`<path d="${wavePath(...SHORT_WAVE)}" fill="none" stroke="${line.fill}" stroke-width="${WAVE.width}" stroke-linecap="round"/>`)),
  };
}

function svg(layers) {
  const defs = layers.map((l) => l.defs ?? '').join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}"><defs>${defs}</defs>${layers.map((l) => l.body).join('')}</svg>`;
}

/** Scale and centre a box of the drawing to fill `size` of the canvas. */
function fit([x0, y0, x1, y1], size) {
  const s = Math.min(size / (x1 - x0), size / (y1 - y0));
  return { s, dx: -s * ((x0 + x1) / 2 - 512), dy: -s * ((y0 + y1) / 2 - 512) };
}
const mark = (p, at) => [cell(p, at), moon(p, at), wave(p, at)];

const DESIGNS = {
  ios: svg([sky(COLOUR), comb(COLOUR, 0.09), ...mark(COLOUR, IOS)]),
  iosDark: svg([sky(DARK), comb(DARK, 0.06), ...mark(DARK, IOS)]),
  iosTinted: svg([sky(TINTED), ...mark(TINTED, IOS)]),
  androidBackground: svg([sky(COLOUR), comb(COLOUR, 0.09)]),
  androidForeground: svg(mark(COLOUR, ANDROID)),
  androidMonochrome: svg(mark(WHITE, ANDROID)),
  notification: svg(mark(WHITE, fit(CELL_BOX, S * (88 / 96)))),
  // Android 12 and later crop the splash image to a circle two-thirds its width; the cell's corners fit inside.
  splash: svg(mark(COLOUR, { s: 0.92, dx: 0, dy: 0 })),
};

// Icon Composer layers, bottom to top, at full size.
const LAYERS = {
  '1-background': svg([sky(COLOUR), comb(COLOUR, 0.09)]),
  '2-cell': svg([cell(COLOUR, IOS)]),
  '3-moon': svg([moon(COLOUR, IOS)]),
  '4-wave': svg([wave(COLOUR, IOS)]),
};

// PNG output.

function render(design, size) {
  const image = new Resvg(design, { fitTo: { mode: 'width', value: size }, font: { loadSystemFonts: true } }).render();
  return { rgba: image.pixels, width: image.width, height: image.height, png: image.asPng() };
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** App Store icons must have no alpha channel, so the opaque icons are written as plain RGB. */
function rgbPng({ rgba, width, height }) {
  const row = width * 3;
  const raw = Buffer.alloc((row + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (row + 1)] = 4; // Paeth filter
    for (let x = 0; x < row; x++) {
      const px = Math.floor(x / 3);
      const value = rgba[(y * width + px) * 4 + (x % 3)];
      const left = x >= 3 ? rgba[(y * width + px - 1) * 4 + (x % 3)] : 0;
      const up = y > 0 ? rgba[((y - 1) * width + px) * 4 + (x % 3)] : 0;
      const upLeft = x >= 3 && y > 0 ? rgba[((y - 1) * width + px - 1) * 4 + (x % 3)] : 0;
      const guess = left + up - upLeft;
      const [dl, du, dul] = [Math.abs(guess - left), Math.abs(guess - up), Math.abs(guess - upLeft)];
      const predictor = dl <= du && dl <= dul ? left : du <= dul ? up : upLeft;
      raw[y * (row + 1) + 1 + x] = (value - predictor) & 0xff;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function write(path, data) {
  const full = join(ROOT, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, data);
  console.log(`${path} (${Math.round(data.length / 1024)} KB)`);
}

const opaque = (design, size) => rgbPng(render(design, size));
const clear = (design, size) => render(design, size).png;

const files = {
  'assets/icon.png': opaque(DESIGNS.ios, 1024),
  'assets/ios-icon-dark.png': opaque(DESIGNS.iosDark, 1024),
  'assets/ios-icon-tinted.png': opaque(DESIGNS.iosTinted, 1024),
  'assets/android-icon-background.png': opaque(DESIGNS.androidBackground, 1024),
  'assets/android-icon-foreground.png': clear(DESIGNS.androidForeground, 1024),
  'assets/android-icon-monochrome.png': clear(DESIGNS.androidMonochrome, 1024),
  'assets/notification-icon.png': clear(DESIGNS.notification, 96),
  'assets/splash-icon.png': clear(DESIGNS.splash, 1024),
  'assets/favicon.png': opaque(DESIGNS.ios, 48),
  'assets/store/play-store-icon.png': opaque(DESIGNS.ios, 512),
};
for (const [path, data] of Object.entries(files)) write(path, data);
write('assets/icon-src/icon.svg', DESIGNS.ios);
rmSync(join(ROOT, 'assets/icon-src/layers'), { recursive: true, force: true });
for (const [name, design] of Object.entries(LAYERS)) write(`assets/icon-src/layers/${name}.svg`, design);

// The same drawing for the app to show (src/ui/Logo.tsx), so the logo in the app matches the icon.
const art = {
  box: CELL_BOX,
  cell: { d: CELL_PATH, stroke: CELL.stroke, fill: COLOUR.cell, fillGradient: [0, 170, 0, 860], honey: COLOUR.honey, honeyGradient: [300, 170, 720, 860] },
  glyph: { ...GLYPH_IN_CELL, box: GLYPH_BOX },
  moon: { d: MOON, cx: MOON_SHAPE.cx, cy: MOON_SHAPE.cy, r: MOON_SHAPE.r, gradient: MOON_GRADIENT, colours: COLOUR.moon },
  aboveWave: ABOVE_WAVE,
  wave: { d: wavePath(...SHORT_WAVE), width: WAVE.width, gradient: [0, 0, S, 0], colours: COLOUR.wave },
};
write(
  'src/ui/logoArt.ts',
  `// Generated by scripts/make-icons.mjs (npm run icons) from the app icon's drawing. Do not edit.\n\nexport const logoArt = ${JSON.stringify(art, null, 2)
    .replace(/\[\s+([^[\]{}]*?)\s+\]/g, (_, items) => `[${items.split(/,\s+/).join(', ')}]`)
    .replace(/"(\w+)":/g, '$1:')
    .replace(/"/g, "'")} as const;\n`,
);

// Preview sheet: each icon as a phone would show it, on a light and a dark home screen.

const uri = (path) => `data:image/png;base64,${files[path].toString('base64')}`;
const FONT = 'font-family="Segoe UI, Helvetica, Arial, sans-serif"';
let clipId = 0;

function superellipse(cx, cy, size, n) {
  const pts = [];
  for (let i = 0; i < 96; i++) {
    const t = (i / 96) * 2 * Math.PI;
    const [c, s] = [Math.cos(t), Math.sin(t)];
    pts.push(`${f(cx + (size / 2) * Math.sign(c) * Math.abs(c) ** (2 / n))},${f(cy + (size / 2) * Math.sign(s) * Math.abs(s) ** (2 / n))}`);
  }
  return `<path d="M${pts.join(' L')}Z"/>`;
}

const SHAPES = {
  circle: (x, y, w) => `<circle cx="${x + w / 2}" cy="${y + w / 2}" r="${w / 2}"/>`,
  squircle: (x, y, w) => superellipse(x + w / 2, y + w / 2, w, 4),
  rounded: (x, y, w) => `<rect x="${x}" y="${y}" width="${w}" height="${w}" rx="${w * 0.16}"/>`,
  teardrop: (x, y, w) =>
    `<path d="M${x + w / 2},${y} A${w / 2},${w / 2} 0 0 1 ${x + w},${y + w / 2} L${x + w},${y + w} L${x + w / 2},${y + w} A${w / 2},${w / 2} 0 0 1 ${x},${y + w / 2} A${w / 2},${w / 2} 0 0 1 ${x + w / 2},${y}Z"/>`,
  ios: (x, y, w) => `<rect x="${x}" y="${y}" width="${w}" height="${w}" rx="${w * 0.2237}"/>`,
};

function clipped(shape, x, y, w, inner) {
  const id = `c${clipId++}`;
  return `<clipPath id="${id}">${SHAPES[shape](x, y, w)}</clipPath><g clip-path="url(#${id})">${inner}</g>`;
}

/** iOS: the whole square, rounded by the system. */
const iosTile = (path, x, y, w, extra = '') => clipped('ios', x, y, w, `<image href="${uri(path)}" x="${x}" y="${y}" width="${w}" height="${w}"${extra}/>`);

/** Android: the launcher shows the middle 72 of the 108 units, cut to its own shape. */
function androidTile(shape, x, y, w) {
  const full = (w * 108) / 72;
  const at = `x="${f(x - (full - w) / 2)}" y="${f(y - (full - w) / 2)}" width="${f(full)}" height="${f(full)}"`;
  return clipped(shape, x, y, w, `<image href="${uri('assets/android-icon-background.png')}" ${at}/><image href="${uri('assets/android-icon-foreground.png')}" ${at}/>`);
}

function themedTile(x, y, w, background, ink) {
  const full = (w * 108) / 72;
  const id = `ink${clipId++}`;
  const at = `x="${f(x - (full - w) / 2)}" y="${f(y - (full - w) / 2)}" width="${f(full)}" height="${f(full)}"`;
  return (
    `<mask id="${id}" maskUnits="userSpaceOnUse" x="${x}" y="${y}" width="${w}" height="${w}"><image href="${uri('assets/android-icon-monochrome.png')}" ${at}/></mask>` +
    clipped('circle', x, y, w, `<rect x="${x}" y="${y}" width="${w}" height="${w}" fill="${background}"/><rect x="${x}" y="${y}" width="${w}" height="${w}" fill="${ink}" mask="url(#${id})"/>`)
  );
}

const label = (x, y, text, colour, size = 20, anchor = 'middle') =>
  `<text x="${x}" y="${y}" ${FONT} font-size="${size}" fill="${colour}" text-anchor="${anchor}">${text}</text>`;

function panel(ox, dark) {
  const ink = dark ? '#E9E8F7' : '#2B2D45';
  const muted = dark ? '#9EA3C7' : '#5E6283';
  const out = [];
  out.push(`<rect x="${ox}" y="0" width="900" height="1240" fill="url(#${dark ? 'wall-dark' : 'wall-light'})"/>`);
  out.push(label(ox + 50, 64, dark ? 'Dark home screen' : 'Light home screen', ink, 30, 'start'));

  out.push(label(ox + 50, 124, 'iPhone', muted, 22, 'start'));
  const iosIcons = dark
    ? [
        ['assets/ios-icon-dark.png', 'Dark', ''],
        ['assets/ios-icon-tinted.png', 'Tinted (blue tint)', ' filter="url(#tint)"'],
      ]
    : [['assets/icon.png', 'Default', '']];
  iosIcons.forEach(([path, name, extra], i) => {
    const x = ox + 50 + i * 230;
    out.push(iosTile(path, x, 150, 180, extra), label(x + 90, 362, name, ink));
  });
  // Small: 60, 40 and 29 points, as on the home screen, in Spotlight and in Settings.
  const small = dark ? 'assets/ios-icon-dark.png' : 'assets/icon.png';
  const smallX = ox + (dark ? 520 : 290);
  [60, 40, 29].reduce((x, w) => {
    out.push(iosTile(small, x, 270 - w, w));
    return x + w + 20;
  }, smallX);
  out.push(label(smallX, 300, 'Small sizes', muted, 18, 'start'));

  out.push(label(ox + 50, 434, 'Android launcher shapes', muted, 22, 'start'));
  ['circle', 'squircle', 'rounded', 'teardrop'].forEach((shape, i) => {
    out.push(androidTile(shape, ox + 50 + i * 205, 460, 160));
  });

  out.push(label(ox + 50, 700, 'Android themed icon', muted, 22, 'start'));
  out.push(dark ? themedTile(ox + 50, 726, 160, '#2B3157', '#C5CEFF') : themedTile(ox + 50, 726, 160, '#DCE2FF', '#283A85'));
  out.push(label(ox + 130, 920, 'Themed', ink));

  out.push(label(ox + 300, 700, 'Notification', muted, 22, 'start'));
  out.push(`<rect x="${ox + 300}" y="726" width="350" height="72" rx="36" fill="${dark ? '#000000' : '#FFFFFF'}" opacity="0.85"/>`);
  out.push(
    `<mask id="note${dark ? 'd' : 'l'}" maskUnits="userSpaceOnUse" x="${ox + 320}" y="738" width="48" height="48"><image href="${uri('assets/notification-icon.png')}" x="${ox + 320}" y="738" width="48" height="48"/></mask>`,
    `<rect x="${ox + 320}" y="738" width="48" height="48" fill="${dark ? '#FFFFFF' : '#3A3F7A'}" mask="url(#note${dark ? 'd' : 'l'})"/>`,
    label(ox + 384, 772, 'Time to start tonight’s recording', ink, 15, 'start'),
  );

  if (!dark) {
    out.push(label(ox + 50, 1000, 'Android safe zone: the cell stays inside the dashed circle', muted, 18, 'start'));
    const [x, y, w] = [ox + 50, 1020, 200];
    out.push(
      `<image href="${uri('assets/android-icon-background.png')}" x="${x}" y="${y}" width="${w}" height="${w}"/>`,
      `<image href="${uri('assets/android-icon-foreground.png')}" x="${x}" y="${y}" width="${w}" height="${w}"/>`,
      `<circle cx="${x + w / 2}" cy="${y + w / 2}" r="${(w * 33) / 108}" fill="none" stroke="#FFFFFF" stroke-width="2" stroke-dasharray="6 5"/>`,
      `<circle cx="${x + w / 2}" cy="${y + w / 2}" r="${(w * 36) / 108}" fill="none" stroke="#FF9C8F" stroke-width="1.5"/>`,
    );
    out.push(label(ox + 280, 1080, 'White: 66 units, always shown', muted, 16, 'start'), label(ox + 280, 1106, 'Coral: 72 units, the edge of a circle icon', muted, 16, 'start'));
  } else {
    out.push(label(ox + 50, 1000, 'Splash', muted, 22, 'start'));
    out.push(`<rect x="${ox + 50}" y="1020" width="120" height="200" rx="18" fill="#0F1629"/>`);
    out.push(`<image href="${uri('assets/splash-icon.png')}" x="${ox + 70}" y="1080" width="80" height="80"/>`);
  }
  return out.join('');
}

// iOS tinting, roughly: the icon's brightness picks the shade of the tint colour.
const tintRows = [0x9d, 0xb4, 0xff].map((c) => [0.2126, 0.7152, 0.0722].map((w) => f((w * c * 1000) / 255) / 1000).join(' ') + ' 0 0');
const sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="1240" viewBox="0 0 1800 1240"><defs>
<linearGradient id="wall-light" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#EEEBF7"/><stop offset="1" stop-color="#CDD3EC"/></linearGradient>
<linearGradient id="wall-dark" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0E1124"/><stop offset="1" stop-color="#1D2140"/></linearGradient>
<filter id="tint" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="${tintRows.join(' ')} 0 0 0 1 0"/></filter>
</defs>${panel(0, false)}${panel(900, true)}</svg>`;
write('docs/icon-preview.png', render(sheet, 1800).png);
