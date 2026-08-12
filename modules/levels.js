const { EmbedBuilder } = require('discord.js');
const { getGuildDb, getUserDb } = require('./database');

const XP_COOLDOWNS = new Map(); // userId -> timestamp

function getXpForLevel(level) {
    return 100 * Math.pow(level + 1, 2);
}

function getLevelFromXp(xp) {
    let level = 0;
    while (xp >= getXpForLevel(level)) {
        xp -= getXpForLevel(level);
        level++;
    }
    return level;
}

function getTotalXpForLevel(level) {
    let total = 0;
    for (let i = 0; i < level; i++) total += getXpForLevel(i);
    return total;
}

async function handleXpGain(message) {
    const db = getGuildDb(message.guild.id);
    const cfg = db.get('levelsConfig', {});
    if (cfg.enabled === false) return;

    // Check ignored channels and roles
    const ignoredChannels = cfg.ignoredChannels || [];
    const ignoredRoles = cfg.ignoredRoles || [];
    if (ignoredChannels.includes(message.channel.id)) return;
    if (ignoredRoles.some(r => message.member.roles.cache.has(r))) return;

    // Cooldown: 60s per user per guild
    const key = `${message.guild.id}:${message.author.id}`;
    const now = Date.now();
    if (XP_COOLDOWNS.has(key) && now - XP_COOLDOWNS.get(key) < 60000) return;
    XP_COOLDOWNS.set(key, now);

    const udb = getUserDb(message.guild.id, message.author.id);
    const rate = cfg.xpRate || 1;
    const gain = Math.floor((Math.random() * 15 + 10) * rate);
    const oldLevel = udb.data.level;

    udb.data.xp = (udb.data.xp || 0) + gain;
    udb.data.level = getLevelFromXp(udb.data.xp);
    udb.save();

    if (udb.data.level > oldLevel) {
        await handleLevelUp(message, udb.data.level, db, cfg);
    }
}

async function handleLevelUp(message, newLevel, db, cfg) {
    // ── Role rewards ──
    const roles      = db.get('levelRoles', []);
    const stackRoles = cfg.stackRoles !== false; // default: stack (keep old roles)

    for (const { level, roleId } of roles) {
        const role = message.guild.roles.cache.get(roleId);
        if (!role) continue;
        if (newLevel >= level) {
            try { await message.member.roles.add(roleId); } catch {}
        } else if (!stackRoles && message.member.roles.cache.has(roleId)) {
            try { await message.member.roles.remove(roleId); } catch {}
        }
    }

    // ── Level-up message via welcomeSystem ──
    try {
        const { triggerLevelUp } = require('./welcomeSystem');
        await triggerLevelUp(message, newLevel);
    } catch {}
}

async function handleLevelsCommand(message, args, client) {
    const db = getGuildDb(message.guild.id);
    const sub = args[0];
    const { isAdmin, isStaffOrAdmin } = require('./helpers');

    if (!sub || sub === 'rank') {
        const target = message.mentions.members.first() || message.member;
        const udb = getUserDb(message.guild.id, target.id);
        const xp = udb.data.xp || 0;
        const level = udb.data.level || 0;
        const needed = getXpForLevel(level);
        const progress = xp - getTotalXpForLevel(level);
        const bar = buildProgressBar(progress, needed);

        return message.channel.send({ embeds: [new EmbedBuilder()
            .setTitle(`📊 ${target.user.username}'s Level`)
            .setThumbnail(target.user.displayAvatarURL())
            .addFields(
                { name: 'Level', value: level.toString(), inline: true },
                { name: 'XP', value: `${progress}/${needed}`, inline: true },
                { name: 'Total XP', value: xp.toString(), inline: true },
                { name: 'Progress', value: bar }
            )
            .setColor('#5865F2')] });
    }

    if (sub === 'leaderboard') {
        const cfg2 = db.get('levelsConfig', {});

        // Rename leaderboard title
        if (args[1]?.toLowerCase() === 'rename') {
            if (!isStaffOrAdmin(message.member)) return message.reply('❌ No permission.');
            const title = args.slice(2).join(' ').trim();
            if (!title) return message.reply('❌ Usage: `.level leaderboard rename <title>`');
            cfg2.leaderboardTitle = title; db.set('levelsConfig', cfg2);
            return message.reply(`✅ Leaderboard title set to **${title}**.`);
        }

        const lbTitle = cfg2.leaderboardTitle || '🏆 XP Leaderboard';
        const page    = Math.max(1, parseInt(args[1]) || 1);
        const perPage = 10;
        const users   = db.data.users || {};
        const sorted  = Object.entries(users)
            .sort((a, b) => (b[1].xp || 0) - (a[1].xp || 0));
        const total   = sorted.length;
        const pages   = Math.max(1, Math.ceil(total / perPage));
        const slice   = sorted.slice((page - 1) * perPage, page * perPage);

        let desc = '';
        for (let i = 0; i < slice.length; i++) {
            const [uid, d] = slice[i];
            const rank = (page - 1) * perPage + i + 1;
            const user = await client.users.fetch(uid).catch(() => null);
            const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `**${rank}.**`;
            desc += `${medal} **${user ? user.username : 'Unknown'}** — Level ${d.level || 0} (${d.xp || 0} XP)\n`;
        }
        return message.channel.send({ embeds: [new EmbedBuilder()
            .setTitle(lbTitle)
            .setDescription(desc || 'No data yet.')
            .setFooter({ text: `Page ${page}/${pages} • Use .level leaderboard <page> to navigate` })
            .setColor('#FFD700').setTimestamp()] });
    }

    if (sub === 'config') {
        if (!isStaffOrAdmin(message.member)) return message.reply('❌ No permission.');
        const cfg = db.get('levelsConfig', {});
        return message.channel.send({ embeds: [new EmbedBuilder()
            .setTitle('⚙️ Level System Config')
            .addFields(
                { name: 'Enabled', value: cfg.enabled ? 'Yes' : 'No', inline: true },
                { name: 'XP Rate', value: (cfg.xpRate || 1).toString(), inline: true },
                { name: 'Message Mode', value: cfg.messageMode || 'channel', inline: true },
                { name: 'Level Message', value: cfg.levelMessage || '*(default)*' },
                { name: 'Ignored Channels', value: (cfg.ignoredChannels || []).map(c => `<#${c}>`).join(', ') || 'None' },
                { name: 'Ignored Roles', value: (cfg.ignoredRoles || []).map(r => `<@&${r}>`).join(', ') || 'None' }
            )
            .setColor('#5865F2')] });
    }

    if (sub === 'lock' || sub === 'disable') {
        if (!isStaffOrAdmin(message.member)) return message.reply('❌ No permission.');
        const cfg = db.get('levelsConfig', {}); cfg.enabled = false; db.set('levelsConfig', cfg);
        return message.reply('🔒 Level system **disabled**.');
    }

    if (sub === 'unlock' || sub === 'enable') {
        if (!isStaffOrAdmin(message.member)) return message.reply('❌ No permission.');
        const cfg = db.get('levelsConfig', {}); cfg.enabled = true; db.set('levelsConfig', cfg);
        return message.reply('🔓 Level system **enabled**.');
    }

    if (sub === 'setrate') {
        if (!isStaffOrAdmin(message.member)) return message.reply('❌ No permission.');
        const rate = parseFloat(args[1]);
        if (isNaN(rate) || rate <= 0) return message.reply('❌ Usage: `.level setrate <number>`');
        const cfg = db.get('levelsConfig', {}); cfg.xpRate = rate; db.set('levelsConfig', cfg);
        return message.reply(`✅ XP rate set to **${rate}x**.`);
    }

    if (sub === 'messages' || (sub === 'message' && args[1]?.toLowerCase() === 'view')) {
        const cfg2 = db.get('levelsConfig', {});
        const lmc  = db.get('levelMsgConfig', {});
        return message.channel.send({ embeds: [new EmbedBuilder().setTitle('📩 Level-Up Message Config')
            .addFields(
                { name: 'System Channel', value: lmc.channelId ? `<#${lmc.channelId}>` : 'Same channel as trigger', inline: true },
                { name: 'Mode',           value: lmc.mode || cfg2.messageMode || 'channel', inline: true },
                { name: 'Message Template', value: lmc.message || cfg2.levelMessage || '*(default)* 🎉 {user.mention} reached level **{level}**!' },
            ).setColor('#5865F2').setFooter({ text: 'Edit with .level message <template>  or  .levelupmsg message <template>' })] });
    }

    if (sub === 'message') {
        if (!isStaffOrAdmin(message.member)) return message.reply('❌ No permission.');
        const sub2 = args[1]?.toLowerCase();
        if (sub2 === 'view') {
            // handled above via messages/message view path — fall-through reaches here
            const cfg2 = db.get('levelsConfig', {});
            return message.reply(`Current level message: \`${cfg2.levelMessage || '(default)'}\``);
        }
        const msg = args.slice(1).join(' ');
        if (!msg) return message.reply('❌ Usage: `.levels message <text or embed code>` — Variables: `{user.mention}`, `{level}`, `{user.username}`, `{guild.name}`');
        const cfg = db.get('levelsConfig', {}); cfg.levelMessage = msg; db.set('levelsConfig', cfg);
        return message.reply(`✅ Level-up message set.`);
    }

    if (sub === 'messagemode') {
        if (!isStaffOrAdmin(message.member)) return message.reply('❌ No permission.');
        const mode = args[1];
        if (!['channel', 'dm', 'custom'].includes(mode)) return message.reply('❌ Modes: `channel`, `dm`, `custom`');
        const cfg = db.get('levelsConfig', {}); cfg.messageMode = mode; db.set('levelsConfig', cfg);
        return message.reply(`✅ Level message mode set to **${mode}**.`);
    }

    if (sub === 'ignore') {
        if (!isStaffOrAdmin(message.member)) return message.reply('❌ No permission.');
        const channel = message.mentions.channels.first();
        const role = message.mentions.roles.first();
        const cfg = db.get('levelsConfig', {});
        if (channel) {
            cfg.ignoredChannels = cfg.ignoredChannels || [];
            const idx = cfg.ignoredChannels.indexOf(channel.id);
            if (idx === -1) { cfg.ignoredChannels.push(channel.id); db.set('levelsConfig', cfg); return message.reply(`✅ <#${channel.id}> is now ignored for XP.`); }
            else { cfg.ignoredChannels.splice(idx, 1); db.set('levelsConfig', cfg); return message.reply(`✅ <#${channel.id}> is no longer ignored.`); }
        }
        if (role) {
            cfg.ignoredRoles = cfg.ignoredRoles || [];
            const idx = cfg.ignoredRoles.indexOf(role.id);
            if (idx === -1) { cfg.ignoredRoles.push(role.id); db.set('levelsConfig', cfg); return message.reply(`✅ <@&${role.id}> is now ignored for XP.`); }
            else { cfg.ignoredRoles.splice(idx, 1); db.set('levelsConfig', cfg); return message.reply(`✅ <@&${role.id}> is no longer ignored.`); }
        }
        return message.reply('❌ Mention a channel or role.');
    }

    if (sub === 'roles' || sub === 'list') {
        const roles = db.get('levelRoles', []).sort((a, b) => a.level - b.level);
        if (!roles.length) return message.reply('No level role rewards set. Add one with `.levels add <level> @role`.');
        const desc = roles.map(r => `Level **${r.level}** → <@&${r.roleId}>`).join('\n');
        const cfg2 = db.get('levelsConfig', {});
        return message.channel.send({ embeds: [new EmbedBuilder().setTitle('🎭 Level Role Rewards')
            .setDescription(desc).setColor('#5865F2')
            .setFooter({ text: `Stacking: ${cfg2.stackRoles !== false ? 'On' : 'Off'} • .levels stackroles to toggle` })] });
    }

    if (sub === 'add') {
        if (!isStaffOrAdmin(message.member)) return message.reply('❌ No permission.');
        const level = parseInt(args[1]);
        const role  = message.mentions.roles.first();
        if (isNaN(level) || !role) return message.reply('❌ Usage: `.levels add <level> @role`');
        const roles = db.get('levelRoles', []).filter(r => r.level !== level); // replace if same level exists
        roles.push({ level, roleId: role.id });
        db.set('levelRoles', roles.sort((a, b) => a.level - b.level));
        return message.reply(`✅ <@&${role.id}> will be awarded at level **${level}**.`);
    }

    if (sub === 'remove') {
        if (!isStaffOrAdmin(message.member)) return message.reply('❌ No permission.');
        const level = parseInt(args[1]);
        if (isNaN(level)) return message.reply('❌ Usage: `.levels remove <level>`');
        const roles = db.get('levelRoles', []).filter(r => r.level !== level);
        db.set('levelRoles', roles);
        return message.reply(`✅ Removed level **${level}** role reward.`);
    }

    if (sub === 'update') {
        if (!isStaffOrAdmin(message.member)) return message.reply('❌ No permission.');
        const level = parseInt(args[1]);
        const role  = message.mentions.roles.first();
        if (isNaN(level) || !role) return message.reply('❌ Usage: `.levels update <level> @role`');
        const roles = db.get('levelRoles', []).map(r => r.level === level ? { level, roleId: role.id } : r);
        if (!roles.some(r => r.level === level)) roles.push({ level, roleId: role.id });
        db.set('levelRoles', roles.sort((a, b) => a.level - b.level));
        return message.reply(`✅ Updated level **${level}** reward to <@&${role.id}>.`);
    }

    if (sub === 'stackroles') {
        if (!isStaffOrAdmin(message.member)) return message.reply('❌ No permission.');
        const cfg2 = db.get('levelsConfig', {});
        cfg2.stackRoles = cfg2.stackRoles === false; // toggle
        db.set('levelsConfig', cfg2);
        return message.reply(`✅ Role stacking **${cfg2.stackRoles ? 'enabled' : 'disabled'}**. ${cfg2.stackRoles ? 'Members keep all level roles.' : 'Members only keep the highest level role.'}`);
    }

    if (sub === 'reset') {
        if (!isStaffOrAdmin(message.member)) return message.reply('❌ No permission.');
        const target = message.mentions.members.first();
        if (!target) return message.reply('❌ Mention a user.');
        const udb = getUserDb(message.guild.id, target.id);
        udb.data.xp = 0; udb.data.level = 0; udb.save();
        return message.reply(`✅ Reset XP and level for ${target.user.username}.`);
    }

    if (sub === 'cleanup') {
        if (!isStaffOrAdmin(message.member)) return message.reply('❌ No permission.');
        if (!db.data.users) return message.reply('No user data to clean.');
        const before = Object.keys(db.data.users).length;
        for (const uid in db.data.users) {
            try { await message.guild.members.fetch(uid); } catch { delete db.data.users[uid]; }
        }
        db._save();
        return message.reply(`✅ Removed ${before - Object.keys(db.data.users).length} stale user entries.`);
    }

    if (sub === 'sync') {
        if (!isStaffOrAdmin(message.member)) return message.reply('❌ No permission.');
        const roles = db.get('levelRoles', []);
        let synced = 0;
        for (const [uid, udata] of Object.entries(db.data.users || {})) {
            try {
                const member = await message.guild.members.fetch(uid).catch(() => null);
                if (!member) continue;
                for (const { level, roleId } of roles) {
                    if ((udata.level || 0) >= level) {
                        await member.roles.add(roleId).catch(() => {});
                        synced++;
                    }
                }
            } catch {}
        }
        return message.reply(`✅ Synced level roles for members (${synced} role additions).`);
    }

    // setxp / removexp / setlevel (top-level commands, handled in index)
    return message.reply('❌ Unknown subcommand. Use `.level config`, `.level leaderboard`, etc.');
}

function buildProgressBar(current, max, length = 20) {
    const pct = Math.min(current / max, 1);
    const filled = Math.round(pct * length);
    return `[${'█'.repeat(filled)}${'░'.repeat(length - filled)}] ${Math.round(pct * 100)}%`;
}

module.exports = { handleXpGain, handleLevelsCommand };
