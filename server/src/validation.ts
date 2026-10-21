import type { Context } from 'hono';
import { z } from 'zod';

import {
  AGE_BANDS,
  BMI_BANDS,
  HEIGHT_BANDS,
  PAUSES,
  POSITIONS,
  SEXES,
  WEIGHT_BANDS,
} from '../../shared/profile.ts';
import { badRequest } from './errors.ts';

/** Request bodies, checked against shared/api.ts. */

const itemId = z.string().regex(/^[a-z0-9_]{1,64}$/, 'must be a catalogue id');

// Trimmed before the format check, since keyboards love a trailing space.
export const magicLinkBody = z.object({ email: z.string().trim().max(254).pipe(z.email()) });

export const exchangeBody = z.object({
  provider: z.enum(['apple', 'google', 'email']),
  token: z.string().min(1).max(8192),
  name: z.string().max(200).nullish(),
  authorization_code: z.string().min(1).max(4096).nullish(),
});

export const suggestBody = z.object({ text: z.string().trim().min(1).max(200) });

const finite = z.number().refine(Number.isFinite, 'must be a finite number');
const optNum = finite.nullable();

export const nightSchema = z.object({
  id: z.string().min(1).max(64),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}(#\d+)?$/, 'must be yyyy-mm-dd'),
  duration_s: z.number().int().min(0).max(172_800),
  time_in_bed_s: z.number().int().min(0).max(172_800),
  score: finite.min(0).max(100),
  score_version: z.number().int().min(1),
  pct_snoring: finite.min(0).max(1),
  event_count: z.number().int().min(0),
  max_db: finite.min(-200).max(200),
  partial: z.boolean(),
  typical: z.boolean().nullable(),
  health: z
    .object({
      sleep_efficiency: optNum,
      spo2_min: optNum,
      spo2_dips: z.number().int().min(0).nullable(),
      hr_mean: optNum,
      hr_max: optNum,
      hrv_mean: optNum,
      resp_mean: optNum,
    })
    .nullable(),
  remedies: z.array(itemId).max(100),
  factors: z.array(z.object({ id: itemId, value: z.string().max(32).nullable() })).max(100),
  updated_at: z.iso.datetime({ offset: true }),
});
export type ValidNight = z.infer<typeof nightSchema>;

/** The envelope only; each night is checked on its own so one bad night does not sink the batch. */
export const syncBody = z.object({
  device_id: z.string().min(1).max(128),
  nights: z.array(z.unknown()).max(500),
});

export const profileBody = z.object({
  version: z.number().int().min(0),
  age_band: z.enum(AGE_BANDS).nullable(),
  sex: z.enum(SEXES).nullable(),
  height_band: z.enum(HEIGHT_BANDS).nullable(),
  weight_band: z.enum(WEIGHT_BANDS).nullable(),
  bmi_band: z.enum(BMI_BANDS).nullable(),
  position: z.enum(POSITIONS).nullable(),
  pauses_reported: z.enum(PAUSES).nullable(),
  apnoea_dx: z.boolean().nullable(),
  cpap: z.boolean().nullable(),
});

export const contributionBody = z.object({ opted_in: z.boolean() });

/** "path: message" for the first problem, used in rejection reasons and 400 messages. */
export function describeIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  const path = issue.path.join('.');
  return path ? `${path}: ${issue.message}` : issue.message;
}

/** Parses and validates a JSON body, or throws a 400. */
export async function readBody<S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw badRequest('Body must be JSON.', 'invalid_json');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw badRequest(describeIssue(parsed.error));
  return parsed.data;
}
