/**
 * serverManagement.js — Server Management Systems
 * Commands: autoresponder, pagination, enablecommand, disablecommand,
 * enableevent, disableevent, enablemodule, disablemodule, ignore,
 * seticon, setsplashbackground, setbanner, pin, unpin, firstmessage,
 * pins, webhook
 */

const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ComponentType, AttachmentBuilder, PermissionFlagsBits,
  ChannelType, WebhookClient, Webhook
} = require('discord.js');
const { getGuildDb, getUserDb } = require('./database');
const { COLORS, base } = require('../utils/embeds');

// ══════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════
function replyEmbed(ctx, embed, files = []) {
  const isInteraction = !!ctx.deferReply;
  const payload = { embeds: [embed] };
  if (files.length) payload.files = files;
  if (isInteraction) {
    if (ctx.deferred || ctx.replied) return ctx.editReply(payload);
    return ctx.reply(payload);
  }
  return ctx.channel.send(payload);
}

function successEmbed(title, desc) {
  return base(COLORS.success).setTitle(`✅ ${title}`).setDescription(desc);
}
function errorEmbed(title, desc) {
  return base(COLORS.error).setTitle(`❌ ${title}`).setDescription(desc);
}
function infoEmbed(title, desc) {
  return base(COLORS.primary).setTitle(title).setDescription(desc);
}

const AUTORESPONDER_GUIDE = [
  {
    name: 'autoresponder add',
    description: 'Create an automatic response for a trigger phrase.',
    aliases: 'ar add',
    parameters: '<trigger>-- <response> [--include] [--reply]',
    usage: ',autoresponder add hey-- hello there',
  },
  {
    name: 'autoresponder remove',
    description: 'Remove one automatic response.',
    aliases: 'ar remove',
    parameters: '<trigger>',
    usage: ',autoresponder remove hey',
  },
  {
    name: 'autoresponder update',
    description: 'Replace the response or flags for an existing trigger.',
    aliases: 'ar update',
    parameters: '<trigger>-- <response> [--include] [--reply]',
    usage: ',autoresponder update hey-- hi again',
  },
  {
    name: 'autoresponder list',
    description: 'View all automatic responses configured in this server.',
    aliases: 'ar list',
    parameters: 'none',
    usage: ',autoresponder list',
  },
  {
    name: 'autoresponder role add',
    description: 'Add a role when a trigger is used.',
    aliases: 'ar role add',
    parameters: '<@role> <trigger>',
    usage: ',autoresponder role add @Member hey',
  },
  {
    name: 'autoresponder role remove',
    description: 'Remove a role action from a trigger.',
    aliases: 'ar role remove',
    parameters: '<@role> <trigger>',
    usage: ',autoresponder role remove @Member hey',
  },
  {
    name: 'autoresponder exclusive',
    description: 'Limit a trigger to one role or channel.',
    aliases: 'ar exclusive',
    parameters: '<@role|#channel> <trigger>',
    usage: ',autoresponder exclusive #welcome hey',
  },
  {
    name: 'autoresponder reset',
    description: 'Delete every automatic response in this server.',
    aliases: 'ar reset',
    parameters: 'none',
    usage: ',autoresponder reset',
  },
  {
    name: 'autoresponder variables',
    description: 'View variables available inside automatic responses.',
    aliases: 'ar variables',
    parameters: 'none',
    usage: ',autoresponder variables',
  },
];

async function sendAutoresponderGuide(ctx) {
  const isInteraction = !!ctx.deferReply;
  const authorId = isInteraction ? ctx.user.id : ctx.author.id;
  let page = 0;

  const buildEmbed = () => {
    const item = AUTORESPONDER_GUIDE[page];
    return base(COLORS.primary)
      .setTitle(item.name)
      .setDescription(item.description)
      .addFields(
        { name: 'Aliases', value: `\`${item.aliases}\``, inline: true },
        { name: 'Parameters', value: `\`${item.parameters}\``, inline: true },
        { name: 'Usage', value: `\`\`\`\n${item.usage}\n\`\`\`` },
      )
      .setFooter({ text: `Page ${page + 1}/${AUTORESPONDER_GUIDE.length}` });
  };

  const buildRow = () => new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ar_prev').setEmoji('◀').setStyle(ButtonStyle.Primary).setDisabled(page === 0),
    new ButtonBuilder().setCustomId('ar_next').setEmoji('▶').setStyle(ButtonStyle.Primary).setDisabled(page === AUTORESPONDER_GUIDE.length - 1),
    new ButtonBuilder().setCustomId('ar_close').setEmoji('✕').setStyle(ButtonStyle.Danger),
  );

  const payload = { embeds: [buildEmbed()], components: [buildRow()] };
  let sent;
  if (isInteraction) {
    await ctx.reply(payload);
    sent = await ctx.fetchReply().catch(() => null);
  } else {
    sent = await ctx.channel.send(payload);
  }
  if (!sent) return;

  const collector = sent.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 120_000,
    filter: interaction => {
      if (interaction.user.id !== authorId) {
        interaction.reply({ content: '❌ This menu belongs to someone else.', ephemeral: true }).catch(() => {});
        return false;
      }
      return true;
    },
  });

  collector.on('collect', async interaction => {
    if (interaction.customId === 'ar_close') {
      collector.stop('closed');
      return interaction.message.delete().catch(() => interaction.update({ components: [] }));
    }
    if (interaction.customId === 'ar_prev') page = Math.max(0, page - 1);
    if (interaction.customId === 'ar_next') page = Math.min(AUTORESPONDER_GUIDE.length - 1, page + 1);
    await interaction.update({ embeds: [buildEmbed()], components: [buildRow()] }).catch(() => {});
  });

  collector.on('end', (_collected, reason) => {
    if (reason !== 'closed') sent.edit({ components: [] }).catch(() => {});
  });
}

async function resolveChannel(ctx, arg) {
  if (!arg) return ctx.channel;
  const match = arg.match(/<#(\d+)>/);
  if (match) return ctx.guild.channels.cache.get(match[1]) || null;
  if (/^\d+$/.test(arg)) return ctx.guild.channels.cache.get(arg) || null;
  return ctx.guild.channels.cache.find(c => c.name.toLowerCase() === arg.toLowerCase()) || null;
}

async function resolveMember(ctx, arg) {
  if (!arg) return null;
  const match = arg.match(/<@!?(\d+)>/);
  if (match) return ctx.guild.members.cache.get(match[1]) || await ctx.guild.members.fetch(match[1]).catch(() => null);
  if (/^\d+$/.test(arg)) return ctx.guild.members.cache.get(arg) || await ctx.guild.members.fetch(arg).catch(() => null);
  return ctx.guild.members.cache.find(m => m.user.username.toLowerCase() === arg.toLowerCase()) || null;
}

async function resolveRole(ctx, arg) {
  if (!arg) return null;
  const match = arg.match(/<@&?(\d+)>/);
  if (match) return ctx.guild.roles.cache.get(match[1]) || null;
  if (/^\d+$/.test(arg)) return ctx.guild.roles.cache.get(arg) || null;
  return ctx.guild.roles.cache.find(r => r.name.toLowerCase() === arg.toLowerCase()) || null;
}

function parseMessageLink(link) {
  const m = link.match(/discord\.com\/channels\/(\d+)\/(\d+)\/(\d+)/);
  if (!m) return null;
  return { guildId: m[1], channelId: m[2], messageId: m[3] };
}

// ══════════════════════════════════════════════════════════
// 1. AUTORESPONDER SYSTEM
// ══════════════════════════════════════════════════════════
function getAutoresponderDb(guildId) {
  const db = getGuildDb(guildId);
  if (!db.data.autoresponders) db.data.autoresponders = {};
  return db.data.autoresponders;
}

/**
 * Parse autoresponder input: trigger-- response [--include] [--reply]
 * The "--" separator marks the end of the trigger.
 * Flags at the end can be in any order.
 */
function parseAutoresponderInput(fullText) {
  // Find the separator "--" (first occurrence)
  const sepIdx = fullText.indexOf('--');
  if (sepIdx === -1) return null;

  const trigger = fullText.slice(0, sepIdx).trim().toLowerCase();
  let response = fullText.slice(sepIdx + 2).trim();

  let include = false;
  let reply = false;

  // Parse flags from the end in any order (loop until no more flags)
  let changed = true;
  while (changed) {
    changed = false;
    if (response.endsWith('--reply')) {
      reply = true;
      response = response.slice(0, -7).trim();
      changed = true;
    }
    if (response.endsWith('--include')) {
      include = true;
      response = response.slice(0, -9).trim();
      changed = true;
    }
  }

  return { trigger, response, include, reply };
}

async function handleAutoresponder(ctx, args) {
  const guildId = ctx.guild.id;
  const ar = getAutoresponderDb(guildId);
  const sub = args[0]?.toLowerCase();
  const isInteraction = !!ctx.deferReply;

  // No subcommand → show help
  if (!sub || !['list','remove','role','variables','update','exclusive','add','reset'].includes(sub)) {
    return sendAutoresponderGuide(ctx);
  }

  if (sub === 'add') {
    const fullText = args.slice(1).join(' ');
    const parsed = parseAutoresponderInput(fullText);
    if (!parsed) return replyEmbed(ctx, errorEmbed('Invalid Format', 'Usage: `autoresponder add <trigger>-- <response> [--include] [--reply]`\n\n**Example:** `,autoresponder add hey bro-- whats up!`'));
    const { trigger, response, include, reply } = parsed;
    if (!trigger || !response) return replyEmbed(ctx, errorEmbed('Missing Arguments', 'Usage: `autoresponder add <trigger>-- <response> [--include] [--reply]`'));
    if (ar[trigger]) return replyEmbed(ctx, errorEmbed('Already Exists', `Trigger \`${trigger}\` already exists. Use \`update\` to modify it.`));
    ar[trigger] = { response, include, reply, rolesAdd: [], rolesRemove: [], exclusiveRoles: [], exclusiveChannels: [], createdAt: Date.now() };
    getGuildDb(guildId)._save();
    return replyEmbed(ctx, successEmbed('Autoresponder Added', `Trigger \`${trigger}\` → ${response.slice(0, 100)}${include ? ' (include)' : ''}${reply ? ' (reply)' : ''}`));
  }

  if (sub === 'remove') {
    const trigger = args[1]?.toLowerCase();
    if (!trigger) return replyEmbed(ctx, errorEmbed('Missing Trigger', 'Usage: `autoresponder remove <trigger>`'));
    if (!ar[trigger]) return replyEmbed(ctx, errorEmbed('Not Found', `Trigger \`${trigger}\` does not exist.`));
    delete ar[trigger];
    getGuildDb(guildId)._save();
    return replyEmbed(ctx, successEmbed('Autoresponder Removed', `Trigger \`${trigger}\` has been deleted.`));
  }

  if (sub === 'update') {
    const fullText = args.slice(1).join(' ');
    const parsed = parseAutoresponderInput(fullText);
    if (!parsed) return replyEmbed(ctx, errorEmbed('Invalid Format', 'Usage: `autoresponder update <trigger>-- <response> [--include] [--reply]`'));
    const { trigger, response, include, reply } = parsed;
    if (!trigger || !response) return replyEmbed(ctx, errorEmbed('Missing Arguments', 'Usage: `autoresponder update <trigger>-- <response> [--include] [--reply]`'));
    if (!ar[trigger]) return replyEmbed(ctx, errorEmbed('Not Found', `Trigger \`${trigger}\` does not exist.`));
    ar[trigger].response = response;
    ar[trigger].include = include;
    ar[trigger].reply = reply;
    getGuildDb(guildId)._save();
    return replyEmbed(ctx, successEmbed('Autoresponder Updated', `Trigger \`${trigger}\` updated.${include ? ' (include)' : ''}${reply ? ' (reply)' : ''}`));
  }

  if (sub === 'list') {
    const keys = Object.keys(ar);
    if (!keys.length) return replyEmbed(ctx, infoEmbed('Autoresponders', 'No autoresponders configured.'));
    const list = keys.map((k, i) => `${i+1}. \`${k}\` — ${ar[k].response.slice(0, 40)}...${ar[k].include ? ' [include]' : ''}${ar[k].reply ? ' [reply]' : ''}`).join('\n');
    return replyEmbed(ctx, infoEmbed('Autoresponders', list));
  }

  if (sub === 'reset') {
    const db = getGuildDb(guildId);
    db.data.autoresponders = {};
    db._save();
    return replyEmbed(ctx, successEmbed('Autoresponders Reset', 'All autoresponders have been removed.'));
  }

  if (sub === 'variables') {
    return replyEmbed(ctx, infoEmbed('Autoresponder Variables',
      '`{user}` — mention the user\n' +
      '`{user.name}` — user\'s username\n' +
      '`{user.id}` — user\'s ID\n' +
      '`{channel}` — mention the channel\n' +
      '`{guild}` — server name\n' +
      '`{guild.id}` — server ID\n' +
      '`{time}` — current time'
    ));
  }

  if (sub === 'role') {
    const roleSub = args[1]?.toLowerCase();
    // Check list sub-subcommands FIRST before add/remove
    if (roleSub === 'add' && args[2]?.toLowerCase() === 'list') {
      const trigger = args[3]?.toLowerCase();
      if (!trigger || !ar[trigger]) return replyEmbed(ctx, errorEmbed('Not Found', 'Trigger not found.'));
      const list = (ar[trigger].rolesAdd || []).map(id => `<@&${id}>`).join('\n') || 'None';
      return replyEmbed(ctx, infoEmbed(`Roles Added — ${trigger}`, list));
    }
    if (roleSub === 'remove' && args[2]?.toLowerCase() === 'list') {
      const trigger = args[3]?.toLowerCase();
      if (!trigger || !ar[trigger]) return replyEmbed(ctx, errorEmbed('Not Found', 'Trigger not found.'));
      const list = (ar[trigger].rolesRemove || []).map(id => `<@&${id}>`).join('\n') || 'None';
      return replyEmbed(ctx, infoEmbed(`Roles Removed — ${trigger}`, list));
    }
    if (roleSub === 'add') {
      const role = await resolveRole(ctx, args[2]);
      const trigger = args[3]?.toLowerCase();
      if (!role || !trigger) return replyEmbed(ctx, errorEmbed('Missing Arguments', 'Usage: `autoresponder role add <@role> <trigger>`'));
      if (!ar[trigger]) return replyEmbed(ctx, errorEmbed('Not Found', `Trigger \`${trigger}\` does not exist.`));
      if (!ar[trigger].rolesAdd) ar[trigger].rolesAdd = [];
      if (!ar[trigger].rolesAdd.includes(role.id)) ar[trigger].rolesAdd.push(role.id);
      getGuildDb(guildId)._save();
      return replyEmbed(ctx, successEmbed('Role Added', `<@&${role.id}> will be given when \`${trigger}\` is triggered.`));
    }
    if (roleSub === 'remove') {
      const role = await resolveRole(ctx, args[2]);
      const trigger = args[3]?.toLowerCase();
      if (!role || !trigger) return replyEmbed(ctx, errorEmbed('Missing Arguments', 'Usage: `autoresponder role remove <@role> <trigger>`'));
      if (!ar[trigger]) return replyEmbed(ctx, errorEmbed('Not Found', `Trigger \`${trigger}\` does not exist.`));
      if (!ar[trigger].rolesRemove) ar[trigger].rolesRemove = [];
      if (!ar[trigger].rolesRemove.includes(role.id)) ar[trigger].rolesRemove.push(role.id);
      getGuildDb(guildId)._save();
      return replyEmbed(ctx, successEmbed('Role Remove Set', `<@&${role.id}> will be removed when \`${trigger}\` is triggered.`));
    }
    return replyEmbed(ctx, errorEmbed('Invalid Subcommand', 'Use `add`, `remove`, `add list`, or `remove list`.'));
  }

  if (sub === 'exclusive') {
    if (args[1]?.toLowerCase() === 'list') {
      const trigger = args[2]?.toLowerCase();
      if (!trigger || !ar[trigger]) return replyEmbed(ctx, errorEmbed('Not Found', 'Trigger not found.'));
      const roles = (ar[trigger].exclusiveRoles || []).map(id => `<@&${id}>`).join('\n') || 'None';
      const chans = (ar[trigger].exclusiveChannels || []).map(id => `<#${id}>`).join('\n') || 'None';
      return replyEmbed(ctx, infoEmbed(`Exclusive Access — ${trigger}`, `**Roles:**\n${roles}\n\n**Channels:**\n${chans}`));
    }
    const target = await resolveRole(ctx, args[1]) || await resolveChannel(ctx, args[1]);
    const trigger = args[2]?.toLowerCase();
    if (!target || !trigger) return replyEmbed(ctx, errorEmbed('Missing Arguments', 'Usage: `autoresponder exclusive <@role|#channel> <trigger>`'));
    if (!ar[trigger]) return replyEmbed(ctx, errorEmbed('Not Found', `Trigger \`${trigger}\` does not exist.`));
    if (target.type !== undefined) {
      if (!ar[trigger].exclusiveChannels) ar[trigger].exclusiveChannels = [];
      if (ar[trigger].exclusiveChannels.includes(target.id)) {
        ar[trigger].exclusiveChannels = ar[trigger].exclusiveChannels.filter(id => id !== target.id);
      } else {
        ar[trigger].exclusiveChannels.push(target.id);
      }
    } else {
      if (!ar[trigger].exclusiveRoles) ar[trigger].exclusiveRoles = [];
      if (ar[trigger].exclusiveRoles.includes(target.id)) {
        ar[trigger].exclusiveRoles = ar[trigger].exclusiveRoles.filter(id => id !== target.id);
      } else {
        ar[trigger].exclusiveRoles.push(target.id);
      }
    }
    getGuildDb(guildId)._save();
    return replyEmbed(ctx, successEmbed('Exclusive Updated', `Toggled ${target} for trigger \`${trigger}\`.`));
  }
}

// Process autoresponder on message
async function processAutoresponder(message) {
  if (message.author.bot || !message.guild) return;
  const ar = getAutoresponderDb(message.guild.id);
  const content = message.content.toLowerCase();
  for (const [trigger, data] of Object.entries(ar)) {
    let matched = false;
    if (data.include) {
      matched = content.includes(trigger);
    } else {
      matched = content === trigger;
    }
    if (!matched) continue;
    // Check exclusives
    if (data.exclusiveRoles?.length && !data.exclusiveRoles.some(rid => message.member.roles.cache.has(rid))) continue;
    if (data.exclusiveChannels?.length && !data.exclusiveChannels.includes(message.channel.id)) continue;
    // Process roles
    if (data.rolesAdd?.length) {
      for (const rid of data.rolesAdd) {
        const role = message.guild.roles.cache.get(rid);
        if (role && message.member.roles.cache.has(rid) === false) {
          await message.member.roles.add(role).catch(() => {});
        }
      }
    }
    if (data.rolesRemove?.length) {
      for (const rid of data.rolesRemove) {
        const role = message.guild.roles.cache.get(rid);
        if (role && message.member.roles.cache.has(rid)) {
          await message.member.roles.remove(role).catch(() => {});
        }
      }
    }
    // Send response with variables
    let response = data.response
      .replace(/{user}/g, `<@${message.author.id}>`)
      .replace(/{user\.name}/g, message.author.username)
      .replace(/{user\.id}/g, message.author.id)
      .replace(/{channel}/g, `<#${message.channel.id}>`)
      .replace(/{guild}/g, message.guild.name)
      .replace(/{guild\.id}/g, message.guild.id)
      .replace(/{time}/g, new Date().toLocaleString());
    if (data.reply) {
      await message.reply(response).catch(() => {});
    } else {
      await message.channel.send(response).catch(() => {});
    }
  }
}

// ══════════════════════════════════════════════════════════
// 2. PAGINATION SYSTEM
// ══════════════════════════════════════════════════════════
function getPaginationDb(guildId) {
  const db = getGuildDb(guildId);
  if (!db.data.paginations) db.data.paginations = {};
  return db.data.paginations;
}

async function handlePagination(ctx, args) {
  const guildId = ctx.guild.id;
  const pag = getPaginationDb(guildId);
  const sub = args[0]?.toLowerCase();

  if (!sub) {
    return replyEmbed(ctx, infoEmbed('Pagination',
      '`pagination set <message_link>` — set up pagination on an existing embed\n' +
      '`pagination add <message_link> <embed_code>` — add a page\n' +
      '`pagination remove <message_link> <id>` — remove a page\n' +
      '`pagination update <message_link> <id> <embed_code>` — update a page\n' +
      '`pagination delete <message_link>` — delete pagination entirely\n' +
      '`pagination list` — view all paginations\n' +
      '`pagination reset` — remove all paginations\n' +
      '`pagination restorereactions <message_link>` — restore nav buttons'
    ));
  }

  if (sub === 'list') {
    const keys = Object.keys(pag);
    if (!keys.length) return replyEmbed(ctx, infoEmbed('Paginations', 'No pagination embeds configured.'));
    const list = keys.map((k, i) => `${i+1}. [Message](https://discord.com/channels/${guildId}/${pag[k].channelId}/${k}) — ${pag[k].pages?.length || 0} pages`).join('\n');
    return replyEmbed(ctx, infoEmbed('Pagination List', list));
  }

  if (sub === 'reset') {
    const db = getGuildDb(guildId);
    db.data.paginations = {};
    db._save();
    return replyEmbed(ctx, successEmbed('Paginations Reset', 'All pagination embeds have been removed.'));
  }

  if (['set','add','remove','update','delete','restorereactions'].includes(sub)) {
    const link = args[1];
    const parsed = parseMessageLink(link);
    if (!parsed) return replyEmbed(ctx, errorEmbed('Invalid Link', 'Provide a valid Discord message link.'));
    const channel = ctx.guild.channels.cache.get(parsed.channelId);
    if (!channel) return replyEmbed(ctx, errorEmbed('Channel Not Found', 'Could not find that channel.'));
    const msg = await channel.messages.fetch(parsed.messageId).catch(() => null);
    if (!msg) return replyEmbed(ctx, errorEmbed('Message Not Found', 'Could not fetch that message.'));

    if (sub === 'set') {
      if (!msg.embeds.length) return replyEmbed(ctx, errorEmbed('No Embed', 'That message has no embeds.'));
      pag[msg.id] = { channelId: channel.id, pages: [msg.embeds[0].toJSON()], currentPage: 0 };
      getGuildDb(guildId)._save();
      await updatePaginationMessage(msg, pag[msg.id]);
      return replyEmbed(ctx, successEmbed('Pagination Set', 'Added navigation buttons to the embed.'));
    }

    if (sub === 'add') {
      const code = args.slice(2).join(' ');
      if (!code) return replyEmbed(ctx, errorEmbed('Missing Embed Code', 'Provide an embed code.'));
      if (!pag[msg.id]) return replyEmbed(ctx, errorEmbed('Not Paginated', 'Use `pagination set` first.'));
      try {
        const embed = JSON.parse(code);
        pag[msg.id].pages.push(embed);
        getGuildDb(guildId)._save();
        await updatePaginationMessage(msg, pag[msg.id]);
        return replyEmbed(ctx, successEmbed('Page Added', `Page ${pag[msg.id].pages.length} added.`));
      } catch {
        return replyEmbed(ctx, errorEmbed('Invalid JSON', 'Could not parse embed code.'));
      }
    }

    if (sub === 'remove') {
      const id = parseInt(args[2]);
      if (isNaN(id)) return replyEmbed(ctx, errorEmbed('Missing ID', 'Provide a page number.'));
      if (!pag[msg.id]) return replyEmbed(ctx, errorEmbed('Not Found', 'No pagination on that message.'));
      if (id < 1 || id > pag[msg.id].pages.length) return replyEmbed(ctx, errorEmbed('Invalid ID', 'Page number out of range.'));
      pag[msg.id].pages.splice(id - 1, 1);
      if (pag[msg.id].currentPage >= pag[msg.id].pages.length) pag[msg.id].currentPage = 0;
      getGuildDb(guildId)._save();
      await updatePaginationMessage(msg, pag[msg.id]);
      return replyEmbed(ctx, successEmbed('Page Removed', `Page ${id} removed.`));
    }

    if (sub === 'update') {
      const id = parseInt(args[2]);
      const code = args.slice(3).join(' ');
      if (isNaN(id) || !code) return replyEmbed(ctx, errorEmbed('Missing Arguments', 'Usage: `pagination update <message_link> <id> <embed_code>`'));
      if (!pag[msg.id]) return replyEmbed(ctx, errorEmbed('Not Found', 'No pagination on that message.'));
      if (id < 1 || id > pag[msg.id].pages.length) return replyEmbed(ctx, errorEmbed('Invalid ID', 'Page number out of range.'));
      try {
        pag[msg.id].pages[id - 1] = JSON.parse(code);
        getGuildDb(guildId)._save();
        await updatePaginationMessage(msg, pag[msg.id]);
        return replyEmbed(ctx, successEmbed('Page Updated', `Page ${id} updated.`));
      } catch {
        return replyEmbed(ctx, errorEmbed('Invalid JSON', 'Could not parse embed code.'));
      }
    }

    if (sub === 'delete') {
      delete pag[msg.id];
      getGuildDb(guildId)._save();
      await msg.edit({ components: [] }).catch(() => {});
      return replyEmbed(ctx, successEmbed('Pagination Deleted', 'Pagination removed from message.'));
    }

    if (sub === 'restorereactions') {
      if (!pag[msg.id]) return replyEmbed(ctx, errorEmbed('Not Found', 'No pagination on that message.'));
      await updatePaginationMessage(msg, pag[msg.id]);
      return replyEmbed(ctx, successEmbed('Reactions Restored', 'Navigation buttons restored.'));
    }
  }
}

async function updatePaginationMessage(msg, data) {
  const total = data.pages.length;
  const current = data.currentPage || 0;
  const embed = EmbedBuilder.from(data.pages[current]);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`pag_prev_${msg.id}`).setEmoji('◀').setStyle(ButtonStyle.Primary).setDisabled(current === 0),
    new ButtonBuilder().setCustomId(`pag_next_${msg.id}`).setEmoji('▶').setStyle(ButtonStyle.Primary).setDisabled(current >= total - 1),
    new ButtonBuilder().setCustomId(`pag_page_${msg.id}`).setLabel(`${current + 1}/${total}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
  );
  await msg.edit({ embeds: [embed], components: [row] }).catch(() => {});
}

async function handlePaginationButton(interaction) {
  if (!interaction.isButton() || !interaction.customId.startsWith('pag_')) return false;
  const [, action, msgId] = interaction.customId.split('_');
  const pag = getPaginationDb(interaction.guild.id);
  const data = pag[msgId];
  if (!data) { await interaction.deferUpdate().catch(() => {}); return true; }
  if (action === 'prev' && data.currentPage > 0) data.currentPage--;
  if (action === 'next' && data.currentPage < data.pages.length - 1) data.currentPage++;
  getGuildDb(interaction.guild.id)._save();
  const channel = interaction.guild.channels.cache.get(data.channelId);
  if (channel) {
    const msg = await channel.messages.fetch(msgId).catch(() => null);
    if (msg) await updatePaginationMessage(msg, data);
  }
  await interaction.deferUpdate().catch(() => {});
  return true;
}

// ══════════════════════════════════════════════════════════
// 3. ENABLE / DISABLE COMMAND
// ══════════════════════════════════════════════════════════
function getDisabledDb(guildId) {
  const db = getGuildDb(guildId);
  if (!db.data.disabled) db.data.disabled = { commands: {}, events: {}, modules: {} };
  return db.data.disabled;
}

async function handleEnablecommand(ctx, args) {
  const db = getDisabledDb(ctx.guild.id);
  const target = args[0];
  const cmd = args[1]?.toLowerCase();
  if (!target || !cmd) return replyEmbed(ctx, errorEmbed('Missing Arguments', 'Usage: `enablecommand <target> <command>`'));

  const isAll = target.toLowerCase() === 'all';
  if (isAll) {
    for (const key of Object.keys(db.commands)) {
      db.commands[key] = (db.commands[key] || []).filter(id => id !== 'all');
    }
    getGuildDb(ctx.guild.id)._save();
    return replyEmbed(ctx, successEmbed('Command Enabled', `\`${cmd}\` enabled in every channel.`));
  }

  const channel = await resolveChannel(ctx, target);
  const member = await resolveMember(ctx, target);
  const id = channel?.id || member?.id;
  if (!id) return replyEmbed(ctx, errorEmbed('Invalid Target', 'Mention a channel or member.'));

  if (!db.commands[cmd]) db.commands[cmd] = [];
  db.commands[cmd] = db.commands[cmd].filter(x => x !== id);
  getGuildDb(ctx.guild.id)._save();
  return replyEmbed(ctx, successEmbed('Command Enabled', `\`${cmd}\` enabled for ${channel || member}.`));
}

async function handleDisablecommand(ctx, args) {
  const db = getDisabledDb(ctx.guild.id);
  const sub = args[0]?.toLowerCase();

  if (sub === 'list') {
    const list = Object.entries(db.commands).map(([cmd, ids]) => `\`${cmd}\` — ${ids.map(id => `<#${id}>`).join(', ')}`).join('\n') || 'None';
    return replyEmbed(ctx, infoEmbed('Disabled Commands', list));
  }

  const target = args[0];
  const cmd = args[1]?.toLowerCase();
  if (!target || !cmd) return replyEmbed(ctx, errorEmbed('Missing Arguments', 'Usage: `disablecommand <target> <command>`'));

  const isAll = target.toLowerCase() === 'all';
  if (isAll) {
    if (!db.commands[cmd]) db.commands[cmd] = [];
    if (!db.commands[cmd].includes('all')) db.commands[cmd].push('all');
    getGuildDb(ctx.guild.id)._save();
    return replyEmbed(ctx, successEmbed('Command Disabled', `\`${cmd}\` disabled in every channel.`));
  }

  const channel = await resolveChannel(ctx, target);
  const member = await resolveMember(ctx, target);
  const id = channel?.id || member?.id;
  if (!id) return replyEmbed(ctx, errorEmbed('Invalid Target', 'Mention a channel or member.'));

  if (!db.commands[cmd]) db.commands[cmd] = [];
  if (!db.commands[cmd].includes(id)) db.commands[cmd].push(id);
  getGuildDb(ctx.guild.id)._save();
  return replyEmbed(ctx, successEmbed('Command Disabled', `\`${cmd}\` disabled for ${channel || member}.`));
}

async function handleCopydisabled(ctx, args) {
  const oldCh = await resolveChannel(ctx, args[0]);
  const newCh = await resolveChannel(ctx, args[1]);
  if (!oldCh || !newCh) return replyEmbed(ctx, errorEmbed('Invalid Channels', 'Usage: `copydisabled <#old> <#new>`'));
  const db = getDisabledDb(ctx.guild.id);
  let copied = 0;
  for (const [cmd, ids] of Object.entries(db.commands)) {
    if (ids.includes(oldCh.id) && !ids.includes(newCh.id)) {
      ids.push(newCh.id); copied++;
    }
  }
  for (const [evt, ids] of Object.entries(db.events || {})) {
    if (ids.includes(oldCh.id) && !ids.includes(newCh.id)) {
      ids.push(newCh.id); copied++;
    }
  }
  for (const [mod, ids] of Object.entries(db.modules || {})) {
    if (ids.includes(oldCh.id) && !ids.includes(newCh.id)) {
      ids.push(newCh.id); copied++;
    }
  }
  getGuildDb(ctx.guild.id)._save();
  return replyEmbed(ctx, successEmbed('Copied', `Disabled settings copied from ${oldCh} to ${newCh}. (${copied} entries)`));
}

// ══════════════════════════════════════════════════════════
// 4. ENABLE / DISABLE EVENT
// ══════════════════════════════════════════════════════════
async function handleEnableevent(ctx, args) {
  const db = getDisabledDb(ctx.guild.id);
  const target = args[0];
  const event = args[1]?.toLowerCase();
  if (!target || !event) return replyEmbed(ctx, errorEmbed('Missing Arguments', 'Usage: `enableevent <target> <event>`'));

  const isAll = target.toLowerCase() === 'all';
  if (isAll) {
    delete db.events[event];
    getGuildDb(ctx.guild.id)._save();
    return replyEmbed(ctx, successEmbed('Event Enabled', `\`${event}\` enabled in every channel.`));
  }

  const channel = await resolveChannel(ctx, target);
  if (!channel) return replyEmbed(ctx, errorEmbed('Invalid Channel', 'Mention a valid channel.'));
  if (!db.events[event]) db.events[event] = [];
  db.events[event] = db.events[event].filter(id => id !== channel.id);
  getGuildDb(ctx.guild.id)._save();
  return replyEmbed(ctx, successEmbed('Event Enabled', `\`${event}\` enabled in ${channel}.`));
}

async function handleDisableevent(ctx, args) {
  const db = getDisabledDb(ctx.guild.id);
  const sub = args[0]?.toLowerCase();

  if (sub === 'list') {
    const list = Object.entries(db.events).map(([evt, ids]) => `\`${evt}\` — ${ids.map(id => `<#${id}>`).join(', ')}`).join('\n') || 'None';
    return replyEmbed(ctx, infoEmbed('Disabled Events', list));
  }

  const target = args[0];
  const event = args[1]?.toLowerCase();
  if (!target || !event) return replyEmbed(ctx, errorEmbed('Missing Arguments', 'Usage: `disableevent <target> <event>`'));

  const isAll = target.toLowerCase() === 'all';
  if (isAll) {
    db.events[event] = ['all'];
    getGuildDb(ctx.guild.id)._save();
    return replyEmbed(ctx, successEmbed('Event Disabled', `\`${event}\` disabled in every channel.`));
  }

  const channel = await resolveChannel(ctx, target);
  if (!channel) return replyEmbed(ctx, errorEmbed('Invalid Channel', 'Mention a valid channel.'));
  if (!db.events[event]) db.events[event] = [];
  if (!db.events[event].includes(channel.id)) db.events[event].push(channel.id);
  getGuildDb(ctx.guild.id)._save();
  return replyEmbed(ctx, successEmbed('Event Disabled', `\`${event}\` disabled in ${channel}.`));
}

// ══════════════════════════════════════════════════════════
// 5. ENABLE / DISABLE MODULE
// ══════════════════════════════════════════════════════════
async function handleEnablemodule(ctx, args) {
  const db = getDisabledDb(ctx.guild.id);
  const target = args[0];
  const module = args[1]?.toLowerCase();
  if (!target || !module) return replyEmbed(ctx, errorEmbed('Missing Arguments', 'Usage: `enablemodule <target> <module>`'));

  const isAll = target.toLowerCase() === 'all';
  if (isAll) {
    delete db.modules[module];
    getGuildDb(ctx.guild.id)._save();
    return replyEmbed(ctx, successEmbed('Module Enabled', `\`${module}\` enabled in every channel.`));
  }

  const channel = await resolveChannel(ctx, target);
  if (!channel) return replyEmbed(ctx, errorEmbed('Invalid Channel', 'Mention a valid channel.'));
  if (!db.modules[module]) db.modules[module] = [];
  db.modules[module] = db.modules[module].filter(id => id !== channel.id);
  getGuildDb(ctx.guild.id)._save();
  return replyEmbed(ctx, successEmbed('Module Enabled', `\`${module}\` enabled in ${channel}.`));
}

async function handleDisablemodule(ctx, args) {
  const db = getDisabledDb(ctx.guild.id);
  const sub = args[0]?.toLowerCase();

  if (sub === 'list') {
    const list = Object.entries(db.modules).map(([mod, ids]) => `\`${mod}\` — ${ids.map(id => `<#${id}>`).join(', ')}`).join('\n') || 'None';
    return replyEmbed(ctx, infoEmbed('Disabled Modules', list));
  }

  const target = args[0];
  const module = args[1]?.toLowerCase();
  if (!target || !module) return replyEmbed(ctx, errorEmbed('Missing Arguments', 'Usage: `disablemodule <target> <module>`'));

  const isAll = target.toLowerCase() === 'all';
  if (isAll) {
    db.modules[module] = ['all'];
    getGuildDb(ctx.guild.id)._save();
    return replyEmbed(ctx, successEmbed('Module Disabled', `\`${module}\` disabled in every channel.`));
  }

  const channel = await resolveChannel(ctx, target);
  if (!channel) return replyEmbed(ctx, errorEmbed('Invalid Channel', 'Mention a valid channel.'));
  if (!db.modules[module]) db.modules[module] = [];
  if (!db.modules[module].includes(channel.id)) db.modules[module].push(channel.id);
  getGuildDb(ctx.guild.id)._save();
  return replyEmbed(ctx, successEmbed('Module Disabled', `\`${module}\` disabled in ${channel}.`));
}

// Check helpers
function isCommandDisabled(guildId, command, channelId) {
  const db = getDisabledDb(guildId);
  const list = db.commands[command] || [];
  return list.includes('all') || list.includes(channelId);
}
function isEventDisabled(guildId, event, channelId) {
  const db = getDisabledDb(guildId);
  const list = db.events[event] || [];
  return list.includes('all') || list.includes(channelId);
}
function isModuleDisabled(guildId, module, channelId) {
  const db = getDisabledDb(guildId);
  const list = db.modules[module] || [];
  return list.includes('all') || list.includes(channelId);
}

// ══════════════════════════════════════════════════════════
// 6. IGNORE SYSTEM
// ══════════════════════════════════════════════════════════
function getIgnoreDb(guildId) {
  const db = getGuildDb(guildId);
  if (!db.data.ignored) db.data.ignored = { members: [], channels: [] };
  return db.data.ignored;
}

async function handleIgnore(ctx, args) {
  const sub = args[0]?.toLowerCase();
  const db = getIgnoreDb(ctx.guild.id);

  if (!sub) {
    return replyEmbed(ctx, infoEmbed('Ignore',
      '`ignore add <target>` — ignore a member or channel\n' +
      '`ignore remove <target>` — stop ignoring\n' +
      '`ignore list` — view ignored members/channels'
    ));
  }

  if (sub === 'list') {
    const members = db.members.map(id => `<@${id}>`).join('\n') || 'None';
    const channels = db.channels.map(id => `<#${id}>`).join('\n') || 'None';
    return replyEmbed(ctx, infoEmbed('Ignored List', `**Members:**\n${members}\n\n**Channels:**\n${channels}`));
  }

  const target = await resolveMember(ctx, args[1]) || await resolveChannel(ctx, args[1]);
  if (!target) return replyEmbed(ctx, errorEmbed('Invalid Target', 'Mention a member or channel.'));

  if (sub === 'add') {
    if (target.user) {
      if (!db.members.includes(target.id)) db.members.push(target.id);
    } else {
      if (!db.channels.includes(target.id)) db.channels.push(target.id);
    }
    getGuildDb(ctx.guild.id)._save();
    return replyEmbed(ctx, successEmbed('Ignored', `Now ignoring ${target}.`));
  }

  if (sub === 'remove') {
    if (target.user) {
      db.members = db.members.filter(id => id !== target.id);
    } else {
      db.channels = db.channels.filter(id => id !== target.id);
    }
    getGuildDb(ctx.guild.id)._save();
    return replyEmbed(ctx, successEmbed('Unignored', `Stopped ignoring ${target}.`));
  }
}

function isIgnored(guildId, memberId, channelId) {
  const db = getIgnoreDb(guildId);
  return db.members.includes(memberId) || db.channels.includes(channelId);
}

// ══════════════════════════════════════════════════════════
// 7. SETICON / SETSPLASHBACKGROUND / SETBANNER
// ══════════════════════════════════════════════════════════
async function handleSeticon(ctx, args) {
  const url = args[0];
  if (!url) return replyEmbed(ctx, errorEmbed('Missing URL', 'Usage: `seticon <url>`'));
  try {
    await ctx.guild.setIcon(url);
    return replyEmbed(ctx, successEmbed('Icon Updated', 'Server icon has been changed.'));
  } catch (err) {
    return replyEmbed(ctx, errorEmbed('Failed', err.message));
  }
}

async function handleSetsplashbackground(ctx, args) {
  const url = args[0];
  if (!url) return replyEmbed(ctx, errorEmbed('Missing URL', 'Usage: `setsplashbackground <url>`'));
  try {
    await ctx.guild.setSplash(url);
    return replyEmbed(ctx, successEmbed('Splash Updated', 'Server splash background has been changed.'));
  } catch (err) {
    return replyEmbed(ctx, errorEmbed('Failed', err.message));
  }
}

async function handleSetbanner(ctx, args) {
  const url = args[0];
  if (!url) return replyEmbed(ctx, errorEmbed('Missing URL', 'Usage: `setbanner <url>`'));
  try {
    await ctx.guild.setBanner(url);
    return replyEmbed(ctx, successEmbed('Banner Updated', 'Server banner has been changed.'));
  } catch (err) {
    return replyEmbed(ctx, errorEmbed('Failed', err.message));
  }
}

// ══════════════════════════════════════════════════════════
// 8. PIN / UNPIN
// ══════════════════════════════════════════════════════════
async function handlePin(ctx, args) {
  let targetMsg = null;
  const input = args[0] || '';
  const linkMatch = input.match(/discord\.com\/channels\/(\d+)\/(\d+)\/(\d+)/);
  try {
    if (linkMatch) {
      const [, , channelId, messageId] = linkMatch;
      const ch = await ctx.client.channels.fetch(channelId).catch(() => null);
      if (ch) targetMsg = await ch.messages.fetch(messageId).catch(() => null);
    } else if (/^\d+$/.test(input)) {
      targetMsg = await ctx.channel.messages.fetch(input).catch(() => null);
    } else {
      const messages = await ctx.channel.messages.fetch({ limit: 5 });
      targetMsg = messages.find(m => !m.pinned && !m.author.bot);
    }
  } catch {}
  if (!targetMsg) return replyEmbed(ctx, errorEmbed('Message Not Found', 'Provide a message link, ID, or ensure recent messages exist.'));
  try {
    await targetMsg.pin();
    return replyEmbed(ctx, successEmbed('Pinned', `[Message](${targetMsg.url}) has been pinned.`));
  } catch (err) {
    return replyEmbed(ctx, errorEmbed('Failed', err.message));
  }
}

async function handleUnpin(ctx, args) {
  let targetMsg = null;
  const input = args[0] || '';
  const linkMatch = input.match(/discord\.com\/channels\/(\d+)\/(\d+)\/(\d+)/);
  try {
    if (linkMatch) {
      const [, , channelId, messageId] = linkMatch;
      const ch = await ctx.client.channels.fetch(channelId).catch(() => null);
      if (ch) targetMsg = await ch.messages.fetch(messageId).catch(() => null);
    } else if (/^\d+$/.test(input)) {
      targetMsg = await ctx.channel.messages.fetch(input).catch(() => null);
    } else {
      const pins = await ctx.channel.messages.fetchPinned();
      targetMsg = pins.first();
    }
  } catch {}
  if (!targetMsg) return replyEmbed(ctx, errorEmbed('Message Not Found', 'Provide a message link, ID, or ensure pinned messages exist.'));
  try {
    await targetMsg.unpin();
    return replyEmbed(ctx, successEmbed('Unpinned', `[Message](${targetMsg.url}) has been unpinned.`));
  } catch (err) {
    return replyEmbed(ctx, errorEmbed('Failed', err.message));
  }
}

// ══════════════════════════════════════════════════════════
// 9. FIRSTMESSAGE
// ══════════════════════════════════════════════════════════
async function handleFirstmessage(ctx, args) {
  const channel = await resolveChannel(ctx, args[0]) || ctx.channel;
  try {
    const messages = await channel.messages.fetch({ limit: 1, after: '0' });
    const first = messages.first();
    if (!first) return replyEmbed(ctx, errorEmbed('Not Found', 'Could not find the first message.'));
    return replyEmbed(ctx, infoEmbed('First Message',
      `**Author:** ${first.author.tag}\n**Sent:** <t:${Math.floor(first.createdTimestamp / 1000)}:F>\n**Link:** [Jump](${first.url})`
    ));
  } catch (err) {
    return replyEmbed(ctx, errorEmbed('Failed', err.message));
  }
}

// ══════════════════════════════════════════════════════════
// 10. PINS ARCHIVAL SYSTEM
// ══════════════════════════════════════════════════════════
function getPinsDb(guildId) {
  const db = getGuildDb(guildId);
  if (!db.data.pinsConfig) db.data.pinsConfig = { enabled: false, channelId: null, unpin: false };
  return db.data.pinsConfig;
}

async function handlePins(ctx, args) {
  const sub = args[0]?.toLowerCase();
  const db = getPinsDb(ctx.guild.id);

  if (!sub) {
    return replyEmbed(ctx, infoEmbed('Pins System',
      '`pins config` — view config\n' +
      '`pins set <on/off>` — enable/disable\n' +
      '`pins channel <#channel>` — set archive channel\n' +
      '`pins unpin <on/off>` — toggle unpinning after archive\n' +
      '`pins archive` — archive current channel pins\n' +
      '`pins reset` — reset config'
    ));
  }

  if (sub === 'config') {
    return replyEmbed(ctx, infoEmbed('Pin Archival Config',
      `**Enabled:** ${db.enabled ? 'Yes' : 'No'}\n**Channel:** ${db.channelId ? `<#${db.channelId}>` : 'Not set'}\n**Unpin after archive:** ${db.unpin ? 'Yes' : 'No'}`
    ));
  }

  if (sub === 'set') {
    const opt = args[1]?.toLowerCase();
    db.enabled = opt === 'on' || opt === 'true' || opt === 'yes';
    getGuildDb(ctx.guild.id)._save();
    return replyEmbed(ctx, successEmbed('Config Updated', `Pin archival is now **${db.enabled ? 'enabled' : 'disabled'}**.`));
  }

  if (sub === 'reset') {
    const guildDb = getGuildDb(ctx.guild.id);
    guildDb.data.pinsConfig = { enabled: false, channelId: null, unpin: false };
    guildDb._save();
    return replyEmbed(ctx, successEmbed('Config Reset', 'Pin archival config has been reset.'));
  }

  if (sub === 'archive') {
    const pins = await ctx.channel.messages.fetchPinned().catch(() => null);
    if (!pins?.size) return replyEmbed(ctx, errorEmbed('No Pins', 'This channel has no pinned messages.'));
    const archiveCh = db.channelId ? ctx.guild.channels.cache.get(db.channelId) : null;
    if (!archiveCh) return replyEmbed(ctx, errorEmbed('No Archive Channel', 'Set an archive channel with `pins channel #channel`.'));
    let archived = 0;
    for (const [, msg] of pins) {
      const embed = new EmbedBuilder()
        .setAuthor({ name: msg.author.tag, iconURL: msg.author.displayAvatarURL() })
        .setDescription(msg.content || '*No text content*')
        .setTimestamp(msg.createdTimestamp)
        .setFooter({ text: `#${msg.channel.name}` });
      if (msg.attachments.size > 0) {
        const img = msg.attachments.find(a => a.contentType?.startsWith('image/'));
        if (img) embed.setImage(img.url);
      }
      await archiveCh.send({ embeds: [embed] }).catch(() => {});
      if (db.unpin) await msg.unpin().catch(() => {});
      archived++;
    }
    return replyEmbed(ctx, successEmbed('Archived', `Archived **${archived}** pin(s) to ${archiveCh}.`));
  }

  if (sub === 'unpin') {
    const opt = args[1]?.toLowerCase();
    db.unpin = opt === 'on' || opt === 'true' || opt === 'yes';
    getGuildDb(ctx.guild.id)._save();
    return replyEmbed(ctx, successEmbed('Config Updated', `Unpin after archive is now **${db.unpin ? 'enabled' : 'disabled'}**.`));
  }

  if (sub === 'channel') {
    const channel = await resolveChannel(ctx, args[1]);
    if (!channel) return replyEmbed(ctx, errorEmbed('Invalid Channel', 'Mention a valid channel.'));
    db.channelId = channel.id;
    getGuildDb(ctx.guild.id)._save();
    return replyEmbed(ctx, successEmbed('Channel Set', `Pin archive channel set to ${channel}.`));
  }
}

async function onChannelPinsUpdate(channel, time) {
  const db = getPinsDb(channel.guild.id);
  if (!db.enabled || !db.channelId) return;
  const archiveCh = channel.guild.channels.cache.get(db.channelId);
  if (!archiveCh) return;
  try {
    const pins = await channel.messages.fetchPinned();
    const newest = pins.first();
    if (!newest || newest.author.bot) return;
    const embed = new EmbedBuilder()
      .setAuthor({ name: newest.author.tag, iconURL: newest.author.displayAvatarURL() })
      .setDescription(newest.content || '*No text content*')
      .setTimestamp(newest.createdTimestamp)
      .setFooter({ text: `Pinned in #${channel.name}` });
    if (newest.attachments.size > 0) {
      const img = newest.attachments.find(a => a.contentType?.startsWith('image/'));
      if (img) embed.setImage(img.url);
    }
    await archiveCh.send({ content: `📌 New pin in ${channel}:`, embeds: [embed] }).catch(() => {});
    if (db.unpin) await newest.unpin().catch(() => {});
  } catch {}
}

// ══════════════════════════════════════════════════════════
// 11. WEBHOOK SYSTEM
// ══════════════════════════════════════════════════════════
function getWebhookDb(guildId) {
  const db = getGuildDb(guildId);
  if (!db.data.webhooks) db.data.webhooks = {};
  return db.data.webhooks;
}

async function handleWebhook(ctx, args) {
  const sub = args[0]?.toLowerCase();
  const db = getWebhookDb(ctx.guild.id);

  if (!sub) {
    return replyEmbed(ctx, infoEmbed('Webhook System',
      '`webhook create <name>` — create a webhook\n' +
      '`webhook delete <id>` — delete a webhook\n' +
      '`webhook list` — list all webhooks\n' +
      '`webhook send <id> <message>` — send via webhook\n' +
      '`webhook edit <id> <name>` — edit webhook\n' +
      '`webhook lock <id>` — lock webhook\n' +
      '`webhook unlock <id>` — unlock webhook'
    ));
  }

  if (sub === 'list') {
    const hooks = await ctx.guild.fetchWebhooks().catch(() => new Map());
    const lines = [];
    hooks.forEach(h => {
      lines.push(`**${h.name}** — <#${h.channelId}> — \`${h.id}\``);
    });
    return replyEmbed(ctx, infoEmbed('Webhooks', lines.join('\n') || 'No webhooks found.'));
  }

  if (sub === 'create') {
    const name = args.slice(1).join(' ') || 'Kaido Webhook';
    try {
      const hook = await ctx.channel.createWebhook({ name });
      db[hook.id] = { id: hook.id, token: hook.token, channelId: hook.channelId, locked: false, creator: ctx.author.id };
      getGuildDb(ctx.guild.id)._save();
      return replyEmbed(ctx, successEmbed('Webhook Created', `**${hook.name}** in ${ctx.channel}\nID: \`${hook.id}\``));
    } catch (err) {
      return replyEmbed(ctx, errorEmbed('Failed', err.message));
    }
  }

  if (sub === 'delete') {
    const id = args[1];
    if (!id) return replyEmbed(ctx, errorEmbed('Missing ID', 'Usage: `webhook delete <id>`'));
    try {
      const hooks = await ctx.guild.fetchWebhooks();
      const hook = hooks.get(id);
      if (!hook) return replyEmbed(ctx, errorEmbed('Not Found', 'Webhook not found.'));
      await hook.delete();
      delete db[id];
      getGuildDb(ctx.guild.id)._save();
      return replyEmbed(ctx, successEmbed('Webhook Deleted', 'Webhook has been deleted.'));
    } catch (err) {
      return replyEmbed(ctx, errorEmbed('Failed', err.message));
    }
  }

  if (sub === 'send') {
    const id = args[1];
    const text = args.slice(2).join(' ');
    if (!id || !text) return replyEmbed(ctx, errorEmbed('Missing Arguments', 'Usage: `webhook send <id> <message>`'));
    const data = db[id];
    if (!data) return replyEmbed(ctx, errorEmbed('Not Found', 'Webhook not found in database.'));
    if (data.locked && data.creator !== ctx.author.id) return replyEmbed(ctx, errorEmbed('Locked', 'This webhook is locked.'));
    try {
      const hook = new WebhookClient({ id: data.id, token: data.token });
      await hook.send(text);
      return replyEmbed(ctx, successEmbed('Sent', 'Message sent via webhook.'));
    } catch (err) {
      return replyEmbed(ctx, errorEmbed('Failed', err.message));
    }
  }

  if (sub === 'edit') {
    const id = args[1];
    const text = args.slice(2).join(' ');
    if (!id || !text) return replyEmbed(ctx, errorEmbed('Missing Arguments', 'Usage: `webhook edit <id> <name>`'));
    const data = db[id];
    if (!data) return replyEmbed(ctx, errorEmbed('Not Found', 'Webhook not found in database.'));
    if (data.locked && data.creator !== ctx.author.id) return replyEmbed(ctx, errorEmbed('Locked', 'This webhook is locked.'));
    try {
      const hooks = await ctx.guild.fetchWebhooks();
      const hook = hooks.get(id);
      if (!hook) return replyEmbed(ctx, errorEmbed('Not Found', 'Webhook not found.'));
      await hook.edit({ name: text });
      return replyEmbed(ctx, successEmbed('Edited', 'Webhook updated.'));
    } catch (err) {
      return replyEmbed(ctx, errorEmbed('Failed', err.message));
    }
  }

  if (sub === 'lock') {
    const id = args[1];
    if (!id) return replyEmbed(ctx, errorEmbed('Missing ID', 'Usage: `webhook lock <id>`'));
    if (!db[id]) return replyEmbed(ctx, errorEmbed('Not Found', 'Webhook not found.'));
    db[id].locked = true;
    getGuildDb(ctx.guild.id)._save();
    return replyEmbed(ctx, successEmbed('Locked', 'Webhook is now locked.'));
  }

  if (sub === 'unlock') {
    const id = args[1];
    if (!id) return replyEmbed(ctx, errorEmbed('Missing ID', 'Usage: `webhook unlock <id>`'));
    if (!db[id]) return replyEmbed(ctx, errorEmbed('Not Found', 'Webhook not found.'));
    db[id].locked = false;
    getGuildDb(ctx.guild.id)._save();
    return replyEmbed(ctx, successEmbed('Unlocked', 'Webhook is now unlocked.'));
  }
}

// ══════════════════════════════════════════════════════════
// EXPORTS
// ══════════════════════════════════════════════════════════
module.exports = {
  // Autoresponder
  handleAutoresponder,
  processAutoresponder,
  // Pagination
  handlePagination,
  handlePaginationButton,
  updatePaginationMessage,
  // Enable/Disable
  handleEnablecommand,
  handleDisablecommand,
  handleCopydisabled,
  handleEnableevent,
  handleDisableevent,
  handleEnablemodule,
  handleDisablemodule,
  isCommandDisabled,
  isEventDisabled,
  isModuleDisabled,
  // Ignore
  handleIgnore,
  isIgnored,
  // Guild assets
  handleSeticon,
  handleSetsplashbackground,
  handleSetbanner,
  // Pin
  handlePin,
  handleUnpin,
  // First message
  handleFirstmessage,
  // Pins archival
  handlePins,
  onChannelPinsUpdate,
  // Webhook
  handleWebhook,
};