const redis = require('redis');

let client;

async function connectRedis() {
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
    return client;
}

module.exports = { connectRedis, getClient: () => client };