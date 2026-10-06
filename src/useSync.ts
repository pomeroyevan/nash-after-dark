import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { STORE } from './model';
import { makeSyncClient, parseSyncConfig, supabaseTransport, SyncEngine, timedFetch } from './sync';

function tabId() {
  try {
    let id = sessionStorage.getItem('nash-after-dark.sync-tab');
    if (!id) { id = crypto.randomUUID(); sessionStorage.setItem('nash-after-dark.sync-tab', id); }
    return id;
  } catch { return crypto.randomUUID(); }
}
export function usePrivateSync() {
  const ref = useRef<SyncEngine | null>(null);
  if (!ref.current) ref.current = new SyncEngine({
    getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value),
    key: index => localStorage.key(index), get length() { return localStorage.length; }
  }, tabId());
  const engine = ref.current;
  const state = useSyncExternalStore(engine.subscribe, engine.getSnapshot);
  const [client, setClient] = useState<SupabaseClient | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [configState, setConfigState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [configMessage, setConfigMessage] = useState('');
  const [configAttempt, setConfigAttempt] = useState(0);
  const [authBusy, setAuthBusy] = useState(false);
  const [authMessage, setAuthMessage] = useState('');
  const [recoveryMode, setRecoveryMode] = useState(false);
  useEffect(() => {
    const controller = new AbortController(); let active = true;
    let cleanup: (() => void) | undefined;
    setConfigState('loading'); setConfigMessage('');
    void (async () => {
      try {
        const response = await timedFetch(`${import.meta.env.BASE_URL}data/sync-config.json`, { cache: 'no-store', signal: controller.signal });
        if (!active) return;
        if (response.status === 404) { setConfigState('missing'); return; }
        if (!response.ok) throw new Error(`Private sync configuration could not be loaded (${response.status}).`);
        const instance = makeSyncClient(parseSyncConfig(await response.json()));
        if (!active) { instance.auth.stopAutoRefresh(); return; }
        const transport = supabaseTransport(instance);
        let sessionEvents = 0;
        const sessionChanged = (next: User | null) => {
          if (!active) return;
          setUser(next); engine.connect(next?.id || null, next ? transport : null);
        };
        const { data: listener } = instance.auth.onAuthStateChange((event, session) => {
          sessionEvents++;
          // Never await another auth call from inside Supabase's auth callback.
          queueMicrotask(() => { if (active) { if (event === 'PASSWORD_RECOVERY') setRecoveryMode(true); if (event === 'SIGNED_OUT') setRecoveryMode(false); sessionChanged(session?.user || null); } });
        });
        cleanup = () => { listener.subscription.unsubscribe(); instance.auth.stopAutoRefresh(); };
        setClient(instance); setConfigState('ready');
        const initialEventCount = sessionEvents;
        const { data, error } = await instance.auth.getSession();
        if (error) throw error;
        if (initialEventCount === sessionEvents) sessionChanged(data.session?.user || null);
      } catch (error) { if (active) { setConfigState('error'); setConfigMessage((error as Error).message || 'Private sync could not connect.'); } }
    })();
    return () => { active = false; controller.abort(); cleanup?.(); };
  }, [engine, configAttempt]);
  useEffect(() => {
    const refresh = () => { if (!document.hidden) engine.refresh(); };
    const storage = (event: StorageEvent) => { if (!engine.getSnapshot().owner && (event.key === STORE || event.key === null)) engine.reloadGuest(); };
    const timer = setInterval(refresh, 30_000);
    window.addEventListener('focus', refresh); window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', refresh); window.addEventListener('storage', storage);
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh); window.removeEventListener('online', refresh); document.removeEventListener('visibilitychange', refresh); window.removeEventListener('storage', storage); };
  }, [engine]);
  const authAction = async (work: (instance: SupabaseClient) => Promise<string>) => {
    if (!client || authBusy) return false;
    setAuthBusy(true); setAuthMessage('');
    try { setAuthMessage(await work(client)); return true; }
    catch (error) {
      const message = (error as Error).message || 'Account request failed.';
      setAuthMessage(/email|smtp|rate|sending/i.test(message) ? `${message} This project's built-in email service is limited to the owner's approved address and may allow only two emails per hour. Try again later or ask the owner to configure email delivery.` : message);
      return false;
    } finally { setAuthBusy(false); }
  };
  const redirectTo = new URL(import.meta.env.BASE_URL, window.location.href).href;
  return { state, engine, user, configState, configMessage, authBusy, authMessage, recoveryMode,
    retryConfig: () => setConfigAttempt(n => n + 1),
    signIn: (email: string, password: string) => authAction(async instance => { const { error } = await instance.auth.signInWithPassword({ email, password }); if (error) throw error; return 'Signed in. Loading your private notes.'; }),
    signUp: (email: string, password: string) => authAction(async instance => { const { data, error } = await instance.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo } }); if (error) throw error; return data.session ? 'Account ready. Loading your private notes.' : 'Check your email to confirm the account, then sign in here. Confirmation email delivery is limited to the project owner’s approved address until custom email delivery is configured.'; }),
    signOut: () => authAction(async instance => { const { error } = await instance.auth.signOut({ scope: 'local' }); if (error) throw error; engine.connect(null, null); setUser(null); return 'Signed out on this device. Account drafts remain in local recovery; device-only notes are separate.'; }),
    resetEmail: (email: string) => authAction(async instance => { const { error } = await instance.auth.resetPasswordForEmail(email, { redirectTo }); if (error) throw error; return 'If email delivery is available for this account, a password-reset link has been requested. Check your email. The built-in mailer is limited to the project owner’s approved address.'; }),
    updatePassword: (password: string) => authAction(async instance => { const { error } = await instance.auth.updateUser({ password }); if (error) throw error; setRecoveryMode(false); return 'Password updated.'; })
  };
}
export type PrivateSync = ReturnType<typeof usePrivateSync>;
