import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { terminate } from 'firebase/firestore';
import App from '../src/App';
import { db } from '../src/config/firebase';
import {
  isValidMobile,
  normalizeMobile,
  registerUserWithDummyOtp,
  requestDummyOtp,
  verifyDummyOtp,
  verifyDummyOtpAndLogin,
} from '../src/services/authService';
import {
  acceptInvitation,
  createPatientWorkspace,
  findMyPatientId,
  findMyPatients,
  findPendingInvitationsForUser,
  inviteMember,
  removeCareCircleMember,
  subscribeMembers,
  subscribeMyMembership,
  updateMemberRole,
} from '../src/services/careCircleService';
import {
  completeAppointment,
  createAppointment,
  startAttend,
} from '../src/services/appointmentService';
import {
  addMedicalBill,
  filterBillsByCategory,
  monthBills,
} from '../src/services/billsService';
import {
  completeCareTask,
  createCareTask,
  subscribeAllTasks,
  subscribePendingTasks,
} from '../src/services/careTaskService';
import { monthRange } from '../src/services/dashboardSelectors';
import { loadSyntheticDemoData } from '../src/services/demoSeedService';
import { localStore } from '../src/services/localStore';
import { getCapabilities } from '../src/services/permissions';
import {
  createPrescription,
  discontinuePrescription,
  logDailyDose,
} from '../src/services/prescriptionService';
import {
  createMedicalRecord,
  createMonthlyCheckup,
} from '../src/services/recordsService';
import { extractPrescriptionFromImage } from '../src/config/gemini';
import { daysRemaining, durationBetween, isLowStock } from '../src/utils/durationCalculator';
import { formatRupees, monthTotal, splitByPayer } from '../src/utils/expenseMath';
import type { CareCircleMember, CareTask } from '../src/types/carebridge';

describe('CareBridge End-to-End Application Flow', () => {
  beforeEach(() => {
    localStore.resetAll();
  });

  afterAll(async () => {
    await terminate(db).catch(() => {});
  });

  test('1. Mobile normalization & OTP verification rules', () => {
    expect(normalizeMobile('+91 98765-43210')).toBe('9876543210');
    expect(isValidMobile('9876543210')).toBe(true);
    expect(isValidMobile('12345')).toBe(false);

    expect(verifyDummyOtp('')).toEqual({ ok: false, reason: 'EMPTY' });
    expect(verifyDummyOtp('123')).toEqual({ ok: false, reason: 'INCOMPLETE' });
    expect(verifyDummyOtp('000000')).toEqual({ ok: false, reason: 'MISMATCH' });
    expect(verifyDummyOtp('111111')).toEqual({ ok: true });
  });

  test('2. Full User Registration -> Workspace Creation -> Care Circle Invites -> Role Updates -> Sibling Claim -> Task Completion', async () => {
    // Step A: Register Primary Sibling (Aarav Rao)
    const user1 = await registerUserWithDummyOtp({
      fullName: 'Aarav Rao',
      phone: '9876543210',
      email: 'aarav@carebridge.test',
      city: 'Hyderabad',
      relationshipLabel: 'Son',
    });

    expect(user1.fullName).toBe('Aarav Rao');
    expect(user1.phone).toBe('9876543210');
    expect(user1.isSyntheticDemo).toBe(true);

    // Duplicate registration for same phone should reject
    await expect(
      registerUserWithDummyOtp({
        fullName: 'Duplicate User',
        phone: '9876543210',
        email: 'dup@carebridge.test',
        city: 'Hyderabad',
        relationshipLabel: 'Son',
      }),
    ).rejects.toThrow('Account already exists. Please login.');

    // Login OTP request & login verification for User 1
    await expect(requestDummyOtp('9876543210')).resolves.toBeUndefined();
    const loggedInUser1 = await verifyDummyOtpAndLogin('9876543210');
    expect(loggedInUser1.id).toBe(user1.id);

    // Initially User 1 has no patient workspace
    const initialPatientId = await findMyPatientId(user1.id);
    expect(initialPatientId).toBeNull();

    // Step B: Create Patient Workspace (Mother: Lakshmi Rao)
    const patientId = await createPatientWorkspace(user1.id, {
      fullName: 'Lakshmi Rao',
      relationshipLabel: 'Mother',
      city: 'Hyderabad',
      bloodGroup: 'O+',
      allergiesNote: 'Penicillin',
      creatorName: user1.fullName,
      creatorPhone: user1.phone,
      creatorEmail: user1.email,
    });

    expect(typeof patientId).toBe('string');
    expect(await findMyPatientId(user1.id)).toBe(patientId);

    // Verify User 1 is CO_CAREGIVER with full capabilities
    let myMember: CareCircleMember | null = null;
    const unsubMe = subscribeMyMembership(patientId, user1.id, m => {
      myMember = m;
    });
    expect(myMember).not.toBeNull();
    expect(myMember!.rolePreset).toBe('CO_CAREGIVER');
    expect(getCapabilities(myMember).canManageMembers).toBe(true);
    expect(getCapabilities(myMember).canViewFinancials).toBe(true);
    unsubMe();

    // Step C: Invite Sibling (Meera Rao) as CONTRIBUTOR without financial visibility
    await inviteMember(
      patientId,
      { uid: user1.id, name: user1.fullName },
      {
        invitedEmail: 'meera@carebridge.test',
        invitedPhone: '9876543211',
        rolePreset: 'CONTRIBUTOR',
        isBackupAdmin: false,
        canViewFinancials: false,
      },
    );

    let allMembers: CareCircleMember[] = [];
    const unsubMembers = subscribeMembers(patientId, list => {
      allMembers = list;
    });
    expect(allMembers.length).toBe(2);
    const pendingInvite = allMembers.find(m => m.invitedPhone === '9876543211');
    expect(pendingInvite).toBeDefined();
    expect(pendingInvite!.inviteStatus).toBe('PENDING');
    expect(pendingInvite!.rolePreset).toBe('CONTRIBUTOR');

    // Step D: Update Sibling's role & backup-admin status
    await updateMemberRole(
      patientId,
      pendingInvite!.id,
      { uid: user1.id, name: user1.fullName },
      {
        isBackupAdmin: true,
        canViewFinancials: true,
      },
    );
    const updatedInvite = allMembers.find(m => m.id === pendingInvite!.id);
    expect(updatedInvite!.isBackupAdmin).toBe(true);
    expect(updatedInvite!.canViewFinancials).toBe(true);
    unsubMembers();

    // Step E: Register Second Sibling (Meera Rao) — automatically claims pending invite!
    const user2 = await registerUserWithDummyOtp({
      fullName: 'Meera Rao',
      phone: '9876543211',
      email: 'meera@carebridge.test',
      city: 'Bengaluru',
      relationshipLabel: 'Daughter',
    });

    // User 2 should immediately resolve to the same patientId without creating a new workspace
    const user2PatientId = await findMyPatientId(user2.id);
    expect(user2PatientId).toBe(patientId);

    // Step F: Pending Tasks & Quick-Complete Audit Log
    localStore.upsertTask(patientId, {
      id: 'task_refill_1',
      patientId,
      taskType: 'REFILL',
      title: 'Refill Telma 40mg strip',
      dueDate: '2026-11-25T10:00:00',
      status: 'PENDING',
      createdById: user1.id,
      createdAt: new Date().toISOString(),
    });

    let pendingTasks: CareTask[] = [];
    const unsubTasks = subscribePendingTasks(patientId, list => {
      pendingTasks = list;
    });
    expect(pendingTasks.length).toBe(1);

    await completeCareTask(
      patientId,
      { id: 'task_refill_1', title: 'Refill Telma 40mg strip' },
      { uid: user2.id, name: user2.fullName },
    );
    expect(pendingTasks.length).toBe(0);
    unsubTasks();

    // Verify activity logs captured workspace creation, invite, role update, and task completion
    const logs = localStore.getActivityLogs(patientId);
    expect(logs.map(l => l.actionType)).toEqual(
      expect.arrayContaining([
        'PATIENT_WORKSPACE_CREATED',
        'MEMBER_INVITED',
        'MEMBER_ROLE_UPDATED',
        'TASK_COMPLETED',
      ]),
    );
  }, 15000);

  test('3. Accept Pending Invitation button flow, Multi-Patient switcher, and Remove/Revoke Member rules', async () => {
    const owner = await registerUserWithDummyOtp({
      fullName: 'Vikram Rao',
      phone: '9876543220',
      email: 'vikram@carebridge.test',
      city: 'Hyderabad',
      relationshipLabel: 'Son',
    });

    const sibling = await registerUserWithDummyOtp({
      fullName: 'Rohan Rao',
      phone: '9876543222',
      email: 'rohan@carebridge.test',
      city: 'Pune',
      relationshipLabel: 'Brother',
    });

    // Create 1st patient workspace (Mother)
    const motherId = await createPatientWorkspace(owner.id, {
      fullName: 'Lakshmi Rao',
      relationshipLabel: 'Mother',
      city: 'Hyderabad',
      creatorName: owner.fullName,
      creatorPhone: owner.phone,
      creatorEmail: owner.email,
    });

    // Create 2nd patient workspace (Father) without overwriting 1st
    const fatherId = await createPatientWorkspace(owner.id, {
      fullName: 'Suresh Rao',
      relationshipLabel: 'Father',
      city: 'Hyderabad',
      creatorName: owner.fullName,
      creatorPhone: owner.phone,
      creatorEmail: owner.email,
    });

    const myPatients = await findMyPatients(owner.id);
    expect(myPatients.map(p => p.id)).toEqual(expect.arrayContaining([motherId, fatherId]));
    expect(localStore.getActivePatientIdForUser(owner.id)).toBe(fatherId);

    // Switch active patient back to Mother
    localStore.setActivePatientForUser(owner.id, motherId);
    expect(localStore.getActivePatientIdForUser(owner.id)).toBe(motherId);

    // Invite already-registered sibling to Mother's care circle
    await inviteMember(
      motherId,
      { uid: owner.id, name: owner.fullName },
      {
        invitedEmail: 'rohan@carebridge.test',
        invitedPhone: '9876543222',
        rolePreset: 'CONTRIBUTOR',
        isBackupAdmin: true,
        canViewFinancials: true,
      },
    );

    // Sibling queries their pending invitations
    const pendingForSibling = await findPendingInvitationsForUser(sibling.phone, sibling.email);
    expect(pendingForSibling.length).toBe(1);
    expect(pendingForSibling[0].patient?.fullName).toBe('Lakshmi Rao');

    // Sibling clicks "Accept Invitation"
    await acceptInvitation(motherId, pendingForSibling[0].member.id, sibling);

    // Verify invite is now ACCEPTED, removed from pending, and logged as INVITE_ACCEPTED
    const remainingPending = await findPendingInvitationsForUser(sibling.phone, sibling.email);
    expect(remainingPending.length).toBe(0);
    expect(localStore.getActivePatientIdForUser(sibling.id)).toBe(motherId);

    const acceptedSiblingMember = localStore
      .getMembers(motherId)
      .find(m => m.userId === sibling.id);
    expect(acceptedSiblingMember?.inviteStatus).toBe('ACCEPTED');
    // Backup admin has canManageMembers capability
    expect(getCapabilities(acceptedSiblingMember ?? null).canManageMembers).toBe(true);

    // Create an appointment assigned to sibling
    const appointmentId = await createAppointment(
      motherId,
      { uid: owner.id, name: owner.fullName },
      {
        hospitalName: 'Apollo Hospitals Jubilee Hills',
        doctorName: 'Dr. Ramesh',
        specialty: 'Cardiology',
        visitType: 'IN_PERSON',
        scheduledAt: '2026-11-26T10:30:00.000Z',
        bookedByUserId: owner.id,
        assignedAttendeeId: sibling.id,
        prepRecordIds: [],
      },
    );

    // Non-assigned user (even owner/CO_CAREGIVER) cannot mark an assigned appointment as completed or start it
    await expect(
      startAttend(motherId, appointmentId, { uid: owner.id, name: owner.fullName }),
    ).rejects.toThrow('Only the assigned attendee can start this appointment.');

    await expect(
      completeAppointment(motherId, appointmentId, { uid: owner.id, name: owner.fullName }),
    ).rejects.toThrow('Only the assigned attendee can mark this appointment as completed.');

    // Assigned user (sibling) marks the appointment as completed
    await completeAppointment(motherId, appointmentId, {
      uid: sibling.id,
      name: sibling.fullName,
    });

    const completedAppointment = localStore
      .getAppointments(motherId)
      .find(a => a.id === appointmentId);
    expect(completedAppointment?.status).toBe('COMPLETED');
    expect(completedAppointment?.actualAttendedById).toBe(sibling.id);

    // Invite a temporary pending observer and revoke their invite
    await inviteMember(
      motherId,
      { uid: owner.id, name: owner.fullName },
      {
        invitedEmail: 'temp@carebridge.test',
        invitedPhone: '9876543219',
        rolePreset: 'OBSERVER',
        isBackupAdmin: false,
        canViewFinancials: false,
      },
    );
    const tempPending = localStore
      .getMembers(motherId)
      .find(m => m.invitedEmail === 'temp@carebridge.test');
    expect(tempPending).toBeDefined();

    await removeCareCircleMember(motherId, tempPending!.id, {
      uid: owner.id,
      name: owner.fullName,
    });
    expect(
      localStore.getMembers(motherId).find(m => m.id === tempPending!.id),
    ).toBeUndefined();

    // Block removing the last remaining CO_CAREGIVER
    await expect(
      removeCareCircleMember(motherId, owner.id, {
        uid: owner.id,
        name: owner.fullName,
      }),
    ).rejects.toThrow('Cannot remove the last Co-caregiver from the care circle.');

    // Removing the accepted CONTRIBUTOR member succeeds
    await removeCareCircleMember(motherId, acceptedSiblingMember!.id, {
      uid: owner.id,
      name: owner.fullName,
    });
    expect(
      localStore.getMembers(motherId).find(m => m.id === acceptedSiblingMember!.id),
    ).toBeUndefined();

    const motherLogs = localStore.getActivityLogs(motherId).map(l => l.actionType);
    expect(motherLogs).toEqual(
      expect.arrayContaining([
        'INVITE_ACCEPTED',
        'APPOINTMENT_SCHEDULED',
        'APPOINTMENT_COMPLETED',
        'INVITE_REVOKED',
        'MEMBER_REMOVED',
      ]),
    );
  }, 25000);

  test('4. Records & Monthly Checkups, Prescriptions + AI Scan + Dose Refill Auto-Task, Bills Ledger & Expense Split, Tasks & Synthetic Demo Seed', async () => {
    const caregiver = await registerUserWithDummyOtp({
      fullName: 'Ananya Rao',
      phone: '9876543230',
      email: 'ananya@carebridge.test',
      city: 'Chennai',
      relationshipLabel: 'Daughter',
    });

    const patientId = await createPatientWorkspace(caregiver.id, {
      fullName: 'Venkatesh Rao',
      relationshipLabel: 'Father',
      city: 'Chennai',
      creatorName: caregiver.fullName,
      creatorPhone: caregiver.phone,
      creatorEmail: caregiver.email,
    });

    const actor = { uid: caregiver.id, name: caregiver.fullName };

    // A: Monthly Checkup & Medical Record
    const checkupId = await createMonthlyCheckup(patientId, actor, {
      checkupCycle: '2026-11',
      labName: 'Vijaya Diagnostics',
      checkupDate: '2026-11-10',
      notes: 'Routine HbA1c and lipid panel',
    });
    expect(typeof checkupId).toBe('string');
    expect(localStore.getMonthlyCheckups(patientId).length).toBe(1);

    const recordId = await createMedicalRecord(patientId, actor, {
      recordCategory: 'MONTHLY_CHECKUP',
      recordType: 'LAB_REPORT',
      title: 'November Lipid & Glucose Panel',
      facilityName: 'Vijaya Diagnostics',
      recordDate: '2026-11-10',
      checkupCycle: '2026-11',
      monthlyCheckupId: checkupId,
      attachments: [{ url: 'https://carebridge.test/demo-lab.jpg', mimeType: 'image/jpeg' }],
    });
    expect(typeof recordId).toBe('string');
    expect(localStore.getMedicalRecords(patientId).length).toBe(1);

    // B: AI Prescription Scan Extraction (sample fallback) -> Create Prescription -> Log Dose -> Auto-Refill Task -> Discontinue
    const draft = await extractPrescriptionFromImage('https://carebridge.test/rx.jpg');
    expect(draft.items.length).toBeGreaterThan(0);

    const prescriptionId = await createPrescription(patientId, actor, {
      prescribedByDoc: 'Dr. Kavitha Nair',
      startDate: '2026-11-01',
      items: [
        {
          medicineName: 'Metformin Synthetic',
          strength: '500 mg',
          timingSlot: 'Morning & Night',
          dailyUnitsNeeded: 2,
          administeredByUserId: caregiver.id,
          administeredByLabel: caregiver.fullName,
          remainingTablets: 6, // 3 days left; after 1 dose (4 left -> 2 days left <= threshold 3)
          refillThresholdDays: 3,
        },
      ],
    });
    const createdRx = localStore.getPrescriptions(patientId).find(p => p.id === prescriptionId);
    expect(createdRx).toBeDefined();
    expect(createdRx!.status).toBe('ACTIVE');
    const itemId = createdRx!.items[0].id;
    expect(daysRemaining(6, 2)).toBe(3);
    expect(isLowStock(6, 2, 3)).toBe(true);

    // Log daily dose -> decrements remainingTablets from 6 to 4 and auto-creates a REFILL task
    await logDailyDose(patientId, prescriptionId, itemId, actor);
    const afterDoseRx = localStore.getPrescriptions(patientId).find(p => p.id === prescriptionId);
    expect(afterDoseRx!.items[0].remainingTablets).toBe(4);
    const refillTasks = localStore
      .getPendingTasks(patientId)
      .filter(t => t.taskType === 'REFILL' && t.prescriptionId === prescriptionId);
    expect(refillTasks.length).toBe(1);

    // Discontinue prescription
    await discontinuePrescription(patientId, prescriptionId, actor, {
      endDate: '2026-11-20',
      discontinuationNote: 'Switched dosage form',
    });
    const discontinuedRx = localStore
      .getPrescriptions(patientId)
      .find(p => p.id === prescriptionId);
    expect(discontinuedRx!.status).toBe('DISCONTINUED');
    expect(durationBetween('2026-11-01', '2026-11-20')).toBe(20);

    // C: Medical Bills & Expense Split Math
    await addMedicalBill(patientId, actor, {
      category: 'PHARMACY_MEDICINES',
      amount: 1200,
      prescriptionDate: '2026-11-12',
      paidByUserId: caregiver.id,
      notes: 'Monthly medicines',
    });
    await addMedicalBill(patientId, actor, {
      category: 'LAB_DIAGNOSTICS',
      amount: 800,
      prescriptionDate: '2026-11-15',
      paidByUserId: caregiver.id,
    });
    const allBills = localStore.getMedicalBills(patientId);
    expect(allBills.length).toBe(2);
    expect(filterBillsByCategory(allBills, 'PHARMACY_MEDICINES').length).toBe(1);
    const novRange = monthRange(new Date('2026-11-15T00:00:00Z'));
    const novBills = monthBills(allBills, novRange);
    expect(monthTotal(novBills)).toBe(2000);
    const shares = splitByPayer(novBills);
    expect(shares[0].amount).toBe(2000);
    expect(shares[0].sharePercent).toBe(100);
    expect(formatRupees(2000)).toContain('2,000');

    // D: Care Tasks creation & full subscription
    const customTaskId = await createCareTask(patientId, actor, {
      taskType: 'GENERAL',
      title: 'Collect printed lab summary',
      dueDate: '2026-11-28',
      assignedToUserId: caregiver.id,
    });
    expect(typeof customTaskId).toBe('string');
    let allTasks: CareTask[] = [];
    const unsubAll = subscribeAllTasks(patientId, list => {
      allTasks = list;
    });
    expect(allTasks.some(t => t.id === customTaskId)).toBe(true);
    unsubAll();

    // E: Synthetic Demo Data Seed
    await loadSyntheticDemoData(patientId, actor);
    expect(localStore.getAppointments(patientId).length).toBeGreaterThanOrEqual(2);
    expect(localStore.getPrescriptions(patientId).length).toBeGreaterThanOrEqual(3);
    expect(localStore.getMedicalBills(patientId).length).toBeGreaterThanOrEqual(4);
  }, 25000);

  test('5. UI Component tree mounts and transitions from Loading to LoginScreen cleanly', async () => {
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
    await act(async () => {
      renderer = ReactTestRenderer.create(<App />);
    });
    // Wait for AuthProvider onAuthStateChanged to settle
    await act(async () => {
      await new Promise<void>(r => {
        setTimeout(() => r(), 100);
      });
    });
    const treeJson = JSON.stringify(renderer!.toJSON());
    expect(treeJson).toContain('The Family Care Hub');
    expect(treeJson).toContain('Get OTP');
    await act(async () => {
      renderer!.unmount();
    });
  });
});
