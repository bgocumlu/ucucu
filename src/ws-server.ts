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

// File delivery tracking system
interface FileDeliveryTracker {
  roomId: string;
  filename: string;
  senderId: string;
  timestamp: number;
  expectedRecipients: Set<string>;
  confirmedRecipients: Set<string>;
  message: { [key: string]: unknown };
  broadcastTime: number;
}

const fileDeliveryTracking: Map<string, FileDeliveryTracker> = new Map();

// Clean up old file delivery tracking entries (older than 30 seconds)
setInterval(() => {
  const now = Date.now();
  const CLEANUP_THRESHOLD = 30000; // 30 seconds
  const REBROADCAST_THRESHOLD = 5000; // 5 seconds
  const MAX_TRACKING_ENTRIES = 1000; // Prevent unbounded growth
  
  // If we have too many entries, force cleanup of oldest ones
  if (fileDeliveryTracking.size > MAX_TRACKING_ENTRIES) {
    const entries = Array.from(fileDeliveryTracking.entries());
    entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
    const toDelete = entries.slice(0, Math.floor(MAX_TRACKING_ENTRIES * 0.3));
    toDelete.forEach(([key]) => {
      console.log(`[FILE-DELIVERY-CLEANUP] Force removing old tracking entry: ${key}`);
      fileDeliveryTracking.delete(key);
    });
  }
  
  for (const [key, tracker] of fileDeliveryTracking.entries()) {
    const age = now - tracker.broadcastTime;
    
    // Check if file needs rebroadcast (some recipients haven't confirmed)
    if (age > REBROADCAST_THRESHOLD && age < CLEANUP_THRESHOLD) {
      const unconfirmedRecipients = Array.from(tracker.expectedRecipients).filter(
        user => !tracker.confirmedRecipients.has(user)
      );
      
      if (unconfirmedRecipients.length > 0) {
        console.log(`[FILE-DELIVERY-RETRY] Rebroadcasting ${tracker.filename} to ${unconfirmedRecipients.length} unconfirmed recipients: ${unconfirmedRecipients.join(', ')}`);
        
        // Rebroadcast the file
        broadcastToRoom(tracker.roomId, 'newMessage', { message: tracker.message }).then(success => {
          console.log(`[FILE-DELIVERY-RETRY] Rebroadcast result for ${tracker.filename}: ${success ? 'SUCCESS' : 'FAILED'}`);
        }).catch(error => {
          console.error(`[FILE-DELIVERY-RETRY] Error rebroadcasting ${tracker.filename}:`, error);
        });
        
        // Update broadcast time to prevent constant rebroadcasts
        tracker.broadcastTime = now;
      }
    }
    
    // Clean up old entries
    if (age > CLEANUP_THRESHOLD) {
      const unconfirmedCount = tracker.expectedRecipients.size - tracker.confirmedRecipients.size;
      if (unconfirmedCount > 0) {
        const unconfirmedUsers = Array.from(tracker.expectedRecipients).filter(
          user => !tracker.confirmedRecipients.has(user)
        );
        console.warn(`[FILE-DELIVERY-TIMEOUT] ⚠️ ${tracker.filename} from ${tracker.senderId}: ${unconfirmedCount} recipients never confirmed delivery: ${unconfirmedUsers.join(', ')}`);
      }
      
      console.log(`[FILE-DELIVERY-CLEANUP] Removing tracking for ${tracker.filename} (age: ${Math.round(age / 1000)}s)`);
      fileDeliveryTracking.delete(key);
    }
  }
}, 3000); // Check every 3 seconds for more responsive rebroadcasts

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
  let totalGhostParticipants = 0;
  
  for (const [roomId, room] of Object.entries(rooms)) {
    const hasActiveSubscriptions = getActiveSubscriptions(roomId).length > 0;
    
    // Cross-verify room participants against actual connected WebSocket clients
    const connectedClientsInRoom = getClientsInRoom(roomId);
    const connectedUsernames = new Set(
      connectedClientsInRoom.map(client => (client as WebSocket & { joinedUser?: string }).joinedUser).filter(Boolean)
    );
    
    // Find ghost participants (in room.users but no WebSocket connection)
    const ghostParticipants = Array.from(room.users).filter(username => 
      !connectedUsernames.has(username)
    );
    
    if (ghostParticipants.length > 0) {
      console.log(`[ROOM_CLEANUP][SERVER:${PORT}] Found ${ghostParticipants.length} ghost participants in room ${roomId}: ${ghostParticipants.join(', ')}`);
      console.log(`[ROOM_CLEANUP][SERVER:${PORT}] Connected clients: ${Array.from(connectedUsernames).join(', ') || 'none'}`);
        // Remove ghost participants from room
      for (const ghostUser of ghostParticipants) {
        room.users.delete(ghostUser);
        totalGhostParticipants++;
        console.log(`[ROOM_CLEANUP][SERVER:${PORT}] Removed ghost participant: ${ghostUser} from room ${roomId}`);
      }
    }
    
    const hasUsers = room.users.size > 0;

    if (roomId === 'global') {
      // Global room is never deleted, just cleaned of ghost participants above
      continue;
    }
    
    // Only delete non-global rooms if no users AND no active subscriptions
    if (!hasUsers && !hasActiveSubscriptions) {
      delete rooms[roomId];
      notificationSubscriptions.delete(roomId);
      cleanedRooms++;
      console.log(`[ROOM_CLEANUP][SERVER:${PORT}] Scheduled cleanup: Deleted empty room ${roomId}`);
    }
  }
    if (cleanedRooms > 0 || totalGhostParticipants > 0) {
    if (cleanedRooms > 0) {
      console.log(`[ROOM_CLEANUP][SERVER:${PORT}] Scheduled cleanup: Removed ${cleanedRooms} empty rooms`);
    }
    if (totalGhostParticipants > 0) {
      console.log(`[ROOM_CLEANUP][SERVER:${PORT}] Scheduled cleanup: Removed ${totalGhostParticipants} ghost participants across all rooms`);
    }
    broadcastRooms();
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
function broadcastToRoom(roomId: string, type: string, data: { [key: string]: unknown }, targetUser?: string, retries: number = 2): Promise<boolean> {
  return new Promise((resolve) => {
    const attemptSend = (attempt: number) => {
      const allClients = getClientsInRoom(roomId); // Fresh client list each attempt
      
      // Filter clients by target user if specified
      const clients = targetUser 
        ? allClients.filter(client => {
            const clientWs = client as WebSocket & { joinedUser?: string };
            return clientWs.joinedUser === targetUser;
          })
        : allClients;
      
      if (clients.length === 0) {
        console.log(`[BROADCAST] No ${targetUser ? `target user (${targetUser})` : 'clients'} in room ${roomId}`);
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
            console.log(`[BROADCAST] ✅ Sent ${type} to ${targetUser ? `target user ${targetUser}` : `client ${index + 1}/${clients.length}`} in room ${roomId}`);
          } else {
            failureCount++;
            console.log(`[BROADCAST] ❌ Client ${index + 1} not ready (state: ${client.readyState})`);
          }
        } catch (error) {
          failureCount++;
          console.error(`[BROADCAST] ❌ Failed to send ${type} to client ${index + 1}:`, error);
        }
      });
      
      console.log(`[BROADCAST] ${type} delivery to ${targetUser || 'all'}: ${successCount} success, ${failureCount} failed (attempt ${attempt + 1}/${retries + 1})`);
      
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
  ws.isAlive = true;
  
  ws.on('pong', () => {
    ws.isAlive = true;
    const room = ws.joinedRoom || 'none';
    const user = ws.joinedUser || 'unknown';
    console.log(`[HEARTBEAT][SERVER:${PORT}] Received pong from ${user} in room: ${room}`);

    // Enhanced desynchronization detection: Check if WebSocket thinks it's in room but room doesn't have user
    if (ws.joinedRoom && ws.joinedUser) {
      const roomData = rooms[ws.joinedRoom];
      if (!roomData || !roomData.users.has(ws.joinedUser)) {
        console.log(`[HEARTBEAT][SERVER:${PORT}] Desynchronized connection detected: ${ws.joinedUser} thinks they're in room ${ws.joinedRoom} but room data disagrees`);
        console.log(`[HEARTBEAT][SERVER:${PORT}] Room exists: ${!!roomData}, User in room: ${roomData ? roomData.users.has(ws.joinedUser) : false}`);
        
        // This is a ghost connection - terminate it
        ws.terminate();
        return;
      }
    }
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
        await broadcastToRoom(roomId, 'roomInfo', { room: roomInfo });      } else if (msg.type === 'sendMessage') {
        const { roomId, username, text, messageType } = msg;
        
        // Rate limiting check
        if (!checkRateLimit(`${username}-${roomId}`, false)) {
          ws.send(JSON.stringify({ 
            type: 'error', 
            error: 'Rate limit exceeded. Please slow down your messaging.' 
          }));
          return;
        }
        
        // Handle file upload status messages
        if (messageType === 'fileUploadStart') {
          if (rooms[roomId] && rooms[roomId].users.has(username)) {
            const message = { username, type: 'fileUploadStart', timestamp: Date.now() };
            await broadcastToRoom(roomId, 'newMessage', { message });
          }
          return;
        } else if (messageType === 'fileUploadEnd') {
          if (rooms[roomId] && rooms[roomId].users.has(username)) {
            const message = { username, type: 'fileUploadEnd', timestamp: Date.now() };
            await broadcastToRoom(roomId, 'newMessage', { message });
          }
          return;
        }
        
        const message = { username, text, timestamp: Date.now() };
        
        if (rooms[roomId]) {          // Check if user is actually in the room's participant list
          if (!rooms[roomId].users.has(username)) {
            console.log(`[SECURITY] User ${username} attempted to send message to room ${roomId} without being a participant`);
            
            // Attempt auto-rejoin for non-password rooms
            if (!rooms[roomId].locked && rooms[roomId].users.size < rooms[roomId].maxParticipants) {
              console.log(`[AUTO-REJOIN] Attempting to auto-rejoin user ${username} to non-password room ${roomId}`);
              
              try {
                // Check if username is already taken
                if (rooms[roomId].users.has(username)) {
                  console.log(`[AUTO-REJOIN] Username ${username} already taken in room ${roomId}`);
                  ws.send(JSON.stringify({ 
                    type: 'error', 
                    error: 'Username already taken in this room.',
                    redirect: `/${roomId}`,
                    action: 'rejoin'
                  }));
                  return;
                }
                
                // Add user to room
                rooms[roomId].users.add(username);
                
                // Update WebSocket tracking
                ws.joinedRoom = roomId;
                ws.joinedUser = username;
                
                console.log(`[AUTO-REJOIN] Successfully rejoined user ${username} to room ${roomId}`);
                
                // Send join notification message
                const joinMsg = { username: '', text: `${username} rejoined the chat.`, timestamp: Date.now(), system: true };
                const usersArr = Array.from(rooms[roomId].users);
                
                // Broadcast join message and room info
                await broadcastToRoom(roomId, 'newMessage', { message: joinMsg });
                
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
                broadcastRooms(); // Broadcast participant count change
                
                // Continue with sending the message after successful rejoin
                console.log(`[AUTO-REJOIN] Proceeding to send message after successful rejoin`);
                
              } catch (error) {
                console.error(`[AUTO-REJOIN] Error during auto-rejoin for user ${username} to room ${roomId}:`, error);
                ws.send(JSON.stringify({ 
                  type: 'error', 
                  error: 'Failed to rejoin room automatically. Please rejoin manually.',
                  redirect: `/${roomId}`,
                  action: 'rejoin'
                }));
                return;
              }
            } else {
              // Room is password-protected or full, cannot auto-rejoin
              const reason = rooms[roomId].locked ? 'password-protected' : 'full';
              console.log(`[SECURITY] Cannot auto-rejoin user ${username} to ${reason} room ${roomId}`);
              ws.send(JSON.stringify({ 
                type: 'error', 
                error: `You must join the room before sending messages. Room is ${reason}.`,
                redirect: `/${roomId}`,
                action: 'rejoin'
              }));
              return;
            }
          }
          // Check if this is an AI command
          if (text.trim().startsWith('!')) {
            const aiPrompt = text.trim().substring(1).trim(); // Remove '!' prefix
            
            if (aiPrompt.length === 0) {
              return;
            }            // Process AI request - send user message first, then AI response when ready
            try {
              console.log(`[AI] Processing command from ${username}: ${aiPrompt}`);
              
              // 1. Send the user's AI command message immediately
              const userMessage = { username, text: aiPrompt, timestamp: Date.now() };
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
        const { roomId, username, fileName, fileType, fileData, timestamp, asAudio } = msg;
        
        // Rate limiting check for files
        if (!checkRateLimit(`${username}-${roomId}`, true)) {
          ws.send(JSON.stringify({ 
            type: 'error', 
            error: 'File upload rate limit exceeded. Please wait before sending another file.' 
          }));
          return;
        }
        
        console.log(`[ws-server] Received sendFile: ${fileName} from ${username} in room ${roomId}`);
        const message = { username, fileName, fileType, fileData, timestamp, type: 'file', ...(asAudio ? { asAudio: true } : {}) };if (rooms[roomId]) {          // Check if user is actually in the room's participant list
          if (!rooms[roomId].users.has(username)) {
            console.log(`[SECURITY] User ${username} attempted to send file to room ${roomId} without being a participant`);
            
            // Attempt auto-rejoin for non-password rooms
            if (!rooms[roomId].locked && rooms[roomId].users.size < rooms[roomId].maxParticipants) {
              console.log(`[AUTO-REJOIN] Attempting to auto-rejoin user ${username} to non-password room ${roomId} for file sending`);
              
              try {
                // Check if username is already taken
                if (rooms[roomId].users.has(username)) {
                  console.log(`[AUTO-REJOIN] Username ${username} already taken in room ${roomId}`);
                  ws.send(JSON.stringify({ 
                    type: 'error', 
                    error: 'Username already taken in this room.',
                    redirect: `/${roomId}`,
                    action: 'rejoin'
                  }));
                  return;
                }
                
                // Add user to room
                rooms[roomId].users.add(username);
                
                // Update WebSocket tracking
                ws.joinedRoom = roomId;
                ws.joinedUser = username;
                
                console.log(`[AUTO-REJOIN] Successfully rejoined user ${username} to room ${roomId} for file sending`);
                
                // Send join notification message
                const joinMsg = { username: '', text: `${username} rejoined the chat.`, timestamp: Date.now(), system: true };
                const usersArr = Array.from(rooms[roomId].users);
                
                // Broadcast join message and room info
                await broadcastToRoom(roomId, 'newMessage', { message: joinMsg });
                
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
                broadcastRooms(); // Broadcast participant count change
                
                // Continue with sending the file after successful rejoin
                console.log(`[AUTO-REJOIN] Proceeding to send file after successful rejoin`);
                
              } catch (error) {
                console.error(`[AUTO-REJOIN] Error during auto-rejoin for user ${username} to room ${roomId} for file sending:`, error);
                ws.send(JSON.stringify({ 
                  type: 'error', 
                  error: 'Failed to rejoin room automatically. Please rejoin manually.',
                  redirect: `/${roomId}`,
                  action: 'rejoin'
                }));
                return;
              }
            } else {
              // Room is password-protected or full, cannot auto-rejoin
              const reason = rooms[roomId].locked ? 'password-protected' : 'full';
              console.log(`[SECURITY] Cannot auto-rejoin user ${username} to ${reason} room ${roomId} for file sending`);
              ws.send(JSON.stringify({ 
                type: 'error', 
                error: `You must join the room before sending files. Room is ${reason}.`,
                redirect: `/${roomId}`,
                action: 'rejoin'
              }));
              return;
            }
          }          console.log('[ws-server] Broadcasting file message to room:', roomId);
          
          // Track expected recipients for delivery confirmation
          const expectedRecipients = new Set<string>();
          if (rooms[roomId]) {
            for (const user of rooms[roomId].users) {
              if (user !== username) { // Exclude sender
                expectedRecipients.add(user);
              }
            }
          }
          
          // Start tracking file delivery
          const trackingKey = `${fileName}-${timestamp}-${username}`;
          fileDeliveryTracking.set(trackingKey, {
            roomId,
            filename: fileName,
            senderId: username,
            timestamp,
            expectedRecipients: new Set(expectedRecipients),
            confirmedRecipients: new Set(),
            message,
            broadcastTime: Date.now()
          });
          
          console.log(`[FILE-DELIVERY-TRACK] Tracking ${fileName} for ${expectedRecipients.size} recipients: ${Array.from(expectedRecipients).join(', ')}`);
          
          const broadcastSuccess = await broadcastToRoom(roomId, 'newMessage', { message });
          console.log(`[ws-server] Broadcast result for ${fileName}: ${broadcastSuccess ? 'SUCCESS' : 'FAILED'}`);
          
          if (!broadcastSuccess) {
            console.error(`[ws-server] ❌ Failed to broadcast ${fileName} to room ${roomId} - retrying...`);
            // Retry broadcast after a short delay
            setTimeout(async () => {
              const retrySuccess = await broadcastToRoom(roomId, 'newMessage', { message });
              console.log(`[ws-server] Retry broadcast result for ${fileName}: ${retrySuccess ? 'SUCCESS' : 'FAILED'}`);
            }, 500);
          }
          
          // Send acknowledgment to the sender
          ws.send(JSON.stringify({ 
            type: 'fileUploadAck', 
            fileName: fileName,
            timestamp: timestamp,
            success: broadcastSuccess
          }));
          
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
        }));      } else if (msg.type === 'fileReceived') {
        const { roomId, username, fileName, senderId, timestamp } = msg;
        console.log(`[ws-server] File delivery confirmed: ${fileName} received by ${username} from ${senderId} in room ${roomId}`);
        
        // Validate that the receiver is actually in the room
        if (rooms[roomId] && rooms[roomId].users.has(username)) {
          // Log the successful delivery confirmation
          console.log(`[FILE-DELIVERY] ✅ ${senderId} → ${username}: ${fileName} (confirmed at ${new Date(timestamp).toISOString()})`);
          
          // Update delivery tracking
          const trackingKey = `${fileName}-${timestamp}-${senderId}`;
          const tracker = fileDeliveryTracking.get(trackingKey);
          
          if (tracker && tracker.expectedRecipients.has(username)) {
            tracker.confirmedRecipients.add(username);
            console.log(`[FILE-DELIVERY-TRACK] ${fileName}: ${tracker.confirmedRecipients.size}/${tracker.expectedRecipients.size} confirmations received`);
            
            // Check if all recipients have confirmed
            if (tracker.confirmedRecipients.size >= tracker.expectedRecipients.size) {
              console.log(`[FILE-DELIVERY-TRACK] ✅ ${fileName} fully delivered to all ${tracker.expectedRecipients.size} recipients`);
              // Optionally clean up the tracker immediately since delivery is complete
              fileDeliveryTracking.delete(trackingKey);
            }
          } else if (!tracker) {
            console.log(`[FILE-DELIVERY-TRACK] ⚠️ No tracking found for ${fileName}-${timestamp}-${senderId} (may have expired)`);
          }
          
          // Send confirmation back to the original sender if they're still connected
          const deliveryConfirmation = {
            type: 'fileDeliveryConfirmed',
            fileName,
            receiverUsername: username,
            timestamp: Date.now(),
            originalTimestamp: timestamp
          };
          
          // Find and notify the sender
          await broadcastToRoom(roomId, 'fileDeliveryConfirmed', deliveryConfirmation, senderId);
        } else {
          console.log(`[SECURITY] User ${username} attempted to confirm file receipt for room ${roomId} without being a participant`);
        }
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
      
      // --- BEGIN: WebRTC Group Audio Call Signaling ---
      } else if (msg.type === "call-join") {
        // msg: { type, roomId, username, isListener }
        const { roomId, username, isListener } = msg
        if (!roomId || !username) return

        // Check if user is actually in the room's participant list
        if (!rooms[roomId] || !rooms[roomId].users.has(username)) {
          console.log(`[SECURITY] User ${username} attempted to join call in room ${roomId} without being a participant`);
          ws.send(JSON.stringify({ 
            type: 'error', 
            error: 'You must join the room before joining the call.',
            redirect: `/${roomId}`,
            action: 'rejoin'
          }));
          return;
        }

        // Create call room if needed
        if (!callRooms[roomId]) callRooms[roomId] = {}
        // Add this peer with room membership verified
        callRooms[roomId][username] = { 
          ws, 
          username, 
          isListener: !!isListener, 
          roomVerified: true,
          lastActivity: Date.now()
        }

        // Tell the new peer about all existing peers
        Object.keys(callRooms[roomId]).forEach(existing => {
          if (existing !== username) {
            ws.send(JSON.stringify({ type: "call-new-peer", username: existing }))
          }
        })
        // Tell all existing peers about the new peer
        broadcastCall(roomId, "call-new-peer", { username }, username)
        return
        
      } else if (msg.type === "call-offer" || msg.type === "call-answer" || msg.type === "call-ice") {
        // msg: { type, roomId, from, to, payload }
        const { roomId, from, to, payload } = msg
        if (!roomId || !from || !to) return

        // Check if sender is actually in the room's participant list
        if (!rooms[roomId] || !rooms[roomId].users.has(from)) {
          console.log(`[SECURITY] User ${from} attempted to send call signal to room ${roomId} without being a participant`);
          ws.send(JSON.stringify({ 
            type: 'error', 
            error: 'You must join the room before participating in calls.',
            redirect: `/${roomId}`,
            action: 'rejoin'
          }));
          return;
        }

        const peers = callRooms[roomId]
        if (peers && peers[to] && peers[to].ws.readyState === WebSocket.OPEN) {
          peers[to].ws.send(JSON.stringify({ type: msg.type, from, payload }))
          // Update activity for both sender and receiver
          if (peers[from]) peers[from].lastActivity = Date.now()
          peers[to].lastActivity = Date.now()
        } else {
          console.log(`[WEBRTC] Target peer ${to} not found or not connected in call room ${roomId}`)
        }
        return
        
      } else if (msg.type === "call-peer-left") {
        // msg: { type, roomId, username }
        const { roomId, username } = msg
        
        // Check if user is actually in the room's participant list
        if (!rooms[roomId] || !rooms[roomId].users.has(username)) {
          console.log(`[SECURITY] User ${username} attempted to leave call in room ${roomId} without being a participant`);
          ws.send(JSON.stringify({ 
            type: 'error', 
            error: 'You must join the room before leaving the call.',
            redirect: `/${roomId}`,
            action: 'rejoin'
          }));
          return;
        }

        if (callRooms[roomId] && callRooms[roomId][username]) {
          delete callRooms[roomId][username]
          broadcastCall(roomId, "call-peer-left", { username }, username)
          cleanupCallRoom(roomId)
        }
        return
      }
      // --- END: WebRTC Group Audio Call Signaling ---
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (e) {
      ws.send(JSON.stringify({ type: 'error', error: 'Invalid message' }));
    }
  });
  ws.on('close', async () => {
    if (typeof joinedRoom === 'string' && joinedUser && joinedRoom in rooms && rooms[joinedRoom]) {
      rooms[joinedRoom].users.delete(joinedUser);
      
      // Clean up WebRTC call connections for this user
      for (const [callRoomId, peers] of Object.entries(callRooms)) {
        if (joinedUser && peers[joinedUser]) {
          console.log(`[WEBRTC] Cleaning up call connection for ${joinedUser} in room ${callRoomId}`);
          delete peers[joinedUser];
          // Notify other call participants that this peer left
          broadcastCall(callRoomId, "call-peer-left", { username: joinedUser }, joinedUser);
          cleanupCallRoom(callRoomId);
        }
      }
      
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
  roomVerified?: boolean // Cache room membership verification
  lastActivity: number // Track last activity for cleanup
}
const callRooms: Record<string, Record<string, CallPeerInfo>> = {}

// Helper: broadcast to all peers in a call room except sender
function broadcastCall(roomId: string, type: string, data: Record<string, unknown>, exceptUsername?: string) {
  const peers = callRooms[roomId]
  if (!peers) return
  
  let activePeers = 0
  let deadConnections = 0
  
  Object.entries(peers).forEach(([username, info]) => {
    if (username !== exceptUsername) {
      if (info.ws.readyState === WebSocket.OPEN) {
        try {
          info.ws.send(JSON.stringify({ type, ...data }))
          info.lastActivity = Date.now() // Update activity timestamp
          activePeers++
        } catch (error) {
          console.error(`[WEBRTC] Failed to send ${type} to ${username}:`, error)
          deadConnections++
        }
      } else {
        console.log(`[WEBRTC] Dead connection detected for ${username} in call room ${roomId}`)
        deadConnections++
      }
    }
  })
  
  console.log(`[WEBRTC] Broadcast ${type} to room ${roomId}: ${activePeers} active, ${deadConnections} dead connections`)
  
  // Clean up dead connections
  if (deadConnections > 0) {
    cleanupDeadCallConnections(roomId)
  }
}

// Clean up dead connections in call room
function cleanupDeadCallConnections(roomId: string) {
  const peers = callRooms[roomId]
  if (!peers) return
  
  let cleanedCount = 0
  const toRemove: string[] = []
  
  Object.entries(peers).forEach(([username, info]) => {
    if (info.ws.readyState !== WebSocket.OPEN) {
      toRemove.push(username)
      cleanedCount++
    }
  })
  
  toRemove.forEach(username => {
    delete peers[username]
    // Notify other peers that this peer left
    broadcastCall(roomId, "call-peer-left", { username }, username)
  })
  
  if (cleanedCount > 0) {
    console.log(`[WEBRTC] Cleaned ${cleanedCount} dead connections from call room ${roomId}`)
  }
  
  cleanupCallRoom(roomId)
}

// Clean up call room if empty
function cleanupCallRoom(roomId: string) {
  if (callRooms[roomId] && Object.keys(callRooms[roomId]).length === 0) {
    delete callRooms[roomId]
    console.log(`[WEBRTC] Deleted empty call room: ${roomId}`)
  }
}

// Periodic cleanup of inactive call connections
setInterval(() => {
  const now = Date.now()
  const CALL_TIMEOUT = 5 * 60 * 1000 // 5 minutes of inactivity
  let totalCleaned = 0
  
  for (const [roomId, peers] of Object.entries(callRooms)) {
    const toRemove: string[] = []
    
    Object.entries(peers).forEach(([username, info]) => {
      const inactive = now - info.lastActivity > CALL_TIMEOUT
      const deadConnection = info.ws.readyState !== WebSocket.OPEN
      
      if (inactive || deadConnection) {
        toRemove.push(username)
        console.log(`[WEBRTC] Removing inactive/dead call peer: ${username} from room ${roomId} (inactive: ${inactive}, dead: ${deadConnection})`)
      }
    })
    
    toRemove.forEach(username => {
      delete peers[username]
      totalCleaned++
      // Notify other peers that this peer left
      broadcastCall(roomId, "call-peer-left", { username }, username)
    })
    
    cleanupCallRoom(roomId)
  }
  
  if (totalCleaned > 0) {
    console.log(`[WEBRTC] Periodic cleanup: Removed ${totalCleaned} inactive call connections`)
  }
}, 120000) // Every 2 minutes

// --- END: WebRTC Group Audio Call Signaling Support ---

// Graceful shutdown handling
const cleanup = () => {
  console.log('[WebSocket Server] Starting graceful shutdown...');
  
  // Close all WebSocket connections
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.close(1000, 'Server shutting down');
    }
  });
  
  // Close the server
  server.close(() => {
    console.log('[WebSocket Server] HTTP server closed');
    process.exit(0);
  });
  
  // Force exit after 10 seconds if graceful shutdown fails
  setTimeout(() => {
    console.log('[WebSocket Server] Force exiting...');
    process.exit(1);
  }, 10000);
};

// Handle shutdown signals
process.on('SIGTERM', cleanup);
process.on('SIGINT', cleanup);
process.on('uncaughtException', (error) => {
  console.error('[WebSocket Server] Uncaught exception:', error);
  cleanup();
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('[WebSocket Server] Unhandled rejection at:', promise, 'reason:', reason);
  // Don't exit on unhandled rejections, just log them
});

// Memory monitoring (log every 10 minutes)
setInterval(() => {
  const memUsage = process.memoryUsage();
  const formatMB = (bytes: number) => Math.round(bytes / 1024 / 1024 * 100) / 100;
  
  // Count WebRTC call rooms and connections
  let totalCallConnections = 0;
  const callRoomCount = Object.keys(callRooms).length;
  for (const peers of Object.values(callRooms)) {
    totalCallConnections += Object.keys(peers).length;
  }
  
  console.log(`[MEMORY] RSS: ${formatMB(memUsage.rss)}MB, Heap Used: ${formatMB(memUsage.heapUsed)}MB, Heap Total: ${formatMB(memUsage.heapTotal)}MB`);
  console.log(`[STATS] Rooms: ${Object.keys(rooms).length}, File Tracking: ${fileDeliveryTracking.size}, Notification Subscriptions: ${Array.from(notificationSubscriptions.values()).reduce((sum, arr) => sum + arr.length, 0)}, Connected Clients: ${wss.clients.size}`);
  console.log(`[WEBRTC STATS] Call Rooms: ${callRoomCount}, Active Call Connections: ${totalCallConnections}`);
  
  // Alert if memory usage is high
  const memoryLimitMB = 500; // Adjust based on your server capacity
  if (formatMB(memUsage.heapUsed) > memoryLimitMB) {
    console.warn(`[MEMORY WARNING] Heap usage (${formatMB(memUsage.heapUsed)}MB) exceeds threshold (${memoryLimitMB}MB)`);
  }
}, 600000); // Every 10 minutes

// Rate limiting to prevent spam and resource exhaustion
const rateLimits = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const MAX_MESSAGES_PER_MINUTE = 30;
const MAX_FILES_PER_MINUTE = 5;

function checkRateLimit(identifier: string, isFile: boolean = false): boolean {
  const now = Date.now();
  const limit = isFile ? MAX_FILES_PER_MINUTE : MAX_MESSAGES_PER_MINUTE;
  const key = `${identifier}_${isFile ? 'file' : 'msg'}`;
  
  const current = rateLimits.get(key);
  
  if (!current || now > current.resetTime) {
    rateLimits.set(key, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return true;
  }
  
  if (current.count >= limit) {
    return false;
  }
  
  current.count++;
  return true;
}

// Clean up rate limit entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, data] of rateLimits.entries()) {
    if (now > data.resetTime) {
      rateLimits.delete(key);
    }
  }
}, 300000); // Clean every 5 minutes