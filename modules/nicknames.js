const { getGuildDb }   = require('./database');
const { COLORS, base } = require('../utils/embeds');
const { createCase, sendModLog } = require('./cases');

// .rename @user <new nick>
async function handleRename(ctx, args) {
    const { isStaffOrAdmin } = require('./helpers');
    if (!isStaffOrAdmin(ctx.member)) return ctx.reply({ content: '❌ No permission.', ephemeral: true });
    const target = ctx.mentions?.members?.first();
    if (!target) return ctx.reply({ content: '❌ Mention a user.', ephemeral: true });
    const nick     = args.slice(1).join(' ').replace(/<@!?\d+>/g, '').trim() || null;
    const authorId = ctx.author?.id || ctx.user?.id;
    const old      = target.nickname || target.user.username;
    await target.setNickname(nick, `Renamed by ${ctx.author?.tag || ctx.user?.tag}`);
    createCase(ctx.guild.id, { type: 'nickname', targetId: target.id, executorId: authorId, reason: nick ? `Renamed to ${nick}` : 'Nickname reset' });
    return ctx.reply({ embeds: [base(COLORS.success).setTitle('✏️ Nickname Changed')
        .addFields({ name: 'User', value: `${target.user}`, inline: true }, { name: 'Old', value: old, inline: true }, { name: 'New', value: nick || '*(reset)*', inline: true })] });
}

// .forcenickname @user <nick>  —  saves to DB so it persists
async function handleForceNickname(ctx, args, client) {
    const { isStaffOrAdmin } = require('./helpers');
    if (!isStaffOrAdmin(ctx.member)) return ctx.reply({ content: '❌ No permission.', ephemeral: true });

    if (args[0] === 'list') {
        const db   = getGuildDb(ctx.guild.id);
        const list = db.get('forcedNicks', {});
        const entries = Object.entries(list);
        if (!entries.length) return ctx.reply({ content: 'No forced nicknames active.' });
        const lines = entries.map(([uid, nick]) => `<@${uid}> → **${nick}**`).join('\n');
        return ctx.reply({ embeds: [base(COLORS.primary).setTitle('📌 Forced Nicknames').setDescription(lines)] });
    }

    const target = ctx.mentions?.members?.first();
    if (!target) return ctx.reply({ content: '❌ Mention a user.', ephemeral: true });
    const nick     = args.slice(1).join(' ').replace(/<@!?\d+>/g, '').trim();
    if (!nick) return ctx.reply({ content: '❌ Provide a nickname.' });
    const authorId = ctx.author?.id || ctx.user?.id;

    await target.setNickname(nick);
    const db   = getGuildDb(ctx.guild.id);
    const list = db.get('forcedNicks', {});
    list[target.id] = nick;
    db.set('forcedNicks', list);
    createCase(ctx.guild.id, { type: 'nickname', targetId: target.id, executorId: authorId, reason: `Force nickname: ${nick}` });
    return ctx.reply({ content: `📌 **${target.user.username}**'s nickname has been forced to **${nick}**.` });
}

// .stripstaff @user  — strips "staff-looking" nicknames (e.g., ones with [MOD] [ADMIN] etc.)
async function handleStripStaff(ctx, args) {
    const { isStaffOrAdmin } = require('./helpers');
    if (!isStaffOrAdmin(ctx.member)) return ctx.reply({ content: '❌ No permission.', ephemeral: true });

    const staffPatterns = /\[(mod|admin|staff|owner|support|helper|manager|dev)\]|\(mod\)|\(admin\)|\(staff\)/gi;
    const members = await ctx.guild.members.fetch();
    let count = 0;

    for (const [, member] of members) {
        const nick = member.nickname;
        if (nick && staffPatterns.test(nick)) {
            await member.setNickname(null, 'Stripped fake staff nickname').catch(() => {});
            count++;
        }
    }
    return ctx.reply({ content: `✅ Stripped fake staff nicknames from **${count}** members.` });
}

// Event handler: enforce forced nicknames on guild member update
async function onMemberUpdate(oldMember, newMember) {
    if (oldMember.nickname === newMember.nickname) return;
    const db   = getGuildDb(newMember.guild.id);
    const list = db.get('forcedNicks', {});
    const forced = list[newMember.id];
    if (forced && newMember.nickname !== forced) {
        await newMember.setNickname(forced).catch(() => {});
    }
}

module.exports = { handleRename, handleForceNickname, handleStripStaff, onMemberUpdate };
