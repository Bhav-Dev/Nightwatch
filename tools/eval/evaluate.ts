/// <reference types="node" />
import * as fs from 'node:fs';
import * as path from 'node:path';

import { proposeFromWav } from '../labelling/propose';
import {
  loadManifest,
  parseLabels,
  parsePredictions,
  readJson,
  volunteerSplitConflicts,
  type Manifest,
  type Predictions,
  type Split,
} from './manifest';
import { evaluateNight, fixed, pct, phase1Gate, poolNights, type GateResult, type NightMetrics } from './metrics';

export interface EvaluateOptions {
  /** Which nights to score; the Phase 1 gate is defined on 'heldout'. */
  split: Split | 'all';
  /** Directory of `<night id>.json` predictions; overrides the manifest and the built-in detector. */
  predictionsDir?: string;
  /** Called for the built-in detector so the CLI can show progress on long nights. */
  onProgress?: (message: string) => void;
}

export interface NightReport extends NightMetrics {
  id: string;
  volunteer: string;
  detector: string;
  predictionsFrom: string;
  durationS: number;
}

export interface EvaluationReport {
  split: Split | 'all';
  nights: NightReport[];
  pooled: NightMetrics;
  gate: GateResult;
  warnings: string[];
}

function predictionsFor(night: Manifest['nights'][number], dir: string, opts: EvaluateOptions): { p: Predictions; from: string } {
  if (opts.predictionsDir) {
    const file = path.join(opts.predictionsDir, `${night.id}.json`);
    if (!fs.existsSync(file)) throw new Error(`${night.id}: no predictions at ${file}`);
    return { p: parsePredictions(readJson(file), file), from: file };
  }
  if (night.predictions) {
    const file = path.resolve(dir, night.predictions);
    return { p: parsePredictions(readJson(file), file), from: file };
  }
  if (night.wav) {
    const file = path.resolve(dir, night.wav);
    if (!fs.existsSync(file)) {
      throw new Error(`${night.id}: recording ${file} is missing and the night has no predictions file`);
    }
    opts.onProgress?.(`${night.id}: running the built-in detector on ${path.basename(file)}`);
    const p = proposeFromWav(file, { includeLevels: false });
    return { p, from: file };
  }
  throw new Error(`${night.id}: needs a wav or a predictions file (or pass --predictions <dir>)`);
}

export function evaluateManifest(manifest: Manifest, dir: string, opts: EvaluateOptions): EvaluationReport {
  const conflicts = volunteerSplitConflicts(manifest);
  if (conflicts.length > 0) {
    throw new Error(`volunteers in both train and held-out: ${conflicts.join(', ')}; fix the manifest before evaluating`);
  }
  const selected = manifest.nights.filter((n) => opts.split === 'all' || n.split === opts.split);
  if (selected.length === 0) throw new Error(`no nights with split "${opts.split}" in the manifest`);

  const warnings: string[] = [];
  const nights: NightReport[] = selected.map((night) => {
    const labelsFile = path.resolve(dir, night.labels);
    const labels = parseLabels(readJson(labelsFile), labelsFile);
    const { p, from } = predictionsFor(night, dir, opts);
    if (p.durationS !== undefined && Math.abs(p.durationS - labels.durationS) > 1) {
      warnings.push(`${night.id}: predictions cover ${p.durationS.toFixed(0)} s but labels cover ${labels.durationS.toFixed(0)} s`);
    }
    if (p.source && labels.source && p.source !== labels.source) {
      warnings.push(`${night.id}: predictions are for "${p.source}" but labels are for "${labels.source}"`);
    }
    return {
      id: night.id,
      volunteer: night.volunteer,
      detector: p.detector,
      predictionsFrom: from,
      durationS: labels.durationS,
      ...evaluateNight(labels.events, p.regions, labels.durationS),
    };
  });

  const detectors = new Set(nights.map((n) => n.detector));
  if (detectors.size > 1) warnings.push(`predictions come from more than one detector: ${[...detectors].join(', ')}`);

  const pooled = poolNights(nights);
  return { split: opts.split, nights, pooled, gate: phase1Gate(pooled), warnings };
}

export function formatReport(r: EvaluationReport): string {
  const rows = [
    ['night', 'volunteer', 'hours', 'frame P', 'frame R', 'frame F1', 'events', 'matched', 'agreement', 'event P'],
    ...r.nights.map((n) => [
      n.id,
      n.volunteer,
      (n.durationS / 3600).toFixed(1),
      fixed(n.frame.precision),
      fixed(n.frame.recall),
      fixed(n.frame.f1),
      String(n.event.labelled),
      String(n.event.matchedLabelled),
      pct(n.event.agreement),
      pct(n.event.precision),
    ]),
  ];
  const p = r.pooled;
  rows.push([
    'pooled',
    String(new Set(r.nights.map((n) => n.volunteer)).size),
    (r.nights.reduce((s, n) => s + n.durationS, 0) / 3600).toFixed(1),
    fixed(p.frame.precision),
    fixed(p.frame.recall),
    fixed(p.frame.f1),
    String(p.event.labelled),
    String(p.event.matchedLabelled),
    pct(p.event.agreement),
    pct(p.event.precision),
  ]);
  const widths = rows[0].map((_, c) => Math.max(...rows.map((row) => row[c].length)));
  const line = (row: string[]) => row.map((cell, c) => (c < 2 ? cell.padEnd(widths[c]) : cell.padStart(widths[c]))).join('  ');
  const out = [
    `Split: ${r.split}. Detector: ${[...new Set(r.nights.map((n) => n.detector))].join(', ')}`,
    '',
    line(rows[0]),
    ...rows.slice(1, -1).map(line),
    widths.map((w) => '-'.repeat(w)).join('  '),
    line(rows[rows.length - 1]),
    '',
  ];
  for (const w of r.warnings) out.push(`Warning: ${w}`);
  if (r.split !== 'heldout') out.push('Note: the Phase 1 gate is defined on held-out nights; this run is for information.');
  out.push(r.gate.pass ? 'Phase 1 gate: pass' : `Phase 1 gate: fail (${r.gate.reasons.join('; ')})`);
  return out.join('\n');
}

const USAGE = `Usage: npx tsx tools/eval/evaluate.ts <manifest.json> [--split heldout|train|all] [--predictions <dir>] [--json <report.json>]

Scores a detector against human labels. By default it runs the built-in detector
(heuristic v0) on each night's WAV, or reads the night's "predictions" file when set.
--predictions <dir> reads <night id>.json from that directory instead (any detector).
Exit codes: 0 gate passed, 1 gate failed, 2 bad input.`;

export function main(argv: string[]): number {
  const args = [...argv];
  const positional: string[] = [];
  const opts: EvaluateOptions = { split: 'heldout', onProgress: (m) => console.error(m) };
  let jsonOut: string | undefined;
  while (args.length > 0) {
    const a = args.shift()!;
    if (a === '--split') {
      const s = args.shift();
      if (s !== 'heldout' && s !== 'train' && s !== 'all') {
        console.error(USAGE);
        return 2;
      }
      opts.split = s;
    } else if (a === '--predictions') opts.predictionsDir = args.shift();
    else if (a === '--json') jsonOut = args.shift();
    else if (a === '--help' || a === '-h') {
      console.log(USAGE);
      return 0;
    } else positional.push(a);
  }
  if (positional.length !== 1) {
    console.error(USAGE);
    return 2;
  }
  const { manifest, dir } = loadManifest(positional[0]);
  const report = evaluateManifest(manifest, dir, opts);
  console.log(formatReport(report));
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(report, null, 2) + '\n');
  return report.gate.pass ? 0 : 1;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 2;
  }
}
