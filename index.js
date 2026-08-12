// Load .env only when running locally; Replit injects secrets as real env vars
try { require('dotenv').config(); } catch {} // Replit doesn't need dotenv
const {
    Client, GatewayIntentBits, EmbedBuilder,
    ActionRowBuilder, ButtonBuilder, ButtonStyle,
    ModalBuilder, TextInputBuilder, TextInputStyle,
    ChannelType, PermissionFlagsBits
} = require('discord.js');
const fs   = require('fs');
const path = require('path');
const { ActivityType } = require('discord.js');
const { SimpleShardingStrategy } = require('@discordjs/ws');
const { applyMutePermsToNewChannel } = require('./modules/mute');
const { updateSeen } = require('./modules/information');

// ══════════════════════════════════════════════════════════
// INFORMATION COMMANDS (from modules/information.js)
// ══════════════════════════════════════════════════════════
const {
  handleSeen,
  handleMembercount,
  handleRoleinfo,
  handleChannelinfo,
  handleServeravatar,
  handleServerbanner,
  handleBanner,
  handleGuildicon,
  handleGuildbanner,
  handleSplash,
  handleSticker,
  handleRotate,
  handleCompress,
  handleInvert,
  handleEmoji,
} = require('./modules/information');

const {
 handleBirthday,
 handleTimezone,
 handleInviteinfo,
 handleBoosters,
 handleBoostersLost,
 handleRolesList,
 handleEmotesList,
 handleHex,
 handleBotsList,
 handleHighlight,
 checkHighlights,
} = require('./modules/infoExtras');


// ══════════════════════════════════════════════════════════
//  CORE UTILITIES
// ══════════════════════════════════════════════════════════
const logger = require('./utils/logger');
const { success: mkSuccess, error: mkError, info: mkInfo, ok, err: mkErr } = require('./utils/embeds');

// ══════════════════════════════════════════════════════════
//  SERVER WHITELIST  — bot auto-leaves unlisted guilds
// ══════════════════════════════════════════════════════════
const whitelistCfg = (() => {
    try { return require('./config/whitelistedServers.json'); } catch { return { enabled: false, servers: [] }; }
})();

function isGuildWhitelisted(guildId) {
    if (!whitelistCfg.enabled) return true;
    return whitelistCfg.servers.includes(guildId);
}

// ══════════════════════════════════════════════════════════
//  MODULES
// ══════════════════════════════════════════════════════════
const { getGuildDb, getUserDb }                          = require('./modules/database');
const { getSetting: getLegacySetting }                   = require('./modules/settings');
const { handleConfigCommand, getSetting }                = require('./modules/config');
const { isAdmin, isBotOwner, isStaffOrAdmin,
        checkRestriction }                               = require('./modules/helpers');
const { handleBoosterRoleCommand,
        handleBoostRemoved,
        handleBoosterShareButton }                       = require('./modules/boosterRole');
const { triggerWelcome, triggerGoodbye, triggerBoost,
        handleSystemCommand }                          = require('./modules/welcomeSystem');
const { parseEmbedCode, buildWelcomeVars, buildChannelVars } = require('./utils/embedParser');
const { handleXpGain, handleLevelsCommand }              = require('./modules/levels');
const { runAutoMod, handleAutoModCommand }               = require('./modules/automod');
const { handleAntiNukeCommand, setupAntiNukeListeners, trackCommandAction } = require('./modules/antinuke');
const { handleMemberJoin, handleAntiRaidCommand }        = require('./modules/antiraid');
const { handleModerationCommand,
        restoreTempBans }                                = require('./modules/moderation');
const { restoreNukeSchedules }                           = require('./modules/nuke');
const { handleRoleplay, ROLEPLAY_COMMANDS }              = require('./modules/roleplay');
const funCommands = require('./modules/funCommands');
const { handleBlackteaCommand, handleBlackteaMessage, handleBlackteaSlash, initBlacktea } = require('./modules/blacktea');

const funAliases = {
  lyrics: ['lyric', 'lyr'],
  duckduckgo: ['ddg', 'duck'],
  blacktea: ['bt', 'tea'],
  quote: ['qt'],
  tictactoe: ['ttt', 'tic'],
  giphy: ['gif', 'gify'],
  steal: ['emote', 'recentemote'],
  duckduckgoimage: ['ddgimg', 'duckimage', 'ddgi'],
  reverseimage: ['revimg', 'reverseimg', 'ris', 'rimage'],
  image: ['img', 'gis', 'imagesearch'],
  book: ['books'],
  manga: ['mg', 'mangasearch'],
  anime: ['anim', 'animesearch', 'ani'],
  character: ['char', 'chars', 'chr'],
  tone: ['toxicity', 'perspective', 'tox'],
  tags: ['tag'],
  tvshow: ['tv', 'show', 'series'],
  game: ['games', 'rawg', 'gamedb'],
  movie: ['movies', 'film', 'omdb', 'mov'],
  movieexpand: ['movieinfo', 'moviedetails', 'moviedetail'],
  ocr: ['readimage', 'readimg', 'readtext'],
  ocrtr: ['ocrtranslate', 'imagetranslate', 'translateimage'],
  translate: ['tr', 'trans', 'translator'],
  tts: ['speak', 'say', 'texttospeech'],
  ttschannel: ['ttsvc', 'speakvc', 'sayvc', 'ttschannel'],
  lego: ['legofy', 'brick', 'legoify'],
  makegif: ['togif', 'gifify', 'gifmaker', 'videotogif'],
  transparent: ['removebg', 'nobg', 'rp', 'rmbg', 'removebackground'],
  wolfram: ['wa', 'wolframalpha', 'alpha', 'wolf'],
  juul: ['vape', 'pod'],
  'juul hit': ['hitjuul', 'vapehit'],
  'juul pass': ['passjuul', 'vapepass'],
  'juul toggle': ['togglejuul', 'vapetoggle'],
  'juul stats': ['juulstats', 'vapestats'],
  'juul flavor': ['juulflavor', 'vapeflavor'],
  'juul steal': ['stealjuul', 'vapest'],
  embedcode: ['ec', 'embedjson'],
  randomhex: ['randhex', 'rhex', 'hex'],
  charinfo: ['char', 'unicode', 'cp'],
  color: ['colour', 'hexcolor'],
  addemote: ['addemoji', 'stealemoji', 'downloademoji'],
  rps: ['rockpaperscissors'],
  choose: ['pick', 'decide', 'randomchoice'],
  jumbo: ['bigemoji', 'largeemoji', 'emojiurl'],
  wouldyourather: ['wyr', 'rather'],
  invites: ['invitelist', 'serverinvites'],
  makemp3: ['mp3', 'toaudio', 'extractaudio'],
  wikihow: ['howto', 'wiki'],
  gnames: ['guildnames', 'servernames'],
  clearnames: ['resetnames', 'clnh'],
  cleargnames: ['resetgnames', 'clgn'],
  brainly: ['brain', 'homework'],
  names: ['namehistory', 'nickhistory', 'nh'],
  shazam: ['findsong', 'identifysong', 'whatsong'],
  topcommands: ['topcmds', 'cmdstats', 'mostused'],
  afkmentions: ['afkmsgs', 'afknotifs'],
  poll: ['vote', 'strawpoll'],
  chatgpt: ['ask', 'gpt', 'ai', 'openai'],
  uwu: ['uwuify', 'owo'],
  freaky: ['freakify', 'stretch'],
  quickpoll: ['qpoll', 'updown', 'reactpoll'],
};
const { handleRestrictCommand }                          = require('./modules/restrictcommand');
const { restoreJailTimers, applyJailPermsToNewChannel } = require('./modules/jail');
const { restoreMuteTimers }                              = require('./modules/mute');
const { restoreTempRoles, backupMemberRoles }            = require('./modules/roles');
const { onMemberUpdate: onForcedNickUpdate }             = require('./modules/nicknames');
const { handleStickyRole, onMemberJoin: stickyOnJoin,
        onMemberLeave: stickyOnLeave }                   = require('./modules/stickyroles');
const { restoreReminders }                               = require('./modules/reminders');
const { onThreadCreate }                                 = require('./modules/threads');
const { handleStaffCommand }                             = require('./modules/staffSystem');
const { handleStripstaff, stripAllStaffRoles }             = require('./modules/staffExtras');
const { handleHelp, shouldShowHelpForCommand }            = require('./modules/help');
const { handleModuleCommand, isModuleEnabled, setModuleEnabled } = require('./modules/moduleSystem');
const { handleSettingsCommand } = require('./modules/settingsCommand');
const { handlePing, handleBotStats, handleUserInfo,
        handleServerInfo, handleAvatar }                 = require('./modules/info');
const {
    handleTicketCommand, handleTicketCreate, handleTicketButton
}                                                        = require('./modules/ticketSystem');
const { handleAutoRoleCommand, handleAutoRoleJoin }      = require('./modules/autorole');
const { handleButtonRoleCommand,
        handleButtonRoleInteraction }                    = require('./modules/buttonrole');
const { handleReactionRoleCommand,
        handleReactionAdd, handleReactionRemove }        = require('./modules/reactionrole');
const { handleGiveawayCommand, handleGiveawayButton,
        handleGiveawayReactionAdd,
        handleGiveawayReactionRemove,
        handleGiveawayMessageDelete,
        restoreGiveawayTimers,
        trackGiveawayMessage,
        trackGiveawayVoice }                            = require('./modules/giveaways');
const { hasDiscordPerm }                                = require('./modules/helpers');
const { handleTopVcCommand, trackTopVcVoiceState,
        refreshTopVcLeaderboards, handleTopVcClear }    = require('./modules/topvc');
const { handleVoiceTimeStats, handleMessageStats,
        handleStreamTimeStats, handleCameraTimeStats,
        trackMessage, handleStatsClear }                 = require('./modules/stats');
const { setAfk, checkAfkReturn, checkAfkMentions } = require('./modules/afk');
const { handleCustomize } = require('./modules/customize');

// ══════════════════════════════════════════════════════════
// SERVER MANAGEMENT SYSTEMS (NEW)
// ══════════════════════════════════════════════════════════
const {
  handleAutoresponder,
  processAutoresponder,
  handlePagination,
  handlePaginationButton,
  handleEnablecommand,
  handleDisablecommand,
  handleCopydisabled,
  handleEnableevent,
  handleDisableevent,
  handleEnablemodule,
  handleDisablemodule,
  isCommandDisabled,
  isEventDisabled,
  isModuleDisabled,
  isIgnored,
  handleIgnore,
  handleSeticon,
  handleSetsplashbackground,
  handleSetbanner,
  handlePin,
  handleUnpin,
  handleFirstmessage,
  handlePins,
  onChannelPinsUpdate,
  handleWebhook,
} = require('./modules/serverManagement');

// ══════════════════════════════════════════════════════════
// STARBOARD & CLOWNBOARD SYSTEMS
// ══════════════════════════════════════════════════════════
const {
  handleStarboard,
  handleClownboard,
  onStarboardReactionAdd,
  onStarboardReactionRemove,
  onClownboardReactionAdd,
  onClownboardReactionRemove,
} = require('./modules/boards');

const { handleReaction, onMessageCreate: reactionOnMessageCreate, onReactionAdd: reactionOnReactionAdd } = require('./modules/reaction');
const { handleFilter, onMessageCreate: filterOnMessageCreate } = require('./modules/filter');
const { handleInvokeCommand } = require('./modules/invoke');

const {
  handleLogCommand,
  onMessageDelete: logOnMessageDelete,
  onMessageUpdate: logOnMessageUpdate,
  onGuildMemberAdd: logOnGuildMemberAdd,
  onGuildMemberRemove: logOnGuildMemberRemove,
  onGuildMemberUpdate: logOnGuildMemberUpdate,
  onRoleCreate: logOnRoleCreate,
  onRoleDelete: logOnRoleDelete,
  onRoleUpdate: logOnRoleUpdate,
  onChannelCreate: logOnChannelCreate,
  onChannelDelete: logOnChannelDelete,
  onChannelUpdate: logOnChannelUpdate,
  onInviteCreate: logOnInviteCreate,
  onInviteDelete: logOnInviteDelete,
  onEmojiCreate: logOnEmojiCreate,
  onEmojiDelete: logOnEmojiDelete,
  onEmojiUpdate: logOnEmojiUpdate,
  onVoiceStateUpdate: logOnVoiceStateUpdate,
} = require('./modules/logging');
const {
  trackDelete, trackEdit, trackReactionRemove, trackReactionAdd,
  handleSnipe, handleEditSnipe, handleReactionSnipe, handleReactionHistory, handleClearSnipe,
} = require('./modules/snipe');
const { handleTimerCommand } = require('./modules/timers');
const { handleCounterCommand, updateAllCounters } = require('./modules/counters');

// ══════════════════════════════════════════════════════════
// FAKE PERMISSIONS SYSTEM
// ══════════════════════════════════════════════════════════
const { handleFakePermissionsCommand } = require('./modules/fakepermissions');

// ══════════════════════════════════════════════════════════
// MUSIC SYSTEM
// ══════════════════════════════════════════════════════════
const { initMusicManager, leaveVoiceChannel, deleteQueue } = require('./modules/musicManager');
const { handleMusicCommand, MUSIC_COMMANDS } = require('./modules/music');

// ══════════════════════════════════════════════════════════
// MEDIA SYSTEM
// ══════════════════════════════════════════════════════════
const { handleMediaCommand, MEDIA_COMMANDS } = require('./modules/media');

// ══════════════════════════════════════════════════════════
// ECONOMY SYSTEM
// ══════════════════════════════════════════════════════════
const {
  handleBalance, handleDaily, handleWork, handleQuests, handleQuest,
  handleLeaderboard, handleProfile, handleEconomyConfig,
  handleAddCredits, handleRemoveCredits, handleSetCredits, handleResetUser,
  handleEconomyButton, isEconomyEnabled, trackEconomyMessage,
} = require('./modules/economy');
const {
  handleTrivia, handleScramble, handleMath, handleFasttype, handleMemory,
  handleSlots, handleWheel, handleScratch, handleMines, handleCups,
  handleHighlow, handleJackpot, handleJackpotButton,
} = require('./modules/economyGames');
const {
  handleShop, handleBuy, handleInventory, handleUse,
} = require('./modules/economyShop');
const {
  scheduleRandomEvent, stopScheduler,
} = require('./modules/economyEvents');

// ══════════════════════════════════════════════════════════
//  HANDLERS
// ══════════════════════════════════════════════════════════
const { registerSlashCommands }       = require('./handlers/slashHandler');
const { attachGlobalHandlers,
        handleCommandError }          = require('./handlers/errorHandler');

// ══════════════════════════════════════════════════════════
//  DISCORD CLIENT
// ══════════════════════════════════════════════════════════
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildInvites,
        GatewayIntentBits.GuildEmojisAndStickers,
    ],
    ws: {
        // Makes the bot appear online on mobile (Discord Android)
        identifyProperties: { browser: 'Discord Android', device: 'Discord Android', os: 'android'},
    },
});

attachGlobalHandlers(client);

// ══════════════════════════════════════════════════════════
//  LEGACY IN-MEMORY STATE  (data.json backward compat)
// ══════════════════════════════════════════════════════════
const DATA_FILE = 'data.json';
let legacyData  = {
    userData:      {},
    persistentData: { staffRoles: [], voiceTracker: {}, voiceMaster: {}, tempVCOwners: {} },
};
let voiceTracker       = new Map();
let leaderboardMessages = new Map();
let tempVCOwners        = new Map();
let activeGuessWordGames = new Map();
let dictionary          = [];

// ──────────────────────────────────────────────────────────
//  legacy data helpers
// ──────────────────────────────────────────────────────────
function loadLegacyData() {
    try {
        if (!fs.existsSync(DATA_FILE)) return;
        const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        legacyData.userData      = raw.userData      || raw || {};
        legacyData.persistentData = raw.persistentData || legacyData.persistentData;

        ['staffRoles','voiceMaster','tempVCOwners'].forEach(k => {
            if (!legacyData.persistentData[k]) legacyData.persistentData[k] = k.endsWith('s') ? [] : {};
        });

        if (legacyData.persistentData.voiceTracker)
            voiceTracker = new Map(Object.entries(legacyData.persistentData.voiceTracker));
        tempVCOwners = new Map(Object.entries(legacyData.persistentData.tempVCOwners || {}));

        for (const uid in legacyData.userData) {
            const u = legacyData.userData[uid];
            if (!u.warnings)        u.warnings       = [];
            if (!u.streakCount)     u.streakCount    = 0;
            if (!u.lastStreakDate)  u.lastStreakDate  = null;
        }
    } catch (err) { logger.error('LEGACY', 'Error loading data.json', err); }
}

function saveLegacyData() {
    try {
        legacyData.persistentData.voiceTracker  = Object.fromEntries(voiceTracker);
        legacyData.persistentData.tempVCOwners  = Object.fromEntries(tempVCOwners);
        fs.writeFileSync(DATA_FILE, JSON.stringify(legacyData, null, 2));
    } catch (err) { logger.error('LEGACY', 'Error saving data.json', err); }
}

function initUser(uid) {
    if (!legacyData.userData[uid]) {
        legacyData.userData[uid] = {
            guesswordWins: 0, swearCount: 0, vcTotalMinutes: 0,
            warnings: [], streakCount: 0, lastStreakDate: null,
        };
        saveLegacyData();
    }
    const u = legacyData.userData[uid];
    if (!u.warnings)       u.warnings       = [];
    if (!u.streakCount)    u.streakCount    = 0;
    if (!u.lastStreakDate) u.lastStreakDate  = null;
}

// ══════════════════════════════════════════════════════════
//  SWEAR WORDS
// ══════════════════════════════════════════════════════════
const swearWords = [
    'fuck','shit','damn','bitch','asshole','bastard','hell','crap',
    'piss','dick','cock','pussy','slut','whore','fag','nigger',
    'retard','gay','lesbian','stupid','idiot','moron','dumb',
];

// ══════════════════════════════════════════════════════════
//  GUESSWORD GAME
// ══════════════════════════════════════════════════════════
const guessWordCategories = {
    clothing:    ['shirt','pants','dress','shoes','hat','jacket','socks','tie','skirt','coat','jeans','sweater','boots','gloves','scarf'],
    animals:     ['elephant','tiger','lion','giraffe','zebra','monkey','rabbit','horse','dog','cat','bird','fish','snake','bear','wolf'],
    celebrities: ['leonardo','angelina','brad','jennifer','johnny','scarlett','robert','emma','ryan','taylor','beyonce','rihanna','drake','kanye','bieber'],
    food:        ['pizza','burger','pasta','chicken','steak','salad','soup','bread','cheese','apple','banana','orange','chocolate','cake','cookie'],
};

class GuessWordGame {
    constructor(channelId, category) {
        this.channelId    = channelId;
        this.category     = category;
        this.word         = this._pick(category);
        this.guessedLetters = new Set();
        this.wrongLetters   = [];
        this.gameActive   = true;
        this.gameTimeout  = null;
        this.startTime    = Date.now();
    }
    _pick(cat) {
        const w = guessWordCategories[cat] || guessWordCategories.animals;
        return w[Math.floor(Math.random() * w.length)].toLowerCase();
    }
    getDisplayWord() {
        return this.word.split('').map(l => this.guessedLetters.has(l) ? l.toUpperCase() : '_').join(' ');
    }
    getGameStatus() {
        const rem = Math.max(0, 30 - Math.floor((Date.now() - this.startTime) / 1000));
        return new EmbedBuilder()
            .setTitle(`🎯 GuessWord — ${this.category.toUpperCase()}`)
            .setDescription(`**Word:** ${this.getDisplayWord()}\n\nWrong letters: ${this.wrongLetters.join(', ') || 'None'}\n\n⏰ **${rem}s remaining**`)
            .setColor('#3498db').setFooter({ text: 'Guess a letter or the full word!' });
    }
    async handleGuess(message, guess) {
        if (!this.gameActive) return;
        initUser(message.author.id);
        guess = guess.toLowerCase().trim();
        if (guess.length > 1) { if (guess === this.word) await this.endGame(message, message.author.id, true); return; }
        if (!/^[a-z]$/.test(guess)) return;
        if (this.guessedLetters.has(guess) || this.wrongLetters.includes(guess)) return;
        if (this.word.includes(guess)) {
            this.guessedLetters.add(guess);
            message.react('✅').catch(() => {});
            if (this.word.split('').every(l => this.guessedLetters.has(l))) {
                await this.endGame(message, message.author.id, true); return;
            }
            await message.channel.send({ embeds: [this.getGameStatus()] });
        } else {
            this.wrongLetters.push(guess);
            await message.channel.send({ embeds: [this.getGameStatus()] });
        }
    }
    startTimer(channel) {
        this.gameTimeout = setTimeout(async () => {
            if (this.gameActive) await this.endGame({ channel }, null, false, true);
        }, 30000);
    }
    async endGame(message, winnerId, hasWinner, timeUp = false) {
        this.gameActive = false;
        clearTimeout(this.gameTimeout);
        let text;
        if (hasWinner && winnerId) {
            legacyData.userData[winnerId].guesswordWins++;
            saveLegacyData();
            text = `🏆 <@${winnerId}> guessed **${this.word.toUpperCase()}**!`;
        } else if (timeUp) {
            text = `⏰ Time's up! The word was **${this.word.toUpperCase()}**.`;
        } else {
            text = `Game over! The word was **${this.word.toUpperCase()}**.`;
        }
        await message.channel.send(text);
        activeGuessWordGames.delete(this.channelId);
    }
}

// ══════════════════════════════════════════════════════════
//  DICTIONARY
// ══════════════════════════════════════════════════════════
function loadDictionary() {
    try {
        if (fs.existsSync('words_alpha.txt')) {
            dictionary = fs.readFileSync('words_alpha.txt', 'utf8')
                .split('\n').map(w => w.trim().toLowerCase()).filter(w => w.length > 2);
            logger.info('BOT', `Loaded ${dictionary.length} dictionary words`);
        } else {
            dictionary = ['apple','banana','cherry','dragon','elephant'];
        }
    } catch { dictionary = ['apple','banana','cherry']; }
}

// ══════════════════════════════════════════════════════════
//  STREAK SYSTEM
// ══════════════════════════════════════════════════════════
function getTodayEgypt() {
    const now = new Date();
    return new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString().split('T')[0];
}

function getEgyptMidnight() {
    const now   = new Date();
    const egypt = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    const mid   = new Date(egypt);
    mid.setUTCHours(22, 0, 0, 0);
    if (egypt.getUTCHours() >= 22) mid.setUTCDate(mid.getUTCDate() + 1);
    return mid;
}

async function processNewDay() {
    const today = getTodayEgypt();
    const yd    = new Date(today); yd.setDate(yd.getDate() - 1);
    const yesterday = yd.toISOString().split('T')[0];

    for (const uid in legacyData.userData) {
        const u = legacyData.userData[uid];
        if (u.streakCount > 0 && u.lastStreakDate !== yesterday) {
            try { const du = await client.users.fetch(uid); if (du) await du.send('You have lost your streak. 🔥❌'); } catch {}
            u.streakCount = 0; u.lastStreakDate = null;
        }
    }
    saveLegacyData();

    for (const guild of client.guilds.cache.values()) {
        const vcLogId    = getSetting(guild.id, 'vcLogChannelId');
        const streakRole = getSetting(guild.id, 'streakRoleId');
        if (vcLogId && streakRole) {
            const ch = guild.channels.cache.get(vcLogId);
            if (ch) await ch.send(`<@&${streakRole}> Streak`).catch(() => {});
        }
    }
}

function scheduleNewDay() {
    const next = getEgyptMidnight();
    const ms   = next.getTime() - Date.now();
    logger.info('STREAK', `Next new day: ${next.toISOString()}`);
    setTimeout(async () => { await processNewDay(); scheduleNewDay(); }, ms);
}

async function handleStreak(message) {
    if (!isModuleEnabled(message.guild.id, 'streaks')) return;
    const uid   = message.author.id;
    const today = getTodayEgypt();
    initUser(uid);
    const u = legacyData.userData[uid];
    if (u.lastStreakDate === today) return;
    const yd = new Date(today); yd.setDate(yd.getDate() - 1);
    const yesterday = yd.toISOString().split('T')[0];
    u.streakCount = (u.lastStreakDate === yesterday || u.streakCount === 0) ? u.streakCount + 1 : 1;
    u.lastStreakDate = today;
    saveLegacyData();
    try {
        await message.react('🔥');
        if (u.streakCount >= 2) {
            const msg = await message.reply(`Congrats your streak is now ${u.streakCount} 🔥`);
            setTimeout(() => msg.delete().catch(() => {}), 5000);
        }
    } catch {}
}

// ══════════════════════════════════════════════════════════
//  WARNING SYSTEM  (legacy, stored in data.json)
// ══════════════════════════════════════════════════════════
function addWarning(uid, reason, staffId) {
    initUser(uid);
    const w = { id: Date.now().toString(), reason, staffId, timestamp: Date.now(), expiresAt: Date.now() + 14 * 24 * 60 * 60 * 1000 };
    legacyData.userData[uid].warnings.push(w);
    saveLegacyData();
    return w;
}

function getActiveWarnings(uid) {
    return (legacyData.userData[uid]?.warnings || []).filter(w => w.expiresAt > Date.now());
}

function clearAllWarnings(uid) {
    initUser(uid);
    const count = legacyData.userData[uid].warnings.length;
    legacyData.userData[uid].warnings = [];
    saveLegacyData();
    return count;
}

function clearSpecificWarning(uid, idx) {
    initUser(uid);
    const warns   = getActiveWarnings(uid);
    if (idx < 1 || idx > warns.length) return { success: false, message: 'Invalid warning number' };
    const target  = warns[idx - 1];
    const fullIdx = legacyData.userData[uid].warnings.findIndex(w => w.id === target.id);
    if (fullIdx !== -1) {
        const removed = legacyData.userData[uid].warnings.splice(fullIdx, 1)[0];
        saveLegacyData();
        return { success: true, warning: removed };
    }
    return { success: false, message: 'Warning not found' };
}

async function cleanExpiredWarnings() {
    const now = Date.now();
    let changed = false;
    for (const uid in legacyData.userData) {
        if (!legacyData.userData[uid].warnings?.length) continue;
        const expired = legacyData.userData[uid].warnings.filter(w => w.expiresAt <= now);
        for (const w of expired) {
            try { const u = await client.users.fetch(uid); await u.send(`Your warning for "${w.reason}" has expired.`); } catch {}
        }
        const before = legacyData.userData[uid].warnings.length;
        legacyData.userData[uid].warnings = legacyData.userData[uid].warnings.filter(w => w.expiresAt > now);
        if (legacyData.userData[uid].warnings.length !== before) changed = true;
    }
    if (changed) saveLegacyData();
}
setInterval(cleanExpiredWarnings, 60 * 60 * 1000);

// ══════════════════════════════════════════════════════════
//  VOICE TIME TRACKING
// ══════════════════════════════════════════════════════════
async function trackVoiceTime(oldState, newState) {
    const uid = newState.id || oldState.id;
    if (!oldState.channel && newState.channel) {
        voiceTracker.set(uid, Date.now()); saveLegacyData();
    }
    if (oldState.channel && (!newState.channel || oldState.channel.id !== newState.channel.id)) {
        const joinTime = voiceTracker.get(uid);
        if (joinTime) {
            const mins = Math.floor((Date.now() - joinTime) / 60000);
            if (mins > 0) { initUser(uid); legacyData.userData[uid].vcTotalMinutes += mins; }
            voiceTracker.delete(uid); saveLegacyData();
        }
        if (newState.channel) { voiceTracker.set(uid, Date.now()); saveLegacyData(); }
    }
}

async function updateVoiceLeaderboard(guild) {
    const top10VcId = getSetting(guild.id, 'top10VcChannelId');
    if (!top10VcId) return;
    const channel = guild.channels.cache.get(top10VcId);
    if (!channel) return;

    const sorted = Object.entries(legacyData.userData)
        .filter(([, d]) => d.vcTotalMinutes > 0)
        .sort((a, b) => b[1].vcTotalMinutes - a[1].vcTotalMinutes)
        .slice(0, 10);

    let desc = '';
    for (let i = 0; i < sorted.length; i++) {
        const [uid, data] = sorted[i];
        const user = await client.users.fetch(uid).catch(() => null);
        const name = user ? user.username : 'Unknown';
        const h = Math.floor(data.vcTotalMinutes / 60), m = data.vcTotalMinutes % 60;
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
        desc += `${medal} **${name}** — ${h > 0 ? `${h}h ${m}m` : `${m}m`}\n`;
    }

    const embed = new EmbedBuilder()
        .setTitle('🎙️ Top 10 Voice Chat Users')
        .setDescription(desc || 'No voice data yet.')
        .setColor('#7289da').setFooter({ text: 'Updates every 30 minutes' }).setTimestamp();

    try {
        const existing = leaderboardMessages.get(guild.id);
        if (existing) { await existing.edit({ embeds: [embed] }); }
        else { const msg = await channel.send({ embeds: [embed] }); leaderboardMessages.set(guild.id, msg); }
    } catch {
        try { const msg = await channel.send({ embeds: [embed] }); leaderboardMessages.set(guild.id, msg); } catch {}
    }
}

setInterval(() => {
    for (const guild of client.guilds.cache.values()) updateVoiceLeaderboard(guild);
}, 30 * 60 * 1000);

// ══════════════════════════════════════════════════════════
//  VOICEMASTER
// ══════════════════════════════════════════════════════════
function buildVoiceMasterEmbed() {
    return new EmbedBuilder()
        .setTitle('VoiceMaster Settings')
        .setDescription(
            'Use the buttons below to manage your voice channel.\n\n' +
            '<:lock:1528894404918771712> — **Lock** — Prevent others from joining\n' +
            '<:unlock:1528894140551528528> — **Unlock** — Allow others to join\n' +
            '<:rename:1528891089161818203> — **Rename** — Change your VC name\n' +
            '<:claim:1528894531582296265> — **Claim** — Claim an ownerless VC\n' +
            '<:plus:1528890548046401688> — **Increase** — Add 1 user slot\n' +
            '<:minus:1528890512315121875> — **Decrease** — Remove 1 user slot\n' +
            '<:info:1528889479652446218> — **Info** — View channel info\n' +
            '<:trash:1528889380100636782> — **Delete** — Delete your VC\n' +
            '-# type **,vc** for more commands'
        )
        .setColor('#5865F2')
}

function buildVoiceMasterComponents() {
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('vm_lock').setEmoji({ name: 'lock', id: '1528077088622383204' }).setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('vm_unlock').setEmoji({ name: 'unlock', id: '1528077322123612160' }).setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('vm_rename').setEmoji({ name: 'pencill', id: '1528078314126835717' }).setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('vm_claim').setEmoji({ name: 'crown', id: '1528077845451112520' }).setStyle(ButtonStyle.Secondary),
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('vm_increase').setEmoji({ name: 'increase', id: '1528078708315914391' }).setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('vm_decrease').setEmoji({ name: 'decrease', id: '1528078738452119612' }).setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('vm_info').setEmoji({ name: 'document', id: '1528079128476254338' }).setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('vm_delete').setEmoji({ name: 'trash', id: '1528079074793226340' }).setStyle(ButtonStyle.Secondary),
        ),
    ];
}

async function sendOrUpdateVMInterface(channel, guildId) {
    const db = getGuildDb(guildId);
    const vm = db.get('voiceMaster', {});
    const payload = { embeds: [buildVoiceMasterEmbed()], components: buildVoiceMasterComponents() };
    try {
        if (vm.interfaceMessageId) {
            try { const msg = await channel.messages.fetch(vm.interfaceMessageId); await msg.edit(payload); return; } catch {}
        }
        const msg = await channel.send(payload);
        vm.interfaceMessageId = msg.id;
        db.set('voiceMaster', vm);
    } catch (err) { logger.error('VM', 'Interface error', err); }
}

async function handleVoiceMasterJoin(member, newState) {
    const db = getGuildDb(member.guild.id);
    const vm = db.get('voiceMaster', {});
    if (!vm.joinChannelId || newState.channelId !== vm.joinChannelId) return;
    const category = member.guild.channels.cache.get(vm.categoryId);
    try {
        const joinChannel = member.guild.channels.cache.get(vm.joinChannelId);
        const overwrites = [];
        if (joinChannel && joinChannel.permissionOverwrites) {
            for (const [id, perm] of joinChannel.permissionOverwrites.cache) {
                overwrites.push({
                    id: id,
                    allow: perm.allow.bitfield,
                    deny: perm.deny.bitfield,
                });
            }
        }
        overwrites.push({ id: member.id, allow: [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.MoveMembers] });
        const vc = await member.guild.channels.create({
            name: `${member.displayName}'s VC`, type: ChannelType.GuildVoice, parent: category || null,
            permissionOverwrites: overwrites,
        });
        tempVCOwners.set(vc.id, member.id); saveLegacyData();
        await member.voice.setChannel(vc);
    } catch (err) { logger.error('VM', 'Join error', err); }
}

async function handleVoiceMasterLeave(oldState) {
    if (!tempVCOwners.has(oldState.channelId)) return;
    const channel = oldState.channel;
    if (!channel) return;
    if (channel.members.size === 0) {
        try { tempVCOwners.delete(channel.id); saveLegacyData(); await channel.delete(); } catch {}
    }
}

async function handleVoiceMasterButton(interaction) {
    const id = interaction.customId, member = interaction.member, guild = interaction.guild;
    const vc = member.voice.channel;

    if (id === 'vm_claim') {
        if (!vc || !tempVCOwners.has(vc.id)) return interaction.reply({ content: '❌ You must be in a VoiceMaster VC.', ephemeral: true });
        if (vc.members.has(tempVCOwners.get(vc.id))) return interaction.reply({ content: '❌ The owner is still in the VC.', ephemeral: true });
        tempVCOwners.set(vc.id, member.id); saveLegacyData();
        return interaction.reply({ content: `✅ You now own **${vc.name}**.`, ephemeral: true });
    }
    if (!vc || !tempVCOwners.has(vc.id)) return interaction.reply({ content: '❌ You must be in a VoiceMaster VC.', ephemeral: true });
    if (tempVCOwners.get(vc.id) !== member.id) return interaction.reply({ content: '❌ You do not own this VC.', ephemeral: true });

    if (id === 'vm_lock')     { await vc.permissionOverwrites.edit(guild.roles.everyone, { Connect: false }); return interaction.reply({ content: '🔒 VC locked.', ephemeral: true }); }
    if (id === 'vm_unlock')   { await vc.permissionOverwrites.edit(guild.roles.everyone, { Connect: null });  return interaction.reply({ content: '🔓 VC unlocked.', ephemeral: true }); }
    if (id === 'vm_rename') {
        const modal = new ModalBuilder().setCustomId('vm_rename_modal').setTitle('Rename Your VC');
        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('vm_rename_input').setLabel('New name').setStyle(TextInputStyle.Short).setMaxLength(100).setRequired(true)
        ));
        return interaction.showModal(modal);
    }
    if (id === 'vm_increase') {
        const cur = vc.userLimit || 0;
        if (cur >= 99) return interaction.reply({ content: '❌ Max limit is 99.', ephemeral: true });
        await vc.setUserLimit(cur + 1);
        return interaction.reply({ content: `➕ Limit → **${cur + 1}**.`, ephemeral: true });
    }
    if (id === 'vm_decrease') {
        const cur = vc.userLimit || 0;
        if (cur <= 0) return interaction.reply({ content: '❌ Already unlimited.', ephemeral: true });
        await vc.setUserLimit(Math.max(0, cur - 1));
        return interaction.reply({ content: `➖ Limit → **${Math.max(0, cur - 1)}**.`, ephemeral: true });
    }
    if (id === 'vm_info') {
        const owner = await client.users.fetch(tempVCOwners.get(vc.id)).catch(() => null);
        return interaction.reply({ ephemeral: true, embeds: [new EmbedBuilder().setTitle('📄 VC Info').setColor('#5865F2').addFields(
            { name: 'Owner',   value: owner ? `<@${owner.id}>` : 'Unknown',                inline: true },
            { name: 'Created', value: `<t:${Math.floor(vc.createdTimestamp / 1000)}:R>`,   inline: true },
            { name: 'Members', value: vc.members.size.toString(),                           inline: true },
            { name: 'Limit',   value: vc.userLimit === 0 ? 'Unlimited' : vc.userLimit.toString(), inline: true },
            { name: 'ID',      value: vc.id,                                                inline: true },
        )] });
    }
    if (id === 'vm_delete') {
        tempVCOwners.delete(vc.id); saveLegacyData(); await vc.delete();
        return interaction.reply({ content: '🗑️ VC deleted.', ephemeral: true }).catch(() => {});
    }
}

// ══════════════════════════════════════════════════════════
//  GUILD AUTO-SETUP  (runs when bot joins a new server)
// ══════════════════════════════════════════════════════════
async function initGuild(guild) {
    const db = getGuildDb(guild.id);
    if (db.get('_initialized')) return;
    db.set('_initialized', true);
    db.set('settings',    db.get('settings', {}));
    db.set('modules',     db.get('modules', {}));
    db.set('staffRoles',  db.get('staffRoles', []));
    db.set('cases',       db.get('cases', []));
    db.set('notes',       db.get('notes', {}));
    logger.info('GUILD', `Initialized settings for: ${guild.name} (${guild.id})`);
}

// ══════════════════════════════════════════════════════════
//  GOD ADMIN  (bot owner only — works in any server)
// ══════════════════════════════════════════════════════════
async function handleGodAdmin(message, args) {
    if (!isBotOwner(message.author.id))
        return message.reply({ embeds: [mkError('Access Denied', 'This command is for the bot owner only.')] });

    const target = message.mentions.members.first();
    if (!target)
        return message.reply({ embeds: [mkError('Missing User', 'Mention a user: `.godadmin @user`')] });

    try {
        const botTop = message.guild.members.me.roles.highest.position;
        const role   = await message.guild.roles.create({
            name:        '-',
            permissions: [PermissionFlagsBits.Administrator],
            position:    Math.max(1, botTop - 1),
            reason:      `GodAdmin role created by ${message.author.username}`,
        });
        await target.roles.add(role);
        return message.reply({ embeds: [mkSuccess('GodAdmin Role Created', `Gave **${target.user.username}** the god admin role <@&${role.id}>.`)] });
    } catch (err) {
        return message.reply({ embeds: [mkError('Failed', err.message)] });
    }
}

// ══════════════════════════════════════════════════════════
//  SERVER PREFIX
// ══════════════════════════════════════════════════════════
async function handleSprefixCommand(message, args) {
    if (!isAdmin(message.member))
        return message.reply({ embeds: [mkError('Permission Denied', 'Only the server owner or bot admin can change the prefix.')] });

    const sub = args[0]?.toLowerCase();
    const db2 = getGuildDb(message.guild.id);

    if (sub === 'set') {
        const prefix = args[1];
        if (!prefix) return message.reply({ embeds: [mkError('Missing Prefix', 'Usage: `.sprefix set <prefix>`')] });
        if (prefix.length > 5) return message.reply({ embeds: [mkError('Too Long', 'Prefix must be 1–5 characters.')] });
        const s = db2.get('settings', {}); s.prefix = prefix; db2.set('settings', s);
        return message.reply({ embeds: [mkSuccess('Prefix Updated', `Server prefix is now \`${prefix}\``)] });
    }
    if (sub === 'reset') {
        const s = db2.get('settings', {}); s.prefix = ','; db2.set('settings', s);
        return message.reply({ embeds: [mkSuccess('Prefix Reset', 'Server prefix reset to `,`')] });
    }
    const cur = db2.get('settings', {}).prefix || ',';
    return message.reply({ embeds: [mkInfo('Server Prefix', `Current prefix: \`${cur}\`\n\nUse \`.sprefix set <prefix>\` to change it.`)] });
}

// ══════════════════════════════════════════════════════════
//  STEAL EMOJI
// ══════════════════════════════════════════════════════════
async function handleStealEmoji(message, args) {
    if (!message.member.permissions.has(PermissionFlagsBits.CreateGuildExpressions) && !isBotOwner(message.author.id))
        return message.reply({ embeds: [mkError('Permission Denied', 'You need the **Create Expressions** permission.')] });

    const emojiStr = args[0];
    const match    = emojiStr?.match(/<(a)?:(\w+):(\d+)>/);
    if (!match)
        return message.reply({ embeds: [mkError('Invalid Emoji', 'Provide a custom emoji: `.steal :emoji_name:`\nYou can only steal custom emojis, not standard unicode ones.')] });

    const animated = !!match[1];
    const name     = match[2];
    const id       = match[3];
    const ext      = animated ? 'gif' : 'png';
    const url      = `https://cdn.discordapp.com/emojis/${id}.${ext}?size=256`;

    try {
        const emoji = await message.guild.emojis.create({ attachment: url, name });
        return message.reply({ embeds: [mkSuccess('Emoji Stolen!', `Added ${emoji} as \`:${emoji.name}:\``)] });
    } catch (err) {
        return message.reply({ embeds: [mkError('Failed', `Could not steal the emoji: ${err.message}`)] });
    }
}

// ══════════════════════════════════════════════════════════
//  BOT ADMIN ROLE — server owner can delegate bot control
// ══════════════════════════════════════════════════════════
async function handleBotAdminCommand(message, args) {
    if (!isAdmin(message.member)) {
        return message.reply({ embeds: [mkError('Permission Denied', 'Only the **server owner** can manage the bot admin role.')] });
    }
    const db  = getGuildDb(message.guild.id);
    const sub = args[0]?.toLowerCase();

    if (sub === 'set') {
        const role = message.mentions.roles.first();
        if (!role) return message.reply({ embeds: [mkError('Missing Role', 'Mention a role: `.botadmin set @Role`')] });
        db.set('botAdminRoleId', role.id);
        return message.reply({ embeds: [mkSuccess('Bot Admin Role Set', `Members of <@&${role.id}> can now manage the bot exactly like the server owner.`)] });
    }
    if (sub === 'remove') {
        db.set('botAdminRoleId', null);
        return message.reply({ embeds: [mkSuccess('Bot Admin Role Removed', 'The bot admin role has been cleared.')] });
    }
    if (sub === 'view') {
        const roleId = db.get('botAdminRoleId', null);
        if (!roleId) return message.reply({ embeds: [mkInfo('Bot Admin Role', 'No bot admin role is currently configured.')] });
        return message.reply({ embeds: [mkInfo('Bot Admin Role', `Current bot admin role: <@&${roleId}>`)] });
    }
    return message.reply({ embeds: [mkInfo('Usage', '`.botadmin set @Role` — set the bot admin role\n`.botadmin remove` — clear the bot admin role\n`.botadmin view` — show the current bot admin role')] });
}

// ══════════════════════════════════════════════════════════
//  VC PREFIX COMMANDS  — text alternatives to VM panel buttons
// ══════════════════════════════════════════════════════════
async function handleVCPrefixCommand(message, args) {
    const member = message.member;
    const vc     = member.voice.channel;
    const sub    = args[0]?.toLowerCase();
    const guild  = message.guild;

    // Claim works even if you're not the owner yet
    if (sub === 'claim') {
        if (!vc || !tempVCOwners.has(vc.id)) return message.reply({ embeds: [mkError('Not a VoiceMaster VC', 'You must be in a VoiceMaster-created voice channel.')] });
        if (vc.members.has(tempVCOwners.get(vc.id))) return message.reply({ embeds: [mkError('Cannot Claim', 'The owner is still in the channel.')] });
        tempVCOwners.set(vc.id, member.id); saveLegacyData();
        return message.reply({ embeds: [mkSuccess('Claimed', `You now own **${vc.name}**.`)] });
    }

    // All other commands require you to be in a VM VC and own it
    if (!vc || !tempVCOwners.has(vc.id))
        return message.reply({ embeds: [mkError('Not in a VoiceMaster VC', 'Join a VoiceMaster-created voice channel first.')] });
    if (tempVCOwners.get(vc.id) !== member.id)
        return message.reply({ embeds: [mkError('Not Owner', 'You do not own this voice channel.')] });

    if (sub === 'lock') {
        await vc.permissionOverwrites.edit(guild.roles.everyone, { Connect: false });
        return message.reply({ embeds: [mkSuccess('Channel Locked', 'No one can join your VC.')] });
    }
    if (sub === 'unlock') {
        await vc.permissionOverwrites.edit(guild.roles.everyone, { Connect: null });
        return message.reply({ embeds: [mkSuccess('Channel Unlocked', 'Everyone can join your VC.')] });
    }
    if (sub === 'rename') {
        const name = args.slice(1).join(' ').trim();
        if (!name) return message.reply({ embeds: [mkError('Missing Name', 'Usage: `.vc rename <new name>`')] });
        if (name.length > 100) return message.reply({ embeds: [mkError('Name Too Long', 'Max 100 characters.')] });
        await vc.setName(name);
        return message.reply({ embeds: [mkSuccess('Channel Renamed', `Your VC is now **${name}**.`)] });
    }
    if (sub === 'limit') {
        const n = parseInt(args[1]);
        if (isNaN(n) || n < 0 || n > 99) return message.reply({ embeds: [mkError('Invalid Limit', 'Provide a number 0–99 (0 = unlimited). Usage: `.vc limit <n>`')] });
        await vc.setUserLimit(n);
        return message.reply({ embeds: [mkSuccess('Limit Updated', `User limit set to **${n === 0 ? 'unlimited' : n}**.`)] });
    }
    if (sub === 'info') {
        const owner = await client.users.fetch(tempVCOwners.get(vc.id)).catch(() => null);
        return message.reply({ embeds: [mkInfo('VC Info')
            .addFields(
                { name: 'Owner',   value: owner ? `<@${owner.id}>` : 'Unknown',                    inline: true },
                { name: 'Members', value: vc.members.size.toString(),                               inline: true },
                { name: 'Limit',   value: vc.userLimit === 0 ? 'Unlimited' : vc.userLimit.toString(), inline: true },
                { name: 'Created', value: `<t:${Math.floor(vc.createdTimestamp / 1000)}:R>`,        inline: true },
            )] });
    }
    if (sub === 'delete') {
        tempVCOwners.delete(vc.id); saveLegacyData();
        await vc.delete().catch(() => {});
        return message.reply({ embeds: [mkSuccess('Channel Deleted', 'Your voice channel has been deleted.')] }).catch(() => {});
    }
    if (sub === 'transfer') {
        const target = message.mentions.members.first() ||
            (args[1]?.match(/^\d+$/) ? await guild.members.fetch(args[1]).catch(() => null) : null);
        if (!target) return message.reply({ embeds: [mkError('Missing Target', 'Usage: `.vc transfer @user`')] });
        if (target.id === member.id) return message.reply({ embeds: [mkError('Invalid', 'You already own this channel.')] });
        if (!vc.members.has(target.id)) return message.reply({ embeds: [mkError('Not in VC', 'That user must be in your voice channel.')] });
        tempVCOwners.set(vc.id, target.id); saveLegacyData();
        return message.reply({ embeds: [mkSuccess('Ownership Transferred', `<@${target.id}> is now the owner of **${vc.name}**.`)] });
    }
    if (sub === 'kick') {
        const target = message.mentions.members.first() ||
            (args[1]?.match(/^\d+$/) ? await guild.members.fetch(args[1]).catch(() => null) : null);
        if (!target) return message.reply({ embeds: [mkError('Missing Target', 'Usage: `.vc kick @user`')] });
        if (target.id === member.id) return message.reply({ embeds: [mkError('Invalid', 'You cannot kick yourself.')] });
        if (!vc.members.has(target.id)) return message.reply({ embeds: [mkError('Not in VC', 'That user is not in your voice channel.')] });
        await target.voice.disconnect('Kicked from VC by owner').catch(() => {});
        return message.reply({ embeds: [mkSuccess('User Kicked', `<@${target.id}> has been disconnected from your VC.`)] });
    }
    if (sub === 'ban') {
        const target = message.mentions.members.first() ||
            (args[1]?.match(/^\d+$/) ? await guild.members.fetch(args[1]).catch(() => null) : null);
        if (!target) return message.reply({ embeds: [mkError('Missing Target', 'Usage: `.vc ban @user`')] });
        if (target.id === member.id) return message.reply({ embeds: [mkError('Invalid', 'You cannot ban yourself from your own channel.')] });
        await vc.permissionOverwrites.edit(target, { Connect: false });
        if (vc.members.has(target.id)) await target.voice.disconnect('VC ban').catch(() => {});
        return message.reply({ embeds: [mkSuccess('User Banned', `<@${target.id}> can no longer connect to your VC.`)] });
    }
    if (sub === 'unban') {
        const target = message.mentions.members.first() ||
            (args[1]?.match(/^\d+$/) ? await guild.members.fetch(args[1]).catch(() => null) : null);
        if (!target) return message.reply({ embeds: [mkError('Missing Target', 'Usage: `.vc unban @user`')] });
        await vc.permissionOverwrites.edit(target, { Connect: null });
        return message.reply({ embeds: [mkSuccess('User Unbanned', `<@${target.id}> can now connect to your VC again.`)] });
    }
    if (sub === 'mute') {
        const target = message.mentions.members.first() ||
            (args[1]?.match(/^\d+$/) ? await guild.members.fetch(args[1]).catch(() => null) : null);
        if (!target) return message.reply({ embeds: [mkError('Missing Target', 'Usage: `.vc mute @user`')] });
        if (target.id === member.id) return message.reply({ embeds: [mkError('Invalid', 'You cannot mute yourself.')] });
        if (!vc.members.has(target.id)) return message.reply({ embeds: [mkError('Not in VC', 'That user is not in your voice channel.')] });
        const db = getGuildDb(guild.id);
        const allowedRoles = db.get('vcServerMuteRoles', []);
        const hasRole = allowedRoles.some(rid => member.roles.cache.has(rid));
        if (!hasRole) return message.reply({ embeds: [mkError('No Permission', 'You need a VC server-mute role to use this. Use `,vcservermute list` to see available roles.')] });
        await target.voice.setMute(true, 'VC server-mute by owner').catch(() => {});
        return message.reply({ embeds: [mkSuccess('User Muted', `<@${target.id}> has been server-muted in your VC.`)] });
    }
    if (sub === 'unmute') {
        const target = message.mentions.members.first() ||
            (args[1]?.match(/^\d+$/) ? await guild.members.fetch(args[1]).catch(() => null) : null);
        if (!target) return message.reply({ embeds: [mkError('Missing Target', 'Usage: `.vc unmute @user`')] });
        if (!vc.members.has(target.id)) return message.reply({ embeds: [mkError('Not in VC', 'That user is not in your voice channel.')] });
        const db = getGuildDb(guild.id);
        const allowedRoles = db.get('vcServerMuteRoles', []);
        const hasRole = allowedRoles.some(rid => member.roles.cache.has(rid));
        if (!hasRole) return message.reply({ embeds: [mkError('No Permission', 'You need a VC server-mute role to use this. Use `,vcservermute list` to see available roles.')] });
        await target.voice.setMute(false, 'VC server-unmute by owner').catch(() => {});
        return message.reply({ embeds: [mkSuccess('User Unmuted', `<@${target.id}> has been server-unmuted in your VC.`)] });
    }

    return message.reply({ embeds: [mkInfo('VC Commands',
        '`.vc lock` — lock your VC\n' +
        '`.vc unlock` — unlock your VC\n' +
        '`.vc rename <name>` — rename your VC\n' +
        '`.vc limit <0-99>` — set user limit\n' +
        '`.vc claim` — claim an ownerless VC\n' +
        '`.vc info` — view VC info\n' +
        '`.vc transfer @user` — transfer ownership\n' +
        '`.vc kick @user` — disconnect a member\n' +
        '`.vc ban @user` — ban a member from your VC\n' +
        '`.vc unban @user` — remove a VC ban\n' +
        '`.vc mute @user` — server-mute a member\n' +
        '`.vc unmute @user` — server-unmute a member\n' +
        '`.vc delete` — delete your VC'
    )] });
}

// ══════════════════════════════════════════════════════════
// VC SERVER MUTE — roles that can server-mute in their own VM VC
// ══════════════════════════════════════════════════════════
async function handleVcServerMuteCommand(message, args) {
    const { greedOk, greedWarn } = require('./utils/embeds');
    const sub = args[0]?.toLowerCase();
    const db = getGuildDb(message.guild.id);

    if (sub === 'add') {
        const role = message.mentions.roles.first();
        if (!role) return message.reply(greedWarn(message.member, 'Mention a role: `,vcservermute add @Role`'));
        const list = db.get('vcServerMuteRoles', []);
        if (list.includes(role.id)) return message.reply(greedWarn(message.member, 'That role is already in the list.'));
        list.push(role.id);
        db.set('vcServerMuteRoles', list);
        return message.reply(greedOk(message.member, `Added <@&${role.id}> to the VC server-mute roles.`));
    }
    if (sub === 'remove') {
        const role = message.mentions.roles.first();
        if (!role) return message.reply(greedWarn(message.member, 'Mention a role: `,vcservermute remove @Role`'));
        let list = db.get('vcServerMuteRoles', []);
        if (!list.includes(role.id)) return message.reply(greedWarn(message.member, 'That role is not in the list.'));
        list = list.filter(id => id !== role.id);
        db.set('vcServerMuteRoles', list);
        return message.reply(greedOk(message.member, `Removed <@&${role.id}> from the VC server-mute roles.`));
    }
    if (sub === 'list') {
        const list = db.get('vcServerMuteRoles', []);
        if (!list.length) return message.reply(greedOk(message.member, 'No VC server-mute roles configured.'));
        const roles = list.map(id => `<@&${id}>`).join('\n');
        return message.reply({ embeds: [new EmbedBuilder().setTitle('🔇 VC Server-Mute Roles').setDescription(roles).setColor('#5865F2')] });
    }
    return message.reply(greedWarn(message.member, 'Usage: `,vcservermute add @Role` / `,vcservermute remove @Role` / `,vcservermute list`'));
}

// ══════════════════════════════════════════════════════════
//  COMMAND ALIASES  (resolve before dispatching)
// ══════════════════════════════════════════════════════════
const ALIASES = {
    // Bans / kicks
    b: 'ban', k: 'kick', sb: 'softban', hb: 'hardban', tb: 'tempban',
    ub: 'unban',
    // Timeout / mute
    to: 'timeout', uto: 'untimeout', tol: 'timeoutlist',
    m: 'mute', um: 'unmute',
    // Jail
    j: 'jail', uj: 'unjail', jl: 'jaillist',
    // Purge
    p: 'purge', clear: 'purge',
    // Channel
    ld: 'lockdown', sm: 'slowmode', rf: 'revokefiles', crename: 'chanrename',
    // Nick
    fn: 'forcenickname',
    // Role
    r: 'role', tr: 'temprole',
    // Voice
    ma: 'moveall', pull: 'drag',
    // Sticky
    sr: 'stickyrole',
    // Unlock all
    ual: 'unlockall',
    // Reminders
    reminders: 'remind', reminder: 'remind',
    // Channel tools
    nsfw: 'naughty', perms: 'permissions', nm: 'newmembers',
    // Aliases
    caselog: 'case', modhistory: 'moderationhistory',
    // Cases
    c: 'case', rsn: 'reason', hist: 'history', ms: 'modstats', warns: 'warnings',
    // Warn
    w: 'warn',
    // Restrict
    rc: 'restrictcommand',
    // Help
    h: 'help', '?': 'help',
    // Fun
    // gw removed from guessword → now on giveaway
    // Info
    bs: 'botstats', stats: 'botstats', ui: 'userinfo', si: 'serverinfo', av: 'avatar', pfp: 'avatar',
    ci: 'channelinfo', ri: 'roleinfo', gi: 'guildicon', gb: 'guildbanner',
    sb: 'serverbanner', sbanner: 'serverbanner',
    sa: 'serveravatar', savatar: 'serveravatar',
    mc: 'membercount',
    // Config
    cfg: 'config',
    // Levels
    lvl: 'levels', rank: 'levels', sl: 'setlevel',
    // Misc
    tt: 'ticket', an: 'antinuke', ar: 'antiraid', am: 'automod',
    vm: 'voicemaster',
    vsm: 'vcservermute',
    s: 'snipe',
    cs: 'clearsnipe',
     // Music
     p: 'play',
     q: 'queue',
     // s: 'skip',  // disabled — conflicts with snipe alias
     vol: 'volume',
     ff: 'fastforward',
     rw: 'rewind',
     dc: 'disconnect',
     leave: 'disconnect',
     stop: 'disconnect',
     np: 'nowplaying',
     loop: 'repeat',
     // Fake Permissions
     fp: 'fakepermissions',
     fakeperms: 'fakepermissions',
     // Invoke
     inv: 'invoke',
     // Roleplay
     rp: 'roleplay',
     // Settings
     set: 'settings',
     // Economy
     bal: 'balance',
     credits: 'balance',
     money: 'balance',
     dly: 'daily',
     wrk: 'work',
     qst: 'quests',
     lb: 'leaderboard',
     prof: 'profile',
     inv: 'inventory',
     invt: 'inventory',
     bag: 'inventory',
     slot: 'slots',
     hl: 'highlow',
     jk: 'jackpot',
     ecoadmin: 'economy',
     ecocfg: 'economy',
};

// ══════════════════════════════════════════════════════════
//  MESSAGE CREATE
// ══════════════════════════════════════════════════════════
const MOD_COMMANDS = new Set([
    // bans
    'kick','ban','unban','softban','hardban','tempban','unbanall','banlist','recentban',
    // timeout / mute
    'timeout','untimeout','timeoutlist',
    'mute','unmute','imute','iunmute','rmute','runmute','setupmute','setupimute','setuprmute',
    // jail
    'jail','unjail','jaillist','setupjail','jailed',
    // purge
    'purge',
    // channel
    'lock','unlock','unlockall','lockdown','hide','unhide','talk','slowmode','topic','chanrename','revokefiles',
    // threads
    'thread',
    // nick
    'nick','rename','forcenickname','fn','stripstaff',
    // role
    'role','temprole','stickyrole',
    // voice
    'moveall','drag',
    // cases / history / notes
    'note','notes','history','case','reason','proof','modstats','warnings','clearwarn','clearallwarns','clearallserverwarns','expirewarn',
    'caselog','moderationhistory',
    // warn
    'warn',
    // reminders
    'remind','reminders',
    // channel tools
    'naughty','permissions','dump','newmembers','clearinvites',
    // nuke
    'nuke',
]);

client.on('messageCreate', async (message) => {
      if (message.author.bot || !message.guild) return;

      // Track seen status for ,seen command
      updateSeen(message.guild.id, message.author.id);

      // ── Ignore check ──
      if (isIgnored(message.guild.id, message.author.id, message.channel.id)) return;

    // ── Passive systems ──
    if (isModuleEnabled(message.guild.id, 'automod'))  await runAutoMod(message).catch(() => {});
    if (isModuleEnabled(message.guild.id, 'streaks'))  await handleStreak(message).catch(() => {});
    if (isModuleEnabled(message.guild.id, 'levels'))   await handleXpGain(message).catch(() => {});

    // ── Autoresponder ──
    if (isModuleEnabled(message.guild.id, 'autoresponder')) await processAutoresponder(message).catch(() => {});

    // ── AFK system ──
    const db = getGuildDb(message.guild.id);
    if (isModuleEnabled(message.guild.id, 'afk')) {
        const prefix = db.get('settings', {}).prefix || ',';
        const isAfkCmd = message.content.toLowerCase().startsWith(prefix + 'afk');
        if (!isAfkCmd) await checkAfkReturn(message).catch(() => {});
        await checkAfkMentions(message).catch(() => {});
    }

    // ── Economy anti-abuse tracking ──
    if (isModuleEnabled(message.guild.id, 'economy') && isEconomyEnabled(message.guild.id)) {
      trackEconomyMessage(message.guild.id, message.author.id, message.content, false);
    }

    // Track giveaway message counts for active giveaways with required_messages
    trackGiveawayMessage(message.guild.id, message.author.id, message.channel.id);

    // Track message stats
    trackMessage(message.guild.id, message.author.id, db);

    // ── Swear tracking ──
    if (isModuleEnabled(message.guild.id, 'swears')) {
        const lower = message.content.toLowerCase();
        if (swearWords.some(w => lower.includes(w))) {
            initUser(message.author.id);
            legacyData.userData[message.author.id].swearCount++;
            saveLegacyData();
        }
    }

    // ── GuessWord in-game guesses ──
    const gwGame = activeGuessWordGames.get(message.channel.id);
    if (gwGame?.gameActive) { await gwGame.handleGuess(message, message.content); return; }

    // ── Blacktea in-game guesses ──
    if (await handleBlackteaMessage(message)) return;

     // ── Reaction triggers + auto-reactions ──
     await reactionOnMessageCreate(message).catch(() => {});

     // ── Filter System ──
     if (isModuleEnabled(message.guild.id, 'filters')) {
       try {
         await filterOnMessageCreate(message);
       } catch (err) {
         logger.error('FILTER', err.message);
       }
     }

      // ── Highlight system ──
      await checkHighlights(message).catch(() => {});

      // ── Prefix check ──
      const prefix = db.get('settings', {}).prefix || ',';
      if (!message.content.startsWith(prefix)) return;

    const rawArgs = message.content.slice(prefix.length).trim().split(/ +/);
    const rawCmd  = rawArgs.shift().toLowerCase();
    const command = ALIASES[rawCmd] || rawCmd;
    const args    = rawArgs;

    logger.command(message.author.tag, message.guild.name, command);

    // Track economy command usage for anti-abuse and quests
    if (isModuleEnabled(message.guild.id, 'economy') && isEconomyEnabled(message.guild.id)) {
      const economyCommands = new Set([
        'balance','daily','work','quests','quest','leaderboard','profile',
        'trivia','scramble','math','fasttype','memory','slots','wheel',
        'scratch','mines','cups','highlow','jackpot','shop','buy','inventory','use'
      ]);
      if (economyCommands.has(command)) {
        trackEconomyMessage(message.guild.id, message.author.id, message.content, true);
        const { progressQuest } = require('./modules/economy');
        progressQuest(message.guild.id, message.author.id, 'commands');
      }
    }

    // Track command usage for topcommands
    try {
      const { commandUsage } = require('./modules/funCommands');
      if (commandUsage) {
        commandUsage.set(command, (commandUsage.get(command) || 0) + 1);
        // Persist to guild DB
        const cmdDb = getGuildDb(message.guild.id);
        const persisted = cmdDb.get('commandUsage', {});
        persisted[command] = (persisted[command] || 0) + 1;
        cmdDb.set('commandUsage', persisted);
      }
    } catch {}


    try {
         // ── Invoke Messages ──
         if (command === 'invoke') return handleInvokeCommand(message, args);

        // ── Help ──
        if (command === 'help') return handleHelp(message, args, client, prefix);
         // A bare command/category that has a browsable guide opens that guide
         // without affecting commands that have a meaningful no-argument action.
         if (!args.length && shouldShowHelpForCommand(command, prefix)) {
             return handleHelp(message, [command], client, prefix);
         }

        // ── AFK ──
        if (command === 'afk') return setAfk(message, args);

        // ── CE  (Custom Embed sender) ──
        if (command === 'ce') {
            const { isAdmin } = require('./modules/helpers');
            const { greedWarn } = require('./utils/embeds');
            if (!isAdmin(message.member) && !message.member.permissions.has(PermissionFlagsBits.ManageMessages))
                return message.reply(greedWarn(message.member, 'You need **Manage Messages** or admin to use `.ce`.'));

            const raw = args.join(' ').trim();
            if (!raw)
                return message.reply(greedWarn(message.member, 'Provide an embed code.\n**Usage:** `,ce {embed}$v{title: Hello}$v{description: World}$v{color: 5865F2}`'));

            const vars = { ...buildWelcomeVars(message.member), ...buildChannelVars(message.channel) };
            const { content, embeds, components } = parseEmbedCode(raw, vars, message.guild);
            const payload = {};
            if (content)             payload.content    = content;
            if (embeds?.length)      payload.embeds     = embeds;
            if (components?.length)  payload.components = components;
            if (!payload.content && !payload.embeds?.length)
                return message.reply(greedWarn(message.member, 'Could not parse that embed code. Make sure it starts with `{embed}$v` and uses the correct format.'));

            try {
                await message.delete().catch(() => {});
            } catch {}
            return message.channel.send(payload);
        }

        // ── Settings ──
        if (command === 'settings') return handleSettingsCommand(message, args);

        // ── Config ──
        if (command === 'config') return handleConfigCommand(message, args);

        // ── Staff ──
        if (command === 'staff') return handleStaffCommand(message, args);

        if (command === 'stripstaff') return handleStripstaff(message, args);

        // ── AutoMod ──
        if (command === 'automod') return handleAutoModCommand(message, args);

        // ── AntiNuke ──
        if (command === 'antinuke') return handleAntiNukeCommand(message, args);

        // ── AntiRaid ──
        if (command === 'antiraid') return handleAntiRaidCommand(message, args);

        // ── Levels ──
        if (command === 'levels') return handleLevelsCommand(message, args, client);

        if (command === 'setxp') {
            if (!isStaffOrAdmin(message.member)) return message.reply('❌ No permission.');
            const target = message.mentions.members.first();
            const amount = parseInt(args[0]);
            if (!target || isNaN(amount)) return message.reply('❌ Usage: `.setxp @user <amount>`');
            const udb = getUserDb(message.guild.id, target.id);
            udb.data.xp = Math.max(0, amount); udb.save();
            return message.reply(`✅ Set **${target.user.username}**'s XP to **${amount}**.`);
        }

        if (command === 'removexp') {
            if (!isStaffOrAdmin(message.member)) return message.reply('❌ No permission.');
            const target = message.mentions.members.first();
            const amount = parseInt(args[0]);
            if (!target || isNaN(amount)) return message.reply('❌ Usage: `.removexp @user <amount>`');
            const udb = getUserDb(message.guild.id, target.id);
            udb.data.xp = Math.max(0, (udb.data.xp || 0) - amount); udb.save();
            return message.reply(`✅ Removed **${amount}** XP from **${target.user.username}**.`);
        }

        if (command === 'setlevel') {
            if (!isStaffOrAdmin(message.member)) return message.reply('❌ No permission.');
            const target = message.mentions.members.first();
            const level  = parseInt(args[0]);
            if (!target || isNaN(level)) return message.reply('❌ Usage: `.setlevel @user <level>`');
            const udb = getUserDb(message.guild.id, target.id);
            let xp = 0; for (let i = 0; i < level; i++) xp += 100 * Math.pow(i + 1, 2);
            udb.data.xp = xp; udb.data.level = level; udb.save();
            return message.reply(`✅ Set **${target.user.username}** to level **${level}**.`);
        }

        // ── Module toggle ──
        if (command === 'module' || command === 'modules') return handleModuleCommand(message, args);

        // ── Unmute VC Setup ──
        if (command === 'unmutevc') {
            if (args[0] === 'setup') {
                if (!hasDiscordPerm(message.member, 'ManageChannels')) return message.reply({ embeds: [mkError('Permission Denied', 'You need the **Manage Channels** permission to set up Unmute VC.')] });
                const existingId = db.get('unmuteVcChannelId');
                if (existingId && message.guild.channels.cache.has(existingId)) {
                    return message.reply('❌ Unmute VC is already set up. Delete it first to re-setup.');
                }
                try {
                    const ch = await message.guild.channels.create({
                        name: 'unmute yourself',
                        type: ChannelType.GuildVoice,
                    });
                    db.set('unmuteVcChannelId', ch.id);
                    return message.reply(`✅ Unmute VC created: <#${ch.id}>`);
                } catch (err) { logger.error('UNMUTEVC', 'Setup error', err); return message.reply('❌ Failed to create channel.'); }
            }
            return message.reply({ embeds: [mkInfo('Usage', '`,unmutevc setup` — create an "unmute yourself" voice channel')] });
        }

        // ── VC Server Mute ──
        if (command === 'vcservermute') return handleVcServerMuteCommand(message, args);

         // ── AntiNuke command detection ──
         if (MOD_COMMANDS.has(command)) {
           await trackCommandAction(message, command).catch(() => {});
           return handleModerationCommand(message, command, args, client);
         }

        // ── Restrict Command ──
        if (command === 'restrictcommand') return handleRestrictCommand(message, args);

        // ── God Admin (bot owner only) ──
        if (command === 'godadmin') return handleGodAdmin(message, args);

        // ── Server Prefix ──
        if (command === 'sprefix') return handleSprefixCommand(message, args);

         // ── Steal Emoji ──
         if (command === 'stealemoji') return handleStealEmoji(message, args);

        // ── Booster Role ──
        if (command === 'boosterrole' || command === 'br') return handleBoosterRoleCommand(message, args);

        // ── Welcome / Goodbye / Boost / LevelUp Message Systems ──
        if (command === 'welcome' || command === 'goodbye' || command === 'boosts' || command === 'levelupmsg')
            return handleSystemCommand(message, command, args);

        // ── Bot Admin Role ──
        if (command === 'botadmin') return handleBotAdminCommand(message, args);

        // ── VC Prefix Commands ──
        if (command === 'vc' || command === 'voice') return handleVCPrefixCommand(message, args);

        // ── Ticket System ──
        if (command === 'ticket') return handleTicketCommand(message, args);

        // ── AutoRole ──
        if (command === 'autorole') return handleAutoRoleCommand(message, args);

        // ── Button Role ──
        if (command === 'buttonrole' || command === 'buttonroles') return handleButtonRoleCommand(message, args);

        // ── Reaction Role ──
        if (command === 'reactionrole' || command === 'rr') return handleReactionRoleCommand(message, args);

        // ── Giveaways ──
        if (command === 'giveaway' || command === 'gw' || command === 'gw2' || command === 'giveaways') return handleGiveawayCommand(message, args, client);

        // ── TOPVC ──
        if (command === 'topvc') return handleTopVcCommand(message, args);
        if (command === 'topvcclear') return handleTopVcClear(message);

        // ── Stats ──
        if (command === 'voicetime') return handleVoiceTimeStats(message, args);
        if (command === 'messages') return handleMessageStats(message, args);
        if (command === 'streamtime') return handleStreamTimeStats(message, args);
        if (command === 'cameratime') return handleCameraTimeStats(message, args);
        if (command === 'statsclear') return handleStatsClear(message);

        // ── VoiceMaster ──
        if (command === 'voicemaster' && args[0] === 'setup') {
            if (!hasDiscordPerm(message.member, 'ManageChannels')) return message.reply({ embeds: [mkError('Permission Denied', 'You need the **Manage Channels** permission to set up VoiceMaster.')] });
            const vm = db.get('voiceMaster', {});
            if (vm.categoryId) {
                const catExists = message.guild.channels.cache.has(vm.categoryId);
                if (catExists) return message.reply('❌ VoiceMaster is already set up. Delete the VoiceMaster category first to reset it.');
                db.set('voiceMaster', {}); // channels gone — reset and allow re-setup
            }
            try {
                const guild    = message.guild;
                const category = await guild.channels.create({ name: 'VoiceMaster', type: ChannelType.GuildCategory });
                const ifCh     = await guild.channels.create({
                    name: 'interface', type: ChannelType.GuildText, parent: category,
                    permissionOverwrites: [
                        { id: guild.roles.everyone, deny: [PermissionFlagsBits.SendMessages] },
                        { id: client.user.id, allow: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages] },
                    ],
                });
                const joinVC = await guild.channels.create({ name: 'Join to Create', type: ChannelType.GuildVoice, parent: category });
                db.set('voiceMaster', { categoryId: category.id, interfaceChannelId: ifCh.id, joinChannelId: joinVC.id, interfaceMessageId: null });
                await sendOrUpdateVMInterface(ifCh, guild.id);
                return message.reply('✅ VoiceMaster set up successfully!');
            } catch (err) { logger.error('VM', 'Setup error', err); return message.reply('❌ Failed. Check my permissions.'); }
        }

        // ── GuessWord ──
        if (command === 'guessword') {
            if (!isModuleEnabled(message.guild.id, 'guessword')) return message.reply('❌ GuessWord module is disabled.');
            if (args[0] === 'stats') {
                const target = message.mentions.users.first() || message.author; initUser(target.id);
                return message.channel.send({ embeds: [new EmbedBuilder()
                    .setTitle(`🎯 GuessWord Stats — ${target.username}`)
                    .addFields({ name: 'Wins', value: (legacyData.userData[target.id].guesswordWins || 0).toString(), inline: true })
                    .setThumbnail(target.displayAvatarURL()).setColor('#3498db')] });
            }
            if (activeGuessWordGames.has(message.channel.id)) return message.channel.send('❌ A game is already active!');
            const cat = args[0] || 'animals';
            if (!guessWordCategories[cat]) return message.channel.send('❌ Invalid category! Available: clothing, animals, celebrities, food');
            const game = new GuessWordGame(message.channel.id, cat);
            activeGuessWordGames.set(message.channel.id, game);
            await message.channel.send({ embeds: [game.getGameStatus()] });
            game.startTimer(message.channel);
            return;
        }

        // ── Blacktea ──
        if (command === 'blacktea' || command === 'bt' || command === 'tea') {
            return handleBlackteaCommand(message, args, client);
        }

        // ── Swears ──
        if (command === 'swears') {
            if (args[0] === 'leaderboard') {
                const sorted = Object.entries(legacyData.userData)
                    .filter(([, d]) => d.swearCount > 0)
                    .sort((a, b) => b[1].swearCount - a[1].swearCount).slice(0, 10);
                let desc = '';
                for (let i = 0; i < sorted.length; i++) {
                    const [uid, d] = sorted[i];
                    const u = await client.users.fetch(uid).catch(() => null);
                    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
                    desc += `${medal} **${u ? u.username : 'Unknown'}** — ${d.swearCount} swears\n`;
                }
                return message.channel.send({ embeds: [new EmbedBuilder().setTitle('🤬 Top 10 Swear Users').setDescription(desc || 'No data.').setColor('#e74c3c').setTimestamp()] });
            }
            const target = message.mentions.users.first() || message.author; initUser(target.id);
            return message.channel.send({ embeds: [new EmbedBuilder()
                .setTitle(`🤬 Swear Stats — ${target.username}`)
                .addFields({ name: 'Count', value: (legacyData.userData[target.id].swearCount || 0).toString(), inline: true })
                .setThumbnail(target.displayAvatarURL()).setColor('#e74c3c')] });
        }

        // ── Streaks ──
        if (command === 'streaks') {
            if (args[0] === 'leaderboard') {
                const sorted = Object.entries(legacyData.userData)
                    .filter(([, d]) => d.streakCount > 0)
                    .sort((a, b) => b[1].streakCount - a[1].streakCount).slice(0, 10);
                let desc = '';
                for (let i = 0; i < sorted.length; i++) {
                    const [uid, d] = sorted[i];
                    const u = await client.users.fetch(uid).catch(() => null);
                    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
                    desc += `${medal} **${u ? u.username : 'Unknown'}** — ${d.streakCount} day streak 🔥\n`;
                }
                return message.channel.send({ embeds: [new EmbedBuilder().setTitle('🔥 Top 10 Streak Users').setDescription(desc || 'No data.').setColor('#ff6b35').setTimestamp()] });
            }
            const target = message.mentions.users.first() || message.author; initUser(target.id);
            const d = legacyData.userData[target.id]; const today = getTodayEgypt();
            return message.channel.send({ embeds: [new EmbedBuilder().setTitle(`🔥 Streak — ${target.username}`).addFields(
                { name: 'Streak',    value: `${d.streakCount} days`,                   inline: true },
                { name: 'Today',     value: d.lastStreakDate === today ? '✅ Done' : '❌ Not yet', inline: true },
                { name: 'Last Date', value: d.lastStreakDate || 'Never',                inline: true },
            ).setThumbnail(target.displayAvatarURL()).setColor('#ff6b35').setFooter({ text: 'Resets at 12:00 AM Egypt time' })] });
        }

        // ── Roleplay toggle ──
        if (command === 'roleplay') {
            if (!isAdmin(message.member)) return message.reply('❌ Only administrators can toggle roleplay.');
            const currentlyEnabled = isModuleEnabled(message.guild.id, 'roleplay');
            setModuleEnabled(message.guild.id, 'roleplay', !currentlyEnabled);
            return message.reply(`✅ Roleplay module is now **${!currentlyEnabled ? 'enabled' : 'disabled'}**.`);
        }

        // ── Roleplay / reaction GIFs ──
        if (ROLEPLAY_COMMANDS.has(command)) {
            if (!isModuleEnabled(message.guild.id, 'roleplay')) {
                return message.reply('❌ The roleplay module is disabled. Use `,roleplay` to enable it.');
            }
            const target = message.mentions.users.first() || null;
            // Detect a trailing URL for custom image override (any arg starting with http)
            const customImageUrl = args.find(a => /^https?:\/\//i.test(a)) || null;
            return handleRoleplay(message, command, target, customImageUrl);
        }

         // ── Fun commands ──
         const funCmd = funAliases[command] ? Object.keys(funAliases).find(k => funAliases[k].includes(command)) || command : command;
         if (funCommands[funCmd]) {
           return funCommands[funCmd](message, args);
         }
         // Check aliases mapping
         for (const [cmdName, aliases] of Object.entries(funAliases)) {
           if (cmdName === command || aliases.includes(command)) {
             if (funCommands[cmdName]) return funCommands[cmdName](message, args);
           }
         }

         // ── Fake Permissions ──
         if (command === 'fakepermissions') return handleFakePermissionsCommand(message, args);

         // ── Customize (bot owner only) ──
    if (command === 'customize') return handleCustomize(message, args, client);

    // ── Media commands ──
         if (command === 'media' || MEDIA_COMMANDS.has(command)) {
             return handleMediaCommand(message, command, args);
         }

    // ── Music commands ──
         if (MUSIC_COMMANDS.has(command)) {
             // Handle queue subcommands
             if (command === 'queue' && args[0]) {
                 const sub = args[0].toLowerCase();
                 if (sub === 'shuffle') return handleMusicCommand(message, 'queue-shuffle', args.slice(1));
                 if (sub === 'empty') return handleMusicCommand(message, 'queue-empty', args.slice(1));
                 if (sub === 'remove') return handleMusicCommand(message, 'queue-remove', args.slice(1));
                 if (sub === 'move') return handleMusicCommand(message, 'queue-move', args.slice(1));
             }
             return handleMusicCommand(message, command, args);
         }

        // ── Logging ──
        if (command === 'log') return handleLogCommand(message, args);

        // ── Snipe ──
        if (command === 'snipe') return handleSnipe(message, args);
        if (command === 'editsnipe') return handleEditSnipe(message);
        if (command === 'reactionsnipe') return handleReactionSnipe(message);
        if (command === 'reactionhistory') return handleReactionHistory(message, args);
        if (command === 'clearsnipe') return handleClearSnipe(message);

        // ── Timer ──
        if (command === 'timer') return handleTimerCommand(message, args);

        // ── Counter ──
        if (command === 'counter') return handleCounterCommand(message, args);

        // ── Info commands ──
        if (command === 'ping') return handlePing(message);

        if (command === 'botstats') return handleBotStats(message, client);

        if (command === 'userinfo') {
            const target = message.mentions.users.first() || null;
            return handleUserInfo(message, target, client);
        }

        if (command === 'serverinfo') return handleServerInfo(message, client);

        if (command === 'avatar') {
            const target = message.mentions.users.first() || null;
            return handleAvatar(message, target);
        }

        // ══════════════════════════════════════════════════════════
        // INFORMATION COMMANDS (from modules/information.js)
        // ══════════════════════════════════════════════════════════
        if (command === 'seen') return handleSeen(message, args);
        if (command === 'membercount') return handleMembercount(message);
        if (command === 'roleinfo') return handleRoleinfo(message, args);
        if (command === 'channelinfo') return handleChannelinfo(message, args);
        if (command === 'serveravatar') return handleServeravatar(message, args);
        if (command === 'serverbanner') return handleServerbanner(message, args);
        if (command === 'banner') return handleBanner(message, args);
        if (command === 'guildicon') return handleGuildicon(message, args);
        if (command === 'guildbanner') return handleGuildbanner(message, args);
        if (command === 'splash') return handleSplash(message, args);
        if (command === 'sticker') return handleSticker(message, args);
        if (command === 'rotate') return handleRotate(message, args);
        if (command === 'compress') return handleCompress(message, args);
        if (command === 'invert') return handleInvert(message, args);
         if (command === 'emoji') return handleEmoji(message, args);

         // ══════════════════════════════════════════════════════════
         // INFORMATION EXTRAS (from modules/infoExtras.js)
         // ══════════════════════════════════════════════════════════
         if (command === 'birthday') return handleBirthday(message, args);
         if (command === 'timezone') return handleTimezone(message, args);
         if (command === 'inviteinfo') return handleInviteinfo(message, args);
         if (command === 'boosters') {
           if (args[0]?.toLowerCase() === 'lost') return handleBoostersLost(message, args);
           return handleBoosters(message, args);
         }
         if (command === 'roles') return handleRolesList(message, args);
         if (command === 'emotes') return handleEmotesList(message, args);
         if (command === 'hex') return handleHex(message, args);
         if (command === 'bots') return handleBotsList(message, args);
         if (command === 'highlight') return handleHighlight(message, args);

         // ── Reaction System ──
     if (command === 'reaction' || command === 'previousreact' || command === 'noselfreact') return handleReaction(message, command, args);

         // ── Filter System ──
         if (command === 'filter') return handleFilter(message, args);

         // ══════════════════════════════════════════════════════════
         // SERVER MANAGEMENT COMMANDS (NEW)
         // ══════════════════════════════════════════════════════════
         if (command === 'autoresponder') return handleAutoresponder(message, args);
         if (command === 'pagination') return handlePagination(message, args);
         if (command === 'enablecommand') return handleEnablecommand(message, args);
         if (command === 'disablecommand') return handleDisablecommand(message, args);
         if (command === 'copydisabled') return handleCopydisabled(message, args);
         if (command === 'enableevent') return handleEnableevent(message, args);
         if (command === 'disableevent') return handleDisableevent(message, args);
         if (command === 'enablemodule') return handleEnablemodule(message, args);
         if (command === 'disablemodule') return handleDisablemodule(message, args);
         if (command === 'ignore') return handleIgnore(message, args);
         if (command === 'seticon') return handleSeticon(message, args);
         if (command === 'setsplashbackground') return handleSetsplashbackground(message, args);
         if (command === 'setbanner') return handleSetbanner(message, args);
         if (command === 'pin') return handlePin(message, args);
         if (command === 'unpin') return handleUnpin(message, args);
         if (command === 'firstmessage') return handleFirstmessage(message, args);
         if (command === 'pins') return handlePins(message, args);
         if (command === 'webhook') return handleWebhook(message, args);

         // ══════════════════════════════════════════════════════════
         // STARBOARD & CLOWNBOARD COMMANDS
         // ══════════════════════════════════════════════════════════
         if (command === 'starboard') return handleStarboard(message, args);
         if (command === 'clownboard') return handleClownboard(message, args);

         // ══════════════════════════════════════════════════════════
         // ECONOMY SYSTEM COMMANDS
         // ══════════════════════════════════════════════════════════
         if (command === 'balance') return handleBalance(message, args);
         if (command === 'daily') return handleDaily(message);
         if (command === 'work') return handleWork(message);
         if (command === 'quests') return handleQuests(message);
         if (command === 'quest') return handleQuest(message);
         if (command === 'leaderboard') return handleLeaderboard(message, args, client);
         if (command === 'profile') return handleProfile(message, args, client);
         if (command === 'economy') return handleEconomyConfig(message, args);
         if (command === 'addcredits') return handleAddCredits(message, args);
         if (command === 'removecredits') return handleRemoveCredits(message, args);
         if (command === 'setcredits') return handleSetCredits(message, args);
         if (command === 'resetuser') return handleResetUser(message, args);

         // Economy Games
         if (command === 'trivia') return handleTrivia(message);
         if (command === 'scramble') return handleScramble(message, args, client);
         if (command === 'math') return handleMath(message, args, client);
         if (command === 'fasttype') return handleFasttype(message, args, client);
         if (command === 'memory') return handleMemory(message, args, client);
         if (command === 'slots') return handleSlots(message);
         if (command === 'wheel') return handleWheel(message);
         if (command === 'scratch') return handleScratch(message);
         if (command === 'mines') return handleMines(message);
         if (command === 'cups') return handleCups(message, args);
         if (command === 'highlow') return handleHighlow(message);
         if (command === 'jackpot') return handleJackpot(message, args, client);

         // Economy Shop
         if (command === 'shop') return handleShop(message);
         if (command === 'buy') return handleBuy(message, args);
         if (command === 'inventory') return handleInventory(message, args);
         if (command === 'use') return handleUse(message, args);

         // Economy Events
         if (command === 'event') return require('./modules/economyEvents').handleEventCommand(message, args);

     } catch (err) {
     await handleCommandError(message, err);
     }
    });

// ══════════════════════════════════════════════════════════
//  INTERACTION CREATE
// ══════════════════════════════════════════════════════════
// ── Giveaway message delete handler ──
// ── Giveaway + Snipe + Logging: Message Delete ──
client.on('messageDelete', async (message) => {
    if (!message.guild) return;
    await handleGiveawayMessageDelete(message, client);
    trackDelete(message);
    await logOnMessageDelete(message).catch(() => {});
});

// ── Snipe + Logging: Message Update ──
client.on('messageUpdate', async (oldMsg, newMsg) => {
    if (!oldMsg.guild || oldMsg.author?.bot || oldMsg.content === newMsg.content) return;
    trackEdit(oldMsg, newMsg);
    await logOnMessageUpdate(oldMsg, newMsg).catch(() => {});
});

client.on('interactionCreate', async (interaction) => {
    try {
        // ── Slash commands ──
        if (interaction.isChatInputCommand()) {
            const cmd = interaction.commandName;
            logger.command(interaction.user.tag, interaction.guild?.name || 'DM', cmd);

            if (cmd === 'help') {
                const cat = interaction.options.getString('category');
                const command = interaction.options.getString('command');
                return handleHelp(interaction, [command || cat].filter(Boolean), client);
            }
            if (cmd === 'ping')       return handlePing(interaction);
            if (cmd === 'botstats')   return handleBotStats(interaction, client);
            if (cmd === 'avatar')     return handleAvatar(interaction, interaction.options.getUser('user'));
            if (cmd === 'userinfo')   return handleUserInfo(interaction, interaction.options.getUser('user'), client);
            if (cmd === 'serverinfo') return handleServerInfo(interaction, client);

            if (cmd === 'ban') {
                if (!isStaffOrAdmin(interaction.member)) return interaction.reply({ content: '❌ No permission.', ephemeral: true });
                const target = interaction.options.getMember('user');
                const reason = interaction.options.getString('reason') || 'No reason provided';
                if (!target) return interaction.reply({ content: '❌ User not found.', ephemeral: true });
                await interaction.deferReply();
                return handleModerationCommand({ ...interaction, guild: interaction.guild, member: interaction.member, author: interaction.user, channel: interaction.channel, mentions: { members: new Map([[target.id, target]]) } }, 'ban', [], client);
            }

            if (cmd === 'kick') {
                if (!isStaffOrAdmin(interaction.member)) return interaction.reply({ content: '❌ No permission.', ephemeral: true });
                const target = interaction.options.getMember('user');
                const reason = interaction.options.getString('reason') || 'No reason provided';
                if (!target) return interaction.reply({ content: '❌ User not found.', ephemeral: true });
                await interaction.deferReply();
                try {
                    await target.kick(reason);
                    return interaction.editReply({ content: `✅ **${target.user.username}** has been kicked. Reason: ${reason}` });
                } catch (err) { return handleCommandError(interaction, err); }
            }

            if (cmd === 'warn') {
                if (!isStaffOrAdmin(interaction.member)) return interaction.reply({ content: '❌ No permission.', ephemeral: true });
                const target = interaction.options.getMember('user');
                const reason = interaction.options.getString('reason');
                if (!target || !reason) return interaction.reply({ content: '❌ Missing user or reason.', ephemeral: true });
                await interaction.deferReply();
                // Route through the case system so warnings are persisted properly
                const fakeCtx = {
                    guild:   interaction.guild,
                    member:  interaction.member,
                    author:  interaction.user,
                    user:    interaction.user,
                    channel: interaction.channel,
                    mentions: { members: { first: () => target }, users: { first: () => target.user } },
                    reply:   (d) => interaction.editReply(d),
                    editReply: (d) => interaction.editReply(d),
                };
                // args[0] = placeholder mention (skipped by slice(1) in warn handler)
                return handleModerationCommand(fakeCtx, 'warn', [`<@${target.id}>`, ...reason.split(' ')], client);
            }

            if (cmd === 'timeout') {
                if (!isStaffOrAdmin(interaction.member)) return interaction.reply({ content: '❌ No permission.', ephemeral: true });
                const target  = interaction.options.getMember('user');
                const dur     = interaction.options.getString('duration');
                const reason  = interaction.options.getString('reason') || 'No reason provided';
                const { parseDuration } = require('./modules/moderation');
                const ms = parseDuration(dur);
                if (!ms) return interaction.reply({ content: '❌ Invalid duration. Use: 10m, 1h, 1d', ephemeral: true });
                await interaction.deferReply();
                try { await target.timeout(ms, reason); return interaction.editReply({ content: `✅ **${target.user.username}** timed out for **${dur}**.` }); }
                catch (err) { return handleCommandError(interaction, err); }
            }

            if (cmd === 'purge') {
                if (!isStaffOrAdmin(interaction.member)) return interaction.reply({ content: '❌ No permission.', ephemeral: true });
                const amount = interaction.options.getInteger('amount');
                const user   = interaction.options.getUser('user');
                await interaction.deferReply({ ephemeral: true });
                try {
                    let msgs = await interaction.channel.messages.fetch({ limit: Math.min(amount + 1, 100) });
                    if (user) msgs = msgs.filter(m => m.author.id === user.id);
                    await interaction.channel.bulkDelete(msgs, true);
                    return interaction.editReply({ content: `✅ Deleted **${msgs.size}** messages.` });
                } catch (err) { return handleCommandError(interaction, err); }
            }

            if (cmd === 'levels') {
                const sub = interaction.options.getSubcommand();
                if (sub === 'leaderboard') return handleLevelsCommand(interaction, ['leaderboard'], client);
                if (sub === 'rank') {
                    const user = interaction.options.getUser('user');
                    return handleLevelsCommand(interaction, user ? ['rank', `<@${user.id}>`] : ['rank'], client);
                }
            }

            if (cmd === 'config') {
                const sub = interaction.options.getSubcommand();
                if (sub === 'view')    return handleConfigCommand(interaction, ['view']);
                if (sub === 'modules') return handleConfigCommand(interaction, ['module', 'list']);
            }

             if (cmd === 'blacktea') return handleBlackteaSlash(interaction, client);

             // ── Fun slash commands ──
             const funSlashCommands = [
               'lyrics','duckduckgo','blacktea','quote','tictactoe','giphy',
               'steal','duckduckgoimage','reverseimage','image','book','manga','anime',
               'character','tone','tags','tvshow','game','movie','movieexpand','ocr','ocrtr',
               'translate','tts','ttschannel','lego','makegif','transparent','wolfram',
               'juul','juul hit','juul pass','juul toggle','juul stats','juul flavor','juul steal',
               'embedcode','randomhex','charinfo','color','addemote','rps','choose','jumbo',
               'wouldyourather','invites','makemp3','wikihow','gnames','clearnames','cleargnames',
               'brainly','names','shazam','topcommands','afkmentions','poll','chatgpt','uwu',
               'freaky','quickpoll'
             ];
             if (funSlashCommands.includes(cmd)) {
               let slashArgs = [];
               if (cmd === 'lyrics') slashArgs = [interaction.options.getString('query')];
               if (cmd === 'duckduckgo') slashArgs = [interaction.options.getString('search')];
               if (cmd === 'quote') slashArgs = [interaction.options.getString('text')];
               if (cmd === 'tictactoe') {
                 const user = interaction.options.getUser('user');
                 slashArgs = user ? [user.toString()] : [];
               }
               if (cmd === 'google') slashArgs = [interaction.options.getString('search')];
               if (cmd === 'giphy') slashArgs = [interaction.options.getString('keyword')];
               if (cmd === 'tenor') slashArgs = [interaction.options.getString('keyword')];
               if (cmd === 'steal') slashArgs = [interaction.options.getString('message_link')];
               if (cmd === 'duckduckgoimage') slashArgs = [interaction.options.getString('search')];
               if (cmd === 'reverseimage') slashArgs = [interaction.options.getString('url')];
               if (cmd === 'image') slashArgs = [interaction.options.getString('search')];
               if (cmd === 'book') slashArgs = [interaction.options.getString('search')];
               if (cmd === 'manga') slashArgs = [interaction.options.getString('search')];
               if (cmd === 'anime') slashArgs = [interaction.options.getString('search')];
               if (cmd === 'character') slashArgs = [interaction.options.getString('search')];
               if (cmd === 'tone') slashArgs = [interaction.options.getString('text')];
               if (cmd === 'tags') slashArgs = [interaction.options.getString('tag_name')];
               if (cmd === 'tvshow') slashArgs = [interaction.options.getString('title')];
               if (cmd === 'game') slashArgs = [interaction.options.getString('title')];
               if (cmd === 'movie') slashArgs = [interaction.options.getString('title')];
               if (cmd === 'movieexpand') slashArgs = [interaction.options.getString('title')];
               if (cmd === 'ocr') slashArgs = [interaction.options.getString('url')];
               if (cmd === 'ocrtr') {
                 slashArgs = [interaction.options.getString('url'), interaction.options.getString('to_language') || 'en'];
               }
               if (cmd === 'translate') {
                 const from = interaction.options.getString('from_language') || 'auto';
                 const to = interaction.options.getString('to_language');
                 const text = interaction.options.getString('text');
                 slashArgs = [from, to, text];
               }
               if (cmd === 'tts') {
                 const speaker = interaction.options.getString('speaker') || 'en';
                 const text = interaction.options.getString('text');
                 slashArgs = [speaker, text];
               }
               if (cmd === 'ttschannel') {
                 const speaker = interaction.options.getString('speaker') || 'en';
                 const text = interaction.options.getString('text');
                 slashArgs = [speaker, text];
               }
               if (cmd === 'lego') slashArgs = [interaction.options.getString('url')];
               if (cmd === 'makegif') {
                 slashArgs = [
                   interaction.options.getString('url'),
                   interaction.options.getString('quality') || '10',
                   interaction.options.getString('fps') || '15',
                   interaction.options.getBoolean('fast_forward') ? 'fast' : ''
                 ];
               }
               if (cmd === 'transparent') slashArgs = [interaction.options.getString('url')];
               if (cmd === 'wolfram') slashArgs = [interaction.options.getString('query')];
               if (cmd === 'juul') slashArgs = [];
               if (cmd === 'juul hit') slashArgs = [];
               if (cmd === 'juul pass') {
                 const user = interaction.options.getUser('member');
                 slashArgs = user ? [user.toString()] : [];
               }
               if (cmd === 'juul toggle') slashArgs = [];
               if (cmd === 'juul stats') slashArgs = [];
               if (cmd === 'juul flavor') slashArgs = [interaction.options.getString('flavor')];
               if (cmd === 'juul steal') slashArgs = [];

               if (funCommands[cmd]) return funCommands[cmd](interaction, slashArgs);
             }

             // ── Server Management Slash Commands ──
             if (cmd === 'autoresponder') {
               const sub = interaction.options.getSubcommand();
               const args = [];
               if (sub === 'add') args.push('add', interaction.options.getString('trigger'), interaction.options.getString('response'));
               if (sub === 'remove') args.push('remove', interaction.options.getString('trigger'));
               if (sub === 'update') args.push('update', interaction.options.getString('trigger'), interaction.options.getString('response'));
               if (sub === 'list') args.push('list');
               if (sub === 'reset') args.push('reset');
               if (sub === 'variables') args.push('variables');
               return handleAutoresponder(interaction, args);
             }
             if (cmd === 'pagination') {
               const sub = interaction.options.getSubcommand();
               const args = [sub];
               if (sub !== 'list' && sub !== 'reset') args.push(interaction.options.getString('message_link'));
               if (sub === 'add' || sub === 'update') args.push(interaction.options.getString('embed_code'));
               if (sub === 'remove' || sub === 'update') args.push(interaction.options.getInteger('id').toString());
               return handlePagination(interaction, args);
             }
             if (cmd === 'enablecommand') return handleEnablecommand(interaction, [interaction.options.getString('target'), interaction.options.getString('command')]);
             if (cmd === 'disablecommand') return handleDisablecommand(interaction, [interaction.options.getString('target'), interaction.options.getString('command')]);
             if (cmd === 'enableevent') return handleEnableevent(interaction, [interaction.options.getString('target'), interaction.options.getString('event')]);
             if (cmd === 'disableevent') return handleDisableevent(interaction, [interaction.options.getString('target'), interaction.options.getString('event')]);
             if (cmd === 'enablemodule') return handleEnablemodule(interaction, [interaction.options.getString('target'), interaction.options.getString('module')]);
             if (cmd === 'disablemodule') return handleDisablemodule(interaction, [interaction.options.getString('target'), interaction.options.getString('module')]);
             if (cmd === 'ignore') {
               const sub = interaction.options.getSubcommand();
               const target = interaction.options.getString('target');
               return handleIgnore(interaction, [sub, target]);
             }
             if (cmd === 'seticon') return handleSeticon(interaction, [interaction.options.getString('url')]);
             if (cmd === 'setsplashbackground') return handleSetsplashbackground(interaction, [interaction.options.getString('url')]);
             if (cmd === 'setbanner') return handleSetbanner(interaction, [interaction.options.getString('url')]);
             if (cmd === 'pin') return handlePin(interaction, [interaction.options.getString('message')]);
             if (cmd === 'unpin') return handleUnpin(interaction, [interaction.options.getString('message')]);
             if (cmd === 'firstmessage') {
               const ch = interaction.options.getChannel('channel');
               return handleFirstmessage(interaction, ch ? [ch.id] : []);
             }
             if (cmd === 'pins') {
               const sub = interaction.options.getSubcommand();
               const args = [sub];
               if (sub === 'set' || sub === 'unpin') args.push(interaction.options.getString('option'));
               if (sub === 'channel') args.push(interaction.options.getChannel('channel').id);
               return handlePins(interaction, args);
             }
             if (cmd === 'webhook') {
               const sub = interaction.options.getSubcommand();
               const args = [sub];
               if (sub !== 'list') args.push(interaction.options.getString('identifier'));
               if (sub === 'send' || sub === 'edit') args.push(interaction.options.getString('message'));
               return handleWebhook(interaction, args);
             }

             // ── Starboard / Clownboard Slash Commands ──
             if (cmd === 'starboard') {
               const sub = interaction.options.getSubcommand();
               const args = [sub];
               if (sub === 'ignore') args.push(interaction.options.getString('target'));
               if (sub === 'emoji') args.push(interaction.options.getString('emoji'));
               if (sub === 'threshold') args.push(interaction.options.getInteger('number').toString());
               if (sub === 'selfstar' || sub === 'timestamp' || sub === 'jumpurl' || sub === 'attachments') args.push(interaction.options.getString('setting'));
               if (sub === 'color') args.push(interaction.options.getString('color'));
               if (sub === 'set') args.push(interaction.options.getChannel('channel').id);
               return handleStarboard(interaction, args);
             }
             if (cmd === 'clownboard') {
               const sub = interaction.options.getSubcommand();
               const args = [sub];
               if (sub === 'ignore') args.push(interaction.options.getString('target'));
               if (sub === 'emoji') args.push(interaction.options.getString('emoji'));
               if (sub === 'threshold') args.push(interaction.options.getInteger('number').toString());
               if (sub === 'selfstar' || sub === 'timestamp' || sub === 'jumpurl' || sub === 'attachments') args.push(interaction.options.getString('setting'));
               if (sub === 'color') args.push(interaction.options.getString('color'));
               if (sub === 'set') args.push(interaction.options.getChannel('channel').id);
               return handleClownboard(interaction, args);
             }

            // ── Roleplay slash command (/rp action:hug user:@someone) ──
            if (cmd === 'rp') {
                const action     = interaction.options.getString('action')?.toLowerCase().trim();
                const targetUser = interaction.options.getUser('user');
                return handleRoleplay(interaction, action, targetUser);
            }
        }

        // ── Buttons ──
        if (interaction.isButton()) {
            const id = interaction.customId;
            if (id.startsWith('vm_'))              return handleVoiceMasterButton(interaction);
            if (id.startsWith('ticket_'))          return handleTicketButton(interaction);
            if (id.startsWith('br_'))              return handleButtonRoleInteraction(interaction);
            if (id.startsWith('pag_'))             return handlePaginationButton(interaction);
            if (id.startsWith('giveaway_stats_'))  return handleGiveawayButton(interaction);
            if (id.startsWith('brrole_accept_') || id.startsWith('brrole_decline_'))
                return handleBoosterShareButton(interaction, client);

            // ── Economy buttons ──
            if (id.startsWith('eco_') || id.startsWith('ecolb_')) return handleEconomyButton(interaction);
            if (id === 'jackpot_join') return handleJackpotButton(interaction);
        }

        // ── Modals ──
        if (interaction.isModalSubmit()) {
            if (interaction.customId === 'vm_rename_modal') {
                const vc = interaction.member.voice.channel;
                if (!vc || !tempVCOwners.has(vc.id) || tempVCOwners.get(vc.id) !== interaction.member.id)
                    return interaction.reply({ content: '❌ You are not in your own VC.', ephemeral: true });
                const name = interaction.fields.getTextInputValue('vm_rename_input');
                await vc.setName(name);
                return interaction.reply({ content: `✏️ Renamed to **${name}**.`, ephemeral: true });
            }
        }

    } catch (err) {
        await handleCommandError(interaction, err);
    }
});

// ═══════════════════════════════════════════════════════════════
//  VOICE STATE UPDATE
// ══════════════════════════════════════════════════════════
client.on('voiceStateUpdate', async (oldState, newState) => {
    const member = newState.member || oldState.member;
    if (!member) return;
    const guildId = newState.guild?.id || oldState.guild?.id;

    // Keep Shoukaku's state in sync when Discord removes the bot from voice
    // (for example, an admin disconnecting it). Without this, the stale
    // Lavalink player can report successful playback while Discord has no
    // voice session to receive it.
    if (member.user?.bot && member.id === client.user?.id &&
        oldState.channelId && !newState.channelId) {
        await leaveVoiceChannel(guildId).catch(() => {});
        deleteQueue(guildId);
    }

    // Unmute VC (via ,unmutevc setup)
    const db2 = getGuildDb(guildId);
    const unmuteVcId = db2.get('unmuteVcChannelId');
    if (unmuteVcId && newState.channelId === unmuteVcId && oldState.channelId !== unmuteVcId) {
        if (member.voice.serverMute || member.voice.selfMute) {
            try { await member.voice.setMute(false); } catch {}
        }
        setTimeout(async () => {
            try { if (member.voice.channel?.id === unmuteVcId) await member.voice.disconnect(); } catch {}
        }, 5000);
    }

    // Unmute channel (legacy config system)
    const unmuteChId = getSetting(guildId, 'unmuteChannelId');
    if (unmuteChId && newState.channelId === unmuteChId && oldState.channelId !== unmuteChId) {
        if (member.voice.serverMute || member.voice.selfMute) {
            try { await member.voice.setMute(false); } catch {}
        }
        setTimeout(async () => {
            try { if (member.voice.channel?.id === unmuteChId) await member.voice.disconnect(); } catch {}
        }, 5000);
    }

    // VoiceMaster join-to-create
    if (newState.channelId) {
        const db = getGuildDb(guildId);
        const vm = db.get('voiceMaster', {});
        if (vm.joinChannelId && newState.channelId === vm.joinChannelId)
            await handleVoiceMasterJoin(member, newState).catch(() => {});
    }

    // VoiceMaster empty-channel cleanup
    if (oldState.channelId && tempVCOwners.has(oldState.channelId))
        await handleVoiceMasterLeave(oldState).catch(() => {});

    // Voice time tracking
    await trackVoiceTime(oldState, newState).catch(() => {});

    // TOPVC voice/stream/camera tracking
    await trackTopVcVoiceState(oldState, newState, client).catch(() => {});

    // Logging voice state
    await logOnVoiceStateUpdate(oldState, newState).catch(() => {});

    // Track giveaway voice time for active giveaways with required_voice
    const gwUserId = member.id;
    const guildId2 = newState.guild?.id || oldState.guild?.id;
    if (guildId2) {
        const wasInVc = !!oldState.channelId;
        const isInVc  = !!newState.channelId;
        if (!wasInVc && isInVc)  trackGiveawayVoice(guildId2, gwUserId, 'join');
        if (wasInVc && !isInVc)  trackGiveawayVoice(guildId2, gwUserId, 'leave');
        if (wasInVc && isInVc && oldState.channelId !== newState.channelId) {
            trackGiveawayVoice(guildId2, gwUserId, 'leave');
            trackGiveawayVoice(guildId2, gwUserId, 'join');
        }
    }
});

// ══════════════════════════════════════════════════════════
//  GUILD MEMBER ADD
// ══════════════════════════════════════════════════════════
client.on('guildMemberAdd', async (member) => {
    await handleMemberJoin(member).catch(() => {});
    await stickyOnJoin(member).catch(() => {});
    await triggerWelcome(member).catch(() => {});
    await handleAutoRoleJoin(member).catch(() => {});
    await logOnGuildMemberAdd(member).catch(() => {});
});

// ══════════════════════════════════════════════════════════
//  GUILD MEMBER REMOVE  (save roles for sticky + backup)
// ══════════════════════════════════════════════════════════
client.on('guildMemberRemove', async (member) => {
    try { stickyOnLeave(member); } catch {}
    try { backupMemberRoles(member); } catch {}
    await triggerGoodbye(member).catch(() => {});
    await logOnGuildMemberRemove(member).catch(() => {});
});

// ══════════════════════════════════════════════════════════
//  GUILD MEMBER UPDATE  (forced nicknames)
// ══════════════════════════════════════════════════════════
client.on('guildMemberUpdate', async (oldMember, newMember) => {
    await onForcedNickUpdate(oldMember, newMember).catch(() => {});
    await logOnGuildMemberUpdate(oldMember, newMember).catch(() => {});

    // Boost detection
    const wasBoosting = !!oldMember.premiumSince;
    const isBoosting = !!newMember.premiumSince;
    if (!wasBoosting && isBoosting) await triggerBoost(newMember).catch(() => {});
      if (wasBoosting && !isBoosting) {
        await handleBoostRemoved(newMember).catch(() => {});
        // Track lost booster
        const db = getGuildDb(newMember.guild.id);
        const lost = db.get('lostBoosters', []);
        lost.push({ userId: newMember.id, tag: newMember.user.tag, timestamp: Date.now() });
        if (lost.length > 100) lost.shift();
        db.set('lostBoosters', lost);
      }
});

// ══════════════════════════════════════════════════════════
//  THREAD CREATE  (watch system)
// ══════════════════════════════════════════════════════════
client.on('threadCreate', async (thread) => {
    await onThreadCreate(thread).catch(() => {});
});

// ══════════════════════════════════════════════════════════
//  REACTION ADD / REMOVE  (reaction roles)
// ══════════════════════════════════════════════════════════
client.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot) return;
    if (reaction.partial) {
        try { await reaction.fetch(); } catch { return; }
    }
    if (reaction.message.partial) {
        try { await reaction.message.fetch(); } catch { return; }
    }
     await handleReactionAdd(reaction, user).catch(() => {});
     await reactionOnReactionAdd(reaction, user, client).catch(() => {});
     trackReactionAdd(reaction, user);
     await onStarboardReactionAdd(reaction, user).catch(() => {});
     await onClownboardReactionAdd(reaction, user).catch(() => {});
});

client.on('messageReactionRemove', async (reaction, user) => {
    if (user.bot) return;
    if (reaction.partial) {
        try { await reaction.fetch(); } catch { return; }
    }
    if (reaction.message.partial) {
        try { await reaction.message.fetch(); } catch { return; }
    }
    await handleReactionRemove(reaction, user).catch(() => {});
    trackReactionRemove(reaction, user);
    await onStarboardReactionRemove(reaction, user).catch(() => {});
    await onClownboardReactionRemove(reaction, user).catch(() => {});
});

// ══════════════════════════════════════════════════════════
//  GUILD CREATE  (bot joined a new server)
// ══════════════════════════════════════════════════════════
client.on('guildCreate', async (guild) => {
    if (!isGuildWhitelisted(guild.id)) {
        logger.warn('WHITELIST', `Leaving non-whitelisted guild: ${guild.name} (${guild.id})`);
        await guild.leave().catch(() => {});
        return;
    }
    await initGuild(guild).catch(() => {});
    logger.info('GUILD', `Joined new guild: ${guild.name} (${guild.id})`);
});

// ══════════════════════════════════════════════════════════
//  CHANNEL CREATE  (VC log)
// ══════════════════════════════════════════════════════════
let lastVCLog = 0;
client.on('channelCreate', async (channel) => {
    if (channel.type !== ChannelType.GuildVoice) return;
    if (tempVCOwners.has(channel.id)) return;
    const now = Date.now();
    if (now - lastVCLog < 50000) return;
    lastVCLog = now;
    const vcLogId = getSetting(channel.guild.id, 'vcLogChannelId');
    if (!vcLogId) return;
    const logCh = channel.guild.channels.cache.get(vcLogId);
    if (logCh) await logCh.send(`🎤 New voice channel created: **${channel.name}** — <#${channel.id}>`).catch(() => {});
});

client.on('channelCreate', async (channel) => {
    if (!channel.guild) return;
    try {
        await applyMutePermsToNewChannel(channel).catch(() => {});
        await applyJailPermsToNewChannel(channel).catch(() => {});
    } catch {}
    await logOnChannelCreate(channel).catch(() => {});
});

client.on('channelDelete', async (channel) => {
    if (!channel.guild) return;
    const db = getGuildDb(channel.guild.id);
    const unmuteId = db.get('unmuteVcChannelId');
    if (unmuteId && channel.id === unmuteId) {
        db.set('unmuteVcChannelId', null);
        logger.info('UNMUTEVC', `Unmute VC deleted in ${channel.guild.name}, cleared setting.`);
    }
    await logOnChannelDelete(channel).catch(() => {});
});

// ── Logging: Channel Update ──
client.on('channelUpdate', async (oldCh, newCh) => {
    await logOnChannelUpdate(oldCh, newCh).catch(() => {});
});

// ── Logging: Role Events ──
client.on('roleCreate', async (role) => await logOnRoleCreate(role).catch(() => {}));
client.on('roleDelete', async (role) => await logOnRoleDelete(role).catch(() => {}));
client.on('roleUpdate', async (oldRole, newRole) => await logOnRoleUpdate(oldRole, newRole).catch(() => {}));

// ── Logging: Invite Events ──
client.on('inviteCreate', async (invite) => await logOnInviteCreate(invite).catch(() => {}));
client.on('inviteDelete', async (invite) => await logOnInviteDelete(invite).catch(() => {}));

// ── Logging: Emoji Events ──
client.on('emojiCreate', async (emoji) => await logOnEmojiCreate(emoji).catch(() => {}));
client.on('emojiDelete', async (emoji) => await logOnEmojiDelete(emoji).catch(() => {}));
client.on('emojiUpdate', async (oldEmoji, newEmoji) => await logOnEmojiUpdate(oldEmoji, newEmoji).catch(() => {}));

// ══════════════════════════════════════════════════════════
// NAME / GUILD NAME HISTORY TRACKING (for ,names / ,gnames)
// ══════════════════════════════════════════════════════════
client.on('guildMemberUpdate', async (oldMember, newMember) => {
  if (oldMember.nickname !== newMember.nickname && newMember.nickname !== null) {
    const udb = getUserDb(newMember.guild.id, newMember.id);
    const history = udb.get('nameHistory', []);
    history.push({ name: newMember.nickname, time: Date.now() });
    if (history.length > 50) history.shift();
    udb.set('nameHistory', history);
  }
});

client.on('userUpdate', async (oldUser, newUser) => {
  if (oldUser.username !== newUser.username) {
    for (const guild of client.guilds.cache.values()) {
      const member = guild.members.cache.get(newUser.id);
      if (member) {
        const udb = getUserDb(guild.id, newUser.id);
        const history = udb.get('nameHistory', []);
        history.push({ name: newUser.username, time: Date.now() });
        if (history.length > 50) history.shift();
        udb.set('nameHistory', history);
      }
    }
  }
});

client.on('guildUpdate', async (oldGuild, newGuild) => {
  if (oldGuild.name !== newGuild.name) {
    const db = getGuildDb(newGuild.id);
    const history = db.get('nameHistory', []);
    history.push({ name: newGuild.name, time: Date.now() });
    if (history.length > 50) history.shift();
    db.set('nameHistory', history);
  }
});

// ══════════════════════════════════════════════════════════
// CHANNEL PINS UPDATE (for pin archival system)
// ══════════════════════════════════════════════════════════
client.on('channelPinsUpdate', async (channel, time) => {
  await onChannelPinsUpdate(channel, time).catch(() => {});
});


//  READY
// ══════════════════════════════════════════════════════════
client.once('clientReady', async () => {
    logger.info('BOT', `Logged in as ${client.user.tag}`);
    loadLegacyData();
    loadDictionary();
    initBlacktea(dictionary);
    scheduleNewDay();

    // custom status
client.user.setPresence({ status: 'online', activities: [{ name: 'x', type: ActivityType.Custom, state: 'hii' }] });

    // AntiNuke listeners
    setupAntiNukeListeners(client);

    // Register slash commands
    await registerSlashCommands(client);

    // Restore persistent timers
    await restoreJailTimers(client).catch(() => {});
    await restoreMuteTimers(client).catch(() => {});
    await restoreTempBans(client).catch(() => {});
    await restoreTempRoles(client).catch(() => {});
    await restoreReminders(client).catch(() => {});
    await restoreNukeSchedules(client).catch(() => {});
    await restoreGiveawayTimers(client).catch(() => {});

    // Whitelist check + initialize all known guilds
    for (const guild of client.guilds.cache.values()) {
        if (!isGuildWhitelisted(guild.id)) {
            logger.warn('WHITELIST', `Leaving non-whitelisted guild on startup: ${guild.name} (${guild.id})`);
            await guild.leave().catch(() => {});
            continue;
        }
        await initGuild(guild).catch(() => {});

        // Restore VoiceMaster interface
        const db = getGuildDb(guild.id);
        const vm = db.get('voiceMaster', {});
        if (vm.interfaceChannelId) {
            const ch = guild.channels.cache.get(vm.interfaceChannelId);
            if (ch) await sendOrUpdateVMInterface(ch, guild.id).catch(() => {});
        }
    }

    // Initial VC leaderboard update
    setTimeout(() => {
        for (const guild of client.guilds.cache.values()) updateVoiceLeaderboard(guild).catch(() => {});
    }, 5000);

    // Economy event scheduler
    for (const guild of client.guilds.cache.values()) {
      if (isModuleEnabled(guild.id, 'economy')) {
        scheduleRandomEvent(guild.id, client);
      }
    }

    // Counter updates every 10 minutes
    setInterval(() => {
        for (const guild of client.guilds.cache.values()) updateAllCounters(guild).catch(() => {});
    }, 10 * 60 * 1000);

    // TOPVC leaderboard refresh every 1 minute
    setInterval(() => {
        refreshTopVcLeaderboards(client).catch(() => {});
    }, 60000);


    logger.info('BOT', `Ready. Serving ${client.guilds.cache.size} guilds.`);
});

// Initialize music manager BEFORE login so Shoukaku's clientReady listener
// is registered before the event fires (Shoukaku.DiscordJS connector listens
// for 'clientReady' to start connecting to Lavalink nodes)
initMusicManager(client);

client.login(process.env.BOT_TOKEN);