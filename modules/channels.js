/**
 * channels.js — full channel moderation system
 * Covers: lock, unlock, lockdown (all/role/ignore), hide, unhide,
 *         talk, slowmode, topic, rename, revokefiles
 */
const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { getGuildDb }   = require('./database');
const { COLORS, base } = require('../utils/embeds');
const { createCase, sendModLog } = require('./cases');

// ══════════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════════
function staffCheck(ctx) {
    const { isStaffOrAdmin } = require('./helpers');
    if (!isStaffOrAdmin(ctx.member)) {
        ctx.reply({ content: '❌ No permission.', ephemeral: true });
        return false;
    }
    return true;
}

function getAuthorId(ctx) { return ctx.author?.id || ctx.user?.id; }

function getTargetChannel(ctx) {
    return ctx.mentions?.channels?.first() || ctx.channel;
}

/** Parse human-readable durations into seconds: 5s, 30s, 1m, 2m, 5m, 15m, 1h, 6h */
function parseDurationSecs(str) {
    if (!str) return null;
    const s = str.toLowerCase().trim();
    if (s === 'off' || s === '0') return 0;
    const m = s.match(/^(\d+(?:\.\d+)?)(s|m|h)$/);
    if (!m) {
        const n = parseInt(s);
        return isNaN(n) ? null : n;
    }
    const [, n, unit] = m;
    const num = parseFloat(n);
    if (unit === 's') return Math.round(num);
    if (unit === 'm') return Math.round(num * 60);
    if (unit === 'h') return Math.round(num * 3600);
    return null;
}

// ══════════════════════════════════════════════════════════
//  LOCK / UNLOCK
// ══════════════════════════════════════════════════════════
async function handleLock(ctx, args) {
    if (!staffCheck(ctx)) return;
    const ch     = getTargetChannel(ctx);
    const reason = args.filter(a => !a.startsWith('<#')).join(' ') || 'Channel locked';
    await ch.permissionOverwrites.edit(ctx.guild.roles.everyone, { SendMessages: false, AddReactions: false });
    createCase(ctx.guild.id, { type: 'lock', targetId: ch.id, executorId: getAuthorId(ctx), reason });
    await sendModLog(ctx.guild, base(COLORS.error).setTitle('🔒 Channel Locked')
        .addFields(
            { name: 'Channel', value: `<#${ch.id}>`,          inline: true },
            { name: 'By',      value: `<@${getAuthorId(ctx)}>`, inline: true },
            { name: 'Reason',  value: reason },
        ));
    return ctx.reply({ content: `🔒 <#${ch.id}> has been **locked**.` });
}

async function handleUnlock(ctx, args) {
    if (!staffCheck(ctx)) return;
    const ch     = getTargetChannel(ctx);
    const reason = args.filter(a => !a.startsWith('<#')).join(' ') || 'Channel unlocked';
    await ch.permissionOverwrites.edit(ctx.guild.roles.everyone, { SendMessages: null, AddReactions: null });
    createCase(ctx.guild.id, { type: 'unlock', targetId: ch.id, executorId: getAuthorId(ctx), reason });
    await sendModLog(ctx.guild, base(COLORS.success).setTitle('🔓 Channel Unlocked')
        .addFields(
            { name: 'Channel', value: `<#${ch.id}>`,           inline: true },
            { name: 'By',      value: `<@${getAuthorId(ctx)}>`, inline: true },
        ));
    return ctx.reply({ content: `🔓 <#${ch.id}> has been **unlocked**.` });
}

// ══════════════════════════════════════════════════════════
//  LOCKDOWN
// ══════════════════════════════════════════════════════════
async function handleLockdown(ctx, args) {
    if (!staffCheck(ctx)) return;

    const db      = getGuildDb(ctx.guild.id);
    const ignored = db.get('lockdownIgnored', []);
    const sub     = args[0]?.toLowerCase();

    // .lockdown ignore add/remove/list
    if (sub === 'ignore') return handleLockdownIgnore(ctx, args);

    // .lockdown role @role [off]
    if (sub === 'role') {
        const role   = ctx.mentions?.roles?.first();
        if (!role) return ctx.reply({ content: '❌ Mention a role: `.lockdown role @role [off]`' });
        const isOff  = args.includes('off');
        const reason = args.filter(a => !a.startsWith('<@') && a !== 'role' && a !== 'off').join(' ') || (isOff ? 'Lockdown lifted' : 'Role lockdown');
        let count    = 0;
        for (const [, ch] of ctx.guild.channels.cache) {
            if (ch.type !== ChannelType.GuildText) continue;
            if (ignored.includes(ch.id)) continue;
            try {
                await ch.permissionOverwrites.edit(role, { SendMessages: isOff ? null : false });
                count++;
            } catch {}
        }
        return ctx.reply({ content: `${isOff ? '🔓' : '🔒'} Role lockdown ${isOff ? 'lifted' : 'applied'} for <@&${role.id}> — **${count}** channels affected.` });
    }

    // .lockdown off  — lift full lockdown
    const isOff  = sub === 'off';
    const reason = args.slice(isOff ? 1 : 0).join(' ') || (isOff ? 'Lockdown lifted' : 'Server lockdown');

    // Target: "all" or no arg = all text channels; otherwise just current
    const affectAll = sub === 'all' || !sub || isOff;
    let locked = 0;

    if (affectAll) {
        for (const [, ch] of ctx.guild.channels.cache) {
            if (ch.type !== ChannelType.GuildText) continue;
            if (ignored.includes(ch.id)) continue;
            try {
                await ch.permissionOverwrites.edit(ctx.guild.roles.everyone, { SendMessages: isOff ? null : false });
                locked++;
            } catch {}
        }
    } else {
        const ch = getTargetChannel(ctx);
        await ch.permissionOverwrites.edit(ctx.guild.roles.everyone, { SendMessages: false });
        locked = 1;
    }

    createCase(ctx.guild.id, { type: 'lockdown', targetId: ctx.guild.id, executorId: getAuthorId(ctx), reason });
    await sendModLog(ctx.guild, base(isOff ? COLORS.success : COLORS.error)
        .setTitle(isOff ? '🔓 Lockdown Lifted' : '🚨 Server Lockdown')
        .addFields(
            { name: 'Channels', value: locked.toString(),   inline: true },
            { name: 'By',       value: `<@${getAuthorId(ctx)}>`, inline: true },
            { name: 'Reason',   value: reason },
        ));
    return ctx.reply({ content: `${isOff ? '🔓 Lockdown lifted' : '🚨 Server locked down'} — **${locked}** channel(s) affected.` });
}

async function handleUnlockAll(ctx, args) {
    if (!staffCheck(ctx)) return;
    const db      = getGuildDb(ctx.guild.id);
    const ignored = db.get('lockdownIgnored', []);
    const reason  = args.join(' ') || 'Mass unlock';
    let count     = 0;

    for (const [, ch] of ctx.guild.channels.cache) {
        if (ch.type !== ChannelType.GuildText) continue;
        if (ignored.includes(ch.id)) continue;
        try {
            await ch.permissionOverwrites.edit(ctx.guild.roles.everyone, { SendMessages: null, AddReactions: null });
            count++;
        } catch {}
    }
    createCase(ctx.guild.id, { type: 'unlock', targetId: 'all', executorId: getAuthorId(ctx), reason });
    return ctx.reply({ content: `🔓 Unlocked **${count}** channel(s).` });
}

async function handleLockdownIgnore(ctx, args) {
    if (!staffCheck(ctx)) return;
    const db      = getGuildDb(ctx.guild.id);
    const ignored = db.get('lockdownIgnored', []);
    const sub     = args[1]?.toLowerCase();
    const ch      = ctx.mentions?.channels?.first();

    if (sub === 'add' && ch) {
        if (!ignored.includes(ch.id)) { ignored.push(ch.id); db.set('lockdownIgnored', ignored); }
        return ctx.reply({ content: `✅ <#${ch.id}> will be **ignored** during lockdowns.` });
    }
    if (sub === 'remove' && ch) {
        db.set('lockdownIgnored', ignored.filter(id => id !== ch.id));
        return ctx.reply({ content: `✅ <#${ch.id}> **removed** from lockdown ignore list.` });
    }
    if (sub === 'list') {
        const list = ignored.length ? ignored.map(id => `<#${id}>`).join('\n') : '*None*';
        return ctx.reply({ embeds: [base(COLORS.primary).setTitle('🔒 Lockdown Ignore List').setDescription(list)] });
    }
    return ctx.reply({ content: '❌ Usage: `.lockdown ignore add/remove/list [#channel]`' });
}

// ══════════════════════════════════════════════════════════
//  HIDE / UNHIDE
// ══════════════════════════════════════════════════════════
async function handleHide(ctx, args) {
    if (!staffCheck(ctx)) return;
    const ch = getTargetChannel(ctx);
    await ch.permissionOverwrites.edit(ctx.guild.roles.everyone, { ViewChannel: false });
    createCase(ctx.guild.id, { type: 'hide', targetId: ch.id, executorId: getAuthorId(ctx), reason: 'Channel hidden' });
    return ctx.reply({ content: `👁 <#${ch.id}> is now **hidden** from @everyone.` });
}

async function handleUnhide(ctx, args) {
    if (!staffCheck(ctx)) return;
    const ch = getTargetChannel(ctx);
    await ch.permissionOverwrites.edit(ctx.guild.roles.everyone, { ViewChannel: null });
    createCase(ctx.guild.id, { type: 'unhide', targetId: ch.id, executorId: getAuthorId(ctx), reason: 'Channel unhidden' });
    return ctx.reply({ content: `👁 <#${ch.id}> is now **visible** to @everyone.` });
}

// ══════════════════════════════════════════════════════════
//  TALK (explicitly allow sending)
// ══════════════════════════════════════════════════════════
async function handleTalk(ctx, args) {
    if (!staffCheck(ctx)) return;
    const ch = getTargetChannel(ctx);
    await ch.permissionOverwrites.edit(ctx.guild.roles.everyone, { SendMessages: true });
    return ctx.reply({ content: `💬 @everyone can now **talk** in <#${ch.id}>.` });
}

// ══════════════════════════════════════════════════════════
//  SLOWMODE — accepts: 5s 30s 1m 2m 5m 15m 1h off 0
// ══════════════════════════════════════════════════════════
async function handleSlowmode(ctx, args) {
    if (!staffCheck(ctx)) return;

    // Channel can be anywhere in args
    const ch       = ctx.mentions?.channels?.first() || ctx.channel;
    const cleanArgs = args.filter(a => !a.startsWith('<#'));
    const rawArg    = cleanArgs[0] || '';

    if (!rawArg || rawArg === 'off') {
        await ch.setRateLimitPerUser(0);
        return ctx.reply({ content: `✅ Slowmode **disabled** in <#${ch.id}>.` });
    }

    const seconds = parseDurationSecs(rawArg);
    if (seconds === null || seconds < 0 || seconds > 21600)
        return ctx.reply({ content: '❌ Valid values: `0`/`off`, `5s`, `30s`, `1m`, `5m`, `15m`, `1h`, or any number up to 21600s.' });

    await ch.setRateLimitPerUser(seconds);
    createCase(ctx.guild.id, { type: 'slowmode', targetId: ch.id, executorId: getAuthorId(ctx), reason: `${rawArg} slowmode` });

    const display = seconds === 0 ? 'disabled' : rawArg;
    return ctx.reply({ content: `🐌 Slowmode in <#${ch.id}> set to **${display}**.` });
}

// ══════════════════════════════════════════════════════════
//  TOPIC
// ══════════════════════════════════════════════════════════
async function handleTopic(ctx, args) {
    if (!staffCheck(ctx)) return;
    const ch    = ctx.mentions?.channels?.first() || ctx.channel;
    const topic = args.filter(a => !a.startsWith('<#')).join(' ');
    if (!topic) return ctx.reply({ content: '❌ Provide a topic: `.topic <text>`' });
    if (ch.type !== ChannelType.GuildText) return ctx.reply({ content: '❌ Topics only work in text channels.' });
    const old = ch.topic || '*(none)*';
    await ch.setTopic(topic);
    return ctx.reply({ content: `✅ Topic updated in <#${ch.id}>:\n**Before:** ${old}\n**After:** ${topic}` });
}

// ══════════════════════════════════════════════════════════
//  CHANNEL RENAME
// ══════════════════════════════════════════════════════════
async function handleChannelRename(ctx, args) {
    if (!staffCheck(ctx)) return;
    const ch      = ctx.mentions?.channels?.first() || ctx.channel;
    const newName = args.filter(a => !a.startsWith('<#')).join('-')
        .replace(/[^a-z0-9\-_]/gi, '-').replace(/-{2,}/g, '-').toLowerCase().slice(0, 100);
    if (!newName) return ctx.reply({ content: '❌ Provide a new name: `.chanrename <name>`' });
    const old = ch.name;
    await ch.setName(newName);
    return ctx.reply({ content: `✏️ Channel renamed: **${old}** → **${newName}**` });
}

// ══════════════════════════════════════════════════════════
//  REVOKE FILES
// ══════════════════════════════════════════════════════════
async function handleRevokeFiles(ctx, args) {
    if (!staffCheck(ctx)) return;
    const ch      = ctx.mentions?.channels?.first() || ctx.channel;
    const raw     = args.find(a => a === 'on' || a === 'off');
    if (!raw) return ctx.reply({ content: '❌ Usage: `.revokefiles on` (disable files) or `.revokefiles off` (restore files)' });
    const revoke  = raw === 'on';
    await ch.permissionOverwrites.edit(ctx.guild.roles.everyone, {
        AttachFiles: revoke ? false : null,
        EmbedLinks:  revoke ? false : null,
    });
    return ctx.reply({ content: `${revoke ? '🚫 File attachments **revoked**' : '✅ File attachments **restored**'} in <#${ch.id}>.` });
}

module.exports = {
    handleLock, handleUnlock, handleUnlockAll,
    handleLockdown, handleLockdownIgnore,
    handleHide, handleUnhide, handleTalk,
    handleSlowmode, handleTopic, handleChannelRename, handleRevokeFiles,
};
