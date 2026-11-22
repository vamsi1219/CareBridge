import * as firebaseConfig from '../config/firebase';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import {
  collection,
  collectionGroup,
  query,
  where,
  getDocs,
  getDoc,
  doc,
  writeBatch,
  type QueryDocumentSnapshot,
  type WriteBatch,
} from 'firebase/firestore';
import type { UserProfile } from '../types/carebridge';
import { localStore, withTimeout } from './localStore';

function getAuthInstance() {
  return firebaseConfig.getFirebaseAuth ? firebaseConfig.getFirebaseAuth() : firebaseConfig.auth;
}

function getDbInstance() {
  return firebaseConfig.getFirebaseDb ? firebaseConfig.getFirebaseDb() : firebaseConfig.db;
}

export const DEMO_OTP = '111111';

// Synthetic demo credential; the same mobile always maps to the same Auth account
// so auth.currentUser.uid is stable across logins.
const DEMO_AUTH_SECRET = 'carebridge-demo-only-not-a-secret';

export function normalizeMobile(raw: string): string {
  let d = raw.replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  return d;
}

export function isValidMobile(raw: string): boolean {
  return normalizeMobile(raw).length === 10;
}

export function demoAuthEmail(phone: string): string {
  return `${phone}@carebridge.demo`;
}

export function verifyDummyOtp(
  code: string,
): { ok: true } | { ok: false; reason: 'EMPTY' | 'INCOMPLETE' | 'MISMATCH' } {
  if (code.length === 0) return { ok: false, reason: 'EMPTY' };
  if (!/^\d{6}$/.test(code)) return { ok: false, reason: 'INCOMPLETE' };
  if (code !== DEMO_OTP) return { ok: false, reason: 'MISMATCH' };
  return { ok: true };
}

function mapAuthError(e: unknown): Error {
  const code = (e as { code?: string } | null)?.code;
  switch (code) {
    case 'auth/email-already-in-use':
      return new Error('Account already exists. Please login.');
    case 'auth/invalid-credential':
    case 'auth/user-not-found':
    case 'auth/wrong-password':
      return new Error('Account not found. Please register first.');
    default:
      return new Error('Could not sign in. Please try again.');
  }
}

export async function requestDummyOtp(phone: string): Promise<void> {
  const normalized = normalizeMobile(phone);
  if (localStore.getUserByPhone(normalized)) {
    return;
  }
  const db = getDbInstance();
  let snapshot: { empty: boolean } | null = null;
  try {
    snapshot = await withTimeout(
      getDocs(query(collection(db, 'users'), where('phone', '==', normalized))),
      2500,
      () => null,
    );
  } catch {
    // If unauthenticated Firestore query is blocked or times out, allow OTP step and verify on login.
    return;
  }
  if (snapshot && snapshot.empty) {
    const err = new Error('Mobile number not found. Please register first.') as Error & {
      code?: string;
    };
    err.code = 'NOT_REGISTERED';
    throw err;
  }
}

export async function claimPendingInvites(
  phone: string,
  email: string,
  uid: string,
  batch: WriteBatch,
): Promise<number> {
  const joinedAt = new Date().toISOString();
  const localClaimed = localStore.claimLocalPendingInvites(phone, email, uid, joinedAt);
  const db = getDbInstance();
  const pendingQueries = [
    getDocs(
      query(
        collectionGroup(db, 'members'),
        where('inviteStatus', '==', 'PENDING'),
        where('invitedPhone', '==', phone),
      ),
    ),
  ];
  if (email) {
    pendingQueries.push(
      getDocs(
        query(
          collectionGroup(db, 'members'),
          where('inviteStatus', '==', 'PENDING'),
          where('invitedEmail', '==', email),
        ),
      ),
    );
  }
  const snapshots = await withTimeout(Promise.all(pendingQueries), 1500, () => []);

  const unique = new Map<string, QueryDocumentSnapshot>();
  for (const snap of snapshots) {
    for (const d of snap.docs) unique.set(d.ref.path, d);
  }

  unique.forEach(d => {
    batch.update(d.ref, { userId: uid, inviteStatus: 'ACCEPTED', joinedAt });
  });
  return Math.max(unique.size, localClaimed);
}

export async function verifyDummyOtpAndLogin(phone: string): Promise<UserProfile> {
  const normalized = normalizeMobile(phone);
  const auth = getAuthInstance();
  const db = getDbInstance();

  const cachedUser = localStore.getUserByPhone(normalized);
  let uid: string = cachedUser?.id ?? `demo_${normalized}`;

  try {
    const cred = await withTimeout(
      signInWithEmailAndPassword(auth, demoAuthEmail(normalized), DEMO_AUTH_SECRET),
      3500,
      () => {
        if (cachedUser) return { user: { uid: cachedUser.id } } as Awaited<ReturnType<typeof signInWithEmailAndPassword>>;
        throw new Error('TIMEOUT');
      },
    );
    uid = cred.user.uid;
  } catch (e) {
    const code = (e as { code?: string } | null)?.code;
    if (
      code === 'auth/invalid-credential' ||
      code === 'auth/user-not-found' ||
      code === 'auth/wrong-password'
    ) {
      if (!cachedUser) {
        throw mapAuthError(e);
      }
    } else if (!cachedUser) {
      throw mapAuthError(e);
    }
  }

  const now = new Date().toISOString();
  let profile: UserProfile | null = cachedUser;

  try {
    const snap = await withTimeout(getDoc(doc(db, 'users', uid)), 2000, () => null);
    if (snap && snap.exists()) {
      profile = snap.data() as UserProfile;
    }
  } catch {
    // Use cached or fallback profile if Firestore read fails
  }

  if (!profile) {
    throw new Error('Account not found. Please register first.');
  }

  const updated: UserProfile = { ...profile, lastLoginAt: now };
  localStore.saveUser(updated);

  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'users', uid), { lastLoginAt: now });
    try {
      await claimPendingInvites(normalized, profile.email ?? '', uid, batch);
    } catch {
      // Ignore missing collectionGroup index
    }
    await withTimeout(batch.commit(), 1500, () => undefined);
  } catch {
    // Local store already updated
  }

  return updated;
}

export async function registerUserWithDummyOtp(input: {
  fullName: string;
  phone: string;
  email: string;
  city: string;
  relationshipLabel: string;
}): Promise<UserProfile> {
  const auth = getAuthInstance();
  const db = getDbInstance();
  const phone = normalizeMobile(input.phone);

  if (localStore.getUserByPhone(phone)) {
    throw new Error('Account already exists. Please login.');
  }

  try {
    const dup = await withTimeout(
      getDocs(query(collection(db, 'users'), where('phone', '==', phone))),
      2000,
      () => null,
    );
    if (dup && !dup.empty) {
      throw new Error('Account already exists. Please login.');
    }
  } catch (e) {
    if ((e as Error).message === 'Account already exists. Please login.') {
      throw e;
    }
  }

  let uid = `user_${phone}`;
  try {
    const cred = await withTimeout(
      createUserWithEmailAndPassword(auth, demoAuthEmail(phone), DEMO_AUTH_SECRET),
      3500,
      () => ({ user: { uid } } as Awaited<ReturnType<typeof createUserWithEmailAndPassword>>),
    );
    uid = cred.user.uid;
  } catch (e) {
    const code = (e as { code?: string } | null)?.code;
    if (code === 'auth/email-already-in-use') {
      // If the Auth user already exists in Firebase Auth, try signing in so we can finish creating/loading their profile
      try {
        const signInCred = await withTimeout(
          signInWithEmailAndPassword(auth, demoAuthEmail(phone), DEMO_AUTH_SECRET),
          2500,
          () => ({ user: { uid } } as Awaited<ReturnType<typeof signInWithEmailAndPassword>>),
        );
        uid = signInCred.user.uid;
      } catch {
        throw mapAuthError(e);
      }
    }
    // For auth/operation-not-allowed, auth/configuration-not-found, or network timeout in demo mode, fall back to deterministic demo uid
  }

  const email = input.email.trim().toLowerCase();
  const now = new Date().toISOString();
  const profile: UserProfile = {
    id: uid,
    fullName: input.fullName.trim(),
    phone,
    email,
    city: input.city.trim(),
    relationshipLabel: input.relationshipLabel.trim(),
    isSyntheticDemo: true,
    createdAt: now,
    lastLoginAt: now,
  };

  localStore.saveUser(profile);

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'users', uid), profile);
    try {
      await claimPendingInvites(phone, email, uid, batch);
    } catch {
      // Proceed even if collectionGroup composite index is not yet deployed.
    }
    await withTimeout(batch.commit(), 1500, () => undefined);
  } catch {
    // Profile is saved in localStore and queued in Firestore cache
  }

  return profile;
}

export async function signOutUser(): Promise<void> {
  const auth = getAuthInstance();
  try {
    await withTimeout(signOut(auth), 1500, () => undefined);
  } catch {
    // Ignore sign-out errors
  }
}
