/**
 * purge.js — full-featured message purge system
 * Completely silent: no bot response. Invoking message is auto-deleted.
 * Max: 10,000 messages. Loops in batches of 100 with rate-limit protection.
 */

const BULK_MAX = 100;
const RATE_DELAY = 1100; // ms between batches to avoid rate limits

// ══════════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════════

/** Messages must be < 14 days old for bulk-delete. */
function isBulkable(msg) {
    return Date.now() - msg.createdTimestamp < 13.9 * 24 * 60 * 60 * 1000;
}

// ══════════════════════════════════════════════════════════
//  CORE EXECUTOR  (completely silent)
// ══════════════════════════════════════════════════════════
async function executePurge(ctx, channel, limit, filterFn) {
    // Delete the invoking message silently
    if (ctx.deletable !== false) await ctx.delete?.().catch(() => {});

    const hardMax = Math.min(limit, 10000);
    let totalDeleted = 0;
    let lastId       = null;

    while (totalDeleted < hardMax) {
        const fetchAmt = Math.min(BULK_MAX, hardMax - totalDeleted + (filterFn ? 50 : 0));
        const opts     = { limit: Math.min(fetchAmt, 100) };
        if (lastId) opts.before = lastId;

        const msgs = await channel.messages.fetch(opts).catch(() => new Map());
        if (!msgs.size) break;

        lastId = [...msgs.keys()].at(-1);

        let batch = filterFn ? new Map([...msgs].filter(([, m]) => filterFn(m))) : msgs;
        batch     = new Map([...batch].filter(([, m]) => isBulkable(m)));

        if (batch.size) {
            const toDelete = new Map([...batch].slice(0, Math.min(BULK_MAX, hardMax - totalDeleted)));
            const result   = await channel.bulkDelete(toDelete, true).catch(() => null);
            totalDeleted  += result?.size ?? toDelete.size;
        }

        if (msgs.size < Math.min(fetchAmt, 100)) break; // No more messages
        if (totalDeleted < hardMax)               await new Promise(r => setTimeout(r, RATE_DELAY));
    }
}

// ══════════════════════════════════════════════════════════
//  NAMED FILTERS
// ══════════════════════════════════════════════════════════
const NAMED = {
    bots:       m => m.author.bot,
    humans:     m => !m.author.bot,
    links:      m => /https?:\/\//i.test(m.content),
    embeds:     m => m.embeds.length > 0,
    files:      m => m.attachments.size > 0,
    images:     m => [...m.attachments.values()].some(a => a.contentType?.startsWith('image/')),
    emoji:      m => /<a?:\w+:\d+>/u.test(m.content) || /\p{Emoji_Presentation}/u.test(m.content),
    emotes:     m => /<a?:\w+:\d+>/u.test(m.content),
    stickers:   m => m.stickers.size > 0,
    mentions:   m => m.mentions.users.size > 0 || m.mentions.roles.size > 0 || m.mentions.everyone,
    activity:   m => m.system || m.type !== 0,
};

// ══════════════════════════════════════════════════════════
//  MAIN PURGE HANDLER
// ══════════════════════════════════════════════════════════
async function handlePurge(ctx, args) {
    const { isStaffOrAdmin } = require('./helpers');
    if (!isStaffOrAdmin(ctx.member)) return ctx.reply({ content: '❌ No permission.' });

    const channel = ctx.channel;
    const sub     = args[0]?.toLowerCase();
    const amount  = parseInt(args[0]);

    // ── .purge <number> ──
    if (!isNaN(amount) && amount > 0) {
        return executePurge(ctx, channel, amount, null);
    }

    // ── .purge @user [amount] ──
    if (ctx.mentions?.users?.size) {
        const target = ctx.mentions.users.first();
        const n      = parseInt(args.find(a => !isNaN(parseInt(a)))) || 100;
        return executePurge(ctx, channel, n, m => m.author.id === target.id);
    }

    // ── .purge reactions [amount] ──
    if (sub === 'reactions') {
        await ctx.delete?.().catch(() => {});
        const n    = parseInt(args[1]) || 50;
        const msgs = await channel.messages.fetch({ limit: Math.min(n, 100) }).catch(() => new Map());
        for (const [, m] of msgs) {
            if (m.reactions.cache.size > 0) await m.reactions.removeAll().catch(() => {});
        }
        return;
    }

    // ── .purge upto <msgId> ──
    if (sub === 'upto') {
        const msgId = args[1];
        if (!msgId?.match(/^\d+$/)) return ctx.reply({ content: '❌ Provide a message ID: `.purge upto <id>`' });
        await ctx.delete?.().catch(() => {});
        const msgs = await channel.messages.fetch({ limit: 100 }).catch(() => new Map());
        const idx  = [...msgs.keys()].indexOf(msgId);
        if (idx === -1) return;
        const toDelete = new Map([...msgs].slice(0, idx).filter(([, m]) => isBulkable(m)));
        if (toDelete.size) await channel.bulkDelete(toDelete, true).catch(() => {});
        return;
    }

    // ── .purge before <msgId> [amount] ──
    if (sub === 'before') {
        const msgId = args[1];
        if (!msgId?.match(/^\d+$/)) return ctx.reply({ content: '❌ Provide a message ID.' });
        const n    = parseInt(args[2]) || 50;
        await ctx.delete?.().catch(() => {});
        const msgs = await channel.messages.fetch({ limit: Math.min(n, BULK_MAX), before: msgId }).catch(() => new Map());
        const bulk = new Map([...msgs].filter(([, m]) => isBulkable(m)));
        if (bulk.size) await channel.bulkDelete(bulk, true).catch(() => {});
        return;
    }

    // ── .purge after <msgId> [amount] ──
    if (sub === 'after') {
        const msgId = args[1];
        if (!msgId?.match(/^\d+$/)) return ctx.reply({ content: '❌ Provide a message ID.' });
        const n    = parseInt(args[2]) || 50;
        await ctx.delete?.().catch(() => {});
        const msgs = await channel.messages.fetch({ limit: Math.min(n, BULK_MAX), after: msgId }).catch(() => new Map());
        const bulk = new Map([...msgs].filter(([, m]) => isBulkable(m)));
        if (bulk.size) await channel.bulkDelete(bulk, true).catch(() => {});
        return;
    }

    // ── .purge between <msgId1> <msgId2> ──
    if (sub === 'between') {
        const id1 = args[1], id2 = args[2];
        if (!id1?.match(/^\d+$/) || !id2?.match(/^\d+$/))
            return ctx.reply({ content: '❌ Usage: `.purge between <msgId1> <msgId2>`' });
        await ctx.delete?.().catch(() => {});
        const msgs  = await channel.messages.fetch({ limit: BULK_MAX, after: id1 }).catch(() => new Map());
        const range = new Map([...msgs].filter(([id]) => BigInt(id) < BigInt(id2) && isBulkable(msgs.get(id))));
        if (range.size) await channel.bulkDelete(range, true).catch(() => {});
        return;
    }

    // ── .purge contains <amount> <text> ──
    if (sub === 'contains') {
        const n    = parseInt(args[1]) || 100;
        const text = args.slice(2).join(' ').toLowerCase();
        if (!text) return ctx.reply({ content: '❌ Usage: `.purge contains <amount> <text>`' });
        return executePurge(ctx, channel, n, m => m.content.toLowerCase().includes(text));
    }

    // ── .purge startswith <amount> <text> ──
    if (sub === 'startswith') {
        const n    = parseInt(args[1]) || 100;
        const text = args.slice(2).join(' ').toLowerCase();
        if (!text) return ctx.reply({ content: '❌ Usage: `.purge startswith <amount> <text>`' });
        return executePurge(ctx, channel, n, m => m.content.toLowerCase().startsWith(text));
    }

    // ── .purge endswith <amount> <text> ──
    if (sub === 'endswith') {
        const n    = parseInt(args[1]) || 100;
        const text = args.slice(2).join(' ').toLowerCase();
        if (!text) return ctx.reply({ content: '❌ Usage: `.purge endswith <amount> <text>`' });
        return executePurge(ctx, channel, n, m => m.content.toLowerCase().endsWith(text));
    }

    // ── Named simple filters ──
    if (sub && NAMED[sub]) {
        const n = parseInt(args[1]) || 100;
        return executePurge(ctx, channel, n, NAMED[sub]);
    }

    // ── Usage (only response the purge command ever sends) ──
    const { base, COLORS } = require('../utils/embeds');
    return ctx.reply({ embeds: [base(COLORS.primary).setTitle('🗑️ Purge Commands')
        .setDescription([
            '**Basic (silent — deletes messages with no response):**',
            '`.purge <amount>` — delete last N messages (max 10,000)',
            '`.purge @user [amount]` — delete messages from a user',
            '',
            '**Filters:**',
            '`.purge bots` `.purge humans` `.purge links` `.purge embeds`',
            '`.purge files` `.purge images` `.purge emoji` `.purge emotes`',
            '`.purge stickers` `.purge mentions` `.purge reactions` `.purge activity`',
            '',
            '**Text:**',
            '`.purge contains <n> <text>` `.purge startswith <n> <text>` `.purge endswith <n> <text>`',
            '',
            '**By Position:**',
            '`.purge upto <msgId>` `.purge before <msgId> [n]`',
            '`.purge after <msgId> [n]` `.purge between <id1> <id2>`',
        ].join('\n'))] });
}

module.exports = { handlePurge, executePurge };
