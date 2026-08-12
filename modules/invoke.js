/**
 * invoke.js — Invoke Message System
 *
 * Customizes bot responses and DMs for moderation commands.
 * Commands supported: jail, unjail, kick, ban, unban, tempban, softban, hardban,
 * timeout, untimeout, warn, mute, unmute, imute, iunmute,
 * rmute, runmute
 *
 * Variables:
 * {user.mention} {user.name} {user.id} {user.avatar}
 * {mod.mention} {mod.name} {mod.id} {mod.icon}
 * {moderator.mention} {moderator.name} {moderator.id} {moderator.icon}
 * {reason} {guild.name} {guild.id} {guild.icon} {guild.count}
 * {case.id} {duration} {timestamp}
 */

const { PermissionFlagsBits } = require('discord.js');
const { getGuildDb } = require('./database');
const { COLORS, base } = require('../utils/embeds');
const { parseInvokeMessage } = require('../utils/embedParser');

// ══════════════════════════════════════════════════════════
// DEFAULT MESSAGES — DMs DISABLED BY DEFAULT (empty = no DM sent)
// ══════════════════════════════════════════════════════════
const DEFAULT_MESSAGES = {
  jail:     { message: '👍', dm: '' },
  unjail:   { message: '👍', dm: '' },
  kick:     { message: '👍', dm: '' },
  ban:      { message: '👍', dm: '' },
  unban:    { message: '👍', dm: '' },
  tempban:  { message: '👍', dm: '' },
  softban:  { message: '👍', dm: '' },
  hardban:  { message: '👍', dm: '' },
  timeout:  { message: '👍', dm: '' },
  untimeout:{ message: '👍', dm: '' },
  warn:     { message: '👍', dm: '' },
  mute:     { message: '👍', dm: '' },
  unmute:   { message: '👍', dm: '' },
  imute:    { message: '👍', dm: '' },
  iunmute:  { message: '👍', dm: '' },
  rmute:    { message: '👍', dm: '' },
  runmute:  { message: '👍', dm: '' },
};

const VALID_COMMANDS = Object.keys(DEFAULT_MESSAGES);

// ══════════════════════════════════════════════════════════
// VARIABLE REPLACEMENT (invoke-specific)
// ══════════════════════════════════════════════════════════
function replaceInvokeVars(template, vars) {
  if (!template) return template;
  let result = template;

  result = result.replace(/{user\.mention}/gi, vars.userMention || vars.targetMention || '{user.mention}');
  result = result.replace(/{user\.name}/gi, vars.userName || vars.targetName || '{user.name}');
  result = result.replace(/{user\.id}/gi, vars.userId || vars.targetId || '{user.id}');
  result = result.replace(/{user\.avatar}/gi, vars.userAvatar || vars.targetAvatar || '');

  result = result.replace(/{target\.mention}/gi, vars.targetMention || vars.userMention || '{target.mention}');
  result = result.replace(/{target\.name}/gi, vars.targetName || vars.userName || '{target.name}');
  result = result.replace(/{target\.id}/gi, vars.targetId || vars.userId || '{target.id}');
  result = result.replace(/{target\.avatar}/gi, vars.targetAvatar || vars.userAvatar || '');

  const modMention = vars.modMention || vars.moderatorMention || '{mod.mention}';
  const modName = vars.modName || vars.moderatorName || '{mod.name}';
  const modId = vars.modId || vars.moderatorId || '{mod.id}';
  const modIcon = vars.modIcon || vars.moderatorIcon || vars.modAvatar || vars.moderatorAvatar || '';

  result = result.replace(/{mod\.mention}/gi, modMention);
  result = result.replace(/{moderator\.mention}/gi, modMention);
  result = result.replace(/{mod\.name}/gi, modName);
  result = result.replace(/{moderator\.name}/gi, modName);
  result = result.replace(/{mod\.id}/gi, modId);
  result = result.replace(/{moderator\.id}/gi, modId);
  result = result.replace(/{mod\.icon}/gi, modIcon);
  result = result.replace(/{moderator\.icon}/gi, modIcon);
  result = result.replace(/{mod\.avatar}/gi, modIcon);
  result = result.replace(/{moderator\.avatar}/gi, modIcon);

  result = result.replace(/{guild\.name}/gi, vars.guildName || '{guild.name}');
  result = result.replace(/{guild\.id}/gi, vars.guildId || '{guild.id}');
  result = result.replace(/{guild\.icon}/gi, vars.guildIcon || '');
  result = result.replace(/{guild\.count}/gi, vars.guildCount || '{guild.count}');

  result = result.replace(/{reason}/gi, vars.reason || 'No reason provided');
  result = result.replace(/{case\.id}/gi, vars.caseId || '{case.id}');
  result = result.replace(/{duration}/gi, vars.duration || '');
  result = result.replace(/{timestamp}/gi, '');

  return result;
}

// ══════════════════════════════════════════════════════════
// GET INVOKE REPLY (public message)
// ══════════════════════════════════════════════════════════
function getInvokeReply(guildId, command, vars, guild) {
  const db = getGuildDb(guildId);
  const invokes = db.get('invokeMessages', {});
  const custom = invokes[command]?.message;
  const raw = custom || DEFAULT_MESSAGES[command]?.message || '👍';
  const text = replaceInvokeVars(raw, vars);
  return parseInvokeMessage(text, vars, guild);
}

// ══════════════════════════════════════════════════════════
// GET INVOKE DM
// Returns null if no custom DM is set (disabled by default)
// ══════════════════════════════════════════════════════════
function getInvokeDm(guildId, command, vars, guild) {
  const db = getGuildDb(guildId);
  const invokes = db.get('invokeMessages', {});
  const custom = invokes[command]?.dm;
  if (!custom || !custom.trim()) return null;
  const text = replaceInvokeVars(custom, vars);
  return parseInvokeMessage(text, vars, guild);
}

// ══════════════════════════════════════════════════════════
// SEND INVOKE DM
// Only sends if a custom DM is configured
// ══════════════════════════════════════════════════════════
async function sendInvokeDm(user, guildId, command, vars, guild) {
  const dmPayload = getInvokeDm(guildId, command, vars, guild);
  if (!dmPayload) return;

  try {
    const payload = {};
    if (dmPayload.content) payload.content = dmPayload.content;
    if (dmPayload.embeds?.length) payload.embeds = dmPayload.embeds;
    if (dmPayload.components?.length) payload.components = dmPayload.components;
    if (Object.keys(payload).length) await user.send(payload);
  } catch (err) {
    // User has DMs closed — silently fail
  }
}

// ══════════════════════════════════════════════════════════
// PREVIEW VARIABLES
// ══════════════════════════════════════════════════════════
function getPreviewVars(guild) {
  return {
    targetMention: '@User',
    targetName: 'ExampleUser',
    targetId: '123456789',
    targetAvatar: 'https://cdn.discordapp.com/embed/avatars/0.png',
    userMention: '@User',
    userName: 'ExampleUser',
    userId: '123456789',
    userAvatar: 'https://cdn.discordapp.com/embed/avatars/0.png',
    modMention: '@Moderator',
    modName: 'Moderator',
    modId: '987654321',
    modIcon: 'https://cdn.discordapp.com/embed/avatars/1.png',
    moderatorMention: '@Moderator',
    moderatorName: 'Moderator',
    moderatorId: '987654321',
    moderatorIcon: 'https://cdn.discordapp.com/embed/avatars/1.png',
    reason: 'Example reason',
    guildName: guild?.name || 'Server Name',
    guildId: guild?.id || '000000000',
    guildIcon: guild?.iconURL?.() || '',
    guildCount: (guild?.memberCount ?? 0).toString(),
    caseId: '#42',
    duration: '1d',
  };
}

// ══════════════════════════════════════════════════════════
// COMMAND HANDLER: ,invoke
// ══════════════════════════════════════════════════════════
async function handleInvokeCommand(message, args) {
  if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    return message.reply({
      embeds: [base(COLORS.error).setTitle('Access Denied').setDescription('You need **Manage Server** permission to manage invoke messages.')]
    });
  }

  const db = getGuildDb(message.guild.id);
  const subCmd = args[0]?.toLowerCase();

  // ── LIST ALL SETTINGS ──
  if (!subCmd || subCmd === 'list') {
    const invokes = db.get('invokeMessages', {});
    const pages = [];

    for (const cmd of VALID_COMMANDS) {
      const settings = invokes[cmd];
      const hasCustom = !!(settings?.message || settings?.dm);
      if (!hasCustom) continue;

      const embed = base(COLORS.primary)
        .setTitle('\uD83D\uDCE8 ' + cmd.charAt(0).toUpperCase() + cmd.slice(1) + ' — Invoke Settings')
        .setFooter({ text: 'Use ,invoke ' + cmd + ' message/dm <text> to edit' });

      const defMsg = DEFAULT_MESSAGES[cmd]?.message || '👍';
      const msgText = settings?.message || defMsg;
      const dmText = settings?.dm || '(disabled)';
      const previewVars = getPreviewVars(message.guild);

      if (settings?.message) {
        const msgPreview = parseInvokeMessage(msgText, previewVars, message.guild);
        embed.addFields({ name: '\uD83D\uDCAC Public Reply (custom)', value: msgPreview.content || '(embed)', inline: false });
      } else {
        embed.addFields({ name: '\uD83D\uDCAC Public Reply (default)', value: msgText.length > 1000 ? msgText.substring(0, 1000) + '...' : msgText, inline: false });
      }

      if (settings?.dm) {
        const dmPreview = parseInvokeMessage(dmText, previewVars, message.guild);
        embed.addFields({ name: '\uD83D\uDCE9 DM (enabled)', value: dmPreview.content || '(embed)', inline: false });
      } else {
        embed.addFields({ name: '\uD83D\uDCE9 DM', value: '\u274C Disabled (no default)', inline: false });
      }

      const copyCode = '```\n,invoke ' + cmd + ' message ' + (settings?.message || '') + '\n,invoke ' + cmd + ' dm ' + (settings?.dm || '') + '\n```';
      embed.addFields({ name: '\uD83D\uDCCB Copy-Paste', value: copyCode, inline: false });
      pages.push(embed);
    }

    if (!pages.length) {
      const cmdList = VALID_COMMANDS.map(c => '`' + c + '`').join(', ');
      return message.reply({
        embeds: [base(COLORS.primary).setTitle('\uD83D\uDCE8 Invoke Messages').setDescription(
          'No custom invoke messages set. Use `,invoke <cmd> message/dm <text>` to configure.\n\n**Available commands:**\n' + cmdList
        )]
      });
    }

    const { sendPaginatedEmbeds } = require('../utils/paginator');
    return sendPaginatedEmbeds(message.channel, pages, message.author.id);
  }

  // ── VALIDATE COMMAND ──
  if (!VALID_COMMANDS.includes(subCmd)) {
    return message.reply({
      embeds: [base(COLORS.error).setTitle('Invalid Command').setDescription(
        'Valid commands: ' + VALID_COMMANDS.map(c => '`' + c + '`').join(', ')
      )]
    });
  }

  const type = args[1]?.toLowerCase();
  const rawText = args.slice(2).join(' ').trim();

  // ── RESET ENTIRE COMMAND ──
  if (type === 'reset') {
    const invokes = db.get('invokeMessages', {});
    if (invokes[subCmd]) {
      delete invokes[subCmd];
      db.set('invokeMessages', invokes);
    }
    return message.reply({
      embeds: [base(COLORS.success).setTitle('Reset').setDescription('Invoke settings for `' + subCmd + '` have been reset to defaults. DMs are now disabled.')]
    });
  }

  // ── VIEW MODE: ,invoke <cmd> view ──
  if (type === 'view') {
    const invokes = db.get('invokeMessages', {});
    const settings = invokes[subCmd] || {};
    const previewVars = getPreviewVars(message.guild);

    const embed = base(COLORS.primary)
      .setTitle('\uD83D\uDCE8 ' + subCmd.charAt(0).toUpperCase() + subCmd.slice(1) + ' — Current Settings')
      .setFooter({ text: 'Use ,invoke ' + subCmd + ' message/dm <text> to edit' });

    const defMsg = DEFAULT_MESSAGES[subCmd]?.message || '👍';
    const msgText = settings.message || defMsg;

    if (settings.message) {
      const msgPreview = parseInvokeMessage(msgText, previewVars, message.guild);
      embed.addFields({ name: '\uD83D\uDCAC Public Reply (custom)', value: msgPreview.content || '(embed)', inline: false });
    } else {
      embed.addFields({ name: '\uD83D\uDCAC Public Reply (default)', value: msgText.length > 1000 ? msgText.substring(0, 1000) + '...' : msgText, inline: false });
    }

    if (settings.dm) {
      const dmPreview = parseInvokeMessage(settings.dm, previewVars, message.guild);
      embed.addFields({ name: '\uD83D\uDCE9 DM (enabled)', value: dmPreview.content || '(embed)', inline: false });
    } else {
      embed.addFields({ name: '\uD83D\uDCE9 DM', value: '\u274C Disabled (no default)', inline: false });
    }

    const copyCode = '```\n,invoke ' + subCmd + ' message ' + (settings.message || '') + '\n,invoke ' + subCmd + ' dm ' + (settings.dm || '') + '\n```';
    embed.addFields({ name: '\uD83D\uDCCB Copy-Paste', value: copyCode, inline: false });
    return message.reply({ embeds: [embed] });
  }

  // ── SUBCOMMAND HANDLER ──
  const subType = args[2]?.toLowerCase();
  const isViewSub = subType === 'view';
  const actualRawText = isViewSub ? '' : args.slice(2).join(' ').trim();

  // Handle ,invoke <cmd> message view
  if (type === 'message' && subType === 'view') {
    const invokes = db.get('invokeMessages', {});
    const settings = invokes[subCmd] || {};
    const previewVars = getPreviewVars(message.guild);

    const embed = base(COLORS.primary)
      .setTitle('\uD83D\uDCAC ' + subCmd.charAt(0).toUpperCase() + subCmd.slice(1) + ' — Public Reply');

    const defMsg = DEFAULT_MESSAGES[subCmd]?.message || '👍';
    const msgText = settings.message || defMsg;

    if (settings.message) {
      const msgPreview = parseInvokeMessage(msgText, previewVars, message.guild);
      embed.setDescription('**Current custom:**\n' + (msgPreview.content || '(embed)'));
      if (msgPreview.embeds?.[0]) {
        return message.reply({ embeds: [embed, msgPreview.embeds[0]] });
      }
    } else {
      embed.setDescription('**Default:**\n' + msgText);
    }

    const copyCode = '```\n,invoke ' + subCmd + ' message ' + (settings.message || '') + '\n```';
    embed.addFields({ name: '\uD83D\uDCCB Copy-Paste', value: copyCode, inline: false });
    return message.reply({ embeds: [embed] });
  }

  // Handle ,invoke <cmd> dm view
  if (type === 'dm' && subType === 'view') {
    const invokes = db.get('invokeMessages', {});
    const settings = invokes[subCmd] || {};
    const previewVars = getPreviewVars(message.guild);

    const embed = base(COLORS.primary)
      .setTitle('\uD83D\uDCE9 ' + subCmd.charAt(0).toUpperCase() + subCmd.slice(1) + ' — DM Message');

    if (settings.dm) {
      const dmPreview = parseInvokeMessage(settings.dm, previewVars, message.guild);
      embed.setDescription('**Current custom:**\n' + (dmPreview.content || '(embed)'));
      if (dmPreview.embeds?.[0]) {
        return message.reply({ embeds: [embed, dmPreview.embeds[0]] });
      }
    } else {
      embed.setDescription('\u274C **Disabled** — No DM is sent for this command by default.\nUse `,invoke ' + subCmd + ' dm <text>` to enable.');
    }

    const copyCode = '```\n,invoke ' + subCmd + ' dm ' + (settings.dm || '') + '\n```';
    embed.addFields({ name: '\uD83D\uDCCB Copy-Paste', value: copyCode, inline: false });
    return message.reply({ embeds: [embed] });
  }

  // ── RESET SUB-TYPE ──
  if (subType === 'reset') {
    const invokes = db.get('invokeMessages', {});
    if (!invokes[subCmd]) invokes[subCmd] = {};
    if (type === 'message') delete invokes[subCmd].message;
    if (type === 'dm') delete invokes[subCmd].dm;
    if (!invokes[subCmd].message && !invokes[subCmd].dm) delete invokes[subCmd];
    db.set('invokeMessages', invokes);

    const extra = type === 'dm' ? ' DMs are now disabled for this command.' : '';
    return message.reply({
      embeds: [base(COLORS.success).setTitle('Reset').setDescription('`' + type + '` for `' + subCmd + '` reset to default.' + extra)]
    });
  }

  // ── VALIDATE TYPE ──
  if (!['message', 'dm'].includes(type)) {
    return message.reply({
      embeds: [base(COLORS.error).setTitle('Invalid Type').setDescription(
        'Usage:\n' +
        '`,invoke ' + subCmd + ' message <text>` — set public reply\n' +
        '`,invoke ' + subCmd + ' dm <text>` — set DM to user\n' +
        '`,invoke ' + subCmd + ' message view` — view public reply\n' +
        '`,invoke ' + subCmd + ' dm view` — view DM\n' +
        '`,invoke ' + subCmd + ' reset` — reset entire command\n' +
        '`,invoke ' + subCmd + ' message reset` — reset public reply\n' +
        '`,invoke ' + subCmd + ' dm reset` — disable DM\n' +
        '`,invoke list` — view all settings\n\n' +
        '**Example:**\n' +
        '`,invoke jail message {user.mention} has been jailed for {reason}`\n' +
        '`,invoke jail dm You were jailed for {reason}`'
      )]
    });
  }

  // ── VIEW WITHOUT TEXT (show current) ──
  if (!actualRawText && !isViewSub) {
    const invokes = db.get('invokeMessages', {});
    const settings = invokes[subCmd] || {};
    const previewVars = getPreviewVars(message.guild);

    const embed = base(COLORS.primary)
      .setTitle('\uD83D\uDCE8 ' + subCmd.charAt(0).toUpperCase() + subCmd.slice(1) + ' — ' + (type === 'message' ? 'Public Reply' : 'DM'));

    if (type === 'message') {
      const defMsg = DEFAULT_MESSAGES[subCmd]?.message || '👍';
      const msgText = settings.message || defMsg;
      if (settings.message) {
        const msgPreview = parseInvokeMessage(msgText, previewVars, message.guild);
        embed.setDescription('**Current custom:**\n' + (msgPreview.content || '(embed)'));
        if (msgPreview.embeds?.[0]) {
          return message.reply({ embeds: [embed, msgPreview.embeds[0]] });
        }
      } else {
        embed.setDescription('**Default:**\n' + msgText);
      }
      const copyCode = '```\n,invoke ' + subCmd + ' message ' + (settings.message || '') + '\n```';
      embed.addFields({ name: '\uD83D\uDCCB Copy-Paste', value: copyCode, inline: false });
    } else {
      if (settings.dm) {
        const dmPreview = parseInvokeMessage(settings.dm, previewVars, message.guild);
        embed.setDescription('**Current custom:**\n' + (dmPreview.content || '(embed)'));
        if (dmPreview.embeds?.[0]) {
          return message.reply({ embeds: [embed, dmPreview.embeds[0]] });
        }
      } else {
        embed.setDescription('\u274C **Disabled** — No DM is sent for this command by default.\nUse `,invoke ' + subCmd + ' dm <text>` to enable.');
      }
      const copyCode = '```\n,invoke ' + subCmd + ' dm ' + (settings.dm || '') + '\n```';
      embed.addFields({ name: '\uD83D\uDCCB Copy-Paste', value: copyCode, inline: false });
    }

    return message.reply({ embeds: [embed] });
  }

  // ── SAVE ──
  const invokes = db.get('invokeMessages', {});
  if (!invokes[subCmd]) invokes[subCmd] = {};
  invokes[subCmd][type] = actualRawText;
  db.set('invokeMessages', invokes);

  const previewVars = getPreviewVars(message.guild);
  const preview = parseInvokeMessage(actualRawText, previewVars, message.guild);

  const embed = base(COLORS.success)
    .setTitle('\u2705 Invoke ' + (type === 'message' ? 'Reply' : 'DM') + ' Updated')
    .setDescription('Command: `' + subCmd + '`\nType: `' + type + '`');

  if (preview.content) {
    embed.addFields({ name: 'Content Preview', value: preview.content.substring(0, 1000) || '*None*' });
  }

  const copyCode = '```\n,invoke ' + subCmd + ' ' + type + ' ' + actualRawText + '\n```';
  embed.addFields({ name: '\uD83D\uDCCB Copy-Paste Command', value: copyCode, inline: false });

  const replyEmbeds = [embed];
  if (preview.embeds?.length) replyEmbeds.push(...preview.embeds);

  return message.reply({ embeds: replyEmbeds, components: preview.components || [] });
}

module.exports = {
  handleInvokeCommand,
  getInvokeReply,
  getInvokeDm,
  sendInvokeDm,
  replaceInvokeVars,
  VALID_COMMANDS,
  DEFAULT_MESSAGES,
};