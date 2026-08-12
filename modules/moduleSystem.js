const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const { getGuildDb } = require('./database');
const { isAdmin } = require('./helpers');
const { COLORS, base } = require('../utils/embeds');

// ══════════════════════════════════════════════════════════
// MODULE REGISTRY
// ══════════════════════════════════════════════════════════

const MODULES = {
  moderation: 'Moderation',
  automod: 'AutoMod',
  antinuke: 'Anti-Nuke',
  antiraid: 'Anti-Raid',
  levels: 'Levels',
  tickets: 'Tickets',
  voicemaster: 'Voice Master',
  streaks: 'Streaks',
  swears: 'Swears',
  guessword: 'Guess Word',
  filters: 'Filters',
  roleplay: 'Roleplay',
};

const MODULE_ORDER = [
  'moderation',
  'automod',
  'antinuke',
  'antiraid',
  'levels',
  'tickets',
  'voicemaster',
  'streaks',
  'swears',
  'guessword',
  'filters',
  'roleplay',
];

// ══════════════════════════════════════════════════════════
// STATE HELPERS
// ══════════════════════════════════════════════════════════

function isModuleEnabled(guildId, moduleName) {
  const db = getGuildDb(guildId);
  const mods = db.get('modules', {});
  if (moduleName === 'roleplay') {
    return mods[moduleName] === true; // roleplay defaults to DISABLED
  }
  return mods[moduleName] !== false; // default = enabled for everything else
}

function setModuleEnabled(guildId, moduleName, enabled) {
  const db = getGuildDb(guildId);
  const mods = db.get('modules', {});
  mods[moduleName] = enabled;
  db.set('modules', mods);
}

// ══════════════════════════════════════════════════════════
// PANEL BUILDER
// ══════════════════════════════════════════════════════════

function buildModulePanel(guildId) {
  const lines = [];
  for (const key of MODULE_ORDER) {
    const enabled = isModuleEnabled(guildId, key);
    lines.push(`${enabled ? '🟢' : '🔴'} **${MODULES[key]}** \`(${key})\``);
  }
  return lines.join('\n');
}

// ══════════════════════════════════════════════════════════
// COMMAND HANDLER
// ══════════════════════════════════════════════════════════

async function handleModuleCommand(message, args) {
  if (!isAdmin(message.member)) {
    return message.reply({ content: '❌ Only the server owner or bot admin can manage modules.', ephemeral: true });
  }

  const sub = args[0]?.toLowerCase();
  const target = args[1]?.toLowerCase();

  if (sub === 'enable' || sub === 'disable') {
    const enabled = sub === 'enable';
    if (target === 'all') {
      for (const key of MODULE_ORDER) setModuleEnabled(message.guild.id, key, enabled);
      return message.reply({ embeds: [base(COLORS.success).setTitle('Modules Updated').setDescription(`All modules have been **${enabled ? 'enabled' : 'disabled'}**.`)] });
    }
    if (!MODULES[target]) {
      return message.reply({ content: `❌ Invalid module. Available: ${Object.keys(MODULES).join(', ')}`, ephemeral: true });
    }
    setModuleEnabled(message.guild.id, target, enabled);
    return message.reply({ embeds: [base(COLORS.success).setTitle('Module Updated').setDescription(`**${MODULES[target]}** has been **${enabled ? 'enabled' : 'disabled'}**.`)] });
  }

  // Show panel
  const embed = base(COLORS.primary)
    .setTitle('🧩 Module Control Panel')
    .setDescription(buildModulePanel(message.guild.id))
    .addFields(
      { name: 'Enable', value: '`.module enable <name>`', inline: true },
      { name: 'Disable', value: '`.module disable <name>`', inline: true },
      { name: 'All', value: '`.module enable all` / `.module disable all`', inline: true },
    )
    .setFooter({ text: 'Roleplay is disabled by default. Use ,rp to toggle it on.' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('module_enable_all').setLabel('Enable All').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('module_disable_all').setLabel('Disable All').setStyle(ButtonStyle.Danger),
  );

  return message.reply({ embeds: [embed], components: [row] });
}

// ══════════════════════════════════════════════════════════
// BUTTON HANDLER
// ══════════════════════════════════════════════════════════

async function handleModuleButton(interaction) {
  if (!isAdmin(interaction.member)) {
    return interaction.reply({ content: '❌ Only the server owner or bot admin can manage modules.', ephemeral: true });
  }

  const customId = interaction.customId;
  if (customId === 'module_enable_all') {
    for (const key of MODULE_ORDER) setModuleEnabled(interaction.guild.id, key, true);
    return interaction.update({ embeds: [base(COLORS.success).setTitle('Modules Updated').setDescription('All modules have been **enabled**.')], components: [] });
  }
  if (customId === 'module_disable_all') {
    for (const key of MODULE_ORDER) setModuleEnabled(interaction.guild.id, key, false);
    return interaction.update({ embeds: [base(COLORS.error).setTitle('Modules Updated').setDescription('All modules have been **disabled**.')], components: [] });
  }
}

module.exports = {
  handleModuleCommand,
  handleModuleButton,
  isModuleEnabled,
  setModuleEnabled,
  MODULES,
  MODULE_ORDER,
};