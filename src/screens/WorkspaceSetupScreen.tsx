import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAuth } from '../hooks/useAuth';
import { useActivePatient } from '../hooks/useCareCircle';
import { colors } from '../theme/colors';

interface FormValues {
  fullName: string;
  relationshipLabel: string;
  city: string;
  bloodGroup: string;
  allergiesNote: string;
}

type FieldErrors = Partial<Record<'fullName' | 'relationshipLabel' | 'city', string>>;

interface FieldProps {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  error?: string;
  multiline?: boolean;
}

function Field({ label, value, onChangeText, error, multiline = false }: FieldProps): React.JSX.Element {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, multiline && styles.inputMultiline]}
        value={value}
        onChangeText={onChangeText}
        multiline={multiline}
        placeholderTextColor={colors.textSecondary}
        autoCorrect={false}
      />
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
}

// Creates a signed-in user's patient workspace or lets them accept a pending invitation.
export default function WorkspaceSetupScreen(): React.JSX.Element {
  const { currentUser } = useAuth();
  const {
    createWorkspace,
    patients,
    cancelAddPatient,
    pendingInvitations,
    acceptPendingInvitation,
  } = useActivePatient();
  const [values, setValues] = useState<FormValues>({
    fullName: '',
    relationshipLabel: '',
    city: '',
    bloodGroup: '',
    allergiesNote: '',
  });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);

  function update(key: keyof FormValues, text: string): void {
    setValues(prev => ({ ...prev, [key]: text }));
  }

  async function handleAccept(targetPatientId: string, memberId: string): Promise<void> {
    setSubmitError(null);
    setAcceptingId(memberId);
    try {
      await acceptPendingInvitation(targetPatientId, memberId);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not accept invitation.');
    } finally {
      setAcceptingId(null);
    }
  }

  async function handleSubmit(): Promise<void> {
    setSubmitError(null);
    const errors: FieldErrors = {};
    if (!values.fullName.trim()) errors.fullName = 'Full name is required.';
    if (!values.relationshipLabel.trim()) errors.relationshipLabel = 'Relationship is required.';
    if (!values.city.trim()) errors.city = 'City is required.';
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    if (!currentUser) {
      setSubmitError('Sign in to create a workspace.');
      return;
    }

    setSubmitting(true);
    try {
      // The hook attaches the signed-in user's name as creatorName itself.
      await createWorkspace({
        fullName: values.fullName.trim(),
        relationshipLabel: values.relationshipLabel.trim(),
        city: values.city.trim(),
        bloodGroup: values.bloodGroup.trim() || undefined,
        allergiesNote: values.allergiesNote.trim() || undefined,
      });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not create the workspace.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      {pendingInvitations.length > 0 ? (
        <View style={styles.inviteCard}>
          <Text style={styles.title}>Pending invitations</Text>
          <Text style={styles.subtitle}>
            You have been invited to join an existing family care circle.
          </Text>
          {pendingInvitations.map(inv => (
            <View key={inv.member.id} style={styles.inviteRow}>
              <View style={styles.inviteInfo}>
                <Text style={styles.inviteTitle}>
                  {inv.patient?.fullName ?? 'Family Patient Workspace'}
                  {inv.patient?.relationshipLabel ? ` (${inv.patient.relationshipLabel})` : ''}
                </Text>
                <Text style={styles.subtitle}>
                  Role: {inv.member.rolePreset}
                  {inv.patient?.city ? ` · ${inv.patient.city}` : ''}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                disabled={acceptingId === inv.member.id}
                onPress={() => void handleAccept(inv.member.patientId, inv.member.id)}
                style={({ pressed }) => [
                  styles.acceptButton,
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
      ) : null}

      <View style={styles.card}>
        <Text style={styles.title}>
          {patients.length > 0 ? 'Add another patient' : 'Set up patient workspace'}
        </Text>
        <Text style={styles.subtitle}>Enter the patient's details. Required fields are marked in the errors below.</Text>

        <Field
          label="Full name (required)"
          value={values.fullName}
          onChangeText={text => update('fullName', text)}
          error={fieldErrors.fullName}
        />
        <Field
          label="Relationship to patient (required)"
          value={values.relationshipLabel}
          onChangeText={text => update('relationshipLabel', text)}
          error={fieldErrors.relationshipLabel}
        />
        <Field
          label="City (required)"
          value={values.city}
          onChangeText={text => update('city', text)}
          error={fieldErrors.city}
        />
        <Field
          label="Blood group (optional)"
          value={values.bloodGroup}
          onChangeText={text => update('bloodGroup', text)}
        />
        <Field
          label="Allergies note (optional)"
          value={values.allergiesNote}
          onChangeText={text => update('allergiesNote', text)}
          multiline
        />

        {submitError ? <Text style={styles.errorText}>{submitError}</Text> : null}

        <Pressable
          accessibilityRole="button"
          onPress={() => void handleSubmit()}
          disabled={submitting}
          style={({ pressed }) => [
            styles.button,
            (pressed || submitting) && styles.buttonDimmed,
          ]}
        >
          <Text style={styles.buttonText}>{submitting ? 'Creating workspace…' : 'Create workspace'}</Text>
        </Pressable>

        {patients.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            onPress={cancelAddPatient}
            disabled={submitting}
            style={styles.cancelButton}
          >
            <Text style={styles.cancelButtonText}>Cancel / Back</Text>
          </Pressable>
        ) : null}
      </View>
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
  inviteCard: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 12,
    padding: 16,
    gap: 12,
  },
  inviteRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: 12,
    gap: 10,
  },
  inviteInfo: {
    gap: 4,
  },
  inviteTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '700',
  },
  acceptButton: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: 'center',
  },
  cancelButton: {
    marginTop: 4,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  cancelButtonText: {
    color: colors.textSecondary,
    fontSize: 15,
    fontWeight: '600',
  },
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 16,
    gap: 12,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 22,
    fontWeight: '700',
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: 14,
  },
  field: {
    gap: 4,
  },
  label: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: colors.textPrimary,
    backgroundColor: colors.card,
  },
  inputMultiline: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  errorText: {
    color: colors.error,
    fontSize: 14,
  },
  button: {
    marginTop: 4,
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  buttonDimmed: {
    opacity: 0.6,
  },
  buttonText: {
    color: colors.card,
    fontSize: 16,
    fontWeight: '600',
  },
});
