import type { CareCircleMember } from '../types/carebridge';

export interface Capabilities {
  canView: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canManageMembers: boolean;
  canViewFinancials: boolean;
  canCompleteTasks: boolean;
}

const NONE: Capabilities = {
  canView: false,
  canEdit: false,
  canDelete: false,
  canManageMembers: false,
  canViewFinancials: false,
  canCompleteTasks: false,
};

// Pure business rules; no Firebase import so they can be unit-tested directly.
// A null member, or one whose invite is not ACCEPTED, has no capabilities.
export function getCapabilities(member: CareCircleMember | null): Capabilities {
  if (!member || member.inviteStatus !== 'ACCEPTED') return { ...NONE };

  const financialsFlag = member.canViewFinancials === true;
  let caps: Capabilities;

  switch (member.rolePreset) {
    case 'CO_CAREGIVER':
      caps = {
        canView: true,
        canEdit: true,
        canDelete: true,
        canManageMembers: true,
        canViewFinancials: financialsFlag,
        canCompleteTasks: true,
      };
      break;
    case 'CONTRIBUTOR':
      caps = {
        canView: true,
        canEdit: true,
        canDelete: false,
        canManageMembers: member.isBackupAdmin === true,
        canViewFinancials: financialsFlag,
        canCompleteTasks: true,
      };
      break;
    case 'OBSERVER':
      caps = {
        canView: true,
        canEdit: false,
        canDelete: false,
        canManageMembers: member.isBackupAdmin === true,
        canViewFinancials: financialsFlag,
        canCompleteTasks: false,
      };
      break;
    default:
      caps = { ...NONE };
  }

  return caps;
}
