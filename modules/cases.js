// Professional case management system
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getGuildDb } = require('./database');
const { getSetting } = require('./config');
const { COLORS, base } = require('../utils/embeds');
const { chunk } = require('../utils/paginator');

const CASE_ICONS = {
  warn: '⚠️', kick: '👢', ban: '🔨', unban: '🔓',
  softban: '🧹', hardban: '🔒', tempban: '⏱️', timeout: '🔇',
  untimeout:'🔊', mute: '🔇', unmute: '🔊', imute: '🖼️', iunmute: '🖼️',
  rmute: '😶', runmute: '😶', jail: '🏛️',
  unjail: '🔓', note: '📝', lock: '🔐', unlock: '🔑',
  slowmode: '🐌', nickname:'✏️', role: '🎭', lockdown:'🚨',
  nuke: '💣', hide: '👁', unhide: '👁', tempban_expire: '⌛',
};

function getIcon(type) { return CASE_ICONS[type] || '📋'; }

// ── Format time left ──
function formatTimeLeft(ms) {
  if (ms <= 0) return 'Expired';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

// ── Create a new case ──
function createCase(guildId, data) {
  const db = getGuildDb(guildId);
  const cases = db.get('cases', []);
  const id = cases.length + 1;
  const c = {
    id,
    type: data.type,
    targetId: data.targetId,
    executorId: data.executorId,
    reason: data.reason || 'No reason provided',
    timestamp: Date.now(),
    guildId,
    // optional
    duration: data.duration || null,
    expires: data.expires || null,
    evidence: data.evidence || [],
    proof: data.proof || [],
    extra: data.extra || {},
    status: data.status || 'active',
    edited: false,
    editHistory: [],
  };
  cases.push(c);
  db.set('cases', cases);
  return c;
}

function getCase(guildId, id) {
  return getGuildDb(guildId).get('cases', []).find(c => c.id === id) || null;
}

function getAllCases(guildId) {
  return getGuildDb(guildId).get('cases', []);
}

function updateCase(guildId, id, updates) {
  const db = getGuildDb(guildId);
  const cases = db.get('cases', []);
  const idx = cases.findIndex(c => c.id === id);
  if (idx === -1) return null;
  Object.assign(cases[idx], updates);
  db.set('cases', cases);
  return cases[idx];
}

// ── Build a case embed ──
async function buildCaseEmbed(c, client) {
  const icon = getIcon(c.type);
  const target = await client.users.fetch(c.targetId).catch(() => null);
  const mod = await client.users.fetch(c.executorId).catch(() => null);

  const embed = base(COLORS.error)
    .setTitle(`${icon} Case #${c.id} — ${c.type.toUpperCase()}`)
    .setColor(c.status === 'pardoned' ? COLORS.success : COLORS.error)
    .addFields(
      { name: '👤 User', value: target ? `${target.username}\n\`${c.targetId}\`` : `\`${c.targetId}\``, inline: true },
      { name: '👮 Moderator', value: mod ? `${mod.username}\n\`${c.executorId}\`` : `\`${c.executorId}\``, inline: true },
      { name: '📅 Date', value: `<t:${Math.floor(c.timestamp / 1000)}:R>`, inline: true },
      { name: '📝 Reason', value: c.reason },
    );

  if (c.duration) embed.addFields({ name: '⏱️ Duration', value: c.duration, inline: true });
  if (c.expires) embed.addFields({ name: '⌛ Expires', value: `<t:${Math.floor(c.expires / 1000)}:R>`, inline: true });
  if (c.status) embed.addFields({ name: '🏷️ Status', value: c.status, inline: true });
  if (c.proof?.length) embed.addFields({ name: `🔗 Proof [${c.proof.length}]`, value: c.proof.map((p, i) => `${i + 1}. ${p}`).join('\n') });
  if (c.edited) embed.setFooter({ text: `Case #${c.id} • Reason was edited` });

  if (target) embed.setThumbnail(target.displayAvatarURL());
  return embed;
}

// ── Send to mod log ──
async function sendModLog(guild, embed, extraContent = '') {
  const chId = getSetting(guild.id, 'modLogChannelId');
  if (!chId) return;
  const ch = guild.channels.cache.get(chId);
  if (ch) await ch.send({ content: extraContent || undefined, embeds: [embed] }).catch(() => {});
}

// ── Format duration string ──
function formatDuration(ms) {
  if (!ms) return null;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

// ── Parse duration string → ms ──
function parseDuration(str) {
  if (!str) return null;
  const map = { s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000 };
  const match = str.match(/^(\d+)([smhdw])$/i);
  if (!match) return null;
  return parseInt(match[1]) * (map[match[2].toLowerCase()] || 0);
}

// ── Get active warnings (filters expired) ──
function getActiveWarnings(guildId, userId) {
  const now = Date.now();
  return getAllCases(guildId).filter(c =>
    c.targetId === userId && c.type === 'warn' && c.status !== 'pardoned' &&
    (!c.expires || c.expires > now)
  );
}

// ── Clear a specific warn by case ID ──
async function cmdClearWarn(ctx, args, client) {
  const { isStaffOrAdmin } = require('./helpers');
  if (!isStaffOrAdmin(ctx.member)) return ctx.reply({ content: '❌ No permission.', ephemeral: true });

  const caseId = parseInt(args[0]);
  if (isNaN(caseId)) return ctx.reply({ content: '❌ Provide a case number. Usage: `.clearwarn <case #>`', ephemeral: true });

  const c = getCase(ctx.guild.id, caseId);
  if (!c) return ctx.reply({ content: `❌ Case **#${caseId}** not found.`, ephemeral: true });
  if (c.type !== 'warn') return ctx.reply({ content: `❌ Case **#${caseId}** is not a warning.`, ephemeral: true });
  if (c.status === 'pardoned') return ctx.reply({ content: `❌ Case **#${caseId}** is already cleared.`, ephemeral: true });

  updateCase(ctx.guild.id, caseId, { status: 'pardoned' });

  return ctx.reply({ content: `✅ A warn was cleared from <@${c.targetId}>` });
}

// ── Clear all warns ──
async function cmdClearAllWarns(ctx, args, client) {
  const { isStaffOrAdmin } = require('./helpers');
  if (!isStaffOrAdmin(ctx.member)) return ctx.reply({ content: '❌ No permission.', ephemeral: true });

  const target = ctx.mentions?.users?.first() || (args[0] ? await client.users.fetch(args[0]).catch(() => null) : null);
  if (!target) return ctx.reply({ content: '❌ Mention a user. Usage: `.clearallwarns @user`', ephemeral: true });

  const db = getGuildDb(ctx.guild.id);
  const cases = db.get('cases', []);
  let cleared = 0;

  for (const c of cases) {
    if (c.type === 'warn' && c.targetId === target.id && c.status !== 'pardoned') {
      c.status = 'pardoned';
      cleared++;
    }
  }

  db.set('cases', cases);

  if (!cleared) return ctx.reply({ content: `✅ **${target.username}** has no active warnings.` });
  return ctx.reply({ content: `✅ Cleared all **${cleared}** warns from **${target}**` });
}

// ── Set warn expiration ──
async function cmdExpireWarn(ctx, args) {
  const { isAdmin } = require('./helpers');
  if (!isAdmin(ctx.member)) return ctx.reply({ content: '❌ Only admins can configure warn expiration.', ephemeral: true });

  const durStr = args[0];
  if (!durStr) {
    const db = getGuildDb(ctx.guild.id);
    const current = db.get('warnExpires', 0);
    if (current) {
      return ctx.reply({ content: `⏱️ Current warn expiration: **${formatDuration(current)}**\nTo disable: \`.expirewarn 0\`` });
    }
    return ctx.reply({ content: '⏱️ Warn expiration is currently **disabled**.\nTo set: \`.expirewarn <time>\` (e.g. \`7d\`, \`30d\`)' });
  }

  if (durStr === '0') {
    const db = getGuildDb(ctx.guild.id);
    db.set('warnExpires', 0);
    return ctx.reply({ content: '✅ Warn expiration has been **disabled**.' });
  }

  const ms = parseDuration(durStr);
  if (!ms) return ctx.reply({ content: '❌ Invalid duration. Use: `1d`, `7d`, `30d`, `0` to disable.', ephemeral: true });

  const db = getGuildDb(ctx.guild.id);
  db.set('warnExpires', ms);
  return ctx.reply({ content: `✅ Warn expiration set to **${formatDuration(ms)}**.\nNew warnings will auto-expire after this time.` });
}

// ── Auto-clean expired warns (runs every 10 min) ──
function startWarnCleanup() {
  setInterval(() => {
    const now = Date.now();
    // We can't easily iterate all guilds here without client reference
    // So we do lazy cleanup: filter on read in getActiveWarnings
    // But also we can clean the DB if we had client... skip for now
  }, 10 * 60 * 1000);
}
startWarnCleanup();

// ──────────────────────────────────────────────────────────
// COMMAND HANDLERS
// ──────────────────────────────────────────────────────────

// .case
async function cmdCase(ctx, args, client) {
  const { isStaffOrAdmin } = require('./helpers');
  if (!isStaffOrAdmin(ctx.member)) return ctx.reply({ content: '❌ No permission.', ephemeral: true });
  const id = parseInt(args[0]);
  if (isNaN(id)) return ctx.reply({ content: '❌ Provide a case number.', ephemeral: true });
  const c = getCase(ctx.guild.id, id);
  if (!c) return ctx.reply({ content: `❌ Case **#${id}** not found.`, ephemeral: true });
  const embed = await buildCaseEmbed(c, client);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`case_proof_${id}`).setLabel('Proof').setEmoji('🔗').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`case_edit_${id}`).setLabel('Edit Reason').setEmoji('✏️').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`case_pardon_${id}`).setLabel('Pardon').setEmoji('✅').setStyle(ButtonStyle.Success),
  );
  return ctx.reply({ embeds: [embed], components: [row] });
}

// .reason
async function cmdReason(ctx, args, client) {
  const { isStaffOrAdmin } = require('./helpers');
  if (!isStaffOrAdmin(ctx.member)) return ctx.reply({ content: '❌ No permission.', ephemeral: true });
  const id = parseInt(args[0]);
  const newReason = args.slice(1).join(' ');
  if (isNaN(id) || !newReason) return ctx.reply({ content: '❌ Usage: `.reason <case #> <new reason>`', ephemeral: true });
  const c = getCase(ctx.guild.id, id);
  if (!c) return ctx.reply({ content: `❌ Case **#${id}** not found.`, ephemeral: true });
  updateCase(ctx.guild.id, id, {
    reason: newReason, edited: true,
    editHistory: [...(c.editHistory || []), { old: c.reason, by: ctx.author?.id || ctx.user?.id, at: Date.now() }],
  });
  return ctx.reply({ embeds: [base(COLORS.success)
    .setTitle('✏️ Reason Updated')
    .addFields({ name: `Case #${id}`, value: newReason })
    .setFooter({ text: `Updated by ${ctx.author?.username || ctx.user?.username}` })
  ]});
}

// .proof add/remove/list/view <case #> [link]
async function cmdProof(ctx, args, client) {
  const { isStaffOrAdmin } = require('./helpers');
  if (!isStaffOrAdmin(ctx.member)) return ctx.reply({ content: '❌ No permission.', ephemeral: true });
  const sub = args[0]?.toLowerCase();
  const id = parseInt(args[1]);
  if (isNaN(id)) return ctx.reply({ content: '❌ Provide a case number.', ephemeral: true });
  const c = getCase(ctx.guild.id, id);
  if (!c) return ctx.reply({ content: `❌ Case **#${id}** not found.`, ephemeral: true });

  if (sub === 'add') {
    const link = args.slice(2).join(' ');
    if (!link) return ctx.reply({ content: '❌ Provide a proof link.', ephemeral: true });
    const proof = [...(c.proof || []), link];
    updateCase(ctx.guild.id, id, { proof });
    return ctx.reply({ embeds: [base(COLORS.success).setTitle(`🔗 Proof Added to Case #${id}`).setDescription(link)] });
  }
  if (sub === 'remove') {
    const idx = parseInt(args[2]) - 1;
    if (isNaN(idx) || idx < 0 || idx >= (c.proof || []).length)
      return ctx.reply({ content: '❌ Invalid proof number.', ephemeral: true });
    const proof = [...(c.proof || [])];
    proof.splice(idx, 1);
    updateCase(ctx.guild.id, id, { proof });
    return ctx.reply({ content: `✅ Proof #${idx + 1} removed from Case #${id}.` });
  }
  if (sub === 'list' || sub === 'view') {
    const proof = c.proof || [];
    if (!proof.length) return ctx.reply({ content: `Case **#${id}** has no proof attached.` });
    const embed = base(COLORS.primary)
      .setTitle(`🔗 Proof — Case #${id}`)
      .setDescription(proof.map((p, i) => `**${i + 1}.** ${p}`).join('\n'));
    return ctx.reply({ embeds: [embed] });
  }
  return ctx.reply({ content: '❌ Usage: `.proof <add/remove/list> <case #> [link]`' });
}

// .history [@user] (paginated)
async function cmdHistory(ctx, args, client) {
  const { isStaffOrAdmin } = require('./helpers');
  if (!isStaffOrAdmin(ctx.member)) return ctx.reply({ content: '❌ No permission.', ephemeral: true });
  const target = ctx.mentions?.users?.first() || (args[0] ? await client.users.fetch(args[0]).catch(() => null) : null);
  if (!target) return ctx.reply({ content: '❌ Mention a user or provide their ID.', ephemeral: true });
  const cases = getAllCases(ctx.guild.id).filter(c => c.targetId === target.id);
  if (!cases.length) return ctx.reply({ content: `**${target.username}** has no moderation history.` });

  const pages = chunk(cases.reverse(), 5).map((page, idx) => {
    const lines = page.map(c => {
      const icon = getIcon(c.type);
      const dur = c.duration ? ` *(${c.duration})*` : '';
      const expired = c.expires && c.expires <= Date.now() ? ' ~~(expired)~~' : '';
      const pardoned = c.status === 'pardoned' ? ' ~~(pardoned)~~' : '';
      return `${icon} **Case #${c.id}** — \`${c.type.toUpperCase()}\`${dur}${expired}${pardoned}\n↳ ${c.reason}\n↳ <t:${Math.floor(c.timestamp / 1000)}:R>`;
    }).join('\n\n');
    return {
      title: `📋 History — ${target.username}`,
      description: lines,
      color: COLORS.warning,
    };
  });

  const { sendPaginated } = require('../utils/paginator');
  const authorId = ctx.author?.id || ctx.user?.id;
  return sendPaginated(ctx.channel || ctx, pages, authorId);
}

// .history remove
async function cmdHistoryRemove(ctx, args, client) {
  const { isAdmin } = require('./helpers');
  if (!isAdmin(ctx.author?.id || ctx.user?.id)) return ctx.reply({ content: '❌ Only admins can remove cases.', ephemeral: true });
  const id = parseInt(args[0]);
  if (isNaN(id)) return ctx.reply({ content: '❌ Provide a case ID.', ephemeral: true });
  const db = getGuildDb(ctx.guild.id);
  const cases = db.get('cases', []).filter(c => c.id !== id);
  db.set('cases', cases);
  return ctx.reply({ content: `✅ Case **#${id}** removed.` });
}

// .history removeall @user
async function cmdHistoryRemoveAll(ctx, args, client) {
  const { isAdmin } = require('./helpers');
  if (!isAdmin(ctx.author?.id || ctx.user?.id)) return ctx.reply({ content: '❌ Only admins can clear history.', ephemeral: true });
  const target = ctx.mentions?.users?.first();
  if (!target) return ctx.reply({ content: '❌ Mention a user.', ephemeral: true });
  const db = getGuildDb(ctx.guild.id);
  const before = db.get('cases', []).length;
  db.set('cases', db.get('cases', []).filter(c => c.targetId !== target.id));
  const removed = before - db.get('cases', []).length;
  return ctx.reply({ content: `✅ Removed **${removed}** case(s) for **${target.username}**.` });
}

// .modstats [@user]
async function cmdModStats(ctx, args, client) {
  const { isStaffOrAdmin } = require('./helpers');
  if (!isStaffOrAdmin(ctx.member)) return ctx.reply({ content: '❌ No permission.', ephemeral: true });
  const target = ctx.mentions?.users?.first() || ctx.author || ctx.user;
  const cases = getAllCases(ctx.guild.id).filter(c => c.executorId === target.id);

  const counts = {};
  for (const c of cases) counts[c.type] = (counts[c.type] || 0) + 1;
  const lines = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([t, n]) => `${getIcon(t)} **${t}**: ${n}`).join('\n') || 'No actions found.';

  const embed = base(COLORS.primary)
    .setTitle(`📊 Mod Stats — ${target.username}`)
    .setDescription(lines)
    .addFields({ name: 'Total Actions', value: cases.length.toString(), inline: true })
    .setThumbnail(target.displayAvatarURL?.() || null);
  return ctx.reply({ embeds: [embed] });
}

// .warnings [@user]
async function cmdWarnings(ctx, args, client) {
  const { isStaffOrAdmin } = require('./helpers');
  if (!isStaffOrAdmin(ctx.member)) return ctx.reply({ content: '❌ No permission.', ephemeral: true });
  const target = ctx.mentions?.users?.first() || ctx.author || ctx.user;
  const cases = getActiveWarnings(ctx.guild.id, target.id);

  if (!cases.length) return ctx.reply({ content: `**${target.username}** has no active warnings.` });

  const pages = chunk(cases.reverse(), 8).map((page, idx) => ({
    title: `⚠️ Warnings — ${target.username}`,
    description: page.map(c => {
      let extra = '';
      if (c.expires) {
        const left = c.expires - Date.now();
        extra = left > 0 ? ` *(expires in ${formatTimeLeft(left)})*` : ' *(expired)*';
      }
      return `**#${c.id}** — ${c.reason}${extra}\n↳ <t:${Math.floor(c.timestamp / 1000)}:R> by <@${c.executorId}>`;
    }).join('\n\n'),
    color: COLORS.warning,
  }));

  const { sendPaginated } = require('../utils/paginator');
  return sendPaginated(ctx.channel, pages, ctx.author?.id || ctx.user?.id);
}

async function cmdClearAllServerWarns(ctx, args, client) {
  const { isStaffOrAdmin } = require('./helpers');
  if (!isStaffOrAdmin(ctx.member)) return ctx.reply({ content: '❌ No permission.', ephemeral: true });

  const db = getGuildDb(ctx.guild.id);
  const cases = db.get('cases', []);
  let cleared = 0;

  for (const c of cases) {
    if (c.type === 'warn' && c.status !== 'pardoned') {
      c.status = 'pardoned';
      cleared++;
    }
  }

  db.set('cases', cases);

  if (!cleared) return ctx.reply({ content: '✅ No active warnings on the server.' });
  return ctx.reply({ content: `✅ Cleared all **${cleared}** warnings from the server!` });
}

module.exports = {
  createCase, getCase, getAllCases, updateCase, buildCaseEmbed, sendModLog,
  parseDuration, formatDuration, getIcon, formatTimeLeft, getActiveWarnings,
  cmdCase, cmdReason, cmdProof, cmdHistory, cmdHistoryRemove, cmdHistoryRemoveAll,
  cmdModStats, cmdWarnings, cmdClearWarn, cmdClearAllWarns, cmdClearAllServerWarns, cmdExpireWarn,
};