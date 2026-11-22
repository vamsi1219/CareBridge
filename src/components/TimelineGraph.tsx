import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { MedicalRecord, MonthlyCheckup } from '../types/carebridge';
import { colors, tabularNums } from '../theme/colors';

export type TimelineFilter = 'ALL' | 'APPOINTMENT_REPORT' | 'MONTHLY_CHECKUP';

export interface TimelineGraphProps {
  records: MedicalRecord[];
  checkups: MonthlyCheckup[];
  filter: TimelineFilter;
}

// Track colours are local: they are not part of src/theme/colors.ts.
const TRACK_A_COLOR = '#4338CA'; // Track A: Appointment Reports (indigo)
const TRACK_B_COLOR = '#047857'; // Track B: Monthly Checkups (emerald)

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

interface TimelinePoint {
  key: string;
  time: number;
  dateText: string;
  label: string;
}

interface LaneProps {
  title: string;
  color: string;
  points: TimelinePoint[];
  min: number;
  span: number;
}

interface LegendSwatchProps {
  color: string;
  label: string;
}

// Parses 'YYYY-MM-DD' into local-midnight milliseconds. Returns null when malformed.
function parseDateOnly(value: string): number | null {
  const match = DATE_ONLY.exec(value);
  if (match === null) return null;
  const time = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime();
  return Number.isNaN(time) ? null : time;
}

function LegendSwatch({ color, label }: LegendSwatchProps): React.JSX.Element {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

function Lane({ title, color, points, min, span }: LaneProps): React.JSX.Element {
  return (
    <View style={styles.lane}>
      <Text style={[styles.laneTitle, { color }]}>{title}</Text>
      <View style={styles.track}>
        <View style={styles.trackLine} />
        {points.map(point => {
          // Position is the proportion of the min→max date range; a single date sits mid-lane.
          const pct = span === 0 ? 50 : ((point.time - min) / span) * 100;
          const left = `${pct}%` as const;
          return (
            <View key={point.key} style={[styles.point, { left }]}>
              <View style={[styles.dot, { backgroundColor: color }]} />
              <Text style={styles.pointLabel} numberOfLines={1}>
                {point.label}
              </Text>
              <Text style={[styles.pointDate, tabularNums]} numberOfLines={1}>
                {point.dateText}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

export default function TimelineGraph({
  records,
  checkups,
  filter,
}: TimelineGraphProps): React.JSX.Element {
  const showTrackA = filter !== 'MONTHLY_CHECKUP';
  const showTrackB = filter !== 'APPOINTMENT_REPORT';

  const trackA = useMemo<TimelinePoint[]>(() => {
    if (!showTrackA) return [];
    return records
      .filter(record => record.recordCategory === 'APPOINTMENT_REPORT')
      .flatMap((record): TimelinePoint[] => {
        const time = parseDateOnly(record.recordDate);
        if (time === null) return [];
        return [{ key: `A-${record.id}`, time, dateText: record.recordDate, label: record.title }];
      });
  }, [records, showTrackA]);

  const trackB = useMemo<TimelinePoint[]>(() => {
    if (!showTrackB) return [];
    return checkups.flatMap((checkup): TimelinePoint[] => {
      const time = parseDateOnly(checkup.checkupDate);
      if (time === null) return [];
      return [
        {
          key: `B-${checkup.id}`,
          time,
          dateText: checkup.checkupDate,
          label: checkup.checkupCycle,
        },
      ];
    });
  }, [checkups, showTrackB]);

  // Range is computed over the visible items so the chosen track fills the lane.
  const bounds = useMemo(() => {
    const points = [...trackA, ...trackB];
    const [head] = points;
    if (head === undefined) return null;
    let first = head;
    let last = head;
    for (const point of points) {
      if (point.time < first.time) first = point;
      if (point.time > last.time) last = point;
    }
    return {
      min: first.time,
      span: last.time - first.time,
      minText: first.dateText,
      maxText: last.dateText,
    };
  }, [trackA, trackB]);

  return (
    <View style={styles.card}>
      <View style={styles.legend}>
        <LegendSwatch color={TRACK_A_COLOR} label="Appointment reports" />
        <LegendSwatch color={TRACK_B_COLOR} label="Monthly checkups" />
      </View>

      {bounds === null ? (
        <Text style={styles.empty}>No entries in this range.</Text>
      ) : (
        <>
          {showTrackA ? (
            <Lane
              title="Appointment reports"
              color={TRACK_A_COLOR}
              points={trackA}
              min={bounds.min}
              span={bounds.span}
            />
          ) : null}
          {showTrackB ? (
            <Lane
              title="Monthly checkups"
              color={TRACK_B_COLOR}
              points={trackB}
              min={bounds.min}
              span={bounds.span}
            />
          ) : null}
          <View style={styles.axis}>
            <Text style={[styles.axisText, tabularNums]}>{bounds.minText}</Text>
            <Text style={[styles.axisText, tabularNums]}>{bounds.maxText}</Text>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
  },
  legend: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 4,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendText: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  lane: {
    marginTop: 12,
  },
  laneTitle: {
    fontSize: 12,
    fontWeight: '600',
  },
  track: {
    height: 60,
    marginHorizontal: 48,
    position: 'relative',
  },
  trackLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 5,
    height: 2,
    backgroundColor: colors.border,
  },
  point: {
    position: 'absolute',
    top: 0,
    width: 96,
    marginLeft: -48,
    alignItems: 'center',
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  pointLabel: {
    marginTop: 4,
    width: 96,
    fontSize: 11,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  pointDate: {
    width: 96,
    fontSize: 10,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  axis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginHorizontal: 48,
    marginTop: 8,
  },
  axisText: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  empty: {
    fontSize: 14,
    color: colors.textSecondary,
    marginVertical: 12,
  },
});
