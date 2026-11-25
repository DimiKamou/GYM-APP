import { describe, expect, it } from 'vitest'

import { MAX_OPEN_SESSIONS, neighbourOf, OPEN_SESSION_TTL_MS, pruneExpired, withOpened, withoutSession } from '@/domain/openSessions'

const T = 1_000_000

describe('open workouts', () => {
  it('appends a new athlete as the last tab and keeps an open one in place', () => {
    let list = withOpened([], { sessionId: 'a', athleteId: 'nikos' }, T)
    list = withOpened(list, { sessionId: 'b', athleteId: 'eleni' }, T + 1)
    list = withOpened(list, { sessionId: 'a', athleteId: 'nikos' }, T + 2)
    expect(list.map((e) => e.sessionId)).toEqual(['a', 'b'])
    expect(list[0].openedAt).toBe(T + 2)
  })

  it('keeps one workout per athlete: a new one replaces their old tab', () => {
    let list = withOpened([], { sessionId: 'a', athleteId: 'nikos' }, T)
    list = withOpened(list, { sessionId: 'b', athleteId: 'eleni' }, T)
    list = withOpened(list, { sessionId: 'c', athleteId: 'nikos' }, T)
    expect(list.map((e) => e.sessionId)).toEqual(['b', 'c'])
  })

  it('drops the oldest past the limit', () => {
    let list: ReturnType<typeof withOpened> = []
    for (let i = 0; i <= MAX_OPEN_SESSIONS; i++) list = withOpened(list, { sessionId: `s${i}`, athleteId: `a${i}` }, T + i)
    expect(list).toHaveLength(MAX_OPEN_SESSIONS)
    expect(list[0].sessionId).toBe('s1')
  })

  it('lets yesterday’s tabs expire instead of sitting above today’s workout', () => {
    const list = withOpened([], { sessionId: 'old', athleteId: 'nikos' }, T)
    expect(pruneExpired(list, T + OPEN_SESSION_TTL_MS)).toEqual([])
    expect(withOpened(list, { sessionId: 'new', athleteId: 'eleni' }, T + OPEN_SESSION_TTL_MS).map((e) => e.sessionId)).toEqual(['new'])
  })

  it('closes a tab and moves to its neighbour, right first', () => {
    let list = withOpened([], { sessionId: 'a', athleteId: '1' }, T)
    list = withOpened(list, { sessionId: 'b', athleteId: '2' }, T)
    list = withOpened(list, { sessionId: 'c', athleteId: '3' }, T)
    expect(neighbourOf(list, 'b')?.sessionId).toBe('c')
    expect(neighbourOf(list, 'c')?.sessionId).toBe('b')
    expect(withoutSession(list, 'b').map((e) => e.sessionId)).toEqual(['a', 'c'])
    expect(neighbourOf([list[0]], 'a')).toBeNull()
  })
})
