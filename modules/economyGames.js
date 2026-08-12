// ══════════════════════════════════════════════════════════
// ECONOMY GAMES MODULE
// Skill-based arcade + Casino Arcade (free-play)
// ══════════════════════════════════════════════════════════

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const { getEconomy, getUserEconomy, isEconomyEnabled, addCredits, setCooldown, progressQuest, checkQuestCompletion, formatNumber, formatDuration, getEventMultiplier, sendEconomyLog, COLORS } = require('./economy');
const { err, ok, info } = require('../utils/embeds');
const logger = require('../utils/logger');

// ══════════════════════════════════════════════════════════
// TRIVIA DATABASE
// ══════════════════════════════════════════════════════════

const TRIVIA_QUESTIONS = [
  { q: 'What is the capital of France?', a: 'paris', options: ['Paris', 'London', 'Berlin', 'Madrid'] },
  { q: 'What planet is known as the Red Planet?', a: 'mars', options: ['Venus', 'Mars', 'Jupiter', 'Saturn'] },
  { q: 'What is the largest ocean on Earth?', a: 'pacific', options: ['Atlantic', 'Indian', 'Pacific', 'Arctic'] },
  { q: 'Who wrote "Romeo and Juliet"?', a: 'shakespeare', options: ['Shakespeare', 'Dickens', 'Hemingway', 'Twain'] },
  { q: 'What is the chemical symbol for gold?', a: 'au', options: ['Ag', 'Au', 'Fe', 'Cu'] },
  { q: 'How many continents are there?', a: '7', options: ['5', '6', '7', '8'] },
  { q: 'What is the speed of light (approx)?', a: '300000', options: ['150000', '300000', '500000', '1000000'] },
  { q: 'What year did World War II end?', a: '1945', options: ['1943', '1944', '1945', '1946'] },
  { q: 'What is the smallest prime number?', a: '2', options: ['0', '1', '2', '3'] },
  { q: 'What gas do plants absorb from the atmosphere?', a: 'carbon dioxide', options: ['Oxygen', 'Carbon Dioxide', 'Nitrogen', 'Hydrogen'] },
  { q: 'What is the hardest natural substance?', a: 'diamond', options: ['Gold', 'Iron', 'Diamond', 'Platinum'] },
  { q: 'How many bones are in the adult human body?', a: '206', options: ['186', '196', '206', '216'] },
  { q: 'What is the largest planet in our solar system?', a: 'jupiter', options: ['Earth', 'Saturn', 'Jupiter', 'Neptune'] },
  { q: 'What element has the atomic number 1?', a: 'hydrogen', options: ['Helium', 'Hydrogen', 'Lithium', 'Carbon'] },
  { q: 'In which country would you find the Great Pyramid of Giza?', a: 'egypt', options: ['Mexico', 'Egypt', 'Peru', 'Greece'] },
  { q: 'What is the currency of Japan?', a: 'yen', options: ['Won', 'Yuan', 'Yen', 'Ringgit'] },
  { q: 'What is the longest river in the world?', a: 'nile', options: ['Amazon', 'Nile', 'Yangtze', 'Mississippi'] },
  { q: 'Who painted the Mona Lisa?', a: 'leonardo da vinci', options: ['Van Gogh', 'Picasso', 'Da Vinci', 'Michelangelo'] },
  { q: 'What is the freezing point of water (°C)?', a: '0', options: ['-10', '0', '10', '32'] },
  { q: 'What does CPU stand for?', a: 'central processing unit', options: ['Central Process Unit', 'Central Processing Unit', 'Computer Personal Unit', 'Central Processor Unit'] },
  { q: 'What is the largest mammal?', a: 'blue whale', options: ['Elephant', 'Blue Whale', 'Giraffe', 'Hippo'] },
  { q: 'What color is a ruby?', a: 'red', options: ['Blue', 'Green', 'Red', 'Yellow'] },
  { q: 'What is the main ingredient in guacamole?', a: 'avocado', options: ['Tomato', 'Avocado', 'Onion', 'Pepper'] },
  { q: 'What is the tallest mountain in the world?', a: 'everest', options: ['K2', 'Kilimanjaro', 'Everest', 'Makalu'] },
  { q: 'What programming language is known as the language of the web?', a: 'javascript', options: ['Python', 'Java', 'C++', 'JavaScript'] },
];

// ══════════════════════════════════════════════════════════
// FAST TYPE PHRASES
// ══════════════════════════════════════════════════════════

const FASTTYPE_PHRASES = [
  'The quick brown fox jumps over the lazy dog',
  'A journey of a thousand miles begins with a single step',
  'To be or not to be that is the question',
  'All that glitters is not gold',
  'The early bird catches the worm',
  'Actions speak louder than words',
  'Where there is a will there is a way',
  'Practice makes perfect',
  'Knowledge is power',
  'Time is money',
  'Better late than never',
  'Every cloud has a silver lining',
  'Honesty is the best policy',
  'When in Rome do as the Romans do',
  'The pen is mightier than the sword',
  'Two wrongs do not make a right',
  'The grass is always greener on the other side',
  'Do not count your chickens before they hatch',
  'A picture is worth a thousand words',
  'Birds of a feather flock together',
];

// ══════════════════════════════════════════════════════════
// SCRAMBLE WORDS
// ══════════════════════════════════════════════════════════

const SCRAMBLE_WORDS = [
  'algorithm', 'butterfly', 'chocolate', 'dinosaur', 'elephant',
  'fireworks', 'giraffe', 'harmony', 'internet', 'jupiter',
  'kangaroo', 'lighthouse', 'mountain', 'notebook', 'octopus',
  'penguin', 'quantum', 'rainbow', 'sunshine', 'telescope',
  'umbrella', 'volcano', 'whisper', 'xylophone', 'yesterday',
  'zeppelin', 'adventure', 'beautiful', 'champion', 'diamond',
  'eclipse', 'festival', 'galaxy', 'horizon', 'illusion',
  'journey', 'kingdom', 'lantern', 'mystery', 'nebula',
  'ocean', 'paradise', 'quest', 'radiant', 'silence',
  'treasure', 'universe', 'victory', 'wonder', 'zenith',
];

// ══════════════════════════════════════════════════════════
// MEMORY EMOJIS
// ══════════════════════════════════════════════════════════

const MEMORY_EMOJIS = ['🍎', '🍌', '🍇', '🍒', '🍓', '🍍', '🥝', '🍑'];

// ══════════════════════════════════════════════════════════
// SLOTS SYMBOLS
// ══════════════════════════════════════════════════════════

const SLOTS_SYMBOLS = ['🍒', '⭐', '💎', '🍋', '🍇', '7️⃣'];

// ══════════════════════════════════════════════════════════
// WHEEL SEGMENTS
// ══════════════════════════════════════════════════════════

const WHEEL_SEGMENTS = [
  { label: '+50 Credits', value: 50, emoji: '💰' },
  { label: '+100 Credits', value: 100, emoji: '💰' },
  { label: '+250 Credits', value: 250, emoji: '💰' },
  { label: '+500 Credits', value: 500, emoji: '💰' },
  { label: '+1,000 Credits', value: 1000, emoji: '💰' },
  { label: 'Bonus Quest', value: 'quest', emoji: '🎯' },
  { label: 'Cosmetic', value: 'cosmetic', emoji: '🎨' },
];

// ══════════════════════════════════════════════════════════
// SCRATCH REWARDS
// ══════════════════════════════════════════════════════════

const SCRATCH_REWARDS = [
  { type: 'credits', value: 50, emoji: '💰' },
  { type: 'credits', value: 100, emoji: '💰' },
  { type: 'credits', value: 250, emoji: '💰' },
  { type: 'credits', value: 500, emoji: '💰' },
  { type: 'quest', value: 1, emoji: '🎯' },
  { type: 'cosmetic', value: 1, emoji: '🎨' },
];

// ══════════════════════════════════════════════════════════
// ACTIVE GAMES TRACKER
// ══════════════════════════════════════════════════════════

const activeGames = new Map(); // channelId -> { type, data, timeout }

function cleanupGame(channelId) {
  const game = activeGames.get(channelId);
  if (game) {
    clearTimeout(game.timeout);
    activeGames.delete(channelId);
  }
}

// ══════════════════════════════════════════════════════════
// TRIVIA
// ══════════════════════════════════════════════════════════

async function handleTrivia(message) {
  if (!isEconomyEnabled(message.guild.id)) return message.reply(err('Economy is not enabled.'));
  const guildId = message.guild.id;
  const userId = message.author.id;
  const user = getUserEconomy(guildId, userId);
  const ec = getEconomy(guildId);

  const remaining = (user.cooldowns.trivia || 0) + ec.cooldowns.trivia - Date.now();
  if (remaining > 0) return message.reply(err(`Trivia cooldown!`, `Wait **${formatDuration(remaining)}**.`));

  const q = TRIVIA_QUESTIONS[Math.floor(Math.random() * TRIVIA_QUESTIONS.length)];
  const mult = getEventMultiplier(guildId, 'trivia');
  const reward = Math.round(ec.rewards.trivia * mult);

  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle('🧠 Trivia Time!')
    .setDescription(`**${q.q}**\n\n${q.options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`).join('\n')}\n\n💰 Reward: **+${formatNumber(reward)}** Credits`)
    .setFooter({ text: 'Reply with A, B, C, or D within 30 seconds!' });

  const msg = await message.reply({ embeds: [embed] });
  user.stats.gamesPlayed++;
  saveEconomy(guildId, ec);

  const correctIndex = q.options.findIndex(o => o.toLowerCase() === q.a.toLowerCase());
  const correctLetter = String.fromCharCode(65 + correctIndex);

  const filter = m => m.author.id === userId && /^[a-dA-D]$/.test(m.content.trim());
  try {
    const collected = await message.channel.awaitMessages({ filter, max: 1, time: 30000, errors: ['time'] });
    const answer = collected.first().content.trim().toUpperCase();
    setCooldown(guildId, userId, 'trivia');

    if (answer === correctLetter) {
      addCredits(guildId, userId, reward, 'trivia');
      user.stats.gamesWon++;
      saveEconomy(guildId, ec);
      progressQuest(guildId, userId, 'trivia');
      progressQuest(guildId, userId, 'minigames');
      checkQuestCompletion(guildId, userId);

      const winEmbed = new EmbedBuilder()
        .setColor(COLORS.success)
        .setTitle('✅ Correct!')
        .setDescription(`**${q.options[correctIndex]}** is right!\n\n💰 **+${formatNumber(reward)}** Credits`)
        .setFooter({ text: `Balance: ${formatNumber(user.credits)}${mult > 1 ? ' • Event Bonus!' : ''}` });
      return msg.edit({ embeds: [winEmbed] });
    } else {
      const loseEmbed = new EmbedBuilder()
        .setColor(COLORS.error)
        .setTitle('❌ Wrong!')
        .setDescription(`The correct answer was **${q.options[correctIndex]}**.\n\nNo reward this time. Better luck next time!`);
      return msg.edit({ embeds: [loseEmbed] });
    }
  } catch {
    setCooldown(guildId, userId, 'trivia');
    const timeoutEmbed = new EmbedBuilder()
      .setColor(COLORS.muted)
      .setTitle('⏰ Time\'s Up!')
      .setDescription(`The correct answer was **${q.options[correctIndex]}**.`);
    return msg.edit({ embeds: [timeoutEmbed] });
  }
}

// ══════════════════════════════════════════════════════════
// SCRAMBLE
// ══════════════════════════════════════════════════════════

async function handleScramble(message, args, client) {
  if (!isEconomyEnabled(message.guild.id)) return message.reply(err('Economy is not enabled.'));
  const guildId = message.guild.id;
  const channelId = message.channel.id;
  const ec = getEconomy(guildId);

  if (activeGames.has(channelId)) return message.reply(err('A game is already active in this channel!'));

  const word = SCRAMBLE_WORDS[Math.floor(Math.random() * SCRAMBLE_WORDS.length)];
  const scrambled = word.split('').sort(() => Math.random() - 0.5).join('');
  const mult = getEventMultiplier(guildId, 'scramble');
  const reward = Math.round(ec.rewards.scramble * mult);

  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle('🔤 Word Scramble!')
    .setDescription(`Unscramble this word:\n\n**${scrambled.toUpperCase()}**\n\n💰 First correct answer wins **+${formatNumber(reward)}** Credits!\n⏰ You have 30 seconds.`)
    .setFooter({ text: 'Type the correct word!' });

  const msg = await message.reply({ embeds: [embed] });

  activeGames.set(channelId, { type: 'scramble', word: word.toLowerCase(), startTime: Date.now() });

  const filter = m => m.content.trim().toLowerCase() === word.toLowerCase();
  try {
    const collected = await message.channel.awaitMessages({ filter, max: 1, time: 30000, errors: ['time'] });
    const winner = collected.first().author;
    cleanupGame(channelId);

    const user = getUserEconomy(guildId, winner.id);
    const remaining = (user.cooldowns.scramble || 0) + ec.cooldowns.scramble - Date.now();
    if (remaining > 0) {
      return msg.edit({ embeds: [new EmbedBuilder().setColor(COLORS.warning).setTitle('⏳ Cooldown').setDescription(`<@${winner.id}> got it right, but they're on cooldown! The word was **${word}**.`)] });
    }

    setCooldown(guildId, winner.id, 'scramble');
    addCredits(guildId, winner.id, reward, 'scramble');
    user.stats.gamesPlayed++;
    user.stats.gamesWon++;
    saveEconomy(guildId, ec);
    progressQuest(guildId, winner.id, 'minigames');
    checkQuestCompletion(guildId, winner.id);

    const winEmbed = new EmbedBuilder()
      .setColor(COLORS.success)
      .setTitle('🏆 Winner!')
      .setDescription(`<@${winner.id}> unscrambled **${word}**!\n\n💰 **+${formatNumber(reward)}** Credits`)
      .setFooter({ text: `New Balance: ${formatNumber(user.credits)}` });
    return msg.edit({ embeds: [winEmbed] });
  } catch {
    cleanupGame(channelId);
    const loseEmbed = new EmbedBuilder()
      .setColor(COLORS.error)
      .setTitle('⏰ Time\'s Up!')
      .setDescription(`Nobody got it. The word was **${word}**.`);
    return msg.edit({ embeds: [loseEmbed] });
  }
}

// ══════════════════════════════════════════════════════════
// MATH
// ══════════════════════════════════════════════════════════

async function handleMath(message, args, client) {
  if (!isEconomyEnabled(message.guild.id)) return message.reply(err('Economy is not enabled.'));
  const guildId = message.guild.id;
  const channelId = message.channel.id;
  const ec = getEconomy(guildId);

  if (activeGames.has(channelId)) return message.reply(err('A game is already active in this channel!'));

  const difficulty = args[0]?.toLowerCase();
  let a, b, op, answer, display;

  if (difficulty === 'hard') {
    a = Math.floor(Math.random() * 50) + 10;
    b = Math.floor(Math.random() * 20) + 5;
    const ops = ['*', '/', '+', '-'];
    op = ops[Math.floor(Math.random() * ops.length)];
  } else if (difficulty === 'medium') {
    a = Math.floor(Math.random() * 20) + 5;
    b = Math.floor(Math.random() * 15) + 2;
    const ops = ['*', '+', '-'];
    op = ops[Math.floor(Math.random() * ops.length)];
  } else {
    a = Math.floor(Math.random() * 20) + 1;
    b = Math.floor(Math.random() * 20) + 1;
    const ops = ['+', '-'];
    op = ops[Math.floor(Math.random() * ops.length)];
  }

  switch (op) {
    case '+': answer = a + b; display = `${a} + ${b}`; break;
    case '-': answer = a - b; display = `${a} - ${b}`; break;
    case '*': answer = a * b; display = `${a} × ${b}`; break;
    case '/':
      answer = a;
      display = `${a * b} ÷ ${b}`;
      break;
  }

  const mult = getEventMultiplier(guildId, 'math');
  const reward = Math.round(ec.rewards.math * mult);

  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle('🔢 Math Challenge!')
    .setDescription(`Solve:\n\n**${display} = ?**\n\n💰 First correct answer wins **+${formatNumber(reward)}** Credits!\n⏰ You have 30 seconds.`)
    .setFooter({ text: `Difficulty: ${difficulty || 'easy'}` });

  const msg = await message.reply({ embeds: [embed] });
  activeGames.set(channelId, { type: 'math', answer: String(answer), startTime: Date.now() });

  const filter = m => !isNaN(parseInt(m.content.trim()));
  try {
    const collected = await message.channel.awaitMessages({ filter, max: 1, time: 30000, errors: ['time'] });
    const winnerMsg = collected.first();
    const winner = winnerMsg.author;
    const guess = parseInt(winnerMsg.content.trim());
    cleanupGame(channelId);

    if (guess !== answer) {
      return msg.edit({ embeds: [new EmbedBuilder().setColor(COLORS.error).setTitle('❌ Wrong!').setDescription(`<@${winner.id}> guessed **${guess}**, but the answer was **${answer}**.`)] });
    }

    const user = getUserEconomy(guildId, winner.id);
    const remaining = (user.cooldowns.math || 0) + ec.cooldowns.math - Date.now();
    if (remaining > 0) {
      return msg.edit({ embeds: [new EmbedBuilder().setColor(COLORS.warning).setTitle('⏳ Cooldown').setDescription(`<@${winner.id}> got it right, but they're on cooldown! The answer was **${answer}**.`)] });
    }

    setCooldown(guildId, winner.id, 'math');
    addCredits(guildId, winner.id, reward, 'math');
    user.stats.gamesPlayed++;
    user.stats.gamesWon++;
    saveEconomy(guildId, ec);
    progressQuest(guildId, winner.id, 'minigames');
    checkQuestCompletion(guildId, winner.id);

    const winEmbed = new EmbedBuilder()
      .setColor(COLORS.success)
      .setTitle('🏆 Winner!')
      .setDescription(`<@${winner.id}> solved **${display} = ${answer}**!\n\n💰 **+${formatNumber(reward)}** Credits`)
      .setFooter({ text: `New Balance: ${formatNumber(user.credits)}` });
    return msg.edit({ embeds: [winEmbed] });
  } catch {
    cleanupGame(channelId);
    return msg.edit({ embeds: [new EmbedBuilder().setColor(COLORS.error).setTitle('⏰ Time\'s Up!').setDescription(`Nobody got it. The answer was **${answer}**.`)] });
  }
}

// ══════════════════════════════════════════════════════════
// FAST TYPE
// ══════════════════════════════════════════════════════════

async function handleFasttype(message, args, client) {
  if (!isEconomyEnabled(message.guild.id)) return message.reply(err('Economy is not enabled.'));
  const guildId = message.guild.id;
  const channelId = message.channel.id;
  const ec = getEconomy(guildId);

  if (activeGames.has(channelId)) return message.reply(err('A game is already active in this channel!'));

  const phrase = FASTTYPE_PHRASES[Math.floor(Math.random() * FASTTYPE_PHRASES.length)];
  const mult = getEventMultiplier(guildId, 'fasttype');
  const reward = Math.round(ec.rewards.fasttype * mult);

  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle('⌨️ Fast Type!')
    .setDescription(`Type this phrase as fast as you can:\n\n**${phrase}**\n\n💰 First correct answer wins **+${formatNumber(reward)}** Credits!\n⏰ You have 20 seconds.`)
    .setFooter({ text: 'Type it exactly!' });

  const msg = await message.reply({ embeds: [embed] });
  activeGames.set(channelId, { type: 'fasttype', phrase: phrase.toLowerCase(), startTime: Date.now() });

  const filter = m => m.content.trim().toLowerCase() === phrase.toLowerCase();
  try {
    const collected = await message.channel.awaitMessages({ filter, max: 1, time: 20000, errors: ['time'] });
    const winner = collected.first().author;
    cleanupGame(channelId);

    const user = getUserEconomy(guildId, winner.id);
    const remaining = (user.cooldowns.fasttype || 0) + ec.cooldowns.fasttype - Date.now();
    if (remaining > 0) {
      return msg.edit({ embeds: [new EmbedBuilder().setColor(COLORS.warning).setTitle('⏳ Cooldown').setDescription(`<@${winner.id}> typed it first, but they're on cooldown!`)] });
    }

    setCooldown(guildId, winner.id, 'fasttype');
    addCredits(guildId, winner.id, reward, 'fasttype');
    user.stats.gamesPlayed++;
    user.stats.gamesWon++;
    saveEconomy(guildId, ec);
    progressQuest(guildId, winner.id, 'minigames');
    checkQuestCompletion(guildId, winner.id);

    const winEmbed = new EmbedBuilder()
      .setColor(COLORS.success)
      .setTitle('🏆 Speed Demon!')
      .setDescription(`<@${winner.id}> typed it perfectly!\n\n💰 **+${formatNumber(reward)}** Credits`)
      .setFooter({ text: `New Balance: ${formatNumber(user.credits)}` });
    return msg.edit({ embeds: [winEmbed] });
  } catch {
    cleanupGame(channelId);
    return msg.edit({ embeds: [new EmbedBuilder().setColor(COLORS.error).setTitle('⏰ Time\'s Up!').setDescription('Nobody typed it in time.')] });
  }
}

// ══════════════════════════════════════════════════════════
// MEMORY
// ══════════════════════════════════════════════════════════

async function handleMemory(message, args, client) {
  if (!isEconomyEnabled(message.guild.id)) return message.reply(err('Economy is not enabled.'));
  const guildId = message.guild.id;
  const userId = message.author.id;
  const user = getUserEconomy(guildId, userId);
  const ec = getEconomy(guildId);

  const remaining = (user.cooldowns.memory || 0) + ec.cooldowns.memory - Date.now();
  if (remaining > 0) return message.reply(err(`Memory game cooldown!`, `Wait **${formatDuration(remaining)}**.`));

  const sequence = [];
  for (let i = 0; i < 4; i++) {
    sequence.push(MEMORY_EMOJIS[Math.floor(Math.random() * MEMORY_EMOJIS.length)]);
  }

  const mult = getEventMultiplier(guildId, 'memory');
  const reward = Math.round(ec.rewards.memory * mult);

  // Show sequence
  const showEmbed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle('🧠 Memory Challenge!')
    .setDescription(`Memorize this sequence:\n\n**${sequence.join(' ')}**\n\nThe buttons will appear in 3 seconds...\n\n💰 Reward: **+${formatNumber(reward)}** Credits`);

  const msg = await message.reply({ embeds: [showEmbed] });

  await new Promise(r => setTimeout(r, 3000));

  // Build buttons
  const rows = [];
  const shuffledEmojis = [...MEMORY_EMOJIS].sort(() => Math.random() - 0.5);
  for (let i = 0; i < 2; i++) {
    const row = new ActionRowBuilder();
    for (let j = 0; j < 4; j++) {
      const emoji = shuffledEmojis[i * 4 + j];
      row.addComponents(
        new ButtonBuilder().setCustomId(`mem_${emoji}`).setEmoji(emoji).setStyle(ButtonStyle.Primary)
      );
    }
    rows.push(row);
  }

  const playEmbed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle('🧠 Memory Challenge!')
    .setDescription(`Click the emojis in the correct order:\n\n**${'❓ '.repeat(sequence.length)}**\n\nSequence: 0/${sequence.length}`);

  await msg.edit({ embeds: [playEmbed], components: rows });

  let step = 0;
  const collector = msg.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 30000,
    filter: i => i.user.id === userId,
  });

  collector.on('collect', async (interaction) => {
    const emoji = interaction.customId.replace('mem_', '');
    if (emoji === sequence[step]) {
      step++;
      if (step >= sequence.length) {
        collector.stop('won');
        setCooldown(guildId, userId, 'memory');
        addCredits(guildId, userId, reward, 'memory');
        user.stats.gamesPlayed++;
        user.stats.gamesWon++;
        saveEconomy(guildId, ec);
        progressQuest(guildId, userId, 'minigames');
        checkQuestCompletion(guildId, userId);

        const winEmbed = new EmbedBuilder()
          .setColor(COLORS.success)
          .setTitle('🎉 Memory Master!')
          .setDescription(`You remembered the sequence!\n\n💰 **+${formatNumber(reward)}** Credits`)
          .setFooter({ text: `Balance: ${formatNumber(user.credits)}` });
        await interaction.update({ embeds: [winEmbed], components: [] });
      } else {
        const progressEmbed = new EmbedBuilder()
          .setColor(COLORS.primary)
          .setTitle('🧠 Memory Challenge!')
          .setDescription(`Click the emojis in the correct order:\n\n${sequence.slice(0, step).join(' ')} ${'❓ '.repeat(sequence.length - step)}\n\nSequence: ${step}/${sequence.length}`);
        await interaction.update({ embeds: [progressEmbed] });
      }
    } else {
      collector.stop('lost');
      const loseEmbed = new EmbedBuilder()
        .setColor(COLORS.error)
        .setTitle('❌ Wrong!')
        .setDescription(`That was not the next emoji. The sequence was:\n\n**${sequence.join(' ')}**\n\nNo reward this time.`);
      await interaction.update({ embeds: [loseEmbed], components: [] });
    }
  });

  collector.on('end', async (collected, reason) => {
    if (reason === 'time') {
      const timeoutEmbed = new EmbedBuilder()
        .setColor(COLORS.muted)
        .setTitle('⏰ Time\'s Up!')
        .setDescription(`The sequence was:\n\n**${sequence.join(' ')}**`);
      await msg.edit({ embeds: [timeoutEmbed], components: [] });
    }
  });
}

// ══════════════════════════════════════════════════════════
// SLOTS
// ══════════════════════════════════════════════════════════

async function handleSlots(message) {
  if (!isEconomyEnabled(message.guild.id)) return message.reply(err('Economy is not enabled.'));
  const guildId = message.guild.id;
  const userId = message.author.id;
  const user = getUserEconomy(guildId, userId);
  const ec = getEconomy(guildId);

  const remaining = (user.cooldowns.slots || 0) + ec.cooldowns.slots - Date.now();
  if (remaining > 0) return message.reply(err(`Slots cooldown!`, `Wait **${formatDuration(remaining)}**.`));

  setCooldown(guildId, userId, 'slots');
  user.stats.gamesPlayed++;
  saveEconomy(guildId, ec);

  const msg = await message.reply({ embeds: [new EmbedBuilder().setColor(COLORS.primary).setTitle('🎰 LUCKY SLOTS').setDescription('Spinning...\n\n`⬜ | ⬜ | ⬜`')] });

  // Animation frames
  for (let i = 0; i < 3; i++) {
    await new Promise(r => setTimeout(r, 800));
    const temp = [SLOTS_SYMBOLS[Math.floor(Math.random() * SLOTS_SYMBOLS.length)], SLOTS_SYMBOLS[Math.floor(Math.random() * SLOTS_SYMBOLS.length)], SLOTS_SYMBOLS[Math.floor(Math.random() * SLOTS_SYMBOLS.length)]];
    await msg.edit({ embeds: [new EmbedBuilder().setColor(COLORS.primary).setTitle('🎰 LUCKY SLOTS').setDescription(`Spinning...\n\n\`${temp[0]} | ${temp[1]} | ${temp[2]}\``)] });
  }

  // Determine result
  let result;
  const rand = Math.random();
  if (rand < 0.03) result = ['💎', '💎', '💎'];
  else if (rand < 0.08) result = ['⭐', '⭐', '⭐'];
  else if (rand < 0.18) result = ['🍒', '🍒', '🍒'];
  else result = [SLOTS_SYMBOLS[Math.floor(Math.random() * SLOTS_SYMBOLS.length)], SLOTS_SYMBOLS[Math.floor(Math.random() * SLOTS_SYMBOLS.length)], SLOTS_SYMBOLS[Math.floor(Math.random() * SLOTS_SYMBOLS.length)]];

  let reward = 0;
  let title = '';
  let color = COLORS.primary;

  if (result[0] === result[1] && result[1] === result[2]) {
    if (result[0] === '🍒') { reward = ec.rewards.slotsCherry; title = '🍒 JACKPOT! Triple Cherries!'; color = COLORS.success; }
    else if (result[0] === '⭐') { reward = ec.rewards.slotsStar; title = '⭐ MEGA WIN! Triple Stars!'; color = COLORS.gold; }
    else if (result[0] === '💎') { reward = ec.rewards.slotsDiamond; title = '💎 ULTRA WIN! Triple Diamonds!'; color = COLORS.gold; }
    user.stats.gamesWon++;
  } else {
    reward = ec.rewards.slotsMixed;
    title = '🎰 Result';
  }

  const mult = getEventMultiplier(guildId, 'slots');
  reward = Math.round(reward * mult);
  if (reward > 0) addCredits(guildId, userId, reward, 'slots');
  saveEconomy(guildId, ec);

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(`\`${result[0]} | ${result[1]} | ${result[2]}\`\n\n💰 **+${formatNumber(reward)}** Credits`)
    .setFooter({ text: `Balance: ${formatNumber(user.credits)}${mult > 1 ? ' • Event Bonus!' : ''}` });

  return msg.edit({ embeds: [embed] });
}

// ══════════════════════════════════════════════════════════
// WHEEL
// ══════════════════════════════════════════════════════════

async function handleWheel(message) {
  if (!isEconomyEnabled(message.guild.id)) return message.reply(err('Economy is not enabled.'));
  const guildId = message.guild.id;
  const userId = message.author.id;
  const user = getUserEconomy(guildId, userId);
  const ec = getEconomy(guildId);

  const remaining = (user.cooldowns.wheel || 0) + ec.cooldowns.wheel - Date.now();
  if (remaining > 0) return message.reply(err(`Wheel cooldown!`, `Wait **${formatDuration(remaining)}**.`));

  setCooldown(guildId, userId, 'wheel');
  user.stats.gamesPlayed++;
  saveEconomy(guildId, ec);

  const msg = await message.reply({ embeds: [new EmbedBuilder().setColor(COLORS.primary).setTitle('🎡 PRIZE WHEEL').setDescription('Spinning the wheel...\n\n🎡')] });

  // Spin animation
  for (let i = 0; i < 5; i++) {
    await new Promise(r => setTimeout(r, 600));
    const temp = WHEEL_SEGMENTS[Math.floor(Math.random() * WHEEL_SEGMENTS.length)];
    await msg.edit({ embeds: [new EmbedBuilder().setColor(COLORS.primary).setTitle('🎡 PRIZE WHEEL').setDescription(`Spinning...\n\n${temp.emoji} **${temp.label}**`)] });
  }

  const result = WHEEL_SEGMENTS[Math.floor(Math.random() * WHEEL_SEGMENTS.length)];
  let desc = `The wheel landed on:\n\n${result.emoji} **${result.label}**`;

  if (typeof result.value === 'number') {
    const mult = getEventMultiplier(guildId, 'wheel');
    const reward = Math.round(result.value * mult);
    addCredits(guildId, userId, reward, 'wheel');
    if (reward > 0) user.stats.gamesWon++;
    desc += `\n\n💰 **+${formatNumber(reward)}** Credits`;
    saveEconomy(guildId, ec);
  } else if (result.value === 'quest') {
    progressQuest(guildId, userId, 'minigames', 2);
    checkQuestCompletion(guildId, userId);
    desc += `\n\n🎯 **Quest progress boosted!**`;
  } else if (result.value === 'cosmetic') {
    desc += `\n\n🎨 **Cosmetic reward!** (Check your inventory)`;
  }

  const embed = new EmbedBuilder()
    .setColor(COLORS.success)
    .setTitle('🎡 Prize Wheel Result')
    .setDescription(desc)
    .setFooter({ text: `Balance: ${formatNumber(user.credits)}` });

  return msg.edit({ embeds: [embed] });
}

// ══════════════════════════════════════════════════════════
// SCRATCH
// ══════════════════════════════════════════════════════════

async function handleScratch(message) {
  if (!isEconomyEnabled(message.guild.id)) return message.reply(err('Economy is not enabled.'));
  const guildId = message.guild.id;
  const userId = message.author.id;
  const user = getUserEconomy(guildId, userId);
  const ec = getEconomy(guildId);

  const remaining = (user.cooldowns.scratch || 0) + ec.cooldowns.scratch - Date.now();
  if (remaining > 0) return message.reply(err(`Scratch card cooldown!`, `Wait **${formatDuration(remaining)}**.`));

  setCooldown(guildId, userId, 'scratch');
  user.stats.gamesPlayed++;
  saveEconomy(guildId, ec);

  // Generate 3x3 grid
  const grid = [];
  for (let i = 0; i < 9; i++) {
    const reward = SCRATCH_REWARDS[Math.floor(Math.random() * SCRATCH_REWARDS.length)];
    grid.push({ id: i, revealed: false, reward });
  }

  const buildButtons = () => {
    const rows = [];
    for (let i = 0; i < 3; i++) {
      const row = new ActionRowBuilder();
      for (let j = 0; j < 3; j++) {
        const cell = grid[i * 3 + j];
        const label = cell.revealed ? (cell.reward.type === 'credits' ? `${cell.reward.value}` : cell.reward.emoji) : '❓';
        const style = cell.revealed ? ButtonStyle.Success : ButtonStyle.Secondary;
        row.addComponents(new ButtonBuilder().setCustomId(`scratch_${i * 3 + j}`).setLabel(label).setStyle(style).setDisabled(cell.revealed));
      }
      rows.push(row);
    }
    return rows;
  };

  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle('🎫 Scratch Card')
    .setDescription('Click the buttons to reveal hidden rewards!\n\n💰 Find Credits, 🎯 Quest Progress, or 🎨 Cosmetics!')
    .setFooter({ text: 'Reveal all 9 tiles!' });

  const msg = await message.reply({ embeds: [embed], components: buildButtons() });

  const collector = msg.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 60000,
    filter: i => i.user.id === userId,
  });

  let revealedCount = 0;
  let totalCredits = 0;

  collector.on('collect', async (interaction) => {
    const idx = parseInt(interaction.customId.replace('scratch_', ''));
    if (grid[idx].revealed) return interaction.reply({ content: 'Already revealed!', ephemeral: true });

    grid[idx].revealed = true;
    revealedCount++;

    const r = grid[idx].reward;
    if (r.type === 'credits') {
      totalCredits += r.value;
    }

    const allRevealed = revealedCount >= 9;
    const desc = allRevealed
      ? `All tiles revealed!\n\n💰 Total Credits: **+${formatNumber(totalCredits)}**\n\n${grid.map((c, i) => `${c.revealed ? (c.reward.type === 'credits' ? '💰' : c.reward.emoji) : '❓'}`).join(' ')}`
      : `Click the buttons to reveal hidden rewards!\n\n💰 Current Total: **${formatNumber(totalCredits)}**\n\n${grid.map((c, i) => `${c.revealed ? (c.reward.type === 'credits' ? '💰' : c.reward.emoji) : '❓'}`).join(' ')}`;

    const newEmbed = new EmbedBuilder()
      .setColor(allRevealed ? COLORS.success : COLORS.primary)
      .setTitle('🎫 Scratch Card')
      .setDescription(desc)
      .setFooter({ text: allRevealed ? 'Card complete!' : `${9 - revealedCount} tiles remaining` });

    await interaction.update({ embeds: [newEmbed], components: allRevealed ? [] : buildButtons() });

    if (allRevealed) {
      collector.stop();
      if (totalCredits > 0) {
        addCredits(guildId, userId, totalCredits, 'scratch');
        user.stats.gamesWon++;
      }
      // Count quest/cosmetic rewards
      const questBoosts = grid.filter(c => c.reward.type === 'quest').length;
      const cosmetics = grid.filter(c => c.reward.type === 'cosmetic').length;
      if (questBoosts > 0) progressQuest(guildId, userId, 'minigames', questBoosts);
      saveEconomy(guildId, ec);
      checkQuestCompletion(guildId, userId);
    }
  });

  collector.on('end', async (collected, reason) => {
    if (reason === 'time') {
      const timeoutEmbed = new EmbedBuilder()
        .setColor(COLORS.muted)
        .setTitle('⏰ Scratch Card Expired')
        .setDescription('The scratch card has expired. Any unrevealed rewards are lost.');
      await msg.edit({ embeds: [timeoutEmbed], components: [] });
    }
  });
}

// ══════════════════════════════════════════════════════════
// MINES
// ══════════════════════════════════════════════════════════

async function handleMines(message) {
  if (!isEconomyEnabled(message.guild.id)) return message.reply(err('Economy is not enabled.'));
  const guildId = message.guild.id;
  const userId = message.author.id;
  const user = getUserEconomy(guildId, userId);
  const ec = getEconomy(guildId);

  const remaining = (user.cooldowns.mines || 0) + ec.cooldowns.mines - Date.now();
  if (remaining > 0) return message.reply(err(`Mines cooldown!`, `Wait **${formatDuration(remaining)}**.`));

  setCooldown(guildId, userId, 'mines');
  user.stats.gamesPlayed++;
  saveEconomy(guildId, ec);

  // 4x4 grid, 4 mines
  const grid = [];
  const minePositions = new Set();
  while (minePositions.size < 4) minePositions.add(Math.floor(Math.random() * 16));
  for (let i = 0; i < 16; i++) {
    grid.push({ id: i, isMine: minePositions.has(i), revealed: false });
  }

  let safePicks = 0;
  let earned = 0;
  const maxSafe = 8;
  const baseReward = ec.rewards.minesBase;
  const increment = ec.rewards.minesIncrement;

  const buildButtons = () => {
    const rows = [];
    for (let i = 0; i < 4; i++) {
      const row = new ActionRowBuilder();
      for (let j = 0; j < 4; j++) {
        const cell = grid[i * 4 + j];
        let label, style, disabled;
        if (cell.revealed) {
          label = cell.isMine ? '💣' : '💎';
          style = cell.isMine ? ButtonStyle.Danger : ButtonStyle.Success;
          disabled = true;
        } else {
          label = '⬜';
          style = ButtonStyle.Secondary;
          disabled = false;
        }
        row.addComponents(new ButtonBuilder().setCustomId(`mine_${i * 4 + j}`).setLabel(label).setStyle(style).setDisabled(disabled));
      }
      rows.push(row);
    }
    return rows;
  };

  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle('💣 MINES')
    .setDescription('Click tiles to find diamonds! Avoid the mines!\n\n💎 Safe = Credits\n💣 Mine = Round Over (keep earned credits)\n\n**Reward: +0 Credits**\n**Safe picks: 0/8**')
    .setFooter({ text: 'Pick a tile!' });

  const msg = await message.reply({ embeds: [embed], components: buildButtons() });

  const collector = msg.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 120000,
    filter: i => i.user.id === userId,
  });

  collector.on('collect', async (interaction) => {
    const idx = parseInt(interaction.customId.replace('mine_', ''));
    if (grid[idx].revealed) return interaction.reply({ content: 'Already picked!', ephemeral: true });

    grid[idx].revealed = true;

    if (grid[idx].isMine) {
      collector.stop('mine');
      const loseEmbed = new EmbedBuilder()
        .setColor(COLORS.error)
        .setTitle('💥 MINE!')
        .setDescription(`You hit a mine!\n\n💰 Credits earned this round: **${formatNumber(earned)}**\n❌ Credits lost: **0**\n\nYour previously earned rewards remain safe!`)
        .setFooter({ text: `Balance: ${formatNumber(user.credits)}` });
      return interaction.update({ embeds: [loseEmbed], components: buildButtons() });
    }

    safePicks++;
    const pickReward = Math.round((baseReward + (safePicks - 1) * increment) * getEventMultiplier(guildId, 'mines'));
    earned += pickReward;

    if (safePicks >= maxSafe) {
      collector.stop('max');
      addCredits(guildId, userId, earned, 'mines');
      user.stats.gamesWon++;
      saveEconomy(guildId, ec);
      progressQuest(guildId, userId, 'minigames');
      checkQuestCompletion(guildId, userId);

      const winEmbed = new EmbedBuilder()
        .setColor(COLORS.success)
        .setTitle('🎉 MAXIMUM SAFE PICKS!')
        .setDescription(`You cleared ${maxSafe} safe tiles!\n\n💰 Total earned: **+${formatNumber(earned)}** Credits`)
        .setFooter({ text: `Balance: ${formatNumber(user.credits)}` });
      return interaction.update({ embeds: [winEmbed], components: buildButtons() });
    }

    const contEmbed = new EmbedBuilder()
      .setColor(COLORS.success)
      .setTitle('💎 Safe Tile!')
      .setDescription(`**Reward: +${formatNumber(pickReward)} Credits**\n\n💰 Total this round: **${formatNumber(earned)}**\n**Safe picks: ${safePicks}/${maxSafe}**\n\nContinue or cash out?`)
      .setFooter({ text: 'Pick another tile or finish!' });

    await interaction.update({ embeds: [contEmbed], components: buildButtons() });
  });

  collector.on('end', async (collected, reason) => {
    if (reason === 'time') {
      if (earned > 0) addCredits(guildId, userId, earned, 'mines');
      const timeoutEmbed = new EmbedBuilder()
        .setColor(COLORS.muted)
        .setTitle('⏰ Round Expired')
        .setDescription(`Time's up! You earned **${formatNumber(earned)}** Credits this round.`)
        .setFooter({ text: `Balance: ${formatNumber(user.credits)}` });
      await msg.edit({ embeds: [timeoutEmbed], components: [] });
    }
  });
}

// ══════════════════════════════════════════════════════════
// CUPS
// ══════════════════════════════════════════════════════════

async function handleCups(message, args) {
  if (!isEconomyEnabled(message.guild.id)) return message.reply(err('Economy is not enabled.'));
  const guildId = message.guild.id;
  const userId = message.author.id;
  const user = getUserEconomy(guildId, userId);
  const ec = getEconomy(guildId);

  const remaining = (user.cooldowns.cups || 0) + ec.cooldowns.cups - Date.now();
  if (remaining > 0) return message.reply(err(`Cups cooldown!`, `Wait **${formatDuration(remaining)}**.`));

  const difficulty = args[0]?.toLowerCase();
  let reward;
  if (difficulty === 'hard') reward = ec.rewards.cupsHard;
  else if (difficulty === 'medium') reward = ec.rewards.cupsMedium;
  else reward = ec.rewards.cupsEasy;

  const correctCup = Math.random() < 0.5 ? 'red' : 'blue';

  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle('🔴🔵 Red Cup / Blue Cup')
    .setDescription(`Where is the ball hidden?\n\n💰 Correct guess = **+${formatNumber(reward)}** Credits\n❌ Wrong guess = **0** Credits lost`)
    .setFooter({ text: `Difficulty: ${difficulty || 'easy'}` });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('cup_red').setLabel('RED CUP').setEmoji('🔴').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('cup_blue').setLabel('BLUE CUP').setEmoji('🔵').setStyle(ButtonStyle.Primary),
  );

  const msg = await message.reply({ embeds: [embed], components: [row] });

  const collector = msg.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 30000,
    max: 1,
    filter: i => i.user.id === userId,
  });

  collector.on('collect', async (interaction) => {
    setCooldown(guildId, userId, 'cups');
    user.stats.gamesPlayed++;
    const picked = interaction.customId.replace('cup_', '');

    if (picked === correctCup) {
      addCredits(guildId, userId, reward, 'cups');
      user.stats.gamesWon++;
      saveEconomy(guildId, ec);
      progressQuest(guildId, userId, 'minigames');
      checkQuestCompletion(guildId, userId);

      const winEmbed = new EmbedBuilder()
        .setColor(COLORS.success)
        .setTitle('🎉 CORRECT!')
        .setDescription(`You found the ball under the **${correctCup.toUpperCase()}** cup!\n\n💰 **+${formatNumber(reward)}** Credits`)
        .setFooter({ text: `Balance: ${formatNumber(user.credits)}` });
      return interaction.update({ embeds: [winEmbed], components: [] });
    } else {
      const loseEmbed = new EmbedBuilder()
        .setColor(COLORS.error)
        .setTitle('❌ Wrong Cup!')
        .setDescription(`The ball was under the **${correctCup.toUpperCase()}** cup.\n\n💰 Credits lost: **0**`)
        .setFooter({ text: `Balance: ${formatNumber(user.credits)}` });
      return interaction.update({ embeds: [loseEmbed], components: [] });
    }
  });

  collector.on('end', async (collected, reason) => {
    if (reason === 'time') {
      const timeoutEmbed = new EmbedBuilder()
        .setColor(COLORS.muted)
        .setTitle('⏰ Time\'s Up!')
        .setDescription(`The ball was under the **${correctCup.toUpperCase()}** cup.`);
      await msg.edit({ embeds: [timeoutEmbed], components: [] });
    }
  });
}

// ══════════════════════════════════════════════════════════
// HIGH / LOW
// ══════════════════════════════════════════════════════════

async function handleHighlow(message) {
  if (!isEconomyEnabled(message.guild.id)) return message.reply(err('Economy is not enabled.'));
  const guildId = message.guild.id;
  const userId = message.author.id;
  const user = getUserEconomy(guildId, userId);
  const ec = getEconomy(guildId);

  const remaining = (user.cooldowns.highlow || 0) + ec.cooldowns.highlow - Date.now();
  if (remaining > 0) return message.reply(err(`High/Low cooldown!`, `Wait **${formatDuration(remaining)}**.`));

  const current = Math.floor(Math.random() * 100) + 1;
  const next = Math.floor(Math.random() * 100) + 1;
  const reward = Math.round(ec.rewards.highlow * getEventMultiplier(guildId, 'highlow'));

  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle('📈 High / Low')
    .setDescription(`Current number: **${current}**\n\nWill the next number be **HIGHER** or **LOWER**?\n\n💰 Correct guess = **+${formatNumber(reward)}** Credits`)
    .setFooter({ text: 'Choose wisely!' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('hl_high').setLabel('HIGHER ⬆️').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('hl_low').setLabel('LOWER ⬇️').setStyle(ButtonStyle.Danger),
  );

  const msg = await message.reply({ embeds: [embed], components: [row] });

  const collector = msg.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 30000,
    max: 1,
    filter: i => i.user.id === userId,
  });

  collector.on('collect', async (interaction) => {
    setCooldown(guildId, userId, 'highlow');
    user.stats.gamesPlayed++;
    const guess = interaction.customId.replace('hl_', '');
    const isHigher = next > current;
    const correct = (guess === 'high' && isHigher) || (guess === 'low' && !isHigher);

    if (correct) {
      addCredits(guildId, userId, reward, 'highlow');
      user.stats.gamesWon++;
      saveEconomy(guildId, ec);
      progressQuest(guildId, userId, 'minigames');
      checkQuestCompletion(guildId, userId);

      const winEmbed = new EmbedBuilder()
        .setColor(COLORS.success)
        .setTitle('✅ Correct!')
        .setDescription(`The next number was **${next}**!\n\n💰 **+${formatNumber(reward)}** Credits`)
        .setFooter({ text: `Balance: ${formatNumber(user.credits)}` });
      return interaction.update({ embeds: [winEmbed], components: [] });
    } else {
      const loseEmbed = new EmbedBuilder()
        .setColor(COLORS.error)
        .setTitle('❌ Wrong!')
        .setDescription(`The next number was **${next}**!\n\nNo reward this time.`)
        .setFooter({ text: `Balance: ${formatNumber(user.credits)}` });
      return interaction.update({ embeds: [loseEmbed], components: [] });
    }
  });

  collector.on('end', async (collected, reason) => {
    if (reason === 'time') {
      const timeoutEmbed = new EmbedBuilder()
        .setColor(COLORS.muted)
        .setTitle('⏰ Time\'s Up!')
        .setDescription(`The next number was **${next}**.`);
      await msg.edit({ embeds: [timeoutEmbed], components: [] });
    }
  });
}

// ══════════════════════════════════════════════════════════
// JACKPOT
// ══════════════════════════════════════════════════════════

const activeJackpots = new Map(); // guildId -> { participants: Set, message, timeout, reward }

async function handleJackpot(message, args, client) {
  if (!isEconomyEnabled(message.guild.id)) return message.reply(err('Economy is not enabled.'));
  const guildId = message.guild.id;
  const userId = message.author.id;
  const user = getUserEconomy(guildId, userId);
  const ec = getEconomy(guildId);

  const remaining = (user.cooldowns.jackpot || 0) + ec.cooldowns.jackpot - Date.now();
  if (remaining > 0) return message.reply(err(`Jackpot cooldown!`, `Wait **${formatDuration(remaining)}**.`));

  if (activeJackpots.has(guildId)) {
    // User is joining an existing jackpot
    const jp = activeJackpots.get(guildId);
    if (jp.participants.has(userId)) {
      return message.reply(err('You already joined this jackpot!'));
    }
    // Check if user has cooldown
    const u = getUserEconomy(guildId, userId);
    const cd = (u.cooldowns.jackpot || 0) + ec.cooldowns.jackpot - Date.now();
    if (cd > 0) return message.reply(err(`Jackpot participation cooldown!`, `Wait **${formatDuration(cd)}**.`));

    jp.participants.add(userId);
    const embed = new EmbedBuilder()
      .setColor(COLORS.gold)
      .setTitle('🎰 SERVER JACKPOT')
      .setDescription(`A jackpot event is running!\n\n💰 Prize: **${formatNumber(jp.reward)}** Credits\n👥 Participants: **${jp.participants.size}**\n⏰ Ends in 60 seconds!\n\nClick **JOIN** to enter for free!`)
      .setFooter({ text: 'Free entry! One entry per user!' });
    await jp.message.edit({ embeds: [embed] });
    return message.reply(ok('You joined the jackpot! Good luck!'));
  }

  // Start new jackpot
  const reward = Math.round(ec.rewards.jackpot * getEventMultiplier(guildId, 'jackpot'));
  const participants = new Set([userId]);

  const embed = new EmbedBuilder()
    .setColor(COLORS.gold)
    .setTitle('🎰 SERVER JACKPOT')
    .setDescription(`A jackpot event is starting!\n\n💰 Prize: **${formatNumber(reward)}** Credits\n👥 Participants: **1**\n⏰ Ends in 60 seconds!\n\nClick **JOIN** to enter for free!`)
    .setFooter({ text: 'Free entry! One entry per user!' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('jackpot_join').setLabel('JOIN').setEmoji('🎰').setStyle(ButtonStyle.Success),
  );

  const msg = await message.channel.send({ embeds: [embed], components: [row] });
  activeJackpots.set(guildId, { participants, message: msg, reward, channelId: message.channel.id });

  // End jackpot after 60 seconds
  setTimeout(async () => {
    const jp = activeJackpots.get(guildId);
    if (!jp) return;
    activeJackpots.delete(guildId);

    const list = Array.from(jp.participants);
    if (list.length === 0) {
      const noEmbed = new EmbedBuilder().setColor(COLORS.muted).setTitle('🎰 Jackpot Cancelled').setDescription('Nobody joined the jackpot.');
      return msg.edit({ embeds: [noEmbed], components: [] });
    }

    const winnerId = list[Math.floor(Math.random() * list.length)];
    addCredits(guildId, winnerId, reward, 'jackpot');
    const winner = getUserEconomy(guildId, winnerId);
    winner.stats.gamesWon++;
    saveEconomy(guildId, ec);

    // Set cooldown for all participants
    for (const pid of list) {
      const pu = getUserEconomy(guildId, pid);
      pu.cooldowns.jackpot = Date.now();
    }
    saveEconomy(guildId, ec);

    const winEmbed = new EmbedBuilder()
      .setColor(COLORS.gold)
      .setTitle('🎰 JACKPOT WINNER!')
      .setDescription(`**${list.length}** users entered...\n\n🏆 <@${winnerId}> wins **${formatNumber(reward)}** Credits!`)
      .setFooter({ text: `New Balance: ${formatNumber(winner.credits)}` });
    await msg.edit({ embeds: [winEmbed], components: [] });
  }, 60000);
}

async function handleJackpotButton(interaction) {
  if (interaction.customId !== 'jackpot_join') return false;
  const guildId = interaction.guild.id;
  const userId = interaction.user.id;
  const ec = getEconomy(guildId);

  const jp = activeJackpots.get(guildId);
  if (!jp) return interaction.reply({ content: '❌ This jackpot has ended.', ephemeral: true });
  if (jp.participants.has(userId)) return interaction.reply({ content: '❌ You already joined!', ephemeral: true });

  const u = getUserEconomy(guildId, userId);
  const cd = (u.cooldowns.jackpot || 0) + ec.cooldowns.jackpot - Date.now();
  if (cd > 0) return interaction.reply({ content: `❌ Jackpot cooldown! Wait ${formatDuration(cd)}.`, ephemeral: true });

  jp.participants.add(userId);
  const embed = new EmbedBuilder()
    .setColor(COLORS.gold)
    .setTitle('🎰 SERVER JACKPOT')
    .setDescription(`A jackpot event is running!\n\n💰 Prize: **${formatNumber(jp.reward)}** Credits\n👥 Participants: **${jp.participants.size}**\n⏰ Ends in 60 seconds!\n\nClick **JOIN** to enter for free!`)
    .setFooter({ text: 'Free entry! One entry per user!' });
  await jp.message.edit({ embeds: [embed] });
  return interaction.reply({ content: '✅ You joined the jackpot! Good luck!', ephemeral: true });
}

// ══════════════════════════════════════════════════════════
// EXPORTS
// ══════════════════════════════════════════════════════════

module.exports = {
  handleTrivia,
  handleScramble,
  handleMath,
  handleFasttype,
  handleMemory,
  handleSlots,
  handleWheel,
  handleScratch,
  handleMines,
  handleCups,
  handleHighlow,
  handleJackpot,
  handleJackpotButton,
};