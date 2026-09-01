import { describe, expect, it } from 'vitest'
import { NIL as NIL_UUID, v4 as uuidv4, version as uuidVersion } from 'uuid'

import { isUuid, newId } from '@/data/ids'

describe('newId', () => {
  it('mints well-formed v7 ids', () => {
    const id = newId()
    expect(isUuid(id)).toBe(true)
    expect(uuidVersion(id)).toBe(7)
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('never repeats, even minted in a tight loop', () => {
    const ids = Array.from({ length: 10_000 }, newId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  // The tie-break in `order by (position, id)` is only stable if ids sort by mint time as
  // strings. Thousands of ids inside one millisecond is exactly the case that breaks a naive
  // v7 implementation, so that is the case the test covers.
  it('sorts in mint order as plain strings', () => {
    const ids = Array.from({ length: 10_000 }, newId)
    for (let i = 1; i < ids.length; i += 1) {
      expect(ids[i] > ids[i - 1]).toBe(true)
    }
    expect([...ids].sort()).toEqual(ids)
  })
})

describe('isUuid', () => {
  it('accepts other uuid versions, so a server-minted v4 is not rejected', () => {
    expect(isUuid(uuidv4())).toBe(true)
  })

  it('rejects the nil uuid, malformed strings and non-strings', () => {
    expect(isUuid(NIL_UUID)).toBe(false)
    expect(isUuid('')).toBe(false)
    expect(isUuid('not-a-uuid')).toBe(false)
    expect(isUuid('0190e3f4-1a2b-7c3d-8e4f')).toBe(false)
    expect(isUuid(`${newId()} `)).toBe(false)
    expect(isUuid(undefined)).toBe(false)
    expect(isUuid(null)).toBe(false)
    expect(isUuid(42)).toBe(false)
  })
})
