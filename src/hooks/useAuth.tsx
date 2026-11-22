import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../config/firebase';
import {
  registerUserWithDummyOtp,
  signOutUser,
  verifyDummyOtpAndLogin,
} from '../services/authService';
import type { UserProfile } from '../types/carebridge';

type RegisterInput = Parameters<typeof registerUserWithDummyOtp>[0];

interface AuthContextValue {
  currentUser: UserProfile | null;
  loading: boolean;
  login: (phone: string) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        setLoading(false);
      }
    }, 2500);

    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = onAuthStateChanged(
        auth,
        async user => {
          try {
            if (user) {
              const snap = await getDoc(doc(db, 'users', user.uid));
              setCurrentUser(snap.exists() ? (snap.data() as UserProfile) : null);
            } else {
              setCurrentUser(null);
            }
          } catch {
            setCurrentUser(null);
          } finally {
            settled = true;
            clearTimeout(timer);
            setLoading(false);
          }
        },
        () => {
          settled = true;
          clearTimeout(timer);
          setCurrentUser(null);
          setLoading(false);
        },
      );
    } catch {
      settled = true;
      clearTimeout(timer);
      setLoading(false);
    }

    return () => {
      clearTimeout(timer);
      unsubscribe?.();
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      currentUser,
      loading,
      login: async phone => {
        const profile = await verifyDummyOtpAndLogin(phone);
        setCurrentUser(profile);
      },
      register: async input => {
        const profile = await registerUserWithDummyOtp(input);
        setCurrentUser(profile);
      },
      logout: async () => {
        await signOutUser();
        setCurrentUser(null);
      },
    }),
    [currentUser, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
