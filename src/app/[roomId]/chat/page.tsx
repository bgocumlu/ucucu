/* eslint-disable @typescript-eslint/no-unused-vars */
"use client"

import type React from "react"

import { useState, useEffect, useRef } from "react"
import { useParams, useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ArrowLeft, Send, Paperclip, Mic, MoreVertical, ArrowDown, Phone } from "lucide-react"
import { ChatMessage } from "@/components/chat-message"
import { RoomSettingsModal } from "@/components/room-settings-modal"
import { RoomLeaveDialog } from "@/components/room-leave-dialog"
import { NotificationBell } from "@/components/notification-bell"
import { useWebSocket } from "@/components/WebSocketProvider"
import type { WSMessage } from "@/components/WebSocketProvider"

interface Message {
  id: string
  type: "text" | "file" | "audio" | "system"
  username: string
  content: string
  timestamp: Date
  isOwn: boolean
  fileData?: string
  fileName?: string
  isAI?: boolean  // Flag to identify AI messages
}

interface Participant {
  username: string
  isOwner: boolean
}

type RoomInfoMsg = { id: string; name: string; count: number; maxParticipants: number; locked: boolean; exists: boolean; owner?: string }

export default function ChatPage() {
  const params = useParams()
  const router = useRouter()
  const rawRoomId = params.roomId as string
  const roomId = decodeURIComponent(rawRoomId)
  const { send, lastMessage, isConnected } = useWebSocket()
  const [messages, setMessages] = useState<Message[]>([])
  const [participants, setParticipants] = useState<Participant[]>([])
  const [currentUser, setCurrentUser] = useState<string>("")
  const [messageText, setMessageText] = useState("")
  const [isTyping, setIsTyping] = useState("")
  const [showSettings, setShowSettings] = useState(false)
  const [isAtBottom, setIsAtBottom] = useState(true)
  const [isRecording, setIsRecording] = useState(false)
  const [isSendingFiles, setIsSendingFiles] = useState(false)
  const [fileUploadProgress, setFileUploadProgress] = useState<{
    current: number;
    total: number;
    fileName: string;
  } | null>(null)
  const [usersUploadingFiles, setUsersUploadingFiles] = useState<Set<string>>(new Set())
  const [fileDeliveryStatus, setFileDeliveryStatus] = useState<Map<string, {
    fileName: string;
    sentAt: number;
    deliveredTo: Set<string>;
    totalRecipients: number;
    status?: string;
    attempts?: number;
  }>>(new Map())
  const [showLeaveDialog, setShowLeaveDialog] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const chatContainerRef = useRef<HTMLDivElement>(null)
  const pendingUpdateRef = useRef<{
    updateId: string
    resolve: () => void
    reject: (error: Error) => void
    timeout: NodeJS.Timeout
  } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  interface PendingConfirmationPayload { type:'fileReceived'; roomId:string; fileName:string; senderId:string; username:string; timestamp:number; transferId?: string }
  const pendingFileConfirmations = useRef<Map<string,{attempts:number;lastAttempt:number;payload:PendingConfirmationPayload}>>(new Map());
  // Map provisional file key (fileName-timestamp) -> transferId once ack arrives
  const provisionalFileKeys = useRef<Map<string,string>>(new Map());

  // Join room on mount
  useEffect(() => {
    // Check for username in sessionStorage
    const username = sessionStorage.getItem(`username:${roomId}`) || ""
    
    if (!username) {
      router.replace(`/${encodeURIComponent(roomId)}`);
      return
    }
    
    setCurrentUser(username)
    send({ type: "joinRoom", roomId, username })

    // Initialize empty messages
    setMessages([])
  }, [roomId, send, router])// Track room owner and info for RoomSettingsModal
  const [roomOwner, setRoomOwner] = useState<string>("")
  const [roomInfo, setRoomInfo] = useState<{
    name?: string
    maxParticipants?: number
    locked?: boolean
    visibility?: 'public' | 'private'
  }>({})
  const [pendingUpdate, setPendingUpdate] = useState<string | null>(null)

  // Listen for messages and participants
  useEffect(() => {
    if (!lastMessage) return
    if (lastMessage.type === "messages" && lastMessage.roomId === roomId) {
      // Set all messages from server, including system join/leave
      setMessages(
        (lastMessage.messages as Array<{ username: string; text: string; timestamp: number; system?: boolean }>).
          map((msg) => ({
            id: (msg.timestamp || Date.now()).toString(),
            type: msg.system ? "system" : "text",
            username: msg.username || "",
            content: msg.text || "",
            timestamp: new Date(msg.timestamp),
            isOwn: msg.username === currentUser,
          }))
      )
    }    if (lastMessage.type === "newMessage" && lastMessage.roomId === roomId) {
      type IncomingMsg =
        | { username: string; text: string; timestamp: number; system?: boolean; isAI?: boolean; isTyping?: boolean; type?: undefined }
        | { username: string; fileName: string; fileType: string; fileData: string; timestamp: number; type: "file"; asAudio?: boolean; transferId?: string }
        | { username: string; type: "fileUploadStart" | "fileUploadEnd"; fileName?: string; timestamp: number };
      const msg = lastMessage.message as IncomingMsg;
      
      // Handle file upload status messages
      if (msg.type === "fileUploadStart") {
        setUsersUploadingFiles(prev => new Set([...prev, msg.username]));
      } else if (msg.type === "fileUploadEnd") {
        setUsersUploadingFiles(prev => {
          const newSet = new Set(prev);
          newSet.delete(msg.username);
          return newSet;
        });      } else if (msg.type === "file" && (msg.asAudio || (msg.fileType && msg.fileType.startsWith('audio/')))) {
        // Only add if it's not from current user (we already added optimistically)
        if (msg.username !== currentUser) {
          // Require transferId for tracking
          if (!msg.transferId) {
            console.warn('[CHAT] Received audio/file without transferId, ignoring confirmation logic');
          }
          setMessages((prev) => [
            ...prev,
            {
              id: `${msg.timestamp || Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              type: "audio",
              username: msg.username,
              content: msg.fileName || "Voice message",
              timestamp: new Date(msg.timestamp),
              isOwn: false,
              fileData: msg.fileData,
              fileName: msg.fileName,
            },
          ]);
          if (msg.transferId) {
            // Send confirmation that file was received
            const confirmationMessage: PendingConfirmationPayload = {
              type: 'fileReceived',
              roomId,
              fileName: msg.fileName,
              senderId: msg.username,
              username: currentUser,
              timestamp: msg.timestamp,
              transferId: msg.transferId
            };
            console.log('[CHAT] Sending file received confirmation:', confirmationMessage);
            send(confirmationMessage as unknown as WSMessage);
            pendingFileConfirmations.current.set(msg.transferId,{attempts:1,lastAttempt:Date.now(),payload:confirmationMessage});
          }
        }
      } else if (msg.type === "file") {
        if (msg.username !== currentUser) {
          if (!msg.transferId) {
            console.warn('[CHAT] Received file without transferId, ignoring confirmation logic');
          }
          setMessages((prev) => [
            ...prev,
            {
              id: `${msg.timestamp || Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              type: "file",
              username: msg.username,
              content: msg.fileName || "File",
              timestamp: new Date(msg.timestamp),
              isOwn: false,
              fileData: msg.fileData,
              fileName: msg.fileName,
            },
          ]);
          if (msg.transferId) {
            const confirmationMessage: PendingConfirmationPayload = {
              type: 'fileReceived',
              roomId,
              fileName: msg.fileName,
              senderId: msg.username,
              username: currentUser,
              timestamp: msg.timestamp,
              transferId: msg.transferId
            };
            console.log('[CHAT] Sending file received confirmation:', confirmationMessage);
            send(confirmationMessage as unknown as WSMessage);
            pendingFileConfirmations.current.set(msg.transferId,{attempts:1,lastAttempt:Date.now(),payload:confirmationMessage});
          }
        }
      } else {
        // Handle regular text messages (including AI messages)
        const msg = lastMessage.message as { 
          username: string; 
          text: string; 
          timestamp: number; 
          system?: boolean; 
          isAI?: boolean; 
          isTyping?: boolean; 
        };
          // Handle AI typing indicator
        if (msg.isAI && msg.isTyping) {
          // Remove any existing typing message and add new one
          setMessages((prev) => {
            const withoutTyping = prev.filter(m => !(m.isAI && (m.content.includes('Thinking') || m.content.includes('🤖 Thinking'))));
            return [
              ...withoutTyping,
              {
                id: `typing-${msg.timestamp}-${Math.random().toString(36).substr(2, 9)}`,
                type: "text" as const,
                username: msg.username,
                content: msg.text,
                timestamp: new Date(msg.timestamp),
                isOwn: false,
                isAI: true,
              },
            ];
          });
        } else if (msg.isAI && !msg.isTyping) {
          // Replace typing indicator with actual AI response, but keep user's original AI command
          setMessages((prev) => {
            // Remove only typing indicators, keep all other messages including user's AI command
            const withoutTyping = prev.filter(m => !(m.isAI && (m.content.includes('Thinking') || m.content.includes('🤖 Thinking'))));
            return [
              ...withoutTyping,
              {
                id: `${msg.timestamp}-${Math.random().toString(36).substr(2, 9)}`,
                type: msg.system ? "system" : "text",
                username: msg.username,
                content: msg.text,
                timestamp: new Date(msg.timestamp),
                isOwn: false, // AI messages are never "own"
                isAI: true,
              },
            ];
          });
        } else {
          // Regular message handling (including user's AI commands)
          setMessages((prev) => [
            ...prev,
            {
              id: `${msg.timestamp}-${Math.random().toString(36).substr(2, 9)}`,
              type: msg.system ? "system" : "text",
              username: msg.username,
              content: msg.text,
              timestamp: new Date(msg.timestamp),
              isOwn: msg.username === currentUser,
              isAI: msg.isAI || false,
            },
          ]);
        }
      }}    // Prefer roomInfo for participants if available
    if (lastMessage.type === "roomInfo" && lastMessage.room && (lastMessage.room as RoomInfoMsg).id === roomId) {
      const info = lastMessage.room as RoomInfoMsg & { users?: string[]; visibility?: 'public' | 'private' }
      setRoomOwner(info.owner || "")
        // Check if this is a response to a pending room update from current user
      const isResponseToPendingUpdate = pendingUpdateRef.current && (lastMessage as { updateId?: string }).updateId === pendingUpdateRef.current.updateId;
      
      if (isResponseToPendingUpdate && pendingUpdateRef.current) {
        // This is a response to our own update request
        clearTimeout(pendingUpdateRef.current.timeout)
        setPendingUpdate(null)
        pendingUpdateRef.current.resolve()
        pendingUpdateRef.current = null
      }
      
      // Always update room info for live updates, unless we have a pending update AND this isn't the response to it
      const shouldUpdateRoomInfo = !pendingUpdate || isResponseToPendingUpdate;
      
      if (shouldUpdateRoomInfo) {
        setRoomInfo({
          name: info.name,
          maxParticipants: info.maxParticipants,
          locked: info.locked,
          visibility: info.visibility || 'public'
        })
      }
      
      if (info.users && Array.isArray(info.users)) {
        setParticipants(
          info.users.map((username) => ({
            username,
            isOwner: info.owner ? username === info.owner : false,
          }))
        )
      }    } else if (lastMessage.type === "error" && pendingUpdateRef.current) {
      // Handle errors for room updates
      clearTimeout(pendingUpdateRef.current.timeout)
      setPendingUpdate(null)
      pendingUpdateRef.current.reject(new Error(String(lastMessage.error) || 'Failed to update room settings'))
      pendingUpdateRef.current = null
    } else if (lastMessage.type === "rooms" && Array.isArray(lastMessage.rooms)) {
      type Room = { id: string; name: string; users?: string[]; owner?: string }
      const found = (lastMessage.rooms as Room[]).find((r) => r.id === roomId)
      if (found && found.users) {
        setParticipants(
          found.users.map((username) => ({
            username,
            isOwner: found.owner ? username === found.owner : false,
          }))
        )      }
    }    // Handle file upload acknowledgments
    if (lastMessage.type === "fileUploadAck") {
      const { fileName, success, transferId, timestamp, recipients } = lastMessage as unknown as { fileName:string; success:boolean; transferId?:string; timestamp:number; recipients:number };
      if (transferId) {
        // Migrate provisional key (if exists) to transferId
        const provisionalKey = `${fileName}-${timestamp}`;
        setFileDeliveryStatus(prev => {
          const updated = new Map(prev);
          const provisional = updated.get(provisionalKey);
          if (provisional) {
            updated.delete(provisionalKey);
            provisionalFileKeys.current.set(provisionalKey, transferId);
            // Preserve delivered info
            updated.set(transferId, { ...provisional, status: success ? 'pending' : 'immediate-fail' });
          } else if (!updated.has(transferId)) {
            updated.set(transferId, { fileName, sentAt: Date.now(), deliveredTo: new Set(), totalRecipients: recipients || 0, status: success ? 'pending' : 'immediate-fail' });
          }
          return updated;
        });
      }
    }
    // Handle file delivery confirmations (sender perspective)
    if (lastMessage.type === "fileDeliveryConfirmed") {
      const confirmationData = lastMessage as unknown as {
        fileName: string;
        receiverUsername: string;
        timestamp: number;
        originalTimestamp: number;
        transferId?: string;
      };
      const key = confirmationData.transferId;
      if (!key) return; // ignore if missing
      setFileDeliveryStatus(prev => {
        const updated = new Map(prev);
        const existing = updated.get(key);
        if (existing) {
          existing.deliveredTo.add(confirmationData.receiverUsername);
          updated.set(key, existing);
        }
        return updated;
      });
    }
    // Unified handling of delivery state events keyed by transferId
    const deliveryEvents = new Set(['fileDeliveryPending','fileDeliveryProgress','fileDeliverySuccess','fileDeliveryFailed','fileDeliveryTimeout','fileDeliveryImmediateFail','fileDeliveryRetry']);
    if (deliveryEvents.has(lastMessage.type) && (lastMessage as WSMessage & { transferId?: string }).transferId) {
      const lm = lastMessage as WSMessage & { transferId: string; fileName?: string; totalRecipients?: number; deliveredRecipients?: string[]; confirmedRecipients?: string[]; attempt?: number };
      const key = lm.transferId;
      setFileDeliveryStatus(prev => {
        const updated = new Map(prev);
        let rec = updated.get(key);
        if (!rec) {
          rec = { fileName: String(lm.fileName), sentAt: Date.now(), deliveredTo: new Set(), totalRecipients: Number(lm.totalRecipients||0), status: 'pending', attempts:0 };
        }
        if (lm.type === 'fileDeliveryPending') {
          rec.totalRecipients = Number(lm.totalRecipients||rec.totalRecipients);
          rec.status = 'pending';
        } else if (lm.type === 'fileDeliveryProgress') {
          rec.deliveredTo = new Set(lm.deliveredRecipients || []);
          rec.totalRecipients = Number(lm.totalRecipients||rec.totalRecipients);
          rec.status = 'progress';
        } else if (lm.type === 'fileDeliveryRetry') {
          rec.status = 'retrying';
          rec.attempts = Number(lm.attempt ?? rec.attempts ?? 0);
        } else if (lm.type === 'fileDeliverySuccess') {
          rec.deliveredTo = new Set(lm.confirmedRecipients || []);
          rec.status = 'complete';
        } else if (lm.type === 'fileDeliveryFailed') {
          rec.status = 'failed';
        } else if (lm.type === 'fileDeliveryTimeout') {
          rec.status = 'timeout';
        } else if (lm.type === 'fileDeliveryImmediateFail') {
          rec.status = 'immediate-fail';
        }
        updated.set(key, rec);
        return updated;
      });
    }
    if (lastMessage.type === 'fileDeliveryReceiptAck') {
      const ackKey = (lastMessage as WSMessage & { transferId?: string }).transferId;
      if (ackKey && pendingFileConfirmations.current.has(ackKey)) {
        pendingFileConfirmations.current.delete(ackKey);
      }
    }
  }, [lastMessage, roomId, currentUser, pendingUpdate, send])
  // Auto-scroll to bottom
  useEffect(() => {
    if (isAtBottom) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
    }
  }, [messages, isAtBottom])

  // Monitor file delivery status and alert on potential issues
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      const WARNING_TIMEOUT = 15000; // warn after 15s
      const FAIL_TIMEOUT = 30000; // mark failed after 30s (matches server cleanup window)
      const CLEANUP_TIMEOUT = 60000; // remove local tracking after 60s

      // We mutate via a staged copy only when needed to avoid unnecessary re-renders
      let needsUpdate = false;
      const updated = new Map(fileDeliveryStatus);

  fileDeliveryStatus.forEach((status, key) => {
        const deliveredCount = status.deliveredTo.size;
        const total = status.totalRecipients;
        const timeSinceSent = now - status.sentAt;

        // Skip completed or already failed states (including server-declared failures/timeouts)
        const terminalStates: Array<string> = ['complete','failed','timeout','immediate-fail','failed-local'];
        if (status.status && terminalStates.includes(status.status)) return;

        // Warning stage
        // Augment status object with optional flags without using any
        type AugmentedStatus = typeof status & { warned?: boolean; failureNotified?: boolean };
        const s = status as AugmentedStatus;
        if (timeSinceSent > WARNING_TIMEOUT && deliveredCount < total && !s.warned) {
          console.warn(`[FILE DELIVERY] Possible delay for ${status.fileName} (${deliveredCount}/${total})`);
          s.warned = true;
          needsUpdate = true;
        }

        // Failure stage (local) – server should also emit, but if not received we fallback
        if (timeSinceSent > FAIL_TIMEOUT && deliveredCount < total) {
          if (status.status !== 'failed-local') {
            status.status = 'failed-local';
            if (!s.failureNotified) {
              s.failureNotified = true;
              // Append a non-intrusive system message instead of alert()
              setMessages(prev => [...prev, {
                id: `filefail_${key}_${Date.now()}`,
                username: '',
                text: `File delivery failed: ${status.fileName}. Not all recipients confirmed.`,
                content: `File delivery failed: ${status.fileName}. Not all recipients confirmed.`,
                type: 'system',
                isOwn: false,
                timestamp: new Date(),
                system: true
              }]);
            }
            needsUpdate = true;
          }
        }

        // Cleanup very old pending entries to prevent infinite warnings
        if (timeSinceSent > CLEANUP_TIMEOUT && deliveredCount < total) {
          updated.delete(key);
          needsUpdate = true;
        }
      });

      if (needsUpdate) {
        setFileDeliveryStatus(updated);
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [fileDeliveryStatus, setMessages])

  // Handle scroll to detect if user is at bottom
  const handleScroll = () => {
    if (chatContainerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = chatContainerRef.current
      const atBottom = scrollHeight - scrollTop - clientHeight < 100
      setIsAtBottom(atBottom)
    }
  }

  const sendMessage = () => {
    if (!messageText.trim()) return
    send({ type: "sendMessage", roomId, username: currentUser, text: messageText })
    setMessageText("")
    setIsAtBottom(true)
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  // --- File upload handler ---
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const fileArray = Array.from(files);

    // Check file sizes and filter (60MB limit)
    const MAX_FILE_SIZE = 60 * 1024 * 1024; // 60MB in bytes
    const validFiles = fileArray.filter(file => file.size <= MAX_FILE_SIZE);
    const oversizedFiles = fileArray.filter(file => file.size > MAX_FILE_SIZE);
    
    // Show warning for oversized files but continue with valid ones
    if (oversizedFiles.length > 0) {
      const fileNames = oversizedFiles.map(f => f.name).join(', ');
      alert(`The following files are too large (max 60MB) and will be skipped: ${fileNames}`);
    }
    
    // If no valid files, exit
    if (validFiles.length === 0) {
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }    // Send each file individually, reliably
    const sendFiles = async () => {
      setIsSendingFiles(true);
      setFileUploadProgress({ current: 0, total: validFiles.length, fileName: "" });
      
      // Notify others that this user started uploading files
      send({
        type: "sendMessage",
        roomId,
        username: currentUser,
        text: "",
        messageType: "fileUploadStart"
      });      try {
        for (let idx = 0; idx < validFiles.length; idx++) {
          const file = validFiles[idx];
          setFileUploadProgress({
            current: idx + 1,
            total: validFiles.length,
            fileName: file.name
          });
          
          await new Promise<void>((resolve) => {
            const reader = new FileReader();
            reader.onload = async () => {
              const base64 = reader.result as string;
              const timestamp = Date.now() + Math.random(); // Ensure uniqueness
              const isAudio = file.type.startsWith('audio/');
              
              // Immediately add the file to sender's view (optimistic update)
              const optimisticMessage = {
                id: `${timestamp}_${Math.random()}`,
                type: isAudio ? "audio" as const : "file" as const,
                username: currentUser,
                content: file.name,
                timestamp: new Date(timestamp),
                isOwn: true,
                fileData: base64,
                fileName: file.name,
                transferId: undefined // server assigns
              };
              
              setMessages(prev => [...prev, optimisticMessage]);
                // Send the file to server
              try {
                // Initialize delivery tracking for this file
                const deliveryKey = `${file.name}-${timestamp}`; // provisional key
                const totalRecipients = Math.max(1, participants.length - 1); // Exclude sender
                setFileDeliveryStatus(prev => {
                  const updated = new Map(prev);
                  updated.set(deliveryKey, {
                    fileName: file.name,
                    sentAt: timestamp,
                    deliveredTo: new Set(),
                    totalRecipients: totalRecipients,
                    status: 'pending'
                  });
                  return updated;
                });
                provisionalFileKeys.current.set(deliveryKey, '');
                
                if (isAudio) {
                  send({
                    type: "sendFile",
                    roomId,
                    username: currentUser,
                    fileName: file.name,
                    fileType: file.type,
                    fileData: base64,
                    timestamp,
                    asAudio: true,
                  });
                } else {
                  send({
                    type: "sendFile",
                    roomId,
                    username: currentUser,
                    fileName: file.name,
                    fileType: file.type,
                    fileData: base64,
                    timestamp,
                  });
                }
                console.log(`[FILE UPLOAD] Sent ${file.name} to server (${totalRecipients} expected recipients)`);
              } catch (error) {
                console.error(`[FILE UPLOAD] Failed to send ${file.name}:`, error);
              }
              
              // Add small delay between files to prevent server overload
              if (idx < validFiles.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 100));
              }
              
              resolve();
            };
            reader.readAsDataURL(file);
          });
        }      } finally {
        // Notify others that this user finished uploading files
        send({
          type: "sendMessage",
          roomId,
          username: currentUser,
          text: "",
          messageType: "fileUploadEnd"
        });
        
        setIsSendingFiles(false);
        setFileUploadProgress(null);
        
        // Failsafe: Clear upload status for current user after a delay
        setTimeout(() => {
          setUsersUploadingFiles(prev => {
            const newSet = new Set(prev);
            newSet.delete(currentUser);
            return newSet;
          });
        }, 1000);
      }
    };
    sendFiles();
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  // --- Drag-and-drop file upload ---
  useEffect(() => {
    const chatDiv = chatContainerRef.current;
    if (!chatDiv) return;
    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer?.files) {
        const fileArray = Array.from(e.dataTransfer.files);

        // Check file sizes and filter (60MB limit)
        const MAX_FILE_SIZE = 60 * 1024 * 1024; // 60MB in bytes
        const validFiles = fileArray.filter(file => file.size <= MAX_FILE_SIZE);
        const oversizedFiles = fileArray.filter(file => file.size > MAX_FILE_SIZE);
        
        // Show warning for oversized files but continue with valid ones
        if (oversizedFiles.length > 0) {
          const fileNames = oversizedFiles.map(f => f.name).join(', ');
          alert(`The following files are too large (max 60MB) and will be skipped: ${fileNames}`);
        }
        
        // If no valid files, exit
        if (validFiles.length === 0) {
          return;
        }         const sendFiles = async () => {
          setIsSendingFiles(true);
          setFileUploadProgress({ current: 0, total: validFiles.length, fileName: "" });
          
          // Notify others that this user started uploading files
          send({
            type: "sendMessage",
            roomId,
            username: currentUser,
            text: "",
            messageType: "fileUploadStart"
          });          try {
            for (let idx = 0; idx < validFiles.length; idx++) {
              const file = validFiles[idx];
              setFileUploadProgress({
                current: idx + 1,
                total: validFiles.length,
                fileName: file.name
              });
              
              await new Promise<void>((resolve) => {
                const reader = new FileReader();
                reader.onload = async () => {
                  const base64 = reader.result as string;
                  const timestamp = Date.now() + Math.random(); // Ensure uniqueness
                  
                  // Immediately add the file to sender's view (optimistic update)
                  const optimisticMessage = {
                    id: `${timestamp}_${Math.random()}`,
                    type: "file" as const,
                    username: currentUser,
                    content: file.name,
                    timestamp: new Date(timestamp),
                    isOwn: true,
                    fileData: base64,
                    fileName: file.name,
                  };
                  
                  setMessages(prev => [...prev, optimisticMessage]);
                  
                  // Send the file to server
                  try {
                    send({
                      type: "sendFile",
                      roomId,
                      username: currentUser,
                      fileName: file.name,
                      fileType: file.type,
                      fileData: base64,
                      timestamp,
                    });                    console.log(`[FILE UPLOAD] Sent ${file.name} to server`);
                  } catch (error) {
                    console.error(`[FILE UPLOAD] Failed to send ${file.name}:`, error);
                  }
                  
                  // Add small delay between files to prevent server overload
                  if (idx < validFiles.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                  }
                  
                  resolve();
                };
                reader.readAsDataURL(file);
              });
            }          } finally {
            // Notify others that this user finished uploading files
            send({
              type: "sendMessage",
              roomId,
              username: currentUser,
              text: "",
              messageType: "fileUploadEnd"
            });
            
            setIsSendingFiles(false);
            setFileUploadProgress(null);
            
            // Failsafe: Clear upload status for current user after a delay
            setTimeout(() => {
              setUsersUploadingFiles(prev => {
                const newSet = new Set(prev);
                newSet.delete(currentUser);
                return newSet;
              });
            }, 1000);
          }
        };
        sendFiles();
      }
    };
    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
    };
    chatDiv.addEventListener('drop', handleDrop);
    chatDiv.addEventListener('dragover', handleDragOver);
    return () => {
      chatDiv.removeEventListener('drop', handleDrop);
      chatDiv.removeEventListener('dragover', handleDragOver);
    };
  }, [chatContainerRef, send, roomId, currentUser]);

  // --- iOS Safari Compatible Audio Recording ---
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorNodeRef = useRef<ScriptProcessorNode | null>(null);
  const recordedBuffersRef = useRef<Float32Array[]>([]);
  const recordingStartTimeRef = useRef<number>(0);
  // Check if MediaRecorder is supported (iOS Safari often doesn't support it)
  const isMediaRecorderSupported = (): boolean => {
    if (typeof window === 'undefined' || typeof MediaRecorder === 'undefined') {
      return false;
    }
    
    try {
      // Try to create a MediaRecorder with a dummy stream to test support
      // First check if isTypeSupported exists and works
      if (MediaRecorder.isTypeSupported) {
        return MediaRecorder.isTypeSupported('audio/webm') || 
               MediaRecorder.isTypeSupported('audio/mp4') || 
               MediaRecorder.isTypeSupported('audio/wav') ||
               MediaRecorder.isTypeSupported('audio/ogg') ||
               MediaRecorder.isTypeSupported('audio/mpeg');
      }
      
      // Fallback: just check if MediaRecorder constructor exists
      return true;
    } catch {
      return false;
    }
  };

  // Convert Float32Array to WAV format for iOS Safari compatibility
  const encodeWAV = (samples: Float32Array, sampleRate: number): Blob => {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);
    
    // WAV header
    const writeString = (offset: number, string: string): void => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };
    
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + samples.length * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, samples.length * 2, true);
    
    // Convert samples to 16-bit PCM
    let offset = 44;
    for (let i = 0; i < samples.length; i++) {
      const sample = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
      offset += 2;
    }
    
    return new Blob([view], { type: 'audio/wav' });
  };
  // Web Audio API recording (fallback for iOS Safari)
  const startWebAudioRecording = async (stream: MediaStream): Promise<void> => {
    try {
      // Support both standard and webkit prefixed AudioContext
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) {
        throw new Error('AudioContext not supported');
      }
      
      const audioContext = new AudioContextClass();
      audioContextRef.current = audioContext;
      
      const input = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      processorNodeRef.current = processor;
      recordedBuffersRef.current = [];
      recordingStartTimeRef.current = Date.now();
      
      processor.onaudioprocess = (e: AudioProcessingEvent) => {
        const inputData = e.inputBuffer.getChannelData(0);
        recordedBuffersRef.current.push(new Float32Array(inputData));
      };
      
      input.connect(processor);
      processor.connect(audioContext.destination);
    } catch (error) {
      console.error('Web Audio API setup failed:', error);
      throw error;
    }
  };

  const stopWebAudioRecording = (): void => {
    try {
      if (processorNodeRef.current) {
        processorNodeRef.current.disconnect();
        processorNodeRef.current = null;
      }
      
      if (audioContextRef.current) {
        const sampleRate = audioContextRef.current.sampleRate;
        audioContextRef.current.close();
        
        // Combine all recorded buffers
        const totalLength = recordedBuffersRef.current.reduce((acc, buffer) => acc + buffer.length, 0);
        const combined = new Float32Array(totalLength);
        let offset = 0;
        
        for (const buffer of recordedBuffersRef.current) {
          combined.set(buffer, offset);
          offset += buffer.length;
        }
        
        // Convert to WAV and send
        const audioBlob = encodeWAV(combined, sampleRate);
        
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64 = reader.result as string;
          send({
            type: "sendFile",
            roomId,
            username: currentUser,
            fileName: `audio-message-${Date.now()}.wav`,
            fileType: 'audio/wav',
            fileData: base64,
            timestamp: Date.now(),
            asAudio: true,
          });
        };
        reader.readAsDataURL(audioBlob);
        
        audioContextRef.current = null;
      }
    } catch (error) {
      console.error('Error stopping Web Audio recording:', error);
    }
  };  const toggleRecording = async (): Promise<void> => {
    if (!isRecording) {
      // Start recording
      // Enhanced capability detection with detailed logging
      const hasNavigator = typeof navigator !== 'undefined';
      const hasMediaDevices = hasNavigator && !!navigator.mediaDevices;
      const hasGetUserMedia = hasMediaDevices && !!navigator.mediaDevices.getUserMedia;
      const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';
      const isLocalhost = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
      
      console.log('Media access check:', {
        hasNavigator,
        hasMediaDevices,
        hasGetUserMedia,
        isHttps,
        isLocalhost,
        protocol: typeof window !== 'undefined' ? window.location.protocol : 'unknown',
        hostname: typeof window !== 'undefined' ? window.location.hostname : 'unknown',
        userAgent: hasNavigator ? navigator.userAgent : 'unknown'
      });
      
      // Check for basic audio recording capability
      if (!hasGetUserMedia) {
        if (!isHttps && !isLocalhost) {
          alert('Microphone access requires HTTPS. Please access this page via HTTPS or localhost.');
        } else {
          alert('Microphone access is not supported in this browser. Please use a modern browser.');
        }
        return;
      }

      // Check if we have either MediaRecorder OR Web Audio API support
      const hasWebAudioSupport = !!(window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
      const hasMediaRecorderSupport = isMediaRecorderSupported();
      
      console.log('Audio capability check:', {
        hasMediaRecorderSupport,
        hasWebAudioSupport,
        mediaRecorderExists: typeof MediaRecorder !== 'undefined',
        audioContextExists: typeof AudioContext !== 'undefined',
        webkitAudioContextExists: typeof (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext !== 'undefined'
      });
      
      if (!hasMediaRecorderSupport && !hasWebAudioSupport) {
        alert('Audio recording is not supported in this browser. Please update your browser or try a different one.');
        return;
      }
      
      try {
        // Request microphone with iOS-optimized settings
        const stream = await navigator.mediaDevices.getUserMedia({ 
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            sampleRate: 44100,
            sampleSize: 16,
            channelCount: 1
          } 
        });
        mediaStreamRef.current = stream;
        
        // Try MediaRecorder first, fallback to Web Audio API for iOS Safari
        if (isMediaRecorderSupported()) {
          console.log('Using MediaRecorder API');
          // MediaRecorder approach (for modern browsers)
          const options: MediaRecorderOptions = {};          // Prefer formats that work better on different platforms
          if (MediaRecorder.isTypeSupported('audio/webm')) {
            options.mimeType = 'audio/webm';
          } else if (MediaRecorder.isTypeSupported('audio/wav')) {
            options.mimeType = 'audio/wav';
          } else if (MediaRecorder.isTypeSupported('audio/mpeg')) {
            options.mimeType = 'audio/mpeg';
          } else if (MediaRecorder.isTypeSupported('audio/ogg')) {
            options.mimeType = 'audio/ogg';
          } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
            options.mimeType = 'audio/mp4';
          }
          
          const mediaRecorder = new MediaRecorder(stream, options);
          mediaRecorderRef.current = mediaRecorder;
          audioChunksRef.current = [];
          
          mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
              audioChunksRef.current.push(event.data);
            }
          };
          
          mediaRecorder.onstop = () => {
            try {
              const blobType = options.mimeType || 'audio/webm';
              const audioBlob = new Blob(audioChunksRef.current, { type: blobType });
              const reader = new FileReader();
              reader.onloadend = () => {
                const base64 = reader.result as string;
                send({
                  type: "sendFile",
                  roomId,
                  username: currentUser,
                  fileName: `audio-message-${Date.now()}.${blobType.split('/')[1] || 'webm'}`,
                  fileType: blobType,
                  fileData: base64,
                  timestamp: Date.now(),
                  asAudio: true,
                });
              };
              reader.readAsDataURL(audioBlob);
              
              // Release microphone
              if (mediaStreamRef.current) {
                mediaStreamRef.current.getTracks().forEach(track => track.stop());
                mediaStreamRef.current = null;
              }
              setIsRecording(false);
              setIsAtBottom(true);
            } catch (error) {
              console.error('Error processing MediaRecorder data:', error);
              alert('Error processing audio recording.');
            }
          };
          
          mediaRecorder.onerror = (event) => {
            console.error('MediaRecorder error:', event);
            alert('Audio recording error occurred.');
            setIsRecording(false);
          };
          
          mediaRecorder.start(1000); // Collect data every second
        } else {
          console.log('Using Web Audio API fallback for iOS Safari');
          // Web Audio API fallback (for iOS Safari)
          await startWebAudioRecording(stream);
        }
        
        setIsRecording(true);
      } catch (err) {
        console.error('Audio recording error:', err);
        alert('Could not start audio recording. Please check microphone permissions and try again.');
      }
    } else {
      // Stop recording
      try {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
          mediaRecorderRef.current.stop();
          mediaRecorderRef.current = null;
        } else {
          // Web Audio API stop
          stopWebAudioRecording();
          
          // Release microphone
          if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach(track => track.stop());
            mediaStreamRef.current = null;
          }
          setIsRecording(false);
          setIsAtBottom(true);
        }
      } catch (error) {
        console.error('Error stopping recording:', error);
        setIsRecording(false);
      }
    }
  };

  const scrollToBottom = () => {
    setIsAtBottom(true)
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  const getInitials = (username: string) => {
    return username.slice(0, 2).toUpperCase()
  }

  // Clear sessionStorage when leaving the chat page
  useEffect(() => {
    const handleRouteChange = (url: string) => {
      if (!url.endsWith(`/chat`)) {
        sessionStorage.removeItem(`username:${roomId}`)
      }
    }
    window.addEventListener('popstate', () => handleRouteChange(window.location.pathname))
    return () => {
      window.removeEventListener('popstate', () => handleRouteChange(window.location.pathname))
    }
  }, [roomId])
  const handleLeaveRoom = () => {
    // Optionally send a leave event here if you want to notify the server
    // (not strictly needed, as ws.onclose will fire on navigation)
    if (typeof window !== "undefined") {
      sessionStorage.removeItem(`username:${roomId}`);
    }
    router.replace("/");
    setTimeout(() => {window.location.reload();}, 300); // Small delay to ensure the page unloads properly
  };

  const handleUpdateRoomSettings = async (settings: { 
    name?: string; 
    maxParticipants?: number; 
    locked?: boolean; 
    visibility?: 'public' | 'private'; 
    password?: string 
  }): Promise<void> => {
    return new Promise((resolve, reject) => {
      const updateId = Math.random().toString(36).substr(2, 9);
      
      // Clean up any existing pending update
      if (pendingUpdateRef.current) {
        clearTimeout(pendingUpdateRef.current.timeout);
        pendingUpdateRef.current.reject(new Error('Request cancelled by new update'));
      }
      
      // Set up timeout for this update
      const timeout = setTimeout(() => {
        if (pendingUpdateRef.current?.updateId === updateId) {
          pendingUpdateRef.current = null;
          reject(new Error('Room settings update timed out'));
        }
      }, 10000); // 10 second timeout
      
      // Store the pending update
      pendingUpdateRef.current = {
        updateId,
        resolve,
        reject,
        timeout
      };
      
      // Store pending update ID to prevent roomInfo updates from overriding changes
      setPendingUpdate(updateId);
        // Send the update request
      send({
        type: "updateRoomSettings",
        roomId,
        username: currentUser,
        updateId,
        ...settings
      });
    });
  };

  useEffect(() => {
    const handlePageHide = (event: PageTransitionEvent) => {
      if (event.persisted) {
        send({ type: "leaveRoom", roomId, username: currentUser });
        // Try to close the WebSocket if possible
        // @ts-expect-error: __ws is not a standard property, used for bfcache workaround
        if (typeof window !== "undefined" && window.__ws) window.__ws.close();
      }
    };
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, [roomId, currentUser, send]);

  // --- bfcache/iOS fix: reload page if restored from bfcache (e.g., after PDF preview on iOS) ---
  // useEffect(() => {
  //   const handlePageShow = (event: PageTransitionEvent) => {
  //     if (event.persisted) {
  //       window.location.reload();
  //     }
  //   };
  //   window.addEventListener('pageshow', handlePageShow);
  //   return () => {
  //     window.removeEventListener('pageshow', handlePageShow);
  //   };
  // }, []);

  // Update document title when room information changes
  useEffect(() => {
    if (roomInfo.name) {
      document.title = `Ucucu - ${roomInfo.name}`;
    } else if (roomId) {
      document.title = `Ucucu - ${roomId}`;
    }

    // Cleanup: Reset title when component unmounts (user leaves room)
    return () => {
      document.title = "Ucucu";
    };  }, [roomInfo.name, roomId]);

  return (
    <div className="h-screen bg-white flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex-shrink-0">
  <div className="flex items-center justify-between gap-2 w-full flex-nowrap">
    {/* Left: Leave + Reconnect + Room name/id (very compact) */}
    <div className="flex items-center gap-2 min-w-0 flex-shrink">
      <Button variant="destructive" size="sm" onClick={() => setShowLeaveDialog(true)}>
        Leave
      </Button>      <Button
        variant="ghost"
        size="sm"
        className="border border-gray-300 bg-white text-red-600 hover:bg-gray-100 h-8 px-3 py-0 text-xs font-semibold shadow-none"
        style={{ boxShadow: 'none' }}
        onClick={() => {
          const username = sessionStorage.getItem(`username:${roomId}`) || currentUser;
          if (username) {
            setCurrentUser(username);
            setIsSendingFiles(false);
            // Send leave message first to ensure we're not in room participants
            send({ type: "leaveRoom", roomId, username });
            // Then send join message after a small delay
            setTimeout(() => {
              send({ type: "joinRoom", roomId, username });
            }, 1000);
          }
        }}
        title="Reconnect to room"
      >
        Reconnect
      </Button>      <div className="flex flex-col min-w-0">
        <div className="flex items-center gap-2">
          <h1
            className="font-semibold text-gray-900 truncate max-w-[80px]"
            title={roomInfo.name || roomId}
          >
            {roomInfo.name || roomId}
          </h1>
          {usersUploadingFiles.size > 0 && (
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
              <span className="text-xs text-blue-600 font-medium">
                {usersUploadingFiles.size === 1 ? 'Uploading...' : `${usersUploadingFiles.size} uploading...`}
              </span>
            </div>
          )}
        </div>
        <p className="text-xs text-gray-500 truncate max-w-[80px]">/{roomId}</p>
      </div>
    </div>    {/* Right: Notification Bell, Avatars and settings always at top right */}    <div className="flex items-center gap-2 flex-shrink-0 min-w-0">
      {/* Notification Bell */}
      <NotificationBell roomId={roomId} username={currentUser} />
      
      {/* Participant Avatars - Show 2 instead of 3 to make room for bell */}
      <div className="flex -space-x-2 max-w-[100px] overflow-hidden">
        {participants.slice(0, 2).map((participant) => (
          <div
            key={participant.username}
            className="w-8 h-8 bg-blue-500 rounded-full border-2 border-white flex items-center justify-center text-white text-xs font-medium"
            title={participant.username}
          >
            {getInitials(participant.username)}
          </div>
        ))}
        {participants.length > 2 && (
          <div className="w-8 h-8 bg-gray-400 rounded-full border-2 border-white flex items-center justify-center text-white text-xs">
            +{participants.length - 2}
          </div>
        )}
      </div>      <Button variant="ghost" size="sm" onClick={() => setShowSettings(true)} aria-label="Open room settings">
        <MoreVertical className="h-4 w-4" />
      </Button>
    </div>
  </div>
</header>

      {/* Messages */}
      <div ref={chatContainerRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4" onScroll={handleScroll}>
        {messages.map((message, idx) => {
          // Use a more robust unique key: combine id, type, username, and index fallback
          let key = message.id + '-' + message.type + '-' + message.username;
          if (messages.findIndex(m => m.id === message.id && m.type === message.type && m.username === message.username) !== idx) {
            key += '-' + idx;
          }
          return (
            <ChatMessage key={key} message={message} currentUser={currentUser} />
          );
        })}

        {/* Typing Indicator */}
        {isTyping && (
          <div className="flex items-center space-x-2 text-gray-500 text-sm">
            <div className="flex space-x-1">
              <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
              <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "0.1s" }}></div>
              <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "0.2s" }}></div>
            </div>
            <span>{isTyping} is typing...</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Scroll to Bottom Button */}
      {!isAtBottom && (
        <div className="absolute bottom-20 right-4">
          <Button size="sm" className="rounded-full h-10 w-10 shadow-lg" onClick={scrollToBottom}>
            <ArrowDown className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Input Area */}
      <div className="border-t border-gray-200 p-4 flex-shrink-0">        <div className="flex items-end space-x-2">
          {/* File Upload */}            <Button variant="ghost" size="sm" onClick={() => fileInputRef.current?.click()} className="flex-shrink-0" disabled={!isConnected || isSendingFiles} aria-label="Upload file">
            <Paperclip className={`h-4 w-4 ${isSendingFiles ? 'animate-pulse' : ''}`} />
          </Button>

          {/* Text Input */}
          <div className="flex-1">
            <Input
              placeholder={isConnected ? "Type a message..." : "Please refresh (connection lost)"}
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              onKeyPress={handleKeyPress}
              className="resize-none"
              disabled={isRecording || !isConnected}
            />
          </div>  
            {/* Phone/Call Button */}
          <Button
            variant="ghost"
            size="sm"
            className="flex-shrink-0"
            aria-label="Join group call"
            onClick={() => {
              // Send a message to chat before going to call page
              send({ 
                type: "sendMessage", 
                roomId, 
                username: currentUser, 
                text: "📞 Joining the call..." 
              });
              
              // Navigate to call page
              router.push(`/${encodeURIComponent(roomId)}/call`);
            }}
          >
            <Phone className="h-4 w-4" />
          </Button>

          {/* Audio Record / Send */}
          {messageText.trim() ? (
            <Button onClick={sendMessage} size="sm" className="flex-shrink-0" disabled={!isConnected} aria-label="Send message">
              <Send className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              variant={isRecording ? "destructive" : "ghost"}
              size="sm"
              onClick={toggleRecording}
              className="flex-shrink-0"
              disabled={!isConnected}
              aria-label={isRecording ? "Stop recording voice message" : "Start recording voice message"}
            >
              <Mic className="h-4 w-4" />
            </Button>
          )}
        </div>

        {!isConnected && (
          <div className="mt-2 flex items-center space-x-2 text-red-600 text-sm font-semibold">
            <span>Connection lost. Please refresh the page.</span>
          </div>
        )}        
        {isRecording && isConnected && (
          <div className="mt-2 flex items-center space-x-2 text-red-600 text-sm">
            <div className="w-2 h-2 bg-red-600 rounded-full animate-pulse"></div>
            <span>Recording... Tap to stop</span>
          </div>
        )}        {isSendingFiles && isConnected && (
          <div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex items-center space-x-3">
              <div className="flex space-x-1">
                <div className="w-2 h-2 bg-blue-600 rounded-full animate-bounce"></div>
                <div className="w-2 h-2 bg-blue-600 rounded-full animate-bounce" style={{ animationDelay: "0.1s" }}></div>
                <div className="w-2 h-2 bg-blue-600 rounded-full animate-bounce" style={{ animationDelay: "0.2s" }}></div>
              </div>
              <div className="flex-1">
                {fileUploadProgress ? (
                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-sm font-medium text-blue-700">
                        Uploading {fileUploadProgress.current} of {fileUploadProgress.total}
                      </span>
                      <span className="text-xs text-blue-600">
                        {Math.round((fileUploadProgress.current / fileUploadProgress.total) * 100)}%
                      </span>
                    </div>
                    <div className="w-full bg-blue-200 rounded-full h-2 mb-1">
                      <div 
                        className="bg-blue-600 h-2 rounded-full transition-all duration-300" 
                        style={{ width: `${(fileUploadProgress.current / fileUploadProgress.total) * 100}%` }}
                      ></div>
                    </div>                    {fileUploadProgress.fileName && (
                      <span className="text-xs text-blue-600 truncate block">
                        {fileUploadProgress.fileName}
                      </span>
                    )}
                  </div>
                ) : (
                  <span className="text-sm text-blue-700">Preparing files...</span>
                )}
              </div>            </div>
          </div>
        )}

        {/* Show when other users are uploading files */}
        {usersUploadingFiles.size > 0 && !isSendingFiles && isConnected && (
          <div className="mt-2 p-2 bg-gray-50 border border-gray-200 rounded-lg">
            <div className="flex items-center space-x-2">
              <div className="w-2 h-2 bg-gray-500 rounded-full animate-pulse"></div>
              <span className="text-sm text-gray-600">
                {Array.from(usersUploadingFiles).map((username, index) => (
                  <span key={username}>
                    <span className="font-medium">{username}</span>
                    {index < usersUploadingFiles.size - 1 && ', '}
                  </span>
                ))}
                {usersUploadingFiles.size === 1 ? ' is uploading files...' : ' are uploading files...'}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Hidden File Input */}
      <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileUpload} accept="*/*" multiple />      {/* Room Settings Modal */}
      <RoomSettingsModal
        open={showSettings}
        onOpenChange={setShowSettings}
        roomId={roomId}
        participants={participants}
        currentUser={currentUser}
        owner={roomOwner}
        roomInfo={roomInfo}
        onUpdateSettings={handleUpdateRoomSettings}
      />

      {/* Leave Room Dialog */}
      <RoomLeaveDialog open={showLeaveDialog} onConfirm={handleLeaveRoom} onCancel={() => setShowLeaveDialog(false)} />
    </div>
  )
}
