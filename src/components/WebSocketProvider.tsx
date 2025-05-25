"use client";

import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";

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
  const messageQueue = useRef<WSMessage[]>([]);

  const connect = useCallback(() => {
    // Always defer connection logic to avoid setState during render
    Promise.resolve().then(() => {
      if (wsRef.current && (wsRef.current.readyState === 0 || wsRef.current.readyState === 1)) {
        // Already connecting or open
        return;
      }
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;
      ws.onopen = () => {
        setIsConnected(true);
        // Send any queued messages
        while (messageQueue.current.length > 0) {
          const msg = messageQueue.current.shift();
          if (msg) ws.send(JSON.stringify(msg));
        }
        if (reconnectTimer.current) {
          clearTimeout(reconnectTimer.current);
          reconnectTimer.current = null;
        }
      };
      ws.onclose = () => {
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
      };
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
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
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (wsRef.current) wsRef.current.close();
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    };
  }, [connect]);

  const send = useCallback((msg: WSMessage) => {
    if (wsRef.current && wsRef.current.readyState === 1) {
      console.log('[WebSocketProvider] Sending message:', msg)
      wsRef.current.send(JSON.stringify(msg));
    } else {
      console.warn('[WebSocketProvider] Tried to send but WebSocket not open', wsRef.current?.readyState)
      // Queue the message to be sent when the socket opens
      messageQueue.current.push(msg);
    }
  }, []);

  const setOnMessage = useCallback((cb: ((msg: WSMessage) => void) | null) => {
    onMessageRef.current = cb;
  }, []);

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
