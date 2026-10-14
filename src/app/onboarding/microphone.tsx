import { router } from 'expo-router';
import { useState } from 'react';
import { Linking } from 'react-native';

import { getAudioCapture } from '../../native';
import { Body, Button, Card, Screen } from '../../ui/kit';
import { space } from '../../ui/theme';

/** The app cannot work without the microphone, so this step cannot be skipped. */
export default function Microphone() {
  const [denied, setDenied] = useState(false);
  const ask = async () => {
    if (await getAudioCapture().requestPermission()) router.replace('/onboarding/notifications');
    else setDenied(true);
  };
  return (
    <Screen
      eyebrow="Step 2 of 6"
      title="Microphone"
      footer={denied ? <Button label="Open Settings" onPress={() => Linking.openSettings()} /> : <Button label="Allow microphone" onPress={ask} />}
    >
      <Body>Nightwatch listens to hear snoring while you sleep. Audio is processed on this phone; it is never uploaded.</Body>
      {denied ? (
        <Card style={{ marginTop: space(5) }}>
          <Body>Microphone access is off. Nightwatch can’t record without it. Turn it on in Settings, then come back.</Body>
          <Button kind="link" label="I’ve turned it on" onPress={ask} />
        </Card>
      ) : null}
    </Screen>
  );
}
