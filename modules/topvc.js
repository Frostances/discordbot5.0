/**
 * topvc.js — TOPVC Leaderboard System
 *
 * Commands (requires ManageChannels or Admin):
 * .topvc setup — creates #top-vc channel with leaderboards
 * .topvc voicetime enable/disable — toggle voice time leaderboard
 * .topvc streams enable/disable — toggle stream/camera leaderboard
 *
 * Storage (guild DB):
 * 'topvcConfig' → { channelId, voiceTimeEnabled: true, streamsEnabled: false }
 * 'vcStats' → { [guildId]: { [userId]: { totalMs, daily: {}, weekly: {}, monthly: {}, streamMs, cameraMs, streamDaily: {}, cameraDaily: {}, lastJoin, lastStreamJoin, lastCameraJoin, inVc, streaming, cameraOn } } }
 * 'topvcMessages' → { voiceTimeMsgId }
 *
 * Leaderboards refresh every 1 minute.
 * Tracks last 7 days only.
 */

const { PermissionFlagsBits, EmbedBuilder, ChannelType } = require('discord.js');
const { getGuildDb } = require('./database');
const { isAdmin } = require('./helpers');
const { base, COLORS } = require('../utils/embeds');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getTodayStr() {
  return new Date().toISOString().split('T')[0];
}

function getWeekKey() {
  const d = new Date();
  const day = d.getDay() || 7;
  d.setDate(d.getDate() - day + 1);
  return d.toISOString().split('T')[0];
}

function getMonthKey() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

function get7DaysAgo() {
  const d = new Date();
  d.setDate(d.getDate() - 6);
  return d.toISOString().split('T')[0];
}

/**
 * Format milliseconds to "Xh Ym" or "Y minutes".
 * Examples: 5400000ms → "1h 30m", 1500000ms → "25m"
 */
function formatTime(ms) {
  if (!ms || ms <= 0) return '0m';
  const totalMinutes = Math.floor(ms / (1000 * 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0 && minutes > 0) return hours + 'h ' + minutes + 'm';
  if (hours > 0) return hours + 'h';
  return minutes + 'm';
}

function getNumberEmoji(n) {
  const emojis = [
    '<:one:1532405922364915742>',
    '<:two:1532405967118139533>',
    '<:three:1532406006909505830>',
    '<:four:1532406058880864366>',
    '<:five:1532406105479843881>',
    '<:six:1532406137952014477>',
    '<:seven:1532406171028160552>',
    '<:eight:1532406201361502332>',
    '<:nine:1532406243094954166>',
    '<:ten:1532407166672175226>',
  ];
  return emojis[n] || ('`' + (n + 1) + '.`');
}

function getOrCreateUserStats(db, guildId, userId) {
  const stats = db.get('vcStats', {});
  if (!stats[guildId]) stats[guildId] = {};
  if (!stats[guildId][userId]) {
    stats[guildId][userId] = {
      totalMs: 0,
      daily: {},
      weekly: {},
      monthly: {},
      streamMs: 0,
      cameraMs: 0,
      streamDaily: {},
      cameraDaily: {},
      lastJoin: null,
      lastStreamJoin: null,
      lastCameraJoin: null,
      inVc: false,
      streaming: false,
      cameraOn: false,
    };
  }
  db.set('vcStats', stats);
  return stats[guildId][userId];
}

/**
 * Validate that the user's DB state matches their actual Discord voice state.
 * If they left while the bot was offline, this fixes stale inVc/streaming/cameraOn flags
 * and flushes any accumulated time to the daily buckets.
 * Returns true if state was fixed (data was mutated).
 */
function validateVcState(guild, userId, userData) {
  const member = guild.members.cache.get(userId);
  const voiceChannel = member?.voice?.channel;
  const now = Date.now();
  let fixed = false;

  // If DB says they're in VC but they're actually not — flush and reset
  if (userData.inVc && !voiceChannel) {
    if (userData.lastJoin) {
      const duration = now - userData.lastJoin;
      const today = getTodayStr();
      const week = getWeekKey();
      const month = getMonthKey();
      userData.totalMs += duration;
      userData.daily[today] = (userData.daily[today] || 0) + duration;
      userData.weekly[week] = (userData.weekly[week] || 0) + duration;
      userData.monthly[month] = (userData.monthly[month] || 0) + duration;
    }
    if (userData.streaming && userData.lastStreamJoin) {
      const duration = now - userData.lastStreamJoin;
      const today = getTodayStr();
      userData.streamMs += duration;
      userData.streamDaily[today] = (userData.streamDaily[today] || 0) + duration;
    }
    if (userData.cameraOn && userData.lastCameraJoin) {
      const duration = now - userData.lastCameraJoin;
      const today = getTodayStr();
      userData.cameraMs += duration;
      userData.cameraDaily[today] = (userData.cameraDaily[today] || 0) + duration;
    }
    userData.inVc = false;
    userData.streaming = false;
    userData.cameraOn = false;
    userData.lastJoin = null;
    userData.lastStreamJoin = null;
    userData.lastCameraJoin = null;
    fixed = true;
  }

  // If they ARE in a voice channel, verify streaming/camera flags match reality
  if (voiceChannel) {
    const isStreaming = member.voice.streaming || false;
    const isCameraOn = member.voice.selfVideo || false;

    // Fix stale streaming flag
    if (userData.streaming && !isStreaming && userData.lastStreamJoin) {
      const duration = now - userData.lastStreamJoin;
      const today = getTodayStr();
      userData.streamMs += duration;
      userData.streamDaily[today] = (userData.streamDaily[today] || 0) + duration;
      userData.streaming = false;
      userData.lastStreamJoin = null;
      fixed = true;
    }
    if (!userData.streaming && isStreaming) {
      userData.streaming = true;
      userData.lastStreamJoin = now;
    }

    // Fix stale camera flag
    if (userData.cameraOn && !isCameraOn && userData.lastCameraJoin) {
      const duration = now - userData.lastCameraJoin;
      const today = getTodayStr();
      userData.cameraMs += duration;
      userData.cameraDaily[today] = (userData.cameraDaily[today] || 0) + duration;
      userData.cameraOn = false;
      userData.lastCameraJoin = null;
      fixed = true;
    }
    if (!userData.cameraOn && isCameraOn) {
      userData.cameraOn = true;
      userData.lastCameraJoin = now;
    }
  }

  return fixed;
}

/**
 * Get ONLY the current live session time (not all-time total).
 * Validates actual Discord state first to fix stale flags.
 */
function getLiveTotal(guild, userId, userData, field) {
  validateVcState(guild, userId, userData);
  const now = Date.now();
  if (field === 'daily' && userData.inVc && userData.lastJoin) {
    return now - userData.lastJoin;
  }
  if (field === 'streamDaily' && userData.streaming && userData.lastStreamJoin) {
    return now - userData.lastStreamJoin;
  }
  if (field === 'cameraDaily' && userData.cameraOn && userData.lastCameraJoin) {
    return now - userData.lastCameraJoin;
  }
  return 0;
}

function get7DayTotal(guild, userId, userData, field) {
  validateVcState(guild, userId, userData);
  const cutoff = get7DaysAgo();
  let total = 0;
  for (const [date, ms] of Object.entries(userData[field] || {})) {
    if (date >= cutoff) total += ms;
  }
  const now = Date.now();
  if (field === 'daily' && userData.inVc && userData.lastJoin) {
    total += (now - userData.lastJoin);
  }
  if (field === 'streamDaily' && userData.streaming && userData.lastStreamJoin) {
    total += (now - userData.lastStreamJoin);
  }
  if (field === 'cameraDaily' && userData.cameraOn && userData.lastCameraJoin) {
    total += (now - userData.lastCameraJoin);
  }
  return total;
}

// ─── Voice State Tracking ─────────────────────────────────────────────────────

async function trackTopVcVoiceState(oldState, newState, client) {
  const guildId = newState.guild ? newState.guild.id : (oldState.guild ? oldState.guild.id : null);
  const userId = newState.id || oldState.id;
  if (!guildId || !userId) return;

  // FIX: Skip bots
  const member = newState.member || oldState.member;
  if (member?.user?.bot) return;

  const db = getGuildDb(guildId);
  const userData = getOrCreateUserStats(db, guildId, userId);
  const now = Date.now();

  // JOIN VC
  if (!oldState.channel && newState.channel) {
    userData.inVc = true;
    userData.lastJoin = now;
    if (newState.streaming) { userData.streaming = true; userData.lastStreamJoin = now; }
    if (newState.selfVideo) { userData.cameraOn = true; userData.lastCameraJoin = now; }
  }

  // LEAVE VC
  if (oldState.channel && !newState.channel) {
    if (userData.lastJoin && userData.inVc) {
      const duration = now - userData.lastJoin;
      const today = getTodayStr();
      const week = getWeekKey();
      const month = getMonthKey();
      userData.totalMs += duration;
      userData.daily[today] = (userData.daily[today] || 0) + duration;
      userData.weekly[week] = (userData.weekly[week] || 0) + duration;
      userData.monthly[month] = (userData.monthly[month] || 0) + duration;
    }
    if (userData.streaming && userData.lastStreamJoin) {
      const duration = now - userData.lastStreamJoin;
      const today = getTodayStr();
      userData.streamMs += duration;
      userData.streamDaily[today] = (userData.streamDaily[today] || 0) + duration;
    }
    if (userData.cameraOn && userData.lastCameraJoin) {
      const duration = now - userData.lastCameraJoin;
      const today = getTodayStr();
      userData.cameraMs += duration;
      userData.cameraDaily[today] = (userData.cameraDaily[today] || 0) + duration;
    }
    userData.inVc = false;
    userData.streaming = false;
    userData.cameraOn = false;
    userData.lastJoin = null;
    userData.lastStreamJoin = null;
    userData.lastCameraJoin = null;
  }

  // SWITCH VC
  if (oldState.channel && newState.channel && oldState.channel.id !== newState.channel.id) {
    if (userData.lastJoin && userData.inVc) {
      const duration = now - userData.lastJoin;
      const today = getTodayStr();
      const week = getWeekKey();
      const month = getMonthKey();
      userData.totalMs += duration;
      userData.daily[today] = (userData.daily[today] || 0) + duration;
      userData.weekly[week] = (userData.weekly[week] || 0) + duration;
      userData.monthly[month] = (userData.monthly[month] || 0) + duration;
    }
    if (userData.streaming && userData.lastStreamJoin) {
      const duration = now - userData.lastStreamJoin;
      const today = getTodayStr();
      userData.streamMs += duration;
      userData.streamDaily[today] = (userData.streamDaily[today] || 0) + duration;
    }
    if (userData.cameraOn && userData.lastCameraJoin) {
      const duration = now - userData.lastCameraJoin;
      const today = getTodayStr();
      userData.cameraMs += duration;
      userData.cameraDaily[today] = (userData.cameraDaily[today] || 0) + duration;
    }
    userData.lastJoin = now;
    userData.lastStreamJoin = newState.streaming ? now : null;
    userData.lastCameraJoin = newState.selfVideo ? now : null;
    userData.inVc = true;
    userData.streaming = newState.streaming;
    userData.cameraOn = newState.selfVideo;
  }

  // STREAM / CAMERA TOGGLE while in same VC
  if (oldState.channel && newState.channel && oldState.channel.id === newState.channel.id) {
    if (!oldState.streaming && newState.streaming) {
      userData.streaming = true;
      userData.lastStreamJoin = now;
    }
    if (oldState.streaming && !newState.streaming) {
      if (userData.lastStreamJoin) {
        const duration = now - userData.lastStreamJoin;
        const today = getTodayStr();
        userData.streamMs += duration;
        userData.streamDaily[today] = (userData.streamDaily[today] || 0) + duration;
      }
      userData.streaming = false;
      userData.lastStreamJoin = null;
    }
    if (!oldState.selfVideo && newState.selfVideo) {
      userData.cameraOn = true;
      userData.lastCameraJoin = now;
    }
    if (oldState.selfVideo && !newState.selfVideo) {
      if (userData.lastCameraJoin) {
        const duration = now - userData.lastCameraJoin;
        const today = getTodayStr();
        userData.cameraMs += duration;
        userData.cameraDaily[today] = (userData.cameraDaily[today] || 0) + duration;
      }
      userData.cameraOn = false;
      userData.lastCameraJoin = null;
    }
  }

  db.set('vcStats', db.get('vcStats', {}));
}

// ─── Leaderboard Builders ─────────────────────────────────────────────────────

async function buildVoiceTimeLeaderboard(guild, db) {
  const stats = db.get('vcStats', {});
  const guildStats = stats[guild.id] || {};
  const cutoff = get7DaysAgo();

  const sorted = Object.entries(guildStats)
    .map(([uid, data]) => {
      // FIX: Skip bots
      const member = guild.members.cache.get(uid);
      if (member?.user?.bot) return null;

      let total7d = 0;
      for (const [date, ms] of Object.entries(data.daily || {})) {
        if (date >= cutoff) total7d += ms;
      }
      // Add ONLY current live session time (getLiveTotal now returns live time only, not all-time)
      total7d += getLiveTotal(guild, uid, data, 'daily');
      return { uid, total7d };
    })
    .filter(u => u && u.total7d > 0)
    .sort((a, b) => b.total7d - a.total7d)
    .slice(0, 10);

  let desc = '';
  for (let i = 0; i < sorted.length; i++) {
    const u = sorted[i];
    desc += getNumberEmoji(i) + ' <@' + u.uid + '> — **' + formatTime(u.total7d) + '**\n';
  }

  return new EmbedBuilder()
    .setColor('#5865F2')
    .setTitle('Top 10 - VC Champions (last 7 days)')
    .setDescription(desc || 'No data yet.')
    .setTimestamp();
}

async function buildStreamsLeaderboard(guild, db) {
  const stats = db.get('vcStats', {});
  const guildStats = stats[guild.id] || {};
  const cutoff = get7DaysAgo();

  const sorted = Object.entries(guildStats)
    .map(([uid, data]) => {
      // FIX: Skip bots
      const member = guild.members.cache.get(uid);
      if (member?.user?.bot) return null;

      // COMBINED: stream time + camera time
      let total7d = 0;
      for (const [date, ms] of Object.entries(data.streamDaily || {})) {
        if (date >= cutoff) total7d += ms;
      }
      for (const [date, ms] of Object.entries(data.cameraDaily || {})) {
        if (date >= cutoff) total7d += ms;
      }
      // Add ONLY current live session time
      total7d += getLiveTotal(guild, uid, data, 'streamDaily');
      total7d += getLiveTotal(guild, uid, data, 'cameraDaily');
      return { uid, total7d };
    })
    .filter(u => u && u.total7d > 0)
    .sort((a, b) => b.total7d - a.total7d)
    .slice(0, 10);

  let desc = '';
  for (let i = 0; i < sorted.length; i++) {
    const u = sorted[i];
    desc += getNumberEmoji(i) + ' <@' + u.uid + '> — **' + formatTime(u.total7d) + '**\n';
  }

  return new EmbedBuilder()
    .setColor('#FF69B4')
    .setTitle('Top 10 - Cam/Streamers (last 7 days)')
    .setDescription(desc || 'No data yet.')
    .setTimestamp();
}

// ─── Refresh Leaderboards ────────────────────────────────────────────────────

async function refreshTopVcLeaderboards(client) {
  for (const guild of client.guilds.cache.values()) {
    const db = getGuildDb(guild.id);
    const cfg = db.get('topvcConfig', {});
    if (!cfg.channelId) continue;

    const channel = guild.channels.cache.get(cfg.channelId);
    if (!channel) continue;

    const msgs = db.get('topvcMessages', {});
    const embeds = [];

    if (cfg.voiceTimeEnabled !== false) {
      const vtEmbed = await buildVoiceTimeLeaderboard(guild, db);
      embeds.push(vtEmbed);
    }
    if (cfg.streamsEnabled) {
      const stEmbed = await buildStreamsLeaderboard(guild, db);
      embeds.push(stEmbed);
    }

    if (embeds.length === 0) continue;

    try {
      if (msgs.voiceTimeMsgId) {
        try {
          const msg = await channel.messages.fetch(msgs.voiceTimeMsgId);
          await msg.edit({ embeds });
        } catch {
          const msg = await channel.send({ embeds });
          msgs.voiceTimeMsgId = msg.id;
          db.set('topvcMessages', msgs);
        }
      } else {
        const msg = await channel.send({ embeds });
        msgs.voiceTimeMsgId = msg.id;
        db.set('topvcMessages', msgs);
      }
    } catch (err) {
      // silently fail
    }
  }
}

// ─── Command Handler ──────────────────────────────────────────────────────────

async function handleTopVcCommand(message, args) {
  const sub = (args[0] || '').toLowerCase();
  const db = getGuildDb(message.guild.id);
  const cfg = db.get('topvcConfig', {});

  const canManage = message.member.permissions.has(PermissionFlagsBits.ManageChannels) || isAdmin(message.member);

  if (!canManage) {
    return message.reply({ embeds: [base(COLORS.error).setTitle('No Permission').setDescription('You need **Manage Channels** or admin to use TOPVC commands.')
    ] });
  }

  // ── setup ──
  if (sub === 'setup') {
    try {
      const channel = await message.guild.channels.create({
        name: 'top-vc',
        type: ChannelType.GuildText,
        permissionOverwrites: [
          { id: message.guild.roles.everyone, allow: [PermissionFlagsBits.ViewChannel], deny: [PermissionFlagsBits.SendMessages] },
        ],
      });
      cfg.channelId = channel.id;
      cfg.voiceTimeEnabled = true;
      cfg.streamsEnabled = false;
      db.set('topvcConfig', cfg);

      const vtEmbed = await buildVoiceTimeLeaderboard(message.guild, db);
      const msg = await channel.send({ embeds: [vtEmbed] });
      db.set('topvcMessages', { voiceTimeMsgId: msg.id });

      return message.reply({ embeds: [base(COLORS.success).setTitle('TOPVC Setup Complete').setDescription('Created <#' + channel.id + '> with voice time leaderboard.\nUse `.topvc streams enable` to also show stream/camera leaderboard.')
      ] });
    } catch (e) {
      return message.reply({ embeds: [base(COLORS.error).setTitle('Failed').setDescription('Could not create channel: ' + e.message)
      ] });
    }
  }

  // ── voicetime enable/disable ──
  if (sub === 'voicetime') {
    const action = (args[1] || '').toLowerCase();
    if (action === 'enable') {
      cfg.voiceTimeEnabled = true; db.set('topvcConfig', cfg);
      return message.reply({ embeds: [base(COLORS.success).setTitle('Voice Time Leaderboard Enabled')
      ] });
    }
    if (action === 'disable') {
      cfg.voiceTimeEnabled = false; db.set('topvcConfig', cfg);
      return message.reply({ embeds: [base(COLORS.success).setTitle('Voice Time Leaderboard Disabled')
      ] });
    }
    return message.reply({ embeds: [base(COLORS.error).setTitle('Invalid').setDescription('Usage: `.topvc voicetime enable/disable`')
    ] });
  }

  // ── streams enable/disable ──
  if (sub === 'streams' || sub === 'camera') {
    const action = (args[1] || '').toLowerCase();
    if (action === 'enable') {
      cfg.streamsEnabled = true; db.set('topvcConfig', cfg);
      return message.reply({ embeds: [base(COLORS.success).setTitle('Stream/Camera Leaderboard Enabled')
      ] });
    }
    if (action === 'disable') {
      cfg.streamsEnabled = false; db.set('topvcConfig', cfg);
      return message.reply({ embeds: [base(COLORS.success).setTitle('Stream/Camera Leaderboard Disabled')
      ] });
    }
    return message.reply({ embeds: [base(COLORS.error).setTitle('Invalid').setDescription('Usage: `.topvc streams enable/disable`')
    ] });
  }

  // ── help ──
  return message.reply({ embeds: [base(COLORS.primary).setTitle('TOPVC Help')
    .setDescription('**Admin Commands (requires Manage Channels):**\n'
      + '`.topvc setup` — create the #top-vc channel\n'
      + '`.topvc voicetime enable/disable` — toggle voice time leaderboard\n'
      + '`.topvc streams enable/disable` — toggle stream/camera leaderboard\n\n'
      + '**Leaderboards refresh every 1 minute automatically.**')
  ] });
}

async function handleTopVcClear(message) {
  const { isAdmin } = require('./helpers');
  if (!isAdmin(message.member)) {
    return message.reply({ content: '❌ Only the server owner or bot admins can clear TOPVC data.', ephemeral: true });
  }

  const db = getGuildDb(message.guild.id);
  db.set('vcStats', {});
  db.set('topvcMessages', {});

  return message.reply({ content: '✅ All TOPVC leaderboard data has been cleared for this server.' });
}

module.exports = {
  handleTopVcCommand,
  trackTopVcVoiceState,
  refreshTopVcLeaderboards,
  getOrCreateUserStats,
  validateVcState,
  handleTopVcClear,
};