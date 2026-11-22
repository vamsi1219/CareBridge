import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import ResultImageGallery from '../components/ResultImageGallery';
import TimelineGraph, { type TimelineFilter } from '../components/TimelineGraph';
import { useAuth } from '../hooks/useAuth';
import { useActivePatient } from '../hooks/useCareCircle';
import { usePermissions } from '../hooks/usePermissions';
import {
  createMedicalRecord,
  createMonthlyCheckup,
  subscribeMedicalRecords,
  subscribeMonthlyCheckups,
} from '../services/recordsService';
import type {
  MedicalRecord,
  MonthlyCheckup,
  RecordCategory,
  RecordType,
} from '../types/carebridge';
import { colors, tabularNums } from '../theme/colors';

const FILTER_OPTIONS: { value: TimelineFilter; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'APPOINTMENT_REPORT', label: 'Appointment reports' },
  { value: 'MONTHLY_CHECKUP', label: 'Monthly checkups' },
];

const CATEGORY_OPTIONS: { value: RecordCategory; label: string }[] = [
  { value: 'APPOINTMENT_REPORT', label: 'Appointment report' },
  { value: 'MONTHLY_CHECKUP', label: 'Monthly checkup' },
];

const TYPE_OPTIONS: { value: RecordType; label: string }[] = [
  { value: 'PRESCRIPTION', label: 'Prescription' },
  { value: 'LAB_REPORT', label: 'Lab report' },
  { value: 'DISCHARGE_SUMMARY', label: 'Discharge summary' },
  { value: 'CHECKUP_PANEL', label: 'Checkup panel' },
  { value: 'OTHER', label: 'Other' },
];

const CHECKUP_CYCLE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_ONLY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong. Please try again.';
}

function typeLabel(value: RecordType): string {
  return TYPE_OPTIONS.find(option => option.value === value)?.label ?? value;
}

interface FieldProps {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  multiline?: boolean;
}

function Field({ label, value, onChangeText, placeholder, multiline }: FieldProps): React.JSX.Element {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[styles.input, multiline ? styles.inputMultiline : null]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textSecondary}
        multiline={multiline}
        autoCapitalize="none"
        autoCorrect={false}
      />
    </View>
  );
}

interface ChipProps {
  label: string;
  active: boolean;
  onPress: () => void;
}

function Chip({ label, active, onPress }: ChipProps): React.JSX.Element {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, active ? styles.chipActive : null]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      <Text style={[styles.chipText, active ? styles.chipTextActive : null]}>{label}</Text>
    </Pressable>
  );
}

export default function RecordsTimelineScreen(): React.JSX.Element {
  const { currentUser } = useAuth();
  const { patientId, loading: workspaceLoading } = useActivePatient();
  const { capabilities } = usePermissions(patientId);

  const [records, setRecords] = useState<MedicalRecord[]>([]);
  const [checkups, setCheckups] = useState<MonthlyCheckup[]>([]);
  const [filter, setFilter] = useState<TimelineFilter>('ALL');

  const [cycle, setCycle] = useState<string>('');
  const [labName, setLabName] = useState<string>('');
  const [checkupDate, setCheckupDate] = useState<string>('');
  const [checkupNotes, setCheckupNotes] = useState<string>('');
  const [checkupError, setCheckupError] = useState<string | null>(null);
  const [checkupSaving, setCheckupSaving] = useState<boolean>(false);

  const [category, setCategory] = useState<RecordCategory>('APPOINTMENT_REPORT');
  const [recordType, setRecordType] = useState<RecordType>('OTHER');
  const [title, setTitle] = useState<string>('');
  const [facilityName, setFacilityName] = useState<string>('');
  const [recordDate, setRecordDate] = useState<string>('');
  const [recordCycle, setRecordCycle] = useState<string>('');
  const [recordError, setRecordError] = useState<string | null>(null);
  const [recordSaving, setRecordSaving] = useState<boolean>(false);

  useEffect(() => {
    if (!patientId) {
      setRecords([]);
      setCheckups([]);
      return;
    }
    const unsubscribeRecords = subscribeMedicalRecords(patientId, items => setRecords(items));
    const unsubscribeCheckups = subscribeMonthlyCheckups(patientId, items => setCheckups(items));
    return () => {
      unsubscribeRecords();
      unsubscribeCheckups();
    };
  }, [patientId]);

  const visibleRecords = useMemo<MedicalRecord[]>(
    () =>
      filter === 'ALL'
        ? records
        : records.filter(record => record.recordCategory === filter),
    [records, filter],
  );

  if (!patientId) {
    return (
      <View style={styles.screen}>
        <Text style={styles.header}>Records & timeline</Text>
        <Text style={styles.muted}>
          {workspaceLoading ? 'Loading workspace...' : 'No patient workspace yet.'}
        </Text>
      </View>
    );
  }

  const handleAddCheckup = async (): Promise<void> => {
    if (!currentUser) {
      setCheckupError('You must be signed in.');
      return;
    }
    const trimmedCycle = cycle.trim();
    const trimmedDate = checkupDate.trim();
    if (!CHECKUP_CYCLE.test(trimmedCycle)) {
      setCheckupError('Checkup cycle must be YYYY-MM.');
      return;
    }
    if (labName.trim() === '') {
      setCheckupError('Lab name is required.');
      return;
    }
    if (!DATE_ONLY.test(trimmedDate)) {
      setCheckupError('Checkup date must be YYYY-MM-DD.');
      return;
    }
    setCheckupSaving(true);
    setCheckupError(null);
    try {
      await createMonthlyCheckup(
        patientId,
        { uid: currentUser.id, name: currentUser.fullName },
        {
          checkupCycle: trimmedCycle,
          labName: labName.trim(),
          checkupDate: trimmedDate,
          notes: checkupNotes.trim() === '' ? undefined : checkupNotes.trim(),
        },
      );
      setCycle('');
      setLabName('');
      setCheckupDate('');
      setCheckupNotes('');
    } catch (err: unknown) {
      setCheckupError(errorMessage(err));
    } finally {
      setCheckupSaving(false);
    }
  };

  const handleAddRecord = async (): Promise<void> => {
    if (!currentUser) {
      setRecordError('You must be signed in.');
      return;
    }
    setRecordSaving(true);
    setRecordError(null);
    try {
      await createMedicalRecord(
        patientId,
        { uid: currentUser.id, name: currentUser.fullName },
        {
          recordCategory: category,
          recordType,
          title,
          facilityName: facilityName.trim() === '' ? undefined : facilityName.trim(),
          recordDate: recordDate.trim(),
          checkupCycle:
            category === 'MONTHLY_CHECKUP' ? recordCycle.trim() : undefined,
          attachments: [],
        },
      );
      setTitle('');
      setFacilityName('');
      setRecordDate('');
      setRecordCycle('');
    } catch (err: unknown) {
      setRecordError(errorMessage(err));
    } finally {
      setRecordSaving(false);
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.header}>Records & timeline</Text>

      <View style={styles.segmented} accessibilityRole="tablist">
        {FILTER_OPTIONS.map(option => {
          const active = filter === option.value;
          return (
            <Pressable
              key={option.value}
              onPress={() => setFilter(option.value)}
              style={[styles.segment, active ? styles.segmentActive : null]}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
            >
              <Text style={[styles.segmentText, active ? styles.segmentTextActive : null]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <TimelineGraph records={records} checkups={checkups} filter={filter} />

      <Text style={styles.sectionTitle}>Records</Text>
      {visibleRecords.length === 0 ? (
        <Text style={styles.muted}>No records in this view.</Text>
      ) : (
        visibleRecords.map(record => (
          <View key={record.id} style={styles.card}>
            <Text style={styles.recordTitle}>{record.title}</Text>
            <Text style={styles.muted}>
              {typeLabel(record.recordType)} · {record.facilityName ?? 'Facility not given'}
            </Text>
            <Text style={[styles.muted, tabularNums]}>{record.recordDate}</Text>
            <View style={styles.gallery}>
              <ResultImageGallery attachments={record.attachments} />
            </View>
          </View>
        ))
      )}

      {capabilities.canEdit ? (
        <>
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Add monthly checkup</Text>
            <Field label="Checkup cycle" value={cycle} onChangeText={setCycle} placeholder="YYYY-MM" />
            <Field label="Lab name" value={labName} onChangeText={setLabName} />
            <Field
              label="Checkup date"
              value={checkupDate}
              onChangeText={setCheckupDate}
              placeholder="YYYY-MM-DD"
            />
            <Field label="Notes" value={checkupNotes} onChangeText={setCheckupNotes} multiline />
            {checkupError ? <Text style={styles.error}>{checkupError}</Text> : null}
            <Pressable
              onPress={() => {
                void handleAddCheckup();
              }}
              disabled={checkupSaving}
              style={[styles.submit, checkupSaving ? styles.submitDisabled : null]}
              accessibilityRole="button"
            >
              <Text style={styles.submitText}>
                {checkupSaving ? 'Saving...' : 'Save monthly checkup'}
              </Text>
            </Pressable>
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Add medical record</Text>
            <Text style={styles.fieldLabel}>Category</Text>
            <View style={styles.chipRow}>
              {CATEGORY_OPTIONS.map(option => (
                <Chip
                  key={option.value}
                  label={option.label}
                  active={category === option.value}
                  onPress={() => setCategory(option.value)}
                />
              ))}
            </View>
            <Text style={styles.fieldLabel}>Type</Text>
            <View style={styles.chipRow}>
              {TYPE_OPTIONS.map(option => (
                <Chip
                  key={option.value}
                  label={option.label}
                  active={recordType === option.value}
                  onPress={() => setRecordType(option.value)}
                />
              ))}
            </View>
            <Field label="Title" value={title} onChangeText={setTitle} />
            <Field label="Facility name" value={facilityName} onChangeText={setFacilityName} />
            <Field
              label="Record date"
              value={recordDate}
              onChangeText={setRecordDate}
              placeholder="YYYY-MM-DD"
            />
            {category === 'MONTHLY_CHECKUP' ? (
              <Field
                label="Checkup cycle"
                value={recordCycle}
                onChangeText={setRecordCycle}
                placeholder="YYYY-MM"
              />
            ) : null}
            {recordError ? <Text style={styles.error}>{recordError}</Text> : null}
            <Pressable
              onPress={() => {
                void handleAddRecord();
              }}
              disabled={recordSaving}
              style={[styles.submit, recordSaving ? styles.submitDisabled : null]}
              accessibilityRole="button"
            >
              <Text style={styles.submitText}>{recordSaving ? 'Saving...' : 'Save medical record'}</Text>
            </Pressable>
          </View>
        </>
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
    paddingBottom: 40,
  },
  header: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
    marginTop: 16,
    marginBottom: 8,
  },
  muted: {
    fontSize: 14,
    color: colors.textSecondary,
    marginVertical: 4,
  },
  error: {
    fontSize: 13,
    color: colors.error,
    marginTop: 8,
  },
  segmented: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 3,
    marginBottom: 12,
  },
  segment: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  segmentActive: {
    backgroundColor: colors.primary,
  },
  segmentText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  segmentTextActive: {
    color: colors.card,
  },
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
    marginTop: 12,
  },
  recordTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 2,
  },
  gallery: {
    marginTop: 8,
  },
  field: {
    marginTop: 8,
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
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    color: colors.textPrimary,
    backgroundColor: colors.canvas,
  },
  inputMultiline: {
    minHeight: 64,
    textAlignVertical: 'top',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: colors.canvas,
  },
  chipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipText: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  chipTextActive: {
    color: colors.card,
    fontWeight: '600',
  },
  submit: {
    marginTop: 12,
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  submitDisabled: {
    opacity: 0.6,
  },
  submitText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.card,
  },
});
