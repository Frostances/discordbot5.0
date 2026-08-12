// modules/filter.js — Chat Filter System (rewritten with AutoMod)
const {
  EmbedBuilder, PermissionFlagsBits,
  AutoModerationRuleEventType, AutoModerationActionType,
  AutoModerationRuleTriggerType
} = require('discord.js');
const { getGuildDb } = require('./database');
const { success: mkSuccess, error: mkError, info: mkInfo } = require('../utils/embeds');
const { isAdmin } = require('./helpers');
const { createCase, parseDuration } = require('./cases');
const logger = require('../utils/logger');

// ══════════════════════════════════════════════════════════
// CONSTANTS & DEFAULTS
// ══════════════════════════════════════════════════════════

const FILTER_DEFAULTS = {
  enabled: false,
  useAutoMod: true,
  words: [],
  wordExempts: [],
  wordWhitelist: [],
  invites: {
    enabled: false, exempts: [], punishment: 'delete',
    logChannel: null, autoModRuleId: null
  },
  massmention: {
    enabled: false, threshold: 5, exempts: [],
    punishment: 'delete', logChannel: null
  },
  spoilers: {
    enabled: false, threshold: 5, exempts: [],
    punishment: 'delete', logChannel: null
  },
  links: {
    enabled: false, exempts: [], whitelist: [],
    punishment: 'delete', logChannel: null
  },
  regex: {
    patterns: [], exempts: [],
    punishment: 'delete', logChannel: null
  },
  emoji: {
    enabled: false, threshold: 10, exempts: [],
    punishment: 'delete', logChannel: null
  },
  musicfiles: {
    enabled: false, exempts: [],
    punishment: 'delete', logChannel: null
  },
  spam: {
    enabled: false, threshold: 5, window: 5000, exempts: [],
    punishment: 'delete', logChannel: null
  },
  caps: {
    enabled: false, threshold: 70, minLength: 5, exempts: [],
    punishment: 'delete', logChannel: null
  },
  duplicates: {
    enabled: false, threshold: 3, exempts: [],
    punishment: 'delete', logChannel: null
  },
  snipe: { types: [] },
};

const VALID_PUNISHMENTS = ['delete', 'warn', 'timeout', 'kick', 'ban', 'mute'];

// ══════════════════════════════════════════════════════════
// IN-MEMORY TRACKERS
// ══════════════════════════════════════════════════════════
const spamTracker = new Map();
const duplicatesTracker = new Map();

// ══════════════════════════════════════════════════════════
// DATA HELPERS
// ══════════════════════════════════════════════════════════

function deepMerge(target, source) {
  const out = { ...target };
  for (const key in source) {
    if (source[key] !== null && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      out[key] = deepMerge(target[key] || {}, source[key]);
    } else {
      out[key] = source[key];
    }
  }
  return out;
}

function getFilterData(guildId) {
  const db = getGuildDb(guildId);
  const raw = db.get('filters', {});
  return deepMerge(FILTER_DEFAULTS, raw);
}

function setFilterData(guildId, data) {
  const db = getGuildDb(guildId);
  db.set('filters', data);
}

// ══════════════════════════════════════════════════════════
// FLAG PARSER  (,filter spam --threshold 3 --window 5000)
// ══════════════════════════════════════════════════════════

function parseFlags(args) {
  const positional = [];
  const flags = {};
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
      positional.push(args[i]);
    }
  }
  return { positional, flags };
}

// ══════════════════════════════════════════════════════════
// PERMISSION / EXEMPTION HELPERS
// ══════════════════════════════════════════════════════════

function hasManageChannels(member) {
  return member.permissions.has(PermissionFlagsBits.ManageChannels) ||
         member.permissions.has(PermissionFlagsBits.Administrator);
}

function hasManageGuild(member) {
  return member.permissions.has(PermissionFlagsBits.ManageGuild) ||
         member.permissions.has(PermissionFlagsBits.Administrator);
}

function isExempt(member, exemptRoleIds) {
  if (!exemptRoleIds || !exemptRoleIds.length) return false;
  return exemptRoleIds.some(id => member.roles.cache.has(id));
}

// ══════════════════════════════════════════════════════════
// EMOJI COUNTING (fixed — uses proper Unicode property)
// ══════════════════════════════════════════════════════════

function countEmojis(text) {
  let count = 0;
  // Custom emojis: <:name:id> or <a:name:id>
  const custom = text.match(/<(a)?:\w+:\d+>/g);
  if (custom) count += custom.length;
  // Unicode emojis (Emoji_Presentation property)
  const unicode = text.match(/\p{Emoji_Presentation}/gu);
  if (unicode) count += unicode.length;
  return count;
}

// ══════════════════════════════════════════════════════════
// WORD MATCHING HELPERS
// ══════════════════════════════════════════════════════════

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isExactWord(text, word) {
  const escaped = escapeRegex(word);
  // Use alternation instead of lookbehind/lookahead for RE2 compatibility
  const regex = new RegExp(`(?:^|[^a-zA-Z0-9_])${escaped}(?:$|[^a-zA-Z0-9_])`, 'i');
  return regex.test(text);
}

function normalizeWordEntry(entry) {
  if (typeof entry === 'string') return { word: entry, include: true };
  return entry;
}

// ══════════════════════════════════════════════════════════
// AUTOMOD HELPERS
// ══════════════════════════════════════════════════════════

async function syncWordAutoMod(guild, data) {
  const rules = await guild.autoModerationRules.fetch().catch(() => new Map());
  let wordRule = rules.find(r => r.name === 'Bot Word Filter');

  if (!data.enabled || !data.useAutoMod || !data.words.length) {
    if (wordRule) await wordRule.delete().catch(() => {});
    return;
  }

  const keywordWords = [];
  const regexPatterns = [];

  for (const entry of data.words) {
    const w = normalizeWordEntry(entry);
    if (w.word.length < 2 || w.word.length > 60) continue;
    if (data.wordWhitelist.includes(w.word.toLowerCase())) continue;
    if (w.include) {
      keywordWords.push(w.word);
    } else {
      // Exact match via RE2-safe regex (no lookarounds)
      regexPatterns.push(`(?:^|[^a-zA-Z0-9_])${escapeRegex(w.word)}(?:$|[^a-zA-Z0-9_])`);
    }
  }

  if (!keywordWords.length && !regexPatterns.length) {
    if (wordRule) await wordRule.delete().catch(() => {});
    return;
  }

  const actions = [
    {
      type: AutoModerationActionType.BlockMessage,
      metadata: { customMessage: 'Your message contained a blocked word.' }
    }
  ];

  if (data.invites.logChannel) {
    actions.push({
      type: AutoModerationActionType.SendAlertMessage,
      metadata: { channelId: data.invites.logChannel }
    });
  }

  if (data.invites.punishment === 'timeout') {
    actions.push({
      type: AutoModerationActionType.Timeout,
      metadata: { durationSeconds: 60 }
    });
  }

  const triggerMetadata = {};
  if (keywordWords.length) triggerMetadata.keywordFilter = keywordWords;
  if (regexPatterns.length) triggerMetadata.regexPatterns = regexPatterns;

  const ruleData = {
    name: 'Bot Word Filter',
    eventType: AutoModerationRuleEventType.MessageSend,
    triggerType: AutoModerationRuleTriggerType.Keyword,
    triggerMetadata,
    actions,
    enabled: true,
    reason: 'Bot filter system — word filter',
  };

  try {
    if (wordRule) {
      await wordRule.edit(ruleData);
    } else {
      await guild.autoModerationRules.create(ruleData);
    }
  } catch (err) {
    logger.error('FILTER', `AutoMod word sync failed: ${err.message}`);
  }
}

async function syncInviteAutoMod(guild, data) {
  const rules = await guild.autoModerationRules.fetch().catch(() => new Map());
  let inviteRule = rules.find(r => r.name === 'Bot Invite Filter');

  if (!data.enabled || !data.useAutoMod || !data.invites.enabled) {
    if (inviteRule) await inviteRule.delete().catch(() => {});
    data.invites.autoModRuleId = null;
    return;
  }

  const actions = [
    {
      type: AutoModerationActionType.BlockMessage,
      metadata: { customMessage: 'Discord invites are not allowed here.' }
    }
  ];

  if (data.invites.logChannel) {
    actions.push({
      type: AutoModerationActionType.SendAlertMessage,
      metadata: { channelId: data.invites.logChannel }
    });
  }

  if (data.invites.punishment === 'timeout') {
    actions.push({
      type: AutoModerationActionType.Timeout,
      metadata: { durationSeconds: 60 }
    });
  }

  const ruleData = {
    name: 'Bot Invite Filter',
    eventType: AutoModerationRuleEventType.MessageSend,
    triggerType: AutoModerationRuleTriggerType.Keyword,
    triggerMetadata: {
      regexPatterns: [
        'discord\\.gg\\/[a-zA-Z0-9-]+',
        'discord(?:app)?\\.com\\/invite\\/[a-zA-Z0-9-]+',
        'discord\\.com\\/invite\\/[a-zA-Z0-9-]+',
      ]
    },
    actions,
    enabled: true,
    reason: 'Bot filter system — invite filter',
  };

  try {
    if (inviteRule) {
      await inviteRule.edit(ruleData);
    } else {
      const created = await guild.autoModerationRules.create(ruleData);
      data.invites.autoModRuleId = created.id;
    }
  } catch (err) {
    logger.error('FILTER', `AutoMod invite sync failed: ${err.message}`);
  }
}

// ══════════════════════════════════════════════════════════
// PUNISHMENT & LOGGING
// ══════════════════════════════════════════════════════════

async function applyPunishment(message, filterType, punishment, durationStr) {
  const member = message.member;
  if (!member) return;

  const reason = `Filter violation: ${filterType}`;
  const botId = message.client.user.id;

  switch (punishment) {
    case 'delete':
      break;
    case 'warn':
      createCase(message.guild.id, {
        type: 'warn',
        targetId: member.id,
        executorId: botId,
        reason,
      });
      break;
    case 'timeout': {
      const dur = durationStr || '1m';
      const ms = parseDuration(dur) || 60000;
      await member.timeout(ms, reason).catch(() => {});
      break;
    }
    case 'kick':
      await member.kick(reason).catch(() => {});
      break;
    case 'ban':
      await member.ban({ reason, deleteMessageSeconds: 0 }).catch(() => {});
      break;
    case 'mute': {
      const { isMuteSetup } = require('./mute');
      if (isMuteSetup(message.guild)) {
        const { muteMember } = require('./mute');
        const dur = durationStr ? parseDuration(durationStr) : null;
        await muteMember(message.guild, member, reason, dur, botId).catch(() => {});
      }
      break;
    }
  }
}

async function sendFilterLog(message, filterType, punishment, content) {
  const data = getFilterData(message.guild.id);
  const config = data[filterType] || data.invites;
  const logChannelId = config?.logChannel;
  if (!logChannelId) return;

  const channel = message.guild.channels.cache.get(logChannelId);
  if (!channel) return;

  const embed = new EmbedBuilder()
    .setTitle('🛡️ Filter Triggered')
    .setColor('#FF4444')
    .addFields(
      { name: 'User', value: `${message.author} (${message.author.id})`, inline: true },
      { name: 'Filter', value: filterType, inline: true },
      { name: 'Punishment', value: punishment, inline: true },
      { name: 'Channel', value: `<#${message.channel.id}>`, inline: true },
      { name: 'Content', value: content.slice(0, 1000) || '(empty)' },
    )
    .setTimestamp();

  await channel.send({ embeds: [embed] }).catch(() => {});
}

// ══════════════════════════════════════════════════════════
// FILTER CHECK FUNCTIONS
// ══════════════════════════════════════════════════════════

async function runFilters(message) {
  if (message.author.bot || !message.guild) return false;
  const member = message.member;
  if (!member) return false;
  if (isAdmin(member)) return false;

  const data = getFilterData(message.guild.id);
  if (!data.enabled) return false;

  const content = message.content;
  const lower = content.toLowerCase();
  let deleted = false;

  const del = async () => {
    if (deleted) return true;
    try {
      await message.delete();
      deleted = true;
    } catch (err) {
      logger.error('FILTER', `Failed to delete message: ${err.message}`);
    }
    return deleted;
  };

  // ── Word Filter (bot-side — AutoMod is additional layer) ──
  if (data.words.length) {
    if (!isExempt(member, data.wordExempts)) {
      for (const entry of data.words) {
        const w = normalizeWordEntry(entry);
        if (data.wordWhitelist.includes(w.word.toLowerCase())) continue;

        let matched = false;
        if (w.include) {
          matched = lower.includes(w.word.toLowerCase());
        } else {
          matched = isExactWord(content, w.word);
        }

        if (matched) {
          const ok = await del();
          if (ok) {
            await applyPunishment(message, 'words', data.invites.punishment || 'delete', data.invites.duration);
            await sendFilterLog(message, 'words', data.invites.punishment || 'delete', content);
          }
          break;
        }
      }
    }
  }
  if (deleted) return true;

  // ── Invite Filter (bot-side — AutoMod is additional layer) ──
  if (data.invites.enabled) {
    if (!isExempt(member, data.invites.exempts)) {
      if (/discord\.gg\/[a-zA-Z0-9-]+/i.test(content) ||
          /discord(?:app)?\.com\/invite\/[a-zA-Z0-9-]+/i.test(content)) {
        const ok = await del();
        if (ok) {
          await applyPunishment(message, 'invites', data.invites.punishment, data.invites.duration);
          await sendFilterLog(message, 'invites', data.invites.punishment, content);
        }
      }
    }
  }
  if (deleted) return true;

  // ── Mass Mention Filter ──
  if (data.massmention.enabled) {
    if (!isExempt(member, data.massmention.exempts)) {
      const mentions = content.match(/<@!?(\d+)>/g) || [];
      if (mentions.length > data.massmention.threshold) {
        const ok = await del();
        if (ok) {
          await applyPunishment(message, 'massmention', data.massmention.punishment, data.massmention.duration);
          await sendFilterLog(message, 'massmention', data.massmention.punishment, content);
        }
      }
    }
  }
  if (deleted) return true;

  // ── Spoiler Filter ──
  if (data.spoilers.enabled) {
    if (!isExempt(member, data.spoilers.exempts)) {
      const spoilers = content.match(/\|\|.*?\|\|/g) || [];
      if (spoilers.length > data.spoilers.threshold) {
        const ok = await del();
        if (ok) {
          await applyPunishment(message, 'spoilers', data.spoilers.punishment, data.spoilers.duration);
          await sendFilterLog(message, 'spoilers', data.spoilers.punishment, content);
        }
      }
    }
  }
  if (deleted) return true;

  // ── Link Filter ──
  if (data.links.enabled) {
    if (!isExempt(member, data.links.exempts)) {
      const hasLink = /https?:\/\/|www\./i.test(content);
      if (hasLink) {
        let whitelisted = false;
        for (const url of data.links.whitelist || []) {
          if (lower.includes(url.toLowerCase())) { whitelisted = true; break; }
        }
        if (!whitelisted) {
          const ok = await del();
          if (ok) {
            await applyPunishment(message, 'links', data.links.punishment, data.links.duration);
            await sendFilterLog(message, 'links', data.links.punishment, content);
          }
        }
      }
    }
  }
  if (deleted) return true;

  // ── Regex Filter ──
  if (data.regex.patterns.length) {
    if (!isExempt(member, data.regex.exempts)) {
      for (const entry of data.regex.patterns) {
        try {
          const regex = new RegExp(entry.pattern, 'i');
          if (regex.test(content)) {
            const ok = await del();
            if (ok) {
              await applyPunishment(message, 'regex', data.regex.punishment, data.regex.duration);
              await sendFilterLog(message, 'regex', data.regex.punishment, content);
            }
            break;
          }
        } catch {}
      }
    }
  }
  if (deleted) return true;

  // ── Emoji Filter ──
  if (data.emoji.enabled) {
    if (!isExempt(member, data.emoji.exempts)) {
      const emojiCount = countEmojis(content);
      if (emojiCount > data.emoji.threshold) {
        const ok = await del();
        if (ok) {
          await applyPunishment(message, 'emoji', data.emoji.punishment, data.emoji.duration);
          await sendFilterLog(message, 'emoji', data.emoji.punishment, content);
        }
      }
    }
  }
  if (deleted) return true;

  // ── Music Files Filter ──
  if (data.musicfiles.enabled) {
    if (!isExempt(member, data.musicfiles.exempts)) {
      const musicExts = ['.mp3','.wav','.flac','.aac','.ogg','.m4a','.wma','.opus','.weba'];
      const hasMusic = message.attachments.some(att =>
        musicExts.some(ext => att.name.toLowerCase().endsWith(ext))
      );
      if (hasMusic) {
        const ok = await del();
        if (ok) {
          await applyPunishment(message, 'musicfiles', data.musicfiles.punishment, data.musicfiles.duration);
          await sendFilterLog(message, 'musicfiles', data.musicfiles.punishment, content);
        }
      }
    }
  }
  if (deleted) return true;

  // ── Spam Filter ──
  if (data.spam.enabled) {
    if (!isExempt(member, data.spam.exempts)) {
      const key = `${message.guild.id}:${message.author.id}:${message.channel.id}`;
      const now = Date.now();
      let arr = spamTracker.get(key) || [];
      arr = arr.filter(t => now - t < data.spam.window);
      arr.push(now);
      spamTracker.set(key, arr);
      if (arr.length > data.spam.threshold) {
        const ok = await del();
        if (ok) {
          await applyPunishment(message, 'spam', data.spam.punishment, data.spam.duration);
          await sendFilterLog(message, 'spam', data.spam.punishment, content);
        }
      }
    }
  }
  if (deleted) return true;

  // ── Caps Filter ──
  if (data.caps.enabled) {
    if (!isExempt(member, data.caps.exempts)) {
      const letters = content.replace(/[^a-zA-Z]/g, '');
      if (letters.length >= data.caps.minLength) {
        const upper = letters.replace(/[^A-Z]/g, '');
        const pct = (upper.length / letters.length) * 100;
        if (pct > data.caps.threshold) {
          const ok = await del();
          if (ok) {
            await applyPunishment(message, 'caps', data.caps.punishment, data.caps.duration);
            await sendFilterLog(message, 'caps', data.caps.punishment, content);
          }
        }
      }
    }
  }
  if (deleted) return true;

  // ── Duplicates Filter ──
  if (data.duplicates.enabled) {
    if (!isExempt(member, data.duplicates.exempts)) {
      const key = `${message.guild.id}:${message.channel.id}:${message.author.id}`;
      const entry = duplicatesTracker.get(key);

      if (entry && entry.content === content) {
        entry.messages.push({ id: message.id, timestamp: Date.now() });
        if (entry.messages.length >= data.duplicates.threshold) {
          // Delete all duplicates except the original (first) message
          for (let i = 1; i < entry.messages.length; i++) {
            const msgData = entry.messages[i];
            try {
              const msg = await message.channel.messages.fetch(msgData.id);
              if (msg && msg.deletable) await msg.delete();
            } catch (err) {
              logger.error('FILTER', `Failed to delete duplicate message ${msgData.id}: ${err.message}`);
            }
          }
          await applyPunishment(message, 'duplicates', data.duplicates.punishment, data.duplicates.duration);
          await sendFilterLog(message, 'duplicates', data.duplicates.punishment, content);
          duplicatesTracker.delete(key);
        }
      } else {
        duplicatesTracker.set(key, { content, messages: [{ id: message.id, timestamp: Date.now() }] });
      }
    }
  }

  return deleted;
}

// ══════════════════════════════════════════════════════════
// COMMAND HANDLERS
// ══════════════════════════════════════════════════════════

async function handleFilterBase(message) {
  if (!hasManageChannels(message.member)) {
    return message.reply({ embeds: [mkError('Permission Denied', 'You need the **Manage Channels** permission.')] });
  }
  const data = getFilterData(message.guild.id);
  const embed = new EmbedBuilder()
    .setTitle('🛡️ Filter System')
    .setColor('#5865F2')
    .setDescription(
      `**Module Status:** ${data.enabled ? '✅ Enabled' : '❌ Disabled'}\\n` +
      `**AutoMod:** ${data.useAutoMod ? '✅ On' : '❌ Off'}\\n\\n` +
      `Use \`,filter enable\` to turn on the module.\\n` +
      `Use \`,filter <type> --setting value\` to configure.`
    )
    .addFields(
      { name: 'Word Filter', value: `${data.words.length} word(s) | ${data.wordExempts.length} exempt | Punishment: ${data.invites.punishment}`, inline: true },
      { name: 'Invite Filter', value: `${data.invites.enabled ? '✅' : '❌'} | Punishment: ${data.invites.punishment} | AutoMod: ${data.useAutoMod ? '✅' : '❌'}`, inline: true },
      { name: 'Mass Mention', value: `${data.massmention.enabled ? '✅' : '❌'} | Threshold: ${data.massmention.threshold}`, inline: true },
      { name: 'Spoiler Filter', value: `${data.spoilers.enabled ? '✅' : '❌'} | Threshold: ${data.spoilers.threshold}`, inline: true },
      { name: 'Link Filter', value: `${data.links.enabled ? '✅' : '❌'} | Whitelist: ${data.links.whitelist.length}`, inline: true },
      { name: 'Regex Filter', value: `${data.regex.patterns.length} pattern(s)`, inline: true },
      { name: 'Emoji Filter', value: `${data.emoji.enabled ? '✅' : '❌'} | Threshold: ${data.emoji.threshold}`, inline: true },
      { name: 'Music Files', value: `${data.musicfiles.enabled ? '✅' : '❌'}`, inline: true },
      { name: 'Spam Filter', value: `${data.spam.enabled ? '✅' : '❌'} | ${data.spam.threshold} msgs / ${data.spam.window}ms`, inline: true },
      { name: 'Caps Filter', value: `${data.caps.enabled ? '✅' : '❌'} | ${data.caps.threshold}% | Min ${data.caps.minLength} chars`, inline: true },
      { name: 'Duplicates', value: `${data.duplicates.enabled ? '✅' : '❌'} | Threshold: ${data.duplicates.threshold}`, inline: true },
      { name: 'Snipe Restrictions', value: data.snipe.types.length ? data.snipe.types.join(', ') : 'None', inline: true },
    );
  return message.reply({ embeds: [embed] });
}

async function handleFilterEnable(message) {
  if (!hasManageChannels(message.member)) {
    return message.reply({ embeds: [mkError('Permission Denied', 'You need **Manage Channels**.')] });
  }
  const data = getFilterData(message.guild.id);
  data.enabled = true;
  setFilterData(message.guild.id, data);

  if (data.useAutoMod) {
    await syncWordAutoMod(message.guild, data);
    await syncInviteAutoMod(message.guild, data);
  }

  return message.reply({ embeds: [mkSuccess('Filter System', 'Filter module is now **enabled**.')] });
}

async function handleFilterDisable(message) {
  if (!hasManageChannels(message.member)) {
    return message.reply({ embeds: [mkError('Permission Denied', 'You need **Manage Channels**.')] });
  }
  const data = getFilterData(message.guild.id);
  data.enabled = false;
  setFilterData(message.guild.id, data);

  if (data.useAutoMod) {
    await syncWordAutoMod(message.guild, data);
    await syncInviteAutoMod(message.guild, data);
  }

  return message.reply({ embeds: [mkSuccess('Filter System', 'Filter module is now **disabled**.')] });
}

async function handleFilterAdd(message, args) {
  if (!hasManageChannels(message.member) || !hasManageGuild(message.member)) {
    return message.reply({ embeds: [mkError('Permission Denied', 'You need **Manage Channels** and **Manage Guild** permissions.')] });
  }
  const { positional, flags } = parseFlags(args);
  const word = positional[0]?.toLowerCase();
  if (!word) return message.reply({ embeds: [mkError('Missing Word', 'Usage: `,filter add <word>`')] });

  const data = getFilterData(message.guild.id);
  const existing = data.words.find(w => {
    const obj = normalizeWordEntry(w);
    return obj.word === word;
  });
  if (existing) return message.reply({ embeds: [mkError('Duplicate', `**${word}** is already filtered.`)] });

  const include = flags.include === true || flags.include === 'true';
  data.words.push({ word, include });
  setFilterData(message.guild.id, data);

  if (data.useAutoMod) {
    await syncWordAutoMod(message.guild, data);
  }

  const modeText = include ? '(substring match — anywhere in message)' : '(exact word match — standalone only)';
  return message.reply({ embeds: [mkSuccess('Word Added', `Added **${word}** to the filter list.\\n${modeText}${data.useAutoMod ? '\\nSynced with Discord AutoMod.' : ''}`)] });
}

async function handleFilterRemove(message, args) {
  if (!hasManageChannels(message.member) || !hasManageGuild(message.member)) {
    return message.reply({ embeds: [mkError('Permission Denied', 'You need **Manage Channels** and **Manage Guild** permissions.')] });
  }
  const word = args[0]?.toLowerCase();
  if (!word) return message.reply({ embeds: [mkError('Missing Word', 'Usage: `,filter remove <word>`')] });
  const data = getFilterData(message.guild.id);
  const idx = data.words.findIndex(w => {
    const obj = normalizeWordEntry(w);
    return obj.word === word;
  });
  if (idx === -1) return message.reply({ embeds: [mkError('Not Found', `**${word}** is not in the filter list.`)] });
  data.words.splice(idx, 1);
  setFilterData(message.guild.id, data);

  if (data.useAutoMod) {
    await syncWordAutoMod(message.guild, data);
  }

  return message.reply({ embeds: [mkSuccess('Word Removed', `Removed **${word}** from the filter list.`)] });
}

async function handleFilterList(message) {
  if (!hasManageChannels(message.member)) {
    return message.reply({ embeds: [mkError('Permission Denied', 'You need **Manage Channels**.')] });
  }
  const data = getFilterData(message.guild.id);
  if (!data.words.length) return message.reply({ embeds: [mkInfo('Filtered Words', 'No words are currently filtered.')] });
  const embed = new EmbedBuilder()
    .setTitle('📋 Filtered Words')
    .setDescription(data.words.map(w => {
      const obj = normalizeWordEntry(w);
      return `• ${obj.word} ${obj.include ? '(include)' : '(exact)'}`;
    }).join('\\n'))
    .setColor('#5865F2')
    .setFooter({ text: `${data.words.length} word(s)` });
  return message.reply({ embeds: [embed] });
}

async function handleFilterReset(message) {
  if (!hasManageGuild(message.member)) {
    return message.reply({ embeds: [mkError('Permission Denied', 'You need **Manage Guild**.')] });
  }
  const data = getFilterData(message.guild.id);
  const count = data.words.length;
  data.words = [];
  setFilterData(message.guild.id, data);

  if (data.useAutoMod) {
    await syncWordAutoMod(message.guild, data);
  }

  return message.reply({ embeds: [mkSuccess('Filter Reset', `Cleared **${count}** filtered word(s).`)] });
}

async function handleFilterWhitelist(message, args) {
  if (!hasManageChannels(message.member) || !hasManageGuild(message.member)) {
    return message.reply({ embeds: [mkError('Permission Denied', 'You need **Manage Channels** and **Manage Guild**.')] });
  }
  const word = args[0]?.toLowerCase();
  if (!word) return message.reply({ embeds: [mkError('Missing Word', 'Usage: `,filter whitelist <word>`')] });
  const data = getFilterData(message.guild.id);
  if (data.wordWhitelist.includes(word)) {
    data.wordWhitelist = data.wordWhitelist.filter(w => w !== word);
    setFilterData(message.guild.id, data);
    return message.reply({ embeds: [mkSuccess('Whitelist Updated', `Removed **${word}** from the whitelist.`)] });
  }
  data.wordWhitelist.push(word);
  setFilterData(message.guild.id, data);
  return message.reply({ embeds: [mkSuccess('Whitelist Updated', `Added **${word}** to the whitelist.`)] });
}

async function handleFilterExempt(message, args) {
  if (!hasManageChannels(message.member)) {
    return message.reply({ embeds: [mkError('Permission Denied', 'You need **Manage Channels**.')] });
  }
  const role = message.mentions.roles.first();
  if (!role) return message.reply({ embeds: [mkError('Missing Role', 'Mention a role: `,filter exempt @Role`')] });
  const data = getFilterData(message.guild.id);
  if (data.wordExempts.includes(role.id)) {
    data.wordExempts = data.wordExempts.filter(id => id !== role.id);
    setFilterData(message.guild.id, data);
    return message.reply({ embeds: [mkSuccess('Exemption Removed', `Removed <@&${role.id}> from word filter exemptions.`)] });
  }
  data.wordExempts.push(role.id);
  setFilterData(message.guild.id, data);
  return message.reply({ embeds: [mkSuccess('Exemption Added', `Added <@&${role.id}> to word filter exemptions.`)] });
}

async function handleFilterExemptList(message) {
  if (!hasManageChannels(message.member)) {
    return message.reply({ embeds: [mkError('Permission Denied', 'You need **Manage Channels**.')] });
  }
  const data = getFilterData(message.guild.id);
  if (!data.wordExempts.length) return message.reply({ embeds: [mkInfo('Word Filter Exemptions', 'No roles are exempt.')] });
  const embed = new EmbedBuilder()
    .setTitle('📋 Word Filter Exemptions')
    .setDescription(data.wordExempts.map(id => `<@&${id}>`).join('\\n'))
    .setColor('#5865F2');
  return message.reply({ embeds: [embed] });
}

async function handleFilterWordMigrate(message) {
  if (!hasManageChannels(message.member) || !hasManageGuild(message.member)) {
    return message.reply({ embeds: [mkError('Permission Denied', 'You need **Manage Channels** and **Manage Guild**.')] });
  }
  const data = getFilterData(message.guild.id);
  if (!data.words.length) return message.reply({ embeds: [mkError('No Words', 'There are no filtered words to migrate.')] });
  try {
    await syncWordAutoMod(message.guild, data);
    return message.reply({ embeds: [mkSuccess('Words Migrated', `Synced **${data.words.length}** word(s) with Discord AutoMod. The legacy bot-side filter remains as fallback.`)] });
  } catch (err) {
    return message.reply({ embeds: [mkError('Migration Failed', err.message)] });
  }
}

// ══════════════════════════════════════════════════════════
// GENERIC FILTER CONFIGURATION
// ══════════════════════════════════════════════════════════

function applyFilterFlags(data, filterType, flags, positional) {
  const config = data[filterType];
  if (!config) return { changed: false, messages: [] };
  const msgs = [];

  // Positional on/off
  const setting = positional[0]?.toLowerCase();
  if (setting === 'on' || setting === 'enable' || setting === 'true') {
    config.enabled = true;
    msgs.push('enabled');
  } else if (setting === 'off' || setting === 'disable' || setting === 'false') {
    config.enabled = false;
    msgs.push('disabled');
  }

  // Flag-based on/off
  if (flags.enabled === true || flags.enable === true || flags.on === true) {
    config.enabled = true;
    msgs.push('enabled');
  } else if (flags.disabled === true || flags.disable === true || flags.off === true) {
    config.enabled = false;
    msgs.push('disabled');
  }

  // Threshold
  if (flags.threshold !== undefined) {
    const n = parseInt(flags.threshold);
    if (!isNaN(n) && n > 0) {
      config.threshold = n;
      msgs.push(`threshold → ${n}`);
    }
  }

  // Window (spam)
  if (flags.window !== undefined) {
    const n = parseInt(flags.window);
    if (!isNaN(n) && n > 0) {
      config.window = n;
      msgs.push(`window → ${n}ms`);
    }
  }

  // Min length (caps)
  if (flags.minlength !== undefined) {
    const n = parseInt(flags.minlength);
    if (!isNaN(n) && n > 0) {
      config.minLength = n;
      msgs.push(`minLength → ${n}`);
    }
  }

  // Punishment
  if (flags.punishment !== undefined) {
    const p = flags.punishment.toLowerCase();
    if (VALID_PUNISHMENTS.includes(p)) {
      config.punishment = p;
      msgs.push(`punishment → ${p}`);
    }
  }

  // Duration
  if (flags.duration !== undefined) {
    if (parseDuration(flags.duration)) {
      config.duration = flags.duration;
      msgs.push(`duration → ${flags.duration}`);
    }
  }

  // Log channel
  if (flags.logchannel !== undefined) {
    // Handled at message level
  }

  // AutoMod toggle (global)
  if (flags.automod !== undefined) {
    const val = flags.automod === 'true' || flags.automod === 'on' || flags.automod === true;
    data.useAutoMod = val;
    msgs.push(`AutoMod → ${val ? 'on' : 'off'}`);
  }

  // Auto-enable if settings changed but no explicit toggle
  const hasExplicitToggle = msgs.some(m =>
    m === 'enabled' || m === 'disabled' || m === 'toggled on' || m === 'toggled off'
  );
  if (msgs.length > 0 && !hasExplicitToggle && config.enabled === false) {
    config.enabled = true;
    msgs.unshift('auto-enabled');
  }

  // Toggle if nothing else
  if (msgs.length === 0) {
    config.enabled = !config.enabled;
    msgs.push(config.enabled ? 'toggled on' : 'toggled off');
  }

  return { changed: true, messages: msgs };
}

async function toggleFilterExempt(message, filterType, roleId) {
  const data = getFilterData(message.guild.id);
  const config = data[filterType];
  if (!config || !Array.isArray(config.exempts)) {
    return message.reply({ embeds: [mkError('Error', 'This filter type does not support exemptions.')] });
  }

  if (config.exempts.includes(roleId)) {
    config.exempts = config.exempts.filter(id => id !== roleId);
    setFilterData(message.guild.id, data);
    return message.reply({ embeds: [mkSuccess('Exemption Removed', `Removed <@&${roleId}> from ${filterType} exemptions.`)] });
  }
  config.exempts.push(roleId);
  setFilterData(message.guild.id, data);
  return message.reply({ embeds: [mkSuccess('Exemption Added', `Added <@&${roleId}> to ${filterType} exemptions.`)] });
}

async function handleFilterTypeExemptList(message, filterType) {
  const data = getFilterData(message.guild.id);
  const config = data[filterType];
  if (!config || !Array.isArray(config.exempts)) {
    return message.reply({ embeds: [mkError('Error', 'This filter type does not support exemptions.')] });
  }
  if (!config.exempts.length) return message.reply({ embeds: [mkInfo(`${filterType} Exemptions`, 'No roles are exempt.')] });
  const embed = new EmbedBuilder()
    .setTitle(`📋 ${filterType.charAt(0).toUpperCase() + filterType.slice(1)} Exemptions`)
    .setDescription(config.exempts.map(id => `<@&${id}>`).join('\\n'))
    .setColor('#5865F2');
  return message.reply({ embeds: [embed] });
}

async function handleGenericFilter(message, filterType, args) {
  if (!hasManageChannels(message.member)) {
    return message.reply({ embeds: [mkError('Permission Denied', 'You need **Manage Channels**.')] });
  }

  const { positional, flags } = parseFlags(args);
  const data = getFilterData(message.guild.id);

  // Exempt subcommand
  if (positional[0]?.toLowerCase() === 'exempt') {
    if (positional[1]?.toLowerCase() === 'list') {
      return handleFilterTypeExemptList(message, filterType);
    }
    const role = message.mentions.roles.first();
    if (!role) return message.reply({ embeds: [mkError('Missing Role', `Mention a role: \`,filter ${filterType} exempt @Role\``)] });
    return toggleFilterExempt(message, filterType, role.id);
  }

  // Log channel flag
  if (flags.logchannel !== undefined) {
    let channel = message.mentions.channels.first();
    if (!channel && /^\\d+$/.test(flags.logchannel)) {
      channel = message.guild.channels.cache.get(flags.logchannel);
    }
    if (channel) {
      data[filterType].logChannel = channel.id;
      setFilterData(message.guild.id, data);
      return message.reply({ embeds: [mkSuccess(`${filterType} Filter`, `Log channel set to <#${channel.id}>.`)] });
    }
  }

  const result = applyFilterFlags(data, filterType, flags, positional);
  setFilterData(message.guild.id, data);

  // Sync AutoMod if needed
  if (filterType === 'invites' && data.useAutoMod) {
    await syncInviteAutoMod(message.guild, data);
  }

  const status = data[filterType].enabled ? 'enabled' : 'disabled';
  return message.reply({
    embeds: [mkSuccess(
      `${filterType.charAt(0).toUpperCase() + filterType.slice(1)} Filter`,
      `Status: **${status}** | Changes: ${result.messages.join(', ')}`
    )]
  });
}

// ══════════════════════════════════════════════════════════
// SPECIFIC FILTER HANDLERS
// ══════════════════════════════════════════════════════════

async function handleFilterInvites(message, args) {
  return handleGenericFilter(message, 'invites', args);
}

async function handleFilterMassMention(message, args) {
  return handleGenericFilter(message, 'massmention', args);
}

async function handleFilterSpoilers(message, args) {
  return handleGenericFilter(message, 'spoilers', args);
}

async function handleFilterLinks(message, args) {
  if (!hasManageChannels(message.member)) {
    return message.reply({ embeds: [mkError('Permission Denied', 'You need **Manage Channels**.')] });
  }

  const { positional, flags } = parseFlags(args);
  const data = getFilterData(message.guild.id);

  // Whitelist subcommand
  if (positional[0]?.toLowerCase() === 'whitelist') {
    const url = positional[1]?.toLowerCase();
    if (!url) return message.reply({ embeds: [mkError('Missing URL', 'Usage: `,filter links whitelist <url>`')] });
    if (data.links.whitelist.includes(url)) {
      data.links.whitelist = data.links.whitelist.filter(u => u !== url);
      setFilterData(message.guild.id, data);
      return message.reply({ embeds: [mkSuccess('Whitelist Updated', `Removed **${url}** from the link whitelist.`)] });
    }
    data.links.whitelist.push(url);
    setFilterData(message.guild.id, data);
    return message.reply({ embeds: [mkSuccess('Whitelist Updated', `Added **${url}** to the link whitelist.`)] });
  }

  // Exempt subcommand
  if (positional[0]?.toLowerCase() === 'exempt') {
    if (positional[1]?.toLowerCase() === 'list') {
      return handleFilterTypeExemptList(message, 'links');
    }
    const role = message.mentions.roles.first();
    if (!role) return message.reply({ embeds: [mkError('Missing Role', 'Mention a role: `,filter links exempt @Role`')] });
    return toggleFilterExempt(message, 'links', role.id);
  }

  // Generic settings
  const result = applyFilterFlags(data, 'links', flags, positional);
  setFilterData(message.guild.id, data);

  const status = data.links.enabled ? 'enabled' : 'disabled';
  return message.reply({
    embeds: [mkSuccess('Link Filter', `Status: **${status}** | Changes: ${result.messages.join(', ')}`)]
  });
}

async function handleFilterRegex(message, args) {
  if (!hasManageChannels(message.member) || !hasManageGuild(message.member)) {
    return message.reply({ embeds: [mkError('Permission Denied', 'You need **Manage Channels** and **Manage Guild**.')] });
  }

  const { positional, flags } = parseFlags(args);
  const data = getFilterData(message.guild.id);

  // List patterns
  if (!positional.length && !Object.keys(flags).length) {
    if (!data.regex.patterns.length) return message.reply({ embeds: [mkInfo('Regex Patterns', 'No regex patterns configured.')] });
    const embed = new EmbedBuilder()
      .setTitle('📋 Regex Patterns')
      .setDescription(data.regex.patterns.map((p, i) => `${i + 1}. \`${p.name}\` — \`${p.pattern}\``).join('\\n'))
      .setColor('#5865F2');
    return message.reply({ embeds: [embed] });
  }

  // Add/remove pattern
  const pattern = positional[0];
  if (!pattern) return message.reply({ embeds: [mkError('Missing Pattern', 'Usage: `,filter regex <pattern>`')] });

  const existing = data.regex.patterns.find(p => p.pattern === pattern);
  if (existing) {
    data.regex.patterns = data.regex.patterns.filter(p => p.pattern !== pattern);
    setFilterData(message.guild.id, data);
    return message.reply({ embeds: [mkSuccess('Pattern Removed', `Removed regex pattern \`${pattern}\`.`)] });
  }

  try { new RegExp(pattern); } catch {
    return message.reply({ embeds: [mkError('Invalid Regex', 'That is not a valid regular expression.')] });
  }

  data.regex.patterns.push({ name: pattern, pattern });
  setFilterData(message.guild.id, data);
  return message.reply({ embeds: [mkSuccess('Pattern Added', `Added regex pattern \`${pattern}\`.`)] });
}

async function handleFilterEmoji(message, args) {
  return handleGenericFilter(message, 'emoji', args);
}

async function handleFilterMusicFiles(message, args) {
  return handleGenericFilter(message, 'musicfiles', args);
}

async function handleFilterSpam(message, args) {
  return handleGenericFilter(message, 'spam', args);
}

async function handleFilterCaps(message, args) {
  return handleGenericFilter(message, 'caps', args);
}

async function handleFilterDuplicates(message, args) {
  return handleGenericFilter(message, 'duplicates', args);
}

async function handleFilterSnipe(message, args) {
  if (!hasManageChannels(message.member)) {
    return message.reply({ embeds: [mkError('Permission Denied', 'You need **Manage Channels**.')] });
  }
  const type = args[0]?.toLowerCase();
  const validTypes = ['images', 'links', 'mentions', 'invites'];
  const data = getFilterData(message.guild.id);
  if (!type) {
    return message.reply({ embeds: [mkInfo('Snipe Restrictions', `Restricted types: ${data.snipe.types.length ? data.snipe.types.join(', ') : 'None'}`)] });
  }
  if (!validTypes.includes(type)) {
    return message.reply({ embeds: [mkError('Invalid Type', `Valid types: ${validTypes.join(', ')}`)] });
  }
  if (data.snipe.types.includes(type)) {
    data.snipe.types = data.snipe.types.filter(t => t !== type);
    setFilterData(message.guild.id, data);
    return message.reply({ embeds: [mkSuccess('Snipe Updated', `Removed **${type}** from snipe restrictions.`)] });
  }
  data.snipe.types.push(type);
  setFilterData(message.guild.id, data);
  return message.reply({ embeds: [mkSuccess('Snipe Updated', `Added **${type}** to snipe restrictions.`)] });
}

// ══════════════════════════════════════════════════════════
// MAIN ROUTER
// ══════════════════════════════════════════════════════════
async function handleFilter(message, args) {
  const sub = args[0]?.toLowerCase();

  if (sub === 'enable') return handleFilterEnable(message);
  if (sub === 'disable') return handleFilterDisable(message);
  if (sub === 'add') return handleFilterAdd(message, args.slice(1));
  if (sub === 'remove') return handleFilterRemove(message, args.slice(1));
  if (sub === 'list') return handleFilterList(message);
  if (sub === 'reset') return handleFilterReset(message);
  if (sub === 'whitelist') return handleFilterWhitelist(message, args.slice(1));
  if (sub === 'exempt') return handleFilterExempt(message, args.slice(1));
  if (sub === 'wordmigrate') return handleFilterWordMigrate(message);
  if (sub === 'invites') return handleFilterInvites(message, args.slice(1));
  if (sub === 'massmention') return handleFilterMassMention(message, args.slice(1));
  if (sub === 'spoilers') return handleFilterSpoilers(message, args.slice(1));
  if (sub === 'links') return handleFilterLinks(message, args.slice(1));
  if (sub === 'regex') return handleFilterRegex(message, args.slice(1));
  if (sub === 'emoji') return handleFilterEmoji(message, args.slice(1));
  if (sub === 'musicfiles') return handleFilterMusicFiles(message, args.slice(1));
  if (sub === 'spam') return handleFilterSpam(message, args.slice(1));
  if (sub === 'caps') return handleFilterCaps(message, args.slice(1));
  if (sub === 'duplicates') return handleFilterDuplicates(message, args.slice(1));
  if (sub === 'snipe') return handleFilterSnipe(message, args.slice(1));

  return handleFilterBase(message);
}

module.exports = {
  handleFilter,
  onMessageCreate: runFilters,
};