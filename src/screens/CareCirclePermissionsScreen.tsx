import React, { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useAuth } from '../hooks/useAuth';
import { useActivePatient, useCareCircle } from '../hooks/useCareCircle';
import { usePermissions } from '../hooks/usePermissions';
import {
  inviteMember,
  removeCareCircleMember,
  updateMemberRole,
  type Actor,
  type MemberChanges,
} from '../services/careCircleService';
import type { CareCircleMember, CareRole } from '../types/carebridge';
import { colors, tabularNums } from '../theme/colors';

const INDIGO = '#4338CA';
const ROLES: CareRole[] = ['CO_CAREGIVER', 'CONTRIBUTOR', 'OBSERVER'];

const ROLE_LABELS: Record<CareRole, string> = {
  CO_CAREGIVER: 'Co-caregiver',
  CONTRIBUTOR: 'Contributor',
  OBSERVER: 'Observer',
};

const ROLE_COLORS: Record<CareRole, string> = {
  CO_CAREGIVER: colors.primary,
  CONTRIBUTOR: INDIGO,
  OBSERVER: colors.amber,
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong. Please try again.';
}

function memberLabel(m: CareCircleMember): string {
  return m.invitedEmail || m.invitedPhone || 'Member';
}

interface ChipProps {
  label: string;
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
}

function Chip({ label, selected, disabled = false, onPress }: ChipProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.chip, selected && styles.chipSelected, disabled && styles.disabled]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

interface ToggleProps {
  label: string;
  value: boolean;
  disabled?: boolean;
  onValueChange: (v: boolean) => void;
}

function Toggle({ label, value, disabled = false, onValueChange }: ToggleProps) {
  return (
    <View style={styles.toggleRow}>
      <Text style={styles.toggleLabel}>{label}</Text>
      <Switch
        value={value}
        disabled={disabled}
        onValueChange={onValueChange}
        trackColor={{ false: colors.border, true: colors.primary }}
      />
    </View>
  );
}

function RoleBadge({ role }: { role: CareRole }) {
  return (
    <View style={[styles.badge, { backgroundColor: ROLE_COLORS[role] }]}>
      <Text style={styles.badgeText}>{ROLE_LABELS[role]}</Text>
    </View>
  );
}

interface MemberRowProps {
  member: CareCircleMember;
  patientId: string;
  actor: Actor | null;
  showControls: boolean;
}

// One card per member. Shows status, role, backup-admin and financials facts,
// plus role/backup/financials controls when the viewer may manage the circle.
function MemberRow({ member, patientId, actor, showControls }: MemberRowProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function applyChange(changes: MemberChanges) {
    if (!actor) {
      setError('You must be signed in to change members.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await updateMemberRole(patientId, member.id, actor, changes);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove() {
    if (!actor) {
      setError('You must be signed in to remove members.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await removeCareCircleMember(patientId, member.id, actor);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const isPending = member.inviteStatus === 'PENDING';

  return (
    <View style={styles.card}>
      <Text style={styles.memberName}>{memberLabel(member)}</Text>
      {isPending ? <Text style={styles.pendingLabel}>Invite pending</Text> : null}

      <View style={styles.badgeRow}>
        <RoleBadge role={member.rolePreset} />
        {member.isBackupAdmin ? (
          <View style={[styles.badge, { backgroundColor: colors.textSecondary }]}>
            <Text style={styles.badgeText}>Backup admin</Text>
          </View>
        ) : null}
      </View>

      <Text style={styles.metaText}>
        {member.canViewFinancials ? 'Financials visible' : 'Financials hidden'}
      </Text>

      {showControls ? (
        <View style={styles.controls}>
          <Text style={styles.sectionLabel}>Role</Text>
          <View style={styles.chipRow}>
            {ROLES.map(role => (
              <Chip
                key={role}
                label={ROLE_LABELS[role]}
                selected={member.rolePreset === role}
                disabled={busy}
                onPress={() => applyChange({ rolePreset: role })}
              />
            ))}
          </View>
          <Toggle
            label="Backup admin"
            value={member.isBackupAdmin}
            disabled={busy}
            onValueChange={v => applyChange({ isBackupAdmin: v })}
          />
          <Toggle
            label="Can view financials"
            value={member.canViewFinancials}
            disabled={busy}
            onValueChange={v => applyChange({ canViewFinancials: v })}
          />
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void handleRemove()}
            style={[styles.removeButton, busy && styles.disabled]}
          >
            <Text style={styles.removeButtonText}>
              {isPending ? 'Revoke' : 'Remove'}
            </Text>
          </Pressable>
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

interface InviteFormProps {
  patientId: string;
  actor: Actor | null;
}

// Invite form. Only rendered for users who can manage members.
function InviteForm({ patientId, actor }: InviteFormProps) {
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<CareRole>('CO_CAREGIVER');
  const [isBackupAdmin, setIsBackupAdmin] = useState(false);
  const [canViewFinancials, setCanViewFinancials] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const trimmedEmail = email.trim();
    if (!EMAIL_RE.test(trimmedEmail)) {
      setError('Enter a valid email address.');
      return;
    }
    if (!actor) {
      setError('You must be signed in to invite members.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await inviteMember(patientId, actor, {
        invitedEmail: trimmedEmail,
        invitedPhone: phone.trim() || undefined,
        rolePreset: role,
        isBackupAdmin,
        canViewFinancials,
      });
      setEmail('');
      setPhone('');
      setIsBackupAdmin(false);
      setCanViewFinancials(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>Invite a member</Text>

      <Text style={styles.fieldLabel}>Email (required)</Text>
      <TextInput
        style={styles.input}
        value={email}
        onChangeText={setEmail}
        placeholder="name@example.com"
        placeholderTextColor={colors.textSecondary}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        editable={!busy}
      />

      <Text style={styles.fieldLabel}>Phone (optional)</Text>
      <TextInput
        style={styles.input}
        value={phone}
        onChangeText={setPhone}
        placeholder="Mobile number"
        placeholderTextColor={colors.textSecondary}
        keyboardType="phone-pad"
        editable={!busy}
      />

      <Text style={styles.fieldLabel}>Role</Text>
      <View style={styles.chipRow}>
        {ROLES.map(r => (
          <Chip
            key={r}
            label={ROLE_LABELS[r]}
            selected={role === r}
            disabled={busy}
            onPress={() => setRole(r)}
          />
        ))}
      </View>

      <Toggle
        label="Backup admin"
        value={isBackupAdmin}
        disabled={busy}
        onValueChange={setIsBackupAdmin}
      />
      <Toggle
        label="Can view financials"
        value={canViewFinancials}
        disabled={busy}
        onValueChange={setCanViewFinancials}
      />

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={submit}
        style={[styles.submit, busy && styles.disabled]}
      >
        <Text style={styles.submitText}>{busy ? 'Sending…' : 'Send invite'}</Text>
      </Pressable>
    </View>
  );
}

export default function CareCirclePermissionsScreen() {
  const { currentUser } = useAuth();
  const {
    patientId,
    startAddPatient,
    pendingInvitations,
    acceptPendingInvitation,
    loading: workspaceLoading,
  } = useActivePatient();
  const { accepted, pending, loading: membersLoading, error: membersError } =
    useCareCircle(patientId);
  const { capabilities, loading: permissionsLoading } = usePermissions(patientId);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [acceptError, setAcceptError] = useState<string | null>(null);

  const actor: Actor | null = currentUser
    ? { uid: currentUser.id, name: currentUser.fullName }
    : null;
  const myUid = currentUser?.id ?? null;

  async function handleAcceptInvite(targetPatientId: string, memberId: string) {
    setAcceptError(null);
    setAcceptingId(memberId);
    try {
      await acceptPendingInvitation(targetPatientId, memberId);
    } catch (e) {
      setAcceptError(errorMessage(e));
    } finally {
      setAcceptingId(null);
    }
  }

  if (workspaceLoading) {
    return (
      <View style={[styles.screen, styles.centered]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!patientId) {
    return (
      <View style={styles.screen}>
        <Text style={styles.title}>Care circle</Text>
        <Text style={styles.subtitle}>Who can see and change this patient's care.</Text>
        <Text style={styles.emptyText}>No patient workspace yet.</Text>
      </View>
    );
  }

  const canManage = capabilities.canManageMembers;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.headerRow}>
        <View style={styles.headerTextCol}>
          <Text style={styles.title}>Care circle</Text>
          <Text style={styles.subtitle}>Who can see and change this patient's care.</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={startAddPatient}
          style={styles.addPatientBtn}
        >
          <Text style={styles.addPatientBtnText}>+ Add Patient</Text>
        </Pressable>
      </View>

      {pendingInvitations.length > 0 ? (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Your pending invitations</Text>
          {pendingInvitations.map(inv => (
            <View key={inv.member.id} style={styles.myInviteRow}>
              <Text style={styles.memberName}>
                {inv.patient?.fullName ?? 'Care Circle'}
                {inv.patient?.relationshipLabel ? ` (${inv.patient.relationshipLabel})` : ''}
              </Text>
              <Text style={styles.metaText}>Role: {ROLE_LABELS[inv.member.rolePreset]}</Text>
              <Pressable
                accessibilityRole="button"
                disabled={acceptingId === inv.member.id}
                onPress={() => void handleAcceptInvite(inv.member.patientId, inv.member.id)}
                style={[styles.submit, acceptingId === inv.member.id && styles.disabled]}
              >
                <Text style={styles.submitText}>
                  {acceptingId === inv.member.id ? 'Accepting…' : 'Accept Invitation'}
                </Text>
              </Pressable>
            </View>
          ))}
          {acceptError ? <Text style={styles.errorText}>{acceptError}</Text> : null}
        </View>
      ) : null}

      {permissionsLoading ? (
        <ActivityIndicator color={colors.primary} />
      ) : canManage ? (
        <InviteForm patientId={patientId} actor={actor} />
      ) : (
        <Text style={styles.noteText}>Only co-caregivers can change roles.</Text>
      )}

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Accepted members</Text>
        <Text style={[styles.count, tabularNums]}>{accepted.length}</Text>
      </View>
      {membersLoading ? (
        <ActivityIndicator color={colors.primary} />
      ) : accepted.length === 0 ? (
        <Text style={styles.emptyText}>No members yet.</Text>
      ) : (
        accepted.map(m => (
          <MemberRow
            key={m.id}
            member={m}
            patientId={patientId}
            actor={actor}
            showControls={canManage && m.userId !== myUid}
          />
        ))
      )}

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Pending invites</Text>
        <Text style={[styles.count, tabularNums]}>{pending.length}</Text>
      </View>
      {membersLoading ? (
        <ActivityIndicator color={colors.primary} />
      ) : pending.length === 0 ? (
        <Text style={styles.emptyText}>No members yet.</Text>
      ) : (
        pending.map(m => (
          <MemberRow
            key={m.id}
            member={m}
            patientId={patientId}
            actor={actor}
            showControls={canManage && m.userId !== myUid}
          />
        ))
      )}

      {membersError ? <Text style={styles.errorText}>{membersError}</Text> : null}
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
    paddingBottom: 32,
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.textPrimary,
    padding: 16,
    paddingBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    marginTop: 8,
    marginBottom: 6,
  },
  count: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  memberName: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  pendingLabel: {
    fontSize: 13,
    color: colors.amber,
    marginTop: 2,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  badge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  metaText: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 8,
  },
  controls: {
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 4,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipText: {
    fontSize: 13,
    color: colors.textPrimary,
  },
  chipTextSelected: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  toggleLabel: {
    fontSize: 14,
    color: colors.textPrimary,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    marginTop: 8,
    marginBottom: 4,
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
  submit: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 12,
  },
  submitText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  disabled: {
    opacity: 0.5,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  headerTextCol: {
    flex: 1,
  },
  addPatientBtn: {
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: colors.card,
  },
  addPatientBtnText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '700',
  },
  myInviteRow: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  removeButton: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: colors.error,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  removeButtonText: {
    color: colors.error,
    fontSize: 14,
    fontWeight: '600',
  },
  errorText: {
    color: colors.error,
    fontSize: 13,
    marginTop: 8,
  },
  noteText: {
    color: colors.textSecondary,
    fontSize: 14,
    marginBottom: 16,
  },
  emptyText: {
    color: colors.textSecondary,
    fontSize: 14,
    marginBottom: 12,
  },
});
