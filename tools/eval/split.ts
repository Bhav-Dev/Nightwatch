/// <reference types="node" />
import * as fs from 'node:fs';

import { loadManifest, volunteerSplitConflicts, type Manifest, type Split } from './manifest';

/**
 * Train / held-out assignment by volunteer, so no one's voice is in both sets.
 *
 * Rules
 * - A volunteer already in the held-out set never moves, and once a held-out set exists it
 *   is frozen: new volunteers always go to train. This keeps release-to-release results
 *   comparable.
 * - A volunteer already in train stays in train.
 * - New nights from a known volunteer inherit that volunteer's split.
 * - First split only: choose the subset of unassigned volunteers whose night count is
 *   closest to the target (default a third of all nights, 10 of 30). Ties prefer more
 *   volunteers in held-out (more voices), then a seeded random choice so the pick is not
 *   biased by how volunteers were named.
 */

export interface SplitOptions {
  /** Target held-out nights on a first split. Default: a third of all nights, rounded. */
  heldoutNights?: number;
  seed?: number;
}

export interface SplitResult {
  manifest: Manifest;
  firstSplit: boolean;
  heldoutVolunteers: string[];
  trainVolunteers: string[];
  heldoutNights: number;
  trainNights: number;
  /** Volunteers assigned by this run. */
  assigned: { volunteer: string; split: Split; nights: number }[];
}

/** Exhaustive search is 2^n; above this many new volunteers fall back to a seeded greedy pick. */
const MAX_EXHAUSTIVE = 20;

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 0x100000000;
  };
}

function chooseHeldout(
  candidates: { volunteer: string; nights: number }[],
  target: number,
  rand: () => number,
  allowAll: boolean,
): Set<string> {
  const n = candidates.length;
  if (n <= MAX_EXHAUSTIVE) {
    let best: number[] = [];
    let bestKey: [number, number] = [Infinity, 0];
    const full = (1 << n) - 1;
    for (let mask = 1; mask <= full; mask++) {
      if (mask === full && !allowAll && n > 1) continue;
      let nights = 0;
      let count = 0;
      for (let i = 0; i < n; i++) {
        if (mask & (1 << i)) {
          nights += candidates[i].nights;
          count++;
        }
      }
      const key: [number, number] = [Math.abs(nights - target), -count];
      if (key[0] < bestKey[0] || (key[0] === bestKey[0] && key[1] < bestKey[1])) {
        bestKey = key;
        best = [mask];
      } else if (key[0] === bestKey[0] && key[1] === bestKey[1]) {
        best.push(mask);
      }
    }
    const mask = best[Math.floor(rand() * best.length)] ?? 0;
    return new Set(candidates.filter((_, i) => mask & (1 << i)).map((c) => c.volunteer));
  }
  const shuffled = [...candidates].sort(() => rand() - 0.5);
  const chosen = new Set<string>();
  let total = 0;
  for (const c of shuffled) {
    if (!allowAll && chosen.size === candidates.length - 1) break;
    if (Math.abs(total + c.nights - target) < Math.abs(total - target)) {
      chosen.add(c.volunteer);
      total += c.nights;
    }
  }
  return chosen;
}

export function assignSplits(input: Manifest, opts: SplitOptions = {}): SplitResult {
  const conflicts = volunteerSplitConflicts(input);
  if (conflicts.length > 0) throw new Error(`volunteers in both train and held-out: ${conflicts.join(', ')}`);

  const nightsBy = new Map<string, number>();
  const existing = new Map<string, Split>();
  for (const n of input.nights) {
    nightsBy.set(n.volunteer, (nightsBy.get(n.volunteer) ?? 0) + 1);
    if (n.split) existing.set(n.volunteer, n.split);
  }
  const firstSplit = ![...existing.values()].includes('heldout');
  const unassigned = [...nightsBy.keys()]
    .filter((v) => !existing.has(v))
    .sort()
    .map((volunteer) => ({ volunteer, nights: nightsBy.get(volunteer)! }));

  const decided = new Map(existing);
  if (firstSplit && unassigned.length > 0) {
    const target = opts.heldoutNights ?? Math.round(input.nights.length / 3);
    // Leave at least one volunteer for training when nobody is in train yet.
    const held = chooseHeldout(unassigned, target, rng(opts.seed ?? 1), existing.size > 0);
    for (const u of unassigned) decided.set(u.volunteer, held.has(u.volunteer) ? 'heldout' : 'train');
  } else {
    for (const u of unassigned) decided.set(u.volunteer, 'train');
  }

  const manifest: Manifest = {
    ...input,
    nights: input.nights.map((n) => ({ ...n, split: decided.get(n.volunteer)! })),
  };
  const volunteersIn = (s: Split) => [...decided].filter(([, v]) => v === s).map(([k]) => k).sort();
  const nightsIn = (s: Split) => manifest.nights.filter((n) => n.split === s).length;
  return {
    manifest,
    firstSplit,
    heldoutVolunteers: volunteersIn('heldout'),
    trainVolunteers: volunteersIn('train'),
    heldoutNights: nightsIn('heldout'),
    trainNights: nightsIn('train'),
    assigned: unassigned.map((u) => ({ ...u, split: decided.get(u.volunteer)! })),
  };
}

const USAGE = `Usage: npx tsx tools/eval/split.ts <manifest.json> [--heldout-nights N] [--seed N] [--write | --out <file>]

Assigns each volunteer to train or held-out. An existing held-out set is never changed;
new volunteers then go to train. Without --write or --out it only prints the plan.`;

export function main(argv: string[]): number {
  const args = [...argv];
  const positional: string[] = [];
  const opts: SplitOptions = {};
  let write = false;
  let out: string | undefined;
  while (args.length > 0) {
    const a = args.shift()!;
    if (a === '--heldout-nights') opts.heldoutNights = Number(args.shift());
    else if (a === '--seed') opts.seed = Number(args.shift());
    else if (a === '--write') write = true;
    else if (a === '--out') out = args.shift();
    else if (a === '--help' || a === '-h') {
      console.log(USAGE);
      return 0;
    } else positional.push(a);
  }
  const badNumber = [opts.heldoutNights, opts.seed].some((x) => x !== undefined && !Number.isInteger(x));
  if (positional.length !== 1 || badNumber) {
    console.error(USAGE);
    return 2;
  }
  const file = positional[0];
  const r = assignSplits(loadManifest(file).manifest, opts);
  console.log(r.firstSplit ? 'First split: choosing the held-out volunteers.' : 'Held-out set exists and is kept as is.');
  for (const a of r.assigned) console.log(`  ${a.volunteer} (${a.nights} nights) → ${a.split}`);
  if (r.assigned.length === 0) console.log('  No new volunteers.');
  console.log(`Train: ${r.trainNights} nights from ${r.trainVolunteers.join(', ') || 'nobody'}`);
  console.log(`Held-out: ${r.heldoutNights} nights from ${r.heldoutVolunteers.join(', ') || 'nobody'}`);
  const target = write ? file : out;
  if (target) {
    fs.writeFileSync(target, JSON.stringify(r.manifest, null, 2) + '\n');
    console.log(`Wrote ${target}`);
  } else {
    console.log('Dry run; pass --write to update the manifest.');
  }
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 2;
  }
}
