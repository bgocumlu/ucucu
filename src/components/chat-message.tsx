"use client"
import { Button } from "@/components/ui/button"
import { Download, Play, FileText } from "lucide-react"
import Image from "next/image"

interface Message {
  id: string
  type: "text" | "file" | "audio" | "system"
  username: string
  content: string
  timestamp: Date
  isOwn: boolean
  fileData?: string // base64 data
  fileName?: string // optional file name
}

interface ChatMessageProps {
  message: Message
}

// Hash a string to a color
function stringToColor(str: string) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  // Generate HSL color
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 70%, 80%)`;
}

export function ChatMessage({ message, currentUser }: ChatMessageProps & { currentUser?: string }) {
  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const getInitials = (username: string) => {
    return username.slice(0, 2).toUpperCase()
  }

  // Detect "You joined/left" for system messages
  let systemText = message.content;
  if (message.type === "system" && currentUser) {
    if (message.content === `${currentUser} joined the chat.`) {
      systemText = `${currentUser} joined the chat. (You)`;
    } else if (message.content === `${currentUser} left the chat.`) {
      systemText = `${currentUser} joined the chat. (You)`;
    }
  }

  if (message.type === "system") {
    return (
      <div className="flex justify-center my-2">
        <div className="bg-gray-200 text-gray-600 text-xs px-3 py-1 rounded-full">
          {systemText}
        </div>
      </div>
    )
  }

  return (
    <div className={`flex ${message.isOwn ? "justify-end" : "justify-start"}`}>
      <div className={`flex space-x-2 max-w-full ${message.isOwn ? "flex-row-reverse space-x-reverse" : ""}`}>
        {/* Message Content */}
        <div className={`flex flex-col ${message.isOwn ? "items-end" : "items-start"}`}>
          {/* Username */}
          <span className="text-xs text-gray-600 mb-1 px-1">{message.username}</span>
          {/* Message Bubble */}
          <div
            className={`rounded-lg px-3 py-2 inline-block`}
            style={{
              wordBreak: 'break-word',
              overflowWrap: 'break-word',
              maxWidth: '100%',
              background: message.isOwn ? '#3b82f6' : stringToColor(message.username),
              color: message.isOwn ? 'white' : '#222',
            }}
          >
            {message.type === "text" && <p className="text-sm whitespace-pre-wrap break-words">{message.content}</p>}

            {message.type === "file" && (() => {
              // Only show preview if file is an image or video
              const isImage = typeof message.fileData === 'string' && message.fileData.startsWith('data:image/');
              const isVideo = typeof message.fileData === 'string' && message.fileData.startsWith('data:video/');
              return (
                <div className="flex flex-col items-start space-y-2">
                  {isImage && message.fileData && (
                    <div className="max-w-xs max-h-60 rounded border border-gray-200 mb-1 overflow-hidden">
                      <Image
                        src={message.fileData}
                        alt={message.fileName || message.content || 'image'}
                        width={320}
                        height={240}
                        style={{ objectFit: 'contain', width: '100%', height: 'auto', maxHeight: '15rem' }}
                        unoptimized
                        priority={false}
                      />
                    </div>
                  )}
                  {isVideo && message.fileData && (
                    <div className="max-w-xs max-h-60 rounded border border-gray-200 mb-1 overflow-hidden">
                      <video
                        src={message.fileData}
                        controls
                        style={{ width: '100%', height: 'auto', maxHeight: '15rem', background: '#000' }}
                      >
                        Your browser does not support the video tag.
                      </video>
                    </div>
                  )}
                  <div className="flex items-center space-x-2">
                    <FileText className="h-4 w-4" />
                    <span className="text-sm">{message.fileName || message.content}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className={`h-6 w-6 p-0 ${message.isOwn ? "text-white hover:bg-blue-600" : "text-gray-600 hover:bg-gray-200"}`}
                      onClick={() => {
                        if (typeof message.fileData === 'string') {
                          const dataUrl = message.fileData;
                          const arr = dataUrl.split(",");
                          if (arr.length === 2) {
                            const mimeMatch = arr[0].match(/:(.*?);/);
                            if (!mimeMatch) {
                              alert('Invalid file data.');
                              return;
                            }
                            const mime = mimeMatch[1];
                            const bstr = atob(arr[1]);
                            let n = bstr.length;
                            const u8arr = new Uint8Array(n);
                            while (n--) {
                              u8arr[n] = bstr.charCodeAt(n);
                            }
                            const blob = new Blob([u8arr], { type: mime });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = message.fileName || message.content || 'file';
                            document.body.appendChild(a);
                            a.click();
                            setTimeout(() => {
                              URL.revokeObjectURL(url);
                              document.body.removeChild(a);
                            }, 100);
                          } else {
                            alert('Invalid file data.');
                          }
                        } else {
                          alert('File data is missing or invalid.');
                        }
                      }}
                    >
                      <Download className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              );
            })()}

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
