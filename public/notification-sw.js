// Service Worker for Web Push Notifications
"use strict";

// Install event
self.addEventListener('install', (event) => {
  console.log('[NotificationSW] Service Worker installing...');
  self.skipWaiting(); // Activate immediately
});

// Activate event
self.addEventListener('activate', (event) => {
  console.log('[NotificationSW] Service Worker activating...');
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
    data: {}
  };
  
  if (event.data) {
    try {
      const pushData = event.data.json();
      console.log('[NotificationSW] Push data:', pushData);
      
      notificationData = {
        title: `New message in /${pushData.roomId}`,
        body: `${pushData.message.username}: ${pushData.message.content}`,
        icon: '/icons/manifest-icon-192.maskable.png',
        badge: '/icons/manifest-icon-192.maskable.png',
        tag: `room-${pushData.roomId}`,
        data: {
          roomId: pushData.roomId,
          message: pushData.message,
          url: `/${pushData.roomId}/chat`
        },
        requireInteraction: false,
        silent: false
      };
    } catch (error) {
      console.error('[NotificationSW] Error parsing push data:', error);
    }
  }
  
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
  );
  
  event.waitUntil(promiseChain);
});

// Notification click event
self.addEventListener('notificationclick', (event) => {
  console.log('[NotificationSW] Notification clicked:', event);
  
  event.notification.close();
  
  const roomId = event.notification.data?.roomId;
  const url = event.notification.data?.url || (roomId ? `/${roomId}/chat` : '/');
  
  if (event.action === 'close') {
    // User clicked dismiss, just close the notification
    return;
  }
  
  // Default action or 'open' action - open the chat
  event.waitUntil(
    clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    }).then((clientList) => {
      // Try to find an existing window/tab with the app
      for (const client of clientList) {
        if (client.url.includes(window.location.origin)) {
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
