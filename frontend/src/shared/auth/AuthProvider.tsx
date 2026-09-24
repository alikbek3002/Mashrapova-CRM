import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { supabase, isSupabaseConfigured } from "../api/supabase";

// Re-export the canonical AppRole type from rbac (single source of truth).
export type AppRole =
  | "director"
  | "fitness_director"
  | "senior_manager"
  | "manager"
  | "cashier"
  | "coach"
  | "parent";

export type AppUser = {
  /** ТЗ §12.3: роль обязывает пройти второй фактор (директор, управляющий). */
  mfa_required?: boolean;
  id: string;
  email: string | null;
  role: AppRole;
  organization_id: string;
  full_name: string;
};

type AuthState = {
  user: AppUser | null;
  loading: boolean;
  profileError: string | null;
  signOut: () => Promise<void>;
  /** Демо-режим (нет ключей Supabase): вход по роли без пароля. */
  demoMode: boolean;
  signInDemo: (role: AppRole) => void;
};

const DEMO_KEY = "uq_demo_role";

const DEMO_NAMES: Record<AppRole, string> = {
  director: "Демо Директор",
  fitness_director: "Демо Управляющий",
  senior_manager: "Демо Ст. менеджер",
  manager: "Демо Менеджер",
  cashier: "Демо Ресепшен",
  coach: "Демо Тренер",
  parent: "Демо Родитель",
};

const makeDemoUser = (role: AppRole): AppUser => ({
  id: `00000000-0000-0000-0000-00000000000${Object.keys(DEMO_NAMES).indexOf(role) + 1}`,
  email: null,
  role,
  organization_id: "00000000-0000-0000-0000-000000000000",
  full_name: DEMO_NAMES[role],
});

const readDemoUser = (): AppUser | null => {
  try {
    const r = localStorage.getItem(DEMO_KEY) as AppRole | null;
    return r && r in DEMO_NAMES ? makeDemoUser(r) : null;
  } catch {
    return null;
  }
};

const AuthContext = createContext<AuthState | null>(null);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<AppUser | null>(() =>
    isSupabaseConfigured ? null : readDemoUser(),
  );
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [profileError, setProfileError] = useState<string | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;

    const loadProfile = async (uid: string) => {
      const { data, error } = await supabase
        .from("profiles")
        // mfa_required нужен экрану второго фактора (ТЗ §12.3): по нему
        // решается, обязателен ли он для этой роли.
        .select("id, email, role, organization_id, full_name, mfa_required")
        .eq("id", uid)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        // Surface the error so the user sees what's wrong instead of being
        // silently bounced back to the login screen.
        console.error("[AuthProvider] profile load failed", error);
        setProfileError(error.message);
        setUser(null);
        setLoading(false);
        return;
      }
      if (!data) {
        // Auth succeeded but profile row is missing for this user
        // (DB inconsistency: auth.users entry without matching profiles row).
        setProfileError("Профиль не найден в базе. Обратитесь к администратору.");
        setUser(null);
        setLoading(false);
        return;
      }
      setProfileError(null);
      setUser(data as AppUser);
      setLoading(false);
    };

    supabase.auth.getSession().then(({ data }) => {
      const uid = data.session?.user?.id;
      if (uid) loadProfile(uid);
      else {
        setUser(null);
        setLoading(false);
      }
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const uid = session?.user?.id;
      if (uid) loadProfile(uid);
      else setUser(null);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const signInDemo = (role: AppRole) => {
    try { localStorage.setItem(DEMO_KEY, role); } catch {}
    setUser(makeDemoUser(role));
  };

  const signOut = async () => {
    if (!isSupabaseConfigured) {
      try { localStorage.removeItem(DEMO_KEY); } catch {}
      setUser(null);
      return;
    }
    await supabase.auth.signOut();
    setUser(null);
    setProfileError(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, profileError, signOut, demoMode: !isSupabaseConfigured, signInDemo }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthState => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
};
