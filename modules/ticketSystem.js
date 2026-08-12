const {
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType,
    PermissionFlagsBits, ModalBuilder, TextInputBuilder, TextInputStyle
} = require('discord.js');
const { getGuildDb } = require('./database');
const logger = require('../utils/logger');

// ══════════════════════════════════════════════════════════
//  TICKET UTILITIES
// ══════════════════════════════════════════════════════════

function isTicketAdmin(member, ticketConfig) {
    if (!member) return false;
    if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
    const supportRoles = ticketConfig.supportRoles || [];
    return supportRoles.some(r => member.roles.cache.has(r));
}

function isTicketOwner(userId, ticketData) {
    return userId === ticketData.openerId;
}

async function fetchTicketData(channel, guildId) {
    const db = getGuildDb(guildId);
    const tickets = db.get('tickets', {});
    return tickets[channel.id] || null;
}

async function saveTicketData(guildId, channelId, data) {
    const db = getGuildDb(guildId);
    const tickets = db.get('tickets', {});
    tickets[channelId] = data;
    db.set('tickets', tickets);
}

async function deleteTicketData(guildId, channelId) {
    const db = getGuildDb(guildId);
    const tickets = db.get('tickets', {});
    delete tickets[channelId];
    db.set('tickets', tickets);
}

// ══════════════════════════════════════════════════════════
//  EMBEDS & COMPONENTS
// ══════════════════════════════════════════════════════════

function buildPanelEmbed(panelData) {
    const embed = new EmbedBuilder()
        .setTitle(panelData.name || '🎫 Support Ticket')
        .setDescription(panelData.description || 'Click a button to create a ticket')
        .setColor(panelData.color || '#5865F2');

    if (panelData.image) embed.setImage(panelData.image);
    if (panelData.thumbnail) embed.setThumbnail(panelData.thumbnail);
    if (panelData.footer) embed.setFooter({ text: panelData.footer });
    if (panelData.author) embed.setAuthor({ name: panelData.author });

    return embed;
}

function buildPanelButtons(panelData) {
    const buttons = [];
    (panelData.buttons || []).slice(0, 5).forEach(btn => {
        buttons.push(
            new ButtonBuilder()
                .setCustomId(`ticket_type_${btn.id}`)
                .setLabel(btn.label)
                .setEmoji(btn.emoji || '🎫')
                .setStyle(btn.style || ButtonStyle.Primary)
        );
    });
    return new ActionRowBuilder().addComponents(buttons);
}

function buildTicketEmbed(ticketData, user) {
    return new EmbedBuilder()
        .setTitle(`🎫 Ticket #${ticketData.ticketNumber}`)
        .setDescription(`**Support will be with you shortly.**\n**Please describe your issue below.**`)
        .addFields(
            { name: 'Status', value: ticketData.status || 'Open', inline: true },
            { name: 'Type', value: ticketData.type || 'General', inline: true },
            { name: 'Claimed By', value: ticketData.claimedBy ? `<@${ticketData.claimedBy}>` : 'Unclaimed', inline: true }
        )
        .setColor('#5865F2')
        .setFooter({ text: `Opened by ${user.username}` })
        .setTimestamp();
}

function buildTicketButtons(ticketData, isSupport, isOwner) {
    const buttons = [];

    if (isSupport) {
        buttons.push(
            new ButtonBuilder().setCustomId('ticket_claim').setEmoji('🤝').setLabel('Claim').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('ticket_unclaim').setEmoji('👤').setLabel('Unclaim').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('ticket_close').setEmoji('🔒').setLabel('Close').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('ticket_delete').setEmoji('🗑️').setLabel('Delete').setStyle(ButtonStyle.Danger)
        );
    } else if (isOwner && ticketData.status === 'open') {
        buttons.push(
            new ButtonBuilder().setCustomId('ticket_close').setEmoji('🔒').setLabel('Close').setStyle(ButtonStyle.Secondary)
        );
    }

    if (isSupport && ticketData.status === 'closed') {
        buttons.push(
            new ButtonBuilder().setCustomId('ticket_reopen').setEmoji('🔓').setLabel('Reopen').setStyle(ButtonStyle.Success)
        );
    }

    if (isSupport) {
        buttons.push(
            new ButtonBuilder().setCustomId('ticket_transcript').setEmoji('📄').setLabel('Transcript').setStyle(ButtonStyle.Secondary)
        );
    }

    return buttons.length > 0 ? [new ActionRowBuilder().addComponents(buttons.slice(0, 5))] : [];
}

// ══════════════════════════════════════════════════════════
//  TICKET SETUP
// ══════════════════════════════════════════════════════════

async function handleTicketSetup(message) {
    const { isAdmin, hasDiscordPerm } = require('./helpers');
    if (!isAdmin(message.member) && !message.member.permissions.has(PermissionFlagsBits.Administrator) && !hasDiscordPerm(message.member, 'ManageChannels')) {
        return message.reply('❌ You need the **Manage Channels** permission (or Administrator) to set up tickets.');
    }

    const db = getGuildDb(message.guild.id);
    let tc = db.get('ticket', {});

    if (tc.setupComplete) {
        // Check if the channels still physically exist
        const catOk   = tc.categoryId      && message.guild.channels.cache.has(tc.categoryId);
        const panelOk = tc.panelChannelId  && message.guild.channels.cache.has(tc.panelChannelId);
        if (catOk || panelOk) {
            return message.reply(`❌ Ticket system is already set up in <#${tc.panelChannelId || tc.categoryId}>. Delete the ticket channels first to reset.`);
        }
        // Channels were deleted — allow fresh setup
        db.set('ticket', {});
        tc = {};
    }

    try {
        const guild = message.guild;

        // Create category
        const category = await guild.channels.create({
            name: '🎫 Support Tickets',
            type: ChannelType.GuildCategory,
            reason: 'Ticket system setup'
        });

        // Create ticket panel channel
        const panelChannel = await guild.channels.create({
            name: 'ticket-panel',
            type: ChannelType.GuildText,
            parent: category,
            permissionOverwrites: [
                { id: guild.roles.everyone, allow: [PermissionFlagsBits.ViewChannel], deny: [PermissionFlagsBits.SendMessages] },
                { id: message.client.user.id, allow: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages] }
            ],
            reason: 'Ticket panel channel'
        });

        const setupData = {
            setupComplete: true,
            categoryId: category.id,
            panelChannelId: panelChannel.id,
            supportRoles: [],
            ticketCounter: 0,
            tickets: {},
            ticketPanels: {
                default: {
                    id: 'default',
                    name: '🎫 Support Ticket',
                    description: 'Click the button below to create a support ticket',
                    color: '#5865F2',
                    image: null,
                    thumbnail: null,
                    footer: 'Kaido Support Team',
                    author: null,
                    buttons: [{ id: 'general', label: 'Create Ticket', emoji: '🎫', style: ButtonStyle.Primary }],
                    supportRoles: [],
                    category: category.id,
                    transcriptChannel: null,
                    logChannel: null,
                    cooldown: 0,
                    ticketLimit: 5,
                    requiredRoles: [],
                    blacklistedRoles: [],
                    forms: [],
                    createdAt: Date.now()
                }
            },
            ticketCooldowns: {},
            panelMessages: {}
        };

        db.set('ticket', setupData);

        // Send panel
        const panelData = setupData.ticketPanels.default;
        await panelChannel.send({
            embeds: [buildPanelEmbed(panelData)],
            components: [buildPanelButtons(panelData)]
        });

        return message.reply(`✅ Ticket system set up successfully in <#${panelChannel.id}>!`);
    } catch (err) {
        logger.error('TICKET', 'Setup error', err);
        return message.reply('❌ Failed to set up ticket system. Check my permissions.');
    }
}

// ══════════════════════════════════════════════════════════
//  SUPPORT ROLES
// ══════════════════════════════════════════════════════════

async function handleSupportRole(message, args) {
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return message.reply('❌ Only administrators can manage support roles.');
    }

    const db = getGuildDb(message.guild.id);
    const tc = db.get('ticket', {});

    if (!tc.setupComplete) return message.reply('❌ Ticket system not set up.');

    const action = args[0];
    const role = message.mentions.roles.first();

    if (!role) return message.reply('❌ Mention a role.');

    tc.supportRoles = tc.supportRoles || [];

    if (action === 'add') {
        if (!tc.supportRoles.includes(role.id)) {
            tc.supportRoles.push(role.id);
            db.set('ticket', tc);
            return message.reply(`✅ Added <@&${role.id}> as a support role.`);
        }
        return message.reply('❌ Role already added.');
    }

    if (action === 'remove') {
        tc.supportRoles = tc.supportRoles.filter(r => r !== role.id);
        db.set('ticket', tc);
        return message.reply(`✅ Removed <@&${role.id}> from support roles.`);
    }

    if (action === 'list') {
        if (tc.supportRoles.length === 0) return message.reply('❌ No support roles configured.');
        const embed = new EmbedBuilder()
            .setTitle('👥 Support Roles')
            .setDescription(tc.supportRoles.map(r => `<@&${r}>`).join('\n'))
            .setColor('#5865F2');
        return message.reply({ embeds: [embed] });
    }

    return message.reply('❌ Usage: `.ticket support add/remove/list @role`');
}

// ══════════════════════════════════════════════════════════
//  TICKET CREATION & MANAGEMENT
// ══════════════════════════════════════════════════════════

async function handleTicketCreate(interaction, ticketType = 'general') {
    // Defer immediately — channel creation can exceed the 3s interaction window
    await interaction.deferReply({ ephemeral: true });

    const guild = interaction.guild;
    const user  = interaction.user;
    const db    = getGuildDb(guild.id);
    const tc    = db.get('ticket', {});

    if (!tc.setupComplete) {
        return interaction.editReply({ content: '❌ Ticket system not configured. An administrator must run `.ticket setup` first.' });
    }

    // Resolve panel config defensively
    const panels = tc.ticketPanels || {};
    const panel  = panels[ticketType] || panels.default;
    if (!panel) {
        return interaction.editReply({ content: '❌ Ticket panel not found. Please contact an administrator.' });
    }

    // Check blacklist
    const blacklist = db.get('ticketBlacklist', []);
    if (blacklist.some(entry => entry.userId === user.id)) {
        return interaction.editReply({ content: '❌ You are blacklisted from creating tickets.' });
    }

    // Check open ticket limit
    const allTickets     = db.get('tickets', {});
    const userOpenTickets = Object.values(allTickets).filter(t => t.openerId === user.id && t.status === 'open');
    const limit           = panel.ticketLimit ?? 5;
    if (userOpenTickets.length >= limit) {
        return interaction.editReply({ content: `❌ You already have ${limit} open ticket(s). Please close an existing ticket first.` });
    }

    // Check cooldown
    const cooldowns = tc.ticketCooldowns || {};
    const cd        = (panel.cooldown || 0) * 1000;
    if (cd > 0 && cooldowns[user.id] && Date.now() - cooldowns[user.id] < cd) {
        const timeLeft = Math.ceil((cd - (Date.now() - cooldowns[user.id])) / 1000);
        return interaction.editReply({ content: `❌ Please wait **${timeLeft}s** before creating another ticket.` });
    }

    try {
        const ticketCounter = (tc.ticketCounter || 0) + 1;
        tc.ticketCounter    = ticketCounter;
        const ticketNumber  = String(ticketCounter).padStart(4, '0');

        // Resolve category — fall back gracefully if deleted
        const categoryId = panel.category || tc.categoryId || null;
        const category   = categoryId ? guild.channels.cache.get(categoryId) || null : null;

        const supportRoles = tc.supportRoles || [];

        // Build permission overwrites — cap at 25 to stay within Discord limits
        const permissionOverwrites = [
            { id: guild.roles.everyone.id,    deny:  [PermissionFlagsBits.ViewChannel] },
            { id: user.id,                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] },
            { id: interaction.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages] },
        ];

        for (const roleId of supportRoles.slice(0, 10)) {
            permissionOverwrites.push({ id: roleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
        }

        const ticketChannel = await guild.channels.create({
            name:               `ticket-${ticketNumber}`,
            type:               ChannelType.GuildText,
            parent:             category,
            permissionOverwrites,
            reason:             `Ticket #${ticketNumber} opened by ${user.username}`,
        });

        const ticketData = {
            channelId:     ticketChannel.id,
            ticketNumber,
            openerId:      user.id,
            openerTag:     user.username,
            type:          ticketType,
            status:        'open',
            claimedBy:     null,
            claimedAt:     null,
            closedAt:      null,
            closedBy:      null,
            closeReason:   null,
            createdAt:     Date.now(),
            messages:      [],
            transcriptUrl: null,
            allowedUsers:  [],
            deniedUsers:   [],
            trainees:      [],
            moveHistory:   [],
            renameHistory: [{ from: `ticket-${ticketNumber}`, to: `ticket-${ticketNumber}`, at: Date.now() }],
        };

        const tickets = db.get('tickets', {});
        tickets[ticketChannel.id] = ticketData;
        db.set('tickets', tickets);

        cooldowns[user.id]    = Date.now();
        tc.ticketCooldowns    = cooldowns;
        db.set('ticket', tc);

        // Send welcome message into the ticket channel
        const embed   = buildTicketEmbed(ticketData, user);
        const buttons = buildTicketButtons(ticketData, false, true);
        await ticketChannel.send({ content: `<@${user.id}>`, embeds: [embed], components: buttons });

        // Log ticket creation
        if (panel.logChannel) {
            const logCh = guild.channels.cache.get(panel.logChannel);
            if (logCh) {
                await logCh.send({ embeds: [new EmbedBuilder()
                    .setTitle('🎫 Ticket Created')
                    .addFields(
                        { name: 'Number',  value: ticketNumber,        inline: true },
                        { name: 'Type',    value: ticketType,           inline: true },
                        { name: 'Creator', value: `<@${user.id}>`,     inline: true },
                    )
                    .setColor('#2ecc71').setTimestamp()] }).catch(() => {});
            }
        }

        return interaction.editReply({ content: `✅ Your ticket has been created: <#${ticketChannel.id}>` });
    } catch (err) {
        logger.error('TICKET', `Ticket create error (type=${ticketType}): ${err.message}`, err);
        return interaction.editReply({ content: `❌ Failed to create ticket: ${err.message}\nMake sure I have **Manage Channels** permission.` });
    }
}

async function handleTicketClaim(interaction) {
    const channel = interaction.channel;
    const ticketData = await fetchTicketData(channel, interaction.guild.id);

    if (!ticketData) return interaction.reply({ content: '❌ Not a ticket channel.', ephemeral: true });

    const db = getGuildDb(interaction.guild.id);
    const tc = db.get('ticket', {});

    if (!isTicketAdmin(interaction.member, tc)) {
        return interaction.reply({ content: '❌ Only support staff can claim tickets.', ephemeral: true });
    }

    if (ticketData.claimedBy) {
        return interaction.reply({ content: `❌ Ticket already claimed by <@${ticketData.claimedBy}>.`, ephemeral: true });
    }

    ticketData.claimedBy = interaction.user.id;
    ticketData.claimedAt = Date.now();

    await saveTicketData(interaction.guild.id, channel.id, ticketData);

    const user = await interaction.client.users.fetch(ticketData.openerId);
    const embed = buildTicketEmbed(ticketData, user);
    const buttons = buildTicketButtons(ticketData, true, false);

    try {
        const messages = await channel.messages.fetch({ limit: 5 });
        const msg = messages.find(m => m.author.id === interaction.client.user.id);
        if (msg) await msg.edit({ embeds: [embed], components: buttons });
    } catch {}

    return interaction.reply({ content: `🤝 **${interaction.user.username}** claimed this ticket.` });
}

async function handleTicketUnclaim(interaction) {
    const channel = interaction.channel;
    const ticketData = await fetchTicketData(channel, interaction.guild.id);

    if (!ticketData) return interaction.reply({ content: '❌ Not a ticket channel.', ephemeral: true });

    const db = getGuildDb(interaction.guild.id);
    const tc = db.get('ticket', {});

    if (!isTicketAdmin(interaction.member, tc)) {
        return interaction.reply({ content: '❌ Only support staff can unclaim tickets.', ephemeral: true });
    }

    if (!ticketData.claimedBy) {
        return interaction.reply({ content: '❌ Ticket is not claimed.', ephemeral: true });
    }

    ticketData.claimedBy = null;
    ticketData.claimedAt = null;

    await saveTicketData(interaction.guild.id, channel.id, ticketData);

    const user = await interaction.client.users.fetch(ticketData.openerId);
    const embed = buildTicketEmbed(ticketData, user);
    const buttons = buildTicketButtons(ticketData, true, false);

    try {
        const messages = await channel.messages.fetch({ limit: 5 });
        const msg = messages.find(m => m.author.id === interaction.client.user.id);
        if (msg) await msg.edit({ embeds: [embed], components: buttons });
    } catch {}

    return interaction.reply({ content: `👤 **${interaction.user.username}** unclaimed this ticket.` });
}

async function handleTicketClose(interaction) {
    const channel = interaction.channel;
    const ticketData = await fetchTicketData(channel, interaction.guild.id);

    if (!ticketData) return interaction.reply({ content: '❌ Not a ticket channel.', ephemeral: true });

    const db = getGuildDb(interaction.guild.id);
    const tc = db.get('ticket', {});
    const isSupport = isTicketAdmin(interaction.member, tc);
    const isOwner = isTicketOwner(interaction.user.id, ticketData);

    if (!isSupport && !isOwner) {
        return interaction.reply({ content: '❌ You cannot close this ticket.', ephemeral: true });
    }

    ticketData.status = 'closed';
    ticketData.closedAt = Date.now();
    ticketData.closedBy = interaction.user.id;

    try {
        await channel.permissionOverwrites.edit(ticketData.openerId, { ViewChannel: false });
    } catch {}

    await saveTicketData(interaction.guild.id, channel.id, ticketData);

    const panel = tc.ticketPanels && tc.ticketPanels[ticketData.type];
    if (panel && panel.logChannel) {
        const logCh = interaction.guild.channels.cache.get(panel.logChannel);
        if (logCh) {
            const logEmbed = new EmbedBuilder()
                .setTitle('🔒 Ticket Closed')
                .addFields(
                    { name: 'Number', value: ticketData.ticketNumber, inline: true },
                    { name: 'Closed By', value: `<@${interaction.user.id}>`, inline: true }
                )
                .setColor('#e74c3c')
                .setTimestamp();
            await logCh.send({ embeds: [logEmbed] }).catch(() => {});
        }
    }

    const embed = new EmbedBuilder()
        .setTitle('🔒 Ticket Closed')
        .setDescription('This ticket has been closed. Only support staff can see this channel now.')
        .setColor('#e74c3c')
        .setTimestamp();

    const reopenBtn = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ticket_reopen').setEmoji('🔓').setLabel('Reopen').setStyle(ButtonStyle.Success)
    );

    return interaction.reply({ embeds: [embed], components: [reopenBtn] });
}

async function handleTicketReopen(interaction) {
    const channel = interaction.channel;
    const ticketData = await fetchTicketData(channel, interaction.guild.id);

    if (!ticketData) return interaction.reply({ content: '❌ Not a ticket channel.', ephemeral: true });

    const db = getGuildDb(interaction.guild.id);
    const tc = db.get('ticket', {});

    if (!isTicketAdmin(interaction.member, tc)) {
        return interaction.reply({ content: '❌ Only support staff can reopen tickets.', ephemeral: true });
    }

    if (ticketData.status === 'open') {
        return interaction.reply({ content: '❌ Ticket is already open.', ephemeral: true });
    }

    ticketData.status = 'open';
    ticketData.closedAt = null;
    ticketData.closedBy = null;

    try {
        await channel.permissionOverwrites.edit(ticketData.openerId, { ViewChannel: true });
    } catch {}

    await saveTicketData(interaction.guild.id, channel.id, ticketData);

    const user = await interaction.client.users.fetch(ticketData.openerId);
    const embed = buildTicketEmbed(ticketData, user);
    const buttons = buildTicketButtons(ticketData, true, true);

    return interaction.reply({ content: `🔓 **${interaction.user.username}** reopened this ticket.`, embeds: [embed], components: buttons });
}

async function handleTicketDelete(interaction) {
    const channel = interaction.channel;
    const ticketData = await fetchTicketData(channel, interaction.guild.id);

    if (!ticketData) return interaction.reply({ content: '❌ Not a ticket channel.', ephemeral: true });

    const db = getGuildDb(interaction.guild.id);
    const tc = db.get('ticket', {});

    if (!isTicketAdmin(interaction.member, tc)) {
        return interaction.reply({ content: '❌ Only support staff can delete tickets.', ephemeral: true });
    }

    const panel = tc.ticketPanels && tc.ticketPanels[ticketData.type];

    if (panel && panel.logChannel) {
        const logCh = interaction.guild.channels.cache.get(panel.logChannel);
        if (logCh) {
            const logEmbed = new EmbedBuilder()
                .setTitle('🗑️ Ticket Deleted')
                .addFields(
                    { name: 'Number', value: ticketData.ticketNumber, inline: true },
                    { name: 'Deleted By', value: `<@${interaction.user.id}>`, inline: true }
                )
                .setColor('#e67e22')
                .setTimestamp();
            await logCh.send({ embeds: [logEmbed] }).catch(() => {});
        }
    }

    await deleteTicketData(interaction.guild.id, channel.id);
    await interaction.reply({ content: '🗑️ Deleting ticket...' });

    setTimeout(async () => {
        try {
            await channel.delete();
        } catch (err) {
            logger.error('TICKET', 'Failed to delete channel', err);
        }
    }, 1500);
}

// ══════════════════════════════════════════════════════════
//  TRANSCRIPT GENERATION
// ══════════════════════════════════════════════════════════

async function generateTranscript(channel, ticketData) {
    try {
        const messages = await channel.messages.fetch({ limit: 100 });
        const sortedMessages = Array.from(messages.values()).reverse();

        let html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Transcript - Ticket #${ticketData.ticketNumber}</title>
    <style>
        body { font-family: Arial, sans-serif; background: #36393f; color: #dcddde; margin: 0; padding: 20px; }
        .container { max-width: 800px; margin: 0 auto; background: #2f3136; border-radius: 8px; padding: 20px; }
        .header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #202225; padding-bottom: 20px; }
        .header h1 { margin: 0; color: #fff; }
        .header p { margin: 5px 0; color: #b0bcc0; }
        .message { margin: 15px 0; padding: 10px; background: #36393f; border-left: 3px solid #7289da; }
        .message-header { display: flex; align-items: center; margin-bottom: 8px; }
        .avatar { width: 36px; height: 36px; border-radius: 50%; margin-right: 10px; }
        .username { font-weight: bold; color: #fff; margin-right: 10px; }
        .timestamp { color: #72767d; font-size: 12px; }
        .message-content { margin: 8px 0; }
        .embed { background: #2c2f33; border-left: 4px solid #7289da; padding: 10px; margin: 8px 0; }
        .embed-title { font-weight: bold; color: #fff; }
        .embed-description { color: #dcddde; margin-top: 5px; }
        .image { max-width: 100%; height: auto; margin: 8px 0; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Ticket #${ticketData.ticketNumber}</h1>
            <p>Type: ${ticketData.type}</p>
            <p>Opened: ${new Date(ticketData.createdAt).toLocaleString()}</p>
            <p>Status: ${ticketData.status.toUpperCase()}</p>
        </div>`;

        for (const msg of sortedMessages) {
            const timestamp = new Date(msg.createdTimestamp).toLocaleTimeString();
            html += `
        <div class="message">
            <div class="message-header">
                <img src="${msg.author.displayAvatarURL()}" alt="${msg.author.username}" class="avatar">
                <span class="username">${msg.author.username}</span>
                <span class="timestamp">${timestamp}</span>
            </div>
            <div class="message-content">${msg.content || '*(No text content)*'}</div>`;

            if (msg.embeds.length > 0) {
                for (const embed of msg.embeds) {
                    html += `<div class="embed">`;
                    if (embed.title) html += `<div class="embed-title">${embed.title}</div>`;
                    if (embed.description) html += `<div class="embed-description">${embed.description}</div>`;
                    html += `</div>`;
                }
            }

            if (msg.attachments.size > 0) {
                for (const [, attachment] of msg.attachments) {
                    if (attachment.contentType?.startsWith('image/')) {
                        html += `<img src="${attachment.url}" alt="image" class="image">`;
                    } else {
                        html += `<p><a href="${attachment.url}">${attachment.name}</a></p>`;
                    }
                }
            }

            html += `</div>`;
        }

        html += `
    </div>
</body>
</html>`;

        return html;
    } catch (err) {
        logger.error('TICKET', 'Transcript generation error', err);
        return null;
    }
}

async function handleTicketTranscript(interaction) {
    const channel = interaction.channel;
    const ticketData = await fetchTicketData(channel, interaction.guild.id);

    if (!ticketData) return interaction.reply({ content: '❌ Not a ticket channel.', ephemeral: true });

    const db = getGuildDb(interaction.guild.id);
    const tc = db.get('ticket', {});

    if (!isTicketAdmin(interaction.member, tc)) {
        return interaction.reply({ content: '❌ Only support staff can generate transcripts.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    try {
        const html = await generateTranscript(channel, ticketData);

        if (!html) return interaction.editReply('❌ Failed to generate transcript.');

        const buffer = Buffer.from(html, 'utf-8');
        const filename = `ticket-${ticketData.ticketNumber}-${Date.now()}.html`;

        return interaction.editReply({
            content: '📄 Transcript generated:',
            files: [{ attachment: buffer, name: filename }]
        });
    } catch (err) {
        logger.error('TICKET', 'Transcript error', err);
        return interaction.editReply('❌ Failed to generate transcript.');
    }
}

// ══════════════════════════════════════════════════════════
//  BLACKLIST MANAGEMENT
// ══════════════════════════════════════════════════════════

async function handleBlacklist(message, args) {
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return message.reply('❌ Only administrators can manage blacklist.');
    }

    const db = getGuildDb(message.guild.id);
    const tc = db.get('ticket', {});

    if (!tc.setupComplete) return message.reply('❌ Ticket system not set up.');

    const action = args[0];
    const target = message.mentions.users.first();
    const reason = args.slice(2).join(' ') || 'No reason provided';

    const blacklist = db.get('ticketBlacklist', []);

    if (action === 'add') {
        if (!target) return message.reply('❌ Mention a user.');
        const entry = {
            userId: target.id,
            reason,
            addedAt: Date.now(),
            addedBy: message.author.id,
            expiresAt: null
        };
        blacklist.push(entry);
        db.set('ticketBlacklist', blacklist);
        return message.reply(`✅ Blacklisted <@${target.id}> from creating tickets.`);
    }

    if (action === 'remove') {
        if (!target) return message.reply('❌ Mention a user.');
        const filtered = blacklist.filter(e => e.userId !== target.id);
        db.set('ticketBlacklist', filtered);
        return message.reply(`✅ Removed <@${target.id}> from blacklist.`);
    }

    if (action === 'list') {
        if (blacklist.length === 0) return message.reply('❌ No blacklisted users.');
        const embed = new EmbedBuilder()
            .setTitle('🚫 Ticket Blacklist')
            .setDescription(blacklist.map(e => `<@${e.userId}> - ${e.reason}`).join('\n'))
            .setColor('#e74c3c');
        return message.reply({ embeds: [embed] });
    }

    return message.reply('❌ Usage: `.ticket blacklist add/remove/list @user [reason]`');
}

// ══════════════════════════════════════════════════════════
//  TICKET STATISTICS
// ══════════════════════════════════════════════════════════

async function handleTicketStats(message) {
    const db = getGuildDb(message.guild.id);
    const tc = db.get('ticket', {});
    const tickets = db.get('tickets', {});  // tickets stored at top-level key, not inside tc

    const stats = {
        opened: Object.values(tickets).length,
        closed: Object.values(tickets).filter(t => t.status === 'closed').length,
        open: Object.values(tickets).filter(t => t.status === 'open').length
    };

    const embed = new EmbedBuilder()
        .setTitle('📊 Ticket Statistics')
        .addFields(
            { name: 'Total', value: stats.opened.toString(), inline: true },
            { name: 'Open', value: stats.open.toString(), inline: true },
            { name: 'Closed', value: stats.closed.toString(), inline: true }
        )
        .setColor('#5865F2')
        .setTimestamp();

    return message.reply({ embeds: [embed] });
}

// ══════════════════════════════════════════════════════════
//  BUTTON HANDLER
// ══════════════════════════════════════════════════════════

async function handleTicketButton(interaction) {
    const id = interaction.customId;

    if (id.startsWith('ticket_type_')) {
        const ticketType = id.replace('ticket_type_', '');
        return handleTicketCreate(interaction, ticketType);
    }

    if (id === 'ticket_claim') return handleTicketClaim(interaction);
    if (id === 'ticket_unclaim') return handleTicketUnclaim(interaction);
    if (id === 'ticket_close') return handleTicketClose(interaction);
    if (id === 'ticket_reopen') return handleTicketReopen(interaction);
    if (id === 'ticket_delete') return handleTicketDelete(interaction);
    if (id === 'ticket_transcript') return handleTicketTranscript(interaction);
}

// ══════════════════════════════════════════════════════════
//  MAIN TICKET COMMAND HANDLER
// ══════════════════════════════════════════════════════════

async function handleTicketCommand(message, args) {
    const subcmd = args[0];

    if (!subcmd || subcmd === 'help') {
        const embed = new EmbedBuilder()
            .setTitle('🎫 Ticket Commands')
            .addFields(
                { name: '.ticket setup', value: 'Setup the ticket system (admin only)', inline: false },
                { name: '.ticket support add <@role>', value: 'Add support role', inline: false },
                { name: '.ticket support remove <@role>', value: 'Remove support role', inline: false },
                { name: '.ticket support list', value: 'List support roles', inline: false },
                { name: '.ticket blacklist add <@user> [reason]', value: 'Blacklist user from tickets', inline: false },
                { name: '.ticket blacklist remove <@user>', value: 'Remove from blacklist', inline: false },
                { name: '.ticket blacklist list', value: 'View blacklist', inline: false },
                { name: '.ticket stats', value: 'View ticket statistics', inline: false }
            )
            .setColor('#5865F2');
        return message.reply({ embeds: [embed] });
    }

    if (subcmd === 'setup') return handleTicketSetup(message);
    if (subcmd === 'support') return handleSupportRole(message, args.slice(1));
    if (subcmd === 'blacklist') return handleBlacklist(message, args.slice(1));
    if (subcmd === 'stats') return handleTicketStats(message);

    return message.reply('❌ Usage: `.ticket setup|support|blacklist|stats` or `.ticket help`');
}

// Deprecated exports for backward compatibility
async function sendOrUpdateVerifyEmbed() {}
async function handleTicketSupport() {}

module.exports = {
    handleTicketCommand,
    handleTicketCreate,
    handleTicketButton,
    handleTicketSetup,
    sendOrUpdateVerifyEmbed,
    handleTicketSupport
};
