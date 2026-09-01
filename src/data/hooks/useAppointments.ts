/**
 * The calendar.
 *
 * Appointments are the only future-tense data in the app — everything else is logged after
 * the fact. They are cached by the week the Calendar screen is showing and by the day the
 * Athletes screen puts at the top, which are the two shapes the UI actually asks for.
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
import type { NewAppointmentInput, WriteState } from '@/data/repo/types'
import type { Appointment, LocalDate, Uuid } from '@/domain/types'

/** Calendar dates are plain strings; parsing them as instants shifts them across midnight. */
export function addDays(date: LocalDate, days: number): LocalDate {
  const [y, m, d] = date.split('-').map(Number)
  const shifted = new Date(Date.UTC(y, m - 1, d))
  shifted.setUTCDate(shifted.getUTCDate() + days)
  return shifted.toISOString().slice(0, 10)
}

export function useWeekAppointments(weekStart: LocalDate): UseQueryResult<Appointment[]> {
  const gymId = useGymId()
  const repo = useRepo()
  return useQuery({
    queryKey: keys.appointmentsWeek(gymId, weekStart),
    queryFn: () => repo.listAppointments(gymId, weekStart, addDays(weekStart, 6)),
  })
}

export function useDayAppointments(date: LocalDate): UseQueryResult<Appointment[]> {
  const gymId = useGymId()
  const repo = useRepo()
  return useQuery({
    queryKey: keys.appointmentsDay(gymId, date),
    queryFn: () => repo.listAppointments(gymId, date, date),
  })
}

export function useCreateAppointment(): UseMutationResult<WriteState, Error, NewAppointmentInput> {
  const gymId = useGymId()
  const repo = useRepo()
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: NewAppointmentInput) => repo.createAppointment(gymId, input),
    // The whole appointments subtree: a slot moved from Tuesday to Thursday belongs to two
    // weeks and two days at once, and there is no cheaper honest answer than both.
    onSettled: () => client.invalidateQueries({ queryKey: keys.appointments(gymId) }),
  })
}

export type AppointmentPatch = Partial<
  Pick<
    Appointment,
    'date' | 'time' | 'durationMin' | 'type' | 'notes' | 'status' | 'membershipId' | 'sessionId'
  >
>

export interface UpdateAppointmentVars {
  appointmentId: Uuid
  patch: AppointmentPatch
}

export function useUpdateAppointment(): UseMutationResult<WriteState, Error, UpdateAppointmentVars> {
  const gymId = useGymId()
  const repo = useRepo()
  const client = useQueryClient()
  return useMutation({
    mutationFn: (vars: UpdateAppointmentVars) =>
      repo.updateAppointment(gymId, vars.appointmentId, vars.patch),
    onSettled: () => client.invalidateQueries({ queryKey: keys.appointments(gymId) }),
  })
}

/** Soft delete, undone from a toast — never a confirm dialog on a phone at arm's length. */
export function useDeleteAppointment(): UseMutationResult<WriteState, Error, Uuid> {
  const gymId = useGymId()
  const repo = useRepo()
  const client = useQueryClient()
  return useMutation({
    mutationFn: (appointmentId: Uuid) => repo.deleteAppointment(gymId, appointmentId),
    onSettled: () => client.invalidateQueries({ queryKey: keys.appointments(gymId) }),
  })
}
