import * as AppleAuthentication from 'expo-apple-authentication';
import * as Google from 'expo-auth-session/providers/google';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { Platform, StyleSheet, TextInput } from 'react-native';

import type { AuthProvider } from '../../../shared/api';
import { config } from '../../config';
import { useApp } from '../../state/AppContext';
import { Body, Button, Card, H2, Screen, Small } from '../../ui/kit';
import { colors, radius, space } from '../../ui/theme';

WebBrowser.maybeCompleteAuthSession();

const googleConfigured = !!(config.googleIosClientId || config.googleAndroidClientId || config.googleWebClientId);

/**
 * An account is always required: it is what lets nights sync between phones and survive a
 * lost phone, and what the contribution opt-in hangs off. Apple, Google or an email link.
 */
export default function SignIn() {
  const { api, signIn } = useApp();
  const [busy, setBusy] = useState<AuthProvider | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [appleAvailable, setAppleAvailable] = useState(false);

  useEffect(() => {
    if (Platform.OS === 'ios') void AppleAuthentication.isAvailableAsync().then(setAppleAvailable);
  }, []);

  const exchange = async (provider: AuthProvider, token: string, name?: string | null, authorizationCode?: string | null) => {
    const res = await api.exchange({ provider, token, name, authorization_code: authorizationCode ?? undefined });
    await signIn({ token: res.session_token, userId: res.user_id, expiresAt: res.expires_at, provider, email: null });
    router.replace('/onboarding/microphone');
  };

  const run = async (provider: AuthProvider, fn: () => Promise<void>) => {
    setBusy(provider);
    setError(null);
    try {
      await fn();
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code !== 'ERR_REQUEST_CANCELED') setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const apple = () =>
    run('apple', async () => {
      const cred = await AppleAuthentication.signInAsync({
        requestedScopes: [AppleAuthentication.AppleAuthenticationScope.EMAIL, AppleAuthentication.AppleAuthenticationScope.FULL_NAME],
      });
      if (!cred.identityToken) throw new Error('Apple did not return a sign-in token.');
      const name = cred.fullName ? AppleAuthentication.formatFullName(cred.fullName) || null : null;
      // The code lets the server revoke Sign in with Apple if the account is ever deleted.
      await exchange('apple', cred.identityToken, name, cred.authorizationCode);
    });

  const sendLink = () =>
    run('email', async () => {
      await api.requestMagicLink(email.trim());
      setSent(true);
    });

  const devSignIn = () =>
    signIn({ token: 'dev', userId: 'dev-user', expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(), provider: 'email', email: 'dev@localhost' }).then(() =>
      router.replace('/onboarding/microphone'),
    );

  return (
    <Screen eyebrow="Step 1 of 6" title="Create your account">
      <Body muted>Your account keeps your nights safe if you change phones and lets you choose to share results. Recordings never leave this phone.</Body>
      <Card style={{ marginTop: space(5) }}>
        {appleAvailable ? (
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
            buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
            cornerRadius={radius.button}
            style={{ height: 52, marginBottom: space(3) }}
            onPress={apple}
          />
        ) : null}
        {googleConfigured ? <GoogleButton busy={busy === 'google'} onToken={(t) => run('google', () => exchange('google', t))} /> : null}
        <H2>Or use your email</H2>
        {sent ? (
          <Body>Check your email for a sign-in link. It works for 15 minutes.</Body>
        ) : (
          <>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor={colors.textFaint}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              style={styles.input}
              accessibilityLabel="Email address"
            />
            <Button kind="secondary" label="Email me a sign-in link" onPress={sendLink} busy={busy === 'email'} disabled={!/^\S+@\S+\.\S+$/.test(email.trim())} />
          </>
        )}
        {error ? <Small style={{ color: colors.danger, marginTop: space(3) }}>{error}</Small> : null}
      </Card>
      {!api.configured ? (
        <Card>
          <Small>No server is configured for this build (EXPO_PUBLIC_API_URL).</Small>
          {config.internalTools ? <Button kind="link" label="Continue with a development account" onPress={devSignIn} /> : null}
        </Card>
      ) : null}
      <Small>By continuing you agree to the terms and privacy policy.</Small>
    </Screen>
  );
}

function GoogleButton({ busy, onToken }: { busy: boolean; onToken: (idToken: string) => void }) {
  const [request, response, prompt] = Google.useIdTokenAuthRequest({
    iosClientId: config.googleIosClientId || undefined,
    androidClientId: config.googleAndroidClientId || undefined,
    webClientId: config.googleWebClientId || undefined,
  });
  useEffect(() => {
    if (response?.type === 'success' && response.params.id_token) onToken(response.params.id_token);
  }, [response, onToken]);
  return <Button kind="secondary" label="Continue with Google" onPress={() => prompt()} disabled={!request} busy={busy} style={{ marginBottom: space(5) }} />;
}

const styles = StyleSheet.create({
  input: {
    backgroundColor: colors.surfaceRaised,
    color: colors.text,
    borderRadius: radius.button,
    paddingHorizontal: space(4),
    paddingVertical: space(3.5),
    fontSize: 16,
    marginBottom: space(3),
  },
});
