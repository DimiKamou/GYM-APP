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
import type { Repo, WriteState } from '@/data/repo/types'
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

/**
 * Redeeming an invite, which is the one call in the app that happens BEFORE the caller has a
 * gym.
 *
 * It is a capability rather than a `Repo` method: every method on that interface takes the
 * `gymId` the joiner does not have yet, and the interface is the contract nine screens are
 * written against. Both implementations offer `redeemInvite`, and `redeemerOf` looks for it
 * structurally — a repository that cannot redeem answers "invalid" instead of throwing at
 * someone who is holding a working link.
 */
export interface RedeemedInvite {
  gymId: Uuid
  membershipId: Uuid
  role: MemberRole
  /**
   * True only when the repository can PROVE this account was already active in that gym.
   * Supabase never can: `redeem_invite` returns one identical payload for a first redemption
   * and for a repeat of it, so the endpoint cannot be used as an oracle. The Join screen
   * therefore also compares against the membership it was already holding.
   */
  alreadyMember: boolean
}

/**
 * One failure value, no reason attached. That mirrors `redeem_invite`, which raises the same
 * 'invalid or expired invite' for a wrong secret, an expired one, a revoked one, a used-up
 * one and one addressed to a different mailbox — deliberately, so a stranger cannot probe it
 * to learn which invites exist.
 */
export type RedeemOutcome = { ok: true; invite: RedeemedInvite } | { ok: false }

export interface InviteRedeemer {
  redeemInvite(secret: string): Promise<RedeemOutcome>
}

export function redeemerOf(repo: Repo): InviteRedeemer | null {
  const candidate = repo as Repo & Partial<InviteRedeemer>
  return typeof candidate.redeemInvite === 'function' ? (candidate as InviteRedeemer) : null
}

/**
 * No `useGymId()` anywhere in here, unlike every other hook in this file: the person redeeming
 * an invite has no membership yet, and reaching for a gym id would throw on the one screen
 * that must work without one.
 */
export function useRedeemInvite(): UseMutationResult<RedeemOutcome, Error, string> {
  const repo = useRepo()
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (secret: string): Promise<RedeemOutcome> => {
      const redeemer = redeemerOf(repo)
      return redeemer ? redeemer.redeemInvite(secret) : { ok: false }
    },
    onSuccess: (outcome) => {
      // A successful redemption changes who the caller IS. Everything cached was read as
      // someone else — including the empty answers a gym-less account got back — and none of
      // it may be reused under the new membership.
      if (outcome.ok) client.clear()
    },
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

/** The owner's copy of everything this gym holds, as JSON. */
export function useExportGym(): UseMutationResult<string, Error, void> {
  const gymId = useGymId()
  const repo = useRepo()
  return useMutation({ mutationFn: () => repo.exportGym(gymId) })
}

/**
 * Re-seeds the demo gym. Present only on the local repository — on Supabase the server owns
 * the data and there is nothing to reset — so the Settings screen gates the button on
 * `repo.kind === 'local'` rather than on this hook existing.
 */
export function useResetDemoData(): UseMutationResult<void, Error, void> {
  const repo = useRepo()
  const client = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      if (!repo.resetDemoData) throw new Error('this repository has no demo data to reset')
      await repo.resetDemoData()
    },
    // Everything on screen came from the rows that were just replaced.
    onSuccess: () => client.clear(),
  })
}
