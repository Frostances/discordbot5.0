// ══════════════════════════════════════════════════════════
// ECONOMY CORE MODULE
// ══════════════════════════════════════════════════════════

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const { getGuildDb } = require('./database');
const { isAdmin, isBotOwner, isStaffOrAdmin, hasDiscordPerm } = require('./helpers');
const { success: mkSuccess, error: mkError, info: mkInfo, ok, err, greedOk, greedWarn, COLORS } = require('../utils/embeds');
const logger = require('../utils/logger');

// ══════════════════════════════════════════════════════════
// DEFAULTS
// ══════════════════════════════════════════════════════════

const DEFAULT_ECONOMY = {
  enabled: false,
  logChannelId: null,
  rewards: {
    daily: 500,
    workMin: 100,
    workMax: 400,
    quest: 300,
    trivia: 200,
    scramble: 200,
    math: 200,
    fasttype: 200,
    memory: 200,
    slotsMixed: 50,
    slotsCherry: 500,
    slotsStar: 1000,
    slotsDiamond: 2500,
    wheel: [50, 100, 250, 500, 1000],
    scratchMin: 50,
    scratchMax: 500,
    minesBase: 100,
    minesIncrement: 50,
    cupsEasy: 100,
    cupsMedium: 250,
    cupsHard: 500,
    highlow: 200,
    jackpot: 5000,
  },
  cooldowns: {
    daily: 86400000,
    work: 3600000,
    trivia: 300000,
    scramble: 300000,
    math: 300000,
    fasttype: 300000,
    memory: 300000,
    slots: 300000,
    wheel: 300000,
    scratch: 300000,
    mines: 300000,
    cups: 300000,
    highlow: 300000,
    jackpot: 3600000,
  },
  events: {
    enabled: true,
    autoInterval: 3600000,
  },
  eventMultipliers: {
    work: 2,
    quest: 2,
    trivia: 2,
    casino: 2,
  },
  maxBalance: 999999999,
  dailyRewardLimit: 50000,
  antiSpamWindow: 10000,
  antiSpamThreshold: 10,
  messageCooldown: 2000,
};

const WORK_JOBS = [
  { text: 'Delivered a package', min: 180, max: 320 },
  { text: 'Fixed a computer', min: 150, max: 280 },
  { text: 'Designed a logo', min: 250, max: 400 },
  { text: 'Helped at a restaurant', min: 180, max: 300 },
  { text: 'Repaired a game console', min: 280, max: 450 },
  { text: 'Walked a dog', min: 100, max: 200 },
  { text: 'Tutored a student', min: 200, max: 350 },
  { text: 'Cleaned an office', min: 150, max: 250 },
  { text: 'Delivered groceries', min: 120, max: 220 },
  { text: 'Built a website', min: 300, max: 500 },
];

const QUEST_TEMPLATES = [
  { type: 'messages', name: 'Send {target} legitimate messages', target: 50, reward: 300 },
  { type: 'commands', name: 'Use {target} economy commands', target: 3, reward: 250 },
  { type: 'minigames', name: 'Complete {target} minigames', target: 2, reward: 400 },
  { type: 'daily', name: 'Complete a daily objective (,daily)', target: 1, reward: 200 },
  { type: 'work', name: 'Use ,work {target} times', target: 5, reward: 350 },
  { type: 'earn', name: 'Earn {target} Credits', target: 2000, reward: 500 },
  { type: 'trivia', name: 'Answer {target} trivia questions correctly', target: 3, reward: 300 },
  { type: 'scramble', name: 'Win {target} scramble games', target: 2, reward: 350 },
];

// ══════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════

function getEconomy(guildId) {
  const db = getGuildDb(guildId);
  let ec = db.get('economy', null);
  if (!ec) {
    ec = JSON.parse(JSON.stringify(DEFAULT_ECONOMY));
    db.set('economy', ec);
  }
  // Merge defaults for missing keys
  for (const key of Object.keys(DEFAULT_ECONOMY)) {
    if (ec[key] === undefined) ec[key] = JSON.parse(JSON.stringify(DEFAULT_ECONOMY[key]));
  }
  if (!ec.users) ec.users = {};
  if (!ec.logs) ec.logs = [];
  if (!ec.shop) ec.shop = getDefaultShopItems();
  if (!ec.activeEvents) ec.activeEvents = {};
  return ec;
}

function saveEconomy(guildId, ec) {
  const db = getGuildDb(guildId);
  db.set('economy', ec);
}

function getUserEconomy(guildId, userId) {
  const ec = getEconomy(guildId);
  if (!ec.users[userId]) {
    ec.users[userId] = {
      credits: 0,
      lifetimeEarned: 0,
      lifetimeSpent: 0,
      questsCompleted: 0,
      inventory: [],
      equipped: {},
      stats: {
        dailyClaims: 0,
        workCount: 0,
        gamesPlayed: 0,
        gamesWon: 0,
        shopPurchases: 0,
        messagesSent: 0,
        commandsUsed: 0,
      },
      cooldowns: {},
      quests: generateQuests(ec),
      messageTracker: {
        lastContent: '',
        lastTime: 0,
        messageCount: 0,
        commandCount: 0,
        spamCount: 0,
        windowStart: 0,
      },
      suspiciousFlags: 0,
    };
    saveEconomy(guildId, ec);
  }
  return ec.users[userId];
}

function generateQuests(ec) {
  const quests = [];
  const shuffled = QUEST_TEMPLATES.sort(() => Math.random() - 0.5);
  for (let i = 0; i < 3; i++) {
    const template = shuffled[i % shuffled.length];
    quests.push({
      id: Date.now() + i,
      type: template.type,
      name: template.name.replace('{target}', template.target),
      target: template.target,
      progress: 0,
      reward: template.reward,
      completed: false,
    });
  }
  return quests;
}

function getDefaultShopItems() {
  return [
    { id: 'badge_vip', name: 'VIP Badge', description: 'A shiny VIP badge for your profile.', price: 5000, type: 'badge', emoji: '💎' },
    { id: 'badge_donator', name: 'Donator Badge', description: 'Shows you support the server.', price: 10000, type: 'badge', emoji: '💖' },
    { id: 'title_gambler', name: 'Title: Gambler', description: 'A title showing your casino skills.', price: 3000, type: 'title', emoji: '🎰' },
    { id: 'title_rich', name: 'Title: Millionaire', description: 'A title for the wealthy.', price: 8000, type: 'title', emoji: '💰' },
    { id: 'title_worker', name: 'Title: Hard Worker', description: 'Earned through dedication.', price: 2500, type: 'title', emoji: '🔨' },
    { id: 'decoration_gold', name: 'Gold Frame', description: 'A gold frame for your profile.', price: 6000, type: 'decoration', emoji: '🖼️' },
    { id: 'effect_rainbow', name: 'Rainbow Effect', description: 'Rainbow text effect on profile.', price: 7500, type: 'effect', emoji: '🌈' },
    { id: 'collectible_coin', name: 'Lucky Coin', description: 'A rare collectible coin.', price: 1500, type: 'collectible', emoji: '🪙' },
    { id: 'collectible_trophy', name: 'Mini Trophy', description: 'A small trophy for your shelf.', price: 4000, type: 'collectible', emoji: '🏆' },
    { id: 'event_summer', name: 'Summer Sun', description: 'Limited summer event item.', price: 2000, type: 'event', emoji: '☀️' },
  ];
}

function isEconomyEnabled(guildId) {
  const ec = getEconomy(guildId);
  return ec.enabled === true;
}

function formatNumber(n) {
  return n.toLocaleString('en-US');
}

function getCooldownRemaining(userEc, key) {
  const last = userEc.cooldowns[key] || 0;
  const ec = getEconomy(userEc._guildId); // hack: we need guildId
  const cd = ec.cooldowns[key] || 0;
  const remaining = last + cd - Date.now();
  return remaining > 0 ? remaining : 0;
}

function setCooldown(guildId, userId, key) {
  const ec = getEconomy(guildId);
  const user = ec.users[userId];
  if (user) user.cooldowns[key] = Date.now();
  saveEconomy(guildId, ec);
}

function formatDuration(ms) {
  const s = Math.ceil(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

// ══════════════════════════════════════════════════════════
// ANTI-ABUSE
// ══════════════════════════════════════════════════════════

function trackEconomyMessage(guildId, userId, content, isCommand = false) {
  const ec = getEconomy(guildId);
  const user = getUserEconomy(guildId, userId);
  const now = Date.now();
  const tracker = user.messageTracker;

  // Message cooldown
  if (now - tracker.lastTime < ec.messageCooldown) return { ok: false, reason: 'cooldown' };

  // Duplicate detection
  if (content.trim().toLowerCase() === tracker.lastContent.toLowerCase()) return { ok: false, reason: 'duplicate' };

  // Anti-spam window
  if (now - tracker.windowStart > ec.antiSpamWindow) {
    tracker.windowStart = now;
    tracker.messageCount = 0;
    tracker.spamCount = 0;
  }
  tracker.messageCount++;
  if (tracker.messageCount > ec.antiSpamThreshold) {
    tracker.spamCount++;
    return { ok: false, reason: 'spam' };
  }

  tracker.lastContent = content;
  tracker.lastTime = now;
  user.stats.messagesSent++;
  if (isCommand) user.stats.commandsUsed++;

  // Quest progress for messages
  for (const q of user.quests) {
    if (q.completed) continue;
    if (q.type === 'messages') q.progress = Math.min(q.target, q.progress + 1);
  }

  saveEconomy(guildId, ec);
  return { ok: true };
}

function checkSuspiciousActivity(guildId, userId, amount) {
  const ec = getEconomy(guildId);
  const user = getUserEconomy(guildId, userId);
  const dailyEarned = user._dailyEarned || 0;
  if (dailyEarned + amount > ec.dailyRewardLimit) {
    user.suspiciousFlags++;
    saveEconomy(guildId, ec);
    return false;
  }
  return true;
}

function addDailyEarned(guildId, userId, amount) {
  const ec = getEconomy(guildId);
  const user = getUserEconomy(guildId, userId);
  if (!user._dailyEarned) user._dailyEarned = 0;
  if (!user._dailyReset) user._dailyReset = 0;
  const now = Date.now();
  if (now - user._dailyReset > 86400000) {
    user._dailyEarned = 0;
    user._dailyReset = now;
  }
  user._dailyEarned += amount;
  saveEconomy(guildId, ec);
}

// ══════════════════════════════════════════════════════════
// TRANSACTIONS
// ══════════════════════════════════════════════════════════

function addCredits(guildId, userId, amount, source, staffId = null) {
  const ec = getEconomy(guildId);
  const user = getUserEconomy(guildId, userId);
  const prev = user.credits;
  user.credits = Math.min(ec.maxBalance, Math.max(0, user.credits + amount));
  const actualAdded = user.credits - prev;
  if (actualAdded > 0) {
    user.lifetimeEarned += actualAdded;
    addDailyEarned(guildId, userId, actualAdded);
  }
  saveEconomy(guildId, ec);
  logTransaction(guildId, userId, amount, source, prev, user.credits, staffId);
  return actualAdded;
}

function removeCredits(guildId, userId, amount, source, staffId = null) {
  const ec = getEconomy(guildId);
  const user = getUserEconomy(guildId, userId);
  const prev = user.credits;
  user.credits = Math.max(0, user.credits - amount);
  const actualRemoved = prev - user.credits;
  if (actualRemoved > 0) user.lifetimeSpent += actualRemoved;
  saveEconomy(guildId, ec);
  logTransaction(guildId, userId, -actualRemoved, source, prev, user.credits, staffId);
  return actualRemoved;
}

function setCredits(guildId, userId, amount, staffId = null) {
  const ec = getEconomy(guildId);
  const user = getUserEconomy(guildId, userId);
  const prev = user.credits;
  user.credits = Math.max(0, Math.min(ec.maxBalance, amount));
  saveEconomy(guildId, ec);
  logTransaction(guildId, userId, user.credits - prev, 'staff_set', prev, user.credits, staffId);
  return user.credits;
}

function logTransaction(guildId, userId, amount, type, prevBalance, newBalance, staffId = null) {
  const ec = getEconomy(guildId);
  ec.logs.push({
    userId,
    amount,
    type,
    prevBalance,
    newBalance,
    timestamp: Date.now(),
    source: type,
    staffId,
  });
  if (ec.logs.length > 5000) ec.logs = ec.logs.slice(-2500);
  saveEconomy(guildId, ec);

  // Also send to log channel if configured
  if (ec.logChannelId) {
    // This is handled async by the caller if they have access to client
  }
}

async function sendEconomyLog(client, guildId, embed) {
  const ec = getEconomy(guildId);
  if (!ec.logChannelId) return;
  try {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return;
    const ch = guild.channels.cache.get(ec.logChannelId);
    if (!ch) return;
    await ch.send({ embeds: [embed] });
  } catch {}
}

// ══════════════════════════════════════════════════════════
// QUEST HELPERS
// ══════════════════════════════════════════════════════════

function checkQuestCompletion(guildId, userId) {
  const ec = getEconomy(guildId);
  const user = getUserEconomy(guildId, userId);
  let completed = false;
  for (const q of user.quests) {
    if (!q.completed && q.progress >= q.target) {
      q.completed = true;
      user.questsCompleted++;
      const reward = Math.round(q.reward * getEventMultiplier(guildId, 'quest'));
      addCredits(guildId, userId, reward, 'quest');
      completed = true;
    }
  }
  // If all completed, generate new ones
  if (user.quests.every(q => q.completed)) {
    user.quests = generateQuests(ec);
  }
  if (completed) saveEconomy(guildId, ec);
  return completed;
}

function progressQuest(guildId, userId, type, amount = 1) {
  const ec = getEconomy(guildId);
  const user = getUserEconomy(guildId, userId);
  let changed = false;
  for (const q of user.quests) {
    if (q.completed) continue;
    if (q.type === type) {
      q.progress = Math.min(q.target, q.progress + amount);
      changed = true;
    }
    if (type === 'credits_earned' && q.type === 'earn') {
      q.progress = Math.min(q.target, q.progress + amount);
      changed = true;
    }
  }
  if (changed) {
    saveEconomy(guildId, ec);
    checkQuestCompletion(guildId, userId);
  }
}

// ══════════════════════════════════════════════════════════
// EVENT MULTIPLIERS
// ══════════════════════════════════════════════════════════

function getEventMultiplier(guildId, category) {
  const ec = getEconomy(guildId);
  if (!ec.activeEvents) return 1;
  let mult = 1;
  if (ec.activeEvents.doubleRewards && ['work', 'daily', 'quest', 'minigame'].includes(category)) mult = ec.eventMultipliers.work || 2;
  if (ec.activeEvents.quizHour && category === 'trivia') mult = ec.eventMultipliers.trivia || 2;
  if (ec.activeEvents.payday && category === 'work') mult = ec.eventMultipliers.work || 2;
  if (ec.activeEvents.questRush && category === 'quest') mult = ec.eventMultipliers.quest || 2;
  if (ec.activeEvents.casinoHour && ['slots', 'wheel', 'scratch', 'mines', 'cups', 'highlow'].includes(category)) mult = ec.eventMultipliers.casino || 2;
  return mult;
}

function getActiveEventNames(guildId) {
  const ec = getEconomy(guildId);
  if (!ec.activeEvents) return [];
  const names = [];
  if (ec.activeEvents.doubleRewards) names.push('⚡ Double Rewards');
  if (ec.activeEvents.quizHour) names.push('🧠 Quiz Hour');
  if (ec.activeEvents.payday) names.push('💰 Payday');
  if (ec.activeEvents.questRush) names.push('🎯 Quest Rush');
  if (ec.activeEvents.casinoHour) names.push('🎰 Casino Arcade Hour');
  return names;
}

// ══════════════════════════════════════════════════════════
// COMMANDS: CORE ECONOMY
// ══════════════════════════════════════════════════════════

async function handleBalance(message, args) {
  if (!isEconomyEnabled(message.guild.id)) return message.reply(err('The economy system is not enabled in this server. Staff can use `,economy setup`.'));
  const target = message.mentions.users.first() || message.author;
  const user = getUserEconomy(message.guild.id, target.id);
  const ec = getEconomy(message.guild.id);

  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle(target.id === message.author.id ? '💳 YOUR ECONOMY' : `💳 ${target.username}'s ECONOMY`)
    .setThumbnail(target.displayAvatarURL())
    .addFields(
      { name: '💰 Credits', value: `**${formatNumber(user.credits)}**`, inline: true },
      { name: '📈 Lifetime Earned', value: `**${formatNumber(user.lifetimeEarned)}**`, inline: true },
      { name: '💸 Lifetime Spent', value: `**${formatNumber(user.lifetimeSpent)}**`, inline: true },
      { name: '🎯 Quests Completed', value: `**${formatNumber(user.questsCompleted)}**`, inline: true },
      { name: '🛍️ Items Owned', value: `**${formatNumber(user.inventory.length)}**`, inline: true },
      { name: '🎮 Games Played', value: `**${formatNumber(user.stats.gamesPlayed)}**`, inline: true },
    )
    .setFooter({ text: 'Use ,profile for full details' })
    .setTimestamp();

  const events = getActiveEventNames(message.guild.id);
  if (events.length) {
    embed.addFields({ name: '🔥 Active Events', value: events.join('\n'), inline: false });
  }

  return message.reply({ embeds: [embed] });
}

async function handleDaily(message) {
  if (!isEconomyEnabled(message.guild.id)) return message.reply(err('The economy system is not enabled.'));
  const guildId = message.guild.id;
  const userId = message.author.id;
  const user = getUserEconomy(guildId, userId);
  const ec = getEconomy(guildId);

  const remaining = (user.cooldowns.daily || 0) + ec.cooldowns.daily - Date.now();
  if (remaining > 0) {
    return message.reply(err(`You already claimed your daily reward!`, `Come back in **${formatDuration(remaining)}**.`));
  }

  const mult = getEventMultiplier(guildId, 'daily');
  const base = ec.rewards.daily;
  const reward = Math.round(base * mult);

  addCredits(guildId, userId, reward, 'daily');
  setCooldown(guildId, userId, 'daily');
  user.stats.dailyClaims++;
  saveEconomy(guildId, ec);
  progressQuest(guildId, userId, 'daily');

  const embed = new EmbedBuilder()
    .setColor(COLORS.success)
    .setTitle('📅 Daily Reward Claimed!')
    .setDescription(`You received **+${formatNumber(reward)}** Credits!\n\n💰 New Balance: **${formatNumber(user.credits)}**`)
    .setTimestamp();
  if (mult > 1) embed.setFooter({ text: `Event Bonus: ${mult}x` });

  return message.reply({ embeds: [embed] });
}

async function handleWork(message) {
  if (!isEconomyEnabled(message.guild.id)) return message.reply(err('The economy system is not enabled.'));
  const guildId = message.guild.id;
  const userId = message.author.id;
  const user = getUserEconomy(guildId, userId);
  const ec = getEconomy(guildId);

  const remaining = (user.cooldowns.work || 0) + ec.cooldowns.work - Date.now();
  if (remaining > 0) {
    return message.reply(err(`You're still on the clock!`, `Come back in **${formatDuration(remaining)}**.`));
  }

  const job = WORK_JOBS[Math.floor(Math.random() * WORK_JOBS.length)];
  const mult = getEventMultiplier(guildId, 'work');
  const base = Math.floor(Math.random() * (job.max - job.min + 1)) + job.min;
  const reward = Math.round(base * mult);

  addCredits(guildId, userId, reward, 'work');
  setCooldown(guildId, userId, 'work');
  user.stats.workCount++;
  saveEconomy(guildId, ec);
  progressQuest(guildId, userId, 'work');
  progressQuest(guildId, userId, 'credits_earned', reward);

  const embed = new EmbedBuilder()
    .setColor(COLORS.success)
    .setTitle('🔨 Work Complete!')
    .setDescription(`**${job.text}**\n\n💰 **+${formatNumber(reward)}** Credits`)
    .setFooter({ text: `New Balance: ${formatNumber(user.credits)}${mult > 1 ? ' • Event Bonus Active!' : ''}` })
    .setTimestamp();

  return message.reply({ embeds: [embed] });
}

async function handleQuests(message) {
  if (!isEconomyEnabled(message.guild.id)) return message.reply(err('The economy system is not enabled.'));
  const guildId = message.guild.id;
  const userId = message.author.id;
  const user = getUserEconomy(guildId, userId);

  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle('🎯 Your Quests')
    .setDescription(user.quests.map((q, i) => {
      const status = q.completed ? '✅' : '⬜';
      const bar = '█'.repeat(Math.floor((q.progress / q.target) * 10)) + '░'.repeat(10 - Math.floor((q.progress / q.target) * 10));
      return `${status} **${q.name}**\n\`[${bar}]\` ${q.progress}/${q.target} → 💰 ${formatNumber(q.reward)}`;
    }).join('\n\n'))
    .setFooter({ text: `Total Completed: ${user.questsCompleted} • Use ,quest for detailed progress` })
    .setTimestamp();

  return message.reply({ embeds: [embed] });
}

async function handleQuest(message) {
  if (!isEconomyEnabled(message.guild.id)) return message.reply(err('The economy system is not enabled.'));
  const guildId = message.guild.id;
  const userId = message.author.id;
  const user = getUserEconomy(guildId, userId);

  const embed = new EmbedBuilder()
    .setColor(COLORS.info)
    .setTitle('📋 Quest Progress')
    .addFields(user.quests.map(q => ({
      name: `${q.completed ? '✅' : '📌'} ${q.name}`,
      value: `Progress: **${q.progress} / ${q.target}**\nReward: **${formatNumber(q.reward)}** Credits\nStatus: **${q.completed ? 'Completed' : 'In Progress'}**`,
      inline: false,
    })))
    .setFooter({ text: 'Complete all quests to get new ones!' })
    .setTimestamp();

  return message.reply({ embeds: [embed] });
}

async function handleLeaderboard(message, args, client) {
  if (!isEconomyEnabled(message.guild.id)) return message.reply(err('The economy system is not enabled.'));
  const guildId = message.guild.id;
  const ec = getEconomy(guildId);
  const users = Object.entries(ec.users).filter(([, u]) => u.credits > 0).sort((a, b) => b[1].credits - a[1].credits);

  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(users.length / pageSize));
  let page = parseInt(args[0]) || 1;
  if (page < 1) page = 1;
  if (page > totalPages) page = totalPages;

  const start = (page - 1) * pageSize;
  const pageUsers = users.slice(start, start + pageSize);

  let desc = '';
  for (let i = 0; i < pageUsers.length; i++) {
    const [uid, u] = pageUsers[i];
    const rank = start + i + 1;
    const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}.`;
    const member = await message.guild.members.fetch(uid).catch(() => null);
    const name = member ? member.user.username : 'Unknown';
    desc += `${medal} **${name}** — ${formatNumber(u.credits)} Credits\n`;
  }

  const embed = new EmbedBuilder()
    .setColor(COLORS.gold)
    .setTitle('🏆 Economy Leaderboard')
    .setDescription(desc || 'No economy data yet.')
    .setFooter({ text: `Page ${page}/${totalPages} • Use ,leaderboard <page>` })
    .setTimestamp();

  const row = new ActionRowBuilder();
  if (page > 1) row.addComponents(new ButtonBuilder().setCustomId(`ecolb_${page - 1}`).setLabel('◀ Previous').setStyle(ButtonStyle.Primary));
  if (page < totalPages) row.addComponents(new ButtonBuilder().setCustomId(`ecolb_${page + 1}`).setLabel('Next ▶').setStyle(ButtonStyle.Primary));

  return message.reply({ embeds: [embed], components: row.components.length ? [row] : [] });
}

async function handleProfile(message, args, client) {
  if (!isEconomyEnabled(message.guild.id)) return message.reply(err('The economy system is not enabled.'));
  const target = message.mentions.users.first() || message.author;
  const guildId = message.guild.id;
  const user = getUserEconomy(guildId, target.id);

  const equippedBadges = Object.entries(user.equipped)
    .filter(([, v]) => v)
    .map(([k, v]) => {
      const item = getDefaultShopItems().find(i => i.id === v) || { emoji: '⭐', name: 'Unknown' };
      return `${item.emoji} ${item.name}`;
    });

  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle(`👤 ${target.username}'s Economy Profile`)
    .setThumbnail(target.displayAvatarURL())
    .addFields(
      { name: '💰 Credits', value: formatNumber(user.credits), inline: true },
      { name: '📈 Lifetime Earned', value: formatNumber(user.lifetimeEarned), inline: true },
      { name: '💸 Lifetime Spent', value: formatNumber(user.lifetimeSpent), inline: true },
      { name: '🎯 Quests Completed', value: formatNumber(user.questsCompleted), inline: true },
      { name: '🛍️ Items Owned', value: formatNumber(user.inventory.length), inline: true },
      { name: '📅 Daily Claims', value: formatNumber(user.stats.dailyClaims), inline: true },
      { name: '🔨 Work Sessions', value: formatNumber(user.stats.workCount), inline: true },
      { name: '🎮 Games Played', value: formatNumber(user.stats.gamesPlayed), inline: true },
      { name: '🏆 Games Won', value: formatNumber(user.stats.gamesWon), inline: true },
      { name: '🛒 Shop Purchases', value: formatNumber(user.stats.shopPurchases), inline: true },
      { name: '💬 Messages Sent', value: formatNumber(user.stats.messagesSent), inline: true },
      { name: '⌨️ Commands Used', value: formatNumber(user.stats.commandsUsed), inline: true },
    )
    .setTimestamp();

  if (equippedBadges.length) {
    embed.addFields({ name: '🎖️ Equipped', value: equippedBadges.join(' | '), inline: false });
  }

  const events = getActiveEventNames(guildId);
  if (events.length) {
    embed.addFields({ name: '🔥 Active Events', value: events.join('\n'), inline: false });
  }

  return message.reply({ embeds: [embed] });
}

// ══════════════════════════════════════════════════════════
// COMMANDS: ADMIN CONFIG
// ══════════════════════════════════════════════════════════

async function handleEconomyConfig(message, args) {
  if (!hasDiscordPerm(message.member, 'ManageGuild')) {
    return message.reply(err('You need the **Manage Server** permission to configure the economy.'));
  }

  const guildId = message.guild.id;
  const ec = getEconomy(guildId);
  const sub = args[0]?.toLowerCase();

  if (sub === 'setup') {
    ec.enabled = true;
    saveEconomy(guildId, ec);
    return message.reply(ok('Economy system has been set up and **enabled**!'));
  }

  if (sub === 'config') {
    const embed = new EmbedBuilder()
      .setColor(COLORS.info)
      .setTitle('⚙️ Economy Configuration')
      .addFields(
        { name: 'Status', value: ec.enabled ? '🟢 Enabled' : '🔴 Disabled', inline: true },
        { name: 'Log Channel', value: ec.logChannelId ? `<#${ec.logChannelId}>` : 'Not set', inline: true },
        { name: 'Events', value: ec.events.enabled ? '🟢 Auto' : '🔴 Manual', inline: true },
        { name: 'Daily Reward', value: `${formatNumber(ec.rewards.daily)}`, inline: true },
        { name: 'Work Range', value: `${formatNumber(ec.rewards.workMin)} - ${formatNumber(ec.rewards.workMax)}`, inline: true },
        { name: 'Quest Reward', value: `${formatNumber(ec.rewards.quest)}`, inline: true },
        { name: 'Max Balance', value: `${formatNumber(ec.maxBalance)}`, inline: true },
        { name: 'Daily Earn Limit', value: `${formatNumber(ec.dailyRewardLimit)}`, inline: true },
      )
      .setFooter({ text: 'Use ,economy rewards/cooldowns to view detailed settings' })
      .setTimestamp();
    return message.reply({ embeds: [embed] });
  }

  if (sub === 'enable') {
    ec.enabled = true;
    saveEconomy(guildId, ec);
    return message.reply(ok('Economy system **enabled**.'));
  }

  if (sub === 'disable') {
    ec.enabled = false;
    saveEconomy(guildId, ec);
    return message.reply(ok('Economy system **disabled**.'));
  }

  if (sub === 'reset') {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('eco_reset_confirm').setLabel('✅ Confirm Reset').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('eco_reset_cancel').setLabel('❌ Cancel').setStyle(ButtonStyle.Secondary),
    );
    return message.reply({
      embeds: [mkError('⚠️ Confirm Economy Reset', 'This will **delete all economy data** for this server. This action cannot be undone!')],
      components: [row],
    });
  }

  if (sub === 'logs') {
    const ch = message.mentions.channels.first();
    if (!ch) return message.reply(err('Mention a channel: `,economy logs #channel`'));
    ec.logChannelId = ch.id;
    saveEconomy(guildId, ec);
    return message.reply(ok(`Economy log channel set to <#${ch.id}>.`));
  }

  if (sub === 'rewards') {
    const rewardType = args[1]?.toLowerCase();
    const val = parseInt(args[2]);
    if (!rewardType || isNaN(val)) {
      let desc = '';
      for (const [k, v] of Object.entries(ec.rewards)) {
        desc += `\`${k}\` → ${Array.isArray(v) ? v.join(', ') : formatNumber(v)}\n`;
      }
      return message.reply({ embeds: [mkInfo('💰 Reward Settings', desc + '\n**Usage:** `,economy rewards <type> <amount>`')] });
    }
    if (ec.rewards[rewardType] === undefined) return message.reply(err(`Unknown reward type. Valid: ${Object.keys(ec.rewards).join(', ')}`));
    ec.rewards[rewardType] = val;
    saveEconomy(guildId, ec);
    return message.reply(ok(`Reward \`${rewardType}\` set to **${formatNumber(val)}**.`));
  }

  if (sub === 'cooldowns') {
    const cdType = args[1]?.toLowerCase();
    const val = args[2];
    if (!cdType || !val) {
      let desc = '';
      for (const [k, v] of Object.entries(ec.cooldowns)) {
        desc += `\`${k}\` → ${formatDuration(v)}\n`;
      }
      return message.reply({ embeds: [mkInfo('⏱️ Cooldown Settings', desc + '\n**Usage:** `,economy cooldowns <type> <duration>`\nExamples: `10m`, `1h`, `30s`')] });
    }
    if (ec.cooldowns[cdType] === undefined) return message.reply(err(`Unknown cooldown type. Valid: ${Object.keys(ec.cooldowns).join(', ')}`));
    const ms = parseDuration(val);
    if (!ms) return message.reply(err('Invalid duration. Use: `10m`, `1h`, `30s`'));
    ec.cooldowns[cdType] = ms;
    saveEconomy(guildId, ec);
    return message.reply(ok(`Cooldown \`${cdType}\` set to **${formatDuration(ms)}**.`));
  }

  if (sub === 'events') {
    const toggle = args[1]?.toLowerCase();
    if (toggle === 'on' || toggle === 'enable') {
      ec.events.enabled = true;
      saveEconomy(guildId, ec);
      return message.reply(ok('Automatic economy events **enabled**.'));
    }
    if (toggle === 'off' || toggle === 'disable') {
      ec.events.enabled = false;
      saveEconomy(guildId, ec);
      return message.reply(ok('Automatic economy events **disabled**.'));
    }
    return message.reply({ embeds: [mkInfo('🎉 Economy Events', `Auto events: **${ec.events.enabled ? 'Enabled' : 'Disabled'}**\n\nUsage: \`,economy events on/off\``)] });
  }

  return message.reply({ embeds: [mkInfo('⚙️ Economy Admin', `
\`,economy setup\` — Initialize economy
\`,economy config\` — View configuration
\`,economy enable/disable\` — Toggle economy
\`,economy reset\` — Reset all data (requires confirmation)
\`,economy logs #channel\` — Set log channel
\`,economy rewards [type] [amount]\` — Configure rewards
\`,economy cooldowns [type] [duration]\` — Configure cooldowns
\`,economy events on/off\` — Toggle auto events
`)] });
}

// ══════════════════════════════════════════════════════════
// COMMANDS: STAFF MANAGEMENT
// ══════════════════════════════════════════════════════════

async function handleAddCredits(message, args) {
  if (!hasDiscordPerm(message.member, 'Administrator')) {
    return message.reply(err('You need the **Administrator** permission.'));
  }
  const target = message.mentions.users.first() || (args[0]?.match(/^\d+$/) ? await message.client.users.fetch(args[0]).catch(() => null) : null);
  const amount = parseInt(args[1]);
  if (!target || isNaN(amount) || amount <= 0) return message.reply(err('Usage: `,addcredits @user <amount>`'));

  const guildId = message.guild.id;
  if (!isEconomyEnabled(guildId)) return message.reply(err('Economy is not enabled.'));

  const actual = addCredits(guildId, target.id, amount, 'staff_add', message.author.id);
  const user = getUserEconomy(guildId, target.id);

  const logEmbed = new EmbedBuilder()
    .setColor(COLORS.warning)
    .setTitle('🛡️ Economy Adjustment')
    .addFields(
      { name: 'User', value: `<@${target.id}>`, inline: true },
      { name: 'Action', value: 'Added Credits', inline: true },
      { name: 'Amount', value: `+${formatNumber(actual)}`, inline: true },
      { name: 'Moderator', value: `<@${message.author.id}>`, inline: true },
      { name: 'New Balance', value: formatNumber(user.credits), inline: true },
    )
    .setTimestamp();

  await sendEconomyLog(message.client, guildId, logEmbed);
  return message.reply(ok(`Added **+${formatNumber(actual)}** Credits to **${target.username}**.\nNew balance: **${formatNumber(user.credits)}**`));
}

async function handleRemoveCredits(message, args) {
  if (!hasDiscordPerm(message.member, 'Administrator')) {
    return message.reply(err('You need the **Administrator** permission.'));
  }
  const target = message.mentions.users.first() || (args[0]?.match(/^\d+$/) ? await message.client.users.fetch(args[0]).catch(() => null) : null);
  const amount = parseInt(args[1]);
  if (!target || isNaN(amount) || amount <= 0) return message.reply(err('Usage: `,removecredits @user <amount>`'));

  const guildId = message.guild.id;
  if (!isEconomyEnabled(guildId)) return message.reply(err('Economy is not enabled.'));

  const actual = removeCredits(guildId, target.id, amount, 'staff_remove', message.author.id);
  const user = getUserEconomy(guildId, target.id);

  const logEmbed = new EmbedBuilder()
    .setColor(COLORS.error)
    .setTitle('🛡️ Economy Adjustment')
    .addFields(
      { name: 'User', value: `<@${target.id}>`, inline: true },
      { name: 'Action', value: 'Removed Credits', inline: true },
      { name: 'Amount', value: `-${formatNumber(actual)}`, inline: true },
      { name: 'Moderator', value: `<@${message.author.id}>`, inline: true },
      { name: 'New Balance', value: formatNumber(user.credits), inline: true },
    )
    .setTimestamp();

  await sendEconomyLog(message.client, guildId, logEmbed);
  return message.reply(ok(`Removed **-${formatNumber(actual)}** Credits from **${target.username}**.\nNew balance: **${formatNumber(user.credits)}**`));
}

async function handleSetCredits(message, args) {
  if (!hasDiscordPerm(message.member, 'Administrator')) {
    return message.reply(err('You need the **Administrator** permission.'));
  }
  const target = message.mentions.users.first() || (args[0]?.match(/^\d+$/) ? await message.client.users.fetch(args[0]).catch(() => null) : null);
  const amount = parseInt(args[1]);
  if (!target || isNaN(amount) || amount < 0) return message.reply(err('Usage: `,setcredits @user <amount>`'));

  const guildId = message.guild.id;
  if (!isEconomyEnabled(guildId)) return message.reply(err('Economy is not enabled.'));

  const prev = getUserEconomy(guildId, target.id).credits;
  setCredits(guildId, target.id, amount, message.author.id);
  const user = getUserEconomy(guildId, target.id);

  const logEmbed = new EmbedBuilder()
    .setColor(COLORS.warning)
    .setTitle('🛡️ Economy Adjustment')
    .addFields(
      { name: 'User', value: `<@${target.id}>`, inline: true },
      { name: 'Action', value: 'Set Credits', inline: true },
      { name: 'Previous', value: formatNumber(prev), inline: true },
      { name: 'New', value: formatNumber(user.credits), inline: true },
      { name: 'Moderator', value: `<@${message.author.id}>`, inline: true },
    )
    .setTimestamp();

  await sendEconomyLog(message.client, guildId, logEmbed);
  return message.reply(ok(`Set **${target.username}**'s balance to **${formatNumber(user.credits)}**.`));
}

async function handleResetUser(message, args) {
  if (!hasDiscordPerm(message.member, 'Administrator')) {
    return message.reply(err('You need the **Administrator** permission.'));
  }
  const target = message.mentions.users.first() || (args[0]?.match(/^\d+$/) ? await message.client.users.fetch(args[0]).catch(() => null) : null);
  if (!target) return message.reply(err('Usage: `,resetuser @user`'));

  const guildId = message.guild.id;
  if (!isEconomyEnabled(guildId)) return message.reply(err('Economy is not enabled.'));

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`eco_resetuser_${target.id}`).setLabel('✅ Confirm Reset').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('eco_resetuser_cancel').setLabel('❌ Cancel').setStyle(ButtonStyle.Secondary),
  );
  return message.reply({
    embeds: [mkError('⚠️ Confirm User Reset', `This will reset ALL economy data for **${target.username}**.`)],
    components: [row],
  });
}

// ══════════════════════════════════════════════════════════
// BUTTON HANDLERS
// ══════════════════════════════════════════════════════════

async function handleEconomyButton(interaction) {
  const id = interaction.customId;

  if (id === 'eco_reset_confirm') {
    if (!hasDiscordPerm(interaction.member, 'ManageGuild')) {
      return interaction.reply({ content: '❌ No permission.', ephemeral: true });
    }
    const guildId = interaction.guild.id;
    const ec = getEconomy(guildId);
    ec.users = {};
    ec.logs = [];
    ec.activeEvents = {};
    saveEconomy(guildId, ec);
    return interaction.update({ embeds: [mkSuccess('Economy Reset', 'All economy data has been wiped.')], components: [] });
  }

  if (id === 'eco_reset_cancel') {
    return interaction.update({ embeds: [mkInfo('Cancelled', 'Economy reset was cancelled.')], components: [] });
  }

  if (id === 'eco_resetuser_cancel') {
    return interaction.update({ embeds: [mkInfo('Cancelled', 'User reset was cancelled.')], components: [] });
  }

  if (id.startsWith('eco_resetuser_')) {
    if (!hasDiscordPerm(interaction.member, 'Administrator')) {
      return interaction.reply({ content: '❌ No permission.', ephemeral: true });
    }
    const targetId = id.replace('eco_resetuser_', '');
    const guildId = interaction.guild.id;
    const ec = getEconomy(guildId);
    if (ec.users[targetId]) delete ec.users[targetId];
    saveEconomy(guildId, ec);
    return interaction.update({ embeds: [mkSuccess('User Reset', `<@${targetId}>'s economy data has been reset.`)], components: [] });
  }

  if (id.startsWith('ecolb_')) {
    const page = parseInt(id.replace('ecolb_', ''));
    const guildId = interaction.guild.id;
    const ec = getEconomy(guildId);
    const users = Object.entries(ec.users).filter(([, u]) => u.credits > 0).sort((a, b) => b[1].credits - a[1].credits);
    const pageSize = 10;
    const totalPages = Math.max(1, Math.ceil(users.length / pageSize));
    const start = (page - 1) * pageSize;
    const pageUsers = users.slice(start, start + pageSize);

    let desc = '';
    for (let i = 0; i < pageUsers.length; i++) {
      const [uid, u] = pageUsers[i];
      const rank = start + i + 1;
      const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}.`;
      const member = await interaction.guild.members.fetch(uid).catch(() => null);
      const name = member ? member.user.username : 'Unknown';
      desc += `${medal} **${name}** — ${formatNumber(u.credits)} Credits\n`;
    }

    const embed = new EmbedBuilder()
      .setColor(COLORS.gold)
      .setTitle('🏆 Economy Leaderboard')
      .setDescription(desc || 'No economy data yet.')
      .setFooter({ text: `Page ${page}/${totalPages}` })
      .setTimestamp();

    const row = new ActionRowBuilder();
    if (page > 1) row.addComponents(new ButtonBuilder().setCustomId(`ecolb_${page - 1}`).setLabel('◀ Previous').setStyle(ButtonStyle.Primary));
    if (page < totalPages) row.addComponents(new ButtonBuilder().setCustomId(`ecolb_${page + 1}`).setLabel('Next ▶').setStyle(ButtonStyle.Primary));

    return interaction.update({ embeds: [embed], components: row.components.length ? [row] : [] });
  }
}

// ══════════════════════════════════════════════════════════
// UTILS
// ══════════════════════════════════════════════════════════

function parseDuration(str) {
  if (!str) return null;
  const match = str.match(/^(\d+)([smhd])$/i);
  if (!match) return null;
  const num = parseInt(match[1]);
  const unit = match[2].toLowerCase();
  const mult = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return num * (mult[unit] || 0);
}

// ══════════════════════════════════════════════════════════
// EXPORTS
// ══════════════════════════════════════════════════════════

module.exports = {
  getEconomy,
  saveEconomy,
  getUserEconomy,
  isEconomyEnabled,
  addCredits,
  removeCredits,
  setCredits,
  logTransaction,
  sendEconomyLog,
  formatNumber,
  formatDuration,
  getEventMultiplier,
  getActiveEventNames,
  progressQuest,
  checkQuestCompletion,
  trackEconomyMessage,
  setCooldown,
  getDefaultShopItems,
  parseDuration,
  // Commands
  handleBalance,
  handleDaily,
  handleWork,
  handleQuests,
  handleQuest,
  handleLeaderboard,
  handleProfile,
  handleEconomyConfig,
  handleAddCredits,
  handleRemoveCredits,
  handleSetCredits,
  handleResetUser,
  // Buttons
  handleEconomyButton,
};