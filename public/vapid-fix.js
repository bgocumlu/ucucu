// VAPID Key Mismatch Fix Utility
// Run this in the browser console to fix VAPID key issues

console.log('🔧 VAPID Key Mismatch Fix Utility');

// Check current VAPID key configuration
async function checkVAPIDConfig() {
  console.log('📋 Current VAPID Configuration:');
  
  // Frontend VAPID key
  const storedKey = localStorage.getItem('vapidPublicKey');
  console.log('Frontend VAPID Key:', storedKey);
  
  // Backend VAPID key (from service)
  try {
    const webPushModule = await import('./src/lib/web-push-service.js');
    const vapidKey = webPushModule.webPushService?.vapidPublicKey;
    console.log('Backend VAPID Key:', vapidKey);
    
    if (storedKey === vapidKey) {
      console.log('✅ VAPID keys match');
    } else {
      console.log('❌ VAPID keys DO NOT match');
    }
  } catch (error) {
    console.log('❌ Could not check backend VAPID key:', error);
  }
}

// Force clear all subscriptions
async function forceFixVAPID() {
  console.log('🧹 Force clearing all subscriptions...');
  
  try {
    // Clear frontend subscriptions
    localStorage.removeItem('notificationSubscriptions');
    localStorage.removeItem('vapidPublicKey');
    console.log('✅ Frontend subscriptions cleared');
    
    // Clear push subscription
    if ('serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await subscription.unsubscribe();
        console.log('✅ Push subscription cleared');
      }
    }
    
    // Clear backend subscriptions via admin command
    const notificationModule = await import('./src/lib/notification-service.js');
    notificationModule.notificationService.adminClearAllSubscriptions();
    console.log('✅ Backend clear command sent');
    
    console.log('🎉 All subscriptions cleared! Please refresh the page.');
    
  } catch (error) {
    console.error('❌ Error during force fix:', error);
  }
}

// Export functions to global scope
window.vapidFix = {
  check: checkVAPIDConfig,
  fix: forceFixVAPID
};

console.log('💡 Available commands:');
console.log('  vapidFix.check() - Check VAPID configuration');
console.log('  vapidFix.fix() - Force fix VAPID key mismatch');
