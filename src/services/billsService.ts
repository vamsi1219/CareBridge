import { db } from '../config/firebase';
import {
  collection,
  doc,
  type DocumentData,
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
  BillCategory,
  CareCircleMember,
  MedicalBill,
} from '../types/carebridge';
import { formatRupees } from '../utils/expenseMath';
import type { MonthRange } from './dashboardSelectors';
import type { Actor } from './careCircleService';
import { localStore, withTimeout } from './localStore';
import { getCapabilities } from './permissions';

export interface AddMedicalBillInput {
  category: BillCategory;
  amount: number;
  /** 'YYYY-MM-DD' */
  prescriptionDate: string;
  paidByUserId: string;
  notes?: string;
  appointmentId?: string;
}

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Newest prescriptionDate first. Works on 'YYYY-MM-DD' strings, so localeCompare is safe.
function sortByPrescriptionDateDesc(list: MedicalBill[]): MedicalBill[] {
  return list.slice().sort((a, b) => b.prescriptionDate.localeCompare(a.prescriptionDate));
}

// Queues an immutable BILLS audit entry on the caller's batch.
function queueBillActivityLog(
  batch: WriteBatch,
  patientId: string,
  actor: Actor,
  billId: string,
  summaryText: string,
  now: string,
): void {
  const ref = doc(collection(db, 'patients', patientId, 'activityLogs'));
  const log: ActivityLog = {
    id: ref.id,
    patientId,
    moduleName: 'BILLS',
    actorUserId: actor.uid,
    actorName: actor.name,
    actionType: 'BILL_ADDED',
    entityType: 'bill',
    entityId: billId,
    summaryText,
    createdAt: now,
  };
  batch.set(ref, log);
  localStore.addActivityLog(patientId, log);
}

// Reads the actor's own accepted membership and throws unless it can edit bills.
// Same local-then-remote lookup as careCircleService.assertCanManageMembers.
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
    2000,
    () => null,
  );
  const me: CareCircleMember | null = snap
    ? snap.docs
        .map(d => ({ ...(d.data() as CareCircleMember), id: d.id }))
        .find(m => m.inviteStatus === 'ACCEPTED') ?? localMe
    : localMe;
  if (!getCapabilities(me).canEdit) {
    throw new Error('You do not have permission to add bills for this patient.');
  }
}

// Live bills for one patient, newest prescriptionDate first. Emits the local mirror
// immediately and again on every remote snapshot or local change.
export function subscribeMedicalBills(
  patientId: string,
  cb: (items: MedicalBill[]) => void,
): Unsubscribe {
  const emitLocal = () => {
    cb(sortByPrescriptionDateDesc(localStore.getMedicalBills(patientId)));
  };

  emitLocal();

  const timer = setTimeout(emitLocal, 1200);
  const unsubLocal = localStore.onMedicalBillsChange(patientId, emitLocal);

  let unsubRemote: Unsubscribe = () => {};
  try {
    unsubRemote = onSnapshot(
      query(collection(db, 'patients', patientId, 'medicalBills'), orderBy('prescriptionDate', 'desc')),
      snap => {
        clearTimeout(timer);
        for (const d of snap.docs) {
          localStore.upsertMedicalBill(patientId, {
            ...(d.data() as MedicalBill),
            id: d.id,
          });
        }
        emitLocal();
      },
      () => {
        clearTimeout(timer);
        emitLocal();
      },
    );
  } catch {
    clearTimeout(timer);
    emitLocal();
  }

  return () => {
    clearTimeout(timer);
    unsubLocal();
    unsubRemote();
  };
}

// Creates one bill and its BILLS activity log in a single batch.
export async function addMedicalBill(
  patientId: string,
  actor: Actor,
  input: AddMedicalBillInput,
): Promise<string> {
  await assertCanEdit(patientId, actor.uid);

  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error('Amount must be a number greater than zero.');
  }
  if (!DATE_ONLY_PATTERN.test(input.prescriptionDate)) {
    throw new Error('Bill date must be in YYYY-MM-DD format.');
  }
  const paidByUserId = input.paidByUserId.trim();
  if (!paidByUserId) {
    throw new Error('Choose who paid for this bill.');
  }

  const ref = doc(collection(db, 'patients', patientId, 'medicalBills'));
  const now = new Date().toISOString();

  const bill: MedicalBill = {
    id: ref.id,
    patientId,
    amount: input.amount,
    currencyCode: 'INR',
    category: input.category,
    paidByUserId,
    prescriptionDate: input.prescriptionDate,
  };
  const appointmentId = input.appointmentId?.trim();
  if (appointmentId) bill.appointmentId = appointmentId;

  const remote: DocumentData = {
    ...bill,
    createdById: actor.uid,
    createdAt: serverTimestamp(),
  };
  const notes = input.notes?.trim();
  if (notes) remote.notes = notes;

  localStore.upsertMedicalBill(patientId, bill);

  const summaryText = `${actor.name} added a ${formatRupees(input.amount)} ${input.category} bill`;
  const batch = writeBatch(db);
  batch.set(ref, remote);
  queueBillActivityLog(batch, patientId, actor, ref.id, summaryText, now);
  await withTimeout(batch.commit(), 1500, () => undefined);
  return ref.id;
}

// Pure: bills in one category, or all bills when category is 'ALL'.
export function filterBillsByCategory(
  bills: MedicalBill[],
  category: BillCategory | 'ALL',
): MedicalBill[] {
  if (category === 'ALL') return bills.slice();
  return bills.filter(bill => bill.category === category);
}

// Pure: bills whose prescriptionDate falls inside the month, both ends inclusive.
export function monthBills(bills: MedicalBill[], month: MonthRange): MedicalBill[] {
  return bills.filter(
    bill => bill.prescriptionDate >= month.start && bill.prescriptionDate <= month.end,
  );
}
