const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const { pagination: paginationEmbed } = require('./embeds');

// Split array into pages of size n
function chunk(arr, size) {
  const pages = [];
  for (let i = 0; i < arr.length; i += size) pages.push(arr.slice(i, i + size));
  return pages;
}

// Send a paginated embed with Prev/Next buttons
// pages: array of { title, description, color }
async function sendPaginated(channel, pages, authorId, timeout = 120000) {
  if (!pages.length) return channel.send({ content: '❌ No data to display.' });
  if (pages.length === 1) {
    const p = pages[0];
    return channel.send({ embeds: [paginationEmbed(p.title, p.description, 1, 1, p.color)] });
  }

  let current = 0;

  function buildRow(page, total) {
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('page_first').setEmoji('⏮️').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
      new ButtonBuilder().setCustomId('page_prev').setEmoji('◀️').setStyle(ButtonStyle.Primary).setDisabled(page === 0),
      new ButtonBuilder().setCustomId('page_next').setEmoji('▶️').setStyle(ButtonStyle.Primary).setDisabled(page === total - 1),
      new ButtonBuilder().setCustomId('page_last').setEmoji('⏭️').setStyle(ButtonStyle.Secondary).setDisabled(page === total - 1),
    );
  }

  function buildEmbed(idx) {
    const p = pages[idx];
    return paginationEmbed(p.title, p.description, idx + 1, pages.length, p.color);
  }

  const msg = await channel.send({
    embeds: [buildEmbed(0)],
    components: [buildRow(0, pages.length)],
  });

  const collector = msg.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: timeout,
    filter: i => {
      if (authorId && i.user.id !== authorId) {
        i.reply({ content: '❌ This menu belongs to someone else.', ephemeral: true });
        return false;
      }
      return true;
    },
  });

  collector.on('collect', async i => {
    if (i.customId === 'page_first') current = 0;
    else if (i.customId === 'page_prev') current = Math.max(0, current - 1);
    else if (i.customId === 'page_next') current = Math.min(pages.length - 1, current + 1);
    else if (i.customId === 'page_last') current = pages.length - 1;
    await i.update({ embeds: [buildEmbed(current)], components: [buildRow(current, pages.length)] });
  });

  collector.on('end', async () => {
    try {
      const row = buildRow(current, pages.length);
      row.components.forEach(b => b.setDisabled(true));
      await msg.edit({ components: [row] });
    } catch {}
  });

  return msg;
}

/**
 * Send paginated pre-built EmbedBuilder instances with Prev/Next buttons.
 * @param {TextChannel} channel
 * @param {EmbedBuilder[]} embeds — array of ready-to-send embeds
 * @param {string} authorId — who can click the buttons
 * @param {number} timeout — collector timeout in ms
 */
async function sendPaginatedEmbeds(channel, embeds, authorId, timeout = 120000) {
  if (!embeds.length) return channel.send({ content: '❌ No data to display.' });
  if (embeds.length === 1) {
    return channel.send({ embeds: [embeds[0]] });
  }

  let current = 0;

  function buildRow(page, total) {
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('page_first').setEmoji('⏮️').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
      new ButtonBuilder().setCustomId('page_prev').setEmoji('◀️').setStyle(ButtonStyle.Primary).setDisabled(page === 0),
      new ButtonBuilder().setCustomId('page_next').setEmoji('▶️').setStyle(ButtonStyle.Primary).setDisabled(page === total - 1),
      new ButtonBuilder().setCustomId('page_last').setEmoji('⏭️').setStyle(ButtonStyle.Secondary).setDisabled(page === total - 1),
    );
  }

  // Add page footer to each embed clone
  function buildEmbed(idx) {
    const embed = EmbedBuilder.from(embeds[idx]);
    const existingFooter = embed.data?.footer?.text || '';
    const footerText = existingFooter
      ? `${existingFooter} • Page ${idx + 1}/${embeds.length}`
      : `Page ${idx + 1}/${embeds.length}`;
    embed.setFooter({ text: footerText, iconURL: embed.data?.footer?.icon_url });
    return embed;
  }

  const msg = await channel.send({
    embeds: [buildEmbed(0)],
    components: [buildRow(0, embeds.length)],
  });

  const collector = msg.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: timeout,
    filter: i => {
      if (authorId && i.user.id !== authorId) {
        i.reply({ content: '❌ This menu belongs to someone else.', ephemeral: true });
        return false;
      }
      return true;
    },
  });

  collector.on('collect', async i => {
    if (i.customId === 'page_first') current = 0;
    else if (i.customId === 'page_prev') current = Math.max(0, current - 1);
    else if (i.customId === 'page_next') current = Math.min(embeds.length - 1, current + 1);
    else if (i.customId === 'page_last') current = embeds.length - 1;
    await i.update({ embeds: [buildEmbed(current)], components: [buildRow(current, embeds.length)] });
  });

  collector.on('end', async () => {
    try {
      const row = buildRow(current, embeds.length);
      row.components.forEach(b => b.setDisabled(true));
      await msg.edit({ components: [row] });
    } catch {}
  });

  return msg;
}

module.exports = { chunk, sendPaginated, sendPaginatedEmbeds };