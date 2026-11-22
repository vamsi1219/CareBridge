import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAuth } from '../hooks/useAuth';
import { useActivePatient, useCareCircle } from '../hooks/useCareCircle';
import { usePermissions } from '../hooks/usePermissions';
import {
  addMedicalBill,
  filterBillsByCategory,
  monthBills,
  subscribeMedicalBills,
} from '../services/billsService';
import { monthRange } from '../services/dashboardSelectors';
import { localStore } from '../services/localStore';
import { colors, tabularNums } from '../theme/colors';
import type { BillCategory, MedicalBill } from '../types/carebridge';
import { formatRupees, monthTotal, splitByPayer } from '../utils/expenseMath';

// Coral for the multi-series split bar; amber and teal come from the theme.
const CORAL = '#EA580C';
const SPLIT_SERIES_COLORS = [colors.primary, colors.amber, CORAL];

const CATEGORY_OPTIONS: BillCategory[] = [
  'PHARMACY_MEDICINES',
  'CONSULTATION',
  'LAB_DIAGNOSTICS',
  'HOSPITAL_OTHER',
];
const FILTER_OPTIONS: Array<BillCategory | 'ALL'> = ['ALL', ...CATEGORY_OPTIONS];

const CATEGORY_LABEL: Record<BillCategory | 'ALL', string> = {
  ALL: 'All',
  PHARMACY_MEDICINES: 'Pharmacy medicines',
  CONSULTATION: 'Consultation',
  LAB_DIAGNOSTICS: 'Lab diagnostics',
  HOSPITAL_OTHER: 'Hospital other',
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isValidDateOnly(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function BillsLedgerScreen() {
  const { patientId } = useActivePatient();
  const { capabilities } = usePermissions(patientId);
  const [bills, setBills] = useState<MedicalBill[]>([]);

  // Bills are only subscribed when the role may view financials, so hidden roles never load them.
  const canViewFinancials = capabilities.canViewFinancials;
  useEffect(() => {
    if (!patientId || !canViewFinancials) {
      setBills([]);
      return;
    }
    return subscribeMedicalBills(patientId, setBills);
  }, [patientId, canViewFinancials]);

  if (!capabilities.canViewFinancials) {
    return (
      <ScrollView style={styles.canvas} contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <Text style={styles.body}>Financial details are hidden for your role.</Text>
        </View>
      </ScrollView>
    );
  }

  if (!patientId) {
    return (
      <ScrollView style={styles.canvas} contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <Text style={styles.body}>No care workspace selected.</Text>
        </View>
      </ScrollView>
    );
  }

  return (
    <LedgerView patientId={patientId} bills={bills} canEdit={capabilities.canEdit} />
  );
}

interface LedgerViewProps {
  patientId: string;
  bills: MedicalBill[];
  canEdit: boolean;
}

// Rendered only for roles that can view financials, so totals are computed only here.
function LedgerView({ patientId, bills, canEdit }: LedgerViewProps) {
  const { currentUser } = useAuth();
  const { accepted } = useCareCircle(patientId);
  const [filter, setFilter] = useState<BillCategory | 'ALL'>('ALL');

  const monthList = monthBills(bills, monthRange(new Date()));
  const total = monthTotal(monthList);
  const shares = splitByPayer(monthList);
  const visible = filterBillsByCategory(bills, filter);

  // CareCircleMember carries no display name: use the signed-in user's name, then the
  // user profile mirror, then the invite email or phone, then the raw id.
  const payerLabel = (id: string): string => {
    if (currentUser && id === currentUser.id) return currentUser.fullName;
    const member = accepted.find(m => m.userId === id);
    return (
      localStore.getUserById(id)?.fullName ||
      member?.invitedEmail ||
      member?.invitedPhone ||
      id
    );
  };

  const payerOptions: string[] = [];
  if (currentUser) payerOptions.push(currentUser.id);
  for (const m of accepted) {
    if (m.userId && !payerOptions.includes(m.userId)) payerOptions.push(m.userId);
  }

  // Add-bill form state.
  const [category, setCategory] = useState<BillCategory>('PHARMACY_MEDICINES');
  const [amountText, setAmountText] = useState('');
  const [dateText, setDateText] = useState(todayIso());
  const [paidBy, setPaidBy] = useState<string>(currentUser?.id ?? '');
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!currentUser) {
      setFormError('You must be signed in to add a bill.');
      return;
    }
    const amountInput = amountText.trim();
    const amount = Number(amountInput);
    if (!amountInput || !Number.isFinite(amount) || amount <= 0) {
      setFormError('Enter an amount greater than zero.');
      return;
    }
    const dateInput = dateText.trim();
    if (!isValidDateOnly(dateInput)) {
      setFormError('Date must be a real date in YYYY-MM-DD format.');
      return;
    }
    const payer = paidBy || payerOptions[0] || '';
    if (!payer) {
      setFormError('Choose who paid for this bill.');
      return;
    }

    setFormError(null);
    setSubmitting(true);
    try {
      await addMedicalBill(
        patientId,
        { uid: currentUser.id, name: currentUser.fullName },
        {
          category,
          amount,
          prescriptionDate: dateInput,
          paidByUserId: payer,
          notes: notes.trim() || undefined,
        },
      );
      setAmountText('');
      setNotes('');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not add the bill.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollView style={styles.canvas} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <Text style={styles.label}>This month</Text>
        {monthList.length === 0 ? (
          <Text style={styles.body}>No bills recorded for this month.</Text>
        ) : (
          <>
            <Text style={[styles.total, tabularNums]}>{formatRupees(total)}</Text>
            <View style={styles.splitBar}>
              {shares.map((share, index) => (
                <View
                  key={share.paidByUserId}
                  style={{
                    flex: share.sharePercent,
                    backgroundColor: SPLIT_SERIES_COLORS[index % SPLIT_SERIES_COLORS.length],
                  }}
                />
              ))}
            </View>
            {shares.map((share, index) => (
              <View key={share.paidByUserId} style={styles.row}>
                <View style={styles.rowLeft}>
                  <View
                    style={[
                      styles.swatch,
                      { backgroundColor: SPLIT_SERIES_COLORS[index % SPLIT_SERIES_COLORS.length] },
                    ]}
                  />
                  <Text style={styles.body}>{payerLabel(share.paidByUserId)}</Text>
                </View>
                <Text style={[styles.body, tabularNums]}>
                  {formatRupees(share.amount)} · {share.sharePercent.toFixed(1)}%
                </Text>
              </View>
            ))}
          </>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Bills</Text>
        <View style={styles.chipRow}>
          {FILTER_OPTIONS.map(option => (
            <Chip
              key={option}
              label={CATEGORY_LABEL[option]}
              selected={filter === option}
              onPress={() => setFilter(option)}
            />
          ))}
        </View>
        {visible.length === 0 ? (
          <Text style={styles.body}>
            {bills.length === 0 ? 'No bills yet.' : 'No bills in this category.'}
          </Text>
        ) : (
          visible.map(bill => (
            <View key={bill.id} style={styles.billRow}>
              <Text style={[styles.meta, tabularNums]}>{bill.prescriptionDate}</Text>
              <Text style={styles.body}>{CATEGORY_LABEL[bill.category as BillCategory] ?? bill.category}</Text>
              <Text style={[styles.amount, tabularNums]}>{formatRupees(bill.amount)}</Text>
              <Text style={styles.meta}>Paid by {payerLabel(bill.paidByUserId)}</Text>
            </View>
          ))
        )}
      </View>

      {canEdit ? (
        <View style={styles.card}>
          <Text style={styles.label}>Add bill</Text>

          <Text style={styles.fieldLabel}>Category</Text>
          <View style={styles.chipRow}>
            {CATEGORY_OPTIONS.map(option => (
              <Chip
                key={option}
                label={CATEGORY_LABEL[option]}
                selected={category === option}
                onPress={() => setCategory(option)}
              />
            ))}
          </View>

          <Text style={styles.fieldLabel}>Amount (₹)</Text>
          <TextInput
            value={amountText}
            onChangeText={setAmountText}
            keyboardType="decimal-pad"
            placeholder="0"
            placeholderTextColor={colors.textSecondary}
            style={styles.input}
          />

          <Text style={styles.fieldLabel}>Date (YYYY-MM-DD)</Text>
          <TextInput
            value={dateText}
            onChangeText={setDateText}
            autoCapitalize="none"
            placeholder="2026-01-31"
            placeholderTextColor={colors.textSecondary}
            style={styles.input}
          />

          <Text style={styles.fieldLabel}>Paid by</Text>
          <View style={styles.chipRow}>
            {payerOptions.map(id => (
              <Chip
                key={id}
                label={payerLabel(id)}
                selected={(paidBy || payerOptions[0]) === id}
                onPress={() => setPaidBy(id)}
              />
            ))}
          </View>

          <Text style={styles.fieldLabel}>Notes (optional)</Text>
          <TextInput
            value={notes}
            onChangeText={setNotes}
            placeholder="Synthetic demo note"
            placeholderTextColor={colors.textSecondary}
            style={styles.input}
          />

          {formError ? <Text style={styles.error}>{formError}</Text> : null}

          <Pressable
            onPress={handleSubmit}
            disabled={submitting}
            style={[styles.submit, submitting && styles.submitDisabled]}
          >
            <Text style={styles.submitText}>{submitting ? 'Saving…' : 'Add bill'}</Text>
          </Pressable>
        </View>
      ) : null}
    </ScrollView>
  );
}

interface ChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
}

function Chip({ label, selected, onPress }: ChipProps) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  canvas: {
    flex: 1,
    backgroundColor: colors.canvas,
  },
  content: {
    padding: 16,
    gap: 12,
  },
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 14,
    gap: 8,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  fieldLabel: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 4,
  },
  body: {
    fontSize: 14,
    color: colors.textPrimary,
  },
  meta: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  total: {
    fontSize: 26,
    fontWeight: '700',
    color: colors.primary,
  },
  amount: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  splitBar: {
    flexDirection: 'row',
    height: 10,
    borderRadius: 5,
    overflow: 'hidden',
    backgroundColor: colors.border,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  swatch: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  chipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipText: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  chipTextSelected: {
    color: colors.card,
    fontWeight: '600',
  },
  billRow: {
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: 2,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    color: colors.textPrimary,
    backgroundColor: colors.card,
  },
  error: {
    fontSize: 13,
    color: colors.error,
  },
  submit: {
    marginTop: 6,
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  submitDisabled: {
    opacity: 0.6,
  },
  submitText: {
    color: colors.card,
    fontSize: 15,
    fontWeight: '600',
  },
});
