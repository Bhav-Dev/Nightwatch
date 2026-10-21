import { deleteAllLocalData } from '../src/data/exportData';
import { migrate } from '../src/data/schema';
import { getSetting, setSetting } from '../src/data/settingsRepo';
import { setUsageAnalytics, usageAnalyticsOn } from '../src/usageAnalytics';
import { openTestDb } from './helpers/nodeDb';

async function freshDb() {
  const db = openTestDb();
  await migrate(db);
  return db;
}

describe('usage counts setting', () => {
  it('is on unless turned off, and turning it off forgets the install id', async () => {
    const db = await freshDb();
    expect(await usageAnalyticsOn(db)).toBe(true);
    await setSetting(db, 'analytics_install_id', 'install-1');

    await setUsageAnalytics(db, false);
    expect(await usageAnalyticsOn(db)).toBe(false);
    expect(await getSetting(db, 'analytics_install_id')).toBeNull();

    await setUsageAnalytics(db, true);
    expect(await usageAnalyticsOn(db)).toBe(true);
  });

  it('stays off after deleting all data on the phone', async () => {
    const db = await freshDb();
    await setSetting(db, 'device_id', 'device-1');
    await setUsageAnalytics(db, false);
    await setSetting(db, 'bedtime_reminder', '22:30');

    await deleteAllLocalData(db);
    expect(await usageAnalyticsOn(db)).toBe(false);
    expect(await getSetting(db, 'device_id')).toBe('device-1');
    expect(await getSetting(db, 'bedtime_reminder')).toBeNull();
  });
});
