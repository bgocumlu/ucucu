// API endpoint to serve VAPID public key
import { NextResponse } from 'next/server'

export async function GET() {
  try {
    const publicKey = process.env.VAPID_PUBLIC_KEY
    
    if (!publicKey) {
      console.error('[VAPID API] VAPID_PUBLIC_KEY environment variable not set')
      return NextResponse.json(
        { error: 'VAPID configuration error' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      publicKey,
      timestamp: Date.now()
    })
  } catch (error) {
    console.error('[VAPID API] Error serving VAPID public key:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
