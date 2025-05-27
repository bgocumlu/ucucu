"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Bell, BellOff } from "lucide-react"
import { notificationService, type NotificationInterval } from "@/lib/notification-service"
import { useWebSocket } from "@/components/WebSocketProvider"

interface NotificationBellProps {
  roomId: string
  username: string
  className?: string
}

export function NotificationBell({ roomId, username, className = "" }: NotificationBellProps) {
  const { send, lastMessage, isConnected } = useWebSocket()
  const [hasPermission, setHasPermission] = useState(false)
  const [isSubscribed, setIsSubscribed] = useState(false)
  const [remainingTime, setRemainingTime] = useState(0)
  const [currentInterval, setCurrentInterval] = useState<NotificationInterval>(0)
  // Update state from notification service
  const updateState = useCallback(() => {
    setHasPermission(notificationService.hasNotificationPermission())
    setIsSubscribed(notificationService.isSubscribed(roomId))
    setRemainingTime(notificationService.getRemainingTime(roomId))
    const subscription = notificationService.getSubscription(roomId)
    setCurrentInterval((subscription?.interval || 0) as NotificationInterval)
  }, [roomId])  // Set up WebSocket communication and fetch status from backend
  useEffect(() => {
    console.log('[NotificationBell] Setting up WebSocket communication', { 
      send: typeof send, 
      isConnected,
      roomId,
      username
    })
    
    // Set the WebSocket send function in the notification service
    notificationService.setWebSocketSend(send)
    
    // Only fetch status and restore subscriptions when WebSocket is connected
    if (isConnected) {
      console.log('[NotificationBell] WebSocket connected - restoring subscriptions and fetching status')
      
      // Restore any existing subscriptions for this user
      notificationService.restoreSubscriptionsForUser(username)
      
      // Fetch current subscription status from backend for this room
      send({
        type: "getNotificationStatus",
        roomId,
        username
      })
    }
  }, [send, roomId, username, isConnected])

  // Handle backend messages
  useEffect(() => {
    if (lastMessage && (
      lastMessage.type === 'notificationStatus' || 
      lastMessage.type === 'notificationSubscribed' || 
      lastMessage.type === 'notificationUnsubscribed'
    )) {
      // Update local state from backend response
      if (lastMessage.type === 'notificationStatus' && lastMessage.roomId === roomId) {
        if (lastMessage.subscribed && typeof lastMessage.interval === 'number' && typeof lastMessage.remainingTime === 'number') {
          const subscription = {
            roomId,
            interval: lastMessage.interval,
            startTime: Date.now() - (lastMessage.interval * 60 * 1000 - lastMessage.remainingTime),
            endTime: Date.now() + lastMessage.remainingTime
          }
          notificationService.updateSubscriptionFromBackend(roomId, subscription)
        } else {
          notificationService.removeSubscriptionFromBackend(roomId)
        }
        updateState()      }
    }
  }, [lastMessage, roomId, updateState])

  useEffect(() => {
    updateState()
    
    // Update remaining time every second when subscribed
    const interval = setInterval(() => {
      if (notificationService.isSubscribed(roomId)) {
        setRemainingTime(notificationService.getRemainingTime(roomId))
      } else {
        updateState() // Refresh all state when subscription expires
      }
    }, 1000)

    // Debug keyboard shortcut (Ctrl+Shift+N)
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'N') {
        console.log('[NotificationBell] Debug shortcut pressed')
        notificationService.debugStatus(roomId)
      }
    }

    window.addEventListener('keydown', handleKeyPress)

    return () => {
      clearInterval(interval)
      window.removeEventListener('keydown', handleKeyPress)
    }
  }, [roomId, updateState])

  // Send subscription request to backend
  const syncWithBackend = (interval: NotificationInterval) => {
    send({
      type: "subscribeNotifications",
      roomId,
      username,
      interval
    })
    
    if (interval > 0) {
      console.log('[NotificationBell] Sent subscription request to backend', { roomId, username, interval })
    } else {
      console.log('[NotificationBell] Sent unsubscription request to backend', { roomId, username })
    }
  }

  const handleBellClick = async () => {
    console.log('[NotificationBell] Bell clicked', { hasPermission, isSubscribed, roomId })

    // If no permission, request it
    if (!hasPermission) {
      const permission = await notificationService.requestNotificationPermission()
      if (permission !== 'granted') {
        alert('Please enable notifications in your browser settings to receive room notifications.')
        return
      }
      setHasPermission(true)
    }

    // Cycle through intervals
    const nextInterval = notificationService.getNextInterval(currentInterval)
    console.log('[NotificationBell] Cycling interval', { currentInterval, nextInterval })
    
    if (nextInterval === 0) {
      // Disable notifications
      notificationService.unsubscribeFromRoom(roomId)
      console.log('[NotificationBell] Notifications disabled for room', roomId)    } else {
      // Subscribe with new interval
      const success = await notificationService.subscribeToRoom(roomId, nextInterval)
      if (success) {
        console.log('[NotificationBell] Subscribed to room notifications', { roomId, interval: nextInterval })
      } else {
        console.error('[NotificationBell] Failed to subscribe to room notifications', roomId)
      }
    }

    // Sync with backend
    syncWithBackend(nextInterval)
    
    updateState()
  }

  const handleTestNotification = async () => {
    console.log('[NotificationBell] Testing notification system')
    
    // Don't use testNotification method, instead show notification directly
    if (notificationService.hasNotificationPermission()) {
      await notificationService.showNotification(roomId, {
        username: 'System',
        content: 'Test notification! You\'ll receive notifications for new messages when away. 🔔'
      })
    } else {
      console.log('[NotificationBell] No permission for test notification')
    }
  }

  const getBellIcon = () => {
    if (!hasPermission || !isSubscribed) {
      return BellOff
    }
    return Bell
  }

  const getBellSize = () => {
    // When timer is active, make bell smaller
    return isSubscribed ? "h-3 w-3" : "h-4 w-4"
  }

  const formatTime = (seconds: number): string => {
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    
    if (minutes > 0) {
      return `${minutes}m`
    } else {
      return `${remainingSeconds}s`
    }
  }

  const BellIcon = getBellIcon()

  return (
    <div className={`flex flex-col items-center justify-center ${className}`}>
      <Button
        variant="ghost"
        size="sm"
        className="h-8 w-8 p-0 rounded-full hover:bg-gray-100"
        onClick={handleBellClick}
        onDoubleClick={handleTestNotification} // Double-click to test
        title={
          !hasPermission
            ? "Enable notifications (double-click to test)"
            : !isSubscribed
            ? "Click to enable room notifications (double-click to test)"
            : `Notifications active for ${Math.ceil(remainingTime / 60)} minutes (double-click to test)`
        }
      >
        <BellIcon 
          className={`${getBellSize()} ${
            !hasPermission || !isSubscribed 
              ? "text-gray-400" 
              : "text-blue-600"
          }`} 
        />
      </Button>
      
      {/* Timer display when notifications are active */}
      {isSubscribed && remainingTime > 0 && (
        <div className="text-xs text-gray-500 font-mono leading-none -mt-1">
          {formatTime(remainingTime)}
        </div>
      )}
    </div>
  )
}
