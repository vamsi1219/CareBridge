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
  RecordAttachment,
  RecordType,
  VisitType,
} from '../types/carebridge';
import { normalizeImageAsset, validateImageAsset } from '../utils/imageCompression';
import type { Actor } from './careCircleService';
import { localStore, withTimeout } from './localStore';
import {
  cancelAppointmentReminder,
  scheduleAppointmentReminder,
} from './notificationService';
import { getCapabilities } from './permissions';

export class AppointmentConflictError extends Error {
  code: 'ALREADY_COMPLETED' | 'STALE_VERSION';
  current: Appointment;

  constructor(
    code: 'ALREADY_COMPLETED' | 'STALE_VERSION',
    message: string,
    current: Appointment,
  ) {
    super(message);
    this.name = 'AppointmentConflictError';
    this.code = code;
    this.current = current;
  }
}

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

export interface FollowUpAppointmentInput {
  hospitalName?: string;
  doctorName?: string;
  visitType?: VisitType;
  /** ISO date-time string */
  scheduledAt: string;
  assignedAttendeeId?: string;
}

export interface AttachmentInput {
  url: string;
  label?: string;
  mimeType?: string;
  sizeBytes?: number;
}

export interface CompleteAppointmentInput {
  actualAttendedById: string;
  completionSummary?: string;
  visitNotes?: string;
  finalAmount?: number;
  finalPaidById?: string;
  expectedVersion?: number;
  clientMutationId?: string;
  simulateOffline?: boolean;
  attachments?: AttachmentInput[];
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
  followUpAppointment?: FollowUpAppointmentInput;
}

export interface RescheduleAppointmentInput {
  scheduledAt: string;
  rescheduleReason?: string;
  expectedVersion?: number;
}

export interface UpdateCompletedAppointmentInput {
  visitNotes?: string;
  attachments?: AttachmentInput[];
  followUpAppointment?: FollowUpAppointmentInput;
  expectedVersion?: number;
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
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function formatShortTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${toLocalDate(iso)} ${hh}:${min}`;
}

function assertOptimisticVersion(
  current: Appointment,
  expectedVersion: number | undefined,
): void {
  if (expectedVersion === undefined) return;
  const currentVersion = current.version ?? 1;
  if (currentVersion === expectedVersion) return;

  if (current.status === 'COMPLETED') {
    const who = current.completedByName || current.completedBy || 'Another caregiver';
    const when = formatShortTime(current.completedAt || current.updatedAt);
    throw new AppointmentConflictError(
      'ALREADY_COMPLETED',
      `Already marked Completed by ${who} at ${when}.`,
      current,
    );
  }
  const who = current.updatedByName || current.updatedBy || 'Another caregiver';
  throw new AppointmentConflictError(
    'STALE_VERSION',
    `${who} updated this appointment (${current.status} · ${formatShortTime(current.scheduledAt)}).`,
    current,
  );
}

function validateAndNormalizeAttachments(
  inputs: AttachmentInput[] | undefined,
  now: string,
): { valid: RecordAttachment[]; rejectedCount: number } {
  if (!inputs || inputs.length === 0) return { valid: [], rejectedCount: 0 };
  const valid: RecordAttachment[] = [];
  let rejectedCount = 0;
  for (const item of inputs) {
    const assetInput = {
      uri: item.url,
      type: item.mimeType,
      fileSize: item.sizeBytes,
    };
    const check = validateImageAsset(assetInput);
    if (!check.ok) {
      rejectedCount += 1;
      continue;
    }
    const normalized = normalizeImageAsset(assetInput);
    const attachment: RecordAttachment = {
      url: normalized.uri,
      uploadedAt: now,
    };
    if (item.label?.trim()) {
      attachment.label = item.label.trim();
    }
    valid.push(attachment);
  }
  return { valid, rejectedCount };
}

function queueFollowUpChildAppointment(
  batch: WriteBatch,
  patientId: string,
  parent: Appointment,
  actor: Actor,
  followUp: FollowUpAppointmentInput,
  now: string,
): string | null {
  const raw = followUp.scheduledAt?.trim();
  if (!raw || Number.isNaN(Date.parse(raw))) {
    return null;
  }
  const scheduledAt = new Date(raw).toISOString();
  const childRef = doc(collection(db, 'patients', patientId, 'appointments'));
  const child: Appointment = {
    id: childRef.id,
    patientId,
    hospitalName: followUp.hospitalName?.trim() || parent.hospitalName,
    doctorName: followUp.doctorName?.trim() || parent.doctorName,
    specialty: parent.specialty,
    visitType: followUp.visitType ?? parent.visitType,
    scheduledAt,
    status: 'SCHEDULED',
    bookedByUserId: actor.uid,
    assignedAttendeeId: followUp.assignedAttendeeId ?? parent.assignedAttendeeId,
    prepRecordIds: [],
    parentAppointmentId: parent.id,
    version: 1,
    syncStatus: 'SYNCED',
    createdAt: now,
    updatedAt: now,
  };
  batch.set(childRef, {
    ...child,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  localStore.upsertAppointment(patientId, child);
  scheduleAppointmentReminder({
    appointmentId: child.id,
    patientId,
    hospitalName: child.hospitalName,
    scheduledAt: child.scheduledAt,
    assignedAttendeeId: child.assignedAttendeeId,
  });
  return child.id;
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
    version: 1,
    syncStatus: 'SYNCED',
    updatedBy: actor.uid,
    updatedByName: actor.name,
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
  scheduleAppointmentReminder({
    appointmentId: ref.id,
    patientId,
    hospitalName,
    scheduledAt,
    assignedAttendeeId: appointment.assignedAttendeeId,
  });
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
): Promise<{ rejectedAttachments: number; childAppointmentId: string | null }> {
  if (input?.clientMutationId && localStore.hasProcessedMutation(input.clientMutationId)) {
    return { rejectedAttachments: 0, childAppointmentId: null };
  }

  // Status check is a plain read followed by a batch write, not a transaction.
  const current = await readAppointment(patientId, appointmentId);
  assertOptimisticVersion(current, input?.expectedVersion);

  if (current.status === 'COMPLETED') {
    const who = current.completedByName || current.completedBy || 'Another caregiver';
    const when = formatShortTime(current.completedAt || current.updatedAt);
    throw new AppointmentConflictError(
      'ALREADY_COMPLETED',
      `Already marked Completed by ${who} at ${when}.`,
      current,
    );
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
    completionSummary: input?.completionSummary ?? input?.visitNotes,
    visitNotes: input?.visitNotes ?? input?.completionSummary,
    finalAmount: input?.finalAmount,
    finalPaidById: input?.finalPaidById,
    createRecord: input?.createRecord,
    followUpTitle: input?.followUpTitle,
    followUpDueDate: input?.followUpDueDate,
    followUpAppointment: input?.followUpAppointment,
    attachments: input?.attachments,
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
  const nextVersion = (current.version ?? 1) + 1;
  const { valid: validAttachments, rejectedCount } = validateAndNormalizeAttachments(
    resolvedInput.attachments,
    now,
  );
  const mergedAttachments = [...(current.attachments ?? []), ...validAttachments];

  const changes: Partial<Appointment> = {
    status: 'COMPLETED',
    actualAttendedById,
    completedAt: now,
    completedBy: actor.uid,
    completedByName: actor.name,
    updatedBy: actor.uid,
    updatedByName: actor.name,
    version: nextVersion,
    syncStatus: input?.simulateOffline ? 'PENDING' : 'SYNCED',
  };
  if (input?.clientMutationId) {
    changes.clientMutationId = input.clientMutationId;
  }
  const visitNotes = resolvedInput.visitNotes?.trim();
  if (visitNotes) {
    changes.completionSummary = visitNotes;
    changes.visitNotes = visitNotes;
  }
  if (mergedAttachments.length > 0) {
    changes.attachments = mergedAttachments;
  }
  if (finalAmount !== undefined) changes.finalAmount = finalAmount;
  if (finalPaidById) changes.finalPaidById = finalPaidById;

  localStore.upsertAppointment(patientId, { ...current, ...changes, updatedAt: now });
  localStore.saveAppointmentDraftNotes(patientId, appointmentId, '');
  cancelAppointmentReminder(appointmentId);

  if (input?.simulateOffline && input.clientMutationId) {
    localStore.queueOfflineMutation({
      clientMutationId: input.clientMutationId,
      patientId,
      appointmentId,
      type: 'COMPLETE',
      createdAt: now,
    });
    return { rejectedAttachments: rejectedCount, childAppointmentId: null };
  }

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
      attachments: validAttachments,
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

  let childAppointmentId: string | null = null;
  if (resolvedInput.followUpAppointment) {
    childAppointmentId = queueFollowUpChildAppointment(
      batch,
      patientId,
      current,
      actor,
      resolvedInput.followUpAppointment,
      now,
    );
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
  if (input?.clientMutationId) {
    localStore.markMutationProcessed(input.clientMutationId);
  }
  return { rejectedAttachments: rejectedCount, childAppointmentId };
}

export async function flushOfflineAppointmentMutation(
  patientId: string,
  appointmentId: string,
  actor: Actor,
  clientMutationId: string,
): Promise<void> {
  if (localStore.hasProcessedMutation(clientMutationId)) return;
  const current = await readAppointment(patientId, appointmentId);
  if (current.syncStatus !== 'PENDING') return;

  const now = new Date().toISOString();
  const synced: Appointment = { ...current, syncStatus: 'SYNCED', updatedAt: now };
  localStore.upsertAppointment(patientId, synced);

  const batch = writeBatch(db);
  batch.update(doc(db, 'patients', patientId, 'appointments', appointmentId), {
    status: current.status,
    syncStatus: 'SYNCED',
    completedAt: current.completedAt,
    completedBy: current.completedBy,
    completedByName: current.completedByName,
    visitNotes: current.visitNotes ?? current.completionSummary ?? '',
    completionSummary: current.completionSummary ?? current.visitNotes ?? '',
    updatedAt: serverTimestamp(),
  });
  await commitBatch(batch, 'Syncing appointment');
  localStore.markMutationProcessed(clientMutationId);
}

export async function rescheduleAppointment(
  patientId: string,
  appointmentId: string,
  actor: Actor,
  input: RescheduleAppointmentInput,
): Promise<void> {
  await assertCanEdit(patientId, actor.uid);
  if (Number.isNaN(Date.parse(input.scheduledAt))) {
    throw new Error('New appointment time is not valid.');
  }
  const current = await readAppointment(patientId, appointmentId);
  assertOptimisticVersion(current, input.expectedVersion);

  if (current.status === 'COMPLETED' || current.status === 'CANCELLED') {
    throw new Error('A completed or cancelled appointment cannot be rescheduled.');
  }

  const nextScheduledAt = new Date(input.scheduledAt).toISOString();
  const now = new Date().toISOString();
  const reason = input.rescheduleReason?.trim();
  const changes: Partial<Appointment> = {
    status: 'SCHEDULED',
    scheduledAt: nextScheduledAt,
    rescheduleCount: (current.rescheduleCount ?? 0) + 1,
    rescheduledBy: actor.uid,
    updatedBy: actor.uid,
    updatedByName: actor.name,
    version: (current.version ?? 1) + 1,
    syncStatus: 'SYNCED',
  };
  if (reason) changes.rescheduleReason = reason;

  localStore.upsertAppointment(patientId, { ...current, ...changes, updatedAt: now });
  scheduleAppointmentReminder({
    appointmentId,
    patientId,
    hospitalName: current.hospitalName,
    scheduledAt: nextScheduledAt,
    assignedAttendeeId: current.assignedAttendeeId,
  });

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
      actionType: 'APPOINTMENT_RESCHEDULED',
      entityType: 'appointment',
      entityId: appointmentId,
      summaryText: `${actor.name} rescheduled ${current.hospitalName} to ${formatShortTime(nextScheduledAt)}${reason ? ` (${reason})` : ''}`,
    },
    now,
  );
  await commitBatch(batch, 'Rescheduling the appointment');
}

export async function markAppointmentMissed(
  patientId: string,
  appointmentId: string,
  actor: Actor,
  expectedVersion?: number,
): Promise<void> {
  await assertCanEdit(patientId, actor.uid);
  const current = await readAppointment(patientId, appointmentId);
  assertOptimisticVersion(current, expectedVersion);

  if (current.status === 'COMPLETED' || current.status === 'CANCELLED') {
    throw new Error('A closed appointment cannot be marked missed.');
  }

  const now = new Date().toISOString();
  const changes: Partial<Appointment> = {
    status: 'MISSED',
    updatedBy: actor.uid,
    updatedByName: actor.name,
    version: (current.version ?? 1) + 1,
    syncStatus: 'SYNCED',
  };
  localStore.upsertAppointment(patientId, { ...current, ...changes, updatedAt: now });
  cancelAppointmentReminder(appointmentId);

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
      actionType: 'APPOINTMENT_MISSED',
      entityType: 'appointment',
      entityId: appointmentId,
      summaryText: `${actor.name} marked ${current.hospitalName} as missed`,
    },
    now,
  );
  await commitBatch(batch, 'Marking appointment missed');
}

export async function revertAppointmentToScheduled(
  patientId: string,
  appointmentId: string,
  actor: Actor,
): Promise<void> {
  await assertCanEdit(patientId, actor.uid);
  const current = await readAppointment(patientId, appointmentId);
  if (current.status !== 'COMPLETED' && current.status !== 'MISSED') {
    throw new Error('Only a completed or missed appointment can be reverted.');
  }

  const now = new Date().toISOString();
  const changes: Partial<Appointment> = {
    status: 'SCHEDULED',
    updatedBy: actor.uid,
    updatedByName: actor.name,
    version: (current.version ?? 1) + 1,
    syncStatus: 'SYNCED',
  };
  localStore.upsertAppointment(patientId, { ...current, ...changes, updatedAt: now });
  if (Date.parse(current.scheduledAt) > Date.now()) {
    scheduleAppointmentReminder({
      appointmentId,
      patientId,
      hospitalName: current.hospitalName,
      scheduledAt: current.scheduledAt,
      assignedAttendeeId: current.assignedAttendeeId,
    });
  }

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
      actionType: 'APPOINTMENT_REVERTED',
      entityType: 'appointment',
      entityId: appointmentId,
      summaryText: `${actor.name} reverted ${current.hospitalName} back to Scheduled`,
    },
    now,
  );
  await commitBatch(batch, 'Reverting the appointment');
}

export async function updateCompletedAppointment(
  patientId: string,
  appointmentId: string,
  actor: Actor,
  input: UpdateCompletedAppointmentInput,
): Promise<{ rejectedAttachments: number; childAppointmentId: string | null }> {
  await assertCanEdit(patientId, actor.uid);
  const current = await readAppointment(patientId, appointmentId);
  assertOptimisticVersion(current, input.expectedVersion);

  if (current.status !== 'COMPLETED') {
    throw new Error('Only a completed appointment can be updated here.');
  }

  const now = new Date().toISOString();
  const { valid: validAttachments, rejectedCount } = validateAndNormalizeAttachments(
    input.attachments,
    now,
  );
  const mergedAttachments = [...(current.attachments ?? []), ...validAttachments];
  const nextNotes = input.visitNotes?.trim();
  const stamp = `Updated by ${actor.name} on ${toLocalDate(now)}`;

  const changes: Partial<Appointment> = {
    updatedBy: actor.uid,
    updatedByName: actor.name,
    lastEditedStamp: stamp,
    version: (current.version ?? 1) + 1,
    syncStatus: 'SYNCED',
    // Preserve original completedBy & completedAt metadata.
    completedBy: current.completedBy ?? current.actualAttendedById,
    completedByName: current.completedByName,
    completedAt: current.completedAt,
  };
  if (nextNotes !== undefined) {
    changes.visitNotes = nextNotes;
    changes.completionSummary = nextNotes;
  }
  if (mergedAttachments.length > 0) {
    changes.attachments = mergedAttachments;
  }

  localStore.upsertAppointment(patientId, { ...current, ...changes, updatedAt: now });

  const batch = writeBatch(db);
  batch.update(doc(db, 'patients', patientId, 'appointments', appointmentId), {
    ...changes,
    updatedAt: serverTimestamp(),
  });

  let childAppointmentId: string | null = null;
  if (input.followUpAppointment) {
    childAppointmentId = queueFollowUpChildAppointment(
      batch,
      patientId,
      current,
      actor,
      input.followUpAppointment,
      now,
    );
  }

  queueActivityLog(
    batch,
    patientId,
    {
      moduleName: 'APPOINTMENT',
      actorUserId: actor.uid,
      actorName: actor.name,
      actionType: 'APPOINTMENT_UPDATED',
      entityType: 'appointment',
      entityId: appointmentId,
      summaryText: `${actor.name} updated notes for ${current.hospitalName}`,
    },
    now,
  );
  await commitBatch(batch, 'Updating the completed appointment');
  return { rejectedAttachments: rejectedCount, childAppointmentId };
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
  const changes: Partial<Appointment> = {
    status: 'CANCELLED',
    cancellationReason: reason,
    updatedBy: actor.uid,
    updatedByName: actor.name,
    version: (current.version ?? 1) + 1,
  };
  localStore.upsertAppointment(patientId, { ...current, ...changes, updatedAt: now });
  cancelAppointmentReminder(appointmentId);

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
