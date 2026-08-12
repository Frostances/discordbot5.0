const { COLORS, base } = require('../utils/embeds');

// .moveall <#fromVC> <#toVC>  or  .moveall <#toVC>  (moves all from your VC)
async function handleMoveAll(ctx, args) {
    const { isStaffOrAdmin } = require('./helpers');
    if (!isStaffOrAdmin(ctx.member)) return ctx.reply({ content: '❌ No permission.', ephemeral: true });

    const mentioned = ctx.mentions?.channels;
    let from, to;

    if (mentioned?.size >= 2) {
        const chans = [...mentioned.values()];
        from = chans[0]; to = chans[1];
    } else if (mentioned?.size === 1) {
        from = ctx.member.voice?.channel;
        to   = [...mentioned.values()][0];
    } else {
        return ctx.reply({ content: '❌ Usage: `.moveall <#from> <#to>` or `.moveall <#to>` (must be in a VC)' });
    }

    if (!from || from.type !== 2) return ctx.reply({ content: '❌ Source must be a voice channel.' });
    if (!to   || to.type   !== 2) return ctx.reply({ content: '❌ Destination must be a voice channel.' });

    const members = [...from.members.values()];
    if (!members.length) return ctx.reply({ content: `❌ <#${from.id}> is empty.` });

    const reply = await ctx.reply({ content: `⏳ Moving **${members.length}** members to <#${to.id}>...` });
    let moved = 0, failed = 0;
    for (const member of members) {
        try { await member.voice.setChannel(to); moved++; } catch { failed++; }
    }

    return reply.edit({ content: '', embeds: [base(COLORS.success).setTitle('📢 Move All Complete')
        .addFields(
            { name: 'From',     value: `<#${from.id}>`,   inline: true },
            { name: 'To',       value: `<#${to.id}>`,     inline: true },
            { name: '✅ Moved', value: moved.toString(),   inline: true },
            { name: '❌ Failed',value: failed.toString(),  inline: true },
        )] });
}

// .drag @user [#vc]  — move a specific member to your VC (or specified VC)
async function handleDrag(ctx, args) {
    const { isStaffOrAdmin } = require('./helpers');
    if (!isStaffOrAdmin(ctx.member)) return ctx.reply({ content: '❌ No permission.', ephemeral: true });

    const target  = ctx.mentions?.members?.first();
    const destCh  = ctx.mentions?.channels?.first();
    if (!target) return ctx.reply({ content: '❌ Mention a user.', ephemeral: true });

    const dest = destCh || ctx.member.voice?.channel;
    if (!dest) return ctx.reply({ content: '❌ You must be in a voice channel, or mention a destination VC.', ephemeral: true });
    if (dest.type !== 2) return ctx.reply({ content: '❌ Destination must be a voice channel.', ephemeral: true });

    if (!target.voice?.channel) return ctx.reply({ content: `❌ **${target.user.username}** is not in a voice channel.`, ephemeral: true });

    await target.voice.setChannel(dest);
    return ctx.reply({ content: `📢 Dragged **${target.user.username}** to <#${dest.id}>.` });
}

module.exports = { handleMoveAll, handleDrag };
