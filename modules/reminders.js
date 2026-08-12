/**
 * reminders.js — per-user, per-guild reminder system
 * Commands: .remind <duration> <text>, .remind list, .remind remove <id>, .reminders
 * Supports: m (minutes), h (hours), d (days), w (weeks)
 * Delivery: DM → fallback to original channel
 * Persistence: stored in guild DB, timers restored on restart
 */
const { EmbedBuilder } = require('discord.js');
const { getGuildDb }   = require('./database');
const { COLORS, base } = require('../utils/embeds');

const ACTIVE_TIMERS = new Map(); // `${guildId}:${reminderId}` → timeout

// ══════════════════════════════════════════════════════════
//  DURATION PARSER — m h d w
// ══════════════════════════════════════════════════════════
function parseDuration(str) {
    if (!str) return null;
    const s = str.trim().toLowerCase();
    const m = s.match(/^(\d+(?:\.\d+)?)(m|h|d|w)$/);
    if (!m) return null;
    const [, n, unit] = m;
    const num = parseFloat(n);
    const table = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };
    return Math.round(num * table[unit]);
}

function fmtDuration(ms) {
    const s = Math.round(ms / 1000);
    if (s < 60)    return `${s}s`;
    if (s < 3600)  return `${Math.floor(s / 60)}m`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
    return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
}

// ══════════════════════════════════════════════════════════
//  FIRE A REMINDER
// ══════════════════════════════════════════════════════════
async function fireReminder(client, guildId, reminder) {
    const key = `${guildId}:${reminder.id}`;
    ACTIVE_TIMERS.delete(key);

    // Remove from DB
    const db      = getGuildDb(guildId);
    const list    = db.get('reminders', []);
    db.set('reminders', list.filter(r => r.id !== reminder.id));

    const embed = base(COLORS.primary)
        .setTitle('⏰ Reminder!')
        .setDescription(reminder.text)
        .addFields({ name: 'Set', value: `<t:${Math.floor(reminder.createdAt / 1000)}:R>`, inline: true })
        .setFooter({ text: `Reminder #${reminder.id}` })
        .setTimestamp();

    // Try DM first
    try {
        const user = await client.users.fetch(reminder.userId);
        await user.send({ embeds: [embed] });
        return;
    } catch {}

    // Fallback: original channel
    try {
        const ch = await client.channels.fetch(reminder.channelId).catch(() => null);
        if (ch) await ch.send({ content: `<@${reminder.userId}>`, embeds: [embed] });
    } catch {}
}

// ══════════════════════════════════════════════════════════
//  SCHEDULE HELPER
// ══════════════════════════════════════════════════════════
function schedule(client, guildId, reminder, delay) {
    const key   = `${guildId}:${reminder.id}`;
    const clamped = Math.min(delay, 2_147_483_647);
    const timer = setTimeout(() => fireReminder(client, guildId, reminder), clamped);
    ACTIVE_TIMERS.set(key, timer);
}

// ══════════════════════════════════════════════════════════
//  RESTORE ON BOT RESTART
// ══════════════════════════════════════════════════════════
async function restoreReminders(client) {
    const now = Date.now();
    for (const guild of client.guilds.cache.values()) {
        const db   = getGuildDb(guild.id);
        const list = db.get('reminders', []);
        const keep = [];

        for (const r of list) {
            const delay = r.fireAt - now;
            if (delay <= 0) {
                // Already overdue — fire immediately
                fireReminder(client, guild.id, r).catch(() => {});
            } else {
                keep.push(r);
                schedule(client, guild.id, r, delay);
            }
        }
        // Only keep reminders that still need to fire
        db.set('reminders', keep);
    }
}

// ══════════════════════════════════════════════════════════
//  COMMAND HANDLER
// ══════════════════════════════════════════════════════════
async function handleRemind(ctx, args, client) {
    const userId    = ctx.author?.id || ctx.user?.id;
    const channelId = ctx.channel?.id || ctx.channelId;
    const guildId   = ctx.guild?.id;
    if (!guildId) return ctx.reply({ content: '❌ Reminders are server-only.' });

    const db   = getGuildDb(guildId);
    const sub  = args[0]?.toLowerCase();

    // ── .remind list / .reminders ──
    if (!sub || sub === 'list') {
        const list = db.get('reminders', []).filter(r => r.userId === userId);
        if (!list.length) return ctx.reply({ content: '📭 You have no active reminders. Use `.remind <duration> <text>` to create one.' });
        const lines = list.map(r =>
            `**#${r.id}** — <t:${Math.floor(r.fireAt / 1000)}:R>\n> ${r.text.slice(0, 100)}${r.text.length > 100 ? '…' : ''}`
        ).join('\n\n');
        return ctx.reply({ embeds: [base(COLORS.primary)
            .setTitle('⏰ Your Reminders')
            .setDescription(lines)
            .setFooter({ text: `${list.length} active reminder(s) • .remind remove <id> to cancel` })] });
    }

    // ── .remind remove <id> ──
    if (sub === 'remove' || sub === 'delete' || sub === 'cancel') {
        const id  = parseInt(args[1]);
        if (isNaN(id)) return ctx.reply({ content: '❌ Usage: `.remind remove <id>`' });

        const list    = db.get('reminders', []);
        const target  = list.find(r => r.id === id && r.userId === userId);
        if (!target)  return ctx.reply({ content: `❌ Reminder #${id} not found or doesn't belong to you.` });

        const key = `${guildId}:${id}`;
        if (ACTIVE_TIMERS.has(key)) { clearTimeout(ACTIVE_TIMERS.get(key)); ACTIVE_TIMERS.delete(key); }

        db.set('reminders', list.filter(r => r.id !== id));
        return ctx.reply({ content: `✅ Reminder **#${id}** cancelled.` });
    }

    // ── .remind <duration> <text> ──
    const durStr  = args[0];
    const duration = parseDuration(durStr);
    if (!duration) return ctx.reply({ content: [
        '❌ Invalid duration. Valid formats: `10m` `2h` `1d` `1w`',
        '',
        '**Examples:**',
        '`.remind 30m check the oven`',
        '`.remind 2h meeting`',
        '`.remind 1d check PR`',
        '`.remind list` — view your reminders',
        '`.remind remove <id>` — cancel a reminder',
    ].join('\n') });

    if (duration < 60_000)       return ctx.reply({ content: '❌ Minimum reminder time is **1 minute**.' });
    if (duration > 30 * 7 * 86_400_000) return ctx.reply({ content: '❌ Maximum reminder time is **30 weeks**.' });

    const text = args.slice(1).join(' ').trim();
    if (!text)  return ctx.reply({ content: '❌ What should I remind you about? Usage: `.remind <duration> <text>`' });

    const list   = db.get('reminders', []);
    const myCount = list.filter(r => r.userId === userId).length;
    if (myCount >= 25) return ctx.reply({ content: '❌ You already have **25** active reminders. Remove some first.' });

    const id      = (list.length ? Math.max(...list.map(r => r.id)) : 0) + 1;
    const fireAt  = Date.now() + duration;
    const r       = { id, userId, channelId, guildId, text, fireAt, createdAt: Date.now() };

    list.push(r);
    db.set('reminders', list);
    schedule(client, guildId, r, duration);

    return ctx.reply({ embeds: [base(COLORS.success)
        .setTitle('⏰ Reminder Set')
        .addFields(
            { name: '📝 Text',     value: text,                                 inline: false },
            { name: '⏱️ In',      value: fmtDuration(duration),                inline: true },
            { name: '🔔 Fires',   value: `<t:${Math.floor(fireAt / 1000)}:F>`, inline: true },
            { name: '🆔 ID',       value: `#${id}`,                             inline: true },
        )
        .setFooter({ text: "I'll DM you when the time comes • .remind remove " + id + ' to cancel' })] });
}

module.exports = { handleRemind, restoreReminders };
