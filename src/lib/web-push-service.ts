// Web Push Service for handling push notifications
"use client"

export interface PushSubscriptionData {
  endpoint: string
  keys: {
    p256dh: string
    auth: string
  }
}

export class WebPushService {
  private static instance: WebPushService
  private registration: ServiceWorkerRegistration | null = null
  private subscription: PushSubscription | null = null
  private vapidPublicKey: string | null = null
    static getInstance(): WebPushService {
    if (!WebPushService.instance) {
      WebPushService.instance = new WebPushService()
    }
    return WebPushService.instance
  }  
  
  private initializeVapidPublicKey(): void {
    this.vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || null
    
    if (!this.vapidPublicKey) {
      console.error('[WebPushService] NEXT_PUBLIC_VAPID_PUBLIC_KEY environment variable not set')
      throw new Error('VAPID public key not configured')
    }
    
    console.log('[WebPushService] VAPID public key initialized from environment')
  }
    async initialize(): Promise<boolean> {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      console.warn('[WebPushService] Push notifications not supported')
      return false
    }
    
    try {
      // Initialize VAPID public key from environment
      this.initializeVapidPublicKey()
      
      if (!this.vapidPublicKey) {
        console.error('[WebPushService] No VAPID public key available')
        return false
      }
      
      // Register service worker
      this.registration = await navigator.serviceWorker.register('/notification-sw.js', {
        scope: '/'
      })
      
      console.log('[WebPushService] Service Worker registered:', this.registration)
        // Wait for service worker to be ready
      await navigator.serviceWorker.ready
      
      // Check if VAPID key has changed (force re-subscription if needed)
      const storedVapidKey = localStorage.getItem('vapidPublicKey')
      console.log('[WebPushService] Stored VAPID key:', storedVapidKey)
      console.log('[WebPushService] Current VAPID key:', this.vapidPublicKey)
      
      if (storedVapidKey && storedVapidKey !== this.vapidPublicKey) {
        console.log('[WebPushService] VAPID key changed, clearing existing subscriptions')
        await this.forceUnsubscribeAll()
        
        // Note: VAPID key changed, user will need to resubscribe to notifications
        console.log('[WebPushService] VAPID key changed - existing notification subscriptions cleared')
      } else if (!storedVapidKey) {
        console.log('[WebPushService] No stored VAPID key found, first time setup')
      } else {
        console.log('[WebPushService] VAPID key unchanged')
      }
      
      // Store current VAPID key for future comparison
      localStorage.setItem('vapidPublicKey', this.vapidPublicKey)
      
      return true
    } catch (error) {
      console.error('[WebPushService] Service Worker registration failed:', error)
      return false
    }
  }
  
  async requestPermission(): Promise<NotificationPermission> {
    if (!('Notification' in window)) {
      console.warn('[WebPushService] Notifications not supported')
      return 'denied'
    }
    
    const permission = await Notification.requestPermission()
    console.log('[WebPushService] Permission status:', permission)
    return permission
  }
  async subscribe(): Promise<PushSubscriptionData | null> {
    if (!this.registration) {
      console.error('[WebPushService] ✗ No service worker registration available')
      return null
    }
    
    if (!this.vapidPublicKey) {
      console.error('[WebPushService] ✗ No VAPID public key available')
      return null
    }
    
    console.log('[WebPushService] ✓ Prerequisites met, creating push subscription...')
    
    try {
      // Check if already subscribed
      this.subscription = await this.registration.pushManager.getSubscription()
      
      if (!this.subscription) {
        // Create new subscription
        this.subscription = await this.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: this.urlBase64ToUint8Array(this.vapidPublicKey)
        })
      }
      
      const subscriptionData: PushSubscriptionData = {
        endpoint: this.subscription.endpoint,
        keys: {
          p256dh: this.arrayBufferToBase64(this.subscription.getKey('p256dh')!),
          auth: this.arrayBufferToBase64(this.subscription.getKey('auth')!)
        }
      }
        console.log('[WebPushService] ✓ Push subscription created successfully:', subscriptionData)
      return subscriptionData
    } catch (error) {
      console.error('[WebPushService] ✗ Push subscription failed:', error)
      return null
    }
  }
  
  async unsubscribe(): Promise<boolean> {
    if (!this.subscription) {
      return true
    }
    
    try {
      const result = await this.subscription.unsubscribe()
      this.subscription = null
      console.log('[WebPushService] Push unsubscribed:', result)
      return result
    } catch (error) {
      console.error('[WebPushService] Push unsubscribe failed:', error)
      return false
    }
  }
  
  getSubscription(): PushSubscription | null {
    return this.subscription
  }
  
  async isSubscribed(): Promise<boolean> {
    if (!this.registration) {
      return false
    }
    
    try {
      this.subscription = await this.registration.pushManager.getSubscription()
      return this.subscription !== null
    } catch (error) {
      console.error('[WebPushService] Error checking subscription:', error)
      return false
    }
  }
  
  // Force clear all existing subscriptions (use when VAPID keys change)
  async forceUnsubscribeAll(): Promise<boolean> {
    console.log('[WebPushService] Force clearing all subscriptions due to VAPID key change')
    
    try {
      if (!this.registration) {
        await this.initialize()
      }
      
      if (this.registration) {
        // Get existing subscription
        const existingSubscription = await this.registration.pushManager.getSubscription()
        if (existingSubscription) {
          console.log('[WebPushService] Unsubscribing existing subscription')
          await existingSubscription.unsubscribe()
        }
        
        // Clear local reference
        this.subscription = null
        
        console.log('[WebPushService] All subscriptions cleared successfully')
        return true
      }
      
      return false
    } catch (error) {
      console.error('[WebPushService] Failed to clear subscriptions:', error)
      return false
    }
  }

  // Helper functions
  private urlBase64ToUint8Array(base64String: string): Uint8Array {
    const padding = '='.repeat((4 - base64String.length % 4) % 4)
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
    
    const rawData = window.atob(base64)
    const outputArray = new Uint8Array(rawData.length)
    
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i)
    }
    return outputArray
  }
  
  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const binary = String.fromCharCode(...new Uint8Array(buffer))
    return window.btoa(binary)
  }
  
  // Send message to service worker
  async sendMessageToServiceWorker(message: unknown): Promise<void> {
    if (!this.registration || !this.registration.active) {
      console.warn('[WebPushService] No active service worker')
      return
    }
    
    this.registration.active.postMessage(message)
  }
  
  // Check if push is supported
  static isPushSupported(): boolean {
    return typeof window !== 'undefined' && 
           'serviceWorker' in navigator && 
           'PushManager' in window && 
           'Notification' in window
  }
}

export const webPushService = WebPushService.getInstance()
