"use client"

import { useState, useEffect } from "react"
import { useParams, useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ArrowLeft, Users, Lock, Eye, EyeOff } from "lucide-react"
import Link from "next/link"
import { useWebSocket } from "@/components/WebSocketProvider"

interface RoomInfo {
  id: string
  name: string
  count: number
  maxParticipants: number
  locked: boolean
  exists: boolean
}

export default function RoomPage() {
  const params = useParams()
  const router = useRouter()
  const rawRoomId = params.roomId as string
  const roomId = decodeURIComponent(rawRoomId)

  const [roomInfo, setRoomInfo] = useState<RoomInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [formData, setFormData] = useState({
    username: "",
    password: "",
    displayName: "",
    maxParticipants: "10",
    visibility: "public" as "public" | "private",
    requirePassword: false,
  })
  const [showPassword, setShowPassword] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const { send, lastMessage, isConnected, setOnMessage } = useWebSocket()
  useEffect(() => {
    setLoading(true)
    send({ type: "getRooms" })
    
    // Check for prefilled username from subscribed room join
    const prefilledUsername = sessionStorage.getItem(`prefilled-username:${roomId}`)
    if (prefilledUsername) {
      setFormData(prev => ({
        ...prev,
        username: prefilledUsername
      }))
      // Clear the prefilled username after using it
      sessionStorage.removeItem(`prefilled-username:${roomId}`)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId])

  useEffect(() => {
    if (lastMessage && lastMessage.type === "rooms") {
      const found = (lastMessage.rooms as RoomInfo[]).find((room) => room.id === roomId)
      if (found) {
        setRoomInfo({ ...found, exists: true })
      } else {
        setRoomInfo({
          id: roomId,
          name: "",
          count: 0,
          maxParticipants: 10,
          locked: false,
          exists: false,
        })
        setFormData((prev) => ({
          ...prev,
          displayName: roomId
            .split("-")
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
            .join(" "),
        }))
      }
      setLoading(false)
    }
  }, [lastMessage, roomId])
  useEffect(() => {
    setIsSubmitting(false)
  }, [isConnected])

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !isSubmitting && !isRoomFull) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const handleSubmit = async () => {
    if (!validateForm()) return;
    setIsSubmitting(true);
    setErrors({});
    send({
      type: "joinRoom",
      roomId,
      username: formData.username,
      // Only send displayName, password, visibility, maxParticipants if creating a new room
      ...(roomInfo && !roomInfo.exists && formData.displayName.trim() && { displayName: formData.displayName.trim() }),
      ...(roomInfo && !roomInfo.exists && { password: formData.password }),
      ...(roomInfo && !roomInfo.exists && { visibility: formData.visibility }),
      ...(roomInfo && !roomInfo.exists && { maxParticipants: Number(formData.maxParticipants) }),
      // Always send password if joining a locked room
      ...(roomInfo && roomInfo.exists && roomInfo.locked && { password: formData.password })
    });
  };

  // Listen for the next roomInfo or error message only when submitting
  useEffect(() => {
    if (!isSubmitting) return;
    type RoomInfoMessage = { type: "roomInfo"; room: { id: string } };
    type ErrorMessage = { type: "error"; error: string };
    type RoomsMessage = { type: "rooms"; rooms: RoomInfo[] };
    type WebSocketMessage = RoomInfoMessage | ErrorMessage | RoomsMessage | { type: string; [key: string]: unknown };

    const handler = (msg: WebSocketMessage) => {
      console.log('[JOIN DEBUG] setOnMessage got:', JSON.stringify(msg, null, 2));
      if (
        msg.type === "roomInfo" &&
        typeof msg.room === "object" &&
        msg.room &&
        "id" in msg.room &&
        (msg.room as { id: string }).id === roomId      ) {        setIsSubmitting(false);
        sessionStorage.setItem(`username:${roomId}`, formData.username);
        setOnMessage(null);
        router.push(`/${encodeURIComponent(roomId)}/chat`);
      } else if (msg.type === "error") {
        setIsSubmitting(false);
        setErrors({ general: String(msg.error) });
        sessionStorage.removeItem(`username:${roomId}`);
        setOnMessage(null);
      }
    };
    setOnMessage(handler);
    return () => setOnMessage(null);
  }, [isSubmitting, formData.username, roomId, router, setOnMessage]);
  const generateRoomId = () => {
    const adjectives = ["cool", "awesome", "epic", "fun", "chill", "cozy", "bright", "swift"]
    const nouns = ["chat", "room", "space", "hub", "zone", "lounge", "corner", "spot"]
    const randomAdj = adjectives[Math.floor(Math.random() * adjectives.length)]
    const randomNoun = nouns[Math.floor(Math.random() * nouns.length)]
    const randomNum = Math.floor(Math.random() * 1000)

    const newRoomId = `${randomAdj}-${randomNoun}-${randomNum}`
    router.push(`/${encodeURIComponent(newRoomId)}`)
  }

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((word) => word[0])
      .join("")
      .toUpperCase()
      .slice(0, 2)
  }

  const validateForm = () => {
    const newErrors: Record<string, string> = {}

    if (!formData.username.trim()) {
      newErrors.username = "Username is required"
    } else if (formData.username.length < 1 || formData.username.length > 20) {
      newErrors.username = "Username must be 1-20 characters"
    }

    if (roomInfo?.exists && roomInfo.locked && !formData.password) {
      newErrors.password = "Password is required for this room"
    }

    if (!roomInfo?.exists && formData.requirePassword && !formData.password) {
      newErrors.password = "Password is required when enabled"
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  // Clear sessionStorage when leaving the room (navigating away from chat)
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
    if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600 mb-4">Loading room...</p>
          <div className="flex gap-2 justify-center">
            <Link href="/">
              <Button variant="default">
                Go Back to Home
              </Button>
            </Link>
          </div>
        </div>
      </div>
    )
  }

  if (!roomInfo) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600 mb-4">Room not found</p>
          <Link href="/">
            <Button>Back to Home</Button>
          </Link>
        </div>
      </div>
    )
  }

  const isRoomFull = roomInfo.exists && roomInfo.count >= roomInfo.maxParticipants

  return (
    <div className="h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex-shrink-0">        <div className="max-w-md mx-auto flex items-center space-x-3">
          <Link href="/">
            <Button variant="ghost" size="sm" aria-label="Go back to home page">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <h1 className="text-lg font-semibold text-gray-900">{roomInfo.exists ? "Join Room" : "Create Room"}</h1>
        </div>
      </header>

      {/* Main Content - Scrollable */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-md mx-auto px-4 py-6 space-y-6">
          {/* Room Info Card */}
          <Card className="mb-6">
            <CardContent className="p-6">
              <div className="flex items-center space-x-4 mb-4">
                <div className="w-16 h-16 bg-blue-500 rounded-full flex items-center justify-center text-white font-medium text-lg">
                  {getInitials(roomInfo.exists ? roomInfo.name : formData.displayName || roomInfo.id)}
                </div>
                <div className="flex-1">
                  <h2 className="text-xl font-semibold text-gray-900 flex items-center space-x-2">
                    <span>{roomInfo.exists ? roomInfo.name : formData.displayName || roomInfo.id}</span>
                    {roomInfo.locked && <Lock className="h-5 w-5 text-gray-400" />}
                  </h2>
                  <p className="text-gray-500">/{roomInfo.id}</p>
                </div>
              </div>

              {roomInfo.exists && (
                <div className="flex items-center justify-between text-sm text-gray-600">
                  <div className="flex items-center space-x-1">
                    <Users className="h-4 w-4" />
                    <span>
                      {roomInfo.count} of {roomInfo.maxParticipants} participants
                    </span>
                  </div>
                  {isRoomFull && <Badge variant="destructive">Full</Badge>}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Form */}
          <Card>
            <CardHeader className="pb-4">
              <CardTitle>{roomInfo.exists ? "Join the conversation" : "Set up your room"}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 pb-6">
              {/* Room ID (only for create) */}
              {!roomInfo.exists && (
                <div className="space-y-2">
                  <Label htmlFor="roomId">Room ID</Label>
                  <div className="flex space-x-2">
                    <Input id="roomId" value={roomInfo.id} disabled className="bg-gray-50" />
                    <Button type="button" variant="outline" onClick={generateRoomId} className="shrink-0">
                      Random
                    </Button>
                  </div>
                </div>
              )}              {/* Username */}              <div className="space-y-2">
                <Label htmlFor="username">Your Username</Label>                <Input
                  id="username"
                  name="username"
                  placeholder="Enter your username (1-20 characters)"
                  value={formData.username}
                  onChange={(e) => setFormData((prev) => ({ ...prev, username: e.target.value }))}
                  className={errors.username ? "border-red-500" : ""}
                  disabled={isRoomFull}
                  onKeyDown={handleKeyPress}
                />
                {errors.username && <p className="text-sm text-red-500">{errors.username}</p>}
              </div>

              {/* Display Name (only for create) */}
              {/* {!roomInfo.exists && (
                <div className="space-y-2">
                  <Label htmlFor="displayName">Display Name (Optional)</Label>
                  <Input
                    id="displayName"
                    placeholder="My Awesome Room"
                    value={formData.displayName}
                    onChange={(e) => setFormData((prev) => ({ ...prev, displayName: e.target.value }))}
                  />
                </div>
              )} */}

              {/* Password Toggle (only for create) */}
              {!roomInfo.exists && (
                <div className="flex items-center space-x-2">
                  <Switch
                    id="requirePassword"
                    checked={formData.requirePassword}
                    onCheckedChange={(checked) =>
                      setFormData((prev) => ({
                        ...prev,
                        requirePassword: checked,
                        password: checked ? prev.password : "",
                      }))
                    }
                  />
                  <Label htmlFor="requirePassword">Require Password</Label>
                </div>
              )}

              {/* Password */}
              {((roomInfo.exists && roomInfo.locked) || (!roomInfo.exists && formData.requirePassword)) && (
                <div className="space-y-2">
                  <Label htmlFor="password">{roomInfo.exists ? "Room Password" : "Password"}</Label>                  <div className="relative">                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      placeholder={roomInfo.exists ? "Enter room password" : "Enter room password"}
                      value={formData.password}
                      onChange={(e) => setFormData((prev) => ({ ...prev, password: e.target.value }))}
                      className={errors.password ? "border-red-500" : ""}
                      disabled={isRoomFull}
                      onKeyDown={handleKeyPress}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="absolute right-0 top-0 h-full px-3"
                      onClick={() => setShowPassword(!showPassword)}
                      disabled={isRoomFull}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                  {errors.password && <p className="text-sm text-red-500">{errors.password}</p>}
                </div>
              )}              {/* Max Participants (only for create) */}
              {!roomInfo.exists && (
                <div className="space-y-2">
                  <Label htmlFor="maxParticipants">Max Participants</Label>
                  <Select
                    value={formData.maxParticipants}
                    onValueChange={(value) => setFormData((prev) => ({ ...prev, maxParticipants: value }))}
                  >
                    <SelectTrigger id="maxParticipants">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="2">2 (1-to-1)</SelectItem>
                      <SelectItem value="5">5</SelectItem>
                      <SelectItem value="10">10</SelectItem>
                      <SelectItem value="20">20</SelectItem>
                      <SelectItem value="50">50</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}              {/* Visibility (only for create) */}
              {!roomInfo.exists && (
                <div className="space-y-2">
                  <Label htmlFor="visibility-public">Visibility</Label>
                  <div className="flex space-x-4">
                    <label htmlFor="visibility-public" className="flex items-center space-x-2 cursor-pointer">
                      <input
                        id="visibility-public"
                        type="radio"
                        name="visibility"
                        value="public"
                        checked={formData.visibility === "public"}
                        onChange={(e) =>
                          setFormData((prev) => ({ ...prev, visibility: e.target.value as "public" | "private" }))
                        }
                        className="text-blue-600"
                      />
                      <span className="text-sm">Public</span>
                    </label>
                    <label htmlFor="visibility-private" className="flex items-center space-x-2 cursor-pointer">
                      <input
                        id="visibility-private"
                        type="radio"
                        name="visibility"
                        value="private"
                        checked={formData.visibility === "private"}
                        onChange={(e) =>
                          setFormData((prev) => ({ ...prev, visibility: e.target.value as "public" | "private" }))
                        }
                        className="text-blue-600"
                      />
                      <span className="text-sm">Private</span>
                    </label>
                  </div>
                </div>
              )}

              {/* Error Message */}
              {errors.general && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-md">
                  <p className="text-sm text-red-600">{errors.general}</p>
                </div>
              )}

              {/* Room Full Message */}
              {isRoomFull && (
                <div className="p-3 bg-orange-50 border border-orange-200 rounded-md">
                  <p className="text-sm text-orange-600">This room is currently full. Please try again later.</p>
                </div>
              )}

              {/* Submit Button */}
              <Button onClick={handleSubmit} className="w-full h-12 text-base" disabled={isSubmitting || isRoomFull}>
                {isSubmitting
                  ? roomInfo.exists
                    ? "Joining..."
                    : "Creating..."
                  : roomInfo.exists
                    ? "Join Room"
                    : "Create & Join Room"}
              </Button>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  )
}
