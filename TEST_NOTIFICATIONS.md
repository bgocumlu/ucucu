# Notification System Testing Guide

## Steps to Test Notifications

### 1. Basic Setup
1. Start the development server: `npm run dev`
2. Open the WebSocket server in another terminal: The server should start automatically
3. Open http://localhost:3000

### 2. Test Notification Permission
1. Go to any room (e.g., http://localhost:3000/test-room/chat)
2. Look for the bell icon in the top right
3. Double-click the bell icon to test notifications
4. Browser should prompt for notification permission - **GRANT IT**

### 3. Test Notification Subscription
1. Single-click the bell icon to cycle through intervals: 1min → 3min → 5min → 10min → 15min → disabled → 1min
2. When subscribed, you should see a timer counting down below the bell
3. The bell should turn blue when notifications are active

### 4. Test Push Notifications
1. Open the room in two browser windows/tabs
2. In the first window, enable notifications (click bell until it's blue with timer)
3. In the second window, send a message
4. The first window should receive a browser notification (even if the tab is active)

### 5. Debug Issues
If notifications aren't working, check:

1. **Browser Console**: Look for logs starting with `[NotificationService]` and `[NotificationBell]`
2. **Server Console**: Look for logs starting with `[NOTIFICATIONS]` and `[BROADCAST]`
3. **WebSocket Connection**: Check for "WebSocket connected" in browser console
4. **Permission**: Ensure browser notifications are allowed

### 6. Common Issues & Solutions

**"WebSocket send function set undefined"**
- The WebSocket connection isn't ready yet
- Wait a moment and try again
- Check if the WebSocket server is running (should be automatic)

**Notifications work once then stop**
- This was a known issue that should be fixed
- Check browser console for WebSocket reconnection logs
- Refresh the page and try again

**No notifications despite being subscribed**
- Check if notification permission is granted
- Try double-clicking the bell for a test notification
- Check server logs to see if notifications are being sent

### 7. Expected Behavior
- ✅ Bell icon changes color based on subscription state
- ✅ Timer shows remaining notification time
- ✅ Notifications appear even when tab is visible (for testing)
- ✅ Clicking notification navigates to the room
- ✅ Subscriptions persist across page refreshes
- ✅ Multiple users can be subscribed to same room

## Recent Fixes Applied
1. ✅ Fixed WebSocket send function being undefined
2. ✅ Improved connection state handling
3. ✅ Simplified notification display logic
4. ✅ Added better error logging
5. ✅ Fixed WebSocket retry logic

## Testing Commands
```bash
# Start development (both frontend and WebSocket server)
npm run dev

# If you need to run the WebSocket server separately:
npm run ws

# Check if processes are running:
# - Frontend: http://localhost:3000
# - WebSocket: ws://localhost:3001
```

## Debug Commands
- **Ctrl+Shift+N** while in a chat room: Print debug info to console
- **Double-click bell icon**: Test notification display
- **Single-click bell icon**: Cycle through subscription intervals
