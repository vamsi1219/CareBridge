import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import ActivityFeedList from '../components/ActivityFeedList';
import { useAuth } from '../hooks/useAuth';
import { useActivePatient, useCareCircle } from '../hooks/useCareCircle';
import { usePermissions } from '../hooks/usePermissions';
import { completeAppointment, subscribeAppointments } from '../services/appointmentService';
import { subscribeMedicalBills } from '../services/billsService';
import { completeCareTask, subscribePendingTasks } from '../services/careTaskService';
import { loadSyntheticDemoData } from '../services/demoSeedService';
import { localStore } from '../services/localStore';
import { subscribePrescriptions } from '../services/prescriptionService';
import {
  formatDateTime,
  groupExpenseByPayer,
  monthRange,
  pickNextAppointment,
  summarizeMedications,
  type AppointmentLike,
  type BillLike,
  type PrescriptionItemLike,
} from '../services/dashboardSelectors';
import { colors, tabularNums } from '../theme/colors';
import type { CareTask } from '../types/carebridge';
import WorkspaceSetupScreen from './WorkspaceSetupScreen';

const TEAL = colors.primary;
const AMBER = colors.amber;
const INDIGO = '#4338CA';
const CORAL = '#EA580C';

interface AppointmentDoc extends AppointmentLike {
  hospitalName: string;
  doctorName?: string;
  visitType: string;
  assignedAttendeeId?: string;
}

interface PrescriptionDoc {
  status: 'ACTIVE' | 'DISCONTINUED';
  items: PrescriptionItemLike[];
}

interface BillDoc extends BillLike {
  prescriptionDate: string;
}

function formatRupees(amount: number): string {
  return `₹${amount.toFixed(2)}`;
}

function Card({
  title,
  accent,
  children,
}: {
  title: string;
  accent: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <View style={styles.card}>
      <Text style={[styles.cardTitle, { color: accent }]}>{title}</Text>
      {children}
    </View>
  );
}

function Loading(): React.JSX.Element {
  return (
    <View style={styles.center}>
      <ActivityIndicator color={colors.textSecondary} />
    </View>
  );
}

function Empty({ text }: { text: string }): React.JSX.Element {
  return <Text style={styles.emptyText}>{text}</Text>;
}

function Chip({ text, color }: { text: string; color: string }): React.JSX.Element {
  return (
    <View style={[styles.chip, { borderColor: color }]}>
      <Text style={[styles.chipText, { color }]}>{text}</Text>
    </View>
  );
}

export default function DashboardScreen(): React.JSX.Element {
  const { currentUser } = useAuth();
  const {
    patientId,
    startAddPatient,
    pendingInvitations,
    acceptPendingInvitation,
    loading: patientLoading,
    error: patientError,
  } = useActivePatient();
  const { capabilities } = usePermissions(patientId);
  const { accepted } = useCareCircle(patientId);

  const [appointments, setAppointments] = useState<AppointmentDoc[] | null>(null);
  const [prescriptions, setPrescriptions] = useState<PrescriptionDoc[] | null>(null);
  const [tasks, setTasks] = useState<CareTask[] | null>(null);
  const [bills, setBills] = useState<BillDoc[] | null>(null);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [taskError, setTaskError] = useState<string | null>(null);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [completingAppointmentId, setCompletingAppointmentId] = useState<string | null>(null);
  const [appointmentError, setAppointmentError] = useState<string | null>(null);
  const [seedingDemo, setSeedingDemo] = useState(false);
  const [seedError, setSeedError] = useState<string | null>(null);
  const [seedDone, setSeedDone] = useState(false);

  const canViewFinancials = capabilities.canViewFinancials;
  const canCompleteTasks = capabilities.canCompleteTasks;
  const canEdit = capabilities.canEdit;

  useEffect(() => {
    setAppointments(null);
    if (!patientId) return;
    return subscribeAppointments(patientId, list => {
      setAppointments(list);
    });
  }, [patientId]);

  useEffect(() => {
    setPrescriptions(null);
    if (!patientId) return;
    return subscribePrescriptions(patientId, list => {
      setPrescriptions(list.filter(p => p.status === 'ACTIVE'));
    });
  }, [patientId]);

  useEffect(() => {
    setTasks(null);
    if (!patientId) return;
    return subscribePendingTasks(patientId, setTasks);
  }, [patientId]);

  useEffect(() => {
    setBills(null);
    if (!patientId || !canViewFinancials) return;
    return subscribeMedicalBills(patientId, list => {
      const range = monthRange(new Date());
      setBills(
        list.filter(b => b.prescriptionDate >= range.start && b.prescriptionDate <= range.end),
      );
    });
  }, [patientId, canViewFinancials]);

  const nextAppointment = useMemo<AppointmentDoc | null>(() => {
    if (!appointments) return null;
    const picked = pickNextAppointment(appointments);
    return picked ? appointments.find(a => a.id === picked.id) ?? null : null;
  }, [appointments]);

  const medications = useMemo(
    () => summarizeMedications(prescriptions ?? []),
    [prescriptions],
  );

  const expense = useMemo(() => groupExpenseByPayer(bills ?? []), [bills]);

  function formatAttendeeName(attendeeId: string | undefined): string {
    if (!attendeeId) return 'Not assigned';
    if (currentUser && attendeeId === currentUser.id) {
      return `You (${currentUser.fullName})`;
    }
    const profile = localStore.getUserById(attendeeId);
    if (profile?.fullName) return profile.fullName;
    const member = accepted.find(m => m.userId === attendeeId);
    if (member) return member.invitedEmail || member.invitedPhone || attendeeId;
    return attendeeId;
  }

  async function handleCompleteNextAppointment(appointment: AppointmentDoc): Promise<void> {
    if (!patientId || !currentUser) return;
    setCompletingAppointmentId(appointment.id);
    setAppointmentError(null);
    try {
      await completeAppointment(
        patientId,
        appointment.id,
        { uid: currentUser.id, name: currentUser.fullName },
        { actualAttendedById: appointment.assignedAttendeeId || currentUser.id },
      );
    } catch (err) {
      setAppointmentError(
        err instanceof Error ? err.message : 'Could not complete the appointment.',
      );
    } finally {
      setCompletingAppointmentId(null);
    }
  }

  async function handleComplete(task: CareTask): Promise<void> {
    if (!patientId || !currentUser) return;
    setBusyTaskId(task.id);
    setTaskError(null);
    try {
      await completeCareTask(
        patientId,
        { id: task.id, title: task.title },
        { uid: currentUser.id, name: currentUser.fullName },
      );
    } catch (err) {
      setTaskError(err instanceof Error ? err.message : 'Could not complete the task.');
    } finally {
      setBusyTaskId(null);
    }
  }

  async function handleLoadDemoData(): Promise<void> {
    if (!patientId || !currentUser) return;
    setSeedingDemo(true);
    setSeedError(null);
    setSeedDone(false);
    try {
      await loadSyntheticDemoData(patientId, {
        uid: currentUser.id,
        name: currentUser.fullName,
      });
      setSeedDone(true);
    } catch (err) {
      setSeedError(err instanceof Error ? err.message : 'Could not load synthetic demo data.');
    } finally {
      setSeedingDemo(false);
    }
  }

  if (!patientId) {
    if (patientLoading) {
      return (
        <View style={styles.screen}>
          <Loading />
        </View>
      );
    }
    if (patientError) {
      return (
        <View style={styles.screen}>
          <View style={styles.card}>
            <Text style={styles.errorText}>{patientError}</Text>
          </View>
        </View>
      );
    }
    return <WorkspaceSetupScreen />;
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.rowBetween}>
        <Text style={styles.heading}>Dashboard</Text>
        <Pressable
          accessibilityRole="button"
          onPress={startAddPatient}
          style={styles.button}
        >
          <Text style={styles.buttonText}>+ Add Patient</Text>
        </Pressable>
      </View>

      {canEdit ? (
        <View style={styles.gap}>
          <Pressable
            accessibilityRole="button"
            disabled={seedingDemo}
            onPress={() => void handleLoadDemoData()}
            style={({ pressed }) => [
              styles.button,
              (pressed || seedingDemo) && styles.buttonDimmed,
            ]}
          >
            <Text style={styles.buttonText}>
              {seedingDemo ? 'Loading…' : 'Load Synthetic Demo Data'}
            </Text>
          </Pressable>
          {seedError ? <Text style={styles.seedErrorText}>{seedError}</Text> : null}
          {seedDone && !seedError ? (
            <Text style={styles.secondaryText}>Synthetic demo data loaded.</Text>
          ) : null}
        </View>
      ) : null}

      {pendingInvitations.length > 0 ? (
        <Card title="Pending care circle invitations" accent={TEAL}>
          <View style={styles.gap}>
            {pendingInvitations.map(inv => (
              <View key={inv.member.id} style={styles.itemRow}>
                <Text style={styles.primaryText}>
                  {inv.patient?.fullName ?? 'Family Care Circle'}
                  {inv.patient?.relationshipLabel ? ` (${inv.patient.relationshipLabel})` : ''}
                </Text>
                <Text style={styles.secondaryText}>Role: {inv.member.rolePreset}</Text>
                <Pressable
                  accessibilityRole="button"
                  disabled={acceptingId === inv.member.id}
                  onPress={async () => {
                    setAcceptingId(inv.member.id);
                    try {
                      await acceptPendingInvitation(inv.member.patientId, inv.member.id);
                    } finally {
                      setAcceptingId(null);
                    }
                  }}
                  style={({ pressed }) => [
                    styles.button,
                    (pressed || acceptingId === inv.member.id) && styles.buttonDimmed,
                  ]}
                >
                  <Text style={styles.buttonText}>
                    {acceptingId === inv.member.id ? 'Accepting…' : 'Accept Invitation'}
                  </Text>
                </Pressable>
              </View>
            ))}
          </View>
        </Card>
      ) : null}

      <Card title="Next appointment" accent={TEAL}>
        {appointments === null ? (
          <Loading />
        ) : nextAppointment === null ? (
          <Empty text="No upcoming appointment." />
        ) : (
          <View style={styles.gap}>
            {appointmentError ? <Text style={styles.errorText}>{appointmentError}</Text> : null}
            <Text style={styles.primaryText}>{nextAppointment.hospitalName}</Text>
            {nextAppointment.doctorName ? (
              <Text style={styles.secondaryText}>{nextAppointment.doctorName}</Text>
            ) : null}
            <Text style={[styles.secondaryText, tabularNums]}>
              {formatDateTime(nextAppointment.scheduledAt)}
            </Text>
            <View style={styles.row}>
              <Chip text={nextAppointment.status} color={TEAL} />
              <Text style={styles.secondaryText}>
                Attendee: {formatAttendeeName(nextAppointment.assignedAttendeeId)}
              </Text>
            </View>
            {nextAppointment.assignedAttendeeId &&
            currentUser &&
            nextAppointment.assignedAttendeeId !== currentUser.id ? (
              <Text style={styles.refillText}>
                {`Assigned to ${formatAttendeeName(nextAppointment.assignedAttendeeId)} to mark completed`}
              </Text>
            ) : null}
            {currentUser &&
            (nextAppointment.assignedAttendeeId === currentUser.id ||
              (!nextAppointment.assignedAttendeeId && canEdit)) ? (
              <Pressable
                accessibilityRole="button"
                disabled={completingAppointmentId === nextAppointment.id}
                onPress={() => void handleCompleteNextAppointment(nextAppointment)}
                style={({ pressed }) => [
                  styles.button,
                  (pressed || completingAppointmentId === nextAppointment.id) && styles.buttonDimmed,
                ]}
              >
                <Text style={styles.buttonText}>
                  {completingAppointmentId === nextAppointment.id
                    ? 'Completing…'
                    : 'Mark as Completed'}
                </Text>
              </Pressable>
            ) : null}
          </View>
        )}
      </Card>

      <Card title="Active medications & refills" accent={TEAL}>
        {prescriptions === null ? (
          <Loading />
        ) : medications.rows.length === 0 ? (
          <Empty text="No active medications." />
        ) : (
          <View style={styles.gap}>
            <Text style={styles.secondaryText}>
              Total daily tablets:{' '}
              <Text style={[styles.primaryText, tabularNums]}>{medications.totalDailyTablets}</Text>
            </Text>
            {medications.rows.map(row => {
              const color = row.isLowStock ? AMBER : colors.textPrimary;
              return (
                <View key={row.itemId} style={styles.itemRow}>
                  <Text style={[styles.primaryText, { color }]}>{row.medicineName}</Text>
                  <Text style={styles.secondaryText}>
                    {row.timingSlot} · {row.administeredByLabel}
                  </Text>
                  {row.isLowStock ? (
                    <Text style={[styles.refillText, tabularNums]}>
                      Refill due: {row.remainingTablets} tablets left
                    </Text>
                  ) : null}
                </View>
              );
            })}
          </View>
        )}
      </Card>

      <Card title="Pending tasks & refill reminders" accent={TEAL}>
        {tasks === null ? (
          <Loading />
        ) : tasks.length === 0 ? (
          <Empty text="No pending tasks." />
        ) : (
          <View style={styles.gap}>
            {taskError ? <Text style={styles.errorText}>{taskError}</Text> : null}
            {tasks.map(task => (
              <View key={task.id} style={styles.itemRow}>
                <Text style={styles.primaryText}>{task.title}</Text>
                <Text style={styles.secondaryText}>
                  Assignee: {task.assignedToUserId ?? task.assignedInviteEmail ?? 'Unassigned'}
                </Text>
                <Text style={[styles.secondaryText, tabularNums]}>
                  Due: {task.dueDate ? formatDateTime(task.dueDate) : 'No due date'}
                </Text>
                {canCompleteTasks ? (
                  <Pressable
                    onPress={() => void handleComplete(task)}
                    disabled={busyTaskId === task.id}
                    style={({ pressed }) => [
                      styles.button,
                      (pressed || busyTaskId === task.id) && styles.buttonDimmed,
                    ]}
                  >
                    <Text style={styles.buttonText}>
                      {busyTaskId === task.id ? 'Completing…' : 'Mark complete'}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            ))}
          </View>
        )}
      </Card>

      <Text style={styles.sectionTitle}>Recent activity</Text>
      <ActivityFeedList patientId={patientId} />

      {canViewFinancials ? (
        <Card title="Sibling expense split" accent={INDIGO}>
          {bills === null ? (
            <Loading />
          ) : bills.length === 0 ? (
            <Empty text="No bills recorded this month." />
          ) : (
            <View style={styles.gap}>
              <Text style={styles.secondaryText}>This month's total</Text>
              <Text style={[styles.totalText, tabularNums]}>{formatRupees(expense.total)}</Text>
              {expense.byPayer.map((payer, index) => {
                const share = expense.total > 0 ? (payer.amount / expense.total) * 100 : 0;
                const barColor = index === 0 ? INDIGO : CORAL;
                return (
                  <View key={payer.payerId} style={styles.itemRow}>
                    <View style={styles.row}>
                      <Text style={[styles.primaryText, styles.flexOne]}>
                        {formatAttendeeName(payer.payerId)}
                      </Text>
                      <Text style={[styles.primaryText, tabularNums]}>
                        {formatRupees(payer.amount)}
                      </Text>
                      <Text style={[styles.secondaryText, tabularNums]}>
                        {Math.round(share)}%
                      </Text>
                    </View>
                    <View style={styles.barTrack}>
                      <View
                        style={[
                          styles.barFill,
                          { width: `${Math.min(100, Math.max(0, share))}%`, backgroundColor: barColor },
                        ]}
                      />
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </Card>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.canvas,
  },
  content: {
    padding: 16,
    gap: 16,
  },
  heading: {
    color: colors.textPrimary,
    fontSize: 26,
    fontWeight: '700',
  },
  sectionTitle: {
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: '700',
  },
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 16,
    gap: 10,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  gap: {
    gap: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  flexOne: {
    flex: 1,
  },
  center: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryText: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryText: {
    color: colors.textSecondary,
    fontSize: 14,
  },
  totalText: {
    color: INDIGO,
    fontSize: 26,
    fontWeight: '700',
  },
  refillText: {
    color: AMBER,
    fontSize: 14,
    fontWeight: '600',
  },
  emptyText: {
    color: colors.textSecondary,
    fontSize: 14,
  },
  errorText: {
    color: colors.error,
    fontSize: 14,
  },
  seedErrorText: {
    color: '#B91C1C',
    fontSize: 14,
  },
  itemRow: {
    paddingVertical: 8,
    gap: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  button: {
    alignSelf: 'flex-start',
    marginTop: 4,
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  buttonDimmed: {
    opacity: 0.6,
  },
  buttonText: {
    color: colors.card,
    fontSize: 13,
    fontWeight: '600',
  },
  barTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.border,
    overflow: 'hidden',
    marginTop: 6,
  },
  barFill: {
    height: 8,
  },
});
