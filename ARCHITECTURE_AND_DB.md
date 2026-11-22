# ARCHITECTURE & DATABASE DESIGN — CAREBRIDGE

## 1. System Architecture (React Native + Firebase)
CareBridge uses a **single repository** (`carebridge-app`) built with **React Native (Expo, TypeScript)** on the client and **Firebase** (Authentication, Cloud Firestore, Storage, and optional Hosting for web preview) without requiring a separate backend server.

### Layers
1. **UI & Navigation Layer (`src/screens/`, `src/components/`, `src/navigation/`, `src/theme/`):**
   - Renders the 8 core screens (Auth & Care Circle Setup, 10-Second Sibling Dashboard, Appointments Hub & 3-Phase Flow, Two-Track Records & Timeline Graph, Prescriptions & History, Medical Bills & Expense Ledger, Tasks & "Who Did What" Log, Care Circle & Permissions).
   - Uses calm surfaces (`#F8FAFC` / `#FFFFFF`), status badges, and tabular numerals (`tabular-nums`).
2. **State, Permissions & Subscriptions Layer (`src/hooks/`):**
   - Subscribes to real-time Firestore data for the active patient workspace and evaluates permissions (`CO_CAREGIVER`, `isBackupAdmin`, `CONTRIBUTOR`, `OBSERVER`, and `canViewFinancials`).
3. **Service & Integration Layer (`src/services/`, `src/config/`, `src/utils/`):**
   - Encapsulates Firestore queries, `writeBatch` mutations, image compression before upload, Storage uploads, and Gemini Vision prescription extraction (always returning editable draft fields for user confirmation).
4. **Data & Security Layer (Cloud Firestore + Security Rules + Storage):**
   - Enforces care-circle membership, role presets, and financial visibility (`canViewFinancials`) in `firestore.rules`.

---

## 2. Firestore Database Design

Keep data scoped under `users/{userId}` and `patients/{patientId}` so queries are fast and stay within Firebase free-tier limits:

### Root Collections
- **`users/{userId}`**
  - `id`: string
  - `fullName`: string
  - `email?`: string
  - `phone?`: string
  - `createdAt`: timestamp / ISO string

- **`patients/{patientId}`**
  - `id`: string
  - `createdByUserId`: string
  - `fullName`: string
  - `dateOfBirth?`: string
  - `relationshipLabel`: string (e.g., `"Mother"`, `"Father"`)
  - `bloodGroup?`: string
  - `allergiesNote?`: string
  - `emergencyContact?`: string
  - `city`: string
  - `isSyntheticDemo`: boolean (`true` for hackathon sample data)
  - `createdAt`: timestamp / ISO string

### Patient Subcollections (`patients/{patientId}/...`)
- **`members/{memberId}`** *(Identity, Invites & RBAC)*
  - `id`: string
  - `patientId`: string
  - `userId?`: string (null until invite is accepted)
  - `invitedEmail`: string
  - `invitedPhone?`: string
  - `inviteStatus`: `'PENDING' | 'ACCEPTED'`
  - `rolePreset`: `'CO_CAREGIVER' | 'CONTRIBUTOR' | 'OBSERVER'`
  - `isBackupAdmin`: boolean
  - `canViewFinancials`: boolean
  - `joinedAt?`: string
  - `createdAt`: string

- **`appointments/{appointmentId}`** *(3-Phase Lifecycle)*
  - `id`: string
  - `patientId`: string
  - `hospitalName`: string
  - `doctorName?`: string
  - `specialty?`: string
  - `visitType`: `'IN_PERSON' | 'TELECONSULT'`
  - `scheduledAt`: string
  - `status`: `'SCHEDULED' | 'ATTEND' | 'COMPLETED' | 'CANCELLED'`
  - `bookedByUserId`: string
  - `assignedAttendeeId?`: string
  - `actualAttendedById?`: string
  - `bookingPaidById?`: string
  - `bookingAmount?`: number
  - `finalPaidById?`: string
  - `finalAmount?`: number
  - `prepNotes?`: string
  - `prepRecordIds`: string[]
  - `completionSummary?`: string
  - `cancellationReason?`: string
  - `completedAt?`: string
  - `createdAt`: string
  - `updatedAt`: string

- **`monthlyCheckups/{checkupId}`** *(Monthly Health Checkup Cadence)*
  - `id`: string
  - `patientId`: string
  - `checkupCycle`: string (`"YYYY-MM"`, e.g., `"2026-11"`)
  - `labName`: string
  - `checkupDate`: string
  - `notes?`: string
  - `createdByUserId`: string
  - `createdAt`: string

- **`medicalRecords/{recordId}`** *(Two-Track Timeline Items + Result Images)*
  - `id`: string
  - `patientId`: string
  - `appointmentId?`: string
  - `monthlyCheckupId?`: string
  - `recordCategory`: `'APPOINTMENT_REPORT' | 'MONTHLY_CHECKUP'`
  - `recordType`: `'PRESCRIPTION' | 'LAB_REPORT' | 'DISCHARGE_SUMMARY' | 'CHECKUP_PANEL' | 'OTHER'`
  - `title`: string
  - `facilityName?`: string
  - `recordDate`: string
  - `checkupCycle?`: string
  - `attachments`: `Array<{ url: string; storagePath?: string; label?: string; uploadedAt: string }>`
  - `uploadedById`: string
  - `createdAt`: string

- **`prescriptions/{prescriptionId}`** *(Current vs. Old Prescriptions & Daily Tablets)*
  - `id`: string
  - `patientId`: string
  - `appointmentId?`: string
  - `medicalRecordId?`: string
  - `prescribedByDoc`: string
  - `status`: `'ACTIVE' | 'DISCONTINUED'`
  - `startDate`: string
  - `endDate?`: string
  - `discontinuationNote?`: string
  - `sourceImageUrl?`: string
  - `items`: `Array<{ id: string; medicineName: string; strength?: string; timingSlot: string; dailyUnitsNeeded: number; administeredByUserId?: string; administeredByLabel: string; remainingTablets: number; refillThresholdDays: number; isActive: boolean }>`
  - `createdById`: string
  - `createdAt`: string

- **`medicalBills/{billId}`** *(Single-Source Expense Ledger)*
  - `id`: string
  - `patientId`: string
  - `appointmentId?`: string
  - `monthlyCheckupId?`: string
  - `category`: `'PHARMACY_MEDICINES' | 'CONSULTATION' | 'LAB_DIAGNOSTICS' | 'HOSPITAL_OTHER'`
  - `prescriptionDate`: string
  - `amount`: number
  - `currencyCode`: `'INR'`
  - `paidByUserId`: string
  - `receiptUrl?`: string
  - `notes?`: string
  - `createdById`: string
  - `createdAt`: string

- **`careTasks/{taskId}`** *(Assignable Tasks & Refill Reminders)*
  - `id`: string
  - `patientId`: string
  - `appointmentId?`: string
  - `prescriptionId?`: string
  - `taskType`: `'REFILL' | 'APPOINTMENT_PREP' | 'LAB_BOOKING' | 'GENERAL'`
  - `title`: string
  - `dueDate?`: string
  - `status`: `'PENDING' | 'COMPLETED'`
  - `assignedToUserId?`: string
  - `assignedInviteEmail?`: string
  - `createdById`: string
  - `completedById?`: string
  - `completedAt?`: string
  - `createdAt`: string

- **`activityLogs/{logId}`** *(Immutable "Who Did What" Audit Feed)*
  - `id`: string
  - `patientId`: string
  - `actorUserId`: string
  - `actorName`: string
  - `moduleName`: `'CARE_CIRCLE' | 'APPOINTMENT' | 'RECORDS' | 'PRESCRIPTION' | 'BILLS' | 'TASKS'`
  - `actionType`: string
  - `entityType`: string
  - `entityId`: string
  - `summaryText`: string
  - `createdAt`: string

### Storage Path Convention
`patients/{patientId}/{folder}/{entityId}/{timestamp}_{fileName}`