// memberUids and memberRoles on patients/{id} are denormalized copies read by firestore.rules.
// They must be updated in the same batch as the member doc (accepted members only).
import { db } from '../config/firebase';
import {
  arrayRemove,
  arrayUnion,
  collection,
  collectionGroup,
  deleteField,
  doc,
  type DocumentData,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  where,
  writeBatch,
  type Unsubscribe,
  type WriteBatch,
} from 'firebase/firestore';
import type {
  ActivityLog,
  CareCircleMember,
  CareRole,
  Patient,
} from '../types/carebridge';
import { isValidMobile, normalizeMobile } from './authService';
import { localStore, withTimeout } from './localStore';
import { getCapabilities } from './permissions';

export interface CreatePatientInput {
  fullName: string;
  relationshipLabel: string;
  bloodGroup?: string;
  allergiesNote?: string;
  city: string;
  creatorName: string;
  creatorPhone?: string;
  creatorEmail?: string;
}

export interface InviteMemberInput {
  invitedEmail: string;
  invitedPhone?: string;
  rolePreset: CareRole;
  isBackupAdmin: boolean;
  canViewFinancials: boolean;
}

export interface MemberChanges {
  rolePreset?: CareRole;
  isBackupAdmin?: boolean;
  canViewFinancials?: boolean;
}

export interface Actor {
  uid: string;
  name: string;
}

export interface PendingInvitation {
  member: CareCircleMember;
  patient: Patient | null;
}

type ActivityInput = Pick<
  ActivityLog,
  'actorUserId' | 'actorName' | 'actionType' | 'entityType' | 'entityId' | 'summaryText'
>;

function toMember(snap: { id: string; data: () => DocumentData | undefined }): CareCircleMember {
  return { ...(snap.data() as CareCircleMember), id: snap.id };
}

// Queues an immutable CARE_CIRCLE audit entry on the caller's batch.
function queueActivityLog(
  batch: WriteBatch,
  patientId: string,
  entry: ActivityInput,
  now: string,
): void {
  const ref = doc(collection(db, 'patients', patientId, 'activityLogs'));
  const log: ActivityLog = {
    id: ref.id,
    patientId,
    moduleName: 'CARE_CIRCLE',
    createdAt: now,
    ...entry,
  };
  batch.set(ref, log);
  localStore.addActivityLog(patientId, log);
}

// Reads the actor's own accepted membership and throws unless it can manage members.
// Only CO_CAREGIVER has canManageMembers, so only a CO_CAREGIVER can grant any role
// (including CO_CAREGIVER) or backup-admin status.
async function assertCanManageMembers(patientId: string, uid: string): Promise<void> {
  const localMe =
    localStore
      .getMembers(patientId)
      .find(m => m.userId === uid && m.inviteStatus === 'ACCEPTED') ?? null;
  if (localMe && getCapabilities(localMe).canManageMembers) {
    return;
  }

  const snap = await withTimeout(
    getDocs(query(collection(db, 'patients', patientId, 'members'), where('userId', '==', uid))),
    2000,
    () => null,
  );
  const me = snap
    ? snap.docs.map(toMember).find(m => m.inviteStatus === 'ACCEPTED') ?? localMe
    : localMe;
  if (!getCapabilities(me).canManageMembers) {
    throw new Error('Only a Co-caregiver can manage the care circle.');
  }
}

export async function createPatientWorkspace(
  uid: string,
  input: CreatePatientInput,
): Promise<string> {
  const patientRef = doc(collection(db, 'patients'));
  const patientId = patientRef.id;
  const now = new Date().toISOString();

  const patient: Patient = {
    id: patientId,
    fullName: input.fullName.trim(),
    relationshipLabel: input.relationshipLabel.trim(),
    city: input.city.trim(),
    createdByUserId: uid,
    isSyntheticDemo: true,
    createdAt: now,
  };
  if (input.bloodGroup?.trim()) patient.bloodGroup = input.bloodGroup.trim();
  if (input.allergiesNote?.trim()) patient.allergiesNote = input.allergiesNote.trim();

  const creatorPhone = input.creatorPhone ? normalizeMobile(input.creatorPhone) : '';
  const creatorMember: CareCircleMember = {
    id: uid,
    patientId,
    userId: uid,
    invitedEmail: (input.creatorEmail ?? '').trim().toLowerCase(),
    invitedPhone: creatorPhone || null,
    inviteStatus: 'ACCEPTED',
    rolePreset: 'CO_CAREGIVER',
    isBackupAdmin: false,
    canViewFinancials: true,
    joinedAt: now,
    createdAt: now,
  };

  localStore.savePatient(patient);
  localStore.upsertMember(patientId, creatorMember);
  localStore.setActivePatientForUser(uid, patientId);

  const patientDoc = {
    ...patient,
    memberUids: [uid],
    memberRoles: {
      [uid]: { rolePreset: 'CO_CAREGIVER', isBackupAdmin: false, canViewFinancials: true },
    },
  };
  const batch = writeBatch(db);
  batch.set(patientRef, patientDoc);
  batch.set(doc(db, 'patients', patientId, 'members', uid), creatorMember);
  queueActivityLog(
    batch,
    patientId,
    {
      actorUserId: uid,
      actorName: input.creatorName,
      actionType: 'PATIENT_WORKSPACE_CREATED',
      entityType: 'patient',
      entityId: patientId,
      summaryText: `${input.creatorName} created the workspace for ${patient.fullName}`,
    },
    now,
  );
  await withTimeout(batch.commit(), 1500, () => undefined);
  return patientId;
}

export async function inviteMember(
  patientId: string,
  actor: Actor,
  input: InviteMemberInput,
): Promise<void> {
  await assertCanManageMembers(patientId, actor.uid);

  const email = input.invitedEmail.trim().toLowerCase();
  const phone = input.invitedPhone ? normalizeMobile(input.invitedPhone) : '';
  if (!email && !phone) throw new Error('Invite needs an email or a phone number.');
  if (phone && !isValidMobile(phone)) throw new Error('Invite phone number is not valid.');

  const memberRef = doc(collection(db, 'patients', patientId, 'members'));
  const now = new Date().toISOString();
  const member: CareCircleMember = {
    id: memberRef.id,
    patientId,
    userId: null,
    invitedEmail: email,
    invitedPhone: phone || null,
    inviteStatus: 'PENDING',
    rolePreset: input.rolePreset,
    isBackupAdmin: input.isBackupAdmin,
    canViewFinancials: input.canViewFinancials,
    createdAt: now,
  };

  localStore.upsertMember(patientId, member);

  const batch = writeBatch(db);
  batch.set(memberRef, member);
  queueActivityLog(
    batch,
    patientId,
    {
      actorUserId: actor.uid,
      actorName: actor.name,
      actionType: 'MEMBER_INVITED',
      entityType: 'member',
      entityId: memberRef.id,
      summaryText: `${actor.name} invited ${email || phone} as ${input.rolePreset}`,
    },
    now,
  );
  await withTimeout(batch.commit(), 1500, () => undefined);
}

export async function updateMemberRole(
  patientId: string,
  memberId: string,
  actor: Actor,
  changes: MemberChanges,
): Promise<void> {
  await assertCanManageMembers(patientId, actor.uid);

  const memberRef = doc(db, 'patients', patientId, 'members', memberId);
  const localBefore = localStore.getMembers(patientId).find(m => m.id === memberId) ?? null;
  const snap = await withTimeout(getDoc(memberRef), 1500, () => null);
  if ((!snap || !snap.exists()) && !localBefore) throw new Error('Member not found.');
  const before = snap && snap.exists() ? toMember(snap) : (localBefore as CareCircleMember);

  const patch: MemberChanges = {};
  const summaries: string[] = [];
  if (changes.rolePreset !== undefined && changes.rolePreset !== before.rolePreset) {
    patch.rolePreset = changes.rolePreset;
    summaries.push(`role ${before.rolePreset} -> ${changes.rolePreset}`);
  }
  if (changes.isBackupAdmin !== undefined && changes.isBackupAdmin !== before.isBackupAdmin) {
    patch.isBackupAdmin = changes.isBackupAdmin;
    summaries.push(`backup admin ${before.isBackupAdmin} -> ${changes.isBackupAdmin}`);
  }
  if (
    changes.canViewFinancials !== undefined &&
    changes.canViewFinancials !== before.canViewFinancials
  ) {
    patch.canViewFinancials = changes.canViewFinancials;
    summaries.push(
      `financials ${before.canViewFinancials} -> ${changes.canViewFinancials}`,
    );
  }
  if (summaries.length === 0) return;

  localStore.upsertMember(patientId, { ...before, ...patch });

  const now = new Date().toISOString();
  const batch = writeBatch(db);
  batch.update(memberRef, patch);
  if (before.userId) {
    const after = { ...before, ...patch };
    batch.update(doc(db, 'patients', patientId), {
      ['memberRoles.' + before.userId]: {
        rolePreset: after.rolePreset,
        isBackupAdmin: after.isBackupAdmin,
        canViewFinancials: after.canViewFinancials,
      },
    });
  }
  queueActivityLog(
    batch,
    patientId,
    {
      actorUserId: actor.uid,
      actorName: actor.name,
      actionType: 'MEMBER_ROLE_UPDATED',
      entityType: 'member',
      entityId: memberId,
      summaryText: `${actor.name} updated ${before.invitedEmail || before.invitedPhone || memberId}: ${summaries.join('; ')}`,
    },
    now,
  );
  await withTimeout(batch.commit(), 1500, () => undefined);
}

export async function removeCareCircleMember(
  patientId: string,
  memberId: string,
  actor: Actor,
): Promise<void> {
  await assertCanManageMembers(patientId, actor.uid);

  const memberRef = doc(db, 'patients', patientId, 'members', memberId);
  const localMembers = localStore.getMembers(patientId);
  const localBefore = localMembers.find(m => m.id === memberId) ?? null;
  const snap = await withTimeout(getDoc(memberRef), 1500, () => null);
  if ((!snap || !snap.exists()) && !localBefore) {
    throw new Error('Member not found.');
  }
  const target = snap && snap.exists() ? toMember(snap) : (localBefore as CareCircleMember);

  if (target.inviteStatus === 'ACCEPTED' && target.rolePreset === 'CO_CAREGIVER') {
    const allMembers = localMembers.length > 0 ? localMembers : [target];
    const coCaregivers = allMembers.filter(
      m => m.inviteStatus === 'ACCEPTED' && m.rolePreset === 'CO_CAREGIVER',
    );
    if (coCaregivers.length <= 1) {
      throw new Error('Cannot remove the last Co-caregiver from the care circle.');
    }
  }

  localStore.removeMember(patientId, memberId);

  const isPending = target.inviteStatus === 'PENDING';
  const label = target.invitedEmail || target.invitedPhone || memberId;
  const now = new Date().toISOString();
  const batch = writeBatch(db);
  batch.delete(memberRef);
  if (target.userId) {
    batch.update(doc(db, 'patients', patientId), {
      memberUids: arrayRemove(target.userId),
      ['memberRoles.' + target.userId]: deleteField(),
    });
  }
  queueActivityLog(
    batch,
    patientId,
    {
      actorUserId: actor.uid,
      actorName: actor.name,
      actionType: isPending ? 'INVITE_REVOKED' : 'MEMBER_REMOVED',
      entityType: 'member',
      entityId: memberId,
      summaryText: isPending
        ? `${actor.name} revoked the invitation for ${label}`
        : `${actor.name} removed ${label} from the care circle`,
    },
    now,
  );
  await withTimeout(batch.commit(), 1500, () => undefined);
}

export async function acceptInvitation(
  patientId: string,
  memberId: string,
  user: { id: string; fullName: string; phone?: string; email?: string },
): Promise<void> {
  const memberRef = doc(db, 'patients', patientId, 'members', memberId);
  const localBefore = localStore.getMembers(patientId).find(m => m.id === memberId) ?? null;
  const snap = await withTimeout(getDoc(memberRef), 1500, () => null);
  if ((!snap || !snap.exists()) && !localBefore) {
    throw new Error('Invitation not found.');
  }
  const before = snap && snap.exists() ? toMember(snap) : (localBefore as CareCircleMember);

  const now = new Date().toISOString();
  const acceptedMember: CareCircleMember = {
    ...before,
    userId: user.id,
    inviteStatus: 'ACCEPTED',
    joinedAt: now,
  };

  localStore.upsertMember(patientId, acceptedMember);
  localStore.setActivePatientForUser(user.id, patientId);

  const batch = writeBatch(db);
  batch.update(memberRef, {
    userId: user.id,
    inviteStatus: 'ACCEPTED',
    joinedAt: now,
  });
  batch.update(doc(db, 'patients', patientId), {
    memberUids: arrayUnion(user.id),
    ['memberRoles.' + user.id]: {
      rolePreset: before.rolePreset,
      isBackupAdmin: before.isBackupAdmin,
      canViewFinancials: before.canViewFinancials,
    },
  });
  queueActivityLog(
    batch,
    patientId,
    {
      actorUserId: user.id,
      actorName: user.fullName,
      actionType: 'INVITE_ACCEPTED',
      entityType: 'member',
      entityId: memberId,
      summaryText: `${user.fullName} accepted the care circle invitation`,
    },
    now,
  );
  await withTimeout(batch.commit(), 1500, () => undefined);
}

export async function findPendingInvitationsForUser(
  phone: string,
  email: string,
): Promise<PendingInvitation[]> {
  const normPhone = phone ? normalizeMobile(phone) : '';
  const normEmail = email ? email.trim().toLowerCase() : '';

  try {
    const queries = [];
    if (normPhone) {
      queries.push(
        withTimeout(
          getDocs(
            query(
              collectionGroup(db, 'members'),
              where('inviteStatus', '==', 'PENDING'),
              where('invitedPhone', '==', normPhone),
            ),
          ),
          1500,
          () => null,
        ),
      );
    }
    if (normEmail) {
      queries.push(
        withTimeout(
          getDocs(
            query(
              collectionGroup(db, 'members'),
              where('inviteStatus', '==', 'PENDING'),
              where('invitedEmail', '==', normEmail),
            ),
          ),
          1500,
          () => null,
        ),
      );
    }
    const snaps = await Promise.all(queries);
    for (const snap of snaps) {
      if (!snap) continue;
      for (const d of snap.docs) {
        const m = toMember(d);
        if (m.patientId) {
          localStore.upsertMember(m.patientId, m);
          if (!localStore.getPatientById(m.patientId)) {
            const pSnap = await withTimeout(
              getDoc(doc(db, 'patients', m.patientId)),
              1200,
              () => null,
            );
            if (pSnap && pSnap.exists()) {
              localStore.savePatient({ ...(pSnap.data() as Patient), id: pSnap.id });
            }
          }
        }
      }
    }
  } catch {
    // Fall back to localStore mirror if collectionGroup composite index is not built.
  }

  return localStore.getPendingInvitationsForUser(normPhone, normEmail);
}

export function subscribePendingInvitations(
  phone: string,
  email: string,
  cb: (invites: PendingInvitation[]) => void,
): Unsubscribe {
  const normPhone = phone ? normalizeMobile(phone) : '';
  const normEmail = email ? email.trim().toLowerCase() : '';

  const emitLocal = () => {
    cb(localStore.getPendingInvitationsForUser(normPhone, normEmail));
  };

  emitLocal();
  void findPendingInvitationsForUser(normPhone, normEmail).then(list => {
    cb(list);
  });

  const unsub = localStore.onPatientChange(emitLocal);
  return unsub;
}

export async function findMyPatients(uid: string): Promise<Patient[]> {
  try {
    const memberSnap = await withTimeout(
      getDocs(
        query(
          collectionGroup(db, 'members'),
          where('userId', '==', uid),
          where('inviteStatus', '==', 'ACCEPTED'),
        ),
      ),
      1500,
      () => null,
    );
    if (memberSnap) {
      for (const d of memberSnap.docs) {
        const m = toMember(d);
        if (m.patientId) {
          localStore.upsertMember(m.patientId, m);
          if (!localStore.getPatientById(m.patientId)) {
            const pSnap = await withTimeout(
              getDoc(doc(db, 'patients', m.patientId)),
              1200,
              () => null,
            );
            if (pSnap && pSnap.exists()) {
              localStore.savePatient({ ...(pSnap.data() as Patient), id: pSnap.id });
            }
          }
        }
      }
    }
  } catch {
    // Ignore missing collectionGroup index
  }

  try {
    const createdSnap = await withTimeout(
      getDocs(query(collection(db, 'patients'), where('createdByUserId', '==', uid))),
      1500,
      () => null,
    );
    if (createdSnap) {
      for (const d of createdSnap.docs) {
        localStore.savePatient({ ...(d.data() as Patient), id: d.id });
      }
    }
  } catch {
    // Ignore read error
  }

  return localStore.getPatientsForUser(uid);
}

export function subscribeMembers(
  patientId: string,
  cb: (members: CareCircleMember[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  const initialLocal = localStore.getMembers(patientId);
  if (initialLocal.length > 0) {
    cb(initialLocal);
  }

  const timer = setTimeout(() => {
    cb(localStore.getMembers(patientId));
  }, 1200);

  const unsubLocal = localStore.onMembersChange(patientId, () => {
    cb(localStore.getMembers(patientId));
  });

  let unsubRemote: Unsubscribe = () => {};
  try {
    unsubRemote = onSnapshot(
      collection(db, 'patients', patientId, 'members'),
      snap => {
        clearTimeout(timer);
        const merged = localStore.setMembersFromRemote(
          patientId,
          snap.docs.map(toMember),
        );
        cb(merged);
      },
      err => {
        clearTimeout(timer);
        const fallback = localStore.getMembers(patientId);
        if (fallback.length > 0) {
          cb(fallback);
        } else {
          onError?.(err);
        }
      },
    );
  } catch (err) {
    clearTimeout(timer);
    onError?.(err as Error);
  }

  return () => {
    clearTimeout(timer);
    unsubLocal();
    unsubRemote();
  };
}

export function subscribeMyMembership(
  patientId: string,
  uid: string,
  cb: (member: CareCircleMember | null) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  const findLocal = () =>
    localStore.getMembers(patientId).find(m => m.userId === uid) ?? null;

  const initial = findLocal();
  if (initial) {
    cb(initial);
  }

  const timer = setTimeout(() => {
    cb(findLocal());
  }, 1200);

  const unsubLocal = localStore.onMembersChange(patientId, () => {
    cb(findLocal());
  });

  const q = query(collection(db, 'patients', patientId, 'members'), where('userId', '==', uid));
  let unsubRemote: Unsubscribe = () => {};
  try {
    unsubRemote = onSnapshot(
      q,
      snap => {
        clearTimeout(timer);
        if (!snap.empty) {
          const m = toMember(snap.docs[0]);
          localStore.upsertMember(patientId, m);
          cb(m);
        } else {
          cb(findLocal());
        }
      },
      err => {
        clearTimeout(timer);
        const local = findLocal();
        if (local) {
          cb(local);
        } else {
          onError?.(err);
        }
      },
    );
  } catch (err) {
    clearTimeout(timer);
    onError?.(err as Error);
  }

  return () => {
    clearTimeout(timer);
    unsubLocal();
    unsubRemote();
  };
}

// Collection-group query: requires a Firestore index on members (userId, inviteStatus) and matching rules.
export async function findMyPatientId(uid: string): Promise<string | null> {
  const localPatientId = localStore.findPatientIdForUser(uid);
  if (localPatientId) {
    return localPatientId;
  }

  try {
    const snap = await withTimeout(
      getDocs(
        query(
          collectionGroup(db, 'members'),
          where('userId', '==', uid),
          where('inviteStatus', '==', 'ACCEPTED'),
        ),
      ),
      1800,
      () => null,
    );
    if (snap && !snap.empty) {
      return (snap.docs[0].data() as CareCircleMember).patientId ?? null;
    }
  } catch {
    // Fall back to direct patients lookup if collectionGroup composite index is not yet built.
  }

  try {
    const createdSnap = await withTimeout(
      getDocs(query(collection(db, 'patients'), where('createdByUserId', '==', uid))),
      1800,
      () => null,
    );
    if (createdSnap && !createdSnap.empty) {
      return createdSnap.docs[0].id;
    }
  } catch {
    // Ignore and return null so user can set up a workspace.
  }

  return localStore.findPatientIdForUser(uid);
}
