/**
 * The gym profile, its coaches and its outstanding invites.
 *
 * These are the only writes in the app that are online-only. A privilege change replayed from
 * a phone that has been in a pocket for three days is not a feature: `apply_ops` refuses
 * `memberships`, `invites` and `gyms` outright, so these mutations report `saved` or `failed`
 * and never `queued`.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query'

import { useGymId } from '@/auth/useAuth'
import { keys } from '@/data/keys'
import { useRepo } from '@/data/repo/useRepo'
import type { WriteState } from '@/data/repo/types'
import type { Gym, Invite, MemberRole, Membership, Uuid } from '@/domain/types'

export function useGymProfile(): UseQueryResult<Gym | null> {
  const gymId = useGymId()
  const repo = useRepo()
  return useQuery({ queryKey: keys.gymProfile(gymId), queryFn: () => repo.getGym(gymId) })
}

export function useTeam(): UseQueryResult<Membership[]> {
  const gymId = useGymId()
  const repo = useRepo()
  return useQuery({ queryKey: keys.team(gymId), queryFn: () => repo.listTeam(gymId) })
}

export function useInvites(): UseQueryResult<Invite[]> {
  const gymId = useGymId()
  const repo = useRepo()
  return useQuery({ queryKey: keys.invites(gymId), queryFn: () => repo.listInvites(gymId) })
}

export function useUpdateGym(): UseMutationResult<
  WriteState,
  Error,
  Partial<Pick<Gym, 'name' | 'timezone' | 'displayUnit'>>
> {
  const gymId = useGymId()
  const repo = useRepo()
  const client = useQueryClient()
  return useMutation({
    mutationFn: (patch: Partial<Pick<Gym, 'name' | 'timezone' | 'displayUnit'>>) =>
      repo.updateGym(gymId, patch),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.gymProfile(gymId) }),
  })
}

export interface InviteTrainerVars {
  email: string
  role: MemberRole
}

/**
 * The result carries the invite secret, and it is the ONLY time it exists outside the
 * recipient's phone — the server stores a hash. A screen that drops it has to revoke the
 * invite and mint another; there is no second read.
 */
export function useInviteTrainer(): UseMutationResult<
  { state: WriteState; secret?: string },
  Error,
  InviteTrainerVars
> {
  const gymId = useGymId()
  const repo = useRepo()
  const client = useQueryClient()
  return useMutation({
    mutationFn: (vars: InviteTrainerVars) => repo.inviteTrainer(gymId, vars.email, vars.role),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.invites(gymId) }),
  })
}

export function useRevokeInvite(): UseMutationResult<WriteState, Error, Uuid> {
  const gymId = useGymId()
  const repo = useRepo()
  const client = useQueryClient()
  return useMutation({
    mutationFn: (inviteId: Uuid) => repo.revokeInvite(gymId, inviteId),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.invites(gymId) }),
  })
}

export interface UpdateMemberVars {
  membershipId: Uuid
  patch: Partial<Pick<Membership, 'displayName' | 'role' | 'status'>>
}

export function useUpdateMember(): UseMutationResult<WriteState, Error, UpdateMemberVars> {
  const gymId = useGymId()
  const repo = useRepo()
  const client = useQueryClient()
  return useMutation({
    mutationFn: (vars: UpdateMemberVars) => repo.updateMember(gymId, vars.membershipId, vars.patch),
    onSettled() {
      void client.invalidateQueries({ queryKey: keys.team(gymId) })
      // A coach's display name is on every set they logged; the roster shows it too.
      void client.invalidateQueries({ queryKey: keys.athletes(gymId) })
    },
  })
}
