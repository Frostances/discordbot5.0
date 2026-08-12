const { EmbedBuilder } = require('discord.js');

// ══════════════════════════════════════════════════════════
// SNIPE DATA STORES
// ══════════════════════════════════════════════════════════
const deletedMessages = new Map();     // channelId -> [{ author, content, attachments, timestamp, avatar }]
const editedMessages = new Map();      // channelId -> { author, before, after, timestamp, avatar }
const removedReactions = new Map();    // channelId -> [{ author, emoji, timestamp, avatar }]
const reactionHistory = new Map();     // messageId -> [{ emoji, userId, action, timestamp }]

const MAX_DELETED = 2;  // Only store last 2 deleted messages

// ══════════════════════════════════════════════════════════
// TRACKERS
// ══════════════════════════════════════════════════════════
function trackDelete(message) {
    if (!message.guild || message.author?.bot) return;
    const list = deletedMessages.get(message.channel.id) || [];
    list.unshift({
        author: message.author.tag,
        authorId: message.author.id,
        content: message.content || null,
        attachments: message.attachments.map(a => a.url),
        timestamp: Date.now(),
        avatar: message.author.displayAvatarURL(),
    });
    if (list.length > MAX_DELETED) list.length = MAX_DELETED;
    deletedMessages.set(message.channel.id, list);
}

function trackEdit(oldMsg, newMsg) {
    if (!oldMsg.guild || oldMsg.author?.bot || oldMsg.content === newMsg.content) return;
    editedMessages.set(oldMsg.channel.id, {
        author: oldMsg.author.tag,
        authorId: oldMsg.author.id,
        before: oldMsg.content,
        after: newMsg.content,
        timestamp: Date.now(),
        avatar: oldMsg.author.displayAvatarURL(),
    });
}

function trackReactionRemove(reaction, user) {
    if (!reaction.message.guild || user.bot) return;
    const list = removedReactions.get(reaction.message.channel.id) || [];
    list.unshift({
        author: user.tag,
        authorId: user.id,
        emoji: reaction.emoji.toString(),
        timestamp: Date.now(),
        avatar: user.displayAvatarURL(),
    });
    if (list.length > 5) list.length = 5;
    removedReactions.set(reaction.message.channel.id, list);

    // Track for reaction history
    const msgId = reaction.message.id;
    const hist = reactionHistory.get(msgId) || [];
    hist.push({ emoji: reaction.emoji.toString(), userId: user.id, action: 'removed', timestamp: Date.now() });
    reactionHistory.set(msgId, hist);
}

function trackReactionAdd(reaction, user) {
    if (!reaction.message.guild || user.bot) return;
    const msgId = reaction.message.id;
    const hist = reactionHistory.get(msgId) || [];
    hist.push({ emoji: reaction.emoji.toString(), userId: user.id, action: 'added', timestamp: Date.now() });
    reactionHistory.set(msgId, hist);
}

// ══════════════════════════════════════════════════════════
// COMMAND HANDLERS
// ══════════════════════════════════════════════════════════

function formatTimeAgo(ts) {
    const secs = Math.floor((Date.now() - ts) / 1000);
    if (secs < 60) return `${secs} second${secs !== 1 ? 's' : ''} ago`;
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins} minute${mins !== 1 ? 's' : ''} ago`;
    const hrs = Math.floor(mins / 60);
    return `${hrs} hour${hrs !== 1 ? 's' : ''} ago`;
}

async function handleSnipe(message, args) {
    const { error: mkError } = require('../utils/embeds');
    const index = parseInt(args[0]) || 1;
    if (index < 1 || index > 2) return message.reply({ embeds: [mkError('Invalid Index', 'Use `,snipe` or `,snipe 2`')] });

    const list = deletedMessages.get(message.channel.id);
    if (!list || !list[index - 1]) return message.reply({ embeds: [mkError('Nothing to snipe', 'No deleted messages found in this channel.')] });

    const data = list[index - 1];
    const embed = new EmbedBuilder()
        .setAuthor({ name: data.author, iconURL: data.avatar })
        .setDescription(data.content || '*No content*')
        .setFooter({ text: `Deleted ${formatTimeAgo(data.timestamp)} • ${index}/${list.length} message${list.length !== 1 ? 's' : ''}` })
        .setColor('#5865F2');

    if (data.attachments.length > 0) {
        embed.setImage(data.attachments[0]);
        if (data.attachments.length > 1) {
            embed.addFields({ name: 'Attachments', value: data.attachments.slice(1).join('\n').slice(0, 1024) });
        }
    }

    return message.reply({ embeds: [embed] });
}

async function handleEditSnipe(message) {
    const { error: mkError } = require('../utils/embeds');
    const data = editedMessages.get(message.channel.id);
    if (!data) return message.reply({ embeds: [mkError('Nothing to snipe', 'No edited messages found in this channel.')] });

    const embed = new EmbedBuilder()
        .setAuthor({ name: data.author, iconURL: data.avatar })
        .addFields(
            { name: 'Before', value: data.before.slice(0, 1024) || '*Empty*' },
            { name: 'After', value: data.after.slice(0, 1024) || '*Empty*' }
        )
        .setFooter({ text: `Edited ${formatTimeAgo(data.timestamp)}` })
        .setColor('#5865F2');

    return message.reply({ embeds: [embed] });
}

async function handleReactionSnipe(message) {
    const { error: mkError } = require('../utils/embeds');
    const list = removedReactions.get(message.channel.id);
    if (!list || !list[0]) return message.reply({ embeds: [mkError('Nothing to snipe', 'No removed reactions found in this channel.')] });

    const data = list[0];
    const embed = new EmbedBuilder()
        .setAuthor({ name: data.author, iconURL: data.avatar })
        .setDescription(data.emoji)
        .setFooter({ text: `Unreacted ${formatTimeAgo(data.timestamp)} • 1/${list.length} reaction${list.length !== 1 ? 's' : ''}` })
        .setColor('#5865F2');

    return message.reply({ embeds: [embed] });
}

async function handleReactionHistory(message, args) {
    const { error: mkError, info: mkInfo } = require('../utils/embeds');
    const link = args[0];
    if (!link) return message.reply({ embeds: [mkError('Missing Link', 'Usage: `,reactionhistory <message link>`')] });

    const match = link.match(/discord\.com\/channels\/(\d+)\/(\d+)\/(\d+)/);
    if (!match) return message.reply({ embeds: [mkError('Invalid Link', 'Provide a valid Discord message link.')] });

    const [, guildId, channelId, messageId] = match;
    if (guildId !== message.guild.id) return message.reply({ embeds: [mkError('Wrong Server', 'That message is not in this server.')] });

    const hist = reactionHistory.get(messageId);
    if (!hist || !hist.length) return message.reply({ embeds: [mkInfo('No History', 'No reaction history found for that message.')] });

    const lines = hist.map(h => {
        const time = formatTimeAgo(h.timestamp);
        return `${h.emoji} <@${h.userId}> — ${h.action} (${time})`;
    }).reverse().slice(0, 20);

    return message.reply({ embeds: [new EmbedBuilder()
        .setTitle('Reaction History')
        .setDescription(lines.join('\n'))
        .setColor('#5865F2')
        .setFooter({ text: `${hist.length} total entries` })
    ]});
}

async function handleClearSnipe(message) {
    const { error: mkError, success: mkSuccess } = require('../utils/embeds');
    if (!message.member.permissions.has('ManageMessages')) {
        return message.reply({ embeds: [mkError('Permission Denied', 'You need **Manage Messages** permission.')] });
    }

    deletedMessages.delete(message.channel.id);
    editedMessages.delete(message.channel.id);
    removedReactions.delete(message.channel.id);

    return message.reply({ embeds: [mkSuccess('Cleared', 'Snipe data cleared for this channel.')] });
}

module.exports = {
    trackDelete,
    trackEdit,
    trackReactionRemove,
    trackReactionAdd,
    handleSnipe,
    handleEditSnipe,
    handleReactionSnipe,
    handleReactionHistory,
    handleClearSnipe,
};