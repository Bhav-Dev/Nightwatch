/**
 * The honeycomb cell: a pointy-top hexagon with softly rounded corners, the app's own shape.
 */

/** The cell drawn in a 100 x 115.4 box, used for badges, numbers and icons. */
export const CELL_VIEWBOX = '0 0 100 115.4';
export const CELL_PATH =
  'M42.5,8.0 Q50.0,3.7 57.5,8.0 L89.3,26.4 Q96.8,30.7 96.8,39.3 L96.8,76.1 Q96.8,84.7 89.3,89.0 L57.5,107.4 Q50.0,111.7 42.5,107.4 L10.7,89.0 Q3.2,84.7 3.2,76.1 L3.2,39.3 Q3.2,30.7 10.7,26.4Z';

/** The logo's cell, in a 100 x 100 box. */
export const LOGO_PATH =
  'M43.9,9.5 Q50.0,6.0 56.1,9.5 L82.0,24.5 Q88.1,28.0 88.1,35.0 L88.1,65.0 Q88.1,72.0 82.0,75.5 L56.1,90.5 Q50.0,94.0 43.9,90.5 L18.0,75.5 Q11.9,72.0 11.9,65.0 L11.9,35.0 Q11.9,28.0 18.0,24.5Z';

const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * A rounded pointy-top hexagon centred on (cx, cy) with corner radius r (centre to corner).
 * `round` is how far along each side the corner curve starts, as a share of r.
 */
export function roundedHex(cx: number, cy: number, r: number, round = 0.158): string {
  const corners = Array.from({ length: 6 }, (_, i) => {
    const a = ((-90 + i * 60) * Math.PI) / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  });
  const t = round;
  const toward = (from: number[], to: number[]) => [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t];
  let d = '';
  corners.forEach((c, i) => {
    const prev = corners[(i + 5) % 6];
    const next = corners[(i + 1) % 6];
    const a = toward(c, prev);
    const b = toward(c, next);
    d += `${i === 0 ? 'M' : 'L'}${r1(a[0])},${r1(a[1])} Q${r1(c[0])},${r1(c[1])} ${r1(b[0])},${r1(b[1])} `;
  });
  return `${d.trim()}Z`;
}
