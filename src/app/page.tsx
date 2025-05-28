"use client"

import type React from "react"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Plus, Users, Lock, Search, Bell, Globe } from "lucide-react"
import Link from "next/link"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { useRouter } from "next/navigation"
import { useWebSocket } from "@/components/WebSocketProvider"
import { notificationService } from "@/lib/notification-service"

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
  const [subscribedRooms, setSubscribedRooms] = useState<{ roomId: string; username: string; remainingTime: number }[]>([])

  const [roomStatus, setRoomStatus] = useState<{
    exists: boolean
    name?: string
    count?: number
    maxParticipants?: number
    locked?: boolean
  } | null>(null)
  const [checkingRoom, setCheckingRoom] = useState(false)

  const router = useRouter()
  const { send, lastMessage, isConnected } = useWebSocket()  // Connect to WebSocket server
  useEffect(() => {
    send({ type: "getRooms" })

    // Online/offline status
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)
    window.addEventListener("online", handleOnline)
    window.addEventListener("offline", handleOffline)

    return () => {
      window.removeEventListener("online", handleOnline)
      window.removeEventListener("offline", handleOffline)
    }
  }, [send])
  useEffect(() => {
    if (isConnected) {
      console.log("Connected! Sending getRooms request")
      send({ type: "getRooms" })    }
  }, [isConnected, send])
    useEffect(() => {
    if (lastMessage && lastMessage.type === "rooms") {
      console.log("Received rooms:", lastMessage.rooms)
      setRooms(lastMessage.rooms as Room[])
      
      // Debug: Check if global room is in the list
      const globalRoomInList = (lastMessage.rooms as Room[]).find(r => r.id === 'global')
      console.log("Global room found in rooms list:", globalRoomInList)
    }
    // Listen for roomInfo and newMessage to trigger a getRooms for live updates
    if (lastMessage && (lastMessage.type === "roomInfo" || lastMessage.type === "newMessage")) {
      send({ type: "getRooms" })
    }
  }, [lastMessage, send])
  useEffect(() => {
    setIsOnline(isConnected)
  }, [isConnected])

  // Load subscribed rooms from notification service
  useEffect(() => {
    const updateSubscribedRooms = () => {
      const subscribed = notificationService.getSubscribedRooms()
      setSubscribedRooms(subscribed)
    }

    // Update immediately
    updateSubscribedRooms()

    // Update every 30 seconds to refresh remaining times
    const interval = setInterval(updateSubscribedRooms, 30000)

    return () => clearInterval(interval)
  }, [])

  // Check room existence when room name changes - USE EXISTING WEBSOCKET
  useEffect(() => {
    if (!roomName.trim() || !showRoomInput) {
      setRoomStatus(null)
      return
    }

    setCheckingRoom(true)

    // Use the existing WebSocket connection instead of creating a new one
    const timeoutId = setTimeout(() => {
      send({ type: "getRooms" })
    }, 500)

    return () => {
      clearTimeout(timeoutId)
    }
  }, [roomName, showRoomInput, send])

  // Handle room status checking with existing lastMessage
  useEffect(() => {
    if (!checkingRoom || !lastMessage || lastMessage.type !== "rooms") return

    const cleanRoomName = roomName.trim().toLowerCase().replace(/[^a-zA-Z0-9-_]/g, "-")
    const existingRoom = (lastMessage.rooms as Room[]).find((room) => room.id === cleanRoomName)
    
    if (existingRoom) {
      setRoomStatus({
        exists: true,
        name: existingRoom.name,
        count: existingRoom.count,
        maxParticipants: existingRoom.maxParticipants,
        locked: existingRoom.locked,
      })
    } else {
      setRoomStatus({ exists: false })
    }    setCheckingRoom(false)
  }, [lastMessage, checkingRoom, roomName])
  const filteredRooms = rooms.filter(
    (room) => {
      // Exclude global room from active rooms list
      if (room.id === 'global') return false;
      
      // Filter by search query and visibility
      const matchesSearch = room.visibility === 'public' &&
        (room.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
         room.id.toLowerCase().includes(searchQuery.toLowerCase()));
      
      // Exclude rooms that user is already subscribed to
      const isSubscribed = subscribedRooms.some(
        (subscribedRoom) => subscribedRoom.roomId === room.id
      );
        return matchesSearch && !isSubscribed;
    }
  )

  const globalRoom = rooms.find(room => room.id === 'global')
  
  // Debug: Log globalRoom state
  console.log("Global room state:", globalRoom)
  console.log("All rooms:", rooms.map(r => ({ id: r.id, name: r.name })))

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

  const handleDirectJoinSubscribedRoom = (roomId: string, username: string) => {
    // Navigate directly to chat with the stored username
    router.push(`/${roomId}/chat?username=${encodeURIComponent(username)}`)
  }
  const formatRemainingTime = (seconds: number): string => {
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)
    
    if (days > 0) {
      return `${days}d`
    } else if (hours > 0) {
      return `${hours}h`
    } else if (minutes > 0) {
      return `${minutes}m`
    } else {
      return `${seconds}s`
    }
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

    // Check if room exists using the existing WebSocket connection
    if (!isConnected) {
      setRoomStatus(null)
      setCheckingRoom(false)
      return
    }

    setCheckingRoom(true)
    // Use the existing WebSocket connection to get rooms
    send({ type: "getRooms" })
  }, [roomName, showRoomInput, isConnected, send])

  // Handle room status updates from WebSocket messages
  useEffect(() => {
    if (lastMessage?.type === "rooms" && checkingRoom && roomName.trim()) {
      const cleanRoomName = roomName.trim().toLowerCase().replace(/[^a-zA-Z0-9-_]/g, "-")
      const existingRoom = (lastMessage.rooms as Room[]).find((room) => room.id === cleanRoomName)
      
      if (existingRoom) {
        setRoomStatus({
          exists: true,
          name: existingRoom.name,
          count: existingRoom.count,
          maxParticipants: existingRoom.maxParticipants,
          locked: existingRoom.locked,
        })
      } else {
        setRoomStatus({ exists: false })
      }
      setCheckingRoom(false)
    }
  }, [lastMessage, checkingRoom, roomName])

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-3">
        <div className="max-w-md mx-auto flex items-center justify-between">
          <h1 className="text-xl font-semibold text-gray-900">Uçucu</h1>
          {!isOnline && (
            <Badge variant="destructive" className="text-xs">
              Offline
            </Badge>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-md mx-auto px-4 py-6 pb-20">        {/* Search */}
        <div className="relative mb-6">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
          <Input
            id="search-rooms"
            name="search-rooms"
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

        {/* Subscribed Rooms */}
        {subscribedRooms.length > 0 && (
          <div className="space-y-3 mb-8">
            <h2 className="text-lg font-medium text-gray-900 mb-4 flex items-center">
              <Bell className="h-5 w-5 mr-2 text-blue-600" />
              Subscribed Rooms
            </h2>
            {subscribedRooms.map((subscribedRoom) => (
              <Card 
                key={`${subscribedRoom.roomId}_${subscribedRoom.username}`} 
                className="border-blue-200 bg-blue-50 hover:bg-blue-100 transition-colors cursor-pointer"
                onClick={() => handleDirectJoinSubscribedRoom(subscribedRoom.roomId, subscribedRoom.username)}
              >
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">                    <div className="flex items-center space-x-3">                      {/* Room Avatar */}
                      {subscribedRoom.roomId === 'global' ? (
                        <div className="w-10 h-10 bg-green-600 rounded-full flex items-center justify-center text-white">
                          <Globe className="h-5 w-5" />
                        </div>
                      ) : (
                        <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center text-white font-medium">
                          {getInitials(subscribedRoom.roomId)}
                        </div>
                      )}
                      
                      {/* Room Info */}
                      <div>
                        <h3 className="font-medium text-blue-900">
                          {subscribedRoom.roomId === 'global' ? 'Global Room' : `/${subscribedRoom.roomId}`}
                        </h3>
                        <p className="text-sm text-blue-700">as {subscribedRoom.username}</p>
                      </div>
                    </div>

                    {/* Notification Timer */}
                    <div className="flex items-center space-x-2 text-blue-600">
                      <Bell className="h-4 w-4" />
                      <span className="text-sm font-mono">
                        {formatRemainingTime(subscribedRoom.remainingTime)}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}        {/* Global Room - only show if user is NOT subscribed to it */}
        {globalRoom && !subscribedRooms.some(sub => sub.roomId === 'global') && (
          <div className="space-y-3 mb-8">
            <h2 className="text-lg font-medium text-gray-900 mb-4 flex items-center">
              <Globe className="h-5 w-5 mr-2 text-green-600" />
              Global Room
            </h2>
            <Link href={`/${globalRoom.id}`}>
              <Card className="border-green-200 bg-green-50 hover:bg-green-100 transition-colors cursor-pointer">
                <CardContent className="p-4">
                  <div className="flex items-center space-x-3">
                    {/* Globe Avatar */}
                    <div className="w-12 h-12 bg-green-600 rounded-full flex items-center justify-center text-white">
                      <Globe className="h-6 w-6" />
                    </div>

                    {/* Room Info */}
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-green-900">{globalRoom.name}</h3>
                      <p className="text-sm text-green-700">/{globalRoom.id}</p>
                    </div>

                    {/* Participant Count */}
                    <div className="flex items-center space-x-1 text-green-700">
                      <Users className="h-4 w-4" />
                      <span className="text-sm">
                        {globalRoom.count}/{globalRoom.maxParticipants}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          </div>
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
      </main>      {/* Floating Action Button */}
      <div className="fixed bottom-6 right-6">
        <Button
          size="lg"
          className="rounded-full h-14 w-14 shadow-lg"
          onClick={() => setShowRoomInput(true)}
          disabled={!isOnline}
          aria-label="Create or join a room"
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
        <DialogContent className="sm:max-w-md">          <DialogHeader>
            <DialogTitle>Enter Room Name</DialogTitle>
            <DialogDescription>
              Enter a room name to join or create a new chat room.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">            <div className="space-y-2">
              <Input
                id="room-name"
                name="room-name"
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
