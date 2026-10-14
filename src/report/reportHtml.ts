/**
 * The doctor's report as HTML, rendered to PDF on the phone (expo-print). Worded as a
 * screening summary to discuss with a GP: no diagnosis, no treatment advice.
 */

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
}

export const REPORT_HEADER =
  'Consumer app summary, not a clinical test. Nightwatch estimates snoring from a phone microphone and, where shared, a smartwatch. It does not diagnose any condition. These are patterns to discuss with your doctor.';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const fmt1 = (x: number) => (Math.round(x * 10) / 10).toString();

function trendSvg(nights: ReportNight[]): string {
  if (nights.length === 0) return '';
  const w = 640;
  const h = 160;
  const pad = 28;
  const x = (i: number) => pad + (nights.length === 1 ? 0 : (i / (nights.length - 1)) * (w - 2 * pad));
  const y = (s: number) => h - pad - (s / 100) * (h - 2 * pad);
  const points = nights.map((n, i) => `${x(i).toFixed(1)},${y(n.score).toFixed(1)}`).join(' ');
  const grid = [0, 50, 100]
    .map((s) => `<line x1="${pad}" x2="${w - pad}" y1="${y(s)}" y2="${y(s)}" stroke="#ddd"/><text x="4" y="${y(s) + 4}" font-size="10" fill="#666">${s}</text>`)
    .join('');
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Snore score by night">${grid}<polyline points="${points}" fill="none" stroke="#1f3a8a" stroke-width="2"/>${nights
    .map((n, i) => `<circle cx="${x(i)}" cy="${y(n.score)}" r="3" fill="#1f3a8a"/>`)
    .join('')}</svg>`;
}

function comparisonRows(rows: ReportComparison[]): string {
  if (rows.length === 0) return '<p class="muted">Nothing logged in this period.</p>';
  return `<table><thead><tr><th>Logged</th><th>Nights with</th><th>Nights without</th><th>Average score difference</th></tr></thead><tbody>${rows
    .map(
      (r) =>
        `<tr><td>${esc(r.name)}</td><td>${r.nightsWith}</td><td>${r.nightsWithout}</td><td>${
          r.difference === null ? 'Not enough nights' : `${r.difference > 0 ? '+' : ''}${fmt1(r.difference)}`
        }</td></tr>`,
    )
    .join('')}</tbody></table>`;
}

export function reportHtml(d: ReportData): string {
  const full = d.nights.filter((n) => !n.partial);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const totals = d.nights.reduce(
    (t, n) => ({ quiet: t.quiet + n.events.quiet, light: t.light + n.events.light, loud: t.loud + n.events.loud, epic: t.epic + n.events.epic }),
    { quiet: 0, light: 0, loud: 0, epic: 0 },
  );
  const withSpo2 = d.nights.filter((n) => n.spo2Dips !== null);
  const dipNights = withSpo2.filter((n) => (n.spo2Dips ?? 0) > 0).length;
  const half = Math.floor(full.length / 2);
  const firstHalf = avg(full.slice(0, half).map((n) => n.score));
  const secondHalf = avg(full.slice(half).map((n) => n.score));

  return `<!doctype html><html><head><meta charset="utf-8"><title>Nightwatch screening summary</title>
<style>
body{font-family:-apple-system,Helvetica,Arial,sans-serif;color:#111;margin:32px;font-size:12px;line-height:1.45}
h1{font-size:20px;margin:0 0 4px}h2{font-size:14px;margin:20px 0 6px;border-bottom:1px solid #ccc;padding-bottom:3px}
.notice{border:1px solid #999;background:#f5f5f5;padding:8px 10px;margin:12px 0}
.muted{color:#555}table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid #e3e3e3;text-align:left;padding:4px 6px}
.grid{display:flex;gap:24px}.grid div{flex:1}.big{font-size:18px;font-weight:700}
</style></head><body>
<h1>Snoring screening summary</h1>
<div class="muted">${esc(d.from)} to ${esc(d.to)} · generated ${esc(d.generatedAt.toISOString().slice(0, 10))}</div>
<div class="notice">${esc(REPORT_HEADER)}</div>

<h2>Overview</h2>
<div class="grid">
<div><div class="big">${d.nights.length}</div>nights recorded (${d.nights.length - full.length} partial)</div>
<div><div class="big">${full.length ? Math.round(avg(full.map((n) => n.score))) : '–'}</div>average snore score (0 to 100)</div>
<div><div class="big">${full.length ? Math.round(avg(full.map((n) => n.pctSnoring)) * 100) : '–'}%</div>average time snoring</div>
</div>

<h2>Snore score by night</h2>
${trendSvg(d.nights)}
${full.length >= 4 ? `<p>Average score in the first half of the period: ${Math.round(firstHalf)}; second half: ${Math.round(secondHalf)}.</p>` : ''}

<h2>Snoring episodes by loudness</h2>
<table><thead><tr><th>Quiet</th><th>Light</th><th>Loud</th><th>Epic</th></tr></thead>
<tbody><tr><td>${totals.quiet}</td><td>${totals.light}</td><td>${totals.loud}</td><td>${totals.epic}</td></tr></tbody></table>
<p class="muted">Loudness is measured relative to the room's background level on each night, not as an absolute sound level.</p>

<h2>Oxygen saturation (from a smartwatch)</h2>
${
  withSpo2.length
    ? `<p>${dipNights} of ${withSpo2.length} nights with watch data had at least one dip below 90% lasting 10 seconds or more. Lowest reading: ${fmt1(
        Math.min(...withSpo2.map((n) => n.spo2Min ?? 100)),
      )}%.</p><p class="muted">Consumer watch oxygen readings are approximate.</p>`
    : '<p class="muted">No watch oxygen data in this period.</p>'
}
${d.profile.pausesReported === 'yes' ? '<p>The user reports that someone has seen them stop breathing at night.</p>' : ''}

<h2>Lifestyle factors</h2>
${comparisonRows(d.factors)}

<h2>Remedies tried</h2>
${comparisonRows(d.remedies)}

<h2>Nightly detail</h2>
<table><thead><tr><th>Date</th><th>Score</th><th>Time snoring</th><th>Time in bed</th><th>Loud and epic episodes</th><th>SpO2 dips</th></tr></thead><tbody>
${d.nights
  .map(
    (n) =>
      `<tr><td>${esc(n.date)}${n.partial ? ' (partial)' : ''}</td><td>${n.score}</td><td>${Math.round(n.pctSnoring * 100)}%</td><td>${(n.timeInBedS / 3600).toFixed(1)} h</td><td>${
        n.events.loud + n.events.epic
      }</td><td>${n.spo2Dips ?? '–'}</td></tr>`,
  )
  .join('')}
</tbody></table>
<p class="muted">Nightwatch records sound on the user's phone and reports patterns. It is not a medical device.</p>
</body></html>`;
}
