// Custom Service Worker for Push Notifications
self.addEventListener('install', (event) => {
  console.log('[SW] Service worker installing...')
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  console.log('[SW] Service worker activating...')
  event.waitUntil(self.clients.claim())
})

// Handle push notification display
self.addEventListener('push', (event) => {
  console.log('[SW] Push message received:', event)
  
  if (!event.data) {
    console.log('[SW] No push data')
    return
  }
  try {
    let data
    let title = 'New Message'
    let body = 'You have a new message'
    let roomId = 'unknown'
      // Try to parse as JSON first
    try {
      data = event.data.json()
      console.log('[SW] Push notification data (JSON):', data)
      
      title = data.title || `New message in room ${data.roomId}`
      body = `${data.username}: ${data.content}`
      roomId = data.roomId
    } catch {
      // If not JSON, treat as plain text
      const textData = event.data.text()
      console.log('[SW] Push notification data (text):', textData)
      
      title = 'New Message'
      body = textData
      roomId = 'unknown' // We'll extract from URL if possible
    }

    const options = {
      body: body,
      icon: '/icons/manifest-icon-192.maskable.png',
      badge: '/icons/manifest-icon-192.maskable.png',
      tag: `room-${roomId}`,
      data: {
        roomId: roomId,
        url: `/${roomId}/chat`
      },
      actions: [
        {
          action: 'view',
          title: 'View Chat'
        }
      ],
      requireInteraction: false,
      silent: false
    }

    event.waitUntil(
      self.registration.showNotification(title, options)
    )
  } catch (error) {
    console.error('[SW] Error handling push data:', error)
    
    // Fallback notification
    event.waitUntil(
      self.registration.showNotification('New Message', {
        body: 'You have a new message',
        icon: '/icons/manifest-icon-192.maskable.png'
      })
    )
  }
})

// Handle notification click
self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Notification clicked:', event)
  
  event.notification.close()

  const data = event.notification.data
  if (!data) return

  const urlToOpen = new URL(data.url, self.location.origin).href

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => {
        // Check if there's already a window open with this URL
        for (const client of clients) {
          if (client.url === urlToOpen && 'focus' in client) {
            return client.focus()
          }
        }
        
        // If no window is open, open a new one
        if (self.clients.openWindow) {
          return self.clients.openWindow(urlToOpen)
        }
      })
  )
})

// Handle background message for showing notifications
self.addEventListener('message', (event) => {
  console.log('[SW] Received message:', event.data)
    if (event.data && event.data.type === 'SHOW_NOTIFICATION') {
    console.log('[SW] Received SHOW_NOTIFICATION message:', event.data)
    
    const { title, body, roomId, username, content } = event.data
    
    const options = {
      body: body || `${username}: ${content}`,
      icon: '/icons/manifest-icon-192.maskable.png',
      badge: '/icons/manifest-icon-192.maskable.png',
      tag: `room-${roomId}`,
      data: {
        roomId: roomId,
        url: `/${roomId}/chat`
      },
      actions: [
        {
          action: 'view',
          title: 'View Chat'
        }
      ],
      requireInteraction: false,
      silent: false
    }

    console.log('[SW] About to show notification with options:', { title, options })
    
    self.registration.showNotification(title || 'New Message', options)
      .then(() => {
        console.log('[SW] Notification shown successfully')
      })
      .catch((error) => {
        console.error('[SW] Error showing notification:', error)
      })
  } else {
    console.log('[SW] Received unknown message:', event.data)
  }
})
