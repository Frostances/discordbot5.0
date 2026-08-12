const { PermissionFlagsBits } = require('discord.js');
const { getGuildDb } = require('./database');

// Global bot owners
let _owners = null;
function getBotOwners() {
  try { _owners = require('../config/botOwners.json').owners || []; }
  catch { _owners = []; }
  return _owners;
}

function isBotOwner(userId) {
  return getBotOwners().includes(String(userId));
}

function isAdmin(member) {
  if (!member) return false;
  if (isBotOwner(member.id ?? member.user?.id)) return true;
  if (!member.guild) return false;
  if (member.guild.ownerId === member.id) return true;
  const db = getGuildDb(member.guild.id);
  const roleId = db.get('botAdminRoleId', null);
  return roleId ? member.roles.cache.has(roleId) : false;
}

function isStaff(member, db) {
  if (!member || !member.roles) return false;
  const staffRoles = db.get('staffRoles', []);
  return staffRoles.some(id => member.roles.cache.has(id));
}

function isStaffOrAdmin(member) {
  if (!member) return false;
  const db = getGuildDb(member.guild.id);
  return isAdmin(member) || isStaff(member, db);
}

function hasDiscordPerm(member, perm) {
  if (!member) return false;
  if (isAdmin(member)) return true;
  const flag = PermissionFlagsBits[perm];
  if (flag && member.permissions.has(flag)) return true;
  try {
    const { hasFakePermission } = require('./fakepermissions');
    const permName = perm.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/,'');
    if (hasFakePermission(member, permName)) return true;
  } catch {}
  return false;
}

function hasPermission(member, permName) {
  if (!member) return false;
  if (isAdmin(member)) return true;
  try {
    const { hasFakePermission } = require('./fakepermissions');
    if (hasFakePermission(member, permName)) return true;
  } catch {}
  const flagKey = permName.toLowerCase().replace(/_/g,'');
  for (const [key, value] of Object.entries(PermissionFlagsBits)) {
    if (key.toLowerCase() === flagKey) {
      return member.permissions.has(value);
    }
  }
  return false;
}

function checkRestriction(ctx, command) {
  try {
    const { checkRestriction: check } = require('./restrictcommand');
    return check(ctx, command);
  } catch { return false; }
}

function isCommandRestricted(member, command) {
  if (!member?.guild) return false;
  try {
    const { isRestricted } = require('./restrictcommand');
    return isRestricted(member, command, member.guild.id);
  } catch { return false; }
}

// ══════════════════════════════════════════════════════════
// SMART ROLE RESOLVER
// ══════════════════════════════════════════════════════════
function resolveRole(guild, query) {
  if (!query) return null;

  // 1. Role mention or raw ID
  const mentionMatch = query.match(/^<@&(\d+)>$/);
  const id = mentionMatch ? mentionMatch[1] : /^\d+$/.test(query) ? query : null;
  if (id) {
    const role = guild.roles.cache.get(id);
    if (role) return role;
  }

  const q = query.toLowerCase();
  const roles = [...guild.roles.cache.values()].filter(r => r.id !== guild.id);

  // 2. Exact name match (case-insensitive)
  const exact = roles.find(r => r.name.toLowerCase() === q);
  if (exact) return exact;

  // 3. Partial match (starts with)
  const partial = roles.find(r => r.name.toLowerCase().startsWith(q));
  if (partial) return partial;

  // 4. Substring match
  const substring = roles.find(r => r.name.toLowerCase().includes(q));
  if (substring) return substring;

  return null;
}

// ══════════════════════════════════════════════════════════
// INVOKE VARIABLE BUILDER
// ══════════════════════════════════════════════════════════
function buildInvokeVars(ctx, target, reason, duration, caseId) {
  const authorId = ctx.author?.id || ctx.user?.id;
  const guild = ctx.guild;
  const modMember = ctx.member;

  return {
    targetMention: target ? '<@' + target.id + '>' : '',
    targetName: target ? (target.user?.username || target.username || 'Unknown') : 'Unknown',
    targetId: target ? target.id : '',
    targetAvatar: target ? (target.user?.displayAvatarURL?.() || target.displayAvatarURL?.() || '') : '',
    userMention: target ? '<@' + target.id + '>' : '',
    userName: target ? (target.user?.username || target.username || 'Unknown') : 'Unknown',
    userId: target ? target.id : '',
    userAvatar: target ? (target.user?.displayAvatarURL?.() || target.displayAvatarURL?.() || '') : '',
    modMention: '<@' + authorId + '>',
    modName: modMember?.user?.username || modMember?.username || 'Unknown',
    modId: authorId,
    modIcon: modMember?.user?.displayAvatarURL?.() || modMember?.displayAvatarURL?.() || '',
    moderatorMention: '<@' + authorId + '>',
    moderatorName: modMember?.user?.username || modMember?.username || 'Unknown',
    moderatorId: authorId,
    moderatorIcon: modMember?.user?.displayAvatarURL?.() || modMember?.displayAvatarURL?.() || '',
    guildName: guild?.name || '',
    guildId: guild?.id || '',
    guildIcon: guild?.iconURL?.() || '',
    guildCount: (guild?.memberCount ?? 0).toString(),
    reason: reason || 'No reason provided',
    caseId: caseId ? '#' + caseId : '',
    duration: duration || '',
  };
}

// ══════════════════════════════════════════════════════════
// SEND INVOKE REPLY — uses new unified parser
// ══════════════════════════════════════════════════════════
function sendInvokeReply(ctx, guildId, command, target, reason, duration, caseId) {
  try {
    const { getInvokeReply } = require('./invoke');
    const vars = buildInvokeVars(ctx, target, reason, duration, caseId);
    const guild = ctx.guild;
    const invMsg = getInvokeReply(guildId, command, vars, guild);
    if (invMsg && (invMsg.content || invMsg.embeds?.length || invMsg.components?.length)) {
      if (ctx.editReply) return ctx.editReply(invMsg);
      return ctx.reply(invMsg);
    }
  } catch (err) {
    // invoke module not loaded or error
  }
  if (ctx.editReply) return ctx.editReply({ content: '👍', embeds: [], components: [] });
  return ctx.reply('👍');
}

// ══════════════════════════════════════════════════════════
// TIME FORMATTER
// ══════════════════════════════════════════════════════════
function formatTimeLeft(ms) {
  if (ms <= 0) return 'Expired';
  const s = Math.floor(ms / 1000);
  if (s < 60) return s + 's left';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm left';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h left';
  const d = Math.floor(h / 24);
  return d + 'd left';
}

module.exports = {
  isAdmin, isBotOwner, isStaff, isStaffOrAdmin,
  hasDiscordPerm,
  hasPermission,
  isCommandRestricted, checkRestriction,
  buildInvokeVars, sendInvokeReply, formatTimeLeft,
  resolveRole,
};
