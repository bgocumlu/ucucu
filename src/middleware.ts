import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Room ID maximum length
const MAX_ROOM_ID_LENGTH = 20

export function middleware(request: NextRequest) {
  const url = request.nextUrl.clone()
  
  // Skip if this is a special Next.js route or static file
  if (url.pathname.startsWith('/api') || 
      url.pathname.startsWith('/_next') || 
      url.pathname === '/favicon.ico' ||
      url.pathname === '/manifest.json' ||
      url.pathname.endsWith('.js') ||
      url.pathname.endsWith('.css') ||
      url.pathname.endsWith('.png') ||
      url.pathname.endsWith('.jpg') ||
      url.pathname.endsWith('.jpeg') ||
      url.pathname.endsWith('.gif') ||
      url.pathname.endsWith('.svg')) {
    return NextResponse.next()
  }
  
  // Check if this is a room route (not the homepage)
  const roomIdMatch = url.pathname.match(/^\/([^\/]+)(?:\/chat)?$/)
  
  if (roomIdMatch && url.pathname !== '/') {
    const roomId = roomIdMatch[1]
    
    // Check if room ID exceeds maximum length
    if (roomId.length > MAX_ROOM_ID_LENGTH) {
      const truncatedRoomId = roomId.substring(0, MAX_ROOM_ID_LENGTH)
      
      // Redirect to truncated room ID, preserving any /chat suffix
      const newPath = url.pathname.includes('/chat') 
        ? `/${truncatedRoomId}/chat` 
        : `/${truncatedRoomId}`
      
      url.pathname = newPath
      return NextResponse.redirect(url)
    }
  }
  
  return NextResponse.next()
}

export const config = {
  // Match room routes (single path segment that could be a room ID)
  matcher: [
    '/((?!api|_next|favicon.ico|manifest.json|sw.js).*)',
  ],
}
