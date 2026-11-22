import { db } from '../config/firebase';
import {
  collection,
  doc,
  type DocumentData,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  where,
  writeBatch,
  type Unsubscribe,
  type WriteBatch,
} from 'firebase/firestore';
import type {
  ActivityLog,
  CareCircleMember,
  MedicalRecord,
  MonthlyCheckup,
  RecordAttachment,
  RecordCategory,
  RecordType,
} from '../types/carebridge';
import type { Actor } from './careCircleService';
import { localStore, withTimeout } from './localStore';
import { getCapabilities } from './permissions';

export interface CreateMonthlyCheckupInput {
  /** 'YYYY-MM' */
  checkupCycle: string;
  labName: string;
  /** 'YYYY-MM-DD' */
  checkupDate: string;
  notes?: string;
}

export interface CreateMedicalRecordInput {
  recordCategory: RecordCategory;
  recordType: RecordType;
  title: string;
  facilityName?: string;
  /** 'YYYY-MM-DD' */
  recordDate: string;
  /** 'YYYY-MM', required when recordCategory is MONTHLY_CHECKUP */
  checkupCycle?: string;
  appointmentId?: string;
  monthlyCheckupId?: string;
  /**
   * Attachments are inline objects only. Uploading files to Storage is out of scope
   * for this service; callers must supply URLs that already exist.
   */
  attachments: RecordAttachment[];
}

type ActivityInput = Pick<
  ActivityLog,
  | 'moduleName'
  | 'actorUserId'
  | 'actorName'
  | 'actionType'
  | 'entityType'
  | 'entityId'
  | 'summaryText'
>;

const COMMIT_TIMEOUT_MS = 1500;
const PERMISSION_READ_TIMEOUT_MS = 2000;
const CHECKUP_CYCLE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_ONLY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

function toMember(snap: { id: string; data: () => DocumentData | undefined }): CareCircleMember {
  return { ...(snap.data() as CareCircleMember), id: snap.id };
}

function toMedicalRecord(snap: { id: string; data: () => DocumentData | undefined }): MedicalRecord {
  return { ...(snap.data() as MedicalRecord), id: snap.id };
}

function toMonthlyCheckup(snap: { id: string; data: () => DocumentData | undefined }): MonthlyCheckup {
  return { ...(snap.data() as MonthlyCheckup), id: snap.id };
}

// Queues an immutable RECORDS audit entry on the caller's batch.
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
    createdAt: now,
    ...entry,
  };
  batch.set(ref, log);
  localStore.addActivityLog(patientId, log);
}

// Reads the actor's own accepted membership and throws unless it can edit.
// OBSERVER is rejected with 'Read-only role'. Known gap: getCapabilities ignores isBackupAdmin.
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
    PERMISSION_READ_TIMEOUT_MS,
    () => null,
  );
  const me = snap
    ? snap.docs.map(toMember).find(m => m.inviteStatus === 'ACCEPTED') ?? localMe
    : localMe;
  if (getCapabilities(me).canEdit) {
    return;
  }
  if (me?.rolePreset === 'OBSERVER') {
    throw new Error('Read-only role');
  }
  throw new Error('You do not have permission to change this workspace.');
}

// Local mirror is applied before the commit (same as careCircleService).
function commitBatch(batch: WriteBatch, _label: string): Promise<void> {
  return withTimeout(batch.commit(), COMMIT_TIMEOUT_MS, () => undefined);
}

export function subscribeMedicalRecords(
  patientId: string,
  cb: (items: MedicalRecord[]) => void,
): Unsubscribe {
  const emitLocal = (): void => {
    cb(localStore.getMedicalRecords(patientId));
  };
  emitLocal();

  const unsubLocal = localStore.onMedicalRecordsChange(patientId, emitLocal);

  let unsubRemote: Unsubscribe = () => {};
  try {
    const q = query(
      collection(db, 'patients', patientId, 'medicalRecords'),
      orderBy('recordDate', 'desc'),
    );
    unsubRemote = onSnapshot(
      q,
      snap => {
        // setMedicalRecordsFromRemote notifies listeners, which re-emits through emitLocal.
        localStore.setMedicalRecordsFromRemote(patientId, snap.docs.map(toMedicalRecord));
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

export function subscribeMonthlyCheckups(
  patientId: string,
  cb: (items: MonthlyCheckup[]) => void,
): Unsubscribe {
  const emitLocal = (): void => {
    cb(localStore.getMonthlyCheckups(patientId));
  };
  emitLocal();

  const unsubLocal = localStore.onMonthlyCheckupsChange(patientId, emitLocal);

  let unsubRemote: Unsubscribe = () => {};
  try {
    const q = query(
      collection(db, 'patients', patientId, 'monthlyCheckups'),
      orderBy('checkupCycle', 'desc'),
    );
    unsubRemote = onSnapshot(
      q,
      snap => {
        // setMonthlyCheckupsFromRemote notifies listeners, which re-emits through emitLocal.
        localStore.setMonthlyCheckupsFromRemote(patientId, snap.docs.map(toMonthlyCheckup));
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

export async function createMonthlyCheckup(
  patientId: string,
  actor: Actor,
  input: CreateMonthlyCheckupInput,
): Promise<string> {
  await assertCanEdit(patientId, actor.uid);

  const checkupCycle = input.checkupCycle.trim();
  if (!CHECKUP_CYCLE.test(checkupCycle)) {
    throw new Error('Checkup cycle must be YYYY-MM.');
  }
  const labName = input.labName.trim();
  if (!labName) throw new Error('Lab name is required.');
  if (!DATE_ONLY.test(input.checkupDate)) {
    throw new Error('Checkup date must be YYYY-MM-DD.');
  }

  const ref = doc(collection(db, 'patients', patientId, 'monthlyCheckups'));
  const now = new Date().toISOString();
  const checkup: MonthlyCheckup = {
    id: ref.id,
    patientId,
    checkupCycle,
    labName,
    checkupDate: input.checkupDate,
    createdById: actor.uid,
    createdAt: now,
  };
  const notes = input.notes?.trim();
  if (notes) checkup.notes = notes;

  const batch = writeBatch(db);
  batch.set(ref, checkup);
  queueActivityLog(
    batch,
    patientId,
    {
      moduleName: 'RECORDS',
      actorUserId: actor.uid,
      actorName: actor.name,
      actionType: 'MONTHLY_CHECKUP_CREATED',
      entityType: 'monthlyCheckup',
      entityId: ref.id,
      summaryText: `${actor.name} added the ${checkupCycle} checkup at ${labName}`,
    },
    now,
  );

  localStore.upsertMonthlyCheckup(patientId, checkup);
  await commitBatch(batch, 'Saving the monthly checkup');
  return ref.id;
}

export async function createMedicalRecord(
  patientId: string,
  actor: Actor,
  input: CreateMedicalRecordInput,
): Promise<string> {
  await assertCanEdit(patientId, actor.uid);

  const title = input.title.trim();
  if (!title) throw new Error('Record title is required.');
  if (!DATE_ONLY.test(input.recordDate)) {
    throw new Error('Record date must be YYYY-MM-DD.');
  }

  const checkupCycle = input.checkupCycle?.trim() || undefined;
  if (input.recordCategory === 'MONTHLY_CHECKUP') {
    if (!checkupCycle) throw new Error('A monthly checkup record needs a checkup cycle.');
  }
  if (checkupCycle !== undefined && !CHECKUP_CYCLE.test(checkupCycle)) {
    throw new Error('Checkup cycle must be YYYY-MM.');
  }

  for (const attachment of input.attachments) {
    if (!attachment.url || !attachment.url.trim()) {
      throw new Error('Every attachment needs a URL.');
    }
  }

  const ref = doc(collection(db, 'patients', patientId, 'medicalRecords'));
  const now = new Date().toISOString();
  const record: MedicalRecord = {
    id: ref.id,
    patientId,
    recordCategory: input.recordCategory,
    recordType: input.recordType,
    title,
    recordDate: input.recordDate,
    attachments: input.attachments.map(a => ({ ...a })),
    uploadedById: actor.uid,
    createdAt: now,
  };
  const facilityName = input.facilityName?.trim();
  if (facilityName) record.facilityName = facilityName;
  if (checkupCycle) record.checkupCycle = checkupCycle;
  if (input.appointmentId) record.appointmentId = input.appointmentId;
  if (input.monthlyCheckupId) record.monthlyCheckupId = input.monthlyCheckupId;

  const batch = writeBatch(db);
  batch.set(ref, record);
  queueActivityLog(
    batch,
    patientId,
    {
      moduleName: 'RECORDS',
      actorUserId: actor.uid,
      actorName: actor.name,
      actionType: 'RECORD_CREATED',
      entityType: 'medicalRecord',
      entityId: ref.id,
      summaryText: `${actor.name} added record "${title}"`,
    },
    now,
  );

  localStore.upsertMedicalRecord(patientId, record);
  await commitBatch(batch, 'Saving the record');
  return ref.id;
}
