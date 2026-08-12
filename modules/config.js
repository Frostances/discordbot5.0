const { EmbedBuilder } = require('discord.js');
const { getGuildDb } = require('./database');
const { COLORS } = require('../utils/embeds');
const { MODULES, handleModuleCommand, getModules } = require('./moduleSystem');

// Full config key map: display name -> db field
const CONFIG_KEYS = {
    'vc-log':          { field: 'vcLogChannelId',      label: 'VC Log Channel',         type: 'channel' },
    'unmute-channel':  { field: 'unmuteChannelId',     label: 'Unmute Channel',          type: 'channel' },
    'streak-role':     { field: 'streakRoleId',        label: 'Streak Role',             type: 'role' },
    'top-vc':          { field: 'top10VcChannelId',    label: 'Top VC Leaderboard',      type: 'channel' },
    'top10vc':         { field: 'top10VcChannelId',    label: 'Top VC Leaderboard',      type: 'channel' },
    'raid-channel':    { field: 'raidChannelId',       label: 'Raid Channel',            type: 'channel' },
    'raid-role':       { field: 'raidRoleId',          label: 'Raid Role',               type: 'role' },
    'mod-log':         { field: 'modLogChannelId',     label: 'Mod Log Channel',         type: 'channel' },
    'welcome-channel': { field: 'welcomeChannelId',    label: 'Welcome Channel',         type: 'channel' },
    'leave-channel':   { field: 'leaveChannelId',      label: 'Leave Channel',           type: 'channel' },
    'ticket-log':      { field: 'ticketLogChannelId',  label: 'Ticket Log Channel',      type: 'channel' },
    'prefix':          { field: 'prefix',              label: 'Command Prefix',          type: 'text' },
};

function getSetting(guildId, field) {
    const db = getGuildDb(guildId);
    const settings = db.get('settings', {});
    return settings[field] || null;
}

function setSetting(guildId, field, value) {
    const db = getGuildDb(guildId);
    const settings = db.get('settings', {});
    settings[field] = value;
    db.set('settings', settings);
}

function formatValue(type, value, guild) {
    if (!value) return '*(not set)*';
    if (type === 'channel') {
        const ch = guild?.channels.cache.get(value);
        return ch ? `<#${value}>` : `\`${value}\``;
    }
    if (type === 'role') {
        const r = guild?.roles.cache.get(value);
        return r ? `<@&${value}>` : `\`${value}\``;
    }
    return `\`${value}\``;
}

async function handleConfigCommand(message, args) {
    const { isStaffOrAdmin } = require('./helpers');
    if (!isStaffOrAdmin(message.member)) return message.reply('❌ No permission.');

    const db = getGuildDb(message.guild.id);
    const sub = args[0]?.toLowerCase();

    // ── .config view ──
    if (!sub || sub === 'view') {
        const settings = db.get('settings', {});
        const lines = Object.entries(CONFIG_KEYS).reduce((acc, [key, cfg]) => {
            if (!acc.seen) acc.seen = new Set();
            if (acc.seen.has(cfg.field)) return acc;
            acc.seen.add(cfg.field);
            const val = settings[cfg.field];
            acc.items.push(`**${cfg.label}** (\`${key}\`)\n↳ ${formatValue(cfg.type, val, message.guild)}`);
            return acc;
        }, { items: [], seen: null }).items;

        const chunks = [];
        for (let i = 0; i < lines.length; i += 6) chunks.push(lines.slice(i, i + 6));

        const embeds = chunks.map((ch, idx) => new EmbedBuilder()
            .setTitle(idx === 0 ? '⚙️ Server Configuration' : '⚙️ Server Configuration (cont.)')
            .setDescription(ch.join('\n\n'))
            .setColor(COLORS.primary)
            .setFooter({ text: `Use .config set <key> <value> to change • ${message.guild.name}` })
            .setTimestamp()
        );
        return message.channel.send({ embeds: embeds.slice(0, 10) });
    }

    // ── .config set <key> <value> ──
    if (sub === 'set') {
        const key = args[1]?.toLowerCase();
        const raw = args.slice(2).join(' ');
        if (!key || !raw) return message.reply('❌ Usage: `.config set <key> <value>`\nSee `.config view` for valid keys.');
        const cfg = CONFIG_KEYS[key];
        if (!cfg) return message.reply(`❌ Unknown key \`${key}\`. Valid keys: ${Object.keys(CONFIG_KEYS).join(', ')}`);

        const id = raw.replace(/[<#@&!>]/g, '').trim();
        setSetting(message.guild.id, cfg.field, id);

        return message.reply({ embeds: [new EmbedBuilder()
            .setTitle('✅ Config Updated')
            .setDescription(`**${cfg.label}** has been set to ${formatValue(cfg.type, id, message.guild)}`)
            .setColor(COLORS.success)
            .setTimestamp()] });
    }

    // ── .config reset <key> ──
    if (sub === 'reset') {
        const key = args[1]?.toLowerCase();
        if (!key) return message.reply('❌ Usage: `.config reset <key>`');
        const cfg = CONFIG_KEYS[key];
        if (!cfg) return message.reply(`❌ Unknown key \`${key}\`.`);
        setSetting(message.guild.id, cfg.field, null);
        return message.reply(`✅ **${cfg.label}** has been reset.`);
    }

    // ── .config module ──
    if (sub === 'module' || sub === 'modules') {
        return handleModuleCommand(message, args.slice(1));
    }

    // ── .config keys ──
    if (sub === 'keys') {
        const unique = [...new Set(Object.values(CONFIG_KEYS).map(c => c.label))];
        const list = Object.entries(CONFIG_KEYS)
            .filter(([, v]) => v) // dedup not needed — show all
            .map(([k, v]) => `\`${k}\` — ${v.label}`)
            .join('\n');
        return message.channel.send({ embeds: [new EmbedBuilder()
            .setTitle('⚙️ Config Keys')
            .setDescription(list)
            .setColor(COLORS.primary)
            .setFooter({ text: '.config set <key> <value>' })] });
    }

    return message.reply('❌ Usage: `.config view` | `.config set <key> <value>` | `.config reset <key>` | `.config module list`\nSee `.config keys` for all keys.');
}

module.exports = { handleConfigCommand, getSetting, setSetting, CONFIG_KEYS };
