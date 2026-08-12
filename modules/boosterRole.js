/**
 * boosterRole.js — Custom booster roles (full-featured)
 *
 * Admin commands: .boosterrole enable/disable/sharemax/sharedmax/base/filter
 * User commands: .boosterrole create/rename/color/reset/share/unshare/shares/dominant/random/view/icon/shared/sharedlist/sharedcancel
 *
 * Storage (guild DB):
 * 'boosterRoleConfig'  → { enabled, shareMax, sharedMax, baseRoleId, filterWords: [] }
 * 'boosterRoles'       → { [userId]: { roleId, sharedWith: [] } }
 * 'pendingBoosterShares' → { [guildId_senderId_targetId]: { ... } }
 * 'sharedBoosterRoles'   → { [guildId]: { [userId]: [ { roleId, senderId } ] } }
 * 'boosterShareCooldowns' → { [guildId_senderId_targetId]: { declineCount, nextAllowed } }
 */

const https = require('https');
const { PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ComponentType } = require('discord.js');
const { getGuildDb } = require('./database');
const { isAdmin } = require('./helpers');
const { base, COLORS, greedOk, greedWarn } = require('../utils/embeds');

// ─── Helpers ──────────────────────────────────────────────────────────────────

const NAMED_COLORS = {
    red: '#FF0000', blue: '#0000FF', green: '#00FF00', yellow: '#FFFF00',
    orange: '#FF8C00', purple: '#8B008B', pink: '#FF69B4', cyan: '#00FFFF',
    white: '#FFFFFF', black: '#000000', magenta: '#FF00FF', lime: '#00FF7F',
    teal: '#008080', gold: '#FFD700', silver: '#C0C0C0', brown: '#8B4513',
    coral: '#FF6347', turquoise: '#40E0D0', violet: '#EE82EE', indigo: '#4B0082',
};

function resolveColor(raw) {
    if (!raw) return null;
    const lower = raw.toLowerCase();
    if (NAMED_COLORS[lower]) return NAMED_COLORS[lower];
    const hex = raw.startsWith('#') ? raw : `#${raw}`;
    if (/^#[0-9A-Fa-f]{6}$/.test(hex)) return hex;
    return null;
}

// ─── Role Icon Helpers ──────────────────────────────────────────────────────
const CUSTOM_EMOJI_REGEX = /<(a)?:(\w+):(\d+)>/;
const UNICODE_EMOJI_REGEX = /^[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F100}-\u{1F1FF}\u{1F200}-\u{1F2FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2300}-\u{23FF}\u{2B50}\u{2B55}\u{3030}\u{303D}\u{3297}\u{3299}\u{00a9}\u{00ae}\u{2122}\u{FE0F}\u{200D}]+$/u;

function extractRoleIcon(input) {
    if (!input) return null;
    const trimmed = input.trim();
    if (/^https?:\/\//.test(trimmed)) return { type: 'url', value: trimmed };
    const customMatch = trimmed.match(CUSTOM_EMOJI_REGEX);
    if (customMatch) return { type: 'url', value: `https://cdn.discordapp.com/emojis/${customMatch[3]}.png?size=256` };
    if (UNICODE_EMOJI_REGEX.test(trimmed)) return { type: 'emoji', value: trimmed };
    return null;
}

function isFilteredName(name, filterWords) {
    const lower = name.toLowerCase();
    return filterWords.some(w => lower.includes(w.toLowerCase()));
}

function fetchBuffer(url) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { timeout: 8000 }, res => {
            if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => resolve(Buffer.concat(chunks)));
            res.on('error', reject);
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    });
}

async function getDominantColor(avatarURL) {
    try {
        const url = avatarURL.replace(/\?.*$/, '') + '?size=64&format=png';
        const buf = await fetchBuffer(url);
        const zlib = require('zlib');
        const idatChunks = [];
        let offset = 8;
        while (offset < buf.length - 12) {
            const length = buf.readUInt32BE(offset);
            const type = buf.slice(offset + 4, offset + 8).toString('ascii');
            if (type === 'IDAT') idatChunks.push(buf.slice(offset + 8, offset + 8 + length));
            if (type === 'IEND') break;
            offset += 12 + length;
        }
        if (idatChunks.length === 0) return null;
        const compressed = Buffer.concat(idatChunks);
        const decompressed = await new Promise((res, rej) => {
            zlib.inflate(compressed, (err, result) => err ? rej(err) : res(result));
        });
        let width = 64, height = 64;
        let ihdrOffset = 8;
        while (ihdrOffset < buf.length - 12) {
            const len = buf.readUInt32BE(ihdrOffset);
            const t = buf.slice(ihdrOffset + 4, ihdrOffset + 8).toString('ascii');
            if (t === 'IHDR') { width = buf.readUInt32BE(ihdrOffset + 8); height = buf.readUInt32BE(ihdrOffset + 12); break; }
            ihdrOffset += 12 + len;
        }
        const bytesPerPixel = 4;
        const colorMap = new Map();
        for (let y = 0; y < height; y += 4) {
            const rowStart = y * (width * bytesPerPixel + 1) + 1;
            for (let x = 0; x < width; x += 4) {
                const px = rowStart + x * bytesPerPixel;
                if (px + 3 >= decompressed.length) continue;
                const [r, g, b, a] = [decompressed[px], decompressed[px+1], decompressed[px+2], decompressed[px+3]];
                if (a < 128) continue;
                const max = Math.max(r, g, b), min = Math.min(r, g, b);
                if (max < 60) continue;
                if (max - min < 30 && max < 200) continue;
                const key = `${Math.round(r/32)*32},${Math.round(g/32)*32},${Math.round(b/32)*32}`;
                colorMap.set(key, (colorMap.get(key) || 0) + 1);
            }
        }
        if (colorMap.size === 0) return null;
        let bestKey = null, bestCount = 0;
        for (const [key, count] of colorMap) { if (count > bestCount) { bestCount = count; bestKey = key; } }
        if (!bestKey) return null;
        const [r, g, b] = bestKey.split(',').map(Number);
        return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
    } catch { return null; }
}

function randomBrightColor() {
    const h = Math.random(), s = 0.7 + Math.random() * 0.3, v = 0.8 + Math.random() * 0.2;
    const i = Math.floor(h * 6), f = h * 6 - i;
    const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
    let r, g, b;
    switch (i % 6) { case 0: r=v; g=t; b=p; break; case 1: r=q; g=v; b=p; break; case 2: r=p; g=v; b=t; break; case 3: r=p; g=q; b=v; break; case 4: r=t; g=p; b=v; break; case 5: r=v; g=p; b=q; break; }
    const toHex = x => Math.round(x * 255).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

async function placeRole(guild, role, baseRoleId) {
    try {
        if (baseRoleId) {
            const baseRole = guild.roles.cache.get(baseRoleId);
            if (baseRole) { await role.setPosition(Math.max(1, baseRole.position - 1)).catch(() => {}); return; }
        }
        const botTop = guild.members.me.roles.highest.position;
        await role.setPosition(Math.max(1, botTop - 1)).catch(() => {});
    } catch {}
}

// ─── Cooldown Helpers ───────────────────────────────────────────────────────

function getCooldownKey(guildId, senderId, targetId) { return `${guildId}_${senderId}_${targetId}`; }

function getCooldownMs(declineCount) {
    if (declineCount === 0) return 10000;      // 10 seconds (initial / no response)
    if (declineCount === 1) return 60000;      // 1 minute
    if (declineCount === 2) return 1800000;     // 30 minutes
    if (declineCount === 3) return 10800000;   // 3 hours
    return 86400000;                           // 1 day (4+ declines)
}

function getSharedRoles(db, guildId, userId) {
    const shared = db.get('sharedBoosterRoles', {});
    if (!shared[guildId]) shared[guildId] = {};
    if (!shared[guildId][userId]) shared[guildId][userId] = [];
    return shared;
}

function addSharedRole(db, guildId, userId, roleId, senderId) {
    const shared = getSharedRoles(db, guildId, userId);
    shared[guildId][userId].push({ roleId, senderId, receivedAt: Date.now() });
    db.set('sharedBoosterRoles', shared);
}

function removeSharedRole(db, guildId, userId, roleId) {
    const shared = db.get('sharedBoosterRoles', {});
    if (!shared[guildId] || !shared[guildId][userId]) return false;
    const before = shared[guildId][userId].length;
    shared[guildId][userId] = shared[guildId][userId].filter(s => s.roleId !== roleId);
    const removed = before > shared[guildId][userId].length;
    db.set('sharedBoosterRoles', shared);
    return removed;
}

function countSharedRoles(db, guildId, userId) {
    const shared = db.get('sharedBoosterRoles', {});
    return shared[guildId]?.[userId]?.length || 0;
}

// ─── Main command handler ─────────────────────────────────────────────────────

async function handleBoosterRoleCommand(message, args) {
    const sub = (args[0] || '').toLowerCase();
    const db = getGuildDb(message.guild.id);

    const cfg = db.get('boosterRoleConfig', { enabled: false, shareMax: 0, sharedMax: 0, baseRoleId: null, filterWords: [] });
    const map = db.get('boosterRoles', {});

    const hasManageRoles = message.member.permissions.has(PermissionFlagsBits.ManageRoles);
    const memberIsAdmin = isAdmin(message.member);
    const canAdmin = hasManageRoles || memberIsAdmin;

    // ══════════════════════════════════════════════════════════════════════════
    // ADMIN SUBCOMMANDS
    // ══════════════════════════════════════════════════════════════════════════

    if (sub === 'enable') {
        if (!canAdmin) return message.reply({ embeds: [base(COLORS.error).setTitle('❌ No Permission').setDescription('You need **Manage Roles** or admin to use this command.')] });
        cfg.enabled = true; db.set('boosterRoleConfig', cfg);
        return message.reply({ embeds: [base(COLORS.success).setTitle('✅ Booster Roles Enabled').setDescription('The booster role system is now **enabled** for this server.')] });
    }

    if (sub === 'disable') {
        if (!canAdmin) return message.reply({ embeds: [base(COLORS.error).setTitle('❌ No Permission').setDescription('You need **Manage Roles** or admin to use this command.')] });
        cfg.enabled = false; db.set('boosterRoleConfig', cfg);
        return message.reply({ embeds: [base(COLORS.warning).setTitle('⚠️ Booster Roles Disabled').setDescription('The booster role system has been **disabled**. Existing roles are untouched.')] });
    }

    if (sub === 'sharemax') {
        if (!canAdmin) return message.reply({ embeds: [base(COLORS.error).setTitle('❌ No Permission').setDescription('You need **Manage Roles** or admin to use this command.')] });
        const val = parseInt(args[1], 10);
        if (isNaN(val) || val < 0 || val > 99)
            return message.reply({ embeds: [base(COLORS.error).setTitle('❌ Invalid Value').setDescription('Provide a number between **0** and **99**. `0` disables sharing.')] });
        cfg.shareMax = val; db.set('boosterRoleConfig', cfg);
        return message.reply({ embeds: [base(COLORS.success).setTitle('✅ Share Limit Updated').setDescription(val === 0 ? 'Role sharing has been **disabled**.' : `Boosters can now share their role with up to **${val}** user(s).`)] });
    }

    // ── sharedmax ────────────────────────────────────────────────────────────
    if (sub === 'sharedmax') {
        if (!canAdmin) return message.reply({ embeds: [base(COLORS.error).setTitle('❌ No Permission').setDescription('You need **Manage Roles** or admin to use this command.')] });
        const val = parseInt(args[1], 10);
        if (isNaN(val) || val < 0 || val > 99)
            return message.reply({ embeds: [base(COLORS.error).setTitle('❌ Invalid Value').setDescription('Provide a number between **0** and **99**. `0` means unlimited shared roles.')]});
        cfg.sharedMax = val; db.set('boosterRoleConfig', cfg);
        return message.reply({ embeds: [base(COLORS.success).setTitle('✅ Shared Max Updated').setDescription(val === 0 ? 'Users can now receive **unlimited** shared booster roles.' : `Users can now receive up to **${val}** shared booster role(s).`)] });
    }

    if (sub === 'base') {
        if (!canAdmin) return message.reply({ embeds: [base(COLORS.error).setTitle('❌ No Permission').setDescription('You need **Manage Roles** or admin to use this command.')] });
        const mentioned = message.mentions.roles.first();
        if (!mentioned) return message.reply({ embeds: [base(COLORS.error).setTitle('❌ No Role').setDescription('Mention a role. Usage: `.boosterrole base @role`')] });
        cfg.baseRoleId = mentioned.id; db.set('boosterRoleConfig', cfg);
        return message.reply({ embeds: [base(COLORS.success).setTitle('✅ Base Role Set').setDescription(`Booster roles will be placed just below <@&${mentioned.id}>.`)] });
    }

    if (sub === 'filter') {
        if (!canAdmin) return message.reply({ embeds: [base(COLORS.error).setTitle('❌ No Permission').setDescription('You need **Manage Roles** or admin to use this command.')] });
        if (!Array.isArray(cfg.filterWords)) cfg.filterWords = [];
        const action = (args[1] || '').toLowerCase();

        if (action === 'list') {
            if (cfg.filterWords.length === 0) return message.reply({ embeds: [base(COLORS.info).setTitle('🔍 Filter List').setDescription('No blacklisted words yet.')] });
            return message.reply({ embeds: [base(COLORS.info).setTitle('🔍 Blacklisted Words').setDescription(cfg.filterWords.map((w, i) => `\`${i + 1}.\` ${w}`).join('\n'))] });
        }
        if (action === 'remove') {
            const word = args.slice(2).join(' ').trim().toLowerCase();
            if (!word) return message.reply({ embeds: [base(COLORS.error).setTitle('❌').setDescription('Provide a word to remove.')] });
            const idx = cfg.filterWords.findIndex(w => w.toLowerCase() === word);
            if (idx === -1) return message.reply({ embeds: [base(COLORS.warning).setTitle('Not Found').setDescription(`\`${word}\` is not in the blacklist.`)] });
            cfg.filterWords.splice(idx, 1); db.set('boosterRoleConfig', cfg);
            return message.reply({ embeds: [base(COLORS.success).setTitle('✅ Word Removed').setDescription(`\`${word}\` has been removed from the filter list.`)] });
        }
        const word = args.slice(1).join(' ').trim();
        if (!word) return message.reply({ embeds: [base(COLORS.error).setTitle('❌').setDescription('Usage:\n`.boosterrole filter <word>` — add\n`.boosterrole filter remove <word>` — remove\n`.boosterrole filter list` — view all')] });
        if (cfg.filterWords.includes(word.toLowerCase())) return message.reply({ embeds: [base(COLORS.warning).setTitle('Already Exists').setDescription(`\`${word}\` is already in the filter list.`)] });
        cfg.filterWords.push(word.toLowerCase()); db.set('boosterRoleConfig', cfg);
        return message.reply({ embeds: [base(COLORS.success).setTitle('✅ Word Added').setDescription(`\`${word}\` has been added to the filter list. Boosters cannot use it in role names.`)] });
    }

    // ══════════════════════════════════════════════════════════════════════════
    // USER SUBCOMMANDS
    // ══════════════════════════════════════════════════════════════════════════

    if (!cfg.enabled && !memberIsAdmin)
        return message.reply({ embeds: [base(COLORS.error).setTitle('❌ System Disabled').setDescription('The booster role system is not enabled on this server.')] });

    const isBooster = message.member.premiumSince != null;

    // ── create ──────────────────────────────────────────────────────────────
    if (sub === 'create') {
        if (!isBooster && !memberIsAdmin)
            return message.reply({ embeds: [base(COLORS.error).setTitle('❌ Not a Booster').setDescription('Only **server boosters** can create a custom booster role.')] });

        const entry = map[message.author.id];
        if (entry && message.guild.roles.cache.has(entry.roleId))
            return message.reply({ embeds: [base(COLORS.warning).setTitle('Already Exists').setDescription(`You already have a booster role: <@&${entry.roleId}>\nUse \`.boosterrole view\` to see it.`)] });

        const customName = args.slice(1).join(' ').trim();
        const roleName = customName || `${message.author.username}'s Role`;
        if (roleName.length > 100) return message.reply({ embeds: [base(COLORS.error).setTitle('❌ Name Too Long').setDescription('Role names must be 100 characters or fewer.')] });
        if (!Array.isArray(cfg.filterWords)) cfg.filterWords = [];
        if (isFilteredName(roleName, cfg.filterWords))
            return message.reply({ embeds: [base(COLORS.error).setTitle('❌ Filtered Name').setDescription('That name contains a blacklisted word. Please choose a different name.')] });

        try {
            const botTop = message.guild.members.me.roles.highest.position;
            const role = await message.guild.roles.create({
                name: roleName, color: '#5865F2', position: Math.max(1, botTop - 1),
                reason: `Custom booster role for ${message.author.tag}`,
            });
            await placeRole(message.guild, role, cfg.baseRoleId);
            await message.member.roles.add(role).catch(() => {});
            map[message.author.id] = { roleId: role.id, sharedWith: [] };
            db.set('boosterRoles', map);
            return message.reply({ embeds: [base(COLORS.success).setTitle('✅ Booster Role Created')
                .setDescription(`Your custom role <@&${role.id}> has been created!`)
                .addFields({ name: 'Customise', value: '`.boosterrole rename <name>` — rename it\n`.boosterrole color <color>` — change color\n`.boosterrole dominant` — use your avatar color\n`.boosterrole random` — random bright color\n`.boosterrole icon <emoji|url|remove>` — set role icon', inline: false })] });
        } catch (e) {
            return message.reply({ embeds: [base(COLORS.error).setTitle('❌ Failed').setDescription(`Could not create role: ${e.message}`)] });
        }
    }

    const entry = map[message.author.id];
    const role = entry ? message.guild.roles.cache.get(entry.roleId) : null;

    function noRole() {
        return message.reply({ embeds: [base(COLORS.error).setTitle('❌ No Booster Role').setDescription('You don\'t have a booster role yet. Create one with `.boosterrole create`.')] });
    }

    // ── view ─────────────────────────────────────────────────────────────────
    if (sub === 'view' || sub === '') {
        if (!entry || !role) return noRole();
        const shared = entry.sharedWith || [];
        const sharedList = shared.length > 0 ? shared.map(id => `<@${id}>`).join(', ') : 'No one';
        return message.reply({ embeds: [base(COLORS.primary).setTitle('🎨 Your Booster Role')
            .addFields(
                { name: 'Role', value: `<@&${role.id}>`, inline: true },
                { name: 'Name', value: role.name, inline: true },
                { name: 'Color', value: role.hexColor || 'Default', inline: true },
                { name: 'Position', value: String(role.position), inline: true },
                { name: 'Members', value: String(role.members.size), inline: true },
                { name: 'Shared With', value: sharedList, inline: false },
            ).setFooter({ text: 'Kaido' })] });
    }

    // ── rename ───────────────────────────────────────────────────────────────
    if (sub === 'rename') {
        if (!entry || !role) return noRole();
        const name = args.slice(1).join(' ').trim();
        if (!name || name.length > 100) return message.reply({ embeds: [base(COLORS.error).setTitle('❌').setDescription('Provide a name (1–100 characters). Usage: `.boosterrole rename <name>`')] });
        if (!Array.isArray(cfg.filterWords)) cfg.filterWords = [];
        if (isFilteredName(name, cfg.filterWords)) return message.reply({ embeds: [base(COLORS.error).setTitle('❌ Filtered Name').setDescription('That name contains a blacklisted word. Choose a different name.')] });
        await role.setName(name);
        return message.reply({ embeds: [base(COLORS.success).setTitle('✅ Role Renamed').setDescription(`Your booster role is now called **${name}**.`)] });
    }

    // ── color / colour ───────────────────────────────────────────────────────
    if (sub === 'color' || sub === 'colour') {
        if (!entry || !role) return noRole();
        const raw = args.slice(1).join(' ').trim();
        if (!raw) return message.reply({ embeds: [base(COLORS.error).setTitle('❌').setDescription('Provide a color. Usage: `.boosterrole color <color>`\nExamples: `#ff5733`, `red`, `royalblue`')] });
        const hex = resolveColor(raw);
        if (!hex) return message.reply({ embeds: [base(COLORS.error).setTitle('❌ Invalid Color').setDescription('Use a valid hex code like `#ff5733` or a color name like `red`, `blue`, `purple`.')] });
        try { await role.setColor(hex); return message.reply({ embeds: [base(hex).setTitle('✅ Color Updated').setDescription(`Your booster role color is now **${hex}**.`)] }); }
        catch { return message.reply({ embeds: [base(COLORS.error).setTitle('❌ Failed').setDescription('Could not update the role color.')] }); }
    }

    // ── random ───────────────────────────────────────────────────────────────
    if (sub === 'random') {
        if (!entry || !role) return noRole();
        const hex = randomBrightColor();
        try { await role.setColor(hex); return message.reply({ embeds: [base(hex).setTitle('🎲 Random Color Set').setDescription(`Your booster role color has been set to **${hex}**.`)] }); }
        catch { return message.reply({ embeds: [base(COLORS.error).setTitle('❌ Failed').setDescription('Could not update the role color.')] }); }
    }

    // ── dominant ─────────────────────────────────────────────────────────────
    if (sub === 'dominant') {
        if (!entry || !role) return noRole();
        const avatarURL = message.member.displayAvatarURL({ extension: 'png', size: 64, forceStatic: true });
        if (!avatarURL) return message.reply({ embeds: [base(COLORS.error).setTitle('❌ No Avatar').setDescription('You don\'t have a custom avatar set.')] });
        const loadMsg = await message.reply({ embeds: [base(COLORS.muted).setTitle('⏳ Extracting Color…').setDescription('Analysing your avatar for the dominant color…')] });
        const hex = await getDominantColor(avatarURL) || '#9B59B6';
        try { await role.setColor(hex); await loadMsg.edit({ embeds: [base(hex).setTitle('🎨 Dominant Color Set').setDescription(`Your avatar's dominant color (**${hex}**) has been applied to your role.`)] }); }
        catch { await loadMsg.edit({ embeds: [base(COLORS.error).setTitle('❌ Failed').setDescription('Could not update the role color.')] }); }
        return;
    }

    // ── reset ─────────────────────────────────────────────────────────────────
    if (sub === 'reset') {
        if (!entry || !role) return noRole();
        await role.delete('User reset their booster role').catch(() => {});
        delete map[message.author.id]; db.set('boosterRoles', map);
        return message.reply({ embeds: [base(COLORS.success).setTitle('✅ Role Reset').setDescription('Your booster role and all shares have been removed.')] });
    }

    // ── icon ─────────────────────────────────────────────────────────────────
    if (sub === 'icon') {
        if (!entry || !role) return noRole();
        const iconArg = args.slice(1).join(' ').trim();
        if (!iconArg) return message.reply(greedWarn(message.member, 'Provide an emoji or image URL. Usage: `.boosterrole icon <emoji|url>` or `.boosterrole icon remove`'));
        if (iconArg.toLowerCase() === 'remove') {
            try { await role.edit({ icon: null, unicodeEmoji: null }); db.set('boosterRoles', map); return message.reply(greedOk(message.member, `Role icon removed from <@&${role.id}>.`)); }
            catch (e) { return message.reply(greedWarn(message.member, `Failed to remove icon: ${e.message}`)); }
        }
        const extracted = extractRoleIcon(iconArg);
        if (!extracted) return message.reply(greedWarn(message.member, 'Invalid input. Provide an image URL, a custom emoji, or a unicode emoji.'));
        try {
            if (extracted.type === 'emoji') {
                await role.edit({ icon: null, unicodeEmoji: extracted.value });
            } else {
                await role.edit({ icon: extracted.value, unicodeEmoji: null });
            }
            db.set('boosterRoles', map);
            return message.reply(greedOk(message.member, `Role icon updated for <@&${role.id}>.`));
        }
        catch (e) { return message.reply(greedWarn(message.member, `Failed to set icon: ${e.message}. The server needs **Level 2** boost to set role icons.`)); }
    }

    // ── share ─────────────────────────────────────────────────────────────────
    if (sub === 'share') {
        if (!entry || !role) return noRole();
        if (cfg.shareMax === 0) return message.reply(greedWarn(message.member, 'Role sharing is not enabled on this server.'));

        const target = message.mentions.members?.first();
        if (!target) return message.reply(greedWarn(message.member, 'Mention a user to share with. Usage: `.boosterrole share @user`'));
        if (target.id === message.author.id) return message.reply(greedWarn(message.member, 'You can\'t share your role with yourself.'));

        if (!Array.isArray(entry.sharedWith)) entry.sharedWith = [];
        if (entry.sharedWith.includes(target.id))
            return message.reply(greedWarn(message.member, `You've already shared your role with ${target}.`));
        if (entry.sharedWith.length >= cfg.shareMax)
            return message.reply(greedWarn(message.member, `You can only share your role with up to **${cfg.shareMax}** user(s).`));

        // Check target's shared max
        const targetSharedCount = countSharedRoles(db, message.guild.id, target.id);
        if (cfg.sharedMax > 0 && targetSharedCount >= cfg.sharedMax)
            return message.reply(greedWarn(message.member, `<:warn:1528892150698348727> ${target} has the max amount of shared roles in this server, ask him to cancel by typing \`,br shared cancel\``));

        // Check cooldown
        const cooldowns = db.get('boosterShareCooldowns', {});
        const cdKey = getCooldownKey(message.guild.id, message.author.id, target.id);
        const cd = cooldowns[cdKey];
        if (cd && Date.now() < cd.nextAllowed) {
            const remaining = Math.ceil((cd.nextAllowed - Date.now()) / 1000);
            const mins = Math.floor(remaining / 60);
            const secs = remaining % 60;
            const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
            return message.reply(greedWarn(message.member, `Please wait **${timeStr}** before requesting to share with ${target} again.`));
        }

        // Check existing pending
        const pending = db.get('pendingBoosterShares', {});
        const pendingKey = `${message.guild.id}_${message.author.id}_${target.id}`;
        if (pending[pendingKey])
            return message.reply(greedWarn(message.member, `You already have a pending share request to ${target}. Please wait for their response.`));

        // Send request silently (no bot reply)
        const shareRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`brrole_accept_${message.guild.id}_${message.author.id}_${target.id}`).setLabel('Accept').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`brrole_decline_${message.guild.id}_${message.author.id}_${target.id}`).setLabel('Decline').setStyle(ButtonStyle.Danger),
        );
        const requestEmbed = new EmbedBuilder()
            .setColor(COLORS.primary)
            .setTitle('🎨 Booster Role Share Request')
            .setDescription(`${target}, <@${message.author.id}> wants to share their booster role <@&${role.id}> with you.\n\nDo you want to accept?`);

        try {
            const requestMsg = await message.channel.send({ content: `${target}`, embeds: [requestEmbed], components: [shareRow] });
            pending[pendingKey] = {
                targetId: target.id, senderId: message.author.id, roleId: role.id,
                guildId: message.guild.id, channelId: message.channel.id, messageId: requestMsg.id,
                expiresAt: Date.now() + 86400000,
            };
            db.set('pendingBoosterShares', pending);
            return; // Silent — no bot reply
        } catch (e) {
            return message.reply(greedWarn(message.member, `Failed to send share request: ${e.message}`));
        }
    }

    // ── unshare ───────────────────────────────────────────────────────────────
    if (sub === 'unshare') {
        if (!entry || !role) return noRole();
        const target = message.mentions.members?.first();
        if (!target) return message.reply({ embeds: [base(COLORS.error).setTitle('❌ No User').setDescription('Mention a user to unshare from. Usage: `.boosterrole unshare @user`')] });
        if (!Array.isArray(entry.sharedWith)) entry.sharedWith = [];
        const idx = entry.sharedWith.indexOf(target.id);
        if (idx === -1) return message.reply({ embeds: [base(COLORS.warning).setTitle('Not Shared').setDescription(`You haven't shared your role with ${target}.`)] });
        entry.sharedWith.splice(idx, 1); db.set('boosterRoles', map);
        removeSharedRole(db, message.guild.id, target.id, role.id);
        await target.roles.remove(role).catch(() => {});
        return message.reply({ embeds: [base(COLORS.success).setTitle('✅ Share Removed').setDescription(`${target} no longer has your booster role.`)] });
    }

    // ── shares ────────────────────────────────────────────────────────────────
    if (sub === 'shares') {
        if (!entry || !role) return noRole();
        if (!Array.isArray(entry.sharedWith)) entry.sharedWith = [];
        if (entry.sharedWith.length === 0) return message.reply({ embeds: [base(COLORS.info).setTitle('📋 Shared With').setDescription('You haven\'t shared your role with anyone.\nUse `.boosterrole share @user` to share it.')] });
        const limit = cfg.shareMax || '∞';
        return message.reply({ embeds: [base(COLORS.info).setTitle('📋 Shared With').setDescription(entry.sharedWith.map((id, i) => `\`${i + 1}.\` <@${id}>`).join('\n')).setFooter({ text: `${entry.sharedWith.length}/${limit} slots used • Kaido` })] });
    }

    // ── shared (receiver commands) ────────────────────────────────────────────
    if (sub === 'shared') {
        const sharedAction = (args[1] || '').toLowerCase();

        // ── shared cancel ──
        if (sharedAction === 'cancel') {
            const userShared = getSharedRoles(db, message.guild.id, message.author.id);
            const myShared = userShared[message.guild.id]?.[message.author.id] || [];

            if (myShared.length === 0)
                return message.reply({ embeds: [base(COLORS.warning).setTitle('No Shared Roles').setDescription('You don\'t have any shared booster roles to cancel.')] });

            // If only 1 shared role, cancel it directly
            if (myShared.length === 1) {
                const sharedRole = myShared[0];
                const r = message.guild.roles.cache.get(sharedRole.roleId);
                if (r) await message.member.roles.remove(r).catch(() => {});
                removeSharedRole(db, message.guild.id, message.author.id, sharedRole.roleId);
                return message.reply({ embeds: [new EmbedBuilder()
                    .setColor(COLORS.success)
                    .setDescription(`<:checkmark:1528890895859056680> Your shared booster role <@&${sharedRole.roleId}> has been removed from you.`)] });
            }

            // Multiple shared roles — ask which one to cancel via buttons
            const rows = [];
            let currentRow = new ActionRowBuilder();
            for (let i = 0; i < myShared.length && i < 25; i++) {
                const s = myShared[i];
                const r = message.guild.roles.cache.get(s.roleId);
                const label = r ? r.name.slice(0, 80) : 'Unknown Role';
                currentRow.addComponents(
                    new ButtonBuilder()
                        .setCustomId(`brrole_cancel_${message.guild.id}_${message.author.id}_${s.roleId}`)
                        .setLabel(label)
                        .setStyle(ButtonStyle.Primary)
                );
                if (currentRow.components.length === 5 || i === myShared.length - 1) {
                    rows.push(currentRow);
                    currentRow = new ActionRowBuilder();
                }
            }

            const cancelEmbed = new EmbedBuilder()
                .setColor(COLORS.primary)
                .setTitle('🎨 Cancel Shared Booster Role')
                .setDescription('You have multiple shared booster roles. Click the button below to cancel one:');

            const msg = await message.reply({ embeds: [cancelEmbed], components: rows });

            // Collector for 60 seconds
            const collector = msg.createMessageComponentCollector({
                componentType: ComponentType.Button,
                time: 60000,
                filter: i => i.user.id === message.author.id && i.customId.startsWith('brrole_cancel_'),
            });

            collector.on('collect', async (i) => {
                const parts = i.customId.split('_');
                const roleId = parts[4];
                const r = message.guild.roles.cache.get(roleId);
                if (r) await message.member.roles.remove(r).catch(() => {});
                removeSharedRole(db, message.guild.id, message.author.id, roleId);
                await i.update({
                    embeds: [new EmbedBuilder()
                        .setColor(COLORS.success)
                        .setDescription(`<:checkmark:1528890895859056680> Your shared booster role <@&${roleId}> has been removed from you.`)],
                    components: [],
                });
                collector.stop();
            });

            collector.on('end', async (_, reason) => {
                if (reason === 'time') {
                    await msg.edit({ components: [] }).catch(() => {});
                }
            });

            return;
        }

        // ── shared list ──
        if (sharedAction === 'list') {
            const userShared = getSharedRoles(db, message.guild.id, message.author.id);
            const myShared = userShared[message.guild.id]?.[message.author.id] || [];

            if (myShared.length === 0)
                return message.reply({ embeds: [base(COLORS.info).setTitle('📋 Your Shared Booster Roles').setDescription('You don\'t have any shared booster roles from other people.')] });

            const desc = [];
            for (let i = 0; i < myShared.length; i++) {
                const s = myShared[i];
                const r = message.guild.roles.cache.get(s.roleId);
                const sender = await message.guild.members.fetch(s.senderId).catch(() => null);
                desc.push(`\`${i + 1}.\` <@&${s.roleId}> — from ${sender ? `<@${s.senderId}>` : 'Unknown'}`);
            }

            const maxStr = cfg.sharedMax > 0 ? `${myShared.length}/${cfg.sharedMax}` : `${myShared.length}/∞`;
            return message.reply({ embeds: [base(COLORS.info).setTitle('📋 Your Shared Booster Roles')
                .setDescription(desc.join('\n'))
                .setFooter({ text: `${maxStr} slots used • Kaido` })] });
        }

        return message.reply({ embeds: [base(COLORS.info).setTitle('🎨 Shared Commands')
            .setDescription('`.boosterrole shared cancel` — remove a shared booster role from yourself\n`.boosterrole shared list` — view all shared booster roles you have')] });
    }

    // ── help / default ────────────────────────────────────────────────────────
    return message.reply({ embeds: [base(COLORS.primary).setTitle('🎨 Booster Role — Help')
        .addFields(
            { name: '👤 User Commands', value: [
                '`.boosterrole create [name]` — create your role',
                '`.boosterrole view` — view your role info',
                '`.boosterrole rename <name>` — rename it',
                '`.boosterrole color <color>` — set color',
                '`.boosterrole dominant` — use avatar dominant color',
                '`.boosterrole random` — random bright color',
                '`.boosterrole icon <emoji|url|remove>` — set or remove role icon',
                '`.boosterrole share @user` — share with a user',
                '`.boosterrole unshare @user` — remove a share',
                '`.boosterrole shares` — list who you shared with',
                '`.boosterrole shared cancel` — remove a shared role from yourself',
                '`.boosterrole shared list` — view roles shared TO you',
                '`.boosterrole reset` — delete your role',
            ].join('\n'), inline: false },
            { name: '⚙️ Admin Commands', value: [
                '`.boosterrole enable/disable` — toggle system',
                '`.boosterrole sharemax <0-99>` — max users you can share TO',
                '`.boosterrole sharedmax <0-99>` — max shared roles a user can RECEIVE',
                '`.boosterrole base @role` — set base role position',
                '`.boosterrole filter <word>` — blacklist a word',
                '`.boosterrole filter remove <word>` — remove from blacklist',
                '`.boosterrole filter list` — view blacklist',
            ].join('\n'), inline: false },
        ).setFooter({ text: 'Kaido' })] });
}

// ─── handleBoostRemoved ───────────────────────────────────────────────────────

async function handleBoostRemoved(member) {
    const db = getGuildDb(member.guild.id);
    const map = db.get('boosterRoles', {});
    const entry = map[member.id];
    if (!entry) return;
    const role = member.guild.roles.cache.get(entry.roleId);
    if (role) await role.delete('Member stopped boosting').catch(() => {});
    delete map[member.id]; db.set('boosterRoles', map);
}

// ─── handleBoosterShareButton ─────────────────────────────────────────────────

async function handleBoosterShareButton(interaction, client) {
    const parts = interaction.customId.split('_');
    const action = parts[1]; // 'accept', 'decline', or 'cancel'
    const guildId = parts[2];
    const senderId = parts[3];
    const targetId = parts[4];

    // ── Handle cancel button (shared cancel with multiple roles) ──
    if (action === 'cancel') {
        if (interaction.user.id !== targetId) return interaction.reply({ content: '❌ This is not for you.', ephemeral: true });
        const roleId = parts[4]; // for cancel, targetId IS roleId
        const db = getGuildDb(guildId);
        const r = interaction.guild?.roles.cache.get(roleId);
        if (r) await interaction.member.roles.remove(r).catch(() => {});
        removeSharedRole(db, guildId, targetId, roleId);
        return interaction.update({
            embeds: [new EmbedBuilder().setColor(COLORS.success).setDescription(`<:checkmark:1528890895859056680> Your shared booster role <@&${roleId}> has been removed from you.`)],
            components: [],
        });
    }

    // Only the intended recipient can respond
    if (interaction.user.id !== targetId) return interaction.reply({ content: '❌ This request is not for you.', ephemeral: true });

    const db = getGuildDb(guildId);
    const pending = db.get('pendingBoosterShares', {});
    const pendingKey = `${guildId}_${senderId}_${targetId}`;
    const req = pending[pendingKey];

    const cooldowns = db.get('boosterShareCooldowns', {});
    const cdKey = getCooldownKey(guildId, senderId, targetId);

    if (!req || Date.now() > req.expiresAt) {
        const channelId = req?.channelId; const messageId = req?.messageId;
        delete pending[pendingKey]; db.set('pendingBoosterShares', pending);
        if (channelId && messageId) {
            try { const ch = await client.channels.fetch(channelId).catch(() => null); if (ch) { const msg = await ch.messages.fetch(messageId).catch(() => null); if (msg) await msg.edit({ content: '❌ This share request has expired.', embeds: [], components: [] }); } } catch {}
        }
        return interaction.reply({ content: '❌ This share request has expired.', ephemeral: true });
    }

    delete pending[pendingKey]; db.set('pendingBoosterShares', pending);

    // ── DECLINE ──
    if (action === 'decline') {
        // Increment decline count
        if (!cooldowns[cdKey]) cooldowns[cdKey] = { declineCount: 0, nextAllowed: 0 };
        cooldowns[cdKey].declineCount++;
        const declineCount = cooldowns[cdKey].declineCount;
        const cooldownMs = getCooldownMs(declineCount);
        cooldowns[cdKey].nextAllowed = Date.now() + cooldownMs;
        db.set('boosterShareCooldowns', cooldowns);

        await interaction.update({ content: `❌ <@${targetId}> declined the booster role share.`, embeds: [], components: [] }).catch(() => {});

        // Notify sender in channel
        try {
            const channel = interaction.channel;
            if (channel) {
                const mins = Math.ceil(cooldownMs / 60000);
                const timeStr = cooldownMs >= 3600000 ? `${Math.ceil(cooldownMs / 3600000)}h` : `${mins}m`;
                channel.send({ embeds: [new EmbedBuilder()
                    .setColor(COLORS.error)
                    .setDescription(`<:warn:1528892150698348727> <@${targetId}> declined your booster role share request. You must wait **${timeStr}** before requesting again.`)
                ] }).catch(() => {});
            }
        } catch {}
        return;
    }

    // ── ACCEPT ──
    try {
        const guild = await client.guilds.fetch(guildId).catch(() => null);
        if (!guild) { await interaction.update({ content: '❌ Could not find the server.', embeds: [], components: [] }).catch(() => {}); return; }

        const member = await guild.members.fetch(targetId).catch(() => null);
        const map = db.get('boosterRoles', {});
        const entry = map[senderId];
        const cfg = db.get('boosterRoleConfig', { enabled: false, shareMax: 0, sharedMax: 0 });

        if (!entry || !member) { await interaction.update({ content: '❌ The booster role no longer exists.', embeds: [], components: [] }).catch(() => {}); return; }

        // Re-check limits
        if (!Array.isArray(entry.sharedWith)) entry.sharedWith = [];
        if (entry.sharedWith.includes(targetId)) { await interaction.update({ content: '❌ You already have this role.', embeds: [], components: [] }).catch(() => {}); return; }
        if (entry.sharedWith.length >= cfg.shareMax && cfg.shareMax > 0) { await interaction.update({ content: '❌ The share limit has been reached.', embeds: [], components: [] }).catch(() => {}); return; }

        // Check target's shared max again
        const targetSharedCount = countSharedRoles(db, guildId, targetId);
        if (cfg.sharedMax > 0 && targetSharedCount >= cfg.sharedMax) {
            await interaction.update({ content: `❌ You have reached the max amount of shared roles (${cfg.sharedMax}). Use \`,br shared cancel\` to remove one.`, embeds: [], components: [] }).catch(() => {});
            return;
        }

        const role = guild.roles.cache.get(entry.roleId);
        if (!role) { await interaction.update({ content: '❌ The booster role no longer exists.', embeds: [], components: [] }).catch(() => {}); return; }

        entry.sharedWith.push(targetId); db.set('boosterRoles', map);
        addSharedRole(db, guildId, targetId, role.id, senderId);
        await member.roles.add(role).catch(() => {});

        // Reset cooldown on accept
        if (cooldowns[cdKey]) { cooldowns[cdKey].declineCount = 0; cooldowns[cdKey].nextAllowed = 0; db.set('boosterShareCooldowns', cooldowns); }

        await interaction.update({
            embeds: [new EmbedBuilder().setColor(COLORS.success).setDescription(`<:checkmark:1528890895859056680> <@${targetId}>: You now have the booster role <@&${role.id}>!`)],
            components: []
        }).catch(() => {});

        // Notify sender in channel
        try {
            const channel = interaction.channel;
            if (channel) {
                channel.send({ embeds: [new EmbedBuilder().setColor(COLORS.success).setDescription(`<:checkmark:1528890895859056680> <@${targetId}> accepted your booster role share!`)] }).catch(() => {});
            }
        } catch {}
        return;
    } catch (e) {
        await interaction.update({ content: `❌ Error: ${e.message}`, embeds: [], components: [] }).catch(() => {});
        return;
    }
}

module.exports = { handleBoosterRoleCommand, handleBoostRemoved, handleBoosterShareButton };