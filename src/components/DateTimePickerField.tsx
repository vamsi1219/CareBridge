import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, tabularNums } from '../theme/colors';

const ISO_MINUTE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DEFAULT_TIME = '09:00';

const MONTH_NAMES: string[] = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const WEEKDAY_NAMES: string[] = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HOUR_OPTIONS: string[] = Array.from({ length: 24 }, (_unused, i) => pad2(i));
const MINUTE_OPTIONS: string[] = Array.from({ length: 12 }, (_unused, i) => pad2(i * 5));

interface DateParts {
  year: number;
  month: number;
  day: number;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function toDateString(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function todayDateString(): string {
  const now = new Date();
  return toDateString(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

function parseDateParts(date: string): DateParts | null {
  const match = DATE_RE.exec(date);
  if (!match) {
    return null;
  }
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function formatDisplayDate(date: string): string {
  const parts = parseDateParts(date);
  if (!parts) {
    return '';
  }
  return `${pad2(parts.day)} ${MONTH_NAMES[parts.month - 1]} ${parts.year}`;
}

export function toLocalIsoMinute(date: string, time: string): string {
  return `${date}T${time}`;
}

export function splitLocalIsoMinute(value: string): { date: string; time: string } {
  if (!ISO_MINUTE_RE.test(value)) {
    return { date: '', time: '' };
  }
  const [date, time] = value.split('T');
  return { date, time };
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

export interface DateTimePickerFieldProps {
  label: string;
  value: string;
  onChange: (next: string) => void;
  error?: string | null;
  mode?: 'datetime';
}

export default function DateTimePickerField({
  label,
  value,
  onChange,
  error = null,
}: DateTimePickerFieldProps): React.JSX.Element {
  const parts = splitLocalIsoMinute(value);
  const selectedDate = parts.date;
  const selectedTime = parts.time;

  const [openPicker, setOpenPicker] = useState<'date' | 'time' | null>(null);
  const [draftDate, setDraftDate] = useState<string>('');
  const [draftTime, setDraftTime] = useState<string>(DEFAULT_TIME);
  const [viewYear, setViewYear] = useState<number>(new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState<number>(new Date().getMonth() + 1);

  function closePicker(): void {
    setOpenPicker(null);
  }

  function openDatePicker(): void {
    const base = parseDateParts(selectedDate);
    const now = new Date();
    setViewYear(base ? base.year : now.getFullYear());
    setViewMonth(base ? base.month : now.getMonth() + 1);
    setDraftDate(selectedDate);
    setOpenPicker('date');
  }

  function openTimePicker(): void {
    setDraftTime(selectedTime || DEFAULT_TIME);
    setOpenPicker('time');
  }

  function shiftMonth(delta: number): void {
    const next = viewMonth + delta;
    if (next < 1) {
      setViewYear(viewYear - 1);
      setViewMonth(12);
    } else if (next > 12) {
      setViewYear(viewYear + 1);
      setViewMonth(1);
    } else {
      setViewMonth(next);
    }
  }

  function commitDate(): void {
    if (!draftDate) {
      closePicker();
      return;
    }
    const time = selectedTime || DEFAULT_TIME;
    onChange(toLocalIsoMinute(draftDate, time));
    closePicker();
  }

  function commitTime(): void {
    const date = selectedDate || todayDateString();
    onChange(toLocalIsoMinute(date, draftTime));
    closePicker();
  }

  const cells: (number | null)[] = [];
  const leading = new Date(viewYear, viewMonth - 1, 1).getDay();
  for (let i = 0; i < leading; i += 1) {
    cells.push(null);
  }
  const totalDays = daysInMonth(viewYear, viewMonth);
  for (let day = 1; day <= totalDays; day += 1) {
    cells.push(day);
  }
  while (cells.length % 7 !== 0) {
    cells.push(null);
  }

  const dateDisplay = formatDisplayDate(selectedDate);
  const timeDisplay = selectedTime;

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.row}>
        <Pressable
          onPress={openDatePicker}
          accessibilityRole="button"
          accessibilityLabel={`${label} date, ${dateDisplay || 'not set'}. Open date picker`}
          style={({ pressed }) => [styles.pickButton, pressed && styles.pressed]}
        >
          <Text style={[styles.pickText, dateDisplay ? styles.valueText : styles.placeholderText, tabularNums]}>
            {dateDisplay || 'Pick date'}
          </Text>
        </Pressable>
        <Pressable
          onPress={openTimePicker}
          accessibilityRole="button"
          accessibilityLabel={`${label} time, ${timeDisplay || 'not set'}. Open time picker`}
          style={({ pressed }) => [styles.pickButton, pressed && styles.pressed]}
        >
          <Text style={[styles.pickText, timeDisplay ? styles.valueText : styles.placeholderText, tabularNums]}>
            {timeDisplay || 'Pick time'}
          </Text>
        </Pressable>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Modal
        visible={openPicker === 'date'}
        transparent={false}
        animationType="slide"
        onRequestClose={closePicker}
      >
        <View style={styles.modalContainer}>
          <View style={styles.monthHeader}>
            <Pressable
              onPress={() => shiftMonth(-1)}
              accessibilityRole="button"
              accessibilityLabel="Previous month"
              style={styles.navButton}
            >
              <Text style={styles.navText}>Prev</Text>
            </Pressable>
            <Text style={[styles.monthTitle, tabularNums]}>
              {`${MONTH_NAMES[viewMonth - 1]} ${viewYear}`}
            </Text>
            <Pressable
              onPress={() => shiftMonth(1)}
              accessibilityRole="button"
              accessibilityLabel="Next month"
              style={styles.navButton}
            >
              <Text style={styles.navText}>Next</Text>
            </Pressable>
          </View>

          <View style={styles.weekRow}>
            {WEEKDAY_NAMES.map((name) => (
              <View key={name} style={styles.dayCell}>
                <Text style={styles.weekdayText}>{name}</Text>
              </View>
            ))}
          </View>

          <View style={styles.grid}>
            {cells.map((day, index) => {
              if (day === null) {
                return <View key={`blank-${index}`} style={styles.dayCell} />;
              }
              const dateStr = toDateString(viewYear, viewMonth, day);
              const isSelected = dateStr === draftDate;
              return (
                <Pressable
                  key={`day-${day}`}
                  onPress={() => setDraftDate(dateStr)}
                  accessibilityRole="button"
                  accessibilityLabel={`Select ${formatDisplayDate(dateStr)}`}
                  accessibilityState={{ selected: isSelected }}
                  style={[styles.dayCell, isSelected && styles.selected]}
                >
                  <Text style={[styles.dayText, isSelected && styles.selectedText, tabularNums]}>{day}</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.modalActions}>
            <Pressable
              onPress={closePicker}
              accessibilityRole="button"
              accessibilityLabel="Cancel date"
              style={styles.actionButton}
            >
              <Text style={styles.actionText}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={commitDate}
              accessibilityRole="button"
              accessibilityLabel="Done, confirm date"
              style={[styles.actionButton, styles.actionPrimary]}
            >
              <Text style={[styles.actionText, styles.selectedText]}>Done</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        visible={openPicker === 'time'}
        transparent={false}
        animationType="slide"
        onRequestClose={closePicker}
      >
        <View style={styles.modalContainer}>
          <Text style={styles.monthTitle}>Pick time</Text>
          <View style={styles.timeColumns}>
            <ScrollView style={styles.timeColumn} accessibilityLabel="Hours">
              {HOUR_OPTIONS.map((hour) => {
                const isSelected = hour === draftTime.slice(0, 2);
                return (
                  <Pressable
                    key={`hour-${hour}`}
                    onPress={() => setDraftTime(`${hour}:${draftTime.slice(3, 5) || '00'}`)}
                    accessibilityRole="button"
                    accessibilityLabel={`Hour ${hour}`}
                    accessibilityState={{ selected: isSelected }}
                    style={[styles.timeOption, isSelected && styles.selected]}
                  >
                    <Text style={[styles.timeOptionText, isSelected && styles.selectedText, tabularNums]}>
                      {hour}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <ScrollView style={styles.timeColumn} accessibilityLabel="Minutes">
              {MINUTE_OPTIONS.map((minute) => {
                const isSelected = minute === draftTime.slice(3, 5);
                return (
                  <Pressable
                    key={`minute-${minute}`}
                    onPress={() => setDraftTime(`${draftTime.slice(0, 2) || '09'}:${minute}`)}
                    accessibilityRole="button"
                    accessibilityLabel={`Minute ${minute}`}
                    accessibilityState={{ selected: isSelected }}
                    style={[styles.timeOption, isSelected && styles.selected]}
                  >
                    <Text style={[styles.timeOptionText, isSelected && styles.selectedText, tabularNums]}>
                      {minute}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>

          <View style={styles.modalActions}>
            <Pressable
              onPress={closePicker}
              accessibilityRole="button"
              accessibilityLabel="Cancel time"
              style={styles.actionButton}
            >
              <Text style={styles.actionText}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={commitTime}
              accessibilityRole="button"
              accessibilityLabel="Done, confirm time"
              style={[styles.actionButton, styles.actionPrimary]}
            >
              <Text style={[styles.actionText, styles.selectedText]}>Done</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 12,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 6,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  pickButton: {
    flex: 1,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
  pickText: {
    fontSize: 16,
  },
  valueText: {
    color: colors.textPrimary,
    fontWeight: '600',
  },
  placeholderText: {
    color: colors.textSecondary,
  },
  error: {
    marginTop: 6,
    fontSize: 13,
    color: colors.error,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: colors.card,
    paddingTop: 56,
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  monthHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  monthTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: 12,
  },
  navButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  navText: {
    fontSize: 16,
    color: colors.primary,
    fontWeight: '600',
  },
  weekRow: {
    flexDirection: 'row',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  dayCell: {
    width: '14.2857%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekdayText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  dayText: {
    fontSize: 16,
    color: colors.textPrimary,
  },
  selected: {
    backgroundColor: colors.primary,
    borderRadius: 999,
  },
  selectedText: {
    color: colors.card,
    fontWeight: '700',
  },
  timeColumns: {
    flexDirection: 'row',
    flex: 1,
    gap: 12,
  },
  timeColumn: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
  },
  timeOption: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  timeOptionText: {
    fontSize: 16,
    color: colors.textPrimary,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 16,
  },
  actionButton: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionPrimary: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  actionText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
  },
});
