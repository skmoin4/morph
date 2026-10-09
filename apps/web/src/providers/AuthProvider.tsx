import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { LoginInput, SessionUser } from '@opsvera/shared';
import { api, setAccessToken, setSessionExpiredHandler } from '../lib/api';

interface AuthContextValue {
  user: SessionUser | null;
  /** Permission keys, as a Set for cheap lookups in render. */
  permissions: ReadonlySet<string>;
  /** True until the initial silent refresh has settled. */
  loading: boolean;
  signIn: (input: LoginInput) => Promise<void>;
  signOut: () => Promise<void>;
  can: (permission: string) => boolean;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();

  const loadSession = useCallback(async () => {
    const session = await api.get<SessionUser>('/auth/me');
    setUser(session);
  }, []);

  /**
   * On first load the access token is gone (it only ever lived in memory), but
   * the httpOnly refresh cookie may still be valid — so a reload silently
   * restores the session rather than bouncing to the login page.
   */
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { accessToken } = await api.post<{ accessToken: string }>('/auth/refresh');
        setAccessToken(accessToken);
        if (!cancelled) await loadSession();
      } catch {
        // No valid cookie: the user simply has to sign in.
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadSession]);

  // A refresh that fails mid-session drops the user back to the login screen
  // rather than leaving the UI stuck on stale data.
  useEffect(() => {
    setSessionExpiredHandler(() => {
      setUser(null);
      queryClient.clear();
    });
    return () => setSessionExpiredHandler(null);
  }, [queryClient]);

  const signIn = useCallback(
    async (input: LoginInput) => {
      const { accessToken } = await api.post<{ accessToken: string }>('/auth/login', input);
      setAccessToken(accessToken);
      await loadSession();
    },
    [loadSession],
  );

  const signOut = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      setAccessToken(null);
      setUser(null);
      queryClient.clear();
    }
  }, [queryClient]);

  const permissions = useMemo(() => new Set(user?.permissions ?? []), [user]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      permissions,
      loading,
      signIn,
      signOut,
      can: (permission: string) => permissions.has(permission),
      refresh: loadSession,
    }),
    [user, permissions, loading, signIn, signOut, loadSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}

/**
 * Permission check for render-time gating.
 *
 * The frontend only hides what the user cannot use — the backend is what
 * actually enforces it.
 */
export function useCan(): (permission: string) => boolean {
  return useAuth().can;
}
