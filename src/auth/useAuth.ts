import { useContext } from 'react'

import { AuthContext, type AuthContextValue } from '@/auth/AuthProvider'
import type { Uuid } from '@/domain/types'

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth() used outside <AuthProvider>')
  return value
}

/**
 * The gym id, for callers that only run inside a resolved session — every query key is
 * gym-scoped, so this is the most-used half of the context by a wide margin.
 *
 * It throws rather than returning null on purpose: a component that reads gym data before the
 * membership is resolved would otherwise build a key like `['gym', undefined, 'athletes']` and
 * quietly cache one gym's roster under a key every gym shares.
 */
export function useGymId(): Uuid {
  const { gym, status } = useAuth()
  if (!gym) throw new Error(`useGymId() before a membership was resolved (status: ${status})`)
  return gym.id
}

/** True while the app has nothing to show yet. Kept here so no screen re-derives it wrongly. */
export function useIsAuthResolving(): boolean {
  return useAuth().status === 'loading'
}
