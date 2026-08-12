const { PermissionsBitField, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getGuildDb } = require('./database');
const { isAdmin } = require('./helpers');
const { ok, err, info, success, error, COLORS } = require('../utils/embeds');

const STYLE_MAP = {
    blue:    ButtonStyle.Primary,
    green:   ButtonStyle.Success,
    red:     ButtonStyle.Danger,
    grey:    ButtonStyle.Secondary,
    gray:    ButtonStyle.Secondary,
};

/**
 * Check if the message author has permission to manage button roles.
 */
function hasPermission(message) {
    return isAdmin(message.member) || message.member.permissions.has(PermissionsBitField.Flags.ManageRoles);
}

/**
 * Parse a Discord message link into { guildId, channelId, messageId }.
 * Accepts: https://discord.com/channels/GUILDID/CHANNELID/MESSAGEID
 */
function parseMessageLink(link) {
    const match = link.match(/discord\.com\/channels\/(\d+)\/(\d+)\/(\d+)/);
    if (!match) return null;
    return { guildId: match[1], channelId: match[2], messageId: match[3] };
}

/**
 * Rebuild all button components on a message from stored data.
 * @param {import('discord.js').Message} msg - the target Discord message
 * @param {Array<{roleId, style, emoji, label}>} buttons
 */
async function rebuildButtons(msg, messageId, buttons) {
    if (!buttons || buttons.length === 0) {
        await msg.edit({ components: [] });
        return;
    }

    // Discord allows max 5 buttons per row, max 5 rows = 25 buttons
    const rows = [];
    for (let i = 0; i < buttons.length && i < 25; i++) {
        const btn = buttons[i];
        const rowIdx = Math.floor(i / 5);
        if (!rows[rowIdx]) rows[rowIdx] = new ActionRowBuilder();

        const style = STYLE_MAP[btn.style?.toLowerCase()] ?? ButtonStyle.Primary;
        const builder = new ButtonBuilder()
            .setCustomId(`br_${messageId}_${i}`)
            .setStyle(style);

        if (btn.label) builder.setLabel(btn.label);
        if (btn.emoji) builder.setEmoji(btn.emoji);

        rows[rowIdx].addComponents(builder);
    }

    await msg.edit({ components: rows });
}

/**
 * Handle the buttonrole command and its subcommands.
 */
async function handleButtonRoleCommand(message, args) {
    if (!hasPermission(message)) {
        return message.reply(err('You need the **Manage Roles** permission to use this command.'));
    }

    const sub = (args[0] || '').toLowerCase();

    if (!sub) {
        return showOverview(message);
    }

    if (sub === 'list') {
        return showList(message);
    }

    if (sub === 'add') {
        return addButton(message, args.slice(1));
    }

    if (sub === 'remove') {
        return removeButton(message, args.slice(1));
    }

    if (sub === 'removeall') {
        return removeAllButtons(message, args.slice(1));
    }

    if (sub === 'reset') {
        return resetAll(message);
    }

    return showOverview(message);
}

async function showOverview(message) {
    const embed = info('🔘 Button Roles', [
        'Assign or remove roles using buttons on messages.',
        '',
        '**Commands:**',
        '`,buttonrole list` — list all button role setups',
        '`,buttonrole add <link> @role <style> [emoji] <label>` — add a button',
        '`,buttonrole remove <link> <index>` — remove a button by index',
        '`,buttonrole removeall <link>` — remove all buttons from a message',
        '`,buttonrole reset` — remove all button roles in the server',
        '',
        '**Styles:** Blue, Green, Red, Grey',
    ].join('\n'));
    return message.reply({ embeds: [embed] });
}

async function showList(message) {
    const db = getGuildDb(message.guild.id);
    const buttonRoles = db.get('buttonRoles', {});
    const entries = Object.entries(buttonRoles);

    if (!entries.length) {
        return message.reply({
            embeds: [info('Button Roles', 'No button roles configured.\n\nUse `,buttonrole add` to get started.')]
        });
    }

    const lines = [];
    for (const [msgId, buttons] of entries) {
        lines.push(`**Message ID:** \`${msgId}\``);
        buttons.forEach((btn, i) => {
            const role = message.guild.roles.cache.get(btn.roleId);
            const roleName = role ? `<@&${btn.roleId}>` : `~~${btn.roleId}~~ (deleted)`;
            const label = btn.label || '(no label)';
            const emoji = btn.emoji ? `${btn.emoji} ` : '';
            lines.push(`  ${i + 1}. ${emoji}${label} → ${roleName} [${btn.style || 'Blue'}]`);
        });
        lines.push('');
    }

    return message.reply({
        embeds: [info('🔘 Button Roles', lines.join('\n') || 'No entries.')
            .setFooter({ text: `${entries.length} message(s) configured • Kaido` })]
    });
}

async function addButton(message, args) {
    // .buttonrole add <message link> @role <style> [emoji (optional)] <label...>
    if (args.length < 3) {
        return message.reply(err(
            'Usage: `,buttonrole add <message link> @role <style: Blue|Green|Red|Grey> [emoji] <label>`'
        ));
    }

    const linkStr = args[0];
    const parsed = parseMessageLink(linkStr);
    if (!parsed) {
        return message.reply(err('Invalid message link. Use a Discord message link like:\n`https://discord.com/channels/GUILD/CHANNEL/MESSAGE`'));
    }

    if (parsed.guildId !== message.guild.id) {
        return message.reply(err('That message link is from a different server.'));
    }

    // Role (either mention or ID in args[1])
    const role = message.mentions.roles.first() || message.guild.roles.cache.get(args[1].replace(/\D/g, ''));
    if (!role) {
        return message.reply(err('Please mention a valid role.\n\nUsage: `,buttonrole add <link> @role <style> [emoji] <label>`'));
    }

    // Check the bot can manage the role
    const botMember = message.guild.members.me;
    if (role.position >= botMember.roles.highest.position) {
        return message.reply(err('I cannot manage that role as it is above or equal to my highest role.'));
    }

    // style in args[2]
    const styleRaw = (args[2] || 'blue').toLowerCase();
    const style = STYLE_MAP[styleRaw] !== undefined ? styleRaw : 'blue';
    if (STYLE_MAP[styleRaw] === undefined) {
        return message.reply(err(`Invalid style \`${args[2]}\`. Choose from: Blue, Green, Red, Grey.`));
    }

    // args[3..] = optional emoji + label
    let emoji = null;
    let labelParts = args.slice(3);

    // Detect emoji — either custom emoji <:name:id> or unicode
    if (labelParts.length > 0) {
        const emojiPattern = /^(<a?:\w+:\d+>|[\u{1F300}-\u{1FAFF}]|[\u2600-\u27FF][\uFE0F]?)/u;
        const firstPart = labelParts[0];
        if (emojiPattern.test(firstPart)) {
            emoji = firstPart;
            labelParts = labelParts.slice(1);
        }
    }

    const label = labelParts.join(' ').trim();
    if (!label && !emoji) {
        return message.reply(err('Please provide a label (and optionally an emoji) for the button.'));
    }

    // Fetch the target channel and message
    const channel = message.guild.channels.cache.get(parsed.channelId);
    if (!channel) {
        return message.reply(err('Could not find the channel from that message link.'));
    }

    let targetMsg;
    try {
        targetMsg = await channel.messages.fetch(parsed.messageId);
    } catch {
        return message.reply(err('Could not fetch that message. Make sure the link is correct and I have access to that channel.'));
    }

    const db = getGuildDb(message.guild.id);
    const buttonRoles = db.get('buttonRoles', {});
    if (!buttonRoles[parsed.messageId]) buttonRoles[parsed.messageId] = [];

    if (buttonRoles[parsed.messageId].length >= 25) {
        return message.reply(err('A message can have at most 25 buttons.'));
    }

    buttonRoles[parsed.messageId].push({ roleId: role.id, style, emoji, label });
    db.set('buttonRoles', buttonRoles);

    try {
        await rebuildButtons(targetMsg, parsed.messageId, buttonRoles[parsed.messageId]);
    } catch (e) {
        // Roll back the push
        buttonRoles[parsed.messageId].pop();
        db.set('buttonRoles', buttonRoles);
        return message.reply(err(`Failed to edit the message: ${e.message}\nMake sure I sent that message or have permission to edit it.`));
    }

    return message.reply(ok(`Button added to [that message](${linkStr}) for role <@&${role.id}>.`, 'Button Role Added'));
}

async function removeButton(message, args) {
    if (args.length < 2) {
        return message.reply(err('Usage: `,buttonrole remove <message link> <index>`'));
    }

    const parsed = parseMessageLink(args[0]);
    if (!parsed) return message.reply(err('Invalid message link.'));
    if (parsed.guildId !== message.guild.id) return message.reply(err('That message is from a different server.'));

    const index = parseInt(args[1], 10) - 1;
    if (isNaN(index) || index < 0) {
        return message.reply(err('Please provide a valid 1-based index.'));
    }

    const db = getGuildDb(message.guild.id);
    const buttonRoles = db.get('buttonRoles', {});
    const buttons = buttonRoles[parsed.messageId];

    if (!buttons || !buttons.length) {
        return message.reply(err('No button roles found for that message.'));
    }

    if (index >= buttons.length) {
        return message.reply(err(`Index out of range. This message has ${buttons.length} button(s).`));
    }

    buttons.splice(index, 1);
    if (buttons.length === 0) {
        delete buttonRoles[parsed.messageId];
    } else {
        buttonRoles[parsed.messageId] = buttons;
    }
    db.set('buttonRoles', buttonRoles);

    // Try to update the message
    try {
        const channel = message.guild.channels.cache.get(parsed.channelId);
        if (channel) {
            const targetMsg = await channel.messages.fetch(parsed.messageId);
            await rebuildButtons(targetMsg, parsed.messageId, buttons.length ? buttons : []);
        }
    } catch {}

    return message.reply(ok('Button removed successfully.', 'Button Role Removed'));
}

async function removeAllButtons(message, args) {
    if (!args[0]) {
        return message.reply(err('Usage: `,buttonrole removeall <message link>`'));
    }

    const parsed = parseMessageLink(args[0]);
    if (!parsed) return message.reply(err('Invalid message link.'));
    if (parsed.guildId !== message.guild.id) return message.reply(err('That message is from a different server.'));

    const db = getGuildDb(message.guild.id);
    const buttonRoles = db.get('buttonRoles', {});

    if (!buttonRoles[parsed.messageId] || !buttonRoles[parsed.messageId].length) {
        return message.reply(err('No button roles found for that message.'));
    }

    delete buttonRoles[parsed.messageId];
    db.set('buttonRoles', buttonRoles);

    try {
        const channel = message.guild.channels.cache.get(parsed.channelId);
        if (channel) {
            const targetMsg = await channel.messages.fetch(parsed.messageId);
            await targetMsg.edit({ components: [] });
        }
    } catch {}

    return message.reply(ok('All buttons removed from that message.', 'Buttons Cleared'));
}

async function resetAll(message) {
    const db = getGuildDb(message.guild.id);
    const buttonRoles = db.get('buttonRoles', {});
    const entries = Object.entries(buttonRoles);

    db.set('buttonRoles', {});

    // Best-effort: remove buttons from all tracked messages
    for (const [msgId, buttons] of entries) {
        // We need the channelId — since we only store messageId as key, attempt a search
        // The channel info is not stored; skip silent cleanup
        // (guild.channels is cached, but without channelId we can't easily find the message)
    }

    return message.reply(ok(`Cleared all button roles (${entries.length} message(s)).`, 'Button Roles Reset'));
}

/**
 * Handle a button interaction for button roles.
 * customId format: br_MESSAGEID_INDEX
 * @param {import('discord.js').ButtonInteraction} interaction
 */
async function handleButtonRoleInteraction(interaction) {
    if (!interaction.inGuild()) return;

    const parts = interaction.customId.split('_');
    // br_MESSAGEID_INDEX
    if (parts.length < 3 || parts[0] !== 'br') return;

    const messageId = parts[1];
    const index = parseInt(parts[2], 10);

    const db = getGuildDb(interaction.guildId);
    const buttonRoles = db.get('buttonRoles', {});
    const buttons = buttonRoles[messageId];

    if (!buttons || !buttons[index]) {
        return interaction.reply({ content: '❌ This button role no longer exists.', ephemeral: true });
    }

    const { roleId } = buttons[index];
    const role = interaction.guild.roles.cache.get(roleId);

    if (!role) {
        return interaction.reply({ content: '❌ The role for this button no longer exists.', ephemeral: true });
    }

    const member = interaction.member;

    try {
        if (member.roles.cache.has(roleId)) {
            await member.roles.remove(role, 'Button role toggle');
            return interaction.reply({ content: `✅ Removed role **${role.name}**.`, ephemeral: true });
        } else {
            await member.roles.add(role, 'Button role toggle');
            return interaction.reply({ content: `✅ Added role **${role.name}**.`, ephemeral: true });
        }
    } catch (e) {
        return interaction.reply({ content: `❌ Failed to update your role: ${e.message}`, ephemeral: true });
    }
}

module.exports = { handleButtonRoleCommand, handleButtonRoleInteraction };
