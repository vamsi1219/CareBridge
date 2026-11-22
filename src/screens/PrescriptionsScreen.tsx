// SYNTHETIC DEMO UI. Prescription list for CareBridge demo data only; not medical advice.
import React, { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import PrescriptionScanSheet from '../components/PrescriptionScanSheet';
import { useAuth } from '../hooks/useAuth';
import { useActivePatient } from '../hooks/useCareCircle';
import { usePermissions } from '../hooks/usePermissions';
import {
  discontinuePrescription,
  logDailyDose,
  subscribePrescriptions,
} from '../services/prescriptionService';
import { colors, tabularNums } from '../theme/colors';
import type { Prescription, PrescriptionItem } from '../types/carebridge';
import {
  daysRemaining,
  durationBetween,
  formatDurationDays,
  isLowStock,
} from '../utils/durationCalculator';

type Tab = 'active' | 'discontinued';

const TAB_LABELS: Record<Tab, string> = {
  active: 'Active medications',
  discontinued: 'Discontinued history',
};

// Local calendar date as YYYY-MM-DD.
function todayDateOnly(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

// Refill countdown text and whether the supply is at or below its refill threshold.
function refillInfo(item: PrescriptionItem): { text: string; low: boolean } {
  const days = daysRemaining(item.remainingTablets, item.dailyUnitsNeeded);
  if (!Number.isFinite(days)) return { text: 'No daily use set', low: false };
  return {
    text: `Refill in ${formatDurationDays(days)}`,
    low: isLowStock(item.remainingTablets, item.dailyUnitsNeeded, item.refillThresholdDays),
  };
}

// Inclusive span text for a discontinued prescription, or a dash when the dates are not valid.
function spanText(prescription: Prescription): string {
  if (!prescription.endDate) return '—';
  const days = durationBetween(prescription.startDate, prescription.endDate);
  return days > 0 ? formatDurationDays(days) : '—';
}

export default function PrescriptionsScreen(): React.JSX.Element {
  const { currentUser } = useAuth();
  const { patientId } = useActivePatient();
  const { capabilities } = usePermissions(patientId);
  const [prescriptions, setPrescriptions] = useState<Prescription[]>([]);
  const [tab, setTab] = useState<Tab>('active');
  const [scanVisible, setScanVisible] = useState<boolean>(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!patientId) {
      setPrescriptions([]);
      return;
    }
    const unsubscribe = subscribePrescriptions(patientId, setPrescriptions);
    return unsubscribe;
  }, [patientId]);

  async function handleLogDose(prescriptionId: string, itemId: string): Promise<void> {
    if (!patientId || !currentUser) return;
    setBusyKey(`dose:${itemId}`);
    setActionError(null);
    try {
      await logDailyDose(patientId, prescriptionId, itemId, {
        uid: currentUser.id,
        name: currentUser.fullName,
      });
    } catch (err) {
      setActionError(errorMessage(err, 'Could not log the dose. Try again.'));
    } finally {
      setBusyKey(null);
    }
  }

  async function runDiscontinue(prescriptionId: string): Promise<void> {
    if (!patientId || !currentUser) return;
    setBusyKey(`discontinue:${prescriptionId}`);
    setActionError(null);
    try {
      await discontinuePrescription(
        patientId,
        prescriptionId,
        { uid: currentUser.id, name: currentUser.fullName },
        { endDate: todayDateOnly() },
      );
    } catch (err) {
      setActionError(errorMessage(err, 'Could not discontinue the prescription. Try again.'));
    } finally {
      setBusyKey(null);
    }
  }

  function confirmDiscontinue(prescription: Prescription): void {
    Alert.alert(
      'Discontinue prescription?',
      `The prescription from ${prescription.prescribedByDoc} will move to Discontinued history with end date ${todayDateOnly()}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Discontinue',
          style: 'destructive',
          onPress: () => {
            void runDiscontinue(prescription.id);
          },
        },
      ],
    );
  }

  if (!patientId) {
    return (
      <View style={styles.screen}>
        <Text style={styles.title}>Prescriptions</Text>
        <Text style={styles.emptyText}>No care workspace selected.</Text>
      </View>
    );
  }

  const activeList = prescriptions.filter(p => p.status === 'ACTIVE');
  const discontinuedList = prescriptions.filter(p => p.status === 'DISCONTINUED');
  const canEdit = capabilities.canEdit;

  function renderTab(value: Tab): React.JSX.Element {
    const selected = tab === value;
    return (
      <Pressable
        key={value}
        accessibilityRole="tab"
        accessibilityState={{ selected }}
        onPress={() => setTab(value)}
        style={[styles.segment, selected ? styles.segmentSelected : null]}
      >
        <Text style={[styles.segmentText, selected ? styles.segmentTextSelected : null]}>
          {TAB_LABELS[value]}
        </Text>
      </Pressable>
    );
  }

  function renderActiveCard(prescription: Prescription): React.JSX.Element {
    const discontinueBusy = busyKey === `discontinue:${prescription.id}`;
    return (
      <View key={prescription.id} style={styles.card}>
        <Text style={styles.cardTitle}>{prescription.prescribedByDoc}</Text>
        <Text style={styles.cardMeta}>
          Started <Text style={tabularNums}>{prescription.startDate}</Text>
        </Text>

        {prescription.items.map(item => {
          const refill = refillInfo(item);
          const doseBusy = busyKey === `dose:${item.id}`;
          return (
            <View key={item.id} style={styles.itemRow}>
              <Text style={styles.itemName}>
                {item.medicineName}
                {item.strength ? ` · ${item.strength}` : ''}
              </Text>
              <Text style={styles.itemMeta}>
                {item.timingSlot} · {item.administeredByLabel}
              </Text>
              <View style={styles.statsRow}>
                <Text style={[styles.stat, tabularNums]}>{item.remainingTablets} tablets left</Text>
                <Text style={[styles.stat, tabularNums]}>{item.dailyUnitsNeeded} per day</Text>
              </View>
              <View style={[styles.badge, refill.low ? styles.badgeLow : styles.badgeNormal]}>
                <Text style={[styles.badgeText, refill.low ? styles.badgeTextLow : null, tabularNums]}>
                  {refill.text}
                </Text>
              </View>
              {canEdit && item.isActive ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => void handleLogDose(prescription.id, item.id)}
                  disabled={doseBusy}
                  style={[styles.secondaryButton, doseBusy ? styles.disabled : null]}
                >
                  <Text style={styles.secondaryButtonText}>Log dose</Text>
                </Pressable>
              ) : null}
            </View>
          );
        })}

        {canEdit ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => confirmDiscontinue(prescription)}
            disabled={discontinueBusy}
            style={[styles.dangerButton, discontinueBusy ? styles.disabled : null]}
          >
            <Text style={styles.dangerButtonText}>Discontinue</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  function renderDiscontinuedCard(prescription: Prescription): React.JSX.Element {
    return (
      <View key={prescription.id} style={styles.card}>
        <Text style={styles.cardTitle}>{prescription.prescribedByDoc}</Text>
        <Text style={styles.cardMeta}>
          <Text style={tabularNums}>{prescription.startDate}</Text>
          {' → '}
          <Text style={tabularNums}>{prescription.endDate ?? '—'}</Text>
        </Text>
        <Text style={styles.cardMeta}>
          Duration <Text style={tabularNums}>{spanText(prescription)}</Text>
        </Text>
        {prescription.discontinuationNote ? (
          <Text style={styles.noteText}>Note: {prescription.discontinuationNote}</Text>
        ) : null}
        {prescription.items.map(item => (
          <Text key={item.id} style={styles.itemMeta}>
            {item.medicineName}
            {item.strength ? ` · ${item.strength}` : ''} · {item.timingSlot}
          </Text>
        ))}
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Prescriptions</Text>
        {canEdit ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => setScanVisible(true)}
            style={styles.primaryButton}
          >
            <Text style={styles.primaryButtonText}>Scan prescription</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.segmented} accessibilityRole="tablist">
        {renderTab('active')}
        {renderTab('discontinued')}
      </View>

      {actionError ? <Text style={styles.errorText}>{actionError}</Text> : null}

      <ScrollView contentContainerStyle={styles.listContent}>
        {tab === 'active' ? (
          activeList.length === 0 ? (
            <Text style={styles.emptyText}>No active medications.</Text>
          ) : (
            activeList.map(renderActiveCard)
          )
        ) : discontinuedList.length === 0 ? (
          <Text style={styles.emptyText}>No discontinued prescriptions.</Text>
        ) : (
          discontinuedList.map(renderDiscontinuedCard)
        )}
      </ScrollView>

      {canEdit ? (
        <PrescriptionScanSheet
          visible={scanVisible}
          patientId={patientId}
          onClose={() => setScanVisible(false)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.canvas,
    paddingTop: 48,
    paddingHorizontal: 16,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  segmented: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 8,
    padding: 4,
    marginBottom: 12,
  },
  segment: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 6,
  },
  segmentSelected: {
    backgroundColor: colors.primary,
  },
  segmentText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  segmentTextSelected: {
    color: colors.card,
  },
  listContent: {
    paddingBottom: 32,
    gap: 12,
  },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    gap: 6,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  cardMeta: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  noteText: {
    fontSize: 13,
    color: colors.textPrimary,
    fontStyle: 'italic',
  },
  itemRow: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    paddingTop: 8,
    gap: 4,
  },
  itemName: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  itemMeta: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 16,
  },
  stat: {
    fontSize: 13,
    color: colors.textPrimary,
  },
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  badgeLow: {
    backgroundColor: colors.amber,
    borderColor: colors.amber,
  },
  badgeNormal: {
    backgroundColor: colors.card,
    borderColor: colors.border,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  badgeTextLow: {
    color: colors.card,
  },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: colors.card,
    fontSize: 14,
    fontWeight: '600',
  },
  secondaryButton: {
    backgroundColor: colors.card,
    borderColor: colors.primary,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
    marginTop: 4,
  },
  secondaryButtonText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '600',
  },
  dangerButton: {
    borderColor: colors.error,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
    marginTop: 6,
  },
  dangerButtonText: {
    color: colors.error,
    fontSize: 14,
    fontWeight: '600',
  },
  emptyText: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 24,
  },
  errorText: {
    color: colors.error,
    fontSize: 14,
    marginBottom: 8,
  },
  disabled: {
    opacity: 0.5,
  },
});
