// SYNTHETIC DEMO UI. Prescription draft capture for CareBridge demo data only; not medical advice.
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { extractPrescriptionDraft, type PrescriptionDraft } from '../config/gemini';
import { useAuth } from '../hooks/useAuth';
import { createPrescription } from '../services/prescriptionService';
import { colors, tabularNums } from '../theme/colors';
import { durationBetween } from '../utils/durationCalculator';

export interface PrescriptionScanSheetProps {
  visible: boolean;
  patientId: string;
  onClose: () => void;
}

type Step = 'scan' | 'review';

// Editable review fields. Every field is kept as text until validation on save.
interface ReviewFields {
  prescribedByDoc: string;
  medicineName: string;
  strength: string;
  timingSlot: string;
  dailyUnitsNeeded: string;
  remainingTablets: string;
  startDate: string;
}

interface ReviewFieldSpec {
  key: keyof ReviewFields;
  label: string;
  numeric: boolean;
}

const REVIEW_FIELDS: ReviewFieldSpec[] = [
  { key: 'prescribedByDoc', label: 'Prescribing doctor', numeric: false },
  { key: 'medicineName', label: 'Medicine name', numeric: false },
  { key: 'strength', label: 'Strength', numeric: false },
  { key: 'timingSlot', label: 'Timing slot', numeric: false },
  { key: 'dailyUnitsNeeded', label: 'Daily units needed', numeric: true },
  { key: 'remainingTablets', label: 'Remaining tablets', numeric: true },
  { key: 'startDate', label: 'Start date (YYYY-MM-DD)', numeric: false },
];

const EMPTY_FIELDS: ReviewFields = {
  prescribedByDoc: '',
  medicineName: '',
  strength: '',
  timingSlot: '',
  dailyUnitsNeeded: '',
  remainingTablets: '',
  startDate: '',
};

// Local calendar date as YYYY-MM-DD.
function todayDateOnly(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

// Parses a numeric text field. Null when the field is empty or not a finite number.
function parseNumberField(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

export default function PrescriptionScanSheet({
  visible,
  patientId,
  onClose,
}: PrescriptionScanSheetProps): React.JSX.Element {
  const { currentUser } = useAuth();
  const [step, setStep] = useState<Step>('scan');
  const [imageUri, setImageUri] = useState<string>('');
  const [sourceImageUrl, setSourceImageUrl] = useState<string>('');
  const [fields, setFields] = useState<ReviewFields>(EMPTY_FIELDS);
  const [source, setSource] = useState<PrescriptionDraft['source']>('SAMPLE');
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Start every opening of the sheet from a clean state.
  useEffect(() => {
    if (!visible) return;
    setStep('scan');
    setImageUri('');
    setSourceImageUrl('');
    setFields(EMPTY_FIELDS);
    setSource('SAMPLE');
    setBusy(false);
    setError(null);
  }, [visible]);

  async function handleExtract(): Promise<void> {
    const uri = imageUri.trim();
    if (!uri) {
      setError('Enter an image URI before extracting a draft.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const draft = await extractPrescriptionDraft(uri);
      setFields({
        prescribedByDoc: draft.prescribedByDoc,
        medicineName: draft.medicineName,
        strength: draft.strength,
        timingSlot: draft.timingSlot,
        dailyUnitsNeeded: draft.dailyUnitsNeeded,
        remainingTablets: draft.remainingTablets,
        startDate: todayDateOnly(),
      });
      setSource(draft.source);
      setSourceImageUrl(uri);
      setStep('review');
    } catch (err) {
      setError(errorMessage(err, 'Could not extract a draft. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  async function handleSave(): Promise<void> {
    if (!currentUser) {
      setError('You must be signed in to save a prescription.');
      return;
    }

    const medicineName = fields.medicineName.trim();
    const timingSlot = fields.timingSlot.trim();
    const startDate = fields.startDate.trim();
    const dailyUnits = parseNumberField(fields.dailyUnitsNeeded);
    const remaining = parseNumberField(fields.remainingTablets);

    let problem: string | null = null;
    if (!medicineName) problem = 'Medicine name is required.';
    else if (!timingSlot) problem = 'Timing slot is required.';
    else if (dailyUnits === null) problem = 'Daily units needed must be a number.';
    else if (dailyUnits <= 0) problem = 'Daily units needed must be greater than 0.';
    else if (remaining === null) problem = 'Remaining tablets must be a number.';
    else if (remaining < 0) problem = 'Remaining tablets must be 0 or more.';
    else if (durationBetween(startDate, startDate) === 0) {
      problem = 'Start date must be a valid YYYY-MM-DD date.';
    }
    if (problem !== null || dailyUnits === null || remaining === null) {
      setError(problem ?? 'Check the highlighted fields.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await createPrescription(
        patientId,
        { uid: currentUser.id, name: currentUser.fullName },
        {
          prescribedByDoc: fields.prescribedByDoc.trim(),
          startDate,
          sourceImageUrl,
          items: [
            {
              medicineName,
              strength: fields.strength.trim(),
              timingSlot,
              dailyUnitsNeeded: dailyUnits,
              administeredByLabel: 'Unassigned',
              remainingTablets: remaining,
              refillThresholdDays: 3,
            },
          ],
        },
      );
      onClose();
    } catch (err) {
      setError(errorMessage(err, 'Could not save the prescription.'));
    } finally {
      setBusy(false);
    }
  }

  const title = step === 'scan' ? 'Scan prescription photo' : 'Review & Confirm Extracted Fields';
  const sourceLine = source === 'AI' ? 'Source: AI draft' : 'Source: synthetic sample';

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={false}
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        <Text style={styles.title}>{title}</Text>

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {step === 'scan' ? (
            <View>
              <View style={styles.notice}>
                <Text style={styles.noticeText}>
                  AI output is a draft only. Check every field against the original prescription before saving.
                </Text>
              </View>
              <Text style={styles.label}>Image URI</Text>
              <TextInput
                style={styles.input}
                value={imageUri}
                onChangeText={setImageUri}
                placeholder="Image URI. Demo uses a synthetic sample when no AI key is configured."
                placeholderTextColor={colors.textSecondary}
                autoCapitalize="none"
                autoCorrect={false}
                editable={!busy}
              />
              <Pressable
                accessibilityRole="button"
                onPress={() => void handleExtract()}
                disabled={busy}
                style={[styles.primaryButton, busy ? styles.disabled : null]}
              >
                <Text style={styles.primaryButtonText}>Extract draft</Text>
              </Pressable>
            </View>
          ) : (
            <View>
              <Text style={styles.sourceLine}>{sourceLine}</Text>
              <View style={styles.notice}>
                <Text style={styles.noticeText}>
                  Draft values are editable. Nothing is saved until you confirm.
                </Text>
              </View>
              {REVIEW_FIELDS.map(spec => (
                <View key={spec.key} style={styles.fieldBlock}>
                  <Text style={styles.label}>{spec.label}</Text>
                  <TextInput
                    style={[styles.input, spec.numeric ? tabularNums : null]}
                    value={fields[spec.key]}
                    onChangeText={text => setFields(prev => ({ ...prev, [spec.key]: text }))}
                    keyboardType={spec.numeric ? 'numeric' : 'default'}
                    autoCapitalize="none"
                    autoCorrect={false}
                    editable={!busy}
                  />
                </View>
              ))}
            </View>
          )}

          {error ? <Text style={styles.errorText}>{error}</Text> : null}
        </ScrollView>

        <View style={styles.footer}>
          {step === 'review' ? (
            <>
              <Pressable
                accessibilityRole="button"
                onPress={() => void handleSave()}
                disabled={busy}
                style={[styles.primaryButton, busy ? styles.disabled : null]}
              >
                {busy ? (
                  <ActivityIndicator color={colors.card} />
                ) : (
                  <Text style={styles.primaryButtonText}>Confirm and save</Text>
                )}
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setError(null);
                  setStep('scan');
                }}
                disabled={busy}
                style={[styles.secondaryButton, busy ? styles.disabled : null]}
              >
                <Text style={styles.secondaryButtonText}>Back to photo</Text>
              </Pressable>
            </>
          ) : null}
          <Pressable
            accessibilityRole="button"
            onPress={onClose}
            disabled={busy}
            style={[styles.secondaryButton, busy ? styles.disabled : null]}
          >
            <Text style={styles.secondaryButtonText}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.canvas,
    paddingTop: 48,
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: 12,
  },
  content: {
    paddingBottom: 16,
  },
  notice: {
    backgroundColor: colors.card,
    borderColor: colors.amber,
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  noticeText: {
    fontSize: 14,
    color: colors.textPrimary,
  },
  sourceLine: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
    marginBottom: 8,
  },
  fieldBlock: {
    marginBottom: 8,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 4,
  },
  input: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.textPrimary,
    marginBottom: 12,
  },
  errorText: {
    color: colors.error,
    fontSize: 14,
    marginTop: 4,
  },
  footer: {
    gap: 8,
    paddingTop: 8,
  },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: colors.card,
    fontSize: 15,
    fontWeight: '600',
  },
  secondaryButton: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '600',
  },
  disabled: {
    opacity: 0.5,
  },
});
