const { PermissionsBitField } = require('discord.js');
const { getGuildDb } = require('./database');
const { isAdmin } = require('./helpers');
const { ok, err, info, COLORS } = require('../utils/embeds');

/**
 * Check if the message author has permission to manage reaction roles.
 */
function hasPermission(message) {
    return isAdmin(message.member) || message.member.permissions.has(PermissionsBitField.Flags.ManageRoles);
}

/**
 * Parse a Discord message link into { guildId, channelId, messageId }.
 */
function parseMessageLink(link) {
    const match = link.match(/discord\.com\/channels\/(\d+)\/(\d+)\/(\d+)/);
    if (!match) return null;
    return { guildId: match[1], channelId: match[2], messageId: match[3] };
}

/**
 * Normalise an emoji string for comparison.
 * Custom emoji: <:name:id> or <a:name:id> → "name:id"
 * Unicode: returned as-is
 */
function normaliseEmoji(emoji) {
    if (!emoji) return '';
    const match = emoji.match(/^<a?:(\w+):(\d+)>$/);
    if (match) return `${match[1]}:${match[2]}`;
    return emoji;
}

/**
 * Compare a reaction's emoji to a stored emoji string.
 */
function emojiMatches(reactionEmoji, storedEmoji) {
    const stored = normaliseEmoji(storedEmoji);
    // Custom emoji
    if (reactionEmoji.id) {
        return stored === `${reactionEmoji.name}:${reactionEmoji.id}`;
    }
    // Unicode
    return reactionEmoji.name === stored || reactionEmoji.toString() === stored;
}

/**
 * Handle the reactionrole command and its subcommands.
 */
async function handleReactionRoleCommand(message, args) {
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
        return addReactionRole(message, args.slice(1));
    }

    if (sub === 'remove') {
        return removeReactionRole(message, args.slice(1));
    }

    if (sub === 'removeall') {
        return removeAllReactionRoles(message, args.slice(1));
    }

    if (sub === 'reset') {
        return resetAll(message);
    }

    if (sub === 'restore') {
        return setRestore(message, args.slice(1));
    }

    return showOverview(message);
}

async function showOverview(message) {
    const db = getGuildDb(message.guild.id);
    const restore = db.get('reactionRoleRestore', false);

    const embed = info('💬 Reaction Roles', [
        'Assign roles to members when they react to messages.',
        '',
        '**Commands:**',
        '`,reactionrole add <link> <emoji> @role` — add a reaction role',
        '`,reactionrole remove <link> <emoji>` — remove a reaction role',
        '`,reactionrole removeall <link>` — remove all reaction roles from a message',
        '`,reactionrole reset` — remove all reaction roles in the server',
        '`,reactionrole restore on|off` — toggle role restore on rejoin',
        '`,reactionrole list` — list all reaction roles',
        '',
        `**Restore on rejoin:** ${restore ? '✅ Enabled' : '❌ Disabled'}`,
    ].join('\n'));

    return message.reply({ embeds: [embed] });
}

async function showList(message) {
    const db = getGuildDb(message.guild.id);
    const reactionRoles = db.get('reactionRoles', {});
    const entries = Object.entries(reactionRoles);

    if (!entries.length) {
        return message.reply({
            embeds: [info('Reaction Roles', 'No reaction roles configured.\n\nUse `,reactionrole add` to get started.')]
        });
    }

    const lines = [];
    for (const [msgId, reactions] of entries) {
        lines.push(`**Message ID:** \`${msgId}\``);
        reactions.forEach((rr, i) => {
            const role = message.guild.roles.cache.get(rr.roleId);
            const roleName = role ? `<@&${rr.roleId}>` : `~~${rr.roleId}~~ (deleted)`;
            lines.push(`  ${i + 1}. ${rr.emoji} → ${roleName}`);
        });
        lines.push('');
    }

    return message.reply({
        embeds: [info('💬 Reaction Roles', lines.join('\n'))
            .setFooter({ text: `${entries.length} message(s) configured • Kaido` })]
    });
}

async function addReactionRole(message, args) {
    // .reactionrole add <message link> <emoji> @role
    if (args.length < 3) {
        return message.reply(err('Usage: `,reactionrole add <message link> <emoji> @role`'));
    }

    const parsed = parseMessageLink(args[0]);
    if (!parsed) {
        return message.reply(err('Invalid message link. Use a Discord message link like:\n`https://discord.com/channels/GUILD/CHANNEL/MESSAGE`'));
    }

    if (parsed.guildId !== message.guild.id) {
        return message.reply(err('That message link is from a different server.'));
    }

    const emojiRaw = args[1];
    const role = message.mentions.roles.first() || message.guild.roles.cache.get(args[2]?.replace(/\D/g, ''));

    if (!role) {
        return message.reply(err('Please mention a valid role.\n\nUsage: `,reactionrole add <link> <emoji> @role`'));
    }

    // Check the bot can manage the role
    const botMember = message.guild.members.me;
    if (role.position >= botMember.roles.highest.position) {
        return message.reply(err('I cannot manage that role as it is above or equal to my highest role.'));
    }

    // Fetch the target message
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
    const reactionRoles = db.get('reactionRoles', {});
    if (!reactionRoles[parsed.messageId]) reactionRoles[parsed.messageId] = [];

    // Check for duplicate emoji
    const normalised = normaliseEmoji(emojiRaw);
    const duplicate = reactionRoles[parsed.messageId].some(rr => normaliseEmoji(rr.emoji) === normalised);
    if (duplicate) {
        return message.reply(err(`That emoji is already configured for that message.`));
    }

    reactionRoles[parsed.messageId].push({ emoji: emojiRaw, roleId: role.id });
    db.set('reactionRoles', reactionRoles);

    // React to the message with the emoji
    try {
        await targetMsg.react(emojiRaw);
    } catch (e) {
        // Roll back
        reactionRoles[parsed.messageId].pop();
        if (!reactionRoles[parsed.messageId].length) delete reactionRoles[parsed.messageId];
        db.set('reactionRoles', reactionRoles);
        return message.reply(err(`Failed to react to the message: ${e.message}\nMake sure I have access to the channel and the emoji is valid.`));
    }

    return message.reply(ok(`${emojiRaw} will now assign <@&${role.id}> when reacted on that message.`, 'Reaction Role Added'));
}

async function removeReactionRole(message, args) {
    if (args.length < 2) {
        return message.reply(err('Usage: `,reactionrole remove <message link> <emoji>`'));
    }

    const parsed = parseMessageLink(args[0]);
    if (!parsed) return message.reply(err('Invalid message link.'));
    if (parsed.guildId !== message.guild.id) return message.reply(err('That message is from a different server.'));

    const emojiRaw = args[1];
    const normalised = normaliseEmoji(emojiRaw);

    const db = getGuildDb(message.guild.id);
    const reactionRoles = db.get('reactionRoles', {});
    const reactions = reactionRoles[parsed.messageId];

    if (!reactions || !reactions.length) {
        return message.reply(err('No reaction roles found for that message.'));
    }

    const idx = reactions.findIndex(rr => normaliseEmoji(rr.emoji) === normalised);
    if (idx === -1) {
        return message.reply(err(`No reaction role for ${emojiRaw} found on that message.`));
    }

    reactions.splice(idx, 1);
    if (reactions.length === 0) {
        delete reactionRoles[parsed.messageId];
    } else {
        reactionRoles[parsed.messageId] = reactions;
    }
    db.set('reactionRoles', reactionRoles);

    // Try to remove the bot's reaction
    try {
        const channel = message.guild.channels.cache.get(parsed.channelId);
        if (channel) {
            const targetMsg = await channel.messages.fetch(parsed.messageId);
            const reaction = targetMsg.reactions.cache.find(r => {
                if (r.emoji.id) return normaliseEmoji(`<:${r.emoji.name}:${r.emoji.id}>`) === normalised;
                return r.emoji.name === normalised || r.emoji.toString() === normalised;
            });
            if (reaction) await reaction.users.remove(message.guild.members.me.id);
        }
    } catch {}

    return message.reply(ok(`Reaction role for ${emojiRaw} has been removed.`, 'Reaction Role Removed'));
}

async function removeAllReactionRoles(message, args) {
    if (!args[0]) {
        return message.reply(err('Usage: `,reactionrole removeall <message link>`'));
    }

    const parsed = parseMessageLink(args[0]);
    if (!parsed) return message.reply(err('Invalid message link.'));
    if (parsed.guildId !== message.guild.id) return message.reply(err('That message is from a different server.'));

    const db = getGuildDb(message.guild.id);
    const reactionRoles = db.get('reactionRoles', {});

    if (!reactionRoles[parsed.messageId] || !reactionRoles[parsed.messageId].length) {
        return message.reply(err('No reaction roles found for that message.'));
    }

    const removed = reactionRoles[parsed.messageId];
    delete reactionRoles[parsed.messageId];
    db.set('reactionRoles', reactionRoles);

    // Try to remove bot's reactions
    try {
        const channel = message.guild.channels.cache.get(parsed.channelId);
        if (channel) {
            const targetMsg = await channel.messages.fetch(parsed.messageId);
            await targetMsg.reactions.removeAll();
        }
    } catch {}

    return message.reply(ok(`Removed all ${removed.length} reaction role(s) from that message.`, 'Reaction Roles Cleared'));
}

async function resetAll(message) {
    const db = getGuildDb(message.guild.id);
    const reactionRoles = db.get('reactionRoles', {});
    const count = Object.keys(reactionRoles).length;
    db.set('reactionRoles', {});
    return message.reply(ok(`Cleared all reaction roles (${count} message(s)).`, 'Reaction Roles Reset'));
}

async function setRestore(message, args) {
    const val = (args[0] || '').toLowerCase();
    if (val !== 'on' && val !== 'off') {
        return message.reply(err('Usage: `,reactionrole restore on|off`'));
    }

    const db = getGuildDb(message.guild.id);
    db.set('reactionRoleRestore', val === 'on');

    return message.reply(ok(
        `Reaction role restore on rejoin is now **${val === 'on' ? 'enabled' : 'disabled'}**.`,
        'Restore Updated'
    ));
}

/**
 * Handle a reaction being added to a message.
 * @param {import('discord.js').MessageReaction} reaction
 * @param {import('discord.js').User} user
 */
async function handleReactionAdd(reaction, user) {
    if (user.bot) return;
    if (!reaction.message.guild) return;

    // Ensure the reaction is fully fetched
    if (reaction.partial) {
        try { await reaction.fetch(); } catch { return; }
    }

    const guild = reaction.message.guild;
    const messageId = reaction.message.id;

    const db = getGuildDb(guild.id);
    const reactionRoles = db.get('reactionRoles', {});
    const reactions = reactionRoles[messageId];
    if (!reactions || !reactions.length) return;

    const entry = reactions.find(rr => emojiMatches(reaction.emoji, rr.emoji));
    if (!entry) return;

    const role = guild.roles.cache.get(entry.roleId);
    if (!role) return;

    try {
        const member = await guild.members.fetch(user.id);
        if (!member.roles.cache.has(role.id)) {
            await member.roles.add(role, 'Reaction role');
        }
    } catch {}
}

/**
 * Handle a reaction being removed from a message.
 * @param {import('discord.js').MessageReaction} reaction
 * @param {import('discord.js').User} user
 */
async function handleReactionRemove(reaction, user) {
    if (user.bot) return;
    if (!reaction.message.guild) return;

    if (reaction.partial) {
        try { await reaction.fetch(); } catch { return; }
    }

    const guild = reaction.message.guild;
    const messageId = reaction.message.id;

    const db = getGuildDb(guild.id);
    const reactionRoles = db.get('reactionRoles', {});
    const reactions = reactionRoles[messageId];
    if (!reactions || !reactions.length) return;

    const entry = reactions.find(rr => emojiMatches(reaction.emoji, rr.emoji));
    if (!entry) return;

    const role = guild.roles.cache.get(entry.roleId);
    if (!role) return;

    try {
        const member = await guild.members.fetch(user.id);
        if (member.roles.cache.has(role.id)) {
            await member.roles.remove(role, 'Reaction role removed');
        }
    } catch {}
}

module.exports = {
    handleReactionRoleCommand,
    handleReactionAdd,
    handleReactionRemove,
};
