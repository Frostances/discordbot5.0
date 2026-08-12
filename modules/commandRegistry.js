const { EmbedBuilder, PermissionsBitField } = require('discord.js');
const { base, COLORS } = require('../utils/embeds');
const { isBotOwner } = require('../modules/helpers');

// ══════════════════════════════════════════════════════════
// PERMISSION NAMES
// ══════════════════════════════════════════════════════════
const PERM_NAMES = {
  Administrator: 'Administrator',
  ManageGuild: 'Manage Server',
  ManageChannels: 'Manage Channels',
  ManageMessages: 'Manage Messages',
  ManageRoles: 'Manage Roles',
  ManageNicknames: 'Manage Nicknames',
  KickMembers: 'Kick Members',
  BanMembers: 'Ban Members',
  ModerateMembers: 'Moderate Members (Timeout)',
  ManageWebhooks: 'Manage Webhooks',
  ManageExpressions: 'Manage Expressions',
  ViewAuditLog: 'View Audit Log',
  MentionEveryone: 'Mention @everyone, @here, All Roles',
  ViewGuildInsights: 'View Server Insights',
  ManageEvents: 'Manage Events',
  ManageThreads: 'Manage Threads',
  CreatePublicThreads: 'Create Public Threads',
  CreatePrivateThreads: 'Create Private Threads',
  SendMessages: 'Send Messages',
  SendMessagesInThreads: 'Send Messages in Threads',
  CreateInstantInvite: 'Create Instant Invite',
  ChangeNickname: 'Change Nickname',
  ReadMessageHistory: 'Read Message History',
  AddReactions: 'Add Reactions',
  UseExternalEmojis: 'Use External Emojis',
  Connect: 'Connect (Voice)',
  Speak: 'Speak (Voice)',
  Video: 'Video',
  UseApplicationCommands: 'Use Application Commands',
  RequestToSpeak: 'Request to Speak',
  DeafenMembers: 'Deafen Members',
  MoveMembers: 'Move Members',
  MuteMembers: 'Mute Members',
  PrioritySpeaker: 'Priority Speaker',
  Stream: 'Video',
};

function fmtPerms(perms) {
  if (!perms || !perms.length) return 'None';
  return perms.map(p => `• ${PERM_NAMES[p] || p}`).join('\n');
}

// ══════════════════════════════════════════════════════════
// COMMAND REGISTRY
// ══════════════════════════════════════════════════════════
const COMMANDS = {
  // ══════════════════════════════════════════════════════════
  // MODERATION
  // ══════════════════════════════════════════════════════════
  moderation: {
    category: 'Moderation',
    commands: {
      ban: { desc: 'Ban a user from the server', usage: 'ban <user> [reason]', perms: ['BanMembers'] },
      kick: { desc: 'Kick a user from the server', usage: 'kick <user> [reason]', perms: ['KickMembers'] },
      unban: { desc: 'Unban a user', usage: 'unban <user-id>', perms: ['BanMembers'] },
      softban: { desc: 'Softban a user (ban + immediate unban)', usage: 'softban <user> [reason]', perms: ['BanMembers'] },
      hardban: { desc: 'Hardban a user (ban + delete all messages)', usage: 'hardban <user> [reason]', perms: ['BanMembers'] },
      tempban: { desc: 'Temporarily ban a user', usage: 'tempban <user> <duration> [reason]', perms: ['BanMembers'] },
      unbanall: { desc: 'Unban all banned users', usage: 'unbanall', perms: ['BanMembers'] },
      banlist: { desc: 'List all banned users', usage: 'banlist', perms: ['BanMembers'] },
      recentban: { desc: 'Show recently banned users', usage: 'recentban', perms: ['BanMembers'] },
      timeout: { desc: 'Timeout a user', usage: 'timeout <user> <duration> [reason]', perms: ['ModerateMembers'] },
      untimeout: { desc: 'Remove timeout from a user', usage: 'untimeout <user>', perms: ['ModerateMembers'] },
      timeoutlist: { desc: 'List timed out users', usage: 'timeoutlist', perms: ['ModerateMembers'] },
      mute: { desc: 'Mute a user', usage: 'mute <user> [reason]', perms: ['ModerateMembers'] },
      unmute: { desc: 'Unmute a user', usage: 'unmute <user>', perms: ['ModerateMembers'] },
      imute: { desc: 'Instant mute a user', usage: 'imute <user> [reason]', perms: ['ModerateMembers'] },
      iunmute: { desc: 'Instant unmute a user', usage: 'iunmute <user>', perms: ['ModerateMembers'] },
      rmute: { desc: 'Role mute a user', usage: 'rmute <user> [reason]', perms: ['ModerateMembers'] },
      runmute: { desc: 'Role unmute a user', usage: 'runmute <user>', perms: ['ModerateMembers'] },
      setupmute: { desc: 'Setup mute system', usage: 'setupmute', perms: ['ManageChannels'] },
      setupimute: { desc: 'Setup instant mute', usage: 'setupimute', perms: ['ManageChannels'] },
      setuprmute: { desc: 'Setup role mute', usage: 'setuprmute', perms: ['ManageChannels'] },
      jail: { desc: 'Jail a user', usage: 'jail <user> [reason]', perms: ['ModerateMembers'] },
      unjail: { desc: 'Unjail a user', usage: 'unjail <user>', perms: ['ModerateMembers'] },
      jaillist: { desc: 'List jailed users', usage: 'jaillist', perms: ['ModerateMembers'] },
      setupjail: { desc: 'Setup jail system', usage: 'setupjail', perms: ['ManageChannels'] },
      jailed: { desc: 'Show jailed users', usage: 'jailed', perms: ['ModerateMembers'] },
      purge: { desc: 'Purge messages', usage: 'purge <amount> [user]', perms: ['ManageMessages'] },
      lock: { desc: 'Lock a channel', usage: 'lock [channel]', perms: ['ManageChannels'] },
      unlock: { desc: 'Unlock a channel', usage: 'unlock [channel]', perms: ['ManageChannels'] },
      unlockall: { desc: 'Unlock all channels', usage: 'unlockall', perms: ['ManageChannels'] },
      lockdown: { desc: 'Server lockdown', usage: 'lockdown', perms: ['ManageChannels'] },
      hide: { desc: 'Hide a channel', usage: 'hide [channel]', perms: ['ManageChannels'] },
      unhide: { desc: 'Unhide a channel', usage: 'unhide [channel]', perms: ['ManageChannels'] },
      talk: { desc: 'Toggle talk permission', usage: 'talk [channel]', perms: ['ManageChannels'] },
      slowmode: { desc: 'Set slowmode', usage: 'slowmode <duration>', perms: ['ManageChannels'] },
      topic: { desc: 'Set channel topic', usage: 'topic <text>', perms: ['ManageChannels'] },
      chanrename: { desc: 'Rename a channel', usage: 'chanrename <channel> <name>', perms: ['ManageChannels'] },
      revokefiles: { desc: 'Revoke file permissions', usage: 'revokefiles [channel]', perms: ['ManageChannels'] },
      thread: { desc: 'Thread management', usage: 'thread <create|archive|delete>', perms: ['ManageThreads'] },
      nick: { desc: 'Change nickname', usage: 'nick <user> <nickname>', perms: ['ManageNicknames'] },
      rename: { desc: 'Rename a user', usage: 'rename <user> <name>', perms: ['ManageNicknames'] },
      forcenickname: { desc: 'Force nickname', usage: 'forcenickname <user> <nickname>', perms: ['ManageNicknames'] },
      stripstaff: { desc: 'Strip staff roles', usage: 'stripstaff <user>', perms: ['ManageRoles'] },
      role: { desc: 'Role management', usage: 'role <add|remove|create|delete> <role> [user]', perms: ['ManageRoles'] },
      temprole: { desc: 'Temporary role', usage: 'temprole <user> <role> <duration>', perms: ['ManageRoles'] },
      stickyrole: { desc: 'Sticky role management', usage: 'stickyrole <set|remove|list>', perms: ['ManageRoles'] },
      moveall: { desc: 'Move all users', usage: 'moveall <from-channel> <to-channel>', perms: ['MoveMembers'] },
      drag: { desc: 'Drag a user', usage: 'drag <user> <channel>', perms: ['MoveMembers'] },
      note: { desc: 'Add a moderation note', usage: 'note <user> <text>', perms: ['ModerateMembers'] },
      notes: { desc: 'View notes', usage: 'notes <user>', perms: ['ModerateMembers'] },
      history: { desc: 'View moderation history', usage: 'history <user>', perms: ['ModerateMembers'] },
      case: { desc: 'View case details', usage: 'case <case-id>', perms: ['ModerateMembers'] },
      reason: { desc: 'Edit case reason', usage: 'reason <case-id> <reason>', perms: ['ModerateMembers'] },
      proof: { desc: 'Add proof to case', usage: 'proof <case-id> <link>', perms: ['ModerateMembers'] },
      modstats: { desc: 'Moderator statistics', usage: 'modstats [user]', perms: ['ModerateMembers'] },
      warnings: { desc: 'View warnings', usage: 'warnings <user>', perms: ['ModerateMembers'] },
      clearwarn: { desc: 'Clear a warning', usage: 'clearwarn <user> <number>', perms: ['ModerateMembers'] },
      clearallwarns: { desc: 'Clear all warnings', usage: 'clearallwarns <user>', perms: ['ModerateMembers'] },
      clearallserverwarns: { desc: 'Clear all server warnings', usage: 'clearallserverwarns', perms: ['Administrator'] },
      expirewarn: { desc: 'Set warning expiry', usage: 'expirewarn <user> <number> <duration>', perms: ['ModerateMembers'] },
      caselog: { desc: 'Case log', usage: 'caselog <case-id>', perms: ['ModerateMembers'] },
      moderationhistory: { desc: 'Moderation history', usage: 'moderationhistory <user>', perms: ['ModerateMembers'] },
      warn: { desc: 'Warn a user', usage: 'warn <user> <reason>', perms: ['ModerateMembers'] },
      remind: { desc: 'Set a reminder', usage: 'remind <duration> <text>', perms: ['SendMessages'] },
      reminders: { desc: 'View reminders', usage: 'reminders', perms: ['SendMessages'] },
      naughty: { desc: 'NSFW toggle', usage: 'naughty <on|off>', perms: ['ManageChannels'] },
      permissions: { desc: 'View permissions', usage: 'permissions <user> [channel]', perms: ['ManageRoles'] },
      dump: { desc: 'Dump channel data', usage: 'dump <type>', perms: ['ManageMessages'] },
      newmembers: { desc: 'View new members', usage: 'newmembers [count]', perms: ['KickMembers'] },
      clearinvites: { desc: 'Clear invites', usage: 'clearinvites', perms: ['ManageGuild'] },
      nuke: { desc: 'Nuke a channel', usage: 'nuke [channel]', perms: ['ManageChannels'] },
    },
  },

  // ══════════════════════════════════════════════════════════
  // INFORMATION (25 search/utility commands moved here from Fun)
  // ══════════════════════════════════════════════════════════
  information: {
    category: 'Information',
    commands: {
      ping: { desc: 'Check bot latency', usage: 'ping', perms: [] },
      botstats: { desc: 'Bot statistics', usage: 'botstats', perms: [] },
      userinfo: { desc: 'User information', usage: 'userinfo [user]', perms: [] },
      serverinfo: { desc: 'Server information', usage: 'serverinfo', perms: [] },
      avatar: { desc: 'Get user avatar', usage: 'avatar [user]', perms: [] },
      seen: { desc: 'When a user was last seen', usage: 'seen <user>', perms: [] },
      membercount: { desc: 'Server member count', usage: 'membercount', perms: [] },
      roleinfo: { desc: 'Role information', usage: 'roleinfo <role>', perms: [] },
      channelinfo: { desc: 'Channel information', usage: 'channelinfo [channel]', perms: [] },
      serveravatar: { desc: 'Server avatar', usage: 'serveravatar', perms: [] },
      serverbanner: { desc: 'Server banner', usage: 'serverbanner', perms: [] },
      banner: { desc: 'User banner', usage: 'banner [user]', perms: [] },
      guildicon: { desc: 'Guild icon', usage: 'guildicon', perms: [] },
      guildbanner: { desc: 'Guild banner', usage: 'guildbanner', perms: [] },
      splash: { desc: 'Guild splash', usage: 'splash', perms: [] },
      sticker: { desc: 'Sticker info', usage: 'sticker <sticker>', perms: [] },
      rotate: { desc: 'Rotate image', usage: 'rotate <degrees> [url]', perms: [] },
      compress: { desc: 'Compress image', usage: 'compress [url]', perms: [] },
      invert: { desc: 'Invert image colors', usage: 'invert [url]', perms: [] },
      emoji: { desc: 'Emoji info', usage: 'emoji <emoji>', perms: [] },
      birthday: { desc: 'Birthday management', usage: 'birthday <set|view|list>', perms: [] },
      timezone: { desc: 'Timezone info', usage: 'timezone [user]', perms: [] },
      inviteinfo: { desc: 'Invite information', usage: 'inviteinfo <code>', perms: [] },
      boosters: { desc: 'List boosters', usage: 'boosters', perms: [] },
      boostersLost: { desc: 'List lost boosters', usage: 'boosters lost', perms: [] },
      roles: { desc: 'List roles', usage: 'roles', perms: [] },
      emotes: { desc: 'List emotes', usage: 'emotes', perms: [] },
      hex: { desc: 'Hex color info', usage: 'hex <color>', perms: [] },
      bots: { desc: 'List bots', usage: 'bots', perms: [] },
      highlight: { desc: 'Highlight words', usage: 'highlight <add|remove|list> <word>', perms: [] },
      lyrics: { desc: 'Search song lyrics', usage: 'lyrics <song>', perms: [] },
      duckduckgo: { desc: 'DuckDuckGo search', usage: 'duckduckgo <query>', perms: [] },
      duckduckgoimage: { desc: 'DuckDuckGo image search', usage: 'duckduckgoimage <query>', perms: [] },
      reverseimage: { desc: 'Reverse image search', usage: 'reverseimage [url]', perms: [] },
      image: { desc: 'Image search', usage: 'image <query>', perms: [] },
      book: { desc: 'Search books', usage: 'book <query>', perms: [] },
      manga: { desc: 'Search manga', usage: 'manga <title>', perms: [] },
      anime: { desc: 'Search anime', usage: 'anime <title>', perms: [] },
      character: { desc: 'Search anime character', usage: 'character <name>', perms: [] },
      tvshow: { desc: 'Search TV shows', usage: 'tvshow <title>', perms: [] },
      game: { desc: 'Search games', usage: 'game <title>', perms: [] },
      movie: { desc: 'Search movies', usage: 'movie <title>', perms: [] },
      movieexpand: { desc: 'Expanded movie info', usage: 'movieexpand <title>', perms: [] },
      ocr: { desc: 'OCR text from image', usage: 'ocr [url]', perms: [] },
      ocrtr: { desc: 'OCR + translate', usage: 'ocrtr [url] [lang]', perms: [] },
      wolfram: { desc: 'WolframAlpha query', usage: 'wolfram <query>', perms: [] },
      embedcode: { desc: 'Get embed JSON', usage: 'embedcode <message-link>', perms: [] },
      charinfo: { desc: 'Character unicode info', usage: 'charinfo <text>', perms: [] },
      color: { desc: 'Color info', usage: 'color <hex>', perms: [] },
      jumbo: { desc: 'Jumbo emoji', usage: 'jumbo <emoji>', perms: [] },
      invites: { desc: 'Server invites', usage: 'invites', perms: ['ManageGuild'] },
      wikihow: { desc: 'WikiHow search', usage: 'wikihow <query>', perms: [] },
      brainly: { desc: 'Brainly search', usage: 'brainly <query>', perms: [] },
      shazam: { desc: 'Identify song', usage: 'shazam [url]', perms: [] },
      translate: { desc: 'Translate text', usage: 'translate [from] <to> <text>', perms: [] },
      names: { desc: 'User name history', usage: 'names [user]', perms: [] },
      gnames: { desc: 'Guild name history', usage: 'gnames [guild-id]', perms: ['ManageGuild'] },
      topcommands: { desc: 'Most used commands', usage: 'topcommands', perms: [] },
      firstmessage: { desc: 'First message in channel', usage: 'firstmessage [channel]', perms: [] },
    },
  },

  // ══════════════════════════════════════════════════════════
  // FUN
  // ══════════════════════════════════════════════════════════
  fun: {
    category: 'Fun',
    commands: {
      blacktea: { desc: '3-letter word game', usage: 'blacktea', perms: [] },
      quote: { desc: 'Quote a message', usage: 'quote [message-link]', perms: [] },
      tictactoe: { desc: 'Tic-tac-toe game', usage: 'tictactoe <@user>', perms: [] },
      giphy: { desc: 'Search GIFs', usage: 'giphy <keyword>', perms: [] },
      steal: { desc: 'Steal an emote', usage: 'steal [message-link]', perms: [] },
      tone: { desc: 'Analyze text toxicity', usage: 'tone <text>', perms: [] },
      tags: { desc: 'Tag system', usage: 'tags <name|add|edit|remove|list>', perms: [] },
      tts: { desc: 'Text to speech', usage: 'tts [lang] <text>', perms: [] },
      ttschannel: { desc: 'TTS in voice channel', usage: 'ttschannel <text>', perms: [] },
      lego: { desc: 'Legofy image', usage: 'lego [url]', perms: [] },
      makegif: { desc: 'Video to GIF', usage: 'makegif [url]', perms: [] },
      transparent: { desc: 'Remove background', usage: 'transparent [url]', perms: [] },
      juul: { desc: 'Server juul', usage: 'juul [hit|pass|toggle|stats|flavor|steal]', perms: [] },
      'juul hit': { desc: 'Hit the juul', usage: 'juul hit', perms: [] },
      'juul pass': { desc: 'Pass the juul', usage: 'juul pass <@user>', perms: [] },
      'juul toggle': { desc: 'Toggle juul', usage: 'juul toggle', perms: ['ManageGuild'] },
      'juul stats': { desc: 'Juul stats', usage: 'juul stats', perms: [] },
      'juul flavor': { desc: 'Set juul flavor', usage: 'juul flavor <flavor>', perms: ['ManageGuild'] },
      'juul steal': { desc: 'Steal the juul', usage: 'juul steal', perms: [] },
      randomhex: { desc: 'Random hex color', usage: 'randomhex', perms: [] },
      addemote: { desc: 'Add emoji to server', usage: 'addemote <emoji>', perms: ['ManageExpressions'] },
      rps: { desc: 'Rock paper scissors', usage: 'rps <rock|paper|scissors>', perms: [] },
      choose: { desc: 'Random choice', usage: 'choose <opt1>, <opt2>', perms: [] },
      wouldyourather: { desc: 'Would you rather', usage: 'wouldyourather', perms: [] },
      makemp3: { desc: 'Extract audio', usage: 'makemp3 [url]', perms: [] },
      clearnames: { desc: 'Clear your name history', usage: 'clearnames', perms: [] },
      cleargnames: { desc: 'Clear guild name history', usage: 'cleargnames', perms: ['ManageGuild'] },
      afkmentions: { desc: 'AFK mentions', usage: 'afkmentions', perms: [] },
      poll: { desc: 'Create a poll', usage: 'poll <time> <question>', perms: [] },
      chatgpt: { desc: 'Ask AI', usage: 'chatgpt <question>', perms: [] },
      uwu: { desc: 'Uwuify text', usage: 'uwu <text>', perms: [] },
      freaky: { desc: 'Freakify text', usage: 'freaky <text>', perms: [] },
      quickpoll: { desc: 'Quick up/down poll', usage: 'quickpoll [message-id]', perms: [] },
    },
  },

  // ══════════════════════════════════════════════════════════
  // CONFIGURATION
  // ══════════════════════════════════════════════════════════
  configuration: {
    category: 'Configuration',
    commands: {
      config: { desc: 'Bot configuration', usage: 'config <view|set|reset>', perms: ['ManageGuild'] },
      settings: { desc: 'Bot settings', usage: 'settings <key> [value]', perms: ['ManageGuild'] },
      sprefix: { desc: 'Server prefix', usage: 'sprefix [set|reset] [prefix]', perms: ['ManageGuild'] },
      module: { desc: 'Toggle modules', usage: 'module <module> [on|off]', perms: ['ManageGuild'] },
      modules: { desc: 'List modules', usage: 'modules', perms: ['ManageGuild'] },
      log: { desc: 'Logging setup', usage: 'log <channel|event|toggle>', perms: ['ManageGuild'] },
      welcome: { desc: 'Welcome messages', usage: 'welcome <channel|message|toggle>', perms: ['ManageGuild'] },
      goodbye: { desc: 'Goodbye messages', usage: 'goodbye <channel|message|toggle>', perms: ['ManageGuild'] },
      boosts: { desc: 'Boost messages', usage: 'boosts <channel|message|toggle>', perms: ['ManageGuild'] },
      levelupmsg: { desc: 'Level up messages', usage: 'levelupmsg <channel|message|toggle>', perms: ['ManageGuild'] },
      automod: { desc: 'AutoMod settings', usage: 'automod <toggle|setup>', perms: ['ManageGuild'] },
      antinuke: { desc: 'Anti-nuke settings', usage: 'antinuke <toggle|setup>', perms: ['Administrator'] },
      antiraid: { desc: 'Anti-raid settings', usage: 'antiraid <toggle|setup>', perms: ['Administrator'] },
      autorole: { desc: 'Auto-role setup', usage: 'autorole <role|toggle>', perms: ['ManageRoles'] },
      buttonrole: { desc: 'Button roles', usage: 'buttonrole <setup>', perms: ['ManageRoles'] },
      reactionrole: { desc: 'Reaction roles', usage: 'reactionrole <setup>', perms: ['ManageRoles'] },
      ticket: { desc: 'Ticket system', usage: 'ticket <setup|create>', perms: ['ManageChannels'] },
      voicemaster: { desc: 'VoiceMaster setup', usage: 'voicemaster setup', perms: ['ManageChannels'] },
      vc: { desc: 'Voice channel commands', usage: 'vc <lock|unlock|rename|limit|claim|info|transfer|kick|ban|unban|mute|unmute|delete>', perms: [] },
      vcservermute: { desc: 'VC server mute roles', usage: 'vcservermute <add|remove|list>', perms: ['ManageRoles'] },
      unmutevc: { desc: 'Unmute VC setup', usage: 'unmutevc setup', perms: ['ManageChannels'] },
      topvc: { desc: 'Top VC leaderboard', usage: 'topvc', perms: [] },
      topvcclear: { desc: 'Clear VC stats', usage: 'topvcclear', perms: ['ManageGuild'] },
      counter: { desc: 'Channel counters', usage: 'counter <setup|list>', perms: ['ManageChannels'] },
      levels: { desc: 'Level system', usage: 'levels [leaderboard|rank]', perms: [] },
      setxp: { desc: 'Set user XP', usage: 'setxp <user> <amount>', perms: ['ManageGuild'] },
      removexp: { desc: 'Remove user XP', usage: 'removexp <user> <amount>', perms: ['ManageGuild'] },
      setlevel: { desc: 'Set user level', usage: 'setlevel <user> <level>', perms: ['ManageGuild'] },
      giveaway: { desc: 'Giveaway system', usage: 'giveaway <create|end|reroll>', perms: ['ManageMessages'] },
      gw: { desc: 'Giveaway alias', usage: 'gw <create|end|reroll>', perms: ['ManageMessages'] },
      gw2: { desc: 'Giveaway alias 2', usage: 'gw2 <create|end|reroll>', perms: ['ManageMessages'] },
      giveaways: { desc: 'Giveaway management', usage: 'giveaways <list>', perms: ['ManageMessages'] },
      fakepermissions: { desc: 'Fake permissions', usage: 'fakepermissions <user> <perm>', perms: ['Administrator'] },
      restrictcommand: { desc: 'Restrict commands', usage: 'restrictcommand <command> <role>', perms: ['ManageGuild'] },
      staff: { desc: 'Staff system', usage: 'staff <role|list>', perms: ['ManageGuild'] },
      botadmin: { desc: 'Bot admin role', usage: 'botadmin <set|remove|view>', perms: ['ManageGuild'] },
      godadmin: { desc: 'God admin (owner only)', usage: 'godadmin <@user>', perms: [] },
      customize: { desc: 'Customize bot (owner)', usage: 'customize <option>', perms: [] },
      invoke: { desc: 'Invoke command', usage: 'invoke <command>', perms: ['ManageGuild'] },
      ce: { desc: 'Custom embed', usage: 'ce <embed-code>', perms: ['ManageMessages'] },
      reaction: { desc: 'Reaction triggers', usage: 'reaction <add|remove|list>', perms: ['ManageMessages'] },
      previousreact: { desc: 'Previous reaction', usage: 'previousreact', perms: ['ManageMessages'] },
      noselfreact: { desc: 'No self react', usage: 'noselfreact', perms: ['ManageMessages'] },
      filter: { desc: 'Message filters', usage: 'filter <add|remove|list>', perms: ['ManageMessages'] },
      snipe: { desc: 'Snipe deleted message', usage: 'snipe [count]', perms: [] },
      editsnipe: { desc: 'Snipe edited message', usage: 'editsnipe', perms: [] },
      reactionsnipe: { desc: 'Snipe removed reaction', usage: 'reactionsnipe', perms: [] },
      reactionhistory: { desc: 'Reaction history', usage: 'reactionhistory', perms: [] },
      clearsnipe: { desc: 'Clear snipe cache', usage: 'clearsnipe', perms: ['ManageMessages'] },
      timer: { desc: 'Set a timer', usage: 'timer <duration> <text>', perms: [] },
      guessword: { desc: 'Guess the word', usage: 'guessword [category]', perms: [] },
      swears: { desc: 'Swear stats', usage: 'swears [leaderboard]', perms: [] },
      streaks: { desc: 'Streak stats', usage: 'streaks [leaderboard]', perms: [] },
      roleplay: { desc: 'Toggle roleplay', usage: 'roleplay', perms: ['ManageGuild'] },
      stats: { desc: 'User stats', usage: 'stats [user]', perms: [] },
      voicetime: { desc: 'Voice time stats', usage: 'voicetime [user]', perms: [] },
      messages: { desc: 'Message stats', usage: 'messages [user]', perms: [] },
      streamtime: { desc: 'Stream time stats', usage: 'streamtime [user]', perms: [] },
      cameratime: { desc: 'Camera time stats', usage: 'cameratime [user]', perms: [] },
      statsclear: { desc: 'Clear stats', usage: 'statsclear', perms: ['ManageGuild'] },
      media: { desc: 'Media commands', usage: 'media <command>', perms: [] },
      music: { desc: 'Music commands', usage: 'music <play|skip|queue>', perms: [] },
      play: { desc: 'Play music', usage: 'play <query>', perms: [] },
      skip: { desc: 'Skip song', usage: 'skip', perms: [] },
      queue: { desc: 'Music queue', usage: 'queue', perms: [] },
      volume: { desc: 'Set volume', usage: 'volume <1-100>', perms: [] },
      pause: { desc: 'Pause music', usage: 'pause', perms: [] },
      resume: { desc: 'Resume music', usage: 'resume', perms: [] },
      stop: { desc: 'Stop music', usage: 'stop', perms: [] },
      disconnect: { desc: 'Disconnect bot', usage: 'disconnect', perms: [] },
      nowplaying: { desc: 'Now playing', usage: 'nowplaying', perms: [] },
      shuffle: { desc: 'Shuffle queue', usage: 'shuffle', perms: [] },
      repeat: { desc: 'Repeat mode', usage: 'repeat <mode>', perms: [] },
      fastforward: { desc: 'Fast forward', usage: 'fastforward <seconds>', perms: [] },
      rewind: { desc: 'Rewind', usage: 'rewind <seconds>', perms: [] },
      afk: { desc: 'Set AFK status', usage: 'afk [reason]', perms: [] },
      help: { desc: 'Show help', usage: 'help [command|category]', perms: [] },
    },
  },

  // ══════════════════════════════════════════════════════════
  // SERVER MANAGEMENT (NEW CATEGORY)
  // ══════════════════════════════════════════════════════════
  servermanagement: {
    category: 'Server Management',
    commands: {
      autoresponder: { desc: 'Auto-reply triggers', usage: 'autoresponder <add|remove|update|list|role|exclusive|variables|reset>', perms: ['ManageChannels'] },
      pagination: { desc: 'Multi-embed pagination', usage: 'pagination <set|add|remove|update|delete|list|reset|restorereactions>', perms: ['ManageMessages'] },
      enablecommand: { desc: 'Enable a command', usage: 'enablecommand <channel|member|all> <command>', perms: ['ManageChannels'] },
      disablecommand: { desc: 'Disable a command', usage: 'disablecommand <channel|member|all> <command>', perms: ['ManageChannels'] },
      copydisabled: { desc: 'Copy disabled settings', usage: 'copydisabled <old-channel> <new-channel>', perms: ['ManageChannels'] },
      enableevent: { desc: 'Enable an event', usage: 'enableevent <channel|all> <event>', perms: ['ManageChannels'] },
      disableevent: { desc: 'Disable an event', usage: 'disableevent <channel|all> <event>', perms: ['ManageChannels'] },
      enablemodule: { desc: 'Enable a module', usage: 'enablemodule <channel|all> <module>', perms: ['ManageChannels'] },
      disablemodule: { desc: 'Disable a module', usage: 'disablemodule <channel|all> <module>', perms: ['ManageChannels'] },
      ignore: { desc: 'Ignore member/channel', usage: 'ignore <add|remove|list> <member|channel>', perms: ['Administrator'] },
      seticon: { desc: 'Set guild icon', usage: 'seticon <url>', perms: ['ManageGuild'] },
      setsplashbackground: { desc: 'Set guild splash', usage: 'setsplashbackground <url>', perms: ['ManageGuild'] },
      setbanner: { desc: 'Set guild banner', usage: 'setbanner <url>', perms: ['ManageGuild'] },
      pin: { desc: 'Pin a message', usage: 'pin [message-link|id]', perms: ['ManageMessages'] },
      unpin: { desc: 'Unpin a message', usage: 'unpin [message-link|id]', perms: ['ManageMessages'] },
      pins: { desc: 'Pin archival system', usage: 'pins <config|set|reset|archive|unpin|channel>', perms: ['ManageGuild'] },
      webhook: { desc: 'Webhook management', usage: 'webhook <create|delete|list|send|edit|lock|unlock>', perms: ['ManageWebhooks'] },
    },
  },
};

// ══════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════
function getCommand(name) {
  for (const category of Object.values(COMMANDS)) {
    if (category.commands[name]) return { ...category.commands[name], name, category: category.category };
  }
  return null;
}

function getCommandsByCategory(categoryName) {
  for (const category of Object.values(COMMANDS)) {
    if (category.category.toLowerCase() === categoryName.toLowerCase()) {
      return Object.entries(category.commands).map(([name, data]) => ({ name, ...data }));
    }
  }
  return [];
}

function getAllCategories() {
  return Object.values(COMMANDS).map(c => c.category);
}

function getAllCommands() {
  const all = [];
  for (const category of Object.values(COMMANDS)) {
    for (const [name, data] of Object.entries(category.commands)) {
      all.push({ name, ...data });
    }
  }
  return all;
}

function buildHelpEmbed(categoryName, prefix = ',') {
  const category = Object.values(COMMANDS).find(c => c.category.toLowerCase() === categoryName.toLowerCase());
  if (!category) return base(COLORS.error).setTitle('❌ Category Not Found').setDescription('Use `help` to see available categories.');
  const embed = base(COLORS.primary).setTitle(`${category.category} Commands`).setDescription(`Prefix: \`${prefix}\``);
  const fields = Object.entries(category.commands).map(([name, data]) => ({
    name: `${prefix}${name}`,
    value: `${data.desc}\n${data.usage ? `Usage: \`${prefix}${data.usage}\`` : ''}`,
    inline: false,
  }));
  if (fields.length <= 25) embed.addFields(fields);
  else {
    for (let i = 0; i < fields.length; i += 25) embed.addFields(fields.slice(i, i + 25));
  }
  return embed;
}

function buildCommandEmbed(commandName, prefix = ',') {
  const cmd = getCommand(commandName);
  if (!cmd) return base(COLORS.error).setTitle('❌ Command Not Found').setDescription(`Command \`${commandName}\` not found.`);
  const embed = base(COLORS.primary).setTitle(`${prefix}${cmd.name}`)
    .setDescription(cmd.desc)
    .addFields(
      { name: 'Usage', value: `\`${prefix}${cmd.usage}\``, inline: false },
      { name: 'Category', value: cmd.category, inline: true },
      { name: 'Permissions', value: fmtPerms(cmd.perms) || 'None', inline: true },
    );
  return embed;
}

module.exports = {
  COMMANDS,
  getCommand,
  getCommandsByCategory,
  getAllCategories,
  getAllCommands,
  buildHelpEmbed,
  buildCommandEmbed,
};