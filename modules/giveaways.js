/**
 * giveaways.js — Full giveaway system
 * Commands: .giveaways start/end/reroll/cancel/list/edit
 *
 * Entry method: 🎉 reaction on the giveaway embed
 * Button: "Giveaway Stats" — shows your progress toward requirements (ephemeral)
 * Anyone can react, but only qualified users can win.
 */
const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle
} = require('discord.js');
const { getGuildDb, getUserDb } = require('./database');
const { COLORS, base, ok, err } = require('../utils/embeds');
const { isStaffOrAdmin } = require('./helpers');

// ── Parse duration string → ms ──
function parseDuration(str) {
  if (!str) return null;
  const map = { s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000 };
  const match = str.match(/^(\d+)([smhdw])$/i);
  if (!match) return null;
  return parseInt(match[1]) * (map[match[2].toLowerCase()] || 0);
}

// ── Format ms into human-readable ──
function formatDuration(ms) {
  if (!ms) return null;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return `${Math.floor(d / 7)}w`;
}

// ── Parse a Discord message link ──
function parseMessageLink(link) {
  const match = link.match(/discord(?:app)?\.com\/channels\/(\d+)\/(\d+)\/(\d+)/);
  if (!match) return null;
  return { guildId: match[1], channelId: match[2], messageId: match[3] };
}

// ── Get all giveaways for a guild ──
function getGiveaways(guildId) {
  return getGuildDb(guildId).get('giveaways', {});
}

// ── Save giveaways for a guild ──
function saveGiveaways(guildId, data) {
  getGuildDb(guildId).set('giveaways', data);
}

// ── Build requirements text for embed ──
function buildRequirementsText(gw) {
  const lines = [];
  if (gw.requiredMessages != null && gw.requiredMessages > 0) {
    const chanText = gw.gwMsgChannelId ? ` in <#${gw.gwMsgChannelId}>` : ' anywhere';
    lines.push(`Send **${gw.requiredMessages}** message(s)${chanText}`);
  }
  if (gw.requiredVoiceSecs != null && gw.requiredVoiceSecs > 0) {
    lines.push(`Spend **${formatDuration(gw.requiredVoiceSecs * 1000)}** in voice channels`);
  }
  if (gw.minLevel != null) lines.push(`Must be level **${gw.minLevel}** or more`);
  if (gw.maxLevel != null) lines.push(`Must be below level **${gw.maxLevel}**`);
  if (gw.minAge != null) lines.push(`Account must be **${gw.minAge}** day(s) old`);
  if (gw.minStay != null) lines.push(`Must be in server for **${gw.minStay}** day(s)`);
  if (gw.requiredRoles?.length > 0) {
    lines.push(`Must have role(s): ${gw.requiredRoles.map(r => `<@&${r}>`).join(', ')}`);
  }
  return lines;
}

// ── Check if a user meets ALL requirements ──
function userMeetsRequirements(gw, userId, member, guildId) {
  // Required roles
  if (gw.requiredRoles?.length > 0) {
    const hasRole = gw.requiredRoles.some(r => member.roles.cache.has(r));
    if (!hasRole) return false;
  }

  // Min/max level
  if (gw.minLevel != null) {
    const userDb = getUserDb(guildId, userId);
    const level = userDb.data.level || 0;
    if (level < gw.minLevel) return false;
  }
  if (gw.maxLevel != null) {
    const userDb = getUserDb(guildId, userId);
    const level = userDb.data.level || 0;
    if (level > gw.maxLevel) return false;
  }

  // Min account age
  if (gw.minAge != null) {
    const accountCreated = member.user?.createdTimestamp || member.createdTimestamp;
    const ageMs = Date.now() - accountCreated;
    if (ageMs / 86400000 < gw.minAge) return false;
  }

  // Min server stay
  if (gw.minStay != null) {
    const joinedAt = member.joinedTimestamp;
    if (!joinedAt) return false;
    if ((Date.now() - joinedAt) / 86400000 < gw.minStay) return false;
  }

  // Required messages
  if (gw.requiredMessages != null && gw.requiredMessages > 0) {
    const sent = (gw.gwMsgCounts || {})[userId] || 0;
    if (sent < gw.requiredMessages) return false;
  }

  // Required voice time
  if (gw.requiredVoiceSecs != null && gw.requiredVoiceSecs > 0) {
    const stored = (gw.gwVoiceSecs || {})[userId] || 0;
    const vcKey = `${guildId}_${userId}`;
    const activeJoin = gwVoiceJoinMap.get(vcKey);
    let activeBonus = 0;
    if (activeJoin) {
      const effectiveJoin = Math.max(activeJoin, gw.startAt || 0);
      activeBonus = Math.max(0, Math.floor((Date.now() - effectiveJoin) / 1000));
    }
    if (stored + activeBonus < gw.requiredVoiceSecs) return false;
  }

  return true;
}

// ── Build missing requirements text for ephemeral reply ──
function buildMissingText(gw, userId, member, guildId) {
  const missing = [];

  if (gw.requiredMessages != null && gw.requiredMessages > 0) {
    const sent = (gw.gwMsgCounts || {})[userId] || 0;
    const need = gw.requiredMessages - sent;
    if (need > 0) missing.push(`Send **${need}** more message(s)`);
  }

  if (gw.requiredVoiceSecs != null && gw.requiredVoiceSecs > 0) {
    const stored = (gw.gwVoiceSecs || {})[userId] || 0;
    const vcKey = `${guildId}_${userId}`;
    const activeJoin = gwVoiceJoinMap.get(vcKey);
    let activeBonus = 0;
    if (activeJoin) {
      const effectiveJoin = Math.max(activeJoin, gw.startAt || 0);
      activeBonus = Math.max(0, Math.floor((Date.now() - effectiveJoin) / 1000));
    }
    const totalSecs = stored + activeBonus;
    const need = gw.requiredVoiceSecs - totalSecs;
    if (need > 0) missing.push(`Spend **${formatDuration(need * 1000)}** more in voice channels`);
  }

  if (gw.minLevel != null) {
    const userDb = getUserDb(guildId, userId);
    const level = userDb.data.level || 0;
    if (level < gw.minLevel) missing.push(`Reach level **${gw.minLevel}** (you are level ${level})`);
  }

  if (gw.maxLevel != null) {
    const userDb = getUserDb(guildId, userId);
    const level = userDb.data.level || 0;
    if (level > gw.maxLevel) missing.push(`Be below level **${gw.maxLevel}** (you are level ${level})`);
  }

  if (gw.minAge != null) {
    const accountCreated = member.user?.createdTimestamp || member.createdTimestamp;
    const ageMs = Date.now() - accountCreated;
    const ageDays = ageMs / 86400000;
    if (ageDays < gw.minAge) {
      const need = Math.ceil(gw.minAge - ageDays);
      missing.push(`Wait **${need}** more day(s) (account age requirement)`);
    }
  }

  if (gw.minStay != null) {
    const joinedAt = member.joinedTimestamp;
    if (joinedAt) {
      const stayMs = Date.now() - joinedAt;
      const stayDays = stayMs / 86400000;
      if (stayDays < gw.minStay) {
        const need = Math.ceil(gw.minStay - stayDays);
        missing.push(`Wait **${need}** more day(s) in this server`);
      }
    }
  }

  if (gw.requiredRoles?.length > 0) {
    const hasRole = gw.requiredRoles.some(r => member.roles.cache.has(r));
    if (!hasRole) {
      missing.push(`Get the required role(s): ${gw.requiredRoles.map(r => `<@&${r}>`).join(', ')}`);
    }
  }

  return missing;
}

// ── Build the giveaway embed (active) ──
function buildGiveawayEmbed(gw, messageId, showEntries = false) {
  const color = gw.color || '#FF6B6B';
  const endUnix = Math.floor(gw.endAt / 1000);
  const reqLines = buildRequirementsText(gw);

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`🎉 ${gw.prize}`)
    .setDescription('React with 🎉 to enter the giveaway.');

  embed.addFields(
    { name: '**Ends:**', value: `<t:${endUnix}:R> (<t:${endUnix}:f>)`, inline: false },
    { name: '**Host:**', value: `<@${gw.hostId}>`, inline: false },
  );

  // Only show entries when ended
  if (showEntries) {
    embed.addFields(
      { name: '**Entries:**', value: `${gw.entries.length}`, inline: false },
    );
  }

  if (reqLines.length > 0) {
    embed.addFields({
      name: '**Requirements:**',
      value: reqLines.map(l => `• ${l}`).join('\n'),
      inline: false,
    });
  }

  embed.setFooter({ text: `ID: ${messageId}` });
  embed.setTimestamp(gw.endAt);

  if (gw.imageUrl) embed.setImage(gw.imageUrl);
  if (gw.thumbnailUrl) embed.setThumbnail(gw.thumbnailUrl);

  return embed;
}

// ── Build ended giveaway embed ──
function buildEndedEmbed(gw, messageId, winners, totalEntries) {
  const color = gw.color || '#FF6B6B';
  const endedAgo = Math.floor((Date.now() - gw.endAt) / 1000);
  const entriesCount = totalEntries ?? gw.entries.length;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`🎉 ${gw.prize}`)
    .setDescription('This giveaway has ended.');

  let endedText = 'Just now';
  if (endedAgo >= 86400) endedText = `${Math.floor(endedAgo / 86400)}d ago`;
  else if (endedAgo >= 3600) endedText = `${Math.floor(endedAgo / 3600)}h ago`;
  else if (endedAgo >= 60) endedText = `${Math.floor(endedAgo / 60)}m ago`;

  embed.addFields(
    { name: '**Ended:**', value: `${endedText} (<t:${Math.floor(gw.endAt / 1000)}:f>)`, inline: false },
    { name: '**Entries:**', value: `${entriesCount}`, inline: false },
    { name: '**Host:**', value: `<@${gw.hostId}>`, inline: false },
  );

  if (winners && winners.length > 0) {
    embed.addFields({
      name: '🏆 **Winners:**',
      value: winners.map(w => `• <@${w}>`).join('\n'),
      inline: false,
    });
  } else {
    embed.addFields({
      name: '🏆 **Winners:**',
      value: 'No valid entries.',
      inline: false,
    });
  }

  embed.setFooter({ text: `ID: ${messageId}` });
  embed.setTimestamp();

  if (gw.imageUrl) embed.setImage(gw.imageUrl);
  if (gw.thumbnailUrl) embed.setThumbnail(gw.thumbnailUrl);
  return embed;
}

// ── Pick random winners (only from qualified users) ──
async function pickWinners(gw, count, client, guild, message) {
  // Get all users who reacted with 🎉 from the actual message
  let reactionUsers = [];
  try {
    const reaction = message.reactions.cache.get('🎉');
    if (reaction) {
      const users = await reaction.users.fetch();
      reactionUsers = [...users.keys()].filter(id => !users.get(id).bot);
    }
  } catch (e) {
    // Fallback to entries array
    reactionUsers = [...new Set(gw.entries)];
  }

  // Check requirements for each user (fetch member if not cached)
  const qualified = [];
  for (const id of reactionUsers) {
    const user = client.users.cache.get(id);
    if (user?.bot) continue;

    let member = guild.members.cache.get(id);
    if (!member) {
      try { member = await guild.members.fetch(id); } catch { continue; }
    }
    if (!member) continue;

    if (userMeetsRequirements(gw, id, member, guild.id)) {
      qualified.push(id);
    }
  }

  const winners = [];
  const available = [...qualified];
  while (winners.length < count && available.length > 0) {
    const idx = Math.floor(Math.random() * available.length);
    winners.push(available.splice(idx, 1)[0]);
  }
  return winners;
}

// ── In-memory timers ──
const activeTimers = new Map(); // messageId → timeout

// ── Schedule end of giveaway ──
function scheduleGiveaway(client, guildId, messageId, endAt) {
  if (activeTimers.has(messageId)) {
    clearTimeout(activeTimers.get(messageId));
  }
  const delay = endAt - Date.now();
  if (delay <= 0) {
    endGiveaway(client, guildId, messageId).catch(() => {});
    return;
  }
  const timer = setTimeout(() => {
    endGiveaway(client, guildId, messageId).catch(() => {});
  }, delay);
  activeTimers.set(messageId, timer);
}

// ── End a giveaway (timer or forced) ──
async function endGiveaway(client, guildId, messageId) {
  const giveaways = getGiveaways(guildId);
  const gw = giveaways[messageId];
  if (!gw || gw.ended) return;

  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;

  let totalEntries = gw.entries.length;
  let winners = [];

  try {
    const channel = await client.channels.fetch(gw.channelId).catch(() => null);
    if (!channel) return;
    const message = await channel.messages.fetch(messageId).catch(() => null);
    if (!message) return;

    // Count actual 🎉 reactions for accurate entry count
    try {
      const reaction = message.reactions.cache.get('🎉');
      if (reaction) {
        const users = await reaction.users.fetch();
        totalEntries = [...users.values()].filter(u => !u.bot).length;
      }
    } catch (e) { /* fallback to gw.entries.length */ }

    // Pick winners from qualified users
    winners = await pickWinners(gw, gw.winnersCount, client, guild, message);

    gw.ended = true;
    gw.winners = winners;
    gw.totalEntries = totalEntries; // store accurate count
    saveGiveaways(guildId, giveaways);

    const embed = buildEndedEmbed(gw, messageId, winners, totalEntries);
    // Keep the reactions, just update the embed and remove the stats button
    await message.edit({ embeds: [embed], components: [] }).catch(() => {});

    if (winners.length > 0) {
      await channel.send({
        content: `🎉 ${winners.map(w => `<@${w}>`).join(', ')} won **${gw.prize}**!`,
      }).catch(() => {});
    } else {
      await channel.send({
        content: `😔 No valid entries for **${gw.prize}**. No winners selected.`,
      }).catch(() => {});
    }
  } catch (e) {
    // Silent fail
  }

  if (activeTimers.has(messageId)) {
    clearTimeout(activeTimers.get(messageId));
    activeTimers.delete(messageId);
  }
}

// ── Cancel giveaway when message is deleted ──
async function handleGiveawayMessageDelete(message, client) {
  const guildId = message.guild?.id;
  const messageId = message.id;
  if (!guildId) return;

  const giveaways = getGiveaways(guildId);
  const gw = giveaways[messageId];
  if (!gw || gw.ended) return;

  delete giveaways[messageId];
  saveGiveaways(guildId, giveaways);

  if (activeTimers.has(messageId)) {
    clearTimeout(activeTimers.get(messageId));
    activeTimers.delete(messageId);
  }
}

// ──────────────────────────────────────────────────────────────
// COMMAND HANDLERS
// ──────────────────────────────────────────────────────────────

// .giveaways start <#channel> <duration> <winners> <prize...> --flag value
async function cmdStart(message, args) {
  if (!isStaffOrAdmin(message.member))
    return message.reply(err('You need Staff or Admin to start giveaways.'));

  if (args.length < 4)
    return message.reply(err('Usage: `giveaways start <#channel> <duration> <winners> <prize...>`'));

  const channelMention = args[0];
  const durationStr = args[1];
  const winnersStr = args[2];
  const prize = args.slice(3).join(' ');

  // Resolve channel
  const channelId = channelMention.replace(/[<#>]/g, '');
  const channel = message.guild.channels.cache.get(channelId);
  if (!channel || !channel.isTextBased())
    return message.reply(err('Invalid channel. Mention a text channel.'));

  // Parse duration
  const durationMs = parseDuration(durationStr);
  if (!durationMs)
    return message.reply(err('Invalid duration. Use formats like `1m`, `2h`, `3d`, `1w`.'));

  // Parse winners
  const winnersCount = parseInt(winnersStr);
  if (isNaN(winnersCount) || winnersCount < 1)
    return message.reply(err('Winners must be a positive number.'));

  if (!prize.trim())
    return message.reply(err('Please provide a prize name.'));

  const endAt = Date.now() + durationMs;
  const hostId = message.author.id;

  // ── Parse optional flags ──
  let hostId2 = hostId;
  let description2 = null;
  let requiredMessages = null;
  let gwMsgChannelId = null;
  let requiredVoiceSecs = null;
  let color2 = '#FF6B6B';
  let imageUrl2 = null;
  let thumbnailUrl2 = null;
  let requiredRoles2 = [];
  let minLevel2 = null;
  let maxLevel2 = null;
  let minAge2 = null;
  let minStay2 = null;

  const prizeParts = prize.split(/\s+--/);
  const cleanPrize = prizeParts[0].trim();

  for (let i = 1; i < prizeParts.length; i++) {
    const flag = prizeParts[i].trim();
    const spaceIdx = flag.indexOf(' ');
    const flagName = (spaceIdx === -1 ? flag : flag.slice(0, spaceIdx)).toLowerCase().replace(/[-_]/g, '');
    const flagVal = spaceIdx === -1 ? '' : flag.slice(spaceIdx + 1).trim();

    switch (flagName) {
      case 'host': {
        const uid = flagVal.replace(/[<@!>]/g, '').replace(/\s.*/, '');
        if (/^\d+$/.test(uid)) hostId2 = uid;
        break;
      }
      case 'description':
        description2 = flagVal || null;
        break;
      case 'color': {
        const hex = flagVal.replace(/^#/, '');
        if (/^[0-9A-Fa-f]{6}$/.test(hex)) color2 = `#${hex}`;
        break;
      }
      case 'image':
        imageUrl2 = flagVal || null;
        break;
      case 'thumbnail':
        thumbnailUrl2 = flagVal || null;
        break;
      case 'requiredroles':
      case 'requiredrole':
      case 'roles':
      case 'role': {
        if (!flagVal) {
          requiredRoles2 = [];
        } else {
          requiredRoles2 = flagVal.split(/\s+/).map(r => r.replace(/[<@&>]/g, '')).filter(r => /^\d+$/.test(r));
        }
        break;
      }
      case 'minlevel':
      case 'minlvl': {
        const lvl = parseInt(flagVal);
        if (!isNaN(lvl) && lvl >= 0) minLevel2 = lvl;
        break;
      }
      case 'maxlevel':
      case 'maxlvl': {
        const lvl = parseInt(flagVal);
        if (!isNaN(lvl) && lvl >= 0) maxLevel2 = lvl;
        break;
      }
      case 'age':
      case 'minage': {
        const days = parseInt(flagVal);
        if (!isNaN(days) && days >= 0) minAge2 = days;
        break;
      }
      case 'stay':
      case 'minstay': {
        const days = parseInt(flagVal);
        if (!isNaN(days) && days >= 0) minStay2 = days;
        break;
      }
      case 'requiredmessages':
      case 'reqmessages':
      case 'reqmsgs':
      case 'messages': {
        const parts = flagVal.split(/\s+/);
        const num = parseInt(parts[0]);
        if (!isNaN(num) && num >= 0) {
          requiredMessages = num || null;
          const chanMatch = parts[1]?.match(/^<#(\d+)>$|^(\d+)$/);
          if (chanMatch) gwMsgChannelId = chanMatch[1] || chanMatch[2];
        }
        break;
      }
      case 'requiredvoice':
      case 'reqvoice':
      case 'voicetime': {
        const ms = parseDuration(flagVal);
        if (ms) requiredVoiceSecs = Math.floor(ms / 1000);
        break;
      }
    }
  }

  const gwData = {
    channelId: channel.id,
    prize: cleanPrize,
    winnersCount,
    hostId: hostId2,
    startAt: Date.now(),
    endAt,
    entries: [],
    ended: false,
    winners: [],
    description: description2,
    color: color2,
    imageUrl: imageUrl2,
    thumbnailUrl: thumbnailUrl2,
    requiredRoles: requiredRoles2,
    minLevel: minLevel2,
    maxLevel: maxLevel2,
    minAge: minAge2,
    minStay: minStay2,
    requiredMessages,
    gwMsgChannelId,
    requiredVoiceSecs,
    gwMsgCounts: {},
    gwVoiceSecs: {},
  };

  // Build embed + stats button
  const embed = buildGiveawayEmbed(gwData, 'PLACEHOLDER');
  const statsButton = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`giveaway_stats_PLACEHOLDER`)
      .setLabel('Giveaway Stats')
      .setEmoji('📊')
      .setStyle(ButtonStyle.Secondary)
  );

  const giveawayMsg = await channel.send({ embeds: [embed], components: [statsButton] });
  const messageId = giveawayMsg.id;

  // Update embed with real message ID
  gwData.messageId = messageId;
  const giveaways = getGiveaways(message.guild.id);
  giveaways[messageId] = gwData;
  saveGiveaways(message.guild.id, giveaways);

  // Update message with real button ID
  const realEmbed = buildGiveawayEmbed(gwData, messageId);
  const realButton = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`giveaway_stats_${messageId}`)
      .setLabel('Giveaway Stats')
      .setEmoji('📊')
      .setStyle(ButtonStyle.Secondary)
  );
  await giveawayMsg.edit({ embeds: [realEmbed], components: [realButton] });

  // Add 🎉 reaction for entry
  await giveawayMsg.react('🎉').catch(() => {});

  scheduleGiveaway(message.client, message.guild.id, messageId, endAt);

  return message.reply({
    embeds: [base(COLORS.success)
      .setTitle('🎉 Giveaway Started!')
      .setDescription(`Giveaway for **${cleanPrize}** started in ${channel}!\nEnds <t:${Math.floor(endAt / 1000)}:R>\n[Jump to Giveaway](${giveawayMsg.url})`)
    ]
  });
}

// .giveaways end <message link>
async function cmdEnd(message, args) {
  if (!isStaffOrAdmin(message.member))
    return message.reply(err('You need Staff or Admin to end giveaways.'));

  if (!args[0]) return message.reply(err('Provide a message link.'));
  const parsed = parseMessageLink(args[0]);
  if (!parsed) return message.reply(err('Invalid message link.'));

  const { guildId, messageId } = parsed;
  if (guildId !== message.guild.id) return message.reply(err('That giveaway is not from this server.'));

  const giveaways = getGiveaways(guildId);
  const gw = giveaways[messageId];
  if (!gw) return message.reply(err('Giveaway not found.'));
  if (gw.ended) return message.reply(err('This giveaway has already ended.'));

  await message.reply({ embeds: [base(COLORS.info).setTitle('⏳ Ending giveaway...').setDescription('Please wait.')] });
  await endGiveaway(message.client, guildId, messageId);
  return message.channel.send({ embeds: [base(COLORS.success).setTitle('✅ Giveaway Ended').setDescription(`The giveaway for **${gw.prize}** has been ended.`)] });
}

// .giveaways reroll <message link> [count]
async function cmdReroll(message, args) {
  if (!isStaffOrAdmin(message.member))
    return message.reply(err('You need Staff or Admin to reroll giveaways.'));

  if (!args[0]) return message.reply(err('Provide a message link.'));
  const parsed = parseMessageLink(args[0]);
  if (!parsed) return message.reply(err('Invalid message link.'));

  const { guildId, messageId } = parsed;
  if (guildId !== message.guild.id) return message.reply(err('That giveaway is not from this server.'));

  const giveaways = getGiveaways(guildId);
  const gw = giveaways[messageId];
  if (!gw) return message.reply(err('Giveaway not found.'));
  if (!gw.ended) return message.reply(err('This giveaway has not ended yet. Use `giveaways end` first.'));

  const count = args[1] ? parseInt(args[1]) : gw.winnersCount;
  if (isNaN(count) || count < 1) return message.reply(err('Invalid winner count.'));

  const guild = message.client.guilds.cache.get(guildId);
  const newWinners = pickWinners(gw, count, message.client, guild);
  gw.winners = newWinners;
  saveGiveaways(guildId, giveaways);

  try {
    const channel = await message.client.channels.fetch(gw.channelId).catch(() => null);
    if (channel) {
      const msg = await channel.messages.fetch(messageId).catch(() => null);
      if (msg) {
        const embed = buildEndedEmbed(gw, messageId, newWinners);
        await msg.edit({ embeds: [embed], components: [] }).catch(() => {});
      }
    }
  } catch (e) {}

  if (newWinners.length > 0) {
    return message.reply({
      content: `🎉 Reroll complete! New winners: ${newWinners.map(w => `<@${w}>`).join(', ')} for **${gw.prize}**!`,
    });
  } else {
    return message.reply({ content: `😔 No valid entries to reroll for **${gw.prize}**.` });
  }
}

// .giveaways cancel <message link>
async function cmdCancel(message, args) {
  if (!isStaffOrAdmin(message.member))
    return message.reply(err('You need Staff or Admin to cancel giveaways.'));

  if (!args[0]) return message.reply(err('Provide a message link.'));
  const parsed = parseMessageLink(args[0]);
  if (!parsed) return message.reply(err('Invalid message link.'));

  const { guildId, messageId } = parsed;
  if (guildId !== message.guild.id) return message.reply(err('That giveaway is not from this server.'));

  const giveaways = getGiveaways(guildId);
  const gw = giveaways[messageId];
  if (!gw) return message.reply(err('Giveaway not found.'));
  if (gw.ended) return message.reply(err('This giveaway has already ended.'));

  gw.ended = true;
  gw.winners = [];
  gw.cancelled = true;
  saveGiveaways(guildId, giveaways);

  if (activeTimers.has(messageId)) {
    clearTimeout(activeTimers.get(messageId));
    activeTimers.delete(messageId);
  }

  try {
    const channel = await message.client.channels.fetch(gw.channelId).catch(() => null);
    if (channel) {
      const msg = await channel.messages.fetch(messageId).catch(() => null);
      if (msg) {
        const cancelEmbed = new EmbedBuilder()
          .setColor('#808080')
          .setTitle(`🚫 ${gw.prize}`)
          .setDescription('This giveaway was cancelled.')
          .setTimestamp();
        await msg.edit({ embeds: [cancelEmbed], components: [] }).catch(() => {});
      }
    }
  } catch (e) {}

  return message.reply({
    embeds: [base(COLORS.success).setTitle('✅ Giveaway Cancelled').setDescription(`The giveaway for **${gw.prize}** has been cancelled.`)]
  });
}

// .giveaways list
async function cmdList(message) {
  const giveaways = getGiveaways(message.guild.id);
  const active = Object.entries(giveaways).filter(([, gw]) => !gw.ended);

  if (active.length === 0)
    return message.reply({ embeds: [base(COLORS.info).setTitle('🎉 Active Giveaways').setDescription('No active giveaways in this server.')] });

  const lines = active.map(([msgId, gw]) => {
    const endUnix = Math.floor(gw.endAt / 1000);
    const channelStr = `<#${gw.channelId}>`;
    return `• **${gw.prize}** — ${channelStr} — Ends <t:${endUnix}:R> — 🏆 ${gw.winnersCount} winner(s)\n  [Jump](https://discord.com/channels/${message.guild.id}/${gw.channelId}/${msgId})`;
  });

  const embed = base(COLORS.primary)
    .setTitle(`🎉 Active Giveaways (${active.length})`)
    .setDescription(lines.join('\n\n'));

  return message.reply({ embeds: [embed] });
}

// ── Edit subcommand router ──
async function cmdEdit(message, args) {
  if (!isStaffOrAdmin(message.member))
    return message.reply(err('You need Staff or Admin to edit giveaways.'));

  const subSub = args[0]?.toLowerCase();
  const link = args[1];
  const rest = args.slice(2);

  const validSubs = ['prize','winners','duration','description','color','image','thumbnail','host','requiredroles','minlevel','maxlevel','age','stay','requiredmessages','requiredvoice'];
  if (!subSub || !validSubs.includes(subSub))
    return message.reply(err(`Valid edit options: \`${validSubs.join('`, `')}\``));

  if (!link) return message.reply(err('Provide a message link.'));
  const parsed = parseMessageLink(link);
  if (!parsed) return message.reply(err('Invalid message link.'));

  const { guildId, messageId } = parsed;
  if (guildId !== message.guild.id) return message.reply(err('That giveaway is not from this server.'));

  const giveaways = getGiveaways(guildId);
  const gw = giveaways[messageId];
  if (!gw) return message.reply(err('Giveaway not found.'));
  if (gw.ended) return message.reply(err('Cannot edit an ended giveaway.'));

  if (rest.length === 0 && !['requiredroles'].includes(subSub))
    return message.reply(err('Provide a new value.'));

  switch (subSub) {
    case 'prize':
      gw.prize = rest.join(' ');
      break;

    case 'winners': {
      const n = parseInt(rest[0]);
      if (isNaN(n) || n < 1) return message.reply(err('Provide a valid winner count.'));
      gw.winnersCount = n;
      break;
    }

    case 'duration': {
      const ms = parseDuration(rest[0]);
      if (!ms) return message.reply(err('Invalid duration. Use formats like `1h`, `2d`.'));
      gw.endAt = Date.now() + ms;
      scheduleGiveaway(message.client, guildId, messageId, gw.endAt);
      break;
    }

    case 'description':
      gw.description = rest.join(' ') || null;
      break;

    case 'color': {
      const hex = rest[0];
      if (!/^#?[0-9A-Fa-f]{6}$/.test(hex)) return message.reply(err('Provide a valid hex color (e.g. `#FF6B6B`).'));
      gw.color = hex.startsWith('#') ? hex : `#${hex}`;
      break;
    }

    case 'image':
      gw.imageUrl = rest[0] || null;
      break;

    case 'thumbnail':
      gw.thumbnailUrl = rest[0] || null;
      break;

    case 'host': {
      const userId = rest[0]?.replace(/[<@!>]/g, '');
      if (!userId) return message.reply(err('Mention a user.'));
      gw.hostId = userId;
      break;
    }

    case 'requiredroles': {
      if (rest.length === 0) {
        gw.requiredRoles = [];
      } else {
        gw.requiredRoles = rest.map(r => r.replace(/[<@&>]/g, '')).filter(r => /^\d+$/.test(r));
      }
      break;
    }

    case 'minlevel': {
      const lvl = parseInt(rest[0]);
      if (isNaN(lvl) || lvl < 0) return message.reply(err('Provide a valid level.'));
      gw.minLevel = lvl;
      break;
    }

    case 'maxlevel': {
      const lvl = parseInt(rest[0]);
      if (isNaN(lvl) || lvl < 0) return message.reply(err('Provide a valid level.'));
      gw.maxLevel = lvl;
      break;
    }

    case 'age': {
      const days = parseInt(rest[0]);
      if (isNaN(days) || days < 0) return message.reply(err('Provide valid days.'));
      gw.minAge = days;
      break;
    }

    case 'stay': {
      const days = parseInt(rest[0]);
      if (isNaN(days) || days < 0) return message.reply(err('Provide valid days.'));
      gw.minStay = days;
      break;
    }

    case 'requiredmessages': {
      if (rest.length === 0) { gw.requiredMessages = null; gw.gwMsgChannelId = null; break; }
      const num = parseInt(rest[0]);
      if (isNaN(num) || num < 0) return message.reply(err('Provide a valid message count (or 0 to remove).'));
      gw.requiredMessages = num || null;
      const chanMatch = rest[1]?.match(/^<#(\d+)>$|^(\d+)$/);
      gw.gwMsgChannelId = chanMatch ? (chanMatch[1] || chanMatch[2]) : null;
      if (!gw.gwMsgCounts) gw.gwMsgCounts = {};
      break;
    }

    case 'requiredvoice': {
      if (rest.length === 0 || rest[0] === '0') { gw.requiredVoiceSecs = null; break; }
      const ms = parseDuration(rest[0]);
      if (!ms) return message.reply(err('Invalid duration. Use formats like `1h`, `30m`.'));
      gw.requiredVoiceSecs = Math.floor(ms / 1000);
      if (!gw.gwVoiceSecs) gw.gwVoiceSecs = {};
      break;
    }
  }

  saveGiveaways(guildId, giveaways);

  // Update the live message
  try {
    const channel = await message.client.channels.fetch(gw.channelId).catch(() => null);
    if (channel) {
      const msg = await channel.messages.fetch(messageId).catch(() => null);
      if (msg) {
        const updatedEmbed = buildGiveawayEmbed(gw, messageId);
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`giveaway_stats_${messageId}`)
            .setLabel('Giveaway Stats')
            .setEmoji('📊')
            .setStyle(ButtonStyle.Secondary)
        );
        await msg.edit({ embeds: [updatedEmbed], components: [row] }).catch(() => {});
      }
    }
  } catch (e) {}

  return message.reply({
    embeds: [base(COLORS.success).setTitle('✅ Giveaway Updated').setDescription(`Successfully updated **${subSub}** for the **${gw.prize}** giveaway.`)]
  });
}

// ──────────────────────────────────────────────────────────────
// MAIN COMMAND HANDLER
// ──────────────────────────────────────────────────────────────

async function handleGiveawayCommand(message, args) {
  const sub = args[0]?.toLowerCase();

  if (!sub) {
    return message.reply({
      embeds: [base(COLORS.info)
        .setTitle('🎉 Giveaway Commands')
        .setDescription([
          '`,giveaways start <#channel> <duration> <winners> <prize...> [flags]`',
          '`,giveaways end <message link>`',
          '`,giveaways reroll <message link> [count]`',
          '`,giveaways cancel <message link>`',
          '`,giveaways list`',
          '`,giveaways edit <field> <message link> <value>`',
          '',
          '**Flags:** `--host @user` `--description text` `--color #hex` `--image url` `--thumbnail url`',
          '`--requiredroles @role1 @role2` `--minlevel N` `--maxlevel N` `--age N` `--stay N`',
          '`--requiredmessages N [#channel]` `--requiredvoice <duration>`',
        ].join('\n'))
      ]
    });
  }

  const subArgs = args.slice(1);

  switch (sub) {
    case 'start': return cmdStart(message, subArgs);
    case 'end': return cmdEnd(message, subArgs);
    case 'reroll': return cmdReroll(message, subArgs);
    case 'cancel': return cmdCancel(message, subArgs);
    case 'list': return cmdList(message);
    case 'edit': return cmdEdit(message, subArgs);
    default:
      return message.reply(err(`Unknown subcommand \`${sub}\`. Use \`giveaways\` to see available commands.`));
  }
}

// ──────────────────────────────────────────────────────────────
// REACTION HANDLER — 🎉 to enter/leave
// ──────────────────────────────────────────────────────────────

async function handleGiveawayReactionAdd(reaction, user, client) {
  if (user.bot) return;
  if (reaction.emoji.name !== '🎉') return;

  const message = reaction.message;
  if (!message.guild) return;

  const guildId = message.guild.id;
  const messageId = message.id;
  const userId = user.id;

  const giveaways = getGiveaways(guildId);
  const gw = giveaways[messageId];
  if (!gw || gw.ended) return;
  if (Date.now() > gw.endAt) return;

  // Add entry
  if (!gw.entries.includes(userId)) {
    gw.entries.push(userId);
    saveGiveaways(guildId, giveaways);
  }
}

async function handleGiveawayReactionRemove(reaction, user, client) {
  if (user.bot) return;
  if (reaction.emoji.name !== '🎉') return;

  const message = reaction.message;
  if (!message.guild) return;

  const guildId = message.guild.id;
  const messageId = message.id;
  const userId = user.id;

  const giveaways = getGiveaways(guildId);
  const gw = giveaways[messageId];
  if (!gw || gw.ended) return;

  // Remove entry
  const idx = gw.entries.indexOf(userId);
  if (idx !== -1) {
    gw.entries.splice(idx, 1);
    saveGiveaways(guildId, giveaways);
  }
}

// ──────────────────────────────────────────────────────────────
// BUTTON HANDLER — Giveaway Stats
// ──────────────────────────────────────────────────────────────

async function handleGiveawayButton(interaction) {
  if (!interaction.customId.startsWith('giveaway_stats_')) return false; // not ours

  const messageId = interaction.customId.replace('giveaway_stats_', '');
  const guildId = interaction.guild.id;

  const giveaways = getGiveaways(guildId);
  const gw = giveaways[messageId];

  if (!gw) {
    return interaction.reply({ content: '❌ This giveaway no longer exists.', ephemeral: true });
  }

  const userId = interaction.user.id;
  const member = interaction.member;

  const missing = buildMissingText(gw, userId, member, guildId);

  if (missing.length > 0) {
    return interaction.reply({
      content: missing.map(m => `• ${m}`).join('\n'),
      ephemeral: true,
    });
  }

  return interaction.reply({
    content: '✅ **You meet all requirements to win!**',
    ephemeral: true,
  });
}

// ──────────────────────────────────────────────────────────────
// RESTORE TIMERS ON BOT START
// ──────────────────────────────────────────────────────────────

async function restoreGiveawayTimers(client) {
  const { readdirSync, existsSync } = require('fs');
  const { join } = require('path');
  const DB_DIR = join(__dirname, '..', 'db');
  if (!existsSync(DB_DIR)) return;

  let files;
  try { files = readdirSync(DB_DIR); } catch { return; }

  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const guildId = file.replace('.json', '');
    const db = getGuildDb(guildId);
    const giveaways = db.get('giveaways', {});

    for (const [messageId, gw] of Object.entries(giveaways)) {
      if (gw.ended) continue;

      if (Date.now() >= gw.endAt) {
        endGiveaway(client, guildId, messageId).catch(() => {});
      } else {
        scheduleGiveaway(client, guildId, messageId, gw.endAt);
      }
    }

    const hasActiveVoiceGiveaway = Object.values(giveaways).some(
      gw => !gw.ended && Date.now() < gw.endAt && gw.requiredVoiceSecs != null
    );
    if (hasActiveVoiceGiveaway) {
      const guild = client.guilds.cache.get(guildId);
      if (guild) {
        for (const channel of guild.channels.cache.values()) {
          if (!channel.isVoiceBased || !channel.isVoiceBased()) continue;
          for (const [memberId] of channel.members) {
            const key = `${guildId}_${memberId}`;
            if (!gwVoiceJoinMap.has(key)) {
              gwVoiceJoinMap.set(key, Date.now());
            }
          }
        }
      }
    }
  }
}

// ──────────────────────────────────────────────────────────────
// GIVEAWAY TRACKING
// ──────────────────────────────────────────────────────────────

const gwVoiceJoinMap = new Map();

function trackGiveawayMessage(guildId, userId, channelId) {
  const db = getGuildDb(guildId);
  const giveaways = db.get('giveaways', {});
  let dirty = false;
  for (const gw of Object.values(giveaways)) {
    if (gw.ended || Date.now() >= gw.endAt) continue;
    if (gw.requiredMessages == null) continue;
    if (gw.gwMsgChannelId && channelId !== gw.gwMsgChannelId) continue;
    if (!gw.gwMsgCounts) gw.gwMsgCounts = {};
    gw.gwMsgCounts[userId] = (gw.gwMsgCounts[userId] || 0) + 1;
    dirty = true;
  }
  if (dirty) db.set('giveaways', giveaways);
}

function trackGiveawayVoice(guildId, userId, event) {
  const key = `${guildId}_${userId}`;
  if (event === 'join') {
    gwVoiceJoinMap.set(key, Date.now());
    return;
  }
  const joinTime = gwVoiceJoinMap.get(key);
  gwVoiceJoinMap.delete(key);
  if (!joinTime) return;

  const leaveTime = Date.now();
  const db = getGuildDb(guildId);
  const giveaways = db.get('giveaways', {});
  let dirty = false;
  for (const gw of Object.values(giveaways)) {
    if (gw.ended || leaveTime >= gw.endAt) continue;
    if (gw.requiredVoiceSecs == null) continue;
    const effectiveJoin = Math.max(joinTime, gw.startAt || 0);
    const elapsed = Math.floor((leaveTime - effectiveJoin) / 1000);
    if (elapsed <= 0) continue;
    if (!gw.gwVoiceSecs) gw.gwVoiceSecs = {};
    gw.gwVoiceSecs[userId] = (gw.gwVoiceSecs[userId] || 0) + elapsed;
    dirty = true;
  }
  if (dirty) db.set('giveaways', giveaways);
}

module.exports = {
  handleGiveawayCommand,
  handleGiveawayButton,
  handleGiveawayReactionAdd,
  handleGiveawayReactionRemove,
  handleGiveawayMessageDelete,
  restoreGiveawayTimers,
  trackGiveawayMessage,
  trackGiveawayVoice,
};