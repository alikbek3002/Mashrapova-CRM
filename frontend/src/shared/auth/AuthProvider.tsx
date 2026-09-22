import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { supabase } from "../api/supabase";

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
};

const AuthContext = createContext<AuthState | null>(null);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadProfile = async (uid: string) => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, email, role, organization_id, full_name")
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

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setProfileError(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, profileError, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthState => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
};
