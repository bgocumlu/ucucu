"use client"

import type React from "react"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Plus, Users, Lock, Search } from "lucide-react"
import Link from "next/link"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useRouter } from "next/navigation"

interface Room {
  id: string
  name: string
  count: number
  maxParticipants: number
  locked: boolean
  visibility: "public" | "private"
}

export default function HomePage() {
  const [rooms, setRooms] = useState<Room[]>([])
  const [searchQuery, setSearchQuery] = useState("")
  const [showRoomInput, setShowRoomInput] = useState(false)
  const [roomName, setRoomName] = useState("")
  const [isOnline, setIsOnline] = useState(true)

  const [roomStatus, setRoomStatus] = useState<{
    exists: boolean
    name?: string
    count?: number
    maxParticipants?: number
    locked?: boolean
  } | null>(null)
  const [checkingRoom, setCheckingRoom] = useState(false)

  const router = useRouter()

  // Simulate real-time room updates
  useEffect(() => {
    // Mock data for demonstration
    const mockRooms: Room[] = [
      { id: "study-group", name: "Study Group", count: 3, maxParticipants: 5, locked: true, visibility: "public" },
      { id: "gaming-chat", name: "Gaming Chat", count: 7, maxParticipants: 10, locked: false, visibility: "public" },
      { id: "work-team", name: "Work Team", count: 2, maxParticipants: 8, locked: true, visibility: "public" },
    ]
    setRooms(mockRooms)

    // Check online status
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)

    window.addEventListener("online", handleOnline)
    window.addEventListener("offline", handleOffline)

    return () => {
      window.removeEventListener("online", handleOnline)
      window.removeEventListener("offline", handleOffline)
    }
  }, [])

  const filteredRooms = rooms.filter(
    (room) =>
      room.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      room.id.toLowerCase().includes(searchQuery.toLowerCase()),
  )

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((word) => word[0])
      .join("")
      .toUpperCase()
      .slice(0, 2)
  }

  const handleJoinOrCreateRoom = () => {
    if (!roomName.trim()) return

    const cleanRoomName = roomName
      .trim()
      .toLowerCase()
      .replace(/[^a-zA-Z0-9-_]/g, "-")
    router.push(`/${cleanRoomName}`)
    setShowRoomInput(false)
    setRoomName("")
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleJoinOrCreateRoom()
    }
  }

  // Check room existence when room name changes
  useEffect(() => {
    if (!roomName.trim() || !showRoomInput) {
      setRoomStatus(null)
      return
    }

    const checkRoomExists = async () => {
      setCheckingRoom(true)

      // Debounce the check
      const timeoutId = setTimeout(async () => {
        try {
          const cleanRoomName = roomName
            .trim()
            .toLowerCase()
            .replace(/[^a-zA-Z0-9-_]/g, "-")

          // Mock API call to check if room exists
          await new Promise((resolve) => setTimeout(resolve, 300))

          // Check against existing rooms
          const existingRoom = rooms.find((room) => room.id === cleanRoomName)

          if (existingRoom) {
            setRoomStatus({
              exists: true,
              name: existingRoom.name,
              count: existingRoom.count,
              maxParticipants: existingRoom.maxParticipants,
              locked: existingRoom.locked,
            })
          } else {
            setRoomStatus({
              exists: false,
            })
          }
        } catch (error) {
          console.error("Failed to check room:", error)
          setRoomStatus(null)
        } finally {
          setCheckingRoom(false)
        }
      }, 500)

      return () => clearTimeout(timeoutId)
    }

    checkRoomExists()
  }, [roomName, showRoomInput, rooms])

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-3">
        <div className="max-w-md mx-auto flex items-center justify-between">
          <h1 className="text-xl font-semibold text-gray-900">EphemeralChat</h1>
          {!isOnline && (
            <Badge variant="destructive" className="text-xs">
              Offline
            </Badge>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-md mx-auto px-4 py-6 pb-20">
        {/* Search */}
        <div className="relative mb-6">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
          <Input
            placeholder="Search rooms..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>

        {/* Offline Message */}
        {!isOnline && (
          <Card className="mb-6 border-orange-200 bg-orange-50">
            <CardContent className="p-4">
              <p className="text-orange-800 text-sm">
                You&apos;re offline. You can view rooms but can&apos;t join or create new ones.
              </p>
            </CardContent>
          </Card>
        )}

        {/* Active Rooms */}
        <div className="space-y-3">
          <h2 className="text-lg font-medium text-gray-900 mb-4">Active Rooms</h2>

          {filteredRooms.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-center">
                <p className="text-gray-500 mb-4">No active rooms found</p>
                <Button onClick={() => setShowRoomInput(true)} disabled={!isOnline} className="w-full">
                  <Plus className="h-4 w-4 mr-2" />
                  Create First Room
                </Button>
              </CardContent>
            </Card>
          ) : (
            filteredRooms.map((room) => (
              <Link key={room.id} href={`/${room.id}`}>
                <Card className="hover:shadow-md transition-shadow cursor-pointer">
                  <CardContent className="p-4">
                    <div className="flex items-center space-x-3">
                      {/* Room Avatar */}
                      <div className="w-12 h-12 bg-blue-500 rounded-full flex items-center justify-center text-white font-medium">
                        {getInitials(room.name)}
                      </div>

                      {/* Room Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center space-x-2">
                          <h3 className="font-medium text-gray-900 truncate">{room.name}</h3>
                          {room.locked && <Lock className="h-4 w-4 text-gray-400" />}
                        </div>
                        <p className="text-sm text-gray-500">/{room.id}</p>
                      </div>

                      {/* Participant Count */}
                      <div className="flex items-center space-x-1 text-gray-500">
                        <Users className="h-4 w-4" />
                        <span className="text-sm">
                          {room.count}/{room.maxParticipants}
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))
          )}
        </div>
      </main>

      {/* Floating Action Button */}
      <div className="fixed bottom-6 right-6">
        <Button
          size="lg"
          className="rounded-full h-14 w-14 shadow-lg"
          onClick={() => setShowRoomInput(true)}
          disabled={!isOnline}
        >
          <Plus className="h-6 w-6" />
        </Button>
      </div>

      {/* Room Name Input Dialog */}
      <Dialog
        open={showRoomInput}
        onOpenChange={(open) => {
          setShowRoomInput(open)
          if (!open) {
            setRoomName("")
            setRoomStatus(null)
            setCheckingRoom(false)
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Enter Room Name</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Input
                placeholder="Enter room name..."
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                onKeyPress={handleKeyPress}
                autoFocus
              />

              {/* Room Status */}
              {roomName.trim() && (
                <div className="min-h-[60px]">
                  {checkingRoom ? (
                    <div className="flex items-center space-x-2 text-gray-500 text-sm">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-400"></div>
                      <span>Checking room...</span>
                    </div>
                  ) : roomStatus ? (
                    <div className="space-y-2">
                      {roomStatus.exists ? (
                        <div className="p-3 bg-blue-50 border border-blue-200 rounded-md">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-sm font-medium text-blue-900">Room exists: {roomStatus.name}</p>
                              <div className="flex items-center space-x-4 text-xs text-blue-700 mt-1">
                                <span className="flex items-center space-x-1">
                                  <Users className="h-3 w-3" />
                                  <span>
                                    {roomStatus.count}/{roomStatus.maxParticipants}
                                  </span>
                                </span>
                                {roomStatus.locked && (
                                  <span className="flex items-center space-x-1">
                                    <Lock className="h-3 w-3" />
                                    <span>Password required</span>
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="p-3 bg-green-50 border border-green-200 rounded-md">
                          <p className="text-sm font-medium text-green-900">New room - you&apos;ll be the owner</p>
                          <p className="text-xs text-green-700 mt-1">
                            You can set password, participant limit, and visibility
                          </p>
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              )}
            </div>

            <div className="flex space-x-2">
              <Button variant="outline" onClick={() => setShowRoomInput(false)} className="flex-1">
                Cancel
              </Button>
              <Button onClick={handleJoinOrCreateRoom} disabled={!roomName.trim() || checkingRoom} className="flex-1">
                {checkingRoom ? "Checking..." : roomStatus?.exists ? "Join Room" : "Create Room"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
