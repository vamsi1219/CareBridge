import type {
  ActivityLog,
  Appointment,
  CareCircleMember,
  CareTask,
  MedicalBill,
  MedicalRecord,
  MonthlyCheckup,
  Patient,
  Prescription,
  UserProfile,
} from '../types/carebridge';

// In-memory local mirror & reactive listeners so UI operations resolve immediately
// even when Firestore WebChannel or missing composite indexes stall in React Native.
const usersById = new Map<string, UserProfile>();
const usersByPhone = new Map<string, UserProfile>();
const patientsById = new Map<string, Patient>();
const membersByPatient = new Map<string, Map<string, CareCircleMember>>();
const logsByPatient = new Map<string, ActivityLog[]>();
const tasksByPatient = new Map<string, Map<string, CareTask>>();
const appointmentsByPatient = new Map<string, Map<string, Appointment>>();
const monthlyCheckupsByPatient = new Map<string, Map<string, MonthlyCheckup>>();
const medicalRecordsByPatient = new Map<string, Map<string, MedicalRecord>>();
const billsByPatient = new Map<string, MedicalBill[]>();
const prescriptionsByPatient = new Map<string, Map<string, Prescription>>();
const activePatientByUser = new Map<string, string>();
const addingPatientByUser = new Map<string, boolean>();
const appointmentDraftNotes = new Map<string, string>();
const processedMutationIds = new Set<string>();
const pendingOfflineMutations = new Map<
  string,
  {
    clientMutationId: string;
    patientId: string;
    appointmentId: string;
    type: 'COMPLETE' | 'UPDATE_NOTES' | 'RESCHEDULE' | 'MISSED' | 'REVERT';
    createdAt: string;
  }
>();

type Listener = () => void;
const memberListeners = new Map<string, Set<Listener>>();
const logListeners = new Map<string, Set<Listener>>();
const taskListeners = new Map<string, Set<Listener>>();
const appointmentListeners = new Map<string, Set<Listener>>();
const monthlyCheckupListeners = new Map<string, Set<Listener>>();
const medicalRecordListeners = new Map<string, Set<Listener>>();
const billListeners = new Map<string, Set<Listener>>();
const prescriptionListeners = new Map<string, Set<Listener>>();
const patientListeners = new Set<Listener>();

function notify(map: Map<string, Set<Listener>>, patientId: string): void {
  const set = map.get(patientId);
  if (!set) return;
  set.forEach(fn => {
    try {
      fn();
    } catch {
      // ignore listener errors
    }
  });
}

function notifyPatientListeners(): void {
  patientListeners.forEach(fn => {
    try {
      fn();
    } catch {
      // ignore listener errors
    }
  });
}

export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  onTimeout: () => T | Promise<T>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      Promise.resolve()
        .then(onTimeout)
        .then(resolve, reject);
    }, ms);

    promise.then(
      val => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(val);
      },
      err => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export const localStore = {
  saveUser(profile: UserProfile): void {
    usersById.set(profile.id, profile);
    if (profile.phone) {
      usersByPhone.set(profile.phone, profile);
    }
  },

  getUserById(uid: string): UserProfile | null {
    return usersById.get(uid) ?? null;
  },

  getUserByPhone(phone: string): UserProfile | null {
    return usersByPhone.get(phone) ?? null;
  },

  savePatient(patient: Patient): void {
    patientsById.set(patient.id, patient);
    if (patient.createdByUserId && !activePatientByUser.has(patient.createdByUserId)) {
      activePatientByUser.set(patient.createdByUserId, patient.id);
    }
    notifyPatientListeners();
  },

  getPatientById(patientId: string): Patient | null {
    return patientsById.get(patientId) ?? null;
  },

  getPatientsForUser(uid: string): Patient[] {
    const patientIds = new Set<string>();
    for (const [patientId, memberMap] of membersByPatient.entries()) {
      for (const m of memberMap.values()) {
        if (m.userId === uid && m.inviteStatus === 'ACCEPTED') {
          patientIds.add(patientId);
        }
      }
    }
    for (const p of patientsById.values()) {
      if (p.createdByUserId === uid) {
        patientIds.add(p.id);
      }
    }
    const result: Patient[] = [];
    for (const pid of patientIds) {
      const existing = patientsById.get(pid);
      if (existing) {
        result.push(existing);
      } else {
        result.push({
          id: pid,
          fullName: 'Care Workspace',
          relationshipLabel: 'Family',
          city: '',
          createdByUserId: uid,
          isSyntheticDemo: true,
          createdAt: '',
        });
      }
    }
    return result;
  },

  setActivePatientForUser(uid: string, patientId: string): void {
    activePatientByUser.set(uid, patientId);
    addingPatientByUser.set(uid, false);
    notifyPatientListeners();
  },

  getActivePatientIdForUser(uid: string): string | null {
    const list = this.getPatientsForUser(uid);
    if (list.length === 0) return null;
    const preferred = activePatientByUser.get(uid);
    if (preferred && list.some(p => p.id === preferred)) {
      return preferred;
    }
    return list[0].id;
  },

  setAddingPatientForUser(uid: string, adding: boolean): void {
    addingPatientByUser.set(uid, adding);
    notifyPatientListeners();
  },

  isAddingPatientForUser(uid: string): boolean {
    return addingPatientByUser.get(uid) === true;
  },

  onPatientChange(fn: Listener): () => void {
    patientListeners.add(fn);
    return () => {
      patientListeners.delete(fn);
    };
  },

  resetAll(): void {
    usersById.clear();
    usersByPhone.clear();
    patientsById.clear();
    membersByPatient.clear();
    logsByPatient.clear();
    tasksByPatient.clear();
    appointmentsByPatient.clear();
    monthlyCheckupsByPatient.clear();
    medicalRecordsByPatient.clear();
    billsByPatient.clear();
    prescriptionsByPatient.clear();
    activePatientByUser.clear();
    addingPatientByUser.clear();
    appointmentDraftNotes.clear();
    processedMutationIds.clear();
    pendingOfflineMutations.clear();
  },

  findPatientIdForUser(uid: string): string | null {
    return this.getActivePatientIdForUser(uid);
  },

  upsertMember(patientId: string, member: CareCircleMember): void {
    let map = membersByPatient.get(patientId);
    if (!map) {
      map = new Map<string, CareCircleMember>();
      membersByPatient.set(patientId, map);
    }
    map.set(member.id, member);
    notify(memberListeners, patientId);
    notifyPatientListeners();
  },

  removeMember(patientId: string, memberId: string): void {
    const map = membersByPatient.get(patientId);
    if (map && map.delete(memberId)) {
      notify(memberListeners, patientId);
      notifyPatientListeners();
    }
  },

  getPendingInvitationsForUser(
    phone: string,
    email: string,
  ): Array<{ member: CareCircleMember; patient: Patient | null }> {
    const normPhone = phone ? phone.replace(/\D/g, '').replace(/^91(\d{10})$/, '$1') : '';
    const normEmail = email ? email.trim().toLowerCase() : '';
    const invites: Array<{ member: CareCircleMember; patient: Patient | null }> = [];
    for (const [patientId, memberMap] of membersByPatient.entries()) {
      for (const m of memberMap.values()) {
        if (m.inviteStatus !== 'PENDING') continue;
        const phoneMatch = Boolean(normPhone && m.invitedPhone === normPhone);
        const emailMatch = Boolean(normEmail && m.invitedEmail.toLowerCase() === normEmail);
        if (phoneMatch || emailMatch) {
          invites.push({
            member: m,
            patient: patientsById.get(patientId) ?? null,
          });
        }
      }
    }
    return invites;
  },

  setMembersFromRemote(patientId: string, list: CareCircleMember[]): CareCircleMember[] {
    let map = membersByPatient.get(patientId);
    if (!map) {
      map = new Map<string, CareCircleMember>();
      membersByPatient.set(patientId, map);
    }
    for (const m of list) {
      map.set(m.id, m);
    }
    return Array.from(map.values());
  },

  getMembers(patientId: string): CareCircleMember[] {
    const map = membersByPatient.get(patientId);
    return map ? Array.from(map.values()) : [];
  },

  claimLocalPendingInvites(phone: string, email: string, uid: string, joinedAt: string): number {
    let count = 0;
    for (const [patientId, memberMap] of membersByPatient.entries()) {
      let changed = false;
      for (const [memberId, m] of memberMap.entries()) {
        if (
          m.inviteStatus === 'PENDING' &&
          ((phone && m.invitedPhone === phone) || (email && m.invitedEmail === email))
        ) {
          memberMap.set(memberId, {
            ...m,
            userId: uid,
            inviteStatus: 'ACCEPTED',
            joinedAt,
          });
          changed = true;
          count += 1;
        }
      }
      if (changed) {
        notify(memberListeners, patientId);
      }
    }
    return count;
  },

  onMembersChange(patientId: string, fn: Listener): () => void {
    let set = memberListeners.get(patientId);
    if (!set) {
      set = new Set<Listener>();
      memberListeners.set(patientId, set);
    }
    set.add(fn);
    return () => {
      set?.delete(fn);
    };
  },

  addActivityLog(patientId: string, log: ActivityLog): void {
    const list = logsByPatient.get(patientId) ?? [];
    const exists = list.some(item => item.id === log.id);
    if (!exists) {
      logsByPatient.set(patientId, [log, ...list]);
      notify(logListeners, patientId);
    }
  },

  mergeActivityLogsFromRemote(patientId: string, remoteLogs: ActivityLog[]): ActivityLog[] {
    const map = new Map<string, ActivityLog>();
    for (const l of logsByPatient.get(patientId) ?? []) {
      map.set(l.id, l);
    }
    for (const l of remoteLogs) {
      map.set(l.id, l);
    }
    const merged = Array.from(map.values()).sort((a, b) =>
      String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')),
    );
    logsByPatient.set(patientId, merged);
    return merged;
  },

  getActivityLogs(patientId: string): ActivityLog[] {
    return logsByPatient.get(patientId) ?? [];
  },

  onActivityLogsChange(patientId: string, fn: Listener): () => void {
    let set = logListeners.get(patientId);
    if (!set) {
      set = new Set<Listener>();
      logListeners.set(patientId, set);
    }
    set.add(fn);
    return () => {
      set?.delete(fn);
    };
  },

  upsertTask(patientId: string, task: CareTask): void {
    let map = tasksByPatient.get(patientId);
    if (!map) {
      map = new Map<string, CareTask>();
      tasksByPatient.set(patientId, map);
    }
    map.set(task.id, task);
    notify(taskListeners, patientId);
  },

  getPendingTasks(patientId: string): CareTask[] {
    const map = tasksByPatient.get(patientId);
    if (!map) return [];
    return Array.from(map.values())
      .filter(t => t.status === 'PENDING')
      .sort((a, b) => String(a.dueDate ?? '').localeCompare(String(b.dueDate ?? '')));
  },

  onTasksChange(patientId: string, fn: Listener): () => void {
    let set = taskListeners.get(patientId);
    if (!set) {
      set = new Set<Listener>();
      taskListeners.set(patientId, set);
    }
    set.add(fn);
    return () => {
      set?.delete(fn);
    };
  },

  upsertAppointment(patientId: string, appointment: Appointment): void {
    let map = appointmentsByPatient.get(patientId);
    if (!map) {
      map = new Map<string, Appointment>();
      appointmentsByPatient.set(patientId, map);
    }
    map.set(appointment.id, appointment);
    notify(appointmentListeners, patientId);
  },

  setAppointmentsFromRemote(patientId: string, list: Appointment[]): Appointment[] {
    let map = appointmentsByPatient.get(patientId);
    if (!map) {
      map = new Map<string, Appointment>();
      appointmentsByPatient.set(patientId, map);
    }
    for (const a of list) {
      map.set(a.id, a);
    }
    notify(appointmentListeners, patientId);
    return Array.from(map.values());
  },

  getAppointments(patientId: string): Appointment[] {
    const map = appointmentsByPatient.get(patientId);
    return map ? Array.from(map.values()) : [];
  },

  saveAppointmentDraftNotes(patientId: string, appointmentId: string, notes: string): void {
    const key = `${patientId}:${appointmentId}`;
    if (notes) {
      appointmentDraftNotes.set(key, notes);
    } else {
      appointmentDraftNotes.delete(key);
    }
  },

  getAppointmentDraftNotes(patientId: string, appointmentId: string): string {
    return appointmentDraftNotes.get(`${patientId}:${appointmentId}`) ?? '';
  },

  hasProcessedMutation(clientMutationId: string): boolean {
    return processedMutationIds.has(clientMutationId);
  },

  markMutationProcessed(clientMutationId: string): void {
    processedMutationIds.add(clientMutationId);
    pendingOfflineMutations.delete(clientMutationId);
  },

  queueOfflineMutation(entry: {
    clientMutationId: string;
    patientId: string;
    appointmentId: string;
    type: 'COMPLETE' | 'UPDATE_NOTES' | 'RESCHEDULE' | 'MISSED' | 'REVERT';
    createdAt: string;
  }): void {
    pendingOfflineMutations.set(entry.clientMutationId, entry);
  },

  getPendingOfflineMutations(patientId?: string) {
    const all = Array.from(pendingOfflineMutations.values());
    return patientId ? all.filter(m => m.patientId === patientId) : all;
  },

  onAppointmentsChange(patientId: string, fn: Listener): () => void {
    let set = appointmentListeners.get(patientId);
    if (!set) {
      set = new Set<Listener>();
      appointmentListeners.set(patientId, set);
    }
    set.add(fn);
    return () => {
      set?.delete(fn);
    };
  },

  upsertMonthlyCheckup(patientId: string, checkup: MonthlyCheckup): void {
    let map = monthlyCheckupsByPatient.get(patientId);
    if (!map) {
      map = new Map<string, MonthlyCheckup>();
      monthlyCheckupsByPatient.set(patientId, map);
    }
    map.set(checkup.id, checkup);
    notify(monthlyCheckupListeners, patientId);
  },

  setMonthlyCheckupsFromRemote(patientId: string, list: MonthlyCheckup[]): MonthlyCheckup[] {
    let map = monthlyCheckupsByPatient.get(patientId);
    if (!map) {
      map = new Map<string, MonthlyCheckup>();
      monthlyCheckupsByPatient.set(patientId, map);
    }
    for (const c of list) {
      map.set(c.id, c);
    }
    notify(monthlyCheckupListeners, patientId);
    return Array.from(map.values());
  },

  getMonthlyCheckups(patientId: string): MonthlyCheckup[] {
    const map = monthlyCheckupsByPatient.get(patientId);
    return map ? Array.from(map.values()) : [];
  },

  onMonthlyCheckupsChange(patientId: string, fn: Listener): () => void {
    let set = monthlyCheckupListeners.get(patientId);
    if (!set) {
      set = new Set<Listener>();
      monthlyCheckupListeners.set(patientId, set);
    }
    set.add(fn);
    return () => {
      set?.delete(fn);
    };
  },

  upsertMedicalRecord(patientId: string, record: MedicalRecord): void {
    let map = medicalRecordsByPatient.get(patientId);
    if (!map) {
      map = new Map<string, MedicalRecord>();
      medicalRecordsByPatient.set(patientId, map);
    }
    map.set(record.id, record);
    notify(medicalRecordListeners, patientId);
  },

  setMedicalRecordsFromRemote(patientId: string, list: MedicalRecord[]): MedicalRecord[] {
    let map = medicalRecordsByPatient.get(patientId);
    if (!map) {
      map = new Map<string, MedicalRecord>();
      medicalRecordsByPatient.set(patientId, map);
    }
    for (const r of list) {
      map.set(r.id, r);
    }
    notify(medicalRecordListeners, patientId);
    return Array.from(map.values());
  },

  getMedicalRecords(patientId: string): MedicalRecord[] {
    const map = medicalRecordsByPatient.get(patientId);
    return map ? Array.from(map.values()) : [];
  },

  onMedicalRecordsChange(patientId: string, fn: Listener): () => void {
    let set = medicalRecordListeners.get(patientId);
    if (!set) {
      set = new Set<Listener>();
      medicalRecordListeners.set(patientId, set);
    }
    set.add(fn);
    return () => {
      set?.delete(fn);
    };
  },

  // Append-only: a bill with an id already present is ignored, never replaced.
  appendMedicalBill(patientId: string, bill: MedicalBill): void {
    const list = billsByPatient.get(patientId) ?? [];
    const exists = list.some(item => item.id === bill.id);
    if (!exists) {
      billsByPatient.set(patientId, [...list, bill]);
      notify(billListeners, patientId);
    }
  },

  // Insert-or-replace by bill id, in the same per-patient bills store used by appendMedicalBill.
  upsertMedicalBill(patientId: string, bill: MedicalBill): void {
    const list = billsByPatient.get(patientId) ?? [];
    const index = list.findIndex(item => item.id === bill.id);
    if (index >= 0) {
      const next = list.slice();
      next[index] = bill;
      billsByPatient.set(patientId, next);
    } else {
      billsByPatient.set(patientId, [...list, bill]);
    }
    notify(billListeners, patientId);
  },

  getMedicalBills(patientId: string): MedicalBill[] {
    return billsByPatient.get(patientId) ?? [];
  },

  onMedicalBillsChange(patientId: string, fn: Listener): () => void {
    let set = billListeners.get(patientId);
    if (!set) {
      set = new Set<Listener>();
      billListeners.set(patientId, set);
    }
    set.add(fn);
    return () => {
      set?.delete(fn);
    };
  },

  upsertPrescription(patientId: string, prescription: Prescription): void {
    let map = prescriptionsByPatient.get(patientId);
    if (!map) {
      map = new Map<string, Prescription>();
      prescriptionsByPatient.set(patientId, map);
    }
    map.set(prescription.id, prescription);
    notify(prescriptionListeners, patientId);
  },

  getPrescriptions(patientId: string): Prescription[] {
    const map = prescriptionsByPatient.get(patientId);
    return map ? Array.from(map.values()) : [];
  },

  onPrescriptionsChange(patientId: string, fn: Listener): () => void {
    let set = prescriptionListeners.get(patientId);
    if (!set) {
      set = new Set<Listener>();
      prescriptionListeners.set(patientId, set);
    }
    set.add(fn);
    return () => {
      set?.delete(fn);
    };
  },
};
