/**
 * stickyroles.js — roles that automatically re-apply when a member rejoins
 * Commands: .stickyrole add @role, .stickyrole remove @role, .stickyrole list
 * Event:    guildMemberAdd — auto-applies sticky roles
 * Event:    guildMemberRemove — not needed (roles are saved on join remove)
 */
const { getGuildDb } = require('./database');
const { COLORS, base } = require('../utils/embeds');

// ══════════════════════════════════════════════════════════
//  COMMAND HANDLER
// ══════════════════════════════════════════════════════════
async function handleStickyRole(ctx, args) {
    const { isStaffOrAdmin } = require('./helpers');
    if (!isStaffOrAdmin(ctx.member)) return ctx.reply({ content: '❌ No permission.', ephemeral: true });

    const db   = getGuildDb(ctx.guild.id);
    const sub  = args[0]?.toLowerCase();
    const role = ctx.mentions?.roles?.first();

    // ── .stickyrole add @role ──
    if (sub === 'add') {
        if (!role) return ctx.reply({ content: '❌ Mention a role: `.stickyrole add @role`' });
        if (role.managed) return ctx.reply({ content: '❌ Cannot make bot-managed roles sticky.' });
        if (role.id === ctx.guild.id) return ctx.reply({ content: '❌ Cannot make @everyone sticky.' });

        const sticky = db.get('stickyRoles', []);
        if (sticky.includes(role.id))
            return ctx.reply({ content: `❌ <@&${role.id}> is already a sticky role.` });

        sticky.push(role.id);
        db.set('stickyRoles', sticky);

        return ctx.reply({ embeds: [base(COLORS.success).setTitle('📌 Sticky Role Added')
            .addFields(
                { name: '🎭 Role',  value: `<@&${role.id}>`, inline: true },
                { name: 'ℹ️ Info', value: 'Members who leave and rejoin will automatically receive this role.' },
            )] });
    }

    // ── .stickyrole remove @role ──
    if (sub === 'remove') {
        if (!role) return ctx.reply({ content: '❌ Mention a role: `.stickyrole remove @role`' });
        const sticky = db.get('stickyRoles', []);
        if (!sticky.includes(role.id))
            return ctx.reply({ content: `❌ <@&${role.id}> is not a sticky role.` });

        db.set('stickyRoles', sticky.filter(id => id !== role.id));
        return ctx.reply({ content: `✅ <@&${role.id}> is no longer sticky.` });
    }

    // ── .stickyrole list ──
    if (!sub || sub === 'list') {
        const sticky = db.get('stickyRoles', []);
        if (!sticky.length)
            return ctx.reply({ embeds: [base(COLORS.primary).setTitle('📌 Sticky Roles').setDescription('No sticky roles configured.\nUse `.stickyrole add @role` to add one.')] });

        const lines = sticky.map(id => {
            const r = ctx.guild.roles.cache.get(id);
            return r ? `<@&${id}>` : `~~\`${id}\`~~ *(deleted)*`;
        }).join('\n');

        return ctx.reply({ embeds: [base(COLORS.primary).setTitle('📌 Sticky Roles')
            .setDescription(lines)
            .setFooter({ text: `${sticky.length} sticky role(s) — members keep these when they rejoin` })] });
    }

    return ctx.reply({ content: '❌ Usage: `.stickyrole add/remove/list [@role]`' });
}

// ══════════════════════════════════════════════════════════
//  MEMBER JOIN — auto-apply sticky roles
// ══════════════════════════════════════════════════════════
async function onMemberJoin(member) {
    const db     = getGuildDb(member.guild.id);
    const sticky = db.get('stickyRoles', []);
    if (!sticky.length) return;

    // Check if this member previously had any sticky roles saved
    const saved  = db.get('memberStickySnapshot', {});
    const had    = saved[member.id] || [];

    // Only re-apply roles that are both sticky AND the member previously had
    const toApply = sticky.filter(id => had.includes(id));
    if (!toApply.length) return;

    for (const roleId of toApply) {
        const role = member.guild.roles.cache.get(roleId);
        if (!role) continue;
        await member.roles.add(role, 'Sticky role restored on rejoin').catch(() => {});
    }
}

// ══════════════════════════════════════════════════════════
//  MEMBER LEAVE — save which sticky roles they had
// ══════════════════════════════════════════════════════════
function onMemberLeave(member) {
    const db     = getGuildDb(member.guild.id);
    const sticky = db.get('stickyRoles', []);
    if (!sticky.length) return;

    const had = [...member.roles.cache.keys()].filter(id => sticky.includes(id));
    if (!had.length) return;

    const saved = db.get('memberStickySnapshot', {});
    saved[member.id] = had;
    db.set('memberStickySnapshot', saved);
}

module.exports = { handleStickyRole, onMemberJoin, onMemberLeave };
