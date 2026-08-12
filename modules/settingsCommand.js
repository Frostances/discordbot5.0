/**
 * settingsCommand.js — Full server settings system
 */
const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { getGuildDb } = require('./database');
const { COLORS, base, success, error, info } = require('../utils/embeds');
const { isAdmin } = require('./helpers');

// Setting definitions: key → { field, label, type, perm }
const SETTINGS_DEF = {
  premiumrole:    { field: 'premiumRoleId',       label: 'Premium Members Role',  type: 'role',   perm: 'ManageGuild' },
  dj:             { field: 'djRoleId',            label: 'DJ Role',               type: 'role',   perm: 'ManageGuild' },
  autonick:       { field: 'autoNick',            label: 'Auto Nickname',         type: 'text',   perm: 'ManageGuild' },
  baserole:       { field: 'baseRoleId',          label: 'Base Role (Boost)',     type: 'role',   perm: 'ManageGuild' },
  jail:           { field: 'jailChannelId',       label: 'Jail Channel',          type: 'channel', perm: 'ManageGuild' },
  muted:          { field: 'mutedRoleId',         label: 'Text Muted Role',       type: 'role',   perm: 'ManageGuild' },
  joinlogs:       { field: 'joinLogsChannelId',   label: 'Join/Leave Logs',       type: 'channel', perm: 'ManageGuild' },
  jailroles:      { field: 'jailRemoveRoles',     label: 'Jail Remove Roles',     type: 'bool',   perm: 'ManageGuild' },
  jailrole:       { field: 'jailRoleId',          label: 'Jail Role',             type: 'role',   perm: 'ManageGuild' },
  modlog:         { field: 'modLogChannelId',     label: 'Mod Log Channel',       type: 'channel', perm: 'ManageGuild' },
  disablecustomfms:{ field: 'disableCustomFms',   label: 'Disable Custom FMs',    type: 'bool',   perm: 'ManageChannels' },
  rmuted:         { field: 'rmutedRoleId',        label: 'Reaction Muted Role',   type: 'role',   perm: 'ManageGuild' },
  imuted:         { field: 'imutedRoleId',        label: 'Image Muted Role',      type: 'role',   perm: 'ManageGuild' },
  jailmsg:        { field: 'jailMessage',         label: 'Jail Message',          type: 'text',   perm: 'ManageGuild' },
};

function hasPerm(member, perm) {
  if (perm === 'Administrator') return isAdmin(member);
  if (perm === 'ManageGuild') return member.permissions.has(PermissionFlagsBits.ManageGuild) || isAdmin(member);
  if (perm === 'ManageChannels') return member.permissions.has(PermissionFlagsBits.ManageChannels) || isAdmin(member);
  return isAdmin(member);
}

function formatSettingValue(guild, type, value) {
  if (value === null || value === undefined || value === '') return '*(not set)*';
  if (type === 'channel') {
    const ch = guild.channels.cache.get(value);
    return ch ? `<#${value}>` : `\`${value}\``;
  }
  if (type === 'role') {
    const r = guild.roles.cache.get(value);
    return r ? `<@&${value}>` : `\`${value}\``;
  }
  if (type === 'bool') return value === true || value === 'yes' ? '✅ Yes' : '❌ No';
  return `\`${value}\``;
}

async function handleSettingsCommand(message, args) {
  const db = getGuildDb(message.guild.id);
  const sub = args[0]?.toLowerCase();

  // ── .settings config / .settings (no args) ──
  if (!sub || sub === 'config') {
    const settings = db.get('settings', {});
    const lines = Object.entries(SETTINGS_DEF).map(([key, def]) => {
      const val = settings[def.field];
      return `**${def.label}** \`(${key})\`
→ ${formatSettingValue(message.guild, def.type, val)}`;
    });

    const embed = base(COLORS.primary)
      .setTitle('⚙️ Server Settings Configuration')
      .setDescription(lines.join('\n\n'))
      .setFooter({ text: `Use ,settings <key> <value> • Manage Guild required` })
      .setTimestamp();
    return message.reply({ embeds: [embed] });
  }

  // ── .settings staff (list) ──
  if (sub === 'staff') {
    if (args[1]?.toLowerCase() === 'list') {
      const staffRoles = db.get('staffRoles', []);
      if (!staffRoles.length) return message.reply({ embeds: [info('Staff Roles', 'No staff roles are configured.')] });
      const list = staffRoles.map(id => {
        const r = message.guild.roles.cache.get(id);
        return r ? `<@&${id}>` : `\`${id}\``;
      }).join('\n');
      return message.reply({ embeds: [base(COLORS.primary).setTitle('👮 Staff Roles').setDescription(list)] });
    }

    // .settings staff @role
    if (!hasPerm(message.member, 'ManageGuild')) return message.reply({ embeds: [error('Permission Denied', 'You need **Manage Server** permission.')] });
    const role = message.mentions.roles.first();
    if (!role) return message.reply({ embeds: [error('Missing Role', 'Usage: `,settings staff @role` or `,settings staff list`')] });
    const staffRoles = db.get('staffRoles', []);
    if (staffRoles.includes(role.id)) {
      const filtered = staffRoles.filter(id => id !== role.id);
      db.set('staffRoles', filtered);
      return message.reply({ embeds: [success('Staff Role Removed', `<@&${role.id}> has been removed from staff roles.`)] });
    }
    staffRoles.push(role.id);
    db.set('staffRoles', staffRoles);
    return message.reply({ embeds: [success('Staff Role Added', `<@&${role.id}> has been added to staff roles.`)] });
  }

  // ── .settings resetcases ──
  if (sub === 'resetcases') {
    if (!hasPerm(message.member, 'Administrator')) return message.reply({ embeds: [error('Permission Denied', 'You need **Administrator** permission.')] });
    db.set('cases', []);
    return message.reply({ embeds: [success('Cases Reset', 'All jail-log / mod cases have been reset.')] });
  }

  // ── .settings reset ──
  if (sub === 'reset') {
    if (!hasPerm(message.member, 'Administrator')) return message.reply({ embeds: [error('Permission Denied', 'You need **Administrator** permission.')] });
    db.set('settings', {});
    return message.reply({ embeds: [success('Settings Reset', 'All moderation configuration has been reset to default.')] });
  }

  // ── Standard settings ──
  const def = SETTINGS_DEF[sub];
  if (!def) return message.reply({ embeds: [error('Unknown Setting', `Valid keys: ${Object.keys(SETTINGS_DEF).join(', ')}, staff`)] });

  if (!hasPerm(message.member, def.perm)) {
    const permName = def.perm === 'ManageGuild' ? 'Manage Server' : def.perm === 'ManageChannels' ? 'Manage Channels' : 'Administrator';
    return message.reply({ embeds: [error('Permission Denied', `You need **${permName}** permission.`)] });
  }

  const raw = args.slice(1).join(' ');
  if (!raw) return message.reply({ embeds: [error('Missing Value', `Usage: \`,settings ${sub} <value>\``)] });

  const settings = db.get('settings', {});

  if (def.type === 'bool') {
    const val = ['yes', 'true', '1', 'on'].includes(raw.toLowerCase());
    settings[def.field] = val;
    db.set('settings', settings);
    return message.reply({ embeds: [success(`${def.label} Updated`, `${def.label} is now **${val ? 'Enabled' : 'Disabled'}**.`)] });
  }

  if (def.type === 'text') {
    settings[def.field] = raw;
    db.set('settings', settings);
    return message.reply({ embeds: [success(`${def.label} Updated`, `${def.label} has been set to:\n\`${raw}\``)] });
  }

  // channel / role
  const id = raw.replace(/[<#@&!>]/g, '').trim();
  settings[def.field] = id;
  db.set('settings', settings);
  return message.reply({ embeds: [success(`${def.label} Updated`, `${def.label} has been set to ${formatSettingValue(message.guild, def.type, id)}.`)] });
}

module.exports = { handleSettingsCommand };