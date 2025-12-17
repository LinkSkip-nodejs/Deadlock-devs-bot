const fs = require('fs');
const path = require('path');

const STORE = path.join(__dirname, 'warns.json');

const loadStore = () => {
  try {
    if (!fs.existsSync(STORE)) return {};
    const raw = fs.readFileSync(STORE, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    return {};
  }
};

const saveStore = (data) => {
  try {
    fs.writeFileSync(STORE, JSON.stringify(data, null, 2));
  } catch (err) {
    // ignore
  }
};

const addWarn = (guildId, userId, entry) => {
  const store = loadStore();
  if (!store[guildId]) store[guildId] = {};
  const arr = store[guildId][userId] || [];
  arr.push({ ...entry, at: Date.now() });
  store[guildId][userId] = arr;
  saveStore(store);
  return arr.length;
};

const clearWarns = (guildId, userId) => {
  const store = loadStore();
  if (store[guildId]) {
    delete store[guildId][userId];
    if (Object.keys(store[guildId]).length === 0) delete store[guildId];
    saveStore(store);
  }
};

module.exports = { addWarn, clearWarns };
