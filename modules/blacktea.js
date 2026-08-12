const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const logger = require('../utils/logger');
const { success: mkSuccess, error: mkError, info: mkInfo } = require('../utils/embeds');
const { getGuildDb } = require('./database');

// ══════════════════════════════════════════════════════════
// GLOBAL STATE
// ══════════════════════════════════════════════════════════
const activeGames = new Map();
const lockedPlayers = new Set();

// ══════════════════════════════════════════════════════════
// CUSTOM 3-LETTER SEQUENCE LIST
// ══════════════════════════════════════════════════════════
const CUSTOM_SEQUENCES = [
  'cat','dog','sun','car','pen','red','art','ear','eye','ing','ion','man','boy','ice','key',
  'top','hat','bat','rat','map','cup','star','sky','sea','tea','air','amp','ous','est','age',
  'all','ell','ill','old','new','big','low','far','win','tin','box','log','tag','bag','rag',
  'dig','fig','pre','pro','bio','geo','psy','tri','uni','sub','out','ump','emp','imp','opt',
  'apt','act','ect','scr','str','spl','spr','thr','shr','phy','nom','arc','the','med','mic',
  'max','min','vid','aud','vis','por','for','fac','duc','tra','cep','rup','ver','tai','war',
  'wis','shi','hoo','roo','lan','fir','wat','lig','dar','gol','blu','ept','tch','dge','que',
  'qua','gue','cia','tia','sia','eau','iou','eon','eum','awe','awk','owl','ink','ank','onk',
  'unk','ash','esh','ish','osh','ush','ive','ize','ify','ate','ary','ory','ery','ace','one',
  'two','zen','zar','qui','ium','oid','sci','enc','ism','ist','cal','zon','mon','tic','cam',
  'jum','lam','bum','dum','pum','ran','ban','tan','san','mil','sil','wal','tal','cha','wor',
  'par','mar','fis','dis','cas','bas','cra','bru','cru','fre','dre','gla','cla','gra','bra',
  'fla','fra','pla','sto','pho','com','con','eco','ele','eng','ent','eve','fam','fan','fin',
  'flo','flu','fun','gam','gar','gen','get','gir','giv','glo','gro','hea','hel','her','hit',
  'hop','hor','hou','int','joy','lab','law','lea','leg','lib','lie','lip','lot','mad','may',
  'mel','men','mid','mob','mor','mot','mus','net','nod','not','nut','oak','off','opt','orb',
  'pan','par','pie','pin','pop','pot','pub','pun','put','rea','ref','reg','rep','res','rid',
  'rig','rob','run','sad','sat','see','sel','sen','ser','set','sha','she','sho','sig','sim',
  'sin','sit','ski','sma','smi','sna','soc','sol','son','sou','spa','spe','spi','sta','ste',
  'sto','sub','sup','tab','tal','tar','tec','tem','ten','ter','the','tie','tim','tip','ton',
  'top','tor','tri','tro','tru','try','twi','typ','uni','urb','vac','val','ven','ver','via',
  'vic','vid','vin','vol','war','web','whi','who','win','wor','nth','ptx','mbx','ndx','stx',
  'ldx','rkx','rtx','ntx','mpx','xyl','zyg','zio',
];

const VALID_SEQUENCES = [...new Set(CUSTOM_SEQUENCES.map(s => s.toLowerCase()))];

// ══════════════════════════════════════════════════════════
// DICTIONARY INIT
// ══════════════════════════════════════════════════════════
let dictionarySet = new Set();
let sequenceToWords = new Map();
let validSequences = [];

function initBlacktea(dictArray) {
  dictionarySet = new Set(dictArray);
  const seqSet = new Set(VALID_SEQUENCES);

  for (const word of dictArray) {
    if (word.length < 3) continue;
    const lower = word.toLowerCase();
    for (let i = 0; i <= lower.length - 3; i++) {
      const seq = lower.substring(i, i + 3);
      if (!/^[a-z]{3}$/.test(seq)) continue;
      if (!sequenceToWords.has(seq)) sequenceToWords.set(seq, []);
      sequenceToWords.get(seq).push(lower);
    }
  }

  validSequences = Array.from(seqSet).filter(seq => {
    const words = sequenceToWords.get(seq);
    return words && words.length >= 1;
  });

  if (validSequences.length < 20) {
    const extra = Array.from(sequenceToWords.keys())
      .filter(s => sequenceToWords.get(s).length >= 5 && !seqSet.has(s))
      .slice(0, 100);
    validSequences.push(...extra);
  }

  logger.info('BLACKTEA', `Initialized with ${validSequences.length} valid sequences`);
}

// ══════════════════════════════════════════════════════════
// STATS HELPERS
// ══════════════════════════════════════════════════════════
function getBlackteaStats(guildId, userId) {
  const db = getGuildDb(guildId);
  const stats = db.get('blackteaStats', {});
  return stats[userId] || { wins: 0, gamesPlayed: 0, bestStreak: 0, totalWords: 0 };
}

function setBlackteaStats(guildId, userId, data) {
  const db = getGuildDb(guildId);
  const stats = db.get('blackteaStats', {});
  stats[userId] = data;
  db.set('blackteaStats', stats);
}

function incrementBlackteaStat(guildId, userId, field, value = 1) {
  const s = getBlackteaStats(guildId, userId);
  s[field] = (s[field] || 0) + value;
  setBlackteaStats(guildId, userId, s);
  return s;
}

// ══════════════════════════════════════════════════════════
// GAME SESSION
// ══════════════════════════════════════════════════════════
class GameSession {
  constructor(channel, hostId, hostUser) {
    this.channel = channel;
    this.hostId = hostId;
    this.hostUser = hostUser;
    this.players = new Map();
    this.turnOrder = [];
    this.currentTurnIndex = -1;
    this.usedWords = new Set();
    this.usedSequences = new Set();
    this.lobbyMessage = null;
    this.promptMessage = null;
    this.currentSequence = null;
    this.currentPlayerId = null;
    this.lobbyCollector = null;
    this.turnTimeout = null;
    this.countdownTimeouts = [];
    this.gameActive = false;
    this.lobbyActive = false;
    this.ended = false;
    this.guildId = channel.guild.id;
  }

  async startLobby() {
    this.lobbyActive = true;

    const embed = this._buildLobbyEmbed(30);
    try {
      this.lobbyMessage = await this.channel.send({ embeds: [embed] });
      await this.lobbyMessage.react('<:checkmark:1528890895859056680>').catch(() => {});
    } catch (err) {
      logger.error('BLACKTEA', 'Failed to send lobby message', err);
      this.cleanup();
      return;
    }

    this.players.set(this.hostId, { user: this.hostUser, lives: 2, eliminated: false });
    lockedPlayers.add(this.hostId);

    const filter = (reaction, user) => reaction.emoji.id === '1528890895859056680' && !user.bot;
    this.lobbyCollector = this.lobbyMessage.createReactionCollector({
      filter,
      time: 30000,
      dispose: true,
    });

    this.lobbyCollector.on('collect', (reaction, user) => {
      if (this.ended || !this.lobbyActive) return;
      if (lockedPlayers.has(user.id) && !this.players.has(user.id)) {
        reaction.users.remove(user.id).catch(() => {});
        return;
      }
      if (!this.players.has(user.id)) {
        this.players.set(user.id, { user, lives: 2, eliminated: false });
        lockedPlayers.add(user.id);
        this._updateLobbyEmbed();
      }
    });

    this.lobbyCollector.on('remove', (reaction, user) => {
      if (this.ended || !this.lobbyActive) return;
      this.players.delete(user.id);
      lockedPlayers.delete(user.id);
      this._updateLobbyEmbed();
    });

    let timeLeft = 30;
    const interval = setInterval(() => {
      timeLeft -= 5;
      if (timeLeft <= 0 || this.ended || !this.lobbyActive) {
        clearInterval(interval);
        return;
      }
      this._updateLobbyEmbed(timeLeft);
    }, 5000);

    this.lobbyCollector.on('end', async () => {
      clearInterval(interval);
      if (this.ended) return;
      await this._finalizeLobby();
    });
  }

  _buildLobbyEmbed(timeLeft = 30) {
    return new EmbedBuilder()
      .setTitle('<:blacktea:1535357849931092090> Blacktea')
      .setDescription(
        'React with <:checkmark:1528890895859056680> to join\n\n' +
        'Say a word containing the given 3 letters\n' +
        'Everyone starts with 2 lives\n' +
        'Last player alive wins\n\n' +
        `**${this.players.size}** players joined\n` +
        `**${timeLeft}s** remaining`
      )
      .setColor('#5865F2');
  }

  async _updateLobbyEmbed(timeLeft) {
    if (!this.lobbyMessage || this.ended) return;
    try {
      const embed = this._buildLobbyEmbed(timeLeft);
      await this.lobbyMessage.edit({ embeds: [embed] });
    } catch (err) {
      if (err.code === 10008) {
        this.forceEnd('The Blacktea game was cancelled because the lobby message was deleted.');
      } else {
        logger.error('BLACKTEA', 'Failed to update lobby embed', err);
      }
    }
  }

  async _finalizeLobby() {
    this.lobbyActive = false;

    try {
      const msg = await this.channel.messages.fetch(this.lobbyMessage.id);
      const reaction = msg.reactions.cache.find(r => r.emoji.id === '1528890895859056680');
      if (reaction) {
        const users = await reaction.users.fetch();
        for (const [userId, user] of users) {
          if (user.bot) continue;
          if (!this.players.has(userId) && !lockedPlayers.has(userId)) {
            this.players.set(userId, { user, lives: 2, eliminated: false });
            lockedPlayers.add(userId);
          }
        }
        for (const [userId] of new Map(this.players)) {
          if (!users.has(userId)) {
            this.players.delete(userId);
            lockedPlayers.delete(userId);
          }
        }
      }
    } catch (err) {
      logger.error('BLACKTEA', 'Failed to finalize lobby reactions', err);
    }

    if (this.players.size < 2) {
      await this.channel.send({
        embeds: [mkError('Not Enough Players', 'At least 2 players are required to start Blacktea. The game has been cancelled.')]
      }).catch(() => {});
      this.cleanup();
      return;
    }

    for (const [userId] of this.players) {
      incrementBlackteaStat(this.guildId, userId, 'gamesPlayed');
    }

    this.turnOrder = Array.from(this.players.keys()).sort(() => Math.random() - 0.5);
    this.currentTurnIndex = -1;
    this.gameActive = true;

    await this.nextTurn();
  }

  async nextTurn() {
    if (this.ended) return;
    try {
      let attempts = 0;
      let nextPlayerId = null;
      let nextPlayer = null;

      do {
        this.currentTurnIndex = (this.currentTurnIndex + 1) % this.turnOrder.length;
        nextPlayerId = this.turnOrder[this.currentTurnIndex];
        nextPlayer = this.players.get(nextPlayerId);
        attempts++;
      } while ((nextPlayer?.eliminated) && attempts < this.turnOrder.length);

      if (!nextPlayer || nextPlayer.eliminated) {
        const alive = Array.from(this.players.values()).filter(p => !p.eliminated);
        if (alive.length === 1) {
          await this._declareWinner(alive[0]);
          return;
        }
        await this.forceEnd('The game ended unexpectedly.');
        return;
      }

      const member = await this.channel.guild.members.fetch(nextPlayerId).catch(() => null);
      if (!member) {
        nextPlayer.eliminated = true;
        await this.channel.send(`<@${nextPlayerId}> is no longer in the server and has been eliminated!`).catch(() => {});
        const alive = Array.from(this.players.values()).filter(p => !p.eliminated);
        if (alive.length === 1) {
          await this._declareWinner(alive[0]);
          return;
        }
        await this.nextTurn();
        return;
      }

      this.currentPlayerId = nextPlayerId;
      await this._sendTurnPrompt();
      await this._startTurnTimer();
    } catch (err) {
      logger.error('BLACKTEA', 'Error in nextTurn', err);
      await this.forceEnd('The Blacktea game ended due to an error.');
    }
  }

  async _sendTurnPrompt() {
    let seq = null;
    const available = validSequences.filter(s => !this.usedSequences.has(s));
    const pool = available.length > 0 ? available : validSequences;
    seq = pool[Math.floor(Math.random() * pool.length)];
    this.usedSequences.add(seq);
    this.currentSequence = seq;

    try {
      this.promptMessage = await this.channel.send({
        content: `<@${this.currentPlayerId}>`,
        embeds: [
          new EmbedBuilder()
            .setDescription(`say a word containing **${seq.toUpperCase()}**`)
            .setColor('#5865F2')
        ]
      });
    } catch (err) {
      logger.error('BLACKTEA', 'Failed to send turn prompt', err);
      await this.forceEnd('The Blacktea game ended because the prompt could not be sent.');
    }
  }

  async _startTurnTimer() {
    this.turnTimeout = setTimeout(() => this._handleTurnTimeout(), 10000);

    this.countdownTimeouts.push(
      setTimeout(() => this._addCountdownReaction('3️⃣'), 7000),
      setTimeout(() => this._addCountdownReaction('2️⃣'), 8000),
      setTimeout(() => this._addCountdownReaction('1️⃣'), 9000)
    );
  }

  async _addCountdownReaction(emoji) {
    if (this.ended || !this.promptMessage) return;
    await this.promptMessage.react(emoji).catch(() => {});
  }

  _clearTurnTimers() {
    if (this.turnTimeout) {
      clearTimeout(this.turnTimeout);
      this.turnTimeout = null;
    }
    for (const t of this.countdownTimeouts) clearTimeout(t);
    this.countdownTimeouts = [];
  }

  async handleGuess(message) {
    if (this.ended || !this.gameActive) return;
    if (message.author.id !== this.currentPlayerId) return;

    const guess = message.content.trim().toLowerCase();
    if (!guess || guess.length < 3) return;
    if (!/^[a-z]+$/.test(guess)) return;
    if (!dictionarySet.has(guess)) return;
    if (!guess.includes(this.currentSequence)) return;
    if (this.usedWords.has(guess)) return;

    this.usedWords.add(guess);
    incrementBlackteaStat(this.guildId, message.author.id, 'totalWords');
    await message.react('<:checkmark:1528890895859056680>').catch(() => {});
    await this._endTurn(true);
  }

  async _endTurn(success) {
    this._clearTurnTimers();
    if (success && !this.ended) {
      await this.nextTurn();
    }
  }

  async _handleTurnTimeout() {
    if (this.ended || !this.gameActive) return;
    this._clearTurnTimers();

    const player = this.players.get(this.currentPlayerId);
    if (!player) {
      await this.nextTurn();
      return;
    }

    player.lives--;

    if (player.lives === 1) {
      await this.channel.send(`<@${this.currentPlayerId}> lost a life! 1 life remaining.`).catch(() => {});
      await this.nextTurn();
    } else if (player.lives <= 0) {
      player.eliminated = true;
      await this.channel.send(`<@${this.currentPlayerId}> has been eliminated!`).catch(() => {});

      const alive = Array.from(this.players.values()).filter(p => !p.eliminated);
      if (alive.length === 1) {
        await this._declareWinner(alive[0]);
        return;
      }
      await this.nextTurn();
    } else {
      await this.nextTurn();
    }
  }

  async _declareWinner(winner) {
    if (this.ended) return;
    this.ended = true;
    this.gameActive = false;

    const s = incrementBlackteaStat(this.guildId, winner.user.id, 'wins');
    if (s.wins > (s.bestStreak || 0)) {
      s.bestStreak = s.wins;
      setBlackteaStats(this.guildId, winner.user.id, s);
    }

    const embed = new EmbedBuilder()
      .setTitle('Blacktea Winner <:blacktea:1535357849931092090>')
      .setDescription(`<@${winner.user.id}> is the last player standing!`)
      .setColor('#5865F2');

    await this.channel.send({ embeds: [embed] }).catch(() => {});
    this.cleanup();
  }

  async forceEnd(reason) {
    if (this.ended) return;
    this.ended = true;
    this.gameActive = false;
    this.lobbyActive = false;

    this._clearTurnTimers();
    if (this.lobbyCollector) {
      this.lobbyCollector.stop();
      this.lobbyCollector = null;
    }

    if (reason) {
      await this.channel.send(reason).catch(() => {});
    }
    this.cleanup();
  }

  cleanup() {
    this.ended = true;
    this.gameActive = false;
    this.lobbyActive = false;

    if (this.lobbyCollector) {
      this.lobbyCollector.stop();
      this.lobbyCollector = null;
    }
    this._clearTurnTimers();

    for (const [userId] of this.players) {
      lockedPlayers.delete(userId);
    }
    lockedPlayers.delete(this.hostId);

    activeGames.delete(this.channel.id);
  }
}

// ══════════════════════════════════════════════════════════
// COMMAND HANDLERS
// ══════════════════════════════════════════════════════════
async function handleBlackteaCommand(message, args, client) {
  const channelId = message.channel.id;
  const sub = args[0]?.toLowerCase();

  // ── Stats ──
  if (sub === 'stats') {
    const target = message.mentions.users.first() || message.author;
    const s = getBlackteaStats(message.guild.id, target.id);
    const embed = new EmbedBuilder()
      .setTitle(`<:blacktea:1535357849931092090> Blacktea — ${target.username}`)
      .setThumbnail(target.displayAvatarURL())
      .setColor('#5865F2')
      .setDescription(
        `-# WINS\n**${s.wins}**\n\n` +
        `-# GAMES PLAYED\n**${s.gamesPlayed}**\n\n` +
        `-# BEST STREAK\n**${s.bestStreak}**\n\n` +
        `-# TOTAL WORDS\n**${s.totalWords}**`
      );
    return message.reply({ embeds: [embed] });
  }

  // ── Leaderboard ──
  if (sub === 'leaderboard' || sub === 'lb') {
    const db = getGuildDb(message.guild.id);
    const stats = db.get('blackteaStats', {});
    const entries = Object.entries(stats)
      .filter(([, d]) => d.wins > 0)
      .sort((a, b) => b[1].wins - a[1].wins)
      .slice(0, 10);

    if (entries.length === 0) {
      return message.reply({ embeds: [mkInfo('Blacktea Leaderboard', 'No wins recorded yet.')] });
    }

    let desc = '';
    for (let i = 0; i < entries.length; i++) {
      const [uid, d] = entries[i];
      desc += `${i + 1}- <@${uid}> — **${d.wins}**\n`;
    }

    const embed = new EmbedBuilder()
      .setTitle('<:blacktea:1535357849931092090> Blacktea Leaderboard')
      .setDescription(desc)
      .setColor('#5865F2');
    return message.reply({ embeds: [embed] });
  }

  // ── Admin end ──
  if (sub === 'end') {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
      return message.reply({ embeds: [mkError('Permission Denied', 'You need the **Manage Messages** permission.')] });
    }
    const game = activeGames.get(channelId);
    if (!game) {
      return message.reply({ embeds: [mkError('No Active Game', 'There is no active Blacktea game.')] });
    }
    await game.forceEnd('The Blacktea game has been ended by a moderator.');
    return;
  }

  // ── Start new game ──
  if (activeGames.has(channelId)) {
    return message.reply({ embeds: [mkError('Game Already Active', 'There is already an active Blacktea game in this channel.')] });
  }

  if (lockedPlayers.has(message.author.id)) {
    return message.reply({ embeds: [mkError('Already in Game', 'You are already participating in a Blacktea game in another channel.')] });
  }

  const game = new GameSession(message.channel, message.author.id, message.author);
  activeGames.set(channelId, game);
  lockedPlayers.add(message.author.id);
  await game.startLobby();
}

async function handleBlackteaMessage(message) {
  const game = activeGames.get(message.channel.id);
  if (!game?.gameActive) return false;
  if (game.currentPlayerId !== message.author.id) return false;

  try {
    const db = getGuildDb(message.guild.id);
    const prefix = db.get('settings', {}).prefix || ',';
    if (message.content.startsWith(prefix)) return false;
  } catch {
    if (message.content.startsWith(',')) return false;
  }

  await game.handleGuess(message);
  return true;
}

async function handleBlackteaSlash(interaction, client) {
  await interaction.deferReply({ ephemeral: true });

  const channelId = interaction.channel.id;
  if (activeGames.has(channelId)) {
    return interaction.editReply({ content: 'There is already an active Blacktea game in this channel.' });
  }

  if (lockedPlayers.has(interaction.user.id)) {
    return interaction.editReply({ content: 'You are already participating in a Blacktea game in another channel.' });
  }

  const game = new GameSession(interaction.channel, interaction.user.id, interaction.user);
  activeGames.set(channelId, game);
  lockedPlayers.add(interaction.user.id);

  try {
    await game.startLobby();
    await interaction.editReply({ content: 'Blacktea lobby started! React with <:checkmark:1528890895859056680> to join.' });
  } catch (err) {
    logger.error('BLACKTEA', 'Slash lobby start error', err);
    activeGames.delete(channelId);
    lockedPlayers.delete(interaction.user.id);
    await interaction.editReply({ content: 'Failed to start the Blacktea game.' });
  }
}

module.exports = {
  initBlacktea,
  handleBlackteaCommand,
  handleBlackteaMessage,
  handleBlackteaSlash,
};