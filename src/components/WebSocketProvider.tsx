"use client";

import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import { notificationService } from "@/lib/notification-service";

export type WSMessage = { type: string; [key: string]: unknown };

type WebSocketContextType = {
  send: (msg: WSMessage) => void;
  lastMessage: WSMessage | null;
  setOnMessage: (cb: ((msg: WSMessage) => void) | null) => void;
  isConnected: boolean;
};

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:3001";

const WebSocketContext = createContext<WebSocketContextType | undefined>(undefined);

export const WebSocketProvider = ({ children }: { children: React.ReactNode }) => {
  const [lastMessage, setLastMessage] = useState<WSMessage | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const onMessageRef = useRef<((msg: WSMessage) => void) | null>(null);
  const reconnectTimer = useRef<NodeJS.Timeout | null>(null);

  const connect = useCallback(() => {
    // Always defer connection logic to avoid setState during render
    Promise.resolve().then(() => {
      if (wsRef.current && (wsRef.current.readyState === 0 || wsRef.current.readyState === 1)) {
        // Already connecting or open
        return;
      }
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;      ws.onopen = () => {
        console.log('[WebSocketProvider] WebSocket connected');
        setIsConnected(true);
        if (reconnectTimer.current) {
          clearTimeout(reconnectTimer.current);
          reconnectTimer.current = null;
        }
      };      ws.onclose = () => {
        console.log('[WebSocketProvider] WebSocket disconnected');
        setIsConnected(false);
        if (!reconnectTimer.current) {
          reconnectTimer.current = setTimeout(connect, 3000); // Try to reconnect every 3s
        }
      };
      ws.onerror = () => {
        setIsConnected(false);
        if (!reconnectTimer.current) {
          reconnectTimer.current = setTimeout(connect, 3000);
        }
      };      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          
          // Handle notification status responses
          if (msg.type === 'notificationStatus' || msg.type === 'allNotificationStatus') {
            console.log('[WebSocketProvider] Received notification status:', msg);
            notificationService.handleBackendSubscriptionUpdate(msg);
            return;
          }
          
          // Handle file delivery status messages
          if (msg.type === 'fileDeliverySuccess' || msg.type === 'fileDeliveryFailed' || msg.type === 'fileDeliveryTimeout') {
            console.log('[WebSocketProvider] Received file delivery status:', msg);
            
            // Show user-friendly notification based on delivery status
            if (typeof window !== 'undefined') {
              if (msg.type === 'fileDeliverySuccess') {
                // You could show a subtle success indicator
                console.log(`✅ File "${msg.fileName}" delivered to all ${msg.totalRecipients} recipients`);
              } else if (msg.type === 'fileDeliveryFailed') {
                const unconfirmed = msg.unconfirmedRecipients?.join(', ') || 'some recipients';
                alert(`❌ File delivery failed: "${msg.fileName}" could not be delivered to ${unconfirmed}. Please try sending the file again.`);
              } else if (msg.type === 'fileDeliveryTimeout') {
                const unconfirmed = msg.unconfirmedRecipients?.join(', ') || 'some recipients';
                alert(`⚠️ File delivery timeout: "${msg.fileName}" may not have been received by ${unconfirmed}. You may want to check with them or resend the file.`);
              }
            }
            
            // Don't set this as lastMessage since it's a status notification
            return;
          }
            // Handle push notifications
          if (msg.type === 'pushNotification') {
            console.log('[WebSocketProvider] Received push notification:', msg);
            
            // Only show notification via WebSocket if Service Worker is not available
            // If Service Worker is available, it will handle the push notification directly
            if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) {
              console.log('[WebSocketProvider] Service Worker not available, showing notification via WebSocket');
              notificationService.showNotification(msg.roomId, msg.message);
            } else {
              console.log('[WebSocketProvider] Service Worker available, skipping WebSocket notification (will be handled by SW)');
              // notificationService.showNotification(msg.roomId, msg.message);
            }
            // Don't set this as lastMessage as it's not for UI updates
            return;
          }
          
          // Handle security error messages with redirect information
          if (msg.type === 'error' && msg.redirect && msg.action === 'rejoin') {
            console.log('[WebSocketProvider] Received security error with redirect:', msg);
            
            // Show error message to user
            if (typeof window !== 'undefined') {
              alert(msg.error || 'Security error: You need to rejoin the room.');
              
              // Redirect user to the room page to rejoin
              // window.location.href = msg.redirect;
            }
            
            // Don't set this as lastMessage to avoid confusing the UI
            return;
          }
          
          setLastMessage((prev) => {
            if (JSON.stringify(prev) !== JSON.stringify(msg)) {
              if (onMessageRef.current) onMessageRef.current(msg);
              return msg;
            }
            return prev;
          });
        } catch {}
      };
    });
  }, []);  useEffect(() => {
    connect();
    return () => {
      if (wsRef.current) wsRef.current.close();
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    };
  }, [connect]);
  const send = useCallback((msg: WSMessage) => {
    if (wsRef.current && wsRef.current.readyState === 1) {
      console.log('[WebSocketProvider] Sending message:', msg)
      // Special logging for file confirmations
      if (msg.type === 'fileReceived') {
        console.log('[WebSocketProvider] 🔴 SENDING FILE CONFIRMATION:', {
          type: msg.type,
          fileName: msg.fileName,
          senderId: msg.senderId,
          username: msg.username,
          timestamp: msg.timestamp,
          roomId: msg.roomId
        });
      }
      wsRef.current.send(JSON.stringify(msg));
    } else {
      console.warn('[WebSocketProvider] WebSocket not ready, current state:', wsRef.current?.readyState);
      
      // Special warning for file confirmations
      if (msg.type === 'fileReceived') {
        console.error('[WebSocketProvider] 🔴 FAILED TO SEND FILE CONFIRMATION - WebSocket not ready:', msg);
      }
      
      // Simple retry after a short delay if WebSocket is connecting (state 0)
      if (wsRef.current?.readyState === 0) {
        setTimeout(() => {
          if (wsRef.current && wsRef.current.readyState === 1) {
            console.log('[WebSocketProvider] Retrying message after connection:', msg);
            if (msg.type === 'fileReceived') {
              console.log('[WebSocketProvider] 🔴 RETRYING FILE CONFIRMATION:', msg);
            }
            wsRef.current.send(JSON.stringify(msg));
          } else {
            console.warn('[WebSocketProvider] Failed to send after retry, WebSocket state:', wsRef.current?.readyState);
            if (msg.type === 'fileReceived') {
              console.error('[WebSocketProvider] 🔴 FAILED TO RETRY FILE CONFIRMATION:', msg);
            }
          }
        }, 1000);
      }
    }
  }, []);

  const setOnMessage = useCallback((cb: ((msg: WSMessage) => void) | null) => {
    onMessageRef.current = cb;
  }, []);

  // Set up notification service WebSocket integration
  useEffect(() => {
    notificationService.setWebSocketSend(send);
  }, [send]);

  // Memoize context value to avoid triggering renders from wsRef.current changes
  const contextValue = React.useMemo(() => ({
    send,
    lastMessage,
    setOnMessage,
    isConnected,
  }), [send, lastMessage, setOnMessage, isConnected]);
  useEffect(() => {
    // Expose wsRef for bfcache workaround
    if (typeof window !== "undefined") {
      // @ts-expect-error: __ws is not a standard property, used for bfcache workaround
      window.__ws = wsRef.current;
    }
  }, [isConnected]); // Add dependency to prevent running on every render

  return (
    <WebSocketContext.Provider value={contextValue}>
      {children}
    </WebSocketContext.Provider>
  );
};

export const useWebSocket = () => {
  const ctx = useContext(WebSocketContext);
  if (!ctx) throw new Error("useWebSocket must be used within a WebSocketProvider");
  return ctx;
};
