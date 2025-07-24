require('dotenv').config();
const { connectRedis } = require('./src/redisClient');

async function testConnection() {
    try {
        const client = await connectRedis();
        
        // Test set and get
        await client.set('test:key', 'Hello Redis!');
        const value = await client.get('test:key');
        console.log('Test successful:', value);
        
        // Cleanup
        await client.del('test:key');
        await client.quit();
    } catch (error) {
        console.error('Test failed:', error);
    }
}

testConnection();