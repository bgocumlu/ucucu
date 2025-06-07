"use client"

import React, { useEffect, useRef, useState } from "react"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { X, RotateCcw } from "lucide-react"

interface VideoFullscreenModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  videoElement: HTMLVideoElement | null
  participantName: string
  isScreenShare?: boolean
}

export function VideoFullscreenModal({ 
  open, 
  onOpenChange, 
  videoElement, 
  participantName, 
  isScreenShare = false 
}: VideoFullscreenModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [videoError, setVideoError] = useState(false)

  // Clone the video stream when modal opens
  useEffect(() => {
    if (open && videoElement && videoRef.current) {
      const cloneStream = () => {
        try {
          setVideoError(false)
          if (videoElement.srcObject) {
            videoRef.current!.srcObject = videoElement.srcObject
            videoRef.current!.muted = videoElement.muted
            
            // Ensure video plays
            const playPromise = videoRef.current!.play()
            if (playPromise) {
              playPromise.catch(error => {
                console.warn('Video play failed in fullscreen modal:', error)
                setVideoError(true)
              })
            }
          }
        } catch (error) {
          console.error('Failed to clone video stream:', error)
          setVideoError(true)
        }
      }

      cloneStream()

      // Listen for stream changes on the original video
      const handleStreamChange = () => {
        if (videoRef.current && videoElement.srcObject) {
          cloneStream()
        }
      }

      // Monitor for srcObject changes
      const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          if (mutation.type === 'attributes' && mutation.attributeName === 'src') {
            handleStreamChange()
          }
        })
      })

      observer.observe(videoElement, {
        attributes: true,
        attributeFilter: ['src']
      })

      // Also listen for srcObject property changes (more reliable for MediaStream)
      const checkForStreamChanges = () => {
        if (videoElement.srcObject && videoRef.current?.srcObject !== videoElement.srcObject) {
          handleStreamChange()
        }
      }
      
      const streamCheckInterval = setInterval(checkForStreamChanges, 1000)

      return () => {
        observer.disconnect()
        clearInterval(streamCheckInterval)
      }
    }
  }, [open, videoElement])

  // Clean up video stream when modal closes
  useEffect(() => {
    if (!open && videoRef.current) {
      videoRef.current.srcObject = null
    }
  }, [open])

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) {
        onOpenChange(false)
      }
    }

    if (open) {
      document.addEventListener('keydown', handleEscape)
      return () => document.removeEventListener('keydown', handleEscape)
    }
  }, [open, onOpenChange])

  // Handle Android back button
  useEffect(() => {
    const handlePopstate = () => {
      if (open) {
        onOpenChange(false)
      }
    }

    if (open) {
      window.addEventListener('popstate', handlePopstate)
      return () => window.removeEventListener('popstate', handlePopstate)
    }
  }, [open, onOpenChange])

  const handleRetry = () => {
    if (videoElement && videoRef.current) {
      setVideoError(false)
      videoRef.current.srcObject = videoElement.srcObject
      const playPromise = videoRef.current.play()
      if (playPromise) {
        playPromise.catch(error => {
          console.warn('Video retry failed:', error)
          setVideoError(true)
        })
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent 
        className="fullscreen-modal-content p-0 border-0 bg-black max-w-none w-screen h-screen rounded-none"
        style={{ 
          margin: 0,
          transform: 'none',
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 100
        }}
      >
        {/* Video Container */}
        <div className="relative w-full h-full flex items-center justify-center bg-black">
          {videoError ? (
            <div className="flex flex-col items-center justify-center text-white p-8 text-center">
              <div className="text-xl mb-4">Video unavailable</div>
              <Button 
                variant="outline" 
                onClick={handleRetry}
                className="bg-white/10 border-white/20 text-white hover:bg-white/20"
              >
                <RotateCcw className="w-4 h-4 mr-2" />
                Try Again
              </Button>
            </div>
          ) : (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted={!isScreenShare} // Screen shares can have audio
              className="max-w-full max-h-full object-contain"
              style={{
                width: '100%',
                height: '100%',
              }}
            />
          )}

          {/* Close Button */}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onOpenChange(false)}
            className="absolute top-4 right-4 z-10 bg-black/50 hover:bg-black/70 text-white border-white/20 rounded-full w-12 h-12"
          >
            <X className="w-6 h-6" />
          </Button>

          {/* Participant Label */}
          <div className="absolute bottom-4 left-4 z-10 bg-black/70 text-white px-4 py-2 rounded-lg text-sm font-medium">
            {participantName} {isScreenShare && '(Screen)'}
          </div>

          {/* Tap to close hint for mobile */}
          <div className="absolute bottom-4 right-4 z-10 bg-black/50 text-white/70 px-3 py-1 rounded text-xs sm:hidden">
            Tap to close
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
