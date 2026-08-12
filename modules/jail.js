// Jail system — strips roles, assigns jail role, auto-releases
const { EmbedBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { getGuildDb } = require('./database');
const { COLORS, base } = require('../utils/embeds');
const { createCase, sendModLog, parseDuration, formatDuration } = require('./cases');
const { buildInvokeVars, sendInvokeReply, formatTimeLeft } = require('./helpers');
const { chunk, sendPaginated } = require('../utils/paginator');

const JAIL_TIMERS = new Map(); // `guildId:userId` -> timer

// ══════════════════════════════════════════════════════════
// SETUP CHECKER
// ══════════════════════════════════════════════════════════

function isJailSetup(guild) {
  const db = getGuildDb(guild.id);
  const cfg = db.get('jailConfig', {});
  return cfg.roleId && guild.roles.cache.has(cfg.roleId);
}

// ══════════════════════════════════════════════════════════
// SETUP JAIL ROLE & CHANNEL
// ══════════════════════════════════════════════════════════

async function setupJail(guild) {
  const db = getGuildDb(guild.id);
  const cfg = db.get('jailConfig', {});

  if (cfg.roleId && guild.roles.cache.has(cfg.roleId)) return cfg.roleId;

  // Create jail role
  const role = await guild.roles.create({
    name: 'jailed', color: '#FFFFFF', permissions: [],
    reason: 'Jail system setup',
  });

  // Deny access to all channels
  for (const [, ch] of guild.channels.cache) {
    if (ch.type === ChannelType.GuildText || ch.type === ChannelType.GuildAnnouncement || ch.type === ChannelType.GuildVoice || ch.type === ChannelType.GuildForum || ch.type === ChannelType.GuildStageVoice) {
      await ch.permissionOverwrites.edit(role, { ViewChannel: false }).catch(() => {});
    }
    if (ch.type === ChannelType.GuildCategory) {
      await ch.permissionOverwrites.edit(role, { ViewChannel: false }).catch(() => {});
    }
  }

  // Jail channel (create if not exists)
  let jailCh = null;
  if (cfg.jailChannelId) {
    jailCh = guild.channels.cache.get(cfg.jailChannelId);
  }

  if (!jailCh) {
    // Find or create a jail channel
    const modCat = guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name.toLowerCase().includes('moderation'));
    jailCh = await guild.channels.create({
      name: 'jail',
      type: ChannelType.GuildText,
      parent: modCat?.id || null,
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: role.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AttachFiles] },
      ],
      reason: 'Jail system setup',
    }).catch(() => null);

    if (jailCh) cfg.jailChannelId = jailCh.id;
  }

  if (jailCh) {
    await jailCh.permissionOverwrites.edit(role, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
      EmbedLinks: true,
      AttachFiles: true,
    }).catch(() => {});
  }

  cfg.roleId = role.id;
  db.set('jailConfig', cfg);
  return role.id;
}

// ══════════════════════════════════════════════════════════
// APPLY JAIL PERMS TO NEW CHANNEL
// ══════════════════════════════════════════════════════════

async function applyJailPermsToNewChannel(channel) {
  const guild = channel.guild;
  const db = getGuildDb(guild.id);
  const cfg = db.get('jailConfig', {});

  if (!cfg.roleId || !guild.roles.cache.has(cfg.roleId)) return;

  // Jail role can't see new channels
  if (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement ||
      channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildForum ||
      channel.type === ChannelType.GuildStageVoice) {
    await channel.permissionOverwrites.edit(cfg.roleId, { ViewChannel: false }).catch(() => {});
  }

  // But CAN see jail channel
  if (cfg.jailChannelId && channel.id === cfg.jailChannelId) {
    await channel.permissionOverwrites.edit(cfg.roleId, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
      EmbedLinks: true,
      AttachFiles: true,
    }).catch(() => {});
  }
}

// ══════════════════════════════════════════════════════════
// JAIL / UNJAIL MEMBER
// ══════════════════════════════════════════════════════════

async function jailMember(guild, member, reason, duration, executorId, client) {
  const db = getGuildDb(guild.id);
  const cfg = db.get('jailConfig', {});
  const roleId = cfg.roleId || await setupJail(guild);

  // Save current roles (excluding @everyone and jail role)
  const savedRoles = member.roles.cache
    .filter(r => r.id !== guild.roles.everyone.id && r.id !== roleId)
    .map(r => r.id);

  // Store in DB
  const jailed = db.get('jailed', {});
  jailed[member.id] = {
    userId: member.id, savedRoles, reason, by: executorId,
    at: Date.now(), expires: duration ? Date.now() + duration : null,
  };
  db.set('jailed', jailed);

  // Remove all roles, add jail role
  await member.roles.set([guild.roles.everyone.id, roleId]).catch(() => {});

  const c = createCase(guild.id, {
    type: 'jail', targetId: member.id, executorId, reason,
    duration: duration ? formatDuration(duration) : 'Permanent',
    expires: duration ? Date.now() + duration : null,
  });

  // Schedule auto-release
  if (duration) scheduleRelease(guild, member.id, duration, client);

  return c;
}

async function unjailMember(guild, memberId, reason, executorId, client) {
  const db = getGuildDb(guild.id);
  const jailed = db.get('jailed', {});
  const entry = jailed[memberId];
  if (!entry) return null;

  const member = await guild.members.fetch(memberId).catch(() => null);
  if (member) {
    const rolesToRestore = (entry.savedRoles || []).filter(id => guild.roles.cache.has(id));
    await member.roles.set([guild.roles.everyone.id, ...rolesToRestore]).catch(() => {});
  }

  delete jailed[memberId];
  db.set('jailed', jailed);

  // Cancel timer
  const key = `${guild.id}:${memberId}`;
  if (JAIL_TIMERS.has(key)) { clearTimeout(JAIL_TIMERS.get(key)); JAIL_TIMERS.delete(key); }

  createCase(guild.id, { type: 'unjail', targetId: memberId, executorId, reason: reason || 'Released from jail' });
  return true;
}

function scheduleRelease(guild, userId, ms, client) {
  const key = `${guild.id}:${userId}`;
  if (JAIL_TIMERS.has(key)) clearTimeout(JAIL_TIMERS.get(key));
  const timer = setTimeout(async () => {
    JAIL_TIMERS.delete(key);
    await unjailMember(guild, userId, 'Auto-released (time served)', guild.client?.user?.id || 'system', client);
    const db = getGuildDb(guild.id);
    const cfg = db.get('jailConfig', {});
    if (cfg.jailChannelId) {
      const ch = guild.channels.cache.get(cfg.jailChannelId);
      if (ch) await ch.send(`🔓 <@${userId}> has been released from jail.`).catch(() => {});
    }
  }, ms);
  JAIL_TIMERS.set(key, timer);
}

// ══════════════════════════════════════════════════════════
// HANDLERS
// ══════════════════════════════════════════════════════════

async function handleJail(ctx, args, client) {
  const { isStaffOrAdmin } = require('./helpers');
  if (!isStaffOrAdmin(ctx.member)) return ctx.reply({ content: '❌ No permission.', ephemeral: true });
  if (!isJailSetup(ctx.guild)) return ctx.reply({ content: '❌ The jail system is not set up. Use `.jail setup` or `.setupjail` to set it up.', ephemeral: true });

  const target = ctx.mentions?.members?.first();
  if (!target) return ctx.reply({ content: '❌ Mention a user.', ephemeral: true });
  if (target.id === ctx.author?.id || target.id === ctx.user?.id) return ctx.reply({ content: '❌ You cannot jail yourself.', ephemeral: true });

  const db = getGuildDb(ctx.guild.id);
  const jailed = db.get('jailed', {});
  if (jailed[target.id]) return ctx.reply({ content: `❌ **${target.user.username}** is already jailed.`, ephemeral: true });

  // Parse optional duration and reason: .jail @user [duration] [reason]
  let durationStr = null, reason = 'No reason provided';
  if (args[1]) {
    const maybeMs = parseDuration(args[1]);
    if (maybeMs) { durationStr = args[1]; reason = args.slice(2).join(' ') || reason; }
    else { reason = args.slice(1).join(' '); }
  }
  const durationMs = durationStr ? parseDuration(durationStr) : null;
  const authorId = ctx.author?.id || ctx.user?.id;

  const c = await jailMember(ctx.guild, target, reason, durationMs, authorId, client);

  // Invoke DM
  try {
    const { sendInvokeDm } = require('./invoke');
    const vars = buildInvokeVars(ctx, target, reason, durationStr, c.id);
    await sendInvokeDm(target.user, ctx.guild.id, 'jail', vars);
  } catch {}

  // Invoke reply
  try {
    return sendInvokeReply(ctx, ctx.guild.id, 'jail', target, reason, durationStr, c.id);
  } catch {
    const timeText = durationStr ? ` for **${durationStr}**` : '';
    return ctx.reply(`${target} is jailed${timeText}`);
  }
}

async function handleUnjail(ctx, args, client) {
  const { isStaffOrAdmin } = require('./helpers');
  if (!isStaffOrAdmin(ctx.member)) return ctx.reply({ content: '❌ No permission.', ephemeral: true });
  if (!isJailSetup(ctx.guild)) return ctx.reply({ content: '❌ The jail system is not set up. Use `.jail setup` or `.setupjail` to set it up.', ephemeral: true });

  const target = ctx.mentions?.members?.first() || ctx.mentions?.users?.first();
  if (!target) return ctx.reply({ content: '❌ Mention a user.', ephemeral: true });
  const authorId = ctx.author?.id || ctx.user?.id;
  const reason = args.slice(1).join(' ') || 'Released by staff';
  const result = await unjailMember(ctx.guild, target.id, reason, authorId, client);
  if (!result) return ctx.reply({ content: `❌ **${target.user?.username || target.username}** is not jailed.`, ephemeral: true });

  // Invoke DM
  try {
    const { sendInvokeDm } = require('./invoke');
    const vars = buildInvokeVars(ctx, target, reason, null, null);
    await sendInvokeDm(target.user || target, ctx.guild.id, 'unjail', vars);
  } catch {}

  // Invoke reply
  try {
    return sendInvokeReply(ctx, ctx.guild.id, 'unjail', target, reason, null, null);
  } catch {
    const embed = base(COLORS.success).setTitle('🔓 Member Released from Jail')
      .addFields(
        { name: '👤 User', value: `<@${target.id}>`, inline: true },
        { name: '👮 Moderator', value: `<@${authorId}>`, inline: true },
        { name: '📝 Reason', value: reason },
      );
    await sendModLog(ctx.guild, embed);
    return ctx.reply({ embeds: [embed] });
  }
}

async function handleJailList(ctx) {
  const { isStaffOrAdmin } = require('./helpers');
  if (!isStaffOrAdmin(ctx.member)) return ctx.reply({ content: '❌ No permission.', ephemeral: true });

  const db = getGuildDb(ctx.guild.id);
  const jailed = db.get('jailed', {});
  const entries = Object.values(jailed);

  if (!entries.length) {
    return ctx.reply({ content: '✅ No members currently jailed.' });
  }

  const lines = entries.map((e, i) => {
    const member = ctx.guild.members.cache.get(e.userId);
    const username = member?.user?.username || 'Unknown';
    const left = e.expires ? formatTimeLeft(e.expires - Date.now()) : 'Permanent';
    const mod = e.by ? `<@${e.by}>` : 'Unknown';
    const reason = e.reason || 'No reason';
    return `${i + 1}- ${username} - jailed (${left}) - mod: ${mod} - reason: ${reason}`;
  });

  const pages = chunk(lines, 5).map((page, idx) => ({
    title: `🏛️ Jailed Members [${entries.length}]`,
    description: page.join('\n'),
    color: COLORS.primary,
  }));

  return sendPaginated(ctx.channel || ctx, pages, ctx.author?.id || ctx.user?.id);
}

async function handleJailSetup(ctx, args) {
  if (!ctx.member.permissions.has(PermissionFlagsBits.ManageGuild) || !ctx.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
    return ctx.reply({ content: '❌ You need **Manage Server** and **Manage Channels** permissions to set up the jail system.', ephemeral: true });
  }

  const db = getGuildDb(ctx.guild.id);
  const cfg = db.get('jailConfig', {});

  if (args[0] === 'channel') {
    const ch = ctx.mentions?.channels?.first();
    if (!ch) return ctx.reply({ content: '❌ Mention a channel.' });
    cfg.jailChannelId = ch.id;
    db.set('jailConfig', cfg);

    // Apply jail role perms to this channel
    if (cfg.roleId && ctx.guild.roles.cache.has(cfg.roleId)) {
      await ch.permissionOverwrites.edit(cfg.roleId, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true,
        EmbedLinks: true,
        AttachFiles: true,
      }).catch(() => {});
    }

    return ctx.reply({ content: `✅ Jail channel set to <#${ch.id}>.` });
  }

  const roleId = await setupJail(ctx.guild);
  return ctx.reply({
    embeds: [base(COLORS.success).setTitle('🏛️ Jail System Set Up')
      .setDescription(`Jail role: <@&${roleId}> (\`${roleId}\`)\n\nAll channels deny the Jailed role. Only the jail channel allows it.`)
      .addFields(
        { name: 'Setup', value: 'Use `.jail setup channel #channel` to set a custom jail channel.', inline: false }
      )]
  });
}

// Restore jail timers on bot restart
async function restoreJailTimers(client) {
  for (const guild of client.guilds.cache.values()) {
    const jailed = getGuildDb(guild.id).get('jailed', {});
    for (const [uid, entry] of Object.entries(jailed)) {
      if (entry.expires && entry.expires > Date.now()) {
        const remaining = entry.expires - Date.now();
        scheduleRelease(guild, uid, remaining, client);
      } else if (entry.expires && entry.expires <= Date.now()) {
        await unjailMember(guild, uid, 'Auto-released (time served)', 'system', client).catch(() => {});
      }
    }
  }
}

module.exports = { handleJail, handleUnjail, handleJailList, handleJailSetup, restoreJailTimers, applyJailPermsToNewChannel };