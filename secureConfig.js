const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// AES-256-GCM decrypt of secrets.enc
const ENCRYPTED_PATH = path.join(__dirname, 'secrets.enc');
const REQUIRED_DEFAULTS = ['DISCORD_TOKEN', 'GUILD_ID', 'PANIC_CONTROLLER_ID'];

const loadEncryptedSecrets = (key) => {
  if (!fs.existsSync(ENCRYPTED_PATH)) {
    throw new Error('secrets.enc not found. Generate one with SECRET_KEY and encrypted JSON payload.');
  }

  const raw = fs.readFileSync(ENCRYPTED_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  const iv = Buffer.from(parsed.iv, 'base64');
  const tag = Buffer.from(parsed.authTag, 'base64');
  const encrypted = Buffer.from(parsed.data, 'base64');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return JSON.parse(decrypted.toString('utf8'));
};

const mask = (value) => {
  if (!value) return '[redacted]';
  if (typeof value !== 'string') return '[redacted]';
  if (value.length <= 6) return '[redacted]';
  return `${value.slice(0, 2)}***${value.slice(-2)}`;
};

const loadSecrets = (requiredKeys = REQUIRED_DEFAULTS) => {
  const key = process.env.SECRET_KEY ? Buffer.from(process.env.SECRET_KEY, 'hex') : null;
  const allowFallback = process.env.UNSAFE_ENV_FALLBACK === 'true';

  if (!key) {
    if (allowFallback) {
      const missing = requiredKeys.filter((k) => !process.env[k]);
      if (missing.length) {
        throw new Error(`Missing required secrets: ${missing.join(', ')}`);
      }
      return requiredKeys.reduce((acc, k) => ({ ...acc, [k]: process.env[k] }), {});
    }
    throw new Error('SECRET_KEY missing. Set SECRET_KEY (hex) and provide secrets.enc.');
  }

  if (key.length !== 32) {
    throw new Error('SECRET_KEY must be 32 bytes (64 hex chars) for aes-256-gcm');
  }

  const secrets = loadEncryptedSecrets(key);
  const missing = requiredKeys.filter((k) => !secrets[k]);
  if (missing.length) {
    throw new Error(`Missing required secrets in secrets.enc: ${missing.join(', ')}`);
  }
  return secrets;
};

module.exports = { loadSecrets, mask };
