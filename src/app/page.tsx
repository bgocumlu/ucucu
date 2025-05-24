"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Plus, Users, Lock, Search } from "lucide-react"
import Link from "next/link"
import { CreateRoomModal } from "@/components/create-room-modal"

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
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [isOnline, setIsOnline] = useState(true)

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
                You&#39;re offline. You can view rooms but can&#39;t join or create new ones.
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
                <Button onClick={() => setShowCreateModal(true)} disabled={!isOnline} className="w-full">
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
          onClick={() => setShowCreateModal(true)}
          disabled={!isOnline}
        >
          <Plus className="h-6 w-6" />
        </Button>
      </div>

      {/* Create Room Modal */}
      <CreateRoomModal open={showCreateModal} onOpenChange={setShowCreateModal} />
    </div>
  )
}
