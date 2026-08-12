/**
 * information.js — Information category commands
 * Commands: seen, membercount, roleinfo, channelinfo, avatar, serveravatar,
 * serverbanner, banner, guildicon, guildbanner, splash, serverinfo, userinfo,
 * sticker (cleanup/tag/add/remove/rename), rotate, compress, invert,
 * emoji (rename/add/stats/removemany/removeduplicates/remove/information/addmany)
 */

const {
  EmbedBuilder, AttachmentBuilder, ActionRowBuilder, ButtonBuilder,
  ButtonStyle, PermissionFlagsBits, ChannelType, ComponentType
} = require('discord.js');
const { getGuildDb, getUserDb } = require('./database');
const { COLORS, base, success, error, info, greedOk, greedWarn } = require('../utils/embeds');
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
// SEEN — when a member was last seen
// ══════════════════════════════════════════════════════════
async function updateSeen(guildId, userId) {
  const db = getGuildDb(guildId);
  const seen = db.get('lastSeen', {});
  seen[userId] = Date.now();
  db.set('lastSeen', seen);
}

async function handleSeen(message, args) {
  const target = message.mentions.members.first() ||
    (args[0]?.match(/^\d+$/) ? await message.guild.members.fetch(args[0]).catch(() => null) : null);
  if (!target) return message.reply({ embeds: [error('Missing Member', 'Mention a member: `,seen @user`')] });

  const db = getGuildDb(message.guild.id);
  const seen = db.get('lastSeen', {});
  const ts = seen[target.id];

  if (!ts) {
    return message.reply({ embeds: [info('Seen', `<@${target.id}> has not been tracked yet.`)] });
  }

  const diff = Date.now() - ts;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  let ago;
  if (days > 0) ago = `${days}d ${hours % 24}h ago`;
  else if (hours > 0) ago = `${hours}h ${minutes % 60}m ago`;
  else if (minutes > 0) ago = `${minutes}m ${seconds % 60}s ago`;
  else ago = `${seconds}s ago`;

  const dateStr = `<t:${Math.floor(ts / 1000)}:F>`;

  return message.reply({
    embeds: [new EmbedBuilder()
      .setTitle('👁️ Seen')
      .setColor(COLORS.primary)
      .setThumbnail(target.user.displayAvatarURL({ size: 256 }))
      .addFields(
        { name: 'User', value: `${target.user.tag} (${target.id})`, inline: false },
        { name: 'Last Seen', value: `${dateStr}\n**${ago}**`, inline: false },
      )
      .setFooter({ text: 'Kaido' })
      .setTimestamp()
    ]
  });
}

// ══════════════════════════════════════════════════════════
// MEMBERCOUNT
// ══════════════════════════════════════════════════════════
async function handleMembercount(message) {
  const guild = message.guild;

  await guild.members.fetch();

  const total = guild.memberCount;
  const bots = guild.members.cache.filter(m => m.user.bot).size;
  const humans = total - bots;

  const embed = new EmbedBuilder()
    .setColor(0x2B2D31) // Same dark gray as the reference
    .setAuthor({
      name: guild.name,
      iconURL: guild.iconURL({ dynamic: true, size: 128 }) ?? undefined,
    })
    .setTitle(`Members in ${guild.name}`)
    .setDescription(
      [
        `> Total Members: \`${total.toLocaleString()}\``,
        `> Humans: \`${humans.toLocaleString()}\``,
        `> Bots: \`${bots.toLocaleString()}\``,
      ].join("\n")
    );

  return message.reply({
    embeds: [embed],
  });
}

// ══════════════════════════════════════════════════════════
// ROLEINFO
// ══════════════════════════════════════════════════════════
async function handleRoleinfo(message, args) {
  const role = message.mentions.roles.first() ||
    message.guild.roles.cache.get(args[0]) ||
    message.guild.roles.cache.find(r => r.name.toLowerCase() === args.join(' ').toLowerCase());
  if (!role) return message.reply({ embeds: [error('Missing Role', 'Provide a role mention, ID, or name.')] });

  const members = role.members.size;
  const perms = role.permissions.toArray().map(p => `\`${p}\``).join(', ') || 'None';
  const color = role.color ? `#${role.color.toString(16).padStart(6, '0')}` : 'Default';
  const created = `<t:${Math.floor(role.createdTimestamp / 1000)}:R>`;

  return message.reply({
    embeds: [new EmbedBuilder()
      .setTitle(`🎭 ${role.name}`)
      .setColor(role.color || COLORS.primary)
      .addFields(
        { name: 'ID', value: role.id, inline: true },
        { name: 'Color', value: color, inline: true },
        { name: 'Position', value: role.position.toString(), inline: true },
        { name: 'Members', value: members.toLocaleString(), inline: true },
        { name: 'Mentionable', value: role.mentionable ? 'Yes' : 'No', inline: true },
        { name: 'Hoisted', value: role.hoist ? 'Yes' : 'No', inline: true },
        { name: 'Created', value: created, inline: true },
        { name: 'Permissions', value: perms.length > 1024 ? perms.slice(0, 1020) + '...' : perms },
      )
      .setFooter({ text: 'Kaido' })
      .setTimestamp()
    ]
  });
}

// ══════════════════════════════════════════════════════════
// CHANNELINFO
// ══════════════════════════════════════════════════════════
async function handleChannelinfo(message, args) {
  const ch = message.mentions.channels.first() ||
    message.guild.channels.cache.get(args[0]) ||
    message.channel;

  const typeMap = {
    [ChannelType.GuildText]: 'Text',
    [ChannelType.GuildVoice]: 'Voice',
    [ChannelType.GuildCategory]: 'Category',
    [ChannelType.GuildAnnouncement]: 'Announcement',
    [ChannelType.AnnouncementThread]: 'Announcement Thread',
    [ChannelType.PublicThread]: 'Public Thread',
    [ChannelType.PrivateThread]: 'Private Thread',
    [ChannelType.GuildStageVoice]: 'Stage',
    [ChannelType.GuildForum]: 'Forum',
    [ChannelType.GuildMedia]: 'Media',
  };

  const embed = new EmbedBuilder()
    .setTitle(`#️⃣ ${ch.name}`)
    .setColor(COLORS.primary)
    .addFields(
      { name: 'ID', value: ch.id, inline: true },
      { name: 'Type', value: typeMap[ch.type] || 'Unknown', inline: true },
      { name: 'Created', value: `<t:${Math.floor(ch.createdTimestamp / 1000)}:R>`, inline: true },
    )
    .setFooter({ text: 'Kaido' })
    .setTimestamp();

  if (ch.parent) embed.addFields({ name: 'Category', value: ch.parent.name, inline: true });
  if (ch.type === ChannelType.GuildText || ch.type === ChannelType.GuildAnnouncement) {
    embed.addFields(
      { name: 'NSFW', value: ch.nsfw ? 'Yes' : 'No', inline: true },
      { name: 'Slowmode', value: ch.rateLimitPerUser ? `${ch.rateLimitPerUser}s` : 'None', inline: true },
      { name: 'Topic', value: ch.topic || 'None', inline: false },
    );
  }
  if (ch.type === ChannelType.GuildVoice || ch.type === ChannelType.GuildStageVoice) {
    embed.addFields(
      { name: 'Bitrate', value: `${ch.bitrate / 1000}kbps`, inline: true },
      { name: 'User Limit', value: ch.userLimit ? ch.userLimit.toString() : 'Unlimited', inline: true },
      { name: 'Region', value: ch.rtcRegion || 'Auto', inline: true },
    );
  }

  return message.reply({ embeds: [embed] });
}

// ══════════════════════════════════════════════════════════
// AVATAR
// ══════════════════════════════════════════════════════════
async function handleAvatar(message, target) {
  const user = target || message.author;
  const url = user.displayAvatarURL({ size: 4096, extension: 'png' });
  const urlWebp = user.displayAvatarURL({ size: 4096, extension: 'webp' });

  return message.reply({
    embeds: [new EmbedBuilder()
      .setTitle(`🖼️ ${user.username}'s Avatar`)
      .setImage(url)
      .setColor(COLORS.primary)
      .setDescription(`[PNG](${url}) | [WebP](${urlWebp})`)
      .setFooter({ text: 'Kaido' })
      .setTimestamp()
    ]
  });
}

// ══════════════════════════════════════════════════════════
// SERVERAVATAR
// ══════════════════════════════════════════════════════════
async function handleServeravatar(message, args) {
  const target = message.mentions.members.first() || message.member;
  if (!target.avatar) {
    return message.reply({ embeds: [error('No Server Avatar', `<@${target.id}> does not have a server-specific avatar.`)] });
  }
  const url = target.avatarURL({ size: 4096, extension: 'png' });
  return message.reply({
    embeds: [new EmbedBuilder()
      .setTitle(`🖼️ ${target.user.username}'s Server Avatar`)
      .setImage(url)
      .setColor(COLORS.primary)
      .setFooter({ text: 'Kaido' })
      .setTimestamp()
    ]
  });
}

// ══════════════════════════════════════════════════════════
// SERVERBANNER
// ══════════════════════════════════════════════════════════
async function handleServerbanner(message, args) {
  const target = message.mentions.members.first() || message.member;
  const user = await message.client.users.fetch(target.id, { force: true }).catch(() => null);
  if (!user?.banner) {
    return message.reply({ embeds: [error('No Banner', `<@${target.id}> does not have a profile banner.`)] });
  }
  const url = user.bannerURL({ size: 4096, extension: 'png' });
  return message.reply({
    embeds: [new EmbedBuilder()
      .setTitle(`🖼️ ${user.username}'s Banner`)
      .setImage(url)
      .setColor(COLORS.primary)
      .setFooter({ text: 'Kaido' })
      .setTimestamp()
    ]
  });
}

// ══════════════════════════════════════════════════════════
// BANNER
// ══════════════════════════════════════════════════════════
async function handleBanner(message, args) {
  const target = message.mentions.users.first() || message.author;
  const user = await message.client.users.fetch(target.id, { force: true }).catch(() => null);
  if (!user?.banner) {
    return message.reply({ embeds: [error('No Banner', `<@${target.id}> does not have a profile banner.`)] });
  }
  const url = user.bannerURL({ size: 4096, extension: 'png' });
  return message.reply({
    embeds: [new EmbedBuilder()
      .setTitle(`🖼️ ${user.username}'s Banner`)
      .setImage(url)
      .setColor(COLORS.primary)
      .setFooter({ text: 'Kaido' })
      .setTimestamp()
    ]
  });
}

// ══════════════════════════════════════════════════════════
// GUILDICON
// ══════════════════════════════════════════════════════════
async function handleGuildicon(message, args) {
  let guild = message.guild;
  if (args[0]) {
    const id = args[0].replace(/\D/g, '');
    guild = message.client.guilds.cache.get(id);
    if (!guild) return message.reply({ embeds: [error('Guild Not Found', 'I am not in that guild or the ID is invalid.')] });
  }
  if (!guild.icon) return message.reply({ embeds: [error('No Icon', 'This guild does not have an icon.')] });
  const url = guild.iconURL({ size: 4096, extension: 'png' });
  return message.reply({
    embeds: [new EmbedBuilder()
      .setTitle(`🏰 ${guild.name}'s Icon`)
      .setImage(url)
      .setColor(COLORS.primary)
      .setFooter({ text: guild.id })
      .setTimestamp()
    ]
  });
}

// ══════════════════════════════════════════════════════════
// GUILDBANNER
// ══════════════════════════════════════════════════════════
async function handleGuildbanner(message, args) {
  let guild = message.guild;
  if (args[0]) {
    const id = args[0].replace(/\D/g, '');
    guild = message.client.guilds.cache.get(id);
    if (!guild) return message.reply({ embeds: [error('Guild Not Found', 'I am not in that guild or the ID is invalid.')] });
  }
  if (!guild.banner) return message.reply({ embeds: [error('No Banner', 'This guild does not have a banner.')] });
  const url = guild.bannerURL({ size: 4096, extension: 'png' });
  return message.reply({
    embeds: [new EmbedBuilder()
      .setTitle(`🏰 ${guild.name}'s Banner`)
      .setImage(url)
      .setColor(COLORS.primary)
      .setFooter({ text: guild.id })
      .setTimestamp()
    ]
  });
}

// ══════════════════════════════════════════════════════════
// SPLASH
// ══════════════════════════════════════════════════════════
async function handleSplash(message, args) {
  let guild = message.guild;
  if (args[0]) {
    const id = args[0].replace(/\D/g, '');
    guild = message.client.guilds.cache.get(id);
    if (!guild) return message.reply({ embeds: [error('Guild Not Found', 'I am not in that guild or the ID is invalid.')] });
  }
  if (!guild.splash) return message.reply({ embeds: [error('No Splash', 'This guild does not have a splash background.')] });
  const url = guild.splashURL({ size: 4096, extension: 'png' });
  return message.reply({
    embeds: [new EmbedBuilder()
      .setTitle(`🏰 ${guild.name}'s Splash`)
      .setImage(url)
      .setColor(COLORS.primary)
      .setFooter({ text: guild.id })
      .setTimestamp()
    ]
  });
}

// ══════════════════════════════════════════════════════════
// SERVERINFO
// ══════════════════════════════════════════════════════════
async function handleServerinfo(message, client) {
  const guild = message.guild;
  await guild.fetch().catch(() => {});
  await guild.members.fetch().catch(() => {});

  const owner = await guild.fetchOwner().catch(() => null);
  const bots = guild.members.cache.filter(m => m.user.bot).size;
  const humans = guild.memberCount - bots;
  const channels = { text: 0, voice: 0, category: 0, forum: 0, stage: 0 };
  guild.channels.cache.forEach(ch => {
    if (ch.type === ChannelType.GuildText) channels.text++;
    else if (ch.type === ChannelType.GuildVoice) channels.voice++;
    else if (ch.type === ChannelType.GuildCategory) channels.category++;
    else if (ch.type === ChannelType.GuildForum) channels.forum++;
    else if (ch.type === ChannelType.GuildStageVoice) channels.stage++;
  });

  const embed = new EmbedBuilder()
    .setTitle(`🏰 ${guild.name}`)
    .setThumbnail(guild.iconURL({ size: 256 }))
    .setColor(COLORS.primary)
    .addFields(
      { name: 'Server ID', value: guild.id, inline: true },
      { name: 'Owner', value: owner ? `${owner.user.tag}` : 'Unknown', inline: true },
      { name: 'Created', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`, inline: true },
      { name: '👥 Members', value: `${guild.memberCount} total\n${humans} humans | ${bots} bots`, inline: true },
      { name: '💬 Channels', value: `${channels.text} text | ${channels.voice} voice\n${channels.category} categories | ${channels.forum} forums | ${channels.stage} stages`, inline: true },
      { name: '🎭 Roles', value: guild.roles.cache.size.toString(), inline: true },
      { name: '😀 Emojis', value: `${guild.emojis.cache.size}/${guild.premiumTier >= 2 ? 250 : 50}`, inline: true },
      { name: '🚀 Boosts', value: `${guild.premiumSubscriptionCount || 0} boosts — Level ${guild.premiumTier}`, inline: true },
      { name: '🔒 Verification', value: guild.verificationLevel.toString(), inline: true },
    )
    .setFooter({ text: 'Kaido' })
    .setTimestamp();

  if (guild.banner) embed.setImage(guild.bannerURL({ size: 1024 }));
  if (guild.description) embed.setDescription(guild.description);

  return message.reply({ embeds: [embed] });
}

// ══════════════════════════════════════════════════════════
// USERINFO
// ══════════════════════════════════════════════════════════
async function handleUserinfo(message, target, client) {
  const guild = message.guild;
  let member, user;

  if (target) {
    user = target;
    member = await guild.members.fetch(target.id).catch(() => null);
  } else {
    user = message.author;
    member = message.member;
  }

  const roles = member?.roles.cache
    .filter(r => r.id !== guild.id)
    .sort((a, b) => b.position - a.position)
    .map(r => `<@&${r.id}>`)
    .slice(0, 15)
    .join(' ') || 'None';

  const joined = member?.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : 'Unknown';
  const created = `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`;
  const flags = user.flags?.toArray().map(f => `\`${f}\``).join(', ') || 'None';

  const embed = new EmbedBuilder()
    .setTitle(`👤 ${user.username}`)
    .setThumbnail(user.displayAvatarURL({ size: 256 }))
    .setColor(member?.displayHexColor || COLORS.primary)
    .addFields(
      { name: 'User', value: `${user} (${user.id})`, inline: false },
      { name: 'Nickname', value: member?.nickname || 'None', inline: true },
      { name: 'Bot', value: user.bot ? 'Yes' : 'No', inline: true },
      { name: 'Account Created', value: created, inline: false },
      { name: 'Joined Server', value: joined, inline: false },
      { name: `Roles [${(member?.roles.cache.size || 1) - 1}]`, value: roles.length > 1024 ? roles.slice(0, 1020) + '...' : roles },
      { name: 'Badges', value: flags },
    )
    .setFooter({ text: 'Kaido' })
    .setTimestamp();

  if (user.banner) embed.setImage(user.bannerURL({ size: 1024 }));

  return message.reply({ embeds: [embed] });
}

// ══════════════════════════════════════════════════════════
// STICKER SYSTEM
// ══════════════════════════════════════════════════════════
async function handleSticker(message, args) {
  const sub = args[0]?.toLowerCase();
  const guild = message.guild;

  if (sub === 'cleanup') {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageExpressions) || !message.member.permissions.has(PermissionFlagsBits.ManageGuild))
      return message.reply({ embeds: [error('Permission Denied', 'You need **Manage Expressions** and **Manage Server**.')] });

    const stickers = await guild.stickers.fetch();
    let cleaned = 0;
    for (const [, s] of stickers) {
      const cleanName = s.name.replace(/[^a-zA-Z0-9_\-]/g, '').slice(0, 30);
      if (cleanName && cleanName !== s.name) {
        await s.edit({ name: cleanName }).catch(() => {});
        cleaned++;
      }
    }
    return message.reply({ embeds: [success('Sticker Cleanup', `Cleaned **${cleaned}** sticker name(s).`)] });
  }

  if (sub === 'tag') {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageExpressions) || !message.member.permissions.has(PermissionFlagsBits.ManageGuild))
      return message.reply({ embeds: [error('Permission Denied', 'You need **Manage Expressions** and **Manage Server**.')] });

    const vanity = guild.vanityURLCode;
    if (!vanity) return message.reply({ embeds: [error('No Vanity', 'This server does not have a vanity URL.')] });

    const stickers = await guild.stickers.fetch();
    let tagged = 0;
    for (const [, s] of stickers) {
      if (!s.name.includes(vanity)) {
        const newName = `${s.name}_${vanity}`.slice(0, 30);
        await s.edit({ name: newName }).catch(() => {});
        tagged++;
      }
    }
    return message.reply({ embeds: [success('Sticker Tag', `Tagged **${tagged}** sticker(s) with vanity \`${vanity}\`.`)] });
  }

  if (sub === 'add') {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageExpressions))
      return message.reply({ embeds: [error('Permission Denied', 'You need **Manage Expressions**.')] });

    const url = args[1];
    const name = args[2];
    if (!url || !name) return message.reply({ embeds: [error('Missing Args', 'Usage: `,sticker add <url> <name>`')] });
    if (name.length < 2 || name.length > 30) return message.reply({ embeds: [error('Invalid Name', 'Sticker name must be 2–30 characters.')] });

    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error('Failed to download');
      const buf = Buffer.from(await res.arrayBuffer());
      const sticker = await guild.stickers.create({ file: buf, name, tags: 'discord' });
      return message.reply({ embeds: [success('Sticker Added', `Added **${sticker.name}**`)] });
    } catch (err) {
      return message.reply({ embeds: [error('Failed', err.message)] });
    }
  }

  if (sub === 'remove') {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageExpressions))
      return message.reply({ embeds: [error('Permission Denied', 'You need **Manage Expressions**.')] });

    const name = args[1];
    if (!name) return message.reply({ embeds: [error('Missing Name', 'Usage: `,sticker remove <name>`')] });

    const stickers = await guild.stickers.fetch();
    const sticker = stickers.find(s => s.name.toLowerCase() === name.toLowerCase());
    if (!sticker) return message.reply({ embeds: [error('Not Found', `No sticker named "${name}" found.`)] });

    await sticker.delete();
    return message.reply({ embeds: [success('Sticker Removed', `Removed **${name}**.`)] });
  }

  if (sub === 'rename') {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageExpressions))
      return message.reply({ embeds: [error('Permission Denied', 'You need **Manage Expressions**.')] });

    const oldName = args[1];
    const newName = args[2];
    if (!oldName || !newName) return message.reply({ embeds: [error('Missing Args', 'Usage: `,sticker rename <old> <new>`')] });

    const stickers = await guild.stickers.fetch();
    const sticker = stickers.find(s => s.name.toLowerCase() === oldName.toLowerCase());
    if (!sticker) return message.reply({ embeds: [error('Not Found', `No sticker named "${oldName}" found.`)] });

    await sticker.edit({ name: newName });
    return message.reply({ embeds: [success('Sticker Renamed', `Renamed to **${newName}**.`)] });
  }

  // Default: list stickers
  const stickers = await guild.stickers.fetch();
  if (!stickers.size) return message.reply({ embeds: [info('Stickers', 'This server has no stickers.')] });

  const lines = [...stickers.values()].map(s => `**${s.name}** — \`${s.id}\` — ${s.format === 1 ? 'PNG' : s.format === 2 ? 'APNG' : 'LOTTIE'}`);
  const pages = chunk(lines, 10).map((pg, i) => ({
    title: `🎨 Stickers [${stickers.size}] — Page ${i + 1}`,
    description: pg.join('\n'),
    color: COLORS.primary,
  }));

  const { sendPaginated } = require('../utils/paginator');
  return sendPaginated(message.channel, pages, message.author.id);
}

// ══════════════════════════════════════════════════════════
// IMAGE MANIPULATION (rotate, compress, invert)
// ══════════════════════════════════════════════════════════
async function handleRotate(message, args) {
  const degree = parseInt(args[0]) || 90;
  let imageUrl;
  try { imageUrl = await resolveImageUrl(message, args.slice(1)); }
  catch (e) { return message.reply({ embeds: [error('No Image', 'Could not find an image.')] }); }

  let inputPath, outputPath;
  try {
    inputPath = await fetchToTemp(imageUrl, '.png');
    outputPath = tmpPath('.png');
    await run(MAGICK, [inputPath + '[0]', '-rotate', String(degree), outputPath]);
    await message.reply({ files: [new AttachmentBuilder(outputPath, { name: 'rotated.png' })] });
  } catch (err) {
    return message.reply({ embeds: [error('Failed', err.message?.slice(0, 200) || 'Unknown error')] });
  } finally {
    safeDelete(inputPath, outputPath);
  }
}

async function handleCompress(message, args) {
  const ratio = Math.min(Math.max(parseInt(args[0]) || 50, 1), 100);
  let imageUrl;
  try { imageUrl = await resolveImageUrl(message, args.slice(1)); }
  catch (e) { return message.reply({ embeds: [error('No Image', 'Could not find an image.')] }); }

  let inputPath, outputPath;
  try {
    inputPath = await fetchToTemp(imageUrl, '.png');
    outputPath = tmpPath('.jpg');
    await run(MAGICK, [inputPath + '[0]', '-quality', String(ratio), outputPath]);
    await message.reply({ files: [new AttachmentBuilder(outputPath, { name: `compressed_${ratio}.jpg` })] });
  } catch (err) {
    return message.reply({ embeds: [error('Failed', err.message?.slice(0, 200) || 'Unknown error')] });
  } finally {
    safeDelete(inputPath, outputPath);
  }
}

async function handleInvert(message, args) {
  let imageUrl;
  try { imageUrl = await resolveImageUrl(message, args); }
  catch (e) { return message.reply({ embeds: [error('No Image', 'Could not find an image.')] }); }

  let inputPath, outputPath;
  try {
    inputPath = await fetchToTemp(imageUrl, '.png');
    outputPath = tmpPath('.png');
    await run(MAGICK, [inputPath + '[0]', '-negate', outputPath]);
    await message.reply({ files: [new AttachmentBuilder(outputPath, { name: 'inverted.png' })] });
  } catch (err) {
    return message.reply({ embeds: [error('Failed', err.message?.slice(0, 200) || 'Unknown error')] });
  } finally {
    safeDelete(inputPath, outputPath);
  }
}

// ══════════════════════════════════════════════════════════
// EMOJI SYSTEM
// ══════════════════════════════════════════════════════════
async function handleEmoji(message, args) {
  const sub = args[0]?.toLowerCase();
  const guild = message.guild;

  if (!sub || sub === 'list') {
    const emojis = [...guild.emojis.cache.values()];
    if (!emojis.length) return message.reply({ embeds: [info('Emojis', 'This server has no custom emojis.')] });

    const lines = emojis.map(e => `${e} — **${e.name}** — \`${e.id}\` — ${e.animated ? 'Animated' : 'Static'}`);
    const pages = chunk(lines, 15).map((pg, i) => ({
      title: `😀 Emojis [${emojis.length}] — Page ${i + 1}`,
      description: pg.join('\n'),
      color: COLORS.primary,
    }));
    const { sendPaginated } = require('../utils/paginator');
    return sendPaginated(message.channel, pages, message.author.id);
  }

  if (sub === 'rename') {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageExpressions))
      return message.reply({ embeds: [error('Permission Denied', 'You need **Manage Expressions**.')] });

    const emojiStr = args[1];
    const newName = args[2];
    if (!emojiStr || !newName) return message.reply({ embeds: [error('Missing Args', 'Usage: `,emoji rename <emoji> <new_name>`')] });

    const match = emojiStr.match(/<(a)?:(\w+):(\d+)>/);
    const emojiId = match ? match[3] : emojiStr.replace(/\D/g, '');
    const emoji = guild.emojis.cache.get(emojiId);
    if (!emoji) return message.reply({ embeds: [error('Not Found', 'Emoji not found in this server.')] });

    await emoji.edit({ name: newName });
    return message.reply({ embeds: [success('Emoji Renamed', `Renamed to **${newName}**`)] });
  }

  if (sub === 'add') {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageExpressions))
      return message.reply({ embeds: [error('Permission Denied', 'You need **Manage Expressions**.')] });

    const emojiStr = args[1];
    const name = args[2];
    if (!emojiStr || !name) return message.reply({ embeds: [error('Missing Args', 'Usage: `,emoji add <emoji> <name>`')] });

    const match = emojiStr.match(/<(a)?:(\w+):(\d+)>/);
    if (!match) return message.reply({ embeds: [error('Invalid Emoji', 'Provide a custom emoji.')] });

    const animated = !!match[1];
    const ext = animated ? 'gif' : 'png';
    const id = match[3];
    const url = `https://cdn.discordapp.com/emojis/${id}.${ext}?size=256`;

    try {
      const emoji = await guild.emojis.create({ attachment: url, name });
      return message.reply({ embeds: [success('Emoji Added', `Added ${emoji}`)] });
    } catch (err) {
      return message.reply({ embeds: [error('Failed', err.message)] });
    }
  }

  if (sub === 'stats') {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageExpressions))
      return message.reply({ embeds: [error('Permission Denied', 'You need **Manage Expressions**.')] });

    const db = getGuildDb(guild.id);
    const stats = db.get('emojiStats', {});
    const sorted = Object.entries(stats)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    if (!sorted.length) return message.reply({ embeds: [info('Emoji Stats', 'No emoji usage data yet.')] });

    let desc = '';
    for (let i = 0; i < sorted.length; i++) {
      const [id, count] = sorted[i];
      const emoji = guild.emojis.cache.get(id);
      desc += `**${i + 1}.** ${emoji || `\`:${id}:\``} — **${count}** uses\n`;
    }
    return message.reply({ embeds: [new EmbedBuilder().setTitle('😀 Top 10 Emojis').setDescription(desc).setColor(COLORS.primary)] });
  }

  if (sub === 'removemany') {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageExpressions))
      return message.reply({ embeds: [error('Permission Denied', 'You need **Manage Expressions**.')] });

    const emojiStrs = args.slice(1);
    if (!emojiStrs.length) return message.reply({ embeds: [error('Missing Args', 'Usage: `,emoji removemany <emoji1> <emoji2> ...`')] });

    let removed = 0, failed = 0;
    for (const str of emojiStrs) {
      const match = str.match(/<(a)?:(\w+):(\d+)>/);
      const id = match ? match[3] : str.replace(/\D/g, '');
      const emoji = guild.emojis.cache.get(id);
      if (emoji) { await emoji.delete().catch(() => {}); removed++; }
      else failed++;
    }
    return message.reply({ embeds: [success('Bulk Remove', `Removed **${removed}** emoji(s). **${failed}** failed.`)] });
  }

  if (sub === 'removeduplicates') {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageExpressions))
      return message.reply({ embeds: [error('Permission Denied', 'You need **Manage Expressions**.')] });

    const emojis = [...guild.emojis.cache.values()];
    const seen = new Map();
    let removed = 0;
    for (const e of emojis) {
      const key = `${e.name}-${e.animated}`;
      if (seen.has(key)) {
        await e.delete().catch(() => {});
        removed++;
      } else {
        seen.set(key, e.id);
      }
    }
    return message.reply({ embeds: [success('Duplicates Removed', `Removed **${removed}** duplicate emoji(s).`)] });
  }

  if (sub === 'remove') {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageExpressions))
      return message.reply({ embeds: [error('Permission Denied', 'You need **Manage Expressions**.')] });

    const emojiStr = args[1];
    if (!emojiStr) return message.reply({ embeds: [error('Missing Emoji', 'Usage: `,emoji remove <emoji>`')] });

    const match = emojiStr.match(/<(a)?:(\w+):(\d+)>/);
    const id = match ? match[3] : emojiStr.replace(/\D/g, '');
    const emoji = guild.emojis.cache.get(id);
    if (!emoji) return message.reply({ embeds: [error('Not Found', 'Emoji not found in this server.')] });

    await emoji.delete();
    return message.reply({ embeds: [success('Emoji Removed', `Removed **${emoji.name}**.`)] });
  }

  if (sub === 'information') {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageExpressions))
      return message.reply({ embeds: [error('Permission Denied', 'You need **Manage Expressions**.')] });

    const msgLink = args[1];
    if (!msgLink) return message.reply({ embeds: [error('Missing Link', 'Usage: `,emoji information <message_link>`')] });

    const match = msgLink.match(/channels\/(\d+)\/(\d+)\/(\d+)/);
    if (!match) return message.reply({ embeds: [error('Invalid Link', 'Provide a valid Discord message link.')] });

    const [, gId, cId, mId] = match;
    const msg = await message.client.channels.cache.get(cId)?.messages.fetch(mId).catch(() => null);
    if (!msg) return message.reply({ embeds: [error('Not Found', 'Could not fetch that message.')] });

    const customEmojis = msg.content.match(/<(a)?:(\w+):(\d+)>/g) || [];
    if (!customEmojis.length) return message.reply({ embeds: [info('No Emojis', 'That message contains no custom emojis.')] });

    const last = customEmojis[customEmojis.length - 1];
    const emMatch = last.match(/<(a)?:(\w+):(\d+)>/);
    const emojiId = emMatch[3];
    const emoji = message.client.emojis.cache.get(emojiId) || guild.emojis.cache.get(emojiId);

    if (!emoji) {
      const ext = emMatch[1] ? 'gif' : 'png';
      const url = `https://cdn.discordapp.com/emojis/${emojiId}.${ext}?size=256`;
      return message.reply({
        embeds: [new EmbedBuilder()
          .setTitle(`😀 :${emMatch[2]}:`)
          .setImage(url)
          .setColor(COLORS.primary)
          .addFields(
            { name: 'ID', value: emojiId, inline: true },
            { name: 'Animated', value: emMatch[1] ? 'Yes' : 'No', inline: true },
            { name: 'Source', value: 'External server', inline: true },
          )
        ]
      });
    }

    return message.reply({
      embeds: [new EmbedBuilder()
        .setTitle(`😀 ${emoji}`)
        .setImage(emoji.url)
        .setColor(COLORS.primary)
        .addFields(
          { name: 'Name', value: emoji.name, inline: true },
          { name: 'ID', value: emoji.id, inline: true },
          { name: 'Animated', value: emoji.animated ? 'Yes' : 'No', inline: true },
          { name: 'Created', value: `<t:${Math.floor(emoji.createdTimestamp / 1000)}:R>`, inline: true },
          { name: 'Author', value: emoji.author ? emoji.author.tag : 'Unknown', inline: true },
        )
      ]
    });
  }

  if (sub === 'addmany') {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageExpressions))
      return message.reply({ embeds: [error('Permission Denied', 'You need **Manage Expressions**.')] });

    const emojiStrs = args.slice(1);
    if (!emojiStrs.length) return message.reply({ embeds: [error('Missing Args', 'Usage: `,emoji addmany <emoji1> <emoji2> ...`')] });

    let added = 0, failed = 0;
    for (const str of emojiStrs) {
      const match = str.match(/<(a)?:(\w+):(\d+)>/);
      if (!match) { failed++; continue; }
      const animated = !!match[1];
      const ext = animated ? 'gif' : 'png';
      const id = match[3];
      const name = match[2];
      const url = `https://cdn.discordapp.com/emojis/${id}.${ext}?size=256`;
      try {
        await guild.emojis.create({ attachment: url, name });
        added++;
      } catch { failed++; }
    }
    return message.reply({ embeds: [success('Bulk Add', `Added **${added}** emoji(s). **${failed}** failed.`)] });
  }

  // Default: show large emoji
  const emojiStr = args[0];
  const match = emojiStr?.match(/<(a)?:(\w+):(\d+)>/);
  if (match) {
    const animated = !!match[1];
    const ext = animated ? 'gif' : 'png';
    const id = match[3];
    const url = `https://cdn.discordapp.com/emojis/${id}.${ext}?size=256`;
    return message.reply({
      embeds: [new EmbedBuilder()
        .setTitle(`😀 :${match[2]}:`)
        .setImage(url)
        .setColor(COLORS.primary)
      ]
    });
  }

  return message.reply({ embeds: [info('Usage', '```,emoji — show large emoji or list\n,emoji rename <emoji> <new_name>\n,emoji add <emoji> <name>\n,emoji stats\n,emoji removemany <emoji1> <emoji2> ...\n,emoji removeduplicates\n,emoji remove <emoji>\n,emoji information <message_link>\n,emoji addmany <emoji1> <emoji2> ...```')] });
}

// ══════════════════════════════════════════════════════════
// EXPORT
// ══════════════════════════════════════════════════════════
module.exports = {
 updateSeen,
 handleSeen,
 handleMembercount,
 handleRoleinfo,
 handleChannelinfo,
 handleAvatar,
 handleServeravatar,
 handleServerbanner,
 handleBanner,
 handleGuildicon,
 handleGuildbanner,
 handleSplash,
 handleServerinfo,
 handleUserinfo,
 handleSticker,
 handleRotate,
 handleCompress,
 handleInvert,
 handleEmoji,
 // utilities for infoExtras
 fetchToTemp,
 tmpPath,
 safeDelete,
 resolveImageUrl,
 run,
};
// --