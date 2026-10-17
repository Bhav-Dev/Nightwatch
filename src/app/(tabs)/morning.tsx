import { useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';

import { track } from '../../analytics';
import { NightView } from '../../screens/NightView';

export default function Morning() {
  const { from } = useLocalSearchParams<{ from?: string }>();
  const fromRecap = from === 'recap';
  useEffect(() => {
    if (fromRecap) track({ name: 'recap_opened' });
  }, [fromRecap]);
  return <NightView fromRecap={fromRecap} />;
}
