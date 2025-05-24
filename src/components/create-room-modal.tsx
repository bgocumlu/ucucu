"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useRouter } from "next/navigation"
import { Eye, EyeOff } from "lucide-react"

interface CreateRoomModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CreateRoomModal({ open, onOpenChange }: CreateRoomModalProps) {
  const router = useRouter()
  const [formData, setFormData] = useState({
    roomId: "",
    username: "",
    displayName: "",
    password: "",
    maxParticipants: "10",
    visibility: "public" as "public" | "private",
    requirePassword: false,
  })
  const [showPassword, setShowPassword] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isCreating, setIsCreating] = useState(false)

  const validateForm = () => {
    const newErrors: Record<string, string> = {}

    if (!formData.roomId.trim()) {
      newErrors.roomId = "Room ID is required"
    } else if (formData.roomId.length < 3) {
      newErrors.roomId = "Room ID must be at least 3 characters"
    } else if (!/^[a-zA-Z0-9-_]+$/.test(formData.roomId)) {
      newErrors.roomId = "Room ID can only contain letters, numbers, hyphens, and underscores"
    }

    if (!formData.username.trim()) {
      newErrors.username = "Username is required"
    } else if (formData.username.length < 3 || formData.username.length > 20) {
      newErrors.username = "Username must be 3-20 characters"
    }

    if (formData.requirePassword && !formData.password) {
      newErrors.password = "Password is required when enabled"
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleCreate = async () => {
    if (!validateForm()) return

    setIsCreating(true)

    try {
      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 1000))

      // Navigate to the new room
      router.push(`/${formData.roomId}`)
      onOpenChange(false)

      // Reset form
      setFormData({
        roomId: "",
        username: "",
        displayName: "",
        password: "",
        maxParticipants: "10",
        visibility: "public",
        requirePassword: false,
      })
    } catch (error) {
      console.error("Failed to create room:", error)
    } finally {
      setIsCreating(false)
    }
  }

  const generateRoomId = () => {
    const adjectives = ["cool", "awesome", "epic", "fun", "chill", "cozy", "bright", "swift"]
    const nouns = ["chat", "room", "space", "hub", "zone", "lounge", "corner", "spot"]
    const randomAdj = adjectives[Math.floor(Math.random() * adjectives.length)]
    const randomNoun = nouns[Math.floor(Math.random() * nouns.length)]
    const randomNum = Math.floor(Math.random() * 1000)

    setFormData((prev) => ({
      ...prev,
      roomId: `${randomAdj}-${randomNoun}-${randomNum}`,
    }))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create New Room</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Room ID */}
          <div className="space-y-2">
            <Label htmlFor="roomId">Room ID</Label>
            <div className="flex space-x-2">
              <Input
                id="roomId"
                placeholder="my-awesome-room"
                value={formData.roomId}
                onChange={(e) => setFormData((prev) => ({ ...prev, roomId: e.target.value }))}
                className={errors.roomId ? "border-red-500" : ""}
              />
              <Button type="button" variant="outline" onClick={generateRoomId} className="shrink-0">
                Random
              </Button>
            </div>
            {errors.roomId && <p className="text-sm text-red-500">{errors.roomId}</p>}
          </div>

          {/* Username */}
          <div className="space-y-2">
            <Label htmlFor="username">Your Username</Label>
            <Input
              id="username"
              placeholder="Enter your username"
              value={formData.username}
              onChange={(e) => setFormData((prev) => ({ ...prev, username: e.target.value }))}
              className={errors.username ? "border-red-500" : ""}
            />
            {errors.username && <p className="text-sm text-red-500">{errors.username}</p>}
          </div>

          {/* Display Name */}
          <div className="space-y-2">
            <Label htmlFor="displayName">Display Name (Optional)</Label>
            <Input
              id="displayName"
              placeholder="My Awesome Room"
              value={formData.displayName}
              onChange={(e) => setFormData((prev) => ({ ...prev, displayName: e.target.value }))}
            />
          </div>

          {/* Password Toggle */}
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

          {/* Password */}
          {formData.requirePassword && (
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Enter room password"
                  value={formData.password}
                  onChange={(e) => setFormData((prev) => ({ ...prev, password: e.target.value }))}
                  className={errors.password ? "border-red-500" : ""}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-0 top-0 h-full px-3"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              {errors.password && <p className="text-sm text-red-500">{errors.password}</p>}
            </div>
          )}

          {/* Max Participants */}
          <div className="space-y-2">
            <Label htmlFor="maxParticipants">Max Participants</Label>
            <Select
              value={formData.maxParticipants}
              onValueChange={(value) => setFormData((prev) => ({ ...prev, maxParticipants: value }))}
            >
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

          {/* Visibility */}
          <div className="space-y-2">
            <Label>Visibility</Label>
            <div className="flex space-x-4">
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
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
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
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

          {/* Create Button */}
          <Button onClick={handleCreate} className="w-full" disabled={isCreating}>
            {isCreating ? "Creating..." : "Create Room"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
