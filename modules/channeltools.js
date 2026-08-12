/**
 * channeltools.js — extra channel moderation tools
 * Commands: .naughty, .permissions, .dump, .newmembers, .clearinvites
 */
const { ChannelType, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const { getGuildDb } = require('./database');
const { COLORS, base } = require('../utils/embeds');
const { chunk, sendPaginated } = require('../utils/paginator');

function staffCheck(ctx) {
  const { isStaffOrAdmin } = require('./helpers');
  return isStaffOrAdmin(ctx.member);
}
function getAuthorId(ctx) { return ctx.author?.id || ctx.user?.id; }

// ══════════════════════════════════════════════════════════
// .naughty [#channel] — toggle NSFW on a text channel
// ══════════════════════════════════════════════════════════
async function handleNaughty(ctx, args) {
  if (!staffCheck(ctx)) return ctx.reply({ content: '❌ No permission.', ephemeral: true });
  const ch = ctx.mentions?.channels?.first() || ctx.channel;
  if (ch.type !== ChannelType.GuildText) return ctx.reply({ content: '❌ Only works on text channels.' });

  const newState = !ch.nsfw;
  await ch.setNSFW(newState, `Toggled by ${ctx.author?.tag || ctx.user?.tag}`);
  return ctx.reply({
    embeds: [base(newState ? COLORS.error : COLORS.success)
      .setTitle(`${newState ? '🔞 Channel Marked NSFW' : '✅ NSFW Removed'}`)
      .addFields({ name: 'Channel', value: `<#${ch.id}>`, inline: true }, { name: 'NSFW', value: newState ? 'Enabled' : 'Disabled', inline: true })],
  });
}

// ══════════════════════════════════════════════════════════
// .permissions [#channel] — show permission overwrites
// ══════════════════════════════════════════════════════════
async function handlePermissions(ctx, args) {
  if (!staffCheck(ctx)) return ctx.reply({ content: '❌ No permission.', ephemeral: true });
  const ch = ctx.mentions?.channels?.first() || ctx.channel;

  const overwrites = [...ch.permissionOverwrites.cache.values()];
  if (!overwrites.length) return ctx.reply({ content: `No permission overwrites on <#${ch.id}>.` });

  const lines = [];
  for (const ow of overwrites) {
    const isRole = ow.type === 0;
    const entity = isRole
      ? (ctx.guild.roles.cache.get(ow.id)?.name ? `@${ctx.guild.roles.cache.get(ow.id).name}` : `Role \`${ow.id}\``)
      : `<@${ow.id}>`;

    const allowed = ow.allow.toArray();
    const denied = ow.deny.toArray();
    const parts = [];
    if (allowed.length) parts.push(`✅ Allow: \`${allowed.join('`, `')}\``);
    if (denied.length) parts.push(`❌ Deny: \`${denied.join('`, `')}\``);

    if (parts.length) lines.push(`**${entity}**\n${parts.join('\n')}`);
  }

  const pages = chunk(lines, 5).map((pg, i) => ({
    title: `🔐 Permissions — #${ch.name} (Page ${i + 1})`,
    description: pg.join('\n\n'),
    color: COLORS.primary,
  }));

  return sendPaginated(ctx.channel, pages, getAuthorId(ctx));
}

// ══════════════════════════════════════════════════════════
// .dump roles|members|channels — data export
// ══════════════════════════════════════════════════════════
async function handleDump(ctx, args) {
  if (!staffCheck(ctx)) return ctx.reply({ content: '❌ No permission.', ephemeral: true });
  const sub = args[0]?.toLowerCase();

  // .dump roles
  if (sub === 'roles') {
    const roles = [...ctx.guild.roles.cache.values()]
      .filter(r => r.id !== ctx.guild.id)
      .sort((a, b) => b.position - a.position);
    const lines = roles.map(r => `<@&${r.id}> — \`${r.id}\` — **${r.members.size}** members — ${r.color !== 0 ? `\`#${r.color.toString(16).padStart(6,'0')}\`` : 'no color'}`);
    const pages = chunk(lines, 12).map((pg, i) => ({ title: `🎭 Roles [${roles.length}] — Page ${i + 1}`, description: pg.join('\n'), color: COLORS.primary }));
    return sendPaginated(ctx.channel, pages, getAuthorId(ctx));
  }

  // .dump members [@role]
  if (sub === 'members') {
    const role = ctx.mentions?.roles?.first();
    await ctx.guild.members.fetch();
    let members = [...ctx.guild.members.cache.values()];
    if (role) members = members.filter(m => m.roles.cache.has(role.id));
    members = members.filter(m => !m.user.bot).sort((a, b) => a.user.username.localeCompare(b.user.username));
    if (!members.length) return ctx.reply({ content: `No members found${role ? ` with role <@&${role.id}>` : ''}.` });
    const lines = members.map(m => `<@${m.id}> — \`${m.id}\` — joined `);
    const pages = chunk(lines, 15).map((pg, i) => ({
      title: `👥 Members${role ? ` with ${role.name}` : ''} [${members.length}] — Page ${i + 1}`,
      description: pg.join('\n'),
      color: COLORS.primary,
    }));
    return sendPaginated(ctx.channel, pages, getAuthorId(ctx));
  }

  // .dump channels
  if (sub === 'channels') {
    const channels = [...ctx.guild.channels.cache.values()]
      .filter(c => !c.isThread())
      .sort((a, b) => (a.parent?.position ?? -1) - (b.parent?.position ?? -1) || a.position - b.position);
    const lines = channels.map(c => `<#${c.id}> — \`${c.id}\` — ${c.type === ChannelType.GuildVoice ? '🔊 Voice' : c.type === ChannelType.GuildCategory ? '📂 Category' : '💬 Text'}${c.nsfw ? ' 🔞' : ''}`);
    const pages = chunk(lines, 15).map((pg, i) => ({ title: `📋 Channels [${channels.length}] — Page ${i + 1}`, description: pg.join('\n'), color: COLORS.primary }));
    return sendPaginated(ctx.channel, pages, getAuthorId(ctx));
  }

  return ctx.reply({ embeds: [base(COLORS.primary).setTitle('📦 Dump Commands').setDescription([
    '`.dump roles` — all roles with member counts',
    '`.dump members [@role]` — all (human) members, optionally filtered by role',
    '`.dump channels` — all channels with type info',
  ].join('\n'))] });
}

// ══════════════════════════════════════════════════════════
// .newmembers [days] — recently joined members (FIXED)
// ══════════════════════════════════════════════════════════
async function handleNewMembers(ctx, args) {
  if (!staffCheck(ctx)) return ctx.reply({ content: '❌ No permission.', ephemeral: true });

  let replyMsg;
  try {
    // Parse duration: supports "2d", "5d", "10d", or plain numbers. Default = 1 (today).
    let raw = args[0] || '1';
    const daysMatch = raw.match(/^(\d+)d?$/i);
    let days = daysMatch ? parseInt(daysMatch[1]) : parseInt(raw);
    if (isNaN(days) || days < 1) days = 1;
    days = Math.min(days, 14); // max 2 weeks

    const cutoff = Date.now() - days * 86_400_000;

    // Send immediate feedback so the user knows the bot is working
    replyMsg = await ctx.reply({ content: `🔍 Fetching new members from the last **${days}** day(s)...` });

    await ctx.guild.members.fetch();
    const recent = [...ctx.guild.members.cache.values()]
      .filter(m => !m.user.bot && m.joinedTimestamp && m.joinedTimestamp > cutoff)
      .sort((a, b) => b.joinedTimestamp - a.joinedTimestamp);

    if (!recent.length) {
      return replyMsg.edit({ content: `No new members in the last **${days}** day(s).`, embeds: [], components: [] });
    }

    // Build pages (15 per page)
    const perPage = 15;
    const totalPages = Math.ceil(recent.length / perPage);

    function buildEmbed(pageIdx) {
      const start = pageIdx * perPage;
      const pageMembers = recent.slice(start, start + perPage);
      const lines = pageMembers.map((m, i) =>
        `**${start + i + 1}.** <@${m.id}> — joined <t:${Math.floor(m.joinedTimestamp / 1000)}:R>`
      );

      return new EmbedBuilder()
        .setTitle(`🆕 New Members — Last ${days} Day(s)`)
        .setDescription(lines.join('\n'))
        .setColor(COLORS.success)
        .setFooter({ text: `Total: ${recent.length} members • Page ${pageIdx + 1}/${totalPages}` })
        .setTimestamp();
    }

    function buildRow(pageIdx) {
      return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('nm_first').setEmoji('⏮️').setStyle(ButtonStyle.Secondary).setDisabled(pageIdx === 0),
        new ButtonBuilder().setCustomId('nm_prev').setEmoji('◀️').setStyle(ButtonStyle.Primary).setDisabled(pageIdx === 0),
        new ButtonBuilder().setCustomId('nm_next').setEmoji('▶️').setStyle(ButtonStyle.Primary).setDisabled(pageIdx >= totalPages - 1),
        new ButtonBuilder().setCustomId('nm_last').setEmoji('⏭️').setStyle(ButtonStyle.Secondary).setDisabled(pageIdx >= totalPages - 1),
      );
    }

    const authorId = getAuthorId(ctx);
    const embed = buildEmbed(0);
    const components = totalPages > 1 ? [buildRow(0)] : [];

    await replyMsg.edit({ content: '', embeds: [embed], components });

    if (totalPages <= 1) return;

    const collector = replyMsg.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 120_000,
      filter: i => {
        if (i.user.id !== authorId) {
          i.reply({ content: '❌ This menu belongs to someone else.', ephemeral: true });
          return false;
        }
        return true;
      },
    });

    let current = 0;
    collector.on('collect', async i => {
      if (i.customId === 'nm_first') current = 0;
      else if (i.customId === 'nm_prev') current = Math.max(0, current - 1);
      else if (i.customId === 'nm_next') current = Math.min(totalPages - 1, current + 1);
      else if (i.customId === 'nm_last') current = totalPages - 1;
      await i.update({ embeds: [buildEmbed(current)], components: [buildRow(current)] });
    });

    collector.on('end', async () => {
      try {
        const row = buildRow(current);
        row.components.forEach(b => b.setDisabled(true));
        await replyMsg.edit({ components: [row] });
      } catch {}
    });
  } catch (err) {
    console.error('[newmembers] Error:', err);
    const errText = `❌ Failed to fetch new members: ${err.message || 'Unknown error'}`;
    if (replyMsg) {
      await replyMsg.edit({ content: errText, embeds: [], components: [] }).catch(() => {});
    } else {
      await ctx.reply({ content: errText }).catch(() => {});
    }
  }
}

// ══════════════════════════════════════════════════════════
// .clearinvites — delete all server invites
// ══════════════════════════════════════════════════════════
async function handleClearInvites(ctx, args) {
  const { isAdmin } = require('./helpers');
  if (!ctx.member.permissions.has(PermissionFlagsBits.ManageGuild) && !isAdmin(getAuthorId(ctx)))
    return ctx.reply({ content: '❌ You need **Manage Server** permission.' });

  const invites = await ctx.guild.invites.fetch();
  if (!invites.size) return ctx.reply({ content: '✅ No invites to delete.' });

  let deleted = 0, failed = 0;
  for (const [, invite] of invites) {
    await invite.delete(`Invites cleared by ${ctx.author?.tag || ctx.user?.tag}`).then(() => deleted++).catch(() => failed++);
  }

  return ctx.reply({ embeds: [base(COLORS.success)
    .setTitle('🧹 Invites Cleared')
    .addFields(
      { name: '✅ Deleted', value: deleted.toString(), inline: true },
      { name: '❌ Failed', value: failed.toString(), inline: true },
      { name: '📊 Total', value: invites.size.toString(), inline: true },
    )] });
}

module.exports = { handleNaughty, handlePermissions, handleDump, handleNewMembers, handleClearInvites };