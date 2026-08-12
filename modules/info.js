const { EmbedBuilder } = require('discord.js');
const { COLORS } = require('../utils/embeds');
const logger = require('../utils/logger');
const os = require('os');

async function handlePing(context) {
    const start = Date.now();
    const isInteraction = !!context.deferReply;

    let msg;
    if (isInteraction) {
        await context.deferReply();
        const elapsed = Date.now() - start;
        const wsLatency = context.client.ws.ping;
        const embed = new EmbedBuilder()
            .setTitle('🏓 Pong!')
            .setColor(COLORS.primary)
            .addFields(
                { name: 'API Latency', value: `${elapsed}ms`, inline: true },
                { name: 'WebSocket', value: `${wsLatency}ms`, inline: true },
            ).setTimestamp();
        return context.editReply({ embeds: [embed] });
    } else {
        msg = await context.channel.send('🏓 Pinging...');
        const elapsed = msg.createdTimestamp - context.createdTimestamp;
        const wsLatency = context.client.ws.ping;
        const embed = new EmbedBuilder()
            .setTitle('🏓 Pong!')
            .setColor(COLORS.primary)
            .addFields(
                { name: 'API Latency', value: `${elapsed}ms`, inline: true },
                { name: 'WebSocket', value: `${wsLatency}ms`, inline: true },
            ).setTimestamp();
        return msg.edit({ content: '', embeds: [embed] });
    }
}

async function handleBotStats(context, client) {
    const isInteraction = !!context.deferReply;
    if (isInteraction) await context.deferReply();

    const { commandsExecuted, errorsLogged } = logger.getStats();
    const guilds = client.guilds.cache.size;
    const users = client.guilds.cache.reduce((a, g) => a + g.memberCount, 0);
    const channels = client.channels.cache.size;
    const uptimeSec = Math.floor(process.uptime());
    const days = Math.floor(uptimeSec / 86400);
    const hours = Math.floor((uptimeSec % 86400) / 3600);
    const mins = Math.floor((uptimeSec % 3600) / 60);
    const uptime = `${days}d ${hours}h ${mins}m`;

    const memUsed = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    const memTotal = Math.round(os.totalmem() / 1024 / 1024);
    const cpuModel = os.cpus()[0]?.model || 'Unknown';
    const nodeVer = process.version;
    const djsVer = require('discord.js').version;
    const ws = client.ws.ping;

    const embed = new EmbedBuilder()
        .setTitle('📊 Bot Statistics')
        .setColor(COLORS.primary)
        .setThumbnail(client.user.displayAvatarURL())
        .addFields(
            { name: '🏠 Servers',         value: guilds.toLocaleString(),    inline: true },
            { name: '👥 Users',            value: users.toLocaleString(),     inline: true },
            { name: '💬 Channels',         value: channels.toLocaleString(),  inline: true },
            { name: '🌐 WebSocket Ping',   value: `${ws}ms`,                  inline: true },
            { name: '⬆️ Uptime',           value: uptime,                     inline: true },
            { name: '📟 Commands Run',     value: commandsExecuted.toLocaleString(), inline: true },
            { name: '💾 Memory',           value: `${memUsed}MB / ${memTotal}MB`, inline: true },
            { name: '🔧 Node.js',          value: nodeVer,                    inline: true },
            { name: '📦 Discord.js',       value: `v${djsVer}`,              inline: true },
            { name: '⚠️ Errors Logged',    value: errorsLogged.toLocaleString(), inline: true },
        )
        .setFooter({ text: `Bot ID: ${client.user.id}` })
        .setTimestamp();

    if (isInteraction) return context.editReply({ embeds: [embed] });
    return context.channel.send({ embeds: [embed] });
}

async function handleUserInfo(context, target, client) {
    const isInteraction = !!context.deferReply;
    if (isInteraction) await context.deferReply();

    const guild = context.guild;
    let member, user;

    if (target) {
        user = target;
        member = await guild.members.fetch(target.id).catch(() => null);
    } else {
        user = isInteraction ? context.user : context.author;
        member = isInteraction ? context.member : context.member;
    }

    const roles = member?.roles.cache
        .filter(r => r.id !== guild.id)
        .sort((a, b) => b.position - a.position)
        .map(r => `<@&${r.id}>`)
        .slice(0, 10)
        .join(' ') || 'None';

    const joined = member?.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:F>` : 'Unknown';
    const created = `<t:${Math.floor(user.createdTimestamp / 1000)}:F>`;

    const flags = user.flags?.toArray().map(f => `\`${f}\``).join(', ') || 'None';

    const embed = new EmbedBuilder()
        .setTitle(`👤 ${user.username}`)
        .setThumbnail(user.displayAvatarURL({ size: 256 }))
        .setColor(member?.displayHexColor || COLORS.primary)
        .addFields(
            { name: 'User', value: `${user} (${user.id})`, inline: false },
            { name: 'Nickname', value: member?.nickname || 'None', inline: true },
            { name: 'Bot', value: user.bot ? 'Yes' : 'No', inline: true },
            { name: 'Account Created', value: created, inline: false },
            { name: 'Joined Server', value: joined, inline: false },
            { name: `Roles [${(member?.roles.cache.size || 1) - 1}]`, value: roles.length > 1024 ? roles.slice(0, 1020) + '...' : roles },
            { name: 'Badges', value: flags },
        )
        .setFooter({ text: 'Kaido' })
        .setTimestamp();

    if (isInteraction) return context.editReply({ embeds: [embed] });
    return context.channel.send({ embeds: [embed] });
}

async function handleServerInfo(context, client) {
    const isInteraction = !!context.deferReply;
    if (isInteraction) await context.deferReply();

    const guild = context.guild;
    await guild.fetch().catch(() => {});

    const owner = await guild.fetchOwner().catch(() => null);
    const bots = guild.members.cache.filter(m => m.user.bot).size;
    const humans = guild.memberCount - bots;
    const channels = { text: 0, voice: 0, category: 0, forum: 0 };
    guild.channels.cache.forEach(ch => {
        if (ch.type === 0) channels.text++;
        else if (ch.type === 2) channels.voice++;
        else if (ch.type === 4) channels.category++;
        else if (ch.type === 15) channels.forum++;
    });
    const created = `<t:${Math.floor(guild.createdTimestamp / 1000)}:F>`;
    const boosts = guild.premiumSubscriptionCount;
    const tier = `Level ${guild.premiumTier}`;

    const embed = new EmbedBuilder()
        .setTitle(`🏰 ${guild.name}`)
        .setThumbnail(guild.iconURL({ size: 256 }))
        .setColor(COLORS.primary)
        .addFields(
            { name: 'Server ID', value: guild.id, inline: true },
            { name: 'Owner', value: owner ? `${owner.user}` : 'Unknown', inline: true },
            { name: 'Created', value: created, inline: false },
            { name: '👥 Members', value: `${guild.memberCount} total\n${humans} humans | ${bots} bots`, inline: true },
            { name: '💬 Channels', value: `${channels.text} text | ${channels.voice} voice\n${channels.category} categories | ${channels.forum} forums`, inline: true },
            { name: '🎭 Roles', value: guild.roles.cache.size.toString(), inline: true },
            { name: '😀 Emojis', value: guild.emojis.cache.size.toString(), inline: true },
            { name: '🚀 Boosts', value: `${boosts} boosts — ${tier}`, inline: true },
            { name: '🔒 Verification', value: guild.verificationLevel.toString(), inline: true },
        )
        .setFooter({ text: 'Kaido' })
        .setTimestamp();

    if (isInteraction) return context.editReply({ embeds: [embed] });
    return context.channel.send({ embeds: [embed] });
}

async function handleAvatar(context, target) {
    const isInteraction = !!context.deferReply;
    if (isInteraction) await context.deferReply();

    const user = target || (isInteraction ? context.user : context.author);
    const url = user.displayAvatarURL({ size: 4096, extension: 'png' });
    const urlWebp = user.displayAvatarURL({ size: 4096, extension: 'webp' });

    const embed = new EmbedBuilder()
        .setTitle(`🖼️ ${user.username}'s Avatar`)
        .setImage(url)
        .setColor(COLORS.primary)
        .setDescription(`[PNG](${url}) | [WebP](${urlWebp})`)
        .setFooter({ text: 'Kaido' })
        .setTimestamp();

    if (isInteraction) return context.editReply({ embeds: [embed] });
    return context.channel.send({ embeds: [embed] });
}

module.exports = { handlePing, handleBotStats, handleUserInfo, handleServerInfo, handleAvatar };
