import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../config/firebase';
import { colors, tabularNums } from '../theme/colors';
import { formatDateTime } from '../services/dashboardSelectors';
import { localStore } from '../services/localStore';
import type { ActivityLog } from '../types/carebridge';

interface Props {
  patientId: string;
}

interface FeedRow {
  id: string;
  actorName: string;
  summaryText: string;
  createdIso: string;
}

const pad = (n: number): string => (n < 10 ? `0${n}` : `${n}`);

// createdAt is an ISO string for older rows and a Firestore Timestamp for
// serverTimestamp() writes (null until the write is acknowledged locally).
function createdAtToLocalIso(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'toDate' in value) {
    const toDate = (value as { toDate: unknown }).toDate;
    if (typeof toDate === 'function') {
      const date = (toDate as () => Date).call(value);
      if (!Number.isNaN(date.getTime())) {
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
          date.getHours(),
        )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
      }
    }
  }
  return '';
}

function toFeedRows(logs: ActivityLog[]): FeedRow[] {
  return logs.slice(0, 10).map(l => ({
    id: l.id,
    actorName: String(l.actorName ?? ''),
    summaryText: String(l.summaryText ?? ''),
    createdIso: createdAtToLocalIso(l.createdAt),
  }));
}

export default function ActivityFeedList({ patientId }: Props): React.JSX.Element {
  const [rows, setRows] = useState<FeedRow[] | null>(null);
  const [failed, setFailed] = useState<boolean>(false);

  useEffect(() => {
    const initialLocal = localStore.getActivityLogs(patientId);
    setRows(initialLocal.length > 0 ? toFeedRows(initialLocal) : null);
    setFailed(false);

    const timer = setTimeout(() => {
      setRows(toFeedRows(localStore.getActivityLogs(patientId)));
    }, 1200);

    const unsubLocal = localStore.onActivityLogsChange(patientId, () => {
      setRows(toFeedRows(localStore.getActivityLogs(patientId)));
    });

    const q = query(
      collection(db, 'patients', patientId, 'activityLogs'),
      orderBy('createdAt', 'desc'),
      limit(10),
    );
    const unsubscribe = onSnapshot(
      q,
      snap => {
        clearTimeout(timer);
        const remote = snap.docs.map(d => {
          const data = d.data();
          return {
            ...(data as ActivityLog),
            id: d.id,
            createdAt: createdAtToLocalIso(data.createdAt),
          };
        });
        const merged = localStore.mergeActivityLogsFromRemote(patientId, remote);
        setRows(toFeedRows(merged));
      },
      () => {
        clearTimeout(timer);
        const local = localStore.getActivityLogs(patientId);
        if (local.length > 0) {
          setRows(toFeedRows(local));
        } else {
          setRows([]);
        }
      },
    );
    return () => {
      clearTimeout(timer);
      unsubLocal();
      unsubscribe();
    };
  }, [patientId]);

  return (
    <View style={styles.card}>
      {failed ? (
        <Text style={styles.message}>Could not load activity.</Text>
      ) : rows === null ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.textSecondary} />
        </View>
      ) : rows.length === 0 ? (
        <Text style={styles.message}>No activity yet.</Text>
      ) : (
        rows.map(row => (
          <View key={row.id} style={styles.row}>
            <Text style={styles.actor}>{row.actorName}</Text>
            <Text style={styles.summary}>{row.summaryText}</Text>
            <Text style={[styles.time, tabularNums]}>
              {row.createdIso ? formatDateTime(row.createdIso) : 'Saving…'}
            </Text>
          </View>
        ))
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
    padding: 16,
  },
  loading: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  message: {
    color: colors.textSecondary,
    fontSize: 14,
  },
  row: {
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  actor: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  summary: {
    color: colors.textSecondary,
    fontSize: 14,
    marginTop: 2,
  },
  time: {
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: 4,
  },
});
