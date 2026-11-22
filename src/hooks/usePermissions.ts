import { useEffect, useMemo, useState } from 'react';
import { useAuth } from './useAuth';
import { subscribeMyMembership } from '../services/careCircleService';
import { getCapabilities, type Capabilities } from '../services/permissions';
import type { CareCircleMember } from '../types/carebridge';

export interface PermissionsState {
  member: CareCircleMember | null;
  capabilities: Capabilities;
  loading: boolean;
}

// The signed-in user's own membership for one patient, with derived capabilities.
export function usePermissions(patientId: string | null): PermissionsState {
  const { currentUser } = useAuth();
  const uid = currentUser?.id ?? null;
  const [member, setMember] = useState<CareCircleMember | null>(null);
  const [loading, setLoading] = useState(patientId !== null && uid !== null);

  useEffect(() => {
    if (!patientId || !uid) {
      setMember(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsubscribe = subscribeMyMembership(
      patientId,
      uid,
      m => {
        setMember(m);
        setLoading(false);
      },
      () => {
        setMember(null);
        setLoading(false);
      },
    );
    return unsubscribe;
  }, [patientId, uid]);

  const capabilities = useMemo(() => getCapabilities(member), [member]);

  return { member, capabilities, loading };
}
