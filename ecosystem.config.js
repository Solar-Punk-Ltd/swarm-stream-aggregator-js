module.exports = {
  apps: [
    {
      name: 'ingestion',
      script: 'dist/index.js',
      interpreter: 'node',
      env: {
        NODE_ENV: 'production',
        GSOC_BEE_URL: process.env.GSOC_BEE_URL,
        GSOC_RESOURCE_ID: process.env.GSOC_RESOURCE_ID,
        GSOC_TOPIC: process.env.GSOC_TOPIC,
        STREAM_BEE_URL: process.env.STREAM_BEE_URL,
        STREAM_TOPIC: process.env.STREAM_TOPIC,
        STREAM_KEY: process.env.STREAM_KEY,
        STREAM_STAMP: process.env.STREAM_STAMP,
        CHAIN_TYPE: process.env.CHAIN_TYPE,
        RPC_URL: process.env.RPC_URL,
        CONTRACT_ADDRESS: process.env.CONTRACT_ADDRESS,
        PRIVATE_KEY: process.env.PRIVATE_KEY,
      },
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '32G',
      time: true,
    },
  ],
};
