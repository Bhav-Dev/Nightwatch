import { Redirect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';

import { latestNight } from '../data/nightRepo';
import { getSetting } from '../data/settingsRepo';
import { type LandingTab, landingTab } from '../domain/landingTab';

export default function Index() {
  const db = useSQLiteContext();
  const [tab, setTab] = useState<LandingTab | null>(null);

  useEffect(() => {
    (async () => {
      const [last, override] = await Promise.all([latestNight(db), getSetting(db, 'landing_tab')]);
      setTab(landingTab(new Date(), last !== null, override as LandingTab | null));
    })();
  }, [db]);

  if (!tab) return null;
  return <Redirect href={tab === 'morning' ? '/morning' : '/tonight'} />;
}
