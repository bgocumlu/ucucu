"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Crown, Shield, UserX } from "lucide-react"

interface Participant {
  username: string
  isOwner: boolean
}

interface RoomSettingsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  roomId: string
  participants: Participant[]
  currentUser: string
  owner?: string
  onUpdateSettings?: (settings: { name?: string; maxParticipants?: number; locked?: boolean }) => void
}

export function RoomSettingsModal({ open, onOpenChange, roomId, participants, currentUser, owner, onUpdateSettings }: RoomSettingsModalProps) {
  const [roomName, setRoomName] = useState("Study Group")
  const [maxParticipants, setMaxParticipants] = useState("5")
  const [newPassword, setNewPassword] = useState("")

  const currentUserData = participants.find((p) => p.username === currentUser)
  const isOwner = owner ? currentUser === owner : currentUserData?.isOwner || false

  const handleKickUser = (username: string) => {
    // In real app, this would send a WebSocket message
    console.log("Kicking user:", username)
  }

  const handleBanUser = (username: string) => {
    // In real app, this would send a WebSocket message
    console.log("Banning user:", username)
  }

  const getInitials = (username: string) => {
    return username.slice(0, 2).toUpperCase()
  }

  // Save changes handler
  const handleSave = () => {
    if (onUpdateSettings) {
      onUpdateSettings({ name: roomName, maxParticipants: Number(maxParticipants) })
    }
  }
  const handleUpdateSecurity = () => {
    if (onUpdateSettings) {
      onUpdateSettings({ maxParticipants: Number(maxParticipants) })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Room Settings</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="info" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="info">Info</TabsTrigger>
            <TabsTrigger value="security">Security</TabsTrigger>
            <TabsTrigger value="participants">People</TabsTrigger>
          </TabsList>

          {/* Room Info Tab */}
          <TabsContent value="info" className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="roomId">Room ID</Label>
              <Input id="roomId" value={roomId} disabled className="bg-gray-50" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="roomName">Room Name</Label>
              <Input
                id="roomName"
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                disabled={!isOwner}
                placeholder="Enter room name"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="visibility">Visibility</Label>
              <div className="flex items-center space-x-2">
                <Badge variant="secondary">Public</Badge>
                <span className="text-sm text-gray-600">This room appears in the public directory</span>
              </div>
            </div>

            {owner && (
              <div className="text-xs text-gray-500">
                Room creator: <span className="font-semibold">{owner}</span>
              </div>
            )}
            {isOwner && <Button className="w-full" onClick={handleSave}>Save Changes</Button>}
          </TabsContent>

          {/* Security Tab */}
          <TabsContent value="security" className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="maxParticipants">Max Participants</Label>
              <Select value={maxParticipants} onValueChange={setMaxParticipants} disabled={!isOwner}>
                <SelectTrigger>
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

            {isOwner && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="newPassword">Change Password</Label>
                  <Input
                    id="newPassword"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Enter new password (leave empty to remove)"
                  />
                </div>

                <Button className="w-full" onClick={handleUpdateSecurity}>Update Security Settings</Button>
              </>
            )}

            {!isOwner && (
              <div className="text-center text-gray-500 text-sm py-4">
                Only the room owner can modify security settings
              </div>
            )}
          </TabsContent>

          {/* Participants Tab */}
          <TabsContent value="participants" className="space-y-4">
            <div className="space-y-3">
              {participants.map((participant) => (
                <div key={participant.username} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 bg-blue-500 rounded-full flex items-center justify-center text-white font-medium">
                      {getInitials(participant.username)}
                    </div>
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="font-medium">{participant.username}</span>
                        {participant.isOwner && <Crown className="h-4 w-4 text-yellow-500" />}
                        {participant.username === currentUser && (
                          <Badge variant="outline" className="text-xs">
                            You
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-gray-600">{participant.isOwner ? "Room Owner" : "Participant"}</p>
                    </div>
                  </div>

                  {isOwner && participant.username !== currentUser && (
                    <div className="flex space-x-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleKickUser(participant.username)}
                        className="text-orange-600 hover:text-orange-700"
                      >
                        <UserX className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleBanUser(participant.username)}
                        className="text-red-600 hover:text-red-700"
                      >
                        <Shield className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="text-center text-sm text-gray-600">
              {participants.length} of {maxParticipants} participants
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
