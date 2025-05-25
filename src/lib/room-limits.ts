// Room and user limits shared across the application
export const MAX_ROOM_ID_LENGTH = 20;
export const MAX_ROOM_NAME_LENGTH = 40;
export const MAX_USERNAME_LENGTH = 15;

/**
 * Truncates a room ID to the maximum allowed length
 * @param roomId - The original room ID
 * @returns The truncated room ID
 */
export function truncateRoomId(roomId: string): string {
  if (roomId.length <= MAX_ROOM_ID_LENGTH) {
    return roomId;
  }
  return roomId.substring(0, MAX_ROOM_ID_LENGTH);
}

/**
 * Truncates a room name to the maximum allowed length
 * @param roomName - The original room name
 * @returns The truncated room name
 */
export function truncateRoomName(roomName: string): string {
  if (roomName.length <= MAX_ROOM_NAME_LENGTH) {
    return roomName;
  }
  return roomName.substring(0, MAX_ROOM_NAME_LENGTH);
}

/**
 * Truncates a username to the maximum allowed length
 * @param username - The original username
 * @returns The truncated username
 */
export function truncateUsername(username: string): string {
  if (username.length <= MAX_USERNAME_LENGTH) {
    return username;
  }
  return username.substring(0, MAX_USERNAME_LENGTH);
}

/**
 * Validates if a room ID meets the length requirements
 * @param roomId - The room ID to validate
 * @returns true if valid, false otherwise
 */
export function isValidRoomId(roomId: string): boolean {
  return roomId.length >= 1 && roomId.length <= MAX_ROOM_ID_LENGTH;
}

/**
 * Validates if a room name meets the length requirements
 * @param roomName - The room name to validate
 * @returns true if valid, false otherwise
 */
export function isValidRoomName(roomName: string): boolean {
  return roomName.trim().length <= MAX_ROOM_NAME_LENGTH;
}

/**
 * Validates if a username meets the length requirements
 * @param username - The username to validate
 * @returns true if valid, false otherwise
 */
export function isValidUsername(username: string): boolean {
  return username.length >= 1 && username.length <= MAX_USERNAME_LENGTH;
}
