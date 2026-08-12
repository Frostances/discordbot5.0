/**
 * staffExtras.js — Staff stripping utilities
 * Exports: handleStripstaff, stripAllStaffRoles, getMemberStaffRoles, isDangerousRole
 */

const { PermissionFlagsBits } = require('discord.js');
const { getGuildDb } = require('./database');
const { isStaffOrAdmin } = require('./helpers');

// ══════════════════════════════════════════════════════════
// DANGEROUS PERMISSIONS — used to identify staff roles
// ══════════════════════════════════════════════════════════
const DANGEROUS_PERMS = [
  PermissionFlagsBits.Administrator,
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.ManageGuild,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.ManageMessages,
  PermissionFlagsBits.MentionEveryone,
  PermissionFlagsBits.ManageWebhooks,
  PermissionFlagsBits.ManageNicknames,
  PermissionFlagsBits.ManageEmojisAndStickers,
  PermissionFlagsBits.ModerateMembers,
];

/**
 * Check if a role has any dangerous permission
 */
function isDangerousRole(role) {
  return DANGEROUS_PERMS.some(perm => role.permissions.has(perm));
}

/**
 * Get all "staff" roles for a member:
 * 1. Roles configured in staffRoles DB
 * 2. Any role the member has that has dangerous permissions
 */
function getMemberStaffRoles(member) {
  const db = getGuildDb(member.guild.id);
  const staffRoles = db.get('staffRoles', []);
  const dangerousIds = new Set();

  // Configured staff roles
  for (const rid of staffRoles) dangerousIds.add(rid);

  // Any role the member has that has dangerous permissions
  for (const [, role] of member.roles.cache) {
    if (isDangerousRole(role)) dangerousIds.add(role.id);
  }

  return Array.from(dangerousIds)
    .map(id => member.guild.roles.cache.get(id))
    .filter(r => r && member.roles.cache.has(r.id));
}

/**
 * Strip ALL staff roles from a member.
 * Returns array of removed role names.
 */
async function stripAllStaffRoles(member, reason = 'Staff strip') {
  const rolesToRemove = getMemberStaffRoles(member);
  const removed = [];

  const botMember = await member.guild.members.fetch(member.guild.client.user.id).catch(() => null);
  if (!botMember) return removed;

  for (const role of rolesToRemove) {
    // Don't try to remove @everyone or managed roles or roles higher than bot
    if (role.managed) continue;
    if (role.id === member.guild.id) continue; // @everyone
    if (role.position >= botMember.roles.highest.position) continue;

    try {
      await member.roles.remove(role, reason);
      removed.push(role.name);
    } catch {
      // Role might be too high or missing permissions
    }
  }

  return removed;
}

/**
 * ,stripstaff @user — strips all staff roles from a user
 */
async function handleStripstaff(message, args) {
  const target = message.mentions.members.first() ||
    (args[0]?.match(/^\d+$/) ? await message.guild.members.fetch(args[0]).catch(() => null) : null);

  if (!target) {
    const { error: mkError } = require('../utils/embeds');
    return message.reply({ embeds: [mkError('Invalid User', 'Mention a valid member.')] });
  }

  if (!isStaffOrAdmin(message.member)) {
    const { error: mkError } = require('../utils/embeds');
    return message.reply({ embeds: [mkError('No Permission', 'You need staff or admin permissions.')] });
  }

  const removed = await stripAllStaffRoles(target, `Stripped by ${message.author.tag}`);

  if (!removed.length) {
    const { error: mkError } = require('../utils/embeds');
    return message.reply({ embeds: [mkError('No Roles Stripped', `${target} has no staff roles to remove.`)] });
  }

  const { success: mkSuccess } = require('../utils/embeds');
  return message.reply({
    embeds: [mkSuccess('Staff Stripped',
      `${target} has been stripped of **${removed.length}** staff role(s):\n${removed.map(r => `• ${r}`).join('\n')}`
    )]
  });
}

module.exports = {
  handleStripstaff,
  stripAllStaffRoles,
  getMemberStaffRoles,
  isDangerousRole,
  DANGEROUS_PERMS,
};