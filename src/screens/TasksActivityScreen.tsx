import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import ActivityFeedList from '../components/ActivityFeedList';
import { useAuth } from '../hooks/useAuth';
import { useActivePatient } from '../hooks/useCareCircle';
import { usePermissions } from '../hooks/usePermissions';
import {
  completeCareTask,
  createCareTask,
  subscribeAllTasks,
} from '../services/careTaskService';
import { colors, tabularNums } from '../theme/colors';
import type { CareTask } from '../types/carebridge';

type TaskType = CareTask['taskType'];
type Tab = 'OPEN' | 'COMPLETED';

const TASK_TYPES: TaskType[] = ['REFILL', 'APPOINTMENT_PREP', 'LAB_BOOKING', 'GENERAL'];

const TASK_TYPE_LABELS: Record<TaskType, string> = {
  REFILL: 'Refill',
  APPOINTMENT_PREP: 'Appointment prep',
  LAB_BOOKING: 'Lab booking',
  GENERAL: 'General',
};

const DUE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Open and completed task lists for the active patient, with quick-complete and a
// new-task form for members who can edit. Synthetic demo data only; no medical advice.
export default function TasksActivityScreen(): React.JSX.Element {
  const { currentUser } = useAuth();
  const { patientId } = useActivePatient();
  const { capabilities } = usePermissions(patientId);

  const [tab, setTab] = useState<Tab>('OPEN');
  const [tasks, setTasks] = useState<CareTask[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);

  const [taskType, setTaskType] = useState<TaskType>('GENERAL');
  const [title, setTitle] = useState<string>('');
  const [dueDate, setDueDate] = useState<string>('');
  const [assignee, setAssignee] = useState<string>('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);

  useEffect(() => {
    if (!patientId) {
      setTasks([]);
      return undefined;
    }
    return subscribeAllTasks(patientId, setTasks);
  }, [patientId]);

  const openTasks = useMemo(() => tasks.filter(t => t.status === 'PENDING'), [tasks]);
  const doneTasks = useMemo(() => tasks.filter(t => t.status === 'COMPLETED'), [tasks]);

  if (!patientId) {
    return (
      <View style={styles.screen}>
        <Text style={styles.message}>No care workspace selected.</Text>
      </View>
    );
  }

  const actor = currentUser ? { uid: currentUser.id, name: currentUser.fullName } : null;
  const visible = tab === 'OPEN' ? openTasks : doneTasks;

  const handleComplete = async (task: CareTask): Promise<void> => {
    if (!actor) return;
    setActionError(null);
    try {
      await completeCareTask(patientId, { id: task.id, title: task.title }, actor);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not complete the task.');
    }
  };

  const handleCreate = async (): Promise<void> => {
    if (!actor || submitting) return;
    const trimmedTitle = title.trim();
    const trimmedDue = dueDate.trim();
    if (!trimmedTitle) {
      setFormError('Title is required.');
      return;
    }
    if (trimmedDue && !DUE_DATE_PATTERN.test(trimmedDue)) {
      setFormError('Due date must be YYYY-MM-DD.');
      return;
    }
    setFormError(null);
    setSubmitting(true);
    try {
      await createCareTask(patientId, actor, {
        taskType,
        title: trimmedTitle,
        dueDate: trimmedDue || undefined,
        assignedToUserId: assignee.trim() || undefined,
      });
      setTitle('');
      setDueDate('');
      setAssignee('');
      setTaskType('GENERAL');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not add the task.');
    } finally {
      setSubmitting(false);
    }
  };

  const renderTask = (task: CareTask): React.JSX.Element => {
    const isPending = task.status === 'PENDING';
    const assigneeLabel = task.assignedToUserId || task.assignedInviteEmail || 'Unassigned';
    return (
      <View key={task.id} style={[styles.taskRow, isPending && styles.taskRowPending]}>
        <View style={styles.taskBody}>
          <Text style={styles.taskTitle}>{task.title}</Text>
          <View style={styles.metaRow}>
            <View style={styles.chip}>
              <Text style={styles.chipText}>{TASK_TYPE_LABELS[task.taskType]}</Text>
            </View>
            <Text style={styles.meta}>Assignee: {assigneeLabel}</Text>
          </View>
          <Text style={[styles.due, isPending && styles.amberText, tabularNums]}>
            Due: {task.dueDate || 'No due date'}
          </Text>
        </View>
        {isPending && capabilities.canCompleteTasks ? (
          <Pressable
            onPress={() => void handleComplete(task)}
            accessibilityRole="button"
            accessibilityLabel={`Mark ${task.title} complete`}
            style={styles.completeButton}
          >
            <Text style={styles.completeText}>Complete</Text>
          </Pressable>
        ) : null}
      </View>
    );
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.segmented} accessibilityRole="tablist">
        {(
          [
            { key: 'OPEN', label: 'Open' },
            { key: 'COMPLETED', label: 'Completed' },
          ] as const
        ).map(segment => {
          const selected = tab === segment.key;
          return (
            <Pressable
              key={segment.key}
              onPress={() => setTab(segment.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              style={[styles.segment, selected && styles.segmentSelected]}
            >
              <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>
                {segment.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {actionError ? <Text style={styles.error}>{actionError}</Text> : null}

      <View style={styles.card}>
        {visible.length === 0 ? (
          <Text style={styles.message}>
            {tab === 'OPEN' ? 'No open tasks.' : 'No completed tasks.'}
          </Text>
        ) : (
          visible.map(renderTask)
        )}
      </View>

      {capabilities.canEdit ? (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>New task</Text>
          <View style={styles.chipRow}>
            {TASK_TYPES.map(type => {
              const selected = type === taskType;
              return (
                <Pressable
                  key={type}
                  onPress={() => setTaskType(type)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  style={[styles.chip, selected && styles.chipSelected]}
                >
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                    {TASK_TYPE_LABELS[type]}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.label}>Title</Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="e.g. Collect refill from pharmacy"
            accessibilityLabel="Task title"
            style={styles.input}
          />

          <Text style={styles.label}>Due date (YYYY-MM-DD, optional)</Text>
          <TextInput
            value={dueDate}
            onChangeText={setDueDate}
            placeholder="2026-06-30"
            autoCapitalize="none"
            accessibilityLabel="Due date"
            style={[styles.input, tabularNums]}
          />

          <Text style={styles.label}>Assign to user ID (optional)</Text>
          <TextInput
            value={assignee}
            onChangeText={setAssignee}
            autoCapitalize="none"
            accessibilityLabel="Assignee user ID"
            style={styles.input}
          />

          {formError ? <Text style={styles.error}>{formError}</Text> : null}

          <Pressable
            onPress={() => void handleCreate()}
            disabled={submitting}
            accessibilityRole="button"
            style={[styles.primaryButton, submitting && styles.disabled]}
          >
            <Text style={styles.primaryText}>{submitting ? 'Saving…' : 'Add task'}</Text>
          </Pressable>
        </View>
      ) : null}

      <Text style={styles.sectionTitle}>Who did what</Text>
      <ActivityFeedList patientId={patientId} />
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
    gap: 12,
  },
  message: {
    color: colors.textSecondary,
    fontSize: 14,
    padding: 8,
  },
  sectionTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '600',
  },
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 16,
    gap: 8,
  },
  segmented: {
    flexDirection: 'row',
    backgroundColor: colors.border,
    borderRadius: 10,
    padding: 4,
  },
  segment: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 8,
  },
  segmentSelected: {
    backgroundColor: colors.card,
  },
  segmentText: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: '600',
  },
  segmentTextSelected: {
    color: colors.primary,
  },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingLeft: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  taskRowPending: {
    borderLeftWidth: 4,
    borderLeftColor: colors.amber,
  },
  taskBody: {
    flex: 1,
    gap: 4,
  },
  taskTitle: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '600',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  meta: {
    color: colors.textSecondary,
    fontSize: 12,
  },
  due: {
    color: colors.textSecondary,
    fontSize: 12,
  },
  amberText: {
    color: colors.amber,
  },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: colors.canvas,
  },
  chipSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  chipText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  chipTextSelected: {
    color: colors.card,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  completeButton: {
    marginLeft: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: colors.primary,
  },
  completeText: {
    color: colors.card,
    fontSize: 13,
    fontWeight: '600',
  },
  label: {
    color: colors.textSecondary,
    fontSize: 13,
    marginTop: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.textPrimary,
    backgroundColor: colors.card,
  },
  primaryButton: {
    marginTop: 8,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: colors.primary,
  },
  primaryText: {
    color: colors.card,
    fontSize: 15,
    fontWeight: '600',
  },
  disabled: {
    opacity: 0.6,
  },
  error: {
    color: colors.error,
    fontSize: 13,
  },
});
