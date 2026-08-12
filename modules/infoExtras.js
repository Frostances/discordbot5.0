/**
 * infoExtras.js — Additional Information category commands
 * Commands: birthday, timezone, inviteinfo, boosters, roles, emotes, hex, bots, highlight
 */

const {
  EmbedBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle
} = require('discord.js');
const { getGuildDb, getUserDb } = require('./database');
const { COLORS, success, error, info } = require('../utils/embeds');
const { chunk } = require('../utils/paginator');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const MAGICK = 'magick';

function run(cmd, args, timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { timeout: timeoutMs });
    let out = '', err = '';
    proc.stdout?.on('data', d => { out += d; });
    proc.stderr?.on('data', d => { err += d; });
    proc.on('close', code => {
      if (code === 0) resolve(out.trim());
      else reject(new Error(`${cmd} exit ${code}: ${err.slice(0, 400)}`));
    });
    proc.on('error', reject);
  });
}

async function fetchToTemp(url, ext) {
  const name = `info_${Date.now()}_${Math.random().toString(36).slice(2)}${ext || ''}`;
  const dest = path.join(os.tmpdir(), name);
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} downloading image`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  return dest;
}

function tmpPath(ext) {
  return path.join(os.tmpdir(), `info_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);
}

function safeDelete(...files) {
  for (const f of files) try { fs.unlinkSync(f); } catch {}
}

async function resolveImageUrl(message, args) {
  const att = message.attachments.first();
  if (att) return att.url;
  const ref = message.reference?.messageId;
  if (ref) {
    const refMsg = await message.channel.messages.fetch(ref).catch(() => null);
    if (refMsg) {
      const refAtt = refMsg.attachments.first();
      if (refAtt) return refAtt.url;
      const embed = refMsg.embeds.find(e => e.image || e.thumbnail);
      if (embed) return (embed.image || embed.thumbnail).url;
    }
  }
  const urlArg = args.find(a => /^https?:\/\//i.test(a));
  if (urlArg) return urlArg;
  const mentioned = message.mentions.users.first();
  if (mentioned) return mentioned.displayAvatarURL({ size: 512, extension: 'png' });
  return message.author.displayAvatarURL({ size: 512, extension: 'png' });
}

// ══════════════════════════════════════════════════════════
// BIRTHDAY SYSTEM
// ══════════════════════════════════════════════════════════

function parseBirthdayDate(input) {
  const months = ['january','february','march','april','may','june','july','august','september','october','november','december'];
  let m = input.match(/^(\d{1,2})[-\/](\d{1,2})$/);
  if (m) {
    const month = parseInt(m[1]);
    const day = parseInt(m[2]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return { month, day };
  }
  const parts = input.toLowerCase().split(/[\s,]+/).filter(Boolean);
  if (parts.length >= 2) {
    let monthIdx = months.indexOf(parts[0]);
    let day = parseInt(parts[1]);
    if (monthIdx === -1) {
      monthIdx = months.indexOf(parts[1]);
      day = parseInt(parts[0]);
    }
    if (monthIdx !== -1 && day >= 1 && day <= 31) return { month: monthIdx + 1, day };
  }
  return null;
}

function formatBirthday({ month, day }) {
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return `${monthNames[month - 1]} ${day}`;
}

async function handleBirthday(message, args) {
  const sub = args[0]?.toLowerCase();
  const db = getGuildDb(message.guild.id);
  const config = db.get('birthdayConfig', { enabled: false, locked: false, roleId: null, channelId: null, celebratedRoles: [] });

  if (!sub) {
    const target = message.mentions.members.first() || message.member;
    const birthdays = db.get('birthdays', {});
    const bd = birthdays[target.id];
    if (!bd) {
      return message.reply({ embeds: [info('Birthday', target.id === message.author.id ? 'You have not set your birthday.' : `<@${target.id}> has not set their birthday.`)] });
    }
    return message.reply({
      embeds: [new EmbedBuilder()
        .setTitle('🎂 Birthday')
        .setColor(COLORS.primary)
        .setThumbnail(target.user.displayAvatarURL({ size: 256 }))
        .setDescription(target.id === message.author.id
          ? `Your birthday is **${formatBirthday(bd)}**.`
          : `<@${target.id}>'s birthday is **${formatBirthday(bd)}**.`)
        .setFooter({ text: 'Kaido' })
        .setTimestamp()
      ]
    });
  }

  if (sub === 'set') {
    if (config.locked) return message.reply({ embeds: [error('Locked', 'The birthday system is currently locked.')] });
    const dateInput = args.slice(1).join(' ').trim();
    if (!dateInput) return message.reply({ embeds: [error('Missing Date', 'Usage: `,birthday set <date>` (e.g., 01-15, January 15)')] });
    const parsed = parseBirthdayDate(dateInput);
    if (!parsed) return message.reply({ embeds: [error('Invalid Date', 'Use format: MM-DD, MM/DD, or "Month Day" (e.g., January 15).')] });
    const birthdays = db.get('birthdays', {});
    birthdays[message.author.id] = parsed;
    db.set('birthdays', birthdays);
    return message.reply({ embeds: [success('Birthday Set', `Your birthday is set to **${formatBirthday(parsed)}**.`)] });
  }

  if (sub === 'list') {
    const birthdays = db.get('birthdays', {});
    const entries = Object.entries(birthdays)
      .map(([uid, bd]) => ({ uid, bd, sortKey: bd.month * 100 + bd.day }))
      .sort((a, b) => a.sortKey - b.sortKey);
    if (!entries.length) return message.reply({ embeds: [info('Birthdays', 'No birthdays have been set.')] });
    const lines = entries.map(e => `<@${e.uid}> — **${formatBirthday(e.bd)}**`);
    const pages = chunk(lines, 10).map((pg, i, arr) => ({
      title: `🎂 Birthdays — Page ${i + 1}/${arr.length}`,
      description: pg.join('\n'),
      color: COLORS.primary,
    }));
    const { sendPaginated } = require('../utils/paginator');
    return sendPaginated(message.channel, pages, message.author.id);
  }

  if (sub === 'unlock') {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageRoles))
      return message.reply({ embeds: [error('Permission Denied', 'You need **Manage Roles**.')] });
    config.enabled = true;
    config.locked = false;
    db.set('birthdayConfig', config);
    return message.reply({ embeds: [success('Unlocked', 'The birthday system has been unlocked.')] });
  }

  if (sub === 'lock') {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageRoles))
      return message.reply({ embeds: [error('Permission Denied', 'You need **Manage Roles**.')] });
    config.locked = true;
    db.set('birthdayConfig', config);
    return message.reply({ embeds: [success('Locked', 'The birthday system has been locked.')] });
  }

  if (sub === 'role') {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageRoles))
      return message.reply({ embeds: [error('Permission Denied', 'You need **Manage Roles**.')] });
    const role = message.mentions.roles.first() || message.guild.roles.cache.get(args[1]);
    if (!role) return message.reply({ embeds: [error('Missing Role', 'Mention or provide a role ID.')] });
    config.roleId = role.id;
    db.set('birthdayConfig', config);
    return message.reply({ embeds: [success('Role Set', `Birthday role set to <@&${role.id}>.`)] });
  }

  if (sub === 'channel') {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels))
      return message.reply({ embeds: [error('Permission Denied', 'You need **Manage Channels**.')] });
    const channel = message.mentions.channels.first() || message.guild.channels.cache.get(args[1]);
    if (!channel) return message.reply({ embeds: [error('Missing Channel', 'Mention or provide a channel ID.')] });
    config.channelId = channel.id;
    db.set('birthdayConfig', config);
    return message.reply({ embeds: [success('Channel Set', `Birthday channel set to <#${channel.id}>.`)] });
  }

  if (sub === 'celebrate') {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageRoles))
      return message.reply({ embeds: [error('Permission Denied', 'You need **Manage Roles**.')] });

    if (args[1]?.toLowerCase() === 'list') {
      if (!config.celebratedRoles?.length) return message.reply({ embeds: [info('Celebrated Roles', 'No celebrated roles configured.')] });
      return message.reply({
        embeds: [new EmbedBuilder()
          .setTitle('🎉 Celebrated Roles')
          .setColor(COLORS.primary)
          .setDescription(config.celebratedRoles.map(id => `<@&${id}>`).join('\n'))
          .setFooter({ text: 'Kaido' })
        ]
      });
    }

    const role = message.mentions.roles.first() || message.guild.roles.cache.get(args[1]);
    if (!role) return message.reply({ embeds: [error('Missing Role', 'Mention or provide a role ID.')] });
    if (!config.celebratedRoles) config.celebratedRoles = [];
    if (config.celebratedRoles.includes(role.id)) {
      config.celebratedRoles = config.celebratedRoles.filter(id => id !== role.id);
      db.set('birthdayConfig', config);
      return message.reply({ embeds: [success('Role Removed', `Removed <@&${role.id}> from celebrated roles.`)] });
    }
    config.celebratedRoles.push(role.id);
    db.set('birthdayConfig', config);
    return message.reply({ embeds: [success('Role Added', `Added <@&${role.id}> to celebrated roles.`)] });
  }

  if (sub === 'config') {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageRoles))
      return message.reply({ embeds: [error('Permission Denied', 'You need **Manage Roles**.')] });
    const roleStr = config.roleId ? `<@&${config.roleId}>` : 'Not set';
    const channelStr = config.channelId ? `<#${config.channelId}>` : 'Not set';
    const celebrateStr = config.celebratedRoles?.length ? config.celebratedRoles.map(id => `<@&${id}>`).join(', ') : 'All roles';
    const status = config.locked ? '🔒 Locked' : (config.enabled ? '✅ Enabled' : '⏸️ Disabled');
    return message.reply({
      embeds: [new EmbedBuilder()
        .setTitle('🎂 Birthday Config')
        .setColor(COLORS.primary)
        .addFields(
          { name: 'Status', value: status, inline: true },
          { name: 'Birthday Role', value: roleStr, inline: true },
          { name: 'Birthday Channel', value: channelStr, inline: true },
          { name: 'Celebrated Roles', value: celebrateStr, inline: false },
        )
        .setFooter({ text: 'Kaido' })
        .setTimestamp()
      ]
    });
  }

  return message.reply({ embeds: [info('Birthday', 'Unknown subcommand. Use `,birthday` to view your birthday.')] });
}

// ══════════════════════════════════════════════════════════
// TIMEZONE SYSTEM
// ══════════════════════════════════════════════════════════

const TZ_MAP = {
  'utc': 'UTC', 'gmt': 'UTC',
  'new york': 'America/New_York', 'ny': 'America/New_York', 'est': 'America/New_York', 'edt': 'America/New_York',
  'los angeles': 'America/Los_Angeles', 'la': 'America/Los_Angeles', 'pst': 'America/Los_Angeles', 'pdt': 'America/Los_Angeles',
  'chicago': 'America/Chicago', 'cst': 'America/Chicago', 'cdt': 'America/Chicago',
  'denver': 'America/Denver', 'mst': 'America/Denver', 'mdt': 'America/Denver',
  'london': 'Europe/London', 'bst': 'Europe/London',
  'paris': 'Europe/Paris', 'cet': 'Europe/Paris', 'cest': 'Europe/Paris',
  'berlin': 'Europe/Berlin',
  'rome': 'Europe/Rome',
  'madrid': 'Europe/Madrid',
  'amsterdam': 'Europe/Amsterdam',
  'moscow': 'Europe/Moscow', 'msk': 'Europe/Moscow',
  'dubai': 'Asia/Dubai',
  'mumbai': 'Asia/Kolkata', 'delhi': 'Asia/Kolkata', 'ist': 'Asia/Kolkata',
  'singapore': 'Asia/Singapore', 'sgt': 'Asia/Singapore',
  'tokyo': 'Asia/Tokyo', 'jst': 'Asia/Tokyo',
  'sydney': 'Australia/Sydney', 'aest': 'Australia/Sydney',
  'shanghai': 'Asia/Shanghai', 'beijing': 'Asia/Shanghai',
  'hong kong': 'Asia/Hong_Kong', 'hkt': 'Asia/Hong_Kong',
  'seoul': 'Asia/Seoul', 'kst': 'Asia/Seoul',
  'cairo': 'Africa/Cairo', 'egypt': 'Africa/Cairo',
  'johannesburg': 'Africa/Johannesburg', 'sast': 'Africa/Johannesburg',
  'sao paulo': 'America/Sao_Paulo', 'brazil': 'America/Sao_Paulo',
  'mexico city': 'America/Mexico_City',
  'toronto': 'America/Toronto',
  'vancouver': 'America/Vancouver',
  'calgary': 'America/Edmonton',
  'montreal': 'America/Toronto',
  'santiago': 'America/Santiago',
  'buenos aires': 'America/Argentina/Buenos_Aires',
  'istanbul': 'Europe/Istanbul',
  'athens': 'Europe/Athens',
  'helsinki': 'Europe/Helsinki',
  'stockholm': 'Europe/Stockholm',
  'oslo': 'Europe/Oslo',
  'copenhagen': 'Europe/Copenhagen',
  'warsaw': 'Europe/Warsaw',
  'prague': 'Europe/Prague',
  'vienna': 'Europe/Vienna',
  'budapest': 'Europe/Budapest',
  'bucharest': 'Europe/Bucharest',
  'kiev': 'Europe/Kyiv', 'kyiv': 'Europe/Kyiv',
  'tel aviv': 'Asia/Jerusalem', 'jerusalem': 'Asia/Jerusalem',
  'riyadh': 'Asia/Riyadh',
  'karachi': 'Asia/Karachi',
  'dhaka': 'Asia/Dhaka',
  'bangkok': 'Asia/Bangkok',
  'jakarta': 'Asia/Jakarta',
  'manila': 'Asia/Manila',
  'taipei': 'Asia/Taipei',
  'auckland': 'Pacific/Auckland',
  'fiji': 'Pacific/Fiji',
  'honolulu': 'Pacific/Honolulu', 'hst': 'Pacific/Honolulu',
  'anchorage': 'America/Anchorage', 'akst': 'America/Anchorage',
  'phoenix': 'America/Phoenix',
};

function resolveTimezone(input) {
  const key = input.toLowerCase().trim();
  if (TZ_MAP[key]) return TZ_MAP[key];
  try {
    Intl.DateTimeFormat(undefined, { timeZone: input });
    return input;
  } catch {
    return null;
  }
}

function formatTimeInZone(tz) {
  const now = new Date();
  return now.toLocaleString('en-US', { timeZone: tz, weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short' });
}

async function handleTimezone(message, args) {
  const sub = args[0]?.toLowerCase();

  if (!sub) {
    const target = message.mentions.members.first() || message.member;
    const userDb = getUserDb(message.guild.id, target.id);
    const tz = userDb.data.timezone;
    if (!tz) {
      return message.reply({ embeds: [info('Timezone', target.id === message.author.id ? 'You have not set a timezone.' : `<@${target.id}> has not set a timezone.`)] });
    }
    const timeStr = formatTimeInZone(tz);
    return message.reply({
      embeds: [new EmbedBuilder()
        .setTitle('🌍 Timezone')
        .setColor(COLORS.primary)
        .setThumbnail(target.user.displayAvatarURL({ size: 256 }))
        .addFields(
          { name: 'User', value: `<@${target.id}>`, inline: true },
          { name: 'Timezone', value: tz, inline: true },
          { name: 'Current Time', value: timeStr, inline: false },
        )
        .setFooter({ text: 'Kaido' })
        .setTimestamp()
      ]
    });
  }

  if (sub === 'set') {
    const location = args.slice(1).join(' ').trim();
    if (!location) return message.reply({ embeds: [error('Missing Location', 'Usage: `,timezone set <location>` (e.g., New York, Tokyo, UTC+3)')] });
    const tz = resolveTimezone(location);
    if (!tz) return message.reply({ embeds: [error('Invalid Timezone', 'Could not recognize that location. Try a major city or IANA timezone like `America/New_York`.')] });
    const userDb = getUserDb(message.guild.id, message.author.id);
    userDb.data.timezone = tz;
    userDb.save();
    return message.reply({ embeds: [success('Timezone Set', `Your timezone is set to **${tz}**. Current time: ${formatTimeInZone(tz)}`)] });
  }

  if (sub === 'list') {
    await message.guild.members.fetch();
    const entries = [];
    for (const [uid, member] of message.guild.members.cache) {
      const userDb = getUserDb(message.guild.id, uid);
      if (userDb.data.timezone) {
        entries.push({ uid, tz: userDb.data.timezone, time: formatTimeInZone(userDb.data.timezone) });
      }
    }
    if (!entries.length) return message.reply({ embeds: [info('Timezones', 'No one has set a timezone.')] });
    const lines = entries.map(e => `<@${e.uid}> — **${e.tz}** — ${e.time}`);
    const pages = chunk(lines, 10).map((pg, i, arr) => ({
      title: `🌍 Timezones — Page ${i + 1}/${arr.length}`,
      description: pg.join('\n'),
      color: COLORS.primary,
    }));
    const { sendPaginated } = require('../utils/paginator');
    return sendPaginated(message.channel, pages, message.author.id);
  }

  return message.reply({ embeds: [info('Timezone', 'Unknown subcommand. Use `,timezone` to view your timezone.')] });
}

// ══════════════════════════════════════════════════════════
// INVITEINFO
// ══════════════════════════════════════════════════════════

async function handleInviteinfo(message, args) {
  const code = args[0]?.replace(/https:\/\/discord\.gg\//i, '').replace(/https:\/\/discord\.com\/invite\//i, '');
  if (!code) return message.reply({ embeds: [error('Missing Code', 'Provide an invite code or link.')] });
  try {
    const invite = await message.client.fetchInvite(code).catch(() => null);
    if (!invite) return message.reply({ embeds: [error('Invalid Invite', 'Could not fetch that invite.')] });
    const embed = new EmbedBuilder()
      .setTitle('🔗 Invite Information')
      .setColor(COLORS.primary)
      .addFields(
        { name: 'Code', value: invite.code, inline: true },
        { name: 'Channel', value: invite.channel ? `#${invite.channel.name}` : 'Unknown', inline: true },
        { name: 'Guild', value: invite.guild ? invite.guild.name : 'Unknown', inline: true },
        { name: 'Inviter', value: invite.inviter ? `${invite.inviter.tag} (${invite.inviter.id})` : 'Unknown', inline: true },
        { name: 'Uses', value: invite.uses?.toString() || 'Unknown', inline: true },
        { name: 'Max Uses', value: invite.maxUses?.toString() || 'Unlimited', inline: true },
        { name: 'Temporary', value: invite.temporary ? 'Yes' : 'No', inline: true },
        { name: 'Expires', value: invite.maxAge ? (invite.maxAge === 0 ? 'Never' : `<t:${Math.floor((Date.now() + invite.maxAge * 1000) / 1000)}:R>`) : 'Unknown', inline: true },
      )
      .setFooter({ text: 'Kaido' })
      .setTimestamp();
    if (invite.guild?.icon) embed.setThumbnail(invite.guild.iconURL({ size: 256 }));
    return message.reply({ embeds: [embed] });
  } catch (err) {
    return message.reply({ embeds: [error('Failed', err.message)] });
  }
}

// ══════════════════════════════════════════════════════════
// BOOSTERS
// ══════════════════════════════════════════════════════════

async function handleBoosters(message, args) {
  await message.guild.members.fetch();
  const boosters = message.guild.members.cache
    .filter(m => m.premiumSince)
    .sort((a, b) => (b.premiumSinceTimestamp || 0) - (a.premiumSinceTimestamp || 0))
    .map(m => `<@${m.id}> — <t:${Math.floor(m.premiumSinceTimestamp / 1000)}:R>`);
  if (!boosters.length) return message.reply({ embeds: [info('Boosters', 'No one is currently boosting this server.')] });
  const pages = chunk(boosters, 10).map((pg, i, arr) => ({
    title: `🚀 Server Boosters — Page ${i + 1}/${arr.length}`,
    description: pg.join('\n'),
    color: COLORS.primary,
  }));
  const { sendPaginated } = require('../utils/paginator');
  return sendPaginated(message.channel, pages, message.author.id);
}

async function handleBoostersLost(message, args) {
  const db = getGuildDb(message.guild.id);
  const lost = db.get('lostBoosters', []);
  if (!lost.length) return message.reply({ embeds: [info('Lost Boosters', 'No lost boosters recorded.')] });
  const recent = lost.slice(-20).reverse();
  const lines = recent.map(entry => `<@${entry.userId}> — **${entry.tag}** — <t:${Math.floor(entry.timestamp / 1000)}:R>`);
  return message.reply({
    embeds: [new EmbedBuilder()
      .setTitle('💔 Recent Lost Boosters')
      .setColor(COLORS.error)
      .setDescription(lines.join('\n'))
      .setFooter({ text: 'Kaido' })
      .setTimestamp()
    ]
  });
}

// ══════════════════════════════════════════════════════════
// ROLES LIST
// ══════════════════════════════════════════════════════════

async function handleRolesList(message, args) {
  const roles = message.guild.roles.cache
    .filter(r => r.id !== message.guild.id)
    .sort((a, b) => b.position - a.position)
    .map(r => {
      const color = r.color ? `#${r.color.toString(16).padStart(6, '0').toUpperCase()}` : 'Default';
      return `<@&${r.id}> — ${color} — ${r.members.size} members`;
    });
  if (!roles.length) return message.reply({ embeds: [info('Roles', 'This server has no custom roles.')] });
  const pages = chunk(roles, 15).map((pg, i, arr) => ({
    title: `🎭 Roles — Page ${i + 1}/${arr.length}`,
    description: pg.join('\n'),
    color: COLORS.primary,
  }));
  const { sendPaginated } = require('../utils/paginator');
  return sendPaginated(message.channel, pages, message.author.id);
}

// ══════════════════════════════════════════════════════════
// EMOTES LIST
// ══════════════════════════════════════════════════════════

async function handleEmotesList(message, args) {
  const emojis = [...message.guild.emojis.cache.values()];
  if (!emojis.length) return message.reply({ embeds: [info('Emotes', 'This server has no custom emotes.')] });
  const lines = emojis.map(e => `${e} \`:${e.name}:\` — ${e.animated ? 'Animated' : 'Static'}`);
  const pages = chunk(lines, 20).map((pg, i, arr) => ({
    title: `😀 Emotes [${emojis.length}] — Page ${i + 1}/${arr.length}`,
    description: pg.join('\n'),
    color: COLORS.primary,
  }));
  const { sendPaginated } = require('../utils/paginator');
  return sendPaginated(message.channel, pages, message.author.id);
}

// ══════════════════════════════════════════════════════════
// HEX (Dominant Color)
// ══════════════════════════════════════════════════════════

async function handleHex(message, args) {
  let imageUrl;
  try { imageUrl = await resolveImageUrl(message, args); }
  catch (e) { return message.reply({ embeds: [error('No Image', 'Provide a URL, attachment, or mention a member.')] }); }
  let inputPath;
  try {
    inputPath = await fetchToTemp(imageUrl, '.png');
    const stdout = await run(MAGICK, [inputPath + '[0]', '-resize', '1x1', 'txt:-']);
    const hexMatch = stdout.match(/#([0-9A-Fa-f]{6})/);
    const hex = hexMatch ? hexMatch[1].toUpperCase() : '000000';
    const intColor = parseInt(hex, 16);
    return message.reply({
      embeds: [new EmbedBuilder()
        .setTitle('🎨 Dominant Color')
        .setColor(intColor)
        .setDescription(`**#${hex}**`)
        .setThumbnail(imageUrl)
        .setFooter({ text: 'Kaido' })
        .setTimestamp()
      ]
    });
  } catch (err) {
    return message.reply({ embeds: [error('Failed', err.message?.slice(0, 200) || 'Unknown error')] });
  } finally {
    safeDelete(inputPath);
  }
}

// ══════════════════════════════════════════════════════════
// BOTS LIST
// ══════════════════════════════════════════════════════════

async function handleBotsList(message, args) {
  await message.guild.members.fetch();
  const bots = message.guild.members.cache
    .filter(m => m.user.bot)
    .sort((a, b) => b.joinedTimestamp - a.joinedTimestamp);
  if (!bots.size) return message.reply({ embeds: [info('Bots', 'No bots in this server.')] });
  const lines = bots.map(m => `<@${m.id}> — **${m.user.tag}** — \`${m.id}\``);
  const pages = chunk(lines, 10).map((pg, i, arr) => ({
    title: `🤖 Bots — Page ${i + 1}/${arr.length}`,
    description: pg.join('\n'),
    color: COLORS.primary,
  }));
  const { sendPaginated } = require('../utils/paginator');
  return sendPaginated(message.channel, pages, message.author.id);
}

// ══════════════════════════════════════════════════════════
// HIGHLIGHT SYSTEM
// ══════════════════════════════════════════════════════════

async function handleHighlight(message, args) {
  const sub = args[0]?.toLowerCase();
  const db = getGuildDb(message.guild.id);
  const userId = message.author.id;

  if (!sub) {
    return message.reply({
      embeds: [info('Highlight',
        'Get notified when keywords are mentioned.\n\n' +
        '`,highlight add <keyword>` — add a keyword\n' +
        '`,highlight remove <keyword>` — remove a keyword\n' +
        '`,highlight list` — list your keywords\n' +
        '`,highlight reset` — remove all your keywords\n' +
        '`,highlight ignore <member/channel/role>` — ignore notifications\n' +
        '`,highlight ignore list` — list ignored entities'
      )]
    });
  }

  if (sub === 'add') {
    const keyword = args.slice(1).join(' ').toLowerCase().trim();
    if (!keyword) return message.reply({ embeds: [error('Missing Keyword', 'Usage: `,highlight add <keyword>`')] });
    if (keyword.length > 100) return message.reply({ embeds: [error('Too Long', 'Keyword must be 100 characters or less.')] });
    const highlights = db.get('highlights', {});
    if (!highlights[userId]) highlights[userId] = { keywords: [], ignoredMembers: [], ignoredChannels: [], ignoredRoles: [] };
    if (highlights[userId].keywords.includes(keyword)) return message.reply({ embeds: [error('Duplicate', 'You already have that keyword highlighted.')] });
    if (highlights[userId].keywords.length >= 20) return message.reply({ embeds: [error('Limit Reached', 'You can only have 20 keywords.')] });
    highlights[userId].keywords.push(keyword);
    db.set('highlights', highlights);
    return message.reply({ embeds: [success('Keyword Added', `Added **${keyword}** to your highlights.`)] });
  }

  if (sub === 'remove') {
    const keyword = args.slice(1).join(' ').toLowerCase().trim();
    if (!keyword) return message.reply({ embeds: [error('Missing Keyword', 'Usage: `,highlight remove <keyword>`')] });
    const highlights = db.get('highlights', {});
    if (!highlights[userId] || !highlights[userId].keywords.includes(keyword)) {
      return message.reply({ embeds: [error('Not Found', 'That keyword is not in your highlights.')] });
    }
    highlights[userId].keywords = highlights[userId].keywords.filter(k => k !== keyword);
    db.set('highlights', highlights);
    return message.reply({ embeds: [success('Keyword Removed', `Removed **${keyword}** from your highlights.`)] });
  }

  if (sub === 'list') {
    const highlights = db.get('highlights', {});
    const userHighlights = highlights[userId];
    if (!userHighlights || !userHighlights.keywords.length) {
      return message.reply({ embeds: [info('Your Highlights', 'You have no highlighted keywords.')] });
    }
    return message.reply({
      embeds: [new EmbedBuilder()
        .setTitle('🔔 Your Highlights')
        .setColor(COLORS.primary)
        .setDescription(userHighlights.keywords.map(k => `• ${k}`).join('\n'))
        .setFooter({ text: 'Kaido' })
      ]
    });
  }

  if (sub === 'reset') {
    const highlights = db.get('highlights', {});
    if (highlights[userId]) {
      highlights[userId].keywords = [];
      db.set('highlights', highlights);
    }
    return message.reply({ embeds: [success('Reset', 'Cleared all your highlighted keywords in this server.')] });
  }

  if (sub === 'ignore') {
    if (args[1]?.toLowerCase() === 'list') {
      const highlights = db.get('highlights', {});
      const userHighlights = highlights[userId];
      if (!userHighlights) return message.reply({ embeds: [info('Ignore List', 'Your ignore list is empty.')] });
      const members = userHighlights.ignoredMembers?.map(id => `<@${id}>`).join(', ') || 'None';
      const channels = userHighlights.ignoredChannels?.map(id => `<#${id}>`).join(', ') || 'None';
      const roles = userHighlights.ignoredRoles?.map(id => `<@&${id}>`).join(', ') || 'None';
      return message.reply({
        embeds: [new EmbedBuilder()
          .setTitle('🚫 Highlight Ignore List')
          .setColor(COLORS.primary)
          .addFields(
            { name: 'Members', value: members, inline: false },
            { name: 'Channels', value: channels, inline: false },
            { name: 'Roles', value: roles, inline: false },
          )
          .setFooter({ text: 'Kaido' })
        ]
      });
    }

    const target = message.mentions.members.first() || message.mentions.channels.first() || message.mentions.roles.first();
    if (!target) return message.reply({ embeds: [error('Missing Target', 'Mention a member, channel, or role to ignore.')] });
    const highlights = db.get('highlights', {});
    if (!highlights[userId]) highlights[userId] = { keywords: [], ignoredMembers: [], ignoredChannels: [], ignoredRoles: [] };
    if (target.id === userId) return message.reply({ embeds: [error('Invalid', 'You cannot ignore yourself.')] });

    if (target.user) {
      if (highlights[userId].ignoredMembers.includes(target.id)) return message.reply({ embeds: [error('Already Ignored', 'That member is already ignored.')] });
      highlights[userId].ignoredMembers.push(target.id);
    } else if (target.type !== undefined) {
      if (highlights[userId].ignoredChannels.includes(target.id)) return message.reply({ embeds: [error('Already Ignored', 'That channel is already ignored.')] });
      highlights[userId].ignoredChannels.push(target.id);
    } else {
      if (highlights[userId].ignoredRoles.includes(target.id)) return message.reply({ embeds: [error('Already Ignored', 'That role is already ignored.')] });
      highlights[userId].ignoredRoles.push(target.id);
    }
    db.set('highlights', highlights);
    return message.reply({ embeds: [success('Ignored', `Added ${target} to your ignore list.`)] });
  }

  return message.reply({ embeds: [info('Highlight', 'Unknown subcommand. Use `,highlight` for help.')] });
}

async function checkHighlights(message) {
  if (message.author.bot || !message.guild) return;
  const db = getGuildDb(message.guild.id);
  const highlights = db.get('highlights', {});
  const content = message.content.toLowerCase();

  for (const [userId, data] of Object.entries(highlights)) {
    if (userId === message.author.id) continue;
    if (!data.keywords?.length) continue;
    if (data.ignoredMembers?.includes(message.author.id)) continue;
    if (data.ignoredChannels?.includes(message.channel.id)) continue;
    const memberRoles = message.member?.roles.cache.map(r => r.id) || [];
    if (data.ignoredRoles?.some(rid => memberRoles.includes(rid))) continue;

    const matched = data.keywords.find(kw => content.includes(kw.toLowerCase()));
    if (!matched) continue;

    try {
      const user = await message.client.users.fetch(userId);
      if (!user) continue;
      const embed = new EmbedBuilder()
        .setTitle('🔔 Highlight Notification')
        .setColor(COLORS.primary)
        .setDescription(`Your keyword **${matched}** was mentioned in ${message.channel}`)
        .addFields(
          { name: 'Author', value: `${message.author.tag} (${message.author.id})`, inline: true },
          { name: 'Message', value: message.content.slice(0, 1024) || '[No content]', inline: false },
        )
        .setTimestamp();
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('Jump to Message')
          .setStyle(ButtonStyle.Link)
          .setURL(message.url),
      );
      await user.send({ embeds: [embed], components: [row] }).catch(() => {});
    } catch {}
  }
}

// ══════════════════════════════════════════════════════════
// EXPORT
// ══════════════════════════════════════════════════════════
module.exports = {
  handleBirthday,
  handleTimezone,
  handleInviteinfo,
  handleBoosters,
  handleBoostersLost,
  handleRolesList,
  handleEmotesList,
  handleHex,
  handleBotsList,
  handleHighlight,
  checkHighlights,
};