const fs = require('fs');
const path = require('path');

const STORE = path.join(__dirname, 'mutes.json');

const loadStore = () => {
  try {
    if (!fs.existsSync(STORE)) return [];
    const raw = fs.readFileSync(STORE, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    return [];
  }
};

const saveStore = (data) => {
  try {
    fs.writeFileSync(STORE, JSON.stringify(data, null, 2));
  } catch (err) {
    // ignore
  }
};

const scheduleUnmute = (client, entry, onExpire) => {
  const delay = entry.endsAt - Date.now();
  if (delay <= 0) return onExpire(entry);
  setTimeout(() => onExpire(entry), delay);
};

const addMute = (client, guildId, userId, durationMs, reason, actorId) => {
  const store = loadStore();
  const endsAt = Date.now() + durationMs;
  const entry = { guildId, userId, endsAt, reason, actorId };
  store.push(entry);
  saveStore(store);
  scheduleUnmute(client, entry, () => clearMute(client, userId, guildId));
};

const clearMute = async (client, userId, guildId) => {
  const store = loadStore().filter((m) => !(m.userId === userId && m.guildId === guildId));
  saveStore(store);
  try {
    const guild = await client.guilds.fetch(guildId);
    const member = await guild.members.fetch(userId);
    await member.timeout(null, 'Mute expired');
  } catch (err) {
    // ignore failures
  }
};

const restoreMutes = (client) => {
  const store = loadStore();
  const remaining = [];
  for (const entry of store) {
    if (entry.endsAt > Date.now()) {
      remaining.push(entry);
      scheduleUnmute(client, entry, () => clearMute(client, entry.userId, entry.guildId));
    }
  }
  saveStore(remaining);
};

module.exports = { addMute, restoreMutes };
