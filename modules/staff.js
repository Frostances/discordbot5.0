/**
 * staff.js — Staff Management System
 * Commands: stripstaff, staffrole, stafflist, staffstats, staffcheck,
 * staffadd, staffremove, staffclear, staffprefix, staffnick,
 * staffavatar, staffbanner, staffcolor, staffhoist, staffmentionable,
 * staffposition, staffpermissions, stafficon, staffemoji
 */

const {
  EmbedBuilder, PermissionFlagsBits
} = require('discord.js');
const { getGuildDb, getUserDb } = require('./database');
const { COLORS, base } = require('../utils/embeds');

// ══════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════
function replyEmbed(ctx, embed, files = []) {
  const isInteraction = !!ctx.deferReply;
  const payload = { embeds: [embed] };
  if (files.length) payload.files = files;
  if (isInteraction) {
    if (ctx.deferred || ctx.replied) return ctx.editReply(payload);
    return ctx.reply(payload);
  }
  return ctx.channel.send(payload);
}

function successEmbed(title, desc) {
  return base(COLORS.success).setTitle(`✅ ${title}`).setDescription(desc);
}
function errorEmbed(title, desc) {
  return base(COLORS.error).setTitle(`❌ ${title}`).setDescription(desc);
}
function infoEmbed(title, desc) {
  return base(COLORS.primary).setTitle(title).setDescription(desc);
}

async function resolveMember(ctx, arg) {
  if (!arg) return null;
  const match = arg.match(/<@!?(\d+)>/);
  if (match) return ctx.guild.members.cache.get(match[1]) || await ctx.guild.members.fetch(match[1]).catch(() => null);
  if (/^\d+$/.test(arg)) return ctx.guild.members.cache.get(arg) || await ctx.guild.members.fetch(arg).catch(() => null);
  return ctx.guild.members.cache.find(m => m.user.username.toLowerCase() === arg.toLowerCase()) || null;
}

async function resolveRole(ctx, arg) {
  if (!arg) return null;
  const match = arg.match(/<@&?(\d+)>/);
  if (match) return ctx.guild.roles.cache.get(match[1]) || null;
  if (/^\d+$/.test(arg)) return ctx.guild.roles.cache.get(arg) || null;
  return ctx.guild.roles.cache.find(r => r.name.toLowerCase() === arg.toLowerCase()) || null;
}

function getStaffDb(guildId) {
  const db = getGuildDb(guildId);
  if (!db.data.staff) db.data.staff = { roles: [], prefix: '!' };
  return db.data.staff;
}

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
 * 1. Roles configured in staff DB
 * 2. Any role with dangerous permissions
 * 3. The configured staffRoleId
 */
function getMemberStaffRoles(member, guildDb) {
  const staffDb = guildDb.data.staff || { roles: [] };
  const staffRoleId = guildDb.data.staffRoleId;
  const dangerousIds = new Set();

  // Configured staff roles
  for (const rid of (staffDb.roles || [])) dangerousIds.add(rid);
  if (staffRoleId) dangerousIds.add(staffRoleId);

  // Any role the member has that has dangerous permissions
  for (const [, role] of member.roles.cache) {
    if (isDangerousRole(role)) dangerousIds.add(role.id);
    // Also include roles explicitly in staff list
    if ((staffDb.roles || []).includes(role.id)) dangerousIds.add(role.id);
    if (role.id === staffRoleId) dangerousIds.add(role.id);
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
  const guildDb = getGuildDb(member.guild.id);
  const rolesToRemove = getMemberStaffRoles(member, guildDb);
  const removed = [];

  for (const role of rolesToRemove) {
    // Don't try to remove @everyone or roles higher than bot
    if (role.managed) continue;
    if (role.id === member.guild.id) continue; // @everyone
    const botMember = await member.guild.members.fetch(member.client.user.id).catch(() => null);
    if (!botMember) continue;
    if (role.position >= botMember.roles.highest.position) continue;

    try {
      await member.roles.remove(role, reason);
      removed.push(role.name);
    } catch (err) {
      // Role might be too high or missing permissions
    }
  }

  return removed;
}

// ══════════════════════════════════════════════════════════
// 1. STRIPSTAFF — strips ALL staff roles from a user
// ══════════════════════════════════════════════════════════
async function handleStripstaff(ctx, args) {
  const member = await resolveMember(ctx, args[0]);
  if (!member) return replyEmbed(ctx, errorEmbed('Invalid User', 'Mention a valid member.'));

  const removed = await stripAllStaffRoles(member, `Stripped by ${ctx.author?.tag || ctx.user?.tag}`);

  if (!removed.length) {
    return replyEmbed(ctx, errorEmbed('No Roles Stripped', `${member} has no staff roles to remove.`));
  }

  return replyEmbed(ctx, successEmbed('Staff Stripped',
    `${member} has been stripped of **${removed.length}** staff role(s):\n${removed.map(r => `• ${r}`).join('\n')}`
  ));
}

// ══════════════════════════════════════════════════════════
// 2. STAFFROLE
// ══════════════════════════════════════════════════════════
async function handleStaffrole(ctx, args) {
  const db = getStaffDb(ctx.guild.id);
  const sub = args[0]?.toLowerCase();

  if (!sub || sub === 'list') {
    const roles = db.roles.map(id => `<@&${id}>`).join('\n') || 'None configured.';
    return replyEmbed(ctx, infoEmbed('Staff Roles', roles));
  }

  if (sub === 'add') {
    const role = await resolveRole(ctx, args[1]);
    if (!role) return replyEmbed(ctx, errorEmbed('Invalid Role', 'Mention a valid role.'));
    if (!db.roles.includes(role.id)) db.roles.push(role.id);
    getGuildDb(ctx.guild.id)._save();
    return replyEmbed(ctx, successEmbed('Role Added', `<@&${role.id}> added to staff roles.`));
  }

  if (sub === 'remove') {
    const role = await resolveRole(ctx, args[1]);
    if (!role) return replyEmbed(ctx, errorEmbed('Invalid Role', 'Mention a valid role.'));
    db.roles = db.roles.filter(id => id !== role.id);
    getGuildDb(ctx.guild.id)._save();
    return replyEmbed(ctx, successEmbed('Role Removed', `<@&${role.id}> removed from staff roles.`));
  }

  if (sub === 'set') {
    const role = await resolveRole(ctx, args[1]);
    if (!role) return replyEmbed(ctx, errorEmbed('Invalid Role', 'Mention a valid role.'));
    db.roles = [role.id];
    getGuildDb(ctx.guild.id)._save();
    return replyEmbed(ctx, successEmbed('Role Set', `<@&${role.id}> set as the staff role.`));
  }

  if (sub === 'clear') {
    db.roles = [];
    getGuildDb(ctx.guild.id)._save();
    return replyEmbed(ctx, successEmbed('Cleared', 'All staff roles have been cleared.'));
  }
}

// ══════════════════════════════════════════════════════════
// 3. STAFFLIST
// ══════════════════════════════════════════════════════════
async function handleStafflist(ctx, args) {
  const db = getStaffDb(ctx.guild.id);
  const staffRoles = db.roles.length ? db.roles : [getGuildDb(ctx.guild.id).data.staffRoleId].filter(Boolean);

  if (!staffRoles.length) return replyEmbed(ctx, errorEmbed('No Staff Roles', 'No staff roles configured.'));

  const members = [];
  for (const rid of staffRoles) {
    const role = ctx.guild.roles.cache.get(rid);
    if (!role) continue;
    for (const [, member] of role.members) {
      if (!members.find(m => m.id === member.id)) members.push(member);
    }
  }

  if (!members.length) return replyEmbed(ctx, infoEmbed('Staff List', 'No staff members found.'));

  const list = members.map((m, i) => `${i + 1}. ${m.user.tag} (${m.id})`).join('\n');
  return replyEmbed(ctx, infoEmbed(`Staff Members (${members.length})`, list.slice(0, 4000)));
}

// ══════════════════════════════════════════════════════════
// 4. STAFFSTATS
// ══════════════════════════════════════════════════════════
async function handleStaffstats(ctx, args) {
  const member = await resolveMember(ctx, args[0]) || ctx.member;
  const userDb = getUserDb(member.id);
  const stats = userDb.data.staffStats || { actions: 0, bans: 0, kicks: 0, mutes: 0, warns: 0 };

  return replyEmbed(ctx, infoEmbed(`Staff Stats — ${member.user.tag}`,
    `**Total Actions:** ${stats.actions}\n` +
    `**Bans:** ${stats.bans}\n` +
    `**Kicks:** ${stats.kicks}\n` +
    `**Mutes:** ${stats.mutes}\n` +
    `**Warnings:** ${stats.warns}`
  ));
}

// ══════════════════════════════════════════════════════════
// 5. STAFFCHECK
// ══════════════════════════════════════════════════════════
async function handleStaffcheck(ctx, args) {
  const member = await resolveMember(ctx, args[0]) || ctx.member;
  const guildDb = getGuildDb(ctx.guild.id);
  const staffRoles = getMemberStaffRoles(member, guildDb);

  if (!staffRoles.length) {
    return replyEmbed(ctx, infoEmbed(`Staff Check — ${member.user.tag}`, 'This user has no staff roles.'));
  }

  const list = staffRoles.map(r => `• <@&${r.id}> — ${r.permissions.toArray().length} permissions`).join('\n');
  return replyEmbed(ctx, infoEmbed(`Staff Check — ${member.user.tag}`,
    `**Staff Roles (${staffRoles.length}):**\n${list}`
  ));
}

// ══════════════════════════════════════════════════════════
// 6. STAFFADD / STAFFREMOVE / STAFFCLEAR
// ══════════════════════════════════════════════════════════
async function handleStaffadd(ctx, args) {
  const member = await resolveMember(ctx, args[0]);
  const role = await resolveRole(ctx, args[1]);
  if (!member) return replyEmbed(ctx, errorEmbed('Invalid User', 'Mention a valid member.'));
  if (!role) return replyEmbed(ctx, errorEmbed('Invalid Role', 'Mention a valid role.'));

  if (member.roles.cache.has(role.id)) {
    return replyEmbed(ctx, errorEmbed('Already Has Role', `${member} already has <@&${role.id}>.`));
  }

  try {
    await member.roles.add(role);
    return replyEmbed(ctx, successEmbed('Role Added', `Added <@&${role.id}> to ${member}.`));
  } catch (err) {
    return replyEmbed(ctx, errorEmbed('Failed', err.message));
  }
}

async function handleStaffremove(ctx, args) {
  const member = await resolveMember(ctx, args[0]);
  const role = await resolveRole(ctx, args[1]);
  if (!member) return replyEmbed(ctx, errorEmbed('Invalid User', 'Mention a valid member.'));
  if (!role) return replyEmbed(ctx, errorEmbed('Invalid Role', 'Mention a valid role.'));

  if (!member.roles.cache.has(role.id)) {
    return replyEmbed(ctx, errorEmbed('Missing Role', `${member} does not have <@&${role.id}>.`));
  }

  try {
    await member.roles.remove(role);
    return replyEmbed(ctx, successEmbed('Role Removed', `Removed <@&${role.id}> from ${member}.`));
  } catch (err) {
    return replyEmbed(ctx, errorEmbed('Failed', err.message));
  }
}

async function handleStaffclear(ctx, args) {
  const member = await resolveMember(ctx, args[0]);
  if (!member) return replyEmbed(ctx, errorEmbed('Invalid User', 'Mention a valid member.'));

  const guildDb = getGuildDb(ctx.guild.id);
  const staffRoles = getMemberStaffRoles(member, guildDb);

  if (!staffRoles.length) {
    return replyEmbed(ctx, errorEmbed('No Staff Roles', `${member} has no staff roles to clear.`));
  }

  let removed = 0;
  for (const role of staffRoles) {
    try {
      await member.roles.remove(role);
      removed++;
    } catch {}
  }

  return replyEmbed(ctx, successEmbed('Cleared', `Removed **${removed}** staff role(s) from ${member}.`));
}

// ══════════════════════════════════════════════════════════
// 7. STAFFPREFIX
// ══════════════════════════════════════════════════════════
async function handleStaffprefix(ctx, args) {
  const db = getStaffDb(ctx.guild.id);
  if (!args[0]) {
    return replyEmbed(ctx, infoEmbed('Staff Prefix', `Current prefix: \`${db.prefix || '!'}\``));
  }
  db.prefix = args[0];
  getGuildDb(ctx.guild.id)._save();
  return replyEmbed(ctx, successEmbed('Prefix Set', `Staff prefix set to \`${args[0]}\`.`));
}

// ══════════════════════════════════════════════════════════
// 8. STAFFNICK
// ══════════════════════════════════════════════════════════
async function handleStaffnick(ctx, args) {
  const member = await resolveMember(ctx, args[0]);
  const nick = args.slice(1).join(' ') || null;
  if (!member) return replyEmbed(ctx, errorEmbed('Invalid User', 'Mention a valid member.'));

  try {
    await member.setNickname(nick);
    return replyEmbed(ctx, successEmbed('Nickname Set', `${member}'s nickname ${nick ? `set to **${nick}**` : 'reset'}.`));
  } catch (err) {
    return replyEmbed(ctx, errorEmbed('Failed', err.message));
  }
}

// ══════════════════════════════════════════════════════════
// 9. STAFFAVATAR / STAFFBANNER / STAFFCOLOR / STAFFICON
// ══════════════════════════════════════════════════════════
async function handleStaffavatar(ctx, args) {
  const member = await resolveMember(ctx, args[0]) || ctx.member;
  const embed = new EmbedBuilder()
    .setTitle(`${member.user.tag}'s Avatar`)
    .setImage(member.user.displayAvatarURL({ size: 4096, dynamic: true }))
    .setColor(COLORS.primary);
  return replyEmbed(ctx, embed);
}

async function handleStaffbanner(ctx, args) {
  const member = await resolveMember(ctx, args[0]) || ctx.member;
  const user = await member.user.fetch();
  if (!user.bannerURL()) {
    return replyEmbed(ctx, errorEmbed('No Banner', `${member} has no banner.`));
  }
  const embed = new EmbedBuilder()
    .setTitle(`${member.user.tag}'s Banner`)
    .setImage(user.bannerURL({ size: 4096 }))
    .setColor(COLORS.primary);
  return replyEmbed(ctx, embed);
}

async function handleStaffcolor(ctx, args) {
  const member = await resolveMember(ctx, args[0]) || ctx.member;
  const color = member.displayHexColor;
  const embed = new EmbedBuilder()
    .setTitle(`${member.user.tag}'s Color`)
    .setDescription(`**Hex:** ${color}`)
    .setColor(color === '#000000' ? COLORS.primary : color);
  return replyEmbed(ctx, embed);
}

async function handleStafficon(ctx, args) {
  const member = await resolveMember(ctx, args[0]) || ctx.member;
  const embed = new EmbedBuilder()
    .setTitle(`${member.user.tag}'s Server Avatar`)
    .setImage(member.displayAvatarURL({ size: 4096, dynamic: true }))
    .setColor(COLORS.primary);
  return replyEmbed(ctx, embed);
}

// ══════════════════════════════════════════════════════════
// 10. STAFFHOIST / STAFFMENTIONABLE / STAFFPOSITION
// ══════════════════════════════════════════════════════════
async function handleStaffhoist(ctx, args) {
  const role = await resolveRole(ctx, args[0]);
  if (!role) return replyEmbed(ctx, errorEmbed('Invalid Role', 'Mention a valid role.'));

  try {
    await role.setHoist(!role.hoist);
    return replyEmbed(ctx, successEmbed('Hoist Toggled', `<@&${role.id}> hoist is now **${!role.hoist ? 'enabled' : 'disabled'}**.`));
  } catch (err) {
    return replyEmbed(ctx, errorEmbed('Failed', err.message));
  }
}

async function handleStaffmentionable(ctx, args) {
  const role = await resolveRole(ctx, args[0]);
  if (!role) return replyEmbed(ctx, errorEmbed('Invalid Role', 'Mention a valid role.'));

  try {
    await role.setMentionable(!role.mentionable);
    return replyEmbed(ctx, successEmbed('Mentionable Toggled', `<@&${role.id}> mentionable is now **${!role.mentionable ? 'enabled' : 'disabled'}**.`));
  } catch (err) {
    return replyEmbed(ctx, errorEmbed('Failed', err.message));
  }
}

async function handleStaffposition(ctx, args) {
  const role = await resolveRole(ctx, args[0]);
  const position = parseInt(args[1]);
  if (!role) return replyEmbed(ctx, errorEmbed('Invalid Role', 'Mention a valid role.'));
  if (isNaN(position)) return replyEmbed(ctx, errorEmbed('Invalid Position', 'Provide a number.'));

  try {
    await role.setPosition(position);
    return replyEmbed(ctx, successEmbed('Position Set', `<@&${role.id}> position set to **${position}**.`));
  } catch (err) {
    return replyEmbed(ctx, errorEmbed('Failed', err.message));
  }
}

// ══════════════════════════════════════════════════════════
// 11. STAFFPERMISSIONS
// ══════════════════════════════════════════════════════════
async function handleStaffpermissions(ctx, args) {
  const role = await resolveRole(ctx, args[0]);
  if (!role) return replyEmbed(ctx, errorEmbed('Invalid Role', 'Mention a valid role.'));

  const perms = role.permissions.toArray();
  const list = perms.length ? perms.map(p => `• ${p}`).join('\n') : 'No permissions.';
  return replyEmbed(ctx, infoEmbed(`Permissions — ${role.name}`, list));
}

// ══════════════════════════════════════════════════════════
// 12. STAFFEMOJI
// ══════════════════════════════════════════════════════════
async function handleStaffemoji(ctx, args) {
  const emoji = args[0];
  if (!emoji) return replyEmbed(ctx, errorEmbed('Missing Emoji', 'Provide an emoji.'));

  const match = emoji.match(/<(a?):(\w+):(\d+)>/);
  if (!match) return replyEmbed(ctx, errorEmbed('Invalid Emoji', 'Provide a custom emoji.'));

  const [, animated, name, id] = match;
  const url = `https://cdn.discordapp.com/emojis/${id}.${animated ? 'gif' : 'png'}?size=4096`;

  const embed = new EmbedBuilder()
    .setTitle(`Emoji: ${name}`)
    .setImage(url)
    .setColor(COLORS.primary);
  return replyEmbed(ctx, embed);
}

// ══════════════════════════════════════════════════════════
// EXPORTS
// ══════════════════════════════════════════════════════════
module.exports = {
  handleStripstaff,
  handleStaffrole,
  handleStafflist,
  handleStaffstats,
  handleStaffcheck,
  handleStaffadd,
  handleStaffremove,
  handleStaffclear,
  handleStaffprefix,
  handleStaffnick,
  handleStaffavatar,
  handleStaffbanner,
  handleStaffcolor,
  handleStaffhoist,
  handleStaffmentionable,
  handleStaffposition,
  handleStaffpermissions,
  handleStafficon,
  handleStaffemoji,
  // Also export the strip helper for security.js
  stripAllStaffRoles,
  getMemberStaffRoles,
  isDangerousRole,
  DANGEROUS_PERMS,
};