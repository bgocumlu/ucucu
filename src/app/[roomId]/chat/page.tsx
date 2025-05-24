/* eslint-disable @typescript-eslint/no-unused-vars */
"use client"

import type React from "react"

import { useState, useEffect, useRef } from "react"
import { useParams, useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ArrowLeft, Send, Paperclip, Mic, MoreVertical, ArrowDown } from "lucide-react"
import { ChatMessage } from "@/components/chat-message"
import { RoomSettingsModal } from "@/components/room-settings-modal"

interface Message {
  id: string
  type: "text" | "file" | "audio"
  username: string
  content: string
  timestamp: Date
  isOwn: boolean
}

interface Participant {
  username: string
  isOwner: boolean
}

export default function ChatPage() {
  const params = useParams()
  const router = useRouter()
  const roomId = params.roomId as string

  const [messages, setMessages] = useState<Message[]>([])
  const [participants, setParticipants] = useState<Participant[]>([])
  const [currentUser, setCurrentUser] = useState("Alice") // Mock current user
  const [messageText, setMessageText] = useState("")
  const [isTyping, setIsTyping] = useState("")
  const [showSettings, setShowSettings] = useState(false)
  const [isAtBottom, setIsAtBottom] = useState(true)
  const [isRecording, setIsRecording] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const chatContainerRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Mock data
  useEffect(() => {
    const mockMessages: Message[] = [
      {
        id: "1",
        type: "text",
        username: "Bob",
        content: "Hey everyone! Welcome to the study group.",
        timestamp: new Date(Date.now() - 300000),
        isOwn: false,
      },
      {
        id: "2",
        type: "text",
        username: "Alice",
        content: "Thanks! Excited to be here.",
        timestamp: new Date(Date.now() - 240000),
        isOwn: true,
      },
      {
        id: "3",
        type: "text",
        username: "Charlie",
        content: "Should we start with the math problems?",
        timestamp: new Date(Date.now() - 180000),
        isOwn: false,
      },
    ]

    const mockParticipants: Participant[] = [
      { username: "Bob", isOwner: true },
      { username: "Alice", isOwner: false },
      { username: "Charlie", isOwner: false },
    ]

    setMessages(mockMessages)
    setParticipants(mockParticipants)
  }, [])

  // Auto-scroll to bottom
  useEffect(() => {
    if (isAtBottom) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
    }
  }, [messages, isAtBottom])

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

    const newMessage: Message = {
      id: Date.now().toString(),
      type: "text",
      username: currentUser,
      content: messageText,
      timestamp: new Date(),
      isOwn: true,
    }

    setMessages((prev) => [...prev, newMessage])
    setMessageText("")
    setIsAtBottom(true)
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const newMessage: Message = {
      id: Date.now().toString(),
      type: "file",
      username: currentUser,
      content: file.name,
      timestamp: new Date(),
      isOwn: true,
    }

    setMessages((prev) => [...prev, newMessage])
    setIsAtBottom(true)
  }

  const toggleRecording = () => {
    setIsRecording(!isRecording)

    if (!isRecording) {
      // Start recording
      setTimeout(() => {
        // Simulate recording completion
        const newMessage: Message = {
          id: Date.now().toString(),
          type: "audio",
          username: currentUser,
          content: "Voice message",
          timestamp: new Date(),
          isOwn: true,
        }
        setMessages((prev) => [...prev, newMessage])
        setIsRecording(false)
        setIsAtBottom(true)
      }, 2000)
    }
  }

  const scrollToBottom = () => {
    setIsAtBottom(true)
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  const getInitials = (username: string) => {
    return username.slice(0, 2).toUpperCase()
  }

  return (
    <div className="h-screen bg-white flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <Button variant="ghost" size="sm" onClick={() => router.push("/")}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="font-semibold text-gray-900">Study Group</h1>
              <p className="text-xs text-gray-500">/{roomId}</p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            {/* Participant Avatars */}
            <div className="flex -space-x-2">
              {participants.slice(0, 3).map((participant) => (
                <div
                  key={participant.username}
                  className="w-8 h-8 bg-blue-500 rounded-full border-2 border-white flex items-center justify-center text-white text-xs font-medium"
                  title={participant.username}
                >
                  {getInitials(participant.username)}
                </div>
              ))}
              {participants.length > 3 && (
                <div className="w-8 h-8 bg-gray-400 rounded-full border-2 border-white flex items-center justify-center text-white text-xs">
                  +{participants.length - 3}
                </div>
              )}
            </div>

            <Button variant="ghost" size="sm" onClick={() => setShowSettings(true)}>
              <MoreVertical className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* Messages */}
      <div ref={chatContainerRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4" onScroll={handleScroll}>
        {messages.map((message) => (
          <ChatMessage key={message.id} message={message} />
        ))}

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
      <div className="border-t border-gray-200 p-4 flex-shrink-0">
        <div className="flex items-end space-x-2">
          {/* File Upload */}
          <Button variant="ghost" size="sm" onClick={() => fileInputRef.current?.click()} className="flex-shrink-0">
            <Paperclip className="h-4 w-4" />
          </Button>

          {/* Text Input */}
          <div className="flex-1">
            <Input
              placeholder="Type a message..."
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              onKeyPress={handleKeyPress}
              className="resize-none"
              disabled={isRecording}
            />
          </div>

          {/* Audio Record / Send */}
          {messageText.trim() ? (
            <Button onClick={sendMessage} size="sm" className="flex-shrink-0">
              <Send className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              variant={isRecording ? "destructive" : "ghost"}
              size="sm"
              onClick={toggleRecording}
              className="flex-shrink-0"
            >
              <Mic className="h-4 w-4" />
            </Button>
          )}
        </div>

        {isRecording && (
          <div className="mt-2 flex items-center space-x-2 text-red-600 text-sm">
            <div className="w-2 h-2 bg-red-600 rounded-full animate-pulse"></div>
            <span>Recording... Tap to stop</span>
          </div>
        )}
      </div>

      {/* Hidden File Input */}
      <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileUpload} accept="*/*" />

      {/* Room Settings Modal */}
      <RoomSettingsModal
        open={showSettings}
        onOpenChange={setShowSettings}
        roomId={roomId}
        participants={participants}
        currentUser={currentUser}
      />
    </div>
  )
}
