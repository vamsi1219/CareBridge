// Pure duration helpers for prescription supply and treatment spans.
// No Firebase or React Native imports; synthetic demo data only.

const DAYS_PER_MONTH = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

// Whole days the remaining supply lasts at the daily rate.
// Infinity when there is no daily consumption (nothing to run out of).
export function daysRemaining(remainingTablets: number, dailyUnitsNeeded: number): number {
  if (dailyUnitsNeeded <= 0) return Number.POSITIVE_INFINITY;
  return Math.floor(Math.max(0, remainingTablets) / dailyUnitsNeeded);
}

// True when the remaining supply covers no more than refillThresholdDays.
// Items with no daily consumption (Infinity) are never low stock.
export function isLowStock(
  remainingTablets: number,
  dailyUnitsNeeded: number,
  refillThresholdDays: number,
): boolean {
  const days = daysRemaining(remainingTablets, dailyUnitsNeeded);
  if (days === Number.POSITIVE_INFINITY) return false;
  return days <= refillThresholdDays;
}

// Human-readable span: "1 day", "12 days", "2 mo", "2 mo 5 days". Uses 30-day months.
export function formatDurationDays(totalDays: number): string {
  const days = Math.max(0, Math.floor(totalDays));
  if (days < DAYS_PER_MONTH) {
    return days === 1 ? '1 day' : `${days} days`;
  }
  const months = Math.floor(days / DAYS_PER_MONTH);
  const remainder = days % DAYS_PER_MONTH;
  if (remainder === 0) {
    return `${months} mo`;
  }
  const dayPart = remainder === 1 ? '1 day' : `${remainder} days`;
  return `${months} mo ${dayPart}`;
}

// Inclusive day count between two 'YYYY-MM-DD' dates (end - start + 1).
// Returns 0 when either input is malformed or end is before start.
export function durationBetween(startDate: string, endDate: string): number {
  const start = parseDateOnlyUtc(startDate);
  const end = parseDateOnlyUtc(endDate);
  if (start === null || end === null) return 0;
  if (end < start) return 0;
  return Math.round((end - start) / MS_PER_DAY) + 1;
}

// Parses 'YYYY-MM-DD' as local calendar parts, returned as UTC midnight so that
// day differences are not affected by daylight-saving shifts. Null when invalid.
function parseDateOnlyUtc(value: string): number | null {
  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return null;
  const time = Date.UTC(year, month - 1, day);
  const check = new Date(time);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    return null;
  }
  return time;
}
