const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, AuditLogEvent } = require('discord.js');
const { getGuildDb } = require('./database');
const { stripAllStaffRoles } = require('./staffExtras');

// ══════════════════════════════════════════════════════════
// CONSTANTS
// ══════════════════════════════════════════════════════════
const MODULES = ['kick', 'webhook', 'emoji', 'ban', 'channel', 'role', 'vanity', 'botadd'];
const MODULE_LABELS = {
  kick: 'Mass Member Kick',
  webhook: 'Webhook Creation',
  emoji: 'Emoji Deletion',
  ban: 'Mass Member Ban',
  channel: 'Channel Creation/Deletion',
  role: 'Role Deletion',
  vanity: 'Vanity Protection',
  botadd: 'Deny Bot Joins (botadd)'
};
const DANGEROUS_PERMS = [
  'administrator', 'ban_members', 'mention_everyone', 'kick_members',
  'moderate_members', 'manage_guild', 'manage_channels', 'manage_roles',
  'view_audit_log', 'manage_webhooks', 'manage_expressions', 'manage_nicknames'
];
const PERM_BITS = {
  administrator: PermissionFlagsBits.Administrator,
  ban_members: PermissionFlagsBits.BanMembers,
  mention_everyone: PermissionFlagsBits.MentionEveryone,
  kick_members: PermissionFlagsBits.KickMembers,
  moderate_members: PermissionFlagsBits.ModerateMembers,
  manage_guild: PermissionFlagsBits.ManageGuild,
  manage_channels: PermissionFlagsBits.ManageChannels,
  manage_roles: PermissionFlagsBits.ManageRoles,
  view_audit_log: PermissionFlagsBits.ViewAuditLog,
  manage_webhooks: PermissionFlagsBits.ManageWebhooks,
  manage_expressions: PermissionFlagsBits.ManageExpressions,
  manage_nicknames: PermissionFlagsBits.ManageNicknames,
};

// ══════════════════════════════════════════════════════════
// ACTION TRACKER (10-second window)
// ══════════════════════════════════════════════════════════
const actionTracker = new Map(); // key: guildId:userId:type -> { count, first, punished }

function getKey(guildId, userId, type) { return `${guildId}:${userId}:${type}`; }

function trackAction(guildId, userId, type, limit) {
  const key = getKey(guildId, userId, type);
  const now = Date.now();
  let entry = actionTracker.get(key);
  if (!entry) {
    entry = { count: 0, first: now, punished: false };
    actionTracker.set(key, entry);
  }
  if (now - entry.first > 10000) {
    entry.count = 1;
    entry.first = now;
    entry.punished = false;
  } else {
    entry.count++;
  }
  if (entry.count >= limit && !entry.punished) {
    entry.punished = true;
    return true;
  }
  return false;
}

// ══════════════════════════════════════════════════════════
// CONFIG HELPERS
// ══════════════════════════════════════════════════════════
function getAntinukeConfig(guildId) {
  const db = getGuildDb(guildId);
  return db.get('antinuke', {
    enabled: false,
    logChannel: null,
    admins: [],
    whitelist: [],
    modules: {},
    permWatch: {
      grant: [],
      remove: []
    },
    permWatchPunishment: 'strip'
  });
}

function saveAntinukeConfig(guildId, cfg) {
  const db = getGuildDb(guildId);
  db.set('antinuke', cfg);
}

function getModuleConfig(cfg, type) {
  const defaults = {
    kick: { enabled: false, threshold: 3, action: 'ban', command: false },
    webhook: { enabled: false, threshold: 3, action: 'ban', command: false },
    emoji: { enabled: false, threshold: 3, action: 'ban', command: false },
    ban: { enabled: false, threshold: 3, action: 'ban', command: false },
    channel: { enabled: false, threshold: 3, action: 'ban', command: false },
    role: { enabled: false, threshold: 3, action: 'ban', command: false },
    vanity: { enabled: false, action: 'ban' },
    botadd: { enabled: false }
  };
  return { ...defaults[type], ...(cfg.modules?.[type] || {}) };
}

// ══════════════════════════════════════════════════════════
// PERMISSION HELPERS
// ══════════════════════════════════════════════════════════
async function isOwnerOrAdmin(message) {
  const { isAdmin } = require('./helpers');
  if (isAdmin(message.member)) return true;
  const cfg = getAntinukeConfig(message.guild.id);
  if (cfg.admins?.includes(message.author.id)) return true;
  return false;
}

function isWhitelisted(cfg, userId, botId = null) {
  if (cfg.whitelist?.includes(userId)) return true;
  if (botId && cfg.whitelist?.includes(botId)) return true;
  return false;
}

// ══════════════════════════════════════════════════════════
// ROLE DELETE CHECK (for roles.js)
// ══════════════════════════════════════════════════════════
function isRoleDeleteAllowed(guildId, userId) {
  const cfg = getAntinukeConfig(guildId);
  if (!cfg.enabled) return true;
  const modCfg = getModuleConfig(cfg, 'role');
  if (!modCfg.enabled) return true;
  if (isWhitelisted(cfg, userId)) return true;
  return false;
}

// ══════════════════════════════════════════════════════════
// PUNISHMENT ENGINE
// ══════════════════════════════════════════════════════════
async function punish(guild, userId, action, type, logChannelId) {
  let success = false;
  let detail = '';
  try {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) {
      if (action === 'ban') {
        await guild.bans.create(userId, { reason: `AntiNuke: ${type}` }).catch(() => {});
        success = true; detail = 'banned';
      }
    } else {
      if (action === 'ban') {
        await guild.bans.create(userId, { reason: `AntiNuke: ${type}` }).catch(() => {});
        success = true; detail = 'banned';
      } else if (action === 'kick') {
        await member.kick(`AntiNuke: ${type}`).catch(() => {});
        success = true; detail = 'kicked';
      } else if (action === 'strip') {
        // Strip ALL staff roles (dangerous perms + configured staff roles)
        const removed = await stripAllStaffRoles(member, `AntiNuke: ${type}`);
        success = removed.length > 0;
        detail = success ? `stripped ${removed.length} staff role(s): ${removed.join(', ')}` : 'no staff roles to strip';
      }
    }
  } catch (err) {
    detail = err.message;
  }

  if (logChannelId) {
    const ch = guild.channels.cache.get(logChannelId);
    if (ch) {
      const embed = new EmbedBuilder()
        .setTitle('🛡️ AntiNuke Triggered')
        .setColor('#FF0000')
        .addFields(
          { name: 'Type', value: type, inline: true },
          { name: 'Executor', value: `<@${userId}> (${userId})`, inline: true },
          { name: 'Punishment', value: action, inline: true },
          { name: 'Result', value: success ? `✅ ${detail}` : '❌ Failed', inline: true }
        )
        .setTimestamp();
      await ch.send({ embeds: [embed] }).catch(() => {});
    }
  }

  try {
    const owner = await guild.fetchOwner().catch(() => null);
    if (owner) {
      await owner.send({
        embeds: [new EmbedBuilder()
          .setTitle('🛡️ AntiNuke Alert')
          .setDescription(`**${guild.name}** — AntiNuke triggered for **${type}**.
Executor: <@${userId}> (${userId})
Punishment: **${action}**
Result: ${success ? 'Success' : 'Failed'}`)
          .setColor('#FF0000')
          .setTimestamp()]
      }).catch(() => {});
    }
  } catch {}
}

// ══════════════════════════════════════════════════════════
// CORE TRIGGER HANDLER
// ══════════════════════════════════════════════════════════
async function handleAntiNukeTrigger(client, guild, type, executorId, targetBotId = null) {
  const cfg = getAntinukeConfig(guild.id);
  if (!cfg.enabled) return;
  if (!executorId || executorId === client.user.id) return;
  if (executorId === guild.ownerId) return;

  const modCfg = getModuleConfig(cfg, type);
  if (!modCfg.enabled) return;
  if (isWhitelisted(cfg, executorId, targetBotId)) return;

  if (type === 'botadd' && targetBotId) {
    const botMember = guild.members.cache.get(targetBotId) || await guild.members.fetch(targetBotId).catch(() => null);
    if (botMember && botMember.user.bot) {
      await botMember.kick('AntiNuke: botadd module').catch(() => {});
    }
    await punish(guild, executorId, 'ban', type, cfg.logChannel);
    return;
  }

  if (type === 'vanity') {
    await punish(guild, executorId, modCfg.action || 'ban', type, cfg.logChannel);
    return;
  }

  const limit = modCfg.threshold || 3;
  const triggered = trackAction(guild.id, executorId, type, limit);
  if (!triggered) return;

  // ── Webhook auto-delete ──
  if (type === 'webhook' && targetBotId) {
    try {
      const webhooks = await guild.fetchWebhooks();
      const wh = webhooks.get(targetBotId);
      if (wh) {
        await wh.delete('[AntiNuke] Auto-deleted malicious webhook');
      }
    } catch {}
  }

  // ── Antinuke logging to general log system ──
  try {
    const { onAntiNukeTrigger } = require('./logging');
    const member = await guild.members.fetch(executorId).catch(() => null);
    if (member) {
      await onAntiNukeTrigger(guild, type, member, modCfg.action || 'ban', `Triggered ${type} protection`);
    }
  } catch {}

  await punish(guild, executorId, modCfg.action || 'ban', type, cfg.logChannel);
}

// ══════════════════════════════════════════════════════════
// COMMAND DETECTION (called from index.js before moderation cmds)
// ══════════════════════════════════════════════════════════
async function trackCommandAction(message, commandType) {
  if (!message.guild) return;
  if (message.author.id === message.guild.ownerId) return;
  const cfg = getAntinukeConfig(message.guild.id);
  if (!cfg.enabled) return;
  if (isWhitelisted(cfg, message.author.id)) return;

  const typeMap = {
    ban: 'ban', kick: 'kick',
    softban: 'ban', hardban: 'ban', tempban: 'ban',
    mute: 'role', timeout: 'role', jail: 'role',
    // NOTE: 'role' command is intentionally excluded here.
    // The role antinuke module protects against ROLE CREATION/DELETION
    // (AuditLogEvent.RoleCreate / RoleDelete), not member-role assignments.
    // ,role add/remove/icon/color/etc. should NOT count toward the role threshold.
    // ,role delete is already protected by isRoleDeleteAllowed() in roles.js.
    lock: 'channel', unlock: 'channel', hide: 'channel', unhide: 'channel',
    lockdown: 'channel', nuke: 'channel', chanrename: 'channel', slowmode: 'channel',
    thread: 'channel'
  };
  const type = typeMap[commandType];
  if (!type) return;

  const modCfg = getModuleConfig(cfg, type);
  if (!modCfg.enabled) return;
  if (!modCfg.command) return;

  const limit = modCfg.threshold || 3;
  const triggered = trackAction(message.guild.id, message.author.id, type, limit);
  if (!triggered) return;

  await punish(message.guild, message.author.id, modCfg.action || 'ban', type, cfg.logChannel);
}

// ══════════════════════════════════════════════════════════
// FLAG PARSER (--threshold 3 --do ban --command on)
// ══════════════════════════════════════════════════════════
function parseFlags(args) {
  const flags = {};
  const remaining = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2).toLowerCase();
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      remaining.push(args[i]);
    }
  }
  return { flags, remaining };
}

// ══════════════════════════════════════════════════════════
// LIST BUILDER
// ══════════════════════════════════════════════════════════
function buildListEntries(cfg, guild) {
  const entries = [];
  for (let i = 0; i < MODULES.length; i++) {
    const mod = MODULES[i];
    const m = getModuleConfig(cfg, mod);
    if (!m.enabled) continue;
    let line = `${i + 1} **${mod}**`;
    if (mod !== 'vanity' && mod !== 'botadd') {
      line += ` (do: ${m.action}, threshold: ${m.threshold})`;
      if (mod !== 'channel' && mod !== 'emoji' && mod !== 'webhook') {
        line += ` [cmd: ${m.command ? 'on' : 'off'}]`;
      }
    } else if (mod === 'vanity') {
      line += ` (do: ${m.action}, threshold: N/A)`;
    }
    entries.push(line);
  }
  for (const id of (cfg.whitelist || [])) {
    const member = guild.members.cache.get(id);
    const user = member?.user || guild.client.users.cache.get(id);
    const name = user ? `${user.username}${user.discriminator && user.discriminator !== '0' ? `#${user.discriminator}` : ''}` : 'Unknown';
    const isBot = user?.bot || false;
    entries.push(`${entries.length + 1} ${name} whitelisted ( ${id} ) [ ${isBot ? 'BOT' : 'MEMBER'} ]`);
  }
  return entries;
}

// ══════════════════════════════════════════════════════════
// COMMAND HANDLER
// ══════════════════════════════════════════════════════════
async function handleAntiNukeCommand(message, args) {
  const { isAdmin } = require('./helpers');
  const cfg = getAntinukeConfig(message.guild.id);
  const sub = args[0]?.toLowerCase();

  // ── No sub / list ──
  if (!sub || sub === 'list') {
    return sendList(message);
  }

  // ── Config ──
  if (sub === 'config') {
    if (!await isOwnerOrAdmin(message)) {
      return message.reply({ embeds: [new EmbedBuilder().setDescription('❌ Only the server owner or antinuke admins can view the configuration.').setColor('#F04747')] });
    }
    return sendConfig(message);
  }

  // ── Admins ──
  if (sub === 'admins') {
    return sendAdminsList(message);
  }

  // ── Enable / Disable (owner or bot owner only) ──
  if (sub === 'enable') {
    if (!isAdmin(message.member)) {
      return message.reply({ embeds: [new EmbedBuilder().setDescription('❌ Only the server owner can enable antinuke.').setColor('#F04747')] });
    }
    cfg.enabled = true;
    saveAntinukeConfig(message.guild.id, cfg);
    return message.reply({ embeds: [new EmbedBuilder().setDescription('✅ Antinuke is now **enabled** in this server.').setColor('#43B581')] });
  }

  if (sub === 'disable') {
    if (!isAdmin(message.member)) {
      return message.reply({ embeds: [new EmbedBuilder().setDescription('❌ Only the server owner can disable antinuke.').setColor('#F04747')] });
    }
    cfg.enabled = false;
    saveAntinukeConfig(message.guild.id, cfg);
    return message.reply({ embeds: [new EmbedBuilder().setDescription('🔴 Antinuke is now **disabled** in this server.').setColor('#F04747')] });
  }

  // ── Admin management (owner / bot owner only) ──
  if (sub === 'admin') {
    if (!isAdmin(message.member)) {
      return message.reply({ embeds: [new EmbedBuilder().setDescription('❌ Only the server owner can manage antinuke admins.').setColor('#F04747')] });
    }
    const target = message.mentions.users.first();
    if (!target) return message.reply({ embeds: [new EmbedBuilder().setDescription('❌ Mention a user. Usage: `,antinuke admin @user`').setColor('#F04747')] });
    cfg.admins = cfg.admins || [];
    if (cfg.admins.includes(target.id)) {
      cfg.admins = cfg.admins.filter(id => id !== target.id);
      saveAntinukeConfig(message.guild.id, cfg);
      return message.reply({ embeds: [new EmbedBuilder().setDescription(`✅ <@${target.id}> is no longer an **antinuke admin** and can no longer edit antinuke settings.`).setColor('#43B581')] });
    } else {
      cfg.admins.push(target.id);
      saveAntinukeConfig(message.guild.id, cfg);
      return message.reply({ embeds: [new EmbedBuilder().setDescription(`✅ <@${target.id}> is now an **antinuke admin** and can edit antinuke settings.`).setColor('#43B581')] });
    }
  }

  // ── Whitelist (owner or antinuke admin) ──
  if (sub === 'whitelist') {
    if (!await isOwnerOrAdmin(message)) {
      return message.reply({ embeds: [new EmbedBuilder().setDescription('❌ Only the server owner or antinuke admins can manage the whitelist.').setColor('#F04747')] });
    }
    const target = message.mentions.users.first();
    if (!target) return message.reply({ embeds: [new EmbedBuilder().setDescription('❌ Mention a user. Usage: `,antinuke whitelist @user`').setColor('#F04747')] });
    cfg.whitelist = cfg.whitelist || [];
    if (cfg.whitelist.includes(target.id)) {
      cfg.whitelist = cfg.whitelist.filter(id => id !== target.id);
      saveAntinukeConfig(message.guild.id, cfg);
      return message.reply({ embeds: [new EmbedBuilder().setDescription(`✅ <@${target.id}> is no longer whitelisted.`).setColor('#43B581')] });
    } else {
      cfg.whitelist.push(target.id);
      saveAntinukeConfig(message.guild.id, cfg);
      return message.reply({ embeds: [new EmbedBuilder().setDescription(`✅ <@${target.id}> is now whitelisted and will not trigger antinuke.`).setColor('#43B581')] });
    }
  }

  // ── Log channel ──
  if (sub === 'log') {
    if (!await isOwnerOrAdmin(message)) {
      return message.reply({ embeds: [new EmbedBuilder().setDescription('❌ Only the server owner or antinuke admins can set the log channel.').setColor('#F04747')] });
    }
    const ch = message.mentions.channels.first();
    if (!ch) return message.reply({ embeds: [new EmbedBuilder().setDescription('❌ Mention a channel. Usage: `,antinuke log #channel`').setColor('#F04747')] });
    cfg.logChannel = ch.id;
    saveAntinukeConfig(message.guild.id, cfg);
    return message.reply({ embeds: [new EmbedBuilder().setDescription(`✅ Antinuke logs will be sent to <#${ch.id}>.`).setColor('#43B581')] });
  }

  // ── Permissions list / toggle / punishment ──
  if (sub === 'permissions') {
    const action = args[1]?.toLowerCase();

    // List mode
    if (action === 'list' || !action) {
      const grantList = cfg.permWatch?.grant || [];
      const removeList = cfg.permWatch?.remove || [];

      const grantLines = DANGEROUS_PERMS.map(p => `${grantList.includes(p) ? '🟢' : '🔴'} \`${p}\``);
      const removeLines = DANGEROUS_PERMS.map(p => `${removeList.includes(p) ? '🟢' : '🔴'} \`${p}\``);

      const embed = new EmbedBuilder()
        .setTitle('🛡️ Permission Watch Lists')
        .setColor('#2F3136')
        .addFields(
          { name: `Grant Watch (${grantList.length}/${DANGEROUS_PERMS.length})`, value: grantLines.join('\n'), inline: true },
          { name: `Remove Watch (${removeList.length}/${DANGEROUS_PERMS.length})`, value: removeLines.join('\n'), inline: true },
        )
        .addFields(
          { name: 'Punishment', value: `**${cfg.permWatchPunishment || 'strip'}**`, inline: false }
        )
        .setFooter({ text: 'Use ,antinuke permissions grant <perm> | remove <perm> | punishment <action>' });

      return message.reply({ embeds: [embed] });
    }

    // Punishment mode
    if (action === 'punishment') {
      if (!await isOwnerOrAdmin(message)) {
        return message.reply({ embeds: [new EmbedBuilder().setDescription('❌ Only the server owner or antinuke admins can manage permissions.').setColor('#F04747')] });
      }
      const punishment = args[2]?.toLowerCase();
      if (!punishment || !['ban', 'kick', 'strip'].includes(punishment)) {
        return message.reply({ embeds: [new EmbedBuilder().setDescription('❌ Invalid punishment. Use `ban`, `kick`, or `strip`.').setColor('#F04747')] });
      }
      cfg.permWatchPunishment = punishment;
      saveAntinukeConfig(message.guild.id, cfg);
      return message.reply({ embeds: [new EmbedBuilder().setDescription(`✅ Permission watch punishment set to **${punishment}**.`).setColor('#43B581')] });
    }

    // Grant / remove toggle mode
    if (!['grant', 'remove'].includes(action)) {
      return message.reply({ embeds: [new EmbedBuilder().setDescription('❌ Usage: `,antinuke permissions list` | `grant <perm>` | `remove <perm>` | `punishment <action>`').setColor('#F04747')] });
    }

    if (!await isOwnerOrAdmin(message)) {
      return message.reply({ embeds: [new EmbedBuilder().setDescription('❌ Only the server owner or antinuke admins can manage permissions.').setColor('#F04747')] });
    }

    const permName = args[2]?.toLowerCase();
    if (!permName || !DANGEROUS_PERMS.includes(permName)) {
      return message.reply({ embeds: [new EmbedBuilder().setDescription(`❌ Invalid permission. Available: ${DANGEROUS_PERMS.join(', ')}`).setColor('#F04747')] });
    }

    cfg.permWatch = cfg.permWatch || { grant: [], remove: [] };
    const list = cfg.permWatch[action] || [];

    if (list.includes(permName)) {
      cfg.permWatch[action] = list.filter(p => p !== permName);
      saveAntinukeConfig(message.guild.id, cfg);
      return message.reply({ embeds: [new EmbedBuilder().setDescription(`🔴 Removed **${permName}** from ${action} watch list.`).setColor('#F04747')] });
    } else {
      list.push(permName);
      cfg.permWatch[action] = list;
      saveAntinukeConfig(message.guild.id, cfg);
      return message.reply({ embeds: [new EmbedBuilder().setDescription(`🟢 Added **${permName}** to ${action} watch list.`).setColor('#43B581')] });
    }
  }

  // ── Module configuration ──
  if (MODULES.includes(sub)) {
    if (!await isOwnerOrAdmin(message)) {
      return message.reply({ embeds: [new EmbedBuilder().setDescription('❌ Only the server owner or antinuke admins can configure modules.').setColor('#F04747')] });
    }
    const { flags, remaining } = parseFlags(args.slice(1));
    const status = remaining[0]?.toLowerCase();

    if (status === 'off') {
      cfg.modules = cfg.modules || {};
      cfg.modules[sub] = { ...(cfg.modules[sub] || {}), enabled: false };
      saveAntinukeConfig(message.guild.id, cfg);
      return message.reply({ embeds: [new EmbedBuilder().setDescription(`🔴 Disabled **${sub}** antinuke module.`).setColor('#F04747')] });
    }

    if (status === 'on') {
      cfg.modules = cfg.modules || {};
      const existing = cfg.modules[sub] || {};
      const wasEnabled = existing.enabled;
      const threshold = parseInt(flags.threshold) || existing.threshold || 3;
      const action = flags.do || existing.action || 'ban';
      const command = flags.command === 'on' ? true : flags.command === 'off' ? false : (existing.command || false);

      cfg.modules[sub] = {
        enabled: true,
        threshold,
        action,
        ...(sub !== 'vanity' && sub !== 'botadd' ? { command } : {})
      };
      saveAntinukeConfig(message.guild.id, cfg);

      let desc = '';
      if (sub === 'vanity') {
        desc = `Enabled **vanity** antinuke module. Punishment is set to **${action}**.`;
      } else if (sub === 'botadd') {
        desc = `Enabled **botadd** antinuke module.`;
      } else if (sub === 'channel' || sub === 'emoji' || sub === 'webhook') {
        const verb = wasEnabled ? 'Updated' : 'Enabled';
        desc = `${verb} **${sub}** antinuke module. Punishment is set to **${action}** and threshold is set to **${threshold}**.`;
      } else {
        const verb = wasEnabled ? 'Updated' : 'Enabled';
        desc = `${verb} **${sub}** antinuke module. Punishment is set to **${action}**, threshold is set to **${threshold}** and command detection is **${command ? 'on' : 'off'}**.`;
      }
      return message.reply({ embeds: [new EmbedBuilder().setDescription(`✅ ${desc}`).setColor('#43B581')] });
    }

    return message.reply({ embeds: [new EmbedBuilder().setDescription(`❌ Usage: \`,antinuke ${sub} on\` or \`,antinuke ${sub} off\``).setColor('#F04747')] });
  }

  return message.reply({ embeds: [new EmbedBuilder().setDescription('❌ Unknown subcommand. Use `,antinuke list` to see available options.').setColor('#F04747')] });
}

// ══════════════════════════════════════════════════════════
// CONFIG EMBED
// ══════════════════════════════════════════════════════════
async function sendConfig(message) {
  const cfg = getAntinukeConfig(message.guild.id);
  const embed = new EmbedBuilder()
    .setAuthor({ name: message.author.username, iconURL: message.author.displayAvatarURL() })
    .setTitle('Settings')
    .setDescription(`Antinuke is **${cfg.enabled ? 'enabled' : 'disabled'}** in this server`)
    .setColor('#2F3136');

  const moduleLines = [];
  for (const mod of MODULES) {
    if (mod === 'botadd') continue;
    const m = getModuleConfig(cfg, mod);
    const label = MODULE_LABELS[mod];
    moduleLines.push(`${label}: ${m.enabled ? '<:checkmark:1528890895859056680>' : ''}`);
  }
  embed.addFields({ name: 'Modules', value: moduleLines.join('\n'), inline: true });

  const whitelistedBots = (cfg.whitelist || []).filter(id => {
    const m = message.guild.members.cache.get(id);
    return m?.user?.bot;
  }).length;
  const whitelistedMembers = (cfg.whitelist || []).length - whitelistedBots;

  embed.addFields({
    name: 'General',
    value:
      `Super Admins: ${(cfg.admins || []).length}
` +
      `Whitelisted Bots: ${whitelistedBots}
` +
      `Whitelisted Members: ${whitelistedMembers}
` +
      `Protection Modules: ${MODULES.filter(m => getModuleConfig(cfg, m).enabled).length} enabled
` +
      `Watch Permission Grant: ${(cfg.permWatch?.grant || []).length}/${DANGEROUS_PERMS.length} perms
` +
      `Watch Permission Remove: ${(cfg.permWatch?.remove || []).length}/${DANGEROUS_PERMS.length} perms
` +
      `Permission Punishment: ${cfg.permWatchPunishment || 'strip'}
` +
      `Deny Bot Joins (botadd): ${getModuleConfig(cfg, 'botadd').enabled ? '<:checkmark:1528890895859056680>' : ''}`,
    inline: true
  });

  await message.channel.send({ embeds: [embed] });
}

// ══════════════════════════════════════════════════════════
// LIST EMBED (paginated)
// ══════════════════════════════════════════════════════════
async function sendList(message) {
  const cfg = getAntinukeConfig(message.guild.id);
  let entries = buildListEntries(cfg, message.guild);
  const perPage = 10;
  let totalPages = Math.max(1, Math.ceil(entries.length / perPage));
  let currentPage = 1;

  async function render(pageNum) {
    currentPage = Math.min(Math.max(pageNum, 1), totalPages);
    const start = (currentPage - 1) * perPage;
    const pageEntries = entries.slice(start, start + perPage);
    const embed = new EmbedBuilder()
      .setAuthor({ name: message.author.username, iconURL: message.author.displayAvatarURL() })
      .setTitle('Antinuke modules & whitelist')
      .setDescription(pageEntries.join('\n') || 'No modules enabled and no whitelisted users.')
      .setColor('#2F3136')
      .setFooter({ text: `Page ${currentPage}/${totalPages} (${entries.length} entries)` });
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('an_list_prev').setEmoji('◀').setStyle(ButtonStyle.Primary).setDisabled(currentPage <= 1),
      new ButtonBuilder().setCustomId('an_list_next').setEmoji('▶').setStyle(ButtonStyle.Primary).setDisabled(currentPage >= totalPages),
      new ButtonBuilder().setCustomId('an_list_sort').setEmoji('↕️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('an_list_close').setEmoji('✖').setStyle(ButtonStyle.Danger)
    );
    return { embed, row };
  }

  const { embed, row } = await render(1);
  const msg = await message.channel.send({ embeds: [embed], components: [row] });

  const collector = msg.createMessageComponentCollector({ time: 120000 });
  collector.on('collect', async (i) => {
    if (i.user.id !== message.author.id) return i.reply({ content: '❌ This is not your menu.', ephemeral: true });
    if (i.customId === 'an_list_close') {
      await msg.delete().catch(() => {});
      return collector.stop();
    }
    if (i.customId === 'an_list_sort') {
      entries.reverse();
      totalPages = Math.max(1, Math.ceil(entries.length / perPage));
    }
    let newPage = currentPage;
    if (i.customId === 'an_list_prev') newPage = currentPage - 1;
    if (i.customId === 'an_list_next') newPage = currentPage + 1;
    const { embed: newEmbed, row: newRow } = await render(newPage);
    await i.update({ embeds: [newEmbed], components: [newRow] });
  });
}

// ══════════════════════════════════════════════════════════
// ADMINS LIST EMBED
// ══════════════════════════════════════════════════════════
async function sendAdminsList(message) {
  const cfg = getAntinukeConfig(message.guild.id);
  const admins = cfg.admins || [];
  const lines = [];
  for (let i = 0; i < admins.length; i++) {
    lines.push(`${i + 1} <@${admins[i]}>`);
  }
  const embed = new EmbedBuilder()
    .setAuthor({ name: message.author.username, iconURL: message.author.displayAvatarURL() })
    .setTitle('Antinuke admins')
    .setDescription(lines.join('\n') || 'No antinuke admins configured.')
    .setColor('#2F3136')
    .setFooter({ text: `Page 1/1 (${admins.length} entries)` });

  await message.channel.send({ embeds: [embed] });
}

// ══════════════════════════════════════════════════════════
// AUDIT LOG LISTENERS
// ══════════════════════════════════════════════════════════
async function setupAntiNukeListeners(client) {
  client.on('guildAuditLogEntryCreate', async (entry, guild) => {
    if (!guild) return;
    const executorId = entry.executorId;
    if (!executorId) return;

    // Bot add detection
    if (entry.action === AuditLogEvent.BotAdd) {
      const targetId = entry.targetId;
      await handleAntiNukeTrigger(client, guild, 'botadd', executorId, targetId);
      return;
    }

    // Vanity URL change
    if (entry.action === AuditLogEvent.GuildUpdate) {
      const changes = entry.changes || [];
      const vanityChange = changes.find(c => c.key === 'vanity_url_code');
      if (vanityChange) {
        await handleAntiNukeTrigger(client, guild, 'vanity', executorId);
      }
      return;
    }

    const typeMap = {
      [AuditLogEvent.ChannelCreate]: 'channel',
      [AuditLogEvent.ChannelDelete]: 'channel',
      [AuditLogEvent.RoleCreate]: 'role',
      [AuditLogEvent.RoleDelete]: 'role',
      [AuditLogEvent.MemberBanAdd]: 'ban',
      [AuditLogEvent.MemberKick]: 'kick',
      [AuditLogEvent.WebhookCreate]: 'webhook',
      [AuditLogEvent.EmojiCreate]: 'emoji',
      [AuditLogEvent.EmojiDelete]: 'emoji',
    };

    const type = typeMap[entry.action];
    if (type) await handleAntiNukeTrigger(client, guild, type, executorId);
  });

  // Permission grant/remove watch — immediate revert + punish
  client.on('guildAuditLogEntryCreate', async (entry, guild) => {
    if (!guild) return;
    const executorId = entry.executorId;
    if (!executorId || executorId === client.user.id || executorId === guild.ownerId) return;
    if (entry.action !== AuditLogEvent.RoleUpdate) return;

    const cfg = getAntinukeConfig(guild.id);
    if (!cfg.enabled) return;
    if (isWhitelisted(cfg, executorId)) return;

    const changes = entry.changes || [];
    const permChange = changes.find(c => c.key === 'permissions');
    if (!permChange) return;

    const oldPerms = BigInt(permChange.old || 0);
    const newPerms = BigInt(permChange.new || 0);
    const added = newPerms & ~oldPerms;
    const removed = oldPerms & ~newPerms;

    const grantWatch = cfg.permWatch?.grant || [];
    const removeWatch = cfg.permWatch?.remove || [];

    let triggeredPerm = null;
    let triggeredAction = null;

    for (const permName of grantWatch) {
      const bit = PERM_BITS[permName];
      if (bit && (added & bit) === bit) { triggeredPerm = permName; triggeredAction = 'grant'; break; }
    }
    if (!triggeredPerm) {
      for (const permName of removeWatch) {
        const bit = PERM_BITS[permName];
        if (bit && (removed & bit) === bit) { triggeredPerm = permName; triggeredAction = 'remove'; break; }
      }
    }

    if (triggeredPerm) {
      // Revert the permission change immediately
      try {
        const role = await guild.roles.fetch(entry.targetId);
        if (role) {
          await role.setPermissions(oldPerms, `AntiNuke: reverted ${triggeredAction} of ${triggeredPerm}`);
        }
      } catch {}

      // Punish immediately on first offense (no threshold)
      await punish(guild, executorId, cfg.permWatchPunishment || 'strip', `permissions (${triggeredAction} ${triggeredPerm})`, cfg.logChannel);

      // Log to general logging system
      try {
        const { onAntiNukeTrigger } = require('./logging');
        const member = await guild.members.fetch(executorId).catch(() => null);
        if (member) {
          await onAntiNukeTrigger(guild, 'antinuke', member, cfg.permWatchPunishment || 'strip', `Reverted ${triggeredAction} of ${triggeredPerm} on <@&${entry.targetId}>`);
        }
      } catch {}
    }
  });
}

module.exports = {
  handleAntiNukeCommand,
  setupAntiNukeListeners,
  trackCommandAction,
  getAntinukeConfig,
  getModuleConfig,
  isWhitelisted,
  isRoleDeleteAllowed
};