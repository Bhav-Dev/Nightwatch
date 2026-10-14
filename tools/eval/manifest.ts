/// <reference types="node" />
import * as fs from 'node:fs';
import * as path from 'node:path';

import type { Span } from './metrics';

export type Split = 'train' | 'heldout';

export interface ManifestNight {
  /** Unique, stable id; also names `<id>.json` in a --predictions directory. */
  id: string;
  volunteer: string;
  /** Absent until tools/eval/split.ts assigns it. */
  split?: Split;
  /** Path to the recording, relative to the manifest. Absent once the recording is deleted. */
  wav?: string;
  /** Path to labels.json from the labelling page, relative to the manifest. */
  labels: string;
  /** Optional path to a predictions JSON (proposals format) for this night. */
  predictions?: string;
}

export interface Manifest {
  version: 1;
  nights: ManifestNight[];
}

export interface Labels {
  version: 1;
  source: string;
  durationS: number;
  labeller: string;
  events: Span[];
}

export interface Predictions {
  version: 1;
  source?: string;
  durationS?: number;
  detector: string;
  regions: Span[];
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

function spans(x: unknown, what: string): Span[] {
  if (!Array.isArray(x)) throw new Error(`${what} must be an array`);
  return x.map((s, i) => {
    if (!isObj(s) || !isNum(s.startS) || !isNum(s.endS) || s.endS < s.startS || s.startS < 0) {
      throw new Error(`${what}[${i}] must be {startS, endS} with 0 ≤ startS ≤ endS`);
    }
    return { startS: s.startS, endS: s.endS };
  });
}

export function parseManifest(json: unknown): Manifest {
  if (!isObj(json) || json.version !== 1 || !Array.isArray(json.nights)) {
    throw new Error('manifest must be { version: 1, nights: [...] }');
  }
  const ids = new Set<string>();
  const nights = json.nights.map((n, i): ManifestNight => {
    if (!isObj(n) || typeof n.id !== 'string' || typeof n.volunteer !== 'string' || typeof n.labels !== 'string') {
      throw new Error(`nights[${i}] needs string id, volunteer and labels`);
    }
    if (ids.has(n.id)) throw new Error(`duplicate night id ${n.id}`);
    ids.add(n.id);
    if (n.split !== undefined && n.split !== 'train' && n.split !== 'heldout') {
      throw new Error(`nights[${i}].split must be "train" or "heldout"`);
    }
    const optStr = (k: string) => {
      if (n[k] !== undefined && typeof n[k] !== 'string') throw new Error(`nights[${i}].${k} must be a string`);
      return n[k] as string | undefined;
    };
    const night: ManifestNight = { id: n.id, volunteer: n.volunteer, labels: n.labels };
    if (n.split !== undefined) night.split = n.split;
    const wav = optStr('wav');
    if (wav !== undefined) night.wav = wav;
    const predictions = optStr('predictions');
    if (predictions !== undefined) night.predictions = predictions;
    return night;
  });
  return { version: 1, nights };
}

/** Volunteers that appear with more than one split. */
export function volunteerSplitConflicts(m: Manifest): string[] {
  const seen = new Map<string, Set<Split>>();
  for (const n of m.nights) {
    if (!n.split) continue;
    const s = seen.get(n.volunteer) ?? new Set<Split>();
    s.add(n.split);
    seen.set(n.volunteer, s);
  }
  return [...seen].filter(([, s]) => s.size > 1).map(([v]) => v);
}

export function parseLabels(json: unknown, where = 'labels'): Labels {
  if (!isObj(json) || json.version !== 1 || !isNum(json.durationS)) {
    throw new Error(`${where}: expected { version: 1, durationS, events }`);
  }
  return {
    version: 1,
    source: typeof json.source === 'string' ? json.source : '',
    durationS: json.durationS,
    labeller: typeof json.labeller === 'string' ? json.labeller : '',
    events: spans(json.events, `${where}.events`),
  };
}

export function parsePredictions(json: unknown, where = 'predictions'): Predictions {
  if (!isObj(json) || json.version !== 1) throw new Error(`${where}: expected { version: 1, detector, regions }`);
  return {
    version: 1,
    source: typeof json.source === 'string' ? json.source : undefined,
    durationS: isNum(json.durationS) ? json.durationS : undefined,
    detector: typeof json.detector === 'string' ? json.detector : 'unknown',
    regions: spans(json.regions, `${where}.regions`),
  };
}

export function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`${file}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function loadManifest(file: string): { manifest: Manifest; dir: string } {
  return { manifest: parseManifest(readJson(file)), dir: path.dirname(path.resolve(file)) };
}
