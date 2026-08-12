const { getGuildDb } = require('./database');
const { EmbedBuilder } = require('discord.js');

const SETTING_KEYS = {
    'vc-log': 'vcLogChannelId',
    'unmute-channel': 'unmuteChannelId',
    'streak-role': 'streakRoleId',
    'top10vc': 'top10VcChannelId',
    'raid-channel': 'raidChannelId',
    'raid-role': 'raidRoleId',
    'mod-log': 'modLogChannelId',
    'welcome-channel': 'welcomeChannelId',
    'leave-channel': 'leaveChannelId',
    'xp-rate': 'xpRate',
};

async function handleSettings(message, args) {
    const db = getGuildDb(message.guild.id);
    if (!message.member.permissions.has('Administrator') && message.author.id !== require('./helpers').ADMIN_USER_ID) {
        return message.reply('❌ Only administrators can change settings.');
    }

    const key = args[0];
    if (!key) {
        const settings = db.get('settings', {});
        const lines = Object.entries(SETTING_KEYS).map(([cmd, field]) => {
            const val = settings[field];
            return `\`${cmd}\` → ${val ? `<#${val}> / <@&${val}> / \`${val}\`` : '*(not set)*'}`;
        });
        return message.channel.send({ embeds: [new EmbedBuilder()
            .setTitle('⚙️ Server Settings')
            .setDescription(lines.join('\n'))
            .setColor('#5865F2')
            .setFooter({ text: 'Use .settings <key> <value>' })] });
    }

    const field = SETTING_KEYS[key];
    if (!field) return message.reply(`❌ Unknown setting \`${key}\`. Valid: ${Object.keys(SETTING_KEYS).join(', ')}`);

    const raw = args[1];
    if (!raw) return message.reply(`❌ Usage: \`.settings ${key} <value>\``);

    // Extract ID from mention or raw value
    const id = raw.replace(/[<#@&!>]/g, '');
    const settings = db.get('settings', {});
    settings[field] = id;
    db.set('settings', settings);

    return message.reply(`✅ **${key}** has been set to \`${id}\`.`);
}

function getSetting(guildId, field) {
    const db = getGuildDb(guildId);
    const settings = db.get('settings', {});
    return settings[field] || null;
}

module.exports = { handleSettings, getSetting, SETTING_KEYS };
