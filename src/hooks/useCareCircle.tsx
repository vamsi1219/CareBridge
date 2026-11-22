import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from './useAuth';
import {
  acceptInvitation,
  createPatientWorkspace,
  findMyPatientId,
  findMyPatients,
  subscribeMembers,
  subscribePendingInvitations,
  type CreatePatientInput,
  type PendingInvitation,
} from '../services/careCircleService';
import { localStore } from '../services/localStore';
import type { CareCircleMember, Patient } from '../types/carebridge';

export interface CareCircleState {
  members: CareCircleMember[];
  accepted: CareCircleMember[];
  pending: CareCircleMember[];
  loading: boolean;
  error: string | null;
}

// Live list of care-circle members for one patient, split by invite status.
export function useCareCircle(patientId: string | null): CareCircleState {
  const [members, setMembers] = useState<CareCircleMember[]>([]);
  const [loading, setLoading] = useState(patientId !== null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!patientId) {
      setMembers([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    const unsubscribe = subscribeMembers(
      patientId,
      list => {
        setMembers(list);
        setLoading(false);
      },
      err => {
        setError(err.message);
        setLoading(false);
      },
    );
    return unsubscribe;
  }, [patientId]);

  const accepted = useMemo(
    () => members.filter(m => m.inviteStatus === 'ACCEPTED'),
    [members],
  );
  const pending = useMemo(
    () => members.filter(m => m.inviteStatus === 'PENDING'),
    [members],
  );

  return { members, accepted, pending, loading, error };
}

export interface ActivePatientState {
  patientId: string | null;
  patients: Patient[];
  activePatient: Patient | null;
  loading: boolean;
  // True only when the lookup succeeded and the user has no accepted membership.
  needsWorkspace: boolean;
  isAddingPatient: boolean;
  pendingInvitations: PendingInvitation[];
  error: string | null;
  createWorkspace: (input: Omit<CreatePatientInput, 'creatorName' | 'creatorPhone' | 'creatorEmail'>) => Promise<string>;
  selectPatient: (patientId: string) => void;
  startAddPatient: () => void;
  cancelAddPatient: () => void;
  acceptPendingInvitation: (patientId: string, memberId: string) => Promise<void>;
}

// Resolves the signed-in user's patient workspaces and active patient selection.
export function useActivePatient(): ActivePatientState {
  const { currentUser } = useAuth();
  const uid = currentUser?.id ?? null;
  const userPhone = currentUser?.phone ?? '';
  const userEmail = currentUser?.email ?? '';

  const [patientId, setPatientId] = useState<string | null>(() =>
    uid ? localStore.getActivePatientIdForUser(uid) : null,
  );
  const [patients, setPatients] = useState<Patient[]>(() =>
    uid ? localStore.getPatientsForUser(uid) : [],
  );
  const [isAddingPatient, setIsAddingPatient] = useState<boolean>(() =>
    uid ? localStore.isAddingPatientForUser(uid) : false,
  );
  const [pendingInvitations, setPendingInvitations] = useState<PendingInvitation[]>(() =>
    uid ? localStore.getPendingInvitationsForUser(userPhone, userEmail) : [],
  );
  const [loading, setLoading] = useState(uid !== null && patientId === null);
  const [error, setError] = useState<string | null>(null);
  const [resolved, setResolved] = useState(patientId !== null);

  useEffect(() => {
    let cancelled = false;
    if (!uid) {
      setPatientId(null);
      setPatients([]);
      setIsAddingPatient(false);
      setPendingInvitations([]);
      setResolved(false);
      setError(null);
      setLoading(false);
      return;
    }

    const syncFromLocal = () => {
      if (cancelled) return;
      const list = localStore.getPatientsForUser(uid);
      const activeId = localStore.getActivePatientIdForUser(uid);
      const adding = localStore.isAddingPatientForUser(uid);
      setPatients(list);
      setPatientId(activeId);
      setIsAddingPatient(adding);
      if (activeId || list.length > 0) {
        setResolved(true);
        setError(null);
        setLoading(false);
      }
    };

    const unsubLocal = localStore.onPatientChange(syncFromLocal);
    const unsubInvites = subscribePendingInvitations(userPhone, userEmail, list => {
      if (!cancelled) {
        setPendingInvitations(list);
      }
    });

    syncFromLocal();
    if (!localStore.getActivePatientIdForUser(uid)) {
      setLoading(true);
    }

    Promise.all([findMyPatientId(uid), findMyPatients(uid)])
      .then(([id, allPatients]) => {
        if (cancelled) return;
        const nextId = localStore.getActivePatientIdForUser(uid) ?? id ?? allPatients[0]?.id ?? null;
        setPatients(localStore.getPatientsForUser(uid));
        setPatientId(nextId);
        setIsAddingPatient(localStore.isAddingPatientForUser(uid));
        setResolved(true);
      })
      .catch(() => {
        if (cancelled) return;
        setError('Could not load your patient workspace. Please try again.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      unsubLocal();
      unsubInvites();
    };
  }, [uid, userPhone, userEmail]);

  const createWorkspace = useCallback<ActivePatientState['createWorkspace']>(
    async input => {
      if (!currentUser) throw new Error('You must be signed in to create a workspace.');
      const id = await createPatientWorkspace(currentUser.id, {
        ...input,
        creatorName: currentUser.fullName,
        creatorPhone: currentUser.phone,
        creatorEmail: currentUser.email,
      });
      localStore.setActivePatientForUser(currentUser.id, id);
      setPatients(localStore.getPatientsForUser(currentUser.id));
      setPatientId(id);
      setIsAddingPatient(false);
      setResolved(true);
      setError(null);
      return id;
    },
    [currentUser],
  );

  const selectPatient = useCallback(
    (nextPatientId: string) => {
      if (!uid) return;
      localStore.setActivePatientForUser(uid, nextPatientId);
      setPatientId(nextPatientId);
      setIsAddingPatient(false);
    },
    [uid],
  );

  const startAddPatient = useCallback(() => {
    if (!uid) return;
    localStore.setAddingPatientForUser(uid, true);
    setIsAddingPatient(true);
  }, [uid]);

  const cancelAddPatient = useCallback(() => {
    if (!uid) return;
    localStore.setAddingPatientForUser(uid, false);
    setIsAddingPatient(false);
  }, [uid]);

  const acceptPendingInvitation = useCallback(
    async (targetPatientId: string, memberId: string) => {
      if (!currentUser) throw new Error('You must be signed in to accept an invitation.');
      await acceptInvitation(targetPatientId, memberId, currentUser);
      setPatients(localStore.getPatientsForUser(currentUser.id));
      setPatientId(targetPatientId);
      setIsAddingPatient(false);
      setResolved(true);
      setError(null);
    },
    [currentUser],
  );

  const activePatient = useMemo(
    () => patients.find(p => p.id === patientId) ?? null,
    [patients, patientId],
  );

  return {
    patientId,
    patients,
    activePatient,
    loading,
    needsWorkspace: uid !== null && resolved && !loading && patientId === null && error === null,
    isAddingPatient,
    pendingInvitations,
    error,
    createWorkspace,
    selectPatient,
    startAddPatient,
    cancelAddPatient,
    acceptPendingInvitation,
  };
}
