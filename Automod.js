const fs = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');
const { addMute } = require('./mutes');
const { addWarn, clearWarns } = require('./warns');

// Load automod configuration with modular rules and severities
const CONFIG_PATH = path.join(__dirname, 'automodconfig.json');

const defaultConfig = {
	enabled: true,
	logChannelId: '',
	bypassRoles: [],
	whitelistChannels: [],
	deleteMessage: true,
	replyToUser: true,
	replyMessage: 'Your message was removed by AutoMod.',
	cooldownSeconds: 5,
	rules: [
		{ name: 'blockedWords', severity: 'warn', blocked: ['badword1', 'badword2'] },
		{ name: 'discordInvites', severity: 'mute', block: true },
		{ name: 'blockedDomains', severity: 'mute', domains: ['short.url'] },
		{ name: 'mentions', severity: 'warn', max: 5 },
		{ name: 'emoji', severity: 'warn', max: 20 },
		{ name: 'caps', severity: 'warn', minLength: 12, maxPercent: 70 },
	],
};

const cooldowns = new Map(); // userId -> last epoch ms

const readConfig = () => {
	try {
		if (!fs.existsSync(CONFIG_PATH)) {
			fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaultConfig, null, 2));
			return defaultConfig;
		}
		const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
		return { ...defaultConfig, ...JSON.parse(raw) };
	} catch (err) {
		return defaultConfig;
	}
};

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const countEmoji = (content) => {
	const emojiRegex = /<a?:\w+:\d+>|[\p{Emoji_Presentation}\p{Emoji}\u200d]+/gu;
	const matches = content.match(emojiRegex);
	return matches ? matches.length : 0;
};

const capsPercent = (content) => {
	const letters = content.replace(/[^a-zA-Z]/g, '');
	if (!letters.length) return 0;
	const caps = letters.replace(/[a-z]/g, '').length;
	return Math.round((caps / letters.length) * 100);
};

const sanitize = (text) => {
	if (!text) return '[no content]';
	const redacted = text.replace(/[A-Za-z0-9_\-]{23,}\.[A-Za-z0-9_\-]{6,}\.[A-Za-z0-9_\-]{27,}/g, '[redacted]');
	return redacted.replace(/\s+/g, ' ').trim().slice(0, 800);
};

const buildLogEmbed = ({ title, description, message, severity, ruleName }) =>
	new EmbedBuilder()
		.setTitle(title)
		.setColor(0xda373c)
		.setDescription(description)
		.addFields(
			{ name: 'User', value: `${message.author.tag} (${message.author.id})`, inline: false },
			{ name: 'Channel', value: `${message.channel}`, inline: false },
			{ name: 'Rule', value: ruleName, inline: true },
			{ name: 'Severity', value: severity, inline: true },
			{ name: 'Content', value: sanitize(message.content), inline: false }
		)
		.setTimestamp();

const shouldBypass = (message, cfg) => {
	if (!message.member) return false;
	if (cfg.whitelistChannels.includes(message.channel.id)) return true;
	return cfg.bypassRoles.some((roleId) => message.member.roles.cache.has(roleId));
};

const sendLog = async (client, cfg, embed) => {
	if (!cfg.logChannelId) return;
	try {
		const channel = await client.channels.fetch(cfg.logChannelId);
		if (channel?.isTextBased()) {
			await channel.send({ embeds: [embed] });
		}
	} catch (err) {
		// ignore logging failures
	}
};

const ruleHandlers = {
	blockedWords: (rule, content) => {
		if (!rule.blocked?.length) return null;
		const hit = rule.blocked.find((w) => new RegExp(`\\b${escapeRegex(w)}\\b`, 'i').test(content));
		return hit ? `Blocked word detected: ${hit}` : null;
	},
	discordInvites: (rule, content) => {
		if (!rule.block) return null;
		const inviteRegex = /(discord\.(gg|com|io|me)\/|discordapp\.com\/invite)/i;
		return inviteRegex.test(content) ? 'Discord invite links are not allowed.' : null;
	},
	blockedDomains: (rule, content) => {
		if (!rule.domains?.length) return null;
		const pattern = rule.domains.map((d) => escapeRegex(d)).join('|');
		if (!pattern) return null;
		return new RegExp(pattern, 'i').test(content) ? 'Links to blocked domains are not allowed.' : null;
	},
	mentions: (rule, _content, message) => {
		if (!rule.max || !message.mentions) return null;
		const count = message.mentions.users.size + message.mentions.roles.size + (message.mentions.everyone ? 1 : 0);
		return count > rule.max ? `Too many mentions (${count}/${rule.max}).` : null;
	},
	emoji: (rule, content) => {
		if (!rule.max) return null;
		const count = countEmoji(content);
		return count > rule.max ? `Too many emoji (${count}/${rule.max}).` : null;
	},
	caps: (rule, content) => {
		if (!rule.maxPercent) return null;
		const pct = capsPercent(content);
		if (content.length < (rule.minLength ?? 0)) return null;
		return pct > rule.maxPercent ? `Excessive caps (${pct}% > ${rule.maxPercent}%).` : null;
	},
};

const severityAction = async (client, message, rule, reason) => {
	const severity = rule.severity || 'warn';

	if (severity === 'warn') {
		const count = addWarn(message.guild.id, message.author.id, { rule: rule.name, reason });
		let dmWarnSent = false;
		try {
			await message.author.send(
				`You received an AutoMod warning in ${message.guild.name}.\n` +
				`Reason: ${reason}\n` +
				`Rule: ${rule.name}\n` +
				`Count: ${count}/3`
			);
			dmWarnSent = true;
		} catch (err) {
			// ignore DM failure
		}
		if (count >= 3) {
			let dmSent = false;
			try {
				await message.author.send(
					`You have reached 3 AutoMod warnings and will be removed.\n` +
					`Last reason: ${reason}\n` +
					`Rule: ${rule.name}\n` +
					`Channel: ${message.channel}`
				);
				dmSent = true;
			} catch (err) {
				// ignore DM failure
			}
			try {
				await message.member?.kick(`AutoMod: 3 warns - ${reason}`);
				clearWarns(message.guild.id, message.author.id);
				return { action: dmSent ? 'warn->kick (dm sent)' : 'warn->kick', warns: count };
			} catch (err) {
				return { action: 'kick_failed_after_warns', warns: count, error: err };
			}
		}
			return { action: `warned (${count}/3)`, dm: dmWarnSent };
	}

	if (severity === 'mute') {
		const minutes = rule.durationMinutes ?? 10;
		const durationMs = minutes * 60000;
		try {
			await message.member?.timeout(durationMs, `AutoMod: ${reason}`);
			addMute(client, message.guild.id, message.author.id, durationMs, reason, 'automod');
			return { action: `muted ${minutes}m` };
		} catch (err) {
			return { action: 'mute_failed', error: err };
		}
	}
	if (severity === 'kick') {
		try {
			await message.member?.kick(`AutoMod: ${reason}`);
			return { action: 'kicked' };
		} catch (err) {
			return { action: 'kick_failed', error: err };
		}
	}
	if (severity === 'ban') {
		try {
			await message.guild.members.ban(message.author.id, { reason: `AutoMod: ${reason}` });
			return { action: 'banned' };
		} catch (err) {
			return { action: 'ban_failed', error: err };
		}
	}
	return { action: 'warned' };
};

const handleViolation = async (client, message, rule, reason, cfg) => {
	const reasonText = sanitize(reason);
	if (cfg.deleteMessage && message.deletable) {
		await message.delete().catch(() => {});
	}

	const actionResult = await severityAction(client, message, rule, reasonText);

	if (cfg.replyToUser) {
		await message.channel
			.send({ content: `${message.author}, ${cfg.replyMessage}\n${reasonText} [${actionResult.action}]` })
			.catch(() => {});
	}

	const embed = buildLogEmbed({
		title: 'AutoMod Action',
		description: `${reasonText}\nAction: ${actionResult.action}${actionResult.warns ? ` | Warns: ${actionResult.warns}` : ''}${actionResult.dm ? ' | DM sent' : ''}`,
		message,
		severity: rule.severity || 'warn',
		ruleName: rule.name,
	});
	await sendLog(client, cfg, embed);
};

const setupAutoMod = (client) => {
	const config = readConfig();
	const cooldownMs = (config.cooldownSeconds ?? 5) * 1000;

	const handleMessage = async (message) => {
		if (!config.enabled) return false;
		if (!message.inGuild()) return false;
		if (message.author.bot) return false;
		if (shouldBypass(message, config)) return false;

		const last = cooldowns.get(message.author.id) || 0;
		if (Date.now() - last < cooldownMs) return false;

		const content = message.content || '';
		for (const rule of config.rules || []) {
			const handler = ruleHandlers[rule.name];
			if (!handler) continue;
			const reason = handler(rule, content, message);
			if (!reason) continue;

			cooldowns.set(message.author.id, Date.now());
			await handleViolation(client, message, rule, reason, config);
			return true;
		}
		return false;
	};

	return { handleMessage };
};

module.exports = { setupAutoMod };
