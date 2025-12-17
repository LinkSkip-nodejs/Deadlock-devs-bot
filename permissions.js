const { PermissionFlagsBits } = require('discord.js');

const hasAnyRole = (member, roleIds = []) => roleIds.some((id) => member.roles.cache.has(id));

const ensureStaff = (message, options) => {
  const { requiredPerms = [], staffRoleIds = [], panicControllerId } = options;
  const member = message.member;
  if (!member) return { ok: false, reason: 'No member context' };

  const isPanicController = panicControllerId && message.author.id === panicControllerId;
  const hasRole = hasAnyRole(member, staffRoleIds);
  const hasPerms = requiredPerms.every((perm) => member.permissions.has(perm));

  if (isPanicController) return { ok: true };
  if (staffRoleIds.length === 0 && hasPerms) return { ok: true };
  if (hasRole && hasPerms) return { ok: true };
  return { ok: false, reason: 'Insufficient permissions' };
};

// Default staff requirement: Kick + staff role
const defaultStaffCheck = (message, staffRoleIds) =>
  ensureStaff(message, {
    requiredPerms: [PermissionFlagsBits.KickMembers],
    staffRoleIds,
  });

module.exports = { ensureStaff, defaultStaffCheck };
