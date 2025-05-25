import { WebSocket, WebSocketServer } from 'ws';
import { createServer } from 'http';
import bcrypt from 'bcryptjs';
import { MAX_ROOM_ID_LENGTH, MAX_ROOM_NAME_LENGTH, MAX_USERNAME_LENGTH } from './lib/room-limits';

const PORT = 3001;

// In-memory store for rooms and messages
const rooms: Record<string, { name: string; users: Set<string>; locked: boolean; maxParticipants: number; visibility: 'public' | 'private'; owner?: string; password?: string }> = {};

const server = createServer();
const wss = new WebSocketServer({ server, maxPayload: 150 * 1024 * 1024 }); // 150 MB max payload size

function getClientsInRoom(roomId: string) {
  return Array.from(wss.clients).filter((client) => {
    // @ts-expect-error custom property
    return client.joinedRoom === roomId;
  });
}

// --- Add ping/pong to detect dead connections only for clients in a room ---
setInterval(() => {
  wss.clients.forEach((ws) => {
    const client = ws as WebSocket & { joinedRoom?: string; joinedUser?: string; isAlive?: boolean };
    if (!client.joinedRoom) return; // Only ping if client is in a room
    if (client.isAlive === false) {
      console.log(`[HEARTBEAT][SERVER:${PORT}] Terminating dead connection for user "${client.joinedUser}" in room "${client.joinedRoom}"`);
      client.terminate();
      return;
    }
    client.isAlive = false;
    client.ping();
    console.log(`[HEARTBEAT][SERVER:${PORT}] Sent ping to user "${client.joinedUser}" in room "${client.joinedRoom}"`);
  });
}, 30000); // every 30 seconds

wss.on('connection', (ws: WebSocket & { joinedRoom?: string; joinedUser?: string; isAlive?: boolean }) => {
  console.log(`[CONNECT][SERVER:${PORT}] New WebSocket connection established`);
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
    const user = ws.joinedUser || 'unknown';
    const room = ws.joinedRoom || 'none';
    console.log(`[HEARTBEAT][SERVER:${PORT}] Received pong from user "${user}" in room "${room}"`);
  });

  // Track which room and username this socket is in
  let joinedRoom: string | null = null;
  let joinedUser: string | null = null;
  ws.joinedRoom = undefined;
  ws.joinedUser = undefined;

  ws.on('message', (data: WebSocket.RawData) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'getRooms') {
        ws.send(JSON.stringify({ type: 'rooms', rooms: Object.entries(rooms).map(([id, r]) => ({ id, name: r.name, count: r.users.size, maxParticipants: r.maxParticipants, locked: r.locked, visibility: r.visibility })) }));
      } else if (msg.type === 'joinRoom') {
        const { roomId, username, password } = msg;        // Validate username and roomId
        if (!username || typeof username !== 'string' || username.length < 1 || username.length > MAX_USERNAME_LENGTH) {
          ws.send(JSON.stringify({ type: 'error', error: `Invalid username. Must be 1-${MAX_USERNAME_LENGTH} characters.` }));
          return;
        }
        if (!roomId || typeof roomId !== 'string' || roomId.length < 1 || roomId.length > MAX_ROOM_ID_LENGTH) {
          ws.send(JSON.stringify({ type: 'error', error: `Invalid room ID. Must be 1-${MAX_ROOM_ID_LENGTH} characters.` }));
          return;
        }
        
        // Validate display name if creating a new room
        if (!rooms[roomId] && msg.displayName && typeof msg.displayName === 'string') {
          if (msg.displayName.trim().length > MAX_ROOM_NAME_LENGTH) {
            ws.send(JSON.stringify({ type: 'error', error: `Room name is too long. Maximum ${MAX_ROOM_NAME_LENGTH} characters.` }));
            return;
          }
        }if (!rooms[roomId]) {
          // Create new room
          const hashedPassword = password ? bcrypt.hashSync(password, 8) : undefined;
          const displayName = typeof msg.displayName === 'string' && msg.displayName.trim().length > 0 ? msg.displayName.trim() : `${roomId}`;
          const visibility = typeof msg.visibility === 'string' && (msg.visibility === 'public' || msg.visibility === 'private') ? msg.visibility : 'public';
          const maxParticipants = typeof msg.maxParticipants === 'number' && msg.maxParticipants > 0 ? msg.maxParticipants : 10;
          rooms[roomId] = { name: displayName, users: new Set(), locked: !!password, maxParticipants, visibility, owner: username, password: hashedPassword };
          console.log(`[ROOM][SERVER:${PORT}] Room "${roomId}" created by user "${username}" (${displayName}, ${visibility}, max: ${maxParticipants})`);
          broadcastRooms(); // Broadcast new room list
        }
        // Prevent duplicate usernames
        if (rooms[roomId].users.has(username)) {
          console.log(`[JOIN][SERVER:${PORT}] User "${username}" attempted to join room "${roomId}" but username already taken`);
          ws.send(JSON.stringify({ type: 'error', error: 'Username already taken in this room.' }));
          return;
        }
        // Prevent joining if room is full
        if (rooms[roomId].users.size >= rooms[roomId].maxParticipants) {
          console.log(`[JOIN][SERVER:${PORT}] User "${username}" attempted to join full room "${roomId}" (${rooms[roomId].users.size}/${rooms[roomId].maxParticipants})`);
          ws.send(JSON.stringify({ type: 'error', error: 'Room is full.' }));
          return;
        }
        // Prevent joining locked rooms (password logic)
        if (rooms[roomId].locked) {
          if (!password || !rooms[roomId].password || !bcrypt.compareSync(password, rooms[roomId].password)) {
            console.log(`[JOIN][SERVER:${PORT}] User "${username}" failed to join locked room "${roomId}" (incorrect/missing password)`);
            ws.send(JSON.stringify({ type: 'error', error: 'Room is locked. Password required or incorrect.' }));
            return;
          }
        }
        rooms[roomId].users.add(username);
        if (!rooms[roomId].owner) rooms[roomId].owner = username;
        joinedRoom = roomId;
        joinedUser = username;
        ws.joinedRoom = roomId;
        ws.joinedUser = username;
        console.log(`[JOIN][SERVER:${PORT}] User "${username}" successfully joined room "${roomId}" (${rooms[roomId].users.size}/${rooms[roomId].maxParticipants} users)`);
        broadcastRooms(); // Broadcast participant count change
        // Send join notification message (system message, only broadcast, not stored)
        const joinMsg = { username: '', text: `${username} joined the chat.`, timestamp: Date.now(), system: true };
        // Only broadcast to clients in this room
        const usersArr = Array.from(rooms[roomId].users);        getClientsInRoom(roomId).forEach((client) => {
          if (client.readyState === 1) {
            const clientUser = (client as WebSocket & { joinedUser?: string }).joinedUser || 'unknown';
            console.log(`[BROADCAST][SERVER:${PORT}] Sending join notification and roomInfo to user "${clientUser}" in room "${roomId}"`);
            client.send(JSON.stringify({ type: 'newMessage', roomId, message: joinMsg }));
            client.send(JSON.stringify({ type: 'roomInfo', room: { id: roomId, name: rooms[roomId].name, count: rooms[roomId].users.size, maxParticipants: rooms[roomId].maxParticipants, locked: rooms[roomId].locked, visibility: rooms[roomId].visibility, exists: true, owner: rooms[roomId].owner, users: usersArr } }));
          }
        });
        // Also send roomInfo to the joining client (in case not included above)
        console.log(`[SEND][SERVER:${PORT}] Sending roomInfo to newly joined user "${username}" in room "${roomId}"`);
        ws.send(JSON.stringify({ type: 'roomInfo', room: { id: roomId, name: rooms[roomId].name, count: rooms[roomId].users.size, maxParticipants: rooms[roomId].maxParticipants, locked: rooms[roomId].locked, visibility: rooms[roomId].visibility, exists: true, owner: rooms[roomId].owner, users: usersArr } }));      } else if (msg.type === 'sendMessage') {
        const { roomId, username, text } = msg;
        const message = { username, text, timestamp: Date.now() };
        if (rooms[roomId]) {
          console.log(`[MESSAGE][SERVER:${PORT}] User "${username}" sent message in room "${roomId}": "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);
          getClientsInRoom(roomId).forEach((client) => {
            if (client.readyState === 1) {
              const clientUser = (client as WebSocket & { joinedUser?: string }).joinedUser || 'unknown';
              console.log(`[BROADCAST][SERVER:${PORT}] Sending message to user "${clientUser}" in room "${roomId}"`);
              client.send(JSON.stringify({ type: 'newMessage', roomId, message }));
            }
          });
        } else {
          console.log(`[ERROR][SERVER:${PORT}] User "${username}" tried to send message to non-existent room "${roomId}"`);
        }
      } else if (msg.type === 'sendFile') {
        const { roomId, username, fileName, fileType, fileData, timestamp, asAudio } = msg;
        console.log(`[FILE][SERVER:${PORT}] User "${username}" sent file in room "${roomId}": "${fileName}" (${fileType}, ${Math.round((fileData?.length || 0) / 1024)}KB${asAudio ? ', audio' : ''})`);
        const message = { username, fileName, fileType, fileData, timestamp, type: 'file', ...(asAudio ? { asAudio: true } : {}) };
        if (rooms[roomId]) {
          getClientsInRoom(roomId).forEach((client) => {
            if (client.readyState === 1) {
              const clientUser = (client as WebSocket & { joinedUser?: string }).joinedUser || 'unknown';
              console.log(`[BROADCAST][SERVER:${PORT}] Sending file to user "${clientUser}" in room "${roomId}"`);
              client.send(JSON.stringify({ type: 'newMessage', roomId, message }));
            }
          });
        } else {
          console.log(`[ERROR][SERVER:${PORT}] User "${username}" tried to send file to non-existent room "${roomId}"`);        }} else if (msg.type === 'updateRoomSettings') {
        const { roomId, username, name, maxParticipants, locked, password, visibility, updateId } = msg;        if (rooms[roomId] && rooms[roomId].owner === username) {
          console.log(`[SETTINGS][SERVER:${PORT}] User "${username}" updating settings for room "${roomId}"`);
            // Validate room name length
          if (typeof name === 'string' && name.trim().length > MAX_ROOM_NAME_LENGTH) {
            console.log(`[ERROR][SERVER:${PORT}] User "${username}" tried to set room name longer than ${MAX_ROOM_NAME_LENGTH} characters in room "${roomId}"`);
            ws.send(JSON.stringify({ type: 'error', error: `Room name is too long. Maximum ${MAX_ROOM_NAME_LENGTH} characters.` }));
            return;
          }
          
          // Prevent setting maxParticipants lower than current user count
          if (typeof maxParticipants === 'number') {
            if (maxParticipants < rooms[roomId].users.size) {
              console.log(`[ERROR][SERVER:${PORT}] User "${username}" tried to set maxParticipants (${maxParticipants}) below current user count (${rooms[roomId].users.size}) in room "${roomId}"`);
              ws.send(JSON.stringify({ type: 'error', error: `Cannot set max participants below current user count (${rooms[roomId].users.size}).` }));
              return;
            }
            rooms[roomId].maxParticipants = maxParticipants;
            console.log(`[SETTINGS][SERVER:${PORT}] Updated maxParticipants to ${maxParticipants} in room "${roomId}"`);
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
          const usersArr = Array.from(rooms[roomId].users);          getClientsInRoom(roomId).forEach((client) => {
            if (client.readyState === 1) {
              interface RoomInfo {
                id: string;
                name: string;
                count: number;
                maxParticipants: number;
                locked: boolean;
                visibility: 'public' | 'private';
                exists: boolean;
                owner?: string;
                users: string[];
              }
              const roomInfoMsg: { type: string; room: RoomInfo; updateId?: string } = { type: 'roomInfo', room: { id: roomId, name: rooms[roomId].name, count: rooms[roomId].users.size, maxParticipants: rooms[roomId].maxParticipants, locked: rooms[roomId].locked, visibility: rooms[roomId].visibility, exists: true, owner: rooms[roomId].owner, users: usersArr } };
              // Include updateId for the client that initiated the update
              if (client === ws && updateId) {
                roomInfoMsg.updateId = updateId;
              }
              client.send(JSON.stringify(roomInfoMsg));
            }
          });
          // Broadcast updated rooms list to all clients (visibility change affects public listing)
          broadcastRooms();        } else {
          ws.send(JSON.stringify({ type: 'error', error: 'Only the room owner can update settings.' }));
        }      } else if (msg.type === 'ping') {
        // Handle ping requests for connection health monitoring
        const { roomId, username } = msg;
        if (roomId && username && rooms[roomId] && rooms[roomId].users.has(username)) {
          // Respond with pong if user is still in the room
          console.log(`[PING][SERVER:${PORT}] Received ping from user "${username}" in room "${roomId}", sending pong`);
          ws.send(JSON.stringify({ type: 'pong', roomId, timestamp: Date.now() }));
        } else {
          console.log(`[PING][SERVER:${PORT}] Received invalid ping from user "${username || 'unknown'}" for room "${roomId || 'unknown'}" - user not in room or room doesn't exist`);
        }
      }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (e) {
      ws.send(JSON.stringify({ type: 'error', error: 'Invalid message' }));
    }
  });  ws.on('close', () => {
    if (typeof joinedRoom === 'string' && joinedUser && joinedRoom in rooms && rooms[joinedRoom]) {
      console.log(`[LEAVE][SERVER:${PORT}] User "${joinedUser}" left room "${joinedRoom}" (${rooms[joinedRoom].users.size - 1}/${rooms[joinedRoom].maxParticipants} users remaining)`);
      rooms[joinedRoom].users.delete(joinedUser);
      
      // Clear the WebSocket's room info before broadcasting to avoid including the leaving client
      ws.joinedRoom = undefined;
      ws.joinedUser = undefined;
      
      // Broadcast leave notification message (system message, only to remaining clients in the room)
      const leaveMsg = { username: '', text: `${joinedUser} left the chat.`, timestamp: Date.now(), system: true };
      const usersArr = Array.from(rooms[joinedRoom].users);
      
      getClientsInRoom(joinedRoom).forEach((client) => {
        if (client.readyState === 1 && joinedRoom) {
          const clientUser = (client as WebSocket & { joinedUser?: string }).joinedUser || 'unknown';
          console.log(`[BROADCAST][SERVER:${PORT}] Sending leave notification and roomInfo to user "${clientUser}" in room "${joinedRoom}"`);
          client.send(JSON.stringify({ type: 'newMessage', roomId: joinedRoom, message: leaveMsg }));
          client.send(JSON.stringify({ type: 'roomInfo', room: { id: joinedRoom, name: rooms[joinedRoom].name, count: rooms[joinedRoom].users.size, maxParticipants: rooms[joinedRoom].maxParticipants, locked: rooms[joinedRoom].locked, visibility: rooms[joinedRoom].visibility, exists: true, owner: rooms[joinedRoom].owner, users: usersArr } }));
        }
      });
      broadcastRooms(); // Broadcast participant count change
      // Delete room if no participants left
      if (rooms[joinedRoom].users.size === 0) {
        console.log(`[ROOM][SERVER:${PORT}] Room "${joinedRoom}" deleted (no users remaining)`);
        delete rooms[joinedRoom];
        broadcastRooms(); // Broadcast room deletion
      }
    } else {
      // Handle disconnection of clients not in a room
      const user = joinedUser || 'unknown';
      const room = joinedRoom || 'none';
      console.log(`[DISCONNECT][SERVER:${PORT}] Client disconnected (user: "${user}", room: "${room}")`);
    }
  });
  ws.on('error', (err) => {
    const user = ws.joinedUser || 'unknown';
    const room = ws.joinedRoom || 'none';
    // @ts-expect-error: custom error code property for ws errors
    if (err && err.code === 'WS_ERR_UNSUPPORTED_MESSAGE_LENGTH') {
      console.log(`[ERROR][SERVER:${PORT}] User "${user}" in room "${room}" sent file too large, rejected`);
      ws.send(JSON.stringify({ type: 'error', error: 'File too large. Max file size exceeded.' }));
      // Also notify the user in the room if possible
      if (ws.joinedRoom && ws.joinedUser) {
        const systemMsg = {
          username: '',
          text: `${ws.joinedUser} tried to send a file that was too large and it was not sent.`,
          timestamp: Date.now(),
          system: true
        };
        getClientsInRoom(ws.joinedRoom).forEach((client) => {
          if (client.readyState === 1) {
            const clientUser = (client as WebSocket & { joinedUser?: string }).joinedUser || 'unknown';
            console.log(`[BROADCAST][SERVER:${PORT}] Sending file-too-large notification to user "${clientUser}" in room "${ws.joinedRoom}"`);
            client.send(JSON.stringify({ type: 'newMessage', roomId: ws.joinedRoom, message: systemMsg }));
          }
        });
      }
      console.error(`[ERROR][SERVER:${PORT}] File too large error for user "${user}" in room "${room}":`, err);
    } else {
      console.log(`[ERROR][SERVER:${PORT}] WebSocket error for user "${user}" in room "${room}": ${err?.message || err}`);
      ws.send(JSON.stringify({ type: 'error', error: 'WebSocket error: ' + (err?.message || err) }));
      console.error(`[ERROR][SERVER:${PORT}] WebSocket error for user "${user}" in room "${room}":`, err);
    }
  });
});

// --- Error handling for large payloads and other errors ---
wss.on('error', (err) => {
  console.error(`[ERROR][SERVER:${PORT}] WebSocket server error:`, err);
});

function broadcastRooms() {
  const roomList = Object.entries(rooms).map(([id, r]) => ({ id, name: r.name, count: r.users.size, maxParticipants: r.maxParticipants, locked: r.locked, visibility: r.visibility }));
  console.log(`[BROADCAST][SERVER:${PORT}] Broadcasting room list to all clients (${roomList.length} rooms)`);
  let clientCount = 0;
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      const clientUser = (client as WebSocket & { joinedUser?: string }).joinedUser || 'unknown';
      const clientRoom = (client as WebSocket & { joinedRoom?: string }).joinedRoom || 'none';
      console.log(`[BROADCAST][SERVER:${PORT}] Sending room list to user "${clientUser}" in room "${clientRoom}"`);
      client.send(JSON.stringify({ type: 'rooms', rooms: roomList }));
      clientCount++;
    }
  });
  console.log(`[BROADCAST][SERVER:${PORT}] Room list sent to ${clientCount} clients`);
}

server.on('request', (req, res) => {
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('WebSocket server does not serve HTTP content. Use WebSocket protocol.');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`WebSocket server running on ws://localhost:${PORT}`);
});
