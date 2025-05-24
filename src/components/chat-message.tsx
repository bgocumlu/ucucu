"use client"
import { Button } from "@/components/ui/button"
import { Download, Play, FileText } from "lucide-react"

interface Message {
  id: string
  type: "text" | "file" | "audio"
  username: string
  content: string
  timestamp: Date
  isOwn: boolean
}

interface ChatMessageProps {
  message: Message
}

export function ChatMessage({ message }: ChatMessageProps) {
  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  }

  const getInitials = (username: string) => {
    return username.slice(0, 2).toUpperCase()
  }

  return (
    <div className={`flex ${message.isOwn ? "justify-end" : "justify-start"}`}>
      <div className={`flex space-x-2 max-w-[80%] ${message.isOwn ? "flex-row-reverse space-x-reverse" : ""}`}>
        {/* Avatar */}
        {!message.isOwn && (
          <div className="w-8 h-8 bg-gray-400 rounded-full flex items-center justify-center text-white text-xs font-medium flex-shrink-0">
            {getInitials(message.username)}
          </div>
        )}

        {/* Message Content */}
        <div className={`flex flex-col ${message.isOwn ? "items-end" : "items-start"}`}>
          {/* Username */}
          {!message.isOwn && <span className="text-xs text-gray-600 mb-1 px-1">{message.username}</span>}

          {/* Message Bubble */}
          <div
            className={`rounded-lg px-3 py-2 max-w-full ${
              message.isOwn ? "bg-blue-500 text-white" : "bg-gray-100 text-gray-900"
            }`}
          >
            {message.type === "text" && <p className="text-sm whitespace-pre-wrap break-words">{message.content}</p>}

            {message.type === "file" && (
              <div className="flex items-center space-x-2">
                <FileText className="h-4 w-4" />
                <span className="text-sm">{message.content}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className={`h-6 w-6 p-0 ${message.isOwn ? "text-white hover:bg-blue-600" : "text-gray-600 hover:bg-gray-200"}`}
                >
                  <Download className="h-3 w-3" />
                </Button>
              </div>
            )}

            {message.type === "audio" && (
              <div className="flex items-center space-x-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className={`h-6 w-6 p-0 ${message.isOwn ? "text-white hover:bg-blue-600" : "text-gray-600 hover:bg-gray-200"}`}
                >
                  <Play className="h-3 w-3" />
                </Button>
                <div className="flex space-x-1">
                  {Array.from({ length: 20 }).map((_, i) => (
                    <div key={i} className={`w-1 bg-current opacity-60 ${Math.random() > 0.5 ? "h-2" : "h-3"}`} />
                  ))}
                </div>
                <span className="text-xs opacity-75">0:03</span>
              </div>
            )}
          </div>

          {/* Timestamp */}
          <span className="text-xs text-gray-500 mt-1 px-1">{formatTime(message.timestamp)}</span>
        </div>
      </div>
    </div>
  )
}
