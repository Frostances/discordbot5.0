const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { getGuildDb } = require('./database');

const joinTracker = new Map(); // guildId -> [{ timestamp, userId }]

// ══════════════════════════════════════════════════════════
// DEFAULT CONFIG
// ══════════════════════════════════════════════════════════
function getDefaultConfig() {
  return {
    enabled: false,
    raidState: false,
    massjoin: { enabled: false, threshold: 5, action: 'ban', lock: false, punish: false },
    newaccounts: { enabled: false, threshold: 7, action: 'ban' },
    avatar: { enabled: false, action: 'kick' },
    whitelist: [],
    logChannel: null
  };
}

function getConfig(guildId) {
  const db = getGuildDb(guildId);
  return { ...getDefaultConfig(), ...db.get('antiraid', {}) };
}

function saveConfig(guildId, cfg) {
  const db = getGuildDb(guildId);
  db.set('antiraid', cfg);
}

// ══════════════════════════════════════════════════════════
// FLAG PARSER
// ══════════════════════════════════════════════════════════
function parseFlags(args) {
  const flags = {};
  const remaining = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2).toLowerCase();
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      remaining.push(args[i]);
    }
  }
  return { flags, remaining };
}

// ══════════════════════════════════════════════════════════
// PERMISSION CHECK
// ══════════════════════════════════════════════════════════
function hasManageGuild(member) {
  if (!member) return false;
  const { isAdmin } = require('./helpers');
  if (isAdmin(member)) return true;
  return member.permissions.has(PermissionFlagsBits.ManageGuild);
}

// ══════════════════════════════════════════════════════════
// PUNISHMENT ENGINE
// ══════════════════════════════════════════════════════════
async function punishMember(member, action, reason) {
  try {
    if (action === 'ban') await member.ban({ reason });
    else if (action === 'kick') await member.kick(reason);
    else if (action === 'timeout') await member.timeout(10 * 60 * 1000, reason);
  } catch {}
}

async function logRaid(guild, text, cfg) {
  if (!cfg.logChannel) return;
  const ch = guild.channels.cache.get(cfg.logChannel);
  if (ch) {
    await ch.send({
      embeds: [new EmbedBuilder()
        .setTitle('🚨 AntiRaid')
        .setDescription(text)
        .setColor('#FF0000')
        .setTimestamp()]
    }).catch(() => {});
  }
}

async function lockChannels(guild, cfg) {
  try {
    const channels = guild.channels.cache.filter(ch => ch.isTextBased && ch.isTextBased());
    for (const ch of channels.values()) {
      await ch.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false }).catch(() => {});
    }
    await logRaid(guild, '🔒 All channels have been locked due to raid detection.', cfg);
  } catch {}
}

async function unlockChannels(guild, cfg) {
  try {
    const channels = guild.channels.cache.filter(ch => ch.isTextBased && ch.isTextBased());
    for (const ch of channels.values()) {
      await ch.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: null }).catch(() => {});
    }
    await logRaid(guild, '🔓 All channels have been unlocked.', cfg);
  } catch {}
}

// ══════════════════════════════════════════════════════════
// MEMBER JOIN HANDLER
// ══════════════════════════════════════════════════════════
async function handleMemberJoin(member) {
  const cfg = getConfig(member.guild.id);
  if (!cfg.enabled) return;

  // Check one-time whitelist
  if (cfg.whitelist?.includes(member.id)) {
    cfg.whitelist = cfg.whitelist.filter(id => id !== member.id);
    saveConfig(member.guild.id, cfg);
    await logRaid(member.guild, `✅ Whitelisted user joined: **${member.user.tag}**`, cfg);
    return;
  }

  // Avatar check
  if (cfg.avatar?.enabled && !member.user.avatar) {
    await punishMember(member, cfg.avatar.action || 'kick', 'AntiRaid: No avatar');
    await logRaid(member.guild, `🚨 No-avatar account blocked: **${member.user.tag}**`, cfg);
    return;
  }

  // New accounts check (age)
  if (cfg.newaccounts?.enabled) {
    const ageDays = (Date.now() - member.user.createdTimestamp) / (1000 * 60 * 60 * 24);
    const minAge = cfg.newaccounts.threshold || 7;
    if (ageDays < minAge) {
      await punishMember(member, cfg.newaccounts.action || 'ban', `AntiRaid: Account too new (${Math.round(ageDays)} days)`);
      await logRaid(member.guild, `🚨 New account blocked: **${member.user.tag}** (${Math.round(ageDays)} days old)`, cfg);
      return;
    }
  }

  // Mass join detection
  if (cfg.massjoin?.enabled) {
    const gid = member.guild.id;
    if (!joinTracker.has(gid)) joinTracker.set(gid, []);
    const times = joinTracker.get(gid);
    times.push({ timestamp: Date.now(), userId: member.id });
    // Keep only last 10 seconds
    const recent = times.filter(t => Date.now() - t.timestamp < 10000);
    joinTracker.set(gid, recent);
    const limit = cfg.massjoin.threshold || 5;

    if (recent.length >= limit) {
      if (!cfg.raidState) {
        cfg.raidState = true;
        saveConfig(member.guild.id, cfg);
        await logRaid(member.guild, `🚨 **RAID DETECTED** — ${recent.length} joins in 10 seconds. Raid mode activated.`, cfg);

        // Lock channels if enabled
        if (cfg.massjoin.lock) {
          await lockChannels(member.guild, cfg);
        }
      }
    }
  }

  // If raid state active and punish new joins is enabled
  if (cfg.raidState && cfg.massjoin?.punish) {
    await punishMember(member, cfg.massjoin.action || 'kick', 'AntiRaid: Raid in progress');
  }
}

// ══════════════════════════════════════════════════════════
// COMMAND HANDLER
// ══════════════════════════════════════════════════════════
async function handleAntiRaidCommand(message, args) {
  if (!hasManageGuild(message.member)) {
    return message.reply({
      embeds: [new EmbedBuilder()
        .setDescription('❌ You need the **Manage Server** permission to use antiraid commands.')
        .setColor('#F04747')]
    });
  }

  const cfg = getConfig(message.guild.id);
  const sub = args[0]?.toLowerCase();

  // ── No sub / help ──
  if (!sub) {
    return sendHelp(message);
  }

  // ── Config ──
  if (sub === 'config') {
    return sendConfig(message, cfg);
  }

  // ── State (turn off raid) ──
  if (sub === 'state') {
    if (!cfg.raidState) {
      return message.reply({
        embeds: [new EmbedBuilder()
          .setDescription('🟢 The server is not currently in a raid state.')
          .setColor('#43B581')]
      });
    }
    cfg.raidState = false;
    saveConfig(message.guild.id, cfg);
    await unlockChannels(message.guild, cfg);
    return message.reply({
      embeds: [new EmbedBuilder()
        .setDescription('✅ Raid state has been turned **off**. All channels unlocked.')
        .setColor('#43B581')]
    });
  }

  // ── Whitelist ──
  if (sub === 'whitelist') {
    const action = args[1]?.toLowerCase();

    if (action === 'view') {
      const lines = (cfg.whitelist || []).map(id => `<@${id}>`).join('\n') || 'No whitelisted users.';
      return message.channel.send({
        embeds: [new EmbedBuilder()
          .setAuthor({ name: message.author.username, iconURL: message.author.displayAvatarURL() })
          .setTitle('Antiraid whitelists')
          .setDescription(lines)
          .setColor('#2F3136')
          .setFooter({ text: `Page 1/1 (${(cfg.whitelist || []).length} entries)` })]
      });
    }

    const target = message.mentions.users.first();
    if (!target) {
      return message.reply({
        embeds: [new EmbedBuilder()
          .setDescription('❌ Mention a user. Usage: `,antiraid whitelist @user`')
          .setColor('#F04747')]
      });
    }

    cfg.whitelist = cfg.whitelist || [];
    if (cfg.whitelist.includes(target.id)) {
      cfg.whitelist = cfg.whitelist.filter(id => id !== target.id);
      saveConfig(message.guild.id, cfg);
      return message.reply({
        embeds: [new EmbedBuilder()
          .setDescription(`✅ <@${target.id}> is no longer whitelisted.`)
          .setColor('#43B581')]
      });
    } else {
      cfg.whitelist.push(target.id);
      saveConfig(message.guild.id, cfg);
      return message.reply({
        embeds: [new EmbedBuilder()
          .setDescription(`✅ <@${target.id}> is now **temporarily** whitelisted and can join.`)
          .setColor('#43B581')]
      });
    }
  }

  // ── Massjoin ──
  if (sub === 'massjoin') {
    const { flags, remaining } = parseFlags(args.slice(1));
    const status = remaining[0]?.toLowerCase();

    if (status === 'off') {
      cfg.massjoin = { ...cfg.massjoin, enabled: false };
      if (!cfg.newaccounts?.enabled && !cfg.avatar?.enabled) cfg.enabled = false;
      saveConfig(message.guild.id, cfg);
      return message.reply({
        embeds: [new EmbedBuilder()
          .setDescription('🔴 Disabled **massjoin** antiraid module.')
          .setColor('#F04747')]
      });
    }

    if (status === 'on') {
      const existing = cfg.massjoin || {};
      const threshold = parseInt(flags.threshold) || existing.threshold || 5;
      const action = flags.do || existing.action || 'ban';
      const lock = flags.lock === 'true' ? true : flags.lock === 'false' ? false : (existing.lock || false);
      const punish = flags.punish === 'true' ? true : flags.punish === 'false' ? false : (existing.punish || false);

      cfg.massjoin = { enabled: true, threshold, action, lock, punish };
      cfg.enabled = true;
      saveConfig(message.guild.id, cfg);

      const wasEnabled = existing.enabled;
      const verb = wasEnabled ? 'Updated' : 'Enabled';
      return message.reply({
        embeds: [new EmbedBuilder()
          .setDescription(
            `✅ ${verb} **massjoin** antiraid. Punishment set to **${action}**, threshold set to **${threshold}**, lock channels set to **${lock}**, punish new members set to **${punish}**`
          )
          .setColor('#43B581')]
      });
    }

    return message.reply({
      embeds: [new EmbedBuilder()
        .setDescription('❌ Usage: `,antiraid massjoin on` or `,antiraid massjoin off`')
        .setColor('#F04747')]
    });
  }

  // ── Newaccounts / Age ──
  if (sub === 'newaccounts' || sub === 'age') {
    const { flags, remaining } = parseFlags(args.slice(1));
    const status = remaining[0]?.toLowerCase();

    if (status === 'off') {
      cfg.newaccounts = { ...cfg.newaccounts, enabled: false };
      if (!cfg.massjoin?.enabled && !cfg.avatar?.enabled) cfg.enabled = false;
      saveConfig(message.guild.id, cfg);
      return message.reply({
        embeds: [new EmbedBuilder()
          .setDescription('🔴 Disabled **newaccounts** antiraid module.')
          .setColor('#F04747')]
      });
    }

    if (status === 'on') {
      const existing = cfg.newaccounts || {};
      const threshold = parseInt(flags.threshold) || existing.threshold || 7;
      const action = flags.do || existing.action || 'ban';

      cfg.newaccounts = { enabled: true, threshold, action };
      cfg.enabled = true;
      saveConfig(message.guild.id, cfg);

      const wasEnabled = existing.enabled;
      const verb = wasEnabled ? 'Updated' : 'Enabled';
      return message.reply({
        embeds: [new EmbedBuilder()
          .setDescription(
            `✅ ${verb} **newaccounts** antiraid. Punishment set to **${action}**, threshold set to **${threshold}**`
          )
          .setColor('#43B581')]
      });
    }

    return message.reply({
      embeds: [new EmbedBuilder()
        .setDescription('❌ Usage: `,antiraid newaccounts on` or `,antiraid newaccounts off`')
        .setColor('#F04747')]
    });
  }

  // ── Avatar ──
  if (sub === 'avatar') {
    const { flags, remaining } = parseFlags(args.slice(1));
    const status = remaining[0]?.toLowerCase();

    if (status === 'off') {
      cfg.avatar = { ...cfg.avatar, enabled: false };
      if (!cfg.massjoin?.enabled && !cfg.newaccounts?.enabled) cfg.enabled = false;
      saveConfig(message.guild.id, cfg);
      return message.reply({
        embeds: [new EmbedBuilder()
          .setDescription('🔴 Disabled **avatar** antiraid module.')
          .setColor('#F04747')]
      });
    }

    if (status === 'on') {
      const existing = cfg.avatar || {};
      const action = flags.do || existing.action || 'kick';

      cfg.avatar = { enabled: true, action };
      cfg.enabled = true;
      saveConfig(message.guild.id, cfg);

      const wasEnabled = existing.enabled;
      const verb = wasEnabled ? 'Updated' : 'Enabled';
      return message.reply({
        embeds: [new EmbedBuilder()
          .setDescription(
            `✅ ${verb} **avatar** antiraid. Punishment set to **${action}**`
          )
          .setColor('#43B581')]
      });
    }

    return message.reply({
      embeds: [new EmbedBuilder()
        .setDescription('❌ Usage: `,antiraid avatar on` or `,antiraid avatar off`')
        .setColor('#F04747')]
    });
  }

  return message.reply({
    embeds: [new EmbedBuilder()
      .setDescription('❌ Unknown subcommand. Use `,antiraid` for help.')
      .setColor('#F04747')]
  });
}

// ══════════════════════════════════════════════════════════
// HELP EMBED (no subcommand)
// ══════════════════════════════════════════════════════════
async function sendHelp(message) {
  const embed = new EmbedBuilder()
    .setAuthor({ name: message.author.username, iconURL: message.author.displayAvatarURL() })
    .setTitle('🛡️ Antiraid Commands')
    .setDescription('Configure protection against potential raids.')
    .setColor('#2F3136')
    .addFields(
      { name: '`,antiraid massjoin on/off`', value: 'Protect server against mass bot raids\n`--threshold (number)` ` --do (ban|kick)` ` --lock (true|false)` ` --punish (true|false)`', inline: false },
      { name: '`,antiraid newaccounts on/off`', value: 'Punish new registered accounts\n`--threshold (days)` ` --do (ban|kick)`', inline: false },
      { name: '`,antiraid avatar on/off`', value: 'Punish accounts without a profile picture\n`--do (ban|kick)`', inline: false },
      { name: '`,antiraid whitelist @user`', value: 'Create a one-time whitelist to allow a user to join', inline: false },
      { name: '`,antiraid whitelist view`', value: 'View all current antiraid whitelists', inline: false },
      { name: '`,antiraid config`', value: 'View server antiraid configuration', inline: false },
      { name: '`,antiraid state`', value: 'Turn off server raid state', inline: false },
    )
    .setFooter({ text: 'Requires Manage Server permission' });

  await message.channel.send({ embeds: [embed] });
}

// ══════════════════════════════════════════════════════════
// CONFIG EMBED (matches antinuke config style)
// ══════════════════════════════════════════════════════════
async function sendConfig(message, cfg) {
  const check = '<:checkmark:1528890895859056680>';

  const moduleLines = [];
  moduleLines.push(`Punish New Accounts: ${cfg.newaccounts?.enabled ? check : '❌'} (do: ${cfg.newaccounts?.enabled ? cfg.newaccounts.action : 'N/A'}, threshold: ${cfg.newaccounts?.enabled ? cfg.newaccounts.threshold : 'N/A'})`);
  moduleLines.push(`Mass Bot Raids: ${cfg.massjoin?.enabled ? check : '❌'} (do: ${cfg.massjoin?.enabled ? cfg.massjoin.action : 'N/A'}, threshold: ${cfg.massjoin?.enabled ? cfg.massjoin.threshold : 'N/A'})`);
  moduleLines.push(`Punish Default PFPs: ${cfg.avatar?.enabled ? check : '❌'} (do: ${cfg.avatar?.enabled ? cfg.avatar.action : 'N/A'}, threshold: N/A)`);

  const embed = new EmbedBuilder()
    .setAuthor({ name: message.author.username, iconURL: message.author.displayAvatarURL() })
    .setTitle('Antiraid settings')
    .setDescription(`Current Raid State: ${cfg.raidState ? '🔴 Raid Detected' : 'Safe'}`)
    .setColor('#2F3136')
    .addFields({ name: 'Modules', value: moduleLines.join('\n'), inline: false })
    .setFooter({ text: 'Use ,antiraid to configure protection' });

  await message.channel.send({ embeds: [embed] });
}

module.exports = { handleMemberJoin, handleAntiRaidCommand };