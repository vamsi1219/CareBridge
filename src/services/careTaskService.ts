import { db } from '../config/firebase';
import {
  collection,
  doc,
  type DocumentData,
  type FieldValue,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import type { ActivityLog, CareCircleMember, CareTask } from '../types/carebridge';
import { localStore, withTimeout } from './localStore';
import { getCapabilities } from './permissions';

// Activity log as written: createdAt is a server timestamp, not an ISO string.
type TaskActivityWrite = Omit<ActivityLog, 'id' | 'createdAt'> & {
  id: string;
  createdAt: FieldValue;
};

// Marks a care task COMPLETED and records an immutable TASKS audit entry in the same batch.
export async function completeCareTask(
  patientId: string,
  task: { id: string; title: string },
  actor: { uid: string; name: string },
): Promise<void> {
  const now = new Date().toISOString();
  const batch = writeBatch(db);

  const taskRef = doc(db, 'patients', patientId, 'careTasks', task.id);
  batch.update(taskRef, {
    status: 'COMPLETED',
    completedById: actor.uid,
    completedAt: serverTimestamp(),
  });

  const logRef = doc(collection(db, 'patients', patientId, 'activityLogs'));
  const log: TaskActivityWrite = {
    id: logRef.id,
    patientId,
    moduleName: 'TASKS',
    actionType: 'TASK_COMPLETED',
    entityType: 'careTask',
    entityId: task.id,
    actorUserId: actor.uid,
    actorName: actor.name,
    summaryText: `${actor.name} completed "${task.title}"`,
    createdAt: serverTimestamp(),
  };
  batch.set(logRef, log);

  localStore.upsertTask(patientId, {
    id: task.id,
    patientId,
    taskType: 'GENERAL',
    title: task.title,
    status: 'COMPLETED',
    createdById: actor.uid,
    completedById: actor.uid,
    completedAt: now,
    createdAt: now,
  });
  localStore.addActivityLog(patientId, {
    id: logRef.id,
    patientId,
    moduleName: 'TASKS',
    actionType: 'TASK_COMPLETED',
    entityType: 'careTask',
    entityId: task.id,
    actorUserId: actor.uid,
    actorName: actor.name,
    summaryText: `${actor.name} completed "${task.title}"`,
    createdAt: now,
  });

  await withTimeout(batch.commit(), 1500, () => undefined);
}

// Live list of PENDING care tasks for a patient, soonest due first.
// Requires a composite Firestore index on careTasks (status, dueDate).
export function subscribePendingTasks(
  patientId: string,
  cb: (tasks: CareTask[]) => void,
): Unsubscribe {
  const initial = localStore.getPendingTasks(patientId);
  if (initial.length > 0) {
    cb(initial);
  }

  const timer = setTimeout(() => {
    cb(localStore.getPendingTasks(patientId));
  }, 1200);

  const unsubLocal = localStore.onTasksChange(patientId, () => {
    cb(localStore.getPendingTasks(patientId));
  });

  const q = query(
    collection(db, 'patients', patientId, 'careTasks'),
    where('status', '==', 'PENDING'),
    orderBy('dueDate'),
  );
  let unsubRemote: Unsubscribe = () => {};
  try {
    unsubRemote = onSnapshot(
      q,
      snap => {
        clearTimeout(timer);
        const list = snap.docs.map(d => ({ ...(d.data() as CareTask), id: d.id }));
        list.forEach(t => localStore.upsertTask(patientId, t));
        cb(localStore.getPendingTasks(patientId));
      },
      () => {
        clearTimeout(timer);
        cb(localStore.getPendingTasks(patientId));
      },
    );
  } catch {
    clearTimeout(timer);
    cb(localStore.getPendingTasks(patientId));
  }

  return () => {
    clearTimeout(timer);
    unsubLocal();
    unsubRemote();
  };
}

// Care task as written: createdAt is a server timestamp, not an ISO string.
type CareTaskWrite = Omit<CareTask, 'createdAt'> & {
  createdAt: FieldValue;
};

export interface CreateCareTaskInput {
  taskType: CareTask['taskType'];
  title: string;
  dueDate?: string;
  assignedToUserId?: string;
  assignedInviteEmail?: string;
}

const DUE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// localStore only exposes PENDING tasks, so this cache holds every task seen by
// subscribeAllTasks or created here. Remote snapshots overwrite entries by id.
const allTasksByPatient = new Map<string, Map<string, CareTask>>();

function rememberTask(patientId: string, task: CareTask): void {
  let map = allTasksByPatient.get(patientId);
  if (!map) {
    map = new Map<string, CareTask>();
    allTasksByPatient.set(patientId, map);
  }
  map.set(task.id, task);
  localStore.upsertTask(patientId, task);
}

// Remote createdAt/completedAt can be Firestore Timestamps; normalise to ISO strings.
function toIsoString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'toDate' in value) {
    const toDate = (value as { toDate: unknown }).toDate;
    if (typeof toDate === 'function') {
      const date = (toDate as () => Date).call(value);
      if (!Number.isNaN(date.getTime())) return date.toISOString();
    }
  }
  return '';
}

function toCareTask(id: string, data: DocumentData, patientId: string): CareTask {
  const task: CareTask = {
    ...(data as CareTask),
    id,
    patientId,
    createdAt: toIsoString(data.createdAt),
  };
  if (data.completedAt !== undefined && data.completedAt !== null) {
    task.completedAt = toIsoString(data.completedAt);
  }
  return task;
}

// Union of cached snapshot tasks and PENDING local mirrors, newest first.
function mergedTasks(patientId: string): CareTask[] {
  const byId = new Map<string, CareTask>();
  for (const t of localStore.getPendingTasks(patientId)) {
    byId.set(t.id, t);
  }
  const cached = allTasksByPatient.get(patientId);
  if (cached) {
    for (const t of Array.from(cached.values())) {
      byId.set(t.id, t);
    }
  }
  return Array.from(byId.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// Reads the actor's own accepted membership and throws unless it can edit care tasks.
async function assertCanEditTasks(patientId: string, uid: string): Promise<void> {
  const localMe =
    localStore
      .getMembers(patientId)
      .find(m => m.userId === uid && m.inviteStatus === 'ACCEPTED') ?? null;
  if (localMe && getCapabilities(localMe).canEdit) {
    return;
  }

  const snap = await withTimeout(
    getDocs(query(collection(db, 'patients', patientId, 'members'), where('userId', '==', uid))),
    2000,
    () => null,
  );
  const me: CareCircleMember | null = snap
    ? snap.docs
        .map(d => ({ ...(d.data() as CareCircleMember), id: d.id }))
        .find(m => m.inviteStatus === 'ACCEPTED') ?? localMe
    : localMe;
  if (getCapabilities(me).canEdit) {
    return;
  }
  if (me?.rolePreset === 'OBSERVER') {
    throw new Error('Read-only role');
  }
  throw new Error('Only a care circle member with edit access can add tasks.');
}

// Creates a PENDING care task and a TASKS audit entry in one batch.
export async function createCareTask(
  patientId: string,
  actor: { uid: string; name: string },
  input: CreateCareTaskInput,
): Promise<string> {
  await assertCanEditTasks(patientId, actor.uid);

  const title = input.title.trim();
  if (!title) throw new Error('Task title is required.');
  const dueDate = input.dueDate?.trim() ?? '';
  if (dueDate && !DUE_DATE_PATTERN.test(dueDate)) {
    throw new Error('Due date must be YYYY-MM-DD.');
  }
  const assignee = input.assignedToUserId?.trim() ?? '';
  const assigneeEmail = input.assignedInviteEmail?.trim().toLowerCase() ?? '';

  const taskRef = doc(collection(db, 'patients', patientId, 'careTasks'));
  const taskId = taskRef.id;
  const now = new Date().toISOString();

  const localTask: CareTask = {
    id: taskId,
    patientId,
    taskType: input.taskType,
    title,
    status: 'PENDING',
    createdById: actor.uid,
    createdAt: now,
  };
  if (dueDate) localTask.dueDate = dueDate;
  if (assignee) localTask.assignedToUserId = assignee;
  if (assigneeEmail) localTask.assignedInviteEmail = assigneeEmail;

  const batch = writeBatch(db);
  const taskWrite: CareTaskWrite = { ...localTask, createdAt: serverTimestamp() };
  batch.set(taskRef, taskWrite);

  const logRef = doc(collection(db, 'patients', patientId, 'activityLogs'));
  const log: TaskActivityWrite = {
    id: logRef.id,
    patientId,
    moduleName: 'TASKS',
    actionType: 'TASK_CREATED',
    entityType: 'careTask',
    entityId: taskId,
    actorUserId: actor.uid,
    actorName: actor.name,
    summaryText: `${actor.name} added task "${title}"`,
    createdAt: serverTimestamp(),
  };
  batch.set(logRef, log);

  rememberTask(patientId, localTask);
  localStore.addActivityLog(patientId, {
    id: logRef.id,
    patientId,
    moduleName: 'TASKS',
    actionType: 'TASK_CREATED',
    entityType: 'careTask',
    entityId: taskId,
    actorUserId: actor.uid,
    actorName: actor.name,
    summaryText: `${actor.name} added task "${title}"`,
    createdAt: now,
  });

  await withTimeout(batch.commit(), 1500, () => undefined);
  return taskId;
}

// Live list of ALL care tasks for a patient (no status filter), newest first.
export function subscribeAllTasks(
  patientId: string,
  cb: (tasks: CareTask[]) => void,
): Unsubscribe {
  const emit = (): void => {
    cb(mergedTasks(patientId));
  };

  const initial = mergedTasks(patientId);
  if (initial.length > 0) {
    cb(initial);
  }

  const timer = setTimeout(emit, 1200);
  const unsubLocal = localStore.onTasksChange(patientId, emit);

  const q = query(
    collection(db, 'patients', patientId, 'careTasks'),
    orderBy('createdAt', 'desc'),
  );
  let unsubRemote: Unsubscribe = () => {};
  try {
    unsubRemote = onSnapshot(
      q,
      snap => {
        clearTimeout(timer);
        snap.docs.forEach(d => {
          rememberTask(patientId, toCareTask(d.id, d.data(), patientId));
        });
        emit();
      },
      () => {
        clearTimeout(timer);
        emit();
      },
    );
  } catch {
    clearTimeout(timer);
    emit();
  }

  return () => {
    clearTimeout(timer);
    unsubLocal();
    unsubRemote();
  };
}
