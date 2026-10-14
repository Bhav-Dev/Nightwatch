import { useLocalSearchParams } from 'expo-router';

import { NightView } from '../../screens/NightView';

export default function PastNight() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <NightView nightId={id} />;
}
