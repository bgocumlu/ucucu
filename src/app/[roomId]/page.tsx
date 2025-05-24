"use client"

import { useState, useEffect } from "react"
import { useParams, useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { ArrowLeft, Users, Lock, Eye, EyeOff } from "lucide-react"
import Link from "next/link"

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
  const roomId = params.roomId as string

  const [roomInfo, setRoomInfo] = useState<RoomInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [formData, setFormData] = useState({
    username: "",
    password: "",
  })
  const [showPassword, setShowPassword] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isJoining, setIsJoining] = useState(false)

  useEffect(() => {
    // Simulate checking if room exists
    const checkRoom = async () => {
      setLoading(true)

      // Mock API call
      await new Promise((resolve) => setTimeout(resolve, 500))

      // Mock room data - in real app, this would come from WebSocket/API
      const mockRoom: RoomInfo = {
        id: roomId,
        name: roomId === "study-group" ? "Study Group" : `Room ${roomId}`,
        count: 2,
        maxParticipants: 5,
        locked: roomId === "study-group",
        exists: ["study-group", "gaming-chat", "work-team"].includes(roomId),
      }

      setRoomInfo(mockRoom)
      setLoading(false)
    }

    checkRoom()
  }, [roomId])

  const validateForm = () => {
    const newErrors: Record<string, string> = {}

    if (!formData.username.trim()) {
      newErrors.username = "Username is required"
    } else if (formData.username.length < 3 || formData.username.length > 20) {
      newErrors.username = "Username must be 3-20 characters"
    }

    if (roomInfo?.locked && !formData.password) {
      newErrors.password = "Password is required for this room"
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleJoin = async () => {
    if (!validateForm()) return

    setIsJoining(true)

    try {
      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 1000))

      // Navigate to chat
      router.push(`/${roomId}/chat`)
    } catch (error) {
      console.error("Failed to join room:", error)
      setErrors({ general: "Failed to join room. Please try again." })
    } finally {
      setIsJoining(false)
    }
  }

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((word) => word[0])
      .join("")
      .toUpperCase()
      .slice(0, 2)
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading room...</p>
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

  const isRoomFull = roomInfo.count >= roomInfo.maxParticipants

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-3">
        <div className="max-w-md mx-auto flex items-center space-x-3">
          <Link href="/">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <h1 className="text-lg font-semibold text-gray-900">{roomInfo.exists ? "Join Room" : "Create Room"}</h1>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-md mx-auto px-4 py-6">
        {/* Room Info Card */}
        <Card className="mb-6">
          <CardContent className="p-6">
            <div className="flex items-center space-x-4 mb-4">
              <div className="w-16 h-16 bg-blue-500 rounded-full flex items-center justify-center text-white font-medium text-lg">
                {getInitials(roomInfo.name)}
              </div>
              <div className="flex-1">
                <h2 className="text-xl font-semibold text-gray-900 flex items-center space-x-2">
                  <span>{roomInfo.name}</span>
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

        {/* Join/Create Form */}
        <Card>
          <CardHeader>
            <CardTitle>{roomInfo.exists ? "Join the conversation" : "Create this room"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Username */}
            <div className="space-y-2">
              <Label htmlFor="username">Your Username</Label>
              <Input
                id="username"
                placeholder="Enter your username (3-20 characters)"
                value={formData.username}
                onChange={(e) => setFormData((prev) => ({ ...prev, username: e.target.value }))}
                className={errors.username ? "border-red-500" : ""}
                disabled={isRoomFull}
              />
              {errors.username && <p className="text-sm text-red-500">{errors.username}</p>}
            </div>

            {/* Password (if room is locked) */}
            {roomInfo.locked && (
              <div className="space-y-2">
                <Label htmlFor="password">Room Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Enter room password"
                    value={formData.password}
                    onChange={(e) => setFormData((prev) => ({ ...prev, password: e.target.value }))}
                    className={errors.password ? "border-red-500" : ""}
                    disabled={isRoomFull}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-0 top-0 h-full px-3"
                    onClick={() => setShowPassword(!showPassword)}
                    disabled={isRoomFull}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
                {errors.password && <p className="text-sm text-red-500">{errors.password}</p>}
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

            {/* Join/Create Button */}
            <Button onClick={handleJoin} className="w-full" disabled={isJoining || isRoomFull}>
              {isJoining ? "Joining..." : roomInfo.exists ? "Join Room" : "Create & Join Room"}
            </Button>
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
