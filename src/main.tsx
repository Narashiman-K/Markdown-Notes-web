import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/app.css'
import './styles/markdown.css'
import 'highlight.js/styles/github.css'

// Expose the converters to the smoke harness so it can run real files through
// the real code path. Gated on an environment variable set only by the test
// script, so this never attaches in a user's session.
if (import.meta.env.DEV) {
  void import('./lib/convert').then((m) => {
    ;(window as unknown as Record<string, unknown>).__convert = m
  })
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

/*
 * Retire the start-up splash from index.html once the interface is on screen.
 * Two animation frames: the first lets React commit, the second lets the
 * browser paint it, so the fade never reveals an empty window. The timeout
 * covers a system with animations turned off, where transitionend never fires.
 */
function retireSplash(): void {
  const splash = document.getElementById('boot-splash')
  if (!splash || splash.classList.contains('gone')) return
  splash.classList.add('gone')
  splash.addEventListener('transitionend', () => splash.remove(), { once: true })
  window.setTimeout(() => splash.remove(), 600)
}
requestAnimationFrame(() => requestAnimationFrame(retireSplash))
// A page opened in a background tab gets no animation frames until it is
// shown, so without this the splash would sit there until then.
window.setTimeout(retireSplash, 1500)
