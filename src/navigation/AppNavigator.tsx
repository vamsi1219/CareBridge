import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../hooks/useAuth';
import { useActivePatient } from '../hooks/useCareCircle';
import AppointmentsScreen from '../screens/AppointmentsScreen';
import BillsLedgerScreen from '../screens/BillsLedgerScreen';
import CareCirclePermissionsScreen from '../screens/CareCirclePermissionsScreen';
import DashboardScreen from '../screens/DashboardScreen';
import LoginScreen from '../screens/LoginScreen';
import PrescriptionsScreen from '../screens/PrescriptionsScreen';
import RecordsTimelineScreen from '../screens/RecordsTimelineScreen';
import RegisterScreen from '../screens/RegisterScreen';
import TasksActivityScreen from '../screens/TasksActivityScreen';
import WorkspaceSetupScreen from '../screens/WorkspaceSetupScreen';
import { colors } from '../theme/colors';

type Screen = 'login' | 'register';
type Tab =
  | 'dashboard'
  | 'circle'
  | 'appointments'
  | 'records'
  | 'prescriptions'
  | 'bills'
  | 'tasks';

export default function AppNavigator() {
  const { currentUser, loading, logout } = useAuth();
  const {
    patientId,
    patients,
    selectPatient,
    isAddingPatient,
    startAddPatient,
    pendingInvitations,
    acceptPendingInvitation,
    loading: workspaceLoading,
    needsWorkspace,
  } = useActivePatient();
  const [screen, setScreen] = useState<Screen>('login');
  const [tab, setTab] = useState<Tab>('dashboard');
  const [acceptingId, setAcceptingId] = useState<string | null>(null);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!currentUser) {
    return screen === 'login' ? (
      <LoginScreen onGoToRegister={() => setScreen('register')} />
    ) : (
      <RegisterScreen onBackToLogin={() => setScreen('login')} />
    );
  }

  if (workspaceLoading) {
    return (
      <View style={styles.center}>
        <Text style={styles.subtext}>Loading…</Text>
      </View>
    );
  }

  if (needsWorkspace || isAddingPatient) {
    return <WorkspaceSetupScreen />;
  }

  async function handleAcceptInvite(targetPatientId: string, memberId: string) {
    setAcceptingId(memberId);
    try {
      await acceptPendingInvitation(targetPatientId, memberId);
    } finally {
      setAcceptingId(null);
    }
  }

  return (
    <View style={styles.authed}>
      <Text style={styles.welcome}>Welcome, {currentUser.fullName}</Text>

      <View style={styles.switcherRow}>
        {patients.map(p => {
          const active = p.id === patientId;
          return (
            <Pressable
              key={p.id}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => selectPatient(p.id)}
              style={[styles.patientChip, active && styles.patientChipActive]}
            >
              <Text style={[styles.patientChipText, active && styles.patientChipTextActive]}>
                {p.fullName}
                {p.relationshipLabel ? ` (${p.relationshipLabel})` : ''}
              </Text>
            </Pressable>
          );
        })}
        <Pressable
          accessibilityRole="button"
          onPress={startAddPatient}
          style={styles.addPatientButton}
        >
          <Text style={styles.addPatientButtonText}>+ Add Patient</Text>
        </Pressable>
      </View>

      {pendingInvitations.length > 0 ? (
        <View style={styles.inviteBanner}>
          {pendingInvitations.map(inv => (
            <View key={inv.member.id} style={styles.inviteBannerRow}>
              <View style={styles.inviteBannerInfo}>
                <Text style={styles.inviteBannerTitle}>
                  Invited to {inv.patient?.fullName ?? 'Care Circle'}
                  {inv.patient?.relationshipLabel ? ` (${inv.patient.relationshipLabel})` : ''}
                </Text>
                <Text style={styles.inviteBannerSub}>
                  Role: {inv.member.rolePreset}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                disabled={acceptingId === inv.member.id}
                onPress={() => void handleAcceptInvite(inv.member.patientId, inv.member.id)}
                style={styles.acceptButton}
              >
                <Text style={styles.acceptButtonText}>
                  {acceptingId === inv.member.id ? 'Accepting…' : 'Accept Invitation'}
                </Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.tabs}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: tab === 'dashboard' }}
          onPress={() => setTab('dashboard')}
          style={[styles.tab, tab === 'dashboard' && styles.tabActive]}
        >
          <Text style={[styles.tabText, tab === 'dashboard' && styles.tabTextActive]}>
            Dashboard
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: tab === 'circle' }}
          onPress={() => setTab('circle')}
          style={[styles.tab, tab === 'circle' && styles.tabActive]}
        >
          <Text style={[styles.tabText, tab === 'circle' && styles.tabTextActive]}>
            Care circle
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: tab === 'appointments' }}
          onPress={() => setTab('appointments')}
          style={[styles.tab, tab === 'appointments' && styles.tabActive]}
        >
          <Text style={[styles.tabText, tab === 'appointments' && styles.tabTextActive]}>
            Appointments
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: tab === 'records' }}
          onPress={() => setTab('records')}
          style={[styles.tab, tab === 'records' && styles.tabActive]}
        >
          <Text style={[styles.tabText, tab === 'records' && styles.tabTextActive]}>
            Records
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: tab === 'prescriptions' }}
          onPress={() => setTab('prescriptions')}
          style={[styles.tab, tab === 'prescriptions' && styles.tabActive]}
        >
          <Text style={[styles.tabText, tab === 'prescriptions' && styles.tabTextActive]}>
            Prescriptions
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: tab === 'bills' }}
          onPress={() => setTab('bills')}
          style={[styles.tab, tab === 'bills' && styles.tabActive]}
        >
          <Text style={[styles.tabText, tab === 'bills' && styles.tabTextActive]}>
            Bills
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: tab === 'tasks' }}
          onPress={() => setTab('tasks')}
          style={[styles.tab, tab === 'tasks' && styles.tabActive]}
        >
          <Text style={[styles.tabText, tab === 'tasks' && styles.tabTextActive]}>
            Tasks
          </Text>
        </Pressable>
      </View>
      <View style={styles.content}>
        {tab === 'dashboard' ? <DashboardScreen /> : null}
        {tab === 'circle' ? <CareCirclePermissionsScreen /> : null}
        {tab === 'appointments' ? <AppointmentsScreen /> : null}
        {tab === 'records' ? <RecordsTimelineScreen /> : null}
        {tab === 'prescriptions' ? <PrescriptionsScreen /> : null}
        {tab === 'bills' ? <BillsLedgerScreen /> : null}
        {tab === 'tasks' ? <TasksActivityScreen /> : null}
      </View>
      <Pressable
        accessibilityRole="button"
        onPress={() => logout()}
        style={styles.logout}
      >
        <Text style={styles.logoutText}>Log out</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    backgroundColor: colors.canvas,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  authed: {
    flex: 1,
    backgroundColor: colors.canvas,
    paddingTop: 48,
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  welcome: {
    color: colors.textPrimary,
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  switcherRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 10,
  },
  patientChip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  patientChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  patientChipText: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '600',
  },
  patientChipTextActive: {
    color: colors.card,
  },
  addPatientButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.card,
  },
  addPatientButtonText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '700',
  },
  inviteBanner: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 10,
    padding: 10,
    marginBottom: 10,
    gap: 8,
  },
  inviteBannerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  inviteBannerInfo: {
    flex: 1,
  },
  inviteBannerTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  inviteBannerSub: {
    color: colors.textSecondary,
    fontSize: 12,
  },
  acceptButton: {
    backgroundColor: colors.primary,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  acceptButtonText: {
    color: colors.card,
    fontSize: 13,
    fontWeight: '600',
  },
  tabs: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    padding: 4,
    marginBottom: 12,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  tabActive: {
    backgroundColor: colors.primary,
  },
  tabText: {
    color: colors.textSecondary,
    fontSize: 15,
    fontWeight: '600',
  },
  tabTextActive: {
    color: colors.card,
  },
  content: {
    flex: 1,
  },
  subtext: {
    color: colors.textSecondary,
    fontSize: 15,
    textAlign: 'center',
  },
  logout: {
    alignSelf: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  logoutText: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: '600',
  },
});
