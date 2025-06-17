# File Upload Improvements

## What was added:

### 1. **Visual Feedback for Senders**
- **Enhanced Progress Bar**: Shows current file being uploaded (X of Y files)
- **Percentage Indicator**: Real-time upload progress percentage
- **File Name Display**: Shows which specific file is currently being uploaded
- **Pending Confirmation Counter**: Shows how many files are awaiting server confirmation
- **Animated Upload Button**: Paperclip icon pulses when uploading

### 2. **Visual Feedback for Receivers**
- **Header Indicator**: Shows "Uploading..." or "X uploading..." in room header
- **User-Specific Notifications**: Shows which users are currently uploading files
- **Real-time Status**: Indicators update immediately when users start/stop uploading

### 3. **Reliability Improvements**
- **Server Acknowledgments**: Server confirms receipt of each file
- **Retry Mechanism**: Automatic retry up to 3 times if upload fails
- **10-second Timeout**: Per attempt with automatic retry
- **Pending Upload Tracking**: Tracks which files are still being processed
- **Error Handling**: Graceful handling of failed uploads

### 4. **Upload Status Messages**
Server now handles:
- `fileUploadStart` - Notifies room when user starts uploading
- `fileUploadEnd` - Notifies room when user finishes uploading  
- `fileUploadAck` - Confirms successful file receipt

## User Experience:

### For the Sender:
1. **Before Upload**: Paperclip button available
2. **During Upload**: 
   - Paperclip button disabled and pulsing
   - Progress bar showing "Uploading X of Y (Z%)"
   - Current file name displayed
   - Pending confirmations shown
3. **After Upload**: All indicators clear, normal state restored

### For Receivers:
1. **Start**: Room header shows "[Username] is uploading files..."
2. **Multiple Users**: "2 uploading..." for multiple simultaneous uploads
3. **Bottom Panel**: Individual user upload notifications
4. **End**: All indicators disappear when uploads complete

## Technical Details:

### Client-Side:
- Added retry logic with exponential backoff
- Pending upload tracking with Map data structure
- Enhanced UI state management
- Proper cleanup on component unmount

### Server-Side:
- File upload acknowledgments
- Upload status message broadcasting
- Error handling and user validation

## Benefits:
- **Transparency**: Users know exactly what's happening
- **Reliability**: Files are guaranteed to be sent or user is notified of failure
- **User Experience**: No more wondering "did my file send?"
- **Multi-user Awareness**: Everyone knows when others are uploading
