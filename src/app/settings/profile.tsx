import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { ScrollView } from 'react-native';

import { EMPTY_PROFILE, type ProfileBands } from '../../../shared/profile';
import { getProfile, saveProfile } from '../../data/profileRepo';
import { ProfileForm } from '../../screens/ProfileForm';
import { useApp } from '../../state/AppContext';
import { Button } from '../../ui/kit';
import { space } from '../../ui/theme';

export default function EditProfile() {
  const db = useSQLiteContext();
  const { sync } = useApp();
  const [p, setP] = useState<ProfileBands>(EMPTY_PROFILE);
  useEffect(() => {
    void getProfile(db).then((r) => setP(r.profile));
  }, [db]);
  return (
    <ScrollView contentContainerStyle={{ padding: space(5) }}>
      <ProfileForm value={p} onChange={setP} />
      <Button
        label="Save"
        onPress={async () => {
          await saveProfile(db, p);
          void sync();
          router.back();
        }}
      />
    </ScrollView>
  );
}
