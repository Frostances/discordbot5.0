const { EmbedBuilder } = require('discord.js');

// Map: guildId -> Map(channelId -> { message, intervalMs, activityRequired, timer })
const activeTimers = new Map();

function parseInterval(str) {
    if (!str) return null;
    const match = str.toLowerCase().trim().match(/^(\d+)([smhd])$/);
    if (!match) return null;
    const [, num, unit] = match;
    const n = parseInt(num);
    switch (unit) {
        case 's': return n * 1000;
        case 'm': return n * 60 * 1000;
        case 'h': return n * 60 * 60 * 1000;
        case 'd': return n * 24 * 60 * 60 * 1000;
        default: return null;
    }
}

function formatInterval(ms) {
    const secs = Math.floor(ms / 1000);
    if (secs < 60) return `${secs}s`;
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    const days = Math.floor(hrs / 24);
    return `${days}d`;
}

function getGuildTimers(guildId) {
    if (!activeTimers.has(guildId)) activeTimers.set(guildId, new Map());
    return activeTimers.get(guildId);
}

function startTimer(guildId, channelId, message, intervalMs, activityRequired = false) {
    const guildMap = getGuildTimers(guildId);
    // Stop existing timer for this channel
    if (guildMap.has(channelId)) {
        clearInterval(guildMap.get(channelId).timer);
    }
    const timer = setInterval(async () => {
        const client = require('../index.js').client || global.client;
        if (!client) return;
        const guild = client.guilds.cache.get(guildId);
        if (!guild) return;
        const channel = guild.channels.cache.get(channelId);
        if (!channel) return;

        // Check activity requirement
        if (activityRequired) {
            const messages = await channel.messages.fetch({ limit: 10 }).catch(() => null);
            if (!messages || messages.size === 0) return; // No recent activity, skip
            const lastMsg = messages.first();
            if (lastMsg && lastMsg.author.id === client.user.id) return; // Last msg was bot, skip
        }

        channel.send(message).catch(() => {});
    }, intervalMs);

    guildMap.set(channelId, { message, intervalMs, activityRequired, timer });
}

function stopTimer(guildId, channelId) {
    const guildMap = getGuildTimers(guildId);
    const data = guildMap.get(channelId);
    if (data) {
        clearInterval(data.timer);
        guildMap.delete(channelId);
        return true;
    }
    return false;
}

async function handleTimerCommand(message, args) {
    const { success: mkSuccess, error: mkError, info: mkInfo } = require('../utils/embeds');
    const sub = args[0]?.toLowerCase();

    if (!message.member.permissions.has('ManageGuild')) {
        return message.reply({ embeds: [mkError('Permission Denied', 'You need the **Manage Server** permission.')] });
    }

    // ── timer (no args) ──
    if (!sub) {
        return message.reply({ embeds: [mkInfo('Timer Commands',
            '`,timer add #channel <interval> <message>` — add auto message\n' +
            '`,timer remove #channel` — remove auto message\n' +
            '`,timer view #channel` — preview auto message\n' +
            '`,timer list` — list all auto messages\n' +
            '`,timer activity <on/off>` — toggle activity requirement'
        )] });
    }

    // ── timer add #channel interval message ──
    if (sub === 'add') {
        const channel = message.mentions.channels.first();
        if (!channel) return message.reply({ embeds: [mkError('Missing Channel', 'Mention a channel: `,timer add #channel <interval> <message>`')] });

        // Find interval by scanning remaining args for pattern like 10m, 1h, 2h
        let intervalStr = null;
        let intervalIdx = -1;
        for (let i = 1; i < args.length; i++) {
            if (/^\d+[smhd]$/i.test(args[i])) {
                intervalStr = args[i];
                intervalIdx = i;
                break;
            }
        }

        if (!intervalStr) return message.reply({ embeds: [mkError('Missing Interval', 'Usage: `,timer add #channel <interval> <message>`\nFormat: `10m`, `1h`, `2h`, `1d`')] });

        const intervalMs = parseInterval(intervalStr);
        if (!intervalMs) return message.reply({ embeds: [mkError('Invalid Interval', 'Use format like `10m`, `1h`, `2h`, `1d`')] });
        if (intervalMs < 10 * 60 * 1000) return message.reply({ embeds: [mkError('Too Short', 'Interval must be at least **10 minutes**.')] });

        const msgText = args.slice(intervalIdx + 1).join(' ');
        if (!msgText) return message.reply({ embeds: [mkError('Missing Message', 'Provide a message to send.')] });

        startTimer(message.guild.id, channel.id, msgText, intervalMs);
        return message.reply({ embeds: [mkSuccess('Auto Message Added', `Added auto message to ${channel} with interval **${intervalStr}**.\nYou can preview it with \`,timer view ${channel}\``)] });
    }

    // ── timer remove #channel ──
    if (sub === 'remove') {
        const channel = message.mentions.channels.first();
        if (!channel) return message.reply({ embeds: [mkError('Missing Channel', 'Usage: `,timer remove #channel`')] });
        const ok = stopTimer(message.guild.id, channel.id);
        if (!ok) return message.reply({ embeds: [mkError('Not Found', 'No auto message is set for that channel.')] });
        return message.reply({ embeds: [mkSuccess('Auto Message Removed', `Removed auto message from ${channel}.`)] });
    }

    // ── timer view #channel ──
    if (sub === 'view') {
        const channel = message.mentions.channels.first();
        if (!channel) return message.reply({ embeds: [mkError('Missing Channel', 'Usage: `,timer view #channel`')] });
        const guildMap = getGuildTimers(message.guild.id);
        const data = guildMap.get(channel.id);
        if (!data) return message.reply({ embeds: [mkError('Not Found', 'No auto message is set for that channel.')] });
        return message.reply({ embeds: [mkInfo('Auto Message Preview', `Channel: ${channel}\nInterval: **${formatInterval(data.intervalMs)}**\nActivity Required: **${data.activityRequired ? 'Yes' : 'No'}**\nMessage:\n${data.message}`)] });
    }

    // ── timer list ──
    if (sub === 'list') {
        const guildMap = getGuildTimers(message.guild.id);
        if (!guildMap.size) return message.reply({ embeds: [mkInfo('Auto Messages', 'No auto messages configured.')] });
        const lines = [];
        for (const [chId, data] of guildMap) {
            lines.push(`• <#${chId}> — every **${formatInterval(data.intervalMs)}** — Activity: **${data.activityRequired ? 'Yes' : 'No'}**`);
        }
        return message.reply({ embeds: [mkInfo('Auto Messages', lines.join('\n'))] });
    }

    // ── timer activity on/off ──
    if (sub === 'activity') {
        const setting = args[1]?.toLowerCase();
        if (!['on', 'off'].includes(setting)) {
            return message.reply({ embeds: [mkError('Invalid Setting', 'Usage: `,timer activity <on/off>`')] });
        }
        const { getGuildDb } = require('./database');
        const db = getGuildDb(message.guild.id);
        db.set('timerActivityRequired', setting === 'on');
        return message.reply({ embeds: [mkSuccess('Setting Updated', `Activity requirement is now **${setting === 'on' ? 'enabled' : 'disabled'}**.\nWhen enabled, auto messages will only send if there was recent activity in the channel.`)] });
    }

    return message.reply({ embeds: [mkInfo('Timer Commands',
        '`,timer add #channel <interval> <message>` — add auto message\n' +
        '`,timer remove #channel` — remove auto message\n' +
        '`,timer view #channel` — preview auto message\n' +
        '`,timer list` — list all auto messages\n' +
        '`,timer activity <on/off>` — toggle activity requirement'
    )] });
}

module.exports = { handleTimerCommand };