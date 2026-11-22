// SYNTHETIC DEMO CODE. Writes clearly fake CareBridge demo records only; not medical advice.
import { db } from '../config/firebase';
import {
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  where,
  writeBatch,
  type WriteBatch,
} from 'firebase/firestore';
import type {
  ActivityLog,
  Appointment,
  CareCircleMember,
  CareTask,
  MedicalBill,
  MedicalRecord,
  MonthlyCheckup,
  Prescription,
  PrescriptionItem,
} from '../types/carebridge';
import { localStore, withTimeout } from './localStore';

const MEMBER_READ_TIMEOUT_MS = 2000;
const COMMIT_TIMEOUT_MS = 1500;
const UNSAVED_MESSAGE =
  'The demo data may not be saved yet. Check the lists before relying on it.';
const DEMO_HOSPITAL = 'Demo City General Hospital';
const DEMO_DOCTOR = 'Dr. Sample Physician';
const DEMO_LAB = 'Demo Diagnostics Lab';

// Local calendar date (YYYY-MM-DD).
function toDateOnly(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function addDays(base: Date, days: number): Date {
  const d = new Date(base.getTime());
  d.setDate(d.getDate() + days);
  return d;
}

// Firestore auto-id generator; no network call is made.
function newDocId(patientId: string, collectionName: string): string {
  return doc(collection(db, 'patients', patientId, collectionName)).id;
}

// Throws unless the actor is an accepted CO_CAREGIVER or CONTRIBUTOR on this patient.
async function assertCanSeed(patientId: string, uid: string): Promise<void> {
  const localMe =
    localStore
      .getMembers(patientId)
      .find(m => m.userId === uid && m.inviteStatus === 'ACCEPTED') ?? null;
  if (localMe && (localMe.rolePreset === 'CO_CAREGIVER' || localMe.rolePreset === 'CONTRIBUTOR')) {
    return;
  }

  const snap = await withTimeout(
    getDocs(query(collection(db, 'patients', patientId, 'members'), where('userId', '==', uid))),
    MEMBER_READ_TIMEOUT_MS,
    () => null,
  );
  const me: CareCircleMember | null = snap
    ? snap.docs
        .map(d => ({ ...(d.data() as CareCircleMember), id: d.id }))
        .find(m => m.inviteStatus === 'ACCEPTED') ?? localMe
    : localMe;
  if (!me) throw new Error('Not a member of this care circle.');
  if (me.rolePreset !== 'CO_CAREGIVER' && me.rolePreset !== 'CONTRIBUTOR') {
    throw new Error('Only a Co-caregiver or Contributor can load synthetic demo data.');
  }
}

// Queues one SYNTHETIC DEMO activity log on the shared batch and mirrors it locally.
function queueSeedActivityLog(
  batch: WriteBatch,
  patientId: string,
  actor: { uid: string; name: string },
  entry: Pick<
    ActivityLog,
    'moduleName' | 'actionType' | 'entityType' | 'entityId' | 'summaryText'
  >,
  nowIso: string,
): void {
  const ref = doc(collection(db, 'patients', patientId, 'activityLogs'));
  const log: ActivityLog = {
    id: ref.id,
    patientId,
    actorUserId: actor.uid,
    actorName: actor.name,
    createdAt: nowIso,
    ...entry,
  };
  batch.set(ref, { ...log, createdAt: serverTimestamp() });
  localStore.addActivityLog(patientId, log);
}

// Writes one synthetic demo set under patients/{patientId} in a single batch (13 operations).
// Does not touch the patient document or members.
export async function loadSyntheticDemoData(
  patientId: string,
  actor: { uid: string; name: string },
): Promise<void> {
  await assertCanSeed(patientId, actor.uid);

  const now = new Date();
  const nowIso = now.toISOString();
  const today = toDateOnly(now);
  const currentCycle = today.slice(0, 7);
  const firstOfMonth = `${currentCycle}-01`;
  const scheduledAt = `${toDateOnly(addDays(now, 3))}T09:30`;
  const pastDate = toDateOnly(addDays(now, -14));
  const completedAt = `${pastDate}T09:30`;
  const refillDueDate = toDateOnly(addDays(now, 2));

  const batch = writeBatch(db);

  // 1. SCHEDULED appointment, about 3 days ahead.
  const scheduledRef = doc(collection(db, 'patients', patientId, 'appointments'));
  const scheduled: Appointment = {
    id: scheduledRef.id,
    patientId,
    hospitalName: DEMO_HOSPITAL,
    doctorName: DEMO_DOCTOR,
    visitType: 'IN_PERSON',
    scheduledAt,
    status: 'SCHEDULED',
    bookedByUserId: actor.uid,
    prepRecordIds: [],
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  batch.set(scheduledRef, {
    ...scheduled,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  localStore.upsertAppointment(patientId, scheduled);

  // 2. COMPLETED appointment, about 14 days ago.
  const completedRef = doc(collection(db, 'patients', patientId, 'appointments'));
  const completed: Appointment = {
    id: completedRef.id,
    patientId,
    hospitalName: DEMO_HOSPITAL,
    doctorName: DEMO_DOCTOR,
    visitType: 'IN_PERSON',
    scheduledAt: completedAt,
    status: 'COMPLETED',
    bookedByUserId: actor.uid,
    actualAttendedById: actor.uid,
    completionSummary: 'Synthetic demo summary',
    prepRecordIds: [],
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  batch.set(completedRef, {
    ...completed,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  localStore.upsertAppointment(patientId, completed);

  // 3. APPOINTMENT_REPORT medical record linked to the completed visit.
  const recordRef = doc(collection(db, 'patients', patientId, 'medicalRecords'));
  const record: MedicalRecord = {
    id: recordRef.id,
    patientId,
    recordCategory: 'APPOINTMENT_REPORT',
    recordType: 'OTHER',
    title: 'Synthetic demo visit report',
    facilityName: DEMO_HOSPITAL,
    recordDate: pastDate,
    attachments: [],
    appointmentId: completedRef.id,
    uploadedById: actor.uid,
    createdAt: nowIso,
  };
  batch.set(recordRef, { ...record, createdAt: serverTimestamp() });
  localStore.upsertMedicalRecord(patientId, record);

  // 4. MONTHLY_CHECKUP for the current YYYY-MM cycle.
  const checkupRef = doc(collection(db, 'patients', patientId, 'monthlyCheckups'));
  const checkup: MonthlyCheckup = {
    id: checkupRef.id,
    patientId,
    checkupCycle: currentCycle,
    labName: DEMO_LAB,
    checkupDate: today,
    notes: 'Synthetic demo checkup',
    createdById: actor.uid,
    createdAt: nowIso,
  };
  batch.set(checkupRef, { ...checkup, createdAt: serverTimestamp() });
  localStore.upsertMonthlyCheckup(patientId, checkup);

  // 5. ACTIVE prescription. remainingTablets 6 <= refillThresholdDays 5 x dailyUnitsNeeded 2,
  //    so it shows as a low-stock refill alert.
  const activeItem: PrescriptionItem = {
    id: newDocId(patientId, 'prescriptions'),
    medicineName: 'Demo Medicine A',
    strength: '10 mg (synthetic)',
    timingSlot: 'Morning',
    dailyUnitsNeeded: 2,
    administeredByUserId: actor.uid,
    administeredByLabel: 'Demo Caregiver',
    remainingTablets: 6,
    refillThresholdDays: 5,
    isActive: true,
  };
  const activeRef = doc(collection(db, 'patients', patientId, 'prescriptions'));
  const activePrescription: Prescription = {
    id: activeRef.id,
    patientId,
    prescribedByDoc: DEMO_DOCTOR,
    status: 'ACTIVE',
    startDate: toDateOnly(addDays(now, -30)),
    createdById: actor.uid,
    createdAt: nowIso,
    items: [activeItem],
  };
  batch.set(activeRef, { ...activePrescription, createdAt: serverTimestamp() });
  localStore.upsertPrescription(patientId, activePrescription);

  // 6. DISCONTINUED prescription with startDate and endDate.
  const discontinuedItem: PrescriptionItem = {
    id: newDocId(patientId, 'prescriptions'),
    medicineName: 'Demo Medicine B',
    strength: '5 mg (synthetic)',
    timingSlot: 'Evening',
    dailyUnitsNeeded: 1,
    administeredByUserId: actor.uid,
    administeredByLabel: 'Demo Caregiver',
    remainingTablets: 0,
    refillThresholdDays: 3,
    isActive: false,
  };
  const discontinuedRef = doc(collection(db, 'patients', patientId, 'prescriptions'));
  const discontinuedPrescription: Prescription = {
    id: discontinuedRef.id,
    patientId,
    prescribedByDoc: DEMO_DOCTOR,
    status: 'DISCONTINUED',
    startDate: toDateOnly(addDays(now, -60)),
    endDate: toDateOnly(addDays(now, -10)),
    discontinuationNote: 'Synthetic demo: course ended',
    createdById: actor.uid,
    createdAt: nowIso,
    items: [discontinuedItem],
  };
  batch.set(discontinuedRef, { ...discontinuedPrescription, createdAt: serverTimestamp() });
  localStore.upsertPrescription(patientId, discontinuedPrescription);

  // 7. Two medical bills dated in the current month.
  const pharmacyRef = doc(collection(db, 'patients', patientId, 'medicalBills'));
  const pharmacyBill: MedicalBill = {
    id: pharmacyRef.id,
    patientId,
    amount: 450,
    currencyCode: 'INR',
    category: 'PHARMACY_MEDICINES',
    paidByUserId: actor.uid,
    prescriptionDate: firstOfMonth,
  };
  batch.set(pharmacyRef, {
    ...pharmacyBill,
    notes: 'Synthetic demo pharmacy bill',
    createdById: actor.uid,
    createdAt: serverTimestamp(),
  });
  localStore.upsertMedicalBill(patientId, pharmacyBill);

  const consultRef = doc(collection(db, 'patients', patientId, 'medicalBills'));
  const consultBill: MedicalBill = {
    id: consultRef.id,
    patientId,
    amount: 800,
    currencyCode: 'INR',
    category: 'CONSULTATION',
    paidByUserId: actor.uid,
    prescriptionDate: today,
  };
  batch.set(consultRef, {
    ...consultBill,
    notes: 'Synthetic demo consultation bill',
    createdById: actor.uid,
    createdAt: serverTimestamp(),
  });
  localStore.upsertMedicalBill(patientId, consultBill);

  // 8. PENDING REFILL task linked to the active prescription. It has a dueDate because
  //    the pending-task query orders by dueDate.
  const refillRef = doc(collection(db, 'patients', patientId, 'careTasks'));
  const refillTask: CareTask = {
    id: refillRef.id,
    patientId,
    prescriptionId: activeRef.id,
    taskType: 'REFILL',
    title: 'Refill Demo Medicine A (synthetic)',
    dueDate: refillDueDate,
    status: 'PENDING',
    createdById: actor.uid,
    createdAt: nowIso,
  };
  batch.set(refillRef, { ...refillTask, createdAt: serverTimestamp() });
  localStore.upsertTask(patientId, refillTask);

  // 9. COMPLETED GENERAL task.
  const doneRef = doc(collection(db, 'patients', patientId, 'careTasks'));
  const doneTask: CareTask = {
    id: doneRef.id,
    patientId,
    taskType: 'GENERAL',
    title: 'Synthetic demo follow-up call',
    status: 'COMPLETED',
    createdById: actor.uid,
    completedById: actor.uid,
    completedAt: nowIso,
    createdAt: nowIso,
  };
  batch.set(doneRef, { ...doneTask, createdAt: serverTimestamp() });
  localStore.upsertTask(patientId, doneTask);

  // 10. Three activity log entries, one per seeded action, each with its matching moduleName.
  queueSeedActivityLog(
    batch,
    patientId,
    actor,
    {
      moduleName: 'PRESCRIPTION',
      actionType: 'PRESCRIPTION_CREATED',
      entityType: 'prescription',
      entityId: activeRef.id,
      summaryText: `${actor.name} loaded a synthetic demo prescription`,
    },
    nowIso,
  );
  queueSeedActivityLog(
    batch,
    patientId,
    actor,
    {
      moduleName: 'APPOINTMENT',
      actionType: 'APPOINTMENT_SCHEDULED',
      entityType: 'appointment',
      entityId: scheduledRef.id,
      summaryText: `${actor.name} loaded a synthetic demo appointment at ${DEMO_HOSPITAL}`,
    },
    nowIso,
  );
  queueSeedActivityLog(
    batch,
    patientId,
    actor,
    {
      moduleName: 'TASKS',
      actionType: 'TASK_CREATED',
      entityType: 'careTask',
      entityId: refillRef.id,
      summaryText: `${actor.name} loaded a synthetic demo refill task`,
    },
    nowIso,
  );

  await withTimeout(batch.commit(), COMMIT_TIMEOUT_MS, () => undefined);
}
