/**
 * restrictcommand.js — Per-command role restrictions
 *
 * Storage (guild DB): 'cmdRestrictions' → {
 *   [command]: { blocked: [roleId, ...], allowed: [roleId, ...] }
 * }
 *
 * .restrictcommand add <cmd> @role     — block role from using command
 * .restrictcommand remove <cmd> @role  — remove block for role
 * .restrictcommand allow <cmd> @role   — always allow role (overrides blocks)
 * .restrictcommand deny <cmd> @role    — deny role regardless of other rules
 * .restrictcommand reset [cmd]         — reset restrictions (specific cmd or ALL)
 * .restrictcommand list [cmd|@role]    — show restrictions
 */

const { getGuildDb }         = require('./database');
const { greedOk, greedWarn, base, COLORS } = require('../utils/embeds');

// ── Check if a command is restricted for this member ──────────────────────

function isRestricted(member, command, guildId) {
    if (!member?.guild) return false;
    const db   = getGuildDb(guildId);
    const rest  = db.get('cmdRestrictions', {});
    const entry = rest[command];
    if (!entry) return false;

    // If member has an "allowed" role, never restrict
    if (entry.allowed?.some(roleId => member.roles.cache.has(roleId))) return false;

    // If member has a "blocked"/"denied" role, restrict
    return (
        entry.blocked?.some(roleId => member.roles.cache.has(roleId)) ||
        entry.denied?.some(roleId => member.roles.cache.has(roleId))
    );
}

function checkRestriction(ctx, command) {
    if (!ctx.guild || !ctx.member) return false;
    if (isRestricted(ctx.member, command, ctx.guild.id)) {
        ctx.reply({ ...greedWarn(ctx.member, 'This command is **restricted** for your role.'), ephemeral: true }).catch(() => {});
        return true;
    }
    return false;
}

// ── Command handler ────────────────────────────────────────────────────────

async function handleRestrictCommand(message, args) {
    const { isStaffOrAdmin } = require('./helpers');
    if (!isStaffOrAdmin(message.member)) {
        return message.reply(greedWarn(message.member, 'You need **staff** or **admin** to manage command restrictions.'));
    }

    const db   = getGuildDb(message.guild.id);
    const rest  = db.get('cmdRestrictions', {});
    const sub   = (args[0] || '').toLowerCase();
    const cmd   = args[1]?.toLowerCase();
    const role  = message.mentions.roles.first();

    // ── list ─────────────────────────────────────────────────────────────
    if (sub === 'list') {
        // .restrictcommand list @role — show all restrictions for that role
        const targetRole = message.mentions.roles.first();
        if (targetRole) {
            const lines = [];
            for (const [c, d] of Object.entries(rest)) {
                const isBlocked  = d.blocked?.includes(targetRole.id);
                const isDenied   = d.denied?.includes(targetRole.id);
                const isAllowed  = d.allowed?.includes(targetRole.id);
                if (isBlocked || isDenied || isAllowed) {
                    const tag = isAllowed ? '✅ allowed' : '🚫 blocked';
                    lines.push(`\`${c}\` — ${tag}`);
                }
            }
            if (!lines.length)
                return message.reply(greedWarn(message.member, `<@&${targetRole.id}> has no restrictions.`));
            return message.channel.send({ embeds: [
                base(COLORS.primary)
                    .setTitle(`🚫 Restrictions for <@&${targetRole.id}>`)
                    .setDescription(lines.join('\n')),
            ] });
        }

        // .restrictcommand list [cmd] — all restrictions
        const target = args[1]?.toLowerCase();
        if (target) {
            const d = rest[target];
            if (!d) return message.reply(greedWarn(message.member, `No restrictions for \`${target}\`.`));
            const lines = [
                d.blocked?.length  ? `🚫 Blocked: ${d.blocked.map(r => `<@&${r}>`).join(', ')}`  : null,
                d.denied?.length   ? `⛔ Denied: ${d.denied.map(r => `<@&${r}>`).join(', ')}`    : null,
                d.allowed?.length  ? `✅ Allowed: ${d.allowed.map(r => `<@&${r}>`).join(', ')}` : null,
            ].filter(Boolean);
            return message.channel.send({ embeds: [
                base(COLORS.primary)
                    .setTitle(`🚫 Restrictions: \`${target}\``)
                    .setDescription(lines.join('\n') || 'None'),
            ] });
        }

        // All
        const entries = Object.entries(rest).filter(([, d]) =>
            (d.blocked?.length || d.denied?.length || d.allowed?.length)
        );
        if (!entries.length) return message.reply(greedWarn(message.member, 'No command restrictions configured.'));
        const lines = entries.map(([c, d]) => {
            const parts = [];
            if (d.blocked?.length) parts.push(`🚫 ${d.blocked.map(r => `<@&${r}>`).join(', ')}`);
            if (d.denied?.length)  parts.push(`⛔ ${d.denied.map(r => `<@&${r}>`).join(', ')}`);
            if (d.allowed?.length) parts.push(`✅ ${d.allowed.map(r => `<@&${r}>`).join(', ')}`);
            return `**${c}** — ${parts.join(' | ')}`;
        }).join('\n');
        return message.channel.send({ embeds: [
            base(COLORS.primary).setTitle('🚫 Command Restrictions').setDescription(lines),
        ] });
    }

    // ── reset ─────────────────────────────────────────────────────────────
    if (sub === 'reset') {
        if (!cmd) {
            // Reset ALL
            db.set('cmdRestrictions', {});
            return message.reply(greedOk(message.member, 'All command restrictions have been **reset**.'));
        }
        delete rest[cmd];
        db.set('cmdRestrictions', rest);
        return message.reply(greedOk(message.member, `Restrictions for \`${cmd}\` have been **removed**.`));
    }

    // ── add / remove / allow / deny ───────────────────────────────────────
    if (['add', 'remove', 'allow', 'deny'].includes(sub)) {
        if (!cmd) return message.reply(greedWarn(message.member, `Usage: \`,restrictcommand ${sub} <command> @role\``));
        if (!role) return message.reply(greedWarn(message.member, 'Mention a role.'));

        if (!rest[cmd]) rest[cmd] = { blocked: [], denied: [], allowed: [] };
        const d = rest[cmd];
        if (!d.blocked) d.blocked = [];
        if (!d.denied)  d.denied  = [];
        if (!d.allowed) d.allowed = [];

        if (sub === 'add') {
            if (!d.blocked.includes(role.id)) d.blocked.push(role.id);
            db.set('cmdRestrictions', rest);
            return message.reply(greedOk(message.member,
                `\`${cmd}\` is now **restricted** for <@&${role.id}>.`));
        }
        if (sub === 'remove') {
            d.blocked = d.blocked.filter(r => r !== role.id);
            d.denied  = d.denied.filter(r => r !== role.id);
            if (!d.blocked.length && !d.denied.length && !d.allowed.length) delete rest[cmd];
            db.set('cmdRestrictions', rest);
            return message.reply(greedOk(message.member,
                `Restriction removed for <@&${role.id}> on \`${cmd}\`.`));
        }
        if (sub === 'allow') {
            if (!d.allowed.includes(role.id)) d.allowed.push(role.id);
            db.set('cmdRestrictions', rest);
            return message.reply(greedOk(message.member,
                `<@&${role.id}> is now **allowed** to use \`${cmd}\` regardless of other restrictions.`));
        }
        if (sub === 'deny') {
            if (!d.denied.includes(role.id)) d.denied.push(role.id);
            db.set('cmdRestrictions', rest);
            return message.reply(greedOk(message.member,
                `<@&${role.id}> is now **denied** from \`${cmd}\`.`));
        }
    }

    return message.reply(
        greedWarn(message.member,
            'Usage:\n' +
            '`,restrictcommand add <cmd> @role` — block role\n' +
            '`,restrictcommand remove <cmd> @role` — remove block\n' +
            '`,restrictcommand allow <cmd> @role` — always allow role\n' +
            '`,restrictcommand deny <cmd> @role` — always deny role\n' +
            '`,restrictcommand reset [cmd]` — reset (specific or all)\n' +
            '`,restrictcommand list [cmd|@role]` — view restrictions'
        )
    );
}

module.exports = { checkRestriction, isRestricted, handleRestrictCommand };
