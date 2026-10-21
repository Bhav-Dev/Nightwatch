import type { APIRoute, GetStaticPaths } from 'astro';

import { alcohol } from '../../data/community';

/**
 * The figures behind each data article, as CSV for press and researchers. Articles only link
 * here once the figures are real (see `sample` in src/data/community.ts).
 */
export const getStaticPaths = (() => [{ params: { id: 'alcohol-and-snoring' } }]) satisfies GetStaticPaths;

export const GET: APIRoute = () => {
  const lines = [
    'section,group,value,nights',
    ...alcohol.byDrinks.map((d) => `average_score_by_drinks,${d.band},${d.score},${d.nights}`),
    ...alcohol.byHour.afterDrinks.map((v, i) => `share_of_hour_snoring_after_drinks,hour ${i + 1},${v},`),
    ...alcohol.byHour.noDrinks.map((v, i) => `share_of_hour_snoring_no_drinks,hour ${i + 1},${v},`),
    ...alcohol.groups.map((g) => `extra_points_by_group,"${g.label}",${g.points ?? ''},`),
  ];
  return new Response(`${lines.join('\n')}\n`, { headers: { 'Content-Type': 'text/csv; charset=utf-8' } });
};
