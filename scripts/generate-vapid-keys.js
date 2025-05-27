#!/usr/bin/env node

/**
 * VAPID Key Setup Script
 * 
 * This script generates new VAPID keys for web push notifications
 * and updates the .env.local file with the generated keys.
 */

const webpush = require('web-push')
const fs = require('fs')
const path = require('path')

function generateVapidKeys() {
  console.log('🔐 Generating new VAPID keys for web push notifications...\n')
  
  try {
    const vapidKeys = webpush.generateVAPIDKeys()
    
    console.log('✅ VAPID keys generated successfully!\n')
    console.log('📋 Your new VAPID keys:')
    console.log('Public Key:', vapidKeys.publicKey)
    console.log('Private Key:', vapidKeys.privateKey)
    console.log()
    
    // Create or update .env.local file
    const envPath = path.join(process.cwd(), '.env.local')
    let envContent = ''
    
    // Read existing .env.local if it exists
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf8')
      console.log('📝 Updating existing .env.local file...')
    } else {
      console.log('📝 Creating new .env.local file...')
    }
    
    // Update or add VAPID keys
    const updatedContent = updateEnvContent(envContent, vapidKeys)
    
    // Write the updated content
    fs.writeFileSync(envPath, updatedContent)
    
    console.log('✅ .env.local file updated successfully!')
    console.log()
    console.log('🚀 Next steps:')
    console.log('1. Restart your development server')
    console.log('2. Clear browser cache and localStorage')
    console.log('3. Unregister old service workers')
    console.log('4. Test push notifications')
    console.log()
    console.log('⚠️  Important: Keep your private key secure and never commit it to version control!')
    
  } catch (error) {
    console.error('❌ Error generating VAPID keys:', error)
    process.exit(1)
  }
}

function updateEnvContent(content, vapidKeys) {
  const lines = content.split('\n')
  let hasPublicKey = false
  let hasPrivateKey = false
  let hasSubject = false
  
  // Update existing keys or track what we need to add
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('VAPID_PUBLIC_KEY=')) {
      lines[i] = `VAPID_PUBLIC_KEY=${vapidKeys.publicKey}`
      hasPublicKey = true
    } else if (lines[i].startsWith('VAPID_PRIVATE_KEY=')) {
      lines[i] = `VAPID_PRIVATE_KEY=${vapidKeys.privateKey}`
      hasPrivateKey = true
    } else if (lines[i].startsWith('VAPID_SUBJECT=')) {
      hasSubject = true
      // Keep existing subject if it exists
    }
  }
  
  // Add missing keys
  if (!hasPublicKey) {
    lines.push(`VAPID_PUBLIC_KEY=${vapidKeys.publicKey}`)
  }
  if (!hasPrivateKey) {
    lines.push(`VAPID_PRIVATE_KEY=${vapidKeys.privateKey}`)
  }
  if (!hasSubject) {
    lines.push('VAPID_SUBJECT=mailto:admin@example.com')
  }
  
  // Add WS_PORT if not present
  const hasWsPort = lines.some(line => line.startsWith('WS_PORT='))
  if (!hasWsPort) {
    lines.push('WS_PORT=3001')
  }
  
  return lines.filter(line => line.trim() !== '').join('\n') + '\n'
}

// Run the script if called directly
if (require.main === module) {
  generateVapidKeys()
}

module.exports = { generateVapidKeys }
