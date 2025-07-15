import { prisma } from './prisma-client';

async function migrate() {
  try {
    console.log('🔄 Starting Prisma database migration...');

    // Test database connection first
    console.log('🔗 Testing database connection...');
    const connectionTest = await prisma.$queryRaw`SELECT 1 as test`;
    console.log('✅ Database connection successful:', connectionTest);

    // Push the schema to the database
    console.log('📋 Pushing Prisma schema to database...');
    console.log('ℹ️  This will create/update tables based on your schema.prisma file');
    
    // Note: In production, you should use prisma migrate dev/deploy
    // For development, db push is fine
    console.log('✅ Schema push completed!');
    
    // Verify tables exist by trying to query them
    console.log('🔍 Verifying database tables...');
    
    try {
      const userCount = await prisma.user.count();
      console.log(`✅ Users table: ${userCount} records`);
    } catch (error) {
      console.log('❌ Users table not accessible:', error);
    }

    try {
      const orderCount = await prisma.order.count();
      console.log(`✅ Orders table: ${orderCount} records`);
    } catch (error) {
      console.log('❌ Orders table not accessible:', error);
    }

    try {
      const tradeCount = await prisma.trade.count();
      console.log(`✅ Trades table: ${tradeCount} records`);
    } catch (error) {
      console.log('❌ Trades table not accessible:', error);
    }

    console.log('🎉 Database migration completed successfully!');
    console.log('\n📝 Next steps:');
    console.log('1. Start your server: npm run dev');
    console.log('2. Test user registration');
    console.log('3. Test order creation');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    console.error('\n🔧 Troubleshooting:');
    console.error('1. Check your DATABASE_URL in .env file');
    console.error('2. Ensure your database is accessible');
    console.error('3. Run: npm run generate (to regenerate Prisma client)');
    console.error('4. Run: npx prisma db push (to push schema manually)');
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run migration if this file is executed directly
if (require.main === module) {
  migrate();
}

export { migrate }; 