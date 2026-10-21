/**
 * The doctor's report as HTML, rendered to PDF on the phone (expo-print). Worded as a
 * screening summary to discuss with a GP: no diagnosis, no treatment advice. It prints on white
 * paper in the app's colours: night indigo for structure, honey for what to look at.
 */
import { APP_NAME } from '../brand';
import { PITCH_WORDS, pitchHzWords, type ProfilePitch } from '../domain/pitch';
import { scoreLabel } from '../domain/scoring';
import { RATING_WORDS, type Rating } from '../domain/snoreProfile';
import { logoArt } from '../ui/logoArt';

export interface ReportNight {
  date: string;
  score: number;
  pctSnoring: number;
  timeInBedS: number;
  partial: boolean;
  events: { quiet: number; light: number; loud: number; epic: number };
  spo2Dips: number | null;
  spo2Min: number | null;
}

export interface ReportComparison {
  name: string;
  nightsWith: number;
  nightsWithout: number;
  /** Mean score with minus without; null below 5 nights a side. */
  difference: number | null;
}

export interface ReportData {
  from: string;
  to: string;
  generatedAt: Date;
  nights: ReportNight[];
  factors: ReportComparison[];
  remedies: ReportComparison[];
  profile: { ageBand: string | null; pausesReported: string | null };
  /** The snore profile, from every night on the phone (not only this period). */
  snoreProfile?: { pitch: ProfilePitch; areas: { name: string; rating: Rating; evidence: string[] }[] } | null;
  /** Heavy breathing heard in this period: nights looked at, nights with some, minutes in all. */
  breathing?: { checkedNights: number; nights: number; minutes: number } | null;
}

export const REPORT_HEADER = `Consumer app summary, not a clinical test. ${APP_NAME} estimates snoring from a phone microphone and, where shared, a smartwatch. It does not diagnose any condition. These are patterns to discuss with your doctor.`;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const fmt1 = (x: number) => (Math.round(x * 10) / 10).toString();
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2026-09-01" as "1 Sep". */
const shortDate = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1] ?? ''}`;

/** Score bands, from lavender (quiet) through honey to deep amber (epic): readable on paper. */
const BAND_COLOUR: Record<string, string> = { Quiet: '#C9CDEE', Light: '#F2D58E', Moderate: '#E9B456', Loud: '#D88A2C', Epic: '#A9581D' };
/** Episode loudness, the same honey ramp. */
const LOUDNESS = [
  { key: 'quiet', name: 'Quiet', colour: '#F3E3B5' },
  { key: 'light', name: 'Light', colour: '#EBC46E' },
  { key: 'loud', name: 'Loud', colour: '#D9962E' },
  { key: 'epic', name: 'Epic', colour: '#A8641A' },
] as const;

const gradient = (id: string, colours: readonly string[], [x1, y1, x2, y2]: readonly number[]) =>
  `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${colours
    .map((c, i) => `<stop offset="${i / (colours.length - 1)}" stop-color="${c}"/>`)
    .join('')}</linearGradient>`;

/** The logo, from the icon's own shapes: the moon over a sound wave in a honeycomb cell. */
function logoSvg(size: number): string {
  const { box, cell, glyph, moon, wave } = logoArt;
  const [x0, y0, x1, y1] = box;
  const [gx0, gy0, gx1, gy1] = glyph.box;
  return `<svg width="${Math.round((size * (x1 - x0)) / (y1 - y0))}" height="${size}" viewBox="${x0} ${y0} ${x1 - x0} ${y1 - y0}" aria-hidden="true">
<defs>${gradient('lc', cell.fill, cell.fillGradient)}${gradient('lh', cell.honey, cell.honeyGradient)}${gradient('lm', moon.colours, moon.gradient)}${gradient('lw', wave.colours, wave.gradient)}
<clipPath id="la"><path d="${logoArt.aboveWave}"/></clipPath></defs>
<path d="${cell.d}" fill="url(#lc)"/><path d="${cell.d}" fill="none" stroke="url(#lh)" stroke-width="${cell.stroke}" stroke-linejoin="round"/>
<g transform="translate(${glyph.cx} ${glyph.cy}) scale(${glyph.s}) translate(${-(gx0 + gx1) / 2} ${-(gy0 + gy1) / 2})"><path d="${moon.d}" fill="url(#lm)" clip-path="url(#la)"/><path d="${wave.d}" fill="none" stroke="url(#lw)" stroke-width="${wave.width}" stroke-linecap="round"/></g></svg>`;
}

/** Faint honeycomb for the header band. */
function combSvg(): string {
  const r = 22;
  const w = Math.sqrt(3) * r;
  const cells: string[] = [];
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 9; col++) {
      const cx = col * w + (row % 2 ? w / 2 : 0);
      const cy = row * 1.5 * r;
      cells.push(
        Array.from({ length: 6 }, (_, i) => {
          const a = (Math.PI / 180) * (60 * i - 90);
          return `${(cx + (r - 3) * Math.cos(a)).toFixed(1)},${(cy + (r - 3) * Math.sin(a)).toFixed(1)}`;
        }).join(' '),
      );
    }
  }
  return `<svg class="comb" width="330" height="140" viewBox="0 0 330 140" aria-hidden="true">${cells
    .map((p) => `<polygon points="${p}" fill="none" stroke="#F6C85F" stroke-opacity="0.16" stroke-width="1.5"/>`)
    .join('')}</svg>`;
}

function trendSvg(nights: ReportNight[], average: number | null): string {
  if (nights.length === 0) return '';
  const [w, h, left, right, top, bottom] = [700, 200, 34, 8, 10, 30];
  const slot = (w - left - right) / nights.length;
  const barW = Math.min(20, slot * 0.66);
  const y = (s: number) => top + (1 - s / 100) * (h - top - bottom);
  const grid = [0, 25, 50, 75, 100]
    .map((s) => `<line x1="${left}" x2="${w - right}" y1="${y(s)}" y2="${y(s)}" stroke="#E6E5F0"/><text x="${left - 8}" y="${y(s) + 3.5}" text-anchor="end" class="axis">${s}</text>`)
    .join('');
  const every = Math.max(1, Math.ceil(nights.length / 7));
  const bars = nights
    .map((n, i) => {
      const cx = left + slot * (i + 0.5);
      const top_ = y(Math.max(n.score, 1));
      const fill = n.partial ? 'url(#hatch)' : BAND_COLOUR[scoreLabel(n.score)];
      const label = i % every === 0 || i === nights.length - 1 ? `<text x="${cx}" y="${h - 10}" text-anchor="middle" class="axis">${esc(shortDate(n.date))}</text>` : '';
      return `<rect x="${(cx - barW / 2).toFixed(1)}" y="${top_.toFixed(1)}" width="${barW.toFixed(1)}" height="${(y(0) - top_).toFixed(1)}" rx="3" fill="${fill}"/>${label}`;
    })
    .join('');
  const avg =
    average === null
      ? ''
      : `<line x1="${left}" x2="${w - right}" y1="${y(average)}" y2="${y(average)}" stroke="#262B70" stroke-width="1.5" stroke-dasharray="5 4"/><text x="${w - right}" y="${y(average) - 5}" text-anchor="end" class="avg">Average ${Math.round(average)}</text>`;
  return `<svg width="100%" viewBox="0 0 ${w} ${h}" role="img" aria-label="Snore score by night">
<defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#EEEDF6"/><line x1="0" y1="0" x2="0" y2="6" stroke="#B9BCD8" stroke-width="2.5"/></pattern></defs>
${grid}${bars}${avg}</svg>`;
}

function difference(d: number | null): string {
  if (d === null) return '<span class="muted">Not enough nights</span>';
  const cls = d < 0 ? 'lower' : d > 0 ? 'higher' : '';
  return `<span class="diff ${cls}">${d > 0 ? '+' : ''}${fmt1(d)}</span>`;
}

const nightsWord = (n: number) => `${n} ${n === 1 ? 'night' : 'nights'}`;

/** The snore profile and heavy breathing, worded as clues for discussion, never as findings. */
function profileSection(d: ReportData): string {
  const p = d.snoreProfile;
  const b = d.breathing;
  if (!p && !b) return '';
  const pitch = p
    ? p.pitch.band
      ? `<p>Pitch of the snoring: <b>${esc(PITCH_WORDS[p.pitch.band].short)}</b>, ${esc(pitchHzWords(p.pitch.hz))}, from ${nightsWord(p.pitch.nights)}${
          p.pitch.spread.length > 1 ? ` (${p.pitch.spread.map((s) => `${esc(PITCH_WORDS[s.band].short)} on ${nightsWord(s.nights)}`).join(', ')})` : ''
        }.</p>`
      : '<p class="muted">Not enough nights with a measured pitch yet.</p>'
    : '';
  const areas = p
    ? `<table class="data"><thead><tr><th>What changed the snoring</th><th>Effect</th><th>Based on</th></tr></thead><tbody>${p.areas
        .map((a) => `<tr><td>${esc(a.name)}</td><td>${esc(RATING_WORDS[a.rating])}</td><td>${a.evidence.length ? esc(a.evidence[0]) : '<span class="muted">Nothing logged</span>'}</td></tr>`)
        .join('')}</tbody></table>`
    : '';
  const breathing =
    b && b.checkedNights > 0
      ? `<p>Heavy breathing (loud breathing not counted as snoring) was heard on ${b.nights} of ${nightsWord(b.checkedNights)} in this period${
          b.minutes > 0 ? `, ${b.minutes} ${b.minutes === 1 ? 'minute' : 'minutes'} in all` : ''
        }.</p>`
      : '';
  return `<section>
<h2>Snore profile</h2>
${pitch}${areas}${breathing}
<p class="note">Clues from the user's own nights, for discussion. The pitch is the strongest frequency of the snoring as a phone heard it, which is approximate; research has associated lower peak frequencies with snoring from the soft palate and higher ones with snoring from the tongue base. None of this shows where the snoring comes from.${
    p ? ' The profile uses every night recorded on the phone, not only this period.' : ''
  }</p>
</section>`;
}

function comparisonTable(rows: ReportComparison[]): string {
  if (rows.length === 0) return '<p class="muted">Nothing logged in this period.</p>';
  return `<table class="data"><thead><tr><th>Logged</th><th class="num">Nights with</th><th class="num">Nights without</th><th class="num">Average score difference</th></tr></thead><tbody>${rows
    .map((r) => `<tr><td>${esc(r.name)}</td><td class="num">${r.nightsWith}</td><td class="num">${r.nightsWithout}</td><td class="num">${difference(r.difference)}</td></tr>`)
    .join('')}</tbody></table>`;
}

const STYLE = `
@page{size:A4;margin:14mm}
*{box-sizing:border-box}
html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{font-family:-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#1C1F3B;margin:0;font-size:11.5px;line-height:1.5}
@media screen{body{max-width:780px;margin:0 auto;padding:24px}}
.band{position:relative;overflow:hidden;background:linear-gradient(120deg,#1E2459,#383690);color:#F4F1FF;border-radius:14px;padding:18px 22px;display:flex;justify-content:space-between;align-items:center}
.band .comb{position:absolute;right:-20px;top:-12px}
.brand{display:flex;align-items:center;gap:10px;position:relative}
.word{font-size:22px;font-weight:800;letter-spacing:-0.2px}.word span{color:#F6C85F}
.heading{text-align:right;position:relative}
.heading h1{font-size:17px;margin:0;font-weight:800}
.heading .range{color:#D9DCF5;margin-top:2px}.heading .gen{color:#AAB1D6;font-size:10.5px}
.notice{background:#FFF5DC;border-left:4px solid #E9A23F;border-radius:8px;padding:9px 12px;margin:14px 0 4px;color:#4A3B1C}
h2{font-size:13px;margin:22px 0 8px;color:#262B70;font-weight:800;display:flex;align-items:center;gap:7px}
h2::before{content:"";width:10px;height:11px;background:#E9A23F;clip-path:polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%)}
section{break-inside:avoid}
.tiles{display:flex;gap:10px;margin-top:14px}
.tile{flex:1;background:#F4F3FB;border-radius:10px;padding:10px 12px}
.tile .big{font-size:22px;font-weight:800;color:#262B70;line-height:1.15}
.tile .small{color:#5B6080;font-size:10.5px}
.tile .tag{display:inline-block;margin-left:4px;font-size:10px;font-weight:700;color:#8A5A12;background:#FBE7B8;border-radius:99px;padding:1px 7px;vertical-align:middle}
.axis{font-size:10px;fill:#7A7F9E}.avg{font-size:10px;fill:#262B70;font-weight:700}
.legend{display:flex;flex-wrap:wrap;gap:12px;color:#5B6080;font-size:10.5px;margin-top:4px}
.legend i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:4px;vertical-align:-1px}
.stack{display:flex;height:16px;border-radius:8px;overflow:hidden;background:#F4F3FB;margin:4px 0 8px}
table{border-collapse:collapse;width:100%}
th,td{text-align:left;padding:5px 8px}
th{font-size:10.5px;color:#5B6080;font-weight:700;border-bottom:1.5px solid #D9D8E8}
td{border-bottom:1px solid #EEEDF5}
.data tbody tr:nth-child(even) td{background:#FAFAFD}
.num{text-align:right}
.diff{font-weight:700}.diff.lower{color:#1F8F6A}.diff.higher{color:#C2513F}
.muted{color:#5B6080}
.two{display:flex;gap:18px}.two>div{flex:1}
.note{color:#5B6080;font-size:10.5px;margin-top:6px}
footer{margin-top:22px;padding-top:10px;border-top:1px solid #E6E5F0;color:#7A7F9E;font-size:10px;display:flex;justify-content:space-between}
`;

export function reportHtml(d: ReportData): string {
  const full = d.nights.filter((n) => !n.partial);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const totals = d.nights.reduce(
    (t, n) => ({ quiet: t.quiet + n.events.quiet, light: t.light + n.events.light, loud: t.loud + n.events.loud, epic: t.epic + n.events.epic }),
    { quiet: 0, light: 0, loud: 0, epic: 0 },
  );
  const allEpisodes = totals.quiet + totals.light + totals.loud + totals.epic;
  const withSpo2 = d.nights.filter((n) => n.spo2Dips !== null);
  const dipNights = withSpo2.filter((n) => (n.spo2Dips ?? 0) > 0).length;
  const half = Math.floor(full.length / 2);
  const firstHalf = avg(full.slice(0, half).map((n) => n.score));
  const secondHalf = avg(full.slice(half).map((n) => n.score));
  const averageScore = full.length ? avg(full.map((n) => n.score)) : null;
  const loudPerNight = full.length ? avg(full.map((n) => n.events.loud + n.events.epic)) : null;
  const userReported = [
    d.profile.pausesReported === 'yes' ? 'Someone has seen them stop breathing at night.' : null,
    d.profile.ageBand ? `Age band: ${esc(d.profile.ageBand)}.` : null,
  ].filter((x): x is string => x !== null);

  return `<!doctype html><html><head><meta charset="utf-8"><title>${APP_NAME} snoring summary</title><style>${STYLE}</style></head><body>
<div class="band">${combSvg()}
  <div class="brand">${logoSvg(40)}<div class="word">${APP_NAME === 'SnoreHive' ? 'Snore<span>Hive</span>' : esc(APP_NAME)}</div></div>
  <div class="heading"><h1>Snoring summary for your doctor</h1><div class="range">${esc(d.from)} to ${esc(d.to)}</div><div class="gen">Generated ${esc(
    d.generatedAt.toISOString().slice(0, 10),
  )}</div></div>
</div>
<div class="notice">${esc(REPORT_HEADER)}</div>

<section class="tiles">
  <div class="tile"><div class="big">${d.nights.length}</div><div class="small">nights recorded (${d.nights.length - full.length} partial)</div></div>
  <div class="tile"><div class="big">${averageScore === null ? '–' : Math.round(averageScore)}${
    averageScore === null ? '' : `<span class="tag">${scoreLabel(Math.round(averageScore))}</span>`
  }</div><div class="small">average snore score, 0 to 100</div></div>
  <div class="tile"><div class="big">${full.length ? Math.round(avg(full.map((n) => n.pctSnoring)) * 100) : '–'}%</div><div class="small">average time snoring</div></div>
  <div class="tile"><div class="big">${loudPerNight === null ? '–' : fmt1(loudPerNight)}</div><div class="small">loud or epic episodes a night</div></div>
</section>

<section>
<h2>Snore score by night</h2>
${trendSvg(d.nights, averageScore)}
<div class="legend">${Object.entries(BAND_COLOUR)
    .map(([name, colour]) => `<span><i style="background:${colour}"></i>${name}</span>`)
    .join('')}<span><i style="background:repeating-linear-gradient(45deg,#B9BCD8 0 2px,#EEEDF6 2px 5px)"></i>Partial night</span></div>
${full.length >= 4 ? `<p>Average score in the first half of the period: ${Math.round(firstHalf)}; second half: ${Math.round(secondHalf)}.</p>` : ''}
</section>

<section>
<h2>Snoring episodes by loudness</h2>
<div class="stack">${LOUDNESS.map((l) => (totals[l.key] ? `<div style="width:${((totals[l.key] / Math.max(1, allEpisodes)) * 100).toFixed(1)}%;background:${l.colour}"></div>` : '')).join('')}</div>
<table><thead><tr>${LOUDNESS.map((l) => `<th><i style="display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:4px;background:${l.colour}"></i>${l.name}</th>`).join('')}</tr></thead>
<tbody><tr><td>${totals.quiet}</td><td>${totals.light}</td><td>${totals.loud}</td><td>${totals.epic}</td></tr></tbody></table>
<p class="note">Loudness is measured relative to the room's background level on each night, not as an absolute sound level.</p>
</section>

<section class="two">
<div>
<h2>Oxygen saturation (from a smartwatch)</h2>
${
  withSpo2.length
    ? `<p>${dipNights} of ${withSpo2.length} nights with watch data had at least one dip below 90% lasting 10 seconds or more. Lowest reading: ${fmt1(
        Math.min(...withSpo2.map((n) => n.spo2Min ?? 100)),
      )}%.</p><p class="note">Consumer watch oxygen readings are approximate.</p>`
    : '<p class="muted">No watch oxygen data in this period.</p>'
}
</div>
<div>
<h2>Reported by the user</h2>
${userReported.length ? userReported.map((line) => `<p>${line}</p>`).join('') : '<p class="muted">Nothing reported.</p>'}
</div>
</section>

${profileSection(d)}

<section>
<h2>Lifestyle factors</h2>
${comparisonTable(d.factors)}
</section>

<section>
<h2>Remedies tried</h2>
${comparisonTable(d.remedies)}
<p class="note">Average score difference: nights with, minus nights without. Below zero means quieter; shown once there are at least 5 nights each way.</p>
</section>

<section>
<h2>Nightly detail</h2>
<table class="data"><thead><tr><th>Date</th><th class="num">Score</th><th class="num">Time snoring</th><th class="num">Time in bed</th><th class="num">Loud and epic episodes</th><th class="num">SpO2 dips</th></tr></thead><tbody>
${d.nights
  .map(
    (n) =>
      `<tr><td>${esc(n.date)}${n.partial ? ' <span class="muted">(partial)</span>' : ''}</td><td class="num">${n.score}</td><td class="num">${Math.round(n.pctSnoring * 100)}%</td><td class="num">${(
        n.timeInBedS / 3600
      ).toFixed(1)} h</td><td class="num">${n.events.loud + n.events.epic}</td><td class="num">${n.spo2Dips ?? '–'}</td></tr>`,
  )
  .join('')}
</tbody></table>
</section>

<footer><span>${APP_NAME} records sound on the user's phone and reports patterns. It is not a medical device.</span><span>${esc(d.from)} to ${esc(d.to)}</span></footer>
</body></html>`;
}
