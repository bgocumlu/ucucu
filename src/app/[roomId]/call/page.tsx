"use client"

import React, { useEffect, useRef, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { ArrowLeft, Phone, Mic, MicOff, Volume2, Video, VideoOff, Monitor, MonitorOff, Maximize2 } from "lucide-react"
import { NotificationBell } from "@/components/notification-bell"

// Extend Window interface for webkit AudioContext
declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext
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
  const [error, setError] = useState("")
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({})
  const [remoteVideoStreams, setRemoteVideoStreams] = useState<Record<string, MediaStream>>({})
  const [remoteScreenStreams, setRemoteScreenStreams] = useState<Record<string, MediaStream>>({})
  const [participants, setParticipants] = useState<Set<string>>(new Set()) // Track all participants
  const localAudioRef = useRef<HTMLAudioElement>(null)
  const localVideoRef = useRef<HTMLVideoElement>(null)
  const localScreenRef = useRef<HTMLVideoElement>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const localVideoStreamRef = useRef<MediaStream | null>(null)
  const localScreenStreamRef = useRef<MediaStream | null>(null)
  const peerConnections = useRef<Record<string, RTCPeerConnection>>({})
  const [muted, setMuted] = useState(false)
  const [videoEnabled, setVideoEnabled] = useState(false)
  const [screenSharing, setScreenSharing] = useState(false)
  const [selectedParticipant, setSelectedParticipant] = useState<string | null>(null)
  const [peerMuted, setPeerMuted] = useState<Record<string, boolean>>({}) // <--- NEW: track muted state for each remote peer
  const [speakingPeers, setSpeakingPeers] = useState<Record<string, boolean>>({})
  const [localSpeaking, setLocalSpeaking] = useState(false)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const localAudioContextRef = useRef<AudioContext | null>(null)  // For each participant, create refs for audio, video, and screen
  const remoteAudioRefs = useRef<Record<string, React.RefObject<HTMLAudioElement | null>>>({})
  const remoteVideoRefs = useRef<Record<string, React.RefObject<HTMLVideoElement | null>>>({})
  const remoteScreenRefs = useRef<Record<string, React.RefObject<HTMLVideoElement | null>>>({})
  
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
  })// Attach srcObject for local audio, video, and screen
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
  }, [localAudioRef, localVideoRef, localScreenRef, joined, actualIsListener, videoEnabled, screenSharing])
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
  }, [remoteScreenStreams])// --- Local speaking detection ---
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
      // Simple volume threshold
      const rms = Math.sqrt(data.reduce((sum, v) => sum + Math.pow(v - 128, 2), 0) / data.length)
      setLocalSpeaking(rms > 15)
      raf = requestAnimationFrame(checkSpeaking)    }
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
        }
        analysers[peer].getByteTimeDomainData(datas[peer])
        const rms = Math.sqrt(datas[peer].reduce((sum, v) => sum + Math.pow(v - 128, 2), 0) / datas[peer].length)
        newSpeaking[peer] = rms > 15
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
        })
      }
    } else {
      // Unmuting
      if (localStreamRef.current) {
        // If we have a stream, just enable the tracks
        localStreamRef.current.getAudioTracks().forEach(track => {
          track.enabled = true
        })
        setMuted(false)
        setError("")
      } else {
        // If no stream, request permission and create new stream
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
          localStreamRef.current = stream
          if (localAudioRef.current) {
            localAudioRef.current.srcObject = stream
          }
          
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
  }, [roomId, router])
  // --- Robust: Always accept answers, but if InvalidStateError occurs, always rollback and retry ONCE, and if still fails, log and continue ---
  async function safeSetRemoteDescription(pc: RTCPeerConnection, desc: RTCSessionDescriptionInit) {
    // Perfect negotiation: Handle offer collision by using username comparison
    if (desc.type === "offer") {
      // If we're in have-local-offer state and receive an offer, we have a collision
      if (pc.signalingState === "have-local-offer") {
        // The peer with the higher username should win the collision
        // If we're the higher username, ignore this offer (we should send ours)
        // If we're the lower username, rollback and accept their offer
        const from = Object.keys(peerConnections.current).find(peer => peerConnections.current[peer] === pc)
        if (from && currentUser > from) {
          console.log("Ignoring offer collision - we have priority")
          return
        } else {
          // We should rollback and accept their offer
          try {
            await pc.setLocalDescription({ type: "rollback" })
          } catch (e) {
            console.warn("Rollback failed:", e)
          }
        }
      }
    }
    
    // --- PATCH: Only set remote answer if in have-local-offer state ---
    if (desc.type === "answer" && pc.signalingState !== "have-local-offer") {
      // Already stable or not expecting answer, skip
      console.warn("Skipping setRemoteDescription for answer: not in have-local-offer state", pc.signalingState);
      return;
    }
    
    let triedRollback = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(desc));
        return;
      } catch (e) {
        // Always try rollback and retry ONCE for InvalidStateError, regardless of type
        if (
          e instanceof DOMException &&
          e.name === "InvalidStateError" &&
          !triedRollback &&
          pc.signalingState === "stable"
        ) {
          triedRollback = true;
          try {
            await pc.setLocalDescription({ type: "rollback" });
          } catch {}
          continue;
        }
        // Log and give up
        console.error("setRemoteDescription error", e, desc, pc.signalingState);
        return;
      }
    }
  }  // Join call room
  const joinCall = async () => {
    setConnecting(true)
    setError("")
    let localStream: MediaStream | null = null
    
    // Always try to get microphone permission
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      localStreamRef.current = localStream
      if (localAudioRef.current) {
        localAudioRef.current.srcObject = localStream
      }
      // Start unmuted if permission granted
      setMuted(false)
    } catch (err) {
      console.warn("Mic access denied, joining muted:", err)
      // Join as normal participant but start muted
      setMuted(true)
      setError("Microphone access denied. You're muted - click unmute to grant permission.")
    }
    
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
          
          // Perfect negotiation: Only create offers if we're not a listener AND our username is "higher"
          // This prevents the race condition where both peers try to create offers
          const shouldCreateOffer = !actualIsListener && currentUser > newPeer
          if (shouldCreateOffer) {
            // Remove all existing senders before adding tracks (avoid duplicate tracks)
            pc.getSenders().forEach(sender => {
              if (sender.track && localStreamRef.current && !localStreamRef.current.getTracks().includes(sender.track)) {
                pc.removeTrack(sender)
              }
            })
            const offer = await pc.createOffer()
            await pc.setLocalDescription(offer)
            ws.send(JSON.stringify({ type: "call-offer", roomId, from: currentUser, to: newPeer, payload: pc.localDescription }))
          }
          break
        }
        case "call-offer": {
          const from = msg.from
          let pc = peerConnections.current[from]
          if (!pc) {
            pc = createPeerConnection(from)
          }
          // Use safeSetRemoteDescription to avoid InvalidStateError
          await safeSetRemoteDescription(pc, msg.payload)
          // --- REMOVE: Do not add tracks here, handled by useEffect above ---
          const answer = await pc.createAnswer()
          await pc.setLocalDescription(answer)
          ws.send(JSON.stringify({ type: "call-answer", roomId, from: currentUser, to: from, payload: pc.localDescription }))
          break
        }
        case "call-answer": {
          const from = msg.from
          const pc = peerConnections.current[from]
          if (pc) {
            // Use safeSetRemoteDescription to avoid InvalidStateError
            await safeSetRemoteDescription(pc, msg.payload)
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
          
          // Reset selected participant if they left
          setSelectedParticipant(prev => prev === left ? null : prev)
          
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
    setParticipants(new Set()) // Clear participants list
    setVideoEnabled(false)
    setScreenSharing(false)
    setSelectedParticipant(null)
    setError("")
    
    // Navigate back to chat
    router.push(`/${encodeURIComponent(roomId)}/chat`)
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
        setRemoteStreams(prev => ({ ...prev, [remote]: stream }))
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
    if (!actualIsListener && localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        if (!pc.getSenders().some(sender => sender.track === track)) {
          pc.addTrack(track, localStreamRef.current!)
        }
      })
    }
    
    // Add video tracks if enabled
    if (localVideoStreamRef.current) {
      localVideoStreamRef.current.getTracks().forEach(track => {
        if (!pc.getSenders().some(sender => sender.track === track)) {
          pc.addTrack(track, localVideoStreamRef.current!)
        }
      })
    }
    
    // Add screen tracks if enabled
    if (localScreenStreamRef.current) {
      localScreenStreamRef.current.getTracks().forEach(track => {
        if (!pc.getSenders().some(sender => sender.track === track)) {
          pc.addTrack(track, localScreenStreamRef.current!)
        }
      })
    }return pc
  }
  // Add local tracks to all peer connections when localStreamRef.current becomes available
  useEffect(() => {
    if (!localStreamRef.current || actualIsListener) return
    Object.values(peerConnections.current).forEach(pc => {
      localStreamRef.current!.getTracks().forEach(track => {
        if (!pc.getSenders().some(sender => sender.track === track)) {
          pc.addTrack(track, localStreamRef.current!)
        }
      })
      
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
    })
  }, [joined, actualIsListener, videoEnabled, screenSharing]) // Updated dependencies

  // Clean up on leave
  useEffect(() => {
    const pcs = peerConnections.current
    return () => {
      Object.values(pcs).forEach(pc => pc.close())
      if (wsRef.current) wsRef.current.close()
      if (localStreamRef.current) localStreamRef.current.getTracks().forEach(t => t.stop())
    }
  }, [roomId])
  // --- Mute/unmute a remote participant ---
  const togglePeerMute = (peer: string) => {
    setPeerMuted(prev => ({
      ...prev,
      [peer]: !prev[peer]
    }))
  }  // --- Toggle video with proper renegotiation ---
  const toggleVideo = async () => {
    if (videoEnabled) {
      // Turn off video
      if (localVideoStreamRef.current) {
        localVideoStreamRef.current.getTracks().forEach(track => track.stop())
        localVideoStreamRef.current = null
      }
      
      // Remove video tracks from all peer connections and trigger renegotiation
      for (const [remote, pc] of Object.entries(peerConnections.current)) {
        pc.getSenders().forEach(sender => {
          if (sender.track && sender.track.kind === 'video' && !sender.track.label.includes('screen')) {
            pc.removeTrack(sender)
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
          console.error('Error creating video-off offer:', error)
        }
      }
      
      setVideoEnabled(false)
    } else {
      // Turn on video
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
        localVideoStreamRef.current = stream
        
        // Add video tracks to all peer connections and trigger renegotiation
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
            console.error('Error creating video offer:', error)
          }
        }
        
        setVideoEnabled(true)
      } catch (error) {
        console.error('Error accessing camera:', error)
        setError('Camera access denied')
      }
    }
  }  // --- Toggle screen sharing with proper renegotiation ---
  const toggleScreenShare = async () => {
    if (screenSharing) {
      // Turn off screen sharing
      if (localScreenStreamRef.current) {
        localScreenStreamRef.current.getTracks().forEach(track => track.stop())
        localScreenStreamRef.current = null
      }
      
      // Remove screen tracks from all peer connections and trigger renegotiation
      for (const [remote, pc] of Object.entries(peerConnections.current)) {
        pc.getSenders().forEach(sender => {
          if (sender.track && sender.track.kind === 'video' && 
              (sender.track.label.toLowerCase().includes('screen') || 
               sender.track.label.toLowerCase().includes('monitor') ||
               sender.track.label.toLowerCase().includes('display'))) {
            pc.removeTrack(sender)
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
          console.error('Error creating screen-off offer:', error)
        }
      }
      
      setScreenSharing(false)
    } else {
      // Turn on screen sharing
      try {        
        const stream = await navigator.mediaDevices.getDisplayMedia({ 
          video: true, 
          audio: false 
        })
        localScreenStreamRef.current = stream
        
        console.log('Screen share started, track label:', stream.getVideoTracks()[0]?.label)
        
        // Add screen tracks to all peer connections and trigger renegotiation
        for (const [remote, pc] of Object.entries(peerConnections.current)) {
          stream.getTracks().forEach(track => {
            console.log('Adding screen track to peer connection:', track.label)
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
            console.error('Error creating screen offer:', error)
          }        }
        
        // Auto-stop when user stops sharing via browser UI
        stream.getVideoTracks()[0].addEventListener('ended', () => {
          console.log('Screen share ended by user')
          setScreenSharing(false)
          localScreenStreamRef.current = null
          
          // Clean up from peer connections and trigger renegotiation
          Object.entries(peerConnections.current).forEach(async ([remote, pc]) => {
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
              console.error('Error creating cleanup offer:', error)
            }
          })
        })
          setScreenSharing(true)
      } catch (error) {
        console.error('Error accessing screen:', error)
        setError('Screen sharing access denied or not supported')
      }
    }
  }

  return (
    <div className="h-screen bg-white flex flex-col">
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex-shrink-0">
        <div className="flex items-center justify-between gap-2 w-full flex-nowrap">
          <div className="flex items-center gap-2 min-w-0 flex-shrink">
            <Button variant="ghost" size="sm" onClick={() => router.push(`/${encodeURIComponent(roomId)}/chat`)}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <h1 className="font-semibold text-gray-900 truncate max-w-[80px]">Call</h1>
            <p className="text-xs text-gray-500 truncate max-w-[80px]">/{roomId}</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0 min-w-0">
            <NotificationBell roomId={roomId} username={currentUser} />
          </div>
        </div>
      </header>
      <main className="flex-1 overflow-y-auto px-4 py-6">        {!joined ? (
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
          <div className="h-full flex flex-col">
            {/* Control Panel */}
            <div className="bg-gray-50 rounded-lg p-4 mb-4 flex-shrink-0">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="text-sm font-medium text-gray-700">Controls</div>
                <div className="flex items-center gap-2">                  {/* Audio Controls */}
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
              {!actualIsListener && localSpeaking && (
                <div className="mt-2 text-xs text-green-600 flex items-center gap-1">
                  <Volume2 className="h-3 w-3" />
                  <span>You are speaking</span>
                </div>
              )}
            </div>

            {/* Selected Participant Large View */}
            {selectedParticipant && (
              <div className="bg-black rounded-lg mb-4 relative flex-shrink-0" style={{ height: '200px' }}>
                <div className="absolute top-2 left-2 bg-black bg-opacity-50 text-white px-2 py-1 rounded text-xs">
                  {selectedParticipant}
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="absolute top-2 right-2 text-white hover:bg-white hover:bg-opacity-20"
                  onClick={() => setSelectedParticipant(null)}
                >
                  <Maximize2 className="h-4 w-4" />
                </Button>
                
                {/* Selected participant's video */}
                {remoteVideoStreams[selectedParticipant] && (
                  <video
                    ref={remoteVideoRefs.current[selectedParticipant]}
                    autoPlay
                    playsInline
                    className="w-full h-full object-cover rounded-lg"
                  />
                )}
                
                {/* Selected participant's screen share */}
                {remoteScreenStreams[selectedParticipant] && (
                  <video
                    ref={remoteScreenRefs.current[selectedParticipant]}
                    autoPlay
                    playsInline
                    className="w-full h-full object-contain rounded-lg bg-gray-900"
                  />
                )}
                
                {/* Fallback if no video */}
                {!remoteVideoStreams[selectedParticipant] && !remoteScreenStreams[selectedParticipant] && (
                  <div className="w-full h-full flex items-center justify-center text-white">
                    <div className="text-center">
                      <div className="w-16 h-16 bg-gray-600 rounded-full flex items-center justify-center mx-auto mb-2">
                        <span className="text-xl font-semibold">{selectedParticipant[0]?.toUpperCase()}</span>
                      </div>
                      <div className="text-sm">No video</div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Local Video Preview */}
            {videoEnabled && localVideoStreamRef.current && (
              <div className="bg-black rounded-lg mb-4 relative flex-shrink-0" style={{ height: '120px' }}>
                <div className="absolute top-2 left-2 bg-black bg-opacity-50 text-white px-2 py-1 rounded text-xs">
                  You (Video)
                </div>
                <video
                  ref={localVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover rounded-lg"
                />
              </div>
            )}

            {/* Local Screen Share Preview */}
            {screenSharing && localScreenStreamRef.current && (
              <div className="bg-black rounded-lg mb-4 relative flex-shrink-0" style={{ height: '120px' }}>
                <div className="absolute top-2 left-2 bg-black bg-opacity-50 text-white px-2 py-1 rounded text-xs">
                  Your Screen
                </div>
                <video
                  ref={localScreenRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-contain rounded-lg"
                />
              </div>
            )}

            {/* Participants Sliding View */}
            <div className="flex-1 overflow-hidden">
              <div className="font-semibold mb-2 text-sm">Participants</div>
                {participants.size === 0 ? (
                <div className="text-gray-400 text-sm text-center py-8">
                  No one else in the call yet.
                </div>
              ) : (
                <div className="overflow-x-auto pb-2">
                  <div className="flex gap-3" style={{ width: 'max-content' }}>
                    {Array.from(participants).map(peer => (
                      <div
                        key={peer}
                        className={`flex-shrink-0 bg-gray-50 rounded-lg p-3 border-2 transition-all cursor-pointer ${
                          selectedParticipant === peer ? 'border-blue-500 bg-blue-50' : 'border-transparent hover:border-gray-300'
                        }`}
                        onClick={() => setSelectedParticipant(selectedParticipant === peer ? null : peer)}
                        style={{ width: '160px' }}
                      >
                        {/* Participant Video Thumbnail */}
                        <div className="relative bg-black rounded mb-2" style={{ height: '90px' }}>
                          {remoteVideoStreams[peer] ? (
                            <video
                              ref={remoteVideoRefs.current[peer]}
                              autoPlay
                              playsInline
                              className="w-full h-full object-cover rounded"
                            />
                          ) : remoteScreenStreams[peer] ? (
                            <video
                              ref={remoteScreenRefs.current[peer]}
                              autoPlay
                              playsInline
                              className="w-full h-full object-contain rounded bg-gray-900"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-white">
                              <div className="w-8 h-8 bg-gray-600 rounded-full flex items-center justify-center">
                                <span className="text-sm font-semibold">{peer[0]?.toUpperCase()}</span>
                              </div>
                            </div>
                          )}
                          
                          {/* Screen share indicator */}
                          {remoteScreenStreams[peer] && (
                            <div className="absolute top-1 right-1 bg-green-500 text-white p-1 rounded">
                              <Monitor className="h-3 w-3" />
                            </div>
                          )}
                        </div>
                        
                        {/* Participant Name and Controls */}
                        <div className="text-xs font-medium text-gray-900 truncate mb-2">{peer}</div>
                        
                        <div className="flex items-center justify-between">
                          {/* Speaking Indicator */}
                          <div className={`flex items-center ${speakingPeers[peer] ? 'text-green-600' : 'text-gray-400'}`}>
                            <Volume2 className="h-3 w-3" />
                            {speakingPeers[peer] && <span className="ml-1 text-xs">Speaking</span>}
                          </div>
                          
                          {/* Mute Button */}
                          <Button
                            size="sm"
                            variant={peerMuted[peer] ? "destructive" : "ghost"}
                            onClick={(e) => {
                              e.stopPropagation()
                              togglePeerMute(peer)
                            }}
                            className="p-1 h-6 w-6"
                          >
                            {peerMuted[peer] ? <MicOff className="h-3 w-3" /> : <Mic className="h-3 w-3" />}
                          </Button>
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
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            
            {/* Hidden local audio element */}
            {!actualIsListener && (
              <audio ref={localAudioRef} autoPlay controls={false} muted={true} className="hidden" />
            )}
          </div>
        )}
      </main>
    </div>
  )
}
