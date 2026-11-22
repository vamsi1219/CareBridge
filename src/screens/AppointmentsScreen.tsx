import React, { useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type KeyboardTypeOptions,
} from 'react-native';
import AppointmentPhaseModal, {
  APPOINTMENT_STATUS_COLOR,
  APPOINTMENT_STATUS_LABEL,
  VISIT_TYPE_LABEL,
  formatAppointmentTime,
  type AttendeeOption,
} from '../components/AppointmentPhaseModal';
import DateTimePickerField from '../components/DateTimePickerField';
import { useActivePatient, useCareCircle } from '../hooks/useCareCircle';
import { useAuth } from '../hooks/useAuth';
import { usePermissions } from '../hooks/usePermissions';
import {
  completeAppointment,
  createAppointment,
  markAppointmentMissed,
  revertAppointmentToScheduled,
  subscribeAppointments,
  type CreateAppointmentInput,
} from '../services/appointmentService';
import type { Actor } from '../services/careCircleService';
import { localStore } from '../services/localStore';
import { colors, tabularNums } from '../theme/colors';
import type { Appointment, VisitType } from '../types/carebridge';

const READ_ONLY_MESSAGE = 'Read-only role — changes are disabled.';
const SCHEDULED_AT_PATTERN =
  /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d$/;
const NO_ATTENDEES: AttendeeOption[] = [];

interface NewAppointmentForm {
  hospitalName: string;
  doctorName: string;
  specialty: string;
  visitType: VisitType;
  /** Local date-time as YYYY-MM-DDTHH:mm */
  scheduledAt: string;
  bookedByUserId: string;
  assignedAttendeeId: string;
  bookingPaidById: string;
  bookingAmount: string;
  prepNotes: string;
}

type FormField = 'hospitalName' | 'scheduledAt' | 'bookedByUserId' | 'bookingAmount';
type FormErrors = Partial<Record<FormField, string>>;

function emptyForm(defaultBookedById: string): NewAppointmentForm {
  return {
    hospitalName: '',
    doctorName: '',
    specialty: '',
    visitType: 'IN_PERSON',
    scheduledAt: '',
    bookedByUserId: defaultBookedById,
    assignedAttendeeId: '',
    bookingPaidById: '',
    bookingAmount: '',
    prepNotes: '',
  };
}

function validateForm(form: NewAppointmentForm): FormErrors {
  const errors: FormErrors = {};
  if (!form.hospitalName.trim()) {
    errors.hospitalName = 'Hospital name is required.';
  }
  const scheduled = form.scheduledAt.trim();
  if (!SCHEDULED_AT_PATTERN.test(scheduled) || Number.isNaN(Date.parse(scheduled))) {
    errors.scheduledAt = 'Use YYYY-MM-DDTHH:mm, for example 2025-03-14T09:30.';
  }
  if (!form.bookedByUserId) {
    errors.bookedByUserId = 'Choose who booked the visit.';
  }
  const amountText = form.bookingAmount.trim();
  if (amountText !== '') {
    const amount = Number(amountText);
    if (!Number.isFinite(amount) || amount < 0) {
      errors.bookingAmount = 'Booking amount must be a number, 0 or more.';
    }
  }
  return errors;
}

function timeOf(appointment: Appointment): number {
  const time = Date.parse(appointment.scheduledAt);
  return Number.isNaN(time) ? 0 : time;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong. Please try again.';
}

interface FieldProps {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  editable: boolean;
  error?: string;
  placeholder?: string;
  keyboardType?: KeyboardTypeOptions;
  multiline?: boolean;
}

function Field({
  label,
  value,
  onChangeText,
  editable,
  error,
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
        style={[styles.input, multiline && styles.inputMultiline, !editable && styles.disabled]}
      />
      {error ? (
        <Text accessibilityRole="alert" style={styles.fieldError}>
          {error}
        </Text>
      ) : null}
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

interface AppointmentRowProps {
  appointment: Appointment;
  attendeeLabel: string;
  isAssignedToMe: boolean;
  isAssignedToOther: boolean;
  canQuickComplete: boolean;
  canEditActions: boolean;
  completing: boolean;
  onQuickComplete: () => void;
  onMarkMissed?: () => void;
  onPress: () => void;
}

function AppointmentRow({
  appointment,
  attendeeLabel,
  isAssignedToMe,
  isAssignedToOther,
  canQuickComplete,
  canEditActions,
  completing,
  onQuickComplete,
  onMarkMissed,
  onPress,
}: AppointmentRowProps): React.JSX.Element {
  const isOpen = appointment.status === 'SCHEDULED' || appointment.status === 'ATTEND';
  const isCompletedMissingNotes =
    appointment.status === 'COMPLETED' &&
    !appointment.visitNotes?.trim() &&
    !appointment.completionSummary?.trim();
  const isSyncing = appointment.syncStatus === 'PENDING';
  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${appointment.hospitalName}, ${APPOINTMENT_STATUS_LABEL[appointment.status]}`}
        onPress={onPress}>
        <View style={styles.rowTop}>
          <Text style={styles.rowTitle}>{appointment.hospitalName}</Text>
          <View style={styles.chipCluster}>
            {isSyncing ? <Text style={styles.syncBadge}>Syncing...</Text> : null}
            <Text style={[styles.statusChip, { color: APPOINTMENT_STATUS_COLOR[appointment.status] }]}>
              {APPOINTMENT_STATUS_LABEL[appointment.status]}
            </Text>
          </View>
        </View>
        <Text style={styles.rowMeta}>{appointment.doctorName ?? 'Doctor not set'}</Text>
        <Text style={styles.rowMeta}>{VISIT_TYPE_LABEL[appointment.visitType]}</Text>
        <Text style={[styles.rowMeta, tabularNums]}>{formatAppointmentTime(appointment.scheduledAt)}</Text>
        <Text style={styles.rowMeta}>
          {isAssignedToMe ? `Attendee: You (${attendeeLabel})` : `Attendee: ${attendeeLabel}`}
        </Text>
        {isOpen && isAssignedToOther ? (
          <Text style={styles.assigneeNote}>
            {`Assigned to ${attendeeLabel} — must be marked completed by ${attendeeLabel}`}
          </Text>
        ) : null}
        {isCompletedMissingNotes && canEditActions ? (
          <View style={styles.notesLaterPill}>
            <Text style={styles.notesLaterText}>Add visit notes later</Text>
          </View>
        ) : null}
      </Pressable>
      {isOpen && (canQuickComplete || (onMarkMissed && canEditActions)) ? (
        <View style={styles.inlineActionRow}>
          {canQuickComplete ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: completing }}
              disabled={completing}
              onPress={onQuickComplete}
              style={[styles.completeInlineButton, completing && styles.disabled]}>
              <Text style={styles.completeInlineButtonText}>
                {completing ? 'Completing…' : 'Mark as Completed'}
              </Text>
            </Pressable>
          ) : null}
          {onMarkMissed && canEditActions ? (
            <>
              <Pressable
                accessibilityRole="button"
                onPress={onPress}
                style={styles.secondaryInlineButton}>
                <Text style={styles.secondaryInlineButtonText}>Reschedule</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={onMarkMissed}
                style={styles.dangerInlineButton}>
                <Text style={styles.dangerInlineButtonText}>Missed</Text>
              </Pressable>
            </>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export default function AppointmentsScreen(): React.JSX.Element {
  const { currentUser } = useAuth();
  const { patientId, loading: workspaceLoading, error: workspaceError } = useActivePatient();
  const { capabilities, loading: permissionsLoading } = usePermissions(patientId);
  const { accepted } = useCareCircle(patientId);

  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState<boolean>(false);
  const [form, setForm] = useState<NewAppointmentForm>(() => emptyForm(currentUser?.id ?? ''));
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [undoBanner, setUndoBanner] = useState<{
    patientId: string;
    appointmentId: string;
    hospitalName: string;
  } | null>(null);

  const attendeeOptions = useMemo<AttendeeOption[]>(() => {
    const fromMembers: AttendeeOption[] = [];
    for (const member of accepted) {
      if (!member.userId) continue;
      const profile = localStore.getUserById(member.userId);
      const label =
        currentUser && member.userId === currentUser.id
          ? currentUser.fullName
          : profile?.fullName || member.invitedEmail || member.invitedPhone || member.userId;
      fromMembers.push({ id: member.userId, label });
    }
    if (fromMembers.length > 0) return fromMembers;
    if (currentUser) return [{ id: currentUser.id, label: currentUser.fullName }];
    return NO_ATTENDEES;
  }, [accepted, currentUser]);

  useEffect(() => {
    if (!patientId) {
      setAppointments([]);
      return undefined;
    }
    return subscribeAppointments(patientId, setAppointments);
  }, [patientId]);

  const { needsUpdate, upcoming, past } = useMemo(() => {
    const nowMs = Date.now();
    const open = appointments.filter(a => a.status === 'SCHEDULED' || a.status === 'ATTEND');
    const overdueList = open
      .filter(a => timeOf(a) > 0 && timeOf(a) < nowMs)
      .sort((a, b) => timeOf(a) - timeOf(b));
    const upcomingList = open
      .filter(a => timeOf(a) === 0 || timeOf(a) >= nowMs)
      .sort((a, b) => timeOf(a) - timeOf(b));
    const pastList = appointments
      .filter(a => a.status === 'COMPLETED' || a.status === 'CANCELLED' || a.status === 'MISSED')
      .sort((a, b) => timeOf(b) - timeOf(a));
    return { needsUpdate: overdueList, upcoming: upcomingList, past: pastList };
  }, [appointments]);

  const isScheduledInPast = useMemo(() => {
    if (!form.scheduledAt) return false;
    const ms = Date.parse(form.scheduledAt);
    return !Number.isNaN(ms) && ms < Date.now();
  }, [form.scheduledAt]);

  const selected = useMemo<Appointment | null>(
    () => appointments.find(a => a.id === selectedId) ?? null,
    [appointments, selectedId],
  );

  const actor: Actor | null = currentUser ? { uid: currentUser.id, name: currentUser.fullName } : null;
  const canEdit = capabilities.canEdit && !permissionsLoading;
  const showReadOnlyNote = !permissionsLoading && !capabilities.canEdit && patientId !== null;

  function attendeeLabel(id: string | undefined): string {
    if (!id) return 'Not assigned';
    return (
      attendeeOptions.find(option => option.id === id)?.label ??
      localStore.getUserById(id)?.fullName ??
      'Unknown member'
    );
  }

  async function handleQuickComplete(appointment: Appointment): Promise<void> {
    const targetPatientId = appointment.patientId || patientId;
    if (!targetPatientId || !actor) return;
    setCompletingId(appointment.id);
    setActionError(null);
    try {
      await completeAppointment(targetPatientId, appointment.id, actor, {
        actualAttendedById: appointment.assignedAttendeeId || actor.uid,
        expectedVersion: appointment.version ?? 1,
        clientMutationId: `mut_${appointment.id}_${Date.now()}`,
      });
      setUndoBanner({
        patientId: targetPatientId,
        appointmentId: appointment.id,
        hospitalName: appointment.hospitalName,
      });
      setTimeout(() => {
        setUndoBanner(prev => (prev?.appointmentId === appointment.id ? null : prev));
      }, 6000);
    } catch (err: unknown) {
      setActionError(errorMessage(err));
    } finally {
      setCompletingId(null);
    }
  }

  async function handleUndoComplete(): Promise<void> {
    if (!undoBanner || !actor) return;
    const target = undoBanner;
    setUndoBanner(null);
    try {
      await revertAppointmentToScheduled(target.patientId, target.appointmentId, actor);
    } catch (err: unknown) {
      setActionError(errorMessage(err));
    }
  }

  async function handleQuickMissed(appointment: Appointment): Promise<void> {
    const targetPatientId = appointment.patientId || patientId;
    if (!targetPatientId || !actor) return;
    setActionError(null);
    try {
      await markAppointmentMissed(
        targetPatientId,
        appointment.id,
        actor,
        appointment.version ?? 1,
      );
    } catch (err: unknown) {
      setActionError(errorMessage(err));
    }
  }

  function patchForm(patch: Partial<NewAppointmentForm>): void {
    setForm(prev => ({ ...prev, ...patch }));
    const keys = Object.keys(patch) as FormField[];
    setFormErrors(prev => {
      const next = { ...prev };
      for (const key of keys) delete next[key];
      return next;
    });
  }

  function openForm(): void {
    setForm(emptyForm(currentUser?.id ?? ''));
    setFormErrors({});
    setSubmitError(null);
    setFormOpen(true);
  }

  async function handleCreate(): Promise<void> {
    if (!patientId || !actor) {
      setSubmitError('You must be signed in to add an appointment.');
      return;
    }
    const errors = validateForm(form);
    setFormErrors(errors);
    if (Object.keys(errors).length > 0) return;

    const amountText = form.bookingAmount.trim();
    const input: CreateAppointmentInput = {
      hospitalName: form.hospitalName.trim(),
      doctorName: form.doctorName.trim() || undefined,
      specialty: form.specialty.trim() || undefined,
      visitType: form.visitType,
      scheduledAt: form.scheduledAt.trim(),
      bookedByUserId: form.bookedByUserId,
      assignedAttendeeId: form.assignedAttendeeId || undefined,
      bookingPaidById: form.bookingPaidById || undefined,
      bookingAmount: amountText === '' ? undefined : Number(amountText),
      prepNotes: form.prepNotes.trim() || undefined,
      prepRecordIds: [],
    };

    setSubmitting(true);
    setSubmitError(null);
    try {
      await createAppointment(patientId, actor, input);
      setFormOpen(false);
      setForm(emptyForm(currentUser?.id ?? ''));
    } catch (err: unknown) {
      setSubmitError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (!patientId) {
    return (
      <View style={styles.container}>
        <Text style={styles.muted}>
          {workspaceError ?? (workspaceLoading ? 'Loading your workspace…' : 'No patient workspace yet.')}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.screenTitle}>Appointments</Text>

        {showReadOnlyNote ? <Text style={styles.readOnlyNote}>{READ_ONLY_MESSAGE}</Text> : null}

        {canEdit && !formOpen ? (
          <Pressable accessibilityRole="button" onPress={openForm} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>New appointment</Text>
          </Pressable>
        ) : null}

        {canEdit && formOpen ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>New appointment</Text>
            <Field
              label="Hospital name (required)"
              value={form.hospitalName}
              onChangeText={text => patchForm({ hospitalName: text })}
              editable={!submitting}
              error={formErrors.hospitalName}
            />
            <Field
              label="Doctor name (optional)"
              value={form.doctorName}
              onChangeText={text => patchForm({ doctorName: text })}
              editable={!submitting}
            />
            <Field
              label="Specialty (optional)"
              value={form.specialty}
              onChangeText={text => patchForm({ specialty: text })}
              editable={!submitting}
            />

            <Text style={styles.fieldLabel}>Visit type</Text>
            <View style={styles.chipWrap}>
              {(Object.keys(VISIT_TYPE_LABEL) as VisitType[]).map(type => (
                <Chip
                  key={type}
                  label={VISIT_TYPE_LABEL[type]}
                  selected={form.visitType === type}
                  disabled={submitting}
                  onPress={() => patchForm({ visitType: type })}
                />
              ))}
            </View>

            <DateTimePickerField
              label="Date and time"
              value={form.scheduledAt}
              onChange={next => patchForm({ scheduledAt: next })}
              error={formErrors.scheduledAt}
              mode="datetime"
            />
            {isScheduledInPast ? (
              <Text style={styles.pastWarning}>
                Selected time is in the past — logging as a retrospective / walk-in visit.
              </Text>
            ) : null}

            <Text style={styles.fieldLabel}>Booked by (required)</Text>
            <View style={styles.chipWrap}>
              {attendeeOptions.map(option => (
                <Chip
                  key={option.id}
                  label={option.label}
                  selected={form.bookedByUserId === option.id}
                  disabled={submitting}
                  onPress={() => patchForm({ bookedByUserId: option.id })}
                />
              ))}
            </View>
            {formErrors.bookedByUserId ? (
              <Text accessibilityRole="alert" style={styles.fieldError}>
                {formErrors.bookedByUserId}
              </Text>
            ) : null}

            <Text style={styles.fieldLabel}>Assigned attendee (optional)</Text>
            <View style={styles.chipWrap}>
              <Chip
                label="None"
                selected={form.assignedAttendeeId === ''}
                disabled={submitting}
                onPress={() => patchForm({ assignedAttendeeId: '' })}
              />
              {attendeeOptions.map(option => (
                <Chip
                  key={option.id}
                  label={option.label}
                  selected={form.assignedAttendeeId === option.id}
                  disabled={submitting}
                  onPress={() => patchForm({ assignedAttendeeId: option.id })}
                />
              ))}
            </View>

            <Text style={styles.fieldLabel}>Booking paid by (optional)</Text>
            <View style={styles.chipWrap}>
              <Chip
                label="None"
                selected={form.bookingPaidById === ''}
                disabled={submitting}
                onPress={() => patchForm({ bookingPaidById: '' })}
              />
              {attendeeOptions.map(option => (
                <Chip
                  key={option.id}
                  label={option.label}
                  selected={form.bookingPaidById === option.id}
                  disabled={submitting}
                  onPress={() => patchForm({ bookingPaidById: option.id })}
                />
              ))}
            </View>

            <Field
              label="Booking amount in ₹ (optional)"
              value={form.bookingAmount}
              onChangeText={text => patchForm({ bookingAmount: text })}
              editable={!submitting}
              error={formErrors.bookingAmount}
              keyboardType="decimal-pad"
              placeholder="0.00"
            />
            <Field
              label="Prep notes (optional)"
              value={form.prepNotes}
              onChangeText={text => patchForm({ prepNotes: text })}
              editable={!submitting}
              multiline
            />

            {submitError ? (
              <Text accessibilityRole="alert" style={styles.errorText}>
                {submitError}
              </Text>
            ) : null}

            <View style={styles.formActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: submitting }}
                disabled={submitting}
                onPress={() => void handleCreate()}
                style={[styles.primaryButton, styles.formButton, submitting && styles.disabled]}>
                <Text style={styles.primaryButtonText}>Save appointment</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: submitting }}
                disabled={submitting}
                onPress={() => setFormOpen(false)}
                style={[styles.secondaryButton, styles.formButton, submitting && styles.disabled]}>
                <Text style={styles.secondaryButtonText}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {undoBanner ? (
          <View style={styles.undoBanner}>
            <Text style={styles.undoText}>
              {`Marked ${undoBanner.hospitalName} as Completed.`}
            </Text>
            {canEdit ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => void handleUndoComplete()}
                style={styles.undoButton}>
                <Text style={styles.undoButtonText}>Undo</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {needsUpdate.length > 0 ? (
          <View style={[styles.section, styles.needsUpdateSection]}>
            <Text style={styles.needsUpdateTitle}>Needs Update</Text>
            {needsUpdate.map(appointment => {
              const isAssigned = Boolean(appointment.assignedAttendeeId);
              const isAssignedToMe = Boolean(
                appointment.assignedAttendeeId &&
                  currentUser &&
                  appointment.assignedAttendeeId === currentUser.id,
              );
              const isAssignedToOther = Boolean(isAssigned && !isAssignedToMe);
              const canQuickComplete =
                actor !== null && (isAssignedToMe || (!isAssigned && canEdit));
              return (
                <AppointmentRow
                  key={appointment.id}
                  appointment={appointment}
                  attendeeLabel={attendeeLabel(appointment.assignedAttendeeId)}
                  isAssignedToMe={isAssignedToMe}
                  isAssignedToOther={isAssignedToOther}
                  canQuickComplete={canQuickComplete}
                  canEditActions={canEdit}
                  completing={completingId === appointment.id}
                  onQuickComplete={() => void handleQuickComplete(appointment)}
                  onMarkMissed={() => void handleQuickMissed(appointment)}
                  onPress={() => setSelectedId(appointment.id)}
                />
              );
            })}
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Upcoming</Text>
          {actionError ? (
            <Text accessibilityRole="alert" style={styles.errorText}>
              {actionError}
            </Text>
          ) : null}
          {upcoming.length === 0 ? (
            <Text style={styles.muted}>No upcoming visits.</Text>
          ) : (
            upcoming.map(appointment => {
              const isAssigned = Boolean(appointment.assignedAttendeeId);
              const isAssignedToMe = Boolean(
                appointment.assignedAttendeeId &&
                  currentUser &&
                  appointment.assignedAttendeeId === currentUser.id,
              );
              const isAssignedToOther = Boolean(isAssigned && !isAssignedToMe);
              const canQuickComplete =
                actor !== null && (isAssignedToMe || (!isAssigned && canEdit));
              return (
                <AppointmentRow
                  key={appointment.id}
                  appointment={appointment}
                  attendeeLabel={attendeeLabel(appointment.assignedAttendeeId)}
                  isAssignedToMe={isAssignedToMe}
                  isAssignedToOther={isAssignedToOther}
                  canQuickComplete={canQuickComplete}
                  canEditActions={canEdit}
                  completing={completingId === appointment.id}
                  onQuickComplete={() => void handleQuickComplete(appointment)}
                  onPress={() => setSelectedId(appointment.id)}
                />
              );
            })
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Past</Text>
          {past.length === 0 ? (
            <Text style={styles.muted}>No past visits.</Text>
          ) : (
            past.map(appointment => (
              <AppointmentRow
                key={appointment.id}
                appointment={appointment}
                attendeeLabel={attendeeLabel(appointment.assignedAttendeeId)}
                isAssignedToMe={Boolean(
                  appointment.assignedAttendeeId &&
                    currentUser &&
                    appointment.assignedAttendeeId === currentUser.id,
                )}
                isAssignedToOther={false}
                canQuickComplete={false}
                canEditActions={canEdit}
                completing={false}
                onQuickComplete={() => {}}
                onPress={() => setSelectedId(appointment.id)}
              />
            ))
          )}
        </View>
      </ScrollView>

      <AppointmentPhaseModal
        visible={selected !== null}
        appointment={selected}
        patientId={patientId}
        onClose={() => setSelectedId(null)}
        attendeeOptions={attendeeOptions}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.canvas,
  },
  content: {
    padding: 16,
    paddingBottom: 48,
  },
  screenTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: 12,
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
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: 10,
  },
  row: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingVertical: 10,
  },
  rowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  rowTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
    paddingRight: 8,
  },
  statusChip: {
    fontSize: 12,
    fontWeight: '700',
  },
  rowMeta: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },
  assigneeNote: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.amber,
    marginTop: 4,
  },
  completeInlineButton: {
    alignSelf: 'flex-start',
    marginTop: 8,
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  completeInlineButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.card,
  },
  muted: {
    fontSize: 14,
    color: colors.textSecondary,
    paddingVertical: 6,
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
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 14,
  },
  primaryButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.card,
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: colors.card,
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  formActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  formButton: {
    flex: 1,
    marginBottom: 0,
    marginHorizontal: 4,
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
  fieldError: {
    fontSize: 13,
    color: colors.error,
    marginTop: 4,
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
  errorText: {
    fontSize: 14,
    color: colors.error,
    marginVertical: 6,
  },
  disabled: {
    opacity: 0.5,
  },
  chipCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  syncBadge: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.amber,
  },
  notesLaterPill: {
    alignSelf: 'flex-start',
    marginTop: 6,
    borderWidth: 1,
    borderColor: colors.amber,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    backgroundColor: '#FFFBEB',
  },
  notesLaterText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.amber,
  },
  inlineActionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  secondaryInlineButton: {
    alignSelf: 'flex-start',
    marginTop: 8,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: colors.card,
  },
  secondaryInlineButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.primary,
  },
  dangerInlineButton: {
    alignSelf: 'flex-start',
    marginTop: 8,
    borderWidth: 1,
    borderColor: colors.error,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: colors.card,
  },
  dangerInlineButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.error,
  },
  needsUpdateSection: {
    borderColor: colors.amber,
  },
  needsUpdateTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.amber,
    marginBottom: 10,
  },
  pastWarning: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.amber,
    marginTop: -4,
    marginBottom: 8,
  },
  undoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.textPrimary,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 12,
  },
  undoText: {
    flex: 1,
    color: colors.card,
    fontSize: 13,
    fontWeight: '600',
  },
  undoButton: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: colors.primary,
  },
  undoButtonText: {
    color: colors.card,
    fontSize: 13,
    fontWeight: '700',
  },
});
