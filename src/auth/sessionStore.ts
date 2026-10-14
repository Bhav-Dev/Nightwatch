import * as SecureStore from 'expo-secure-store';

/** The app session (from POST /v1/auth/exchange), kept in the keychain / keystore. */
export interface Session {
  token: string;
  userId: string;
  expiresAt: string;
  provider: 'apple' | 'google' | 'email';
  email: string | null;
}

const KEY = 'nightwatch.session';

export async function loadSession(): Promise<Session | null> {
  const raw = await SecureStore.getItemAsync(KEY);
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Session;
    return new Date(s.expiresAt).getTime() > Date.now() ? s : null;
  } catch {
    return null;
  }
}

export async function saveSession(s: Session): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(s));
}

export async function clearSession(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
}
