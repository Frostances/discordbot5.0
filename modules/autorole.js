const { PermissionsBitField } = require('discord.js');
const { getGuildDb } = require('./database');
const { isAdmin, resolveRole } = require('./helpers');
const { ok, err, info, success, error, COLORS } = require('../utils/embeds');

/**
 * Check if the message author has permission to manage autoroles.
 * Requires ManageRoles Discord permission or isAdmin.
 */
function hasPermission(message) {
  return isAdmin(message.member) || message.member.permissions.has(PermissionsBitField.Flags.ManageRoles);
}

/**
 * Handle the autorole command and its subcommands.
 * @param {import('discord.js').Message} message
 * @param {string[]} args
 */
async function handleAutoRoleCommand(message, args) {
  if (!hasPermission(message)) {
    return message.reply(err('You need the **Manage Roles** permission to use this command.'));
  }

  const sub = (args[0] || '').toLowerCase();

  if (!sub || sub === 'list') {
    return showList(message);
  }

  if (sub === 'add') {
    return addRole(message, args.slice(1));
  }

  if (sub === 'remove') {
    return removeRole(message, args.slice(1));
  }

  if (sub === 'reset') {
    return resetRoles(message);
  }

  // Unknown subcommand — show overview
  return showList(message);
}

async function showList(message) {
  const db = getGuildDb(message.guild.id);
  const autoRoles = db.get('autoRoles', []);

  if (!autoRoles.length) {
    return message.reply({
      embeds: [info('Auto Roles', 'No auto roles configured.\n\nUse `,autorole add @role` to add one.')]
    });
  }

  const lines = autoRoles.map((id, i) => {
    const role = message.guild.roles.cache.get(id);
    return `${i + 1}. ${role ? `<@&${id}>` : `~~${id}~~ (deleted)`}`;
  });

  return message.reply({
    embeds: [info('🎭 Auto Roles', lines.join('\n'))
      .setFooter({ text: `${autoRoles.length} role(s) configured • Kaido` })]
  });
}

async function addRole(message, args) {
  let role = message.mentions.roles.first() || message.guild.roles.cache.get(args[0]);
  if (!role) {
    const roleQuery = args.join(' ');
    role = resolveRole(message.guild, roleQuery);
  }
  if (!role) {
    return message.reply(err('Please mention a valid role to add.\n\nUsage: `,autorole add @role`'));
  }

  // Check the bot can manage the role
  const botMember = message.guild.members.me;
  if (role.position >= botMember.roles.highest.position) {
    return message.reply(err('I cannot manage that role as it is above or equal to my highest role.'));
  }

  if (role.managed) {
    return message.reply(err('That role is managed by an integration and cannot be auto-assigned.'));
  }

  const db = getGuildDb(message.guild.id);
  const autoRoles = db.get('autoRoles', []);

  if (autoRoles.includes(role.id)) {
    return message.reply(err(`<@&${role.id}> is already in the auto roles list.`));
  }

  autoRoles.push(role.id);
  db.set('autoRoles', autoRoles);

  return message.reply(ok(`<@&${role.id}> will now be assigned to new members when they join.`, 'Auto Role Added'));
}

async function removeRole(message, args) {
  let role = message.mentions.roles.first() || message.guild.roles.cache.get(args[0]);
  if (!role) {
    const roleQuery = args.join(' ');
    role = resolveRole(message.guild, roleQuery);
  }
  if (!role) {
    return message.reply(err('Please mention a valid role to remove.\n\nUsage: `,autorole remove @role`'));
  }

  const db = getGuildDb(message.guild.id);
  const autoRoles = db.get('autoRoles', []);
  const idx = autoRoles.indexOf(role.id);

  if (idx === -1) {
    return message.reply(err(`<@&${role.id}> is not in the auto roles list.`));
  }

  autoRoles.splice(idx, 1);
  db.set('autoRoles', autoRoles);

  return message.reply(ok(`<@&${role.id}> has been removed from auto roles.`, 'Auto Role Removed'));
}

async function resetRoles(message) {
  const db = getGuildDb(message.guild.id);
  db.set('autoRoles', []);
  return message.reply(ok('All auto roles have been cleared.', 'Auto Roles Reset'));
}

/**
 * Assign all configured autoroles to a new member on join.
 * @param {import('discord.js').GuildMember} member
 */
async function handleAutoRoleJoin(member) {
  if (member.user.bot) return;

  const db = getGuildDb(member.guild.id);
  const autoRoles = db.get('autoRoles', []);
  if (!autoRoles.length) return;

  const botMember = member.guild.members.me;

  for (const roleId of autoRoles) {
    const role = member.guild.roles.cache.get(roleId);
    if (!role) continue;

    // Skip if bot can't manage this role
    if (role.position >= botMember.roles.highest.position) continue;
    if (role.managed) continue;

    try {
      await member.roles.add(role, 'Auto Role on join');
    } catch (e) {
      // Silently skip roles we can't assign
    }
  }
}

module.exports = { handleAutoRoleCommand, handleAutoRoleJoin };
