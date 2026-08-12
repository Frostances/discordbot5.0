// Bot customization system — avatar, banner, bio
const { EmbedBuilder } = require('discord.js');
const { isBotOwner } = require('./helpers');
const { base, COLORS } = require('../utils/embeds');

/**
 * Handle ,customize <subcommand> [args]
 * @param {Message|Interaction} ctx
 * @param {string[]} args
 * @param {Client} client
 */
async function handleCustomize(ctx, args, client) {
  const authorId = ctx.author?.id || ctx.user?.id;
  if (!isBotOwner(authorId)) {
    return ctx.reply({ content: '❌ This command is for the bot owner only.', ephemeral: true });
  }

  const sub = args[0]?.toLowerCase();
  const value = args.slice(1).join(' ').trim();

  // ── AVATAR ──
  if (sub === 'avatar') {
    const url = value || ctx.attachments?.first()?.url || null;
    if (!url) {
      return ctx.reply({ content: '❌ Provide an image URL or attach an image.\n**Usage:** `.customize avatar <image URL>`', ephemeral: true });
    }
    try {
      await client.user.setAvatar(url);
      const embed = base(COLORS.success)
        .setTitle('🖼️ Avatar Updated')
        .setDescription('Bot avatar has been changed successfully.')
        .setImage(url);
      return ctx.reply({ embeds: [embed] });
    } catch (err) {
      return ctx.reply({ content: `❌ Failed to update avatar: ${err.message}`, ephemeral: true });
    }
  }

  // ── BANNER ──
  if (sub === 'banner') {
    const url = value || ctx.attachments?.first()?.url || null;
    if (!url) {
      return ctx.reply({ content: '❌ Provide an image URL or attach an image.\n**Usage:** `.customize banner <image URL>`', ephemeral: true });
    }
    try {
      await client.user.setBanner(url);
      const embed = base(COLORS.success)
        .setTitle('🎨 Banner Updated')
        .setDescription('Bot banner has been changed successfully.')
        .setImage(url);
      return ctx.reply({ embeds: [embed] });
    } catch (err) {
      return ctx.reply({ content: `❌ Failed to update banner: ${err.message}\n*(Note: Bot banners require the bot to be in a verified developer team.)*`, ephemeral: true });
    }
  }

  // ── USERNAME ──
  if (sub === 'username' || sub === 'name') {
    if (!value) {
      return ctx.reply({ content: '❌ Provide a new username.\n**Usage:** `.customize username <name>`', ephemeral: true });
    }
    if (value.length > 32) {
      return ctx.reply({ content: `❌ Username is too long (**${value.length}/32** characters).`, ephemeral: true });
    }
    try {
      await client.user.setUsername(value);
      // Also try to set display name (global name) if supported
      try {
        if (client.user.setGlobalName) {
          await client.user.setGlobalName(value);
        }
      } catch (e) { /* ignore if not supported */ }

      const embed = base(COLORS.success)
        .setTitle('🏷️ Username Updated')
        .setDescription(`Bot username has been changed to **${value}**.`);
      return ctx.reply({ embeds: [embed] });
    } catch (err) {
      return ctx.reply({ content: `❌ Failed to update username: ${err.message}\n*(You can only change username twice per hour.)*`, ephemeral: true });
    }
  }

  // ── BIO ──
  if (sub === 'bio') {
    if (!value) {
      return ctx.reply({ content: '❌ Provide text for the bio.\n**Usage:** `.customize bio <text>`', ephemeral: true });
    }
    if (value.length > 400) {
      return ctx.reply({ content: `❌ Bio is too long (**${value.length}/400** characters). Please shorten it.`, ephemeral: true });
    }
    try {
      await client.application.fetch();
      await client.application.edit({ description: value });
      const embed = base(COLORS.success)
        .setTitle('📝 Bio Updated')
        .setDescription('Bot bio has been changed successfully.')
        .addFields({ name: 'New Bio', value: value.length > 200 ? value.slice(0, 200) + '...' : value });
      return ctx.reply({ embeds: [embed] });
    } catch (err) {
      return ctx.reply({ content: `❌ Failed to update bio: ${err.message}`, ephemeral: true });
    }
  }

  // ── HELP / INVALID ──
  const helpEmbed = base(COLORS.primary)
    .setTitle('🎨 Customize Commands')
    .setDescription('Customize the bot\'s appearance and profile. *(Bot owner only)*')
    .addFields(
      { name: 'Avatar', value: '`.customize avatar <image URL>`\nChange the bot\'s profile picture.', inline: false },
      { name: 'Banner', value: '`.customize banner <image URL>`\nChange the bot\'s profile banner.', inline: false },
      { name: 'Username', value: '`.customize username <name>`\nChange the bot\'s username & display name.', inline: false },
      { name: 'Bio', value: '`.customize bio <text>`\nChange the bot\'s "About Me" / description.', inline: false },
    );
  return ctx.reply({ embeds: [helpEmbed] });
}

module.exports = { handleCustomize };