// Notification Service for Room Chat Notifications
"use client"

import { webPushService, type PushSubscriptionData } from "./web-push-service"

export interface NotificationSubscription {
  roomId: string
  interval: number // minutes: 1, 3, 5, 10, 15, or 0 (disabled)
  startTime: number // timestamp when subscription started
  endTime: number // timestamp when subscription expires
  username?: string // store username for persistence
  pushSubscription?: PushSubscriptionData // Web Push subscription data
}

export type NotificationInterval = 1 | 3 | 5 | 10 | 15 | 0

interface WebSocketMessage {
  type: string
  roomId?: string
  username?: string
  interval?: number
  subscribed?: boolean
  remainingTime?: number
  pushSubscription?: PushSubscriptionData
  [key: string]: unknown
}

class NotificationService {
  private static instance: NotificationService
  private subscriptions: Map<string, NotificationSubscription> = new Map()
  private intervals: Map<string, NodeJS.Timeout> = new Map()
  private websocketSend: ((msg: WebSocketMessage) => void) | null = null
  private pendingRestoration: NotificationSubscription[] = []
  private tabId: string = ''

  static getInstance(): NotificationService {
    if (!NotificationService.instance) {
      NotificationService.instance = new NotificationService()
    }
    return NotificationService.instance
  }

  constructor() {
    // Load subscriptions from localStorage on startup
    this.loadSubscriptionsFromStorage()
    
    // Initialize Web Push service for background notifications
    this.initializeWebPush()
    
    // Handle page visibility changes for better notification management
    if (typeof window !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          this.log('Page became hidden - notifications will continue in background')
        } else {
          this.log('Page became visible')
          // Mark this tab as active when it becomes visible
          this.markTabAsActive()
        }
      })
      
      // Handle page unload to ensure persistence
      window.addEventListener('beforeunload', () => {
        this.saveSubscriptionsToStorage()
        this.log('Page unloading - subscriptions saved to localStorage')
      })
    }
    
    // Cross-tab communication for better notification management
    this.initializeCrossTabCommunication()
  }

  // Set the WebSocket send function for backend communication
  setWebSocketSend(sendFn: (msg: WebSocketMessage) => void) {
    this.websocketSend = sendFn
    if (typeof sendFn === 'function') {
      this.log('WebSocket send function set successfully')
      // When WebSocket is available, restore subscriptions to backend
      this.restoreSubscriptionsToBackend()
    } else {
      this.log('WebSocket send function set to null/undefined')
    }
  }

  // Restore all active local subscriptions to the backend
  private restoreSubscriptionsToBackend() {
    const activeSubscriptions = this.getAllActiveSubscriptions()
    
    if (activeSubscriptions.length === 0) {
      this.log('No active subscriptions to restore to backend')
      return
    }
    
    this.log(`Restoring ${activeSubscriptions.length} subscriptions to backend`)
    
    // Store pending subscriptions to restore later when username is available
    this.pendingRestoration = activeSubscriptions
  }

  // Restore subscriptions for a specific user when they reconnect
  restoreSubscriptionsForUser(username: string) {
    // First restore any pending subscriptions from localStorage
    if (this.pendingRestoration.length > 0) {
      this.log(`Restoring ${this.pendingRestoration.length} pending subscriptions for user ${username}`)
      
      for (const subscription of this.pendingRestoration) {
        const remainingMinutes = Math.ceil((subscription.endTime - Date.now()) / (60 * 1000))
        if (remainingMinutes > 0) {
          this.syncWithBackend(subscription.roomId, username, remainingMinutes as NotificationInterval)
        }
      }
      
      this.pendingRestoration = []
      return
    }
    
    // Then restore any active subscriptions for this user or subscriptions without username
    const activeSubscriptions = this.getAllActiveSubscriptions().filter(sub => 
      !sub.username || sub.username === username
    )
    
    if (activeSubscriptions.length === 0) {
      this.log(`No active subscriptions to restore for user ${username}`)
      return
    }
    
    this.log(`Restoring ${activeSubscriptions.length} subscriptions for user ${username}`)
    
    for (const subscription of activeSubscriptions) {
      const remainingMinutes = Math.ceil((subscription.endTime - Date.now()) / (60 * 1000))
      if (remainingMinutes > 0) {
        // Update subscription with username if it wasn't stored
        if (!subscription.username) {
          subscription.username = username
          this.subscriptions.set(subscription.roomId, subscription)
          this.saveSubscriptionsToStorage()
        }
        
        this.syncWithBackend(subscription.roomId, username, remainingMinutes as NotificationInterval)
      }
    }
  }

  private log(message: string, data?: unknown) {
    console.log(`[NotificationService] ${message}`, data)
  }

  // localStorage persistence methods
  private loadSubscriptionsFromStorage() {
    if (typeof window === 'undefined') return // Server-side rendering guard
    
    try {
      const stored = localStorage.getItem('notificationSubscriptions')
      if (stored) {
        const subscriptionsData = JSON.parse(stored)
        
        // Load simple room/user mappings - backend handles timing
        for (const [roomId, data] of Object.entries(subscriptionsData)) {
          const simpleData = data as { username: string }
          // Create minimal subscription object for UI purposes
          this.subscriptions.set(roomId, {
            roomId,
            username: simpleData.username,
            interval: 0, // Will be synced from backend
            startTime: 0,
            endTime: 0,
            pushSubscription: undefined
          })
          this.log(`Restored subscription mapping from storage for room ${roomId}`)
        }
      }
    } catch (error) {
      this.log('Failed to load subscriptions from storage:', error)
    }
  }

  private saveSubscriptionsToStorage() {
    if (typeof window === 'undefined') return // Server-side rendering guard
    
    try {
      // Only store basic room/user info - backend handles timing
      const simpleSubscriptions: Record<string, { username: string }> = {}
      for (const [roomId, subscription] of this.subscriptions.entries()) {
        if (subscription.username) {
          simpleSubscriptions[roomId] = { username: subscription.username }
        }
      }
      localStorage.setItem('notificationSubscriptions', JSON.stringify(simpleSubscriptions))
      this.log('Saved subscriptions to storage (simplified)')
    } catch (error) {
      this.log('Failed to save subscriptions to storage:', error)
    }
  }

  // Sync subscription with backend
  private syncWithBackend(roomId: string, username: string, interval: NotificationInterval, pushSubscription?: PushSubscriptionData) {
    if (this.websocketSend && typeof this.websocketSend === 'function') {
      this.websocketSend({
        type: "subscribeNotifications",
        roomId,
        username,
        interval,
        pushSubscription
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
  }

  // Handle backend subscription response
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
    this.saveSubscriptionsToStorage() // Save to localStorage
    this.log(`Updated subscription from backend for room ${roomId}`, subscription)
  }

  // Remove subscription (used when backend reports no subscription)
  removeSubscriptionFromBackend(roomId: string) {
    this.subscriptions.delete(roomId)
    this.clearAutoCleanup(roomId)
    this.saveSubscriptionsToStorage() // Save to localStorage
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
      this.saveSubscriptionsToStorage() // Save to localStorage when subscription expires
    }, remainingTime)
    
    this.intervals.set(roomId, timeout)
  }

  private clearAutoCleanup(roomId: string) {
    if (this.intervals.has(roomId)) {
      clearTimeout(this.intervals.get(roomId)!)
      this.intervals.delete(roomId)
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

  async subscribeToRoom(roomId: string, interval: NotificationInterval, username?: string): Promise<boolean> {
    if (interval === 0) {
      await this.unsubscribeFromRoom(roomId, username)
      return true
    }

    if (!this.hasNotificationPermission()) {
      this.log('Cannot subscribe: no notification permission')
      return false
    }

    // Get or create push subscription for true background notifications
    let pushSubscription: PushSubscriptionData | undefined = undefined
    try {
      const pushSub = await webPushService.subscribe()
      if (pushSub) {
        pushSubscription = pushSub
        this.log('Push subscription created for true background notifications')
      } else {
        this.log('Failed to create push subscription, falling back to foreground notifications')
      }
    } catch (error) {
      this.log('Error creating push subscription:', error)
    }

    const now = Date.now()
    const endTime = now + (interval * 60 * 1000) // Convert minutes to milliseconds

    const subscription: NotificationSubscription = {
      roomId,
      interval,
      startTime: now,
      endTime,
      username, // Store username for persistence
      pushSubscription // Store push subscription for backend
    }

    this.subscriptions.set(roomId, subscription)
    
    this.log(`Subscribed to room ${roomId} for ${interval} minutes`, subscription)

    // Set up auto-unsubscribe timer
    this.setupAutoCleanup(roomId, interval * 60 * 1000)
    
    // Save to localStorage for persistence
    this.saveSubscriptionsToStorage()
    
    // Sync with backend if username and websocket available
    if (username) {
      this.syncWithBackend(roomId, username, interval, pushSubscription)
    }

    return true
  }

  async unsubscribeFromRoom(roomId: string, username?: string): Promise<void> {
    const subscription = this.subscriptions.get(roomId)
    
    // Unsubscribe from push notifications if there was a subscription
    if (subscription?.pushSubscription) {
      try {
        await webPushService.unsubscribe()
        this.log('Unsubscribed from push notifications')
      } catch (error) {
        this.log('Error unsubscribing from push notifications:', error)
      }
    }
    
    this.subscriptions.delete(roomId)
    this.clearAutoCleanup(roomId)
    
    // Save to localStorage for persistence
    this.saveSubscriptionsToStorage()
    
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
  }
  // This will be called when a new message arrives
  async showNotification(roomId: string, message: { username: string; content: string }) {
    this.log(`showNotification called with:`, { roomId, message, roomIdType: typeof roomId })
    
    if (!roomId) {
      this.log(`Error: roomId is ${roomId}`)
      return
    }

    if (!this.hasNotificationPermission()) {
      this.log(`Not showing notification for room ${roomId}: no permission`)
      return
    }    // Show notification - backend has already filtered for subscribed users
    this.log(`Showing notification for room ${roomId} - backend has authorized this notification`)

    try {
      // Check notification permission again before creating
      this.log(`Browser notification permission: ${Notification.permission}`)
      this.log(`Document visibility: ${document.visibilityState}`)
      this.log(`Window focus: ${document.hasFocus()}`)
      
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

      this.log(`Notification object created:`, notification)

      notification.onclick = () => {
        this.log(`Notification clicked for room ${roomId}`)
        window.focus()
        window.location.href = `/${roomId}/chat`
        notification.close()
      }

      notification.onshow = () => {
        this.log(`Notification successfully displayed for room ${roomId}`)
      }

      notification.onerror = (error) => {
        this.log(`Notification error for room ${roomId}:`, error)
      }

      notification.onclose = () => {
        this.log(`Notification closed for room ${roomId}`)
      }

      // Auto-close after 5 seconds
      setTimeout(() => {
        this.log(`Auto-closing notification for room ${roomId}`)
        notification.close()
      }, 5000)
      
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
    const success = await this.subscribeToRoom(roomId, 1) // 1 minute for testing
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

  // Debug method to check system status
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

  // Cross-tab communication for better notification management
  private initializeCrossTabCommunication() {
    if (typeof window === 'undefined') return
    
    // Listen for messages from other tabs
    window.addEventListener('storage', (e) => {
      if (e.key === 'notificationSubscriptions') {
        // Another tab updated subscriptions, reload our local copy
        this.loadSubscriptionsFromStorage()
        this.log('Reloaded subscriptions from storage due to change in another tab')
      }
    })
    
    // Register this tab as active
    this.markTabAsActive()
    
    // Periodically mark this tab as active (heartbeat)
    setInterval(() => this.markTabAsActive(), 30000) // Every 30 seconds
  }
  
  private markTabAsActive() {
    if (typeof window === 'undefined') return
    
    try {
      const tabData = {
        timestamp: Date.now(),
        tabId: this.getTabId()
      }
      localStorage.setItem('notificationActiveTab', JSON.stringify(tabData))
    } catch (error) {
      this.log('Failed to mark tab as active:', error)
    }
  }
  
  private getTabId(): string {
    // Generate a unique ID for this tab session
    if (!this.tabId) {
      this.tabId = `tab_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    }
    return this.tabId
  }
  
  private isAnyTabActive(): boolean {
    if (typeof window === 'undefined') return false
    
    try {
      const stored = localStorage.getItem('notificationActiveTab')
      if (!stored) return false
      
      const tabData = JSON.parse(stored)
      const now = Date.now()
      
      // Consider a tab active if it updated within the last minute
      return (now - tabData.timestamp) < 60000
    } catch (error) {
      this.log('Failed to check active tab status:', error)
      return false
    }
  }

  // Initialize Web Push service
  private async initializeWebPush() {
    if (typeof window === 'undefined') return
    
    try {
      const initialized = await webPushService.initialize()
      if (initialized) {
        this.log('Web Push service initialized successfully')
        
        // Request permission for push notifications
        const permission = await webPushService.requestPermission()
        if (permission === 'granted') {
          this.log('Push notification permission granted')
        } else {
          this.log('Push notification permission denied:', permission)
        }
      } else {
        this.log('Web Push service initialization failed')
      }
    } catch (error) {
      this.log('Error initializing Web Push service:', error)
    }
  }
}

export const notificationService = NotificationService.getInstance()
