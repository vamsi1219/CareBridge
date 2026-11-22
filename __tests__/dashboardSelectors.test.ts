import {
  formatDateTime,
  groupExpenseByPayer,
  monthRange,
  pickNextAppointment,
  summarizeMedications,
} from '../src/services/dashboardSelectors';

describe('monthRange', () => {
  it('returns the first and last calendar day of the month as YYYY-MM-DD', () => {
    expect(monthRange(new Date(2026, 4, 15))).toEqual({
      start: '2026-05-01',
      end: '2026-05-31',
    });
  });

  it('handles a leap-year February', () => {
    expect(monthRange(new Date(2028, 1, 10))).toEqual({
      start: '2028-02-01',
      end: '2028-02-29',
    });
  });
});

describe('pickNextAppointment', () => {
  it('skips COMPLETED and CANCELLED and returns the earliest remaining one', () => {
    const next = pickNextAppointment([
      { id: 'a', scheduledAt: '2026-05-01T09:00:00', status: 'COMPLETED' },
      { id: 'b', scheduledAt: '2026-05-02T09:00:00', status: 'CANCELLED' },
      { id: 'c', scheduledAt: '2026-06-02T11:00:00', status: 'SCHEDULED' },
      { id: 'd', scheduledAt: '2026-06-01T10:00:00', status: 'ATTEND' },
    ] as never[]);
    expect(next?.id).toBe('d');
  });

  it('returns null when nothing is upcoming', () => {
    expect(
      pickNextAppointment([
        { id: 'a', scheduledAt: '2026-05-01T09:00:00', status: 'COMPLETED' },
      ] as never[]),
    ).toBeNull();
  });
});

describe('summarizeMedications', () => {
  it('counts only active items, flags low stock, and ignores inactive items', () => {
    const summary = summarizeMedications([
      {
        status: 'ACTIVE',
        items: [
          {
            id: 'i1',
            medicineName: 'Med A',
            timingSlot: 'MORNING',
            dailyUnitsNeeded: 2,
            administeredByLabel: 'Asha',
            remainingTablets: 10,
            refillThresholdDays: 5,
            isActive: true,
          },
          {
            id: 'i2',
            medicineName: 'Med B',
            timingSlot: 'NIGHT',
            dailyUnitsNeeded: 1,
            administeredByLabel: 'Ravi',
            remainingTablets: 30,
            refillThresholdDays: 5,
            isActive: true,
          },
          {
            id: 'i3',
            medicineName: 'Old',
            timingSlot: 'NIGHT',
            dailyUnitsNeeded: 1,
            administeredByLabel: 'Ravi',
            remainingTablets: 0,
            refillThresholdDays: 5,
            isActive: false,
          },
        ],
      },
      {
        status: 'DISCONTINUED',
        items: [
          {
            id: 'i4',
            medicineName: 'Stopped',
            timingSlot: 'MORNING',
            dailyUnitsNeeded: 1,
            administeredByLabel: 'Asha',
            remainingTablets: 1,
            refillThresholdDays: 5,
            isActive: true,
          },
        ],
      },
    ] as never[]);

    expect(summary.totalDailyTablets).toBe(3);
    expect(summary.rows.map(r => r.medicineName)).toEqual(['Med A', 'Med B']);
    expect(summary.rows[0].isLowStock).toBe(true); // 10 / 2 = 5 days <= 5
    expect(summary.rows[1].isLowStock).toBe(false); // 30 / 1 = 30 days
  });
});

describe('groupExpenseByPayer', () => {
  it('totals amounts and groups them by paidByUserId, largest first', () => {
    const result = groupExpenseByPayer([
      { amount: 100, paidByUserId: 'u1' },
      { amount: 300, paidByUserId: 'u2' },
      { amount: 50, paidByUserId: 'u1' },
    ] as never[]);
    expect(result.total).toBe(450);
    expect(result.byPayer).toEqual([
      { payerId: 'u2', amount: 300 },
      { payerId: 'u1', amount: 150 },
    ]);
  });
});

describe('formatDateTime', () => {
  it('formats a local ISO timestamp as DD Mon YYYY, HH:mm', () => {
    expect(formatDateTime('2026-06-01T09:05:00')).toBe('01 Jun 2026, 09:05');
  });

  it('returns the input unchanged when it is not a valid date', () => {
    expect(formatDateTime('not-a-date')).toBe('not-a-date');
  });
});
