/**
 * music.js — All music commands (28 commands)
 * Lavalink-based audio streaming via Shoukaku
 */

const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const {
  getShoukaku, getPlayer, hasPlayer, getBestNode,
  getVoiceConnection, isPlayerPlaying,
  formatDuration, formatTrack,
  PRESETS, PRESET_NAMES,
  getActiveFilters, addActiveFilter, removeActiveFilter, clearActiveFilters,
  getCombinedFilters,
  getQueue, setQueue, clearQueue, deleteQueue,
  LOOP_MODES, getNextLoopMode,
  setupPlayerEvents, resolveQuery,
  isLavalinkReady, getNodeStatus, getConnectionErrors,
  leaveVoiceChannel,
} = require('./musicManager');
const logger = require('../utils/logger');

// ══════════════════════════════════════════════════════════
// EMBED HELPERS
// ══════════════════════════════════════════════════════════
function musicEmbed(title, description, color = '#5865F2') {
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(color)
    .setTimestamp();
}

function errorEmbed(text) {
  return musicEmbed('❌ Error', text, '#ED4245');
}

function successEmbed(text) {
  return musicEmbed('✅ Success', text, '#57F287');
}

// ══════════════════════════════════════════════════════════
// VOICE CHECK HELPER
// ══════════════════════════════════════════════════════════
function checkVoice(ctx) {
  const isInteraction = !!ctx.deferReply;
  const member = isInteraction ? ctx.member : ctx.member;
  const guild = isInteraction ? ctx.guild : ctx.guild;

  if (!member.voice.channel) {
    return { ok: false, reply: 'You must be in a voice channel to use music commands!' };
  }

  const botMember = guild.members.me;
  const voiceChannel = member.voice.channel;

  // Check bot permissions
  const permissions = voiceChannel.permissionsFor(botMember);
  if (!permissions.has(PermissionFlagsBits.Connect)) {
    return { ok: false, reply: "I don't have permission to connect to your voice channel!" };
  }
  if (!permissions.has(PermissionFlagsBits.Speak)) {
    return { ok: false, reply: "I don't have permission to speak in your voice channel!" };
  }

  if (!botMember.voice.channel) {
    return { ok: true, voiceChannel };
  }

  if (botMember.voice.channel.id !== member.voice.channel.id) {
    return { ok: false, reply: 'You must be in the same voice channel as the bot!' };
  }

  return { ok: true, voiceChannel };
}

async function sendReply(ctx, payload) {
  const isInteraction = !!ctx.deferReply;
  if (isInteraction) {
    if (ctx.replied || ctx.deferred) {
      return ctx.editReply(payload);
    }
    return ctx.reply(payload);
  }
  return ctx.reply(payload);
}

async function sendFollowUp(ctx, payload) {
  const isInteraction = !!ctx.deferReply;
  if (isInteraction) {
    return ctx.followUp(payload);
  }
  return ctx.channel.send(payload);
}

// ══════════════════════════════════════════════════════════
// COMMAND: PLAY
// ══════════════════════════════════════════════════════════
async function cmdPlay(ctx, args) {
  const check = checkVoice(ctx);
  if (!check.ok) return sendReply(ctx, { embeds: [errorEmbed(check.reply)] });

  const isInteraction = !!ctx.deferReply;
  const guild = isInteraction ? ctx.guild : ctx.guild;
  const guildId = guild.id;
  const voiceChannel = check.voiceChannel;

  // Parse args: play [next]
  let playNext = false;
  let queryIndex = 0;

  if (args[0]?.toLowerCase() === 'next') {
    playNext = true;
    queryIndex = 1;
  }

  const query = args.slice(queryIndex).join(' ').trim();
  if (!query) {
    return sendReply(ctx, { embeds: [errorEmbed('Please provide a song name or URL.\nUsage: `,play [next] <query>`')] });
  }

  if (isInteraction) await ctx.deferReply();

  const node = getBestNode();
  if (!node) {
    return sendReply(ctx, { embeds: [errorEmbed('No Lavalink nodes are available. Use `,music` to check your configuration.')] });
  }

  const result = await resolveQuery(node, query);
  if (!result || result.loadType === 'empty' || result.loadType === 'error') {
    return sendReply(ctx, { embeds: [errorEmbed('No results found for that query.')] });
  }

  let tracks = [];
  let playlistName = null;

  if (result.loadType === 'playlist') {
    tracks = result.data.tracks;
    playlistName = result.data.info?.name || 'Unknown Playlist';
  } else if (result.loadType === 'search') {
    if (!result.data || !result.data.length) {
      return sendReply(ctx, { embeds: [errorEmbed('No results found for that query.')] });
    }
    tracks = [result.data[0]];
  } else if (result.loadType === 'track') {
    tracks = [result.data];
  } else {
    return sendReply(ctx, { embeds: [errorEmbed('Unknown response from Lavalink.')] });
  }

  if (!tracks.length) {
    return sendReply(ctx, { embeds: [errorEmbed('No tracks found.')] });
  }

  // Get or create player
  let player = getPlayer(guildId);
  const botVoiceChannel = guild.members.me?.voice?.channel;
  const shoukakuConnection = getVoiceConnection(guildId);

  // Discord can remove the bot without the old Shoukaku object being removed
  // immediately. Clean that stale connection before trying to join again.
  if (shoukakuConnection &&
      (!botVoiceChannel || shoukakuConnection.channelId !== voiceChannel.id)) {
    await leaveVoiceChannel(guildId).catch(() => {});
    player = null;
  }

  if (!player) {
    try {
      player = await getShoukaku().joinVoiceChannel({
        guildId: guildId,
        channelId: voiceChannel.id,
        shardId: 0,
        deaf: true,
      });
      setupPlayerEvents(player, guildId);
    } catch (err) {
      logger.error('MUSIC', 'Failed to join voice channel:', err);
      return sendReply(ctx, { embeds: [errorEmbed("Failed to join the voice channel. Please check my permissions.")] });
    }
  }

  const queue = getQueue(guildId);

  if (playNext) {
    // Insert after current track
    const insertIndex = Math.max(0, queue.current + 1);
    queue.tracks.splice(insertIndex, 0, ...tracks);
  } else {
    queue.tracks.push(...tracks);
  }

  setQueue(guildId, queue);

  // If nothing is playing, start playing
  if (!isPlayerPlaying(player) && !player.paused) {
    if (queue.current === -1) {
      queue.current = 0;
    } else if (!playNext) {
      queue.current = queue.tracks.length - tracks.length;
    }

    const trackToPlay = queue.tracks[queue.current];
    if (!trackToPlay) {
      return sendReply(ctx, { embeds: [errorEmbed('Failed to load track. Please try again.')] });
    }

    try {
      await player.playTrack({ track: { encoded: trackToPlay.encoded } });
    } catch (err) {
      logger.error('MUSIC', 'Failed to play track:', err);
      return sendReply(ctx, { embeds: [errorEmbed('Failed to start playback. The track may be unavailable.')] });
    }

    const embed = musicEmbed('🎵 Now Playing', formatTrack(trackToPlay))
      .setThumbnail(trackToPlay.info.artworkUrl || null);
    return sendReply(ctx, { embeds: [embed] });
  }

  // Added to queue
  if (playlistName) {
    const embed = successEmbed(`Added **${tracks.length}** tracks from playlist **${playlistName}** to the queue!`);
    return sendReply(ctx, { embeds: [embed] });
  } else {
    const embed = successEmbed(`Added to queue: ${formatTrack(tracks[0])}`);
    return sendReply(ctx, { embeds: [embed] });
  }
}

// ══════════════════════════════════════════════════════════
// COMMAND: QUEUE
// ══════════════════════════════════════════════════════════
async function cmdQueue(ctx, args) {
  const guildId = ctx.guild.id;
  const queue = getQueue(guildId);

  if (!queue.tracks.length) {
    return sendReply(ctx, { embeds: [musicEmbed('📋 Queue', 'The queue is empty.')] });
  }

  const nowPlaying = queue.current >= 0 && queue.current < queue.tracks.length
    ? queue.tracks[queue.current]
    : null;

  let description = '';
  if (nowPlaying) {
    description += `**Now Playing:**\n${formatTrack(nowPlaying)}\n\n`;
  }

  // Show up to 20 upcoming tracks
  const upcoming = queue.tracks.slice(queue.current + 1, queue.current + 21);
  if (upcoming.length) {
    description += `**Up Next:**\n`;
    upcoming.forEach((track, i) => {
      description += `${formatTrack(track, queue.current + i + 2)}\n`;
    });
    if (queue.tracks.length > queue.current + 21) {
      description += `\n*...and ${queue.tracks.length - queue.current - 21} more tracks*`;
    }
  } else {
    description += '**No more tracks in queue.**';
  }

  const totalDuration = queue.tracks.reduce((sum, t) => sum + (t.info.length || 0), 0);
  const loopStatus = queue.loop !== 'off' ? ` | 🔁 Loop: **${queue.loop}**` : '';

  const embed = musicEmbed(`📋 Queue — ${queue.tracks.length} tracks${loopStatus}`, description)
    .setFooter({ text: `Total duration: ${formatDuration(totalDuration)}` });

  return sendReply(ctx, { embeds: [embed] });
}

// ══════════════════════════════════════════════════════════
// COMMAND: QUEUE SHUFFLE
// ══════════════════════════════════════════════════════════
async function cmdQueueShuffle(ctx) {
  const guildId = ctx.guild.id;
  const queue = getQueue(guildId);

  if (queue.tracks.length < 2) {
    return sendReply(ctx, { embeds: [errorEmbed('Not enough tracks to shuffle.')] });
  }

  if (queue.current < 0 || queue.current >= queue.tracks.length) {
    return sendReply(ctx, { embeds: [errorEmbed('No track is currently playing.')] });
  }

  // Keep current track in place, shuffle the rest
  const current = queue.tracks[queue.current];
  const rest = queue.tracks.filter((_, i) => i !== queue.current);

  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }

  queue.tracks = [current, ...rest];
  queue.current = 0;
  setQueue(guildId, queue);

  return sendReply(ctx, { embeds: [successEmbed('Queue shuffled! 🔀')] });
}

// ══════════════════════════════════════════════════════════
// COMMAND: QUEUE EMPTY
// ══════════════════════════════════════════════════════════
async function cmdQueueEmpty(ctx) {
  const guildId = ctx.guild.id;
  const queue = getQueue(guildId);

  if (!queue.tracks.length) {
    return sendReply(ctx, { embeds: [errorEmbed('The queue is already empty.')] });
  }

  // Keep only the currently playing track
  const current = queue.tracks[queue.current];
  queue.tracks = current ? [current] : [];
  queue.current = current ? 0 : -1;
  setQueue(guildId, queue);

  return sendReply(ctx, { embeds: [successEmbed('Queue cleared! All upcoming tracks have been removed.')] });
}

// ══════════════════════════════════════════════════════════
// COMMAND: QUEUE REMOVE
// ══════════════════════════════════════════════════════════
async function cmdQueueRemove(ctx, args) {
  const guildId = ctx.guild.id;
  const queue = getQueue(guildId);

  const pos = parseInt(args[0]);
  if (isNaN(pos) || pos < 1 || pos > queue.tracks.length) {
    return sendReply(ctx, { embeds: [errorEmbed(`Invalid position. Use a number between 1 and ${queue.tracks.length}.`)] });
  }

  // Convert to 0-based index
  const index = pos - 1;
  if (index === queue.current) {
    return sendReply(ctx, { embeds: [errorEmbed('Cannot remove the currently playing track. Use `,skip` instead.')] });
  }

  const removed = queue.tracks.splice(index, 1)[0];

  // Adjust current index if we removed before it
  if (index < queue.current) {
    queue.current--;
  }

  setQueue(guildId, queue);

  return sendReply(ctx, { embeds: [successEmbed(`Removed from queue: **${removed.info.title}**`)] });
}

// ══════════════════════════════════════════════════════════
// COMMAND: QUEUE MOVE
// ══════════════════════════════════════════════════════════
async function cmdQueueMove(ctx, args) {
  const guildId = ctx.guild.id;
  const queue = getQueue(guildId);

  if (queue.tracks.length < 2) {
    return sendReply(ctx, { embeds: [errorEmbed('Not enough tracks to move.')] });
  }

  const fromPos = parseInt(args[0]);
  const toPos = parseInt(args[1]);

  if (isNaN(fromPos) || isNaN(toPos)) {
    return sendReply(ctx, { embeds: [errorEmbed('Usage: `,queue move <from> <to>`')] });
  }

  if (fromPos < 1 || fromPos > queue.tracks.length || toPos < 1 || toPos > queue.tracks.length) {
    return sendReply(ctx, { embeds: [errorEmbed(`Positions must be between 1 and ${queue.tracks.length}.`)] });
  }

  const fromIndex = fromPos - 1;
  const toIndex = toPos - 1;

  if (fromIndex === queue.current || toIndex === queue.current) {
    return sendReply(ctx, { embeds: [errorEmbed('Cannot move the currently playing track.')] });
  }

  const [moved] = queue.tracks.splice(fromIndex, 1);
  queue.tracks.splice(toIndex, 0, moved);

  // Adjust current index
  if (fromIndex < queue.current && toIndex >= queue.current) {
    queue.current--;
  } else if (fromIndex > queue.current && toIndex <= queue.current) {
    queue.current++;
  }

  setQueue(guildId, queue);

  return sendReply(ctx, { embeds: [successEmbed(`Moved **${moved.info.title}** from position ${fromPos} to ${toPos}.`)] });
}

// ══════════════════════════════════════════════════════════
// COMMAND: FASTFORWARD
// ══════════════════════════════════════════════════════════
async function cmdFastForward(ctx, args) {
  const check = checkVoice(ctx);
  if (!check.ok) return sendReply(ctx, { embeds: [errorEmbed(check.reply)] });

  const guildId = ctx.guild.id;
  const player = getPlayer(guildId);

  if (!isPlayerPlaying(player)) {
    return sendReply(ctx, { embeds: [errorEmbed('Nothing is currently playing.')] });
  }

  const posStr = args[0];
  if (!posStr) {
    return sendReply(ctx, { embeds: [errorEmbed('Usage: `,fastforward <time>`\nExamples: `30s`, `2m`, `1:30`')] });
  }

  let ms = 0;
  // Parse formats: 30s, 2m, 1:30, 90
  if (/^\d+s$/i.test(posStr)) {
    ms = parseInt(posStr) * 1000;
  } else if (/^\d+m$/i.test(posStr)) {
    ms = parseInt(posStr) * 60 * 1000;
  } else if (/^\d+:\d+$/.test(posStr)) {
    const [m, s] = posStr.split(':').map(Number);
    ms = (m * 60 + s) * 1000;
  } else if (/^\d+$/.test(posStr)) {
    ms = parseInt(posStr) * 1000;
  } else {
    return sendReply(ctx, { embeds: [errorEmbed('Invalid time format. Use: `30s`, `2m`, `1:30`, or seconds.')] });
  }

  const newPosition = (player.position || 0) + ms;
  await player.seekTo(newPosition);

  return sendReply(ctx, { embeds: [successEmbed(`⏩ Fast-forwarded by **${formatDuration(ms)}**. Now at **${formatDuration(newPosition)}**.`)] });
}

// ══════════════════════════════════════════════════════════
// COMMAND: REWIND
// ══════════════════════════════════════════════════════════
async function cmdRewind(ctx, args) {
  const check = checkVoice(ctx);
  if (!check.ok) return sendReply(ctx, { embeds: [errorEmbed(check.reply)] });

  const guildId = ctx.guild.id;
  const player = getPlayer(guildId);

  if (!isPlayerPlaying(player)) {
    return sendReply(ctx, { embeds: [errorEmbed('Nothing is currently playing.')] });
  }

  const posStr = args[0];
  if (!posStr) {
    return sendReply(ctx, { embeds: [errorEmbed('Usage: `,rewind <time>`\nExamples: `30s`, `2m`, `1:30`')] });
  }

  let ms = 0;
  if (/^\d+s$/i.test(posStr)) {
    ms = parseInt(posStr) * 1000;
  } else if (/^\d+m$/i.test(posStr)) {
    ms = parseInt(posStr) * 60 * 1000;
  } else if (/^\d+:\d+$/.test(posStr)) {
    const [m, s] = posStr.split(':').map(Number);
    ms = (m * 60 + s) * 1000;
  } else if (/^\d+$/.test(posStr)) {
    ms = parseInt(posStr) * 1000;
  } else {
    return sendReply(ctx, { embeds: [errorEmbed('Invalid time format. Use: `30s`, `2m`, `1:30`, or seconds.')] });
  }

  const newPosition = Math.max(0, (player.position || 0) - ms);
  await player.seekTo(newPosition);

  return sendReply(ctx, { embeds: [successEmbed(`⏪ Rewound by **${formatDuration(ms)}**. Now at **${formatDuration(newPosition)}**.`)] });
}

// ══════════════════════════════════════════════════════════
// COMMAND: VOLUME
// ══════════════════════════════════════════════════════════
async function cmdVolume(ctx, args) {
  const check = checkVoice(ctx);
  if (!check.ok) return sendReply(ctx, { embeds: [errorEmbed(check.reply)] });

  const guildId = ctx.guild.id;
  const player = getPlayer(guildId);

  if (!player) {
    return sendReply(ctx, { embeds: [errorEmbed('Nothing is currently playing.')] });
  }

  const volStr = args[0];
  if (!volStr) {
    const currentVol = player.volume || 100;
    return sendReply(ctx, { embeds: [musicEmbed('🔊 Volume', `Current volume: **${currentVol}%**`)] });
  }

  const vol = parseInt(volStr);
  if (isNaN(vol) || vol < 0 || vol > 1000) {
    return sendReply(ctx, { embeds: [errorEmbed('Volume must be between 0 and 1000.')] });
  }

  await player.setVolume(vol);

  return sendReply(ctx, { embeds: [successEmbed(`Volume set to **${vol}%** 🔊`)] });
}

// ══════════════════════════════════════════════════════════
// COMMAND: PAUSE
// ══════════════════════════════════════════════════════════
async function cmdPause(ctx) {
  const check = checkVoice(ctx);
  if (!check.ok) return sendReply(ctx, { embeds: [errorEmbed(check.reply)] });

  const guildId = ctx.guild.id;
  const player = getPlayer(guildId);

  if (!isPlayerPlaying(player)) {
    return sendReply(ctx, { embeds: [errorEmbed('Nothing is currently playing.')] });
  }

  await player.setPaused(true);
  return sendReply(ctx, { embeds: [successEmbed('⏸️ Player paused.')] });
}

// ══════════════════════════════════════════════════════════
// COMMAND: RESUME
// ══════════════════════════════════════════════════════════
async function cmdResume(ctx) {
  const check = checkVoice(ctx);
  if (!check.ok) return sendReply(ctx, { embeds: [errorEmbed(check.reply)] });

  const guildId = ctx.guild.id;
  const player = getPlayer(guildId);

  if (!player) {
    return sendReply(ctx, { embeds: [errorEmbed('Nothing is currently playing.')] });
  }

  await player.setPaused(false);
  return sendReply(ctx, { embeds: [successEmbed('▶️ Player resumed.')] });
}

// ══════════════════════════════════════════════════════════
// COMMAND: SKIP
// ══════════════════════════════════════════════════════════
async function cmdSkip(ctx) {
  const check = checkVoice(ctx);
  if (!check.ok) return sendReply(ctx, { embeds: [errorEmbed(check.reply)] });

  const guildId = ctx.guild.id;
  const player = getPlayer(guildId);
  const queue = getQueue(guildId);

  if (!isPlayerPlaying(player) || !queue.tracks.length || queue.current < 0) {
    return sendReply(ctx, { embeds: [errorEmbed('Nothing is currently playing.')] });
  }

  const skipped = queue.tracks[queue.current];
  if (queue.loop === 'track') {
    await player.playTrack({ track: { encoded: skipped.encoded } });
  } else {
    queue.current++;
    if (queue.current >= queue.tracks.length) {
      if (queue.loop === 'queue') {
        queue.current = 0;
        await player.playTrack({ track: { encoded: queue.tracks[queue.current].encoded } });
      } else {
        await leaveVoiceChannel(guildId);
        deleteQueue(guildId);
      }
    } else {
      await player.playTrack({ track: { encoded: queue.tracks[queue.current].encoded } });
    }
  }

  return sendReply(ctx, { embeds: [successEmbed(`⏭️ Skipped: **${skipped?.info?.title || 'Unknown'}**`)] });
}

// ══════════════════════════════════════════════════════════
// COMMAND: SHUFFLE
// ══════════════════════════════════════════════════════════
async function cmdShuffle(ctx) {
  const guildId = ctx.guild.id;
  const queue = getQueue(guildId);

  if (queue.tracks.length < 2) {
    return sendReply(ctx, { embeds: [errorEmbed('Not enough tracks to shuffle.')] });
  }

  // Fisher-Yates shuffle entire queue
  for (let i = queue.tracks.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [queue.tracks[i], queue.tracks[j]] = [queue.tracks[j], queue.tracks[i]];
  }

  // Reset current to 0
  queue.current = 0;
  setQueue(guildId, queue);

  const player = getPlayer(guildId);
  if (isPlayerPlaying(player)) {
    // Restart from beginning of shuffled queue
    const track = queue.tracks[0];
    await player.playTrack({ track: { encoded: track.encoded } });
  }

  return sendReply(ctx, { embeds: [successEmbed('🔀 Queue shuffled! Starting from the top.')] });
}

// ══════════════════════════════════════════════════════════
// COMMAND: REPEAT / LOOP
// ══════════════════════════════════════════════════════════
async function cmdRepeat(ctx, args) {
  const guildId = ctx.guild.id;
  const queue = getQueue(guildId);

  if (args[0]) {
    const mode = args[0].toLowerCase();
    if (!LOOP_MODES.includes(mode)) {
      return sendReply(ctx, { embeds: [errorEmbed(`Invalid loop mode. Available: ${LOOP_MODES.join(', ')}`)] });
    }
    queue.loop = mode;
  } else {
    // Toggle to next mode
    queue.loop = getNextLoopMode(queue.loop);
  }

  setQueue(guildId, queue);

  const modeEmoji = {
    off: '⏹️',
    track: '🔂',
    queue: '🔁',
  };

  return sendReply(ctx, { embeds: [successEmbed(`${modeEmoji[queue.loop]} Loop mode: **${queue.loop}**`)] });
}

// ══════════════════════════════════════════════════════════
// COMMAND: PRESET (list / toggle)
// ══════════════════════════════════════════════════════════
async function cmdPreset(ctx, args) {
  const check = checkVoice(ctx);
  if (!check.ok) return sendReply(ctx, { embeds: [errorEmbed(check.reply)] });

  const guildId = ctx.guild.id;
  const player = getPlayer(guildId);

  if (!player || !isPlayerPlaying(player)) {
    return sendReply(ctx, { embeds: [errorEmbed('Nothing is currently playing.')] });
  }

  const sub = args[0]?.toLowerCase();

  // List all presets
  if (!sub || sub === 'list') {
    const active = getActiveFilters(guildId);
    const list = PRESET_NAMES.map(name => {
      const isActive = active.includes(name) ? '✅' : '⬜';
      return `${isActive} \`${name}\``;
    }).join('\n');

    return sendReply(ctx, { embeds: [musicEmbed('🎛️ Audio Presets',
      `**Available presets:**\n${list}\n\n` +
      `Use \`,preset <name>\` to toggle a preset.\n` +
      `Use \`,preset active\` to see currently applied filters.`
    )] });
  }

  // Show active filters
  if (sub === 'active') {
    const active = getActiveFilters(guildId);
    if (!active.length) {
      return sendReply(ctx, { embeds: [musicEmbed('🎛️ Active Filters', 'No filters are currently applied.')] });
    }
    return sendReply(ctx, { embeds: [musicEmbed('🎛️ Active Filters', active.map(f => `• \`${f}\``).join('\n'))] });
  }

  // Toggle a preset
  if (!PRESET_NAMES.includes(sub)) {
    return sendReply(ctx, { embeds: [errorEmbed(`Unknown preset: \`${sub}\`\nAvailable: ${PRESET_NAMES.join(', ')}`)] });
  }

  const active = getActiveFilters(guildId);
  const isActive = active.includes(sub);

  // A preset is a sound profile, not a chain of effects. Keeping several
  // profiles active at once is what caused filters to compound into muddy,
  // underwater audio.
  if (isActive) {
    clearActiveFilters(guildId);
  } else {
    clearActiveFilters(guildId);
    addActiveFilter(guildId, sub);
  }

  // Always send the complete filter state. Sending only the selected preset
  // leaves old Lavalink filters active and causes stacked/underwater audio.
  await player.setFilters({
    karaoke: null,
    equalizer: [],
    timescale: null,
    tremolo: null,
    vibrato: null,
    rotation: null,
    distortion: null,
    channelMix: null,
    lowPass: null,
    ...getCombinedFilters(guildId),
  });

  return sendReply(ctx, { embeds: [successEmbed(
    `${isActive ? 'Disabled' : 'Enabled'} preset: **${sub}**${isActive ? '' : ' 🎛️'}`
  )] });
}

// ══════════════════════════════════════════════════════════
// COMMAND: MUSIC STATUS
// ══════════════════════════════════════════════════════════
async function cmdMusicStatus(ctx) {
  const ready = isLavalinkReady();
  const nodes = getNodeStatus();
  const errors = getConnectionErrors();

  const lines = [];
  lines.push(`**Lavalink Status:** ${ready ? '✅ Connected' : '❌ Not Connected'}`);
  lines.push('');

  if (!nodes.length) {
    lines.push('No Lavalink nodes are configured.');
    lines.push('Edit the `NODES` array in `modules/musicManager.js` to set your Lavalink server details.');
  } else {
    for (const node of nodes) {
      const emoji = node.state === 'CONNECTED' ? '🟢' : node.state === 'CONNECTING' ? '🟡' : '🔴';
      lines.push(`${emoji} **${node.name}** — ${node.state}`);
      if (node.stats) {
        lines.push(`↳ Players: ${node.stats.players || 0} | Playing: ${node.stats.playingPlayers || 0}`);
      }
    }
  }

  // Show recent connection errors
  if (errors.length) {
    lines.push('');
    lines.push('**Recent Errors:**');
    for (const [name, err] of errors.slice(-3)) {
      const time = Math.floor((Date.now() - err.time) / 1000);
      lines.push(`🔴 **${name}**: ${err.message} (${time}s ago)`);
    }
  }

  lines.push('');
  lines.push('**Node config** (`modules/musicManager.js`):');
  const nodeInfo = getNodeStatus();
  if (nodeInfo.length === 0) {
    lines.push('No nodes configured in `NODES` array.');
  } else {
    for (const n of nodeInfo) {
      lines.push(`↳ \`${n.name}\`: ${n.state}`);
    }
  }

  const description = lines.join('\n');
  return sendReply(ctx, { embeds: [musicEmbed('🎵 Music System Status', description)] });
}

// ══════════════════════════════════════════════════════════
// COMMAND: DISCONNECT
// ══════════════════════════════════════════════════════════
async function cmdDisconnect(ctx) {
  const check = checkVoice(ctx);
  if (!check.ok) return sendReply(ctx, { embeds: [errorEmbed(check.reply)] });

  const guildId = ctx.guild.id;
  const player = getPlayer(guildId);

  if (!player || !getVoiceConnection(guildId)) {
    return sendReply(ctx, { embeds: [errorEmbed('Not connected to a voice channel.')] });
  }

  await leaveVoiceChannel(guildId);
  deleteQueue(guildId);

  return sendReply(ctx, { embeds: [successEmbed('👋 Disconnected and cleared the queue.')] });
}

// ══════════════════════════════════════════════════════════
// COMMAND: NOWPLAYING (bonus helper)
// ══════════════════════════════════════════════════════════
async function cmdNowPlaying(ctx) {
  const check = checkVoice(ctx);
  if (!check.ok) return sendReply(ctx, { embeds: [errorEmbed(check.reply)] });

  const guildId = ctx.guild.id;
  const player = getPlayer(guildId);
  const queue = getQueue(guildId);

  if (!player || !queue.tracks.length || queue.current < 0) {
    return sendReply(ctx, { embeds: [musicEmbed('🎵 Now Playing', 'Nothing is currently playing.')] });
  }

  const track = queue.tracks[queue.current];
  const position = player.position || 0;
  const duration = track.info.length || 0;
  const progress = duration > 0 ? Math.min(100, Math.round((position / duration) * 100)) : 0;
  const bar = '▬'.repeat(Math.floor(progress / 5)) + '🔘' + '▬'.repeat(20 - Math.floor(progress / 5));

  const embed = musicEmbed('🎵 Now Playing',
    `${formatTrack(track)}\n\n` +
    `\`${formatDuration(position)}\` ${bar} \`${formatDuration(duration)}\`\n\n` +
    `Volume: **${player.volume || 100}%** | ` +
    `Loop: **${queue.loop}**`
  ).setThumbnail(track.info.artworkUrl || null);

  return sendReply(ctx, { embeds: [embed] });
}

// ══════════════════════════════════════════════════════════
// MAIN HANDLER
// ══════════════════════════════════════════════════════════
const MUSIC_COMMANDS = new Set([
  'play', 'p',
  'queue', 'q',
  'skip', 's',
  'pause',
  'resume',
  'volume', 'vol',
  'disconnect', 'dc', 'leave', 'stop',
  'shuffle',
  'repeat', 'loop',
  'fastforward', 'ff',
  'rewind', 'rw',
  'preset',
  'nowplaying', 'np',
  'music',
  // Sub-commands
  'queue-shuffle', 'queue-empty', 'queue-remove', 'queue-move',
]);

async function handleMusicCommand(ctx, command, args) {
  try {
    switch (command) {
      case 'music':
        return await cmdMusicStatus(ctx);

      case 'play':
      case 'p':
        return await cmdPlay(ctx, args);

      case 'queue':
      case 'q':
        return await cmdQueue(ctx, args);

      case 'queue-shuffle':
        return await cmdQueueShuffle(ctx);

      case 'queue-empty':
        return await cmdQueueEmpty(ctx);

      case 'queue-remove':
        return await cmdQueueRemove(ctx, args);

      case 'queue-move':
        return await cmdQueueMove(ctx, args);

      case 'fastforward':
      case 'ff':
        return await cmdFastForward(ctx, args);

      case 'rewind':
      case 'rw':
        return await cmdRewind(ctx, args);

      case 'volume':
      case 'vol':
        return await cmdVolume(ctx, args);

      case 'pause':
        return await cmdPause(ctx);

      case 'resume':
        return await cmdResume(ctx);

      case 'skip':
      case 's':
        return await cmdSkip(ctx);

      case 'shuffle':
        return await cmdShuffle(ctx);

      case 'repeat':
      case 'loop':
        return await cmdRepeat(ctx, args);

      case 'preset':
        return await cmdPreset(ctx, args);

      case 'disconnect':
      case 'dc':
      case 'leave':
      case 'stop':
        return await cmdDisconnect(ctx);

      case 'nowplaying':
      case 'np':
        return await cmdNowPlaying(ctx);

      default:
        return sendReply(ctx, { embeds: [errorEmbed(`Unknown music command: \`${command}\``)] });
    }
  } catch (err) {
    logger.error('MUSIC', `Command ${command} failed:`, err);
    return sendReply(ctx, { embeds: [errorEmbed('An error occurred while processing that command.')] });
  }
}

module.exports = { handleMusicCommand, MUSIC_COMMANDS };