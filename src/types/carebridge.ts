export interface UserProfile {
  id: string;
  fullName: string;
  phone: string;
  email: string;
  city: string;
  relationshipLabel: string;
  isSyntheticDemo: boolean;
  createdAt: string;
  lastLoginAt: string;
}

export interface CareCircleMember {
  id: string;
  patientId: string;
  userId: string | null;
  invitedEmail: string;
  invitedPhone: string | null;
  inviteStatus: 'PENDING' | 'ACCEPTED';
  rolePreset: 'CO_CAREGIVER' | 'CONTRIBUTOR' | 'OBSERVER';
  isBackupAdmin: boolean;
  canViewFinancials: boolean;
  joinedAt?: string;
  createdAt: string;
}

export interface Patient {
  id: string;
  fullName: string;
  relationshipLabel: string;
  bloodGroup?: string;
  allergiesNote?: string;
  city: string;
  createdByUserId: string;
  isSyntheticDemo: true;
  createdAt: string;
}

export type CareRole = CareCircleMember['rolePreset'];

// Shape follows ARCHITECTURE_AND_DB.md §2 (activityLogs), not the brief's
// simplified action/summary names.
export interface ActivityLog {
  id: string;
  patientId: string;
  actorUserId: string;
  actorName: string;
  moduleName: 'CARE_CIRCLE' | 'APPOINTMENT' | 'RECORDS' | 'PRESCRIPTION' | 'BILLS' | 'TASKS';
  actionType: string;
  entityType: string;
  entityId: string;
  summaryText: string;
  createdAt: string;
}

// Shape follows ARCHITECTURE_AND_DB.md §2 (careTasks). Dates are ISO strings like
// the rest of this file; completeCareTask writes serverTimestamp() for completedAt.
export interface CareTask {
  id: string;
  patientId: string;
  appointmentId?: string;
  prescriptionId?: string;
  taskType: 'REFILL' | 'APPOINTMENT_PREP' | 'LAB_BOOKING' | 'GENERAL';
  title: string;
  dueDate?: string;
  status: 'PENDING' | 'COMPLETED';
  assignedToUserId?: string;
  assignedInviteEmail?: string;
  createdById: string;
  completedById?: string;
  completedAt?: string;
  createdAt: string;
}

// Shapes follow ARCHITECTURE_AND_DB.md §2 (appointments, monthlyCheckups,
// medicalRecords, medicalBills). Dates are ISO strings / 'YYYY-MM-DD' / 'YYYY-MM'
// as documented there. The doc does not list document ids, so `id` is added to
// the top-level entities for local keying; it mirrors the Firestore doc id.
export type AppointmentStatus = 'SCHEDULED' | 'ATTEND' | 'COMPLETED' | 'CANCELLED' | 'MISSED';

export type VisitType = 'IN_PERSON' | 'TELECONSULT';

export interface Appointment {
  id: string;
  patientId: string;
  hospitalName: string;
  doctorName?: string;
  specialty?: string;
  visitType: VisitType;
  scheduledAt: string;
  status: AppointmentStatus;
  bookedByUserId: string;
  assignedAttendeeId?: string;
  bookingPaidById?: string;
  bookingAmount?: number;
  prepNotes?: string;
  prepRecordIds: string[];
  actualAttendedById?: string;
  completionSummary?: string;
  visitNotes?: string;
  attachments?: RecordAttachment[];
  completedAt?: string;
  completedBy?: string;
  completedByName?: string;
  updatedBy?: string;
  updatedByName?: string;
  lastEditedStamp?: string;
  version?: number;
  parentAppointmentId?: string;
  rescheduleCount?: number;
  rescheduledBy?: string;
  rescheduleReason?: string;
  syncStatus?: 'SYNCED' | 'PENDING' | 'FAILED';
  clientMutationId?: string;
  finalAmount?: number;
  finalPaidById?: string;
  cancellationReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MonthlyCheckup {
  id: string;
  patientId: string;
  /** 'YYYY-MM' */
  checkupCycle: string;
  labName: string;
  /** 'YYYY-MM-DD' */
  checkupDate: string;
  notes?: string;
  createdById: string;
  createdAt: string;
}

export type RecordCategory = 'APPOINTMENT_REPORT' | 'MONTHLY_CHECKUP';

export type RecordType = 'PRESCRIPTION' | 'LAB_REPORT' | 'DISCHARGE_SUMMARY' | 'CHECKUP_PANEL' | 'OTHER';

export interface RecordAttachment {
  url: string;
  storagePath?: string;
  label?: string;
  uploadedAt: string;
}

export interface MedicalRecord {
  id: string;
  patientId: string;
  recordCategory: RecordCategory;
  recordType: RecordType;
  title: string;
  facilityName?: string;
  /** 'YYYY-MM-DD' */
  recordDate: string;
  /** 'YYYY-MM' */
  checkupCycle?: string;
  appointmentId?: string;
  monthlyCheckupId?: string;
  attachments: RecordAttachment[];
  uploadedById: string;
  createdAt: string;
}

// Doc §2 gives no category vocabulary, so `category` is a plain string.
export interface MedicalBill {
  id: string;
  patientId: string;
  amount: number;
  currencyCode: 'INR';
  category: string;
  paidByUserId: string;
  /** 'YYYY-MM-DD' */
  prescriptionDate: string;
  appointmentId?: string;
}

// Shapes follow the prescriptions and medicalBills schema in ARCHITECTURE_AND_DB.md §2.
// Synthetic demo data only; these types carry no medical advice.
export type PrescriptionStatus = 'ACTIVE' | 'DISCONTINUED';

export type BillCategory = 'PHARMACY_MEDICINES' | 'CONSULTATION' | 'LAB_DIAGNOSTICS' | 'HOSPITAL_OTHER';

export interface PrescriptionItem {
  id: string;
  medicineName: string;
  strength?: string;
  timingSlot: string;
  dailyUnitsNeeded: number;
  administeredByUserId?: string;
  administeredByLabel: string;
  remainingTablets: number;
  refillThresholdDays: number;
  isActive: boolean;
}

export interface Prescription {
  id: string;
  patientId: string;
  appointmentId?: string;
  medicalRecordId?: string;
  prescribedByDoc: string;
  status: PrescriptionStatus;
  /** 'YYYY-MM-DD' */
  startDate: string;
  /** 'YYYY-MM-DD' */
  endDate?: string;
  discontinuationNote?: string;
  sourceImageUrl?: string;
  createdById: string;
  createdAt: string;
  items: PrescriptionItem[];
}




