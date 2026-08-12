/**
 * stats.js — User Stats System
 *
 * Commands:
 * .voicetime [@user] — voice time stats (today, week, month)
 * .messages [@user] — message stats (today, week, month)
 * .streamtime [@user] — stream time stats (today, week, month)
 * .cameratime [@user] — camera time stats (today, week, month)
 *
 * Storage (guild DB):
 * 'vcStats' → { [guildId]: { [userId]: { totalMs, daily, weekly, monthly, streamMs, cameraMs, streamDaily, cameraDaily, lastJoin, lastStreamJoin, lastCameraJoin, inVc, streaming, cameraOn } } }
 * 'messageStats' → { [guildId]: { [userId]: { daily: {}, weekly: {}, monthly: {}, total: 0 } } }
 */

const { EmbedBuilder } = require('discord.js');
const { getGuildDb } = require('./database');
const { base, COLORS } = require('../utils/embeds');

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

function formatDuration(ms) {
  if (!ms || ms <= 0) return '0m';
  const totalMinutes = Math.floor(ms / (1000 * 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0 && minutes > 0) return hours + 'h ' + minutes + 'm';
  if (hours > 0) return hours + 'h';
  return minutes + 'm';
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
 * Calculate total from daily entries for a given date range.
 * Validates actual Discord state before adding live time.
 */
function getDailyTotal(guild, userId, userData, period, field) {
  validateVcState(guild, userId, userData);
  const obj = userData[field] || {};
  if (period === 'today') {
    return obj[getTodayStr()] || 0;
  }
  if (period === 'week') {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 6);
    const cutoffStr = cutoff.toISOString().split('T')[0];
    let total = 0;
    for (const [date, ms] of Object.entries(obj)) {
      if (date >= cutoffStr) total += ms;
    }
    return total;
  }
  if (period === 'month') {
    // FIX: Use last 30 days instead of calendar month so month is always >= week
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 29);
    const cutoffStr = cutoff.toISOString().split('T')[0];
    let total = 0;
    for (const [date, ms] of Object.entries(obj)) {
      if (date >= cutoffStr) total += ms;
    }
    return total;
  }
  return 0;
}

/**
 * Add live session time if user is currently in VC/streaming/camera.
 * Validates actual Discord state first.
 */
function addLiveTime(guild, userId, userData, field, period) {
  validateVcState(guild, userId, userData);
  const now = Date.now();
  let extra = 0;

  if (field === 'daily' && userData.inVc && userData.lastJoin) {
    extra = now - userData.lastJoin;
  }
  if (field === 'streamDaily' && userData.streaming && userData.lastStreamJoin) {
    extra = now - userData.lastStreamJoin;
  }
  if (field === 'cameraDaily' && userData.cameraOn && userData.lastCameraJoin) {
    extra = now - userData.lastCameraJoin;
  }

  // For week/month, only add if the session started within the period
  if (period === 'today') return extra;
  if (period === 'week') {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 6);
    const sessionStart = field === 'daily' ? userData.lastJoin :
      field === 'streamDaily' ? userData.lastStreamJoin :
      field === 'cameraDaily' ? userData.lastCameraJoin : null;
    if (sessionStart) {
      const sessionStartStr = new Date(sessionStart).toISOString().split('T')[0];
      if (sessionStartStr >= cutoff.toISOString().split('T')[0]) return extra;
    }
    return 0;
  }
  if (period === 'month') {
    // FIX: Use last 30 days cutoff to match getDailyTotal
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 29);
    const sessionStart = field === 'daily' ? userData.lastJoin :
      field === 'streamDaily' ? userData.lastStreamJoin :
      field === 'cameraDaily' ? userData.lastCameraJoin : null;
    if (sessionStart) {
      const sessionStartStr = new Date(sessionStart).toISOString().split('T')[0];
      if (sessionStartStr >= cutoff.toISOString().split('T')[0]) return extra;
    }
    return 0;
  }
  return 0;
}

// ─── Message Tracking ───────────────────────────────────────────────────────────

function trackMessage(guildId, userId, db) {
  const stats = db.get('messageStats', {});
  if (!stats[guildId]) stats[guildId] = {};
  if (!stats[guildId][userId]) {
    stats[guildId][userId] = { daily: {}, weekly: {}, monthly: {}, total: 0 };
  }
  const today = getTodayStr();
  const week = getWeekKey();
  const month = getMonthKey();

  stats[guildId][userId].daily[today] = (stats[guildId][userId].daily[today] || 0) + 1;
  stats[guildId][userId].weekly[week] = (stats[guildId][userId].weekly[week] || 0) + 1;
  stats[guildId][userId].monthly[month] = (stats[guildId][userId].monthly[month] || 0) + 1;
  stats[guildId][userId].total += 1;
  db.set('messageStats', stats);
}

// ─── Stats Embed Builder ──────────────────────────────────────────────────────

async function buildStatsEmbed(title, icon, color, target, todayVal, weekVal, monthVal, formatter) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(icon + ' ' + title + ' — ' + (target.displayName || target.user?.username || 'Unknown'))
    .setThumbnail(target.displayAvatarURL?.() || target.user?.displayAvatarURL?.() || null)
    .addFields(
      { name: '\u200B', value: '**📅 Today**\n' + formatter(todayVal), inline: true },
      { name: '\u200B', value: '**📆 This Week**\n' + formatter(weekVal), inline: true },
      { name: '\u200B', value: '**📊 This Month**\n' + formatter(monthVal), inline: true },
    )
    .setTimestamp()
    .setFooter({ text: 'Kaido Stats' });
}

// ─── Command Handlers ─────────────────────────────────────────────────────────

async function handleVoiceTimeStats(message, args) {
  const target = message.mentions.members?.first() || message.member;
  const db = getGuildDb(message.guild.id);
  const stats = db.get('vcStats', {});
  if (!stats[message.guild.id]) stats[message.guild.id] = {};
  if (!stats[message.guild.id][target.id]) {
    stats[message.guild.id][target.id] = {
      totalMs: 0, daily: {}, weekly: {}, monthly: {},
      streamMs: 0, cameraMs: 0, streamDaily: {}, cameraDaily: {},
      lastJoin: null, lastStreamJoin: null, lastCameraJoin: null,
      inVc: false, streaming: false, cameraOn: false,
    };
  }
  const userData = stats[message.guild.id][target.id];

  const todayMs = getDailyTotal(message.guild, target.id, userData, 'today', 'daily') + addLiveTime(message.guild, target.id, userData, 'daily', 'today');
  const weekMs = getDailyTotal(message.guild, target.id, userData, 'week', 'daily') + addLiveTime(message.guild, target.id, userData, 'daily', 'week');
  const monthMs = getDailyTotal(message.guild, target.id, userData, 'month', 'daily') + addLiveTime(message.guild, target.id, userData, 'daily', 'month');

  // FIX: Save any state fixes (stale inVc flushes) back to DB so they persist
  db.set('vcStats', stats);

  const embed = await buildStatsEmbed('Voice Time', '\uD83C\uDF99', '#5865F2', target, todayMs, weekMs, monthMs, formatDuration);
  return message.reply({ embeds: [embed] });
}

async function handleMessageStats(message, args) {
  const target = message.mentions.members?.first() || message.member;
  const db = getGuildDb(message.guild.id);
  const stats = db.get('messageStats', {});
  const userData = (stats[message.guild.id] || {})[target.id] || { daily: {}, weekly: {}, monthly: {}, total: 0 };

  const todayCount = userData.daily[getTodayStr()] || 0;
  const weekCount = userData.weekly[getWeekKey()] || 0;
  const monthCount = userData.monthly[getMonthKey()] || 0;

  const embed = await buildStatsEmbed('Messages', '\uD83D\uDCAC', '#57F287', target, todayCount, weekCount, monthCount, v => (v || 0) + ' messages');
  return message.reply({ embeds: [embed] });
}

async function handleStreamTimeStats(message, args) {
  const target = message.mentions.members?.first() || message.member;
  const db = getGuildDb(message.guild.id);
  const stats = db.get('vcStats', {});
  if (!stats[message.guild.id]) stats[message.guild.id] = {};
  if (!stats[message.guild.id][target.id]) {
    stats[message.guild.id][target.id] = {
      totalMs: 0, daily: {}, weekly: {}, monthly: {},
      streamMs: 0, cameraMs: 0, streamDaily: {}, cameraDaily: {},
      lastJoin: null, lastStreamJoin: null, lastCameraJoin: null,
      inVc: false, streaming: false, cameraOn: false,
    };
  }
  const userData = stats[message.guild.id][target.id];

  const todayMs = getDailyTotal(message.guild, target.id, userData, 'today', 'streamDaily') + addLiveTime(message.guild, target.id, userData, 'streamDaily', 'today');
  const weekMs = getDailyTotal(message.guild, target.id, userData, 'week', 'streamDaily') + addLiveTime(message.guild, target.id, userData, 'streamDaily', 'week');
  const monthMs = getDailyTotal(message.guild, target.id, userData, 'month', 'streamDaily') + addLiveTime(message.guild, target.id, userData, 'streamDaily', 'month');

  // FIX: Save any state fixes back to DB
  db.set('vcStats', stats);

  const embed = await buildStatsEmbed('Stream Time', '\uD83D\uDCE1', '#FF69B4', target, todayMs, weekMs, monthMs, formatDuration);
  return message.reply({ embeds: [embed] });
}

async function handleCameraTimeStats(message, args) {
  const target = message.mentions.members?.first() || message.member;
  const db = getGuildDb(message.guild.id);
  const stats = db.get('vcStats', {});
  if (!stats[message.guild.id]) stats[message.guild.id] = {};
  if (!stats[message.guild.id][target.id]) {
    stats[message.guild.id][target.id] = {
      totalMs: 0, daily: {}, weekly: {}, monthly: {},
      streamMs: 0, cameraMs: 0, streamDaily: {}, cameraDaily: {},
      lastJoin: null, lastStreamJoin: null, lastCameraJoin: null,
      inVc: false, streaming: false, cameraOn: false,
    };
  }
  const userData = stats[message.guild.id][target.id];

  const todayMs = getDailyTotal(message.guild, target.id, userData, 'today', 'cameraDaily') + addLiveTime(message.guild, target.id, userData, 'cameraDaily', 'today');
  const weekMs = getDailyTotal(message.guild, target.id, userData, 'week', 'cameraDaily') + addLiveTime(message.guild, target.id, userData, 'cameraDaily', 'week');
  const monthMs = getDailyTotal(message.guild, target.id, userData, 'month', 'cameraDaily') + addLiveTime(message.guild, target.id, userData, 'cameraDaily', 'month');

  // FIX: Save any state fixes back to DB
  db.set('vcStats', stats);

  const embed = await buildStatsEmbed('Camera Time', '\uD83D\uDCF7', '#FF8C00', target, todayMs, weekMs, monthMs, formatDuration);
  return message.reply({ embeds: [embed] });
}

async function handleStatsClear(message) {
  const { isAdmin } = require('./helpers');
  if (!isAdmin(message.member)) {
    return message.reply({ content: '❌ Only the server owner or bot admins can clear stats data.', ephemeral: true });
  }

  const db = getGuildDb(message.guild.id);
  db.set('vcStats', {});
  db.set('messageStats', {});

  return message.reply({ content: '✅ All stats data (voice time, stream time, camera time, and messages) has been cleared for this server.' });
}

module.exports = {
  handleVoiceTimeStats,
  handleMessageStats,
  handleStreamTimeStats,
  handleCameraTimeStats,
  trackMessage,
  handleStatsClear,
};