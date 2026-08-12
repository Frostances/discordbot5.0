/**
 * threads.js — full thread moderation system
 * lock, unlock, rename, add, remove, archive, unarchive, list, watch, watch list
 */
const { ChannelType } = require('discord.js');
const { getGuildDb }  = require('./database');
const { COLORS, base } = require('../utils/embeds');

function staffCheck(ctx) {
    const { isStaffOrAdmin } = require('./helpers');
    if (!isStaffOrAdmin(ctx.member)) { ctx.reply({ content: '❌ No permission.', ephemeral: true }); return false; }
    return true;
}

function isThread(ch) {
    return ch && [ChannelType.PublicThread, ChannelType.PrivateThread, ChannelType.AnnouncementThread].includes(ch.type);
}

function resolveThread(ctx) {
    const mentioned = ctx.mentions?.channels?.first();
    if (mentioned && isThread(mentioned)) return mentioned;
    if (isThread(ctx.channel)) return ctx.channel;
    return null;
}

async function handleThread(ctx, args, client) {
    if (!staffCheck(ctx)) return;
    const sub = args[0]?.toLowerCase();

    // ── Help ──
    if (!sub) return ctx.reply({ embeds: [base(COLORS.primary).setTitle('🧵 Thread Commands')
        .setDescription([
            '`.thread lock [#thread]` — lock a thread',
            '`.thread unlock [#thread]` — unlock a thread',
            '`.thread rename [#thread] <name>` — rename a thread',
            '`.thread add @user [#thread]` — add a member to a thread',
            '`.thread remove @user [#thread]` — remove a member from a thread',
            '`.thread archive [#thread]` — archive a thread',
            '`.thread unarchive [#thread]` — unarchive a thread',
            '`.thread list` — list all active threads',
            '`.thread watch <add|remove|list> [#channel]` — watch a channel for new threads',
        ].join('\n'))] });

    // ── .thread lock ──
    if (sub === 'lock') {
        const thread = resolveThread(ctx);
        if (!thread) return ctx.reply({ content: '❌ Run this inside a thread, or mention one: `.thread lock #thread`' });
        await thread.setLocked(true, `Locked by ${ctx.author?.tag || ctx.user?.tag}`);
        return ctx.reply({ content: `🔒 Thread <#${thread.id}> has been **locked**.` });
    }

    // ── .thread unlock ──
    if (sub === 'unlock') {
        const thread = resolveThread(ctx);
        if (!thread) return ctx.reply({ content: '❌ Run this inside a thread, or mention one.' });
        await thread.setLocked(false);
        return ctx.reply({ content: `🔓 Thread <#${thread.id}> has been **unlocked**.` });
    }

    // ── .thread rename ──
    if (sub === 'rename') {
        const thread  = resolveThread(ctx);
        if (!thread) return ctx.reply({ content: '❌ Run this inside a thread, or mention one.' });
        const newName = args.filter(a => a !== 'rename' && !a.startsWith('<#')).slice(1).join(' ')
            || args.slice(2).filter(a => !a.startsWith('<#')).join(' ');
        if (!newName) return ctx.reply({ content: '❌ Provide a new name: `.thread rename <name>`' });
        const old = thread.name;
        await thread.setName(newName.slice(0, 100));
        return ctx.reply({ content: `✏️ Thread renamed: **${old}** → **${newName.slice(0, 100)}**` });
    }

    // ── .thread add @user ──
    if (sub === 'add') {
        const target = ctx.mentions?.members?.first();
        if (!target) return ctx.reply({ content: '❌ Mention a user: `.thread add @user`' });
        const thread = resolveThread(ctx);
        if (!thread) return ctx.reply({ content: '❌ Run this inside a thread, or mention one.' });
        await thread.members.add(target.id);
        return ctx.reply({ content: `✅ <@${target.id}> added to <#${thread.id}>.` });
    }

    // ── .thread remove @user ──
    if (sub === 'remove') {
        const target = ctx.mentions?.members?.first();
        if (!target) return ctx.reply({ content: '❌ Mention a user: `.thread remove @user`' });
        const thread = resolveThread(ctx);
        if (!thread) return ctx.reply({ content: '❌ Run this inside a thread, or mention one.' });
        await thread.members.remove(target.id);
        return ctx.reply({ content: `✅ <@${target.id}> removed from <#${thread.id}>.` });
    }

    // ── .thread archive ──
    if (sub === 'archive') {
        const thread = resolveThread(ctx);
        if (!thread) return ctx.reply({ content: '❌ Run this inside a thread, or mention one.' });
        await thread.setArchived(true);
        return ctx.reply({ content: `📁 Thread <#${thread.id}> **archived**.` });
    }

    // ── .thread unarchive ──
    if (sub === 'unarchive') {
        const thread = resolveThread(ctx);
        if (!thread) return ctx.reply({ content: '❌ Run this inside a thread, or mention one.' });
        await thread.setArchived(false);
        return ctx.reply({ content: `📂 Thread <#${thread.id}> **unarchived**.` });
    }

    // ── .thread list ──
    if (sub === 'list') {
        const { sendPaginated, chunk } = require('../utils/paginator');
        const threads = [...ctx.guild.channels.cache.values()].filter(c => isThread(c));
        if (!threads.length) return ctx.reply({ content: 'No active threads found in this server.' });
        const lines = threads.map(t =>
            `<#${t.id}> — ${t.locked ? '🔒 Locked' : '🔓 Open'} — ${t.archived ? '📁 Archived' : '📂 Active'} — **${t.memberCount ?? '?'}** members`
        );
        const pages = chunk(lines, 12).map((pg, i) => ({
            title:       `🧵 Threads [${threads.length}] — Page ${i + 1}`,
            description: pg.join('\n'),
            color:       COLORS.primary,
        }));
        return sendPaginated(ctx.channel, pages, ctx.author?.id || ctx.user?.id);
    }

    // ── .thread watch <add|remove|list> [#channel] ──
    if (sub === 'watch') {
        const db      = getGuildDb(ctx.guild.id);
        const watched = db.get('threadWatch', []);
        const action  = args[1]?.toLowerCase();
        const ch      = ctx.mentions?.channels?.first() || ctx.channel;

        if (!action || action === 'list') {
            if (!watched.length) return ctx.reply({ content: '📭 No channels are being watched for threads.' });
            const lines = watched.map(id => {
                const c = ctx.guild.channels.cache.get(id);
                return c ? `<#${id}>` : `~~\`${id}\`~~ *(deleted)*`;
            }).join('\n');
            return ctx.reply({ embeds: [base(COLORS.primary).setTitle('👁️ Thread Watch List').setDescription(lines)] });
        }

        if (action === 'add') {
            if (watched.includes(ch.id)) return ctx.reply({ content: `❌ <#${ch.id}> is already being watched.` });
            watched.push(ch.id);
            db.set('threadWatch', watched);
            return ctx.reply({ content: `✅ Now watching <#${ch.id}> for new threads. The bot will log new threads in mod-log.` });
        }

        if (action === 'remove') {
            if (!watched.includes(ch.id)) return ctx.reply({ content: `❌ <#${ch.id}> is not being watched.` });
            db.set('threadWatch', watched.filter(id => id !== ch.id));
            return ctx.reply({ content: `✅ Stopped watching <#${ch.id}>.` });
        }

        return ctx.reply({ content: '❌ Usage: `.thread watch add/remove/list [#channel]`' });
    }

    return ctx.reply({ content: '❌ Unknown subcommand. Use `.thread` for help.' });
}

// ── Called from index.js threadCreate event to log watched channels ──
async function onThreadCreate(thread) {
    try {
        const { sendModLog }  = require('./cases');
        const { COLORS, base } = require('../utils/embeds');
        const db      = getGuildDb(thread.guild.id);
        const watched = db.get('threadWatch', []);

        // Is the parent channel being watched?
        if (!watched.includes(thread.parentId)) return;

        await sendModLog(thread.guild, base(COLORS.info)
            .setTitle('🧵 New Thread Created')
            .addFields(
                { name: '📌 Thread',  value: `<#${thread.id}> — **${thread.name}**`, inline: false },
                { name: '📢 Parent',  value: `<#${thread.parentId}>`,                inline: true },
                { name: '👤 Creator', value: thread.ownerId ? `<@${thread.ownerId}>` : 'Unknown', inline: true },
                { name: '🕐 Created', value: `<t:${Math.floor(thread.createdTimestamp / 1000)}:F>`, inline: false },
            )
            .setTimestamp());
    } catch {}
}

module.exports = { handleThread, onThreadCreate };
