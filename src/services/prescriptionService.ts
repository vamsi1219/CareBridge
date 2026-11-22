// SYNTHETIC DEMO CODE. Prescription records for CareBridge demo data only; not medical advice.
import { db } from '../config/firebase';
import {
  collection,
  doc,
  type DocumentData,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
  writeBatch,
  type Unsubscribe,
  type WriteBatch,
} from 'firebase/firestore';
import type {
  ActivityLog,
  CareCircleMember,
  CareTask,
  Prescription,
  PrescriptionItem,
} from '../types/carebridge';
import { durationBetween, isLowStock } from '../utils/durationCalculator';
import type { Actor } from './careCircleService';
import { localStore, withTimeout } from './localStore';
import { getCapabilities } from './permissions';

export type PrescriptionItemInput = Omit<PrescriptionItem, 'id' | 'isActive'>;

export interface CreatePrescriptionInput {
  prescribedByDoc: string;
  /** 'YYYY-MM-DD' */
  startDate: string;
  appointmentId?: string;
  medicalRecordId?: string;
  sourceImageUrl?: string;
  items: PrescriptionItemInput[];
}

export interface DiscontinuePrescriptionInput {
  /** 'YYYY-MM-DD' */
  endDate: string;
  discontinuationNote?: string;
}

type ActivityInput = Pick<
  ActivityLog,
  'actorUserId' | 'actorName' | 'actionType' | 'entityType' | 'entityId' | 'summaryText'
>;

const COMMIT_TIMEOUT_MS = 1500;
const READ_TIMEOUT_MS = 1500;
const MEMBER_READ_TIMEOUT_MS = 2000;
const UNSAVED_MESSAGE =
  'The change may not be saved yet. Check the prescription again before relying on it.';

// Firestore auto-id generator; no network call is made.
function generateId(patientId: string): string {
  return doc(collection(db, 'patients', patientId, 'prescriptions')).id;
}

// Converts a Firestore Timestamp (or an ISO string from the local mirror) to an ISO string.
function toIsoString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof (value as { toDate?: unknown }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return '';
}

function prescriptionFromDoc(id: string, data: DocumentData): Prescription {
  const raw = data as Omit<Prescription, 'createdAt'> & { createdAt?: unknown };
  return {
    ...raw,
    id,
    items: Array.isArray(raw.items) ? raw.items : [],
    createdAt: toIsoString(raw.createdAt),
  };
}

function sortByCreatedAt(list: Prescription[]): Prescription[] {
  return [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function prescriptionRef(patientId: string, prescriptionId: string) {
  return doc(db, 'patients', patientId, 'prescriptions', prescriptionId);
}

// 'YYYY-MM-DD' that is a real calendar date (durationBetween returns 0 for invalid input).
function isValidDateOnly(value: string): boolean {
  return durationBetween(value, value) > 0;
}

// Queues an immutable PRESCRIPTION audit entry on the caller's batch.
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
    moduleName: 'PRESCRIPTION',
    createdAt: now,
    ...entry,
  };
  batch.set(ref, { ...log, createdAt: serverTimestamp() });
  localStore.addActivityLog(patientId, log);
}

// Reads the actor's own accepted membership and throws unless it can edit prescriptions.
async function assertCanEdit(patientId: string, uid: string): Promise<void> {
  const localMe =
    localStore
      .getMembers(patientId)
      .find(m => m.userId === uid && m.inviteStatus === 'ACCEPTED') ?? null;
  if (localMe && getCapabilities(localMe).canEdit) {
    return;
  }

  const snap = await withTimeout(
    getDocs(query(collection(db, 'patients', patientId, 'members'), where('userId', '==', uid))),
    MEMBER_READ_TIMEOUT_MS,
    () => null,
  );
  const me: CareCircleMember | null = snap
    ? (snap.docs
        .map(d => ({ ...(d.data() as CareCircleMember), id: d.id }))
        .find(m => m.inviteStatus === 'ACCEPTED') ?? localMe)
    : localMe;
  if (!me) throw new Error('Not a member of this care circle.');
  if (!getCapabilities(me).canEdit) throw new Error('Read-only role');
}

// Reads the prescription from the local mirror first, falling back to Firestore if not cached locally.
async function readPrescriptionForChange(
  patientId: string,
  prescriptionId: string,
): Promise<Prescription> {
  const local =
    localStore.getPrescriptions(patientId).find(p => p.id === prescriptionId) ?? null;
  if (local) return local;

  const snap = await withTimeout(
    getDoc(prescriptionRef(patientId, prescriptionId)),
    READ_TIMEOUT_MS,
    () => null,
  );
  if (snap && snap.exists()) {
    return prescriptionFromDoc(snap.id, snap.data() ?? {});
  }
  throw new Error('Prescription not found.');
}

// Checks for an open REFILL task for this prescription. Checks local mirror first.
async function hasOpenRefill(patientId: string, prescriptionId: string): Promise<boolean> {
  const localHas = localStore
    .getPendingTasks(patientId)
    .some(t => t.taskType === 'REFILL' && t.prescriptionId === prescriptionId);
  if (localHas) return true;

  try {
    const snap = await withTimeout(
      getDocs(
        query(
          collection(db, 'patients', patientId, 'careTasks'),
          where('taskType', '==', 'REFILL'),
          where('status', '==', 'PENDING'),
          where('prescriptionId', '==', prescriptionId),
        ),
      ),
      READ_TIMEOUT_MS,
      () => null,
    );
    if (snap) return !snap.empty;
  } catch {
    // Fall through to the local mirror when the composite index is not built.
  }
  return false;
}

// Validates the input items and assigns each an id, isActive true, and trimmed text fields.
function buildItems(patientId: string, items: PrescriptionItemInput[]): PrescriptionItem[] {
  if (items.length === 0) throw new Error('Add at least one medicine.');
  return items.map((item, index) => {
    const label = `Medicine ${index + 1}`;
    const medicineName = item.medicineName.trim();
    const timingSlot = item.timingSlot.trim();
    if (!medicineName) throw new Error(`${label} needs a medicine name.`);
    if (!timingSlot) throw new Error(`${label} needs a timing slot.`);
    if (!Number.isFinite(item.dailyUnitsNeeded) || item.dailyUnitsNeeded <= 0) {
      throw new Error(`${label} needs a daily units value greater than 0.`);
    }
    if (!Number.isFinite(item.remainingTablets) || item.remainingTablets < 0) {
      throw new Error(`${label} needs a remaining tablets value of 0 or more.`);
    }
    if (!Number.isFinite(item.refillThresholdDays) || item.refillThresholdDays < 0) {
      throw new Error(`${label} needs a refill threshold of 0 days or more.`);
    }

    const built: PrescriptionItem = {
      id: generateId(patientId),
      medicineName,
      timingSlot,
      dailyUnitsNeeded: item.dailyUnitsNeeded,
      administeredByLabel: item.administeredByLabel.trim(),
      remainingTablets: item.remainingTablets,
      refillThresholdDays: item.refillThresholdDays,
      isActive: true,
    };
    if (item.strength?.trim()) built.strength = item.strength.trim();
    if (item.administeredByUserId) built.administeredByUserId = item.administeredByUserId;
    return built;
  });
}

// Commits the batch under the shared timeout (local mirror is already updated).
function commitOrThrow(batch: WriteBatch): Promise<void> {
  return withTimeout(batch.commit(), COMMIT_TIMEOUT_MS, () => undefined);
}

// Live list of a patient's prescriptions, oldest first. Requires a Firestore index on prescriptions (createdAt).
export function subscribePrescriptions(
  patientId: string,
  cb: (items: Prescription[]) => void,
): Unsubscribe {
  const emitLocal = (): void => {
    cb(sortByCreatedAt(localStore.getPrescriptions(patientId)));
  };

  emitLocal();
  const unsubLocal = localStore.onPrescriptionsChange(patientId, emitLocal);

  const q = query(collection(db, 'patients', patientId, 'prescriptions'), orderBy('createdAt'));
  let unsubRemote: Unsubscribe = () => {};
  try {
    unsubRemote = onSnapshot(
      q,
      snap => {
        for (const d of snap.docs) {
          localStore.upsertPrescription(patientId, prescriptionFromDoc(d.id, d.data()));
        }
        emitLocal();
      },
      () => {
        emitLocal();
      },
    );
  } catch {
    emitLocal();
  }

  return () => {
    unsubLocal();
    unsubRemote();
  };
}

// Creates an ACTIVE prescription and its PRESCRIPTION_CREATED audit entry in one batch.
export async function createPrescription(
  patientId: string,
  actor: Actor,
  input: CreatePrescriptionInput,
): Promise<string> {
  await assertCanEdit(patientId, actor.uid);

  const prescribedByDoc = input.prescribedByDoc.trim();
  if (!prescribedByDoc) throw new Error('Prescribing doctor is required.');
  if (!isValidDateOnly(input.startDate)) {
    throw new Error('Start date must be a valid YYYY-MM-DD date.');
  }
  const items = buildItems(patientId, input.items);

  const ref = doc(collection(db, 'patients', patientId, 'prescriptions'));
  const now = new Date().toISOString();
  const prescription: Prescription = {
    id: ref.id,
    patientId,
    prescribedByDoc,
    status: 'ACTIVE',
    startDate: input.startDate,
    createdById: actor.uid,
    createdAt: now,
    items,
  };
  if (input.appointmentId) prescription.appointmentId = input.appointmentId;
  if (input.medicalRecordId) prescription.medicalRecordId = input.medicalRecordId;
  if (input.sourceImageUrl) prescription.sourceImageUrl = input.sourceImageUrl;

  localStore.upsertPrescription(patientId, prescription);

  const batch = writeBatch(db);
  batch.set(ref, { ...prescription, createdAt: serverTimestamp() });
  queueActivityLog(
    batch,
    patientId,
    {
      actorUserId: actor.uid,
      actorName: actor.name,
      actionType: 'PRESCRIPTION_CREATED',
      entityType: 'prescription',
      entityId: ref.id,
      summaryText: `${actor.name} added a prescription from ${prescribedByDoc} with ${items.length} medicine(s)`,
    },
    now,
  );
  await commitOrThrow(batch);
  return ref.id;
}

// Records one dose: decrements the item's remaining tablets (floor 0), logs DOSE_LOGGED,
// and opens a REFILL task when the supply is now low and no open refill exists.
// NOTE: the reads (prescription, open refill) and the batch write are not transactional.
// Two members logging at the same moment can both decrement from the same starting count.
export async function logDailyDose(
  patientId: string,
  prescriptionId: string,
  itemId: string,
  actor: Actor,
): Promise<void> {
  await assertCanEdit(patientId, actor.uid);

  const prescription = await readPrescriptionForChange(patientId, prescriptionId);
  if (prescription.status !== 'ACTIVE') {
    throw new Error('Only an active prescription can log doses.');
  }
  const item = prescription.items.find(i => i.id === itemId);
  if (!item) throw new Error('Prescription item not found.');
  if (!item.isActive) throw new Error('This medicine is no longer active.');

  const newRemaining = Math.max(0, item.remainingTablets - item.dailyUnitsNeeded);
  const newItems: PrescriptionItem[] = prescription.items.map(i =>
    i.id === itemId ? { ...i, remainingTablets: newRemaining } : i,
  );
  const now = new Date().toISOString();

  const lowStock = isLowStock(newRemaining, item.dailyUnitsNeeded, item.refillThresholdDays);
  const needsRefillTask = lowStock && !(await hasOpenRefill(patientId, prescriptionId));

  const batch = writeBatch(db);
  batch.update(prescriptionRef(patientId, prescriptionId), { items: newItems });
  queueActivityLog(
    batch,
    patientId,
    {
      actorUserId: actor.uid,
      actorName: actor.name,
      actionType: 'DOSE_LOGGED',
      entityType: 'prescription',
      entityId: prescriptionId,
      summaryText: `${actor.name} logged a dose of ${item.medicineName}; ${newRemaining} tablets left`,
    },
    now,
  );

  localStore.upsertPrescription(patientId, { ...prescription, items: newItems });

  if (needsRefillTask) {
    const taskRef = doc(collection(db, 'patients', patientId, 'careTasks'));
    const task: CareTask = {
      id: taskRef.id,
      patientId,
      prescriptionId,
      taskType: 'REFILL',
      title: `Refill ${item.medicineName}`,
      status: 'PENDING',
      createdById: actor.uid,
      createdAt: now,
    };
    batch.set(taskRef, { ...task, createdAt: serverTimestamp() });
    localStore.upsertTask(patientId, task);
  }

  await commitOrThrow(batch);
}

// Marks an ACTIVE prescription DISCONTINUED, deactivates all items, and logs PRESCRIPTION_DISCONTINUED.
export async function discontinuePrescription(
  patientId: string,
  prescriptionId: string,
  actor: Actor,
  input: DiscontinuePrescriptionInput,
): Promise<void> {
  await assertCanEdit(patientId, actor.uid);

  const prescription = await readPrescriptionForChange(patientId, prescriptionId);
  if (prescription.status !== 'ACTIVE') {
    throw new Error('Only an active prescription can be discontinued.');
  }
  if (durationBetween(prescription.startDate, input.endDate) === 0) {
    throw new Error('End date must be a valid date on or after the start date.');
  }

  const note = input.discontinuationNote?.trim() ?? '';
  const newItems: PrescriptionItem[] = prescription.items.map(i => ({ ...i, isActive: false }));
  const now = new Date().toISOString();

  const updated: Prescription = {
    ...prescription,
    status: 'DISCONTINUED',
    endDate: input.endDate,
    items: newItems,
  };
  if (note) updated.discontinuationNote = note;
  localStore.upsertPrescription(patientId, updated);

  const patch: DocumentData = {
    status: 'DISCONTINUED',
    endDate: input.endDate,
    items: newItems,
  };
  if (note) patch.discontinuationNote = note;

  const batch = writeBatch(db);
  batch.update(prescriptionRef(patientId, prescriptionId), patch);
  queueActivityLog(
    batch,
    patientId,
    {
      actorUserId: actor.uid,
      actorName: actor.name,
      actionType: 'PRESCRIPTION_DISCONTINUED',
      entityType: 'prescription',
      entityId: prescriptionId,
      summaryText: `${actor.name} discontinued the prescription from ${prescription.prescribedByDoc} (ended ${input.endDate})`,
    },
    now,
  );
  await commitOrThrow(batch);
}
