// Simple WebSocket server for ephemeralchat
// Run with: npx tsx src/ws-server.ts

import { WebSocket, WebSocketServer } from 'ws';
import { createServer } from 'http';

const PORT = 3001;

// In-memory store for rooms and messages
const rooms: Record<string, { name: string; users: Set<string>; messages: unknown[]; locked: boolean; maxParticipants: number; visibility: 'public' | 'private'; owner?: string }> = {
  'study-group': { name: 'Study Group', users: new Set(), messages: [], locked: true, maxParticipants: 5, visibility: 'public', owner: undefined },
  'gaming-chat': { name: 'Gaming Chat', users: new Set(), messages: [], locked: false, maxParticipants: 10, visibility: 'public', owner: undefined },
  'work-team': { name: 'Work Team', users: new Set(), messages: [], locked: true, maxParticipants: 8, visibility: 'public', owner: undefined },
};

const server = createServer();
const wss = new WebSocketServer({ server });

function getClientsInRoom(roomId: string) {
  return Array.from(wss.clients).filter((client) => {
    // @ts-expect-error custom property
    return client.joinedRoom === roomId;
  });
}

wss.on('connection', (ws: WebSocket & { joinedRoom?: string; joinedUser?: string }) => {
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
        const { roomId, username, password } = msg;
        // Validate username and roomId
        if (!username || typeof username !== 'string' || username.length < 3 || username.length > 20) {
          ws.send(JSON.stringify({ type: 'error', error: 'Invalid username. Must be 3-20 characters.' }));
          return;
        }
        if (!roomId || typeof roomId !== 'string' || roomId.length < 2 || roomId.length > 40) {
          ws.send(JSON.stringify({ type: 'error', error: 'Invalid room ID.' }));
          return;
        }
        if (!rooms[roomId]) {
          // Create new room
          rooms[roomId] = { name: `Room ${roomId}`, users: new Set(), messages: [], locked: false, maxParticipants: 10, visibility: 'public', owner: username };
        }
        // Prevent duplicate usernames
        if (rooms[roomId].users.has(username)) {
          ws.send(JSON.stringify({ type: 'error', error: 'Username already taken in this room.' }));
          return;
        }
        // Prevent joining if room is full
        if (rooms[roomId].users.size >= rooms[roomId].maxParticipants) {
          ws.send(JSON.stringify({ type: 'error', error: 'Room is full.' }));
          return;
        }
        // Prevent joining locked rooms (password logic placeholder)
        if (rooms[roomId].locked) {
          // TODO: Add password check here if you want password support
          ws.send(JSON.stringify({ type: 'error', error: 'Room is locked. Password required.' }));
          return;
        }
        rooms[roomId].users.add(username);
        if (!rooms[roomId].owner) rooms[roomId].owner = username;
        joinedRoom = roomId;
        joinedUser = username;
        ws.joinedRoom = roomId;
        ws.joinedUser = username;
        // Send join notification message
        const joinMsg = { username: '', text: `${username} joined the chat.`, timestamp: Date.now(), system: true };
        rooms[roomId].messages.push(joinMsg);
        // Only broadcast to clients in this room
        const usersArr = Array.from(rooms[roomId].users);
        getClientsInRoom(roomId).forEach((client) => {
          if (client.readyState === 1) {
            console.log('[WS DEBUG] Sending roomInfo to client for room:', roomId)
            client.send(JSON.stringify({ type: 'newMessage', roomId, message: joinMsg }));
            client.send(JSON.stringify({ type: 'roomInfo', room: { id: roomId, name: rooms[roomId].name, count: rooms[roomId].users.size, maxParticipants: rooms[roomId].maxParticipants, locked: rooms[roomId].locked, exists: true, owner: rooms[roomId].owner, users: usersArr } }));
          }
        });
        // Also send roomInfo to the joining client (in case not included above)
        ws.send(JSON.stringify({ type: 'roomInfo', room: { id: roomId, name: rooms[roomId].name, count: rooms[roomId].users.size, maxParticipants: rooms[roomId].maxParticipants, locked: rooms[roomId].locked, exists: true, owner: rooms[roomId].owner, users: usersArr } }));
        ws.send(JSON.stringify({ type: 'messages', roomId, messages: rooms[roomId].messages }));
      } else if (msg.type === 'sendMessage') {
        const { roomId, username, text } = msg;
        const message = { username, text, timestamp: Date.now() };
        if (rooms[roomId]) {
          rooms[roomId].messages.push(message);
          getClientsInRoom(roomId).forEach((client) => {
            if (client.readyState === 1) {
              client.send(JSON.stringify({ type: 'newMessage', roomId, message }));
            }
          });
        }
      } else if (msg.type === 'updateRoomSettings') {
        const { roomId, username, name, maxParticipants, locked } = msg;
        if (rooms[roomId] && rooms[roomId].owner === username) {
          if (typeof name === 'string') rooms[roomId].name = name;
          if (typeof maxParticipants === 'number') rooms[roomId].maxParticipants = maxParticipants;
          if (typeof locked === 'boolean') rooms[roomId].locked = locked;
          // Broadcast updated roomInfo (with users)
          const usersArr = Array.from(rooms[roomId].users);
          getClientsInRoom(roomId).forEach((client) => {
            if (client.readyState === 1) {
              client.send(JSON.stringify({ type: 'roomInfo', room: { id: roomId, name: rooms[roomId].name, count: rooms[roomId].users.size, maxParticipants: rooms[roomId].maxParticipants, locked: rooms[roomId].locked, exists: true, owner: rooms[roomId].owner, users: usersArr } }));
            }
          });
        } else {
          ws.send(JSON.stringify({ type: 'error', error: 'Only the room owner can update settings.' }));
        }
      }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (e) {
      ws.send(JSON.stringify({ type: 'error', error: 'Invalid message' }));
    }
  });

  ws.on('close', () => {
    if (joinedRoom && joinedUser && rooms[joinedRoom]) {
      rooms[joinedRoom].users.delete(joinedUser);
      // Delete room if no participants left
      if (rooms[joinedRoom].users.size === 0) {
        delete rooms[joinedRoom];
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`WebSocket server running on ws://localhost:${PORT}`);
});
