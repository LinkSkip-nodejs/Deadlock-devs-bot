const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  PermissionFlagsBits,
} = require('discord.js');
const { setupAutoMod } = require('./Automod');
const { loadSecrets, mask } = require('./secureConfig');
const { checkRateLimit } = require('./rateLimiter');
const { ensureStaff } = require('./permissions');
const { addMute, restoreMutes } = require('./mutes');
const { addWarn, clearWarns } = require('./warns');

// Centralized configuration for Deadlock Devs
const secrets = loadSecrets(['DISCORD_TOKEN', 'GUILD_ID', 'PANIC_CONTROLLER_ID']);
const staffRoleIds = (secrets.STAFF_ROLE_IDS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const CONFIG = {
  botPrefix: '!',
  panicControllerId: secrets.PANIC_CONTROLLER_ID,
  guildId: secrets.GUILD_ID,
  channels: {
    panicLock: [
      '1449962788012429415', // welcome
      '1449962788012429419', // chat
      '1449986364870234224', // scripts
      '1449962788012429421', // off-topic
    ],
    announcements: '1449962788012429416',
    log: '1449971736035725393',
    welcome: '1449962788012429415',
  },
  roles: {
    member: '1449976312067260437',
    staff: staffRoleIds,
  },
  messages: {
    welcome: (member) => `Welcome ${member} to Deadlock Devs! Make yourself at home.`,
  },
  announcements: {
    panicOn:
      'Attention: Panic protocol is active. Selected channels are read-only while we address an incident. We will update you shortly.',
    panicOff:
      'Notice: Panic protocol is cleared. All affected channels are restored to normal access. Thank you for your patience.',
  },
  rateLimits: {
    user: { windowMs: 15000, max: 8 },
    command: { windowMs: 8000, max: 4 },
  },
};

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.GuildMember],
});

let autoMod;

let panicActive = false;

const logInfo = (msg) => console.log(msg);
const logError = (msg, err) => console.error(msg, err);

const sanitize = (text) => {
  if (!text) return '[no content]';
  const redactedTokens = text.replace(/[A-Za-z0-9_\-]{23,}\.[A-Za-z0-9_\-]{6,}\.[A-Za-z0-9_\-]{27,}/g, '[redacted]');
  return redactedTokens.replace(/\s+/g, ' ').trim().slice(0, 1800);
};

const getGuild = () => client.guilds.cache.get(CONFIG.guildId);

const fetchChannel = async (channelId) => {
  if (!channelId) return null;
  try {
    return await client.channels.fetch(channelId);
  } catch (err) {
    logError(`Failed to fetch channel ${channelId}`, err);
    return null;
  }
};

const sendLogEmbed = async (embed) => {
  const channel = await fetchChannel(CONFIG.channels.log);
  if (channel?.isTextBased()) {
    try {
      await channel.send({ embeds: [embed] });
    } catch (err) {
      logError('Failed to send log embed', err);
    }
  }
};

const sendAnnouncement = async (content) => {
  const channel = await fetchChannel(CONFIG.channels.announcements);
  if (channel?.isTextBased()) {
    try {
      await channel.send({ content });
    } catch (err) {
      logError('Failed to send announcement', err);
    }
  }
};

const buildRoleList = (member) => {
  if (!member) return 'No roles';
  const roles = member.roles.cache
    .filter((role) => role.id !== member.guild.id)
    .map((role) => role.name)
    .filter(Boolean);
  return roles.length ? roles.join(', ') : 'No roles';
};

const formatTimestampField = (tsMs) => {
  const ts = tsMs ? Math.floor(tsMs / 1000) : Math.floor(Date.now() / 1000);
  return `<t:${ts}:F>\n<t:${ts}:R>`;
};

const formatContentBlock = (label, text) => {
  const safe = sanitize(text ?? '');
  const value = safe.length ? safe : '[no content]';
  return `**${label}**\n\`\`\`\n${value}\n\`\`\``;
};

const buildBaseEmbed = (title) =>
  new EmbedBuilder()
    .setTitle(title)
    .setColor(0x2b2d31)
    .setTimestamp();

const buildMessageEmbed = ({ title, eventType, message, contentSection }) => {
  const userTag = message.author?.tag ?? 'Unknown User';
  const displayName = message.member?.displayName ?? userTag;
  const userId = message.author?.id ?? 'Unknown ID';
  const msgId = message.id ?? 'Unknown Message ID';
  const roles = buildRoleList(message.member);
  const channelMention = message.channel ? `${message.channel}` : 'Unknown channel';
  const jump = message.guild
    ? `[Open Message](https://discord.com/channels/${message.guild.id}/${message.channel.id}/${message.id})`
    : 'Not available';
  const timestampField = formatTimestampField(message.createdTimestamp);

  return buildBaseEmbed(title).addFields(
    { name: 'Event', value: eventType, inline: false },
    { name: 'User', value: displayName, inline: false },
    { name: 'User ID', value: `\`${userId}\``, inline: false },
    { name: 'Message ID', value: `\`${msgId}\``, inline: false },
    { name: 'Roles', value: roles, inline: false },
    { name: 'Channel', value: channelMention, inline: false },
    { name: 'Timestamp', value: timestampField, inline: false },
    { name: 'Jump Link', value: jump, inline: false }
  ).setDescription(contentSection);
};

const logMessageCreate = async (message) => {
  const contentSection = formatContentBlock('Content', message.content);
  const embed = buildMessageEmbed({
    title: 'Message Logged',
    eventType: 'Message Logged',
    message,
    contentSection,
  });
  await sendLogEmbed(embed);
};

const logMessageDelete = async (message) => {
  const safeMessage = message.partial ? await message.fetch().catch(() => null) : message;
  if (!safeMessage) return;
  if (safeMessage.author?.bot) return;
  const contentSection = formatContentBlock('Content', safeMessage.content);
  const embed = buildMessageEmbed({
    title: 'Message Deleted',
    eventType: 'Message Deleted',
    message: safeMessage,
    contentSection,
  });
  await sendLogEmbed(embed);
};

const logMessageEdit = async (oldMessage, newMessage) => {
  const original = oldMessage.partial ? await oldMessage.fetch().catch(() => null) : oldMessage;
  const updated = newMessage.partial ? await newMessage.fetch().catch(() => null) : newMessage;
  if (!original || !updated) return;
  if (original.author?.bot) return;
  const beforeContent = formatContentBlock('Before', original.content);
  const afterContent = formatContentBlock('After', updated.content);
  if (beforeContent === afterContent) return;

  const embed = buildMessageEmbed({
    title: 'Message Edited',
    eventType: 'Message Edited',
    message: updated,
    contentSection: `${beforeContent}\n\n${afterContent}`,
  });
  await sendLogEmbed(embed);
};

const logCommandUse = async (message, commandName) => {
  const contentSection = formatContentBlock('Command', `${CONFIG.botPrefix}${commandName}`);
  const embed = buildMessageEmbed({
    title: 'Command Used',
    eventType: 'Command Used',
    message,
    contentSection,
  });
  await sendLogEmbed(embed);
};

const sendSimpleLog = async (title, body) => {
  const embed = buildBaseEmbed(title).setDescription(body);
  await sendLogEmbed(embed);
};

const setChannelLock = async (guild, shouldLock) => {
  const targets = ['everyone', CONFIG.roles.member];
  for (const channelId of CONFIG.channels.panicLock) {
    const channel = guild.channels.cache.get(channelId);
    if (!channel?.isTextBased()) continue;

    for (const target of targets) {
      const overwriteId = target === 'everyone' ? guild.roles.everyone.id : target;
      try {
        await channel.permissionOverwrites.edit(overwriteId, {
          SendMessages: shouldLock ? false : null,
          SendMessagesInThreads: shouldLock ? false : null,
          AddReactions: shouldLock ? false : null,
        });
      } catch (err) {
        logError(`Failed to ${shouldLock ? 'lock' : 'unlock'} channel ${channelId}`, err);
      }
    }
  }
};

const isPanicController = (message) => message.author.id === CONFIG.panicControllerId;

const handlePanicToggle = async (message, enable) => {
  const check = ensureStaff(message, {
    requiredPerms: [PermissionFlagsBits.ManageGuild],
    staffRoleIds: CONFIG.roles.staff,
    panicControllerId: CONFIG.panicControllerId,
  });
  if (!check.ok) {
    await message.reply({ content: 'You are not authorized to run panic commands.' });
    return;
  }
  if (panicActive === enable) {
    await message.reply({ content: `Panic mode is already ${enable ? 'enabled' : 'disabled'}.` });
    return;
  }

  const guild = getGuild();
  if (!guild) {
    await message.reply({ content: 'Guild not available. Try again later.' });
    return;
  }

  try {
    await setChannelLock(guild, enable);
    panicActive = enable;

    const announcement = enable ? CONFIG.announcements.panicOn : CONFIG.announcements.panicOff;
    await sendAnnouncement(announcement);
    await sendSimpleLog(
      enable ? 'Panic enabled' : 'Panic disabled',
      `${enable ? 'Panic enabled' : 'Panic disabled'} by ${message.member}`
    );
    await message.reply({ content: `Panic mode ${enable ? 'enabled' : 'disabled'}.` });
    logInfo(enable ? 'panic enabled' : 'panic disabled');
  } catch (err) {
    logError('Failed to toggle panic mode', err);
    await message.reply({ content: 'Unable to toggle panic right now.' });
  }
};

const parseDuration = (input) => {
  const match = /^(\d+)([smhd])$/i.exec(input ?? '');
  if (!match) return null;
  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const multipliers = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return value > 0 ? value * multipliers[unit] : null;
};

const findTargetMember = async (message, idOrMention) => {
  const mention = message.mentions.members.first();
  if (mention) return mention;
  if (!idOrMention) return null;
  try {
    return await message.guild.members.fetch(idOrMention);
  } catch {
    return null;
  }
};

const requireStaffPermission = async (message, permission) => {
  const check = ensureStaff(message, {
    requiredPerms: [permission],
    staffRoleIds: CONFIG.roles.staff,
    panicControllerId: CONFIG.panicControllerId,
  });
  if (!check.ok) {
    await message.reply({ content: 'You are not authorized to use this command.' });
    return false;
  }
  return true;
};

const handleBan = async (message, args) => {
  if (!(await requireStaffPermission(message, PermissionFlagsBits.BanMembers))) return;
  const target = await findTargetMember(message, args[0]);
  if (!target) return message.reply({ content: 'User not found.' });
  if (!target.bannable) return message.reply({ content: 'I cannot ban this user.' });
  const reason = sanitize(args.slice(1).join(' ')) || 'No reason provided';
  await target.ban({ reason });
  await message.reply({ content: `Banned ${target.user.tag}.` });
  await sendSimpleLog('User banned', `${target.user.tag} banned by ${message.member} | Reason: ${reason}`);
};

const handleKick = async (message, args) => {
  if (!(await requireStaffPermission(message, PermissionFlagsBits.KickMembers))) return;
  const target = await findTargetMember(message, args[0]);
  if (!target) return message.reply({ content: 'User not found.' });
  if (!target.kickable) return message.reply({ content: 'I cannot kick this user.' });
  const reason = sanitize(args.slice(1).join(' ')) || 'No reason provided';
  await target.kick(reason);
  await message.reply({ content: `Kicked ${target.user.tag}.` });
  await sendSimpleLog('User kicked', `${target.user.tag} kicked by ${message.member} | Reason: ${reason}`);
};

const handleMute = async (message, args) => {
  if (!(await requireStaffPermission(message, PermissionFlagsBits.ModerateMembers))) return;
  const target = await findTargetMember(message, args[0]);
  if (!target) return message.reply({ content: 'User not found.' });
  const durationMs = parseDuration(args[1]);
  if (!durationMs) return message.reply({ content: 'Provide a duration like 1m, 1h, or 1d.' });
  const reason = sanitize(args.slice(2).join(' ')) || 'No reason provided';
  try {
    await target.timeout(durationMs, reason);
    addMute(message.client, message.guild.id, target.id, durationMs, reason, message.author.id);
    await message.reply({ content: `Muted ${target.user.tag} for ${args[1]}.` });
    await sendSimpleLog('User muted', `${target.user.tag} muted by ${message.member} for ${args[1]} | Reason: ${reason}`);
  } catch (err) {
    logError('Failed to mute user', err);
    await message.reply({ content: 'Unable to mute this user.' });
  }
};

const handleWarn = async (message, args) => {
  if (!(await requireStaffPermission(message, PermissionFlagsBits.KickMembers))) return;
  const target = await findTargetMember(message, args[0]);
  if (!target) return message.reply({ content: 'User not found.' });
  const reason = sanitize(args.slice(1).join(' ')) || 'No reason provided';

  const count = addWarn(message.guild.id, target.id, { actor: message.author.id, reason });

  // Attempt DM on every warn
  let dmWarnSent = false;
  try {
    await target.send(
      `You have received a warning in ${message.guild.name}.\n` +
        `Reason: ${reason}\n` +
        `Count: ${count}/3\n` +
        `Issued by: ${message.member}`
    );
    dmWarnSent = true;
  } catch (err) {
    // ignore DM failure
  }

  if (count >= 3) {
    let dmSent = false;
    try {
      await target.send(
        `You have reached 3 warnings and will be removed from the server.\n` +
          `Last reason: ${reason}\n` +
          `Issued by: ${message.member}\n` +
          `Guild: ${message.guild.name}`
      );
      dmSent = true;
    } catch (err) {
      // ignore DM failure
    }
    try {
      await target.kick(`Manual warn threshold reached: ${reason}`);
      clearWarns(message.guild.id, target.id);
      await message.reply({ content: `Kicked ${target.user.tag} after 3 warnings. DM ${dmSent ? 'sent' : 'failed'}.` });
      await sendSimpleLog(
        'Warn -> Kick',
        `${target.user.tag} kicked after 3 warns by ${message.member} | Reason: ${reason} | DM: ${dmSent ? 'sent' : 'failed'}`
      );
    } catch (err) {
      await message.reply({ content: 'Reached 3 warns but failed to kick this user.' });
      logError('Failed to kick after 3 warns', err);
    }
    return;
  }

  await message.reply({ content: `Warned ${target.user.tag}. (${count}/3) DM ${dmWarnSent ? 'sent' : 'failed'}.` });
  await sendSimpleLog(
    'User warned',
    `${target.user.tag} warned by ${message.member} (${count}/3) | Reason: ${reason} | DM: ${dmWarnSent ? 'sent' : 'failed'}`
  );
};

client.once('ready', () => {
  logInfo('bot online');
  logInfo(`guild=${mask(CONFIG.guildId)} panicController=${mask(CONFIG.panicControllerId)}`);
  autoMod = setupAutoMod(client);
  restoreMutes(client);
  const guild = client.guilds.cache.get(CONFIG.guildId);
  if (!guild) {
    logError('Configured guild not found, shutting down.', CONFIG.guildId);
    process.exit(1);
  }
});

client.on('guildMemberAdd', async (member) => {
  try {
    const channel = await fetchChannel(CONFIG.channels.welcome);
    if (channel?.isTextBased()) {
      await channel.send({ content: CONFIG.messages.welcome(member) });
    }
    if (CONFIG.roles.member) {
      await member.roles.add(CONFIG.roles.member).catch((err) => logError('Failed to auto-assign member role', err));
    }
    await sendSimpleLog('Member joined', member.user.tag);
  } catch (err) {
    logError('Failed to handle member join', err);
  }
});

client.on('guildMemberRemove', async (member) => {
  try {
    await sendSimpleLog('Member left', member.user.tag);
  } catch (err) {
    logError('Failed to handle member leave', err);
  }
});

client.on('messageCreate', async (message) => {
  try {
    if (message.author.bot || !message.inGuild()) return;
    await logMessageCreate(message);

    // AutoMod runs before commands; returns true if it handled/deleted the message.
    if (autoMod && (await autoMod.handleMessage(message))) return;

    if (!message.content.startsWith(CONFIG.botPrefix)) return;
    const args = message.content.slice(CONFIG.botPrefix.length).trim().split(/\s+/);
    const command = args.shift()?.toLowerCase();

    const rate = checkRateLimit(message.author.id, command, CONFIG.rateLimits);
    if (!rate.allowed) {
      await message.reply({ content: rate.reason });
      return;
    }

    if (command === 'panic') {
      await logCommandUse(message, 'panic');
      await handlePanicToggle(message, true);
    } else if (command === 'unpanic') {
      await logCommandUse(message, 'unpanic');
      await handlePanicToggle(message, false);
    } else if (command === 'ban') {
      await logCommandUse(message, 'ban');
      await handleBan(message, args);
    } else if (command === 'kick') {
      await logCommandUse(message, 'kick');
      await handleKick(message, args);
    } else if (command === 'mute') {
      await logCommandUse(message, 'mute');
      await handleMute(message, args);
    } else if (command === 'warn') {
      await logCommandUse(message, 'warn');
      await handleWarn(message, args);
    }
  } catch (err) {
    logError('messageCreate handler failed', err);
  }
});

client.on('messageDelete', async (message) => {
  try {
    if (message.author?.bot) return;
    await logMessageDelete(message);
  } catch (err) {
    logError('messageDelete handler failed', err);
  }
});

client.on('messageUpdate', async (oldMessage, newMessage) => {
  try {
    if (newMessage.author?.bot) return;
    await logMessageEdit(oldMessage, newMessage);
  } catch (err) {
    logError('messageUpdate handler failed', err);
  }
});

process.on('unhandledRejection', (reason) => {
  logError('Unhandled rejection', reason);
});

process.on('uncaughtException', (err) => {
  logError('Uncaught exception', err);
});

process.on('SIGINT', async () => {
  logInfo('Received SIGINT, shutting down.');
  await client.destroy();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logInfo('Received SIGTERM, shutting down.');
  await client.destroy();
  process.exit(0);
});

client.login(secrets.DISCORD_TOKEN).catch((err) => {
  logError('Failed to login to Discord', err);
  process.exit(1);
});
