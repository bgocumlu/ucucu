"use client"

import React, { useEffect, useRef, useState, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { ArrowLeft, Phone, Mic, MicOff, Volume2, Video, VideoOff, Monitor, MonitorOff, RotateCcw, FlipHorizontal, RefreshCw, Maximize } from "lucide-react"
import { NotificationBell } from "@/components/notification-bell"

// Extend Window interface for webkit AudioContext and fullscreen APIs
declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext
  }
  
  interface HTMLElement {
    webkitRequestFullscreen?: () => Promise<void>
    mozRequestFullScreen?: () => Promise<void>
    msRequestFullscreen?: () => Promise<void>
  }
  
  interface Document {
    webkitExitFullscreen?: () => Promise<void>
    mozCancelFullScreen?: () => Promise<void>
    msExitFullscreen?: () => Promise<void>
    webkitFullscreenElement?: Element | null
    mozFullScreenElement?: Element | null
    msFullscreenElement?: Element | null
  }
}

const SIGNALING_SERVER_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:3001"
const ICE_CONFIG = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] }

export default function CallPage() {
  const params = useParams()
  const router = useRouter()
  const rawRoomId = params.roomId as string
  const roomId = decodeURIComponent(rawRoomId)
  const [currentUser, setCurrentUser] = useState("")
  const [actualIsListener, setActualIsListener] = useState(false) // Track actual operational mode
  const [joined, setJoined] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [reconnecting, setReconnecting] = useState(false)
  const [connectionSequenceComplete, setConnectionSequenceComplete] = useState(false)
  const [connectionSequenceProgress, setConnectionSequenceProgress] = useState(0)
  const [error, setError] = useState("")
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({})
  const [remoteVideoStreams, setRemoteVideoStreams] = useState<Record<string, MediaStream>>({})
  const [remoteScreenStreams, setRemoteScreenStreams] = useState<Record<string, MediaStream>>({})
  const [remoteSystemAudioStreams, setRemoteSystemAudioStreams] = useState<Record<string, MediaStream>>({}) // NEW: separate system audio streams
  const [participants, setParticipants] = useState<Set<string>>(new Set()) // Track all participants
  const localAudioRef = useRef<HTMLAudioElement>(null)
  const localVideoRef = useRef<HTMLVideoElement>(null)
  const localScreenRef = useRef<HTMLVideoElement>(null)
  const localSystemAudioRef = useRef<HTMLAudioElement>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const localVideoStreamRef = useRef<MediaStream | null>(null)
  const localScreenStreamRef = useRef<MediaStream | null>(null)
  const localSystemAudioStreamRef = useRef<MediaStream | null>(null)
  const peerConnections = useRef<Record<string, RTCPeerConnection>>({})
  const [muted, setMuted] = useState(false)
  const [videoEnabled, setVideoEnabled] = useState(false)
  const [screenSharing, setScreenSharing] = useState(false)
  const [expandedParticipants, setExpandedParticipants] = useState<Set<string>>(new Set())
  const [localPreviewExpanded, setLocalPreviewExpanded] = useState(false)
  const [peerMuted, setPeerMuted] = useState<Record<string, boolean>>({}) // <--- NEW: track muted state for each remote peer
  const [speakingPeers, setSpeakingPeers] = useState<Record<string, boolean>>({})
  const [localSpeaking, setLocalSpeaking] = useState(false)
  
  // ROBUST CONNECTION: Add connection health monitoring
  const [connectionHealth, setConnectionHealth] = useState<Record<string, 'connecting' | 'connected' | 'failed' | 'disconnected'>>({})
  const connectionTimeouts = useRef<Record<string, NodeJS.Timeout>>({})
  
  // Add state for camera switching
  const [currentCamera, setCurrentCamera] = useState<'user' | 'environment'>('user') // 'user' = front, 'environment' = back
  
  // Add state for camera mirror functionality
  const [isMirrored, setIsMirrored] = useState(true) // Default to mirrored for front camera

  const analyserRef = useRef<AnalyserNode | null>(null)
  const localAudioContextRef = useRef<AudioContext | null>(null)
  const mixedAudioContextsRef = useRef<Map<string, AudioContext>>(new Map())  // For each participant, create refs for audio, video, and screen
  const remoteAudioRefs = useRef<Record<string, React.RefObject<HTMLAudioElement | null>>>({})
  const remoteVideoRefs = useRef<Record<string, React.RefObject<HTMLVideoElement | null>>>({})
  const remoteScreenRefs = useRef<Record<string, React.RefObject<HTMLVideoElement | null>>>({})
  const remoteSystemAudioRefs = useRef<Record<string, React.RefObject<HTMLAudioElement | null>>>({}) // NEW: refs for system audio
  
  // Create refs for all participants (not just those with streams)
  Array.from(participants).forEach(peer => {
    if (!remoteAudioRefs.current[peer]) {
      remoteAudioRefs.current[peer] = React.createRef<HTMLAudioElement>()
    }
    if (!remoteVideoRefs.current[peer]) {
      remoteVideoRefs.current[peer] = React.createRef<HTMLVideoElement>()
    }
    if (!remoteScreenRefs.current[peer]) {
      remoteScreenRefs.current[peer] = React.createRef<HTMLVideoElement>()
    }
    if (!remoteSystemAudioRefs.current[peer]) {
      remoteSystemAudioRefs.current[peer] = React.createRef<HTMLAudioElement>()
    }
  })// Attach srcObject for local audio, video, screen, and system audio
  useEffect(() => {
    if (localAudioRef.current && localStreamRef.current) {
      localAudioRef.current.srcObject = localStreamRef.current
    }
    if (localVideoRef.current && localVideoStreamRef.current) {
      localVideoRef.current.srcObject = localVideoStreamRef.current
    }
    if (localScreenRef.current && localScreenStreamRef.current) {
      localScreenRef.current.srcObject = localScreenStreamRef.current
    }
    if (localSystemAudioRef.current && localSystemAudioStreamRef.current) {
      localSystemAudioRef.current.srcObject = localSystemAudioStreamRef.current
      localSystemAudioRef.current.muted = true // IMPORTANT: Mute local system audio to prevent echo
    }
  }, [localAudioRef, localVideoRef, localScreenRef, localSystemAudioRef, joined, actualIsListener, videoEnabled, screenSharing])
  // --- Ensure remote audio/video/screen elements are always "live" and properly set ---
  useEffect(() => {
    Object.entries(remoteStreams).forEach(([peer, stream]) => {
      const ref = remoteAudioRefs.current[peer]
      if (ref && ref.current && stream) {
        if (ref.current.srcObject !== stream) {
          ref.current.srcObject = stream
        }
        ref.current.controls = false
        ref.current.muted = !!peerMuted[peer] // <-- mute if user wants to mute this peer
        ref.current
          .play()
          .catch(() => {
            // Ignore play errors (autoplay policy)
          })
      }
    })
  }, [remoteStreams, peerMuted])

  // Attach video streams to video elements
  useEffect(() => {
    Object.entries(remoteVideoStreams).forEach(([peer, stream]) => {
      const ref = remoteVideoRefs.current[peer]
      if (ref && ref.current && stream) {
        if (ref.current.srcObject !== stream) {
          ref.current.srcObject = stream
        }
        ref.current.controls = false
        ref.current
          .play()
          .catch(() => {
            // Ignore play errors (autoplay policy)
          })
      }
    })
  }, [remoteVideoStreams])

  // Attach screen streams to screen elements
  useEffect(() => {
    Object.entries(remoteScreenStreams).forEach(([peer, stream]) => {
      const ref = remoteScreenRefs.current[peer]
      if (ref && ref.current && stream) {
        if (ref.current.srcObject !== stream) {
          ref.current.srcObject = stream
        }
        ref.current.controls = false
        ref.current
          .play()
          .catch(() => {
            // Ignore play errors (autoplay policy)
          })
      }
    })
  }, [remoteScreenStreams])

  // Attach system audio streams to system audio elements
  useEffect(() => {
    console.log('🔊 System audio useEffect triggered. Current streams:', Object.keys(remoteSystemAudioStreams))
    Object.entries(remoteSystemAudioStreams).forEach(([peer, stream]) => {
      const ref = remoteSystemAudioRefs.current[peer]
      console.log(`Processing system audio for ${peer}:`, {
        hasRef: !!ref,
        hasRefCurrent: !!(ref && ref.current),
        hasStream: !!stream,
        streamTracks: stream ? stream.getTracks().length : 0
      })
      
      if (ref && ref.current && stream) {
        if (ref.current.srcObject !== stream) {
          ref.current.srcObject = stream
          console.log(`✅ Attached system audio stream to element for ${peer}`)
        }
        ref.current.controls = false
        ref.current.muted = false // Don't mute system audio by default
        ref.current
          .play()
          .then(() => {
            console.log(`▶️ Successfully started playing system audio for ${peer}`)
          })
          .catch((error) => {
            console.error(`❌ Failed to play system audio for ${peer}:`, error)
            // Ignore play errors (autoplay policy)
          })
      }
    })
  }, [remoteSystemAudioStreams])

// --- Local speaking detection ---
  useEffect(() => {
    if (!joined || actualIsListener || !localStreamRef.current) return
    let raf: number | undefined
    const AudioContextClass = window.AudioContext || window.webkitAudioContext
    if (!AudioContextClass) return
    const ctx = new AudioContextClass()
    localAudioContextRef.current = ctx
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 512
    analyserRef.current = analyser
    const source = ctx.createMediaStreamSource(localStreamRef.current)
    source.connect(analyser)    
    const data = new Uint8Array(analyser.fftSize)
    function checkSpeaking() {
      if (!analyser) return
      analyser.getByteTimeDomainData(data)
      // Simple volume threshold - decreased threshold for more sensitive detection
      const rms = Math.sqrt(data.reduce((sum, v) => sum + Math.pow(v - 128, 2), 0) / data.length)
      setLocalSpeaking(rms > 4)
      raf = requestAnimationFrame(checkSpeaking)
    }
    checkSpeaking()
    return () => {
      if (raf !== undefined) cancelAnimationFrame(raf)
      analyser.disconnect()
      source.disconnect()
      ctx.close()
    }
  }, [joined, actualIsListener])  // --- Remote speaking detection ---
  useEffect(() => {
    // For each remote stream, create an analyser and update speakingPeers
    const peerIds = Object.keys(remoteStreams)
    const audioContexts: Record<string, AudioContext> = {}
    const analysers: Record<string, AnalyserNode> = {}
    const datas: Record<string, Uint8Array> = {}
    let raf: number | undefined
    let stopped = false

    function checkRemoteSpeaking() {
      if (stopped) return
      const newSpeaking: Record<string, boolean> = {}
      const AudioContextClass = window.AudioContext || window.webkitAudioContext
      if (!AudioContextClass) return
      
      peerIds.forEach(peer => {
        const stream = remoteStreams[peer]
        if (!stream) return
        if (!audioContexts[peer]) {
          audioContexts[peer] = new AudioContextClass()
          analysers[peer] = audioContexts[peer].createAnalyser()
          analysers[peer].fftSize = 512
          datas[peer] = new Uint8Array(analysers[peer].fftSize)
          const src = audioContexts[peer].createMediaStreamSource(stream)
          src.connect(analysers[peer])
        }        analysers[peer].getByteTimeDomainData(datas[peer])
        const rms = Math.sqrt(datas[peer].reduce((sum, v) => sum + Math.pow(v - 128, 2), 0) / datas[peer].length)
        newSpeaking[peer] = rms > 4
      })
      setSpeakingPeers(newSpeaking)
      raf = requestAnimationFrame(checkRemoteSpeaking)
    }
    if (peerIds.length > 0) {
      checkRemoteSpeaking()
    }
    return () => {
      stopped = true
      if (raf !== undefined) cancelAnimationFrame(raf)
      peerIds.forEach(peer => {
        if (audioContexts[peer]) audioContexts[peer].close()
      })
    }  }, [remoteStreams])  // Handle mute/unmute without stopping tracks to maintain WebRTC connections
  const handleMute = async () => {
    if (!muted) {
      // Muting - disable audio tracks without stopping them
      setMuted(true)
      if (localStreamRef.current) {
        localStreamRef.current.getAudioTracks().forEach(track => {
          track.enabled = false // Disable instead of stopping
          console.log('Audio track muted:', track.label, track.enabled)
        })
      }
    } else {
      // Unmuting
      if (localStreamRef.current) {
        // Check if we have an arbitrary audio track (no real microphone access)
        const hasArbitraryTrack = localStreamRef.current.getAudioTracks().some(track => 
          track.label === "Arbitrary Audio Track"
        )
        
        if (hasArbitraryTrack) {
          // Try to get real microphone permission
          try {
            console.log('Attempting to get real microphone access to replace arbitrary track...')
            
            // First check if microphone devices are available
            let hasAudioDevices = false
            try {
              const devices = await navigator.mediaDevices.enumerateDevices()
              hasAudioDevices = devices.some(device => device.kind === 'audioinput')
              console.log('Available audio input devices:', devices.filter(d => d.kind === 'audioinput').length)
            } catch (deviceError) {
              console.warn('Could not enumerate devices:', deviceError)
            }
            
            if (!hasAudioDevices) {
              throw new DOMException('No microphone devices found on this system. Please connect a microphone and try again.', 'NotFoundError')
            }
            
            // Force a new permission request - this should trigger the browser permission dialog
            const newStream = await navigator.mediaDevices.getUserMedia({ 
              audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
              }, 
              video: false 
            })
            
            // Stop the old arbitrary audio tracks
            localStreamRef.current.getAudioTracks().forEach(track => track.stop())
            
            // Replace with real microphone stream
            localStreamRef.current = newStream
            if (localAudioRef.current) {
              localAudioRef.current.srcObject = newStream
            }
            
            // Replace tracks in all existing peer connections using replaceTrack to maintain m-line order
            Object.values(peerConnections.current).forEach(pc => {
              const newTrack = newStream.getAudioTracks()[0]
              if (newTrack) {
                // Find existing audio sender to replace track (preserves m-line order)
                const existingAudioSender = pc.getSenders().find(sender => 
                  sender.track && sender.track.kind === 'audio'
                )
                
                if (existingAudioSender && existingAudioSender.track) {
                  // Use replaceTrack to maintain m-line order
                  existingAudioSender.replaceTrack(newTrack).then(() => {
                    console.log('✅ Successfully replaced arbitrary audio with real microphone using replaceTrack')
                  }).catch(error => {
                    console.warn('⚠️ replaceTrack failed, falling back to remove/add:', error)
                    // Fallback: remove old and add new (may cause m-line reordering)
                    pc.removeTrack(existingAudioSender)
                    pc.addTrack(newTrack, newStream)
                  })
                } else {
                  // No existing audio sender, add new track
                  pc.addTrack(newTrack, newStream)
                  console.log('✅ Added new real microphone track (no existing audio sender)')
                }
              }
            })
            
            // Trigger renegotiation for all peers
            Object.entries(peerConnections.current).forEach(async ([remote, pc]) => {
              try {
                const offer = await pc.createOffer()
                await pc.setLocalDescription(offer)
                if (wsRef.current) {
                  wsRef.current.send(JSON.stringify({ 
                    type: "call-offer", 
                    roomId, 
                    from: currentUser, 
                    to: remote, 
                    payload: pc.localDescription 
                  }))
                }
              } catch (error) {
                console.error('Error creating unmute offer:', error)
              }
            })
            
            setMuted(false)
            setError("")
            console.log('Successfully replaced arbitrary track with real microphone')
          } catch (error) {
            console.warn('Failed to get real microphone access:', error)
            // Show more helpful error message based on the error type
            const mediaError = error as DOMException
            if (mediaError.name === 'NotAllowedError') {
              setError("Microphone permission denied. Please click the microphone icon in your browser's address bar and allow microphone access, then try again.")
            } else if (mediaError.name === 'NotFoundError') {
              setError("No microphone found on this system. Please connect a microphone and refresh the page to try again.")
            } else if (mediaError.name === 'NotSupportedError') {
              setError("Microphone access not supported by your browser. Please try using a modern browser like Chrome, Firefox, or Edge.")
            } else if (mediaError.name === 'NotReadableError') {
              setError("Microphone is being used by another application. Please close other applications using the microphone and try again.")
            } else if (mediaError.name === 'OverconstrainedError') {
              setError("Microphone doesn't support the required settings. Please try with a different microphone.")
            } else {
              setError(`Failed to access microphone: ${mediaError.message || 'Unknown error'}. Please check your system audio settings and try again.`)
            }
            
            // Keep the arbitrary track enabled for WebRTC connection but stay muted
            localStreamRef.current.getAudioTracks().forEach(track => {
              track.enabled = true
              console.log('Keeping arbitrary audio track enabled for WebRTC (permission denied):', track.label)
            })
            // Stay muted since we couldn't get real microphone access
            setMuted(true)
          }
        } else {
          // We have real microphone tracks, just enable them
          localStreamRef.current.getAudioTracks().forEach(track => {
            track.enabled = true
            console.log('Audio track unmuted:', track.label, track.enabled)
          })
          setMuted(false)
          setError("")
        }
      } else {
        // If no stream, request permission and create new stream
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
          localStreamRef.current = stream
          if (localAudioRef.current) {
            localAudioRef.current.srcObject = stream
          }
          
          // Ensure audio tracks are enabled
          stream.getAudioTracks().forEach(track => {
            track.enabled = true
            console.log('New audio track enabled:', track.label, track.enabled)
          })
          
          // Add audio tracks to all existing peer connections and trigger renegotiation
          for (const [remote, pc] of Object.entries(peerConnections.current)) {
            stream.getTracks().forEach(track => {
              if (!pc.getSenders().some(sender => sender.track === track)) {
                pc.addTrack(track, stream)
              }
            })
            
            // Always trigger renegotiation for both sides
            try {
              const offer = await pc.createOffer()
              await pc.setLocalDescription(offer)
              if (wsRef.current) {
                wsRef.current.send(JSON.stringify({ 
                  type: "call-offer", 
                  roomId, 
                  from: currentUser, 
                  to: remote, 
                  payload: pc.localDescription 
                }))
              }
            } catch (error) {
              console.error('Error creating unmute offer:', error)
            }
          }
          
          setMuted(false)
          setError("")
        } catch {
          setError("Microphone access denied. Please check browser permissions.")
        }
      }
    }
  }

  // Consistent join logic (same as chat)
  useEffect(() => {
    const username = sessionStorage.getItem(`username:${roomId}`) || ""
    if (!username) {
      router.replace(`/${encodeURIComponent(roomId)}`)
      return
    }
    setCurrentUser(username)
  }, [roomId, router])  // Perfect negotiation implementation to handle SSL transport role conflicts
  async function safeSetRemoteDescription(pc: RTCPeerConnection, desc: RTCSessionDescriptionInit, isPolite: boolean = false) {
    console.log(`Setting remote description: ${desc.type}, signaling state: ${pc.signalingState}, isPolite: ${isPolite}`)
    
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(desc));
      console.log(`Successfully set remote ${desc.type}`)
      return 'success'
    } catch (e: unknown) {
      const error = e as Error;
      console.error("setRemoteDescription error", error, desc, pc.signalingState);
      
      // Handle specific WebRTC errors
      if (error.name === 'InvalidStateError' || error.name === 'InvalidAccessError') {
        // Check for m-line ordering issue specifically
        if (error.message.includes('m-line') || error.message.includes("order doesn't match")) {
          console.error('🚨 M-LINE ORDERING ERROR - peer connection needs recreation')
          return 'recreate'
        }
        
        if (desc.type === 'offer') {
          if (pc.signalingState === 'have-local-offer' && !isPolite) {
            // Impolite peer ignores colliding offer
            console.log("Ignoring colliding offer (impolite peer)")
            return 'ignored'
          } else {
            // Polite peer handles collision with rollback
            console.log("Handling offer collision with rollback (polite peer)")
            try {
              await pc.setLocalDescription({ type: "rollback" })
              await pc.setRemoteDescription(new RTCSessionDescription(desc));
              console.log("Successfully recovered from offer collision")
              return 'success'
            } catch (rollbackError) {
              console.error("Rollback recovery failed:", rollbackError)
              return 'recreate'
            }
          }
        } else if (desc.type === 'answer') {
          if (pc.signalingState === 'stable') {
            // Answer in stable state - ignore it as it's likely stale
            console.log("Answer received in stable state, ignoring (likely stale)")
            return 'ignored'
          } else {
            console.log("Answer in wrong state, may need to recreate connection")
            return 'recreate'
          }
        }
      } else if (error.name === 'OperationError' || error.message.includes('SSL role')) {
        console.log("SSL transport error - recreating peer connection")
        return 'recreate'
      }
      
      // Re-throw other errors
      throw error
    }
  }

  // UTILITY: Safe track replacement that maintains m-line order
  const safeReplaceTrack = async (pc: RTCPeerConnection, oldTrack: MediaStreamTrack | null, newTrack: MediaStreamTrack | null, stream: MediaStream, trackType: 'audio' | 'video' | 'screen'): Promise<boolean> => {
    try {
      // Find the appropriate sender based on track type and current track
      let targetSender: RTCRtpSender | undefined
      
      if (trackType === 'audio') {
        // Find the first audio sender (we only use ONE audio track now)
        targetSender = pc.getSenders().find(sender => 
          sender.track && sender.track.kind === 'audio'
        )
      } else if (trackType === 'video') {
        // Find camera video sender (not screen)
        targetSender = pc.getSenders().find(sender => 
          sender.track && sender.track.kind === 'video' && 
          !sender.track.label.toLowerCase().includes('screen') &&
          !sender.track.label.toLowerCase().includes('monitor') &&
          !sender.track.label.toLowerCase().includes('display')
        )
      } else if (trackType === 'screen') {
        // Find screen video sender
        targetSender = pc.getSenders().find(sender => 
          sender.track && sender.track.kind === 'video' && 
          (sender.track.label.toLowerCase().includes('screen') ||
           sender.track.label.toLowerCase().includes('monitor') ||
           sender.track.label.toLowerCase().includes('display'))
        )
      }
      
      if (targetSender) {
        // Replace existing track (maintains m-line order)
        await targetSender.replaceTrack(newTrack)
        console.log(`✅ Successfully replaced ${trackType} track using replaceTrack`)
        return true
      } else if (newTrack) {
        // No existing sender, add new track (this may change m-line order but is necessary)
        pc.addTrack(newTrack, stream)
        console.log(`✅ Added new ${trackType} track (no existing sender to replace)`)
        return true
      }
      
      return false
    } catch (error) {
      console.warn(`⚠️ Failed to replace ${trackType} track:`, error)
      return false
    }
  }

  const recreatePeerConnection = async (peerId: string) => {
    console.log(`🔥 RECREATING peer connection for ${peerId} due to m-line ordering error`)
    
    // CRITICAL: Store current track state before recreation to maintain consistency
    const existingPC = peerConnections.current[peerId]
    let existingTrackInfo: { kind: string; label: string; enabled: boolean }[] = []
    
    if (existingPC) {
      existingTrackInfo = existingPC.getSenders().map(sender => ({
        kind: sender.track?.kind || 'unknown',
        label: sender.track?.label || 'unknown',
        enabled: sender.track?.enabled || false
      }))
      console.log(`🔥 Storing existing track order for ${peerId}:`, existingTrackInfo)
      
      // Close existing connection
      existingPC.close()
      delete peerConnections.current[peerId]
    }
    
    // Clear any existing timeouts
    if (connectionTimeouts.current[peerId]) {
      clearTimeout(connectionTimeouts.current[peerId])
      delete connectionTimeouts.current[peerId]
    }
    
    // IMPORTANT: Wait a moment for complete cleanup
    await new Promise(resolve => setTimeout(resolve, 100))
    
    // Create new connection with IDENTICAL track order
    console.log(`🔥 Creating FRESH peer connection for ${peerId} with consistent track order`)
    const newPc = createPeerConnection(peerId)
    
    // VERIFY: Log new track order and compare with previous
    const newTrackInfo = newPc.getSenders().map(sender => ({
      kind: sender.track?.kind || 'unknown',
      label: sender.track?.label || 'unknown', 
      enabled: sender.track?.enabled || false
    }))
    
    console.log(`🔥 NEW track order for ${peerId}:`, newTrackInfo)
    console.log(`🔥 Order consistency check:`, {
      previousCount: existingTrackInfo.length,
      newCount: newTrackInfo.length,
      kindsMatch: existingTrackInfo.map(t => t.kind).join(',') === newTrackInfo.map(t => t.kind).join(','),
      orderChanged: JSON.stringify(existingTrackInfo) !== JSON.stringify(newTrackInfo)
    })
    
    // Trigger new negotiation with ICE restart for clean slate
    try {
      console.log(`🔥 Sending FRESH offer to ${peerId} with ICE restart`)
      const offer = await newPc.createOffer({ iceRestart: true })
      await newPc.setLocalDescription(offer)
      
      if (wsRef.current) {
        wsRef.current.send(JSON.stringify({ 
          type: "call-offer", 
          roomId, 
          from: currentUser, 
          to: peerId, 
          payload: newPc.localDescription 
        }))
      }
      
      console.log(`🔥 ✅ FRESH peer connection created for ${peerId} - should resolve m-line ordering`)
    } catch (error) {
      console.error(`🔥 ❌ Error in recreated peer connection offer for ${peerId}:`, error)
    }
  }

  // UNIVERSAL TRACK SYNCHRONIZATION: Ensure all peers have complete media state
  const synchronizeAllMediaTracks = useCallback(async (targetPeer?: string) => {
    console.log('🔄 UNIVERSAL MEDIA SYNC: Starting comprehensive track synchronization...')
    
    const peersToSync = targetPeer ? [targetPeer] : Object.keys(peerConnections.current)
    
    for (const peerId of peersToSync) {
      const pc = peerConnections.current[peerId]
      if (!pc) continue
      
      console.log(`🔄 📡 Synchronizing ALL media tracks for peer: ${peerId}`)
      
      // Get current senders to avoid duplicates
      const existingSenders = pc.getSenders()
      
      // 1. AUDIO SYNCHRONIZATION: Handle microphone and system audio intelligently
      const hasMicrophone = localStreamRef.current && localStreamRef.current.getAudioTracks().length > 0
      const hasSystemAudio = localSystemAudioStreamRef.current && localSystemAudioStreamRef.current.getAudioTracks().length > 0
      
      console.log(`🔄 🎵 Audio sync state for ${peerId}:`, {
        hasMicrophone,
        hasSystemAudio,
        microphoneTracks: localStreamRef.current?.getAudioTracks().length || 0,
        systemAudioTracks: localSystemAudioStreamRef.current?.getAudioTracks().length || 0
      })
      
      if (hasMicrophone && hasSystemAudio) {
        // CRITICAL: Check for existing master mixed track stored as custom property first
        const streamWithMixedTrack = localStreamRef.current as MediaStream & { masterMixedTrack?: MediaStreamTrack }
        const storedMasterMixedTrack = streamWithMixedTrack.masterMixedTrack
        
        // Also check for master mixed track in the actual stream tracks
        const inStreamMasterMixedTrack = localStreamRef.current?.getAudioTracks().find(track => 
          'isMixedAudio' in track && (track as MediaStreamTrack & { isMixedAudio: boolean }).isMixedAudio
        )
        
        const masterMixedTrack = storedMasterMixedTrack || inStreamMasterMixedTrack
        
        if (masterMixedTrack && masterMixedTrack.readyState === 'live') {
          // SMART PROTECTION: Check if the master mixed track is already correctly assigned
          const existingAudioSender = existingSenders.find(sender => 
            sender.track && sender.track.kind === 'audio'
          )
          
          if (existingAudioSender && existingAudioSender.track === masterMixedTrack) {
            console.log(`🔄 🔍 SKIP SYNC: ${peerId} already has correct master mixed track - no action needed`)
            console.log(`🔄 🔍 Track verification:`, {
              label: masterMixedTrack.label,
              id: masterMixedTrack.id,
              enabled: masterMixedTrack.enabled,
              readyState: masterMixedTrack.readyState,
              senderMatches: true
            })
            continue // Skip this peer - already correctly configured
          }
          
          console.log(`🔄 🎵 MASTER MIXED AUDIO: Using existing master mixed track for ${peerId}`)
          console.log(`🔄 🎵 Master track details:`, {
            label: masterMixedTrack.label,
            id: masterMixedTrack.id,
            enabled: masterMixedTrack.enabled,
            readyState: masterMixedTrack.readyState,
            isMixedAudio: 'isMixedAudio' in masterMixedTrack,
            containsSystemAudio: 'containsSystemAudio' in masterMixedTrack,
            source: storedMasterMixedTrack ? 'stored property' : 'in-stream track'
          })
          
          if (existingAudioSender && existingAudioSender.track !== masterMixedTrack) {
            try {
              console.log(`🔄 🔄 REPLACING track for ${peerId}: ${existingAudioSender.track?.label} → ${masterMixedTrack.label}`)
              await existingAudioSender.replaceTrack(masterMixedTrack)
              console.log(`🔄 ✅ ${peerId} audio track SUCCESSFULLY replaced with MASTER mixed audio (mic+system)`)
              
              // VERIFY: Check the replacement actually worked
              const currentTrack = existingAudioSender.track
              const isCorrectTrack = currentTrack === masterMixedTrack
              console.log(`🔄 🔍 Track replacement verification for ${peerId}:`, {
                replacementWorked: isCorrectTrack,
                currentTrackLabel: currentTrack?.label,
                expectedTrackLabel: masterMixedTrack.label,
                currentTrackId: currentTrack?.id,
                expectedTrackId: masterMixedTrack.id
              })
              
              if (!isCorrectTrack) {
                console.error(`🔄 ❌ Track replacement FAILED for ${peerId} - track mismatch detected!`)
              }
            } catch (error) {
              console.error(`🔄 ❌ Failed to replace with master mixed track for ${peerId}:`, error)
              // Fallback: force add the master mixed track
              console.log(`🔄 🔄 FALLBACK: Force adding master mixed track for ${peerId}`)
              try {
                pc.addTrack(masterMixedTrack, localStreamRef.current!)
                console.log(`🔄 ✅ FALLBACK: Master mixed track force-added for ${peerId}`)
              } catch (addError) {
                console.error(`🔄 ❌ FALLBACK FAILED for ${peerId}:`, addError)
              }
            }
          } else if (!existingAudioSender) {
            // Add master mixed track if no existing sender
            pc.addTrack(masterMixedTrack, localStreamRef.current!)
            console.log(`🔄 ✅ ${peerId} master mixed audio track added (no existing sender)`)
          } else {
            // Sender exists and track matches - verify it's actually working
            const currentTrack = existingAudioSender.track
            const isCorrectTrack = currentTrack === masterMixedTrack
            console.log(`🔄 🔍 VERIFICATION: ${peerId} track status:`, {
              senderExists: !!existingAudioSender,
              trackMatches: isCorrectTrack,
              currentTrackLabel: currentTrack?.label,
              expectedTrackLabel: masterMixedTrack.label,
              trackEnabled: currentTrack?.enabled,
              trackState: currentTrack?.readyState
            })
            
            if (isCorrectTrack) {
              console.log(`🔄 ✅ ${peerId} already has the correct master mixed track and it's verified`)
            } else {
              console.warn(`🔄 ⚠️ ${peerId} track verification FAILED - forcing replacement`)
              try {
                await existingAudioSender.replaceTrack(masterMixedTrack)
                console.log(`🔄 ✅ ${peerId} track FORCE-REPLACED during verification`)
              } catch (error) {
                console.error(`🔄 ❌ FORCE-REPLACEMENT failed for ${peerId}:`, error)
              }
            }
          }
          
          // CRITICAL: Skip individual mixed audio creation when we have master mixed track
          console.log(`🔄 📝 SYNC PRESERVATION: Skipping individual mixed audio for ${peerId} - master mixed track active`)
        } else {
          console.log(`🔄 🎵 INDIVIDUAL MIXED AUDIO: Creating combined mic+system audio for late joiner ${peerId}`)
          
          // Get existing audio sender to replace the track
          const existingAudioSender = existingSenders.find(sender => 
            sender.track && sender.track.kind === 'audio'
          )
          
          if (existingAudioSender) {
            // IMPORTANT: Check if we've already created a mixed track for this peer to avoid recreation
            const existingMixedContext = mixedAudioContextsRef.current.get(peerId)
            if (existingMixedContext && existingMixedContext.state !== 'closed') {
              console.log(`🔄 ⏭️ Skipping mixed audio creation for ${peerId} - already exists`)
              return // Skip creating new mixed track
            }
            // Create mixed audio track for late joiner
            try {
              const audioContext = new AudioContext({
                sampleRate: 48000,
                latencyHint: 'interactive'
              })
              
              if (audioContext.state === 'suspended') {
                await audioContext.resume()
              }
              
              const mixedOutput = audioContext.createGain()
              
              // Create sources for both audio streams
              const microphoneSource = audioContext.createMediaStreamSource(localStreamRef.current!)
              const systemSource = audioContext.createMediaStreamSource(localSystemAudioStreamRef.current!)
              
              // Set balanced gain levels
              const micGain = audioContext.createGain()
              const systemGain = audioContext.createGain()
              micGain.gain.setValueAtTime(0.7, audioContext.currentTime) // 70% microphone
              systemGain.gain.setValueAtTime(0.8, audioContext.currentTime) // 80% system audio
              
              // Connect sources through gain nodes to the output
              microphoneSource.connect(micGain)
              systemSource.connect(systemGain)
              micGain.connect(mixedOutput)
              systemGain.connect(mixedOutput)
              
              // Create destination and get mixed stream
              const destination = audioContext.createMediaStreamDestination()
              mixedOutput.connect(destination)
              
              const mixedTrack = destination.stream.getAudioTracks()[0]
              if (mixedTrack) {
                // Mark the mixed track
                Object.defineProperty(mixedTrack, 'label', {
                  value: 'Mixed Audio (Microphone + System) - Late Joiner Sync',
                  writable: false
                })
                
                Object.defineProperty(mixedTrack, 'isMixedAudio', {
                  value: true,
                  writable: false
                })
                
                // Replace existing audio track with mixed one
                await existingAudioSender.replaceTrack(mixedTrack)
                console.log(`🔄 ✅ Late joiner ${peerId} audio track replaced with INDIVIDUAL mixed audio (mic+system)`)
                
                // Store audio context for cleanup
                mixedAudioContextsRef.current.set(peerId, audioContext)
              } else {
                console.warn(`🔄 ❌ Failed to create mixed audio track for late joiner ${peerId}`)
                await audioContext.close()
              }
            } catch (error) {
              console.error(`🔄 ❌ Failed to create mixed audio for late joiner ${peerId}:`, error)
              // Fallback: add tracks separately
              if (localStreamRef.current) {
                const audioTracks = localStreamRef.current.getAudioTracks()
                for (const track of audioTracks) {
                  const existingSender = existingSenders.find(s => s.track?.id === track.id)
                  if (!existingSender) {
                    pc.addTrack(track, localStreamRef.current!)
                    console.log(`🔄 🎤 Added MICROPHONE track (fallback) for ${peerId}:`, track.label)
                  }
                }
              }
            }
          } else {
            // No existing audio sender, add microphone first, then system audio
            if (localStreamRef.current) {
              const audioTracks = localStreamRef.current.getAudioTracks()
              for (const track of audioTracks) {
                const existingSender = existingSenders.find(s => s.track?.id === track.id)
                if (!existingSender) {
                  pc.addTrack(track, localStreamRef.current!)
                  console.log(`🔄 🎤 Added MICROPHONE track for ${peerId}:`, track.label)
                }
              }
            }
            
            // Add system audio as well
            if (localSystemAudioStreamRef.current) {
              const systemAudioTracks = localSystemAudioStreamRef.current.getAudioTracks()
              for (const track of systemAudioTracks) {
                const existingSender = existingSenders.find(s => s.track?.id === track.id)
                if (!existingSender) {
                  pc.addTrack(track, localSystemAudioStreamRef.current!)
                  console.log(`🔄 🔊 Added SYSTEM AUDIO track for ${peerId}:`, track.label)
                }
              }
            }
          }
        }
      } else if (hasMicrophone) {
        // Only microphone audio - add normally
        const audioTracks = localStreamRef.current!.getAudioTracks()
        for (const track of audioTracks) {
          const existingSender = existingSenders.find(s => s.track?.id === track.id)
          if (!existingSender) {
            pc.addTrack(track, localStreamRef.current!)
            console.log(`🔄 🎤 Added MICROPHONE-ONLY track for ${peerId}:`, track.label)
          }
        }
      } else if (hasSystemAudio) {
        // Only system audio - add normally  
        const systemAudioTracks = localSystemAudioStreamRef.current!.getAudioTracks()
        for (const track of systemAudioTracks) {
          const existingSender = existingSenders.find(s => s.track?.id === track.id)
          if (!existingSender) {
            pc.addTrack(track, localSystemAudioStreamRef.current!)
            console.log(`🔄 🔊 Added SYSTEM-AUDIO-ONLY track for ${peerId}:`, track.label)
          }
        }
      }
      
      // 2. VIDEO SYNCHRONIZATION: Ensure camera video if enabled
      if (localVideoStreamRef.current && videoEnabled) {
        const videoTracks = localVideoStreamRef.current.getVideoTracks()
        for (const track of videoTracks) {
          // Skip arbitrary video tracks when video is disabled
          if ('isArbitraryTrack' in track && !videoEnabled) continue
          
          const existingSender = existingSenders.find(s => s.track?.id === track.id)
          if (!existingSender) {
            pc.addTrack(track, localVideoStreamRef.current!)
            console.log(`🔄 📹 Added VIDEO track for ${peerId}:`, track.label)
          }
        }
      }
      
      // 3. SCREEN SHARE SYNCHRONIZATION: Ensure screen sharing if active
      if (localScreenStreamRef.current && screenSharing) {
        const screenTracks = localScreenStreamRef.current.getVideoTracks()
        for (const track of screenTracks) {
          const existingSender = existingSenders.find(s => s.track?.id === track.id)
          if (!existingSender) {
            pc.addTrack(track, localScreenStreamRef.current!)
            console.log(`🔄 📺 Added SCREEN SHARE track for ${peerId}:`, track.label)
          }
        }
        
        // Screen audio tracks - NOTE: These are already handled in the mixed audio logic above
        // when both microphone and system audio are present. Only add separately if no microphone.
        if (!hasMicrophone) {
          const screenAudioTracks = localScreenStreamRef.current.getAudioTracks()
          for (const track of screenAudioTracks) {
            const existingSender = existingSenders.find(s => s.track?.id === track.id)
            if (!existingSender) {
              pc.addTrack(track, localScreenStreamRef.current!)
              console.log(`🔄 🔊 Added SCREEN AUDIO track for ${peerId}:`, track.label)
            }
          }
        } else {
          console.log(`🔄 📝 Skipping separate screen audio tracks for ${peerId} - already included in mixed audio`)
        }
      }
      
      console.log(`🔄 ✅ ENHANCED Media synchronization complete for ${peerId} - Total senders: ${pc.getSenders().length}`)
      console.log(`🔄 � Final sync summary for ${peerId}:`, {
        audioHandling: hasMicrophone && hasSystemAudio ? 'MIXED' : hasMicrophone ? 'MIC_ONLY' : hasSystemAudio ? 'SYSTEM_ONLY' : 'NONE',
        videoEnabled,
        screenSharing,
        totalSenders: pc.getSenders().length
      })
      
      // Trigger renegotiation after synchronization
      try {
        if (pc.signalingState === 'stable') {
          const offer = await pc.createOffer()
          await pc.setLocalDescription(offer)
          if (wsRef.current) {
            wsRef.current.send(JSON.stringify({ 
              type: "call-offer", 
              roomId, 
              from: currentUser, 
              to: peerId, 
              payload: pc.localDescription 
            }))
          }
          console.log(`🔄 ✅ Renegotiation offer sent to ${peerId} after synchronization`)
        }
      } catch (error) {
        console.error(`🔄 ❌ Failed to renegotiate with ${peerId} after synchronization:`, error)
      }
    }
  }, [videoEnabled, screenSharing, roomId, currentUser])

  // SELECTIVE SYNC: Only sync non-audio tracks to avoid interfering with working mixed audio
  const synchronizeNonAudioTracks = useCallback(async (targetPeer: string) => {
    console.log(`🔄 🎵 NON-AUDIO SYNC: Starting selective track synchronization for ${targetPeer} (audio preserved)`)
    
    const pc = peerConnections.current[targetPeer]
    if (!pc) return
    
    // Get current senders to avoid duplicates
    const existingSenders = pc.getSenders()
    
    // 1. VIDEO SYNCHRONIZATION: Ensure camera video if enabled
    if (localVideoStreamRef.current && videoEnabled) {
      const videoTracks = localVideoStreamRef.current.getVideoTracks()
      for (const track of videoTracks) {
        const alreadyHasTrack = existingSenders.some(sender => sender.track === track)
        if (!alreadyHasTrack) {
          pc.addTrack(track, localVideoStreamRef.current)
          console.log(`🔄 📹 Added missing video track for ${targetPeer}: ${track.label}`)
        }
      }
    }
    
    // 2. SCREEN SHARE SYNCHRONIZATION: Ensure screen sharing if active
    if (localScreenStreamRef.current && screenSharing) {
      const screenTracks = localScreenStreamRef.current.getVideoTracks()
      for (const track of screenTracks) {
        const alreadyHasTrack = existingSenders.some(sender => sender.track === track)
        if (!alreadyHasTrack) {
          pc.addTrack(track, localScreenStreamRef.current)
          console.log(`🔄 🖥️ Added missing screen share track for ${targetPeer}: ${track.label}`)
        }
      }
      
      // IMPORTANT: Do NOT add screen audio tracks - those are handled by mixed audio
      console.log(`🔄 🎵 Skipping screen audio tracks for ${targetPeer} - already handled by working mixed audio`)
    }
    
    console.log(`🔄 ✅ NON-AUDIO synchronization complete for ${targetPeer} - audio preserved, other tracks synced`)
    
    // Trigger renegotiation after synchronization
    try {
      if (pc.signalingState === 'stable') {
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        
        if (wsRef.current) {
          wsRef.current.send(JSON.stringify({
            type: "call-offer",
            roomId,
            from: currentUser,
            to: targetPeer,
            payload: pc.localDescription
          }))
        }
        console.log(`🔄 ✅ Renegotiation offer sent to ${targetPeer} after non-audio sync`)
      }
    } catch (error) {
      console.error(`🔄 ❌ Failed to renegotiate with ${targetPeer} after non-audio sync:`, error)
    }
  }, [videoEnabled, screenSharing, roomId, currentUser])

  const createPeerConnection = useCallback((remote: string) => {
    const pc = new RTCPeerConnection(ICE_CONFIG)
    peerConnections.current[remote] = pc
    
    // Simplified connection monitoring for better performance
    setConnectionHealth(prev => ({ ...prev, [remote]: 'connecting' }))
    
    // Set up connection timeout
    const timeout = setTimeout(() => {
      if (pc.connectionState !== 'connected') {
        setConnectionHealth(prev => ({ ...prev, [remote]: 'failed' }))
      }
    }, 30000)
    
    connectionTimeouts.current[remote] = timeout
    
    // Minimal connection state monitoring
    pc.onconnectionstatechange = () => {
      switch (pc.connectionState) {
        case 'connected':
          setConnectionHealth(prev => ({ ...prev, [remote]: 'connected' }))
          if (connectionTimeouts.current[remote]) {
            clearTimeout(connectionTimeouts.current[remote])
            delete connectionTimeouts.current[remote]
          }
          break
        case 'failed':
          setConnectionHealth(prev => ({ ...prev, [remote]: 'failed' }))
          break
        case 'disconnected':
          setConnectionHealth(prev => ({ ...prev, [remote]: 'disconnected' }))
          break
        case 'connecting':
        case 'new':
          setConnectionHealth(prev => ({ ...prev, [remote]: 'connecting' }))
          break
      }
    }
    
    pc.onicecandidate = (e) => {
      if (e.candidate && wsRef.current) {
        wsRef.current.send(JSON.stringify({ type: "call-ice", roomId, from: currentUser, to: remote, payload: e.candidate }))
      }
    }
    
    pc.ontrack = (e) => {
      const track = e.track
      const stream = e.streams[0]
      
      console.log(`📡 Received track from ${remote}:`, {
        kind: track.kind,
        label: track.label,
        id: track.id,
        enabled: track.enabled,
        readyState: track.readyState
      })
      
      if (track.kind === 'audio') {
        // Check if this is a mixed audio track
        const isMixedAudio = track.label.toLowerCase().includes('mixed audio') ||
                           track.label.toLowerCase().includes('microphone + system') ||
                           ('isMixedAudio' in track && (track as MediaStreamTrack & { isMixedAudio: boolean }).isMixedAudio)
        
        // Check if this is system audio
        const isSystemAudio = track.label.toLowerCase().includes('system audio') ||
                             track.label.toLowerCase().includes('screen') ||
                             ('isSystemAudio' in track && (track as MediaStreamTrack & { isSystemAudio: boolean }).isSystemAudio)
        
        console.log(`🎵 Audio track analysis for ${remote}:`, {
          trackLabel: track.label,
          isMixedAudio: isMixedAudio,
          isSystemAudio: isSystemAudio
        })
        
        if (isMixedAudio) {
          console.log(`🎵 ✅ Received mixed audio (mic + system) from ${remote}`)
          // Mixed audio contains both microphone and system audio
          setRemoteStreams(prev => ({ ...prev, [remote]: stream }))
          // Also set as system audio for compatibility with UI that expects separate system audio
          setRemoteSystemAudioStreams(prev => ({ ...prev, [remote]: stream }))
        } else if (isSystemAudio) {
          console.log(`🔊 ✅ Received system audio from ${remote}`)
          setRemoteSystemAudioStreams(prev => ({ ...prev, [remote]: stream }))
        } else {
          console.log(`🎤 ✅ Received microphone audio from ${remote}`)
          setRemoteStreams(prev => ({ ...prev, [remote]: stream }))
        }
      } else if (track.kind === 'video') {
        // Check track label to determine if it's screen share
        const isScreenShare = track.label.toLowerCase().includes('screen') || 
                             track.label.toLowerCase().includes('monitor') ||
                             track.label.toLowerCase().includes('display') ||
                             track.getSettings().displaySurface === 'monitor'
        
        if (isScreenShare) {
          console.log(`🖥️ ✅ Received screen share from ${remote}:`, {
            label: track.label,
            settings: track.getSettings()
          })
          setRemoteScreenStreams(prev => ({ ...prev, [remote]: stream }))
        } else {
          console.log(`📹 ✅ Received camera video from ${remote}`)
          setRemoteVideoStreams(prev => ({ ...prev, [remote]: stream }))
        }
      }
    }
    
    // --- ENHANCED: Always add local tracks to new peer connection with robust arbitrary track foundation ---
    // CRITICAL: Add tracks in STRICT CONSISTENT ORDER to avoid m-line ordering issues
    console.log(`🔗 Creating ROBUST peer connection for ${remote}. Adding tracks in strict order:`)
    
    // STRICT ORDER: Always maintain the same track order across all negotiations
    // Order: 1) Audio (mic), 2) System Audio, 3) Video (camera), 4) Screen Share
    
    // 1. FOUNDATION: Always ensure we have persistent arbitrary tracks for WebRTC foundation
    const currentAudioTracks = localStreamRef.current?.getAudioTracks() || []
    const hasRealAudio = currentAudioTracks.some(track => !('isArbitraryTrack' in track))
    
    if (!hasRealAudio) {
      console.log(`🔗 📦 No real audio detected, ensuring arbitrary audio foundation exists for ${remote}`)
      if (!localStreamRef.current || currentAudioTracks.length === 0) {
        console.log(`🔗 🔧 Creating new arbitrary audio foundation for peer connection`)
        const arbitraryAudioStream = createArbitraryAudioTrack()
        localStreamRef.current = arbitraryAudioStream
        
        // Update local audio element
        if (localAudioRef.current) {
          localAudioRef.current.srcObject = arbitraryAudioStream
        }
      }
    }
    
    const currentVideoTracks = localVideoStreamRef.current?.getVideoTracks() || []
    const hasRealVideo = currentVideoTracks.some(track => !('isArbitraryTrack' in track))
    
    if (!hasRealVideo && (!localVideoStreamRef.current || currentVideoTracks.length === 0)) {
      console.log(`🔗 🔧 Creating persistent arbitrary video foundation for ${remote}`)
      const arbitraryVideoStream = createArbitraryVideoTrack()
      localVideoStreamRef.current = arbitraryVideoStream
      
      // Update local video element if not already set
      if (localVideoRef.current && !localVideoRef.current.srcObject) {
        localVideoRef.current.srcObject = arbitraryVideoStream
      }
    }
    
    // STRICT ORDER IMPLEMENTATION: Add tracks in exact order to maintain m-line consistency
    
    // CRITICAL DEBUGGING: Log current state before track addition
    console.log(`🔗 🔍 COMPREHENSIVE STATE CHECK for ${remote}:`, {
      screenSharing,
      hasLocalSystemAudio: !!localSystemAudioStreamRef.current,
      localStreamExists: !!localStreamRef.current,
      audioTracksCount: localStreamRef.current?.getAudioTracks().length || 0,
      videoEnabled,
      videoTracksCount: localVideoStreamRef.current?.getVideoTracks().length || 0,
      screenTracksCount: localScreenStreamRef.current?.getVideoTracks().length || 0,
      systemAudioTracksCount: localSystemAudioStreamRef.current?.getAudioTracks().length || 0
    })
    
    // 1. FIRST: Add SINGLE audio track (real, arbitrary, or mixed) - ALWAYS position 0
    if (localStreamRef.current) {
      const audioTracks = localStreamRef.current.getAudioTracks()
      
      // CRITICAL: Check for stored master mixed track for late joiners during screen sharing
      const streamWithMixedTrack = localStreamRef.current as MediaStream & { masterMixedTrack?: MediaStreamTrack }
      const storedMasterMixedTrack = streamWithMixedTrack.masterMixedTrack
      
      // Also check for master mixed track in the actual stream tracks
      const inStreamMasterMixedTrack = audioTracks.find(track => 
        'isMixedAudio' in track && (track as MediaStreamTrack & { isMixedAudio: boolean }).isMixedAudio
      )
      
      const masterMixedTrack = storedMasterMixedTrack || inStreamMasterMixedTrack
      
      // DEBUGGING: Log master mixed track detection
      console.log(`🔗 🔍 Master mixed track detection for ${remote}:`, {
        screenSharing,
        hasSystemAudio: !!localSystemAudioStreamRef.current,
        storedMasterMixedTrack: !!storedMasterMixedTrack,
        storedTrackState: storedMasterMixedTrack?.readyState,
        storedTrackLabel: storedMasterMixedTrack?.label,
        inStreamMasterMixedTrack: !!inStreamMasterMixedTrack,
        inStreamTrackState: inStreamMasterMixedTrack?.readyState,
        inStreamTrackLabel: inStreamMasterMixedTrack?.label,
        finalMasterMixedTrack: !!masterMixedTrack,
        finalTrackState: masterMixedTrack?.readyState,
        finalTrackLabel: masterMixedTrack?.label,
        audioTracksCount: audioTracks.length,
        audioTrackLabels: audioTracks.map(t => t.label),
        conditionsMet: !!(masterMixedTrack && masterMixedTrack.readyState === 'live' && screenSharing && localSystemAudioStreamRef.current)
      })
      
      // ENHANCED: Use master mixed track if we're screen sharing with system audio
      if (masterMixedTrack && masterMixedTrack.readyState === 'live' && screenSharing && localSystemAudioStreamRef.current) {
        // Use the master mixed track for late joiners during screen sharing with system audio
        if (!pc.getSenders().some(sender => sender.track === masterMixedTrack)) {
          pc.addTrack(masterMixedTrack, localStreamRef.current)
          console.log(`🔗 ✅ [POS 0] Added master mixed audio track for late joiner ${remote}: ${masterMixedTrack.label}, enabled: ${masterMixedTrack.enabled}`)
          console.log(`🔗 🎵 Late joiner ${remote} will receive BOTH microphone and system audio in single mixed track`)
        }
      } else if (audioTracks.length > 0) {
        const audioTrack = audioTracks[0] // Use only first audio track to maintain order
        if (!pc.getSenders().some(sender => sender.track === audioTrack)) {
          pc.addTrack(audioTrack, localStreamRef.current)
          const isArbitrary = 'isArbitraryTrack' in audioTrack
          const isMixed = audioTrack.label.toLowerCase().includes('mixed')
          console.log(`🔗 ✅ [POS 0] Added ${isArbitrary ? 'arbitrary' : isMixed ? 'mixed' : 'real'} audio track: ${audioTrack.label}, enabled: ${audioTrack.enabled}`)
          
          // IMPORTANT: If we're screen sharing with system audio but no master mixed track,
          // we should warn that this late joiner won't get the optimal experience
          if (screenSharing && localSystemAudioStreamRef.current && !isMixed) {
            console.warn(`🔗 ⚠️ Late joiner ${remote} is getting separate microphone track - system audio will be added separately (not optimal)`)
          }
        }
      }
    }
    
    // 2. SECOND: Add video tracks (real or arbitrary) - ALWAYS position 1
    if (localVideoStreamRef.current && videoEnabled) {
      const videoTracks = localVideoStreamRef.current.getVideoTracks()
      if (videoTracks.length > 0) {
        const videoTrack = videoTracks[0] // Use only first video track to maintain order
        if (!pc.getSenders().some(sender => sender.track === videoTrack)) {
          pc.addTrack(videoTrack, localVideoStreamRef.current)
          const isArbitrary = 'isArbitraryTrack' in videoTrack
          console.log(`🔗 ✅ [POS 1] Added ${isArbitrary ? 'arbitrary' : 'real'} video track: ${videoTrack.label}`)
        }
      }
    }
    
    // 3. THIRD: Add screen share tracks (if available) - ALWAYS position 2
    if (localScreenStreamRef.current && screenSharing) {
      const screenTracks = localScreenStreamRef.current.getVideoTracks()
      if (screenTracks.length > 0) {
        const screenTrack = screenTracks[0] // Use only first screen track
        if (!pc.getSenders().some(sender => sender.track === screenTrack)) {
          pc.addTrack(screenTrack, localScreenStreamRef.current)
          console.log(`🔗 ✅ [POS 2] Added screen share track: ${screenTrack.label}`)
        }
      }
      
      // Also add any audio tracks from screen sharing
      const screenAudioTracks = localScreenStreamRef.current.getAudioTracks()
      screenAudioTracks.forEach(track => {
        if (!pc.getSenders().some(sender => sender.track === track)) {
          pc.addTrack(track, localScreenStreamRef.current!)
          console.log(`🔗 ✅ [POS 2+] Added screen audio track: ${track.label}`)
        }
      })
    }
    
    // 4. FOURTH: Add system audio tracks (if available) - ALWAYS position 3+
    // BUT ONLY if we don't already have a master mixed track that contains system audio
    if (localSystemAudioStreamRef.current) {
      // Check if we already have a master mixed track that contains system audio
      const streamWithMixedTrack = localStreamRef.current as MediaStream & { masterMixedTrack?: MediaStreamTrack }
      const storedMasterMixedTrack = streamWithMixedTrack.masterMixedTrack
      const inStreamMasterMixedTrack = localStreamRef.current?.getAudioTracks().find(track => 
        'isMixedAudio' in track && 
        'containsSystemAudio' in track &&
        (track as MediaStreamTrack & { isMixedAudio: boolean; containsSystemAudio: boolean }).isMixedAudio &&
        (track as MediaStreamTrack & { isMixedAudio: boolean; containsSystemAudio: boolean }).containsSystemAudio
      )
      
      const hasMasterMixedTrack = (storedMasterMixedTrack && storedMasterMixedTrack.readyState === 'live') || inStreamMasterMixedTrack
      
      // ENHANCED: Also check if we already added a master mixed track in step 1
      const alreadyAddedMasterMixed = pc.getSenders().some(sender => 
        sender.track && 
        'isMixedAudio' in sender.track && 
        (sender.track as MediaStreamTrack & { isMixedAudio: boolean }).isMixedAudio
      )
      
      console.log(`🔗 🔍 System audio decision for ${remote}:`, {
        hasMasterMixedTrack: !!hasMasterMixedTrack,
        alreadyAddedMasterMixed,
        systemAudioTracksCount: localSystemAudioStreamRef.current.getAudioTracks().length,
        willSkip: !!(hasMasterMixedTrack || alreadyAddedMasterMixed)
      })
      
      if (hasMasterMixedTrack || alreadyAddedMasterMixed) {
        console.log(`🔗 📝 Skipping separate system audio tracks for ${remote} - already included in master mixed track`)
      } else {
        const systemAudioTracks = localSystemAudioStreamRef.current.getAudioTracks()
        systemAudioTracks.forEach(track => {
          if (!pc.getSenders().some(sender => sender.track === track)) {
            pc.addTrack(track, localSystemAudioStreamRef.current!)
            console.log(`🔗 ✅ [POS 3+] Added system audio track: ${track.label}`)
          }
        })
      }
    }
    
    // FINAL DEBUGGING: Log final track order for debugging m-line issues
    const finalSenders = pc.getSenders()
    console.log(`🔗 🔍 FINAL TRACK ORDER for ${remote}:`, {
      totalSenders: finalSenders.length,
      trackOrder: finalSenders.map((sender, index) => ({
        position: index,
        kind: sender.track?.kind,
        label: sender.track?.label,
        enabled: sender.track?.enabled,
        id: sender.track?.id
      }))
    })
    
    console.log(`🔗 ✅ ULTRA-ROBUST peer connection for ${remote} created with ${pc.getSenders().length} senders in strict order`)
    console.log(`🔗 📊 Complete media state for ${remote}:`, {
      audioTracks: localStreamRef.current?.getAudioTracks().length || 0,
      videoTracks: (localVideoStreamRef.current?.getVideoTracks().length || 0) * (videoEnabled ? 1 : 0),
      screenTracks: (localScreenStreamRef.current?.getVideoTracks().length || 0) * (screenSharing ? 1 : 0),
      screenAudioTracks: (localScreenStreamRef.current?.getAudioTracks().length || 0) * (screenSharing ? 1 : 0),
      systemAudioTracks: localSystemAudioStreamRef.current?.getAudioTracks().length || 0,
      totalSenders: pc.getSenders().length
    })
    
    return pc
  }, [roomId, currentUser, screenSharing, videoEnabled]) // Dependencies for useCallback

// Join call room with OPTIMIZED CONNECTION PROTOCOL
  const joinCall = async () => {
    setConnecting(true)
    setConnectionSequenceProgress(0)
    setError("")
    console.log('🚀 Starting optimized connection...')
    
    // STEP 1: Create foundation tracks efficiently
    setConnectionSequenceProgress(20)
    
    // Create arbitrary foundation ONLY if needed
    let foundationAudioStream: MediaStream
    try {
      // Try to get real microphone first (much faster than creating arbitrary track)
      foundationAudioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      localStreamRef.current = foundationAudioStream
      setMuted(false)
      console.log('🚀 ✅ Real microphone acquired immediately')
    } catch {
      // Fallback to arbitrary audio only if microphone fails
      foundationAudioStream = createArbitraryAudioTrack()
      localStreamRef.current = foundationAudioStream
      setMuted(true)
      setError("Microphone access denied. You can still hear others. Click unmute to grant permission.")
      console.log('🚀 📦 Using arbitrary audio fallback')
    }
    
    if (localAudioRef.current) {
      localAudioRef.current.srcObject = foundationAudioStream
    }
    
    // Create minimal arbitrary video foundation (no animation during startup)
    const arbitraryVideoStream = createArbitraryVideoTrack()
    localVideoStreamRef.current = arbitraryVideoStream
    
    // Always start with video disabled for faster startup
    setVideoEnabled(false)
    setConnectionSequenceProgress(60)
    
    // Mark connection sequence as complete immediately
    setConnectionSequenceComplete(true)
    
    // Always join as a normal participant (never as listener)
    setActualIsListener(false)
    setConnectionSequenceProgress(80)
    
    // Connect to signaling immediately after foundation is ready
    const ws = new WebSocket(SIGNALING_SERVER_URL)
    wsRef.current = ws
    
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "call-join", roomId, username: currentUser, isListener: false }))
      setJoined(true)
      setConnecting(false)
      setConnectionSequenceProgress(100)
      console.log('🚀 ✅ Connected successfully!')
    }
    ws.onmessage = async (event) => {
      const msg = JSON.parse(event.data)
      switch (msg.type) {        case "call-new-peer": {
          const newPeer = msg.username
          if (newPeer === currentUser) return
          
          // Add to participants list
          setParticipants(prev => new Set([...prev, newPeer]))
          
          let pc = peerConnections.current[newPeer]
          if (!pc) {
            // Create peer connection with current tracks
            pc = createPeerConnection(newPeer)
          }
          
          // Simplified sync for better startup performance
          // Only run full sync if we have complex media state
          const hasComplexMedia = screenSharing || (localSystemAudioStreamRef.current && localStreamRef.current)
          
          if (hasComplexMedia) {
            // Only sync complex media if needed
            setTimeout(async () => {
              try {
                await synchronizeAllMediaTracks(newPeer)
              } catch (error) {
                console.error(`Failed to synchronize media for ${newPeer}:`, error)
              }
            }, 100) // Reduced delay for faster startup
          }
          
          // Perfect negotiation with GUARANTEED connection establishment
          const isImpolite = currentUser > newPeer
          const shouldCreateOffer = !actualIsListener && isImpolite
          
          if (shouldCreateOffer) {
            console.log(`🔗 ${currentUser} is IMPOLITE - will create offer for ${newPeer}`)
            // Add a small delay to let the polite peer potentially start negotiation first
            setTimeout(async () => {
              // Check if negotiation hasn't started yet
              if (pc && pc.signalingState === 'stable') {
                try {
                  console.log(`🔗 ✅ Creating ROBUST offer for new peer ${newPeer} with ${pc.getSenders().length} senders`)
                  const offer = await pc.createOffer()
                  await pc.setLocalDescription(offer)
                  ws.send(JSON.stringify({ type: "call-offer", roomId, from: currentUser, to: newPeer, payload: pc.localDescription }))
                } catch (error) {
                  console.error(`🔗 ❌ Error creating offer for new peer ${newPeer}:`, error)
                }
              }
            }, 100) // Small delay to prevent race conditions
          } else {
            console.log(`🔗 ${currentUser} is POLITE - waiting for offer from ${newPeer}`)
            // If we're the polite peer but no offer comes, create one anyway after a longer delay
            setTimeout(async () => {
              if (pc && pc.signalingState === 'stable') {
                try {
                  console.log(`🔗 🔄 Polite peer ${currentUser} creating BACKUP offer for ${newPeer} to ensure connection`)
                  const offer = await pc.createOffer()
                  await pc.setLocalDescription(offer)
                  ws.send(JSON.stringify({ type: "call-offer", roomId, from: currentUser, to: newPeer, payload: pc.localDescription }))
                } catch (error) {
                  console.error('Error creating backup offer:', error)
                }
              }
            }, 500) // Longer delay for backup offer
          }
          break
        }case "call-offer": {
          const from = msg.from
          let pc = peerConnections.current[from]
          if (!pc) {
            pc = createPeerConnection(from)
          }
          
          // Perfect negotiation: determine politeness based on username comparison
          const isPolite = currentUser < from // Lexicographically smaller username is polite
          
          // Use safeSetRemoteDescription with politeness info
          const result = await safeSetRemoteDescription(pc, msg.payload, isPolite)
          if (result === 'recreate') {
            // Recreate the peer connection and try again
            await recreatePeerConnection(from)
            pc = peerConnections.current[from]
            if (pc) {
              await safeSetRemoteDescription(pc, msg.payload, isPolite)
            }
          } else if (result === 'ignored') {
            // Offer was ignored due to collision, don't create answer
            console.log(`Offer from ${from} was ignored due to collision`)
            break
          }
          
          // Only proceed if we have a valid peer connection and didn't ignore
          if (pc && pc.signalingState !== 'closed' && result === 'success') {
            try {
              const answer = await pc.createAnswer()
              await pc.setLocalDescription(answer)
              ws.send(JSON.stringify({ type: "call-answer", roomId, from: currentUser, to: from, payload: pc.localDescription }))
            } catch (error) {
              console.error('Error creating answer:', error)
            }
          }
          break
        }        case "call-answer": {
          const from = msg.from
          const pc = peerConnections.current[from]
          if (pc) {
            // Check if we're in the right state to accept an answer
            if (pc.signalingState === 'have-local-offer') {
              // Use safeSetRemoteDescription to avoid InvalidStateError
              const result = await safeSetRemoteDescription(pc, msg.payload, false)
              if (result === 'recreate') {
                // For answers, we usually don't recreate but log the issue
                console.log(`Answer processing failed for ${from}, may need full renegotiation`)
              } else if (result === 'ignored') {
                console.log(`Answer from ${from} was ignored (stale or wrong state)`)
              }
            } else {
              console.log(`Received answer from ${from} in wrong state: ${pc.signalingState}`)
            }
          }
          break
        }
        case "call-ice": {
          const from = msg.from
          const pc = peerConnections.current[from]
          if (pc && msg.payload) {
            try { await pc.addIceCandidate(new RTCIceCandidate(msg.payload)) } catch {}
          }
          break
        }        case "call-peer-left": {
          const left = msg.username
          
          // Remove from participants list
          setParticipants(prev => {
            const newSet = new Set(prev)
            newSet.delete(left)
            return newSet
          })
          
          if (peerConnections.current[left]) {
            peerConnections.current[left].close()
            delete peerConnections.current[left]
          }
          
          // Clean up mixed audio context for this peer
          const audioContext = mixedAudioContextsRef.current.get(left)
          if (audioContext) {
            console.log(`🎵 Closing mixed audio context for departed peer ${left}`)
            audioContext.close().catch(console.warn)
            mixedAudioContextsRef.current.delete(left)
          }
          
          setRemoteStreams(prev => {
            const copy = { ...prev }
            delete copy[left]
            return copy
          })
          setRemoteVideoStreams(prev => {
            const copy = { ...prev }
            delete copy[left]
            return copy
          })
          setRemoteScreenStreams(prev => {
            const copy = { ...prev }
            delete copy[left]
            return copy
          })
          setRemoteSystemAudioStreams(prev => {
            const copy = { ...prev }
            delete copy[left]
            return copy
          })
            // Reset expanded participant if they left
          setExpandedParticipants(prev => {
            const newSet = new Set(prev)
            newSet.delete(left)
            return newSet
          })
          
          break
        }
        case "error": {
          const errorMessage = msg.message || msg.error || "An unknown error occurred"
          console.error('Call WebSocket error:', errorMessage, msg)
          setError(errorMessage)
          
          // If the error has redirect information, redirect to the room
          if (msg.redirectTo) {
            console.log('Redirecting to room due to error:', msg.redirectTo)
            router.push(msg.redirectTo)
          }
          
          break
        }
      }
    }
    ws.onclose = () => {
      console.log('WebSocket connection closed')
      setJoined(false)
    }
    ws.onerror = (error) => {
      console.error('WebSocket connection error:', error)
      setError("Connection error. Please check your internet connection and try again.")
    }
  }  // Leave call room
  const leaveCall = () => {
    console.log('🚪 Leaving call - starting comprehensive cleanup...')
    
    // FIRST: Reset joined state to stop health monitor immediately
    setJoined(false)
    
    // Send leave message to server BEFORE closing WebSocket
    if (wsRef.current && currentUser) {
      try {
        wsRef.current.send(JSON.stringify({ type: "call-peer-left", roomId, username: currentUser }))
        console.log('🚪 Sent leave message to server')
      } catch (error) {
        console.warn('🚪 Failed to send leave message:', error)
      }
    }
    
    // Close WebSocket connection IMMEDIATELY to stop reconnection attempts
    if (wsRef.current) {
      wsRef.current.onclose = null // Remove onclose handler to prevent unexpected behavior
      wsRef.current.onerror = null // Remove error handler
      wsRef.current.onmessage = null // Remove message handler
      wsRef.current.close()
      wsRef.current = null
      console.log('🚪 WebSocket connection closed and cleaned up')
    }
    
    // Close all peer connections
    Object.values(peerConnections.current).forEach(pc => {
      pc.onconnectionstatechange = null // Remove event handlers
      pc.oniceconnectionstatechange = null
      pc.onicegatheringstatechange = null
      pc.onicecandidate = null
      pc.ontrack = null
      pc.close()
    })
    peerConnections.current = {}
    console.log('🚪 All peer connections closed and cleaned up')
    
    // Clean up connection timeouts and health monitoring
    Object.values(connectionTimeouts.current).forEach(timeout => clearTimeout(timeout))
    connectionTimeouts.current = {}
    setConnectionHealth({})
    console.log('🚪 Connection timeouts and health monitoring cleared')
    
    // Stop local stream tracks
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop())
      localStreamRef.current = null
    }
    
    // Stop video stream tracks
    if (localVideoStreamRef.current) {
      localVideoStreamRef.current.getTracks().forEach(track => track.stop())
      localVideoStreamRef.current = null
    }
    
    // Stop screen stream tracks
    if (localScreenStreamRef.current) {
      localScreenStreamRef.current.getTracks().forEach(track => track.stop())
      localScreenStreamRef.current = null
    }
    
    // Stop system audio stream tracks
    if (localSystemAudioStreamRef.current) {
      localSystemAudioStreamRef.current.getTracks().forEach(track => track.stop())
      localSystemAudioStreamRef.current = null
    }
    
    // Clean up mixed audio contexts
    mixedAudioContextsRef.current.forEach((audioContext, peerId) => {
      console.log(`🎵 Closing mixed audio context for ${peerId}`)
      audioContext.close().catch(console.warn)
    })
    mixedAudioContextsRef.current.clear()
    
    // Clean up local audio context if it exists
    if (localAudioContextRef.current) {
      localAudioContextRef.current.close().catch(console.warn)
      localAudioContextRef.current = null
    }
    
    // Reset state
    setConnectionSequenceComplete(false)
    setConnectionSequenceProgress(0)
    setRemoteStreams({})
    setRemoteVideoStreams({})
    setRemoteScreenStreams({})
    setRemoteSystemAudioStreams({})
    setParticipants(new Set()) // Clear participants list
    setVideoEnabled(false)    
    setScreenSharing(false)
    setExpandedParticipants(new Set()) // Clear all expanded participants
    setLocalPreviewExpanded(false) // Collapse local preview
    setError("")
    
    console.log('🚪 ✅ Call cleanup completed - navigating to chat')
    
    // Navigate back to chat
    router.push(`/${encodeURIComponent(roomId)}/chat`)
  }
// Add local tracks to all peer connections when available
  useEffect(() => {
    if (actualIsListener) return
    
    Object.values(peerConnections.current).forEach(pc => {
      // Add audio tracks if available
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => {
          if (!pc.getSenders().some(sender => sender.track === track)) {
            pc.addTrack(track, localStreamRef.current!)
            console.log(`Added audio track to existing PC: ${track.label}, enabled: ${track.enabled}`)
          }
        })
      }
      
      // Also add video tracks if enabled
      if (localVideoStreamRef.current) {
        localVideoStreamRef.current.getTracks().forEach(track => {
          if (!pc.getSenders().some(sender => sender.track === track)) {
            pc.addTrack(track, localVideoStreamRef.current!)
          }
        })
      }
      
      // Also add screen tracks if enabled  
      if (localScreenStreamRef.current) {
        localScreenStreamRef.current.getTracks().forEach(track => {
          if (!pc.getSenders().some(sender => sender.track === track)) {
            pc.addTrack(track, localScreenStreamRef.current!)
          }
        })
      }
      
      // Also add system audio tracks if enabled
      if (localSystemAudioStreamRef.current) {
        localSystemAudioStreamRef.current.getTracks().forEach(track => {
          if (!pc.getSenders().some(sender => sender.track === track)) {
            pc.addTrack(track, localSystemAudioStreamRef.current!)
            console.log(`Added system audio track to existing PC: ${track.label}, enabled: ${track.enabled}`)
          }
        })
      }
    })
  }, [joined, actualIsListener, videoEnabled, screenSharing, muted]) // Added muted as dependency

  // Clean up on leave
  useEffect(() => {
    const pcs = peerConnections.current
    const timeouts = connectionTimeouts.current
    return () => {
      Object.values(pcs).forEach(pc => pc.close())
      // Clean up connection timeouts
      Object.values(timeouts).forEach(timeout => clearTimeout(timeout))
      if (wsRef.current) wsRef.current.close()
      if (localStreamRef.current) localStreamRef.current.getTracks().forEach(t => t.stop())
      if (localVideoStreamRef.current) localVideoStreamRef.current.getTracks().forEach(t => t.stop())
      if (localScreenStreamRef.current) localScreenStreamRef.current.getTracks().forEach(t => t.stop())
      if (localSystemAudioStreamRef.current) localSystemAudioStreamRef.current.getTracks().forEach(t => t.stop())
    }
  }, [roomId])

  // 🔗 ULTRA-ROBUST CONNECTION: Immediate fail detection and aggressive recovery system
  useEffect(() => {
    // Only run health monitor if we're joined and have participants or connections
    if (!joined || (participants.size === 0 && Object.keys(connectionHealth).length === 0)) {
      return
    }

    const healthMonitor = setInterval(() => {
      const connectionCount = Object.keys(connectionHealth).length
      const participantCount = participants.size
      
      // Only log if we have connections or participants to monitor
      if (connectionCount > 0 || participantCount > 1) { // More than 1 because we exclude ourselves
        console.log('🔗 🔍 Health monitor checking connections:', Object.keys(connectionHealth))
      }
      
      Object.entries(connectionHealth).forEach(([peerId, health]) => {
        const pc = peerConnections.current[peerId]
        
        if (!pc) {
          console.log(`🔗 ⚠️ Missing peer connection for ${peerId}, cleaning up health state`)
          setConnectionHealth(prev => {
            const newHealth = { ...prev }
            delete newHealth[peerId]
            return newHealth
          })
          return
        }
        
        const actualState = pc.connectionState
        const iceState = pc.iceConnectionState
        console.log(`🔗 📊 ${peerId}: health=${health}, connection=${actualState}, ice=${iceState}`)
        
        // SMART FAILURE DETECTION: Only restart if truly stuck or failed
        const isActuallyStuck = (
          (actualState === 'failed') || // Connection completely failed
          (iceState === 'failed') || // ICE failed 
          (actualState === 'closed') || // Connection closed
          // Only consider disconnected as stuck if it's been disconnected for a while
          (actualState === 'disconnected' && health === 'disconnected')
        )
        
        // PATIENCE FOR CONNECTING STATES: Let connections that are making progress continue
        const isProgressing = (
          actualState === 'connecting' || // Still connecting
          actualState === 'new' || // Just started
          iceState === 'checking' || // ICE connectivity check in progress
          iceState === 'connected' || // ICE connected
          iceState === 'completed' // ICE completed
        )
        
        if (isActuallyStuck && !isProgressing) {
          console.log(`🔗 � IMMEDIATE RECOVERY: ${peerId} is stuck/failed (connection=${actualState}, ice=${iceState}, health=${health})`)
          
          // AGGRESSIVE IMMEDIATE RECOVERY - NO DELAYS
          setConnectionHealth(prev => ({ ...prev, [peerId]: 'failed' }))
          
          // Close and completely recreate connection immediately
          setTimeout(async () => {
            try {
              console.log(`🔗 🔥 FORCE RECREATING connection for ${peerId}`)
              
              // 1. Completely close old connection
              if (peerConnections.current[peerId]) {
                peerConnections.current[peerId].close()
                delete peerConnections.current[peerId]
              }
              
              // 2. Clear any existing timeouts
              if (connectionTimeouts.current[peerId]) {
                clearTimeout(connectionTimeouts.current[peerId])
                delete connectionTimeouts.current[peerId]
              }
              
              // 3. Wait a moment for cleanup
              await new Promise(resolve => setTimeout(resolve, 100))
              
              // 4. Create completely fresh connection
              console.log(`🔗 ✨ Creating FRESH peer connection for ${peerId}`)
              const newPc = createPeerConnection(peerId)
              
              // 5. Force immediate offer with ICE restart
              console.log(`🔗 🚀 Sending FRESH offer to ${peerId}`)
              const offer = await newPc.createOffer({ iceRestart: true })
              await newPc.setLocalDescription(offer)
              
              if (wsRef.current) {
                wsRef.current.send(JSON.stringify({
                  type: "call-offer",
                  roomId,
                  from: currentUser,
                  to: peerId,
                  payload: newPc.localDescription
                }))
              }
              
              console.log(`🔗 ✅ FRESH connection initiated for ${peerId}`)
              
              // 6. Set short timeout for this new connection
              const quickTimeout = setTimeout(() => {
                if (newPc.connectionState === 'new' || newPc.connectionState === 'connecting') {
                  console.log(`🔗 ⚡ Quick retry for ${peerId} - still not connected`)
                  setConnectionHealth(prev => ({ ...prev, [peerId]: 'failed' }))
                }
              }, 3000) // Much shorter timeout for quick retry
              
              connectionTimeouts.current[peerId] = quickTimeout
              
            } catch (error) {
              console.error(`🔗 ❌ FORCE RECREATION failed for ${peerId}:`, error)
              // Try again in a moment
              setTimeout(() => {
                setConnectionHealth(prev => ({ ...prev, [peerId]: 'failed' }))
              }, 1000)
            }
          }, 100) // IMMEDIATE - no delay
          
        } else {
          // Update health state to match actual state for non-stuck connections
          if (health !== actualState) {
            const validState = ['connecting', 'connected', 'failed', 'disconnected'].includes(actualState) 
              ? actualState as 'connecting' | 'connected' | 'failed' | 'disconnected'
              : 'connecting'
            
            console.log(`🔗 📝 Updating health for ${peerId}: ${health} → ${validState}`)
            setConnectionHealth(prev => ({ ...prev, [peerId]: validState }))
          }
          
          // ENHANCED: Smart periodic media synchronization for connected peers
          if (actualState === 'connected') {
            // Check if tracks are actually out of sync before forcing a sync
            const now = Date.now()
            const pcWithSync = pc as RTCPeerConnection & { _lastMediaSync?: number }
            const lastSync = pcWithSync._lastMediaSync || 0
            
            if (now - lastSync > 120000) { // Sync only every 2 minutes to reduce interference
              // INTELLIGENT sync: Calculate expected track count based on current media state
              const senders = pc.getSenders()
              const actualTrackCount = senders.filter(s => s.track).length
              
              // Calculate REAL expected track count based on current media states
              let expectedTrackCount = 0
              
              // Audio: Always 1 track (microphone, system, mixed, or arbitrary)
              if (localStreamRef.current && localStreamRef.current.getAudioTracks().length > 0) {
                expectedTrackCount += 1
              }
              
              // Video: 1 track if video enabled
              if (videoEnabled && localVideoStreamRef.current && localVideoStreamRef.current.getVideoTracks().length > 0) {
                expectedTrackCount += 1
              }
              
              // Screen share video: 1 track if screen sharing
              if (screenSharing && localScreenStreamRef.current && localScreenStreamRef.current.getVideoTracks().length > 0) {
                expectedTrackCount += 1
              }
              
              // Screen share audio: Additional audio tracks from screen sharing (if not mixed)
              if (screenSharing && localScreenStreamRef.current && localScreenStreamRef.current.getAudioTracks().length > 0) {
                // Check if we have master mixed track that includes system audio
                const streamWithMixedTrack = localStreamRef.current as MediaStream & { masterMixedTrack?: MediaStreamTrack }
                const hasMasterMixedTrack = streamWithMixedTrack.masterMixedTrack?.readyState === 'live' ||
                  localStreamRef.current?.getAudioTracks().some(track => 
                    'isMixedAudio' in track && (track as MediaStreamTrack & { isMixedAudio: boolean }).isMixedAudio
                  )
                
                // Check if peer already has any mixed audio (master or individual)
                const hasAnyMixedAudio = senders.some(sender => 
                  sender.track && 
                  sender.track.kind === 'audio' &&
                  (
                    ('isMixedAudio' in sender.track) ||
                    (sender.track.label.toLowerCase().includes('mixed audio'))
                  )
                )
                
                if (!hasMasterMixedTrack && !hasAnyMixedAudio) {
                  expectedTrackCount += localScreenStreamRef.current.getAudioTracks().length
                }
              }
              
              // System audio: Only if NOT included in master mixed track
              if (localSystemAudioStreamRef.current && localSystemAudioStreamRef.current.getAudioTracks().length > 0) {
                // Check if we have master mixed track that includes system audio
                const streamWithMixedTrack = localStreamRef.current as MediaStream & { masterMixedTrack?: MediaStreamTrack }
                const hasMasterMixedTrack = streamWithMixedTrack.masterMixedTrack?.readyState === 'live' ||
                  localStreamRef.current?.getAudioTracks().some(track => 
                    'isMixedAudio' in track && (track as MediaStreamTrack & { isMixedAudio: boolean }).isMixedAudio
                  )
                
                if (!hasMasterMixedTrack) {
                  expectedTrackCount += localSystemAudioStreamRef.current.getAudioTracks().length
                }
              }
              
              // Also check if peer already has working master mixed audio OR individual mixed audio
              const hasWorkingMasterMixed = senders.some(sender => 
                sender.track && 
                sender.track.readyState === 'live' &&
                (
                  // Check for master mixed track
                  ('isMixedAudio' in sender.track && (sender.track as MediaStreamTrack & { isMixedAudio: boolean }).isMixedAudio) ||
                  // Check for individual mixed track (also contains both mic + system)
                  (sender.track.label.toLowerCase().includes('mixed audio') && 
                   sender.track.label.toLowerCase().includes('microphone') && 
                   sender.track.label.toLowerCase().includes('system'))
                )
              )
              
              console.log(`🔗 🔍 Smart sync analysis for ${peerId}:`, {
                actualTracks: actualTrackCount,
                expectedTracks: expectedTrackCount,
                hasWorkingMasterMixed,
                mediaStates: {
                  audio: !!localStreamRef.current?.getAudioTracks().length,
                  video: videoEnabled,
                  screen: screenSharing,
                  systemAudio: !!localSystemAudioStreamRef.current?.getAudioTracks().length
                }
              })
              
              if (hasWorkingMasterMixed && actualTrackCount === expectedTrackCount) {
                // PERFECT STATE: Working mixed audio AND correct track count - no sync needed
                pcWithSync._lastMediaSync = now
                console.log(`🔗 🔒 SYNC BLOCKED: ${peerId} has working mixed audio and correct track count - no interference allowed`)
              } else if (hasWorkingMasterMixed && actualTrackCount !== expectedTrackCount) {
                // PARTIAL SYNC: Working mixed audio but missing other tracks (likely screen share)
                pcWithSync._lastMediaSync = now
                console.log(`🔗 � SELECTIVE SYNC: ${peerId} has working mixed audio but missing tracks - syncing non-audio tracks only`)
                
                // Only sync non-audio tracks to avoid interfering with working audio
                synchronizeNonAudioTracks(peerId)
              } else if (actualTrackCount !== expectedTrackCount) {
                console.log(`🔗 🔄 Smart sync for ${peerId}: track count mismatch (expected ${expectedTrackCount}, actual ${actualTrackCount})`)
                synchronizeAllMediaTracks(peerId)
                pcWithSync._lastMediaSync = now
              } else {
                // No mismatch detected - just update timestamp without syncing
                pcWithSync._lastMediaSync = now
                console.log(`🔗 ✅ Smart sync check for ${peerId}: tracks already synchronized (${actualTrackCount}/${expectedTrackCount})`)
              }
            }
          }
        }
      })
      
      // Also check for peers that should have connections but don't
      Array.from(participants).forEach(peerId => {
        if (peerId !== currentUser && !peerConnections.current[peerId]) {
          console.log(`🔗 🔧 Missing connection for active participant ${peerId}, creating immediately...`)
          
          setConnectionHealth(prev => ({ ...prev, [peerId]: 'connecting' }))
          const newPc = createPeerConnection(peerId)
          
          // Send offer to establish connection immediately
          setTimeout(async () => {
            try {
              const offer = await newPc.createOffer()
              await newPc.setLocalDescription(offer)
              
              if (wsRef.current) {
                wsRef.current.send(JSON.stringify({
                  type: "call-offer",
                  roomId,
                  from: currentUser,
                  to: peerId,
                  payload: newPc.localDescription
                }))
              }
              console.log(`🔗 ✅ Created missing connection for ${peerId}`)
            } catch (error) {
              console.error(`🔗 ❌ Failed to create missing connection for ${peerId}:`, error)
              setConnectionHealth(prev => ({ ...prev, [peerId]: 'failed' }))
            }
          }, 100)
        }
      })
      
    }, 5000) // Less frequent checks - every 5 seconds for stability
    
    return () => clearInterval(healthMonitor)
  }, [joined, connectionHealth, roomId, currentUser, participants, createPeerConnection, synchronizeAllMediaTracks, synchronizeNonAudioTracks, screenSharing, videoEnabled])

  // --- Mute/unmute a remote participant ---
  const togglePeerMute = (peer: string) => {
    setPeerMuted(prev => ({
      ...prev,
      [peer]: !prev[peer]
    }))
  }
  // --- Fullscreen controls for participant videos ---
  const enterFullscreen = (peer: string) => {
    const element = remoteScreenRefs.current[peer]?.current || remoteVideoRefs.current[peer]?.current
    if (element) {
      if (element.requestFullscreen) {
        element.requestFullscreen()
      } else if (element.webkitRequestFullscreen) {
        element.webkitRequestFullscreen()
      } else if (element.mozRequestFullScreen) {
        element.mozRequestFullScreen()
      } else if (element.msRequestFullscreen) {
        element.msRequestFullscreen()
      }
    }
  }

  // Listen for fullscreen changes (when user exits fullscreen with ESC)
  useEffect(() => {
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement && 
          !document.webkitFullscreenElement && 
          !document.mozFullScreenElement && 
          !document.msFullscreenElement) {
      }
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange)
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange)
    document.addEventListener('mozfullscreenchange', handleFullscreenChange)
    document.addEventListener('MSFullscreenChange', handleFullscreenChange)

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange)
      document.removeEventListener('mozfullscreenchange', handleFullscreenChange)
      document.removeEventListener('MSFullscreenChange', handleFullscreenChange)
    }
  }, [])

  // --- Switch camera between front and back with optimized renegotiation ---
  const switchCamera = async () => {
    if (!videoEnabled) return

    const newCamera = currentCamera === 'user' ? 'environment' : 'user'

    if (newCamera === 'environment')
      setIsMirrored(false) // Back camera should not be mirrored
    else
      setIsMirrored(true) // Front camera should be mirrored
    
    try {
      // Stop current video stream
      if (localVideoStreamRef.current) {
        localVideoStreamRef.current.getTracks().forEach(track => track.stop())
      }      // Get new video stream with the opposite camera - ULTRA HIGH QUALITY 60FPS
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { 
          facingMode: newCamera,
          width: { ideal: 1920, min: 1280 },
          height: { ideal: 1080, min: 720 },
          frameRate: { ideal: 60 }, // 60fps for streaming quality
          aspectRatio: { ideal: 16/9 },
        }, 
        audio: false 
      })
      localVideoStreamRef.current = stream

      // Update local video preview immediately
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream
      }

      // Update all peer connections with parallel processing
      const renegotiationPromises = Object.entries(peerConnections.current).map(async ([remote, pc]) => {
        const newVideoTrack = stream.getVideoTracks()[0]
        
        // Find existing video sender (non-screen) and use safe replacement
        const existingVideoTrack = pc.getSenders().find(sender =>
          sender.track && sender.track.kind === 'video' && !sender.track.label.includes('screen')
        )?.track || null

        const success = await safeReplaceTrack(pc, existingVideoTrack, newVideoTrack, stream, 'video')
        if (!success) {
          console.warn(`Failed to safely replace camera track for ${remote}, falling back to remove/add`)
          // Fallback: Remove old tracks and add new ones (may cause m-line reordering)
          pc.getSenders().forEach(sender => {
            if (sender.track && sender.track.kind === 'video' && !sender.track.label.includes('screen')) {
              pc.removeTrack(sender)
            }
          })

          // Add new video tracks
          if (!pc.getSenders().some(sender => sender.track === newVideoTrack)) {
            pc.addTrack(newVideoTrack, stream)
          }
        }
        
        // Trigger renegotiation only if needed
        try {
          const offer = await pc.createOffer()
          await pc.setLocalDescription(offer)
          if (wsRef.current) {
            wsRef.current.send(JSON.stringify({ 
              type: "call-offer", 
              roomId, 
              from: currentUser, 
              to: remote, 
              payload: pc.localDescription 
            }))
          }
        } catch (error) {
          console.error(`Error creating camera switch offer for ${remote}:`, error)
        }
      })

      // Wait for all updates to complete
      await Promise.allSettled(renegotiationPromises)
      setCurrentCamera(newCamera)
    } catch (error) {
      console.error('Error switching camera:', error)
      setError('Camera switch failed - the requested camera may not be available')
    }
  }

  // --- Toggle mirror for local video preview ---
  const toggleMirror = () => {
    setIsMirrored(!isMirrored)
  }  // --- Toggle video with optimized parallel renegotiation ---
  const toggleVideo = async () => {
    if (videoEnabled) {
      // Turn off video
      if (localVideoStreamRef.current) {
        localVideoStreamRef.current.getTracks().forEach(track => track.stop())
        localVideoStreamRef.current = null
      }
      
      // Remove video tracks using safe replacement (maintain m-line order)
      const renegotiationPromises = Object.entries(peerConnections.current).map(async ([remote, pc]) => {
        // Use safeReplaceTrack to replace video track with null (maintains m-line order)
        const currentVideoTrack = pc.getSenders().find(sender => 
          sender.track && sender.track.kind === 'video' && 
          !sender.track.label.toLowerCase().includes('screen')
        )?.track || null
        
        const success = await safeReplaceTrack(pc, currentVideoTrack, null, new MediaStream(), 'video')
        if (!success) {
          console.warn(`Failed to safely replace video track for ${remote}, falling back to remove`)
          // Fallback: remove track (may cause m-line reordering but necessary if replaceTrack fails)
          pc.getSenders().forEach(sender => {
            if (sender.track && sender.track.kind === 'video' && !sender.track.label.includes('screen')) {
              pc.removeTrack(sender)
            }
          })
        }
        
        // Trigger renegotiation
        try {
          const offer = await pc.createOffer()
          await pc.setLocalDescription(offer)
          if (wsRef.current) {
            wsRef.current.send(JSON.stringify({ 
              type: "call-offer", 
              roomId, 
              from: currentUser, 
              to: remote, 
              payload: pc.localDescription 
            }))
          }
        } catch (error) {
          console.error(`Error creating video-off offer for ${remote}:`, error)
        }
      })
      
      // Wait for all renegotiations to complete
      await Promise.allSettled(renegotiationPromises)
      setVideoEnabled(false)
    } else {      // Turn on video
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
          video: { 
            facingMode: currentCamera,
            width: { ideal: 1920, min: 1280 },
            height: { ideal: 1080, min: 720 },
            frameRate: { ideal: 60 }, // 60fps for streaming platform quality
            aspectRatio: { ideal: 16/9 }
          }, 
          audio: false 
        })
        localVideoStreamRef.current = stream
        
        // Add video tracks and trigger parallel renegotiation
        const renegotiationPromises = Object.entries(peerConnections.current).map(async ([remote, pc]) => {
          const videoTrack = stream.getVideoTracks()[0]
          
          // Use safeReplaceTrack to maintain m-line order
          const success = await safeReplaceTrack(pc, null, videoTrack, stream, 'video')
          if (!success) {
            console.warn(`Failed to safely add video track for ${remote}, falling back to addTrack`)
            // Fallback: add track normally (may cause m-line reordering)
            if (!pc.getSenders().some(sender => sender.track === videoTrack)) {
              pc.addTrack(videoTrack, stream)
              console.log(`Added video track to peer connection: ${remote}`)
            }
          }
          
          // Set encoding parameters for video optimization
          const sender = pc.getSenders().find(s => s.track === videoTrack)
          if (sender) {
            try {
              const parameters = sender.getParameters()
              if (!parameters.encodings) {
                parameters.encodings = [{}]
              }
              // Optimize for streaming platform quality: high bitrate, 60fps
              if (parameters.encodings[0]) {
                parameters.encodings[0].maxBitrate = 4000000 // 4 Mbps for 60fps 1080p streaming
                parameters.encodings[0].maxFramerate = 60    // 60fps for streaming platform quality
                parameters.encodings[0].scaleResolutionDownBy = 1 // No downscaling for best quality
              }
              await sender.setParameters(parameters)
              console.log(`Set video encoding parameters for ${remote}`)
            } catch (error) {
              console.warn(`Failed to set video encoding parameters for ${remote}:`, error)
            }
          }
          
          // Trigger renegotiation
          try {
            const offer = await pc.createOffer()
            await pc.setLocalDescription(offer)
            if (wsRef.current) {
              wsRef.current.send(JSON.stringify({ 
                type: "call-offer", 
                roomId, 
                from: currentUser, 
                to: remote, 
                payload: pc.localDescription 
              }))
            }
          } catch (error) {
            console.error(`Error creating video offer for ${remote}:`, error)
          }
        })
        
        // Wait for all renegotiations to complete in parallel
        await Promise.allSettled(renegotiationPromises)
        setVideoEnabled(true)
      } catch (error) {
        console.error('Error accessing camera:', error)
        setError('Camera access denied')
      }
    }
  }// --- Toggle screen sharing with optimized parallel renegotiation ---
  const toggleScreenShare = async () => {
    if (screenSharing) {
      // Turn off screen sharing with safe track replacement
      if (localScreenStreamRef.current) {
        localScreenStreamRef.current.getTracks().forEach(track => track.stop())
        localScreenStreamRef.current = null
      }
      
      // Turn off system audio
      if (localSystemAudioStreamRef.current) {
        localSystemAudioStreamRef.current.getTracks().forEach(track => track.stop())
        localSystemAudioStreamRef.current = null
      }
      
      // Use safe track replacement to maintain m-line order
      const renegotiationPromises = Object.entries(peerConnections.current).map(async ([remote, pc]) => {
        // Remove screen video track safely
        const currentScreenTrack = pc.getSenders().find(sender => 
          sender.track && sender.track.kind === 'video' && 
          (sender.track.label.toLowerCase().includes('screen') || 
           sender.track.label.toLowerCase().includes('monitor') ||
           sender.track.label.toLowerCase().includes('display'))
        )?.track || null
        
        if (currentScreenTrack) {
          await safeReplaceTrack(pc, currentScreenTrack, null, new MediaStream(), 'screen')
        }
        
        // Remove system audio track safely
        const currentSystemAudioTrack = pc.getSenders().find(sender => 
          sender.track && sender.track.kind === 'audio' && 
          (sender.track.label.toLowerCase().includes('system') || 
           sender.track.label.toLowerCase().includes('screen'))
        )?.track || null
        
        if (currentSystemAudioTrack) {
          await safeReplaceTrack(pc, currentSystemAudioTrack, null, new MediaStream(), 'audio')
        }
        
        console.log(`✅ Screen sharing and system audio safely removed for ${remote}`)
        
        // Trigger renegotiation
        try {
          const offer = await pc.createOffer()
          await pc.setLocalDescription(offer)
          if (wsRef.current) {
            wsRef.current.send(JSON.stringify({ 
              type: "call-offer", 
              roomId, 
              from: currentUser, 
              to: remote, 
              payload: pc.localDescription 
            }))
          }
        } catch (error) {
          console.error(`Error creating screen-off offer for ${remote}:`, error)
        }
      })
      
      // Wait for all renegotiations to complete
      await Promise.allSettled(renegotiationPromises)
      setScreenSharing(false)
    } else {
      // Turn on screen sharing
      try {
        // CRITICAL: Verify microphone is still working before starting screen share
        console.log('🎤 Pre-screen-share microphone check...')
        if (localStreamRef.current) {
          const micTracks = localStreamRef.current.getAudioTracks()
          console.log(`🎤 Found ${micTracks.length} microphone tracks before screen share`)
          micTracks.forEach((track, index) => {
            console.log(`  Mic Track ${index + 1}: ${track.label}, enabled: ${track.enabled}, state: ${track.readyState}`)
          })
          
          // Ensure microphone tracks are enabled if not muted
          if (!muted) {
            micTracks.forEach(track => {
              if (!track.enabled) {
                track.enabled = true
                console.log(`🎤 ✅ Re-enabled microphone track: ${track.label}`)
              }
            })
          }
        } else {
          console.warn('🎤 No microphone stream found before screen share!')
        }
        
        const stream = await navigator.mediaDevices.getDisplayMedia({ 
          video: { 
            width: { ideal: 1920, max: 1920 },
            height: { ideal: 1080, max: 1080 },
            frameRate: { ideal: 60, max: 60 } // Force 60fps for smooth screen sharing
          }, 
          audio: true // Include audio if available
        })
        localScreenStreamRef.current = stream
        
        console.log('Screen share started, track label:', stream.getVideoTracks()[0]?.label)
        
        // Handle system audio separately if available
        const systemAudioTracks = stream.getAudioTracks()
        if (systemAudioTracks.length > 0) {
          console.log('🔊 System audio captured with screen share:')
          systemAudioTracks.forEach((track, index) => {
            console.log(`  Track ${index + 1}:`, {
              label: track.label,
              enabled: track.enabled,
              kind: track.kind,
              id: track.id
            })
          })
          
          // Mark system audio tracks with a custom property for identification
          systemAudioTracks.forEach(track => {
            // Add a custom property to identify system audio tracks
            Object.defineProperty(track, 'isSystemAudio', {
              value: true,
              writable: false
            })
            // Override the label to make it clearly identifiable
            Object.defineProperty(track, 'label', {
              value: `System Audio - ${track.label}`,
              writable: false
            })
            console.log('✅ Marked system audio track with custom property:', track.label)
          })
          
          // CRITICAL: Create a combined audio stream that includes BOTH microphone and system audio
          const combinedAudioTracks: MediaStreamTrack[] = []
          let microphoneTrackCount = 0
          
          // Add existing microphone tracks first (preserve microphone)
          if (localStreamRef.current) {
            const micTracks = localStreamRef.current.getAudioTracks()
            if (micTracks.length > 0) {
              console.log('🎤 Preserving microphone tracks in combined stream:', micTracks.length)
              combinedAudioTracks.push(...micTracks)
              microphoneTrackCount = micTracks.length
            }
          }
          
          // Add system audio tracks
          combinedAudioTracks.push(...systemAudioTracks)
          
          // Create separate system audio stream for local monitoring
          const systemAudioStream = new MediaStream(systemAudioTracks)
          localSystemAudioStreamRef.current = systemAudioStream
          
          // Attach to local system audio element for monitoring (but keep it muted to prevent echo)
          if (localSystemAudioRef.current) {
            localSystemAudioRef.current.srcObject = systemAudioStream
            localSystemAudioRef.current.muted = true
            console.log('📻 Local system audio element configured (muted to prevent echo)')
          }
          
          console.log(`🎵 Combined audio stream created with ${combinedAudioTracks.length} tracks (${microphoneTrackCount} mic + ${systemAudioTracks.length} system)`)
          
          // CRITICAL: Create a single mixed audio track for ALL peers (including late joiners)
          if (localStreamRef.current && microphoneTrackCount > 0) {
            console.log('🎵 🔄 Creating master mixed audio track for consistent late joiner support...')
            
            // IMPORTANT: Preserve the original microphone stream BEFORE creating mixed track
            const originalMicrophoneStream = localStreamRef.current
            const micTracks = originalMicrophoneStream.getAudioTracks()
            console.log('🎵 🔍 Pre-mixing microphone state:', {
              trackCount: micTracks.length,
              tracks: micTracks.map(track => ({
                label: track.label,
                enabled: track.enabled,
                readyState: track.readyState,
                muted: track.muted
              }))
            })
            
            // Ensure microphone tracks are enabled for mixing
            micTracks.forEach(track => {
              if (!track.enabled && !muted) {
                track.enabled = true
                console.log('🎵 ✅ Re-enabled microphone track for mixing:', track.label)
              }
            })
            
            try {
              const masterAudioContext = new AudioContext({
                sampleRate: 48000,
                latencyHint: 'interactive'
              })
              
              if (masterAudioContext.state === 'suspended') {
                await masterAudioContext.resume()
              }
              
              const masterMixedOutput = masterAudioContext.createGain()
              
              // CRITICAL: Create sources from the ORIGINAL streams, not the reference that will be updated
              const masterMicSource = masterAudioContext.createMediaStreamSource(originalMicrophoneStream)
              const masterSystemSource = masterAudioContext.createMediaStreamSource(systemAudioStream)
              
              // Set balanced gain levels
              const masterMicGain = masterAudioContext.createGain()
              const masterSystemGain = masterAudioContext.createGain()
              masterMicGain.gain.setValueAtTime(0.7, masterAudioContext.currentTime) // 70% microphone
              masterSystemGain.gain.setValueAtTime(0.8, masterAudioContext.currentTime) // 80% system audio
              
              console.log('🎵 🔧 Audio mixing setup:', {
                micGainLevel: 0.7,
                systemGainLevel: 0.8,
                audioContextState: masterAudioContext.state,
                micSourceConnected: !!masterMicSource,
                systemSourceConnected: !!masterSystemSource,
                originalMicTracks: originalMicrophoneStream.getAudioTracks().length,
                systemTracks: systemAudioStream.getAudioTracks().length
              })
              
              // Connect sources through gain nodes to the output
              masterMicSource.connect(masterMicGain)
              masterSystemSource.connect(masterSystemGain)
              masterMicGain.connect(masterMixedOutput)
              masterSystemGain.connect(masterMixedOutput)
              
              // Create destination and get mixed stream
              const masterDestination = masterAudioContext.createMediaStreamDestination()
              masterMixedOutput.connect(masterDestination)
              
              const masterMixedTrack = masterDestination.stream.getAudioTracks()[0]
              if (masterMixedTrack) {
                // Mark the master mixed track
                Object.defineProperty(masterMixedTrack, 'label', {
                  value: 'Master Mixed Audio (Microphone + System) - Screen Share',
                  writable: false
                })
                
                Object.defineProperty(masterMixedTrack, 'isMixedAudio', {
                  value: true,
                  writable: false
                })
                
                Object.defineProperty(masterMixedTrack, 'containsSystemAudio', {
                  value: true,
                  writable: false
                })
                
                console.log('🎵 ✅ Master mixed track created:', {
                  label: masterMixedTrack.label,
                  enabled: masterMixedTrack.enabled,
                  readyState: masterMixedTrack.readyState,
                  id: masterMixedTrack.id
                })
                
                // CRITICAL FIX: Update existing peer connections with replaceTrack() instead of modifying stream
                // This preserves audio connection for existing peers while providing master mixed track
                
                // IMMEDIATELY update all existing peer connections with master mixed track
                console.log('🎵 🔄 Updating all existing peer connections with master mixed audio...')
                
                const updatePromises = Object.entries(peerConnections.current).map(async ([remote, pc]) => {
                  const existingAudioSender = pc.getSenders().find(sender => 
                    sender.track && sender.track.kind === 'audio'
                  )
                  
                  if (existingAudioSender) {
                    try {
                      await existingAudioSender.replaceTrack(masterMixedTrack)
                      console.log(`🎵 ✅ Successfully updated ${remote} with master mixed audio`)
                    } catch (error) {
                      console.error(`🎵 ❌ Failed to update ${remote} with master mixed audio:`, error)
                    }
                  }
                })
                
                // Wait for all peer connections to be updated
                await Promise.allSettled(updatePromises)
                
                // DON'T modify the local stream reference - keep the original microphone stream
                // The master mixed track will be used by peer connections via replaceTrack()
                // but we keep the original stream for local monitoring and future audio mixing
                console.log('🎵 ✅ Master mixed track distributed to all existing peers, original stream preserved')
                
                // Update local audio element to monitor the mixed audio for local feedback
                if (localAudioRef.current) {
                  // Create a temporary stream with just the master mixed track for local monitoring
                  const localMonitoringStream = new MediaStream([masterMixedTrack])
                  localAudioRef.current.srcObject = localMonitoringStream
                }
                
                // Store a reference to the master mixed track for late joiners
                // We'll check for this in createPeerConnection instead of modifying localStreamRef
                const streamWithMixedTrack = localStreamRef.current as MediaStream & { masterMixedTrack?: MediaStreamTrack }
                if (!streamWithMixedTrack.masterMixedTrack) {
                  Object.defineProperty(streamWithMixedTrack, 'masterMixedTrack', {
                    value: masterMixedTrack,
                    writable: true,
                    enumerable: false
                  })
                }
                
                // Store the master audio context for cleanup
                mixedAudioContextsRef.current.set('master', masterAudioContext)
                
                console.log('🎵 ✅ Master mixed audio active for existing peers, original microphone stream preserved for stability')
                
                // IMPORTANT: Keep the original microphone stream reference for audio context
                console.log('🎵 📌 Original microphone stream preserved - audio mixing will continue working')
                
                // Store reference to original stream for potential cleanup later
                setTimeout(() => {
                  // Only stop if we're sure the mixed track is working and being used
                  if (masterMixedTrack.readyState === 'live') {
                    console.log('🎵 🧹 Master mixed track confirmed working, original mic stream can be cleaned up')
                  }
                }, 5000) // Wait 5 seconds before cleanup
              } else {
                console.warn('🎵 ❌ Failed to create master mixed audio track')
                await masterAudioContext.close()
              }
            } catch (error) {
              console.error('🎵 ❌ Failed to create master mixed audio:', error)
            }
          }
        } else {
          console.log('❌ No system audio captured with screen share')
        }
        
        // Add both screen video and system audio tracks to all peer connections
        console.log('🔄 Starting screen sharing track distribution to all peers...')
        const renegotiationPromises = Object.entries(peerConnections.current).map(async ([remote, pc]) => {
          console.log(`📡 Processing screen sharing for peer: ${remote}`)
          
          const screenTrack = stream.getVideoTracks()[0]
          
          // Handle screen video track
          if (screenTrack) {
            // Check for existing screen track sender to use replaceTrack if possible
            const existingScreenSender = pc.getSenders().find(sender => 
              sender.track && sender.track.kind === 'video' && 
              (sender.track.label.toLowerCase().includes('screen') || 
               sender.track.label.toLowerCase().includes('monitor') ||
               sender.track.label.toLowerCase().includes('display'))
            )
            
            if (existingScreenSender && existingScreenSender.track) {
              // Replace existing screen track (avoids renegotiation)
              try {
                await existingScreenSender.replaceTrack(screenTrack)
                console.log(`Replaced screen track for ${remote}`)
                return // No renegotiation needed
              } catch (error) {
                console.warn(`Failed to replace screen track for ${remote}, falling back to addTrack:`, error)
              }
            } else {
              // Add new track if no existing track or replace failed
              if (!pc.getSenders().some(sender => sender.track === screenTrack)) {
                pc.addTrack(screenTrack, stream)
                console.log(`Added screen track to peer connection: ${remote}`)
              }
            }
            
            // Set encoding parameters for screen sharing optimization
            const sender = pc.getSenders().find(s => s.track === screenTrack)
            if (sender) {
              try {
                const parameters = sender.getParameters()
                if (!parameters.encodings) {
                  parameters.encodings = [{}]
                }
                if (parameters.encodings[0]) {
                  // Optimize for smooth 60fps screen sharing
                  parameters.encodings[0].maxBitrate = 5000000 // 5 Mbps for smooth screen content
                  parameters.encodings[0].maxFramerate = 60    // 60 fps for smooth screen share
                  parameters.encodings[0].scaleResolutionDownBy = 1 // No downscaling
                  parameters.encodings[0].priority = 'high'    // High priority for screen content
                  await sender.setParameters(parameters)
                  console.log(`Set optimized screen share encoding parameters for ${remote}: 5Mbps, 60fps`)
                }
              } catch (error) {
                console.warn(`Failed to set encoding parameters for ${remote}:`, error)
              }
            }
          }
          
          // ENHANCED: Use master mixed audio track for consistent experience
          if (localStreamRef.current && localSystemAudioStreamRef.current) {
            console.log(`🎵 Setting up audio for ${remote} using master mixed track...`)
            
            // Check if we have the master mixed track
            const masterMixedTrack = localStreamRef.current.getAudioTracks().find(track => 
              'isMixedAudio' in track && (track as MediaStreamTrack & { isMixedAudio: boolean }).isMixedAudio
            )
            
            if (masterMixedTrack) {
              console.log(`🎵 ✅ Using master mixed audio track for ${remote}`)
              
              // Get existing audio sender to replace the track
              const existingAudioSender = pc.getSenders().find(sender => 
                sender.track && sender.track.kind === 'audio'
              )
              
              if (existingAudioSender) {
                // Replace with master mixed track
                try {
                  await existingAudioSender.replaceTrack(masterMixedTrack)
                  console.log(`🎵 ✅ Replaced audio track with master mixed audio for ${remote}`)
                } catch (error) {
                  console.error(`🎵 ❌ Failed to replace with master mixed audio for ${remote}:`, error)
                }
              } else {
                // Add master mixed track if no existing sender
                if (!pc.getSenders().some(sender => sender.track === masterMixedTrack)) {
                  pc.addTrack(masterMixedTrack, localStreamRef.current)
                  console.log(`🎵 ✅ Added master mixed audio track for ${remote}`)
                }
              }
            } else {
              // Fallback to individual mixing (shouldn't happen with master track approach)
              console.log(`🎵 ⚠️ No master mixed track found, falling back to individual mixing for ${remote}`)
              
              const microphoneTracks = localStreamRef.current.getAudioTracks()
              const systemTracks = localSystemAudioStreamRef.current.getAudioTracks()
              
              console.log(`  🎤 Microphone tracks: ${microphoneTracks.length}`)
              console.log(`  🔊 System audio tracks: ${systemTracks.length}`)
              
              // Get existing audio sender to replace the track
              const existingAudioSender = pc.getSenders().find(sender => 
                sender.track && sender.track.kind === 'audio'
              )
              
              if (existingAudioSender && microphoneTracks.length > 0 && systemTracks.length > 0) {
                // Create individual mixed audio track as fallback
                console.log(`🎵 Creating individual audio mix for ${remote}...`)
                
                try {
                  // Create an audio context for mixing with proper settings
                  const audioContext = new AudioContext({
                    sampleRate: 48000, // High quality sample rate
                    latencyHint: 'interactive'
                  })
                  
                  // Ensure audio context is resumed (required by some browsers)
                  if (audioContext.state === 'suspended') {
                    await audioContext.resume()
                    console.log('🎵 Audio context resumed')
                  }
                  
                  const mixedOutput = audioContext.createGain()
                  
                  // Create sources for both audio streams - need to use original streams for individual mixing
                  const microphoneSource = audioContext.createMediaStreamSource(new MediaStream(microphoneTracks))
                  const systemSource = audioContext.createMediaStreamSource(localSystemAudioStreamRef.current)
                  
                  // Set balanced gain levels (slightly lower to prevent clipping)
                  const micGain = audioContext.createGain()
                  const systemGain = audioContext.createGain()
                  micGain.gain.setValueAtTime(0.7, audioContext.currentTime) // 70% microphone
                  systemGain.gain.setValueAtTime(0.8, audioContext.currentTime) // 80% system audio
                  
                  // Connect sources through gain nodes to the output
                  microphoneSource.connect(micGain)
                  systemSource.connect(systemGain)
                  micGain.connect(mixedOutput)
                  systemGain.connect(mixedOutput)
                  
                  // Create a destination and get the mixed stream
                  const destination = audioContext.createMediaStreamDestination()
                  mixedOutput.connect(destination)
                  
                  const mixedTrack = destination.stream.getAudioTracks()[0]
                  if (mixedTrack) {
                    // Mark the mixed track appropriately
                    Object.defineProperty(mixedTrack, 'label', {
                      value: 'Mixed Audio (Microphone + System) - Individual',
                      writable: false
                    })
                    
                    // Replace the existing audio track with the mixed one
                    await existingAudioSender.replaceTrack(mixedTrack)
                    console.log(`🎵 ✅ Replaced audio track with individual mixed audio for ${remote}`)
                    
                    // Store audio context reference for cleanup later
                    mixedAudioContextsRef.current.set(remote, audioContext)
                  } else {
                    console.warn(`🎵 ❌ Failed to get individual mixed audio track for ${remote}`)
                    await audioContext.close()
                  }
                } catch (error) {
                  console.error(`🎵 ❌ Failed to create individual mixed audio for ${remote}:`, error)
                  // Fallback: add both tracks separately
                  systemTracks.forEach(track => {
                    if (!pc.getSenders().some(sender => sender.track?.id === track.id)) {
                      pc.addTrack(track, localSystemAudioStreamRef.current!)
                      console.log(`🔊 ✅ Added system audio track separately for ${remote}`)
                    }
                  })
                }
              } else {
                // No existing audio sender, add both microphone and system audio tracks
                console.log(`🎵 Adding separate microphone and system audio tracks for ${remote}`)
                
                microphoneTracks.forEach((track: MediaStreamTrack) => {
                  if (!pc.getSenders().some(sender => sender.track?.id === track.id)) {
                    pc.addTrack(track, new MediaStream([track])) // Create individual stream for each track
                    console.log(`🎤 ✅ Added microphone audio track for ${remote}`)
                  }
                })
                
                systemTracks.forEach((track: MediaStreamTrack) => {
                  if (!pc.getSenders().some(sender => sender.track?.id === track.id)) {
                    pc.addTrack(track, localSystemAudioStreamRef.current!)
                    console.log(`🔊 ✅ Added system audio track for ${remote}`)
                  }
                })
              }
            }
          } else if (localStreamRef.current) {
            // Only microphone available
            const microphoneTracks = localStreamRef.current.getAudioTracks()
            if (microphoneTracks.length > 0) {
              console.log(`🎤 Preserving microphone-only audio for ${remote}`)
              microphoneTracks.forEach((track: MediaStreamTrack) => {
                const existingSender = pc.getSenders().find(sender => sender.track?.id === track.id)
                if (!existingSender) {
                  pc.addTrack(track, localStreamRef.current!)
                  console.log(`🎤 ✅ Added microphone audio track for ${remote}`)
                }
              })
            }
          } else if (localSystemAudioStreamRef.current) {
            // Only system audio available
            const systemTracks = localSystemAudioStreamRef.current.getAudioTracks()
            if (systemTracks.length > 0) {
              console.log(`🔊 Adding system-audio-only for ${remote}`)
              systemTracks.forEach((track: MediaStreamTrack) => {
                const existingSender = pc.getSenders().find(sender => sender.track?.id === track.id)
                if (!existingSender) {
                  pc.addTrack(track, localSystemAudioStreamRef.current!)
                  console.log(`🔊 ✅ Added system audio track for ${remote}`)
                }
              })
            }
          }
          
          // Trigger renegotiation
          try {
            const offer = await pc.createOffer()
            await pc.setLocalDescription(offer)
            if (wsRef.current) {
              wsRef.current.send(JSON.stringify({ 
                type: "call-offer", 
                roomId, 
                from: currentUser, 
                to: remote, 
                payload: pc.localDescription 
              }))
            }
          } catch (error) {
            console.error(`Error creating screen offer for ${remote}:`, error)
          }
        })
        
        // Wait for all renegotiations to complete in parallel
        await Promise.allSettled(renegotiationPromises)
        
        // Auto-stop when user stops sharing via browser UI
        stream.getVideoTracks()[0].addEventListener('ended', async () => {
          console.log('Screen share ended by user')
          setScreenSharing(false)
          localScreenStreamRef.current = null
          
          // Stop system audio stream
          if (localSystemAudioStreamRef.current) {
            localSystemAudioStreamRef.current.getTracks().forEach(track => track.stop())
            localSystemAudioStreamRef.current = null
          }
          
          // Clean up from peer connections with parallel renegotiation
          const cleanupPromises = Object.entries(peerConnections.current).map(async ([remote, pc]) => {
            pc.getSenders().forEach(sender => {
              if (sender.track && sender.track.readyState === 'ended') {
                pc.removeTrack(sender)
              }
            })
            
            // Trigger renegotiation
            try {
              const offer = await pc.createOffer()
              await pc.setLocalDescription(offer)
              if (wsRef.current) {
                wsRef.current.send(JSON.stringify({ 
                  type: "call-offer", 
                  roomId, 
                  from: currentUser, 
                  to: remote, 
                  payload: pc.localDescription 
                }))
              }
            } catch (error) {
              console.error(`Error creating cleanup offer for ${remote}:`, error)
            }
          })
          
          await Promise.allSettled(cleanupPromises)
        })
        setScreenSharing(true)
      } catch (error) {
        console.error('Error accessing screen:', error)
        setError('Screen sharing access denied or not supported')
      }
    }
  }// Create arbitrary audio track when no microphone access - OPTIMIZED for startup speed
  const createArbitraryAudioTrack = (): MediaStream => {
    try {
      // Create audio context with minimal processing for speed
      const audioContext = new (window.AudioContext || window.webkitAudioContext)()
      const oscillator = audioContext.createOscillator()
      const gainNode = audioContext.createGain()
      
      // Create extremely quiet audio for WebRTC detection
      oscillator.frequency.setValueAtTime(440, audioContext.currentTime)
      gainNode.gain.setValueAtTime(0.00001, audioContext.currentTime) // Virtually inaudible
      
      oscillator.connect(gainNode)
      
      // Create MediaStreamDestination
      const destination = audioContext.createMediaStreamDestination()
      gainNode.connect(destination)
      
      // Start the oscillator
      oscillator.start()
      
      const stream = destination.stream
      const audioTrack = stream.getAudioTracks()[0]
      
      if (audioTrack) {
        // Set track properties
        Object.defineProperty(audioTrack, 'label', {
          value: 'Optimized Arbitrary Audio',
          writable: false
        })
        
        Object.defineProperty(audioTrack, 'isArbitraryTrack', {
          value: true,
          writable: false
        })
      }
      
      return stream
    } catch (error) {
      console.error('🔧 ❌ Error creating arbitrary audio track:', error)
      
      // Fallback: create minimal media stream
      const canvas = document.createElement('canvas')
      canvas.width = 1
      canvas.height = 1
      const canvasStream = canvas.captureStream(1)
      
      return canvasStream
    }
  }



  // Create arbitrary video track when no camera access - OPTIMIZED for startup speed
  const createArbitraryVideoTrack = (): MediaStream => {
    try {
      // Create a minimal canvas for faster startup
      const canvas = document.createElement('canvas')
      canvas.width = 320
      canvas.height = 240
      
      const ctx = canvas.getContext('2d')
      if (ctx) {
        // Create static content instead of animation for faster startup
        ctx.fillStyle = '#1a1a1a'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        
        // Add minimal visual content
        ctx.fillStyle = '#333'
        ctx.fillRect(canvas.width/2 - 50, canvas.height/2 - 25, 100, 50)
        
        ctx.fillStyle = '#666'
        ctx.font = '16px Arial'
        ctx.textAlign = 'center'
        ctx.fillText('Video Off', canvas.width/2, canvas.height/2 + 5)
      }
      
      // Capture stream from canvas (low frame rate for efficiency)
      const stream = canvas.captureStream(1) // 1 FPS for minimal bandwidth
      const videoTrack = stream.getVideoTracks()[0]
      
      if (videoTrack) {
        // Set track properties to make it identifiable
        Object.defineProperty(videoTrack, 'label', {
          value: 'Optimized Arbitrary Video',
          writable: false
        })
        
        // Mark as arbitrary track for identification
        Object.defineProperty(videoTrack, 'isArbitraryTrack', {
          value: true,
          writable: false
        })
      }
      
      return stream
    } catch (error) {
      console.error('🔧 ❌ Error creating arbitrary video track:', error)
      
      // Fallback: create minimal canvas stream
      try {
        const canvas = document.createElement('canvas')
        canvas.width = 320
        canvas.height = 240
        const fallbackStream = canvas.captureStream(1)
        
        return fallbackStream
      } catch (fallbackError) {
        console.error('🔧 ❌ Error creating fallback video track:', fallbackError)
        return new MediaStream()
      }
    }
  }
  // Reconnect to call - manually reset and reconnect all WebRTC connections
  const reconnectCall = async () => {
    if (!joined || reconnecting) return
    
    setReconnecting(true)
    setError("")
    console.log("Manual reconnection initiated...")
    
    // FIRST: Stop ALL media tracks and clean up properly
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        console.log('Reconnect: Stopping audio track:', track.label)
        track.stop()
      })
      localStreamRef.current = null
    }
    
    if (localVideoStreamRef.current) {
      localVideoStreamRef.current.getTracks().forEach(track => {
        console.log('Reconnect: Stopping video track:', track.label)
        track.stop()
      })
      localVideoStreamRef.current = null
    }
    setVideoEnabled(false)
    
    if (localScreenStreamRef.current) {
      localScreenStreamRef.current.getTracks().forEach(track => {
        console.log('Reconnect: Stopping screen share track:', track.label)
        track.stop()
      })
      localScreenStreamRef.current = null
    }
    setScreenSharing(false)
    
    // Clear audio element source
    if (localAudioRef.current) {
      localAudioRef.current.srcObject = null
    }
    
    console.log("Reconnect: All media tracks stopped and cleaned up")
    
    try {
      // Store only muted state to restore after reconnection
      const wasMuted = muted
      
      // Close all existing peer connections
      Object.values(peerConnections.current).forEach(pc => {
        console.log('Closing peer connection:', pc.signalingState)
        pc.close()
      })
      peerConnections.current = {}
      
      // Clear remote streams but keep participants list
      setRemoteStreams({})
      setRemoteVideoStreams({})
      setRemoteScreenStreams({})
      // Reset expanded participants
      setExpandedParticipants(new Set())
      setLocalPreviewExpanded(false)
      
      // Close and recreate WebSocket connection
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
      
      // Wait a moment for cleanup
      await new Promise(resolve => setTimeout(resolve, 500))
      
      // Recreate media streams
      let newLocalStream: MediaStream | null = null
      
      // Always create an audio stream - either real microphone or arbitrary track
      if (!wasMuted) {
        try {
          // Request microphone permission again
          newLocalStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
          localStreamRef.current = newLocalStream
          if (localAudioRef.current) {
            localAudioRef.current.srcObject = newLocalStream
          }
          newLocalStream.getAudioTracks().forEach(track => {
            track.enabled = true
            console.log('Reconnect: Real audio track enabled:', track.label)
          })
          setMuted(false)
          console.log('Reconnect: Microphone access granted successfully')
        } catch (err) {
          console.warn("Reconnect: Mic access denied, creating arbitrary audio track:", err)
          // Create arbitrary audio track to establish WebRTC connection
          newLocalStream = createArbitraryAudioTrack()
          localStreamRef.current = newLocalStream
          if (localAudioRef.current) {
            localAudioRef.current.srcObject = newLocalStream
          }
          // Keep the arbitrary track enabled but set UI to muted
          newLocalStream.getAudioTracks().forEach(track => {
            track.enabled = true
            console.log('Reconnect: Arbitrary audio track enabled for WebRTC:', track.label)
          })
          setMuted(true)
          setError("Microphone access denied. Reconnected but others won't hear you. Click unmute to grant microphone permission.")
        }
      } else {
        // Even if muted, create an arbitrary audio track for WebRTC connection establishment
        console.log("Reconnect: Creating arbitrary audio track for muted user")
        newLocalStream = createArbitraryAudioTrack()
        localStreamRef.current = newLocalStream
        if (localAudioRef.current) {
          localAudioRef.current.srcObject = newLocalStream
        }
        // Keep audio track enabled for WebRTC but UI shows muted
        newLocalStream.getAudioTracks().forEach(track => {
          track.enabled = true // Keep enabled for WebRTC connection
          console.log('Reconnect: Arbitrary audio track enabled for WebRTC (was muted):', track.label)
        })
        setMuted(true) // UI shows muted
      }      // Always create arbitrary video track for WebRTC connection establishment (no camera access requested)
      // Video and screen sharing will be disabled after connection establishment
      let reconnectVideoStream: MediaStream | null = null
      console.log('Reconnect: Creating arbitrary video track for WebRTC establishment (no camera access requested)')
      reconnectVideoStream = createArbitraryVideoTrack()
      localVideoStreamRef.current = reconnectVideoStream
      console.log('Reconnect: Arbitrary video track created for WebRTC establishment')
      // Set video enabled temporarily for connection establishment
      setVideoEnabled(true)
      
      // Always disable video and screen sharing after connection establishment
      // regardless of previous state (only restore muted state)
      setTimeout(() => {
        // Stop arbitrary video track
        if (localVideoStreamRef.current) {
          localVideoStreamRef.current.getTracks().forEach(track => {
            if (track.label === 'Arbitrary Video Track') {
              track.stop()
            }
          })
          localVideoStreamRef.current = null
        }
        setVideoEnabled(false)
        
        // Ensure screen sharing is also disabled
        if (localScreenStreamRef.current) {
          localScreenStreamRef.current.getTracks().forEach(track => track.stop())
          localScreenStreamRef.current = null
        }
        setScreenSharing(false)
        
        console.log('Reconnect: Video and screen sharing disabled after connection establishment')
      }, 2000)
      
      // Reconnect WebSocket
      const ws = new WebSocket(SIGNALING_SERVER_URL)
      wsRef.current = ws
        ws.onopen = () => {
        console.log('Reconnect: WebSocket reconnected')
        ws.send(JSON.stringify({ type: "call-join", roomId, username: currentUser, isListener: false }))
        setJoined(true) // Ensure we stay in the call
        setReconnecting(false)
      }
      
      // Reuse the same message handler as joinCall
      ws.onmessage = async (event) => {
        const msg = JSON.parse(event.data)
        switch (msg.type) {
          case "call-new-peer": {
            const newPeer = msg.username
            if (newPeer === currentUser) return
            
            // Add to participants list (might already be there)
            setParticipants(prev => new Set([...prev, newPeer]))
            
            let pc = peerConnections.current[newPeer]
            if (!pc) {
              pc = createPeerConnection(newPeer)
            }
            
            // Check if we have any media to share
            const hasAudio = localStreamRef.current && localStreamRef.current.getTracks().length > 0
            const hasVideo = localVideoStreamRef.current && localVideoStreamRef.current.getTracks().length > 0
            const hasScreenShare = localScreenStreamRef.current && localScreenStreamRef.current.getTracks().length > 0
            const hasAnyMedia = hasAudio || hasVideo || hasScreenShare
            
            // Perfect negotiation: Only create offer if we're the impolite peer
            const isImpolite = currentUser > newPeer
            const shouldCreateOffer = !actualIsListener && isImpolite && hasAnyMedia
            
            if (shouldCreateOffer) {
              setTimeout(async () => {
                if (pc && pc.signalingState === 'stable') {
                  try {
                    console.log(`Reconnect: Creating offer for peer ${newPeer}`)
                    const offer = await pc.createOffer()
                    await pc.setLocalDescription(offer)
                    ws.send(JSON.stringify({ 
                      type: "call-offer", 
                      roomId, 
                      from: currentUser, 
                      to: newPeer, 
                      payload: pc.localDescription 
                    }))
                  } catch (error) {
                    console.error('Reconnect: Error creating offer:', error)
                  }
                }
              }, 100)
            }
            break
          }
          
          // Handle other message types (same as joinCall)
          case "call-offer": {
            const from = msg.from
            let pc = peerConnections.current[from]
            if (!pc) {
              pc = createPeerConnection(from)
            }
            
            const isPolite = currentUser < from
            const result = await safeSetRemoteDescription(pc, msg.payload, isPolite)
            
            if (result === 'recreate') {
              await recreatePeerConnection(from)
              pc = peerConnections.current[from]
              if (pc) {
                await safeSetRemoteDescription(pc, msg.payload, isPolite)
              }
            } else if (result === 'ignored') {
              console.log(`Reconnect: Offer from ${from} was ignored due to collision`)
              break
            }
            
            if (pc && pc.signalingState !== 'closed' && result === 'success') {
              try {
                const answer = await pc.createAnswer()
                await pc.setLocalDescription(answer)
                ws.send(JSON.stringify({ 
                  type: "call-answer", 
                  roomId, 
                  from: currentUser, 
                  to: from, 
                  payload: pc.localDescription 
                }))
              } catch (error) {
                console.error('Reconnect: Error creating answer:', error)
              }
            }
            break
          }
          
          case "call-answer": {
            const from = msg.from
            const pc = peerConnections.current[from]
            if (pc) {
              if (pc.signalingState === 'have-local-offer') {
                const result = await safeSetRemoteDescription(pc, msg.payload, currentUser < from)
                if (result === 'recreate') {
                  await recreatePeerConnection(from)
                }
              } else {
                console.log(`Reconnect: Unexpected answer from ${from} in state ${pc.signalingState}`)
              }
            }
            break
          }
          
          case "call-ice": {
            const from = msg.from
            const pc = peerConnections.current[from]
            if (pc && msg.payload) {
              try { 
                await pc.addIceCandidate(new RTCIceCandidate(msg.payload)) 
              } catch (error) {
                console.error('Reconnect: ICE candidate error:', error)
              }
            }
            break
          }
          
          case "call-peer-left": {
            const left = msg.username
            setParticipants(prev => {
              const newSet = new Set(prev)
              newSet.delete(left)
              return newSet
            })
            
            if (peerConnections.current[left]) {
              peerConnections.current[left].close()
              delete peerConnections.current[left]
            }
            
            setRemoteStreams(prev => {
              const copy = { ...prev }
              delete copy[left]
              return copy
            })
            setRemoteVideoStreams(prev => {
              const copy = { ...prev }
              delete copy[left]
              return copy
            })
            setRemoteScreenStreams(prev => {
              const copy = { ...prev }
              delete copy[left]
              return copy
            })
            setRemoteSystemAudioStreams(prev => {
              const copy = { ...prev }
              delete copy[left]
              return copy
            })
            
            // Remove from expanded participants if they left
            setExpandedParticipants(prev => {
              const newSet = new Set(prev)
              newSet.delete(left)
              return newSet
            })
            break
          }
        }
      }
        ws.onclose = () => {
        console.log('Reconnect: WebSocket closed')
        // Don't set joined to false during reconnection - keep the user in the call UI
        if (!reconnecting) {
          setJoined(false)
        }
        setReconnecting(false)
      }
      
      ws.onerror = (error) => {
        console.error('Reconnect: WebSocket error:', error)
        setError("Reconnection failed: WebSocket error")
        setReconnecting(false)
      }
      
    } catch (error) {
      console.error('Reconnection failed:', error)
      setError("Reconnection failed. Please try again.")
      setReconnecting(false)
    }
  }

  // Update document title when component mounts/unmounts
  useEffect(() => {
    // Set title to show we're in a call
    document.title = `Ucucu - Call`;

    // Cleanup: Reset title when component unmounts (user leaves call)
    return () => {
      document.title = "Ucucu";
    };
  }, []);

  return (
    <div className="h-screen bg-white flex flex-col">      <header className="bg-white border-b border-gray-200 px-4 py-3 flex-shrink-0">
        <div className="flex items-center justify-between gap-2 w-full flex-nowrap">
          <div className="flex items-center gap-2 min-w-0 flex-shrink">
            <Button variant="ghost" size="sm" onClick={() => router.push(`/${encodeURIComponent(roomId)}/chat`)}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <h1 className="font-semibold text-gray-900 truncate max-w-[80px]">Call</h1>
            <p className="text-xs text-gray-500 truncate max-w-[80px]">/{roomId}</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0 min-w-0">
            {/* Reconnect Button - only show when joined */}
            {joined && (
              <Button
                size="sm"
                variant="outline"
                onClick={reconnectCall}
                disabled={reconnecting || connecting}
                className="flex items-center gap-1"
                title="Reconnect to resolve connection issues"
              >
                <RotateCcw className={`h-4 w-4 ${reconnecting ? 'animate-spin' : ''}`} />
                <span className="sm:inline">{reconnecting ? 'Reconnecting...' : 'Reconnect'}</span>
              </Button>
            )}
            
            {/* Fix Button - only show when there are connection issues */}
            {joined && Object.values(connectionHealth).some(health => health === 'failed' || health === 'disconnected') && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  console.log('🔧 MANUAL CONNECTION FIX TRIGGERED')
                  console.log('🔧 Current connection states:')
                  Object.entries(peerConnections.current).forEach(([peerId, pc]) => {
                    console.log(`  ${peerId}: connection=${pc.connectionState}, ice=${pc.iceConnectionState}, signaling=${pc.signalingState}`)
                  })
                  console.log('🔧 Health states:', connectionHealth)
                  
                  // Force all problematic connections to be marked as failed for immediate recreation
                  Object.entries(connectionHealth).forEach(([peerId, health]) => {
                    if (health === 'failed' || health === 'disconnected' || peerConnections.current[peerId]?.connectionState === 'new') {
                      console.log(`🔧 Forcing fix for ${peerId} (health: ${health})`)
                      setConnectionHealth(prev => ({ ...prev, [peerId]: 'failed' }))
                    }
                  })
                }}
                className="flex items-center gap-1 bg-yellow-50 border-yellow-200 text-yellow-700 hover:bg-yellow-100"
                title="Fix connection issues immediately"
              >
                🔧
                <span className="hidden sm:inline">Fix</span>
              </Button>
            )}
            
            <NotificationBell roomId={roomId} username={currentUser} />
          </div>
        </div>
      </header>
      <main className="flex-1 overflow-y-auto px-4 py-6 min-h-0">        {!joined ? (
          <div className="max-w-md mx-auto flex flex-col items-center gap-4">
            {connecting ? (
              // Connection Sequence Loading Indicator
              <div className="text-center space-y-6">
                <div className="text-center mb-4">
                  <h2 className="text-lg font-semibold mb-2">Connecting to Call</h2>
                  <p className="text-sm text-gray-600">Setting up your connection...</p>
                </div>
                
                {/* Progress Bar */}
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div 
                    className="bg-blue-600 h-2 rounded-full transition-all duration-500 ease-out"
                    style={{ width: `${connectionSequenceProgress}%` }}
                  ></div>
                </div>
                
                {/* Progress Text */}
                <div className="text-sm text-gray-600">
                  {connectionSequenceProgress < 20 && "Initializing audio foundation..."}
                  {connectionSequenceProgress >= 20 && connectionSequenceProgress < 40 && "Setting up video foundation..."}
                  {connectionSequenceProgress >= 40 && connectionSequenceProgress < 60 && "Requesting microphone access..."}
                  {connectionSequenceProgress >= 60 && connectionSequenceProgress < 80 && "Configuring media streams..."}
                  {connectionSequenceProgress >= 80 && connectionSequenceProgress < 90 && "Connecting to signaling server..."}
                  {connectionSequenceProgress >= 90 && connectionSequenceProgress < 100 && "Establishing peer connections..."}
                  {connectionSequenceProgress >= 100 && "Connection complete!"}
                </div>
                
                {/* Animated Spinner */}
                <div className="flex justify-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                </div>
                
                {/* Connection sequence status - only show during setup */}
                {!connectionSequenceComplete && (
                  <div className="text-xs text-gray-500 text-center space-y-2">
                    <p>Setting up reliable connection...</p>
                    <p>Video controls will appear once setup is complete.</p>
                  </div>
                )}
              </div>
            ) : (
              // Initial Join Screen
              <>
                <div className="text-center mb-4">
                  <h2 className="text-lg font-semibold mb-2">Join the Call</h2>
                  <p className="text-sm text-gray-600">Choose how you want to join</p>
                </div>
                  <div className="w-full space-y-3">
                  <Button onClick={() => joinCall()} disabled={connecting} className="w-full">
                    <Mic className="h-5 w-5 mr-2" /> Join Call
                  </Button>
                </div>
                
                <div className="text-xs text-gray-500 text-center">
                  Microphone permission will be requested automatically.<br/>
                  If denied, you&apos;ll join muted and can unmute to try again.
                </div>
              </>
            )}
            
            {error && <div className="text-red-600 text-sm mt-4 p-3 bg-red-50 rounded">{error}</div>}
          </div>) : (
          <div className="h-full flex flex-col min-h-0 space-y-4">            
          {/* Control Panel */}
            <div className="bg-gray-50 rounded-lg p-3 flex-shrink-0">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="text-sm font-medium text-gray-700 flex items-center gap-2">
                  Controls
                  {/* Show loading indicator during connection sequence */}
                  {!connectionSequenceComplete && (
                    <div className="flex items-center gap-2 text-blue-600">
                      <div className="animate-spin rounded-full h-3 w-3 border-b border-blue-600"></div>
                      <span className="text-xs">Setting up...</span>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-wrap">{/* Audio Controls */}
                  {!actualIsListener && (
                    <Button
                      size="sm"
                      variant={muted ? "destructive" : "outline"}
                      onClick={handleMute}
                      className="flex items-center gap-1"
                    >
                      {muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                      <span className="hidden sm:inline">{muted ? "Unmute" : "Mic"}</span>
                    </Button>
                  )}
                    {/* Video Controls - only show after connection sequence is complete */}
                  {!actualIsListener && connectionSequenceComplete && (
                    <Button
                      size="sm"
                      variant={videoEnabled ? "default" : "outline"}
                      onClick={toggleVideo}
                      className="flex items-center gap-1"
                    >
                      {videoEnabled ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
                      <span className="hidden sm:inline">Video</span>
                    </Button>
                  )}
                    {/* Camera Switch Controls - only show when video is enabled and sequence complete */}
                  {!actualIsListener && videoEnabled && connectionSequenceComplete && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={switchCamera}
                      className="flex items-center gap-1"
                      title={`Switch to ${currentCamera === 'user' ? 'back' : 'front'} camera`}
                    >
                      <RefreshCw className="h-4 w-4" />
                      <span className="hidden sm:inline">Flip</span>
                    </Button>
                  )}
                  
                  {/* Mirror Toggle Controls - only show when video is enabled and sequence complete */}
                  {!actualIsListener && videoEnabled && connectionSequenceComplete && (
                    <Button
                      size="sm"
                      variant={isMirrored ? "default" : "outline"}
                      onClick={toggleMirror}
                      className="flex items-center gap-1"
                      title={`${isMirrored ? 'Disable' : 'Enable'} mirror effect for your video`}
                    >
                      <FlipHorizontal className="h-4 w-4" />
                      <span className="hidden sm:inline">Mirror</span>
                    </Button>
                  )}
                    {/* Screen Share Controls */}
                  {!actualIsListener && (
                    <Button
                      size="sm"
                      variant={screenSharing ? "default" : "outline"}
                      onClick={toggleScreenShare}
                      className="flex items-center gap-1"
                    >
                      {screenSharing ? <Monitor className="h-4 w-4" /> : <MonitorOff className="h-4 w-4" />}
                      <span className="hidden sm:inline">Screen</span>
                    </Button>
                  )}
                  
                  {/* Leave Call */}
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={leaveCall}
                    className="flex items-center gap-1"
                  >
                    <Phone className="h-4 w-4" />
                    <span className="hidden sm:inline">Leave</span>
                  </Button>
                </div>
              </div>
                {/* Local Speaking Indicator */}
              {!actualIsListener && (
                <div className={`mt-2 text-xs text-green-600 flex items-center gap-1 transition-opacity ${
                  localSpeaking ? 'opacity-100' : 'opacity-0'
                }`}>
                  <Volume2 className="h-3 w-3" />
                  <span>You are speaking</span>
                </div>
              )}            </div>

            {/* Participants Grid */}
            <div className="flex-1 overflow-y-auto">
              <div className="font-semibold mb-4 text-sm">Participants</div>
              
              <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
                {/* Local Video Preview Card */}
                {videoEnabled && localVideoStreamRef.current && (
                  <div
                    className={`bg-gray-50 rounded-lg p-2 sm:p-3 border-2 transition-all cursor-pointer ${
                      localPreviewExpanded ? 'border-blue-500 bg-blue-50 col-span-2 sm:col-span-2' : 'border-transparent hover:border-gray-300'
                    }`}
                    onClick={() => setLocalPreviewExpanded(!localPreviewExpanded)}
                  >
                    {/* Local Video Container */}
                    <div className="relative bg-black rounded mb-2 sm:mb-3 aspect-video">
                      <video
                        ref={localVideoRef}
                        autoPlay
                        playsInline
                        muted
                        className="w-full h-full object-cover rounded"
                        style={{ transform: isMirrored ? 'scaleX(-1)' : 'none' }}
                      />
                      
                      {/* Local video indicator */}
                      <div className="absolute top-2 right-2 bg-blue-500 text-white p-1 rounded">
                        <Video className="h-3 w-3" />
                      </div>
                        {/* Expanded indicator */}
                      {/* {localPreviewExpanded && (
                        <div className="absolute top-2 left-2 bg-blue-500 w-3 h-3 rounded-full"></div>
                      )} */}
                    </div>
                      {/* Local Video Name and Controls */}
                    <div className="flex items-center justify-between mb-1 sm:mb-2">
                      <div className={`font-medium text-gray-900 truncate ${
                        localPreviewExpanded ? 'text-sm sm:text-base' : 'text-xs sm:text-sm'
                      }`}>
                        {currentUser} (Video)
                      </div>
                      
                      {/* Camera Switch Button */}
                      {/* {!actualIsListener && videoEnabled && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(e) => {
                            e.stopPropagation()
                            switchCamera()
                          }}
                          className="p-1 h-6 w-6 sm:h-7 sm:w-7"
                          title={`Switch to ${currentCamera === 'user' ? 'back' : 'front'} camera`}
                        >
                          <RotateCcw className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
                        </Button>
                      )} */}
                    </div>
                    
                    {/* Local Speaking Indicator */}
                    <div className={`flex items-center text-xs text-green-600 transition-opacity ${
                      localSpeaking ? 'opacity-100' : 'opacity-10'
                    }`}>
                      <Volume2 className="h-2.5 w-2.5 sm:h-3 sm:w-3 mr-1" />
                      <span className="text-xs">Speaking</span>
                    </div>
                  </div>
                )}

                {/* Local Screen Share Preview Card */}
                {screenSharing && localScreenStreamRef.current && (
                  <div
                    className={`bg-gray-50 rounded-lg p-2 sm:p-3 border-2 transition-all cursor-pointer ${
                      localPreviewExpanded ? 'border-green-500 bg-green-50 col-span-2 sm:col-span-2' : 'border-transparent hover:border-gray-300'
                    }`}
                    onClick={() => setLocalPreviewExpanded(!localPreviewExpanded)}
                  >
                    {/* Local Screen Container */}
                    <div className="relative bg-black rounded mb-2 sm:mb-3 aspect-video">
                      <video
                        ref={localScreenRef}
                        autoPlay
                        playsInline
                        muted
                        className="w-full h-full object-contain rounded bg-gray-900"
                      />
                      
                      {/* Screen share indicator */}
                      <div className="absolute top-2 right-2 bg-green-500 text-white p-1 rounded">
                        <Monitor className="h-3 w-3" />
                      </div>
                        {/* Expanded indicator */}
                   {/* {localPreviewExpanded && (
                        <div className="absolute top-2 left-2 bg-green-500 w-3 h-3 rounded-full"></div>
                      )}    */}
                    </div>
                    
                    {/* Local Screen Name and Controls */}
                    <div className="flex items-center justify-between mb-1 sm:mb-2">
                      <div className={`font-medium text-gray-900 truncate ${
                        localPreviewExpanded ? 'text-sm sm:text-base' : 'text-xs sm:text-sm'
                      }`}>
                        {currentUser} (Screen)
                      </div>
                    </div>
                    
                    {/* Empty space for consistency */}
                    <div className="flex items-center text-xs opacity-10">
                      <Monitor className="h-2.5 w-2.5 sm:h-3 sm:w-3 mr-1" />
                      <span className="text-xs">Sharing</span>
                    </div>
                  </div>
                )}                {participants.size === 0 ? (
                  // Show empty state only if no participants AND no local preview cards
                  !(videoEnabled && localVideoStreamRef.current) && 
                  !(screenSharing && localScreenStreamRef.current) && (
                    <div className="col-span-2 sm:col-span-2 lg:col-span-3 xl:col-span-4 text-gray-400 text-sm text-center py-8">
                      No one else in the call yet.
                    </div>
                  )
                ) : (
                  /* Remote Participants */
                  Array.from(participants).map(peer => {
                    const isExpanded = expandedParticipants.has(peer);
                    const hasVideo = remoteVideoStreams[peer];
                    const hasScreenShare = remoteScreenStreams[peer];
                    
                    return (
                      <div
                        key={peer}
                        className={`bg-gray-50 rounded-lg p-2 sm:p-3 border-2 transition-all cursor-pointer ${
                          isExpanded ? 'border-blue-500 bg-blue-50 col-span-2 sm:col-span-2' : 'border-transparent hover:border-gray-300'
                        }`}
                        onClick={() => {
                          setExpandedParticipants(prev => {
                            const newSet = new Set(prev)
                            if (isExpanded) {
                              newSet.delete(peer)
                            } else {
                              newSet.add(peer)
                            }
                            return newSet
                          })
                        }}
                      >
                        {/* Participant Video Container */}
                        <div 
                          className="relative bg-black rounded mb-2 sm:mb-3 aspect-video"
                        >
                          {hasVideo ? (
                            <video
                              ref={remoteVideoRefs.current[peer]}
                              autoPlay
                              playsInline
                              className="w-full h-full object-cover rounded"
                            />
                          ) : hasScreenShare ? (
                            <video
                              ref={remoteScreenRefs.current[peer]}
                              autoPlay
                              playsInline
                              className="w-full h-full object-contain rounded bg-gray-900"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-white">
                              <div className={`bg-gray-600 rounded-full flex items-center justify-center ${
                                isExpanded ? 'w-12 h-12 sm:w-16 sm:h-16' : 'w-8 h-8 sm:w-12 sm:h-12'
                              }`}>
                                <span className={`font-semibold ${isExpanded ? 'text-lg sm:text-xl' : 'text-sm sm:text-lg'}`}>
                                  {peer[0]?.toUpperCase()}
                                </span>
                              </div>
                            </div>
                          )}
                          
                          {/* Screen share indicator */}
                          {hasScreenShare && (
                            <div className="absolute top-2 right-2 bg-green-500 text-white p-1 rounded">
                              <Monitor className="h-3 w-3" />
                            </div>
                          )}
                            {/* Expanded indicator */}
                          {/* {isExpanded && (
                            <div className="absolute top-2 left-2 bg-blue-500 w-3 h-3 rounded-full"></div>
                          )} */}
                        </div>
                          {/* Participant Name and Controls */}
                        <div className="flex items-center justify-between mb-1 sm:mb-2">
                          <div className={`font-medium text-gray-900 truncate ${
                            isExpanded ? 'text-sm sm:text-base' : 'text-xs sm:text-sm'
                          }`}>
                            {peer}
                            {/* Enhanced Connection Health Indicator with detailed feedback */}
                            <span className={`ml-2 inline-flex items-center gap-1`}>
                              <span className={`inline-block w-2 h-2 rounded-full ${
                                connectionHealth[peer] === 'connected' ? 'bg-green-500' :
                                connectionHealth[peer] === 'connecting' ? 'bg-yellow-500 animate-pulse' :
                                connectionHealth[peer] === 'failed' ? 'bg-red-500 animate-bounce' :
                                connectionHealth[peer] === 'disconnected' ? 'bg-orange-500' :
                                'bg-gray-400'
                              }`} title={`Connection: ${connectionHealth[peer] || 'unknown'}`}></span>
                              {/* Show state text for failed/problematic connections */}
                              {(connectionHealth[peer] === 'failed' || connectionHealth[peer] === 'disconnected') && (
                                <span className="text-xs text-red-600 font-medium">
                                  {connectionHealth[peer] === 'failed' ? 'Reconnecting...' : 'Lost'}
                                </span>
                              )}
                            </span>
                          </div>
                          
                          <div className="flex items-center gap-1">
                            {/* Fullscreen Button */}
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={(e) => {
                                e.stopPropagation()
                                enterFullscreen(peer)
                              }}
                              className="p-1 h-6 w-6 sm:h-7 sm:w-7"
                              title={`Enter fullscreen for ${peer}`}
                            >
                              <Maximize className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
                            </Button>
                            
                            {/* Mute Button */}
                            <Button
                              size="sm"
                              variant={peerMuted[peer] ? "destructive" : "ghost"}
                              onClick={(e) => {
                                e.stopPropagation()
                                togglePeerMute(peer)
                              }}
                              className="p-1 h-6 w-6 sm:h-7 sm:w-7"
                            >
                              <MicOff className="h-2.5 w-2.5 sm:h-3 sm:w-3" style={{ display: peerMuted[peer] ? 'block' : 'none' }} />
                              <Mic className="h-2.5 w-2.5 sm:h-3 sm:w-3" style={{ display: peerMuted[peer] ? 'none' : 'block' }} />
                            </Button>
                          </div>
                        </div>
                        
                        {/* Speaking Indicator */}
                        <div className={`flex items-center text-xs text-green-600 transition-opacity ${
                          speakingPeers[peer] ? 'opacity-100' : 'opacity-10'
                        }`}>
                          <Volume2 className="h-2.5 w-2.5 sm:h-3 sm:w-3 mr-1" />
                          <span className="text-xs">Speaking</span>
                        </div>
                        
                        {/* Hidden audio element */}
                        <audio
                          ref={remoteAudioRefs.current[peer]}
                          autoPlay
                          playsInline
                          controls={false}
                          muted={!!peerMuted[peer]}
                          className="hidden"
                        />
                        
                        {/* Hidden system audio element */}
                        <audio
                          ref={remoteSystemAudioRefs.current[peer]}
                          autoPlay
                          playsInline
                          controls={false}
                          muted={false}
                          className="hidden"
                        />
                      </div>
                    );
                  })
                )}
              </div>
            </div>
            
            {/* Hidden local audio element */}
            {!actualIsListener && (
              <audio ref={localAudioRef} autoPlay controls={false} muted={true} className="hidden" />
            )}
            
            {/* Hidden local system audio element */}
            {!actualIsListener && (
              <audio ref={localSystemAudioRef} autoPlay controls={false} muted={true} className="hidden" />
            )}
          </div>
        )}
      </main>
    </div>
  )
}
