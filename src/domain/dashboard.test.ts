import { describe, expect, it } from 'vitest'

import { coachActivity, gymDashboard } from '@/domain/dashboard'
import type { Athlete, Membership, Session } from '@/domain/types'

const s = (id: string, athleteId: string, localDate: string, loggedBy: string, creditedTo: string | null = null) =>
  ({ id, athleteId, localDate, loggedBy, creditedTo, startedAt: `${localDate}T09:00:00Z`, deletedAt: null }) as unknown as Session
const a = (id: string, fullName: string, deletedAt: string | null = null) => ({ id, fullName, deletedAt }) as unknown as Athlete
const m = (id: string, displayName: string, status = 'active') =>
  ({ id, displayName, role: 'trainer', status }) as unknown as Membership

const TODAY = '2026-11-18' // a Wednesday
const athletes = [a('nikos', 'Νίκος'), a('eleni', 'Ελένη'), a('kostas', 'Κώστας'), a('new', 'Νέα'), a('gone', 'Παλιός', '2026-01-01')]
const members = [m('maria', 'Μαρία'), m('dimitris', 'Δημήτρης'), m('left', 'Έφυγε', 'removed')]
const sessions = [
  s('1', 'nikos', '2026-11-17', 'maria'),
  s('2', 'eleni', '2026-11-15', 'maria', 'dimitris'), // Sunday: last week
  s('3', 'nikos', '2026-11-10', 'dimitris'),
  s('4', 'kostas', '2026-10-01', 'maria'),
]
const lastByAthlete = new Map([['nikos', '2026-11-17'], ['eleni', '2026-11-15'], ['kostas', '2026-10-01'], ['new', null]])

describe('the gym dashboard', () => {
  const d = gymDashboard({ sessions, athletes, members, lastByAthlete, today: TODAY })

  it('counts this week and last week, Monday to Sunday', () => {
    expect(d.thisWeek).toBe(1)
    expect(d.lastWeek).toBe(2)
    expect(d.weeks).toHaveLength(12)
    expect(d.weeks[11]).toEqual({ weekStart: '2026-11-16', sessions: 1 })
  })

  it('counts active athletes over 30 days, out of the live ones only', () => {
    expect(d.activeAthletes).toBe(2)
    expect(d.totalAthletes).toBe(4)
  })

  it('lists who has not trained for two weeks, longest gap first, the never-trained last', () => {
    expect(d.drifting.map((x) => [x.athlete.id, x.daysSince])).toEqual([
      ['kostas', 48],
      ['new', null],
    ])
  })

  it('credits each session to its author, as the sheets print it', () => {
    expect(d.coaches.map((c) => [c.member.id, c.sessions, c.athletes])).toEqual([
      ['dimitris', 2, 2],
      ['maria', 1, 1],
    ])
  })
})

describe('team activity', () => {
  it('keeps an active member with no sessions, and a removed one only if they did work', () => {
    const rows = coachActivity([s('1', 'nikos', '2026-11-17', 'left')], members)
    expect(rows.map((r) => [r.member.id, r.sessions])).toEqual([
      ['left', 1],
      ['dimitris', 0],
      ['maria', 0],
    ])
  })
})
