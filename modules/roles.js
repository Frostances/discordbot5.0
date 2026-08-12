/**
 * roles.js — complete role management system
 * Covers: add, remove, create, delete, edit, color, gradient, icon,
 * mentionable, hoist, restore, mass ops (humans/bots/has/all),
 * temprole, stickyrole, cancel — all with progress embeds and safety checks.
 */
const { PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { getGuildDb } = require('./database');
const { COLORS, base } = require('../utils/embeds');
const { createCase, sendModLog, parseDuration, formatDuration } = require('./cases');
const { resolveRole } = require('./helpers');

// ── In-memory state ──
const TEMPROLE_TIMERS = new Map(); // key → timeout
const MASS_CANCEL = new Map(); // guildId → true (set to cancel)
const MASS_RUNNING = new Map(); // guildId → true (set while running)

// ══════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════
function staffCheck(ctx) {
 const { isStaffOrAdmin } = require('./helpers');
 return isStaffOrAdmin(ctx.member);
}

function getAuthorId(ctx) { return ctx.author?.id || ctx.user?.id; }

function hexToNum(hex) {
 return parseInt(hex.replace(/^#/, ''), 16);
}

function blendColors(hex1, hex2, t = 0.5) {
 const a = hexToNum(hex1), b = hexToNum(hex2);
 const r = Math.round(((a >> 16) & 0xff) * (1 - t) + ((b >> 16) & 0xff) * t);
 const g = Math.round(((a >> 8) & 0xff) * (1 - t) + ((b >> 8) & 0xff) * t);
 const bl= Math.round((a & 0xff) * (1 - t) + (b & 0xff) * t);
 return `#${((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1)}`;
}

function progressBar(done, total) {
 const pct = total === 0 ? 100 : Math.round((done / total) * 100);
 const filled = Math.round(pct / 5);
 return `\`[${'█'.repeat(filled)}${'░'.repeat(20 - filled)}] ${pct}%\``;
}

// ── Emoji / Icon helpers for role icon ──
const CUSTOM_EMOJI_REGEX = /<(a)?:(\w+):(\d+)>/;
// Unicode emoji detection — covers most common emojis including composite ones
const UNICODE_EMOJI_REGEX = /^[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F100}-\u{1F1FF}\u{1F200}-\u{1F2FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2300}-\u{23FF}\u{2B50}\u{2B55}\u{3030}\u{303D}\u{3297}\u{3299}\u{00a9}\u{00ae}\u{2122}\u{FE0F}\u{200D}]+$/u;

function extractRoleIcon(input) {
 if (!input) return null;
 const trimmed = input.trim();

 // 1. Image URL
 if (/^https?:\/\//.test(trimmed)) {
 return { type: 'url', value: trimmed };
 }

 // 2. Custom Discord emoji (including animated) → static PNG CDN URL
 // Discord automatically serves a static frame when you request .png for an animated emoji
 const customMatch = trimmed.match(CUSTOM_EMOJI_REGEX);
 if (customMatch) {
 const id = customMatch[3];
 return { type: 'url', value: `https://cdn.discordapp.com/emojis/${id}.png?size=256` };
 }

 // 3. Unicode emoji
 if (UNICODE_EMOJI_REGEX.test(trimmed)) {
 return { type: 'emoji', value: trimmed };
 }

 return null;
}

// ══════════════════════════════════════════════════════════
// MASS ROLE OPERATION
// ══════════════════════════════════════════════════════════
async function massRoleOp(ctx, role, action, filter) {
 const guildId = ctx.guild.id;

 if (MASS_RUNNING.get(guildId))
 return ctx.reply({ content: '❌ A mass role operation is already running. Use `.role cancel` to stop it.' });

 await ctx.guild.members.fetch(); // cache all members
 let targets = [...ctx.guild.members.cache.values()];

 // Determine target set — .role add all / .role remove all → humans ONLY
 switch (filter) {
 case 'humans': targets = targets.filter(m => !m.user.bot); break;
 case 'bots': targets = targets.filter(m => m.user.bot); break;
 case 'has': targets = targets.filter(m => !m.user.bot && m.roles.cache.has(role.id)); break;
 case 'nothas': targets = targets.filter(m => !m.user.bot && !m.roles.cache.has(role.id)); break;
 case 'all': targets = targets.filter(m => !m.user.bot); break; // all = humans only, never bots
 default: targets = targets.filter(m => !m.user.bot);
 }

 const total = targets.length;
 if (total === 0)
 return ctx.reply({ content: `❌ No eligible members found for filter \`${filter}\`.` });

 MASS_RUNNING.set(guildId, true);
 MASS_CANCEL.delete(guildId);

 const embed = () => base(COLORS.primary)
 .setTitle(`${action === 'add' ? '➕' : '➖'} Mass Role ${action === 'add' ? 'Add' : 'Remove'}`)
 .addFields(
 { name: '🎭 Role', value: `<@&${role.id}>`, inline: true },
 { name: '📊 Progress', value: progressBar(done, total), inline: false },
 { name: '✅ Done', value: done.toString(), inline: true },
 { name: '❌ Failed', value: failed.toString(), inline: true },
 { name: '⏳ Remaining', value: (total - done - failed).toString(), inline: true },
 )
 .setFooter({ text: `Use .role cancel to stop • ${total} total members` });

 let done = 0, failed = 0;
 const reply = await ctx.channel.send({ embeds: [base(COLORS.primary).setTitle('⏳ Starting mass role operation...')] });

 for (let i = 0; i < total; i++) {
 if (MASS_CANCEL.get(guildId)) {
 MASS_RUNNING.delete(guildId);
 MASS_CANCEL.delete(guildId);
 await reply.edit({ embeds: [base(COLORS.warning).setTitle('🛑 Mass Role Cancelled')
 .addFields({ name: 'Done so far', value: done.toString(), inline: true }, { name: '❌ Failed', value: failed.toString(), inline: true })] });
 return;
 }

 const m = targets[i];
 try {
 if (action === 'add') await m.roles.add(role, `Mass role add by <@${getAuthorId(ctx)}>`);
 else await m.roles.remove(role, `Mass role remove by <@${getAuthorId(ctx)}>`);
 done++;
 } catch { failed++; }

 // Update progress every 25 members or on last
 if (done + failed === 1 || (done + failed) % 25 === 0 || i === total - 1) {
 await reply.edit({ embeds: [embed()] }).catch(() => {});
 }
 }

 MASS_RUNNING.delete(guildId);
 createCase(guildId, {
 type: 'role', targetId: 'mass', executorId: getAuthorId(ctx),
 reason: `Mass role ${action}: <@&${role.id}> — ${filter} (${done} done, ${failed} failed)`,
 });

 return reply.edit({ embeds: [base(COLORS.success)
 .setTitle(`✅ Mass Role ${action === 'add' ? 'Add' : 'Remove'} Complete`)
 .addFields(
 { name: '🎭 Role', value: `<@&${role.id}>`, inline: true },
 { name: '📋 Filter', value: filter, inline: true },
 { name: '✅ Done', value: done.toString(), inline: true },
 { name: '❌ Failed', value: failed.toString(), inline: true },
 { name: '📊 Total', value: total.toString(), inline: true },
 )
 .setFooter({ text: `Requested by ${ctx.author?.tag || ctx.user?.tag}` })] });
}

// ══════════════════════════════════════════════════════════
// MAIN ROLE HANDLER
// ══════════════════════════════════════════════════════════
async function handleRole(ctx, args, client) {
 if (!staffCheck(ctx)) return ctx.reply({ content: '❌ No permission.', ephemeral: true });

 const sub = args[0]?.toLowerCase();

 // ── .role cancel ──
 if (sub === 'cancel') {
 if (!MASS_RUNNING.get(ctx.guild.id))
 return ctx.reply({ content: '❌ No mass role operation is running.' });
 MASS_CANCEL.set(ctx.guild.id, true);
 return ctx.reply({ content: '🛑 Cancellation requested — stopping after current batch...' });
 }

 const mentions = ctx.mentions;
 let role = mentions?.roles?.first();
 let target = mentions?.members?.first();

 // ── Smart role resolution for implied add/remove ──
 // .role @user @role OR .role @user tree OR .role @user tr
 if (!role && target && args.length >= 2) {
 const roleQuery = args.slice(1).join(' ');
 role = resolveRole(ctx.guild, roleQuery);
 }
 // If no target but first arg is a user mention
 if (!target && args.length >= 1) {
 const userMention = args[0];
 const userIdMatch = userMention.match(/^<@!?(\d+)>$/);
 if (userIdMatch) {
 target = await ctx.guild.members.fetch(userIdMatch[1]).catch(() => null);
 if (target && args.length >= 2) {
 const roleQuery = args.slice(1).join(' ');
 role = resolveRole(ctx.guild, roleQuery);
 }
 }
 }

 // ── .role add @user @role ──
 if (sub === 'add' && target && role && args[1] !== 'all') {
 await target.roles.add(role, `Role added by <@${getAuthorId(ctx)}>`);
 createCase(ctx.guild.id, { type: 'role', targetId: target.id, executorId: getAuthorId(ctx), reason: `Added <@&${role.id}>` });
 return ctx.reply({ embeds: [base(COLORS.success).setTitle('✅ Role Added')
 .addFields(
 { name: '👤 User', value: `${target.user}`, inline: true },
 { name: '🎭 Role', value: `<@&${role.id}>`, inline: true },
 )] });
 }

 // ── .role remove @user @role ──
 if (sub === 'remove' && target && role && args[1] !== 'all') {
 await target.roles.remove(role, `Role removed by <@${getAuthorId(ctx)}>`);
 createCase(ctx.guild.id, { type: 'role', targetId: target.id, executorId: getAuthorId(ctx), reason: `Removed <@&${role.id}>` });
 return ctx.reply({ embeds: [base(COLORS.error).setTitle('✅ Role Removed')
 .addFields(
 { name: '👤 User', value: `${target.user}`, inline: true },
 { name: '🎭 Role', value: `<@&${role.id}>`, inline: true },
 )] });
 }

 // ── Implied toggle: .role @user @role (no subcommand) ──
 if (target && role && !['add','remove','create','delete','edit','color','icon','mentionable','hoist','restore','humans','bots','has','cancel'].includes(sub)) {
 const hasRole = target.roles.cache.has(role.id);
 if (hasRole) {
 await target.roles.remove(role, `Role removed by <@${getAuthorId(ctx)}>`);
 createCase(ctx.guild.id, { type: 'role', targetId: target.id, executorId: getAuthorId(ctx), reason: `Removed <@&${role.id}>` });
 return ctx.reply({ embeds: [base(COLORS.error).setTitle('✅ Role Removed')
 .addFields(
 { name: '👤 User', value: `${target.user}`, inline: true },
 { name: '🎭 Role', value: `<@&${role.id}>`, inline: true },
 )] });
 } else {
 await target.roles.add(role, `Role added by <@${getAuthorId(ctx)}>`);
 createCase(ctx.guild.id, { type: 'role', targetId: target.id, executorId: getAuthorId(ctx), reason: `Added <@&${role.id}>` });
 return ctx.reply({ embeds: [base(COLORS.success).setTitle('✅ Role Added')
 .addFields(
 { name: '👤 User', value: `${target.user}`, inline: true },
 { name: '🎭 Role', value: `<@&${role.id}>`, inline: true },
 )] });
 }
 }

 // ── .role add all @role (humans only) ──
 if (sub === 'add' && args[1] === 'all' && role) return massRoleOp(ctx, role, 'add', 'all');

 // ── .role remove all @role (humans only) ──
 if (sub === 'remove' && args[1] === 'all' && role) return massRoleOp(ctx, role, 'remove', 'all');

 // ── .role humans add/remove @role ──
 if (sub === 'humans') {
 const action = args[1]?.toLowerCase();
 if (!role) {
 const roleQuery = args.slice(2).join(' ');
 role = resolveRole(ctx.guild, roleQuery);
 }
 if (!role) return ctx.reply({ content: '❌ Could not find that role. Usage: `.role humans add @role`' });
 if (!['add','remove'].includes(action)) return ctx.reply({ content: '❌ Usage: `.role humans add/remove @role`' });
 return massRoleOp(ctx, role, action, 'humans');
 }

 // ── .role bots add/remove @role ──
 if (sub === 'bots') {
 const action = args[1]?.toLowerCase();
 if (!role) {
 const roleQuery = args.slice(2).join(' ');
 role = resolveRole(ctx.guild, roleQuery);
 }
 if (!role) return ctx.reply({ content: '❌ Could not find that role. Usage: `.role bots add @role`' });
 if (!['add','remove'].includes(action)) return ctx.reply({ content: '❌ Usage: `.role bots add/remove @role`' });
 return massRoleOp(ctx, role, action, 'bots');
 }

 // ── .role has @filterRole add/remove @newRole ──
 if (sub === 'has') {
 const action = args[1]?.toLowerCase();
 const roles = [...(mentions?.roles?.values() || [])];
 if (roles.length < 2) {
 if (roles.length === 1 && args.length >= 3) {
 const secondRole = resolveRole(ctx.guild, args.slice(2).join(' '));
 if (secondRole) roles.push(secondRole);
 }
 }
 if (roles.length < 2) return ctx.reply({ content: '❌ Usage: `.role has @filterRole add @role`' });
 const [filterRole, targetRole] = roles;
 if (!['add','remove'].includes(action)) return ctx.reply({ content: '❌ Usage: `.role has @filterRole add/remove @newRole`' });
 return massRoleOp(ctx, { ...targetRole, id: targetRole.id }, action, 'has', filterRole);
 }

 // ── .role create <name> [#color] ──
 if (sub === 'create') {
 if (!ctx.member.permissions.has(PermissionFlagsBits.ManageRoles))
 return ctx.reply({ content: '❌ Missing `Manage Roles` permission.' });
 const colorMatch = args.find(a => /^#[0-9a-fA-F]{6}$/.test(a));
 const name = args.slice(1).filter(a => !/^#[0-9a-fA-F]{6}$/.test(a)).join(' ');
 if (!name) return ctx.reply({ content: '❌ Provide a name: `.role create <name> [#hex]`' });
 const newRole = await ctx.guild.roles.create({
 name, color: colorMatch || '#000000',
 reason: `Created by ${ctx.author?.tag || ctx.user?.tag}`,
 });
 return ctx.reply({ embeds: [base(COLORS.success).setTitle('✅ Role Created')
 .addFields(
 { name: '📛 Name', value: `<@&${newRole.id}>`, inline: true },
 { name: '🎨 Color', value: colorMatch || 'Default', inline: true },
 { name: '🆔 ID', value: newRole.id, inline: true },
 )] });
 }

 // ── .role delete @role ──
 if (sub === 'delete') {
 if (!ctx.member.permissions.has(PermissionFlagsBits.ManageRoles))
 return ctx.reply({ content: '❌ Missing `Manage Roles` permission.' });

 // ── ANTINUKE ROLE DELETE PROTECTION ──
 try {
 const { isRoleDeleteAllowed } = require('./antinuke');
 if (!isRoleDeleteAllowed(ctx.guild.id, ctx.author.id)) {
 return ctx.reply({
 embeds: [new EmbedBuilder()
 .setDescription('❌ This action is blocked by the antinuke system.')
 .setColor('#F04747')]
 });
 }
 } catch {}
 // ── END ANTINUKE CHECK ──

 if (!role) {
 const roleQuery = args.slice(1).join(' ');
 role = resolveRole(ctx.guild, roleQuery);
 }
 if (!role) return ctx.reply({ content: '❌ Could not find that role. Usage: `.role delete @role`' });
 const name = role.name;
 await role.delete(`Deleted by ${ctx.author?.tag || ctx.user?.tag}`);
 return ctx.reply({ content: `🗑️ Role **${name}** has been deleted.` });
 }

 // ── .role edit @role <new name> ──
 if (sub === 'edit') {
 if (!ctx.member.permissions.has(PermissionFlagsBits.ManageRoles))
 return ctx.reply({ content: '❌ Missing `Manage Roles` permission.' });
 if (!role) {
 const roleQuery = args[1];
 role = resolveRole(ctx.guild, roleQuery);
 }
 if (!role) return ctx.reply({ content: '❌ Could not find that role. Usage: `.role edit @role <new name>`' });
 const newName = args.slice(2).filter(a => !a.startsWith('<@')).join(' ');
 if (!newName) return ctx.reply({ content: '❌ Provide a new name: `.role edit @role <new name>`' });
 const old = role.name;
 await role.setName(newName);
 return ctx.reply({ content: `✏️ Role renamed: **${old}** → **${newName}**` });
 }

 // ── .role color @role #hex ──
 if (sub === 'color' && args[1] !== 'gradient') {
 if (!ctx.member.permissions.has(PermissionFlagsBits.ManageRoles))
 return ctx.reply({ content: '❌ Missing `Manage Roles` permission.' });
 if (!role) {
 const roleQuery = args[1];
 role = resolveRole(ctx.guild, roleQuery);
 }
 if (!role) return ctx.reply({ content: '❌ Could not find that role. Usage: `.role color @role #hex`' });
 const colorArg = args.find(a => /^#[0-9a-fA-F]{6}$/.test(a)) || args.slice(2).join('');
 if (!colorArg) return ctx.reply({ content: '❌ Provide a hex color: `.role color @role #ff5500`' });
 await role.setColor(colorArg);
 return ctx.reply({ embeds: [base(hexToNum(colorArg)).setTitle('🎨 Role Color Updated')
 .addFields(
 { name: '🎭 Role', value: `<@&${role.id}>`, inline: true },
 { name: '🎨 Color', value: `\`${colorArg}\``, inline: true },
 )] });
 }

 // ── .role color gradient @role #hex1 #hex2 ──
 if (sub === 'color' && args[1] === 'gradient') {
 if (!ctx.member.permissions.has(PermissionFlagsBits.ManageRoles))
 return ctx.reply({ content: '❌ Missing `Manage Roles` permission.' });
 if (!role) {
 const roleQuery = args[2];
 role = resolveRole(ctx.guild, roleQuery);
 }
 if (!role) return ctx.reply({ content: '❌ Could not find that role. Usage: `.role color gradient @role #hex1 #hex2`' });
 const colors = args.filter(a => /^#[0-9a-fA-F]{6}$/.test(a));
 if (colors.length < 2) return ctx.reply({ content: '❌ Provide two hex colors: `.role color gradient @role #ff0000 #0000ff`' });
 const blended = blendColors(colors[0], colors[1]);
 await role.setColor(blended);
 return ctx.reply({ embeds: [base(hexToNum(blended)).setTitle('🎨 Role Gradient Color Set')
 .setDescription(`Discord only supports solid role colors. Your role has been set to the midpoint blend of the two colors.`)
 .addFields(
 { name: '🎭 Role', value: `<@&${role.id}>`, inline: true },
 { name: '🎨 From', value: `\`${colors[0]}\``, inline: true },
 { name: '🎨 To', value: `\`${colors[1]}\``, inline: true },
 { name: '🔀 Result', value: `\`${blended}\``, inline: true },
 )] });
 }

 // ── .role icon @role <url | emoji> ──
 if (sub === 'icon') {
 if (!ctx.member.permissions.has(PermissionFlagsBits.ManageRoles))
 return ctx.reply({ content: '❌ Missing `Manage Roles` permission.' });
 if (!role) {
 const roleQuery = args[1];
 role = resolveRole(ctx.guild, roleQuery);
 }
 if (!role) return ctx.reply({ content: '❌ Could not find that role. Usage: `.role icon @role <url|emoji>`' });

 if (!ctx.guild.features?.includes('ROLE_ICONS'))
 return ctx.reply({ content: '❌ Role icons require **Boost Level 2**. Your server hasn\'t unlocked this feature.' });

 let icon = null;
 let iconType = 'url';

 // 1. Check for URL or attachment
 const url = args.find(a => /^https?:\/\//.test(a))
 || ctx.message?.attachments?.first()?.url;
 if (url) {
 icon = url;
 }

 // 2. Check for emoji in args (if no URL found)
 if (!icon) {
 const emojiArg = args.slice(2).join(' ') || args[1];
 const extracted = extractRoleIcon(emojiArg);
 if (extracted) {
 icon = extracted.value;
 iconType = extracted.type;
 }
 }

 // 3. Also check all args individually for emojis (in case emoji was passed as separate arg)
 if (!icon) {
 for (const arg of args) {
 const extracted = extractRoleIcon(arg);
 if (extracted) {
 icon = extracted.value;
 iconType = extracted.type;
 break;
 }
 }
 }

 if (!icon) return ctx.reply({ content: '❌ Provide an image URL, attach an image, or provide an emoji.' });

 try {
 if (iconType === 'emoji') {
 // Unicode emoji → use unicodeEmoji field, clear image icon
 await role.edit({ icon: null, unicodeEmoji: icon });
 } else {
 // Image URL or custom emoji CDN URL → use icon field, clear unicode emoji
 await role.edit({ icon, unicodeEmoji: null });
 }
 const isEmoji = iconType === 'emoji';
 return ctx.reply({ embeds: [base(COLORS.success).setTitle(isEmoji ? '🎭 Role Emoji Icon Updated' : '🖼️ Role Icon Updated')
 .addFields(
 { name: '🎭 Role', value: `<@&${role.id}>`, inline: true },
 { name: isEmoji ? '🎭 Emoji' : '🖼️ Icon', value: isEmoji ? icon : 'Image set', inline: true },
 )] });
 } catch (err) {
 return ctx.reply({ content: `❌ Failed to set role icon: ${err.message}` });
 }
 }

 // ── .role mentionable @role ──
 if (sub === 'mentionable') {
 if (!ctx.member.permissions.has(PermissionFlagsBits.ManageRoles))
 return ctx.reply({ content: '❌ Missing `Manage Roles` permission.' });
 if (!role) {
 const roleQuery = args[1];
 role = resolveRole(ctx.guild, roleQuery);
 }
 if (!role) return ctx.reply({ content: '❌ Could not find that role.' });
 const newState = !role.mentionable;
 await role.setMentionable(newState);
 return ctx.reply({ content: `✅ <@&${role.id}> is now **${newState ? 'mentionable' : 'not mentionable'}**.` });
 }

 // ── .role hoist @role ──
 if (sub === 'hoist') {
 if (!ctx.member.permissions.has(PermissionFlagsBits.ManageRoles))
 return ctx.reply({ content: '❌ Missing `Manage Roles` permission.' });
 if (!role) {
 const roleQuery = args[1];
 role = resolveRole(ctx.guild, roleQuery);
 }
 if (!role) return ctx.reply({ content: '❌ Could not find that role.' });
 const newState = !role.hoist;
 await role.setHoist(newState);
 return ctx.reply({ content: `✅ <@&${role.id}> is now **${newState ? 'hoisted' : 'not hoisted'}** in the member list.` });
 }

 // ── .role restore @user (restore backed-up roles) ──
 if (sub === 'restore' && target) {
 const db = getGuildDb(ctx.guild.id);
 const backups = db.get('roleBackups', {});
 const saved = backups[target.id];
 if (!saved?.length) return ctx.reply({ content: `❌ No role backup found for **${target.user.username}**.` });

 let restored = 0;
 for (const roleId of saved) {
 const r = ctx.guild.roles.cache.get(roleId);
 if (!r) continue;
 await target.roles.add(r, `Roles restored by <@${getAuthorId(ctx)}>`).then(() => restored++).catch(() => {});
 }

 return ctx.reply({ embeds: [base(COLORS.success).setTitle('♻️ Roles Restored')
 .addFields(
 { name: '👤 User', value: `${target.user}`, inline: true },
 { name: '✅ Restored', value: `${restored}`, inline: true },
 { name: '📋 Total', value: `${saved.length}`, inline: true },
 )] });
 }

 // ── Help ──
 return ctx.reply({ embeds: [base(COLORS.primary).setTitle('🎭 Role Commands')
 .setDescription([
 '**Member:**',
 '`.role add @user @role` `.role remove @user @role`',
 '`.role @user @role` (implied toggle)',
 '`.role @user <role name>` (smart search)',
 '`.role restore @user`',
 '',
 '**Mass (humans only — never bots):**',
 '`.role add all @role` `.role remove all @role`',
 '`.role humans add/remove @role` `.role bots add/remove @role`',
 '`.role has @filterRole add @role`',
 '`.role cancel` — cancel running mass operation',
 '',
 '**Manage:**',
 '`.role create <name> [#color]` `.role delete @role`',
 '`.role edit @role <new name>` `.role color @role #hex`',
 '`.role color gradient @role #hex1 #hex2`',
 '`.role icon @role <url|emoji>` *(Boost Level 2 required)*',
 '`.role mentionable @role` `.role hoist @role`',
 '',
 '**Temporary:**',
 '`.temprole @user <duration> @role [reason]`',
 ].join('\n'))] });
}

// ══════════════════════════════════════════════════════════
// TEMPROLE HANDLER
// ══════════════════════════════════════════════════════════
function scheduleTemproleRemoval(guild, memberId, roleId, ms) {
 const key = `${guild.id}:${memberId}:${roleId}`;
 if (TEMPROLE_TIMERS.has(key)) clearTimeout(TEMPROLE_TIMERS.get(key));
 const timer = setTimeout(async () => {
 TEMPROLE_TIMERS.delete(key);
 const member = await guild.members.fetch(memberId).catch(() => null);
 if (member) await member.roles.remove(roleId, 'Temporary role expired').catch(() => {});
 const db = getGuildDb(guild.id);
 const temproles = db.get('temproles', []);
 db.set('temproles', temproles.filter(t => !(t.userId === memberId && t.roleId === roleId)));
 }, Math.min(ms, 2147483647)); // clamp to max safe setTimeout
 TEMPROLE_TIMERS.set(key, timer);
}

async function handleTempRole(ctx, args, client) {
 const { isStaffOrAdmin } = require('./helpers');
 if (!isStaffOrAdmin(ctx.member)) return ctx.reply({ content: '❌ No permission.', ephemeral: true });

 if (args[0] === 'list') {
 const db = getGuildDb(ctx.guild.id);
 const temproles = db.get('temproles', []);
 if (!temproles.length) return ctx.reply({ content: 'No active temporary roles.' });
 const lines = temproles.map(t =>
 `<@${t.userId}> → <@&${t.roleId}> — expires <t:${Math.floor(t.expires / 1000)}:R>`
 ).join('\n');
 return ctx.reply({ embeds: [base(COLORS.primary).setTitle('⏱️ Active Temporary Roles').setDescription(lines)] });
 }

 const target = ctx.mentions?.members?.first();
 let role = ctx.mentions?.roles?.first();
 const cleanArgs = args.filter(a => !/<[@&!#]?\d+>/.test(a));
 const duration = parseDuration(cleanArgs[0]);

 if (!target) return ctx.reply({ content: '❌ Usage: `.temprole @user <duration> @role [reason]`\nExample: `.temprole @user 1h @Member`' });
 if (!role && args.length >= 3) {
 const roleQuery = args.slice(2).join(' ');
 role = resolveRole(ctx.guild, roleQuery);
 }
 if (!role || !duration)
 return ctx.reply({ content: '❌ Usage: `.temprole @user <duration> @role [reason]`\nExample: `.temprole @user 1h @Member`' });

 const reason = cleanArgs.slice(1).join(' ') || 'Temporary role';
 const authorId = getAuthorId(ctx);
 const expires = Date.now() + duration;

 await target.roles.add(role, reason);

 const db = getGuildDb(ctx.guild.id);
 const temproles = db.get('temproles', []);
 // Replace existing entry for same user+role
 const filtered = temproles.filter(t => !(t.userId === target.id && t.roleId === role.id));
 filtered.push({ userId: target.id, roleId: role.id, expires, by: authorId });
 db.set('temproles', filtered);

 createCase(ctx.guild.id, { type: 'role', targetId: target.id, executorId: authorId, reason, duration: formatDuration(duration), expires });
 scheduleTemproleRemoval(ctx.guild, target.id, role.id, duration);

 return ctx.reply({ embeds: [base(COLORS.success).setTitle('⏱️ Temporary Role Assigned')
 .addFields(
 { name: '👤 User', value: `${target.user}`, inline: true },
 { name: '🎭 Role', value: `<@&${role.id}>`, inline: true },
 { name: '⏱️ Duration', value: formatDuration(duration), inline: true },
 { name: '⌛ Expires', value: `<t:${Math.floor(expires / 1000)}:R>`, inline: true },
 { name: '📝 Reason', value: reason },
 )] });
}

// ══════════════════════════════════════════════════════════
// RESTORE TIMERS ON BOT RESTART
// ══════════════════════════════════════════════════════════
async function restoreTempRoles(client) {
 for (const guild of client.guilds.cache.values()) {
 const db = getGuildDb(guild.id);
 const temproles = db.get('temproles', []);
 const now = Date.now();
 const active = [];

 for (const t of temproles) {
 if (t.expires <= now) {
 const member = await guild.members.fetch(t.userId).catch(() => null);
 if (member) await member.roles.remove(t.roleId, 'Temporary role expired (on restart)').catch(() => {});
 } else {
 active.push(t);
 scheduleTemproleRemoval(guild, t.userId, t.roleId, t.expires - now);
 }
 }
 db.set('temproles', active);
 }
}

// ══════════════════════════════════════════════════════════
// ROLE BACKUP (called from guildMemberRemove)
// ══════════════════════════════════════════════════════════
function backupMemberRoles(member) {
 const db = getGuildDb(member.guild.id);
 const backups = db.get('roleBackups', {});
 const roleIds = [...member.roles.cache.keys()].filter(id => id !== member.guild.id);
 if (roleIds.length) { backups[member.id] = roleIds; db.set('roleBackups', backups); }
}

module.exports = { handleRole, handleTempRole, restoreTempRoles, backupMemberRoles };