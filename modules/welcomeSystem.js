/**
 * welcomeSystem.js — Welcome, Goodbye, Boost, and Level-Up message system
 *
 * Uses unified embed parser from utils/embedParser.js
 * Embed code format (start with {embed}$v):
 *   {embed}$v{message: text}$v{color: hex}$v{thumbnail: url}$v
 *   {title: text}$v{description: text}$v{footer: text && iconUrl}$v
 *   {image: url}$v{author: name && iconUrl && url}$v
 *   {field: Name && Value && inline}$v{timestamp}$v{url: https://link}
 *   {button: url && label && emoji && enabled|disabled}
 *
 * All supported variables are listed in buildWelcomeVars() below.
 */

const { ChannelType } = require('discord.js');
const { getGuildDb } = require('./database');
const { parseEmbedCode, buildWelcomeVars, buildChannelVars } = require('../utils/embedParser');

// ══════════════════════════════════════════════════════════
// SEND SYSTEM MESSAGE
// ══════════════════════════════════════════════════════════
async function sendSystemMessage(channel, template, vars, guild) {
  if (!channel || !template) return;
  try {
    const { content, embeds, components } = parseEmbedCode(template, vars, guild);
    const payload = {};
    if (content) payload.content = content;
    if (embeds?.length) payload.embeds = embeds;
    if (components?.length) payload.components = components;
    if (!payload.content && !payload.embeds?.length) return;
    await channel.send(payload);
  } catch {}
}

// ══════════════════════════════════════════════════════════
// EVENT TRIGGERS
// ══════════════════════════════════════════════════════════

async function triggerWelcome(member) {
  const db = getGuildDb(member.guild.id);
  const cfg = db.get('welcomeConfig', {});
  if (!cfg.enabled || !cfg.channelId) return;
  const ch = member.guild.channels.cache.get(cfg.channelId);
  if (!ch) return;
  const template = cfg.message
    || '👋 Welcome to **{guild.name}**, {user.mention}! You are member **#{guild.count}**.';
  await sendSystemMessage(ch, template,
    { ...buildWelcomeVars(member), ...buildChannelVars(ch) }, member.guild);
}

async function triggerGoodbye(member) {
  const db = getGuildDb(member.guild.id);
  const cfg = db.get('goodbyeConfig', {});
  if (!cfg.enabled || !cfg.channelId) return;
  const ch = member.guild.channels.cache.get(cfg.channelId);
  if (!ch) return;
  const template = cfg.message
    || '👋 **{user.name}** left the server. We now have **{guild.count}** members.';
  await sendSystemMessage(ch, template,
    { ...buildWelcomeVars(member), ...buildChannelVars(ch) }, member.guild);
}

async function triggerBoost(member) {
  const db = getGuildDb(member.guild.id);
  const cfg = db.get('boostConfig', {});
  if (!cfg.enabled || !cfg.channelId) return;
  const ch = member.guild.channels.cache.get(cfg.channelId);
  if (!ch) return;
  const template = cfg.message
    || '🚀 {user.mention} just boosted **{guild.name}**! Thank you! 💜\n`{guild.boost_count}` boosts · {guild.boost_tier}';
  await sendSystemMessage(ch, template,
    { ...buildWelcomeVars(member), ...buildChannelVars(ch) }, member.guild);
}

async function triggerLevelUp(message, level) {
  const db = getGuildDb(message.guild.id);
  const levelCfg = db.get('levelMsgConfig', {});
  const cfg = db.get('levelsConfig', {});

  const enabled = levelCfg.enabled !== false;
  if (!enabled) return;

  const mode = levelCfg.mode || cfg.messageMode || 'channel';
  const template = levelCfg.message || cfg.levelMessage
    || '🎉 {user.mention} reached level **{level.new_rank}**!';

  let userXp = 0;
  try {
    const { getUserDb } = require('./database');
    const udb = getUserDb(message.guild.id, message.author.id);
    userXp = udb.data.xp || 0;
  } catch {}

  const vars = {
    ...buildWelcomeVars(message.member),
    ...buildChannelVars(message.channel),
    '{level}': level.toString(),
    '{level.new_rank}': level.toString(),
    '{level.user_xp}': userXp.toString(),
  };

  const { content, embeds, components } = parseEmbedCode(template, vars, message.guild);
  const payload = {};
  if (content) payload.content = content;
  if (embeds?.length) payload.embeds = embeds;
  if (components?.length) payload.components = components;
  if (!payload.content && !payload.embeds?.length) return;

  try {
    if (mode === 'dm') {
      await message.author.send(payload).catch(() => {});
    } else if (mode === 'custom' && (levelCfg.channelId || cfg.levelChannel)) {
      const ch = message.guild.channels.cache.get(levelCfg.channelId || cfg.levelChannel);
      if (ch) await ch.send(payload).catch(() => {});
    } else {
      await message.channel.send(payload).catch(() => {});
    }
  } catch {}
}

// ══════════════════════════════════════════════════════════
// COMMAND HANDLER — shared logic for all 4 systems
// ══════════════════════════════════════════════════════════

const SYSTEM_KEYS = {
  welcome: 'welcomeConfig',
  goodbye: 'goodbyeConfig',
  boosts: 'boostConfig',
  levelupmsg: 'levelMsgConfig',
};

const SYSTEM_LABELS = {
  welcome: 'Welcome',
  goodbye: 'Goodbye',
  boosts: 'Boost',
  levelupmsg: 'Level-Up',
};

async function handleSystemCommand(message, system, args) {
  const { isAdmin } = require('./helpers');
  const { greedOk, greedWarn, greedWarnText, base, COLORS } = require('../utils/embeds');

  if (!isAdmin(message.member))
    return message.reply(greedWarn(message.member, 'Only admins can configure this system.'));

  const db = getGuildDb(message.guild.id);
  const key = SYSTEM_KEYS[system];
  const label = SYSTEM_LABELS[system];
  const cfg = db.get(key, {});
  const sub = args[0]?.toLowerCase();

  if (sub === 'enable') {
    cfg.enabled = true; db.set(key, cfg);
    return message.reply(greedOk(message.member, '**' + label + '** messages enabled.'));
  }
  if (sub === 'disable') {
    cfg.enabled = false; db.set(key, cfg);
    return message.reply(greedOk(message.member, '**' + label + '** messages disabled.'));
  }
  if (sub === 'channel') {
    const ch = message.mentions.channels.first();
    if (!ch) return message.reply(greedWarn(message.member, 'Mention a channel: `,' + system + ' channel #channel`'));
    cfg.channelId = ch.id; db.set(key, cfg);
    return message.reply(greedOk(message.member, '**' + label + '** channel set to <#' + ch.id + '>.'));
  }
  if (sub === 'message') {
    const msg = args.slice(1).join(' ');
    if (!msg) {
      const varList = [
        '`{user.mention}` `{user.name}` `{user.display_name}` `{user.id}` `{user.avatar}`',
        '`{user.join_position}` `{user.join_position_suffix}` `{user.top_role}` `{user.color}`',
        '`{user.boost}` `{user.boost_since}` `{user.created_at}` `{user.joined_at}`',
        '`{guild.name}` `{guild.count}` `{guild.id}` `{guild.vanity}` `{guild.boost_count}` `{guild.boost_tier}`',
        '`{guild.icon}` `{guild.banner}` `{guild.emoji_count}` `{guild.role_count}` `{guild.owner_id}`',
        '`{guild.channels_count}` `{guild.text_channels_count}` `{guild.voice_channels_count}`',
        '`{channel.name}` `{channel.mention}` `{channel.topic}` `{channel.position}`',
        '`{date.now}` `{date.utc_now}` `{date.utc_timestamp}` `{time.now}` `{time.now_military}`',
        '`{boost.count}` (for boosts) `{level.new_rank}` `{level.user_xp}` (for levelup)',
      ];
      return message.reply([
        greedWarnText(message.member, 'Usage: `,' + system + ' message <text>`'),
        '',
        '**Plain text:** `,welcome message Welcome {user.mention}!`',
        '**Embed:** `,welcome message {embed}$v{title: Welcome!}$v{description: Hi {user.mention}}$v{color: 5865F2}$v{thumbnail: {user.avatar}}`',
        '',
        '**Variables:**',
        ...varList,
      ].join('\n'));
    }
    cfg.message = msg; db.set(key, cfg);
    return message.reply(greedOk(message.member, '**' + label + '** message updated.'));
  }
  if (sub === 'preview' || sub === 'test') {
    if (!cfg.message) return message.reply(greedWarn(message.member, 'No message set. Use `,' + system + ' message <text>`'));
    const vars = {
      ...buildWelcomeVars(message.member),
      ...buildChannelVars(message.channel),
      '{level}': '5', '{level.new_rank}': '5', '{level.user_xp}': '1250',
      '{boost.count}': '3',
    };
    const { content, embeds, components } = parseEmbedCode(cfg.message, vars, message.guild);
    const payload = {};
    if (content) payload.content = '**Preview of ' + label + ' message:**\n' + content;
    if (embeds?.length) payload.embeds = embeds;
    if (components?.length) payload.components = components;
    return message.channel.send(payload);
  }
  if (sub === 'reset') {
    db.set(key, {}); return message.reply(greedOk(message.member, '**' + label + '** config reset.'));
  }
  if (!sub || sub === 'view' || sub === 'config') {
    return message.channel.send({ embeds: [base(COLORS.primary)
      .setTitle('⚙️ ' + label + ' System Config')
      .addFields(
        { name: 'Status', value: cfg.enabled ? '✅ Enabled' : '❌ Disabled', inline: true },
        { name: 'Channel', value: cfg.channelId ? '<#' + cfg.channelId + '>' : 'Not set', inline: true },
        { name: 'Message', value: cfg.message ? '```\n' + cfg.message.slice(0, 500) + '\n```' : '*(default)*' },
      )] });
  }

  return message.reply(
    '**' + label + ' Commands:**\n' +
    '`,' + system + ' enable/disable`\n' +
    '`,' + system + ' channel #channel`\n' +
    '`,' + system + ' message <text>`\n' +
    '`,' + system + ' preview` / `,' + system + ' test`\n' +
    '`,' + system + ' view` — view config\n' +
    '`,' + system + ' reset` — reset config'
  );
}

module.exports = {
  triggerWelcome,
  triggerGoodbye,
  triggerBoost,
  triggerLevelUp,
  handleSystemCommand,
};