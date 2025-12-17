const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REQUIRED = ['DISCORD_TOKEN', 'GUILD_ID', 'PANIC_CONTROLLER_ID'];
const INPUT = path.join(__dirname, 'secrets.plain.json');
const OUTPUT = path.join(__dirname, 'secrets.enc');

const mask = (v) => (typeof v === 'string' && v.length > 6 ? `${v.slice(0, 2)}***${v.slice(-2)}` : '[redacted]');

const main = () => {
  const keyHex = process.env.SECRET_KEY;
  if (!keyHex || keyHex.length !== 64) {
    console.error('SECRET_KEY must be set (64 hex chars for aes-256-gcm)');
    process.exit(1);
  }
  const key = Buffer.from(keyHex, 'hex');

  if (!fs.existsSync(INPUT)) {
    console.error(`Input ${INPUT} not found. Create it with your secrets first.`);
    process.exit(1);
  }

  const raw = fs.readFileSync(INPUT, 'utf8');
  let json;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    console.error('Invalid JSON in secrets.plain.json');
    process.exit(1);
  }

  const missing = REQUIRED.filter((k) => !json[k] || typeof json[k] !== 'string' || !json[k].trim());
  if (missing.length) {
    console.error(`Missing required keys: ${missing.join(', ')}`);
    process.exit(1);
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(json), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const payload = {
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    data: encrypted.toString('base64'),
  };

  fs.writeFileSync(OUTPUT, JSON.stringify(payload, null, 2));
  console.log('Wrote secrets.enc');
  console.log(`GUILD_ID=${mask(json.GUILD_ID)}`);
  console.log(`PANIC_CONTROLLER_ID=${mask(json.PANIC_CONTROLLER_ID)}`);
  if (json.STAFF_ROLE_IDS) console.log(`STAFF_ROLE_IDS=${json.STAFF_ROLE_IDS}`);
};

main();
