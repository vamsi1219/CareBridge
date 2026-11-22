// Pure expense helpers for the sibling ledger. No Firebase or React Native imports.
// Amounts are INR. Synthetic demo data only.

export interface AmountLike {
  amount: number;
}

export interface PayerBillLike {
  amount: number;
  paidByUserId: string;
}

export interface PayerShare {
  paidByUserId: string;
  amount: number;
  sharePercent: number;
}

function roundTo(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

// Sum of all bill amounts, rounded to 2 decimals.
export function monthTotal(bills: AmountLike[]): number {
  let sum = 0;
  for (const bill of bills) {
    sum += bill.amount;
  }
  return roundTo(sum, 2);
}

// Per-payer totals with each payer's share of the overall total (1 decimal place).
// Sorted by amount, largest first. Empty input gives [].
export function splitByPayer(bills: PayerBillLike[]): PayerShare[] {
  if (bills.length === 0) return [];
  const totals = new Map<string, number>();
  let grand = 0;
  for (const bill of bills) {
    totals.set(bill.paidByUserId, (totals.get(bill.paidByUserId) ?? 0) + bill.amount);
    grand += bill.amount;
  }
  const shares: PayerShare[] = Array.from(totals, ([paidByUserId, rawAmount]) => {
    const amount = roundTo(rawAmount, 2);
    const sharePercent = grand > 0 ? roundTo((rawAmount / grand) * 100, 1) : 0;
    return { paidByUserId, amount, sharePercent };
  });
  shares.sort((a, b) => b.amount - a.amount);
  return shares;
}

function groupIndianDigits(integerDigits: string): string {
  if (integerDigits.length <= 3) return integerDigits;
  const last3 = integerDigits.slice(-3);
  const rest = integerDigits.slice(0, -3);
  const groups: string[] = [];
  let end = rest.length;
  while (end > 0) {
    const start = Math.max(0, end - 2);
    groups.unshift(rest.slice(start, end));
    end = start;
  }
  return `${groups.join(',')},${last3}`;
}

// '₹' + Indian digit grouping (12,34,567), at most 2 decimals, no trailing zeros.
// Non-finite input is treated as 0.
export function formatRupees(amount: number): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  const cents = Math.round(Math.abs(safe) * 100);
  const integerPart = Math.floor(cents / 100);
  const fractionPart = cents % 100;
  const integerText = groupIndianDigits(String(integerPart));
  let text = `₹${integerText}`;
  if (fractionPart !== 0) {
    const fraction = String(fractionPart).padStart(2, '0').replace(/0+$/, '');
    text = `${text}.${fraction}`;
  }
  return cents !== 0 && safe < 0 ? `-${text}` : text;
}
