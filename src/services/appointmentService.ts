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
  Timestamp,
  where,
  writeBatch,
  type Unsubscribe,
  type WriteBatch,
} from 'firebase/firestore';
import type {
  ActivityLog,
  Appointment,
  CareCircleMember,
  CareTask,
  MedicalBill,
  MedicalRecord,
  RecordType,
  VisitType,
} from '../types/carebridge';
import type { Actor } from './careCircleService';
import { localStore, withTimeout } from './localStore';
import { getCapabilities } from './permissions';

export interface CreateAppointmentInput {
  hospitalName: string;
  doctorName?: string;
  specialty?: string;
  visitType: VisitType;
  /** ISO date-time string */
  scheduledAt: string;
  bookedByUserId: string;
  assignedAttendeeId?: string;
  bookingPaidById?: string;
  bookingAmount?: number;
  prepNotes?: string;
  prepRecordIds: string[];
}

export interface CompleteAppointmentInput {
  actualAttendedById: string;
  completionSummary?: string;
  finalAmount?: number;
  finalPaidById?: string;
  createRecord?: {
    title: string;
    recordType: RecordType;
    facilityName?: string;
    /** 'YYYY-MM-DD' */
    recordDate: string;
  };
  followUpTitle?: string;
  /** 'YYYY-MM-DD' */
  followUpDueDate?: string;
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
const READ_TIMEOUT_MS = 2000;
const DATE_ONLY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

function toMember(snap: { id: string; data: () => DocumentData | undefined }): CareCircleMember {
  return { ...(snap.data() as CareCircleMember), id: snap.id };
}

// serverTimestamp() fields come back from Firestore as Timestamp objects; the app types use ISO strings.
function toIsoString(value: unknown): string {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  return typeof value === 'string' ? value : '';
}

function toAppointment(snap: { id: string; data: () => DocumentData | undefined }): Appointment {
  const data = snap.data() as DocumentData;
  return {
    ...(data as Appointment),
    id: snap.id,
    createdAt: toIsoString(data.createdAt),
    updatedAt: toIsoString(data.updatedAt),
  };
}

// Local calendar date (YYYY-MM-DD) of an ISO date-time, used for bill and summary dates.
function toLocalDate(iso: string): string {
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function sortByScheduledAt(list: Appointment[]): Appointment[] {
  return [...list].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
}

// Queues an immutable APPOINTMENT / RECORDS audit entry on the caller's batch.
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

// Queues a medicalBills document on the caller's batch and mirrors it locally.
function queueMedicalBill(
  batch: WriteBatch,
  patientId: string,
  input: Omit<MedicalBill, 'id' | 'patientId'>,
): void {
  const ref = doc(collection(db, 'patients', patientId, 'medicalBills'));
  const bill: MedicalBill = { id: ref.id, patientId, ...input };
  batch.set(ref, bill);
  localStore.appendMedicalBill(patientId, bill);
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

// Reads one appointment from the local mirror first, falling back to Firestore if not cached locally.
async function readAppointment(patientId: string, appointmentId: string): Promise<Appointment> {
  const local = localStore.getAppointments(patientId).find(a => a.id === appointmentId);
  if (local) {
    return local;
  }
  const snap = await withTimeout(
    getDoc(doc(db, 'patients', patientId, 'appointments', appointmentId)),
    READ_TIMEOUT_MS,
    () => null,
  );
  if (snap && snap.exists()) {
    return toAppointment(snap);
  }
  throw new Error('Appointment not found.');
}

// Local mirror is applied before the commit (same as careCircleService).
function commitBatch(batch: WriteBatch, _label: string): Promise<void> {
  return withTimeout(batch.commit(), COMMIT_TIMEOUT_MS, () => undefined);
}

export function subscribeAppointments(
  patientId: string,
  cb: (items: Appointment[]) => void,
): Unsubscribe {
  const emitLocal = (): void => {
    cb(sortByScheduledAt(localStore.getAppointments(patientId)));
  };
  emitLocal();

  const unsubLocal = localStore.onAppointmentsChange(patientId, emitLocal);

  let unsubRemote: Unsubscribe = () => {};
  try {
    const q = query(
      collection(db, 'patients', patientId, 'appointments'),
      orderBy('scheduledAt'),
    );
    unsubRemote = onSnapshot(
      q,
      snap => {
        // setAppointmentsFromRemote notifies listeners, which re-emits through emitLocal.
        localStore.setAppointmentsFromRemote(patientId, snap.docs.map(toAppointment));
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

export async function createAppointment(
  patientId: string,
  actor: Actor,
  input: CreateAppointmentInput,
): Promise<string> {
  await assertCanEdit(patientId, actor.uid);

  const hospitalName = input.hospitalName.trim();
  if (!hospitalName) throw new Error('Hospital name is required.');
  if (Number.isNaN(Date.parse(input.scheduledAt))) {
    throw new Error('Appointment time is not valid.');
  }
  const scheduledAt = new Date(input.scheduledAt).toISOString();

  const ref = doc(collection(db, 'patients', patientId, 'appointments'));
  const now = new Date().toISOString();
  const appointment: Appointment = {
    id: ref.id,
    patientId,
    hospitalName,
    visitType: input.visitType,
    scheduledAt,
    status: 'SCHEDULED',
    bookedByUserId: input.bookedByUserId,
    prepRecordIds: [...input.prepRecordIds],
    createdAt: now,
    updatedAt: now,
  };
  const doctorName = input.doctorName?.trim();
  if (doctorName) appointment.doctorName = doctorName;
  const specialty = input.specialty?.trim();
  if (specialty) appointment.specialty = specialty;
  const assignedAttendeeId = input.assignedAttendeeId?.trim();
  if (assignedAttendeeId) appointment.assignedAttendeeId = assignedAttendeeId;
  const bookingPaidById = input.bookingPaidById?.trim();
  if (bookingPaidById) appointment.bookingPaidById = bookingPaidById;
  const bookingAmount = input.bookingAmount;
  if (bookingAmount !== undefined) appointment.bookingAmount = bookingAmount;
  const prepNotes = input.prepNotes?.trim();
  if (prepNotes) appointment.prepNotes = prepNotes;

  const batch = writeBatch(db);
  batch.set(ref, {
    ...appointment,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  if (bookingAmount !== undefined && bookingAmount > 0 && bookingPaidById) {
    queueMedicalBill(batch, patientId, {
      amount: bookingAmount,
      currencyCode: 'INR',
      category: 'CONSULTATION',
      paidByUserId: bookingPaidById,
      prescriptionDate: toLocalDate(scheduledAt),
      appointmentId: ref.id,
    });
  }

  queueActivityLog(
    batch,
    patientId,
    {
      moduleName: 'APPOINTMENT',
      actorUserId: actor.uid,
      actorName: actor.name,
      actionType: 'APPOINTMENT_SCHEDULED',
      entityType: 'appointment',
      entityId: ref.id,
      summaryText: `${actor.name} scheduled ${hospitalName} on ${toLocalDate(scheduledAt)}`,
    },
    now,
  );

  localStore.upsertAppointment(patientId, appointment);
  await commitBatch(batch, 'Scheduling the appointment');
  return ref.id;
}

export async function reassignAttendee(
  patientId: string,
  appointmentId: string,
  actor: Actor,
  assignedAttendeeId: string,
): Promise<void> {
  await assertCanEdit(patientId, actor.uid);

  const attendee = assignedAttendeeId.trim();
  if (!attendee) throw new Error('Pick an attendee.');

  const current = await readAppointment(patientId, appointmentId);
  if (current.status === 'COMPLETED' || current.status === 'CANCELLED') {
    throw new Error('A closed appointment cannot be reassigned.');
  }

  const now = new Date().toISOString();
  const changes: Partial<Appointment> = { assignedAttendeeId: attendee };
  localStore.upsertAppointment(patientId, { ...current, ...changes, updatedAt: now });

  const batch = writeBatch(db);
  batch.update(doc(db, 'patients', patientId, 'appointments', appointmentId), {
    ...changes,
    updatedAt: serverTimestamp(),
  });
  queueActivityLog(
    batch,
    patientId,
    {
      moduleName: 'APPOINTMENT',
      actorUserId: actor.uid,
      actorName: actor.name,
      actionType: 'ATTENDEE_REASSIGNED',
      entityType: 'appointment',
      entityId: appointmentId,
      summaryText: `${actor.name} reassigned the visit to ${attendee}`,
    },
    now,
  );
  await commitBatch(batch, 'Reassigning the attendee');
}

export async function startAttend(
  patientId: string,
  appointmentId: string,
  actor: Actor,
): Promise<void> {
  // Status check is a plain read followed by a batch write, not a transaction.
  const current = await readAppointment(patientId, appointmentId);
  if (current.assignedAttendeeId) {
    if (current.assignedAttendeeId !== actor.uid) {
      throw new Error('Only the assigned attendee can start this appointment.');
    }
  } else {
    await assertCanEdit(patientId, actor.uid);
  }

  if (current.status !== 'SCHEDULED') {
    throw new Error('Only a scheduled appointment can be started.');
  }

  const now = new Date().toISOString();
  const changes: Partial<Appointment> = { status: 'ATTEND' };
  localStore.upsertAppointment(patientId, { ...current, ...changes, updatedAt: now });

  const batch = writeBatch(db);
  batch.update(doc(db, 'patients', patientId, 'appointments', appointmentId), {
    ...changes,
    updatedAt: serverTimestamp(),
  });
  queueActivityLog(
    batch,
    patientId,
    {
      moduleName: 'APPOINTMENT',
      actorUserId: actor.uid,
      actorName: actor.name,
      actionType: 'APPOINTMENT_ATTEND_STARTED',
      entityType: 'appointment',
      entityId: appointmentId,
      summaryText: `${actor.name} started attending ${current.hospitalName}`,
    },
    now,
  );
  await commitBatch(batch, 'Starting the visit');
}

export async function completeAppointment(
  patientId: string,
  appointmentId: string,
  actor: Actor,
  input?: Partial<CompleteAppointmentInput>,
): Promise<void> {
  // Status check is a plain read followed by a batch write, not a transaction.
  const current = await readAppointment(patientId, appointmentId);
  if (current.status === 'COMPLETED') {
    throw new Error('This appointment is already completed.');
  }
  if (current.status === 'CANCELLED') {
    throw new Error('A cancelled appointment cannot be completed.');
  }

  if (current.assignedAttendeeId) {
    if (current.assignedAttendeeId !== actor.uid) {
      throw new Error('Only the assigned attendee can mark this appointment as completed.');
    }
  } else {
    await assertCanEdit(patientId, actor.uid);
  }

  const resolvedInput: CompleteAppointmentInput = {
    actualAttendedById:
      input?.actualAttendedById?.trim() || current.assignedAttendeeId || actor.uid,
    completionSummary: input?.completionSummary,
    finalAmount: input?.finalAmount,
    finalPaidById: input?.finalPaidById,
    createRecord: input?.createRecord,
    followUpTitle: input?.followUpTitle,
    followUpDueDate: input?.followUpDueDate,
  };

  const actualAttendedById = resolvedInput.actualAttendedById.trim();
  if (!actualAttendedById) throw new Error('Record who attended the visit.');

  const finalAmount = resolvedInput.finalAmount;
  const finalPaidById = resolvedInput.finalPaidById?.trim() || undefined;
  if (finalAmount !== undefined && finalAmount < 0) {
    throw new Error('Final amount cannot be negative.');
  }
  if (finalAmount !== undefined && finalAmount > 0 && !finalPaidById) {
    throw new Error('Choose who paid the final amount.');
  }

  const createRecord = resolvedInput.createRecord;
  const recordTitle = createRecord?.title.trim() ?? '';
  if (createRecord) {
    if (!recordTitle) throw new Error('Record title is required.');
    if (!DATE_ONLY.test(createRecord.recordDate)) {
      throw new Error('Record date must be YYYY-MM-DD.');
    }
  }

  const followUpTitle = resolvedInput.followUpTitle?.trim() ?? '';
  if (resolvedInput.followUpDueDate && !DATE_ONLY.test(resolvedInput.followUpDueDate)) {
    throw new Error('Follow-up due date must be YYYY-MM-DD.');
  }

  const now = new Date().toISOString();
  const changes: Partial<Appointment> = { status: 'COMPLETED', actualAttendedById };
  const completionSummary = resolvedInput.completionSummary?.trim();
  if (completionSummary) changes.completionSummary = completionSummary;
  if (finalAmount !== undefined) changes.finalAmount = finalAmount;
  if (finalPaidById) changes.finalPaidById = finalPaidById;

  localStore.upsertAppointment(patientId, { ...current, ...changes, updatedAt: now });

  const batch = writeBatch(db);
  batch.update(doc(db, 'patients', patientId, 'appointments', appointmentId), {
    ...changes,
    updatedAt: serverTimestamp(),
  });

  if (finalAmount !== undefined && finalAmount > 0 && finalPaidById) {
    queueMedicalBill(batch, patientId, {
      amount: finalAmount,
      currencyCode: 'INR',
      category: 'CONSULTATION',
      paidByUserId: finalPaidById,
      prescriptionDate: toLocalDate(current.scheduledAt),
      appointmentId,
    });
  }

  if (createRecord) {
    const recordRef = doc(collection(db, 'patients', patientId, 'medicalRecords'));
    const record: MedicalRecord = {
      id: recordRef.id,
      patientId,
      recordCategory: 'APPOINTMENT_REPORT',
      recordType: createRecord.recordType,
      title: recordTitle,
      recordDate: createRecord.recordDate,
      // Attachments are inline objects; file upload is out of scope for this service.
      attachments: [],
      appointmentId,
      uploadedById: actor.uid,
      createdAt: now,
    };
    const facilityName = createRecord.facilityName?.trim();
    if (facilityName) record.facilityName = facilityName;
    batch.set(recordRef, record);
    localStore.upsertMedicalRecord(patientId, record);
  }

  if (followUpTitle) {
    const taskRef = doc(collection(db, 'patients', patientId, 'careTasks'));
    const task: CareTask = {
      id: taskRef.id,
      patientId,
      appointmentId,
      taskType: 'GENERAL',
      title: followUpTitle,
      status: 'PENDING',
      createdById: actor.uid,
      createdAt: now,
    };
    if (resolvedInput.followUpDueDate) task.dueDate = resolvedInput.followUpDueDate;
    batch.set(taskRef, task);
    localStore.upsertTask(patientId, task);
  }

  queueActivityLog(
    batch,
    patientId,
    {
      moduleName: 'APPOINTMENT',
      actorUserId: actor.uid,
      actorName: actor.name,
      actionType: 'APPOINTMENT_COMPLETED',
      entityType: 'appointment',
      entityId: appointmentId,
      summaryText: `${actor.name} completed ${current.hospitalName}`,
    },
    now,
  );
  await commitBatch(batch, 'Completing the appointment');
}

export async function cancelAppointment(
  patientId: string,
  appointmentId: string,
  actor: Actor,
  cancellationReason: string,
): Promise<void> {
  await assertCanEdit(patientId, actor.uid);

  const reason = cancellationReason.trim();
  if (!reason) throw new Error('A cancellation reason is required.');

  // Status check is a plain read followed by a batch write, not a transaction.
  const current = await readAppointment(patientId, appointmentId);
  if (current.status === 'COMPLETED') {
    throw new Error('A completed appointment cannot be cancelled.');
  }
  if (current.status === 'CANCELLED') {
    throw new Error('This appointment is already cancelled.');
  }

  const now = new Date().toISOString();
  const changes: Partial<Appointment> = { status: 'CANCELLED', cancellationReason: reason };
  localStore.upsertAppointment(patientId, { ...current, ...changes, updatedAt: now });

  const batch = writeBatch(db);
  batch.update(doc(db, 'patients', patientId, 'appointments', appointmentId), {
    ...changes,
    updatedAt: serverTimestamp(),
  });
  queueActivityLog(
    batch,
    patientId,
    {
      moduleName: 'APPOINTMENT',
      actorUserId: actor.uid,
      actorName: actor.name,
      actionType: 'APPOINTMENT_CANCELLED',
      entityType: 'appointment',
      entityId: appointmentId,
      summaryText: `${actor.name} cancelled ${current.hospitalName}: ${reason}`,
    },
    now,
  );
  await commitBatch(batch, 'Cancelling the appointment');
}
