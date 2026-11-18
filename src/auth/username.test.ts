import { describe, expect, it } from 'vitest'

import { emailForIdentifier } from './username'

describe('the sign-in name', () => {
  it('turns a trainer username into the address the Streamlit pilot created', () => {
    expect(emailForIdentifier('Dimitris', 'powerhouse.gr')).toEqual({ ok: true, email: 'dimitris@powerhouse.gr' })
    expect(emailForIdentifier('  maria.s ', 'powerhouse.gr')).toEqual({ ok: true, email: 'maria.s@powerhouse.gr' })
  })

  it('passes a real address through, lowercased', () => {
    expect(emailForIdentifier('Eleni.K@Gmail.com', 'powerhouse.gr')).toEqual({ ok: true, email: 'eleni.k@gmail.com' })
  })

  it('refuses what Streamlit refuses, instead of minting an address no account has', () => {
    expect(emailForIdentifier('Δημήτρης', 'powerhouse.gr')).toEqual({ ok: false, reason: 'username' })
    expect(emailForIdentifier('two words', 'powerhouse.gr')).toEqual({ ok: false, reason: 'username' })
    expect(emailForIdentifier('   ', 'powerhouse.gr')).toEqual({ ok: false, reason: 'empty' })
  })
})
