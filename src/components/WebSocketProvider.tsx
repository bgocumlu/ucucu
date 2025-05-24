"use client";

import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";

export type WSMessage = { type: string; [key: string]: unknown };

type WebSocketContextType = {
  ws: WebSocket | null;
  send: (msg: WSMessage) => void;
  lastMessage: WSMessage | null;
  setOnMessage: (cb: ((msg: WSMessage) => void) | null) => void;
  isConnected: boolean;
};

const WebSocketContext = createContext<WebSocketContextType | undefined>(undefined);

export const WebSocketProvider = ({ children }: { children: React.ReactNode }) => {
  const [lastMessage, setLastMessage] = useState<WSMessage | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const onMessageRef = useRef<((msg: WSMessage) => void) | null>(null);

  useEffect(() => {
    const ws = new WebSocket("ws://localhost:3001");
    wsRef.current = ws;
    ws.onopen = () => setIsConnected(true);
    ws.onclose = () => setIsConnected(false);
    ws.onerror = () => setIsConnected(false);
    // Only update setLastMessage and call onMessageRef.current if the message is different
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        console.log('WebSocket message received:', msg);
        setLastMessage((prev) => {
          if (JSON.stringify(prev) !== JSON.stringify(msg)) {
            if (onMessageRef.current) onMessageRef.current(msg);
            return msg;
          }
          return prev;
        });
      } catch {}
    };
    return () => {
      ws.close();
    };
  }, []);

  const send = useCallback((msg: WSMessage) => {
    if (wsRef.current && wsRef.current.readyState === 1) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const setOnMessage = useCallback((cb: ((msg: WSMessage) => void) | null) => {
    onMessageRef.current = cb;
  }, []);

  return (
    <WebSocketContext.Provider value={{ ws: wsRef.current, send, lastMessage, setOnMessage, isConnected }}>
      {children}
    </WebSocketContext.Provider>
  );
};

export const useWebSocket = () => {
  const ctx = useContext(WebSocketContext);
  if (!ctx) throw new Error("useWebSocket must be used within a WebSocketProvider");
  return ctx;
};
