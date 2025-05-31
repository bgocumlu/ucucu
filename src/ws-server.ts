import { WebSocket, WebSocketServer } from 'ws';
import { createServer } from 'http';
import bcrypt from 'bcryptjs';
import webpush from 'web-push';
import { aiService } from './ai-service';

const PORT = process.env.WS_PORT || 3001;

// Notification configuration
const NOTIFY_ACTIVE_USERS = process.env.NOTIFY_ACTIVE_USERS !== 'false'; // Default to true, set to 'false' to disable notifications for active users

// VAPID keys from environment variables
const VAPID_KEYS = {
  publicKey: process.env.VAPID_PUBLIC_KEY || '',
  privateKey: process.env.VAPID_PRIVATE_KEY || '',
  subject: process.env.VAPID_SUBJECT || 'mailto:admin@example.com'
};

// Validate VAPID keys on startup
if (!VAPID_KEYS.publicKey || !VAPID_KEYS.privateKey) {
  console.error('[WebSocket Server] VAPID keys not configured. Please set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY environment variables.');
  console.error('[WebSocket Server] Generate new keys with: npx web-push generate-vapid-keys');
  process.exit(1);
}

// Log notification configuration
console.log(`[WebSocket Server] Notification configuration: NOTIFY_ACTIVE_USERS = ${NOTIFY_ACTIVE_USERS}`);
if (NOTIFY_ACTIVE_USERS) {
  console.log('[WebSocket Server] Notifications will be sent to ALL subscribed users (including those currently active in rooms)');
} else {
  console.log('[WebSocket Server] Notifications will only be sent to subscribed users who are NOT currently active in rooms');
}

// Configure web-push with VAPID details
webpush.setVapidDetails(
  VAPID_KEYS.subject,
  VAPID_KEYS.publicKey,
  VAPID_KEYS.privateKey
);

// Notification subscription interface
interface NotificationSubscription {
  roomId: string
  username: string
  deviceId: string // unique device identifier
  interval: number // minutes
  startTime: number
  endTime: number
}

// In-memory store for rooms and messages
const rooms: Record<string, { name: string; users: Set<string>; locked: boolean; maxParticipants: number; visibility: 'public' | 'private'; owner?: string; password?: string }> = {};

// Create the global room like any other room, just with no admin
rooms['global'] = {
  name: 'Global Room',
  users: new Set(),
  locked: false,
  maxParticipants: 50,
  visibility: 'public',
  // No owner for global room
};
console.log('[WebSocket Server] Created global room: global');

// Function to ensure global room exists (recreate if deleted)
function ensureGlobalRoomExists(): void {
  if (!rooms['global']) {
    rooms['global'] = {
      name: 'Global Room',
      users: new Set(),
      locked: false,
      maxParticipants: 50,
      visibility: 'public',
      // No owner for global room
    };
    console.log('[WebSocket Server] Recreated global room: global');
  }
}

// In-memory store for notification subscriptions with push endpoint support
interface WebPushSubscription {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

interface PushNotificationSubscription extends NotificationSubscription {
  pushSubscription?: WebPushSubscription // Web Push API subscription
  vapidEndpoint?: string
}

const notificationSubscriptions: Map<string, PushNotificationSubscription[]> = new Map(); // roomId -> subscriptions[]

// Memory-only storage - no file persistence
// Subscriptions will be lost on server restart, which is desired behavior

// Memory-only storage - no file persistence
// Subscriptions will be lost on server restart, which is desired behavior

// Notification management functions
function addNotificationSubscription(roomId: string, username: string, deviceId: string, interval: number, pushSubscription?: WebPushSubscription): void {
  const now = Date.now()
  const endTime = now + (interval * 60 * 1000) // Convert minutes to milliseconds
  
  const subscription: PushNotificationSubscription = {
    roomId,
    username,
    deviceId,
    interval,
    startTime: now,
    endTime,
    pushSubscription
  }

  if (!notificationSubscriptions.has(roomId)) {
    notificationSubscriptions.set(roomId, [])
  }

  const roomSubscriptions = notificationSubscriptions.get(roomId)!
  // Remove existing subscription for this device and username in this room
  const existingIndex = roomSubscriptions.findIndex(sub => sub.deviceId === deviceId && sub.username === username)
  if (existingIndex !== -1) {
    roomSubscriptions.splice(existingIndex, 1)
  }

  roomSubscriptions.push(subscription)
  console.log(`[NOTIFICATIONS] Added subscription for ${username} (device: ${deviceId}) in room ${roomId} for ${interval} minutes`)
  
  // Ensure room exists and won't be deleted while subscriptions are active
  if (!rooms[roomId]) {
    rooms[roomId] = {
      name: roomId,
      users: new Set(),
      locked: false,
      maxParticipants: 50,
      visibility: 'public',
      owner: username
    }
    console.log(`[NOTIFICATIONS] Created room ${roomId} for notification subscription`)
  }
}

function removeNotificationSubscription(roomId: string, username: string, deviceId: string): void {
  const roomSubscriptions = notificationSubscriptions.get(roomId)
  if (!roomSubscriptions) return
  
  const index = roomSubscriptions.findIndex(sub => sub.deviceId === deviceId && sub.username === username)
  if (index !== -1) {
    roomSubscriptions.splice(index, 1)
    console.log(`[NOTIFICATIONS] Removed subscription for ${username} (device: ${deviceId}) in room ${roomId}`)
    
    // Clean up empty arrays
    if (roomSubscriptions.length === 0) {
      notificationSubscriptions.delete(roomId)
    }
  }
}

function getActiveSubscriptions(roomId: string): PushNotificationSubscription[] {
  const roomSubscriptions = notificationSubscriptions.get(roomId)
  if (!roomSubscriptions) return []

  const now = Date.now()
  const active = roomSubscriptions.filter(sub => sub.endTime > now)
  
  // If some subscriptions expired, clean them up
  if (active.length !== roomSubscriptions.length) {
    notificationSubscriptions.set(roomId, active)
    console.log(`[NOTIFICATIONS] Cleaned up expired subscriptions in room ${roomId}`)
    
    // Check if room should be deleted after subscription cleanup
    checkRoomDeletionAfterSubscriptionCleanup(roomId)
  }
  
  return active
}

function cleanupExpiredSubscriptions(): void {
  const now = Date.now()
  let cleanedCount = 0
  
  for (const [roomId, subscriptions] of notificationSubscriptions.entries()) {
    const activeSubscriptions = subscriptions.filter(sub => sub.endTime > now)
    
    if (activeSubscriptions.length !== subscriptions.length) {
      if (activeSubscriptions.length === 0) {
        notificationSubscriptions.delete(roomId)
      } else {
        notificationSubscriptions.set(roomId, activeSubscriptions)
      }
      cleanedCount += subscriptions.length - activeSubscriptions.length
    }
  }
  if (cleanedCount > 0) {
    console.log(`[NOTIFICATIONS] Cleaned up ${cleanedCount} expired subscriptions`)
  }
}

// Clear all push subscriptions (when VAPID keys change)
function clearAllPushSubscriptions(): void {
  let clearedCount = 0
  
  for (const [roomId, subscriptions] of notificationSubscriptions.entries()) {
    // Remove all subscriptions with push endpoints
    const subscriptionsWithoutPush = subscriptions.filter(sub => !sub.pushSubscription)
    
    clearedCount += subscriptions.length - subscriptionsWithoutPush.length
    
    if (subscriptionsWithoutPush.length === 0) {
      notificationSubscriptions.delete(roomId)
    } else {
      notificationSubscriptions.set(roomId, subscriptionsWithoutPush)
    }
  }
  
  console.log(`[NOTIFICATIONS] Cleared ${clearedCount} push subscriptions due to VAPID key change`)
  
  // Broadcast room updates since some subscriptions were removed
  broadcastRooms()
}

async function sendNotificationsForMessage(roomId: string, message: { username: string; text: string }): Promise<void> {
  const activeSubscriptions = getActiveSubscriptions(roomId);
  
  if (activeSubscriptions.length === 0) {
    console.log(`[NOTIFICATIONS] No active subscriptions for room ${roomId}`);
    return;
  }

  // Get currently active users in the room (connected via WebSocket)
  const currentlyActiveUsers = rooms[roomId] ? Array.from(rooms[roomId].users) : [];
  
  let usersToNotify: PushNotificationSubscription[];
  
  if (NOTIFY_ACTIVE_USERS) {
    // Send notifications to ALL subscribed users (including active users)
    usersToNotify = activeSubscriptions;
    console.log(`[NOTIFICATIONS] Sending notifications to ALL ${activeSubscriptions.length} subscribed users for room ${roomId} (including active users)`);
  } else {
    // Filter out users who are currently active in the room
    usersToNotify = activeSubscriptions.filter(sub => 
      !currentlyActiveUsers.includes(sub.username)
    );
    console.log(`[NOTIFICATIONS] Sending notifications to ${usersToNotify.length}/${activeSubscriptions.length} subscribed users for room ${roomId} (excluding ${currentlyActiveUsers.length} active users)`);
  }

  // If no users need notifications, exit early
  if (usersToNotify.length === 0) {
    console.log(`[NOTIFICATIONS] No users need notifications for room ${roomId}`);
    return;
  }

  // Prepare notification payload
  const notificationPayload = JSON.stringify({
    title: `${roomId}`,
    body: `${message.username}: ${message.text}`,
    icon: '/icon-192x192.png',
    badge: '/badge-72x72.png',
    data: {
      roomId,
      username: message.username,
      timestamp: Date.now()
    },
    actions: [
      {
        action: 'open',
        title: 'Open Chat'
      },
      {
        action: 'close',
        title: 'Dismiss'
      }
    ]
  });

  // Send push notifications to users with valid push subscriptions
  const pushPromises = usersToNotify
    .filter(sub => sub.pushSubscription)
    .map(async (sub) => {
      try {
        await webpush.sendNotification(sub.pushSubscription!, notificationPayload);
        console.log(`[PUSH] Successfully sent push notification to ${sub.username} (${sub.deviceId}) in room ${roomId}`);
      } catch (error) {
        console.error(`[PUSH] Failed to send push notification to ${sub.username}:`, error);
          // If the subscription is invalid (410 Gone), remove it
        if (error instanceof Error && error.message.includes('410')) {
          console.log(`[PUSH] Removing invalid subscription for ${sub.username} (device: ${sub.deviceId}) in room ${roomId}`);
          removeNotificationSubscription(roomId, sub.username, sub.deviceId);
        }
      }
    });

  // Wait for all push notifications to complete
  await Promise.allSettled(pushPromises);

  // Also send to connected WebSocket clients for real-time updates
  const notificationData = {
    type: 'pushNotification',
    roomId,
    message: {
      username: message.username,
      content: message.text
    }
  };

  const allClients = Array.from(wss.clients).filter(client => client.readyState === WebSocket.OPEN);
  for (const client of allClients) {
    try {
      client.send(JSON.stringify(notificationData));
    } catch (error) {
      console.error(`[NOTIFICATIONS] Failed to send WebSocket notification to client:`, error);
    }
  }
}

// Clean up expired subscriptions every minute
setInterval(cleanupExpiredSubscriptions, 60000)

// Additional room cleanup check every 2 minutes to catch any edge cases
setInterval(() => {
  // Ensure global room always exists
  ensureGlobalRoomExists();
  
  let cleanedRooms = 0;
  
  for (const [roomId, room] of Object.entries(rooms)) {
    // Never delete the global room
    if (roomId === 'global') continue;
    
    const hasUsers = room.users.size > 0;
    const hasActiveSubscriptions = getActiveSubscriptions(roomId).length > 0;
    
    // Only delete room if no users AND no active subscriptions
    if (!hasUsers && !hasActiveSubscriptions) {
      delete rooms[roomId];
      notificationSubscriptions.delete(roomId);
      cleanedRooms++;
      console.log(`[ROOM_CLEANUP][SERVER:${PORT}] Scheduled cleanup: Deleted empty room ${roomId}`);
    }
  }
  
  if (cleanedRooms > 0) {
    broadcastRooms();
    console.log(`[ROOM_CLEANUP][SERVER:${PORT}] Scheduled cleanup: Removed ${cleanedRooms} empty rooms`);
  }
}, 120000); // every 2 minutes

const server = createServer();
const wss = new WebSocketServer({ server, maxPayload: 150 * 1024 * 1024 }); // 150 MB max payload size

function getClientsInRoom(roomId: string) {
  return Array.from(wss.clients).filter((client) => {
    // @ts-expect-error custom property
    return client.joinedRoom === roomId && client.readyState === WebSocket.OPEN;
  });
}

// Reliable message broadcast with error handling and retry
function broadcastToRoom(roomId: string, type: string, data: { [key: string]: unknown }, retries: number = 2): Promise<boolean> {
  return new Promise((resolve) => {
    const attemptSend = (attempt: number) => {
      const clients = getClientsInRoom(roomId); // Fresh client list each attempt
      
      if (clients.length === 0) {
        console.log(`[BROADCAST] No clients in room ${roomId}`);
        resolve(false);
        return;
      }
      
      const message = JSON.stringify({ type, roomId, ...data });
      let successCount = 0;
      let failureCount = 0;
      
      clients.forEach((client, index) => {
        try {
          if (client.readyState === WebSocket.OPEN) {
            client.send(message);
            successCount++;
            console.log(`[BROADCAST] ✅ Sent ${type} to client ${index + 1}/${clients.length} in room ${roomId}`);
          } else {
            failureCount++;
            console.log(`[BROADCAST] ❌ Client ${index + 1} not ready (state: ${client.readyState})`);
          }
        } catch (error) {
          failureCount++;
          console.error(`[BROADCAST] ❌ Failed to send ${type} to client ${index + 1}:`, error);
        }
      });
      
      console.log(`[BROADCAST] ${type} delivery: ${successCount} success, ${failureCount} failed (attempt ${attempt + 1}/${retries + 1})`);
      
      if (successCount > 0 || attempt >= retries) {
        resolve(successCount > 0);
      } else {
        // Retry after a short delay
        setTimeout(() => attemptSend(attempt + 1), 100 * (attempt + 1));
      }
    };
    
    attemptSend(0);
  });
}

// --- Enhanced heartbeat system with ghost user detection and room cleanup ---
setInterval(async () => {
  const ghostUsers: Array<{ roomId: string; username: string; ws: WebSocket }> = [];
  
  wss.clients.forEach((ws) => {
    const client = ws as WebSocket & { joinedRoom?: string; joinedUser?: string; isAlive?: boolean };
    if (!client.joinedRoom) return; // Only ping if client is in a room
    
    if (client.isAlive === false) {
      // This is a ghost user - connection failed to respond to previous ping
      console.log(`[HEARTBEAT][SERVER:${PORT}] Detected ghost user: ${client.joinedUser} in room: ${client.joinedRoom}`);
      
      // Collect ghost user info before terminating connection
      if (client.joinedRoom && client.joinedUser) {
        ghostUsers.push({
          roomId: client.joinedRoom,
          username: client.joinedUser,
          ws: client
        });
      }
      
      client.terminate();
      return;
    }
      client.isAlive = false;
    client.ping();
    console.log(`[HEARTBEAT][SERVER:${PORT}] Sent ping to ${client.joinedUser} in room: ${client.joinedRoom}`);
  });

  // Clean up ghost users from room data structures
  for (const ghost of ghostUsers) {
    const { roomId, username } = ghost;
    
    if (rooms[roomId] && rooms[roomId].users.has(username)) {
      console.log(`[HEARTBEAT][SERVER:${PORT}] Removing ghost user ${username} from room ${roomId}`);
      
      // Remove user from room
      rooms[roomId].users.delete(username);
      
      // Broadcast leave notification message (system message)
      const leaveMsg = { 
        username: '', 
        text: `${username} disconnected.`, 
        timestamp: Date.now(), 
        system: true 
      };
      
      try {
        await broadcastToRoom(roomId, 'newMessage', { message: leaveMsg });
        
        // Broadcast updated room info
        const usersArr = Array.from(rooms[roomId].users);
        const roomInfo = { 
          id: roomId, 
          name: rooms[roomId].name, 
          count: rooms[roomId].users.size, 
          maxParticipants: rooms[roomId].maxParticipants, 
          locked: rooms[roomId].locked, 
          visibility: rooms[roomId].visibility, 
          exists: true, 
          owner: rooms[roomId].owner, 
          users: usersArr 
        };
        await broadcastToRoom(roomId, 'roomInfo', { room: roomInfo });
        
      } catch (error) {
        console.error(`[HEARTBEAT][SERVER:${PORT}] Error broadcasting ghost user removal:`, error);
      }
      
      // Check if room should be deleted after ghost user removal
      if (rooms[roomId].users.size === 0) {
        checkRoomDeletionAfterSubscriptionCleanup(roomId);
      }
    }
  }
  
  // Broadcast updated rooms list if any ghost users were removed
  if (ghostUsers.length > 0) {
    broadcastRooms();
    console.log(`[HEARTBEAT][SERVER:${PORT}] Cleaned up ${ghostUsers.length} ghost users and updated room listings`);
  }
  
}, 30000); // every 30 seconds

wss.on('connection', (ws: WebSocket & { joinedRoom?: string; joinedUser?: string; isAlive?: boolean }) => {
  ws.isAlive = true;  ws.on('pong', () => {
    ws.isAlive = true;
    const room = ws.joinedRoom || 'none';
    const user = ws.joinedUser || 'unknown';
    console.log(`[HEARTBEAT][SERVER:${PORT}] Received pong from ${user} in room: ${room}`);
  });

  // Track which room and username this socket is in
  let joinedRoom: string | null = null;
  let joinedUser: string | null = null;
  ws.joinedRoom = undefined;
  ws.joinedUser = undefined;

  ws.on('message', async (data: WebSocket.RawData) => {
    try {
      const msg = JSON.parse(data.toString());      if (msg.type === 'getRooms') {
        console.log('[WebSocket Server] getRooms request - Current rooms:', Object.keys(rooms))
        console.log('[WebSocket Server] Global room exists:', !!rooms['global'])
        
        // Include all rooms including global room
        const allRooms = Object.entries(rooms)
          .map(([id, r]) => ({ id, name: r.name, count: r.users.size, maxParticipants: r.maxParticipants, locked: r.locked, visibility: r.visibility }));
        
        console.log('[WebSocket Server] Sending rooms:', allRooms.map(r => r.id))
        ws.send(JSON.stringify({ type: 'rooms', rooms: allRooms }));      } else if (msg.type === 'joinRoom') {
        const { roomId, username, password } = msg;
        console.log(`[WebSocket Server] joinRoom request - roomId: ${roomId}, username: ${username}`)
        console.log(`[WebSocket Server] Room exists: ${!!rooms[roomId]}`)
        
        // Validate username and roomId
        if (!username || typeof username !== 'string' || username.length < 1 || username.length > 20) {
          ws.send(JSON.stringify({ type: 'error', error: 'Invalid username. Must be 1-20 characters.' }));
          return;
        }
        if (!roomId || typeof roomId !== 'string' || roomId.length < 1 || roomId.length > 40) {
          ws.send(JSON.stringify({ type: 'error', error: 'Invalid room ID.' }));
          return;
        }        if (!rooms[roomId]) {
          // Prevent recreating the global room
          if (roomId === 'global') {
            ws.send(JSON.stringify({ type: 'error', error: 'Cannot create global room - it already exists.' }));
            return;
          }
          
          // Create new room
          const hashedPassword = password ? bcrypt.hashSync(password, 8) : undefined;
          const displayName = typeof msg.displayName === 'string' && msg.displayName.trim().length > 0 ? msg.displayName.trim() : `${roomId}`;
          const visibility = typeof msg.visibility === 'string' && (msg.visibility === 'public' || msg.visibility === 'private') ? msg.visibility : 'public';
          const maxParticipants = typeof msg.maxParticipants === 'number' && msg.maxParticipants > 0 ? msg.maxParticipants : 10;
          rooms[roomId] = { name: displayName, users: new Set(), locked: !!password, maxParticipants, visibility, owner: username, password: hashedPassword };
          broadcastRooms(); // Broadcast new room list
        }
        // Prevent duplicate usernames
        if (rooms[roomId].users.has(username)) {
          ws.send(JSON.stringify({ type: 'error', error: 'Username already taken in this room', requestId: Date.now() + Math.random() }));
          return;
        }
        // Prevent joining if room is full
        if (rooms[roomId].users.size >= rooms[roomId].maxParticipants) {
          ws.send(JSON.stringify({ type: 'error', error: 'Room is full.' }));
          return;
        }
        // Prevent joining locked rooms (password logic)
        if (rooms[roomId].locked) {
          if (!password || !rooms[roomId].password || !bcrypt.compareSync(password, rooms[roomId].password)) {
            ws.send(JSON.stringify({ type: 'error', error: 'Room is locked. Password required or incorrect.' }));
            return;
          }        }
        rooms[roomId].users.add(username);        // Set owner only for rooms that don't have one (except global room)
        if (roomId !== 'global' && !rooms[roomId].owner) {
          rooms[roomId].owner = username;
        }
        joinedRoom = roomId;
        joinedUser = username;
        ws.joinedRoom = roomId;
        ws.joinedUser = username;
        broadcastRooms(); // Broadcast participant count change        // Send join notification message (system message, only broadcast, not stored)
        const joinMsg = { username: '', text: `${username} joined the chat.`, timestamp: Date.now(), system: true };
        // Only broadcast to clients in this room
        const usersArr = Array.from(rooms[roomId].users);
        
        // Use robust broadcast for join message
        await broadcastToRoom(roomId, 'newMessage', { message: joinMsg });
        
        // Send room info to all clients in room
        const roomInfo = { 
          id: roomId, 
          name: rooms[roomId].name, 
          count: rooms[roomId].users.size, 
          maxParticipants: rooms[roomId].maxParticipants, 
          locked: rooms[roomId].locked, 
          visibility: rooms[roomId].visibility, 
          exists: true, 
          owner: rooms[roomId].owner, 
          users: usersArr 
        };
        await broadcastToRoom(roomId, 'roomInfo', { room: roomInfo });} else if (msg.type === 'sendMessage') {
        const { roomId, username, text } = msg;
        const message = { username, text, timestamp: Date.now() };
        
        if (rooms[roomId]) {          // Check if this is an AI command
          if (text.trim().startsWith('!')) {
            const aiPrompt = text.trim().substring(1).trim(); // Remove '!' prefix
            
            if (aiPrompt.length === 0) {
              return;
            }            // Process AI request - send user message first, then AI response when ready
            try {
              console.log(`[AI] Processing command from ${username}: ${aiPrompt}`);
              
              // 1. Send the user's AI command message immediately
              const userMessage = { username, text, timestamp: Date.now() };
              await broadcastToRoom(roomId, 'newMessage', { message: userMessage });
              
              // 2. Process AI request and send response when ready
              const aiResponse = await aiService.chat(aiPrompt, username);
              const aiMessage = { 
                username: `Gizli AI → ${username}`, 
                text: aiResponse, 
                timestamp: Date.now(),
                isAI: true
              };
              await broadcastToRoom(roomId, 'newMessage', { message: aiMessage });
              
              console.log(`[AI] Successfully processed command for ${username}`);
              
            } catch (error) {
              console.error('[AI Service] Error processing AI request:', error);
              const errorMessage = { 
                username: `Gizli AI → ${username}`, 
                text: '🤖 Sorry, I encountered an error while processing your request. Please try again.', 
                timestamp: Date.now(),
                isAI: true
              };
              
              await broadcastToRoom(roomId, 'newMessage', { message: errorMessage });
            }          } else {
            // Regular message handling
            await broadcastToRoom(roomId, 'newMessage', { message });
            
            // Send notifications to subscribed users who are not currently in the room
            await sendNotificationsForMessage(roomId, message);
          }
        }      } else if (msg.type === 'sendFile') {
        const { roomId, username, fileName, fileType, fileData, timestamp, asAudio } = msg;        console.log('[ws-server] Received sendFile:', { roomId, username, fileName, fileType, timestamp, fileDataLength: fileData?.length });
        const message = { username, fileName, fileType, fileData, timestamp, type: 'file', ...(asAudio ? { asAudio: true } : {}) };
        if (rooms[roomId]) {
          console.log('[ws-server] Broadcasting file message to room:', roomId);
          await broadcastToRoom(roomId, 'newMessage', { message });
          
          // Send notifications for file messages too
          const notificationMessage = {
            username,
            text: asAudio ? '🎤 Voice message' : `📎 ${fileName || 'File'}`
          };
          await sendNotificationsForMessage(roomId, notificationMessage);
        }      } else if (msg.type === 'updateRoomSettings') {
        const { roomId, username, name, maxParticipants, locked, password, visibility, updateId } = msg;        // Prevent updating global room settings
        if (roomId === 'global') {
          ws.send(JSON.stringify({ type: 'error', error: 'Global room settings cannot be modified.' }));
          return;
        }
        
        if (rooms[roomId] && rooms[roomId].owner === username) {
          // Prevent setting maxParticipants lower than current user count
          if (typeof maxParticipants === 'number') {
            if (maxParticipants < rooms[roomId].users.size) {
              ws.send(JSON.stringify({ type: 'error', error: `Cannot set max participants below current user count (${rooms[roomId].users.size}).` }));
              return;
            }
            rooms[roomId].maxParticipants = maxParticipants;
          }
          if (typeof name === 'string') rooms[roomId].name = name;
          if (typeof locked === 'boolean') rooms[roomId].locked = locked;
          if (typeof visibility === 'string' && (visibility === 'public' || visibility === 'private')) {
            rooms[roomId].visibility = visibility;
          }
          if (typeof password === 'string' && password.length > 0) {
            rooms[roomId].password = bcrypt.hashSync(password, 8);
            rooms[roomId].locked = true;
          }
          if (password === '') {
            rooms[roomId].password = undefined;
            rooms[roomId].locked = false;
          }          // Broadcast updated roomInfo (with users)
          const usersArr = Array.from(rooms[roomId].users);
          const roomInfo = { 
            id: roomId, 
            name: rooms[roomId].name, 
            count: rooms[roomId].users.size, 
            maxParticipants: rooms[roomId].maxParticipants, 
            locked: rooms[roomId].locked, 
            visibility: rooms[roomId].visibility, 
            exists: true, 
            owner: rooms[roomId].owner, 
            users: usersArr 
          };
          
          await broadcastToRoom(roomId, 'roomInfo', { room: roomInfo, updateId });
          
          // Broadcast updated rooms list to all clients (visibility change affects public listing)
          broadcastRooms();        } else {
          ws.send(JSON.stringify({ type: 'error', error: 'Only the room owner can update settings.' }));
        }      } else if (msg.type === 'subscribeNotifications') {
        const { roomId, username, deviceId, interval, pushSubscription } = msg;
        console.log(`[NOTIFICATIONS] Subscribe request: ${username} (device: ${deviceId}) in room ${roomId} for ${interval} minutes`, {
          hasPushSubscription: !!pushSubscription
        });
        
        if (interval > 0) {
          addNotificationSubscription(roomId, username, deviceId || 'unknown', interval, pushSubscription);
          ws.send(JSON.stringify({ 
            type: 'notificationSubscribed', 
            roomId, 
            interval,
            success: true 
          }));
        } else {
          removeNotificationSubscription(roomId, username, deviceId || 'unknown');
          ws.send(JSON.stringify({ 
            type: 'notificationUnsubscribed', 
            roomId,
            success: true 
          }));
        }      } else if (msg.type === 'getNotificationStatus') {
        const { roomId, username, deviceId } = msg;
        const subscriptions = getActiveSubscriptions(roomId);
        const userSubscription = subscriptions.find(sub => sub.username === username && sub.deviceId === (deviceId || 'unknown'));
        
        ws.send(JSON.stringify({
          type: 'notificationStatus',
          roomId,
          subscribed: !!userSubscription,
          interval: userSubscription?.interval || 0,
          remainingTime: userSubscription ? Math.max(0, userSubscription.endTime - Date.now()) : 0
        }));
      } else if (msg.type === 'getAllNotificationStatus') {
        const { deviceId } = msg;
        console.log(`[NOTIFICATIONS] Getting all notification status for device: ${deviceId}`);
        
        // Find all subscriptions for this device across all rooms
        const deviceSubscriptions: Array<{
          roomId: string;
          interval: number;
          remainingTime: number;
          username: string;
        }> = [];
        
        for (const subscriptions of notificationSubscriptions.values()) {
          for (const sub of subscriptions) {
            if (sub.deviceId === deviceId) {
              const remainingTime = Math.max(0, sub.endTime - Date.now());
              if (remainingTime > 0) { // Only include active subscriptions
                deviceSubscriptions.push({
                  roomId: sub.roomId,
                  interval: sub.interval,
                  remainingTime,
                  username: sub.username
                });
              }
            }
          }
        }
        
        console.log(`[NOTIFICATIONS] Found ${deviceSubscriptions.length} active subscriptions for device ${deviceId}`);
        
        ws.send(JSON.stringify({
          type: 'allNotificationStatus',
          subscriptions: deviceSubscriptions
        }));} else if (msg.type === 'clearAllPushSubscriptions') {
        // Clear all push subscriptions (when VAPID keys change)
        console.log('[NOTIFICATIONS] Received request to clear all push subscriptions due to VAPID key change');
        clearAllPushSubscriptions();
        ws.send(JSON.stringify({
          type: 'pushSubscriptionsCleared',
          success: true
        }));
      } else if (msg.type === 'leaveRoom') {
        const { roomId, username } = msg;
        if (joinedRoom === roomId && joinedUser === username && rooms[roomId]) {
          // Remove user from room
          rooms[roomId].users.delete(username);
            // Send leave notification message (system message, only to clients in the room)
          const leaveMsg = { username: '', text: `${username} left the chat.`, timestamp: Date.now(), system: true };
          const usersArr = Array.from(rooms[roomId].users);
          
          await broadcastToRoom(roomId, 'newMessage', { message: leaveMsg });
          
          const roomInfo = { 
            id: roomId, 
            name: rooms[roomId].name, 
            count: rooms[roomId].users.size, 
            maxParticipants: rooms[roomId].maxParticipants, 
            locked: rooms[roomId].locked, 
            visibility: rooms[roomId].visibility, 
            exists: true, 
            owner: rooms[roomId].owner, 
            users: usersArr 
          };
          await broadcastToRoom(roomId, 'roomInfo', { room: roomInfo });
          
          // Update joined state
          joinedRoom = null;
          joinedUser = null;
          ws.joinedRoom = undefined;
          ws.joinedUser = undefined;
            broadcastRooms(); // Broadcast participant count change
          
          // Check if room should be deleted (considering subscriptions)
          if (rooms[roomId].users.size === 0) {
            checkRoomDeletionAfterSubscriptionCleanup(roomId);
          }
        }
      }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (e) {
      ws.send(JSON.stringify({ type: 'error', error: 'Invalid message' }));
    }
  });
  ws.on('close', async () => {
    if (typeof joinedRoom === 'string' && joinedUser && joinedRoom in rooms && rooms[joinedRoom]) {
      rooms[joinedRoom].users.delete(joinedUser);
      // Broadcast leave notification message (system message, only to clients in the room)
      const leaveMsg = { username: '', text: `${joinedUser} left the chat.`, timestamp: Date.now(), system: true };
      const usersArr = Array.from(rooms[joinedRoom].users);
      
      await broadcastToRoom(joinedRoom, 'newMessage', { message: leaveMsg });
      
      const roomInfo = { 
        id: joinedRoom, 
        name: rooms[joinedRoom].name, 
        count: rooms[joinedRoom].users.size, 
        maxParticipants: rooms[joinedRoom].maxParticipants, 
        locked: rooms[joinedRoom].locked, 
        visibility: rooms[joinedRoom].visibility, 
        exists: true, 
        owner: rooms[joinedRoom].owner, 
        users: usersArr 
      };
      await broadcastToRoom(joinedRoom, 'roomInfo', { room: roomInfo });
      
      broadcastRooms(); // Broadcast participant count change      // Check if room should be deleted (considering subscriptions)
      if (rooms[joinedRoom].users.size === 0) {
        checkRoomDeletionAfterSubscriptionCleanup(joinedRoom);
      }
    }
  });
  ws.on('error', async (err) => {
    // @ts-expect-error: custom error code property for ws errors
    if (err && err.code === 'WS_ERR_UNSUPPORTED_MESSAGE_LENGTH') {
      ws.send(JSON.stringify({ type: 'error', error: 'File too large. Max file size exceeded.' }));
      // Also notify the user in the room if possible
      if (ws.joinedRoom && ws.joinedUser) {
        const systemMsg = {
          username: '',
          text: `${ws.joinedUser} tried to send a file that was too large and it was not sent.`,
          timestamp: Date.now(),
          system: true
        };
        await broadcastToRoom(ws.joinedRoom, 'newMessage', { message: systemMsg });
      }
      ws.send(JSON.stringify({ type: 'error', error: 'WebSocket error: ' + (err?.message || err) }));
      console.error('[ws-server] File too large error:', err);
    } else {
      ws.send(JSON.stringify({ type: 'error', error: 'WebSocket error: ' + (err?.message || err) }));
      console.error('[ws-server] WebSocket error:', err);
    }
  });
});

// --- Error handling for large payloads and other errors ---
wss.on('error', (err) => {
  console.error('[ws-server] WebSocket server error:', err);
});

function broadcastRooms() {
  // Include all rooms including global room
  const roomList = Object.entries(rooms)
    .map(([id, r]) => ({ id, name: r.name, count: r.users.size, maxParticipants: r.maxParticipants, locked: r.locked, visibility: r.visibility }));
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(JSON.stringify({ type: 'rooms', rooms: roomList }));
    }
  });
}

// Check if room should be deleted when no users and no subscriptions
function checkRoomDeletionAfterSubscriptionCleanup(roomId: string): void {
  const room = rooms[roomId]
  if (!room) return
  
  // Never delete the global room
  if (roomId === 'global') return
  
  const hasUsers = room.users.size > 0
  const hasActiveSubscriptions = getActiveSubscriptions(roomId).length > 0
  
  // Only delete room if no users AND no active subscriptions
  if (!hasUsers && !hasActiveSubscriptions) {
    delete rooms[roomId]
    notificationSubscriptions.delete(roomId)
    console.log(`[ROOM] Deleted room ${roomId} - no users and no active subscriptions`)
    broadcastRooms()
  } else if (!hasUsers && hasActiveSubscriptions) {
    console.log(`[ROOM] Keeping room ${roomId} - no users but has ${getActiveSubscriptions(roomId).length} active subscriptions`)
  }
}

server.on('request', (req, res) => {  // Handle VAPID public key endpoint
  if (req.method === 'GET' && req.url === '/vapid-public-key') {
    res.writeHead(200, { 
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end(JSON.stringify({ publicKey: VAPID_KEYS.publicKey }));
    return;
  }

  // Default 404 response
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('WebSocket server does not serve HTTP content. Use WebSocket protocol.');
});

server.listen(PORT as number, '0.0.0.0', () => {
  console.log(`WebSocket server 1.6.1 running on ws://localhost:${PORT}`);
});

// --- BEGIN: WebRTC Group Audio Call Signaling Support ---

// In-memory signaling state for group calls
type CallPeerInfo = {
  ws: WebSocket
  username: string
  isListener: boolean
}
const callRooms: Record<string, Record<string, CallPeerInfo>> = {}

// Helper: broadcast to all peers in a call room except sender
function broadcastCall(roomId: string, type: string, data: Record<string, unknown>, exceptUsername?: string) {
  const peers = callRooms[roomId]
  if (!peers) return
  Object.entries(peers).forEach(([username, info]) => {
    if (username !== exceptUsername && info.ws.readyState === WebSocket.OPEN) {
      info.ws.send(JSON.stringify({ type, ...data }))
    }
  })
}

// Clean up call room if empty
function cleanupCallRoom(roomId: string) {
  if (callRooms[roomId] && Object.keys(callRooms[roomId]).length === 0) {
    delete callRooms[roomId]
  }
}

// --- END: WebRTC Group Audio Call Signaling ---

wss.on('connection', (ws: WebSocket & { joinedRoom?: string; joinedUser?: string; isAlive?: boolean }) => {
  ws.isAlive = true;  ws.on('pong', () => {
    ws.isAlive = true;
    const room = ws.joinedRoom || 'none';
    const user = ws.joinedUser || 'unknown';
    console.log(`[HEARTBEAT][SERVER:${PORT}] Received pong from ${user} in room: ${room}`);
  });

  // Track which room and username this socket is in
  let joinedRoom: string | null = null;
  let joinedUser: string | null = null;
  ws.joinedRoom = undefined;
  ws.joinedUser = undefined;

  ws.on('message', async (data: WebSocket.RawData) => {
    try {
      const msg = JSON.parse(data.toString());

      // --- BEGIN: WebRTC Group Audio Call Signaling ---
      if (msg.type === "call-join") {
        // msg: { type, roomId, username, isListener }
        const { roomId, username, isListener } = msg
        if (!roomId || !username) return

        // Create call room if needed
        if (!callRooms[roomId]) callRooms[roomId] = {}
        // Add this peer
        callRooms[roomId][username] = { ws, username, isListener: !!isListener }

        // Tell the new peer about all existing peers
        Object.keys(callRooms[roomId]).forEach(existing => {
          if (existing !== username) {
            ws.send(JSON.stringify({ type: "call-new-peer", username: existing }))
          }
        })
        // Tell all existing peers about the new peer
        broadcastCall(roomId, "call-new-peer", { username }, username)

        // Clean up on close
        ws.on("close", () => {
          if (callRooms[roomId] && callRooms[roomId][username]) {
            delete callRooms[roomId][username]
            broadcastCall(roomId, "call-peer-left", { username }, username)
            cleanupCallRoom(roomId)
          }
        })
        // Clean up on error
        ws.on("error", () => {
          if (callRooms[roomId] && callRooms[roomId][username]) {
            delete callRooms[roomId][username]
            broadcastCall(roomId, "call-peer-left", { username }, username)
            cleanupCallRoom(roomId)
          }
        })
        return
      }
      if (msg.type === "call-offer" || msg.type === "call-answer" || msg.type === "call-ice") {
        // msg: { type, roomId, from, to, payload }
        const { roomId, from, to, payload } = msg
        if (!roomId || !from || !to) return
        const peers = callRooms[roomId]
        if (peers && peers[to] && peers[to].ws.readyState === WebSocket.OPEN) {
          peers[to].ws.send(JSON.stringify({ type: msg.type, from, payload }))
        }
        return
      }
      if (msg.type === "call-peer-left") {
        // msg: { type, roomId, username }
        const { roomId, username } = msg
        if (callRooms[roomId] && callRooms[roomId][username]) {
          delete callRooms[roomId][username]
          broadcastCall(roomId, "call-peer-left", { username }, username)
          cleanupCallRoom(roomId)
        }
        return
      }
      // --- END: WebRTC Group Audio Call Signaling ---

      // ...existing code...
    } catch (e) {
      ws.send(JSON.stringify({ type: 'error', error: 'Invalid message' }));
    }
  });
  ws.on('close', async () => {
    if (typeof joinedRoom === 'string' && joinedUser && joinedRoom in rooms && rooms[joinedRoom]) {
      rooms[joinedRoom].users.delete(joinedUser);
      // Broadcast leave notification message (system message, only to clients in the room)
      const leaveMsg = { username: '', text: `${joinedUser} left the chat.`, timestamp: Date.now(), system: true };
      const usersArr = Array.from(rooms[joinedRoom].users);
      
      await broadcastToRoom(joinedRoom, 'newMessage', { message: leaveMsg });
      
      const roomInfo = { 
        id: joinedRoom, 
        name: rooms[joinedRoom].name, 
        count: rooms[joinedRoom].users.size, 
        maxParticipants: rooms[joinedRoom].maxParticipants, 
        locked: rooms[joinedRoom].locked, 
        visibility: rooms[joinedRoom].visibility, 
        exists: true, 
        owner: rooms[joinedRoom].owner, 
        users: usersArr 
      };
      await broadcastToRoom(joinedRoom, 'roomInfo', { room: roomInfo });
      
      broadcastRooms(); // Broadcast participant count change      // Check if room should be deleted (considering subscriptions)
      if (rooms[joinedRoom].users.size === 0) {
        checkRoomDeletionAfterSubscriptionCleanup(joinedRoom);
      }
    }
  });
  ws.on('error', async (err) => {
    // @ts-expect-error: custom error code property for ws errors
    if (err && err.code === 'WS_ERR_UNSUPPORTED_MESSAGE_LENGTH') {
      ws.send(JSON.stringify({ type: 'error', error: 'File too large. Max file size exceeded.' }));
      // Also notify the user in the room if possible
      if (ws.joinedRoom && ws.joinedUser) {
        const systemMsg = {
          username: '',
          text: `${ws.joinedUser} tried to send a file that was too large and it was not sent.`,
          timestamp: Date.now(),
          system: true
        };
        await broadcastToRoom(ws.joinedRoom, 'newMessage', { message: systemMsg });
      }
      ws.send(JSON.stringify({ type: 'error', error: 'WebSocket error: ' + (err?.message || err) }));
      console.error('[ws-server] File too large error:', err);
    } else {
      ws.send(JSON.stringify({ type: 'error', error: 'WebSocket error: ' + (err?.message || err) }));
      console.error('[ws-server] WebSocket error:', err);
    }
  });
});
