import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type KeyboardTypeOptions,
} from 'react-native';
import { useAuth } from '../hooks/useAuth';
import { usePermissions } from '../hooks/usePermissions';
import {
  AppointmentConflictError,
  cancelAppointment,
  completeAppointment,
  markAppointmentMissed,
  reassignAttendee,
  rescheduleAppointment,
  revertAppointmentToScheduled,
  startAttend,
  updateCompletedAppointment,
  type CompleteAppointmentInput,
} from '../services/appointmentService';
import type { Actor } from '../services/careCircleService';
import { formatDateTime } from '../services/dashboardSelectors';
import { localStore } from '../services/localStore';
import { subscribeMedicalRecords } from '../services/recordsService';
import DateTimePickerField from './DateTimePickerField';
import { colors, tabularNums } from '../theme/colors';
import type {
  Appointment,
  AppointmentStatus,
  MedicalRecord,
  RecordType,
  VisitType,
} from '../types/carebridge';

export interface AttendeeOption {
  id: string;
  label: string;
}

export interface AppointmentPhaseModalProps {
  visible: boolean;
  appointment: Appointment | null;
  patientId: string;
  onClose: () => void;
  /** Members that can be chosen as attendee, payer or the person who attended. */
  attendeeOptions?: AttendeeOption[];
}

export const APPOINTMENT_STATUS_LABEL: Record<AppointmentStatus, string> = {
  SCHEDULED: 'Scheduled',
  ATTEND: 'In progress (ATTEND)',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  MISSED: 'Missed',
};

export const APPOINTMENT_STATUS_COLOR: Record<AppointmentStatus, string> = {
  SCHEDULED: colors.amber,
  ATTEND: colors.primary,
  COMPLETED: '#4338CA',
  CANCELLED: colors.textSecondary,
  MISSED: colors.error,
};

export const VISIT_TYPE_LABEL: Record<VisitType, string> = {
  IN_PERSON: 'In person',
  TELECONSULT: 'Teleconsult',
};

const RECORD_TYPE_LABEL: Record<RecordType, string> = {
  PRESCRIPTION: 'Prescription',
  LAB_REPORT: 'Lab report',
  DISCHARGE_SUMMARY: 'Discharge summary',
  CHECKUP_PANEL: 'Checkup panel',
  OTHER: 'Other',
};

const RECORD_TYPES: RecordType[] = [
  'PRESCRIPTION',
  'LAB_REPORT',
  'DISCHARGE_SUMMARY',
  'CHECKUP_PANEL',
  'OTHER',
];

const DATE_ONLY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const READ_ONLY_MESSAGE = 'Read-only role — changes are disabled.';
const NO_ATTENDEES: AttendeeOption[] = [];

// Form values for the post-visit wrap-up. Kept in one object so it resets together.
interface WrapUpForm {
  actualAttendedById: string;
  completionSummary: string;
  finalAmount: string;
  finalPaidById: string;
  createRecord: boolean;
  recordTitle: string;
  recordType: RecordType;
  recordFacility: string;
  recordDate: string;
  followUpTitle: string;
  followUpDueDate: string;
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : `${value}`;
}

// Local calendar date as YYYY-MM-DD.
export function localDateString(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

// Formats a stored ISO date-time as 'DD Mon YYYY, HH:mm' in local time.
export function formatAppointmentTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const local = `${localDateString(date)}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  return formatDateTime(local);
}

function formatRupees(amount: number): string {
  return `₹${amount.toFixed(2)}`;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong. Please try again.';
}

function emptyWrapUp(defaultAttendeeId: string): WrapUpForm {
  return {
    actualAttendedById: defaultAttendeeId,
    completionSummary: '',
    finalAmount: '',
    finalPaidById: '',
    createRecord: false,
    recordTitle: '',
    recordType: 'OTHER',
    recordFacility: '',
    recordDate: localDateString(new Date()),
    followUpTitle: '',
    followUpDueDate: '',
  };
}

interface FieldProps {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  editable: boolean;
  placeholder?: string;
  keyboardType?: KeyboardTypeOptions;
  multiline?: boolean;
}

function Field({
  label,
  value,
  onChangeText,
  editable,
  placeholder,
  keyboardType,
  multiline = false,
}: FieldProps): React.JSX.Element {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        editable={editable}
        placeholder={placeholder}
        placeholderTextColor={colors.textSecondary}
        keyboardType={keyboardType}
        multiline={multiline}
        style={[
          styles.input,
          multiline && styles.inputMultiline,
          !editable && styles.disabled,
        ]}
      />
    </View>
  );
}

interface ChipProps {
  label: string;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
}

function Chip({ label, selected, disabled, onPress }: ChipProps): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.chip, selected && styles.chipSelected, disabled && styles.disabled]}>
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

interface ButtonProps {
  label: string;
  onPress: () => void;
  disabled: boolean;
  tone?: 'primary' | 'danger';
}

function ActionButton({ label, onPress, disabled, tone = 'primary' }: ButtonProps): React.JSX.Element {
  const toneStyle = tone === 'danger' ? styles.buttonDanger : styles.buttonPrimary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, toneStyle, disabled && styles.disabled]}>
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function InlineError({ message }: { message: string | null }): React.JSX.Element | null {
  if (!message) return null;
  return (
    <Text accessibilityRole="alert" style={styles.errorText}>
      {message}
    </Text>
  );
}

interface RowProps {
  label: string;
  value: string;
  tabular?: boolean;
}

function Row({ label, value, tabular = false }: RowProps): React.JSX.Element {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, tabular && tabularNums]}>{value}</Text>
    </View>
  );
}

export default function AppointmentPhaseModal({
  visible,
  appointment,
  patientId,
  onClose,
  attendeeOptions = NO_ATTENDEES,
}: AppointmentPhaseModalProps): React.JSX.Element {
  const { currentUser } = useAuth();
  const { capabilities, loading: permissionsLoading } = usePermissions(patientId);

  const [records, setRecords] = useState<MedicalRecord[]>([]);
  const [recordsLoaded, setRecordsLoaded] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState<string>('');
  const [cancelReasonError, setCancelReasonError] = useState<string | null>(null);
  const [rescheduleAt, setRescheduleAt] = useState<string>('');
  const [rescheduleReason, setRescheduleReason] = useState<string>('');
  const [followUpEnabled, setFollowUpEnabled] = useState<boolean>(false);
  const [followUpScheduledAt, setFollowUpScheduledAt] = useState<string>('');
  const [extraNotes, setExtraNotes] = useState<string>('');
  const [attachmentUrl, setAttachmentUrl] = useState<string>('');
  const [editingCompleted, setEditingCompleted] = useState<boolean>(false);
  const [conflictBanner, setConflictBanner] = useState<string | null>(null);
  const [scheduleConflictNotice, setScheduleConflictNotice] = useState<string | null>(null);
  const [openedVersion, setOpenedVersion] = useState<number | undefined>(undefined);
  const [openedScheduledAt, setOpenedScheduledAt] = useState<string | null>(null);
  const [wrapUp, setWrapUp] = useState<WrapUpForm>(() => emptyWrapUp(''));

  // Explicitly bind patientId to the selected appointment so global patient switching never misroutes writes.
  const targetPatientId = appointment?.patientId ?? patientId;
  const appointmentId = appointment?.id ?? null;
  const actor: Actor | null = currentUser
    ? { uid: currentUser.id, name: currentUser.fullName }
    : null;
  const isAssigned = Boolean(appointment?.assignedAttendeeId);
  const isAssignedToMe = Boolean(
    appointment?.assignedAttendeeId &&
      currentUser &&
      appointment.assignedAttendeeId === currentUser.id,
  );
  const isAssignedToOther = Boolean(isAssigned && !isAssignedToMe);
  const editable = capabilities.canEdit && !permissionsLoading && !busy && actor !== null;
  const canStartOrComplete =
    !busy &&
    actor !== null &&
    (isAssignedToMe || (!isAssigned && capabilities.canEdit && !permissionsLoading));
  const showReadOnlyNote = !permissionsLoading && !capabilities.canEdit && !isAssignedToMe;

  // Live medical records, used to resolve prepRecordIds while the modal is open.
  useEffect(() => {
    if (!visible || !targetPatientId) return undefined;
    return subscribeMedicalRecords(targetPatientId, items => {
      setRecords(items);
      setRecordsLoaded(true);
    });
  }, [visible, targetPatientId]);

  // Reset local form state whenever a different appointment is opened.
  useEffect(() => {
    setError(null);
    setCancelReason('');
    setCancelReasonError(null);
    setRescheduleAt('');
    setRescheduleReason('');
    setFollowUpEnabled(false);
    setFollowUpScheduledAt('');
    setConflictBanner(null);
    setScheduleConflictNotice(null);
    setEditingCompleted(false);
    setAttachmentUrl('');
    setOpenedVersion(appointment?.version ?? 1);
    setOpenedScheduledAt(appointment?.scheduledAt ?? null);
    const savedDraft =
      appointment && targetPatientId
        ? localStore.getAppointmentDraftNotes(targetPatientId, appointment.id)
        : '';
    const form = emptyWrapUp(appointment?.assignedAttendeeId ?? currentUser?.id ?? '');
    if (savedDraft) {
      form.completionSummary = savedDraft;
    }
    setWrapUp(form);
    setExtraNotes(
      appointment?.visitNotes ?? appointment?.completionSummary ?? savedDraft ?? '',
    );
    // Keyed on the id only: a status update to the same visit should not wipe the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appointmentId, visible]);

  // Detect concurrent reschedule/cancel while user has unsaved draft notes.
  useEffect(() => {
    if (!visible || !appointment || !openedScheduledAt) return;
    if (
      appointment.scheduledAt !== openedScheduledAt &&
      wrapUp.completionSummary.trim().length > 0
    ) {
      const who = appointment.updatedByName || 'Another caregiver';
      setScheduleConflictNotice(
        `${who} rescheduled this appointment to ${formatAppointmentTime(appointment.scheduledAt)}. Save notes to the rescheduled visit or discard?`,
      );
    }
  }, [appointment, openedScheduledAt, visible, wrapUp.completionSummary]);

  const prepRecords = useMemo<MedicalRecord[]>(() => {
    if (!appointment) return [];
    const byId = new Map<string, MedicalRecord>(records.map(r => [r.id, r] as const));
    const found: MedicalRecord[] = [];
    for (const id of appointment.prepRecordIds) {
      const record = byId.get(id);
      if (record) found.push(record);
    }
    return found;
  }, [appointment, records]);

  function labelFor(id: string | undefined): string {
    if (!id) return 'Not assigned';
    return attendeeOptions.find(option => option.id === id)?.label ?? 'Unknown member';
  }

  function patchWrapUp(patch: Partial<WrapUpForm>): void {
    setWrapUp(prev => {
      const next = { ...prev, ...patch };
      if (patch.completionSummary !== undefined && appointment && targetPatientId) {
        localStore.saveAppointmentDraftNotes(
          targetPatientId,
          appointment.id,
          patch.completionSummary,
        );
      }
      return next;
    });
  }

  // Runs one write. Returns true on success; thrown errors are shown inline.
  async function runAction(action: () => Promise<void>): Promise<boolean> {
    setBusy(true);
    setError(null);
    setConflictBanner(null);
    try {
      await action();
      return true;
    } catch (err: unknown) {
      if (err instanceof AppointmentConflictError && err.code === 'ALREADY_COMPLETED') {
        setConflictBanner(err.message);
      } else {
        setError(errorMessage(err));
      }
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleStart(): Promise<void> {
    if (!appointment || !actor) return;
    const id = appointment.id;
    await runAction(() => startAttend(targetPatientId, id, actor));
  }

  async function handleCancel(): Promise<void> {
    if (!appointment || !actor) return;
    const id = appointment.id;
    const reason = cancelReason.trim();
    if (!reason) {
      setCancelReasonError('Enter a cancellation reason before cancelling.');
      return;
    }
    setCancelReasonError(null);
    await runAction(() => cancelAppointment(targetPatientId, id, actor, reason));
  }

  async function handleReschedule(): Promise<void> {
    if (!appointment || !actor) return;
    if (!rescheduleAt || Number.isNaN(Date.parse(rescheduleAt))) {
      setError('Pick a valid new date and time to reschedule.');
      return;
    }
    const id = appointment.id;
    await runAction(async () => {
      await rescheduleAppointment(targetPatientId, id, actor, {
        scheduledAt: rescheduleAt,
        rescheduleReason: rescheduleReason.trim() || undefined,
        expectedVersion: openedVersion,
      });
      setRescheduleAt('');
      setRescheduleReason('');
      setOpenedVersion((appointment.version ?? 1) + 1);
    });
  }

  async function handleMarkMissed(): Promise<void> {
    if (!appointment || !actor) return;
    const id = appointment.id;
    await runAction(() => markAppointmentMissed(targetPatientId, id, actor, openedVersion));
  }

  async function handleRevertToScheduled(): Promise<void> {
    if (!appointment || !actor) return;
    const id = appointment.id;
    await runAction(() => revertAppointmentToScheduled(targetPatientId, id, actor));
  }

  async function handleSaveCompletedExtras(): Promise<void> {
    if (!appointment || !actor) return;
    const id = appointment.id;
    const attachments = attachmentUrl.trim() ? [{ url: attachmentUrl.trim() }] : undefined;
    const followUpAppointment =
      followUpEnabled && followUpScheduledAt && !Number.isNaN(Date.parse(followUpScheduledAt))
        ? { scheduledAt: followUpScheduledAt }
        : undefined;
    if (followUpEnabled && !followUpAppointment) {
      setError('Pick a valid follow-up date & time or turn off the follow-up toggle.');
      return;
    }
    await runAction(async () => {
      const res = await updateCompletedAppointment(targetPatientId, id, actor, {
        visitNotes: extraNotes,
        attachments,
        followUpAppointment,
      });
      if (res.rejectedAttachments > 0) {
        setError('Notes saved, but an attachment failed type/size validation.');
      }
      setEditingCompleted(false);
      setAttachmentUrl('');
      setFollowUpEnabled(false);
      setFollowUpScheduledAt('');
    });
  }

  async function handleReassign(option: AttendeeOption): Promise<void> {
    if (!appointment || !actor) return;
    if (option.id === appointment.assignedAttendeeId) return;
    const id = appointment.id;
    await runAction(() => reassignAttendee(targetPatientId, id, actor, option.id));
  }

  async function handleComplete(): Promise<void> {
    if (!appointment || !actor) return;
    const id = appointment.id;

    const actualAttendedById = wrapUp.actualAttendedById.trim();
    if (!actualAttendedById) {
      setError('Choose who attended the visit.');
      return;
    }

    const amountText = wrapUp.finalAmount.trim();
    let finalAmount: number | undefined;
    if (amountText !== '') {
      const parsed = Number(amountText);
      if (!Number.isFinite(parsed) || parsed < 0) {
        setError('Final amount must be a number, 0 or more.');
        return;
      }
      finalAmount = parsed;
    }

    const finalPaidById = wrapUp.finalPaidById.trim();
    if (finalAmount !== undefined && finalAmount > 0 && !finalPaidById) {
      setError('Choose who paid the final amount.');
      return;
    }

    let createRecord: CompleteAppointmentInput['createRecord'];
    if (wrapUp.createRecord) {
      const title = wrapUp.recordTitle.trim();
      const recordDate = wrapUp.recordDate.trim();
      if (!title) {
        setError('Enter a title for the record.');
        return;
      }
      if (!DATE_ONLY.test(recordDate)) {
        setError('Record date must be YYYY-MM-DD.');
        return;
      }
      createRecord = {
        title,
        recordType: wrapUp.recordType,
        recordDate,
        facilityName: wrapUp.recordFacility.trim() || undefined,
      };
    }

    const followUpDueDate = wrapUp.followUpDueDate.trim();
    if (followUpDueDate && !DATE_ONLY.test(followUpDueDate)) {
      setError('Follow-up due date must be YYYY-MM-DD.');
      return;
    }

    const followUpAppointment =
      followUpEnabled && followUpScheduledAt && !Number.isNaN(Date.parse(followUpScheduledAt))
        ? { scheduledAt: followUpScheduledAt }
        : undefined;

    const input: CompleteAppointmentInput = {
      actualAttendedById,
      completionSummary: wrapUp.completionSummary.trim() || undefined,
      visitNotes: wrapUp.completionSummary.trim() || undefined,
      finalAmount,
      finalPaidById: finalPaidById || undefined,
      expectedVersion: openedVersion,
      clientMutationId: `mut_${id}_${Date.now()}`,
      attachments: attachmentUrl.trim() ? [{ url: attachmentUrl.trim() }] : undefined,
      createRecord,
      followUpTitle: wrapUp.followUpTitle.trim() || undefined,
      followUpDueDate: followUpDueDate || undefined,
      followUpAppointment,
    };
    await runAction(async () => {
      const res = await completeAppointment(targetPatientId, id, actor, input);
      if (res.rejectedAttachments > 0) {
        setError('Visit completed, but an attachment failed validation.');
      }
    });
  }

  async function handleQuickComplete(): Promise<void> {
    if (!appointment || !actor) return;
    const id = appointment.id;
    await runAction(async () => {
      await completeAppointment(targetPatientId, id, actor, {
        actualAttendedById: appointment.assignedAttendeeId || actor.uid,
        expectedVersion: openedVersion,
        clientMutationId: `mut_${id}_${Date.now()}`,
      });
    });
  }

  function renderDetails(current: Appointment): React.JSX.Element {
    return (
      <Section title="Visit details">
        <Row label="Hospital" value={current.hospitalName} />
        <Row label="Doctor" value={current.doctorName ?? 'Not set'} />
        <Row label="Specialty" value={current.specialty ?? 'Not set'} />
        <Row label="Visit type" value={VISIT_TYPE_LABEL[current.visitType]} />
        <Row label="Scheduled" value={formatAppointmentTime(current.scheduledAt)} tabular />
        <Row label="Attendee" value={labelFor(current.assignedAttendeeId)} />
        {current.prepNotes ? <Row label="Prep notes" value={current.prepNotes} /> : null}
      </Section>
    );
  }

  function renderAssigneeNotice(current: Appointment): React.JSX.Element | null {
    if (!isAssignedToOther) return null;
    return (
      <Text style={styles.readOnlyNote}>
        {`Assigned to ${labelFor(current.assignedAttendeeId)} — only the assigned user can mark this appointment as completed.`}
      </Text>
    );
  }

  function renderScheduled(current: Appointment): React.JSX.Element {
    const cancelDisabled = !editable;
    return (
      <>
        {renderAssigneeNotice(current)}
        {renderDetails(current)}
        <Section title="Complete or start the visit">
          <ActionButton
            label="Mark as Completed"
            onPress={() => void handleQuickComplete()}
            disabled={!canStartOrComplete}
          />
          <View style={{ height: 8 }} />
          <ActionButton
            label="Start visit (ATTEND)"
            onPress={() => void handleStart()}
            disabled={!canStartOrComplete}
          />
        </Section>
        <Section title="Reassign attendee">
          {attendeeOptions.length === 0 ? (
            <Text style={styles.muted}>No members available to assign.</Text>
          ) : (
            <View style={styles.chipWrap}>
              {attendeeOptions.map(option => (
                <Chip
                  key={option.id}
                  label={option.label}
                  selected={option.id === current.assignedAttendeeId}
                  disabled={!editable}
                  onPress={() => void handleReassign(option)}
                />
              ))}
            </View>
          )}
        </Section>
        <Section title="Reschedule or mark missed">
          <DateTimePickerField
            label="New date and time"
            value={rescheduleAt}
            onChange={setRescheduleAt}
            mode="datetime"
          />
          <Field
            label="Reschedule reason (optional)"
            value={rescheduleReason}
            onChangeText={setRescheduleReason}
            editable={editable}
            placeholder="e.g. Doctor delayed"
          />
          <ActionButton
            label="Reschedule appointment"
            onPress={() => void handleReschedule()}
            disabled={!editable}
          />
          <View style={{ height: 8 }} />
          <ActionButton
            label="Missed / Didn't Happen"
            tone="danger"
            onPress={() => void handleMarkMissed()}
            disabled={!editable}
          />
        </Section>
        <Section title="Cancel appointment">
          <Field
            label="Cancellation reason (required)"
            value={cancelReason}
            onChangeText={text => {
              setCancelReason(text);
              setCancelReasonError(null);
            }}
            editable={!cancelDisabled}
            placeholder="Why is this visit being cancelled?"
            multiline
          />
          <InlineError message={cancelReasonError} />
          <ActionButton
            label="Cancel appointment"
            tone="danger"
            onPress={() => void handleCancel()}
            disabled={cancelDisabled}
          />
        </Section>
      </>
    );
  }

  function renderAttend(current: Appointment): React.JSX.Element {
    const recordsMissing = recordsLoaded
      ? current.prepRecordIds.length - prepRecords.length
      : 0;
    return (
      <>
        {renderAssigneeNotice(current)}
        {renderDetails(current)}

        <Section title="Hospital Pocket View">
          {current.prepNotes ? (
            <Row label="Prep notes" value={current.prepNotes} />
          ) : (
            <Text style={styles.muted}>No prep notes.</Text>
          )}
          <Text style={styles.subheading}>Prep records</Text>
          {current.prepRecordIds.length === 0 ? (
            <Text style={styles.muted}>No prep records linked.</Text>
          ) : (
            prepRecords.map(record => (
              <View key={record.id} style={styles.recordRow}>
                <Text style={styles.recordTitle}>{record.title}</Text>
                <Text style={[styles.muted, tabularNums]}>{record.recordDate}</Text>
              </View>
            ))
          )}
          {recordsMissing > 0 ? (
            <Text style={styles.muted}>
              {`${recordsMissing} linked record(s) not found in this workspace.`}
            </Text>
          ) : null}
          <Row label="Assigned attendee" value={labelFor(current.assignedAttendeeId)} />
        </Section>

        <Section title="Reassign attendee">
          {attendeeOptions.length === 0 ? (
            <Text style={styles.muted}>No members available to assign.</Text>
          ) : (
            <View style={styles.chipWrap}>
              {attendeeOptions.map(option => (
                <Chip
                  key={option.id}
                  label={option.label}
                  selected={option.id === current.assignedAttendeeId}
                  disabled={!editable}
                  onPress={() => void handleReassign(option)}
                />
              ))}
            </View>
          )}
        </Section>

        <Section title="Post-visit wrap-up">
          <Text style={styles.fieldLabel}>Who attended the visit (required)</Text>
          <View style={styles.chipWrap}>
            {attendeeOptions.map(option => (
              <Chip
                key={option.id}
                label={option.label}
                selected={wrapUp.actualAttendedById === option.id}
                disabled={!canStartOrComplete || isAssignedToMe}
                onPress={() => patchWrapUp({ actualAttendedById: option.id })}
              />
            ))}
          </View>

          <Field
            label="Completion summary (optional)"
            value={wrapUp.completionSummary}
            onChangeText={text => patchWrapUp({ completionSummary: text })}
            editable={canStartOrComplete}
            multiline
          />
          <Field
            label="Final amount in ₹ (optional)"
            value={wrapUp.finalAmount}
            onChangeText={text => patchWrapUp({ finalAmount: text })}
            editable={canStartOrComplete}
            keyboardType="decimal-pad"
            placeholder="0.00"
          />
          <Text style={styles.fieldLabel}>Who paid the final amount (required when amount is above 0)</Text>
          <View style={styles.chipWrap}>
            <Chip
              label="None"
              selected={wrapUp.finalPaidById === ''}
              disabled={!canStartOrComplete}
              onPress={() => patchWrapUp({ finalPaidById: '' })}
            />
            {attendeeOptions.map(option => (
              <Chip
                key={option.id}
                label={option.label}
                selected={wrapUp.finalPaidById === option.id}
                disabled={!canStartOrComplete}
                onPress={() => patchWrapUp({ finalPaidById: option.id })}
              />
            ))}
          </View>

          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: wrapUp.createRecord, disabled: !canStartOrComplete }}
            disabled={!canStartOrComplete}
            onPress={() => patchWrapUp({ createRecord: !wrapUp.createRecord })}
            style={styles.checkboxRow}>
            <View style={[styles.checkbox, wrapUp.createRecord && styles.checkboxOn]}>
              <Text style={styles.checkboxMark}>{wrapUp.createRecord ? '✓' : ''}</Text>
            </View>
            <Text style={styles.checkboxLabel}>Save an appointment report record</Text>
          </Pressable>
          {wrapUp.createRecord ? (
            <View style={styles.nested}>
              <Field
                label="Record title"
                value={wrapUp.recordTitle}
                onChangeText={text => patchWrapUp({ recordTitle: text })}
                editable={canStartOrComplete}
              />
              <Text style={styles.fieldLabel}>Record type</Text>
              <View style={styles.chipWrap}>
                {RECORD_TYPES.map(type => (
                  <Chip
                    key={type}
                    label={RECORD_TYPE_LABEL[type]}
                    selected={wrapUp.recordType === type}
                    disabled={!canStartOrComplete}
                    onPress={() => patchWrapUp({ recordType: type })}
                  />
                ))}
              </View>
              <Field
                label="Facility name (optional)"
                value={wrapUp.recordFacility}
                onChangeText={text => patchWrapUp({ recordFacility: text })}
                editable={canStartOrComplete}
              />
              <Field
                label="Record date (YYYY-MM-DD)"
                value={wrapUp.recordDate}
                onChangeText={text => patchWrapUp({ recordDate: text })}
                editable={canStartOrComplete}
                placeholder="YYYY-MM-DD"
              />
            </View>
          ) : null}

          <Field
            label="Follow-up title (optional)"
            value={wrapUp.followUpTitle}
            onChangeText={text => patchWrapUp({ followUpTitle: text })}
            editable={canStartOrComplete}
          />
          <Field
            label="Follow-up due date (optional, YYYY-MM-DD)"
            value={wrapUp.followUpDueDate}
            onChangeText={text => patchWrapUp({ followUpDueDate: text })}
            editable={canStartOrComplete}
            placeholder="YYYY-MM-DD"
          />

          <ActionButton
            label="Complete visit"
            onPress={() => void handleComplete()}
            disabled={!canStartOrComplete}
          />
        </Section>
      </>
    );
  }

  function renderClosed(current: Appointment): React.JSX.Element {
    const isCancelled = current.status === 'CANCELLED';
    const isMissed = current.status === 'MISSED';
    const hasNotes = Boolean(current.visitNotes?.trim() || current.completionSummary?.trim());
    return (
      <>
        {renderDetails(current)}
        <Section title="Summary">
          {isCancelled ? (
            <Row label="Cancellation reason" value={current.cancellationReason ?? 'Not recorded'} />
          ) : isMissed ? (
            <Text style={styles.muted}>This appointment was marked as Missed / Didn't happen.</Text>
          ) : (
            <>
              <Row label="Attended by" value={labelFor(current.actualAttendedById)} />
              {current.completedByName ? (
                <Row label="Completed by" value={current.completedByName} />
              ) : null}
              {current.completedAt ? (
                <Row label="Completed at" value={formatAppointmentTime(current.completedAt)} tabular />
              ) : null}
              {current.lastEditedStamp ? (
                <Row label="Last updated" value={current.lastEditedStamp} />
              ) : null}
              <Row
                label="Visit notes"
                value={current.visitNotes ?? current.completionSummary ?? 'Not recorded'}
              />
              {!hasNotes && editable ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setEditingCompleted(true)}
                  style={styles.pillPrompt}
                >
                  <Text style={styles.pillPromptText}>Add visit notes later</Text>
                </Pressable>
              ) : null}
              <Row
                label="Final amount"
                value={current.finalAmount !== undefined ? formatRupees(current.finalAmount) : 'Not recorded'}
                tabular
              />
              <Row label="Paid by" value={labelFor(current.finalPaidById)} />
              {current.attachments && current.attachments.length > 0 ? (
                <Row label="Attachments" value={`${current.attachments.length} file(s)`} />
              ) : null}
            </>
          )}
        </Section>

        {current.status === 'COMPLETED' && editable ? (
          <Section title="Update completed visit">
            {editingCompleted ? (
              <>
                <Field
                  label="Visit notes"
                  value={extraNotes}
                  onChangeText={setExtraNotes}
                  editable={!busy}
                  multiline
                  placeholder="Add lab findings, doctor instructions, etc."
                />
                <Field
                  label="Attachment URL (optional)"
                  value={attachmentUrl}
                  onChangeText={setAttachmentUrl}
                  editable={!busy}
                  placeholder="https://... or file://..."
                />
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: followUpEnabled, disabled: busy }}
                  disabled={busy}
                  onPress={() => setFollowUpEnabled(prev => !prev)}
                  style={styles.checkboxRow}
                >
                  <View style={[styles.checkbox, followUpEnabled && styles.checkboxOn]}>
                    <Text style={styles.checkboxMark}>{followUpEnabled ? '✓' : ''}</Text>
                  </View>
                  <Text style={styles.checkboxLabel}>Schedule a follow-up visit</Text>
                </Pressable>
                {followUpEnabled ? (
                  <DateTimePickerField
                    label="Follow-up date and time"
                    value={followUpScheduledAt}
                    onChange={setFollowUpScheduledAt}
                    mode="datetime"
                  />
                ) : null}
                <ActionButton
                  label="Save extra notes"
                  onPress={() => void handleSaveCompletedExtras()}
                  disabled={busy}
                />
              </>
            ) : (
              <ActionButton
                label="View / Add Extra Notes"
                onPress={() => setEditingCompleted(true)}
                disabled={busy}
              />
            )}
            <View style={{ height: 8 }} />
            <ActionButton
              label="Revert to Scheduled (Undo)"
              tone="danger"
              onPress={() => void handleRevertToScheduled()}
              disabled={busy}
            />
          </Section>
        ) : null}

        {isMissed && editable ? (
          <Section title="Reopen visit">
            <ActionButton
              label="Revert to Scheduled"
              onPress={() => void handleRevertToScheduled()}
              disabled={busy}
            />
          </Section>
        ) : null}
      </>
    );
  }

  function renderBody(): React.JSX.Element | null {
    if (!appointment) return null;
    switch (appointment.status) {
      case 'SCHEDULED':
        return renderScheduled(appointment);
      case 'ATTEND':
        return renderAttend(appointment);
      case 'COMPLETED':
      case 'CANCELLED':
      case 'MISSED':
        return renderClosed(appointment);
      default:
        return null;
    }
  }

  const showPermissionNote =
    appointment !== null && (appointment.status === 'SCHEDULED' || appointment.status === 'ATTEND');

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.headerTitle}>{appointment?.hospitalName ?? 'Appointment'}</Text>
            {appointment ? (
              <Text
                style={[
                  styles.statusChip,
                  { color: APPOINTMENT_STATUS_COLOR[appointment.status] },
                ]}>
                {APPOINTMENT_STATUS_LABEL[appointment.status]}
              </Text>
            ) : null}
          </View>
          <Pressable accessibilityRole="button" onPress={onClose} style={styles.closeButton}>
            <Text style={styles.closeText}>Close</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {showPermissionNote && showReadOnlyNote ? (
            <Text style={styles.readOnlyNote}>{READ_ONLY_MESSAGE}</Text>
          ) : null}
          {conflictBanner ? (
            <View style={styles.section}>
              <Text style={styles.errorText}>{conflictBanner}</Text>
              {editable ? (
                <ActionButton
                  label="View / Add Extra Notes"
                  onPress={() => {
                    setConflictBanner(null);
                    setEditingCompleted(true);
                  }}
                  disabled={busy}
                />
              ) : null}
            </View>
          ) : null}
          {scheduleConflictNotice ? (
            <View style={styles.section}>
              <Text style={styles.errorText}>{scheduleConflictNotice}</Text>
              <ActionButton
                label="Discard Draft Notes"
                tone="danger"
                onPress={() => {
                  if (appointment) {
                    localStore.saveAppointmentDraftNotes(targetPatientId, appointment.id, '');
                  }
                  patchWrapUp({ completionSummary: '' });
                  setScheduleConflictNotice(null);
                  setOpenedScheduledAt(appointment?.scheduledAt ?? null);
                }}
                disabled={busy}
              />
            </View>
          ) : null}
          {permissionsLoading && showPermissionNote ? (
            <Text style={styles.muted}>Checking your permissions…</Text>
          ) : null}
          <InlineError message={error} />
          {renderBody()}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.canvas,
    paddingTop: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.card,
  },
  headerText: {
    flex: 1,
    paddingRight: 12,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  statusChip: {
    marginTop: 4,
    fontSize: 13,
    fontWeight: '600',
  },
  closeButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  closeText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.primary,
  },
  content: {
    padding: 16,
    paddingBottom: 48,
  },
  section: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: 10,
  },
  subheading: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    marginTop: 8,
    marginBottom: 4,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  rowLabel: {
    flex: 1,
    fontSize: 14,
    color: colors.textSecondary,
  },
  rowValue: {
    flex: 1.4,
    fontSize: 14,
    color: colors.textPrimary,
    textAlign: 'right',
  },
  muted: {
    fontSize: 14,
    color: colors.textSecondary,
    marginVertical: 2,
  },
  recordRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  recordTitle: {
    flex: 1,
    fontSize: 14,
    color: colors.textPrimary,
    paddingRight: 8,
  },
  readOnlyNote: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 12,
    marginBottom: 14,
  },
  field: {
    marginBottom: 10,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.textPrimary,
    backgroundColor: colors.card,
  },
  inputMultiline: {
    minHeight: 64,
    textAlignVertical: 'top',
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 10,
  },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginRight: 8,
    marginBottom: 8,
    backgroundColor: colors.card,
  },
  chipSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  chipText: {
    fontSize: 13,
    color: colors.textPrimary,
  },
  chipTextSelected: {
    color: colors.card,
    fontWeight: '600',
  },
  button: {
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonPrimary: {
    backgroundColor: colors.primary,
  },
  buttonDanger: {
    backgroundColor: colors.error,
  },
  buttonText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.card,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.textSecondary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
    backgroundColor: colors.card,
  },
  checkboxOn: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  checkboxMark: {
    color: colors.card,
    fontSize: 14,
    fontWeight: '700',
  },
  checkboxLabel: {
    flex: 1,
    fontSize: 14,
    color: colors.textPrimary,
  },
  nested: {
    borderLeftWidth: 2,
    borderLeftColor: colors.border,
    paddingLeft: 12,
    marginBottom: 10,
  },
  errorText: {
    fontSize: 14,
    color: colors.error,
    marginVertical: 6,
  },
  disabled: {
    opacity: 0.5,
  },
  pillPrompt: {
    alignSelf: 'flex-start',
    marginTop: 6,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: colors.amber,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: '#FFFBEB',
  },
  pillPromptText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.amber,
  },
});
