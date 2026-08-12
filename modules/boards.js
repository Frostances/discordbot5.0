/**
 * boards.js — Starboard & Clownboard Systems
 * Starboard = showcase best messages
 * Clownboard = showcase worst messages
 * Completely separate categories with identical command structures.
 */

const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { getGuildDb } = require('./database');
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

async function resolveChannel(ctx, arg) {
  if (!arg) return ctx.channel;
  const match = arg.match(/<#(\d+)>/);
  if (match) return ctx.guild.channels.cache.get(match[1]) || null;
  if (/^\d+$/.test(arg)) return ctx.guild.channels.cache.get(arg) || null;
  return ctx.guild.channels.cache.find(c => c.name.toLowerCase() === arg.toLowerCase()) || null;
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

// ══════════════════════════════════════════════════════════
// DATABASE
// ══════════════════════════════════════════════════════════
function getBoardDb(guildId, type) {
  const db = getGuildDb(guildId);
  const key = type === 'starboard' ? 'starboardConfig' : 'clownboardConfig';
  if (!db.data[key]) {
    db.data[key] = {
      channelId: null,
      emoji: type === 'starboard' ? '⭐' : '🤡',
      threshold: 3,
      color: type === 'starboard' ? '#FFD700' : '#FF6B35',
      selfStar: false,
      jumpUrl: true,
      timestamp: true,
      attachments: true,
      locked: false,
      ignored: { channels: [], members: [], roles: [] },
      messages: {} // originalMsgId -> boardMsgId
    };
  }
  return db.data[key];
}

// ══════════════════════════════════════════════════════════
// IGNORE HELPERS
// ══════════════════════════════════════════════════════════
async function handleBoardIgnore(ctx, args, type) {
  const db = getBoardDb(ctx.guild.id, type);
  const sub = args[0]?.toLowerCase();
  const name = type === 'starboard' ? 'Starboard' : 'Clownboard';

  // Handle both "list" and "ignore_list" (from slash commands)
  if (!sub || sub === 'list' || sub === 'ignore_list') {
    const channels = db.ignored.channels.map(id => `<#${id}>`).join('\n') || 'None';
    const members = db.ignored.members.map(id => `<@${id}>`).join('\n') || 'None';
    const roles = db.ignored.roles.map(id => `<@&${id}>`).join('\n') || 'None';
    return replyEmbed(ctx, infoEmbed(`${name} Ignore List`,
      `**Channels:**\n${channels}\n\n**Members:**\n${members}\n\n**Roles:**\n${roles}`
    ));
  }

  const target = await resolveChannel(ctx, args[0]) || await resolveMember(ctx, args[0]) || await resolveRole(ctx, args[0]);
  if (!target) return replyEmbed(ctx, errorEmbed('Invalid Target', 'Mention a channel, member, or role.'));

  if (target.type !== undefined) { // Channel
    if (db.ignored.channels.includes(target.id)) {
      db.ignored.channels = db.ignored.channels.filter(id => id !== target.id);
      getGuildDb(ctx.guild.id)._save();
      return replyEmbed(ctx, successEmbed('Unignored', `${target} removed from ${name.toLowerCase()} ignore list.`));
    } else {
      db.ignored.channels.push(target.id);
      getGuildDb(ctx.guild.id)._save();
      return replyEmbed(ctx, successEmbed('Ignored', `${target} added to ${name.toLowerCase()} ignore list.`));
    }
  } else if (target.user !== undefined) { // Member
    if (db.ignored.members.includes(target.id)) {
      db.ignored.members = db.ignored.members.filter(id => id !== target.id);
      getGuildDb(ctx.guild.id)._save();
      return replyEmbed(ctx, successEmbed('Unignored', `${target} removed from ${name.toLowerCase()} ignore list.`));
    } else {
      db.ignored.members.push(target.id);
      getGuildDb(ctx.guild.id)._save();
      return replyEmbed(ctx, successEmbed('Ignored', `${target} added to ${name.toLowerCase()} ignore list.`));
    }
  } else { // Role
    if (db.ignored.roles.includes(target.id)) {
      db.ignored.roles = db.ignored.roles.filter(id => id !== target.id);
      getGuildDb(ctx.guild.id)._save();
      return replyEmbed(ctx, successEmbed('Unignored', `${target} removed from ${name.toLowerCase()} ignore list.`));
    } else {
      db.ignored.roles.push(target.id);
      getGuildDb(ctx.guild.id)._save();
      return replyEmbed(ctx, successEmbed('Ignored', `${target} added to ${name.toLowerCase()} ignore list.`));
    }
  }
}

function isBoardIgnored(guildId, type, message) {
  const db = getBoardDb(guildId, type);
  if (db.ignored.channels.includes(message.channel.id)) return true;
  if (db.ignored.members.includes(message.author.id)) return true;
  if (message.member && message.member.roles.cache.some(r => db.ignored.roles.includes(r.id))) return true;
  return false;
}

// ══════════════════════════════════════════════════════════
// REACTION HANDLERS
// ══════════════════════════════════════════════════════════
async function handleBoardReactionAdd(reaction, user, type) {
  const { message } = reaction;
  if (!message.guild) return;
  const db = getBoardDb(message.guild.id, type);
  if (db.locked) return;
  if (!db.channelId) return;

  const boardChannel = message.guild.channels.cache.get(db.channelId);
  if (!boardChannel) return;

  // Check if emoji matches
  const emojiStr = reaction.emoji.id ? `<:${reaction.emoji.name}:${reaction.emoji.id}>` : reaction.emoji.name;
  const targetEmoji = db.emoji;
  if (emojiStr !== targetEmoji && reaction.emoji.name !== targetEmoji) return;

  // Ignore checks
  if (isBoardIgnored(message.guild.id, type, message)) return;

  // Self-star check
  if (!db.selfStar && message.author.id === user.id) return;

  // Count reactions with the target emoji
  const reactionData = message.reactions.cache.find(r => {
    const e = r.emoji.id ? `<:${r.emoji.name}:${r.emoji.id}>` : r.emoji.name;
    return e === targetEmoji || r.emoji.name === targetEmoji;
  });
  if (!reactionData) return;

  const count = reactionData.count || 0;

  // Already posted?
  if (db.messages[message.id]) {
    // Update the board message with new count
    try {
      const boardMsg = await boardChannel.messages.fetch(db.messages[message.id]).catch(() => null);
      if (boardMsg) {
        await updateBoardMessage(boardMsg, message, count, type, db);
      }
    } catch {}
    return;
  }

  // Threshold met?
  if (count >= db.threshold) {
    try {
      const boardMsg = await createBoardMessage(boardChannel, message, count, type, db);
      db.messages[message.id] = boardMsg.id;
      getGuildDb(message.guild.id)._save();
    } catch {}
  }
}

async function handleBoardReactionRemove(reaction, user, type) {
  const { message } = reaction;
  if (!message.guild) return;
  const db = getBoardDb(message.guild.id, type);
  if (!db.channelId) return;
  if (!db.messages[message.id]) return;

  const boardChannel = message.guild.channels.cache.get(db.channelId);
  if (!boardChannel) return;

  // Check emoji
  const emojiStr = reaction.emoji.id ? `<:${reaction.emoji.name}:${reaction.emoji.id}>` : reaction.emoji.name;
  const targetEmoji = db.emoji;
  if (emojiStr !== targetEmoji && reaction.emoji.name !== targetEmoji) return;

  // Count remaining reactions
  const reactionData = message.reactions.cache.find(r => {
    const e = r.emoji.id ? `<:${r.emoji.name}:${r.emoji.id}>` : r.emoji.name;
    return e === targetEmoji || r.emoji.name === targetEmoji;
  });
  const count = reactionData ? (reactionData.count || 0) : 0;

  if (count < db.threshold) {
    // Delete board message
    try {
      const boardMsg = await boardChannel.messages.fetch(db.messages[message.id]).catch(() => null);
      if (boardMsg) await boardMsg.delete().catch(() => {});
    } catch {}
    delete db.messages[message.id];
    getGuildDb(message.guild.id)._save();
  } else {
    // Update count
    try {
      const boardMsg = await boardChannel.messages.fetch(db.messages[message.id]).catch(() => null);
      if (boardMsg) {
        await updateBoardMessage(boardMsg, message, count, type, db);
      }
    } catch {}
  }
}

async function createBoardMessage(boardChannel, originalMessage, count, type, db) {
  const name = type === 'starboard' ? 'Starboard' : 'Clownboard';
  const emoji = db.emoji;

  const embed = new EmbedBuilder()
    .setAuthor({ name: originalMessage.author.tag, iconURL: originalMessage.author.displayAvatarURL() })
    .setDescription(originalMessage.content || '*No text content*')
    .setColor(db.color)
    .addFields(
      { name: 'Channel', value: `<#${originalMessage.channel.id}>`, inline: true },
      { name: 'Count', value: `${emoji} ${count}`, inline: true }
    )
    .setFooter({ text: `${name} • ${originalMessage.id}` });

  if (db.timestamp) {
    embed.setTimestamp(originalMessage.createdTimestamp);
  }

  if (db.jumpUrl) {
    embed.addFields({ name: 'Original', value: `[Jump to message](${originalMessage.url})` });
  }

  const files = [];
  if (db.attachments && originalMessage.attachments.size > 0) {
    const img = originalMessage.attachments.find(a => a.contentType?.startsWith('image/'));
    if (img) embed.setImage(img.url);
    // Also attach non-image files
    for (const [, att] of originalMessage.attachments) {
      if (!att.contentType?.startsWith('image/')) {
        files.push(att.url);
      }
    }
  }

  const content = `${emoji} ${count} | <#${originalMessage.channel.id}>`;
  return await boardChannel.send({ content, embeds: [embed], files: files.length ? files : undefined });
}

async function updateBoardMessage(boardMsg, originalMessage, count, type, db) {
  const emoji = db.emoji;
  const embed = boardMsg.embeds[0];
  if (!embed) return;

  const newEmbed = EmbedBuilder.from(embed);
  // Update count field
  const fields = newEmbed.data.fields || [];
  const countFieldIdx = fields.findIndex(f => f.name === 'Count');
  if (countFieldIdx !== -1) {
    fields[countFieldIdx] = { name: 'Count', value: `${emoji} ${count}`, inline: true };
  }
  newEmbed.setFields(fields);

  const content = `${emoji} ${count} | <#${originalMessage.channel.id}>`;
  await boardMsg.edit({ content, embeds: [newEmbed] }).catch(() => {});
}

// ══════════════════════════════════════════════════════════
// COMMAND HANDLERS
// ══════════════════════════════════════════════════════════
async function handleBoardCommand(ctx, args, type) {
  const db = getBoardDb(ctx.guild.id, type);
  const sub = args[0]?.toLowerCase();
  const name = type === 'starboard' ? 'Starboard' : 'Clownboard';
  const emoji = type === 'starboard' ? '⭐' : '🤡';

  // No subcommand → show help + current config
  if (!sub) {
    const config = getBoardDb(ctx.guild.id, type);
    const ch = config.channelId ? `<#${config.channelId}>` : 'Not set';
    return replyEmbed(ctx, infoEmbed(`${name}`,
      `**Channel:** ${ch}\n` +
      `**Emoji:** ${config.emoji || emoji}\n` +
      `**Threshold:** ${config.threshold}\n` +
      `**Color:** ${config.color}\n` +
      `**Self-${type === 'starboard' ? 'star' : 'clown'}:** ${config.selfStar ? 'Yes' : 'No'}\n` +
      `**Jump URL:** ${config.jumpUrl ? 'Yes' : 'No'}\n` +
      `**Timestamp:** ${config.timestamp ? 'Yes' : 'No'}\n` +
      `**Attachments:** ${config.attachments ? 'Yes' : 'No'}\n` +
      `**Locked:** ${config.locked ? 'Yes' : 'No'}\n\n` +
      `\`${type} set <#channel>\` — set board channel\n` +
      `\`${type} emoji <emoji>\` — set trigger emoji\n` +
      `\`${type} threshold <number>\` — set required reactions\n` +
      `\`${type} color <#hex>\` — set embed color\n` +
      `\`${type} selfstar <on/off>\` — allow self-reactions\n` +
      `\`${type} jumpurl <on/off>\` — show jump URL\n` +
      `\`${type} timestamp <on/off>\` — show timestamp\n` +
      `\`${type} attachments <on/off>\` — show attachments\n` +
      `\`${type} ignore <target>\` — ignore channel/member/role\n` +
      `\`${type} ignore list\` — view ignored targets\n` +
      `\`${type} lock\` — disable board\n` +
      `\`${type} unlock\` — enable board\n` +
      `\`${type} reset\` — reset all config\n` +
      `\`${type} config\` — view full config`
    ));
  }

  if (sub === 'set') {
    const channel = await resolveChannel(ctx, args[1]);
    if (!channel) return replyEmbed(ctx, errorEmbed('Invalid Channel', 'Mention a valid text channel.'));
    db.channelId = channel.id;
    getGuildDb(ctx.guild.id)._save();
    return replyEmbed(ctx, successEmbed('Channel Set', `${name} channel set to ${channel}.`));
  }

  if (sub === 'emoji') {
    const emojiArg = args[1];
    if (!emojiArg) return replyEmbed(ctx, errorEmbed('Missing Emoji', `Usage: \`${type} emoji <emoji>\``));
    db.emoji = emojiArg;
    getGuildDb(ctx.guild.id)._save();
    return replyEmbed(ctx, successEmbed('Emoji Set', `${name} emoji set to ${emojiArg}.`));
  }

  if (sub === 'threshold') {
    const num = parseInt(args[1]);
    if (isNaN(num) || num < 1) return replyEmbed(ctx, errorEmbed('Invalid Number', `Usage: \`${type} threshold <number>\``));
    db.threshold = num;
    getGuildDb(ctx.guild.id)._save();
    return replyEmbed(ctx, successEmbed('Threshold Set', `${name} threshold set to **${num}**.`));
  }

  if (sub === 'color') {
    const color = args[1];
    if (!color || !/^#?[0-9A-Fa-f]{6}$/.test(color)) return replyEmbed(ctx, errorEmbed('Invalid Color', `Usage: \`${type} color <#hex>\``));
    db.color = color.startsWith('#') ? color : `#${color}`;
    getGuildDb(ctx.guild.id)._save();
    return replyEmbed(ctx, successEmbed('Color Set', `${name} color set to **${db.color}**.`));
  }

  if (sub === 'selfstar') {
    const opt = args[1]?.toLowerCase();
    db.selfStar = opt === 'on' || opt === 'true' || opt === 'yes';
    getGuildDb(ctx.guild.id)._save();
    return replyEmbed(ctx, successEmbed('Setting Updated', `Self-${type === 'starboard' ? 'star' : 'clown'} is now **${db.selfStar ? 'enabled' : 'disabled'}**.`));
  }

  if (sub === 'jumpurl') {
    const opt = args[1]?.toLowerCase();
    db.jumpUrl = opt === 'on' || opt === 'true' || opt === 'yes';
    getGuildDb(ctx.guild.id)._save();
    return replyEmbed(ctx, successEmbed('Setting Updated', `Jump URL is now **${db.jumpUrl ? 'enabled' : 'disabled'}**.`));
  }

  if (sub === 'timestamp') {
    const opt = args[1]?.toLowerCase();
    db.timestamp = opt === 'on' || opt === 'true' || opt === 'yes';
    getGuildDb(ctx.guild.id)._save();
    return replyEmbed(ctx, successEmbed('Setting Updated', `Timestamp is now **${db.timestamp ? 'enabled' : 'disabled'}**.`));
  }

  if (sub === 'attachments') {
    const opt = args[1]?.toLowerCase();
    db.attachments = opt === 'on' || opt === 'true' || opt === 'yes';
    getGuildDb(ctx.guild.id)._save();
    return replyEmbed(ctx, successEmbed('Setting Updated', `Attachments are now **${db.attachments ? 'enabled' : 'disabled'}**.`));
  }

  if (sub === 'ignore') {
    return handleBoardIgnore(ctx, args.slice(1), type);
  }

  if (sub === 'lock') {
    db.locked = true;
    getGuildDb(ctx.guild.id)._save();
    return replyEmbed(ctx, successEmbed('Locked', `${name} is now **locked** (disabled).`));
  }

  if (sub === 'unlock') {
    db.locked = false;
    getGuildDb(ctx.guild.id)._save();
    return replyEmbed(ctx, successEmbed('Unlocked', `${name} is now **unlocked** (enabled).`));
  }

  if (sub === 'reset') {
    const key = type === 'starboard' ? 'starboardConfig' : 'clownboardConfig';
    const guildDb = getGuildDb(ctx.guild.id);
    delete guildDb.data[key];
    guildDb._save();
    return replyEmbed(ctx, successEmbed('Reset', `${name} configuration has been reset.`));
  }

  if (sub === 'config') {
    const config = getBoardDb(ctx.guild.id, type);
    const ch = config.channelId ? `<#${config.channelId}>` : 'Not set';
    const channels = config.ignored.channels.map(id => `<#${id}>`).join(', ') || 'None';
    const members = config.ignored.members.map(id => `<@${id}>`).join(', ') || 'None';
    const roles = config.ignored.roles.map(id => `<@&${id}>`).join(', ') || 'None';
    return replyEmbed(ctx, infoEmbed(`${name} Configuration`,
      `**Channel:** ${ch}\n` +
      `**Emoji:** ${config.emoji || emoji}\n` +
      `**Threshold:** ${config.threshold}\n` +
      `**Color:** ${config.color}\n` +
      `**Self-${type === 'starboard' ? 'star' : 'clown'}:** ${config.selfStar ? 'Yes' : 'No'}\n` +
      `**Jump URL:** ${config.jumpUrl ? 'Yes' : 'No'}\n` +
      `**Timestamp:** ${config.timestamp ? 'Yes' : 'No'}\n` +
      `**Attachments:** ${config.attachments ? 'Yes' : 'No'}\n` +
      `**Locked:** ${config.locked ? 'Yes' : 'No'}\n\n` +
      `**Ignored Channels:** ${channels}\n` +
      `**Ignored Members:** ${members}\n` +
      `**Ignored Roles:** ${roles}`
    ));
  }

  return replyEmbed(ctx, errorEmbed('Invalid Subcommand', `Use \`${type}\` for help.`));
}

// ══════════════════════════════════════════════════════════
// PUBLIC WRAPPERS
// ══════════════════════════════════════════════════════════
async function handleStarboard(ctx, args) {
  return handleBoardCommand(ctx, args, 'starboard');
}

async function handleClownboard(ctx, args) {
  return handleBoardCommand(ctx, args, 'clownboard');
}

async function onStarboardReactionAdd(reaction, user) {
  return handleBoardReactionAdd(reaction, user, 'starboard');
}

async function onStarboardReactionRemove(reaction, user) {
  return handleBoardReactionRemove(reaction, user, 'starboard');
}

async function onClownboardReactionAdd(reaction, user) {
  return handleBoardReactionAdd(reaction, user, 'clownboard');
}

async function onClownboardReactionRemove(reaction, user) {
  return handleBoardReactionRemove(reaction, user, 'clownboard');
}

// ══════════════════════════════════════════════════════════
// EXPORTS
// ══════════════════════════════════════════════════════════
module.exports = {
  handleStarboard,
  handleClownboard,
  onStarboardReactionAdd,
  onStarboardReactionRemove,
  onClownboardReactionAdd,
  onClownboardReactionRemove,
};