module.exports = {
  apps: [
    {
      name: "deadlock-devs-bot",
      script: "index.js",
      cwd: "C:/Users/harri/Downloads/Deadlock Devs Bot",

      env: {
        DISCORD_TOKEN: process.env.DISCORD_TOKEN,
        GUILD_ID: process.env.GUILD_ID
      },

      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      time: true
    }
  ]
};
