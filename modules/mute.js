// Mute system (role-based) + image/reaction mute variants
const { EmbedBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { getGuildDb } = require('./database');
const { COLORS, base } = require('../utils/embeds');
const { createCase, sendModLog, parseDuration, formatDuration } = require('./cases');

const MUTE_TIMERS = new Map();
const IMUTE_TIMERS = new Map();
const RMUTE_TIMERS = new Map();

// ══════════════════════════════════════════════════════════
// SETUP CHECKERS
// ══════════════════════════════════════════════════════════

function isMuteSetup(guild) {
  const db = getGuildDb(guild.id);
  const cfg = db.get('muteConfig', {});
  return cfg.roleId && guild.roles.cache.has(cfg.roleId);
}

function isIMuteSetup(guild) {
  const db = getGuildDb(guild.id);
  const cfg = db.get('imuteConfig', {});
  return cfg.roleId && guild.roles.cache.has(cfg.roleId);
}

function isRMuteSetup(guild) {
  const db = getGuildDb(guild.id);
  const cfg = db.get('rmuteConfig', {});
  return cfg.roleId && guild.roles.cache.has(cfg.roleId);
}

// ══════════════════════════════════════════════════════════
// ROLE HELPERS
// ══════════════════════════════════════════════════════════

async function getOrCreateMuteRole(guild) {
  const db = getGuildDb(guild.id);
  const cfg = db.get('muteConfig', {});
  if (cfg.roleId && guild.roles.cache.has(cfg.roleId)) return cfg.roleId;

  const role = await guild.roles.create({
    name: 'muted', color: '#FFFFFF', permissions: [],
    reason: 'Mute system setup',
  });

  await applyMuteRolePerms(guild, role.id);

  cfg.roleId = role.id;
  db.set('muteConfig', cfg);
  return role.id;
}

async function getOrCreateImageMuteRole(guild) {
  const db = getGuildDb(guild.id);
  const cfg = db.get('imuteConfig', {});
  if (cfg.roleId && guild.roles.cache.has(cfg.roleId)) return cfg.roleId;

  const role = await guild.roles.create({
    name: 'imuted', color: '#FFFFFF', permissions: [],
    reason: 'Image mute system setup',
  });

  await applyImageMuteRolePerms(guild, role.id);

  cfg.roleId = role.id;
  db.set('imuteConfig', cfg);
  return role.id;
}

async function getOrCreateReactionMuteRole(guild) {
  const db = getGuildDb(guild.id);
  const cfg = db.get('rmuteConfig', {});
  if (cfg.roleId && guild.roles.cache.has(cfg.roleId)) return cfg.roleId;

  const role = await guild.roles.create({
    name: 'rmuted', color: '#FFFFFF', permissions: [],
    reason: 'Reaction mute system setup',
  });

  await applyReactionMuteRolePerms(guild, role.id);

  cfg.roleId = role.id;
  db.set('rmuteConfig', cfg);
  return role.id;
}

// ══════════════════════════════════════════════════════════
// CHANNEL PERMISSION HELPERS
// ══════════════════════════════════════════════════════════

async function applyMuteRolePerms(guild, roleId) {
  for (const [, ch] of guild.channels.cache) {
    if (ch.type === ChannelType.GuildText || ch.type === ChannelType.GuildAnnouncement) {
      await ch.permissionOverwrites.edit(roleId, {
        SendMessages: false,
        AddReactions: false,
        CreatePublicThreads: false,
        CreatePrivateThreads: false,
        SendMessagesInThreads: false,
      }).catch(() => {});
    }
    if (ch.type === ChannelType.GuildVoice || ch.type === ChannelType.GuildStageVoice) {
      await ch.permissionOverwrites.edit(roleId, {
        Speak: false,
        Stream: false,
        UseSoundboard: false,
      }).catch(() => {});
    }
    if (ch.type === ChannelType.GuildForum) {
      await ch.permissionOverwrites.edit(roleId, {
        SendMessages: false,
        SendMessagesInThreads: false,
      }).catch(() => {});
    }
  }
}

async function applyImageMuteRolePerms(guild, roleId) {
  for (const [, ch] of guild.channels.cache) {
    if (ch.type === ChannelType.GuildText || ch.type === ChannelType.GuildAnnouncement || ch.type === ChannelType.GuildForum) {
      await ch.permissionOverwrites.edit(roleId, {
        AttachFiles: false,
        EmbedLinks: false,
      }).catch(() => {});
    }
  }
}

async function applyReactionMuteRolePerms(guild, roleId) {
  for (const [, ch] of guild.channels.cache) {
    if (ch.type === ChannelType.GuildText || ch.type === ChannelType.GuildAnnouncement || ch.type === ChannelType.GuildForum) {
      await ch.permissionOverwrites.edit(roleId, {
        AddReactions: false,
        UseExternalEmojis: false,
        UseExternalStickers: false,
      }).catch(() => {});
    }
  }
}

// ══════════════════════════════════════════════════════════
// NEW CHANNEL AUTO-APPLY (called from index.js on channelCreate)
// ══════════════════════════════════════════════════════════
async function applyMutePermsToNewChannel(channel) {
  const guild = channel.guild;
  const db = getGuildDb(guild.id);

  // Muted role
  const muteCfg = db.get('muteConfig', {});
  if (muteCfg.roleId && guild.roles.cache.has(muteCfg.roleId)) {
    if (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement) {
      await channel.permissionOverwrites.edit(muteCfg.roleId, {
        SendMessages: false,
        AddReactions: false,
        CreatePublicThreads: false,
        CreatePrivateThreads: false,
        SendMessagesInThreads: false,
      }).catch(() => {});
    }
    if (channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice) {
      await channel.permissionOverwrites.edit(muteCfg.roleId, {
        Speak: false,
        Stream: false,
        UseSoundboard: false,
      }).catch(() => {});
    }
    if (channel.type === ChannelType.GuildForum) {
      await channel.permissionOverwrites.edit(muteCfg.roleId, {
        SendMessages: false,
        SendMessagesInThreads: false,
      }).catch(() => {});
    }
  }

  // Image Muted role
  const imuteCfg = db.get('imuteConfig', {});
  if (imuteCfg.roleId && guild.roles.cache.has(imuteCfg.roleId)) {
    if (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement || channel.type === ChannelType.GuildForum) {
      await channel.permissionOverwrites.edit(imuteCfg.roleId, {
        AttachFiles: false,
        EmbedLinks: false,
      }).catch(() => {});
    }
  }

  // Reaction Muted role
  const rmuteCfg = db.get('rmuteConfig', {});
  if (rmuteCfg.roleId && guild.roles.cache.has(rmuteCfg.roleId)) {
    if (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement || channel.type === ChannelType.GuildForum) {
      await channel.permissionOverwrites.edit(rmuteCfg.roleId, {
        AddReactions: false,
        UseExternalEmojis: false,
        UseExternalStickers: false,
      }).catch(() => {});
    }
  }
}

// ══════════════════════════════════════════════════════════
// MUTE / UNMUTE
// ══════════════════════════════════════════════════════════

async function muteMember(guild, member, reason, duration, executorId) {
  const roleId = await getOrCreateMuteRole(guild);
  await member.roles.add(roleId, reason);

  const c = createCase(guild.id, {
    type: 'mute', targetId: member.id, executorId, reason,
    duration: duration ? formatDuration(duration) : 'Permanent',
    expires: duration ? Date.now() + duration : null,
  });

  if (duration) scheduleMuteRelease(guild, member.id, duration);
  return c;
}

async function unmuteMember(guild, memberId, reason, executorId) {
  const db = getGuildDb(guild.id);
  const cfg = db.get('muteConfig', {});
  if (!cfg.roleId) return null;
  const member = await guild.members.fetch(memberId).catch(() => null);
  if (!member) return null;
  await member.roles.remove(cfg.roleId, reason).catch(() => {});
  const key = `${guild.id}:${memberId}`;
  if (MUTE_TIMERS.has(key)) { clearTimeout(MUTE_TIMERS.get(key)); MUTE_TIMERS.delete(key); }
  createCase(guild.id, { type: 'unmute', targetId: memberId, executorId, reason: reason || 'Unmuted by staff' });
  return true;
}

function scheduleMuteRelease(guild, userId, ms) {
  const key = `${guild.id}:${userId}`;
  if (MUTE_TIMERS.has(key)) clearTimeout(MUTE_TIMERS.get(key));
  const timer = setTimeout(async () => {
    MUTE_TIMERS.delete(key);
    await unmuteMember(guild, userId, 'Auto-unmuted (time expired)', guild.client?.user?.id || 'system');
  }, ms);
  MUTE_TIMERS.set(key, timer);
}

// ══════════════════════════════════════════════════════════
// IMAGE MUTE / UNMUTE (with duration)
// ══════════════════════════════════════════════════════════

async function imuteMember(guild, member, reason, duration, executorId) {
  const roleId = await getOrCreateImageMuteRole(guild);
  await member.roles.add(roleId, reason);

  const c = createCase(guild.id, {
    type: 'imute', targetId: member.id, executorId, reason,
    duration: duration ? formatDuration(duration) : 'Permanent',
    expires: duration ? Date.now() + duration : null,
  });

  if (duration) scheduleIMuteRelease(guild, member.id, duration);
  return c;
}

async function unimuteMember(guild, memberId, reason, executorId) {
  const db = getGuildDb(guild.id);
  const cfg = db.get('imuteConfig', {});
  if (!cfg.roleId) return null;
  const member = await guild.members.fetch(memberId).catch(() => null);
  if (!member) return null;
  await member.roles.remove(cfg.roleId, reason).catch(() => {});
  const key = `${guild.id}:${memberId}`;
  if (IMUTE_TIMERS.has(key)) { clearTimeout(IMUTE_TIMERS.get(key)); IMUTE_TIMERS.delete(key); }
  createCase(guild.id, { type: 'iunmute', targetId: memberId, executorId, reason: reason || 'Image mute removed by staff' });
  return true;
}

function scheduleIMuteRelease(guild, userId, ms) {
  const key = `${guild.id}:${userId}`;
  if (IMUTE_TIMERS.has(key)) clearTimeout(IMUTE_TIMERS.get(key));
  const timer = setTimeout(async () => {
    IMUTE_TIMERS.delete(key);
    await unimuteMember(guild, userId, 'Auto-unmuted (image mute time expired)', guild.client?.user?.id || 'system');
  }, ms);
  IMUTE_TIMERS.set(key, timer);
}

// ══════════════════════════════════════════════════════════
// REACTION MUTE / UNMUTE (with duration)
// ══════════════════════════════════════════════════════════

async function rmuteMember(guild, member, reason, duration, executorId) {
  const roleId = await getOrCreateReactionMuteRole(guild);
  await member.roles.add(roleId, reason);

  const c = createCase(guild.id, {
    type: 'rmute', targetId: member.id, executorId, reason,
    duration: duration ? formatDuration(duration) : 'Permanent',
    expires: duration ? Date.now() + duration : null,
  });

  if (duration) scheduleRMuteRelease(guild, member.id, duration);
  return c;
}

async function unrmuteMember(guild, memberId, reason, executorId) {
  const db = getGuildDb(guild.id);
  const cfg = db.get('rmuteConfig', {});
  if (!cfg.roleId) return null;
  const member = await guild.members.fetch(memberId).catch(() => null);
  if (!member) return null;
  await member.roles.remove(cfg.roleId, reason).catch(() => {});
  const key = `${guild.id}:${memberId}`;
  if (RMUTE_TIMERS.has(key)) { clearTimeout(RMUTE_TIMERS.get(key)); RMUTE_TIMERS.delete(key); }
  createCase(guild.id, { type: 'runmute', targetId: memberId, executorId, reason: reason || 'Reaction mute removed by staff' });
  return true;
}

function scheduleRMuteRelease(guild, userId, ms) {
  const key = `${guild.id}:${userId}`;
  if (RMUTE_TIMERS.has(key)) clearTimeout(RMUTE_TIMERS.get(key));
  const timer = setTimeout(async () => {
    RMUTE_TIMERS.delete(key);
    await unrmuteMember(guild, userId, 'Auto-unmuted (reaction mute time expired)', guild.client?.user?.id || 'system');
  }, ms);
  RMUTE_TIMERS.set(key, timer);
}

// ══════════════════════════════════════════════════════════
// HANDLERS
// ══════════════════════════════════════════════════════════

async function handleMute(ctx, args, client) {
  const { isStaffOrAdmin } = require('./helpers');
  if (!isStaffOrAdmin(ctx.member)) return ctx.reply({ content: '❌ No permission.', ephemeral: true });
  if (!isMuteSetup(ctx.guild)) return ctx.reply({ content: '❌ The mute system is not set up. Use `.setupmute` to set it up.', ephemeral: true });

  const target = ctx.mentions?.members?.first();
  if (!target) return ctx.reply({ content: '❌ Mention a user.', ephemeral: true });

  let durationStr = null, reason = 'No reason provided';
  const maybeMs = parseDuration(args[1]);
  if (maybeMs) { durationStr = args[1]; reason = args.slice(2).join(' ') || reason; }
  else { reason = args.slice(1).join(' ') || reason; }
  const authorId = ctx.author?.id || ctx.user?.id;

  const c = await muteMember(ctx.guild, target, reason, durationStr ? parseDuration(durationStr) : null, authorId);

  // Invoke DM
  try {
    const { sendInvokeDm } = require('./invoke');
    const { buildInvokeVars, sendInvokeReply } = require('./helpers');
    const vars = buildInvokeVars(ctx, target, reason, durationStr, c.id);
    await sendInvokeDm(target.user, ctx.guild.id, 'mute', vars);
  } catch {}

  // Invoke reply
  try {

    return sendInvokeReply(ctx, ctx.guild.id, 'mute', target, reason, durationStr, c.id);
  } catch {
    const timeText = durationStr ? ` for **${durationStr}**` : '';
    return ctx.reply(`${target} you're muted${timeText}`);
  }
}

async function handleUnmute(ctx, args, client) {
  const { isStaffOrAdmin } = require('./helpers');
  if (!isStaffOrAdmin(ctx.member)) return ctx.reply({ content: '❌ No permission.', ephemeral: true });
  if (!isMuteSetup(ctx.guild)) return ctx.reply({ content: '❌ The mute system is not set up. Use `.setupmute` to set it up.', ephemeral: true });

  const target = ctx.mentions?.members?.first();
  if (!target) return ctx.reply({ content: '❌ Mention a user.', ephemeral: true });
  const reason = args.slice(1).join(' ') || 'Unmuted by staff';
  const authorId = ctx.author?.id || ctx.user?.id;
  const result = await unmuteMember(ctx.guild, target.id, reason, authorId);
  if (!result) return ctx.reply({ content: '❌ Could not unmute. No mute role set up?', ephemeral: true });

  // Invoke DM
  try {
    const { sendInvokeDm } = require('./invoke');
    const { buildInvokeVars, sendInvokeReply } = require('./helpers');
    const vars = buildInvokeVars(ctx, target, reason, null, null);
    await sendInvokeDm(target.user, ctx.guild.id, 'unmute', vars);
  } catch {}

  // Invoke reply
  try {

    return sendInvokeReply(ctx, ctx.guild.id, 'unmute', target, reason, null, null);
  } catch {
    const embed = base(COLORS.success).setTitle('🔊 Member Unmuted')
      .addFields(
        { name: '👤 User', value: `${target.user}`, inline: true },
        { name: '👮 Moderator', value: `<@${authorId}>`, inline: true },
        { name: '📝 Reason', value: reason },
      );
    await sendModLog(ctx.guild, embed);
    return ctx.reply({ embeds: [embed] });
  }
}

// imute — mute images/attachments only (role-based) with optional duration
async function handleIMute(ctx, args) {
  const { isStaffOrAdmin } = require('./helpers');
  if (!isStaffOrAdmin(ctx.member)) return ctx.reply({ content: '❌ No permission.', ephemeral: true });
  if (!isIMuteSetup(ctx.guild)) return ctx.reply({ content: '❌ The image mute system is not set up. Use `.setupimute` to set it up.', ephemeral: true });

  const target = ctx.mentions?.members?.first();
  if (!target) return ctx.reply({ content: '❌ Mention a user.', ephemeral: true });

  let durationStr = null, reason = 'Image mute';
  const maybeMs = parseDuration(args[1]);
  if (maybeMs) { durationStr = args[1]; reason = args.slice(2).join(' ') || reason; }
  else { reason = args.slice(1).join(' ') || reason; }
  const authorId = ctx.author?.id || ctx.user?.id;

  const c = await imuteMember(ctx.guild, target, reason, durationStr ? parseDuration(durationStr) : null, authorId);

  // Invoke DM
  try {
    const { sendInvokeDm } = require('./invoke');
    const { buildInvokeVars, sendInvokeReply } = require('./helpers');
    const vars = buildInvokeVars(ctx, target, reason, durationStr, c.id);
    await sendInvokeDm(target.user, ctx.guild.id, 'imute', vars);
  } catch {}

  // Invoke reply
  try {

    return sendInvokeReply(ctx, ctx.guild.id, 'imute', target, reason, durationStr, c.id);
  } catch {
    const timeText = durationStr ? ` for **${durationStr}**` : '';
    return ctx.reply(`${target} you can't send images${timeText}`);
  }
}

async function handleIUnmute(ctx, args) {
  const { isStaffOrAdmin } = require('./helpers');
  if (!isStaffOrAdmin(ctx.member)) return ctx.reply({ content: '❌ No permission.', ephemeral: true });
  if (!isIMuteSetup(ctx.guild)) return ctx.reply({ content: '❌ The image mute system is not set up. Use `.setupimute` to set it up.', ephemeral: true });

  const target = ctx.mentions?.members?.first();
  if (!target) return ctx.reply({ content: '❌ Mention a user.', ephemeral: true });
  const reason = args.slice(1).join(' ') || 'Image mute removed';
  const authorId = ctx.author?.id || ctx.user?.id;

  const result = await unimuteMember(ctx.guild, target.id, reason, authorId);
  if (!result) return ctx.reply({ content: '❌ Could not remove image mute. No image mute role set up?', ephemeral: true });

  // Invoke DM
  try {
    const { sendInvokeDm } = require('./invoke');
    const { buildInvokeVars, sendInvokeReply } = require('./helpers');
    const vars = buildInvokeVars(ctx, target, reason, null, null);
    await sendInvokeDm(target.user, ctx.guild.id, 'iunmute', vars);
  } catch {}

  // Invoke reply
  try {

    return sendInvokeReply(ctx, ctx.guild.id, 'iunmute', target, reason, null, null);
  } catch {
    return ctx.reply({ content: `🔊 Image mute removed from **${target.user.username}**.` });
  }
}

// rmute — reaction mute (role-based) with optional duration
async function handleRMute(ctx, args) {
  const { isStaffOrAdmin } = require('./helpers');
  if (!isStaffOrAdmin(ctx.member)) return ctx.reply({ content: '❌ No permission.', ephemeral: true });
  if (!isRMuteSetup(ctx.guild)) return ctx.reply({ content: '❌ The reaction mute system is not set up. Use `.setuprmute` to set it up.', ephemeral: true });

  const target = ctx.mentions?.members?.first();
  if (!target) return ctx.reply({ content: '❌ Mention a user.', ephemeral: true });

  let durationStr = null, reason = 'Reaction mute';
  const maybeMs = parseDuration(args[1]);
  if (maybeMs) { durationStr = args[1]; reason = args.slice(2).join(' ') || reason; }
  else { reason = args.slice(1).join(' ') || reason; }
  const authorId = ctx.author?.id || ctx.user?.id;

  const c = await rmuteMember(ctx.guild, target, reason, durationStr ? parseDuration(durationStr) : null, authorId);

  // Invoke DM
  try {
    const { sendInvokeDm } = require('./invoke');
    const { buildInvokeVars, sendInvokeReply } = require('./helpers');
    const vars = buildInvokeVars(ctx, target, reason, durationStr, c.id);
    await sendInvokeDm(target.user, ctx.guild.id, 'rmute', vars);
  } catch {}

  // Invoke reply
  try {

    return sendInvokeReply(ctx, ctx.guild.id, 'rmute', target, reason, durationStr, c.id);
  } catch {
    const timeText = durationStr ? ` for **${durationStr}**` : '';
    return ctx.reply(`${target} you can't add reactions${timeText}`);
  }
}

async function handleRUnmute(ctx, args) {
  const { isStaffOrAdmin } = require('./helpers');
  if (!isStaffOrAdmin(ctx.member)) return ctx.reply({ content: '❌ No permission.', ephemeral: true });
  if (!isRMuteSetup(ctx.guild)) return ctx.reply({ content: '❌ The reaction mute system is not set up. Use `.setuprmute` to set it up.', ephemeral: true });

  const target = ctx.mentions?.members?.first();
  if (!target) return ctx.reply({ content: '❌ Mention a user.', ephemeral: true });
  const reason = args.slice(1).join(' ') || 'Reaction mute removed';
  const authorId = ctx.author?.id || ctx.user?.id;

  const result = await unrmuteMember(ctx.guild, target.id, reason, authorId);
  if (!result) return ctx.reply({ content: '❌ Could not remove reaction mute. No reaction mute role set up?', ephemeral: true });

  // Invoke DM
  try {
    const { sendInvokeDm } = require('./invoke');
    const { buildInvokeVars, sendInvokeReply } = require('./helpers');
    const vars = buildInvokeVars(ctx, target, reason, null, null);
    await sendInvokeDm(target.user, ctx.guild.id, 'runmute', vars);
  } catch {}

  // Invoke reply
  try {

    return sendInvokeReply(ctx, ctx.guild.id, 'runmute', target, reason, null, null);
  } catch {
    return ctx.reply({ content: `🔊 Reaction mute removed from **${target.user.username}**.` });
  }
}

// ══════════════════════════════════════════════════════════
// SETUP COMMANDS
// ══════════════════════════════════════════════════════════

function requireSetupPerms(member) {
  return member.permissions.has(PermissionFlagsBits.ManageGuild) && member.permissions.has(PermissionFlagsBits.ManageChannels);
}

async function handleSetupMute(ctx, args) {
  if (!requireSetupPerms(ctx.member)) {
    return ctx.reply({ content: '❌ You need **Manage Server** and **Manage Channels** permissions to set up the mute system.', ephemeral: true });
  }

  const roleId = await getOrCreateMuteRole(ctx.guild);
  const role = ctx.guild.roles.cache.get(roleId);

  return ctx.reply({
    embeds: [base(COLORS.success).setTitle('🔇 Mute System Set Up')
      .setDescription(`Mute role: <@&${roleId}> (\`${roleId}\`)\n\nAll channels have been configured with deny permissions.`)
      .addFields(
        { name: 'Role Name', value: role?.name || 'muted', inline: true },
        { name: 'Permissions', value: '❌ Send Messages\n❌ Add Reactions\n❌ Speak in VC\n❌ Create Threads', inline: true }
      )]
  });
}

async function handleSetupIMute(ctx, args) {
  if (!requireSetupPerms(ctx.member)) {
    return ctx.reply({ content: '❌ You need **Manage Server** and **Manage Channels** permissions to set up the image mute system.', ephemeral: true });
  }

  const roleId = await getOrCreateImageMuteRole(ctx.guild);
  const role = ctx.guild.roles.cache.get(roleId);

  return ctx.reply({
    embeds: [base(COLORS.success).setTitle('🖼️ Image Mute System Set Up')
      .setDescription(`Image Mute role: <@&${roleId}> (\`${roleId}\`)\n\nAll channels have been configured with deny permissions.`)
      .addFields(
        { name: 'Role Name', value: role?.name || 'imuted', inline: true },
        { name: 'Permissions', value: '❌ Attach Files\n❌ Embed Links', inline: true }
      )]
  });
}

async function handleSetupRMute(ctx, args) {
  if (!requireSetupPerms(ctx.member)) {
    return ctx.reply({ content: '❌ You need **Manage Server** and **Manage Channels** permissions to set up the reaction mute system.', ephemeral: true });
  }

  const roleId = await getOrCreateReactionMuteRole(ctx.guild);
  const role = ctx.guild.roles.cache.get(roleId);

  return ctx.reply({
    embeds: [base(COLORS.success).setTitle('😶 Reaction Mute System Set Up')
      .setDescription(`Reaction Mute role: <@&${roleId}> (\`${roleId}\`)\n\nAll channels have been configured with deny permissions.`)
      .addFields(
        { name: 'Role Name', value: role?.name || 'rmuted', inline: true },
        { name: 'Permissions', value: '❌ Add Reactions\n❌ Use External Emojis\n❌ Use External Stickers', inline: true }
      )]
  });
}

// ══════════════════════════════════════════════════════════
// RESTORE TIMERS
// ══════════════════════════════════════════════════════════

async function restoreMuteTimers(client) {
  for (const guild of client.guilds.cache.values()) {
    const db = getGuildDb(guild.id);
    const cases = db.get('cases', []).filter(c =>
      ['mute', 'imute', 'rmute'].includes(c.type) && c.expires && c.expires > Date.now() && c.status !== 'pardoned'
    );
    for (const c of cases) {
      const remaining = c.expires - Date.now();
      if (c.type === 'mute') scheduleMuteRelease(guild, c.targetId, remaining);
      if (c.type === 'imute') scheduleIMuteRelease(guild, c.targetId, remaining);
      if (c.type === 'rmute') scheduleRMuteRelease(guild, c.targetId, remaining);
    }
  }
}

// ══════════════════════════════════════════════════════════
// UNMUTE ALL
// ══════════════════════════════════════════════════════════

async function handleUnmuteAll(ctx) {
  const { isStaffOrAdmin } = require('./helpers');
  if (!isStaffOrAdmin(ctx.member)) return ctx.reply({ content: '❌ No permission.', ephemeral: true });

  const db = getGuildDb(ctx.guild.id);
  const cfg = db.get('muteConfig', {});
  if (!cfg.roleId || !ctx.guild.roles.cache.has(cfg.roleId)) {
    return ctx.reply({ content: '❌ The mute system is not set up.', ephemeral: true });
  }

  const members = ctx.guild.members.cache.filter(m => m.roles.cache.has(cfg.roleId));
  if (!members.size) return ctx.reply({ content: '✅ No members are currently muted.' });

  let count = 0;
  for (const [, member] of members) {
    await member.roles.remove(cfg.roleId, 'Unmute all command').catch(() => {});
    const key = `${ctx.guild.id}:${member.id}`;
    if (MUTE_TIMERS.has(key)) { clearTimeout(MUTE_TIMERS.get(key)); MUTE_TIMERS.delete(key); }
    count++;
  }

  createCase(ctx.guild.id, {
    type: 'unmute', targetId: 'mass', executorId: ctx.author?.id || ctx.user?.id,
    reason: `Unmuted ${count} member(s) via unmute all`,
  });

  return ctx.reply({ content: `✅ Unmuted **${count}** member(s).` });
}

async function handleIUnmuteAll(ctx) {
  const { isStaffOrAdmin } = require('./helpers');
  if (!isStaffOrAdmin(ctx.member)) return ctx.reply({ content: '❌ No permission.', ephemeral: true });

  const db = getGuildDb(ctx.guild.id);
  const cfg = db.get('imuteConfig', {});
  if (!cfg.roleId || !ctx.guild.roles.cache.has(cfg.roleId)) {
    return ctx.reply({ content: '❌ The image mute system is not set up.', ephemeral: true });
  }

  const members = ctx.guild.members.cache.filter(m => m.roles.cache.has(cfg.roleId));
  if (!members.size) return ctx.reply({ content: '✅ No members are currently image-muted.' });

  let count = 0;
  for (const [, member] of members) {
    await member.roles.remove(cfg.roleId, 'Unimute all command').catch(() => {});
    const key = `${ctx.guild.id}:${member.id}`;
    if (IMUTE_TIMERS.has(key)) { clearTimeout(IMUTE_TIMERS.get(key)); IMUTE_TIMERS.delete(key); }
    count++;
  }

  createCase(ctx.guild.id, {
    type: 'iunmute', targetId: 'mass', executorId: ctx.author?.id || ctx.user?.id,
    reason: `Removed image mute from ${count} member(s) via unimute all`,
  });

  return ctx.reply({ content: `✅ Removed image mute from **${count}** member(s).` });
}

async function handleRUnmuteAll(ctx) {
  const { isStaffOrAdmin } = require('./helpers');
  if (!isStaffOrAdmin(ctx.member)) return ctx.reply({ content: '❌ No permission.', ephemeral: true });

  const db = getGuildDb(ctx.guild.id);
  const cfg = db.get('rmuteConfig', {});
  if (!cfg.roleId || !ctx.guild.roles.cache.has(cfg.roleId)) {
    return ctx.reply({ content: '❌ The reaction mute system is not set up.', ephemeral: true });
  }

  const members = ctx.guild.members.cache.filter(m => m.roles.cache.has(cfg.roleId));
  if (!members.size) return ctx.reply({ content: '✅ No members are currently reaction-muted.' });

  let count = 0;
  for (const [, member] of members) {
    await member.roles.remove(cfg.roleId, 'Unrmute all command').catch(() => {});
    const key = `${ctx.guild.id}:${member.id}`;
    if (RMUTE_TIMERS.has(key)) { clearTimeout(RMUTE_TIMERS.get(key)); RMUTE_TIMERS.delete(key); }
    count++;
  }

  createCase(ctx.guild.id, {
    type: 'runmute', targetId: 'mass', executorId: ctx.author?.id || ctx.user?.id,
    reason: `Removed reaction mute from ${count} member(s) via unrmute all`,
  });

  return ctx.reply({ content: `✅ Removed reaction mute from **${count}** member(s).` });
}

module.exports = {
  handleMute, handleUnmute, handleIMute, handleIUnmute,
  handleRMute, handleRUnmute, handleSetupMute, handleSetupIMute, handleSetupRMute,
  handleUnmuteAll, handleIUnmuteAll, handleRUnmuteAll,
  restoreMuteTimers, applyMutePermsToNewChannel,
};