require('dotenv').config(); 
const redis = require('redis');

let client;

async function connectRedis() {
    // Add this debug line to see what URL is being used
    console.log('Connecting to Redis URL:', process.env.REDIS_URL);
    client = redis.createClient({
        url: process.env.REDIS_URL,
        socket: {
            connectTimeout: 10000,
            reconnectStrategy: (retries) => {
                if (retries > 10) {
                    console.log("Too many connection attempts to Redis");
                    return new Error("Too many retries");
                }
                return Math.min(retries * 100, 3000);
            }
        }
    });

    client.on('error', (err) => {
        console.error('Redis Client Error:', err);
    });

    client.on('connect', () => {
        console.log('Connected to Redis successfully!');
    });

    await client.connect();
    
    // Check for RedisJSON support
    try {
        await client.sendCommand(['JSON.SET', 'test:json', '$', '{}']);
        await client.del('test:json');
        console.log('✅ RedisJSON is available');
    } catch (error) {
        console.log('⚠️  RedisJSON not available - using fallback storage');
    }
    
    return client;
}

module.exports = { connectRedis, getClient: () => client };