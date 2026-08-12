        const { EmbedBuilder } = require('discord.js');
        const { getGuildDb } = require('./database');

        // ══════════════════════════════════════════════════════════
        //  AFK SYSTEM
        // ══════════════════════════════════════════════════════════

        function formatDuration(ms) {
            const seconds = Math.floor((ms / 1000) % 60);
            const minutes = Math.floor((ms / (1000 * 60)) % 60);
            const hours   = Math.floor((ms / (1000 * 60 * 60)) % 24);
            const days    = Math.floor(ms / (1000 * 60 * 60 * 24));

            const parts = [];
            if (days    > 0) parts.push(`${days} day${days !== 1 ? 's' : ''}`);
            if (hours   > 0) parts.push(`${hours} hour${hours !== 1 ? 's' : ''}`);
            if (minutes > 0) parts.push(`${minutes} minute${minutes !== 1 ? 's' : ''}`);
            if (seconds > 0 || parts.length === 0) parts.push(`${seconds} second${seconds !== 1 ? 's' : ''}`);

            return parts.join(', ');
        }

        function getAfkData(guildId) {
            const db = getGuildDb(guildId);
            return db.get('afk', {});
        }

        function saveAfkData(guildId, data) {
            const db = getGuildDb(guildId);
            db.set('afk', data);
        }

        // ── Set or toggle off AFK ──
        async function setAfk(message, args) {
            const afk = getAfkData(message.guild.id);

            // Toggle OFF if already AFK
            if (afk[message.author.id]) {
                const oldData = afk[message.author.id];
                delete afk[message.author.id];
                saveAfkData(message.guild.id, afk);

                // Restore nickname
                try {
                    const current = message.member.displayName;
                    if (current.startsWith('[AFK] ')) {
                        await message.member.setNickname(current.replace('[AFK] ', '').slice(0, 32)).catch(() => {});
                    } else if (current.startsWith('[AFK]')) {
                        await message.member.setNickname(current.replace('[AFK]', '').slice(0, 32)).catch(() => {});
                    } else if (oldData.originalNick && oldData.originalNick !== current) {
                        await message.member.setNickname(oldData.originalNick.slice(0, 32)).catch(() => {});
                    }
                } catch {}

                const embed = new EmbedBuilder()
                    .setColor('#57F287')
                    .setDescription(`✅ ${message.author}: **You're no longer AFK.**`);
                return message.channel.send({ embeds: [embed] });
            }

            // Set AFK
            const reason = args.join(' ').trim() || 'AFK';
            afk[message.author.id] = {
                since: Date.now(),
                reason: reason,
                originalNick: message.member.displayName
            };
            saveAfkData(message.guild.id, afk);

            // Add [AFK] prefix to nickname
            try {
                const nick = message.member.displayName;
                if (!nick.startsWith('[AFK]')) {
                    const newNick = `[AFK] ${nick}`.slice(0, 32);
                    await message.member.setNickname(newNick).catch(() => {});
                }
            } catch {}

            const embed = new EmbedBuilder()
                .setColor('#57F287')
                .setDescription(`✅ ${message.author}: **You're now AFK** with the status: \`${reason}\``);
            return message.channel.send({ embeds: [embed] });
        }

        // ── Auto-detect AFK user returning ──
        async function checkAfkReturn(message) {
            if (message.author.bot || !message.guild) return;

            const afk = getAfkData(message.guild.id);
            if (!afk[message.author.id]) return;

            const data = afk[message.author.id];
            delete afk[message.author.id];
            saveAfkData(message.guild.id, afk);

            // Restore nickname
            try {
                const current = message.member.displayName;
                if (current.startsWith('[AFK] ')) {
                    await message.member.setNickname(current.replace('[AFK] ', '').slice(0, 32)).catch(() => {});
                } else if (current.startsWith('[AFK]')) {
                    await message.member.setNickname(current.replace('[AFK]', '').slice(0, 32)).catch(() => {});
                } else if (data.originalNick && data.originalNick !== current) {
                    await message.member.setNickname(data.originalNick.slice(0, 32)).catch(() => {});
                }
            } catch {}

            const duration = formatDuration(Date.now() - data.since);
            const embed = new EmbedBuilder()
                .setColor('#57F287')
                .setDescription(`👋 ${message.author}: **Welcome back!** You were AFK for **${duration}**.`);

            const msg = await message.channel.send({ embeds: [embed] }).catch(() => null);
            if (msg) setTimeout(() => msg.delete().catch(() => {}), 10000);
        }

        // ── Reply when someone mentions an AFK user ──
        async function checkAfkMentions(message) {
            if (message.author.bot || !message.guild) return;

            const afk = getAfkData(message.guild.id);
            if (!afk || Object.keys(afk).length === 0) return;

            const mentioned = [];
            for (const [userId, data] of Object.entries(afk)) {
                if (message.mentions.users.has(userId)) {
                    mentioned.push({ userId, ...data });
                }
            }
            if (mentioned.length === 0) return;

            // Cap spam if too many AFK users mentioned
            if (mentioned.length > 3) {
                const embed = new EmbedBuilder()
                    .setColor('#FEE75C')
                    .setDescription(`⚠️ Several users you mentioned are currently AFK.`);
                return message.channel.send({ embeds: [embed] }).catch(() => {});
            }

            for (const userData of mentioned) {
                const duration = formatDuration(Date.now() - userData.since);
                const embed = new EmbedBuilder()
                    .setColor('#FEE75C')
                    .setDescription(`💤 <@${userData.userId}> is currently **AFK** — *${duration}*\n📝 **Reason:** ${userData.reason}`);
                await message.channel.send({ embeds: [embed] }).catch(() => {});
            }
        }

        module.exports = { setAfk, checkAfkReturn, checkAfkMentions, formatDuration };