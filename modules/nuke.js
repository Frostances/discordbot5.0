/**
 * nuke.js — Channel nuke and nuke scheduler
 * Commands:
 *   .nuke [#channel] [reason]            — immediately clone-delete the channel
 *   .nuke schedule <time> [#channel] [reason] — schedule a future nuke
 *   .nuke list                            — show all scheduled nukes
 *   .nuke cancel [#channel]               — cancel a scheduled nuke
 */
const { PermissionFlagsBits } = require('discord.js');
const { getGuildDb }   = require('./database');
const { COLORS, base } = require('../utils/embeds');
const { createCase, sendModLog, parseDuration, formatDuration } = require('./cases');
const logger           = require('../utils/logger');

/** In-memory timer handles: channelId → TimeoutHandle */
const activeTimers = new Map();

function getAuthorId(ctx) { return ctx.author?.id || ctx.user?.id; }

// ══════════════════════════════════════════════════════════
//  CORE: clone-delete the channel (preserves all settings)
// ══════════════════════════════════════════════════════════
async function executeNuke(channel, executorId, reason = 'Channel nuked') {
    const guild = channel.guild;
    try {
        const clone = await guild.channels.create({
            name:               channel.name,
            type:               channel.type,
            topic:              channel.topic       || undefined,
            nsfw:               channel.nsfw,
            rateLimitPerUser:   channel.rateLimitPerUser,
            parent:             channel.parent      || undefined,
            position:           channel.rawPosition,
            permissionOverwrites: [...channel.permissionOverwrites.cache.values()],
            reason: `Nuke by ${executorId}: ${reason}`,
        });

        await channel.delete(`Nuke: ${reason}`);

        createCase(guild.id, { type: 'nuke', targetId: clone.id, executorId, reason });
        await sendModLog(guild, base(COLORS.error)
            .setTitle('💣 Channel Nuked')
            .addFields(
                { name: 'Channel', value: `#${clone.name}`,  inline: true },
                { name: 'By',      value: `<@${executorId}>`, inline: true },
                { name: 'Reason',  value: reason },
            ));

        return clone;
    } catch (err) {
        logger.error('NUKE', `Failed to nuke #${channel.name}`, err);
        throw err;
    }
}

// ══════════════════════════════════════════════════════════
//  SCHEDULE PERSISTENCE
// ══════════════════════════════════════════════════════════
function saveSchedule(guildId, channelId, data) {
    const db  = getGuildDb(guildId);
    const sch = db.get('nukeSchedule', {});
    sch[channelId] = data;
    db.set('nukeSchedule', sch);
}

function removeSchedule(guildId, channelId) {
    const db  = getGuildDb(guildId);
    const sch = db.get('nukeSchedule', {});
    delete sch[channelId];
    db.set('nukeSchedule', sch);
}

function cancelTimer(channelId) {
    if (activeTimers.has(channelId)) {
        clearTimeout(activeTimers.get(channelId));
        activeTimers.delete(channelId);
    }
}

function scheduleNuke(client, guildId, channelId, executorId, reason, fireAt) {
    cancelTimer(channelId);
    const delay = Math.max(0, fireAt - Date.now());
    const handle = setTimeout(async () => {
        activeTimers.delete(channelId);
        removeSchedule(guildId, channelId);
        const guild = client.guilds.cache.get(guildId);
        if (!guild) return;
        const channel = guild.channels.cache.get(channelId);
        if (!channel) return;
        try {
            const clone = await executeNuke(channel, executorId, reason);
            await clone.send('first').catch(() => {});
        } catch (err) {
            logger.error('NUKE', `Scheduled nuke failed for channel ${channelId}`, err);
        }
    }, delay);
    activeTimers.set(channelId, handle);
}

// ══════════════════════════════════════════════════════════
//  RESTORE ON RESTART
// ══════════════════════════════════════════════════════════
async function restoreNukeSchedules(client) {
    let restored = 0;
    for (const guild of client.guilds.cache.values()) {
        const db  = getGuildDb(guild.id);
        const sch = db.get('nukeSchedule', {});
        for (const [channelId, data] of Object.entries(sch)) {
            if (data.fireAt <= Date.now()) {
                // Overdue — execute immediately
                removeSchedule(guild.id, channelId);
                const channel = guild.channels.cache.get(channelId);
                if (channel) {
                    executeNuke(channel, data.executorId, data.reason + ' (overdue)').catch(() => {});
                }
            } else {
                scheduleNuke(client, guild.id, channelId, data.executorId, data.reason, data.fireAt);
                restored++;
            }
        }
    }
    logger.info('NUKE', `Restored ${restored} scheduled nuke(s)`);
}

// ══════════════════════════════════════════════════════════
//  COMMAND HANDLER
// ══════════════════════════════════════════════════════════
async function handleNuke(ctx, args, client) {
    const { isStaffOrAdmin } = require('./helpers');
    if (!isStaffOrAdmin(ctx.member)) return ctx.reply({ content: '❌ No permission.', ephemeral: true });
    if (!ctx.member.permissions.has(PermissionFlagsBits.ManageChannels))
        return ctx.reply({ content: '❌ You need **Manage Channels** permission.', ephemeral: true });

    const sub      = args[0]?.toLowerCase();
    const authorId = getAuthorId(ctx);
    const guild    = ctx.guild;

    // ── .nuke list ──────────────────────────────────────────
    if (sub === 'list') {
        const sch     = getGuildDb(guild.id).get('nukeSchedule', {});
        const entries = Object.entries(sch);
        if (!entries.length) return ctx.reply({ content: '✅ No scheduled nukes.' });
        const lines = entries.map(([chId, d]) =>
            `<#${chId}> — fires <t:${Math.floor(d.fireAt / 1000)}:R> — *${d.reason}* — by <@${d.executorId}>`
        ).join('\n');
        return ctx.reply({ embeds: [base(COLORS.warning).setTitle('💣 Scheduled Nukes').setDescription(lines)] });
    }

    // ── .nuke cancel [#channel] ─────────────────────────────
    if (sub === 'cancel') {
        const ch = ctx.mentions?.channels?.first() || ctx.channel;
        cancelTimer(ch.id);
        removeSchedule(guild.id, ch.id);
        return ctx.reply({ content: `✅ Scheduled nuke for <#${ch.id}> cancelled.` });
    }

    // ── .nuke schedule <time> [#channel] [reason] ───────────
    if (sub === 'schedule') {
        const durStr   = args[1];
        const duration = parseDuration(durStr);
        if (!duration) return ctx.reply({
            content: '❌ Usage: `.nuke schedule <time> [#channel] [reason]`\nTime: `10m` `1h` `2d`',
            ephemeral: true,
        });

        const ch     = ctx.mentions?.channels?.first() || ctx.channel;
        const reason = args.slice(2).filter(a => !a.startsWith('<#')).join(' ') || 'Scheduled nuke';
        const fireAt = Date.now() + duration;

        saveSchedule(guild.id, ch.id, { channelId: ch.id, executorId: authorId, reason, fireAt });
        scheduleNuke(client, guild.id, ch.id, authorId, reason, fireAt);

        return ctx.reply({ embeds: [base(COLORS.warning)
            .setTitle('💣 Nuke Scheduled')
            .addFields(
                { name: 'Channel',   value: `<#${ch.id}>`,                         inline: true },
                { name: 'Duration',  value: formatDuration(duration),               inline: true },
                { name: 'Fires At',  value: `<t:${Math.floor(fireAt / 1000)}:F>`,  inline: false },
                { name: 'Reason',    value: reason },
            )] });
    }

    // ── .nuke [#channel] [reason] — immediate ────────────────
    const ch     = ctx.mentions?.channels?.first() || ctx.channel;
    const reason = args.filter(a => !a.startsWith('<#')).join(' ') || 'No reason provided';

    if (!ch.permissionsFor(guild.members.me)?.has(PermissionFlagsBits.ManageChannels))
        return ctx.reply({ content: `❌ I don't have **Manage Channels** permission in <#${ch.id}>.`, ephemeral: true });

    // 3-second warning
    let warningMsg;
    try {
        warningMsg = await ch.send({ embeds: [base(COLORS.error)
            .setTitle('💣 Incoming Nuke')
            .setDescription('This channel is being nuked in **3 seconds**...')] });
    } catch {}

    await new Promise(r => setTimeout(r, 3000));
    warningMsg?.delete().catch(() => {});

    try {
        const clone = await executeNuke(ch, authorId, reason);
        await clone.send('first').catch(() => {});
    } catch (err) {
        // channel is gone — try to notify in another channel
        try { await ctx.channel?.send(`❌ Nuke failed: ${err.message}`); } catch {}
    }
}

module.exports = { handleNuke, restoreNukeSchedules };