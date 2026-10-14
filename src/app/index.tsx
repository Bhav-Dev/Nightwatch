import { Redirect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';

import { latestNight } from '../data/nightRepo';
import { getSetting } from '../data/settingsRepo';
import { type LandingTab, landingTab } from '../domain/landingTab';
import { useApp } from '../state/AppContext';

/** Chooses where the app opens: sign-in, the rest of onboarding, or the landing tab. */
export default function Index() {
  const db = useSQLiteContext();
  const { session } = useApp();
  const [target, setTarget] = useState<string | null>(null);

  useEffect(() => {
    if (session === undefined) return;
    (async () => {
      if (session === null) return setTarget('/onboarding');
      if ((await getSetting(db, 'onboarding_complete')) !== '1') return setTarget('/onboarding/microphone');
      const [last, override] = await Promise.all([latestNight(db), getSetting(db, 'landing_tab')]);
      const tab = landingTab(new Date(), last !== null, (override as LandingTab | null) ?? null);
      setTarget(tab === 'morning' ? '/morning' : '/tonight');
    })();
  }, [db, session]);

  if (!target) return null;
  return <Redirect href={target as never} />;
}
