const { EmbedBuilder, WebhookClient } = require('discord.js');
const logger = require('../utils/logger');

// Cache webhooks to avoid recreating them
const webhookCache = new Map();

const ALL_EVENTS = ['messages', 'members', 'roles', 'channels', 'invites', 'emojis', 'voice', 'antinuke'];

function getLogConfig(db) {
    return db.get('logging', { channels: {}, ignored: { channels: [], members: [] } });
}

function saveLogConfig(db, cfg) {
    db.set('logging', cfg);
}

function isIgnored(db, guildId, channelId, userId) {
    const cfg = getLogConfig(db);
    if (cfg.ignored.channels.includes(channelId)) return true;
    if (cfg.ignored.members.includes(userId)) return true;
    return false;
}

function getEventColor(cfg, channelId, event) {
    const chCfg = cfg.channels[channelId];
    if (chCfg?.colors?.[event]) return chCfg.colors[event];
    const defaults = {
        messages: '#5865F2',
        members: '#57F287',
        roles: '#EB459E',
        channels: '#FEE75C',
        invites: '#ED4245',
        emojis: '#5865F2',
        voice: '#5865F2',
    };
    return defaults[event] || '#5865F2';
}

async function getOrCreateWebhook(channel, cfg) {
    const chCfg = cfg.channels[channel.id];
    const cachedId = chCfg?.webhookId;

    // Try cache first
    if (cachedId && webhookCache.has(cachedId)) {
        const wh = webhookCache.get(cachedId);
        try { 
            await wh.send({ content: null, embeds: [] }); 
            return wh;
        } catch { 
            webhookCache.delete(cachedId); 
        }
    }

    // Try existing webhooks
    try {
        const hooks = await channel.fetchWebhooks();
        const existing = hooks.find(h => h.owner?.id === channel.client.user.id);
        if (existing) {
            const wh = new WebhookClient({ url: existing.url });
            webhookCache.set(existing.id, wh);
            return wh;
        }
    } catch {}

    // Create new webhook
    try {
        const wh = await channel.createWebhook({
            name: channel.client.user.username + ' logs',
            avatar: channel.client.user.displayAvatarURL(),
        });
        const whClient = new WebhookClient({ url: wh.url });
        webhookCache.set(wh.id, whClient);
        return whClient;
    } catch (err) {
        logger.error('LOGGING', 'Failed to create webhook', err);
        return null;
    }
}

async function sendLog(guild, event, embedBuilder) {
    const { getGuildDb } = require('./database');
    const db = getGuildDb(guild.id);
    const cfg = getLogConfig(db);

    for (const [chId, chCfg] of Object.entries(cfg.channels)) {
        if (!chCfg.events.includes(event)) continue;
        const channel = guild.channels.cache.get(chId);
        if (!channel) continue;

        const color = getEventColor(cfg, chId, event);
        const embed = embedBuilder(color);
        if (!embed) continue;

        try {
            const wh = await getOrCreateWebhook(channel, cfg);
            if (wh) {
                await wh.send({ embeds: [embed] });
            } else {
                await channel.send({ embeds: [embed] });
            }
        } catch (err) {
            logger.error('LOGGING', `Failed to send ${event} log`, err);
        }
    }
}

// ══════════════════════════════════════════════════════════
// COMMAND HANDLER
// ══════════════════════════════════════════════════════════
async function handleLogCommand(message, args) {
    const { success: mkSuccess, error: mkError, info: mkInfo } = require('../utils/embeds');
    const { getGuildDb } = require('./database');
    const db = getGuildDb(message.guild.id);
    const cfg = getLogConfig(db);
    const sub = args[0]?.toLowerCase();

    if (!message.member.permissions.has('ManageGuild')) {
        return message.reply({ embeds: [mkError('Permission Denied', 'You need the **Manage Server** permission.')] });
    }

    // ── log (no args) ──
    if (!sub) {
        const channels = Object.entries(cfg.channels).map(([id, ch]) => {
            const chObj = message.guild.channels.cache.get(id);
            return `• <#${id}> — ${ch.events.join(', ') || 'none'}`;
        });
        return message.reply({ embeds: [mkInfo('Logging Configuration',
            channels.length ? channels.join('\n') : 'No logging channels configured.\n\nUse `,log add #channel <event>` to set up logging.'
        )] });
    }

    // ── log add #channel [event] ──
    if (sub === 'add') {
        const channel = message.mentions.channels.first();
        const event = args[2]?.toLowerCase();
        if (!channel) return message.reply({ embeds: [mkError('Missing Channel', 'Usage: `,log add #channel <event>`')] });

        if (!cfg.channels[channel.id]) cfg.channels[channel.id] = { events: [], colors: {} };

        if (!event) {
            // Add all events
            cfg.channels[channel.id].events = [...ALL_EVENTS];
            saveLogConfig(db, cfg);
            return message.reply({ embeds: [mkSuccess('Logging Added', `All events will be logged in ${channel}.`)] });
        }

        if (!ALL_EVENTS.includes(event)) {
            return message.reply({ embeds: [mkError('Invalid Event', `Available events: ${ALL_EVENTS.join(', ')}`)] });
        }

        if (!cfg.channels[channel.id].events.includes(event)) {
            cfg.channels[channel.id].events.push(event);
        }
        saveLogConfig(db, cfg);
        return message.reply({ embeds: [mkSuccess('Logging Added', `Event **${event}** will be logged in ${channel}.`)] });
    }

    // ── log remove #channel [event] ──
    if (sub === 'remove') {
        const channel = message.mentions.channels.first();
        const event = args[2]?.toLowerCase();
        if (!channel) return message.reply({ embeds: [mkError('Missing Channel', 'Usage: `,log remove #channel <event>`')] });
        if (!cfg.channels[channel.id]) return message.reply({ embeds: [mkError('Not Found', 'That channel is not configured for logging.')] });

        if (!event) {
            delete cfg.channels[channel.id];
            saveLogConfig(db, cfg);
            return message.reply({ embeds: [mkSuccess('Logging Removed', `All events removed from ${channel}.`)] });
        }

        cfg.channels[channel.id].events = cfg.channels[channel.id].events.filter(e => e !== event);
        if (cfg.channels[channel.id].events.length === 0) delete cfg.channels[channel.id];
        saveLogConfig(db, cfg);
        return message.reply({ embeds: [mkSuccess('Logging Removed', `Event **${event}** will no longer be logged in ${channel}.`)] });
    }

    // ── log ignore @user/#channel ──
    if (sub === 'ignore') {
        const target = message.mentions.channels.first() || message.mentions.members.first();
        if (!target) return message.reply({ embeds: [mkError('Missing Target', 'Mention a channel or member: `,log ignore #channel` or `,log ignore @user`')] });

        const isChannel = target.type !== undefined;
        const list = isChannel ? cfg.ignored.channels : cfg.ignored.members;
        const id = target.id;

        if (list.includes(id)) {
            // Unignore
            if (isChannel) cfg.ignored.channels = list.filter(x => x !== id);
            else cfg.ignored.members = list.filter(x => x !== id);
            saveLogConfig(db, cfg);
            return message.reply({ embeds: [mkSuccess('Unignored', `${isChannel ? `<#${id}>` : `<@${id}>`} will now be logged.`)] });
        } else {
            // Ignore
            list.push(id);
            if (isChannel) cfg.ignored.channels = list;
            else cfg.ignored.members = list;
            saveLogConfig(db, cfg);
            return message.reply({ embeds: [mkSuccess('Ignored', `${isChannel ? `<#${id}>` : `<@${id}>`} will no longer be logged.`)] });
        }
    }

    // ── log ignore list ──
    if (sub === 'ignore' && args[1]?.toLowerCase() === 'list') {
        const chs = cfg.ignored.channels.map(id => `<#${id}>`).join(', ') || 'None';
        const mems = cfg.ignored.members.map(id => `<@${id}>`).join(', ') || 'None';
        return message.reply({ embeds: [mkInfo('Ignored Channels & Members',
            `**Channels:** ${chs}\n**Members:** ${mems}`
        )] });
    }

    // ── log color #channel event #hex ──
    if (sub === 'color') {
        const channel = message.mentions.channels.first();
        const event = args[2]?.toLowerCase();
        const color = args[3];
        if (!channel || !event || !color) return message.reply({ embeds: [mkError('Missing Args', 'Usage: `,log color #channel <event> #hex`')] });
        if (!ALL_EVENTS.includes(event)) return message.reply({ embeds: [mkError('Invalid Event', `Available: ${ALL_EVENTS.join(', ')}`)] });
        if (!cfg.channels[channel.id]) return message.reply({ embeds: [mkError('Not Found', 'That channel is not configured for logging.')] });

        cfg.channels[channel.id].colors = cfg.channels[channel.id].colors || {};
        cfg.channels[channel.id].colors[event] = color;
        saveLogConfig(db, cfg);
        return message.reply({ embeds: [mkSuccess('Color Updated', `**${event}** logs in ${channel} will now use color **${color}**.`)] });
    }

    // ── log color list #channel ──
    if (sub === 'color' && args[1]?.toLowerCase() === 'list') {
        const channel = message.mentions.channels.first();
        if (!channel) return message.reply({ embeds: [mkError('Missing Channel', 'Usage: `,log color list #channel`')] });
        if (!cfg.channels[channel.id]) return message.reply({ embeds: [mkError('Not Found', 'That channel is not configured for logging.')] });

        const colors = cfg.channels[channel.id].colors || {};
        const lines = ALL_EVENTS.map(e => `• **${e}:** ${colors[e] || 'default'}`);
        return message.reply({ embeds: [mkInfo('Log Colors', lines.join('\n'))] });
    }

    // ── log show ──
    if (sub === 'show') {
      const embed = new EmbedBuilder().setTitle('📋 Logging Events').setColor('#5865F2');
      const lines = ALL_EVENTS.map(ev => {
        const enabledIn = Object.entries(cfg.channels)
          .filter(([, ch]) => ch.events.includes(ev))
          .map(([id]) => `<#${id}>`);
        return `${enabledIn.length ? '🟢' : '🔴'} **${ev}**${enabledIn.length ? ' → ' + enabledIn.join(', ') : ''}`;
      });
      embed.setDescription(lines.join('\n') || 'No events configured.');
      return message.reply({ embeds: [embed] });
    }

    return message.reply({ embeds: [mkInfo('Log Commands',
        '`,log` — view config\n' +
        '`,log add #channel <event>` — add logging event\n' +
        '`,log remove #channel <event>` — remove logging event\n' +
        '`,log ignore #channel/@user` — toggle ignore\n' +
        '`,log ignore list` — view ignored\n' +
        '`,log color #channel <event> #hex` — set embed color\n' +
        '`,log color list #channel` — view colors'
    )] });
}

// ══════════════════════════════════════════════════════════
// EVENT HANDLERS
// ══════════════════════════════════════════════════════════

async function onMessageDelete(message) {
    if (!message.guild || message.author?.bot) return;
    const { getGuildDb } = require('./database');
    const db = getGuildDb(message.guild.id);
    if (isIgnored(db, message.guild.id, message.channel.id, message.author.id)) return;

    await sendLog(message.guild, 'messages', (color) => {
        const embed = new EmbedBuilder()
            .setAuthor({ name: 'Message Deleted', iconURL: 'https://cdn.discordapp.com/embed/avatars/0.png' })
            .setDescription(
                `Message from <@${message.author.id}> deleted in <#${message.channel.id}>\n` +
                `It was sent at <t:${Math.floor(message.createdTimestamp / 1000)}:F>`
            )
            .setColor(color)
            .setFooter({ text: `User ID: ${message.author.id} • Today at ${new Date().toLocaleTimeString()}` });

        if (message.content) embed.addFields({ name: 'Message Content', value: message.content.slice(0, 1024) });
        if (message.attachments.size > 0) {
            embed.addFields({ name: 'Attachments', value: message.attachments.map(a => a.url).join('\n').slice(0, 1024) });
        }
        return embed;
    });
}

async function onMessageUpdate(oldMsg, newMsg) {
    if (!oldMsg.guild || oldMsg.author?.bot || oldMsg.content === newMsg.content) return;
    const { getGuildDb } = require('./database');
    const db = getGuildDb(oldMsg.guild.id);
    if (isIgnored(db, oldMsg.guild.id, oldMsg.channel.id, oldMsg.author.id)) return;

    await sendLog(oldMsg.guild, 'messages', (color) => {
        return new EmbedBuilder()
            .setAuthor({ name: 'Message Edited', iconURL: oldMsg.author.displayAvatarURL() })
            .setDescription(`Message from <@${oldMsg.author.id}> edited in <#${oldMsg.channel.id}>\n[Jump to message](${newMsg.url})`)
            .addFields(
                { name: 'Before', value: oldMsg.content.slice(0, 1024) || '*Empty*' },
                { name: 'After', value: newMsg.content.slice(0, 1024) || '*Empty*' }
            )
            .setColor(color)
            .setFooter({ text: `User ID: ${oldMsg.author.id}` })
            .setTimestamp();
    });
}

async function onGuildMemberAdd(member) {
    const { getGuildDb } = require('./database');
    const db = getGuildDb(member.guild.id);
    const cfg = getLogConfig(db);
    if (!Object.values(cfg.channels).some(ch => ch.events.includes('antinuke'))) return;

    await sendLog(member.guild, 'members', (color) => {
        return new EmbedBuilder()
            .setAuthor({ name: 'Member Joined', iconURL: member.user.displayAvatarURL() })
            .setDescription(`<@${member.id}> **${member.user.tag}**`)
            .addFields(
                { name: 'Account Created', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true },
                { name: 'Member Count', value: member.guild.memberCount.toString(), inline: true }
            )
            .setColor(color)
            .setFooter({ text: `User ID: ${member.id}` })
            .setTimestamp();
    });
}

async function onGuildMemberRemove(member) {
    const { getGuildDb } = require('./database');
    const db = getGuildDb(member.guild.id);
    const cfg = getLogConfig(db);
    if (!Object.values(cfg.channels).some(ch => ch.events.includes('members'))) return;

    await sendLog(member.guild, 'members', (color) => {
        return new EmbedBuilder()
            .setAuthor({ name: 'Member Left', iconURL: member.user.displayAvatarURL() })
            .setDescription(`<@${member.id}> **${member.user.tag}**`)
            .addFields(
                { name: 'Joined Server', value: member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : 'Unknown', inline: true },
                { name: 'Member Count', value: member.guild.memberCount.toString(), inline: true }
            )
            .setColor(color)
            .setFooter({ text: `User ID: ${member.id}` })
            .setTimestamp();
    });
}

async function onGuildMemberUpdate(oldMember, newMember) {
    if (oldMember.nickname !== newMember.nickname) {
        const { getGuildDb } = require('./database');
        const db = getGuildDb(newMember.guild.id);
        if (isIgnored(db, newMember.guild.id, null, newMember.id)) return;

        await sendLog(newMember.guild, 'members', (color) => {
            return new EmbedBuilder()
                .setAuthor({ name: 'Nickname Changed', iconURL: newMember.user.displayAvatarURL() })
                .setDescription(`<@${newMember.id}>`)
                .addFields(
                    { name: 'Before', value: oldMember.nickname || '*None*', inline: true },
                    { name: 'After', value: newMember.nickname || '*None*', inline: true }
                )
                .setColor(color)
                .setFooter({ text: `User ID: ${newMember.id}` })
                .setTimestamp();
        });
    }
}

async function onRoleCreate(role) {
    await sendLog(role.guild, 'roles', (color) => {
        return new EmbedBuilder()
            .setAuthor({ name: 'Role Created', iconURL: role.guild.iconURL() })
            .setDescription(`<@&${role.id}> **${role.name}**`)
            .addFields(
                { name: 'Color', value: role.hexColor, inline: true },
                { name: 'Hoisted', value: role.hoist ? 'Yes' : 'No', inline: true },
                { name: 'Mentionable', value: role.mentionable ? 'Yes' : 'No', inline: true }
            )
            .setColor(color)
            .setFooter({ text: `Role ID: ${role.id}` })
            .setTimestamp();
    });
}

async function onRoleDelete(role) {
    await sendLog(role.guild, 'roles', (color) => {
        return new EmbedBuilder()
            .setAuthor({ name: 'Role Deleted', iconURL: role.guild.iconURL() })
            .setDescription(`**${role.name}**`)
            .setColor(color)
            .setFooter({ text: `Role ID: ${role.id}` })
            .setTimestamp();
    });
}

async function onRoleUpdate(oldRole, newRole) {
    if (oldRole.name === newRole.name && oldRole.color === newRole.color) return;
    await sendLog(newRole.guild, 'roles', (color) => {
        const embed = new EmbedBuilder()
            .setAuthor({ name: 'Role Updated', iconURL: newRole.guild.iconURL() })
            .setDescription(`<@&${newRole.id}> **${newRole.name}**`)
            .setColor(color)
            .setFooter({ text: `Role ID: ${newRole.id}` })
            .setTimestamp();
        if (oldRole.name !== newRole.name) embed.addFields({ name: 'Name', value: `\`\`${oldRole.name}\`\` → \`\`${newRole.name}\`\`` });
        if (oldRole.color !== newRole.color) embed.addFields({ name: 'Color', value: `\`\`${oldRole.hexColor}\`\` → \`\`${newRole.hexColor}\`\`` });
        return embed;
    });
}

async function onChannelCreate(channel) {
    if (!channel.guild) return;
    await sendLog(channel.guild, 'channels', (color) => {
        return new EmbedBuilder()
            .setAuthor({ name: 'Channel Created', iconURL: channel.guild.iconURL() })
            .setDescription(`<#${channel.id}> **${channel.name}**`)
            .addFields({ name: 'Type', value: channel.type.toString(), inline: true })
            .setColor(color)
            .setFooter({ text: `Channel ID: ${channel.id}` })
            .setTimestamp();
    });
}

async function onChannelDelete(channel) {
    if (!channel.guild) return;
    await sendLog(channel.guild, 'channels', (color) => {
        return new EmbedBuilder()
            .setAuthor({ name: 'Channel Deleted', iconURL: channel.guild.iconURL() })
            .setDescription(`**${channel.name}**`)
            .addFields({ name: 'Type', value: channel.type.toString(), inline: true })
            .setColor(color)
            .setFooter({ text: `Channel ID: ${channel.id}` })
            .setTimestamp();
    });
}

async function onChannelUpdate(oldChannel, newChannel) {
    if (!newChannel.guild) return;
    if (oldChannel.name === newChannel.name) return;
    await sendLog(newChannel.guild, 'channels', (color) => {
        return new EmbedBuilder()
            .setAuthor({ name: 'Channel Updated', iconURL: newChannel.guild.iconURL() })
            .setDescription(`<#${newChannel.id}>`)
            .addFields({ name: 'Name', value: `\`\`${oldChannel.name}\`\` → \`\`${newChannel.name}\`\`` })
            .setColor(color)
            .setFooter({ text: `Channel ID: ${newChannel.id}` })
            .setTimestamp();
    });
}

async function onInviteCreate(invite) {
    await sendLog(invite.guild, 'invites', (color) => {
        return new EmbedBuilder()
            .setAuthor({ name: 'Invite Created', iconURL: invite.guild.iconURL() })
            .setDescription(`**${invite.code}**`)
            .addFields(
                { name: 'Channel', value: `<#${invite.channel.id}>`, inline: true },
                { name: 'Inviter', value: `<@${invite.inviter.id}>`, inline: true },
                { name: 'Max Uses', value: invite.maxUses?.toString() || 'Unlimited', inline: true }
            )
            .setColor(color)
            .setFooter({ text: `Inviter ID: ${invite.inviter.id}` })
            .setTimestamp();
    });
}

async function onInviteDelete(invite) {
    await sendLog(invite.guild, 'invites', (color) => {
        return new EmbedBuilder()
            .setAuthor({ name: 'Invite Deleted', iconURL: invite.guild.iconURL() })
            .setDescription(`**${invite.code}**`)
            .addFields({ name: 'Channel', value: `<#${invite.channel.id}>`, inline: true })
            .setColor(color)
            .setTimestamp();
    });
}

async function onEmojiCreate(emoji) {
    await sendLog(emoji.guild, 'emojis', (color) => {
        return new EmbedBuilder()
            .setAuthor({ name: 'Emoji Created', iconURL: emoji.guild.iconURL() })
            .setDescription(`${emoji} \`:${emoji.name}:\``)
            .setColor(color)
            .setFooter({ text: `Emoji ID: ${emoji.id}` })
            .setTimestamp();
    });
}

async function onEmojiDelete(emoji) {
    await sendLog(emoji.guild, 'emojis', (color) => {
        return new EmbedBuilder()
            .setAuthor({ name: 'Emoji Deleted', iconURL: emoji.guild.iconURL() })
            .setDescription(`\`:${emoji.name}:\``)
            .setColor(color)
            .setFooter({ text: `Emoji ID: ${emoji.id}` })
            .setTimestamp();
    });
}

async function onEmojiUpdate(oldEmoji, newEmoji) {
    await sendLog(newEmoji.guild, 'emojis', (color) => {
        return new EmbedBuilder()
            .setAuthor({ name: 'Emoji Updated', iconURL: newEmoji.guild.iconURL() })
            .setDescription(`${newEmoji} \`:${newEmoji.name}:\``)
            .addFields({ name: 'Old Name', value: `\`:${oldEmoji.name}:\`` })
            .setColor(color)
            .setFooter({ text: `Emoji ID: ${newEmoji.id}` })
            .setTimestamp();
    });
}

async function onVoiceStateUpdate(oldState, newState) {
    const guild = newState.guild || oldState.guild;
    const member = newState.member || oldState.member;
    if (!guild || member.user.bot) return;

    const { getGuildDb } = require('./database');
    const db = getGuildDb(guild.id);
    if (isIgnored(db, guild.id, null, member.id)) return;

    let embed = null;

    if (!oldState.channel && newState.channel) {
        embed = new EmbedBuilder()
            .setAuthor({ name: 'Voice Channel Joined', iconURL: member.user.displayAvatarURL() })
            .setDescription(`<@${member.id}> joined <#${newState.channel.id}>`)
            .setColor('#57F287');
    } else if (oldState.channel && !newState.channel) {
        embed = new EmbedBuilder()
            .setAuthor({ name: 'Voice Channel Left', iconURL: member.user.displayAvatarURL() })
            .setDescription(`<@${member.id}> left <#${oldState.channel.id}>`)
            .setColor('#ED4245');
    } else if (oldState.channel && newState.channel && oldState.channel.id !== newState.channel.id) {
        embed = new EmbedBuilder()
            .setAuthor({ name: 'Voice Channel Switched', iconURL: member.user.displayAvatarURL() })
            .setDescription(`<@${member.id}> moved from <#${oldState.channel.id}> to <#${newState.channel.id}>`)
            .setColor('#FEE75C');
    }

    if (embed) {
        await sendLog(guild, 'voice', () => embed.setFooter({ text: `User ID: ${member.id}` }).setTimestamp());
    }
}

async function onAntiNukeTrigger(guild, type, member, action, reason) {
    const { getGuildDb } = require('./database');
    const db = getGuildDb(guild.id);
    const cfg = getLogConfig(db);
    if (!Object.values(cfg.channels).some(ch => ch.events.includes('members'))) return;

    await sendLog(guild, 'antinuke', (color) => {
        return new EmbedBuilder()
            .setTitle('🛡️ AntiNuke Triggered')
            .setColor('#FF0000')
            .setThumbnail(member.user?.displayAvatarURL?.() || null)
            .addFields(
                { name: '👤 User', value: `${member.user?.tag || 'Unknown'} (<@${member.id}>)`, inline: true },
                { name: '⚡ Type', value: type, inline: true },
                { name: '🚫 Punishment', value: action, inline: true },
                { name: '📝 Reason', value: reason || 'No reason provided' },
            )
            .setFooter({ text: `User ID: ${member.id}` })
            .setTimestamp();
    });
}

module.exports = {
    handleLogCommand,
    onMessageDelete,
    onMessageUpdate,
    onGuildMemberAdd,
    onGuildMemberRemove,
    onGuildMemberUpdate,
    onRoleCreate,
    onRoleDelete,
    onRoleUpdate,
    onChannelCreate,
    onChannelDelete,
    onChannelUpdate,
    onInviteCreate,
    onInviteDelete,
    onEmojiCreate,
    onEmojiDelete,
    onEmojiUpdate,
    onVoiceStateUpdate,
    onAntiNukeTrigger,
};