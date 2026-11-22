export interface AppointmentReminderJob {
  appointmentId: string;
  patientId: string;
  hospitalName: string;
  scheduledAt: string;
  assignedAttendeeId?: string;
  recipientScope: 'ASSIGNEE' | 'CARE_CIRCLE';
  status: 'SCHEDULED' | 'CANCELLED';
  updatedAt: string;
}

const reminderJobs = new Map<string, AppointmentReminderJob>();

// Schedules or updates a local reminder job for an appointment.
// If assignedAttendeeId is set, targets that attendee first; otherwise notifies the active care circle.
export function scheduleAppointmentReminder(params: {
  appointmentId: string;
  patientId: string;
  hospitalName: string;
  scheduledAt: string;
  assignedAttendeeId?: string;
}): AppointmentReminderJob {
  const job: AppointmentReminderJob = {
    appointmentId: params.appointmentId,
    patientId: params.patientId,
    hospitalName: params.hospitalName,
    scheduledAt: params.scheduledAt,
    assignedAttendeeId: params.assignedAttendeeId,
    recipientScope: params.assignedAttendeeId ? 'ASSIGNEE' : 'CARE_CIRCLE',
    status: 'SCHEDULED',
    updatedAt: new Date().toISOString(),
  };
  reminderJobs.set(params.appointmentId, job);
  return job;
}

// Cancels any pending reminder immediately upon completion, cancellation, or missed status.
export function cancelAppointmentReminder(appointmentId: string): void {
  const existing = reminderJobs.get(appointmentId);
  if (existing) {
    reminderJobs.set(appointmentId, {
      ...existing,
      status: 'CANCELLED',
      updatedAt: new Date().toISOString(),
    });
  }
}

export function getAppointmentReminder(appointmentId: string): AppointmentReminderJob | null {
  return reminderJobs.get(appointmentId) ?? null;
}

export function clearAllAppointmentReminders(): void {
  reminderJobs.clear();
}
