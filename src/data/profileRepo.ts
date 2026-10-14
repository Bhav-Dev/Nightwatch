import { EMPTY_PROFILE, type ProfileBands } from '../../shared/profile';
import type { Db } from './db';

interface ProfileRow {
  age_band: string | null;
  sex: string | null;
  height_band: string | null;
  weight_band: string | null;
  bmi_band: string | null;
  position: string | null;
  pauses_reported: string | null;
  apnoea_dx: number | null;
  cpap: number | null;
  version: number;
}

const bool = (x: number | null) => (x === null ? null : x === 1);
const int = (x: boolean | null) => (x === null ? null : x ? 1 : 0);

export async function getProfile(db: Db): Promise<{ profile: ProfileBands; version: number }> {
  const r = await db.getFirstAsync<ProfileRow>('SELECT * FROM profile WHERE id = 1', []);
  if (!r) return { profile: EMPTY_PROFILE, version: 0 };
  return {
    profile: {
      age_band: r.age_band as ProfileBands['age_band'],
      sex: r.sex as ProfileBands['sex'],
      height_band: r.height_band as ProfileBands['height_band'],
      weight_band: r.weight_band as ProfileBands['weight_band'],
      bmi_band: r.bmi_band as ProfileBands['bmi_band'],
      position: r.position as ProfileBands['position'],
      pauses_reported: r.pauses_reported as ProfileBands['pauses_reported'],
      apnoea_dx: bool(r.apnoea_dx),
      cpap: bool(r.cpap),
    },
    version: r.version,
  };
}

/** Saves the profile and bumps its version so sync knows to send it. */
export async function saveProfile(db: Db, p: ProfileBands, version?: number): Promise<number> {
  const current = await getProfile(db);
  const next = version ?? current.version + 1;
  await db.runAsync(
    `INSERT INTO profile (id, age_band, sex, height_band, weight_band, bmi_band, position, pauses_reported, apnoea_dx, cpap, version)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET age_band = excluded.age_band, sex = excluded.sex, height_band = excluded.height_band,
       weight_band = excluded.weight_band, bmi_band = excluded.bmi_band, position = excluded.position,
       pauses_reported = excluded.pauses_reported, apnoea_dx = excluded.apnoea_dx, cpap = excluded.cpap, version = excluded.version`,
    [p.age_band, p.sex, p.height_band, p.weight_band, p.bmi_band, p.position, p.pauses_reported, int(p.apnoea_dx), int(p.cpap), next],
  );
  return next;
}

/** "People like you" needs age, BMI and position. */
export function profileComplete(p: ProfileBands): boolean {
  return p.age_band !== null && p.bmi_band !== null && p.position !== null;
}
