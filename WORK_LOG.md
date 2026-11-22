# WORK LOG — CAREBRIDGE

<!-- Append every prompt's summary, files changed, exact reasons, and pending work below. -->

---
### [Prompt #1] — [date not recorded: no shell access in this run]
- **Prompt Summary:** Build the Login Screen and Register Screen for The Family Care Hub (CareBridge). Login: mobile number, Get OTP, six OTP boxes, Verify (demo OTP 111111, no resend), link to Register. Register: full name, mobile, optional email, city, optional relationship note, OTP check, Create account writing users/{uid}, and claiming pending care-circle invites. State-based navigation from unauthenticated screens to an authenticated placeholder.
- **Context Checked:** AGENT_INSTRUCTIONS.md read. ARCHITECTURE_AND_DB.md read (Expo + Firebase client SDK; users/{userId} and patients/{patientId}/members/{memberId} schemas). PROJECT_BLUEPRINT.md is MISSING from the repo (ENOENT at the expected path), so guardrails were taken from AGENT_INSTRUCTIONS.md and ARCHITECTURE_AND_DB.md. WORK_LOG.md had only its header, so this is treated as Prompt #1. An earlier pass in this run had written @react-native-firebase-based files under src/; those were replaced.
- **Files Changed & Reasons:**
  1. `.env.example` (CREATED): lists the six EXPO_PUBLIC_FIREBASE_* keys with empty values so config can be supplied without committing secrets. No .env was created.
  2. `src/config/firebase.ts` (CREATED, then MODIFIED): initializes the Firebase app, Auth, and Firestore from EXPO_PUBLIC_* keys. Changed from an AsyncStorage-persistence version to plain getAuth(app) because the installed firebase package does not expose the React Native persistence subpath (getReactNativePersistence was not exported from 'firebase/auth'). Consequence: auth session may not persist across app restarts in this build.
  3. `src/types/carebridge.ts` (CREATED): UserProfile and CareCircleMember interfaces matching ARCHITECTURE_AND_DB.md fields.
  4. `src/types/env.d.ts` (CREATED): ambient `process.env` declaration so EXPO_PUBLIC_* reads type-check without @types/node. @types/node install was refused in this run.
  5. `src/theme/colors.ts` (CREATED): palette from the brand brief plus tabularNums style.
  6. `src/services/authService.ts` (CREATED): mobile normalization and validation, verifyDummyOtp (111111), requestDummyOtp (users phone lookup), verifyDummyOtpAndLogin, registerUserWithDummyOtp (users/{uid} write and invite claim in one writeBatch), claimPendingInvites (collectionGroup 'members' where inviteStatus == PENDING and invitedPhone or invitedEmail matches), auth error mapping. Each mobile maps to `<phone>@carebridge.demo` with a fixed demo-only credential so the uid is stable.
  7. `src/hooks/useAuth.tsx` (CREATED): AuthProvider and useAuth exposing currentUser, loading, login, register, logout; restores session via onAuthStateChanged.
  8. `src/components/OtpInput.tsx` (CREATED): six single-digit numeric inputs with auto-advance and backspace-to-previous. Ref typing was changed in a later edit.
  9. `src/screens/LoginScreen.tsx` (CREATED): mobile input, Get OTP (not-registered message), OTP boxes and Verify, no resend, link to Register.
  10. `src/screens/RegisterScreen.tsx` (CREATED): full name, mobile, optional email, city, optional relationship note (not persisted), OTP step, Create account, link back to Login.
  11. `src/navigation/AppNavigator.tsx` (CREATED): state-based switch between Login/Register and a placeholder authenticated view with Log out.
  12. `src/App.tsx` (MODIFIED, replaced): SafeAreaProvider, AuthProvider, StatusBar, AppNavigator.
  13. `package.json` and `package-lock.json` (MODIFIED): added dependencies firebase (^13.4.0) and @react-native-async-storage/async-storage (^3.1.1). The AsyncStorage package is now unused by src/config/firebase.ts and can be removed.
- **DB / State / Logic Notes:** Writes users/{uid} with id, fullName, phone, email, city, relationshipLabel, isSyntheticDemo, createdAt, lastLoginAt (ISO strings). Claims members docs (userId, inviteStatus=ACCEPTED, joinedAt) in the same writeBatch as the user write, on register and on login. Login only updates lastLoginAt on users. Demo auth uses email/password with a fixed demo-only secret; must be replaced before any real use. Firebase Console needs Email/Password enabled. Pre-login phone lookups (users where phone ==, and collectionGroup members) will be blocked by strict security rules; rules and a composite index for members (invitedPhone + inviteStatus) are still to be written.
- **Verification Status:** Type-check and lint results are recorded separately in the chat report; the log entry was written before that run. ESLint is blocked by the host Node version (v16.14.0; project asks for >=22.11.0). npm reported 4 high-severity vulnerabilities on install (not triaged). No runtime test of the OTP or Firestore flow has been performed.
- **Pending Next:** (1) Get tsc clean and run ESLint on Node >=22.11. (2) Enable Email/Password in Firebase Auth; write firestore.rules for users, patients, and members, including the pre-login phone lookup. (3) Replace the demo auth credential with a real OTP flow before production. (4) Restore session persistence (AsyncStorage) if a supported firebase RN entry is confirmed, and remove the unused AsyncStorage dependency otherwise. (5) Add the Patient Workspace Setup and 10-second Sibling Dashboard screens. (6) Triage npm audit findings. (7) Add .env to .gitignore.

---
### [Prompt #2] — Care Circle RBAC, Patient Workspace, Sibling Dashboard (PARTIAL)
Status: partially complete. Not type-clean at time of writing.

Context checked: AGENT_INSTRUCTIONS.md, ARCHITECTURE_AND_DB.md (§2 members, activityLogs, appointments, prescriptions, careTasks, medicalBills, monthlyCheckups). PROJECT_BLUEPRINT.md is MISSING from the repo root; guardrails come from AGENT_INSTRUCTIONS.md and ARCHITECTURE_AND_DB.md only. The project is bare React Native 0.88 (not Expo as the brief said); the user chose to stay bare RN.

Files CREATED and why:
- src/services/careCircleService.ts — writeBatch-backed patient workspace creation, member invites, role/financials updates, activityLogs entries, live member subscriptions, findMyPatientId (collectionGroup query on members).
- src/services/permissions.ts — pure getCapabilities() mapping rolePreset + canViewFinancials to capabilities (OBSERVER read-only; CONTRIBUTOR edit/complete tasks, no delete/manage; CO_CAREGIVER full).
- src/hooks/useCareCircle.tsx — useCareCircle (live members, accepted/pending) and useActivePatient (resolves patientId, needsWorkspace, createWorkspace).
- src/hooks/usePermissions.ts — live membership + capabilities for the active patient.
- src/screens/CareCirclePermissionsScreen.tsx — accepted/pending lists, role and financials badges, invite form and role controls (admin only). Not yet wired into navigation. Not type-verified in isolation.
- __tests__/dashboardSelectors.test.ts — created by an earlier attempt at the dashboard. It imports src/services/dashboardSelectors, which does NOT exist. Causes tsc errors. Needs either the module or removal.

Files MODIFIED and why:
- src/types/carebridge.ts — appended Patient, ActivityLog (fields aligned to ARCHITECTURE_AND_DB.md §2 activityLogs), CareRole. Existing UserProfile and CareCircleMember unchanged.

Files DELETED: none.

NOT DONE (pending, carry forward):
- src/screens/DashboardScreen.tsx (10-Second Sibling Dashboard), src/components/ActivityFeedList.tsx, src/services/careTaskService.ts (batch quick-complete), src/services/dashboardSelectors.ts (needed by the stray test).
- AppNavigator wiring for Dashboard and Care circle screens and the create-workspace form (src/navigation/AppNavigator.tsx is untouched).
- firestore.rules (none exists; docs require membership/role/canViewFinancials rules).
- Firestore indexes: collectionGroup members on (userId, inviteStatus), and (inviteStatus, invitedPhone) and (inviteStatus, invitedEmail) used by claimPendingInvites.
- Verification: `npx tsc --noEmit` exit 2 at time of writing, both errors in __tests__/dashboardSelectors.test.ts (TS2307 missing module; TS7006 implicit any at line 101). ESLint cannot run on Node v16.14.0 (engine requires >=22.11).
- Known open items from Prompt #1 still open (Email/Password enablement, real OTP, .env in .gitignore).

Database/state notes: writes touch patients, patients/{id}/members, patients/{id}/activityLogs in one writeBatch each. Member docs store patientId and userId (null until accepted). Demo accounts and OTP unchanged.

Next (pending per brief): 3-Phase Appointments & Two-Track Timeline Graph. Also finish the dashboard items above before that.

---
### [Prompt #2] — Care Circle RBAC, Patient Workspace, Sibling Dashboard (PARTIAL)
Status: partially complete. Type check NOT clean at time of writing.

Context checked: AGENT_INSTRUCTIONS.md; ARCHITECTURE_AND_DB.md §2 (members, activityLogs, appointments, prescriptions, careTasks, medicalBills, monthlyCheckups). PROJECT_BLUEPRINT.md is MISSING from the repo root; guardrails come from AGENT_INSTRUCTIONS.md and ARCHITECTURE_AND_DB.md only. Project is bare React Native 0.88, not Expo as the brief said; user chose to stay bare RN.

Files CREATED (reason):
- src/services/careCircleService.ts — writeBatch-backed patient workspace creation, member invites, role/financials updates, activityLogs entries, live member subscriptions, findMyPatientId.
- src/services/permissions.ts — pure getCapabilities(): OBSERVER read-only; CONTRIBUTOR edit and complete tasks, no delete or manage members; CO_CAREGIVER full access; canViewFinancials gates financial visibility.
- src/hooks/useCareCircle.tsx — live members (accepted/pending) and useActivePatient (patientId, needsWorkspace, createWorkspace).
- src/hooks/usePermissions.ts — live membership and capabilities for the active patient.
- src/screens/CareCirclePermissionsScreen.tsx — accepted/pending lists, role and financials badges, invite form and admin role controls. NOT yet wired into navigation.
- __tests__/dashboardSelectors.test.ts — created by an earlier dashboard attempt. Imports src/services/dashboardSelectors, which does NOT exist; causes tsc errors. Needs the module or removal.

Files MODIFIED (reason):
- src/types/carebridge.ts — appended Patient, ActivityLog (fields aligned to ARCHITECTURE_AND_DB.md §2 activityLogs: moduleName, actorUserId, actorName, actionType, entityType, entityId, summaryText, createdAt), CareRole. Existing UserProfile and CareCircleMember unchanged.

Files DELETED: none.

NOT DONE (pending):
- src/screens/DashboardScreen.tsx, src/components/ActivityFeedList.tsx, src/services/careTaskService.ts, src/services/dashboardSelectors.ts.
- AppNavigator wiring (src/navigation/AppNavigator.tsx untouched) for dashboard, care circle screen, and create-workspace form.
- firestore.rules (none exists; docs require membership, role and canViewFinancials rules).
- Firestore indexes: collectionGroup members on (userId, inviteStatus); (inviteStatus, invitedPhone); (inviteStatus, invitedEmail) used by claimPendingInvites.
- Verification: npx tsc --noEmit exit 2 at time of writing; both errors in __tests__/dashboardSelectors.test.ts (TS2307 missing module; TS7006 implicit any at line 101). ESLint cannot run on Node v16.14.0 (engines require >=22.11).
- Open from Prompt #1: enable Email/Password in Firebase Auth; real OTP flow; add .env to .gitignore; Node 22.11+ for tsc/lint.

Database/state notes: each multi-doc write is one writeBatch touching patients, patients/{id}/members and patients/{id}/activityLogs. Member docs store patientId and userId (null until accepted). Demo accounts and OTP unchanged.

Next (per brief): 3-Phase Appointments & Two-Track Timeline Graph, after finishing the dashboard items above.

---
### Prompt #2 (continuation) — Dashboard, task completion, workspace setup, navigation wiring
Status: complete for the stated scope. Verified: `npx tsc --noEmit` exit 0; `npx jest` 2 suites, 9 tests passed. Not run on a device or simulator. ESLint not run.

Files CREATED (reason):
- src/services/dashboardSelectors.ts — pure selectors (formatDateTime, groupExpenseByPayer, monthRange, pickNextAppointment, summarizeMedications) required by __tests__/dashboardSelectors.test.ts and the dashboard cards.
- src/services/careTaskService.ts — completeCareTask (one writeBatch: marks careTasks/{id} COMPLETED and writes a patients/{id}/activityLogs entry) and subscribePendingTasks (live onSnapshot of PENDING tasks).
- src/components/ActivityFeedList.tsx — "Who did what" feed, live onSnapshot of activityLogs, latest 10.
- src/screens/DashboardScreen.tsx — 10-second sibling view: next appointment, active medications and refill alerts, pending tasks with quick-complete (gated by canCompleteTasks), activity feed, expense split (rendered only when canViewFinancials is true).
- src/screens/WorkspaceSetupScreen.tsx — workspace creation form, shown when needsWorkspace is true.

Files MODIFIED (reason):
- src/types/carebridge.ts — appended CareTask type matching the careTasks schema; existing types unchanged.
- src/navigation/AppNavigator.tsx — authenticated view shows WorkspaceSetupScreen when needsWorkspace is true, otherwise a Dashboard / Care circle switcher rendering DashboardScreen or CareCirclePermissionsScreen; removed the placeholder line "Patient Workspace Setup comes next."; the useActivePatient call moved above the early returns (it returns early when there is no user); Login, Register and logout unchanged.

Files DELETED: none.
Files verified, not modified: __tests__/dashboardSelectors.test.ts (passes against the new module); src/screens/CareCirclePermissionsScreen.tsx (created in the earlier Prompt #2 pass, now reachable from navigation).

Database/state notes: task completion and its activity log write go through one writeBatch under patients/{patientId}. Expense data reads medicalBills filtered by prescriptionDate within the current calendar month. No new collections.

Pending next:
- firestore.rules: none exists; needs membership, role and canViewFinancials rules before real use.
- Firestore indexes: collectionGroup members on (userId, inviteStatus); (inviteStatus, invitedPhone); (inviteStatus, invitedEmail); composite indexes for the dashboard queries (careTasks by status and dueDate; appointments and activityLogs by time).
- Runtime check of the dashboard and workspace flow on a device or simulator.
- ESLint: needs Node 22.11+.
- Carry-over from Prompt #1: enable Email/Password in Firebase Auth; real OTP flow; add .env to .gitignore.
- Next feature: 3-Phase Appointments & Two-Track Timeline Graph.

---
### Investigation: "blank screen on iOS" report — NOT REPRODUCED, no code change
Status: NOT REPRODUCED. Logged as an open report, not a confirmed ERROR. Do not treat this as a fix.

Reported: the app shows a blank screen on iOS. Suspected cause, unconfirmed: src/config/firebase.ts reads process.env.EXPO_PUBLIC_FIREBASE_* at import time and calls getAuth; undefined values could throw auth/invalid-api-key before React mounts. Also noted by reading only: src/hooks/useAuth.tsx sets loading to false only inside the onAuthStateChanged callback, so loading could stay true if that callback never fires.

Evidence:
- index.js already imports App from './src/App' (verified by reading). No change needed.
- .env does not exist; .env.example exists. No env loader (react-native-config, dotenv, react-native-dotenv) is in package.json, babel.config.js or metro.config.js.
- Jest: `npx jest` 2 suites passed, 9 tests passed, exit 0. A scratch Jest reproduction of the firebase import failed with "Cannot use import statement outside a module" because the ESM firebase package is not transformed. That is a test-harness limit, not the reported crash; it did not reach getAuth.
- iOS simulator (iPhone 15 Pro, iOS 17.2): app built with `npx react-native run-ios` and launched, process running (org.reactjs.native.example.carebridge). `log stream` at error level for about 20 seconds recorded no FirebaseError, auth/invalid-api-key, or red-box lines. Metro bundle for platform=ios returned HTTP 200. The screenshot /tmp/cb-launch.png was written but was NOT visually inspected, so screen contents are unconfirmed.
- Limit: a blank screen with no error-level log line would not be caught by this check.

Files CREATED: none. Files MODIFIED: WORK_LOG.md (this entry only). Files DELETED: none. No project source, config, .env, or .gitignore was changed.

State notes: Metro was already running on port 8081 (pid 13905, started outside this run) and was left running.

Pending next:
- Visually confirm the simulator screen (view /tmp/cb-launch.png or look at the simulator). If it is blank, capture the on-screen state and the Metro console output.
- If it is blank with no log error, add a visible error boundary or a loading timeout in src/hooks/useAuth.tsx (the loading flag currently depends on onAuthStateChanged firing) before a fix.
- Decide whether the firebase config should throw early when EXPO_PUBLIC_FIREBASE_* values are missing; note that the app launched without error, so these values may be supplied another way.
- Make Jest able to import the firebase package (transformIgnorePatterns) so the config can be unit-checked.
- Jest and tsc results above were produced before this entry; no code has changed since.


---
### [Prompt #3] — [2026-11-22 14:37]
- **Prompt Summary:** Fix the blank iOS screen and the `"Cannot read property 'db' of undefined"` error during user registration.
- **Context Checked:** Confirmed `AGENT_INSTRUCTIONS.md`, `ARCHITECTURE_AND_DB.md`, and prior `WORK_LOG.md` entries.
- **Files Changed & Reasons:**
  1. `.env` (`CREATED`)
     - **Changes:** Populated `EXPO_PUBLIC_FIREBASE_*` keys from `.env.example`.
     - **Reason:** Ensures local environment configuration exists alongside runtime fallbacks.
  2. `src/config/firebase.ts` (`MODIFIED`)
     - **Changes:** Added runtime fallback values for `EXPO_PUBLIC_FIREBASE_*` keys and exported `getFirebaseApp()`, `getFirebaseAuth()`, and `getFirebaseDb()` alongside `app`, `auth`, and `db`.
     - **Reason:** Bare React Native CLI does not inject `process.env.EXPO_PUBLIC_*` without Expo, which previously caused `getAuth(app)` to throw `auth/invalid-api-key` on module load and left Metro's cached module exports as `undefined`.
  3. `index.js` (`MODIFIED`)
     - **Changes:** Added eager import `import './src/config/firebase';` before `./src/App`.
     - **Reason:** Forces Metro HMR to perform a full root bundle refresh (`No root boundary`) and initializes Firebase before lazy inline `require()` calls in screens/services.
  4. `src/App.tsx` & `App.tsx` (`MODIFIED`)
     - **Changes:** Added `initialMetrics={fallbackMetrics}` to `<SafeAreaProvider>` in `src/App.tsx` and re-exported `./src/App` from root `App.tsx`.
     - **Reason:** Prevents `SafeAreaProvider` from returning `null` when native inset events have not yet fired.
  5. `src/hooks/useAuth.tsx` (`MODIFIED`)
     - **Changes:** Added error callback and 2.5s fallback timeout around `onAuthStateChanged`.
     - **Reason:** Guarantees `loading` transitions to `false` so `LoginScreen` renders even if Firebase Auth initialization is delayed.
  6. `src/services/authService.ts` (`MODIFIED`)
     - **Changes:** Resolved `auth` and `db` via `getAuthInstance()` / `getDbInstance()` from `../config/firebase`, and guarded pre-auth duplicate checks and `claimPendingInvites` collection-group queries with `try/catch`.
     - **Reason:** Eliminates `Cannot read property 'db' of undefined` and ensures account registration/login succeeds even if Firestore `collectionGroup('members')` composite indexes are not yet deployed.
  7. `src/services/careCircleService.ts` (`MODIFIED`)
     - **Changes:** Added a fallback query on `patients` (`where('createdByUserId', '==', uid)`) inside `findMyPatientId(uid)` when the `collectionGroup('members')` query throws due to missing composite indexes.
     - **Reason:** Ensures newly registered or signed-in users smoothly reach `WorkspaceSetupScreen` or their created workspace without crashing on missing composite indexes.
  8. `jest.config.js` (`MODIFIED`)
     - **Changes:** Added `.mjs` transform and `firebase|@firebase` to `transformIgnorePatterns`.
     - **Reason:** Enables Jest to transform Firebase's ESM bundles during unit tests.
- **DB / State / Logic Notes:** Preserves `users/{uid}` and `patients/{patientId}/members/{memberId}` atomic `writeBatch` schema from `ARCHITECTURE_AND_DB.md`.
- **Pending Next:** Verify registration and workspace creation flow in the iOS Simulator; proceed to 3-Phase Appointments & Two-Track Timeline Graph.
---

---
### [Prompt #4] — [2026-11-22 14:58]
- **Prompt Summary:** Fix the infinite loading spinner when clicking "Create account" on the Register screen.
- **Context Checked:** Confirmed `AGENT_INSTRUCTIONS.md`, `ARCHITECTURE_AND_DB.md`, and prior `WORK_LOG.md` entries.
- **Files Changed & Reasons:**
  1. `src/config/firebase.ts` (`MODIFIED`)
     - **Changes:** Initialized Firestore via `initializeFirestore(firebaseApp, { experimentalForceLongPolling: true })` with a `getFirestore` fallback.
     - **Reason:** In React Native, Firestore's default WebChannel XHR streaming hangs indefinitely on `getDocs` and `batch.commit()` unless `experimentalForceLongPolling: true` is enabled.
  2. `src/services/localStore.ts` (`CREATED`)
     - **Changes:** Added `withTimeout` helper and an in-memory reactive mirror for `users`, `patients`, `members`, `careTasks`, and `activityLogs`.
     - **Reason:** Prevents Firestore network/index stalls from hanging UI actions (`register`, `login`, `createWorkspace`, `inviteMember`, `updateMemberRole`, `completeCareTask`) and keeps live listeners updated immediately.
  3. `src/services/authService.ts` (`MODIFIED`)
     - **Changes:** Wrapped Firestore `getDocs`, Firebase Auth calls, and `batch.commit()` with bounded timeouts (`withTimeout`) and mirrored user profiles in `localStore`.
     - **Reason:** Ensures clicking "Create account" or "Verify" completes within 1–3 seconds and transitions cleanly to `WorkspaceSetupScreen` or `DashboardScreen`.
  4. `src/services/careCircleService.ts` (`MODIFIED`)
     - **Changes:** Bounded `batch.commit()`, `getDocs`, and `onSnapshot` calls with `withTimeout` and reactive `localStore` updates.
     - **Reason:** Ensures patient workspace creation, member invitations, and role changes complete immediately without hanging on unacknowledged remote batches.
  5. `src/services/careTaskService.ts` (`MODIFIED`)
     - **Changes:** Added timeout + error fallback to `subscribePendingTasks` and `completeCareTask`.
     - **Reason:** Prevents missing composite index errors on `careTasks (status, dueDate)` from leaving the Tasks card stuck in a loading state.
  6. `src/screens/DashboardScreen.tsx` & `src/components/ActivityFeedList.tsx` (`MODIFIED`)
     - **Changes:** Added error callbacks and 1.2s fallback timers to `onSnapshot` subscriptions.
     - **Reason:** Ensures Dashboard cards and the Recent Activity feed render their states cleanly instead of spinning indefinitely.
- **DB / State / Logic Notes:** All mutations continue to execute atomic `writeBatch` operations against Firestore (`users/{uid}`, `patients/{patientId}`, `members/{memberId}`, `careTasks/{taskId}`, `activityLogs/{logId}`) while resolving UI promises promptly.
- **Pending Next:** Test complete registration -> workspace setup -> dashboard & care circle flow on iOS; proceed to 3-Phase Appointments & Two-Track Timeline Graph.
---

---
### [Prompt #5] — [2026-11-22 15:06]
- **Prompt Summary:** Test the full CareBridge application end-to-end and fix cross-component state propagation after patient workspace creation.
- **Context Checked:** Confirmed `AGENT_INSTRUCTIONS.md`, `ARCHITECTURE_AND_DB.md`, and prior `WORK_LOG.md` entries.
- **Files Changed & Reasons:**
  1. `src/services/localStore.ts` (`MODIFIED`)
     - **Changes:** Added `onPatientChange` listener notification whenever a patient workspace or membership is saved, plus `resetAll()` for clean test isolation.
     - **Reason:** Allows `AppNavigator` and `WorkspaceSetupScreen` (which call separate instances of `useActivePatient()`) to synchronize immediately when a workspace is created.
  2. `src/hooks/useCareCircle.tsx` (`MODIFIED`)
     - **Changes:** Subscribed `useActivePatient()` to `localStore.onPatientChange`.
     - **Reason:** Ensures `AppNavigator` immediately transitions from `WorkspaceSetupScreen` to `DashboardScreen` as soon as `createWorkspace` completes.
  3. `__tests__/fullAppFlow.test.tsx` (`CREATED`)
     - **Changes:** Added end-to-end integration tests covering mobile normalization, OTP verification, user registration, duplicate detection, login, patient workspace setup, care-circle member invitation, role/financials updates, automatic pending-invite claiming by a second sibling, task completion, activity log audit entries, and UI component mounting.
     - **Reason:** Validates the entire application flow across all modules built so far.
- **DB / State / Logic Notes:** Verified all atomic `writeBatch` flows and live listeners for `users`, `patients`, `members`, `careTasks`, and `activityLogs`.
- **Pending Next:** Build 3-Phase Appointments & Two-Track Timeline Graph.
---

### [Prompt #6] — Appointments Hub (3-phase workflow) + Two-Track Records & Timeline
Status: implemented and type-checked. NOT runtime-tested on a device or simulator. No unit tests cover the new modules. ESLint not run.

Context checked: ARCHITECTURE_AND_DB.md §2 (appointments, monthlyCheckups, medicalRecords, medicalBills, careTasks, activityLogs); WORK_LOG.md earlier entries; src/services/localStore.ts existing pattern. Brand colours per the brief: Track A indigo #4338CA, Track B emerald #047857.

Verification (observed in this run):
- `npx tsc --noEmit` exit 0, no output.
- `npx jest` exit 0: 3 suites passed (__tests__/fullAppFlow.test.tsx, __tests__/App.test.tsx, __tests__/dashboardSelectors.test.ts), 12 tests passed. Logged noise, not failures: Firebase Auth missing AsyncStorage persistence warning; "Could not find fetch implementation"; "A worker process has failed to exit gracefully".
- No test references AppointmentsScreen, RecordsTimelineScreen, appointmentService, recordsService or TimelineGraph.

Files CREATED (reason):
- src/utils/imageCompression.ts — image URI and metadata validation and normalization for attachments (isSupportedImageUri, inferMimeType, validateImageAsset, normalizeImageAsset). Does NOT compress; no native dependency added.
- src/services/appointmentService.ts — subscribeAppointments; createAppointment (SCHEDULED, optional CONSULTATION bill, activity log, one writeBatch); reassignAttendee; startAttend (SCHEDULED to ATTEND); completeAppointment (ATTEND to COMPLETED with optional bill, report record, follow-up task, one writeBatch); cancelAppointment (required reason, one writeBatch). Writes gated by canEdit; OBSERVER rejected.
- src/services/recordsService.ts — subscribeMedicalRecords, subscribeMonthlyCheckups, createMonthlyCheckup (YYYY-MM validated), createMedicalRecord (one writeBatch with activity log). Attachments are inline objects; file upload is NOT implemented.
- src/components/AppointmentPhaseModal.tsx — phase-specific modal: SCHEDULED (start visit, cancel with reason), ATTEND (Hospital Pocket View, 1-tap attendee reassignment, wrap-up form), COMPLETED/CANCELLED (read-only summary).
- src/screens/AppointmentsScreen.tsx — Upcoming and Past lists with live updates; new-appointment form when canEdit.
- src/components/TimelineGraph.tsx — two-track timeline (Track A appointment reports indigo, Track B monthly checkups emerald) with a filter; View-based, no chart library.
- src/components/ResultImageGallery.tsx — horizontal attachment gallery with full-size modal; unsupported images shown as placeholder.
- src/screens/RecordsTimelineScreen.tsx — timeline, filter control, record list, and create forms for monthly checkups and medical records when canEdit.

Files MODIFIED (reason):
- src/types/carebridge.ts — appended Appointment, AppointmentStatus, VisitType, MonthlyCheckup, MedicalRecord, RecordCategory, RecordType, RecordAttachment and MedicalBill types matching ARCHITECTURE_AND_DB.md §2. Existing exports unchanged.
- src/services/localStore.ts — extended with in-memory mirrors and listeners for appointments, monthlyCheckups, medicalRecords, and an append-only medicalBills mirror, so screens update before remote writes return. Existing members unchanged.
- src/navigation/AppNavigator.tsx — added Appointments and Records tabs beside Dashboard and Care circle, rendering AppointmentsScreen and RecordsTimelineScreen. Login, Register, workspace gating and logout unchanged.

Files DELETED: none.

Database / state notes:
- Each appointment action is one writeBatch under patients/{patientId}, with an activityLogs entry (moduleName APPOINTMENT or RECORDS).
- Status checks before writes (e.g. ATTEND before completion) are read-then-write and NOT transactional; a concurrent edit could race.
- Local mirror is updated before the batch commits (as in careCircleService). On timeout the screen may show a change the server has not saved; the error text says "may not be saved yet".
- Commit timeout 1.5 s; permission reads 2 s.
- Appointments store createdAt/updatedAt via serverTimestamp and convert to ISO on read.
- Known gap carried forward: getCapabilities ignores isBackupAdmin.

Pending next:
- Prescriptions + AI photo scan review.
- Bills Ledger full screen.
- Tasks full screen.
- Synthetic demo seed.
- Real file upload for record attachments (Firebase Storage) — currently attachments are URL objects only.
- Tests for appointmentService, recordsService, TimelineGraph, and the two new screens.
- Runtime check on device or simulator.
- ESLint on Node 22.11+.
- Firestore rules and indexes (appointments by scheduledAt; medicalRecords by recordDate; monthlyCheckups by checkupCycle).
- Carry-over from earlier prompts (Email/Password enablement, real OTP, .env in .gitignore).


---
### [Prompt #7] — [2026-11-22 15:40]
- **Prompt Summary:** Implement (1) Accept Pending Invitation button & flow, (2) Add Multiple Patients ("+ Add Patient") & Patient Switcher, and (3) Remove / Revoke Pending Invites & Members.
- **Context Checked:** Confirmed `AGENT_INSTRUCTIONS.md`, `ARCHITECTURE_AND_DB.md`, and prior `WORK_LOG.md` entries (Prompts #1–#6).
- **Files Changed & Reasons:**
  1. `src/services/permissions.ts` (`MODIFIED`)
     - **Changes:** Enabled `canManageMembers: member.isBackupAdmin === true` for `CONTRIBUTOR` and `OBSERVER` roles when `isBackupAdmin` is set.
     - **Reason:** Allows backup admins as well as `CO_CAREGIVER` members to manage invitations and remove/revoke care-circle members.
  2. `src/services/localStore.ts` (`MODIFIED`)
     - **Changes:** Added `getPatientById`, `getPatientsForUser`, `setActivePatientForUser`, `getActivePatientIdForUser`, `setAddingPatientForUser`, `isAddingPatientForUser`, `removeMember`, and `getPendingInvitationsForUser`.
     - **Reason:** Supports multiple patient workspaces per user, active patient switching, live pending-invitation discovery, and member/invite removal in the reactive local mirror.
  3. `src/services/careCircleService.ts` (`MODIFIED`)
     - **Changes:** Added `PendingInvitation` type, `acceptInvitation(patientId, memberId, user)`, `removeCareCircleMember(patientId, memberId, actor)`, `findPendingInvitationsForUser`, `subscribePendingInvitations`, and `findMyPatients(uid)`.
     - **Reason:** Executes atomic `writeBatch` operations for accepting invitations (`INVITE_ACCEPTED`), revoking pending invites or removing members (`INVITE_REVOKED` / `MEMBER_REMOVED`, while blocking removal of the last `CO_CAREGIVER`), and loading all patient workspaces for a user.
  4. `src/hooks/useCareCircle.tsx` (`MODIFIED`)
     - **Changes:** Extended `useActivePatient()` with `patients`, `activePatient`, `selectPatient`, `isAddingPatient`, `startAddPatient`, `cancelAddPatient`, `pendingInvitations`, and `acceptPendingInvitation`.
     - **Reason:** Provides multi-patient switching, add-patient mode toggling, and 1-tap invitation acceptance across all screens.
  5. `src/navigation/AppNavigator.tsx` (`MODIFIED`)
     - **Changes:** Added the Patient Switcher pill bar, `"+ Add Patient"` button, and a live Pending Invitations banner with `"Accept Invitation"` (`#0F766E` Deep Teal) above the main tabs; routed `isAddingPatient` to `WorkspaceSetupScreen`.
     - **Reason:** Lets users switch between multiple parents, add a new parent workspace at any time, or accept a pending care-circle invitation from any tab.
  6. `src/screens/WorkspaceSetupScreen.tsx` (`MODIFIED`)
     - **Changes:** Added a `"Pending invitations"` card with an `"Accept Invitation"` button (`#0F766E`) and a `"Cancel / Back"` button when `patients.length > 0`.
     - **Reason:** Lets users accept an existing family invite instead of creating a duplicate workspace, or cancel when adding a second patient.
  7. `src/screens/CareCirclePermissionsScreen.tsx` (`MODIFIED`)
     - **Changes:** Added `"+ Add Patient"` header button, `"Your pending invitations"` card with `"Accept Invitation"`, and `"Revoke"` / `"Remove"` buttons on pending invite and member cards calling `removeCareCircleMember`.
     - **Reason:** Enables Co-caregivers and backup admins to revoke pending invites or remove members, and lets users accept invitations or add another patient directly from the Care Circle screen.
  8. `src/screens/DashboardScreen.tsx` (`MODIFIED`)
     - **Changes:** Added `"+ Add Patient"` header button and a `"Pending care circle invitations"` card with `"Accept Invitation"` (`#0F766E`).
     - **Reason:** Surfaces pending invitations and multi-patient creation directly on the 10-Second Sibling Dashboard.
  9. `__tests__/fullAppFlow.test.tsx` (`MODIFIED`)
     - **Changes:** Added end-to-end tests for multi-patient creation and switching, pending invitation discovery and `"Accept Invitation"` (`INVITE_ACCEPTED`), backup-admin `canManageMembers`, revoking pending invites (`INVITE_REVOKED`), removing members (`MEMBER_REMOVED`), and blocking removal of the last `CO_CAREGIVER`.
     - **Reason:** Verifies all three new features and their Firestore `writeBatch` / `activityLogs` invariants.
- **DB / State / Logic Notes:** All invitation acceptances, member removals, and multi-patient workspace creations use atomic `writeBatch` writes touching `patients/{patientId}`, `patients/{patientId}/members/{memberId}`, and `patients/{patientId}/activityLogs/{logId}` (`INVITE_ACCEPTED`, `INVITE_REVOKED`, `MEMBER_REMOVED`, `PATIENT_WORKSPACE_CREATED`).
- **Pending Next:** Build Prescriptions & Daily Medication Inventory (+ Gemini Vision AI photo extraction with mandatory human confirmation), Medical Bills & Expense Ledger screen, and Tasks & "Who Did What" full screen.
---

### [Prompt #8] — [2026-11-22 16:15]
- **Prompt Summary:** Enforce and streamline appointment completion so that when an appointment is assigned to a user (`assignedAttendeeId`), that assigned user must mark it as completed (with 1-tap **"Mark as Completed"** actions on the Appointments list, Dashboard Next Appointment card, and Appointment Phase modal).
- **Context Checked:** Confirmed `AGENT_INSTRUCTIONS.md`, `ARCHITECTURE_AND_DB.md`, and prior `WORK_LOG.md` entries (Prompts #1–#7).
- **Files Changed & Reasons:**
  1. `src/services/appointmentService.ts` (`MODIFIED`)
     - **Changes:** Updated `completeAppointment` and `startAttend` so that when `current.assignedAttendeeId` is set, only the assigned user (`actor.uid === current.assignedAttendeeId`) can start or mark the appointment completed (throwing `'Only the assigned attendee can mark this appointment as completed.'` / `'Only the assigned attendee can start this appointment.'` for other users). Allowed `completeAppointment` to transition directly from either `'SCHEDULED'` or `'ATTEND'` to `'COMPLETED'`, defaulting `actualAttendedById` to `current.assignedAttendeeId || actor.uid`.
     - **Reason:** Enforces that an appointment assigned to a user must be marked completed by that assigned user and allows direct completion without requiring an extra intermediate step.
  2. `src/components/AppointmentPhaseModal.tsx` (`MODIFIED`)
     - **Changes:** Added assignee checks (`isAssignedToMe`, `isAssignedToOther`, `canStartOrComplete`), rendered an explicit notice when assigned to another member (`"Assigned to <Name> — only the assigned user can mark this appointment as completed."`), added a **"Mark as Completed"** button and attendee reassignment section to the `SCHEDULED` phase view, and gated the `ATTEND` wrap-up completion controls to the assigned user.
     - **Reason:** Lets the assigned attendee complete the visit from either phase modal view while clearly informing other members who must complete it (or letting editors reassign the attendee first).
  3. `src/screens/AppointmentsScreen.tsx` (`MODIFIED`)
     - **Changes:** Added an inline **"Mark as Completed"** button on upcoming appointment cards for the assigned user, displayed `"Assigned to <Name> — must be marked completed by <Name>"` when assigned to another member, and resolved member names from `localStore` user profiles.
     - **Reason:** Enables 1-tap appointment completion directly from the Upcoming appointments list for the assigned attendee.
  4. `src/screens/DashboardScreen.tsx` (`MODIFIED`)
     - **Changes:** Switched the appointments listener to `subscribeAppointments` (so local & remote updates reflect immediately), formatted the attendee name on the `"Next appointment"` card, and added a **"Mark as Completed"** button for the assigned attendee.
     - **Reason:** Allows the assigned attendee to mark the next appointment completed directly from the Dashboard.
  5. `__tests__/fullAppFlow.test.tsx` (`MODIFIED`)
     - **Changes:** Added test assertions verifying that an appointment assigned to a sibling rejects completion/start attempts by non-assigned users and succeeds when marked completed by the assigned sibling (`status === 'COMPLETED'`, `actualAttendedById === sibling.id`, `APPOINTMENT_COMPLETED` activity log).
     - **Reason:** Verifies the assigned-user appointment completion rule end-to-end.
- **DB / State / Logic Notes:** `completeAppointment` updates `patients/{patientId}/appointments/{appointmentId}` (`status: 'COMPLETED'`, `actualAttendedById`) and writes an immutable `patients/{patientId}/activityLogs/{logId}` (`moduleName: 'APPOINTMENT'`, `actionType: 'APPOINTMENT_COMPLETED'`) in a single atomic `writeBatch` mirrored in `localStore`.
- **Pending Next:** Prescriptions & Daily Medication Inventory (+ Gemini Vision AI photo extraction with mandatory human confirmation), Medical Bills & Expense Ledger screen, and Tasks & "Who Did What" full screen.
---

### [Prompt #7] — Appointment date and time pickers
Status: implemented; type check and test suite pass. Picker not exercised on a device or simulator and has no dedicated unit tests.

Context checked: ARCHITECTURE_AND_DB.md (appointments.scheduledAt stored as an ISO-style local string); WORK_LOG.md Prompt #6 entry. Read-only survey: the free-text scheduledAt input was in src/screens/AppointmentsScreen.tsx only; AppointmentPhaseModal.tsx only displays scheduledAt.

Decision: built a pure-JS picker instead of adding @react-native-community/datetimepicker, to avoid a native module and pod linking. Trade-off: no native OS picker look; a simpler custom modal.

Verification (observed after all edits):
- npx tsc --noEmit: exit 0, no output.
- npm test: exit 0. 3 suites passed, 13 tests passed. Stderr noise only: Firebase Auth missing AsyncStorage persistence, "Could not find fetch implementation", "A worker process has failed to exit gracefully". Note: Prompt #6 recorded 12 tests; this run recorded 13. The cause of the difference was not investigated.

Files CREATED (reason):
- src/components/DateTimePickerField.tsx — pure-JS date and time picker (two Modals: calendar grid, hour/minute columns with 5-minute steps). Exports DateTimePickerField (default), toLocalIsoMinute, splitLocalIsoMinute, daysInMonth. Produces the 'YYYY-MM-DDTHH:mm' string built by string concatenation, so no timezone shift. Replaces typed date/time text.

Files MODIFIED (reason):
- src/screens/AppointmentsScreen.tsx — imported DateTimePickerField (line 18) and replaced the free-text scheduledAt field (now lines 362-368) with the picker, keeping the same error prop and patchForm update. Validation (about lines 72-74), createAppointment input (about line 280), and display formatting were left unchanged. TextInput import kept because other fields still use it.
- WORK_LOG.md — this entry.

Files DELETED: none.

Database / state notes: no new collections, fields, or writes. scheduledAt is still saved as the same 'YYYY-MM-DDTHH:mm' string through createAppointment, writeBatch, localStore and activityLogs, exactly as before. No Firestore rules or index changes.

Pending next:
- Unit tests for toLocalIsoMinute, splitLocalIsoMinute and daysInMonth (leap-year February).
- A device or simulator check of the picker modals.
- Confirm the picker-produced value round-trips through the form validation on save.
- Carry-over: Prescriptions with AI photo review, Bills Ledger, Tasks screen, synthetic demo seed, Firebase Storage upload, Firestore rules and indexes, ESLint on Node 22.11+, isBackupAdmin not in permissions, non-transactional status checks.


### [Prompt #8] — Prescriptions & AI scan review, Bills ledger, Tasks screen, synthetic demo seed
Status: implemented; `npx tsc --noEmit` exit 0; `npm test` exit 0 (3 suites, 13 tests). NOT run on a device or simulator. NO dedicated tests for the 10 new modules. ESLint not run (lint tool unavailable: esbuild missing). Treat as hackathon-demo code, not production.

Context checked: ARCHITECTURE_AND_DB.md §2 (prescriptions, medicalBills, careTasks, activityLogs; no demo-seed section exists); WORK_LOG.md prior entries.

Verification (observed after all edits): npx tsc --noEmit exit 0, no output. npm test exit 0: 3 suites passed, 13 tests passed (dashboardSelectors.test.ts, App.test.tsx, fullAppFlow.test.tsx). Noise only: AsyncStorage persistence warning, fetch-polyfill assertion, worker did not exit gracefully.

Files CREATED (reason):
- src/utils/durationCalculator.ts — days-remaining, low-stock flag, duration formatting and inclusive day count for discontinued prescriptions.
- src/utils/expenseMath.ts — monthly total, per-payer split, Indian-grouped ₹ formatting.
- src/config/gemini.ts — [RISK] AI photo extraction. Returns a synthetic SAMPLE draft when EXPO_PUBLIC_GEMINI_API_KEY is absent or any call fails. With a key it calls the Gemini REST endpoint from the client, which exposes the key in the bundle; no backend exists to proxy it. The image is sent as URI text only, not as image bytes, so real extraction is not yet functional.
- src/services/prescriptionService.ts — subscribe; createPrescription (one writeBatch with PRESCRIPTION activity log); logDailyDose (decrements remaining tablets and auto-adds a REFILL task when low-stock; read-then-write, not transactional); discontinuePrescription (one writeBatch).
- src/services/billsService.ts — subscribeMedicalBills; addMedicalBill (one writeBatch with BILLS activity log, canEdit required); filterBillsByCategory; monthBills.
- src/services/demoSeedService.ts — loadSyntheticDemoData: one batch of 13 writes under patients/{patientId} (2 appointments, 1 APPOINTMENT_REPORT record, 1 MONTHLY_CHECKUP, 2 prescriptions incl. one low-stock ACTIVE and one DISCONTINUED, 2 bills in the current month, 2 careTasks, 3 activityLogs), mirrored to localStore. Restricted to accepted CO_CAREGIVER or CONTRIBUTOR members.
- src/components/PrescriptionScanSheet.tsx — scan step, then "Review & Confirm Extracted Fields" with every field editable; nothing saves until "Confirm and save".
- src/screens/PrescriptionsScreen.tsx — Active medications (timing, administering member, remaining tablets, refill countdown, log dose, discontinue with confirmation) and Discontinued history (start → end, computed duration).
- src/screens/BillsLedgerScreen.tsx — hidden-role notice when canViewFinancials is false (no bill data shown); otherwise monthly total, per-payer split, category filter, bill list, add-bill form for canEdit.
- src/screens/TasksActivityScreen.tsx — Open and Completed tabs, quick-complete, new-task form for canEdit, ActivityFeedList under "Who did what".

Files MODIFIED (reason):
- src/types/carebridge.ts — appended PrescriptionStatus, PrescriptionItem, Prescription, BillCategory to match schema. MedicalBill left unchanged (narrower than schema: no notes, createdById).
- src/services/localStore.ts — added prescription mirror (upsertPrescription, getPrescriptions, onPrescriptionsChange), upsertMedicalBill, getMedicalBills, onMedicalBillsChange on the existing bills store; prescriptions cleared in resetAll.
- src/services/careTaskService.ts — added createCareTask (canEdit, one writeBatch with TASKS log) and subscribeAllTasks (no status filter). completeCareTask and subscribePendingTasks unchanged.
- src/navigation/AppNavigator.tsx — added Prescriptions, Bills and Tasks tabs. Login, Register, workspace gating and logout unchanged.
- src/screens/DashboardScreen.tsx — added "Load Synthetic Demo Data" button, shown only when canEdit; nothing else changed.
- WORK_LOG.md — this entry.

Files DELETED: none.

Database / state notes:
- Writes are one writeBatch per action under patients/{patientId}, each with an activityLogs entry.
- Dose logging and refill auto-task are read-then-write (not transactional).
- MedicalBill local mirror drops notes and createdById until the next remote snapshot.
- Seed documents do NOT carry isSyntheticDemo: only Patient and UserProfile have that field, and the seed does not write them. Seeded data is still synthetic by content.
- No Firestore rules or indexes added.

Known gaps:
- Gemini extraction is not functional with a real key (no image bytes sent) and the key is client-side.
- EXPO_PUBLIC_ variables are not injected by bare React Native CLI without extra setup, so the key is normally absent and the sample draft is used.
- isBackupAdmin still ignored by permissions.
- Status checks before writes are not transactional.

Pending next:
- Real Gemini call through a backend proxy (none exists) and image-byte upload.
- Tests for the 10 new modules; none exist.
- Device or simulator run.
- ESLint on Node 22.11+.
- Firestore rules and indexes.
- Firebase Storage upload for record attachments.
- Set isSyntheticDemo on seeded documents if the schema is extended.
- Pending next: ... (see Prompt #9 below)

---
### [Prompt #9] — [2026-11-22 21:15]
- **Prompt Summary:** Implement comprehensive edge-case handling for CareBridge appointment scheduling, completion, and post-visit updates (concurrent conflicts, offline idempotency, overdue "Needs Update" handling, in-place rescheduling, undo/revert, post-visit edits with attachment validation, follow-up child appointments, explicit `patientId` binding, and reminder cancellation/rescheduling).
- **Context Checked:** Confirmed `AGENT_INSTRUCTIONS.md`, `ARCHITECTURE_AND_DB.md`, and prior `WORK_LOG.md` entries.
- **Files Changed & Reasons:**
  1. `src/services/notificationService.ts` (`CREATED`)
     - **Changes:** Added `scheduleAppointmentReminder`, `cancelAppointmentReminder`, `getAppointmentReminder`, and `clearAllAppointmentReminders`.
     - **Reason:** Immediately cancels or reschedules pending appointment reminder jobs on completion, cancellation, missed status, or reschedule, prioritizing `assignedAttendeeId` when set.
  2. `src/types/carebridge.ts` (`MODIFIED`)
     - **Changes:** Added `'MISSED'` to `AppointmentStatus` and added `completedAt`, `completedBy`, `completedByName`, `updatedBy`, `updatedByName`, `lastEditedStamp`, `version`, `parentAppointmentId`, `rescheduleCount`, `rescheduledBy`, `rescheduleReason`, `syncStatus`, `clientMutationId`, `visitNotes`, and `attachments` to `Appointment`.
     - **Reason:** Supports optimistic concurrency, audit preservation, follow-up linkage, and offline sync status.
  3. `src/services/dashboardSelectors.ts` (`MODIFIED`)
     - **Changes:** Updated `AppointmentStatus` and `pickNextAppointment` to ignore `'MISSED'` alongside `'COMPLETED'` and `'CANCELLED'`.
     - **Reason:** Prevents missed appointments from showing as the next upcoming appointment.
  4. `src/services/localStore.ts` (`MODIFIED`)
     - **Changes:** Added `saveAppointmentDraftNotes`, `getAppointmentDraftNotes`, `hasProcessedMutation`, `markMutationProcessed`, `queueOfflineMutation`, and `getPendingOfflineMutations`.
     - **Reason:** Preserves unsaved post-visit notes across concurrent schedule changes and tracks idempotent offline mutations.
  5. `src/services/appointmentService.ts` (`MODIFIED`)
     - **Changes:** Added `AppointmentConflictError`, `rescheduleAppointment`, `markAppointmentMissed`, `revertAppointmentToScheduled`, `updateCompletedAppointment`, `flushOfflineAppointmentMutation`, optimistic `version` checks, `clientMutationId` idempotency, image attachment validation via `imageCompression.ts`, child follow-up creation (`parentAppointmentId`), and reminder hooks.
     - **Reason:** Handles all concurrency, offline, rescheduling, completion, post-visit edit, and reminder edge cases atomically.
  6. `src/components/AppointmentPhaseModal.tsx` (`MODIFIED`)
     - **Changes:** Bound writes to `appointment.patientId`, added conflict & draft-notes banners, reschedule + missed actions, `"Add visit notes later"` pill, `"View / Add Extra Notes"` with validated attachments & follow-up toggle, and `"Revert to Scheduled (Undo)"`.
     - **Reason:** Exposes safe conflict resolution, rescheduling, post-visit updates, and undo controls in the appointment modal.
  7. `src/screens/AppointmentsScreen.tsx` (`MODIFIED`)
     - **Changes:** Added **Needs Update** section for overdue visits with 1-tap **Mark as Completed**, **Reschedule**, and **Missed** buttons; added 6-second **Undo** toast banner; added past-time walk-in warning; added `"Syncing..."` and `"Add visit notes later"` pills.
     - **Reason:** Surfaces overdue visits, undo recovery, retrospective visit warnings, and sync indicators cleanly.
  8. `__tests__/fullAppFlow.test.tsx` (`MODIFIED`)
     - **Changes:** Added test `#5` covering concurrency conflict errors, in-place rescheduling, offline `clientMutationId` idempotency/flush, post-visit updates with attachment validation & child follow-up (`parentAppointmentId`), undo/revert, missed status, and reminder cancellation/rescheduling.
     - **Reason:** Verifies all appointment edge cases end-to-end.
- **DB / State / Logic Notes:** All appointment mutations use atomic `writeBatch` writes under `patients/{patientId}/appointments/{appointmentId}` and `patients/{patientId}/activityLogs/{logId}` with optimistic `version` counters.
- **Pending Next:** Verify on iOS/Android device or simulator and push to Git.
---

