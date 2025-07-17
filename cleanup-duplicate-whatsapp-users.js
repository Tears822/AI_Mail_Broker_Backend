const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * Cleanup script to fix duplicate WhatsApp users
 * This addresses phone number normalization issues that created multiple users
 */

function normalizePhoneNumber(phoneNumber) {
  if (!phoneNumber) return '';
  
  // Remove whatsapp: prefix if present
  let normalized = phoneNumber.replace(/^whatsapp:(\+)?/, '');
  
  // Ensure it starts with + for international format
  if (!normalized.startsWith('+')) {
    normalized = '+' + normalized;
  }
  
  // Remove any spaces, dashes, or other characters
  normalized = normalized.replace(/[\s\-\(\)]/g, '');
  
  return normalized;
}

async function cleanupDuplicateWhatsAppUsers() {
  console.log('🧹 Starting WhatsApp user cleanup...\n');

  try {
    // Get all WhatsApp users (users with phone numbers starting with WhatsApp_ usernames)
    const whatsappUsers = await prisma.user.findMany({
      where: {
        OR: [
          { username: { startsWith: 'WhatsApp_' } },
          { email: { contains: '@whatsapp.temp' } }
        ]
      },
      include: {
        orders: true
      }
    });

    console.log(`📱 Found ${whatsappUsers.length} WhatsApp users`);

    // Group users by normalized phone number
    const phoneGroups = new Map();
    
    for (const user of whatsappUsers) {
      if (!user.phone) continue;
      
      const normalizedPhone = normalizePhoneNumber(user.phone);
      
      if (!phoneGroups.has(normalizedPhone)) {
        phoneGroups.set(normalizedPhone, []);
      }
      phoneGroups.get(normalizedPhone).push(user);
    }

    console.log(`📊 Found ${phoneGroups.size} unique phone numbers`);

    // Find duplicates
    let duplicateCount = 0;
    let mergedCount = 0;

    for (const [phone, users] of phoneGroups) {
      if (users.length > 1) {
        duplicateCount++;
        console.log(`\n🔄 Merging ${users.length} users for phone ${phone}:`);
        
        // Sort users by creation date (keep the oldest)
        users.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
        const primaryUser = users[0];
        const duplicateUsers = users.slice(1);
        
        console.log(`  📌 Primary user: ${primaryUser.username} (${primaryUser.id})`);
        
        for (const duplicateUser of duplicateUsers) {
          console.log(`  🗑️  Merging: ${duplicateUser.username} (${duplicateUser.id})`);
          
          // Transfer orders to primary user
          if (duplicateUser.orders.length > 0) {
            await prisma.order.updateMany({
              where: { userId: duplicateUser.id },
              data: { userId: primaryUser.id }
            });
            console.log(`    📋 Transferred ${duplicateUser.orders.length} orders`);
          }
          
          // Count and transfer trades
          const buyerTradesCount = await prisma.trade.count({
            where: { buyerId: duplicateUser.id }
          });
          
          if (buyerTradesCount > 0) {
            await prisma.trade.updateMany({
              where: { buyerId: duplicateUser.id },
              data: { buyerId: primaryUser.id }
            });
            console.log(`    💰 Transferred ${buyerTradesCount} buyer trades`);
          }
          
          const sellerTradesCount = await prisma.trade.count({
            where: { sellerId: duplicateUser.id }
          });
          
          if (sellerTradesCount > 0) {
            await prisma.trade.updateMany({
              where: { sellerId: duplicateUser.id },
              data: { sellerId: primaryUser.id }
            });
            console.log(`    💰 Transferred ${sellerTradesCount} seller trades`);
          }
          
          // Delete the duplicate user
          await prisma.user.delete({
            where: { id: duplicateUser.id }
          });
          
          console.log(`    ✅ Deleted duplicate user: ${duplicateUser.username}`);
          mergedCount++;
        }
        
        // Update primary user with normalized phone number
        await prisma.user.update({
          where: { id: primaryUser.id },
          data: { phone: phone }
        });
        
        console.log(`  ✅ Updated primary user phone to: ${phone}`);
      }
    }

    // Clean up test users with invalid phone numbers
    console.log('\n🧪 Cleaning up test users with invalid phone numbers...');
    
    const testUsers = await prisma.user.findMany({
      where: {
        OR: [
          { phone: '+1234567890' },
          { phone: '1234567890' },
          { phone: '+1234567891' },
          { phone: '1234567891' },
          { phone: { contains: '1234567890' } },
          { phone: { contains: '1234567891' } }
        ]
      }
    });

    for (const testUser of testUsers) {
      // Set phone to null to prevent WhatsApp errors
      await prisma.user.update({
        where: { id: testUser.id },
        data: { phone: null }
      });
      console.log(`  🧪 Cleaned test user: ${testUser.username} - removed invalid phone`);
    }

    console.log('\n📊 CLEANUP SUMMARY');
    console.log('==================');
    console.log(`📱 Total WhatsApp users found: ${whatsappUsers.length}`);
    console.log(`🔄 Phone numbers with duplicates: ${duplicateCount}`);
    console.log(`🗑️  Duplicate users merged: ${mergedCount}`);
    console.log(`🧪 Test users cleaned: ${testUsers.length}`);
    console.log('\n✅ WhatsApp user cleanup completed!');

  } catch (error) {
    console.error('❌ Error during cleanup:', error);
  } finally {
    await prisma.$disconnect();
  }
}

cleanupDuplicateWhatsAppUsers(); 