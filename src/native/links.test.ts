import { describe, expect, it } from 'vitest'

import { routeForAppUrl } from '@/native/links'

const ORIGIN = 'https://app.powerhouse.gr'

describe('an address arriving from outside the app', () => {
  it('sends a provider callback to the shared callback screen, code and all', () => {
    expect(routeForAppUrl('gr.powerhouse.app://auth/callback?code=abc', ORIGIN)).toBe('/auth/callback?code=abc')
  })

  it('keeps an invite secret in the fragment', () => {
    expect(routeForAppUrl(`${ORIGIN}/welcome#invite=s3cret`, ORIGIN)).toBe('/welcome#invite=s3cret')
  })

  it('refuses any other route on the app scheme, and any other site', () => {
    expect(routeForAppUrl('gr.powerhouse.app://athletes/x', ORIGIN)).toBeNull()
    expect(routeForAppUrl('https://evil.example/welcome#invite=x', ORIGIN)).toBeNull()
    expect(routeForAppUrl('not a url', ORIGIN)).toBeNull()
  })
})
