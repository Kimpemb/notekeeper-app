// src/features/sync/store/useSyncStore.ts
import { create } from "zustand";
import type { Session } from "@supabase/supabase-js";
import { supabase, isSyncConfigured } from "@/features/sync/db/supabaseClient";

interface SyncStore {
  session: Session | null;
  sessionLoaded: boolean;

  isSignedIn: () => boolean;
  restoreSession: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

// Module-level so repeated restoreSession() calls never stack subscriptions.
let authSubscription: { unsubscribe: () => void } | null = null;

export const useSyncStore = create<SyncStore>((set, get) => ({
  session: null,
  sessionLoaded: false,

  isSignedIn: () => get().session !== null,

  restoreSession: async () => {
    if (!isSyncConfigured) {
      set({ session: null, sessionLoaded: true });
      return;
    }

    try {
      const { data } = await supabase.auth.getSession();
      set({ session: data.session, sessionLoaded: true });
    } catch (err) {
      console.warn("[sync] Session restore failed:", err);
      set({ session: null, sessionLoaded: true });
    }

    // Keep store in sync with token refreshes / external sign-out.
    authSubscription?.unsubscribe();
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      set({ session });
    });
    authSubscription = data.subscription;
  },

  signIn: async (email, password) => {
    if (!isSyncConfigured) {
      return { error: "Sync isn't configured in this build." };
    }
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    set({ session: data.session });
    return { error: null };
  },

  signOut: async () => {
    if (isSyncConfigured) await supabase.auth.signOut();
    set({ session: null });
  },
}));