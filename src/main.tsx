import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from '@/App'
import { registerServiceWorker } from '@/pwa/serviceWorker'

// Fonts first (an @font-face order nothing depends on), then reset, then tokens: the theme
// files must win on `body`, and the reset's `:focus-visible` outline resolves `--th-accent`
// from the tokens either way.
import '@/styles/fonts.css'
import '@/styles/reset.css'
import '@/styles/tokens.css'

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('#root is missing from index.html')

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

registerServiceWorker()
