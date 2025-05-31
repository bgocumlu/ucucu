"use client"

import React from "react"
import { useEffect, useRef, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { ArrowLeft, Phone, Mic, MicOff, Volume2 } from "lucide-react"
import { NotificationBell } from "@/components/notification-bell"

const SIGNALING_SERVER_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:3001"
const ICE_CONFIG = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] }

export default function CallPage() {
  const params = useParams()
  const router = useRouter()
  const rawRoomId = params.roomId as string
  const roomId = decodeURIComponent(rawRoomId)
  const [currentUser, setCurrentUser] = useState("")
  const [isListener, setIsListener] = useState(false)
  const [joined, setJoined] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState("")
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({})
  const localAudioRef = useRef<HTMLAudioElement>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const peerConnections = useRef<Record<string, RTCPeerConnection>>({})
  const [muted, setMuted] = useState(false)
  const [peerMuted, setPeerMuted] = useState<Record<string, boolean>>({}) // <--- NEW: track muted state for each remote peer
  const [speakingPeers, setSpeakingPeers] = useState<Record<string, boolean>>({})
  const [localSpeaking, setLocalSpeaking] = useState(false)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const localAudioContextRef = useRef<AudioContext | null>(null)
  const speakingTimers = useRef<Record<string, NodeJS.Timeout>>({})

  // For each remote stream, create a ref and attach srcObject
  const remoteAudioRefs = useRef<Record<string, React.RefObject<HTMLAudioElement>>>({})
  Object.keys(remoteStreams).forEach(peer => {
    if (!remoteAudioRefs.current[peer]) {
      remoteAudioRefs.current[peer] = React.createRef<HTMLAudioElement>()
    }
  })

  // Attach srcObject for local audio
  useEffect(() => {
    if (localAudioRef.current && localStreamRef.current) {
      localAudioRef.current.srcObject = localStreamRef.current
    }
  }, [localAudioRef, joined, isListener])

  // --- Ensure remote audio elements are always "live" and NOT muted unless user muted ---
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

  // --- Local speaking detection ---
  useEffect(() => {
    if (!joined || isListener || !localStreamRef.current) return
    let raf: number
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
    localAudioContextRef.current = ctx
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 512
    analyserRef.current = analyser
    const source = ctx.createMediaStreamSource(localStreamRef.current)
    source.connect(analyser)
    const data = new Uint8Array(analyser.fftSize)
    function checkSpeaking() {
      analyser.getByteTimeDomainData(data)
      // Simple volume threshold
      const rms = Math.sqrt(data.reduce((sum, v) => sum + Math.pow(v - 128, 2), 0) / data.length)
      setLocalSpeaking(rms > 15)
      raf = requestAnimationFrame(checkSpeaking)
    }
    checkSpeaking()
    return () => {
      cancelAnimationFrame(raf)
      analyser.disconnect()
      source.disconnect()
      ctx.close()
    }
  }, [joined, isListener])

  // --- Remote speaking detection ---
  useEffect(() => {
    // For each remote stream, create an analyser and update speakingPeers
    const peerIds = Object.keys(remoteStreams)
    const audioContexts: Record<string, AudioContext> = {}
    const analysers: Record<string, AnalyserNode> = {}
    const datas: Record<string, Uint8Array> = {}
    let raf: number
    let stopped = false

    function checkRemoteSpeaking() {
      if (stopped) return
      const newSpeaking: Record<string, boolean> = {}
      peerIds.forEach(peer => {
        const stream = remoteStreams[peer]
        if (!stream) return
        if (!audioContexts[peer]) {
          audioContexts[peer] = new (window.AudioContext || (window as any).webkitAudioContext)()
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
      cancelAnimationFrame(raf)
      peerIds.forEach(peer => {
        if (audioContexts[peer]) audioContexts[peer].close()
      })
    }
  }, [remoteStreams])

  // --- Mute/unmute mic ---
  useEffect(() => {
    if (!localStreamRef.current) return
    localStreamRef.current.getAudioTracks().forEach(track => {
      track.enabled = !muted
    })
  }, [muted])

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
    // If we get an offer in stable, rollback first (perfect negotiation)
    if (desc.type === "offer" && pc.signalingState === "stable") {
      try {
        await pc.setLocalDescription({ type: "rollback" });
      } catch {}
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
  }

  // Join call room
  const joinCall = async () => {
    setConnecting(true)
    setError("")
    let localStream: MediaStream | null = null
    if (!isListener) {
      try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
        localStreamRef.current = localStream
        if (localAudioRef.current) {
          localAudioRef.current.srcObject = localStream
        }
      } catch {
        setIsListener(true)
        setError("Mic access denied, joining as listener.")
      }
    }
    // Connect to signaling
    const ws = new WebSocket(SIGNALING_SERVER_URL)
    wsRef.current = ws
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "call-join", roomId, username: currentUser, isListener }))
      setJoined(true)
      setConnecting(false)
    }
    ws.onmessage = async (event) => {
      const msg = JSON.parse(event.data)
      switch (msg.type) {
        case "call-new-peer": {
          if (isListener) return
          const newPeer = msg.username
          if (newPeer === currentUser) return
          let pc = peerConnections.current[newPeer]
          if (!pc) {
            pc = createPeerConnection(newPeer)
          }
          // Remove all existing senders before adding tracks (avoid duplicate tracks)
          pc.getSenders().forEach(sender => {
            if (sender.track && localStreamRef.current && !localStreamRef.current.getTracks().includes(sender.track)) {
              pc.removeTrack(sender)
            }
          })
          // Always add tracks for this peer connection
          localStreamRef.current?.getTracks().forEach(track => {
            if (!pc.getSenders().some(sender => sender.track === track)) {
              pc.addTrack(track, localStreamRef.current!)
            }
          })
          const offer = await pc.createOffer()
          await pc.setLocalDescription(offer)
          ws.send(JSON.stringify({ type: "call-offer", roomId, from: currentUser, to: newPeer, payload: pc.localDescription }))
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
          // Always add tracks for this peer connection if not a listener
          if (!isListener && localStreamRef.current) {
            localStreamRef.current.getTracks().forEach(track => {
              if (!pc.getSenders().some(sender => sender.track === track)) {
                pc.addTrack(track, localStreamRef.current!)
              }
            })
          }
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
        }
        case "call-peer-left": {
          const left = msg.username
          if (peerConnections.current[left]) {
            peerConnections.current[left].close()
            delete peerConnections.current[left]
          }
          setRemoteStreams(prev => {
            const copy = { ...prev }
            delete copy[left]
            return copy
          })
          break
        }
      }
    }
    ws.onclose = () => setJoined(false)
    ws.onerror = () => setError("WebSocket error")
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
      setRemoteStreams(prev => ({ ...prev, [remote]: e.streams[0] }))
    }
    return pc
  }

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
      <main className="flex-1 overflow-y-auto px-4 py-6">
        {!joined ? (
          <div className="max-w-md mx-auto flex flex-col items-center gap-4">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={isListener} onChange={e => setIsListener(e.target.checked)} />
              Listen only (no mic)
            </label>
            <Button onClick={joinCall} disabled={connecting} className="w-full">
              <Phone className="h-5 w-5 mr-2" /> Join Call
            </Button>
            {error && <div className="text-red-600 text-sm">{error}</div>}
          </div>
        ) : (
          <div className="max-w-md mx-auto w-full">
            {!isListener && (
              <div className="mb-4">
                <div className="font-semibold mb-1 flex items-center gap-2">
                  Your Mic
                  <span className={`inline-flex items-center ml-2 ${localSpeaking ? "text-green-600" : "text-gray-400"}`}>
                    <Volume2 className="h-4 w-4" />
                    {localSpeaking && <span className="ml-1 text-xs">Speaking</span>}
                  </span>
                  <Button
                    size="icon"
                    variant={muted ? "destructive" : "outline"}
                    className="ml-2"
                    onClick={() => setMuted(m => !m)}
                    aria-label={muted ? "Unmute" : "Mute"}
                  >
                    {muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                  </Button>
                </div>
                <audio ref={localAudioRef} autoPlay controls muted className="w-full" />
              </div>
            )}
            <div className="font-semibold mb-1">Remote Participants</div>
            <div className="space-y-2">
              {Object.keys(remoteStreams).length === 0 && <div className="text-gray-400 text-sm">No one else in the call yet.</div>}
              {Object.keys(remoteStreams).map(peer => (
                <div key={peer} className="flex items-center gap-2">
                  <audio
                    ref={remoteAudioRefs.current[peer]}
                    autoPlay
                    playsInline
                    controls={false}
                    muted={!!peerMuted[peer]}
                    className="w-full"
                  />
                  <span className="text-xs text-gray-500">{peer}</span>
                  <span className={`ml-2 ${speakingPeers[peer] ? "text-green-600" : "text-gray-400"}`}>
                    <Volume2 className="h-4 w-4 inline" />
                    {speakingPeers[peer] && <span className="ml-1 text-xs">Speaking</span>}
                  </span>
                  <Button
                    size="icon"
                    variant={peerMuted[peer] ? "destructive" : "outline"}
                    className="ml-2"
                    onClick={() => togglePeerMute(peer)}
                    aria-label={peerMuted[peer] ? "Unmute participant" : "Mute participant"}
                  >
                    {peerMuted[peer] ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
