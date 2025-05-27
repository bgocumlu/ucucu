'use client'

import { useEffect } from 'react'

export function ServiceWorkerRegistration() {
  useEffect(() => {
    // Service worker registration is now handled by the WebPushService
    // This component is kept for compatibility but doesn't register a SW
    console.log('[SW] Service worker registration handled by WebPushService')
  }, [])

  return null
}
