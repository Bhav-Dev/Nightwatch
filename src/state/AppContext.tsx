import { randomUUID } from 'expo-crypto';
import { getLocales } from 'expo-localization';
import { useSQLiteContext } from 'expo-sqlite';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { track } from '../analytics';
import { ApiClient } from '../api/client';
import { clearSession, loadSession, saveSession, type Session } from '../auth/sessionStore';
import { getToken, setToken } from '../auth/tokenStore';
import { configureBilling, currentEntitlement, onEntitlementChange, signOutBilling } from '../billing/billing';
import { config } from '../config';
import { refreshCatalogue } from '../data/catalogueClient';
import { getSetting, setSetting } from '../data/settingsRepo';
import { syncNow } from '../sync/sync';

interface AppContextValue {
  /** Undefined while loading from the keychain; null when signed out. */
  session: Session | null | undefined;
  api: ApiClient;
  /** Has the paid entitlement (RevenueCat, the server mirror, or the dev override). */
  paid: boolean;
  region: string;
  deviceId: string | null;
  signIn(session: Session): Promise<void>;
  signOut(): Promise<void>;
  refreshEntitlement(): Promise<void>;
  /** Runs a sync now; failures are swallowed (the next one retries). */
  sync(): Promise<void>;
  lastSyncError: string | null;
}

const Ctx = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside AppProvider');
  return v;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [paid, setPaid] = useState(false);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [lastSyncError, setLastSyncError] = useState<string | null>(null);
  const syncing = useRef(false);

  const region = getLocales()[0]?.regionCode ?? 'GB';

  const api = useMemo(
    () =>
      new ApiClient(
        config.apiUrl,
        getToken,
        undefined,
        () => {
          // Session revoked or expired on the server: back to sign-in.
          setToken(null);
          void clearSession().then(() => setSession(null));
        },
      ),
    [],
  );

  const refreshEntitlement = useCallback(async () => {
    const dev = __DEV__ && (await getSetting(db, 'dev_paid')) === '1';
    const store = await currentEntitlement().catch(() => false);
    const server = getToken() && api.configured ? await api.subscription().then((s) => s.active).catch(() => false) : false;
    setPaid(dev || store || server);
  }, [api, db]);

  const sync = useCallback(async () => {
    if (!getToken() || !api.configured || syncing.current) return;
    syncing.current = true;
    try {
      let id = await getSetting(db, 'device_id');
      if (!id) {
        id = randomUUID();
        await setSetting(db, 'device_id', id);
      }
      await refreshCatalogue(db, api).catch(() => undefined);
      await syncNow(db, api, id);
      setLastSyncError(null);
    } catch (e) {
      setLastSyncError(e instanceof Error ? e.message : String(e));
    } finally {
      syncing.current = false;
    }
  }, [api, db]);

  useEffect(() => {
    track({ name: 'app_open' });
    (async () => {
      setDeviceId(await getSetting(db, 'device_id'));
      const s = await loadSession();
      setToken(s?.token ?? null);
      setSession(s);
    })();
  }, [db]);

  useEffect(() => {
    if (!session) return;
    let unsubscribe = () => undefined as void;
    (async () => {
      await configureBilling(session.userId).catch(() => undefined);
      unsubscribe = onEntitlementChange(setPaid);
      await refreshEntitlement();
      await sync();
    })();
    const appState = AppState.addEventListener('change', (s) => {
      if (s === 'active') {
        void sync();
        void refreshEntitlement();
      }
    });
    return () => {
      unsubscribe();
      appState.remove();
    };
  }, [session, refreshEntitlement, sync]);

  const signIn = useCallback(
    async (s: Session) => {
      await saveSession(s);
      setToken(s.token);
      setSession(s);
    },
    [],
  );

  const signOut = useCallback(async () => {
    setToken(null);
    await clearSession();
    await signOutBilling();
    setPaid(false);
    setSession(null);
  }, []);

  const value: AppContextValue = { session, api, paid, region, deviceId, signIn, signOut, refreshEntitlement, sync, lastSyncError };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
