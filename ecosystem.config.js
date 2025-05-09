module.exports = {
  apps: [
    {
      name: 'swarm-stream-agg',
      script: 'dist/index.js',
      interpreter: 'node',
      env_file: '.env',
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
      },
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '32G',
      time: true,
    },
  ],
};
