// Pure selectors for the dashboard. No Firebase import: inputs are plain data
// shaped like ARCHITECTURE_AND_DB.md §2, so these can be unit-tested directly.

export type AppointmentStatus = 'SCHEDULED' | 'ATTEND' | 'COMPLETED' | 'CANCELLED' | 'MISSED';

export interface AppointmentLike {
  id: string;
  scheduledAt: string;
  status: AppointmentStatus;
}

export interface PrescriptionItemLike {
  id: string;
  medicineName: string;
  timingSlot: string;
  dailyUnitsNeeded: number;
  administeredByLabel: string;
  remainingTablets: number;
  refillThresholdDays: number;
  isActive: boolean;
}

export interface PrescriptionLike {
  status: 'ACTIVE' | 'DISCONTINUED';
  items: readonly PrescriptionItemLike[];
}

export interface MedicationRow {
  itemId: string;
  medicineName: string;
  timingSlot: string;
  administeredByLabel: string;
  dailyUnitsNeeded: number;
  remainingTablets: number;
  daysLeft: number | null;
  isLowStock: boolean;
}

export interface MedicationSummary {
  totalDailyTablets: number;
  rows: MedicationRow[];
}

export interface BillLike {
  amount: number;
  paidByUserId: string;
}

export interface PayerTotal {
  payerId: string;
  amount: number;
}

export interface ExpenseSummary {
  total: number;
  byPayer: PayerTotal[];
}

export interface MonthRange {
  start: string;
  end: string;
}

const MONTH_NAMES: readonly string[] = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const ISO_LOCAL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

function pad2(value: number): string {
  return value < 10 ? `0${value}` : `${value}`;
}

// First and last calendar day of the month containing `date`, using local date parts.
export function monthRange(date: Date): MonthRange {
  const year = date.getFullYear();
  const month = date.getMonth();
  const lastDay = new Date(year, month + 1, 0).getDate();
  return {
    start: `${year}-${pad2(month + 1)}-01`,
    end: `${year}-${pad2(month + 1)}-${pad2(lastDay)}`,
  };
}

// Earliest upcoming appointment, ignoring COMPLETED, CANCELLED, and MISSED.
export function pickNextAppointment(appointments: readonly AppointmentLike[]): AppointmentLike | null {
  let best: AppointmentLike | null = null;
  let bestTime = Number.POSITIVE_INFINITY;
  for (const appointment of appointments) {
    if (
      appointment.status === 'COMPLETED' ||
      appointment.status === 'CANCELLED' ||
      appointment.status === 'MISSED'
    ) {
      continue;
    }
    const time = Date.parse(appointment.scheduledAt);
    if (Number.isNaN(time)) continue;
    if (time < bestTime) {
      best = appointment;
      bestTime = time;
    }
  }
  return best;
}

// Counts active items on ACTIVE prescriptions only. An item is low stock when its
// remaining supply covers no more than refillThresholdDays at the daily rate.
export function summarizeMedications(prescriptions: readonly PrescriptionLike[]): MedicationSummary {
  let totalDailyTablets = 0;
  const rows: MedicationRow[] = [];
  for (const prescription of prescriptions) {
    if (prescription.status !== 'ACTIVE') continue;
    for (const item of prescription.items) {
      if (!item.isActive) continue;
      totalDailyTablets += item.dailyUnitsNeeded;
      const daysLeft =
        item.dailyUnitsNeeded > 0 ? item.remainingTablets / item.dailyUnitsNeeded : null;
      rows.push({
        itemId: item.id,
        medicineName: item.medicineName,
        timingSlot: item.timingSlot,
        administeredByLabel: item.administeredByLabel,
        dailyUnitsNeeded: item.dailyUnitsNeeded,
        remainingTablets: item.remainingTablets,
        daysLeft,
        isLowStock: daysLeft !== null && daysLeft <= item.refillThresholdDays,
      });
    }
  }
  return { totalDailyTablets, rows };
}

// Total spend plus per-payer totals, largest first.
export function groupExpenseByPayer(bills: readonly BillLike[]): ExpenseSummary {
  let total = 0;
  const totals = new Map<string, number>();
  for (const bill of bills) {
    total += bill.amount;
    totals.set(bill.paidByUserId, (totals.get(bill.paidByUserId) ?? 0) + bill.amount);
  }
  const byPayer: PayerTotal[] = Array.from(totals, ([payerId, amount]) => ({ payerId, amount }));
  byPayer.sort((a, b) => b.amount - a.amount);
  return { total, byPayer };
}

// Formats 'YYYY-MM-DDTHH:mm[:ss]' (local, no timezone) as 'DD Mon YYYY, HH:mm'.
// Returns the input unchanged when it is not a valid local timestamp.
export function formatDateTime(value: string): string {
  const match = ISO_LOCAL_PATTERN.exec(value);
  if (!match) return value;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59) return value;
  const daysInMonth = new Date(year, month, 0).getDate();
  if (day > daysInMonth) return value;
  return `${pad2(day)} ${MONTH_NAMES[month - 1]} ${year}, ${pad2(hour)}:${pad2(minute)}`;
}
