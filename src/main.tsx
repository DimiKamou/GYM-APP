import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from '@/App'

// Reset first, tokens second: the theme files must win on `body`, and the reset's
// `:focus-visible` outline resolves `--th-accent` from the tokens either way.
import '@/styles/reset.css'
import '@/styles/tokens.css'

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('#root is missing from index.html')

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
