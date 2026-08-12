const { EmbedBuilder } = require('discord.js');

const COLORS = {
    primary:  '#5865F2',
    success:  '#57F287',
    warning:  '#FEE75C',
    error:    '#ED4245',
    info:     '#5865F2',
    muted:    '#2F3136',
    gold:     '#FFD700',
    orange:   '#E67E22',
};

const BOT_NAME    = 'Kaido';
const CHECK_EMOJI = '<:checkmark:1528890895859056680>';
const XMARK_EMOJI = '<:warn:1528892150698348727>';

function base(color) {
    return new EmbedBuilder().setColor(color);
}

function success(title, description) {
    return base(COLORS.success).setTitle(`${CHECK_EMOJI} ${title}`).setDescription(description || null);
}

function error(title, description) {
    return base(COLORS.error).setTitle(`${XMARK_EMOJI} ${title}`).setDescription(description || null);
}

function warning(title, description) {
    return base(COLORS.warning).setTitle(`⚠️ ${title}`).setDescription(description || null);
}

function info(title, description) {
    return base(COLORS.primary).setTitle(title).setDescription(description || null);
}

function loading(title, description) {
    return base(COLORS.muted).setTitle(`⏳ ${title}`).setDescription(description || null);
}

/**
 * Quick embed wrappers for inline replies:
 *   ok('User banned.')          → green success embed
 *   err('No permission.')       → red error embed
 */
function ok(description, title = 'Success') {
    return { embeds: [success(title, description)] };
}

function err(description, title = 'Error') {
    return { embeds: [error(title, description)] };
}

// ══════════════════════════════════════════════════════════
//  GREED-STYLE INLINE TEXT RESPONSES  (no embed, plain content)
//  Format: <emoji> @mention: message text
// ══════════════════════════════════════════════════════════

/**
 * Resolve a @mention string from a GuildMember, User, or interaction.member/user.
 * Falls back to empty string if nothing can be resolved.
 */
function _mention(m) {
    const id = m?.id ?? m?.user?.id;
    return id ? `<@${id}>` : '';
}

/**
 * Greed-style success reply — green embed with checkmark.
 * Returns a message payload object: { embeds: [...] }
 * @param {GuildMember|User|string} memberOrUser
 * @param {string} text
 */
function greedOk(memberOrUser, text) {
    return {
        embeds: [
            new EmbedBuilder()
                .setColor(COLORS.success)
                .setDescription(`<:checkmark:1528890895859056680> ${_mention(memberOrUser)}: ${text}`)
        ]
    };
}

/**
 * Greed-style warning/error reply — yellow embed with warn icon.
 * Returns a message payload object: { embeds: [...] }
 * @param {GuildMember|User|string} memberOrUser
 * @param {string} text
 */
function greedWarn(memberOrUser, text) {
    return {
        embeds: [
            new EmbedBuilder()
                .setColor(COLORS.warning)
                .setDescription(`<:warn:1528892150698348727> ${_mention(memberOrUser)}: ${text}`)
        ]
    };
}

/**
 * Raw text versions (for use inside arrays / string joins).
 */
function greedOkText(memberOrUser, text) {
    return `<:checkmark:1528890895859056680> ${_mention(memberOrUser)}: ${text}`;
}
function greedWarnText(memberOrUser, text) {
    return `<:warn:1528892150698348727> ${_mention(memberOrUser)}: ${text}`;
}

function modAction(type, target, executor, reason, caseId = null) {
    const icons = { Kick: '👢', Ban: '🔨', Unban: '🔓', Mute: '🔇', Unmute: '🔊', Warn: '⚠️', Softban: '🧹', Tempban: '⏱️', Hardban: '🔒', Timeout: '🔇', Note: '📝', Purge: '🗑️', Lock: '🔒', Unlock: '🔓' };
    const icon = icons[type] || '🔨';
    const embed = base(COLORS.error)
        .setTitle(`${icon} ${type}`)
        .addFields(
            { name: 'User',      value: `${target} (${target.id || target})`, inline: true },
            { name: 'Moderator', value: `${executor}`,                         inline: true },
            { name: 'Reason',    value: reason || 'No reason provided' }
        );
    if (caseId) embed.setFooter({ text: `Case #${caseId} • ${BOT_NAME}` });
    return embed;
}

function pagination(title, description, page, totalPages, color = COLORS.primary) {
    return base(color)
        .setTitle(title)
        .setDescription(description)
        .setFooter({ text: `Page ${page}/${totalPages}` });
}

module.exports = {
    COLORS, CHECK_EMOJI, XMARK_EMOJI,
    base, success, error, warning, info, loading,
    ok, err,
    greedOk, greedWarn, greedOkText, greedWarnText,
    modAction, pagination,
};
