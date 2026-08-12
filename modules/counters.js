const { EmbedBuilder, ChannelType } = require('discord.js');

const CHANNEL_TYPES = {
    voice:   ChannelType.GuildVoice,
    text:    ChannelType.GuildText,
    category: ChannelType.GuildCategory,
    announce: ChannelType.GuildAnnouncement,
    stage:   ChannelType.GuildStageVoice,
};

const COUNTER_OPTIONS = {
    members:              { name: 'Members',            emoji: '👥', format: (g) => g.memberCount.toString() },
    users_only:           { name: 'Users',              emoji: '👤', format: (g) => g.members.cache.filter(m => !m.user.bot).size.toString() },
    bots_only:            { name: 'Bots',               emoji: '🤖', format: (g) => g.members.cache.filter(m => m.user.bot).size.toString() },
    pending_members:      { name: 'Pending',            emoji: '⏳', format: (g) => g.members.cache.filter(m => m.pending).size.toString() },
    all_channels:         { name: 'Channels',           emoji: '📁', format: (g) => g.channels.cache.size.toString() },
    text_channels:        { name: 'Text Channels',      emoji: '📝', format: (g) => g.channels.cache.filter(c => c.type === ChannelType.GuildText).size.toString() },
    voice_channels:       { name: 'Voice Channels',     emoji: '🔊', format: (g) => g.channels.cache.filter(c => c.type === ChannelType.GuildVoice).size.toString() },
    categories:           { name: 'Categories',         emoji: '📂', format: (g) => g.channels.cache.filter(c => c.type === ChannelType.GuildCategory).size.toString() },
    announcement_channels:{ name: 'Announcements',      emoji: '📢', format: (g) => g.channels.cache.filter(c => c.type === ChannelType.GuildAnnouncement).size.toString() },
    staging_channels:     { name: 'Stage Channels',     emoji: '🎭', format: (g) => g.channels.cache.filter(c => c.type === ChannelType.GuildStageVoice).size.toString() },
    boosts:               { name: 'Boosts',             emoji: '💎', format: (g) => (g.premiumSubscriptionCount || 0).toString() },
    booster_count:        { name: 'Boosters',           emoji: '💠', format: (g) => g.members.cache.filter(m => m.premiumSince).size.toString() },
    unix:                 { name: 'Unix Timestamp',     emoji: '⏰', format: () => Math.floor(Date.now() / 1000).toString() },
};

// Map: guildId -> Map(channelId -> optionKey)
const activeCounters = new Map();

function getGuildCounters(guildId) {
    if (!activeCounters.has(guildId)) activeCounters.set(guildId, new Map());
    return activeCounters.get(guildId);
}

async function updateCounter(guild, channelId, optionKey) {
    const option = COUNTER_OPTIONS[optionKey];
    if (!option) return;
    const channel = guild.channels.cache.get(channelId);
    if (!channel) return;
    const value = option.format(guild);
    const newName = `${option.emoji} ${option.name}: ${value}`;
    if (channel.name !== newName) {
        try { await channel.setName(newName); } catch {}
    }
}

async function updateAllCounters(guild) {
    const counters = getGuildCounters(guild.id);
    for (const [channelId, optionKey] of counters) {
        await updateCounter(guild, channelId, optionKey);
    }
}

async function handleCounterCommand(message, args) {
    const { success: mkSuccess, error: mkError, info: mkInfo } = require('../utils/embeds');
    const sub = args[0]?.toLowerCase();

    if (!message.member.permissions.has('ManageChannels')) {
        return message.reply({ embeds: [mkError('Permission Denied', 'You need the **Manage Channels** permission.')] });
    }

    // ── counter (no args) ──
    if (!sub) {
        const options = Object.entries(COUNTER_OPTIONS).map(([k, v]) => `• **${k}** — ${v.emoji} ${v.name}`).join('\n');
        const types = Object.keys(CHANNEL_TYPES).map(t => `• **${t}**`).join('\n');
        return message.reply({ embeds: [mkInfo('Counter System',
            `**Options:**\n${options}\n\n**Channel Types:**\n${types}\n\nUse \`,counter add <option> <type>\` to create one.`
        )] });
    }

    // ── counter add <option> <type> ──
    if (sub === 'add') {
        const optionKey = args[1]?.toLowerCase();
        const typeKey = args[2]?.toLowerCase();

        if (!optionKey || !COUNTER_OPTIONS[optionKey]) {
            return message.reply({ embeds: [mkError('Invalid Option', `Available: ${Object.keys(COUNTER_OPTIONS).join(', ')}`)] });
        }
        if (!typeKey || !CHANNEL_TYPES[typeKey]) {
            return message.reply({ embeds: [mkError('Invalid Type', `Available types: ${Object.keys(CHANNEL_TYPES).join(', ')}`)] });
        }

        const option = COUNTER_OPTIONS[optionKey];
        const guild = message.guild;
        const initialValue = option.format(guild);
        const channelName = `${option.emoji} ${option.name}: ${initialValue}`;

        try {
            const channel = await guild.channels.create({
                name: channelName,
                type: CHANNEL_TYPES[typeKey],
            });
            const counters = getGuildCounters(guild.id);
            counters.set(channel.id, optionKey);
            return message.reply({ embeds: [mkSuccess('Counter Created', `Created **${option.name}** counter as a **${typeKey}** channel.`)] });
        } catch (err) {
            return message.reply({ embeds: [mkError('Failed', `Could not create channel: ${err.message}`)] });
        }
    }

    // ── counter set #channel <option> ──
    if (sub === 'set') {
        const channel = message.mentions.channels.first();
        const optionKey = args[2]?.toLowerCase();

        if (!channel) return message.reply({ embeds: [mkError('Missing Channel', 'Mention a channel: `,counter set #channel <option>`')] });
        if (!optionKey || !COUNTER_OPTIONS[optionKey]) {
            return message.reply({ embeds: [mkError('Invalid Option', `Available: ${Object.keys(COUNTER_OPTIONS).join(', ')}`)] });
        }

        const counters = getGuildCounters(message.guild.id);
        counters.set(channel.id, optionKey);
        await updateCounter(message.guild, channel.id, optionKey);
        return message.reply({ embeds: [mkSuccess('Counter Updated', `Set ${channel} to display **${COUNTER_OPTIONS[optionKey].name}**.`)] });
    }

    // ── counter remove #channel ──
    if (sub === 'remove') {
        const channel = message.mentions.channels.first();
        if (!channel) return message.reply({ embeds: [mkError('Missing Channel', 'Mention a channel: `,counter remove #channel`')] });

        const counters = getGuildCounters(message.guild.id);
        if (!counters.has(channel.id)) return message.reply({ embeds: [mkError('Not Found', 'That channel is not a counter.')] });
        counters.delete(channel.id);
        return message.reply({ embeds: [mkSuccess('Counter Removed', `${channel} is no longer set as a counter channel.`)] });
    }

    // ── counter list ──
    if (sub === 'list') {
        const counters = getGuildCounters(message.guild.id);
        if (!counters.size) return message.reply({ embeds: [mkInfo('Counters', 'No counters configured in this server.')] });
        const lines = [];
        for (const [chId, optionKey] of counters) {
            const opt = COUNTER_OPTIONS[optionKey];
            lines.push(`• <#${chId}> — ${opt.emoji} ${opt.name}`);
        }
        return message.reply({ embeds: [mkInfo('Counters', lines.join('\n'))] });
    }

    return message.reply({ embeds: [mkInfo('Counter Commands',
        '`,counter` — view options\n' +
        '`,counter add <option> <type>` — create counter\n' +
        '`,counter set #channel <option>` — change counter\n' +
        '`,counter remove #channel` — remove counter\n' +
        '`,counter list` — list all counters'
    )] });
}

module.exports = { handleCounterCommand, updateAllCounters, getGuildCounters };