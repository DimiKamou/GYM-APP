/**
 * Athlete accounts (012), from both sides.
 *
 * The staff half takes the gym id like every other hook. The athlete half takes none: an
 * athlete is not a member of anything, and `my_athlete_portal()` answers from `auth.uid()`.
 * All of it is online-only, like the team writes — granting someone outside the staff a view
 * of a person's record is not an op to replay from a pocket three days later.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query'

import { useAuth, useGymId } from '@/auth/useAuth'
import { keys } from '@/data/keys'
import { useRepo } from '@/data/repo/useRepo'
import { athleteSideOf, type AthleteRedeemOutcome, type WriteState } from '@/data/repo/types'
import type { AthleteAccess, AthletePortal, Uuid } from '@/domain/types'

/** False when the repository has no athlete accounts at all: the card is hidden, not broken. */
export function useAthleteAccountsSupported(): boolean {
  const repo = useRepo()
  return typeof repo.getAthleteAccess === 'function' && typeof repo.createAthleteInvite === 'function'
}

export function useAthleteAccess(athleteId: Uuid | undefined): UseQueryResult<AthleteAccess> {
  const gymId = useGymId()
  const repo = useRepo()
  return useQuery({
    queryKey: keys.athleteAccess(gymId, athleteId ?? 'none'),
    queryFn: () => {
      if (!repo.getAthleteAccess || !athleteId) throw new Error('athlete accounts are not available')
      return repo.getAthleteAccess(gymId, athleteId)
    },
    enabled: athleteId !== undefined && typeof repo.getAthleteAccess === 'function',
    // A link is redeemed on another phone; nothing here would otherwise notice.
    staleTime: 0,
    retry: false,
  })
}

export interface CreateAthleteInviteVars {
  athleteId: Uuid
  email?: string | null
}

/** The secret is in the result and nowhere else, ever — as with a trainer's invite. */
export function useCreateAthleteInvite(): UseMutationResult<
  { state: WriteState; secret?: string },
  Error,
  CreateAthleteInviteVars
> {
  const gymId = useGymId()
  const repo = useRepo()
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (vars: CreateAthleteInviteVars) =>
      repo.createAthleteInvite
        ? repo.createAthleteInvite(gymId, vars.athleteId, vars.email ?? null)
        : { state: 'failed' as const },
    onSuccess: (_result, vars) =>
      client.invalidateQueries({ queryKey: keys.athleteAccess(gymId, vars.athleteId) }),
  })
}

export function useRevokeAthleteAccess(): UseMutationResult<WriteState, Error, Uuid> {
  const gymId = useGymId()
  const repo = useRepo()
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (athleteId: Uuid) =>
      repo.revokeAthleteAccess ? repo.revokeAthleteAccess(gymId, athleteId) : ('failed' as const),
    onSuccess: (_state, athleteId) =>
      client.invalidateQueries({ queryKey: keys.athleteAccess(gymId, athleteId) }),
  })
}

/** The athlete's own sheet. Only ever enabled for a signed-in athlete. */
export function useAthletePortal(): UseQueryResult<AthletePortal | null> {
  const { athlete } = useAuth()
  const repo = useRepo()
  const athleteId = athlete?.athleteId ?? 'none'
  return useQuery({
    queryKey: keys.athletePortal(athleteId),
    queryFn: async () => {
      const side = athleteSideOf(repo)
      return side ? side.getAthletePortal() : null
    },
    enabled: athlete !== null,
  })
}

/**
 * No gym, no membership, no athlete yet: the one athlete call made before the caller is anyone.
 * A successful redemption changes who the caller is, so everything cached as the previous
 * nobody goes.
 */
export function useRedeemAthleteInvite(): UseMutationResult<AthleteRedeemOutcome, Error, string> {
  const repo = useRepo()
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (secret: string): Promise<AthleteRedeemOutcome> => {
      const side = athleteSideOf(repo)
      return side ? side.redeemAthleteInvite(secret) : { ok: false }
    },
    onSuccess: (outcome) => {
      if (outcome.ok) client.clear()
    },
  })
}
