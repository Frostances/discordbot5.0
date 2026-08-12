/**
 * musicManager.js — Lavalink connection & player management
 * Uses Shoukaku (Lavalink client) for audio streaming
 */

const { Shoukaku, Connectors } = require('shoukaku');
const logger = require('../utils/logger');

// ══════════════════════════════════════════════════════════
// LAVALINK NODES CONFIG
// ══════════════════════════════════════════════════════════
// Edit these values to change your Lavalink server details.
// secure: true for SSL (port 443), false for plain connections
const NODES = [
  {
    name: 'MainNode',
    url: 'lavalinkv4.serenetia.com:443',
    auth: 'https://seretia.link/discord',
    secure: true,
  },
];

// ══════════════════════════════════════════════════════════
// SHOUKAKU CLIENT
// ══════════════════════════════════════════════════════════
let shoukaku = null;
const connectionErrors = new Map();

function getConnectionErrors() {
  return Array.from(connectionErrors.entries());
}

function initMusicManager(client) {
  shoukaku = new Shoukaku(new Connectors.DiscordJS(client), NODES, {
    moveOnDisconnect: false,
    resume: true,
    resumeByLibrary: true,
    reconnectTries: 10,
    reconnectInterval: 5000,
    restTimeout: 10000,
    userAgent: 'DiscordBot/KaidoMusic/4.0',
  });

  shoukaku.on('error', (name, error) => {
    logger.error('LAVALINK', `Node ${name} error:`, error);
    console.log('[DEBUG] Node error:', name, error);
    connectionErrors.set(name, { message: error?.message || String(error), time: Date.now() });
  });

  shoukaku.on('close', (name, code, reason) => {
    logger.warn('LAVALINK', `Node ${name} closed: ${code} ${reason}`);
    console.log('[DEBUG] Node closed:', name, code, reason);
  });

  shoukaku.on('disconnect', (name, players, moved) => {
    logger.warn('LAVALINK', `Node ${name} disconnected. Players: ${players.length}, Moved: ${moved}`);
    console.log('[DEBUG] Node disconnected:', name);
  });

  shoukaku.on('ready', (name, reconnected) => {
    logger.info('LAVALINK', `Node ${name} ready${reconnected ? ' (reconnected)' : ''}`);
    console.log('[DEBUG] Node ready:', name);
    connectionErrors.delete(name);
  });

  logger.info('MUSIC', 'Music manager initialized');
  return shoukaku;
}

function getShoukaku() {
  return shoukaku;
}

// ══════════════════════════════════════════════════════════
// PLAYER HELPERS
// ══════════════════════════════════════════════════════════
function getPlayer(guildId) {
  if (!shoukaku) return null;
  // A Shoukaku player can remain in the player map after Discord removes the
  // bot from voice. Treat it as stale until its voice connection still exists.
  if (!shoukaku.connections.has(guildId)) return null;
  return shoukaku.players.get(guildId) || null;
}

function hasPlayer(guildId) {
  return !!getPlayer(guildId);
}

function getVoiceConnection(guildId) {
  return shoukaku?.connections.get(guildId) || null;
}

function isPlayerPlaying(player) {
  return !!player?.track && !player.paused;
}

// ══════════════════════════════════════════════════════════
// TRACK UTILITIES
// ══════════════════════════════════════════════════════════
function formatDuration(ms) {
  if (!ms || ms === Infinity) return 'LIVE';
  const seconds = Math.floor((ms / 1000) % 60);
  const minutes = Math.floor((ms / (1000 * 60)) % 60);
  const hours = Math.floor(ms / (1000 * 60 * 60));
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function formatTrack(track, index = null) {
  const prefix = index !== null ? `\`${index}.\` ` : '';
  const title = track.info.title || 'Unknown Title';
  const author = track.info.author || 'Unknown';
  const duration = formatDuration(track.info.length);
  const url = track.info.uri || '';
  return `${prefix}[${title}](${url}) — \`${duration}\` by **${author}**`;
}

// ══════════════════════════════════════════════════════════
// PRESET FILTERS
// ══════════════════════════════════════════════════════════
const PRESETS = {
  karaoke: {
    karaoke: { level: 1.0, monoLevel: 1.0, filterBand: 220.0, filterWidth: 100.0 },
    equalizer: [],
    timescale: {},
    tremolo: {},
    vibrato: {},
    rotation: {},
    distortion: {},
    channelMix: {},
    lowPass: {},
  },
  piano: {
    karaoke: {},
    equalizer: [
      { band: 0, gain: 0.1 }, { band: 1, gain: 0.2 }, { band: 2, gain: 0.3 },
      { band: 3, gain: 0.4 }, { band: 4, gain: 0.5 }, { band: 5, gain: 0.4 },
      { band: 6, gain: 0.3 }, { band: 7, gain: 0.2 }, { band: 8, gain: 0.1 },
      { band: 9, gain: 0.0 }, { band: 10, gain: 0.0 }, { band: 11, gain: 0.1 },
      { band: 12, gain: 0.2 }, { band: 13, gain: 0.3 }, { band: 14, gain: 0.4 },
    ],
    timescale: {},
    tremolo: {},
    vibrato: {},
    rotation: {},
    distortion: {},
    channelMix: {},
    lowPass: {},
  },
  flat: {
    karaoke: {},
    equalizer: [
      { band: 0, gain: 0 }, { band: 1, gain: 0 }, { band: 2, gain: 0 },
      { band: 3, gain: 0 }, { band: 4, gain: 0 }, { band: 5, gain: 0 },
      { band: 6, gain: 0 }, { band: 7, gain: 0 }, { band: 8, gain: 0 },
      { band: 9, gain: 0 }, { band: 10, gain: 0 }, { band: 11, gain: 0 },
      { band: 12, gain: 0 }, { band: 13, gain: 0 }, { band: 14, gain: 0 },
    ],
    timescale: {},
    tremolo: {},
    vibrato: {},
    rotation: {},
    distortion: {},
    channelMix: {},
    lowPass: {},
  },
  boost: {
    karaoke: {},
    equalizer: [
      { band: 0, gain: 0.2 }, { band: 1, gain: 0.3 }, { band: 2, gain: 0.4 },
      { band: 3, gain: 0.3 }, { band: 4, gain: 0.2 }, { band: 5, gain: 0.1 },
      { band: 6, gain: 0.1 }, { band: 7, gain: 0.2 }, { band: 8, gain: 0.3 },
      { band: 9, gain: 0.4 }, { band: 10, gain: 0.5 }, { band: 11, gain: 0.4 },
      { band: 12, gain: 0.3 }, { band: 13, gain: 0.2 }, { band: 14, gain: 0.1 },
    ],
    timescale: {},
    tremolo: {},
    vibrato: {},
    rotation: {},
    distortion: {},
    channelMix: {},
    lowPass: {},
  },
  nightcore: {
    karaoke: {},
    equalizer: [],
    timescale: { speed: 1.2, pitch: 1.2, rate: 1.0 },
    tremolo: {},
    vibrato: {},
    rotation: {},
    distortion: {},
    channelMix: {},
    lowPass: {},
  },
  soft: {
    karaoke: {},
    equalizer: [
      { band: 0, gain: 0.5 }, { band: 1, gain: 0.4 }, { band: 2, gain: 0.3 },
      { band: 3, gain: 0.2 }, { band: 4, gain: 0.1 }, { band: 5, gain: -0.1 },
      { band: 6, gain: -0.2 }, { band: 7, gain: -0.3 }, { band: 8, gain: -0.4 },
      { band: 9, gain: -0.5 }, { band: 10, gain: -0.5 }, { band: 11, gain: -0.5 },
      { band: 12, gain: -0.5 }, { band: 13, gain: -0.5 }, { band: 14, gain: -0.5 },
    ],
    timescale: {},
    tremolo: {},
    vibrato: {},
    rotation: {},
    distortion: {},
    channelMix: {},
    lowPass: { smoothing: 20.0 },
  },
  vibrato: {
    karaoke: {},
    equalizer: [],
    timescale: {},
    tremolo: {},
    vibrato: { frequency: 5.0, depth: 0.5 },
    rotation: {},
    distortion: {},
    channelMix: {},
    lowPass: {},
  },
  vaporwave: {
    karaoke: {},
    equalizer: [
      { band: 0, gain: 0.1 }, { band: 1, gain: 0.2 }, { band: 2, gain: 0.3 },
      { band: 3, gain: 0.4 }, { band: 4, gain: 0.3 }, { band: 5, gain: 0.2 },
      { band: 6, gain: 0.1 }, { band: 7, gain: 0.0 }, { band: 8, gain: 0.0 },
      { band: 9, gain: 0.0 }, { band: 10, gain: 0.0 }, { band: 11, gain: 0.0 },
      { band: 12, gain: 0.0 }, { band: 13, gain: 0.0 }, { band: 14, gain: 0.0 },
    ],
    timescale: { speed: 0.85, pitch: 0.85, rate: 1.0 },
    tremolo: {},
    vibrato: {},
    rotation: {},
    distortion: {},
    channelMix: {},
    lowPass: {},
  },
  metal: {
    karaoke: {},
    equalizer: [
      { band: 0, gain: 0.1 }, { band: 1, gain: 0.2 }, { band: 2, gain: 0.3 },
      { band: 3, gain: 0.4 }, { band: 4, gain: 0.5 }, { band: 5, gain: 0.6 },
      { band: 6, gain: 0.5 }, { band: 7, gain: 0.4 }, { band: 8, gain: 0.3 },
      { band: 9, gain: 0.2 }, { band: 10, gain: 0.1 }, { band: 11, gain: 0.0 },
      { band: 12, gain: 0.0 }, { band: 13, gain: 0.0 }, { band: 14, gain: 0.0 },
    ],
    timescale: {},
    tremolo: {},
    vibrato: {},
    rotation: {},
    distortion: { sinOffset: 0.0, sinScale: 1.0, cosOffset: 0.0, cosScale: 1.0, tanOffset: 0.0, tanScale: 1.0, offset: 0.0, scale: 1.0 },
    channelMix: {},
    lowPass: {},
  },
  chipmunk: {
    karaoke: {},
    equalizer: [],
    timescale: { speed: 1.4, pitch: 1.4, rate: 1.0 },
    tremolo: {},
    vibrato: {},
    rotation: {},
    distortion: {},
    channelMix: {},
    lowPass: {},
  },
  '8d': {
    karaoke: {},
    equalizer: [],
    timescale: {},
    tremolo: {},
    vibrato: {},
    rotation: { rotationHz: 0.2 },
    distortion: {},
    channelMix: {},
    lowPass: {},
  },
};

const PRESET_NAMES = Object.keys(PRESETS);

// ══════════════════════════════════════════════════════════
// ACTIVE FILTERS TRACKER (per guild)
// ══════════════════════════════════════════════════════════
const activeFilters = new Map(); // guildId -> Set of preset names

function getActiveFilters(guildId) {
  return Array.from(activeFilters.get(guildId) || []);
}

function addActiveFilter(guildId, presetName) {
  if (!activeFilters.has(guildId)) activeFilters.set(guildId, new Set());
  activeFilters.get(guildId).add(presetName);
}

function removeActiveFilter(guildId, presetName) {
  if (!activeFilters.has(guildId)) return;
  activeFilters.get(guildId).delete(presetName);
  if (activeFilters.get(guildId).size === 0) activeFilters.delete(guildId);
}

function clearActiveFilters(guildId) {
  activeFilters.delete(guildId);
}

function getCombinedFilters(guildId) {
  const active = getActiveFilters(guildId);
  const equalizer = new Map();
  const combined = {};

  for (const name of active) {
    const preset = PRESETS[name];
    if (!preset) continue;

    for (const [key, value] of Object.entries(preset)) {
      if (key === 'equalizer' && Array.isArray(value)) {
        for (const band of value) {
          const gain = (equalizer.get(band.band) || 0) + Number(band.gain || 0);
          // Lavalink accepts gains from -0.25 to 1.0. Clamping prevents
          // stacked presets from producing harsh or underwater distortion.
          equalizer.set(band.band, Math.max(-0.25, Math.min(1, gain)));
        }
      } else if (value && typeof value === 'object' && Object.keys(value).length) {
        combined[key] = { ...combined[key], ...value };
      }
    }
  }

  if (equalizer.size) {
    combined.equalizer = [...equalizer.entries()]
      .sort(([a], [b]) => a - b)
      .map(([band, gain]) => ({ band, gain }));
  }
  return combined;
}

// ══════════════════════════════════════════════════════════
// QUEUE MANAGER (per guild)
// ══════════════════════════════════════════════════════════
const queues = new Map(); // guildId -> { tracks: [], loop: 'off'|'track'|'queue', current: index }
function getQueue(guildId) {
  if (!queues.has(guildId)) {
    queues.set(guildId, { tracks: [], loop: 'off', current: -1 });
  }
  return queues.get(guildId);
}

function setQueue(guildId, queue) {
  queues.set(guildId, queue);
}

function clearQueue(guildId) {
  queues.set(guildId, { tracks: [], loop: 'off', current: -1 });
}

function deleteQueue(guildId) {
  queues.delete(guildId);
  clearActiveFilters(guildId);
}

// ══════════════════════════════════════════════════════════
// LOOP MODES
// ══════════════════════════════════════════════════════════
const LOOP_MODES = ['off', 'track', 'queue'];

function getNextLoopMode(current) {
  const idx = LOOP_MODES.indexOf(current);
  return LOOP_MODES[(idx + 1) % LOOP_MODES.length];
}

// ══════════════════════════════════════════════════════════
// PLAYER EVENT HANDLER
// ══════════════════════════════════════════════════════════
function setupPlayerEvents(player, guildId) {
  player.on('start', () => {
    logger.info('MUSIC', `Started playing in guild ${guildId}`);
  });

  player.on('end', async (data) => {
    const queue = getQueue(guildId);
    if (!queue) return;

    const reason = data?.reason || 'unknown';
    // stopTrack() is also used by skip. The command advances the queue itself,
    // so never let the TrackEndEvent advance it a second time.
    if (reason === 'replaced') return;

    if (queue.loop === 'track') {
      // Replay same track
      const track = queue.tracks[queue.current];
      if (track) {
        await player.playTrack({ track: { encoded: track.encoded } });
      }
    } else {
      // Move to next track
      queue.current++;
      if (queue.current >= queue.tracks.length) {
        if (queue.loop === 'queue') {
          queue.current = 0;
        } else {
          // Queue ended
          await leaveVoiceChannel(guildId);
          deleteQueue(guildId);
          return;
        }
      }
      const nextTrack = queue.tracks[queue.current];
      if (nextTrack) {
        await player.playTrack({ track: { encoded: nextTrack.encoded } });
      }
    }
  });

  player.on('exception', (err) => {
    logger.error('MUSIC', `Player exception in guild ${guildId}:`, err);
  });

  player.on('closed', (data) => {
    logger.warn('MUSIC', `Player closed in guild ${guildId}:`, data);
    deleteQueue(guildId);
  });
}

// ══════════════════════════════════════════════════════════
// SEARCH / RESOLVE
// ══════════════════════════════════════════════════════════
async function resolveQuery(node, query) {
  try {
    const isUrl = /^https?:\/\//.test(query);
    const searchQuery = isUrl ? query : `ytsearch:${query}`;
    const result = await node.rest.resolve(searchQuery);
    return result;
  } catch (err) {
    logger.error('MUSIC', `Resolve failed for query: ${query}`, err);
    return null;
  }
}

// ══════════════════════════════════════════════════════════
// GET BEST NODE (FIXED)
// ══════════════════════════════════════════════════════════
function getBestNode() {
  if (!shoukaku) return null;
  for (const node of shoukaku.nodes.values()) {
    if (node.state === 1) return node; // 1 = CONNECTED
  }
  return null;
}

function getNodeStatus() {
  if (!shoukaku) return [];
  return Array.from(shoukaku.nodes.values()).map(node => ({
    name: node.name,
    state: node.state === 0 ? 'CONNECTING' : node.state === 1 ? 'CONNECTED' : 'DISCONNECTED',
    stats: node.state === 1 ? node.stats : null,
  }));
}

function isLavalinkReady() {
  return !!getBestNode();
}

/**
 * Leave through Shoukaku, not just the Lavalink REST player endpoint.
 * destroy() removes the remote player but leaves the Discord voice
 * connection registered, which makes the next ,play command look successful
 * while no audio can be delivered.
 */
async function leaveVoiceChannel(guildId) {
  if (!shoukaku) return;
  await shoukaku.leaveVoiceChannel(guildId);
}

// ══════════════════════════════════════════════════════════
// EXPORTS
// ══════════════════════════════════════════════════════════
module.exports = {
  initMusicManager,
  getShoukaku,
  getPlayer,
  hasPlayer,
  getVoiceConnection,
  isPlayerPlaying,
  formatDuration,
  formatTrack,
  PRESETS,
  PRESET_NAMES,
  getActiveFilters,
  addActiveFilter,
  removeActiveFilter,
  clearActiveFilters,
  getCombinedFilters,
  getQueue,
  setQueue,
  clearQueue,
  deleteQueue,
  LOOP_MODES,
  getNextLoopMode,
  setupPlayerEvents,
  resolveQuery,
  getBestNode,
  getNodeStatus,
  isLavalinkReady,
  getConnectionErrors,
  leaveVoiceChannel,
};