import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';

import { useApp } from '../state/AppContext';
import { Body, Button, Card, Loading, Screen } from '../ui/kit';

/**
 * Opened from the magic-link email: nightwatch://auth?token=…, either straight from the email or
 * from the website's /auth page (https://<site>/auth?token=…), which forwards to the app because
 * many mail apps will not open a nightwatch:// link. The same route would serve the https link
 * itself if universal links are added later.
 */
export default function AuthCallback() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  const { api, signIn } = useApp();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const res = await api.exchange({ provider: 'email', token });
        await signIn({ token: res.session_token, userId: res.user_id, expiresAt: res.expires_at, provider: 'email', email: null });
        router.replace('/');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'This sign-in link has expired or was already used.');
      }
    })();
  }, [api, signIn, token]);

  const message = token ? error : 'This sign-in link is incomplete. Request a new one from the app.';
  return (
    <Screen eyebrow="Signing in">
      {message ? (
        <Card>
          <Body>{message}</Body>
          <Button label="Back to sign in" onPress={() => router.replace('/onboarding/sign-in')} />
        </Card>
      ) : (
        <Loading />
      )}
    </Screen>
  );
}
