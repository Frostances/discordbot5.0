const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { getGuildDb } = require('./database');

// Spam tracking: Map<guildId:userId, {count, timer}>
const spamTracker = new Map();
const capsTracker = new Map();

async function runAutoMod(message) {
    if (!message.guild) return;
    const db = getGuildDb(message.guild.id);
    const cfg = db.get('automod', {});
    if (!cfg.enabled) return;

    // Role/channel exemptions
    const exemptRoles = cfg.exemptRoles || [];
    const exemptChannels = cfg.exemptChannels || [];
    if (exemptChannels.includes(message.channel.id)) return;
    if (exemptRoles.some(r => message.member.roles.cache.has(r))) return;
    if (message.member.permissions.has(PermissionFlagsBits.ManageMessages)) return;

    const content = message.content;

    // Spam filter
    if (cfg.spamFilter) {
        const key = `${message.guild.id}:${message.author.id}`;
        const now = Date.now();
        if (!spamTracker.has(key)) spamTracker.set(key, { count: 0, last: now });
        const entry = spamTracker.get(key);
        if (now - entry.last < 5000) {
            entry.count++;
            entry.last = now;
            if (entry.count >= (cfg.spamThreshold || 5)) {
                spamTracker.delete(key);
                await punish(message, cfg, 'spam', 'Spamming messages');
                return;
            }
        } else {
            entry.count = 1;
            entry.last = now;
        }
    }

    // Caps filter (>70% caps, min 8 chars)
    if (cfg.capsFilter && content.length >= 8) {
        const upper = content.replace(/[^A-Za-z]/g, '');
        if (upper.length > 0 && (upper.replace(/[^A-Z]/g, '').length / upper.length) > 0.7) {
            await punish(message, cfg, 'caps', 'Excessive caps');
            return;
        }
    }

    // Invite filter
    if (cfg.inviteFilter && /discord\.gg\/|discord\.com\/invite\//i.test(content)) {
        await punish(message, cfg, 'invite', 'Posting Discord invites');
        return;
    }

    // Link filter
    if (cfg.linkFilter && /https?:\/\//i.test(content)) {
        const whitelist = cfg.linkWhitelist || [];
        if (!whitelist.some(w => content.includes(w))) {
            await punish(message, cfg, 'link', 'Posting links');
            return;
        }
    }

    // Mention filter
    if (cfg.mentionFilter) {
        const limit = cfg.mentionLimit || 5;
        const mentions = message.mentions.users.size + message.mentions.roles.size;
        if (mentions >= limit) {
            await punish(message, cfg, 'mention', `Mass mentioning (${mentions} mentions)`);
            return;
        }
    }

    // Emoji spam
    if (cfg.emojiFilter) {
        const emojiCount = (content.match(/(\p{Emoji_Presentation}|\p{Extended_Pictographic})/gu) || []).length;
        if (emojiCount >= (cfg.emojiLimit || 10)) {
            await punish(message, cfg, 'emoji', 'Emoji spam');
            return;
        }
    }

    // Attachment filter
    if (cfg.attachmentFilter && message.attachments.size > 0) {
        await punish(message, cfg, 'attachment', 'Attachment not allowed');
        return;
    }

    // Profanity filter (uses guild swear list)
    if (cfg.profanityFilter) {
        const words = db.get('profanityList', []);
        const lower = content.toLowerCase();
        if (words.some(w => lower.includes(w))) {
            await punish(message, cfg, 'profanity', 'Profanity');
            return;
        }
    }
}

async function punish(message, cfg, type, reason) {
    try { await message.delete(); } catch {}

    const action = (cfg.punishments || {})[type] || 'warn';
    const logChannel = cfg.logChannel
        ? message.guild.channels.cache.get(cfg.logChannel)
        : null;

    const embed = new EmbedBuilder()
        .setTitle('🤖 AutoMod Action')
        .setColor('#FF4444')
        .addFields(
            { name: 'User', value: `${message.author} (${message.author.id})`, inline: true },
            { name: 'Rule', value: type, inline: true },
            { name: 'Action', value: action, inline: true },
            { name: 'Reason', value: reason },
            { name: 'Channel', value: `<#${message.channel.id}>` }
        )
        .setTimestamp();

    if (logChannel) await logChannel.send({ embeds: [embed] }).catch(() => {});

    if (action === 'timeout') {
        const duration = cfg.timeoutDuration || 60000;
        try { await message.member.timeout(duration, `AutoMod: ${reason}`); } catch {}
    } else if (action === 'kick') {
        try { await message.member.kick(`AutoMod: ${reason}`); } catch {}
    } else if (action === 'ban') {
        try { await message.member.ban({ reason: `AutoMod: ${reason}` }); } catch {}
    } else {
        // warn: just send a temp message
        try {
            const w = await message.channel.send(`⚠️ ${message.author}, **${reason}** is not allowed here.`);
            setTimeout(() => w.delete().catch(() => {}), 5000);
        } catch {}
    }
}

async function handleAutoModCommand(message, args) {
    const { isStaffOrAdmin } = require('./helpers');
    if (!isStaffOrAdmin(message.member)) return message.reply('❌ No permission.');
    const db = getGuildDb(message.guild.id);
    const cfg = db.get('automod', {});
    const sub = args[0];

    if (!sub) {
        return message.channel.send({ embeds: [new EmbedBuilder()
            .setTitle('🤖 AutoMod Configuration')
            .setColor('#FF4444')
            .addFields(
                { name: 'Enabled', value: cfg.enabled ? '✅' : '❌', inline: true },
                { name: 'Spam Filter', value: cfg.spamFilter ? '✅' : '❌', inline: true },
                { name: 'Caps Filter', value: cfg.capsFilter ? '✅' : '❌', inline: true },
                { name: 'Invite Filter', value: cfg.inviteFilter ? '✅' : '❌', inline: true },
                { name: 'Link Filter', value: cfg.linkFilter ? '✅' : '❌', inline: true },
                { name: 'Mention Filter', value: cfg.mentionFilter ? '✅' : '❌', inline: true },
                { name: 'Emoji Filter', value: cfg.emojiFilter ? '✅' : '❌', inline: true },
                { name: 'Profanity Filter', value: cfg.profanityFilter ? '✅' : '❌', inline: true },
                { name: 'Attachment Filter', value: cfg.attachmentFilter ? '✅' : '❌', inline: true },
                { name: 'Punishments', value: JSON.stringify(cfg.punishments || {}) }
            )
            .setFooter({ text: '.automod enable/disable/spam/caps/invites/links/mentions/emoji/attachments/profanity/punishment' })] });
    }

    if (sub === 'enable') { cfg.enabled = true; db.set('automod', cfg); return message.reply('✅ AutoMod **enabled**.'); }
    if (sub === 'disable') { cfg.enabled = false; db.set('automod', cfg); return message.reply('🔴 AutoMod **disabled**.'); }

    const toggles = { spam: 'spamFilter', caps: 'capsFilter', invites: 'inviteFilter', links: 'linkFilter', mentions: 'mentionFilter', emoji: 'emojiFilter', attachments: 'attachmentFilter', profanity: 'profanityFilter' };
    if (toggles[sub]) {
        cfg[toggles[sub]] = !cfg[toggles[sub]];
        db.set('automod', cfg);
        return message.reply(`✅ **${sub}** filter ${cfg[toggles[sub]] ? 'enabled' : 'disabled'}.`);
    }

    if (sub === 'punishment') {
        // .automod punishment spam timeout
        const type = args[1];
        const action = args[2];
        if (!type || !action) return message.reply('❌ Usage: `.automod punishment <type> <warn|timeout|kick|ban>`');
        cfg.punishments = cfg.punishments || {};
        cfg.punishments[type] = action;
        db.set('automod', cfg);
        return message.reply(`✅ **${type}** punishment set to **${action}**.`);
    }

    if (sub === 'threshold') {
        const n = parseInt(args[1]);
        if (isNaN(n)) return message.reply('❌ Usage: `.automod threshold <number>`');
        cfg.spamThreshold = n;
        db.set('automod', cfg);
        return message.reply(`✅ Spam threshold set to **${n}** messages in 5 seconds.`);
    }

    if (sub === 'whitelist') {
        // .automod whitelist add/remove #channel or @role
        const action = args[1];
        const channel = message.mentions.channels.first();
        const role = message.mentions.roles.first();
        cfg.exemptChannels = cfg.exemptChannels || [];
        cfg.exemptRoles = cfg.exemptRoles || [];
        if (action === 'add' && channel) { cfg.exemptChannels.push(channel.id); db.set('automod', cfg); return message.reply(`✅ <#${channel.id}> whitelisted.`); }
        if (action === 'remove' && channel) { cfg.exemptChannels = cfg.exemptChannels.filter(c => c !== channel.id); db.set('automod', cfg); return message.reply(`✅ <#${channel.id}> removed from whitelist.`); }
        if (action === 'add' && role) { cfg.exemptRoles.push(role.id); db.set('automod', cfg); return message.reply(`✅ <@&${role.id}> whitelisted.`); }
        if (action === 'remove' && role) { cfg.exemptRoles = cfg.exemptRoles.filter(r => r !== role.id); db.set('automod', cfg); return message.reply(`✅ <@&${role.id}> removed from whitelist.`); }
        return message.reply('❌ Usage: `.automod whitelist add/remove #channel or @role`');
    }

    if (sub === 'logchannel') {
        const ch = message.mentions.channels.first();
        if (!ch) return message.reply('❌ Mention a channel.');
        cfg.logChannel = ch.id;
        db.set('automod', cfg);
        return message.reply(`✅ AutoMod logs → <#${ch.id}>.`);
    }

    return message.reply('❌ Unknown subcommand.');
}

module.exports = { runAutoMod, handleAutoModCommand };
