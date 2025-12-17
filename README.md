# Deadlock Devs Bot

A hardened Discord moderation bot with panic controls, staff commands, AutoMod, encrypted secrets, and PM2 deployment.

## Features
- Panic / unpanic to lock key channels
- Message logging (create, edit, delete, commands)
- AutoMod with modular rules, warn/mute/kick/ban severities, cooldowns, whitelists
- Warn tracking (3 warns → kick + DM)
- Staff commands: `!panic`, `!unpanic`, `!ban`, `!kick`, `!mute <duration>`, `!warn <user> <reason>`
- Rate limiting per user and per command
- Encrypted secrets at rest (`secrets.enc` + `SECRET_KEY`), startup validation
- Temp mutes persisted across restarts
- PM2 deployment scripts

## Prerequisites
- Node.js 18+ (tested on Node 25)
- PM2 installed globally: `npm install -g pm2`
- A 64-hex `SECRET_KEY` (32 bytes) for AES-256-GCM

## Secrets
1) Fill `secrets.plain.json`:
```json
{
  "DISCORD_TOKEN": "<bot token>",
  "GUILD_ID": "<guild id>",
  "PANIC_CONTROLLER_ID": "<user id with panic override>",
  "STAFF_ROLE_IDS": "<comma-separated role ids>"  // optional
}
```
2) Set `SECRET_KEY` in your shell (64 hex chars):
```powershell
setx SECRET_KEY <64-hex-key>
# or for current session
$env:SECRET_KEY = "<64-hex-key>"
```
3) Encrypt secrets:
```powershell
node encrypt-secrets.js
```
4) (Optional) Delete `secrets.plain.json` after encryption. Do not commit it.

Runtime uses `secrets.enc` + `SECRET_KEY`. `.env` should be empty/removed to avoid leaks.

## Configuration
- AutoMod rules: edit `automodconfig.json` (rules array with severities, cooldownSeconds, bypassRoles, whitelistChannels).
- PM2 app definition: `ecosystem.config.js`.

## Commands (staff only)
- `!panic` / `!unpanic`
- `!ban <user> [reason]`
- `!kick <user> [reason]`
- `!mute <user> <duration> [reason]` (durations: 1m, 10m, 1h, 1d)
- `!warn <user> <reason>` (DMs user; 3 warns → DM + kick)

## AutoMod actions
- Warn severity: DMs user, increments warns; at 3 warns, DM + kick + clear warns
- Mute severity: timeouts user (default 10m) and records for auto-expiry after restart
- Kick / Ban severity: executes immediately
- All actions are logged to the configured log channel

## Run with PM2
```powershell
pm2 start ecosystem.config.js --update-env
pm2 save
```
Useful commands:
- `pm2 list`
- `pm2 logs deadlock-devs-bot --lines 100`
- `pm2 restart ecosystem.config.js --update-env`
- `pm2 delete deadlock-devs-bot`

## Development
- Lint/syntax check quickly: `node -c index.js` and `node -c Automod.js`
- Rate limits are defined in `index.js` under `CONFIG.rateLimits`
- Permissions checks are in `permissions.js`

## Safety notes
- Never commit tokens or `secrets.plain.json`
- Rotate the token if it was ever in `.env`
- Keep `SECRET_KEY` private; required at runtime for decryption

## Repository
- Initialized with `.gitignore` ignoring `node_modules/`, `.env`, and plaintext secrets.
