// Notification Service for Room Chat Notifications
"use client"

import { webPushService, type PushSubscriptionData } from "./web-push-service"

export interface NotificationSubscription {
  roomId: string
  interval: number // minutes: 1, 3, 5, 10, 15, or 0 (disabled)
  startTime: number // timestamp when subscription started
  endTime: number // timestamp when subscription expires
  deviceId: string // unique device identifier
  username: string // current username for this subscription
  pushSubscription?: PushSubscriptionData // Web Push subscription data
}

export type NotificationInterval = 1 | 3 | 5 | 10 | 15 | 0

interface WebSocketMessage {
  type: string
  roomId?: string
  username?: string
  deviceId?: string
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
  private deviceId: string = ''

  static getInstance(): NotificationService {
    if (!NotificationService.instance) {
      NotificationService.instance = new NotificationService()
    }
    return NotificationService.instance
  }

  constructor() {
    // Generate or retrieve device ID
    this.deviceId = this.getOrCreateDeviceId()
    
    // Clean up any corrupted localStorage data
    this.cleanupCorruptedStorage()
    
    // Load subscriptions from localStorage on startup
    this.loadSubscriptionsFromStorage()
    
    // Initialize Web Push service
    this.initializeWebPush()
    
    // Initialize cross-tab communication
    this.initializeCrossTabCommunication()    // Add to global window for emergency admin access (development only)
    if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).notificationServiceAdmin = {
        clearAll: () => this.adminClearAllSubscriptions(),
        clearLocal: () => this.clearAllSubscriptions(),
        status: () => this.debugStatus('admin')
      }
    }
  }

  // Set the WebSocket send function for backend communication
  setWebSocketSend(sendFn: (msg: WebSocketMessage) => void) {
    this.websocketSend = sendFn
    this.log('WebSocket send function set')
    
    // Restore any pending subscriptions now that WebSocket is available
    this.restoreSubscriptionsToBackend()
  }

  // Restore all active local subscriptions to the backend
  private restoreSubscriptionsToBackend() {
    if (!this.websocketSend) {
      this.log('Cannot restore subscriptions to backend: WebSocket not available')
      return
    }

    const activeSubscriptions = this.getAllActiveSubscriptions()
    
    if (activeSubscriptions.length === 0) {
      this.log('No active subscriptions to restore to backend')
      return
    }

    this.log(`Restoring ${activeSubscriptions.length} subscriptions to backend`)
    
    for (const subscription of activeSubscriptions) {
      const remainingMinutes = Math.ceil((subscription.endTime - Date.now()) / (60 * 1000))
      if (remainingMinutes > 0) {
        this.syncWithBackend(subscription.roomId, subscription.username, remainingMinutes as NotificationInterval, subscription.pushSubscription)
      }
    }
  }

  // Restore subscriptions for a specific user when they reconnect
  restoreSubscriptionsForUser(username: string) {
    const activeSubscriptions = this.getAllActiveSubscriptions().filter(sub => 
      sub.deviceId === this.deviceId
    )
    
    if (activeSubscriptions.length === 0) {
      this.log(`No active subscriptions to restore for device ${this.deviceId}`)
      return
    }
    
    this.log(`Restoring ${activeSubscriptions.length} subscriptions for device ${this.deviceId}`)
    
    for (const subscription of activeSubscriptions) {
      const remainingMinutes = Math.ceil((subscription.endTime - Date.now()) / (60 * 1000))
      if (remainingMinutes > 0) {
        // Update subscription with current username
        subscription.username = username
        this.subscriptions.set(subscription.roomId, subscription)
        this.saveSubscriptionsToStorage()
        
        this.syncWithBackend(subscription.roomId, username, remainingMinutes as NotificationInterval)
      }
    }
  }

  private log(message: string, data?: unknown) {
    console.log(`[NotificationService] ${message}`, data || '')
  }

  // localStorage persistence methods
  private loadSubscriptionsFromStorage() {
    if (typeof window === 'undefined') return
    
    try {
      const stored = localStorage.getItem('notificationSubscriptions')
      if (stored) {
        const subscriptionsData = JSON.parse(stored)
          for (const [, data] of Object.entries(subscriptionsData)) {
          const subscriptionData = data as NotificationSubscription
          // Use the roomId from the subscription data, not the storage key
          if (subscriptionData.roomId) {
            this.subscriptions.set(subscriptionData.roomId, subscriptionData)
            
            // Set up auto-cleanup for active subscriptions
            const remainingTime = subscriptionData.endTime - Date.now()
            if (remainingTime > 0) {
              this.setupAutoCleanup(subscriptionData.roomId, remainingTime)
            }
          }
        }
        
        this.log(`Loaded ${this.subscriptions.size} subscriptions from storage`)
      }
    } catch (error) {
      this.log('Failed to load subscriptions from storage:', error)
      // Clear corrupted data
      localStorage.removeItem('notificationSubscriptions')
    }
  }

  private saveSubscriptionsToStorage() {
    if (typeof window === 'undefined') return
    
    try {
      const subscriptionsData: Record<string, NotificationSubscription> = {}
      
      for (const [roomId, subscription] of this.subscriptions) {
        // Use roomId + deviceId as the key, but store the actual roomId in the data
        const key = `${roomId}_${this.deviceId}`
        subscriptionsData[key] = {
          roomId, // Store the actual roomId here
          interval: subscription.interval,
          startTime: subscription.startTime,
          endTime: subscription.endTime,
          deviceId: subscription.deviceId,
          username: subscription.username,
          pushSubscription: subscription.pushSubscription
        }
      }
      
      localStorage.setItem('notificationSubscriptions', JSON.stringify(subscriptionsData))
      this.log(`Saved ${Object.keys(subscriptionsData).length} subscriptions to storage`)
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
        deviceId: this.deviceId,
        interval,
        pushSubscription
      })
      this.log(`Synced subscription with backend: ${username} (device: ${this.deviceId}) in room ${roomId} for ${interval} minutes`)
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
        username,
        deviceId: this.deviceId
      })
      this.log(`Requested subscription status from backend for ${username} (device: ${this.deviceId}) in room ${roomId}`)
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
        
        this.updateSubscriptionFromBackend(roomId, {
          roomId,
          interval: data.interval,
          startTime: now - (data.interval * 60 * 1000) + remainingTime,
          endTime,
          deviceId: this.deviceId,
          username: data.username || 'unknown'
        })
      } else {
        // No active subscription
        this.removeSubscriptionFromBackend(roomId)
      }
    }
  }

  // Update subscription from backend data
  updateSubscriptionFromBackend(roomId: string, subscription: Partial<NotificationSubscription> & { roomId: string; interval: number; startTime: number; endTime: number }) {
    const fullSubscription: NotificationSubscription = {
      roomId: subscription.roomId,
      interval: subscription.interval,
      startTime: subscription.startTime,
      endTime: subscription.endTime,
      deviceId: subscription.deviceId || this.deviceId,
      username: subscription.username || 'unknown',
      pushSubscription: subscription.pushSubscription
    }
    
    this.subscriptions.set(roomId, fullSubscription)
    this.setupAutoCleanup(roomId, fullSubscription.endTime - Date.now())
    this.saveSubscriptionsToStorage() // Save to localStorage
    this.log(`Updated subscription from backend for room ${roomId}`, fullSubscription)
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
    this.log('Requesting notification permission (user triggered)')
    
    if (!('Notification' in window)) {
      this.log('Browser does not support notifications')
      return 'denied'
    }

    // Only request if not already granted
    if (Notification.permission === 'default') {
      const permission = await Notification.requestPermission()
      this.log('Permission request result:', permission)
      return permission
    }
    
    this.log('Permission already set:', Notification.permission)
    alert(`Notification permission is set to ${Notification.permission}.`)
    return Notification.permission
  }

  hasNotificationPermission(): boolean {
    return ('Notification' in window) && Notification.permission === 'granted'
  }

  async subscribeToRoom(roomId: string, interval: NotificationInterval, username: string): Promise<boolean> {
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
      deviceId: this.deviceId,
      username,
      pushSubscription
    }

    this.subscriptions.set(roomId, subscription)
    
    this.log(`Subscribed to room ${roomId} for ${interval} minutes`, subscription)

    // Set up auto-unsubscribe timer
    this.setupAutoCleanup(roomId, interval * 60 * 1000)
    
    // Save to localStorage for persistence
    this.saveSubscriptionsToStorage()
    
    // Sync with backend
    this.syncWithBackend(roomId, username, interval, pushSubscription)

    return true
  }

  async unsubscribeFromRoom(roomId: string, username: string): Promise<void> {
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
    
    // Sync with backend
    this.syncWithBackend(roomId, username, 0)
    
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
    const timestamp = Date.now()
    this.log(`showNotification called for room ${roomId} at ${timestamp}:`, message)
    
    if (!roomId) {
      this.log(`Error: roomId is ${roomId}`)
      return
    }

    if (!this.hasNotificationPermission()) {
      this.log(`Not showing notification for room ${roomId}: no permission`)
      return
    }

    // Show notification - backend has already filtered for subscribed users
    this.log(`Showing notification for room ${roomId}`)

    try {
      const title = `/${roomId}`
      const body = `${message.username}: ${message.content}`

      this.log(`Creating notification with title: ${title}, body: ${body}`)

      // ONLY use Service Worker notifications - no fallback to direct notifications
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        // Check which service worker is active
        const registration = await navigator.serviceWorker.ready
        this.log(`Active Service Worker: ${registration.active?.scriptURL}`)
        
        navigator.serviceWorker.controller.postMessage({
          type: 'SHOW_NOTIFICATION',
          title,
          body,
          roomId,
          username: message.username,
          content: message.content,
          timestamp
        })
        this.log(`Service Worker notification message sent for room ${roomId} with timestamp ${timestamp}`)
      } else {
        this.log(`Service Worker not available for room ${roomId} - notification not shown`)
      }
      
    } catch (error) {
      console.error('[NotificationService] Failed to send notification to Service Worker:', error)
    }
  }

  private setupNotificationHandlers(notification: Notification, roomId: string) {
    notification.onclick = () => {
      this.log(`Notification clicked for room ${roomId}`)
      window.focus()
      window.location.href = `/${roomId}/chat`
      notification.close()
    }

    notification.onshow = () => {
      this.log(`Notification displayed for room ${roomId}`)
    }

    notification.onerror = (error) => {
      this.log(`Notification error for room ${roomId}:`, error)
    }

    // Auto-close after 5 seconds
    setTimeout(() => {
      notification.close()
    }, 5000)
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
        // Don't request permission here - only when user clicks bell
      } else {
        this.log('Web Push service initialization failed')
      }
    } catch (error) {
      this.log('Error initializing Web Push service:', error)
    }
  }

  // Device ID management
  private getOrCreateDeviceId(): string {
    if (typeof window === 'undefined') return 'server' // Server-side rendering guard
    
    try {
      let deviceId = localStorage.getItem('notificationDeviceId')
      if (!deviceId) {
        // Generate unique device ID
        deviceId = `device_${Date.now()}_${Math.random().toString(36).substr(2, 12)}`
        localStorage.setItem('notificationDeviceId', deviceId)
        this.log('Generated new device ID:', deviceId)
      } else {
        this.log('Loaded existing device ID:', deviceId)
      }
      return deviceId
    } catch (error) {
      this.log('Failed to get/create device ID:', error)
      return `device_${Date.now()}_${Math.random().toString(36).substr(2, 12)}`
    }
  }

  // Clean up corrupted localStorage data
  private cleanupCorruptedStorage(): void {
    if (typeof window === 'undefined') return
    
    try {
      const stored = localStorage.getItem('notificationSubscriptions')
      if (stored) {
        const subscriptionsData = JSON.parse(stored)
        let hasCorruptedData = false
        
        // Check for corrupted room IDs (containing device IDs)
        for (const [, data] of Object.entries(subscriptionsData)) {
          const subscriptionData = data as { roomId?: string }
          if (subscriptionData.roomId && subscriptionData.roomId.includes('device_')) {
            hasCorruptedData = true
            break
          }
        }
        
        if (hasCorruptedData) {
          this.log('Found corrupted subscription data, clearing localStorage')
          localStorage.removeItem('notificationSubscriptions')
        }
      }
    } catch (error) {
      this.log('Error checking for corrupted storage, clearing localStorage:', error)
      localStorage.removeItem('notificationSubscriptions')
    }
  }

  getDeviceId(): string {
    return this.deviceId
  }

  // Get all subscribed rooms with their usernames for home screen
  getSubscribedRooms(): { roomId: string; username: string; remainingTime: number }[] {
    const now = Date.now()
    return Array.from(this.subscriptions.values())
      .filter(sub => sub.endTime > now)
      .map(sub => ({
        roomId: sub.roomId,
        username: sub.username,
        remainingTime: Math.floor((sub.endTime - now) / 1000)
      }))
  }

  // Test method to check if notifications work at all
  async testNotification(): Promise<boolean> {
    this.log('Testing notification...')
    
    if (!this.hasNotificationPermission()) {
      this.log('No notification permission for test')
      return false
    }

    try {
      const testNotification = new Notification('Test Notification', {
        body: 'This is a test notification to check if notifications work',
        icon: '/icons/manifest-icon-192.maskable.png',
        tag: 'test-notification'
      })
      
      this.log('Test notification created successfully')
      
      setTimeout(() => {
        testNotification.close()
      }, 3000)
      
      return true
    } catch (error) {
      this.log('Test notification failed:', error)
      return false
    }
  }

  // Clear all subscriptions (used when VAPID keys change)
  clearAllSubscriptions(): void {
    this.log('Clearing all notification subscriptions due to VAPID key change')
    
    // Clear in-memory subscriptions
    this.subscriptions.clear()
    
    // Clear all cleanup timers
    for (const timeout of this.intervals.values()) {
      clearTimeout(timeout)
    }
    this.intervals.clear()
    
    // Clear localStorage
    if (typeof window !== 'undefined') {
      localStorage.removeItem('notificationSubscriptions')
    }
    
    this.log('All notification subscriptions cleared')
  }

  // Request backend to clear all push subscriptions (when VAPID keys change)
  requestClearAllPushSubscriptions(): void {
    if (this.websocketSend && typeof this.websocketSend === 'function') {
      this.log('Requesting backend to clear all push subscriptions due to VAPID key change')
      this.websocketSend({
        type: "clearAllPushSubscriptions"
      })
    } else {
      this.log('Cannot request backend to clear push subscriptions: WebSocket send function not available')
    }
  }

  // Admin function to force clear all subscriptions (for emergency VAPID key fixes)
  adminClearAllSubscriptions(): void {
    if (this.websocketSend && typeof this.websocketSend === 'function') {
      this.log('ADMIN: Force clearing all backend subscriptions')
      this.websocketSend({
        type: "adminClearAllSubscriptions"
      })
    } else {
      this.log('Cannot send admin clear command: WebSocket send function not available')
    }
  }
}

export const notificationService = NotificationService.getInstance()
