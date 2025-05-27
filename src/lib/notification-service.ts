// Notification Service for Room Chat Notifications
"use client"

export interface NotificationSubscription {
  roomId: string
  interval: number // minutes: 1, 3, 5, 10, 15, or 0 (disabled)
  startTime: number // timestamp when subscription started
  endTime: number // timestamp when subscription expires
}

export type NotificationInterval = 1 | 3 | 5 | 10 | 15 | 0

interface WebSocketMessage {
  type: string
  roomId?: string
  username?: string
  interval?: number
  subscribed?: boolean
  remainingTime?: number
  [key: string]: unknown
}

class NotificationService {
  private static instance: NotificationService
  private subscriptions: Map<string, NotificationSubscription> = new Map()
  private intervals: Map<string, NodeJS.Timeout> = new Map()
  private websocketSend: ((msg: WebSocketMessage) => void) | null = null

  static getInstance(): NotificationService {
    if (!NotificationService.instance) {
      NotificationService.instance = new NotificationService()
    }
    return NotificationService.instance
  }

  constructor() {
    // No longer using localStorage - backend storage only
    // Set up cleanup interval to remove expired subscriptions
    setInterval(() => this.cleanupExpiredSubscriptions(), 30000) // Check every 30 seconds
  }  // Set the WebSocket send function for backend communication
  setWebSocketSend(sendFn: (msg: WebSocketMessage) => void) {
    this.websocketSend = sendFn
    if (typeof sendFn === 'function') {
      this.log('WebSocket send function set successfully')
    } else {
      this.log('WebSocket send function set to null/undefined')
    }
  }

  private log(message: string, data?: unknown) {
    console.log(`[NotificationService] ${message}`, data)
  }
  // Sync subscription with backend
  private syncWithBackend(roomId: string, username: string, interval: NotificationInterval) {
    if (this.websocketSend && typeof this.websocketSend === 'function') {
      this.websocketSend({
        type: "subscribeNotifications",
        roomId,
        username,
        interval
      })
      this.log(`Synced subscription with backend: ${username} in room ${roomId} for ${interval} minutes`)
    } else {
      this.log('Cannot sync with backend: WebSocket send function not available')
    }
  }
  // Fetch subscription status from backend
  async fetchSubscriptionFromBackend(roomId: string, username: string): Promise<void> {
    if (this.websocketSend && typeof this.websocketSend === 'function') {
      this.websocketSend({
        type: "getNotificationStatus",
        roomId,
        username
      })
      this.log(`Requested subscription status from backend for ${username} in room ${roomId}`)
    } else {
      this.log('Cannot fetch subscription from backend: WebSocket send function not available')
    }
  }// Handle backend subscription response
  handleBackendSubscriptionUpdate(data: WebSocketMessage) {
    if (data.type === 'notificationStatus' && data.roomId) {
      const roomId = data.roomId
      if (data.subscribed && typeof data.interval === 'number' && data.interval > 0) {
        // Update local subscription from backend data
        const now = Date.now()
        const remainingTime = data.remainingTime || 0
        const endTime = now + remainingTime
        
        const subscription: NotificationSubscription = {
          roomId,
          interval: data.interval,
          startTime: now - (data.interval * 60 * 1000) + remainingTime, // Calculate start time
          endTime
        }
        
        this.subscriptions.set(roomId, subscription)
        this.log(`Updated subscription from backend: room ${roomId}, interval ${data.interval}, remaining ${Math.floor(remainingTime/1000)}s`)
        
        // Set up auto-cleanup timer
        this.setupAutoCleanup(roomId, remainingTime)
      } else {
        // No active subscription
        this.subscriptions.delete(roomId)
        this.clearAutoCleanup(roomId)
        this.log(`No active subscription for room ${roomId}`)
      }
    }
  }

  // Update subscription from backend data
  updateSubscriptionFromBackend(roomId: string, subscription: NotificationSubscription) {
    this.subscriptions.set(roomId, subscription)
    this.setupAutoCleanup(roomId, subscription.endTime - Date.now())
    this.log(`Updated subscription from backend for room ${roomId}`, subscription)
  }

  // Remove subscription (used when backend reports no subscription)
  removeSubscriptionFromBackend(roomId: string) {
    this.subscriptions.delete(roomId)
    this.clearAutoCleanup(roomId)
    this.log(`Removed subscription from backend for room ${roomId}`)
  }

  private setupAutoCleanup(roomId: string, remainingTime: number) {
    if (this.intervals.has(roomId)) {
      clearTimeout(this.intervals.get(roomId)!)
    }
    
    const timeout = setTimeout(() => {
      this.log(`Auto-cleaning expired subscription for room ${roomId}`)
      this.subscriptions.delete(roomId)
      this.intervals.delete(roomId)
    }, remainingTime)
    
    this.intervals.set(roomId, timeout)
  }

  private clearAutoCleanup(roomId: string) {
    if (this.intervals.has(roomId)) {
      clearTimeout(this.intervals.get(roomId)!)
      this.intervals.delete(roomId)
    }
  }
  private cleanupExpiredSubscriptions() {
    const now = Date.now()
    
    for (const [roomId, subscription] of this.subscriptions.entries()) {
      if (subscription.endTime <= now) {
        this.log(`Subscription expired for room ${roomId}`)
        this.subscriptions.delete(roomId)
        this.clearAutoCleanup(roomId)
      }
    }
  }

  async requestNotificationPermission(): Promise<NotificationPermission> {
    if (!('Notification' in window)) {
      this.log('Browser does not support notifications')
      return 'denied'
    }

    let permission = Notification.permission
    
    if (permission === 'default') {
      this.log('Requesting notification permission')
      permission = await Notification.requestPermission()
    }
    
    this.log('Notification permission status:', permission)
    return permission
  }

  hasNotificationPermission(): boolean {
    return ('Notification' in window) && Notification.permission === 'granted'
  }
  subscribeToRoom(roomId: string, interval: NotificationInterval, username?: string): boolean {
    if (interval === 0) {
      this.unsubscribeFromRoom(roomId, username)
      return true
    }

    if (!this.hasNotificationPermission()) {
      this.log('Cannot subscribe: no notification permission')
      return false
    }

    const now = Date.now()
    const endTime = now + (interval * 60 * 1000) // Convert minutes to milliseconds

    const subscription: NotificationSubscription = {
      roomId,
      interval,
      startTime: now,
      endTime
    }

    this.subscriptions.set(roomId, subscription)
    
    this.log(`Subscribed to room ${roomId} for ${interval} minutes`, subscription)

    // Set up auto-unsubscribe timer
    this.setupAutoCleanup(roomId, interval * 60 * 1000)
    
    // Sync with backend if username and websocket available
    if (username) {
      this.syncWithBackend(roomId, username, interval)
    }

    return true
  }

  unsubscribeFromRoom(roomId: string, username?: string): void {
    this.subscriptions.delete(roomId)
    this.clearAutoCleanup(roomId)
    
    // Sync with backend if username and websocket available
    if (username) {
      this.syncWithBackend(roomId, username, 0)
    }
    
    this.log(`Unsubscribed from room ${roomId}`)
  }

  getSubscription(roomId: string): NotificationSubscription | null {
    return this.subscriptions.get(roomId) || null
  }

  getRemainingTime(roomId: string): number {
    const subscription = this.getSubscription(roomId)
    if (!subscription) return 0
    
    const remaining = Math.max(0, subscription.endTime - Date.now())
    return Math.floor(remaining / 1000) // Return seconds
  }

  getRemainingMinutes(roomId: string): number {
    return Math.ceil(this.getRemainingTime(roomId) / 60)
  }

  isSubscribed(roomId: string): boolean {
    const subscription = this.getSubscription(roomId)
    if (!subscription) return false
    
    // Check if subscription is still valid
    return subscription.endTime > Date.now()
  }

  getAllActiveSubscriptions(): NotificationSubscription[] {
    const now = Date.now()
    return Array.from(this.subscriptions.values()).filter(sub => sub.endTime > now)
  }  // This will be called when a new message arrives
  async showNotification(roomId: string, message: { username: string; content: string }) {
    this.log(`showNotification called with:`, { roomId, message, roomIdType: typeof roomId })
    
    if (!roomId) {
      this.log(`Error: roomId is ${roomId}`)
      return
    }

    if (!this.isSubscribed(roomId)) {
      this.log(`Not showing notification for room ${roomId}: not subscribed`)
      return
    }

    if (!this.hasNotificationPermission()) {
      this.log(`Not showing notification for room ${roomId}: no permission`)
      return
    }

    // For testing purposes, always show notifications regardless of current room
    const currentPath = window.location.pathname
    const isInRoom = currentPath.includes(`/${roomId}/`)
    this.log(`Notification context for room ${roomId}:`, {
      currentPath,
      isInRoom,
      documentHidden: document.hidden,
      isSubscribed: this.isSubscribed(roomId)
    })

    try {
      // Direct notification API (more reliable for testing)
      const notification = new Notification(`New message in /${roomId}`, {
        body: `${message.username}: ${message.content}`,
        icon: '/icons/manifest-icon-192.maskable.png',
        badge: '/icons/manifest-icon-192.maskable.png',
        tag: `room-${roomId}`, // Replace previous notifications from same room
        data: { roomId, message },
        requireInteraction: false,
        silent: false
      })

      notification.onclick = () => {
        window.focus()
        window.location.href = `/${roomId}/chat`
        notification.close()
      }

      // Auto-close after 5 seconds
      setTimeout(() => notification.close(), 5000)
      
      this.log(`Notification shown for room ${roomId}`, message)
    } catch (error) {
      console.error('[NotificationService] Failed to show notification:', error)
    }
  }

  /**
   * Test notification system - for debugging purposes
   */
  async testNotification(roomId: string): Promise<void> {
    this.log('Testing notification system', { roomId })
    
    const hasPermission = this.hasNotificationPermission()
    this.log('Permission status:', hasPermission)
    
    if (!hasPermission) {
      const permission = await this.requestNotificationPermission()
      this.log('Permission request result:', permission)
      
      if (permission !== 'granted') {
        this.log('Permission denied, cannot test notifications')
        return
      }
    }
    
    // Test subscription
    const success = this.subscribeToRoom(roomId, 1) // 1 minute for testing
    this.log('Subscription result:', success)
      if (success) {
      // Show test notification
      const testMessage = {
        username: 'System',
        content: 'This is a test notification! 🔔'
      }
      
      await this.showNotification(roomId, testMessage)
      this.log('Test notification sent successfully', testMessage)
    } else {
      this.log('Failed to subscribe for test notification')
    }
  }

  // Cycle through notification intervals: 1 -> 3 -> 5 -> 10 -> 15 -> 0 (disabled) -> 1
  getNextInterval(currentInterval: NotificationInterval): NotificationInterval {
    const intervals: NotificationInterval[] = [1, 3, 5, 10, 15, 0]
    const currentIndex = intervals.indexOf(currentInterval)
    const nextIndex = (currentIndex + 1) % intervals.length
    return intervals[nextIndex]
  }

  // Get icon name for current notification state
  getNotificationIcon(roomId: string): string {
    if (!this.hasNotificationPermission()) {
      return 'bell-off'
    }
    
    if (!this.isSubscribed(roomId)) {
      return 'bell-off'
    }
    
    return 'bell'
  }
  // Format remaining time for display
  formatRemainingTime(seconds: number): string {
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    
    if (minutes > 0) {
      return `${minutes}m`
    } else {
      return `${remainingSeconds}s`
    }
  }

  // Debug method to check system state
  debugStatus(roomId: string): void {
    const subscription = this.getSubscription(roomId)
    const hasPermission = this.hasNotificationPermission()
    const isSubscribed = this.isSubscribed(roomId)
    const remainingTime = this.getRemainingTime(roomId)
    
    console.log(`[NotificationService] Debug Status for room ${roomId}:`, {
      hasPermission,
      isSubscribed,
      remainingTime: `${remainingTime}s`,
      subscription,
      websocketSend: this.websocketSend ? 'available' : 'null',
      notificationPermission: 'Notification' in window ? Notification.permission : 'not supported'
    })
  }
}

export const notificationService = NotificationService.getInstance()
