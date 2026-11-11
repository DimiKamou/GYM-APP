import type { OAuthProvider } from '@/auth/AuthProvider'

/**
 * The two marks a "Continue with…" button must carry. Their colours are the providers' own and
 * are not themed: both brand guidelines require the full-colour mark on a sign-in button, and a
 * monochrome G reads as a generic letter rather than as the account the athlete already has.
 */
export function ProviderLogo({ provider, size = 20 }: { provider: OAuthProvider; size?: number }) {
  if (provider === 'google') {
    return (
      <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
        <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z" />
        <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17.1z" />
        <path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z" />
        <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.3-8.5 2.3-6.2 0-11.5-4.1-13.4-9.8l-7.9 6.1C6.6 42.6 14.6 48 24 48z" />
      </svg>
    )
  }
  if (provider === 'apple') {
    // Apple's guidelines want the mark in the button's own text colour, so it follows the theme.
    return (
      <svg width={size} height={size} viewBox="0 0 814 1000" aria-hidden="true" focusable="false">
        <path
          fill="currentColor"
          d="M788 341c-6 4-108 62-108 190 0 148 130 200 134 202-1 3-21 72-69 142-43 62-88 124-156 124s-86-40-165-40c-77 0-104 41-166 41s-106-57-156-127C44 791 0 671 0 557c0-183 119-280 236-280 62 0 114 41 153 41 37 0 95-43 166-43 27 0 124 2 188 66zM554 159c29-35 50-83 50-131 0-7-1-14-2-19-48 2-104 32-138 72-27 30-52 79-52 128 0 7 1 15 2 17 3 1 8 1 13 1 43 0 97-29 127-68z"
        />
      </svg>
    )
  }
  return (
    <svg width={size} height={size} viewBox="0 0 21 21" aria-hidden="true" focusable="false">
      <rect x="1" y="1" width="9" height="9" fill="#F25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
      <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
      <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
    </svg>
  )
}
