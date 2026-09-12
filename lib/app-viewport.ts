/** UI-only viewport lifecycle. No authentication or registration work belongs here. */
export function installAppViewport() {
  const root = document.documentElement
  const mode = window.matchMedia('(pointer: coarse) and (max-width: 1000px), (display-mode: standalone)')
  const viewport = window.visualViewport
  const enabled = () => mode.matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
  const resize = () => {
    if (!enabled()) {
      delete root.dataset.appViewport
      root.style.removeProperty('--app-viewport-height')
      return
    }
    root.dataset.appViewport = 'locked'
    // Keyboard/browser chrome can reduce the usable height. Pinching must not
    // itself resize the application layout if a browser accessibility override wins.
    if (!viewport || Math.abs(viewport.scale - 1) < 0.01) {
      root.style.setProperty('--app-viewport-height', `${viewport?.height ?? window.innerHeight}px`)
    }
  }
  const preventGesture = (event: Event) => {
    if (enabled() && event.cancelable) event.preventDefault()
  }
  const preventPinch = (event: TouchEvent) => {
    if (event.touches.length > 1) preventGesture(event)
  }
  resize()
  mode.addEventListener('change', resize)
  window.addEventListener('resize', resize)
  viewport?.addEventListener('resize', resize)
  document.addEventListener('gesturestart', preventGesture, { passive: false })
  document.addEventListener('gesturechange', preventGesture, { passive: false })
  document.addEventListener('touchstart', preventPinch, { passive: false })
  document.addEventListener('touchmove', preventPinch, { passive: false })
  return () => {
    mode.removeEventListener('change', resize)
    window.removeEventListener('resize', resize)
    viewport?.removeEventListener('resize', resize)
    document.removeEventListener('gesturestart', preventGesture)
    document.removeEventListener('gesturechange', preventGesture)
    document.removeEventListener('touchstart', preventPinch)
    document.removeEventListener('touchmove', preventPinch)
    delete root.dataset.appViewport
    root.style.removeProperty('--app-viewport-height')
  }
}
