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
  private async fetchVapidPublicKey(): Promise<void> {
    try {
      // Use the WebSocket URL to determine the API URL
      const wsUrl = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3001/'
      const apiUrl = wsUrl.replace('ws://', 'http://').replace('wss://', 'https://').replace(/\/$/, '')
      const response = await fetch(`${apiUrl}/vapid-public-key`)
      const data = await response.json()
      this.vapidPublicKey = data.publicKey
      console.log('[WebPushService] VAPID public key fetched:', this.vapidPublicKey)
    } catch (error) {
      console.error('[WebPushService] Failed to fetch VAPID key:', error)
      // Fallback to hardcoded key (updated with correct key)
      this.vapidPublicKey = 'BGl9j3HkonR05k5n4JDk9Fgv4cdVRoUW0jJ569QZBhZEMieHayUiaZMqtEvoe6fCVjYTbi1-1jYqf_iVeYByxmQ'
    }
  }
  
  async initialize(): Promise<boolean> {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      console.warn('[WebPushService] Push notifications not supported')
      return false
    }
    
    try {
      // Fetch VAPID public key from backend
      await this.fetchVapidPublicKey()
      
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
      console.error('[WebPushService] No service worker registration')
      return null
    }
    
    if (!this.vapidPublicKey) {
      console.error('[WebPushService] No VAPID public key available')
      return null
    }
    
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
      
      console.log('[WebPushService] Push subscription created:', subscriptionData)
      return subscriptionData
    } catch (error) {
      console.error('[WebPushService] Push subscription failed:', error)
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
