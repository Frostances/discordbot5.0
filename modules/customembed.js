/**
 * customembed.js — Custom Embed Command
 *
 * Usage:
 *   ,ce <embed script>        — send embed to current channel
 *   ,ce preview <script>      — preview embed (ephemeral)
 *   ,ce edit <msgId> <script> — edit an existing embed message
 *
 * Embed script format:
 *   {embed}$v{message: text}$v{title: text}$v{description: text}$v{color: hex}
 *   $v{thumbnail: url}$v{image: url}$v{footer: text && iconUrl}$v{author: name && iconUrl && url}
 *   $v{field: Name && Value && inline}$v{timestamp}$v{url: https://link}
 *   $v{button: url && label && emoji && enabled|disabled}
 *
 * Variables:
 *   {user.mention} {user.name} {user.id} {user.avatar}
 *   {guild.name} {guild.id} {guild.icon} {guild.count}
 *   {channel.mention} {channel.name}
 */

const { PermissionFlagsBits } = require('discord.js');
const { parseEmbedCode, substituteVars } = require('../utils/embedParser');
const { base, COLORS } = require('../utils/embeds');

function buildCustomEmbedVars(message) {
  const member = message.member;
  const user = message.author;
  const guild = message.guild;
  const channel = message.channel;

  return {
    '{user.mention}': '<@' + user.id + '>',
    '{user.name}': user.username,
    '{user.id}': user.id,
    '{user.avatar}': user.displayAvatarURL({ size: 256, extension: 'png' }),
    '{user.display_name}': member?.displayName || user.username,
    '{guild.name}': guild?.name || '',
    '{guild.id}': guild?.id || '',
    '{guild.icon}': guild?.iconURL({ size: 256, extension: 'png' }) || '',
    '{guild.count}': (guild?.memberCount ?? 0).toString(),
    '{channel.mention}': '<#' + channel.id + '>',
    '{channel.name}': channel.name,
    '{channel.id}': channel.id,
  };
}

async function handleCustomEmbed(message, args) {
  // Permission check: Manage Messages
  if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
    return message.reply({
      embeds: [base(COLORS.error).setTitle('Access Denied').setDescription('You need **Manage Messages** permission to use custom embeds.')]
    });
  }

  const sub = args[0]?.toLowerCase();

  // ── EDIT MODE ──
  if (sub === 'edit') {
    const msgId = args[1];
    const script = args.slice(2).join(' ');
    if (!msgId || !script) {
      return message.reply({
        embeds: [base(COLORS.error).setTitle('Invalid Usage').setDescription('Usage: `,ce edit <messageId> <embed script>`')]
      });
    }

    try {
      const targetMsg = await message.channel.messages.fetch(msgId);
      if (!targetMsg) {
        return message.reply({ embeds: [base(COLORS.error).setTitle('Not Found').setDescription('Message not found in this channel.')] });
      }

      const vars = buildCustomEmbedVars(message);
      const { content, embeds, components } = parseEmbedCode(script, vars, message.guild);
      const payload = {};
      if (content !== undefined) payload.content = content;
      if (embeds?.length) payload.embeds = embeds;
      if (components?.length) payload.components = components;

      await targetMsg.edit(payload);
      return message.reply({ embeds: [base(COLORS.success).setTitle('✅ Embed Updated')] });
    } catch (err) {
      return message.reply({ embeds: [base(COLORS.error).setTitle('Failed').setDescription('Could not edit message: ' + err.message)] });
    }
  }

  // ── PREVIEW MODE ──
  if (sub === 'preview') {
    const script = args.slice(1).join(' ');
    if (!script) {
      return message.reply({
        embeds: [base(COLORS.error).setTitle('Invalid Usage').setDescription('Usage: `,ce preview <embed script>`')]
      });
    }

    const vars = buildCustomEmbedVars(message);
    const { content, embeds, components } = parseEmbedCode(script, vars, message.guild);
    const payload = {};
    if (content !== undefined) payload.content = '**Preview:**\n' + (content || '');
    if (embeds?.length) payload.embeds = embeds;
    if (components?.length) payload.components = components;

    return message.reply(payload);
  }

  // ── SEND MODE (default) ──
  const script = args.join(' ');
  if (!script) {
    return message.reply({
      embeds: [base(COLORS.primary).setTitle('Custom Embed').setDescription(
        'Create custom embeds with buttons!\n\n' +
        '**Usage:**\n' +
        '`,ce <embed script>` — send embed\n' +
        '`,ce preview <script>` — preview before sending\n' +
        '`,ce edit <msgId> <script>` — edit existing embed\n\n' +
        '**Example:**\n' +
        '```\n' +
        ',ce {embed}$v{title: Welcome!}$v{description: Hello {user.mention}}$v{color: 5865F2}$v{thumbnail: {user.avatar}}$v{button: https://discord.com && Click me && 👋 && enabled}\n' +
        '```\n\n' +
        '**Supported properties:**\n' +
        '`message` `title` `description` `color` `thumbnail` `image` `footer` `author` `field` `timestamp` `url` `button`\n\n' +
        '**Button format:**\n' +
        '`{button: url && label && emoji && enabled|disabled}`\n' +
        '• url: link URL (empty for non-link button)\n' +
        '• label: button text\n' +
        '• emoji: Unicode or :custom_emoji:\n' +
        '• state: enabled or disabled'
      )]
    });
  }

  const vars = buildCustomEmbedVars(message);
  const { content, embeds, components } = parseEmbedCode(script, vars, message.guild);
  const payload = {};
  if (content !== undefined) payload.content = content;
  if (embeds?.length) payload.embeds = embeds;
  if (components?.length) payload.components = components;

  if (!payload.content && !payload.embeds?.length) {
    return message.reply({ embeds: [base(COLORS.error).setTitle('Invalid Embed').setDescription('Could not parse embed script. Make sure it starts with `{embed}`')] });
  }

  try {
    const sent = await message.channel.send(payload);
    // Delete the command message
    try { await message.delete(); } catch {}
    return sent;
  } catch (err) {
    return message.reply({ embeds: [base(COLORS.error).setTitle('Failed').setDescription('Could not send embed: ' + err.message)] });
  }
}

module.exports = { handleCustomEmbed };