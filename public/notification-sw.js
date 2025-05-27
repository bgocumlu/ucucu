// Service Worker for Web Push Notifications
"use strict";

// Self-diagnostic function
function logServiceWorkerInfo() {
  console.log('[NotificationSW] Service Worker Environment Check:');
  console.log('[NotificationSW] - Location:', self.location.href);
  console.log('[NotificationSW] - Origin:', self.location.origin);
  console.log('[NotificationSW] - Registration available:', !!self.registration);
  console.log('[NotificationSW] - Push Manager available:', !!self.registration?.pushManager);
  console.log('[NotificationSW] - Notification available:', !!self.Notification);
  console.log('[NotificationSW] - Clients available:', !!self.clients);
}

// Install event
self.addEventListener('install', () => {
  console.log('[NotificationSW] Service Worker installing...');
  logServiceWorkerInfo();
  self.skipWaiting(); // Activate immediately
});

// Activate event
self.addEventListener('activate', (event) => {
  console.log('[NotificationSW] Service Worker activating...');
  logServiceWorkerInfo();
  event.waitUntil(clients.claim()); // Take control of all pages immediately
});

// Push event - handles incoming push notifications
self.addEventListener('push', (event) => {
  console.log('[NotificationSW] Push event received:', event);
  
  let notificationData = {
    title: 'New message',
    body: 'You have a new message',
    icon: '/icons/manifest-icon-192.maskable.png',
    badge: '/icons/manifest-icon-192.maskable.png',
    tag: 'chat-notification',
    data: {}  };
  
  if (event.data) {
    try {
      const pushData = event.data.json();
      console.log('[NotificationSW] Push data:', pushData);
      
      // Handle different push data formats
      let title, body, roomId;
      
      if (pushData.message && pushData.message.username && pushData.message.content) {
        // Format: { roomId: 'test', message: { username: 'user', content: 'text' } }
        title = `/${pushData.roomId}`;
        body = `${pushData.message.username}: ${pushData.message.content}`;
        roomId = pushData.roomId;
      } else if (pushData.title && pushData.body) {
        // Format: { title: 'test', body: 'a: l', data: { roomId: 'test' } }
        title = `/${pushData.data?.roomId || pushData.title}`;
        body = pushData.body;
        roomId = pushData.data?.roomId || pushData.title;
      } else {
        // Fallback format
        title = pushData.title || 'New Message';
        body = pushData.body || 'You have a new message';
        roomId = pushData.roomId || 'unknown';
      }
        notificationData = {
        title: title,
        body: body,
        icon: '/icons/manifest-icon-192.maskable.png',
        badge: '/icons/manifest-icon-192.maskable.png',
        tag: `room-${roomId}-${Date.now()}`, // Add timestamp to prevent replacement
        data: {
          roomId: roomId,
          message: pushData.message || { username: 'Unknown', content: body },
          url: `/${roomId}/chat`
        },        requireInteraction: false,
        silent: false
      };
    } catch (error) {
      console.error('[NotificationSW] Error parsing push data:', error);
      // Try to get raw data for debugging
      try {
        const rawData = event.data.text();
        console.error('[NotificationSW] Raw push data:', rawData);
      } catch (rawError) {
        console.error('[NotificationSW] Could not read raw push data:', rawError);
      }
    }
  } else {
    console.log('[NotificationSW] No push data received, using default notification');
  }
    console.log('[NotificationSW] Final notification data:', JSON.stringify(notificationData, null, 2));
  
  const promiseChain = self.registration.showNotification(
    notificationData.title,
    {
      body: notificationData.body,
      icon: notificationData.icon,
      badge: notificationData.badge,
      tag: notificationData.tag,
      data: notificationData.data,
      requireInteraction: notificationData.requireInteraction,
      silent: notificationData.silent,
      actions: [
        {
          action: 'open',
          title: 'Open Chat',
          icon: '/icons/manifest-icon-192.maskable.png'
        },
        {
          action: 'close',
          title: 'Dismiss'
        }
      ]
    }
  ).then(() => {
    console.log('[NotificationSW] Notification shown successfully');
  }).catch((error) => {
    console.error('[NotificationSW] Failed to show notification:', error);
  });
  
  event.waitUntil(promiseChain);
});

// Notification click event
self.addEventListener('notificationclick', (event) => {
  console.log('[NotificationSW] Notification clicked:', event);
    event.notification.close();
  
  const roomId = event.notification.data?.roomId;
  let url = event.notification.data?.url || (roomId ? `/${roomId}/chat` : '/');
  
  // Ensure URL is absolute for better compatibility
  try {
    url = new URL(url, self.location.origin).href;
  } catch (error) {
    console.error('[NotificationSW] Error constructing URL:', error);
    url = self.location.origin + (roomId ? `/${roomId}/chat` : '/');
  }
  
  if (event.action === 'close') {
    // User clicked dismiss, just close the notification
    return;
  }
  
  // Default action or 'open' action - open the chat
  event.waitUntil(    clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    }).then((clientList) => {
      // Try to find an existing window/tab with the app
      for (const client of clientList) {
        // Check if client URL is from the same origin (more robust check)
        try {
          const clientUrl = new URL(client.url);
          const targetUrl = new URL(url, self.location.origin);
          
          if (clientUrl.origin === targetUrl.origin) {
            // Focus existing window and navigate to the room
            return client.focus().then(() => {
              if (client.navigate) {
                return client.navigate(url);
              } else {
                // Fallback: post message to client to handle navigation
                client.postMessage({
                  type: 'navigate',
                  url: url,
                  roomId: roomId
                });
              }
            });
          }
        } catch (error) {
          console.error('[NotificationSW] Error checking client URL:', error);
          // Continue to next client if URL parsing fails
          continue;
        }
      }
      
      // No existing window found, open a new one
      return clients.openWindow(url);
    })
  );
});

// Message event - handle messages from the main thread
self.addEventListener('message', (event) => {
  console.log('[NotificationSW] Message received:', event.data);
    if (event.data && event.data.type === 'subscribe') {
    // Handle subscription updates from main thread
    console.log('[NotificationSW] Subscription update:', event.data);
  } else if (event.data && event.data.type === 'SHOW_NOTIFICATION') {
    console.log('[NotificationSW] Received SHOW_NOTIFICATION message:', event.data);
    
    const { title, body, roomId, username, content } = event.data;
    const timestamp = Date.now();
    
    const options = {
      body: body || `${username}: ${content}`,
      icon: '/icons/manifest-icon-192.maskable.png',
      badge: '/icons/manifest-icon-192.maskable.png',
      tag: `room-${roomId}-${timestamp}`, // Add timestamp to prevent replacement
      data: {
        roomId: roomId,
        url: `/${roomId}/chat`
      },
      actions: [
        {
          action: 'open',
          title: 'Open Chat',
          icon: '/icons/manifest-icon-192.maskable.png'
        },
        {
          action: 'close',
          title: 'Dismiss'
        }
      ],
      requireInteraction: false,
      silent: false
    };

    console.log('[NotificationSW] About to show notification with options:', { title, options });
    
    self.registration.showNotification(title || 'New Message', options)
      .then(() => {
        console.log('[NotificationSW] Notification shown successfully');
      })
      .catch((error) => {
        console.error('[NotificationSW] Error showing notification:', error);
      });
  }
});

// Background sync for offline functionality (optional)
self.addEventListener('sync', (event) => {
  console.log('[NotificationSW] Background sync:', event.tag);
  
  if (event.tag === 'notification-sync') {
    // Handle background sync for notifications
    event.waitUntil(
      // Sync notification subscriptions when back online
      fetch('/api/sync-notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }).catch(error => {
        console.error('[NotificationSW] Sync failed:', error);
      })
    );
  }
});
