import { StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './i18n'
import './index.css'
import { App } from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={null}>
      <App />
    </Suspense>
  </StrictMode>,
)
