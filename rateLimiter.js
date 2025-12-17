const now = () => Date.now();

// Simple sliding-window limiter for users and commands
const buckets = new Map(); // key -> array of timestamps

const prune = (key, windowMs) => {
  const arr = buckets.get(key);
  if (!arr) return [];
  const cutoff = now() - windowMs;
  const pruned = arr.filter((t) => t >= cutoff);
  buckets.set(key, pruned);
  return pruned;
};

const record = (key) => {
  const arr = buckets.get(key) || [];
  arr.push(now());
  buckets.set(key, arr);
};

const checkRateLimit = (userId, command, limits) => {
  const {
    user: { windowMs: userWindow, max: userMax },
    command: { windowMs: cmdWindow, max: cmdMax },
  } = limits;

  const userKey = `user:${userId}`;
  const cmdKey = `cmd:${command}`;

  const userArr = prune(userKey, userWindow);
  const cmdArr = prune(cmdKey, cmdWindow);

  if (userArr.length >= userMax) {
    return { allowed: false, reason: 'Rate limit: too many requests (user).' };
  }
  if (cmdArr.length >= cmdMax) {
    return { allowed: false, reason: 'Rate limit: command cooling down.' };
  }

  record(userKey);
  record(cmdKey);
  return { allowed: true };
};

module.exports = { checkRateLimit };
