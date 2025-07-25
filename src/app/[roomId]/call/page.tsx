"use client"

import React, { useEffect, useRef, useState } from "react"
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
  
  // Add state for camera switching
  const [currentCamera, setCurrentCamera] = useState<'user' | 'environment'>('user') // 'user' = front, 'environment' = back
  
  // Add state for camera mirror functionality
  const [isMirrored, setIsMirrored] = useState(true) // Default to mirrored for front camera

  const analyserRef = useRef<AnalyserNode | null>(null)
  const localAudioContextRef = useRef<AudioContext | null>(null)  // For each participant, create refs for audio, video, and screen
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
            
            // Replace tracks in all existing peer connections
            Object.values(peerConnections.current).forEach(pc => {
              // Remove old arbitrary tracks
              pc.getSenders().forEach(sender => {
                if (sender.track && sender.track.kind === 'audio') {
                  pc.removeTrack(sender)
                }
              })
              
              // Add new real microphone tracks
              newStream.getAudioTracks().forEach(track => {
                pc.addTrack(track, newStream)
              })
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

  const recreatePeerConnection = async (peerId: string) => {
    console.log(`Recreating peer connection for ${peerId}`)
    
    // Close existing connection
    if (peerConnections.current[peerId]) {
      peerConnections.current[peerId].close()
      delete peerConnections.current[peerId]
    }
    
    // Create new connection
    const newPc = createPeerConnection(peerId)
    
    // Trigger new negotiation
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
    } catch (error) {
      console.error('Error in recreated peer connection offer:', error)
    }
  }

  function createPeerConnection(remote: string) {
    const pc = new RTCPeerConnection(ICE_CONFIG)
    peerConnections.current[remote] = pc
    
    pc.onicecandidate = (e) => {
      if (e.candidate && wsRef.current) {
        wsRef.current.send(JSON.stringify({ type: "call-ice", roomId, from: currentUser, to: remote, payload: e.candidate }))
      }
    }
    
    pc.ontrack = (e) => {
      const track = e.track
      const stream = e.streams[0]
      
      console.log('Received track:', track.kind, track.label, 'from', remote)
      
      if (track.kind === 'audio') {
        // Distinguish between microphone and system audio based on track label or custom property
        const isSystemAudio = ('isSystemAudio' in track && (track as { isSystemAudio: boolean }).isSystemAudio) ||
                             track.label.toLowerCase().includes('system audio') ||
                             track.label.toLowerCase().includes('screen') ||
                             track.label.toLowerCase().includes('monitor') ||
                             track.label.toLowerCase().includes('display') ||
                             track.label.toLowerCase().includes('desktop')
        
        console.log('Audio track analysis:', {
          trackLabel: track.label,
          hasSystemAudioProperty: 'isSystemAudio' in track,
          isSystemAudioValue: ('isSystemAudio' in track) ? (track as { isSystemAudio: boolean }).isSystemAudio : undefined,
          isSystemAudio: isSystemAudio,
          remote: remote
        })
        
        if (isSystemAudio) {
          console.log('✅ Setting as system audio for', remote, 'label:', track.label)
          setRemoteSystemAudioStreams(prev => ({ ...prev, [remote]: stream }))
        } else {
          console.log('🎤 Setting as microphone audio for', remote, 'label:', track.label)
          setRemoteStreams(prev => ({ ...prev, [remote]: stream }))
        }
      } else if (track.kind === 'video') {
        // Check track label or use track settings to determine if it's screen share
        // Screen share tracks typically have labels containing 'screen' or have specific constraints
        const isScreenShare = track.label.toLowerCase().includes('screen') || 
                             track.label.toLowerCase().includes('monitor') ||
                             track.label.toLowerCase().includes('display') ||
                             track.getSettings().displaySurface === 'monitor'
        
        if (isScreenShare) {
          console.log('Setting as screen share for', remote)
          setRemoteScreenStreams(prev => ({ ...prev, [remote]: stream }))
        } else {
          console.log('Setting as video for', remote)
          setRemoteVideoStreams(prev => ({ ...prev, [remote]: stream }))
        }
      }
    }
    
    // --- ADD: Always add local tracks to new peer connection if available ---
    // IMPORTANT: Add tracks in consistent order to avoid m-line ordering issues
    console.log(`Creating peer connection for ${remote}. Adding tracks in order:`)
    
    // 1. First add microphone audio tracks (highest priority)
    if (localStreamRef.current) {
      console.log(`- Adding ${localStreamRef.current.getTracks().length} microphone audio tracks`)
      localStreamRef.current.getTracks().forEach(track => {
        if (track.kind === 'audio' && !pc.getSenders().some(sender => sender.track === track)) {
          pc.addTrack(track, localStreamRef.current!)
          console.log(`  - Added microphone audio track: ${track.label}, enabled: ${track.enabled}`)
        }
      })
    }
    
    // 2. Then add system audio tracks (if available)
    if (localSystemAudioStreamRef.current) {
      console.log(`- Adding ${localSystemAudioStreamRef.current.getTracks().length} system audio tracks`)
      localSystemAudioStreamRef.current.getTracks().forEach(track => {
        if (track.kind === 'audio' && !pc.getSenders().some(sender => sender.track === track)) {
          pc.addTrack(track, localSystemAudioStreamRef.current!)
          console.log(`  - Added system audio track: ${track.label}, enabled: ${track.enabled}`)
        }
      })
    }
    
    // 3. Then add regular video tracks
    if (localVideoStreamRef.current) {
      console.log(`- Adding ${localVideoStreamRef.current.getTracks().length} video tracks`)
      localVideoStreamRef.current.getTracks().forEach(track => {
        if (track.kind === 'video' && !pc.getSenders().some(sender => sender.track === track)) {
          pc.addTrack(track, localVideoStreamRef.current!)
          console.log(`  - Added video track: ${track.label}`)
        }
      })
    }
    
    // 4. Finally add screen share tracks
    if (localScreenStreamRef.current) {
      console.log(`- Adding ${localScreenStreamRef.current.getTracks().length} screen share tracks`)
      localScreenStreamRef.current.getTracks().forEach(track => {
        if (!pc.getSenders().some(sender => sender.track === track)) {
          pc.addTrack(track, localScreenStreamRef.current!)
          console.log(`  - Added screen share track: ${track.label}`)
        }
      })
    }
    
    console.log(`Peer connection for ${remote} created with ${pc.getSenders().length} senders`)
    
    return pc
  }

// Join call room
  const joinCall = async () => {
    setConnecting(true)
    setError("")
    let localStream: MediaStream | null = null
    let localVideoStream: MediaStream | null = null
    
    // Always try to get microphone permission
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      localStreamRef.current = localStream
      if (localAudioRef.current) {
        localAudioRef.current.srcObject = localStream
      }
      // Ensure audio tracks are enabled
      localStream.getAudioTracks().forEach(track => {
        track.enabled = true
        console.log('Audio track enabled:', track.label, track.enabled)
      })
      // Start unmuted if permission granted
      setMuted(false)
    } catch (err) {
      console.warn("Mic access denied, creating arbitrary audio track:", err)
      // Create arbitrary audio track to establish WebRTC connection
      localStream = createArbitraryAudioTrack()
      localStreamRef.current = localStream
      if (localAudioRef.current) {
        localAudioRef.current.srcObject = localStream
      }
      // Keep the arbitrary audio track enabled for WebRTC connection establishment
      // but set the UI state to muted so user knows they need to grant permission
      setMuted(true) // Set UI state to muted
      localStream.getAudioTracks().forEach(track => {
        track.enabled = true // Keep track enabled for WebRTC
        console.log('Join: Arbitrary audio track created and enabled for WebRTC:', track.label)
      })
      setError("Microphone access denied. You can still hear others. Click unmute to grant microphone permission.")
    }
    
    // Always use arbitrary video track at startup for WebRTC connection establishment
    console.log('Creating arbitrary video track for WebRTC establishment (no camera access requested)')
    localVideoStream = createArbitraryVideoTrack()
    localVideoStreamRef.current = localVideoStream
    console.log('Join: Arbitrary video track created for WebRTC establishment')
    // Set video enabled temporarily for connection establishment
    setVideoEnabled(true)
    
    // Keep arbitrary video track longer to ensure proper peer connections
    setTimeout(() => {
      if (localVideoStreamRef.current) {
        const hasArbitraryTrack = localVideoStreamRef.current.getTracks().some(track => 
          track.label === 'Arbitrary Video Track'
        )
        
        if (hasArbitraryTrack) {
          console.log('Keeping arbitrary video track for better WebRTC connectivity')
          // Don't stop arbitrary tracks immediately - keep them for connection stability
        }
      }
      setVideoEnabled(false)
      console.log('Video UI disabled but arbitrary tracks kept for connectivity')
    }, 5000) // Increased timeout for better connectivity
    
    // Always join as a normal participant (never as listener)
    setActualIsListener(false)
      // Connect to signaling
    const ws = new WebSocket(SIGNALING_SERVER_URL)
    wsRef.current = ws
    
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "call-join", roomId, username: currentUser, isListener: false }))
      setJoined(true)
      setConnecting(false)
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
            pc = createPeerConnection(newPeer)
          }
          
          // Check if we have any media to share (audio, video, or screen) - check actual streams not state
          const hasAudio = localStreamRef.current && localStreamRef.current.getTracks().length > 0
          const hasVideo = localVideoStreamRef.current && localVideoStreamRef.current.getTracks().length > 0
          const hasScreenShare = localScreenStreamRef.current && localScreenStreamRef.current.getTracks().length > 0
          
          // Perfect negotiation: Only create offer if we're the impolite peer (larger username)
          // IMPORTANT: Always establish connection even without real media (arbitrary tracks count as media)
          const isImpolite = currentUser > newPeer
          const shouldCreateOffer = !actualIsListener && isImpolite // Removed hasAnyMedia condition
          
          if (shouldCreateOffer) {
            // Add a small delay to let the polite peer potentially start negotiation first
            setTimeout(async () => {
              // Check if negotiation hasn't started yet
              if (pc && pc.signalingState === 'stable') {
                try {
                  console.log(`Creating offer for new peer ${newPeer}. Media: audio=${hasAudio}, video=${hasVideo}, screen=${hasScreenShare}`)
                  const offer = await pc.createOffer()
                  await pc.setLocalDescription(offer)
                  ws.send(JSON.stringify({ type: "call-offer", roomId, from: currentUser, to: newPeer, payload: pc.localDescription }))
                } catch (error) {
                  console.error('Error creating offer for new peer:', error)
                }
              }
            }, 100) // Small delay to prevent race conditions
          } else {
            // If we're the polite peer but no offer comes, create one anyway after a longer delay
            setTimeout(async () => {
              if (pc && pc.signalingState === 'stable') {
                try {
                  console.log(`Polite peer ${currentUser} creating backup offer for ${newPeer} to ensure connection`)
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
          }          setRemoteStreams(prev => {
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
          console.error('Call WebSocket error:', msg.message)
          setError(msg.message || "An error occurred")
          
          // If the error has redirect information, redirect to the room
          if (msg.redirectTo) {
            console.log('Redirecting to room due to error:', msg.redirectTo)
            router.push(msg.redirectTo)
          }
          
          break
        }
      }
    }
    ws.onclose = () => setJoined(false)
    ws.onerror = () => setError("WebSocket error")
  }  // Leave call room
  const leaveCall = () => {
    // Send leave message to server
    if (wsRef.current && currentUser) {
      wsRef.current.send(JSON.stringify({ type: "call-peer-left", roomId, username: currentUser }))
    }
    
    // Close all peer connections
    Object.values(peerConnections.current).forEach(pc => pc.close())
    peerConnections.current = {}
    
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
    
    // Close WebSocket connection
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
      // Reset state
    setJoined(false)
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
    
    // Navigate back to chat
    router.push(`/${encodeURIComponent(roomId)}/chat`)  }
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
    return () => {
      Object.values(pcs).forEach(pc => pc.close())
      if (wsRef.current) wsRef.current.close()
      if (localStreamRef.current) localStreamRef.current.getTracks().forEach(t => t.stop())
      if (localVideoStreamRef.current) localVideoStreamRef.current.getTracks().forEach(t => t.stop())
      if (localScreenStreamRef.current) localScreenStreamRef.current.getTracks().forEach(t => t.stop())
      if (localSystemAudioStreamRef.current) localSystemAudioStreamRef.current.getTracks().forEach(t => t.stop())
    }
  }, [roomId])  // --- Mute/unmute a remote participant ---
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
        
        // Find existing video sender (non-screen)
        const existingVideoSender = pc.getSenders().find(sender =>
          sender.track && sender.track.kind === 'video' && !sender.track.label.includes('screen')
        )

        if (existingVideoSender) {
          // Use replaceTrack for seamless camera switch (no renegotiation needed)
          try {
            await existingVideoSender.replaceTrack(newVideoTrack)
            console.log(`Replaced camera track for ${remote}`)            
            // Set encoding parameters for ULTRA HIGH QUALITY streaming
            const parameters = existingVideoSender.getParameters()
            if (!parameters.encodings) {
              parameters.encodings = [{}]
            }
            // STREAMING PLATFORM QUALITY: High bitrate for 60fps smooth video
            if (parameters.encodings[0]) {
              parameters.encodings[0].maxBitrate = 4000000 // 4 Mbps for 60fps 1080p
              parameters.encodings[0].maxFramerate = 60    // 60fps streaming quality
              parameters.encodings[0].scaleResolutionDownBy = 1 // No downscaling
            }
            
            await existingVideoSender.setParameters(parameters)
            
            return // No renegotiation needed with replaceTrack
          } catch (error) {
            console.warn(`Failed to replace camera track for ${remote}, falling back to full renegotiation:`, error)
          }
        }

        // Fallback: Remove old tracks and add new ones (requires renegotiation)
        pc.getSenders().forEach(sender => {
          if (sender.track && sender.track.kind === 'video' && !sender.track.label.includes('screen')) {
            pc.removeTrack(sender)
          }
        })

        // Add new video tracks
        if (!pc.getSenders().some(sender => sender.track === newVideoTrack)) {
          pc.addTrack(newVideoTrack, stream)
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
      
      // Remove video tracks and trigger parallel renegotiation
      const renegotiationPromises = Object.entries(peerConnections.current).map(async ([remote, pc]) => {
        pc.getSenders().forEach(sender => {
          if (sender.track && sender.track.kind === 'video' && !sender.track.label.includes('screen')) {
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
          
          // Check for existing video track sender to use replaceTrack if possible
          const existingVideoSender = pc.getSenders().find(sender => 
            sender.track && sender.track.kind === 'video' && !sender.track.label.includes('screen')
          )
          
          if (existingVideoSender && existingVideoSender.track) {
            // Replace existing video track (avoids renegotiation)
            try {
              await existingVideoSender.replaceTrack(videoTrack)
              console.log(`Replaced video track for ${remote}`)
              return // No renegotiation needed
            } catch (error) {
              console.warn(`Failed to replace video track for ${remote}, falling back to addTrack:`, error)
            }
          }
          
          // Add new track if no existing track or replace failed
          if (!pc.getSenders().some(sender => sender.track === videoTrack)) {
            pc.addTrack(videoTrack, stream)
            console.log(`Added video track to peer connection: ${remote}`)
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
      // Turn off screen sharing
      if (localScreenStreamRef.current) {
        localScreenStreamRef.current.getTracks().forEach(track => track.stop())
        localScreenStreamRef.current = null
      }
      
      // Turn off system audio
      if (localSystemAudioStreamRef.current) {
        localSystemAudioStreamRef.current.getTracks().forEach(track => track.stop())
        localSystemAudioStreamRef.current = null
      }
      
      // Remove screen and system audio tracks and trigger parallel renegotiation
      const renegotiationPromises = Object.entries(peerConnections.current).map(async ([remote, pc]) => {
        // Remove screen video tracks
        pc.getSenders().forEach(sender => {
          if (sender.track && sender.track.kind === 'video' && 
              (sender.track.label.toLowerCase().includes('screen') || 
               sender.track.label.toLowerCase().includes('monitor') ||
               sender.track.label.toLowerCase().includes('display'))) {
            pc.removeTrack(sender)
          }
        })
        
        // Remove system audio tracks (but preserve microphone audio)
        const systemAudioSendersToRemove: RTCRtpSender[] = []
        pc.getSenders().forEach(sender => {
          if (sender.track && sender.track.kind === 'audio') {
            // Only remove if it's clearly identified as system audio
            const isSystemAudio = ('isSystemAudio' in sender.track && (sender.track as { isSystemAudio: boolean }).isSystemAudio) ||
                                 sender.track.label.toLowerCase().includes('system audio') ||
                                 sender.track.label.toLowerCase().includes('screen') ||
                                 sender.track.label.toLowerCase().includes('monitor') ||
                                 sender.track.label.toLowerCase().includes('display') ||
                                 sender.track.label.toLowerCase().includes('desktop')
            
            if (isSystemAudio) {
              console.log(`🗑️ Marking system audio track for removal: ${sender.track.label}`)
              systemAudioSendersToRemove.push(sender)
            } else {
              console.log(`🎤 Preserving microphone audio track: ${sender.track.label}`)
            }
          }
        })
        
        // Remove only the identified system audio senders
        systemAudioSendersToRemove.forEach(sender => {
          pc.removeTrack(sender)
          console.log(`✅ Removed system audio track: ${sender.track?.label}`)
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
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            frameRate: { ideal: 60 }, // 60fps for smooth screen sharing
            displaySurface: "monitor" // Optimize for screen sharing
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
                  // Optimize for screen sharing: higher bitrate, lower framerate
                  parameters.encodings[0].maxBitrate = 2000000 // 2 Mbps for screen content
                  parameters.encodings[0].maxFramerate = 60    // 60 fps for smooth screen share
                  await sender.setParameters(parameters)
                  console.log(`Set screen share encoding parameters for ${remote}`)
                }
              } catch (error) {
                console.warn(`Failed to set encoding parameters for ${remote}:`, error)
              }
            }
          }
          
          // CRITICAL: Handle combined audio (microphone + system audio) for simultaneous operation
          if (localStreamRef.current && localSystemAudioStreamRef.current) {
            console.log(`� Setting up combined audio for ${remote}...`)
            
            // Create a combined audio stream with both microphone and system audio
            const microphoneTracks = localStreamRef.current.getAudioTracks()
            const systemTracks = localSystemAudioStreamRef.current.getAudioTracks()
            
            console.log(`  🎤 Microphone tracks: ${microphoneTracks.length}`)
            console.log(`  🔊 System audio tracks: ${systemTracks.length}`)
            
            if (microphoneTracks.length > 0 && systemTracks.length > 0) {
              // Get existing audio sender to replace the track
              const existingAudioSender = pc.getSenders().find(sender => 
                sender.track && sender.track.kind === 'audio'
              )
              
              if (existingAudioSender) {
                // We need to create a mixed audio track for simultaneous operation
                console.log(`🎵 Creating audio mix for simultaneous microphone + system audio...`)
                
                try {
                  // Create an audio context for mixing
                  const audioContext = new AudioContext()
                  const mixedOutput = audioContext.createGain()
                  
                  // Create sources for both audio streams
                  const microphoneSource = audioContext.createMediaStreamSource(localStreamRef.current)
                  const systemSource = audioContext.createMediaStreamSource(localSystemAudioStreamRef.current)
                  
                  // Connect both sources to the output with balanced levels
                  microphoneSource.connect(mixedOutput)
                  systemSource.connect(mixedOutput)
                  
                  // Create a destination and get the mixed stream
                  const destination = audioContext.createMediaStreamDestination()
                  mixedOutput.connect(destination)
                  
                  const mixedTrack = destination.stream.getAudioTracks()[0]
                  if (mixedTrack) {
                    // Mark the mixed track appropriately
                    Object.defineProperty(mixedTrack, 'label', {
                      value: 'Mixed Audio (Microphone + System)',
                      writable: false
                    })
                    
                    // Replace the existing audio track with the mixed one
                    await existingAudioSender.replaceTrack(mixedTrack)
                    console.log(`� ✅ Replaced audio track with mixed audio for ${remote}`)
                  }
                } catch (error) {
                  console.error(`� ❌ Failed to create mixed audio for ${remote}:`, error)
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
                
                microphoneTracks.forEach(track => {
                  if (!pc.getSenders().some(sender => sender.track?.id === track.id)) {
                    pc.addTrack(track, localStreamRef.current!)
                    console.log(`🎤 ✅ Added microphone audio track for ${remote}`)
                  }
                })
                
                systemTracks.forEach(track => {
                  if (!pc.getSenders().some(sender => sender.track?.id === track.id)) {
                    pc.addTrack(track, localSystemAudioStreamRef.current!)
                    console.log(`🔊 ✅ Added system audio track for ${remote}`)
                  }
                })
              }
            } else if (microphoneTracks.length > 0) {
              // Only microphone, ensure it's preserved
              console.log(`🎤 Preserving microphone-only audio for ${remote}`)
              microphoneTracks.forEach(track => {
                const existingSender = pc.getSenders().find(sender => sender.track?.id === track.id)
                if (!existingSender) {
                  pc.addTrack(track, localStreamRef.current!)
                  console.log(`🎤 ✅ Added microphone audio track for ${remote}`)
                }
              })
            } else if (systemTracks.length > 0) {
              // Only system audio
              console.log(`🔊 Adding system-audio-only for ${remote}`)
              systemTracks.forEach(track => {
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
  }// Create arbitrary audio track when no microphone access
  const createArbitraryAudioTrack = (): MediaStream => {
    console.log('Creating arbitrary audio track for WebRTC connection')
    
    try {
      // Create audio context and generate silent audio
      const audioContext = new (window.AudioContext || window.webkitAudioContext)()
      const oscillator = audioContext.createOscillator()
      const gainNode = audioContext.createGain()
      
      // Create silent audio (very low volume but not completely silent)
      oscillator.frequency.setValueAtTime(440, audioContext.currentTime) // 440 Hz tone
      gainNode.gain.setValueAtTime(0.00001, audioContext.currentTime) // Very low volume, almost silent
      
      oscillator.connect(gainNode)
      
      // Create MediaStreamDestination to get a MediaStream
      const destination = audioContext.createMediaStreamDestination()
      gainNode.connect(destination)
      
      // Start the oscillator
      oscillator.start()
      
      const stream = destination.stream
      const audioTrack = stream.getAudioTracks()[0]
      
      if (audioTrack) {
        // Set track properties to make it identifiable
        Object.defineProperty(audioTrack, 'label', {
          value: 'Arbitrary Audio Track',
          writable: false
        })
        
        console.log('Arbitrary audio track created successfully:', {
          label: audioTrack.label,
          kind: audioTrack.kind,
          enabled: audioTrack.enabled,
          readyState: audioTrack.readyState,
          id: audioTrack.id
        })
      } else {
        console.warn('Failed to create audio track from arbitrary stream')
      }
      
      return stream
    } catch (error) {
      console.error('Error creating arbitrary audio track:', error)
      
      // Fallback: create a minimal media stream with silent track
      // This should work even if Web Audio API fails
      const canvas = document.createElement('canvas')
      canvas.width = 1
      canvas.height = 1
      const canvasStream = canvas.captureStream(1) // 1 FPS
      
      console.log('Created fallback canvas stream as audio substitute')
      return canvasStream
    }
  }

  // Create arbitrary video track when no camera access
  const createArbitraryVideoTrack = (): MediaStream => {
    console.log('Creating arbitrary video track for WebRTC connection')
    
    try {
      // Create a canvas with minimal dimensions
      const canvas = document.createElement('canvas')
      canvas.width = 640
      canvas.height = 480
      
      const ctx = canvas.getContext('2d')
      if (ctx) {
        // Create a simple black frame with minimal content
        ctx.fillStyle = 'black'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        
        // Add a small visual indicator to distinguish from real video
        ctx.fillStyle = '#333'
        ctx.fillRect(10, 10, 20, 20)
      }
      
      // Capture stream from canvas (1 FPS for minimal bandwidth)
      const stream = canvas.captureStream(1)
      const videoTrack = stream.getVideoTracks()[0]
      
      if (videoTrack) {
        // Set track properties to make it identifiable
        Object.defineProperty(videoTrack, 'label', {
          value: 'Arbitrary Video Track',
          writable: false
        })
        
        console.log('Arbitrary video track created successfully:', {
          label: videoTrack.label,
          kind: videoTrack.kind,
          enabled: videoTrack.enabled,
          readyState: videoTrack.readyState,
          id: videoTrack.id
        })
      } else {
        console.warn('Failed to create video track from arbitrary stream')
      }
      
      return stream
    } catch (error) {
      console.error('Error creating arbitrary video track:', error)
      
      // Fallback: try to create a minimal canvas stream
      try {
        const canvas = document.createElement('canvas')
        canvas.width = 1
        canvas.height = 1
        const fallbackStream = canvas.captureStream(1)
        
        console.log('Created minimal fallback canvas stream for video')
        return fallbackStream
      } catch (fallbackError) {
        console.error('Error creating fallback video track:', fallbackError)
        // Return empty MediaStream as last resort
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
    
    // FIRST: Immediately stop video and screen sharing before anything else
    if (localVideoStreamRef.current) {
      localVideoStreamRef.current.getTracks().forEach(track => track.stop())
      localVideoStreamRef.current = null
    }
    setVideoEnabled(false)
    
    if (localScreenStreamRef.current) {
      localScreenStreamRef.current.getTracks().forEach(track => track.stop())
      localScreenStreamRef.current = null
    }
    setScreenSharing(false)
    
    console.log("Reconnect: Video and screen sharing stopped immediately")
    
    try {
      // Store only muted state to restore after reconnection
      // Video and screen sharing are already disabled above
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
            <NotificationBell roomId={roomId} username={currentUser} />
          </div>
        </div>
      </header>
      <main className="flex-1 overflow-y-auto px-4 py-6 min-h-0">        {!joined ? (
          <div className="max-w-md mx-auto flex flex-col items-center gap-4">
            <div className="text-center mb-4">
              <h2 className="text-lg font-semibold mb-2">Join the Call</h2>
              <p className="text-sm text-gray-600">Choose how you want to join</p>
            </div>
              <div className="w-full space-y-3">
              <Button onClick={() => joinCall()} disabled={connecting} className="w-full">
                <Mic className="h-5 w-5 mr-2" /> Join Call
              </Button>
            </div>
            
            {error && <div className="text-red-600 text-sm mt-4 p-3 bg-red-50 rounded">{error}</div>}
              <div className="text-xs text-gray-500 text-center">
              Microphone permission will be requested automatically.<br/>
              If denied, you&apos;ll join muted and can unmute to try again.
            </div>
          </div>) : (
          <div className="h-full flex flex-col min-h-0 space-y-4">            
          {/* Control Panel */}
            <div className="bg-gray-50 rounded-lg p-3 flex-shrink-0">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="text-sm font-medium text-gray-700">Controls</div>
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
                    {/* Video Controls */}
                  {!actualIsListener && (
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
                    {/* Camera Switch Controls - only show when video is enabled */}
                  {!actualIsListener && videoEnabled && (
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
                  
                  {/* Mirror Toggle Controls - only show when video is enabled */}
                  {!actualIsListener && videoEnabled && (
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
