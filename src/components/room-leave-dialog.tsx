"use client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface RoomLeaveDialogProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function RoomLeaveDialog({ open, onConfirm, onCancel }: RoomLeaveDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="sm:max-w-md">        <DialogHeader>
          <DialogTitle>Leave Room</DialogTitle>
          <DialogDescription>
            Confirm your action to leave this chat room.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-gray-700">Are you sure you want to leave this room?</p>
          <div className="flex space-x-2">
            <Button variant="outline" onClick={onCancel} className="flex-1">
              Cancel
            </Button>
            <Button variant="destructive" onClick={onConfirm} className="flex-1">
              Leave Room
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
