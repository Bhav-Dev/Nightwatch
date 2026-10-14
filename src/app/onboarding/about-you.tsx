import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';

import { EMPTY_PROFILE, type ProfileBands } from '../../../shared/profile';
import { getProfile, saveProfile } from '../../data/profileRepo';
import { ProfileForm } from '../../screens/ProfileForm';
import { Body, Button, Screen } from '../../ui/kit';
import { space } from '../../ui/theme';

export default function AboutYou() {
  const db = useSQLiteContext();
  const [p, setP] = useState<ProfileBands>(EMPTY_PROFILE);
  useEffect(() => {
    void getProfile(db).then((r) => setP(r.profile));
  }, [db]);
  const next = () => router.replace('/onboarding/health');
  return (
    <Screen
      eyebrow="Step 4 of 6"
      title="About you"
      footer={
        <>
          <Button
            label="Continue"
            onPress={async () => {
              await saveProfile(db, p);
              next();
            }}
          />
          <Button kind="link" label="Skip for now" onPress={next} />
        </>
      }
    >
      <Body muted style={{ marginBottom: space(5) }}>
        This lets us show results from people like you. Everything is stored in broad bands.
      </Body>
      <ProfileForm value={p} onChange={setP} />
    </Screen>
  );
}
