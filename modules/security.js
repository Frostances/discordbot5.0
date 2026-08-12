/**
 * security.js — Security & AntiNuke System
 * Commands: antinuke, antiraid, whitelist, blacklist
 * Events: guildMemberAdd, guildMemberRemove, channelCreate, channelDelete,
 *         roleCreate, roleDelete, roleUpdate, emojiDelete, stickerDelete,
 *         webhookCreate, guildUpdate, guildBanAdd, guildMemberRemove (kick)
 */

const {
  EmbedBuilder, PermissionFlagsBits, AuditLogEvent
} = require('discord.js');
const { getGuildDb, getUserDb } = require('./database');
const { COLORS, base } = require('../utils/embeds');
const { stripAllStaffRoles } = require('./staff');

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

function getSecurityDb(guildId) {
  const db = getGuildDb(guildId);
  if (!db.data.security) {
    db.data.security = {
      enabled: false,
      punishment: 'strip', // ban, kick, strip
      modules: {
        ban: { enabled: false, threshold: 3, command: true },
        kick: { enabled: false, threshold: 3, command: true },
        roleDelete: { enabled: false, threshold: 3 },
        roleCreate: { enabled: false, threshold: 3 },
        channelDelete: { enabled: false, threshold: 3 },
        channelCreate: { enabled: false, threshold: 3 },
        emojiDelete: { enabled: false, threshold: 3 },
        stickerDelete: { enabled: false, threshold: 3 },
        webhookCreate: { enabled: false, threshold: 3 },
        guildUpdate: { enabled: false, threshold: 1 },
        botAdd: { enabled: false, threshold: 1 },
        vanity: { enabled: false, threshold: 1 },
      },
      whitelist: [], // user IDs
      admins: [], // user IDs who can configure antinuke
      logChannel: null,
    };
  }
  return db.data.security;
}

// Action tracker: userId -> { actionType -> [{ timestamp, targetId }] }
const actionTracker = new Map();
const TRACKING_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

function trackAction(guildId, userId, actionType, targetId = null) {
  const key = `${guildId}:${userId}`;
  if (!actionTracker.has(key)) actionTracker.set(key, {});
  const userActions = actionTracker.get(key);
  if (!userActions[actionType]) userActions[actionType] = [];

  const now = Date.now();
  // Clean old entries
  userActions[actionType] = userActions[actionType].filter(a => now - a.timestamp < TRACKING_WINDOW_MS);
  userActions[actionType].push({ timestamp: now, targetId });

  return userActions[actionType].length;
}

function getActionCount(guildId, userId, actionType) {
  const key = `${guildId}:${userId}`;
  const userActions = actionTracker.get(key);
  if (!userActions || !userActions[actionType]) return 0;
  const now = Date.now();
  return userActions[actionType].filter(a => now - a.timestamp < TRACKING_WINDOW_MS).length;
}

function isWhitelisted(guildId, userId) {
  const db = getSecurityDb(guildId);
  return db.whitelist.includes(userId);
}

function isAntinukeAdmin(guildId, userId) {
  const db = getSecurityDb(guildId);
  return db.admins.includes(userId);
}

async function logSecurityAction(guild, title, description, color = COLORS.error) {
  const db = getSecurityDb(guild.id);
  if (!db.logChannel) return;
  const channel = guild.channels.cache.get(db.logChannel);
  if (!channel) return;

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(color)
    .setTimestamp();

  await channel.send({ embeds: [embed] }).catch(() => {});
}

// ══════════════════════════════════════════════════════════
// PUNISHMENT HANDLER — strips ALL staff roles when triggered
// ══════════════════════════════════════════════════════════
async function applyPunishment(guild, member, reason, punishmentType = null) {
  const db = getSecurityDb(guild.id);
  const punishment = punishmentType || db.punishment || 'strip';
  const botMember = await guild.members.fetch(guild.client.user.id).catch(() => null);
  if (!botMember) return false;

  // Don't punish owner or whitelisted users
  if (member.id === guild.ownerId) return false;
  if (isWhitelisted(guild.id, member.id)) return false;

  // Don't punish if bot can't act on them
  if (member.roles.highest.position >= botMember.roles.highest.position) return false;

  let result = false;
  let details = '';

  try {
    switch (punishment) {
      case 'ban':
        await member.ban({ reason: `[AntiNuke] ${reason}` });
        result = true;
        details = 'banned';
        break;

      case 'kick':
        await member.kick(`[AntiNuke] ${reason}`);
        result = true;
        details = 'kicked';
        break;

      case 'strip':
      default:
        // STRIP ALL STAFF ROLES — the key change
        const removed = await stripAllStaffRoles(member, `[AntiNuke] ${reason}`);
        result = removed.length > 0;
        details = removed.length > 0
          ? `stripped of **${removed.length}** staff role(s): ${removed.join(', ')}`
          : 'no staff roles to strip';
        break;
    }
  } catch (err) {
    details = `failed: ${err.message}`;
  }

  if (result) {
    await logSecurityAction(
      guild,
      `🛡️ AntiNuke Triggered`,
      `**User:** ${member} (${member.id})\n` +
      `**Action:** ${reason}\n` +
      `**Punishment:** ${details}\n` +
      `**Type:** ${punishment}`,
      COLORS.error
    );
  }

  return result;
}

// ══════════════════════════════════════════════════════════
// ANTINUKE EVENT HANDLERS
// ══════════════════════════════════════════════════════════
async function checkAndPunish(guild, userId, actionType, reason) {
  const db = getSecurityDb(guild.id);
  if (!db.enabled) return false;

  const moduleConfig = db.modules[actionType];
  if (!moduleConfig || !moduleConfig.enabled) return false;

  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return false;

  // Owner and whitelisted are exempt
  if (member.id === guild.ownerId) return false;
  if (isWhitelisted(guild.id, member.id)) return false;

  const count = trackAction(guild.id, userId, actionType);
  const threshold = moduleConfig.threshold || 3;

  if (count >= threshold) {
    return await applyPunishment(guild, member, reason);
  }

  return false;
}

// ── Anti Ban ──
async function onGuildBanAdd(ban) {
  if (!ban.guild) return;
  const db = getSecurityDb(ban.guild.id);
  if (!db.enabled || !db.modules.ban?.enabled) return;

  // Fetch audit log to find who banned
  try {
    const auditLogs = await ban.guild.fetchAuditLogs({
      limit: 1,
      type: AuditLogEvent.MemberBanAdd,
    });
    const entry = auditLogs.entries.first();
    if (!entry || entry.target.id !== ban.user.id) return;
    if (Date.now() - entry.createdTimestamp > 5000) return; // Only recent

    await checkAndPunish(ban.guild, entry.executor.id, 'ban', `Mass ban (${entry.target.tag})`);
  } catch {}
}

// ── Anti Kick ──
async function onGuildMemberRemove(member) {
  if (!member.guild) return;
  const db = getSecurityDb(member.guild.id);
  if (!db.enabled || !db.modules.kick?.enabled) return;

  try {
    const auditLogs = await member.guild.fetchAuditLogs({
      limit: 1,
      type: AuditLogEvent.MemberKick,
    });
    const entry = auditLogs.entries.first();
    if (!entry || entry.target.id !== member.id) return;
    if (Date.now() - entry.createdTimestamp > 5000) return;

    await checkAndPunish(member.guild, entry.executor.id, 'kick', `Mass kick (${entry.target.tag})`);
  } catch {}
}

// ── Anti Role Delete ──
async function onRoleDelete(role) {
  if (!role.guild) return;
  const db = getSecurityDb(role.guild.id);
  if (!db.enabled || !db.modules.roleDelete?.enabled) return;

  try {
    const auditLogs = await role.guild.fetchAuditLogs({
      limit: 1,
      type: AuditLogEvent.RoleDelete,
    });
    const entry = auditLogs.entries.first();
    if (!entry || entry.target.id !== role.id) return;
    if (Date.now() - entry.createdTimestamp > 5000) return;

    await checkAndPunish(role.guild, entry.executor.id, 'roleDelete', `Role deletion (${role.name})`);
  } catch {}
}

// ── Anti Role Create ──
async function onRoleCreate(role) {
  if (!role.guild) return;
  const db = getSecurityDb(role.guild.id);
  if (!db.enabled || !db.modules.roleCreate?.enabled) return;

  try {
    const auditLogs = await role.guild.fetchAuditLogs({
      limit: 1,
      type: AuditLogEvent.RoleCreate,
    });
    const entry = auditLogs.entries.first();
    if (!entry || entry.target.id !== role.id) return;
    if (Date.now() - entry.createdTimestamp > 5000) return;

    await checkAndPunish(role.guild, entry.executor.id, 'roleCreate', `Role creation spam (${role.name})`);
  } catch {}
}

// ── Anti Channel Delete ──
async function onChannelDelete(channel) {
  if (!channel.guild) return;
  const db = getSecurityDb(channel.guild.id);
  if (!db.enabled || !db.modules.channelDelete?.enabled) return;

  try {
    const auditLogs = await channel.guild.fetchAuditLogs({
      limit: 1,
      type: AuditLogEvent.ChannelDelete,
    });
    const entry = auditLogs.entries.first();
    if (!entry || entry.target.id !== channel.id) return;
    if (Date.now() - entry.createdTimestamp > 5000) return;

    await checkAndPunish(channel.guild, entry.executor.id, 'channelDelete', `Channel deletion (${channel.name})`);
  } catch {}
}

// ── Anti Channel Create ──
async function onChannelCreate(channel) {
  if (!channel.guild) return;
  const db = getSecurityDb(channel.guild.id);
  if (!db.enabled || !db.modules.channelCreate?.enabled) return;

  try {
    const auditLogs = await channel.guild.fetchAuditLogs({
      limit: 1,
      type: AuditLogEvent.ChannelCreate,
    });
    const entry = auditLogs.entries.first();
    if (!entry || entry.target.id !== channel.id) return;
    if (Date.now() - entry.createdTimestamp > 5000) return;

    await checkAndPunish(channel.guild, entry.executor.id, 'channelCreate', `Channel creation spam (${channel.name})`);
  } catch {}
}

// ── Anti Emoji Delete ──
async function onEmojiDelete(emoji) {
  if (!emoji.guild) return;
  const db = getSecurityDb(emoji.guild.id);
  if (!db.enabled || !db.modules.emojiDelete?.enabled) return;

  try {
    const auditLogs = await emoji.guild.fetchAuditLogs({
      limit: 1,
      type: AuditLogEvent.EmojiDelete,
    });
    const entry = auditLogs.entries.first();
    if (!entry || entry.target.id !== emoji.id) return;
    if (Date.now() - entry.createdTimestamp > 5000) return;

    await checkAndPunish(emoji.guild, entry.executor.id, 'emojiDelete', `Emoji deletion (${emoji.name})`);
  } catch {}
}

// ── Anti Sticker Delete ──
async function onStickerDelete(sticker) {
  if (!sticker.guild) return;
  const db = getSecurityDb(sticker.guild.id);
  if (!db.enabled || !db.modules.stickerDelete?.enabled) return;

  try {
    const auditLogs = await sticker.guild.fetchAuditLogs({
      limit: 1,
      type: AuditLogEvent.StickerDelete,
    });
    const entry = auditLogs.entries.first();
    if (!entry || entry.target.id !== sticker.id) return;
    if (Date.now() - entry.createdTimestamp > 5000) return;

    await checkAndPunish(sticker.guild, entry.executor.id, 'stickerDelete', `Sticker deletion (${sticker.name})`);
  } catch {}
}

// ── Anti Webhook Create ──
async function onWebhookCreate(webhook) {
  if (!webhook.guild) return;
  const db = getSecurityDb(webhook.guild.id);
  if (!db.enabled || !db.modules.webhookCreate?.enabled) return;

  try {
    const auditLogs = await webhook.guild.fetchAuditLogs({
      limit: 1,
      type: AuditLogEvent.WebhookCreate,
    });
    const entry = auditLogs.entries.first();
    if (!entry || entry.target.id !== webhook.id) return;
    if (Date.now() - entry.createdTimestamp > 5000) return;

    await checkAndPunish(webhook.guild, entry.executor.id, 'webhookCreate', `Webhook creation (${webhook.name})`);
  } catch {}
}

// ── Anti Guild Update (vanity, icon, name, etc.) ──
async function onGuildUpdate(oldGuild, newGuild) {
  const db = getSecurityDb(newGuild.id);
  if (!db.enabled || !db.modules.guildUpdate?.enabled) return;

  try {
    const auditLogs = await newGuild.fetchAuditLogs({
      limit: 1,
      type: AuditLogEvent.GuildUpdate,
    });
    const entry = auditLogs.entries.first();
    if (!entry) return;
    if (Date.now() - entry.createdTimestamp > 5000) return;

    const changes = [];
    if (oldGuild.vanityURLCode !== newGuild.vanityURLCode) changes.push('vanity URL');
    if (oldGuild.name !== newGuild.name) changes.push('server name');
    if (oldGuild.icon !== newGuild.icon) changes.push('server icon');
    if (oldGuild.banner !== newGuild.banner) changes.push('server banner');

    if (changes.length) {
      await checkAndPunish(newGuild, entry.executor.id, 'guildUpdate', `Guild update (${changes.join(', ')})`);
    }
  } catch {}
}

// ── Anti Bot Add ──
async function onGuildMemberAdd(member) {
  if (!member.guild) return;
  if (!member.user.bot) return;

  const db = getSecurityDb(member.guild.id);
  if (!db.enabled || !db.modules.botAdd?.enabled) return;

  try {
    const auditLogs = await member.guild.fetchAuditLogs({
      limit: 1,
      type: AuditLogEvent.BotAdd,
    });
    const entry = auditLogs.entries.first();
    if (!entry || entry.target.id !== member.id) return;
    if (Date.now() - entry.createdTimestamp > 5000) return;

    await checkAndPunish(member.guild, entry.executor.id, 'botAdd', `Bot added (${member.user.tag})`);
  } catch {}
}

// ══════════════════════════════════════════════════════════
// ANTINUKE COMMANDS
// ══════════════════════════════════════════════════════════
async function handleAntinuke(ctx, args) {
  const guildId = ctx.guild.id;
  const db = getSecurityDb(guildId);
  const sub = args[0]?.toLowerCase();
  const isOwner = ctx.author?.id === ctx.guild.ownerId || ctx.user?.id === ctx.guild.ownerId;

  // Owner-only for config
  if (sub && ['toggle', 'punishment', 'threshold', 'logchannel', 'admin', 'whitelist'].includes(sub)) {
    if (!isOwner && !isAntinukeAdmin(guildId, ctx.author?.id || ctx.user?.id)) {
      return replyEmbed(ctx, errorEmbed('No Permission', 'Only the server owner or antinuke admins can configure this.'));
    }
  }

  if (!sub) {
    return replyEmbed(ctx, infoEmbed('AntiNuke',
      `**Status:** ${db.enabled ? '✅ Enabled' : '❌ Disabled'}\n` +
      `**Punishment:** ${db.punishment}\n` +
      `**Log Channel:** ${db.logChannel ? `<#${db.logChannel}>` : 'Not set'}\n\n` +
      '`antinuke toggle <on/off>` — enable/disable\n' +
      '`antinuke punishment <ban/kick/strip>` — set punishment\n' +
      '`antinuke <module> <on/off> [--threshold N]` — enable a module\n' +
      '`antinuke threshold <module> <N>` — set threshold\n' +
      '`antinuke logchannel <#channel>` — set log channel\n' +
      '`antinuke admin <@user>` — add/remove admin\n' +
      '`antinuke whitelist <@user>` — add/remove whitelist\n' +
      '`antinuke config` — view full config\n' +
      '`antinuke list` — view modules & whitelist'
    ));
  }

  if (sub === 'toggle') {
    const opt = args[1]?.toLowerCase();
    db.enabled = opt === 'on' || opt === 'true' || opt === 'yes';
    getGuildDb(guildId)._save();
    return replyEmbed(ctx, successEmbed('AntiNuke', `AntiNuke is now **${db.enabled ? 'enabled' : 'disabled'}**.`));
  }

  if (sub === 'punishment') {
    const p = args[1]?.toLowerCase();
    if (!['ban', 'kick', 'strip'].includes(p)) {
      return replyEmbed(ctx, errorEmbed('Invalid', 'Use: ban, kick, or strip.'));
    }
    db.punishment = p;
    getGuildDb(guildId)._save();
    return replyEmbed(ctx, successEmbed('Punishment Set', `Punishment set to **${p}**.`));
  }

  if (sub === 'logchannel') {
    const channel = ctx.guild.channels.cache.get(args[1]?.replace(/[<#>]/g, ''));
    if (!channel) return replyEmbed(ctx, errorEmbed('Invalid Channel', 'Mention a valid channel.'));
    db.logChannel = channel.id;
    getGuildDb(guildId)._save();
    return replyEmbed(ctx, successEmbed('Log Channel Set', `Logs will be sent to ${channel}.`));
  }

  if (sub === 'admin') {
    const member = await resolveMember(ctx, args[1]);
    if (!member) return replyEmbed(ctx, errorEmbed('Invalid User', 'Mention a valid member.'));
    if (db.admins.includes(member.id)) {
      db.admins = db.admins.filter(id => id !== member.id);
      getGuildDb(guildId)._save();
      return replyEmbed(ctx, successEmbed('Admin Removed', `${member} removed from antinuke admins.`));
    } else {
      db.admins.push(member.id);
      getGuildDb(guildId)._save();
      return replyEmbed(ctx, successEmbed('Admin Added', `${member} added as antinuke admin.`));
    }
  }

  if (sub === 'whitelist') {
    const member = await resolveMember(ctx, args[1]);
    if (!member) return replyEmbed(ctx, errorEmbed('Invalid User', 'Mention a valid member.'));
    if (db.whitelist.includes(member.id)) {
      db.whitelist = db.whitelist.filter(id => id !== member.id);
      getGuildDb(guildId)._save();
      return replyEmbed(ctx, successEmbed('Removed', `${member} removed from whitelist.`));
    } else {
      db.whitelist.push(member.id);
      getGuildDb(guildId)._save();
      return replyEmbed(ctx, successEmbed('Added', `${member} added to whitelist.`));
    }
  }

  if (sub === 'config') {
    const modules = Object.entries(db.modules).map(([name, cfg]) => {
      return `**${name}:** ${cfg.enabled ? '✅' : '❌'} (threshold: ${cfg.threshold}${cfg.command !== undefined ? `, command: ${cfg.command ? 'on' : 'off'}` : ''})`;
    }).join('\n');

    return replyEmbed(ctx, infoEmbed('AntiNuke Config',
      `**Enabled:** ${db.enabled ? 'Yes' : 'No'}\n` +
      `**Punishment:** ${db.punishment}\n` +
      `**Log Channel:** ${db.logChannel ? `<#${db.logChannel}>` : 'None'}\n\n` +
      `**Modules:**\n${modules}\n\n` +
      `**Admins:** ${db.admins.map(id => `<@${id}>`).join(', ') || 'None'}\n` +
      `**Whitelist:** ${db.whitelist.map(id => `<@${id}>`).join(', ') || 'None'}`
    ));
  }

  if (sub === 'list') {
    const enabled = Object.entries(db.modules).filter(([, cfg]) => cfg.enabled).map(([name]) => name);
    return replyEmbed(ctx, infoEmbed('AntiNuke List',
      `**Enabled Modules:** ${enabled.join(', ') || 'None'}\n\n` +
      `**Admins:** ${db.admins.map(id => `<@${id}>`).join(', ') || 'None'}\n` +
      `**Whitelist:** ${db.whitelist.map(id => `<@${id}>`).join(', ') || 'None'}`
    ));
  }

  // Module toggles: antinuke ban on --threshold 3
  if (db.modules[sub] !== undefined) {
    const opt = args[1]?.toLowerCase();
    const moduleConfig = db.modules[sub];

    if (opt === 'on' || opt === 'true' || opt === 'yes') {
      moduleConfig.enabled = true;

      // Parse --threshold flag
      const thresholdIdx = args.findIndex(a => a.toLowerCase() === '--threshold');
      if (thresholdIdx !== -1 && args[thresholdIdx + 1]) {
        const n = parseInt(args[thresholdIdx + 1]);
        if (!isNaN(n) && n > 0) moduleConfig.threshold = n;
      }

      // Parse --command flag
      const commandIdx = args.findIndex(a => a.toLowerCase() === '--command');
      if (commandIdx !== -1 && args[commandIdx + 1]) {
        moduleConfig.command = ['on', 'true', 'yes'].includes(args[commandIdx + 1].toLowerCase());
      }

      getGuildDb(guildId)._save();
      return replyEmbed(ctx, successEmbed('Module Enabled', `**${sub}** protection enabled (threshold: ${moduleConfig.threshold}).`));
    }

    if (opt === 'off' || opt === 'false' || opt === 'no') {
      moduleConfig.enabled = false;
      getGuildDb(guildId)._save();
      return replyEmbed(ctx, successEmbed('Module Disabled', `**${sub}** protection disabled.`));
    }

    return replyEmbed(ctx, errorEmbed('Invalid', `Usage: \`,antinuke ${sub} <on/off> [--threshold N]\``));
  }

  if (sub === 'threshold') {
    const moduleName = args[1]?.toLowerCase();
    const num = parseInt(args[2]);
    if (!db.modules[moduleName]) return replyEmbed(ctx, errorEmbed('Invalid Module', 'Module not found.'));
    if (isNaN(num) || num < 1) return replyEmbed(ctx, errorEmbed('Invalid Number', 'Provide a positive number.'));
    db.modules[moduleName].threshold = num;
    getGuildDb(guildId)._save();
    return replyEmbed(ctx, successEmbed('Threshold Set', `**${moduleName}** threshold set to **${num}**.`));
  }

  return replyEmbed(ctx, errorEmbed('Invalid Subcommand', 'Use `,antinuke` for help.'));
}

// ══════════════════════════════════════════════════════════
// ANTIRAID COMMANDS
// ══════════════════════════════════════════════════════════
function getAntiraidDb(guildId) {
  const db = getGuildDb(guildId);
  if (!db.data.antiraid) {
    db.data.antiraid = {
      enabled: false,
      mode: 'lockdown', // lockdown, captcha, verification
      joinThreshold: 10, // joins per minute
      accountAge: 0, // minimum account age in days (0 = off)
      action: 'kick', // kick, ban, mute
      duration: 0, // action duration in minutes (0 = permanent)
      whitelist: [],
    };
  }
  return db.data.antiraid;
}

const joinTracker = new Map(); // guildId -> [{ timestamp, memberId }]

async function handleAntiraid(ctx, args) {
  const guildId = ctx.guild.id;
  const db = getAntiraidDb(guildId);
  const sub = args[0]?.toLowerCase();

  if (!sub) {
    return replyEmbed(ctx, infoEmbed('AntiRaid',
      `**Status:** ${db.enabled ? '✅ Enabled' : '❌ Disabled'}\n` +
      `**Mode:** ${db.mode}\n` +
      `**Join Threshold:** ${db.joinThreshold}/min\n` +
      `**Account Age:** ${db.accountAge > 0 ? `${db.accountAge} days` : 'Off'}\n` +
      `**Action:** ${db.action}\n\n` +
      '`antiraid toggle <on/off>` — enable/disable\n' +
      '`antiraid mode <lockdown/captcha/verification>` — set mode\n' +
      '`antiraid threshold <N>` — joins per minute\n' +
      '`antiraid accountage <N>` — minimum account age in days\n' +
      '`antiraid action <kick/ban/mute>` — action on trigger\n' +
      '`antiraid whitelist <@user>` — whitelist a user\n' +
      '`antiraid config` — view config'
    ));
  }

  if (sub === 'toggle') {
    const opt = args[1]?.toLowerCase();
    db.enabled = opt === 'on' || opt === 'true' || opt === 'yes';
    getGuildDb(guildId)._save();
    return replyEmbed(ctx, successEmbed('AntiRaid', `AntiRaid is now **${db.enabled ? 'enabled' : 'disabled'}**.`));
  }

  if (sub === 'mode') {
    const mode = args[1]?.toLowerCase();
    if (!['lockdown', 'captcha', 'verification'].includes(mode)) {
      return replyEmbed(ctx, errorEmbed('Invalid Mode', 'Use: lockdown, captcha, or verification.'));
    }
    db.mode = mode;
    getGuildDb(guildId)._save();
    return replyEmbed(ctx, successEmbed('Mode Set', `AntiRaid mode set to **${mode}**.`));
  }

  if (sub === 'threshold') {
    const n = parseInt(args[1]);
    if (isNaN(n) || n < 1) return replyEmbed(ctx, errorEmbed('Invalid', 'Provide a positive number.'));
    db.joinThreshold = n;
    getGuildDb(guildId)._save();
    return replyEmbed(ctx, successEmbed('Threshold Set', `Join threshold set to **${n}** per minute.`));
  }

  if (sub === 'accountage') {
    const n = parseInt(args[1]);
    if (isNaN(n) || n < 0) return replyEmbed(ctx, errorEmbed('Invalid', 'Provide a number (0 = off).'));
    db.accountAge = n;
    getGuildDb(guildId)._save();
    return replyEmbed(ctx, successEmbed('Account Age Set', `Minimum account age set to **${n}** days.`));
  }

  if (sub === 'action') {
    const action = args[1]?.toLowerCase();
    if (!['kick', 'ban', 'mute'].includes(action)) {
      return replyEmbed(ctx, errorEmbed('Invalid Action', 'Use: kick, ban, or mute.'));
    }
    db.action = action;
    getGuildDb(guildId)._save();
    return replyEmbed(ctx, successEmbed('Action Set', `AntiRaid action set to **${action}**.`));
  }

  if (sub === 'whitelist') {
    const member = await resolveMember(ctx, args[1]);
    if (!member) return replyEmbed(ctx, errorEmbed('Invalid User', 'Mention a valid member.'));
    if (db.whitelist.includes(member.id)) {
      db.whitelist = db.whitelist.filter(id => id !== member.id);
      getGuildDb(guildId)._save();
      return replyEmbed(ctx, successEmbed('Removed', `${member} removed from whitelist.`));
    } else {
      db.whitelist.push(member.id);
      getGuildDb(guildId)._save();
      return replyEmbed(ctx, successEmbed('Added', `${member} added to whitelist.`));
    }
  }

  if (sub === 'config') {
    return replyEmbed(ctx, infoEmbed('AntiRaid Config',
      `**Enabled:** ${db.enabled ? 'Yes' : 'No'}\n` +
      `**Mode:** ${db.mode}\n` +
      `**Join Threshold:** ${db.joinThreshold}/min\n` +
      `**Account Age:** ${db.accountAge > 0 ? `${db.accountAge} days` : 'Off'}\n` +
      `**Action:** ${db.action}\n` +
      `**Whitelist:** ${db.whitelist.map(id => `<@${id}>`).join(', ') || 'None'}`
    ));
  }

  return replyEmbed(ctx, errorEmbed('Invalid Subcommand', 'Use `,antiraid` for help.'));
}

async function onAntiraidMemberAdd(member) {
  if (!member.guild) return;
  const db = getAntiraidDb(member.guild.id);
  if (!db.enabled) return;
  if (db.whitelist.includes(member.id)) return;

  // Account age check
  if (db.accountAge > 0) {
    const accountAgeDays = (Date.now() - member.user.createdTimestamp) / (1000 * 60 * 60 * 24);
    if (accountAgeDays < db.accountAge) {
      await applyRaidAction(member, db);
      return;
    }
  }

  // Join rate check
  const guildId = member.guild.id;
  if (!joinTracker.has(guildId)) joinTracker.set(guildId, []);
  const joins = joinTracker.get(guildId);
  const now = Date.now();
  joins.push({ timestamp: now, memberId: member.id });

  // Clean old entries (older than 1 minute)
  const oneMinuteAgo = now - 60000;
  const recentJoins = joins.filter(j => j.timestamp > oneMinuteAgo);
  joinTracker.set(guildId, recentJoins);

  if (recentJoins.length >= db.joinThreshold) {
    // Raid detected — apply action to recent joiners
    for (const join of recentJoins) {
      const m = await member.guild.members.fetch(join.memberId).catch(() => null);
      if (m) await applyRaidAction(m, db);
    }
  }
}

async function applyRaidAction(member, db) {
  try {
    switch (db.action) {
      case 'ban':
        await member.ban({ reason: '[AntiRaid] Raid protection' });
        break;
      case 'kick':
        await member.kick('[AntiRaid] Raid protection');
        break;
      case 'mute':
        // Timeout for 1 day
        await member.timeout(24 * 60 * 60 * 1000, '[AntiRaid] Raid protection');
        break;
    }
  } catch {}
}

// ══════════════════════════════════════════════════════════
// EXPORTS
// ══════════════════════════════════════════════════════════
module.exports = {
  // Commands
  handleAntinuke,
  handleAntiraid,
  // Event handlers
  onGuildBanAdd,
  onGuildMemberRemove,
  onRoleDelete,
  onRoleCreate,
  onChannelDelete,
  onChannelCreate,
  onEmojiDelete,
  onStickerDelete,
  onWebhookCreate,
  onGuildUpdate,
  onGuildMemberAdd,
  onAntiraidMemberAdd,
  // Helpers
  applyPunishment,
  isWhitelisted,
  isAntinukeAdmin,
  logSecurityAction,
  getSecurityDb,
};