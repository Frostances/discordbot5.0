const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, AttachmentBuilder, PermissionFlagsBits } = require('discord.js');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { COLORS, base } = require('../utils/embeds');
const { getGuildDb, getUserDb } = require('../modules/database');
const { Readable } = require('node:stream');
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  NoSubscriberBehavior,
  entersState,
  getVoiceConnection: getDiscordVoiceConnection,
} = require('@discordjs/voice');
const {
  getVoiceConnection: getMusicVoiceConnection,
  leaveVoiceChannel: leaveMusicVoiceChannel,
} = require('./musicManager');

// ══════════════════════════════════════════════════════════
// API KEYS — Paste your keys here if config/apikeys.js is missing
// ══════════════════════════════════════════════════════════
let API_KEYS;
try {
  API_KEYS = require('../config/apikeys');
} catch {
  API_KEYS = {
    GOOGLE_API_KEY: '',
    GOOGLE_CX: '',
    GIPHY_API_KEY: '',
    TENOR_API_KEY: '',
    PERSPECTIVE_API_KEY: '',
    RAWG_API_KEY: '',
    OMDB_API_KEY: '',
    OCR_API_KEY: '',
    REMOVEBG_API_KEY: '',
    WOLFRAM_API_KEY: '',
    OPENAI_API_KEY: '',
    GROQ_API_KEY: '',
    AUDD_API_KEY: '',
  };
}

// ══════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════
async function jsonFetch(url, opts = {}) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000), ...opts });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function textFetch(url, opts = {}) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000), ...opts });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function bufferFetch(url, opts = {}) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000), ...opts });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} — ${text.slice(0, 200)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

function rand(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function replyEmbed(ctx, embed, files = []) {
 const isInteraction = !!ctx.deferReply;
 const payload = { embeds: [embed] };
 if (files.length) payload.files = files;
 if (isInteraction) {
 if (ctx.deferred || ctx.replied) return ctx.editReply(payload);
 return ctx.reply(payload);
 }
 return ctx.channel.send(payload);
}

// Extract image URL from command args, replied message, attachments, or recent messages
async function resolveImageUrl(ctx, args) {
  // 1. Check args for a direct URL
  const urlArg = args.find(a => /^https?:\/\//.test(a));
  if (urlArg) return urlArg;

  // 2. Check if this is a reply to a message with an image/video
  const referenced = ctx.reference || ctx.message?.reference;
  if (referenced?.messageId) {
    try {
      const refMsg = await ctx.channel.messages.fetch(referenced.messageId);
      const imgAtt = refMsg.attachments.find(a => a.contentType?.startsWith('image/') || a.contentType?.startsWith('video/') || /\.(png|jpe?g|gif|webp|mp4|mov|webm)(\?|$)/i.test(a.url));
      if (imgAtt) return imgAtt.url;
      const imgEmbed = refMsg.embeds.find(e => e.image?.url || e.thumbnail?.url);
      if (imgEmbed) return imgEmbed.image?.url || imgEmbed.thumbnail?.url;
    } catch {}
  }

  // 3. Check if command message itself has attachments
  const msg = ctx.message || ctx;
  if (msg?.attachments?.size > 0) {
    const imgAtt = msg.attachments.find(a => a.contentType?.startsWith('image/') || a.contentType?.startsWith('video/') || /\.(png|jpe?g|gif|webp|mp4|mov|webm)(\?|$)/i.test(a.url));
    if (imgAtt) return imgAtt.url;
  }

  // 4. Check last few messages in channel for images
  try {
    const messages = await ctx.channel.messages.fetch({ limit: 10 });
    for (const m of messages.values()) {
      if (m.id === ctx.id || m.id === ctx.message?.id) continue;
      const imgAtt = m.attachments.find(a => a.contentType?.startsWith('image/') || a.contentType?.startsWith('video/') || /\.(png|jpe?g|gif|webp|mp4|mov|webm)(\?|$)/i.test(a.url));
      if (imgAtt) return imgAtt.url;
      const imgEmbed = m.embeds.find(e => e.image?.url || e.thumbnail?.url);
      if (imgEmbed) return imgEmbed.image?.url || imgEmbed.thumbnail?.url;
    }
  } catch {}

  return null;
}

// ══════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════
// 1. LYRICS
// ══════════════════════════════════════════════════════════
async function handleLyrics(ctx, args) {
  const query = args.join(' ').trim();
  if (!query) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Missing Query').setDescription('Usage: `,lyrics <artist> - <song>` or `,lyrics <song>`'));

  try {
    let artist = query, title = query;
    if (query.includes(' - ')) { [artist, title] = query.split(' - ').map(s => s.trim()); }
    const data = await jsonFetch(`https://lyrist.vercel.app/api/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`);
    if (data?.lyrics) {
      return replyEmbed(ctx, base(COLORS.primary).setTitle(`🎵 ${data.title || title} — ${data.artist || artist}`)
        .setDescription(data.lyrics.length > 4000 ? data.lyrics.slice(0, 4000) + '...' : data.lyrics)
        .setFooter({ text: 'Powered by Lyrist' }));
    }
  } catch (e) { console.log('[Lyrics] Lyrist failed:', e.message); }

  try {
    const [artist, title] = query.includes(' - ') ? query.split(' - ').map(s => s.trim()) : [query, query];
    const data = await jsonFetch(`https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`);
    if (data?.lyrics) {
      return replyEmbed(ctx, base(COLORS.primary).setTitle(`🎵 ${title || query}`)
        .setDescription(data.lyrics.length > 4000 ? data.lyrics.slice(0, 4000) + '...' : data.lyrics)
        .setFooter({ text: 'Powered by lyrics.ovh' }));
    }
  } catch (e) { console.log('[Lyrics] lyrics.ovh failed:', e.message); }

  try {
    const data = await jsonFetch(`https://api.lyrics.ovh/suggest/${encodeURIComponent(query)}`);
    if (data?.data?.length) {
      const song = data.data[0];
      const lyricsData = await jsonFetch(`https://api.lyrics.ovh/v1/${encodeURIComponent(song.artist.name)}/${encodeURIComponent(song.title)}`);
      if (lyricsData?.lyrics) {
        return replyEmbed(ctx, base(COLORS.primary).setTitle(`🎵 ${song.title} — ${song.artist.name}`)
          .setDescription(lyricsData.lyrics.length > 4000 ? lyricsData.lyrics.slice(0, 4000) + '...' : lyricsData.lyrics)
          .setFooter({ text: 'Powered by lyrics.ovh' }));
      }
    }
  } catch (e) { console.log('[Lyrics] suggest failed:', e.message); }

  return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Not Found').setDescription('Could not find lyrics. Try `artist - song` format, e.g. `,lyrics The Weeknd - Blinding Lights`'));
}
// 2. DUCKDUCKGO SEARCH
// ══════════════════════════════════════════════════════════
async function handleDuckDuckGo(ctx, args) {
  const query = args.join(' ').trim();
  if (!query) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Missing Query').setDescription('Usage: `,duckduckgo <query>`'));
  try {
    const html = await textFetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });
    const results = [];
    const regex = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    let m;
    while ((m = regex.exec(html)) !== null && results.length < 5) {
      const url = m[1].replace(/&amp;/g, '&');
      const title = m[2].replace(/<\/?[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').trim();
      if (title && url && !url.includes('duckduckgo.com')) results.push({ title, url });
    }
    if (!results.length) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ No Results').setDescription('No results found.'));
    return replyEmbed(ctx, base(COLORS.primary).setTitle(`🔍 DuckDuckGo: ${query}`)
      .setDescription(results.map((r, i) => `**${i + 1}.** [${r.title}](${r.url})`).join('\n'))
      .setFooter({ text: 'Results from DuckDuckGo' }));
  } catch {
    return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Search Failed').setDescription('Could not perform search.'));
  }
}

// ══════════════════════════════════════════════════════════
// 3. BLACKTEA (3-letter word game)
// ══════════════════════════════════════════════════════════
const blackteaGames = new Map();
const THREE_LETTER_WORDS = [
  'ace','act','add','age','aid','aim','air','ale','all','and','ant','any','ape','apt','arc','are','ark','arm','art','ash',
  'ask','ate','awe','axe','bad','bag','ban','bar','bat','bay','bed','bee','beg','bet','bid','big','bin','bit','bob','bog',
  'boo','bow','box','boy','bra','bud','bug','bum','bun','bus','but','buy','bye','cab','cad','cam','can','cap','car','cat',
  'cop','cot','cow','coy','cry','cub','cue','cup','cut','dad','dam','day','den','dew','did','die','dig','dim','din','dip',
  'dog','dot','dry','dub','dud','due','dug','dun','duo','dye','ear','eat','ebb','eel','egg','ego','elf','elk','elm','end',
  'era','eve','eye','fad','fan','far','fat','fax','fay','fed','fee','fen','few','fig','fin','fir','fit','fix','flu','fly',
  'fog','foe','fop','for','fox','fro','fry','fun','fur','gab','gad','gag','gal','gap','gas','gay','gee','gel','gem',
  'get','gig','gin','god','got','gum','gun','gut','guy','gym','had','hag','ham','has','hat','hay','hem','hen','her','hew',
  'hex','hid','him','hip','his','hit','hob','hoe','hog','hop','hot','how','hub','hue','hug','huh','hum','hut','ice','icy',
  'ink','inn','ion','ire','irk','ivy','jab','jag','jam','jar','jaw','jay','jet','jew','jig','job','jog','jot','joy','jug',
  'jut','keg','ken','key','kid','kin','kit','lab','lad','lag','lam','lap','law','lax','lay','lea','led','lee','leg','let',
  'lid','lie','lip','lit','lob','log','lop','lot','low','lox','lug','lux','lye','mad','man','map','mar','mat','maw','max',
  'may','men','met','mew','mid','mil','mix','mob','mod','mop','mow','mud','mug','mum','nab','nag','nap','nay','nee','net',
  'new','nil','nip','nod','nor','not','now','nub','nun','nut','oaf','oak','oar','oat','odd','ode','off','oft','ohm','oho',
  'oil','old','one','ooh','opt','orb','ore','our','out','ova','owe','owl','own','pad','pal','pan','par','pat','paw','pay',
  'pea','peg','pen','pep','per','pet','pew','phi','pic','pie','pig','pin','pip','pit','ply','pod','poi','pop','pot','pow',
  'pox','pro','pry','pub','pug','pun','pup','pus','put','rag','rah','ram','ran','rap','rat','raw','ray','red','ref','rep',
  'rev','rib','rid','rig','rim','rip','rob','rod','roe','rot','row','rub','rue','rug','rum','run','rut','rye','sac','sad',
  'sag','sap','sat','saw','sax','say','sea','sec','see','set','sew','sex','shy','sib','sic','sin','sip','sir','sit','six',
  'ski','sky','sly','sob','sod','sol','son','sop','sot','sow','soy','spa','spy','sty','sub','sue','sum','sun','sup','tab',
  'tad','tag','tam','tan','tap','tar','tat','tax','tea','tee','ten','the','thy','tic','tie','tin','tip','toe','tog','tom',
  'ton','too','top','tor','tot','tow','toy','try','tub','tug','tun','tux','two','use','van','vat','vet','vex','via','vie',
  'vim','vow','wad','wag','wan','war','was','wax','way','web','wed','wee','wet','who','why','wig','win','wit','woe','won',
  'woo','wow','wry','yak','yam','yap','yaw','yea','yen','yep','yes','yet','yew','yip','yod','yon','you','yow','yuk','yum',
  'yup','zag','zap','zed','zen','zip','zit','zoo'
];

async function handleBlacktea(ctx, args) {
  const channelId = ctx.channel?.id || ctx.channelId;
  if (blackteaGames.has(channelId)) {
    const game = blackteaGames.get(channelId);
    const rem = Math.max(0, 60 - Math.floor((Date.now() - game.startTime) / 1000));
    return replyEmbed(ctx, base(COLORS.warning).setTitle('☕ Blacktea Active')
      .setDescription(`A game is already running! **${rem}s** remaining.`));
  }
  const word = rand(THREE_LETTER_WORDS);
  const game = { word, guesses: [], active: true, startTime: Date.now(), winner: null };
  blackteaGames.set(channelId, game);
  replyEmbed(ctx, base(COLORS.primary).setTitle('☕ Blacktea')
    .setDescription('I\'m thinking of a **3-letter word**...\nType your guess in chat! First to find it wins!\n\n⏰ **60 seconds**')
    .setFooter({ text: 'Hint: it\'s a real English word!' }));
  const filter = m => m.content.length === 3 && /^[a-zA-Z]+$/.test(m.content) && !m.author.bot;
  const collector = ctx.channel.createMessageCollector({ filter, time: 60000 });
  collector.on('collect', async m => {
    const guess = m.content.toLowerCase();
    if (game.guesses.includes(guess)) return;
    game.guesses.push(guess);
    if (guess === game.word) {
      game.active = false; game.winner = m.author.id;
      blackteaGames.delete(channelId); collector.stop('won');
      const udb = getUserDb(ctx.guild.id, m.author.id);
      udb.data.blackteaWins = (udb.data.blackteaWins || 0) + 1; udb.save();
      return replyEmbed(ctx, base(COLORS.success).setTitle('☕ Blacktea')
        .setDescription(`🏆 **${m.author.username}** found the word **\`${game.word.toUpperCase()}\`**!\nGuesses: ${game.guesses.length}`));
    }
  });
  collector.on('end', (_, reason) => {
    if (reason !== 'won') {
      blackteaGames.delete(channelId);
      replyEmbed(ctx, base(COLORS.error).setTitle('☕ Blacktea Over')
        .setDescription(`Time\'s up! The word was **\`${game.word.toUpperCase()}\`**.\nGuesses: ${game.guesses.length}`));
    }
  });
}

// ══════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════
// 4. QUOTE (message quoting)
// ══════════════════════════════════════════════════════════
async function handleQuote(ctx, args) {
  const isInteraction = !!ctx.deferReply;
  let targetMsg = null;
  const input = args[0] || '';
  const linkMatch = input.match(/discord\.com\/channels\/(\d+)\/(\d+)\/(\d+)/);
  try {
    if (linkMatch) {
      const [, , channelId, messageId] = linkMatch;
      const ch = await ctx.client.channels.fetch(channelId).catch(() => null);
      if (ch) targetMsg = await ch.messages.fetch(messageId).catch(() => null);
    } else if (/^\d+$/.test(input)) {
      targetMsg = await ctx.channel.messages.fetch(input).catch(() => null);
    } else {
      const messages = await ctx.channel.messages.fetch({ limit: 10 });
      const mention = isInteraction ? null : ctx.mentions?.users?.first();
      if (mention) targetMsg = messages.find(m => m.author.id === mention.id && !m.author.bot);
      if (!targetMsg) targetMsg = messages.find(m => !m.author.bot && m.id !== ctx.id);
    }
  } catch {}
  if (!targetMsg) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Message Not Found')
    .setDescription('Provide a message link, message ID, or mention a user.\nUsage: `,quote <message-link>`'));

  // Try to generate image with Canvas
  try {
    const Canvas = require('@napi-rs/canvas');
    const canvas = Canvas.createCanvas(1200, 675);
    const ctx2d = canvas.getContext('2d');

    // Try to load background image from message attachments
    let bgImage = null;
    if (targetMsg.attachments.size > 0) {
      const imgAtt = targetMsg.attachments.find(a => a.contentType?.startsWith('image/'));
      if (imgAtt) {
        try { bgImage = await Canvas.loadImage(imgAtt.url); } catch {}
      }
    }
    if (!bgImage && targetMsg.embeds.length > 0) {
      const embedImg = targetMsg.embeds.find(e => e.image?.url || e.thumbnail?.url);
      if (embedImg) {
        try { bgImage = await Canvas.loadImage(embedImg.image?.url || embedImg.thumbnail?.url); } catch {}
      }
    }
    if (!bgImage) {
      try { bgImage = await Canvas.loadImage(targetMsg.author.displayAvatarURL({ format: 'png', size: 512 })); } catch {}
    }

    if (bgImage) {
      const imgAspect = bgImage.width / bgImage.height;
      const canvasAspect = 660 / 675;
      let sx, sy, sWidth, sHeight;
      if (imgAspect > canvasAspect) {
        sHeight = bgImage.height;
        sWidth = sHeight * canvasAspect;
        sx = (bgImage.width - sWidth) / 2;
        sy = 0;
      } else {
        sWidth = bgImage.width;
        sHeight = sWidth / canvasAspect;
        sx = 0;
        sy = (bgImage.height - sHeight) / 2;
      }
      ctx2d.drawImage(bgImage, sx, sy, sWidth, sHeight, 0, 0, 660, 675);
      const gradLeft = ctx2d.createLinearGradient(0, 0, 660, 0);
      gradLeft.addColorStop(0, 'rgba(0,0,0,0.3)');
      gradLeft.addColorStop(0.7, 'rgba(0,0,0,0.6)');
      gradLeft.addColorStop(1, 'rgba(0,0,0,0.95)');
      ctx2d.fillStyle = gradLeft;
      ctx2d.fillRect(0, 0, 660, 675);
    }

    ctx2d.fillStyle = '#0a0a0a';
    ctx2d.fillRect(660, 0, 540, 675);
    const gradCenter = ctx2d.createLinearGradient(500, 0, 800, 0);
    gradCenter.addColorStop(0, 'rgba(10,10,10,0)');
    gradCenter.addColorStop(1, 'rgba(10,10,10,1)');
    ctx2d.fillStyle = gradCenter;
    ctx2d.fillRect(500, 0, 300, 675);

    // Draw circular avatar + display name at top-left
    try {
      const avatarUrl = targetMsg.author.displayAvatarURL({ format: 'png', size: 256 });
      const avatarImg = await Canvas.loadImage(avatarUrl);
      const avatarSize = 70;
      const avatarX = 40;
      const avatarY = 40;
      ctx2d.save();
      ctx2d.beginPath();
      ctx2d.arc(avatarX + avatarSize/2, avatarY + avatarSize/2, avatarSize/2, 0, Math.PI * 2);
      ctx2d.closePath();
      ctx2d.clip();
      ctx2d.drawImage(avatarImg, avatarX, avatarY, avatarSize, avatarSize);
      ctx2d.restore();
      ctx2d.fillStyle = '#ffffff';
      ctx2d.font = 'bold 28px sans-serif';
      ctx2d.textAlign = 'left';
      ctx2d.fillText(targetMsg.member?.displayName || targetMsg.author.displayName, avatarX + avatarSize + 15, avatarY + avatarSize/2 + 10);
    } catch {}

    // Adaptive font sizing for quote text
    const text = targetMsg.content || '*No text content*';
    const authorName = targetMsg.author.username;

    function fitText(ctx2d, text, maxWidth, maxHeight, startSize) {
      let fontSize = startSize;
      while (fontSize >= 14) {
        ctx2d.font = `bold ${fontSize}px sans-serif`;
        const words = text.split(' ');
        const lines = [];
        let line = '';
        for (const word of words) {
          const testLine = line + word + ' ';
          const metrics = ctx2d.measureText(testLine);
          if (metrics.width > maxWidth && line !== '') {
            lines.push(line.trim());
            line = word + ' ';
          } else {
            line = testLine;
          }
        }
        lines.push(line.trim());
        const lineHeight = fontSize * 1.4;
        const totalHeight = lines.length * lineHeight;
        if (totalHeight <= maxHeight) return { fontSize, lines, lineHeight };
        fontSize -= 2;
      }
      ctx2d.font = `bold 14px sans-serif`;
      const words = text.split(' ');
      const lines = [];
      let line = '';
      for (const word of words) {
        const testLine = line + word + ' ';
        const metrics = ctx2d.measureText(testLine);
        if (metrics.width > maxWidth && line !== '') {
          lines.push(line.trim());
          line = word + ' ';
        } else {
          line = testLine;
        }
      }
      lines.push(line.trim());
      return { fontSize: 14, lines, lineHeight: 20 };
    }

    const maxTextW = 460;
    const maxTextH = 420;
    const centerX = 930;
    const { fontSize, lines, lineHeight } = fitText(ctx2d, text, maxTextW, maxTextH, 56);

    const totalTextH = lines.length * lineHeight;
    let startY = 280 - totalTextH / 2 + lineHeight / 2;

    ctx2d.fillStyle = '#ffffff';
    ctx2d.textAlign = 'center';
    ctx2d.textBaseline = 'middle';
    for (let i = 0; i < lines.length; i++) {
      ctx2d.fillText(lines[i], centerX, startY + i * lineHeight);
    }

    ctx2d.fillStyle = '#888888';
    ctx2d.font = `italic ${Math.max(16, Math.floor(fontSize * 0.55))}px sans-serif`;
    ctx2d.fillText(`— ${authorName}`, centerX, startY + lines.length * lineHeight + 25);

    const buffer = await canvas.encode('png');
    const att = new AttachmentBuilder(buffer, { name: 'quote.png' });
    return ctx.channel.send({ files: [att] });
  } catch (err) {
    console.error('[Quote] Canvas error:', err.message);
    const embed = base(COLORS.primary)
      .setAuthor({ name: targetMsg.author.tag, iconURL: targetMsg.author.displayAvatarURL() })
      .setDescription(targetMsg.content || '*No text content*')
      .setTimestamp(targetMsg.createdTimestamp)
      .setFooter({ text: `#${targetMsg.channel.name}` });
    if (targetMsg.attachments.size > 0) {
      const img = targetMsg.attachments.find(a => a.contentType?.startsWith('image/'));
      if (img) embed.setImage(img.url);
    }
    return replyEmbed(ctx, embed);
  }
}
// 5. TIC-TAC-TOE (with stats & leaderboard)
// ══════════════════════════════════════════════════════════
const TTT_WINS = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
function tttCheck(b) {
  for (const [a,c,d] of TTT_WINS) if (b[a] && b[a] === b[c] && b[a] === b[d]) return b[a];
  if (b.every(c => c !== null)) return 'draw';
  return null;
}

function tttComponents(board) {
  const labels = board.map(c => c === 'X' ? '❌' : c === 'O' ? '⭕' : '⬜');
  return [0, 3, 6].map(offset =>
    new ActionRowBuilder().addComponents(
      [0, 1, 2].map(i => new ButtonBuilder()
        .setCustomId(`ttt_${offset + i}`)
        .setLabel(labels[offset + i])
        .setStyle(board[offset + i] ? ButtonStyle.Secondary : ButtonStyle.Primary)
        .setDisabled(!!board[offset + i])
      )
    )
  );
}

const tttGames = new Map();

async function handleTicTacToe(ctx, args) {
  const isInteraction = !!ctx.deferReply;
  const challenger = isInteraction ? ctx.user : ctx.author;
  const channelId = isInteraction ? ctx.channelId : ctx.channel.id;

  // ── Stats ──
  if (args[0]?.toLowerCase() === 'stats') {
    const target = isInteraction ? (ctx.options?.getUser?.('user') || ctx.user) : (ctx.mentions?.users?.first() || ctx.author);
    const udb = getUserDb(ctx.guild.id, target.id);
    const stats = { wins: udb.data.tttWins || 0, losses: udb.data.tttLosses || 0, draws: udb.data.tttDraws || 0 };
    const embed = new EmbedBuilder()
      .setTitle(`❌⭕ TicTacToe — ${target.username}`)
      .setThumbnail(target.displayAvatarURL())
      .setColor('#5865F2')
      .setDescription(
        `-# WINS\n**${stats.wins}**\n\n` +
        `-# LOSSES\n**${stats.losses}**\n\n` +
        `-# DRAWS\n**${stats.draws}**\n\n` +
        `-# TOTAL GAMES\n**${stats.wins + stats.losses + stats.draws}**`
      );
    return replyEmbed(ctx, embed);
  }

  // ── Leaderboard ──
  if (args[0]?.toLowerCase() === 'leaderboard') {
    const db = getGuildDb(ctx.guild.id);
    const users = db.data.users || {};
    const sorted = Object.entries(users).filter(([, d]) => (d.tttWins || 0) > 0).sort((a, b) => (b[1].tttWins || 0) - (a[1].tttWins || 0)).slice(0, 10);
    if (sorted.length === 0) {
      return replyEmbed(ctx, new EmbedBuilder().setTitle('🏆 TicTacToe Leaderboard').setDescription('No wins recorded yet.').setColor('#5865F2'));
    }
    let desc = '';
    for (let i = 0; i < sorted.length; i++) {
      const [uid, d] = sorted[i];
      desc += `${i + 1}- <@${uid}> — **${d.tttWins || 0}**\n`;
    }
    return replyEmbed(ctx, new EmbedBuilder().setTitle('🏆 TicTacToe Leaderboard').setDescription(desc).setColor('#5865F2'));
  }

  if (tttGames.has(channelId)) {
    const msg = '❌ A TicTacToe game is already active in this channel.';
    return isInteraction ? ctx.reply({ content: msg, ephemeral: true }) : ctx.reply(msg);
  }

  // ── Require an opponent mention — no bot play ──
  const opponent = isInteraction ? ctx.options?.getUser?.('user') : ctx.mentions?.users?.first();
  if (!opponent || opponent.id === challenger.id) {
    return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Missing Opponent')
      .setDescription('Mention a user to play against.\nUsage: `,tictactoe @user`\n\nYou cannot play against bots or yourself.'));
  }
  if (opponent.bot) {
    return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Invalid Opponent')
      .setDescription('You cannot play against bots. Mention a real user.'));
  }

  const xPlayer = challenger, oPlayer = opponent;
  const board = Array(9).fill(null);
  const gameState = { board, xPlayer, oPlayer, currentTurn: 'X', channelId, startedAt: Date.now(), lastMoveAt: Date.now() };
  tttGames.set(channelId, gameState);

  const embed = new EmbedBuilder().setTitle('❌⭕ TicTacToe').setColor(COLORS.primary).setTimestamp().setFooter({ text: 'Kaido' })
    .setDescription(`${xPlayer} (**❌**) vs ${oPlayer} (**⭕**)\n\n${xPlayer}'s turn (❌)\n⏰ 30s per move`);

  let sent;
  if (isInteraction) { await ctx.reply({ embeds: [embed], components: tttComponents(board) }); sent = await ctx.fetchReply(); }
  else { sent = await ctx.channel.send({ embeds: [embed], components: tttComponents(board) }); }

  // ── 30-second turn timer ──
  const turnTimer = setInterval(async () => {
    const gs = tttGames.get(channelId);
    if (!gs) { clearInterval(turnTimer); return; }
    const elapsed = Date.now() - gs.lastMoveAt;
    if (elapsed >= 30000) {
      tttGames.delete(channelId); clearInterval(turnTimer);
      const forfeitPlayer = gs.currentTurn === 'X' ? gs.xPlayer : gs.oPlayer;
      const winner = gs.currentTurn === 'X' ? gs.oPlayer : gs.xPlayer;
      const wdb = getUserDb(ctx.guild.id, winner.id);
      wdb.data.tttWins = (wdb.data.tttWins || 0) + 1; wdb.save();
      const ldb = getUserDb(ctx.guild.id, forfeitPlayer.id);
      ldb.data.tttLosses = (ldb.data.tttLosses || 0) + 1; ldb.save();
      const endEmbed = new EmbedBuilder().setTitle('❌⭕ TicTacToe').setColor(COLORS.success).setTimestamp().setFooter({ text: 'Kaido' })
        .setDescription(`⏰ **${forfeitPlayer.username}** ran out of time!\n\n**${winner.username}** wins by forfeit! 🎉`);
      await sent.edit({ embeds: [endEmbed], components: tttComponents(gs.board).map(r => { r.components.forEach(b => b.setDisabled(true)); return r; }) }).catch(() => {});
    }
  }, 5000);

  const collector = sent.createMessageComponentCollector({
    componentType: ComponentType.Button, time: 5 * 60 * 1000,
    filter: i => {
      const gs = tttGames.get(channelId);
      if (!gs) { i.deferUpdate(); return false; }
      const validUser = gs.currentTurn === 'X' ? i.user.id === gs.xPlayer.id : i.user.id === gs.oPlayer.id;
      if (!validUser) { i.reply({ content: '❌ It\'s not your turn.', ephemeral: true }); return false; }
      return true;
    },
  });

  collector.on('collect', async i => {
    const gs = tttGames.get(channelId);
    if (!gs) return i.deferUpdate();
    const idx = parseInt(i.customId.replace('ttt_', ''));
    if (gs.board[idx]) return i.deferUpdate();
    gs.board[idx] = gs.currentTurn;
    gs.lastMoveAt = Date.now();

    const result = tttCheck(gs.board);
    let desc;
    if (result) {
      tttGames.delete(channelId); clearInterval(turnTimer); collector.stop('done');
      if (result === 'draw') {
        desc = "It\'s a **draw**! 🤝";
        const xdb = getUserDb(ctx.guild.id, gs.xPlayer.id); xdb.data.tttDraws = (xdb.data.tttDraws || 0) + 1; xdb.save();
        const odb = getUserDb(ctx.guild.id, gs.oPlayer.id); odb.data.tttDraws = (odb.data.tttDraws || 0) + 1; odb.save();
      } else if (result === 'X') {
        desc = `**${gs.xPlayer.username}** wins! 🎉`;
        const udb = getUserDb(ctx.guild.id, gs.xPlayer.id); udb.data.tttWins = (udb.data.tttWins || 0) + 1; udb.save();
        const odb = getUserDb(ctx.guild.id, gs.oPlayer.id); odb.data.tttLosses = (odb.data.tttLosses || 0) + 1; odb.save();
      } else {
        desc = `**${gs.oPlayer.username}** wins! 🎉`;
        const udb = getUserDb(ctx.guild.id, gs.oPlayer.id); udb.data.tttWins = (udb.data.tttWins || 0) + 1; udb.save();
        const xdb = getUserDb(ctx.guild.id, gs.xPlayer.id); xdb.data.tttLosses = (xdb.data.tttLosses || 0) + 1; xdb.save();
      }
    } else {
      gs.currentTurn = gs.currentTurn === 'X' ? 'O' : 'X';
      const nextPlayer = gs.currentTurn === 'X' ? gs.xPlayer : gs.oPlayer;
      desc = `${nextPlayer}'s turn (${gs.currentTurn === 'X' ? '❌' : '⭕'})\n⏰ 30s per move`;
    }
    const updEmbed = new EmbedBuilder().setTitle('❌⭕ TicTacToe').setDescription(desc).setColor(result && result !== 'draw' ? COLORS.success : COLORS.primary).setTimestamp().setFooter({ text: 'Kaido' });
    await i.update({ embeds: [updEmbed], components: result ? tttComponents(gs.board).map(r => { r.components.forEach(b => b.setDisabled(true)); return r; }) : tttComponents(gs.board) });
  });
  collector.on('end', (_, reason) => {
    if (reason !== 'done') {
      tttGames.delete(channelId); clearInterval(turnTimer);
      sent.edit({ components: [] }).catch(() => {});
    }
  });
}

// ══════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════
// 7. GIPHY
// ══════════════════════════════════════════════════════════
async function handleGiphy(ctx, args) {
  const query = args.join(' ').trim();
  if (!query) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Missing Query').setDescription('Usage: `,giphy <query>`'));
  const key = API_KEYS.GIPHY_API_KEY;
  if (!key) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ API Key Missing').setDescription('Add `GIPHY_API_KEY` to `config/apikeys.js`.\nGet one at https://developers.giphy.com/'));
  try {
    const data = await jsonFetch(`https://api.giphy.com/v1/gifs/search?api_key=${key}&q=${encodeURIComponent(query)}&limit=25&rating=g`);
    if (!data.data?.length) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ No Results').setDescription('No GIFs found.'));
    const gif = rand(data.data);
    return replyEmbed(ctx, base(COLORS.primary).setTitle(`🎞️ Giphy: ${query}`).setImage(gif.images.original.url).setFooter({ text: `Powered by Giphy • ${gif.username || 'unknown'}` }));
  } catch { return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Failed').setDescription('Could not fetch from Giphy.')); }
}


// 8. TENOR (CANCELLED / REMOVED dont count it )

// ══════════════════════════════════════════════════════════
// 9. STEAL (most recent emote)
// ══════════════════════════════════════════════════════════
async function handleSteal(ctx, args) {
  const input = args[0] || '';
  const linkMatch = input.match(/discord\.com\/channels\/(\d+)\/(\d+)\/(\d+)/);
  let targetMsg = null;
  try {
    if (linkMatch) {
      const [, , channelId, messageId] = linkMatch;
      const ch = await ctx.client.channels.fetch(channelId).catch(() => null);
      if (ch) targetMsg = await ch.messages.fetch(messageId).catch(() => null);
    }
  } catch {}
  if (!targetMsg) {
    try {
      const messages = await ctx.channel.messages.fetch({ limit: 50 });
      targetMsg = messages.find(m => { const em = m.content.match(/<(a?):(\w+):(\d+)>/); return em && !m.author.bot; });
    } catch {}
  }
  if (!targetMsg) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ No Emote Found').setDescription('No custom emotes found in recent messages. Try providing a message link.'));
  const emojiMatch = targetMsg.content.match(/<(a?):(\w+):(\d+)>/);
  if (!emojiMatch) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ No Emote Found').setDescription('That message does not contain a custom emote.'));
  const animated = !!emojiMatch[1], name = emojiMatch[2], id = emojiMatch[3];
  const ext = animated ? 'gif' : 'png', url = `https://cdn.discordapp.com/emojis/${id}.${ext}?size=256`;
  return replyEmbed(ctx, base(COLORS.primary).setTitle(`:${name}:`)
    .setDescription(`**Name:** \`${name}\`\n**ID:** \`${id}\`\n**Animated:** ${animated ? 'Yes' : 'No'}\n**URL:** [Link](${url})`)
    .setImage(url).setFooter({ text: `Found in message by ${targetMsg.author.tag}` }));
}

// ══════════════════════════════════════════════════════════
// 10. DUCKDUCKGO IMAGE
// ══════════════════════════════════════════════════════════
async function handleDuckDuckGoImage(ctx, args) {
  const query = args.join(' ').trim();
  if (!query) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Missing Query').setDescription('Usage: `,duckduckgoimage <query>`'));
  try {
    const html = await textFetch(`https://duckduckgo.com/?q=${encodeURIComponent(query)}&iax=images&ia=images`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });
    const match = html.match(/vqd="([^"]+)"/);
    if (!match) throw new Error('no vqd');
    const data = await jsonFetch(`https://duckduckgo.com/i.js?q=${encodeURIComponent(query)}&vqd=${match[1]}&f=,,,&l=us-en`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Referer': 'https://duckduckgo.com/' }
    });
    if (!data.results?.length) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ No Results').setDescription('No images found.'));
    const img = rand(data.results);
    return replyEmbed(ctx, base(COLORS.primary).setTitle(`🖼️ DDG Images: ${query}`).setImage(img.image).setFooter({ text: `From: ${img.source || 'Unknown'}` }));
  } catch { return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Search Failed').setDescription('Could not fetch images.')); }
}

// ══════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════
// 11. REVERSE IMAGE
// ══════════════════════════════════════════════════════════
async function handleReverseImage(ctx, args) {
  const url = await resolveImageUrl(ctx, args);
  if (!url) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Invalid URL').setDescription('Usage: `,reverseimage <image-url>` or reply to a message with an image.'));
  return replyEmbed(ctx, base(COLORS.primary).setTitle('🔍 Reverse Image Search')
    .setDescription(`[Search on Google Lens](https://lens.google.com/uploadbyurl?url=${encodeURIComponent(url)})\n[Search on TinEye](https://tineye.com/search?url=${encodeURIComponent(url)})\n[Search on Yandex](https://yandex.com/images/search?url=${encodeURIComponent(url)}&rpt=imageview)`)
    .setImage(url).setFooter({ text: 'Click a link above to view results' }));
}
// 12. IMAGE SEARCH (DDG)
// ══════════════════════════════════════════════════════════
async function handleImage(ctx, args) {
  const query = args.join(' ').trim();
  if (!query) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Missing Query').setDescription('Usage: `,image <query>`'));
  try {
    const html = await textFetch(`https://duckduckgo.com/?q=${encodeURIComponent(query)}&iax=images&ia=images`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });
    const match = html.match(/vqd="([^"]+)"/);
    if (!match) throw new Error('no vqd');
    const data = await jsonFetch(`https://duckduckgo.com/i.js?q=${encodeURIComponent(query)}&vqd=${match[1]}&f=,,,&l=us-en`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Referer': 'https://duckduckgo.com/' }
    });
    if (!data.results?.length) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ No Results').setDescription('No images found.'));
    const img = rand(data.results);
    return replyEmbed(ctx, base(COLORS.primary).setTitle(`🖼️ Image: ${query}`).setImage(img.image).setFooter({ text: `From: ${img.source || 'DuckDuckGo'}` }));
  } catch (err) {
    console.error('[Image] Error:', err.message);
    return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Search Failed').setDescription('Could not fetch images.'));
  }
}
// 13. BOOK (Open Library)
// ══════════════════════════════════════════════════════════
async function handleBook(ctx, args) {
  const query = args.join(' ').trim();
  if (!query) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Missing Query').setDescription('Usage: `,book <title>`'));
  try {
    const data = await jsonFetch(`https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=5`);
    if (!data.docs?.length) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ No Results').setDescription('No books found.'));
    const book = data.docs[0];
    const embed = base(COLORS.primary).setTitle(`📖 ${book.title}`)
      .setDescription(book.first_sentence?.[0] || '*No description available*')
      .addFields(
        { name: 'Author', value: book.author_name?.join(', ') || 'Unknown', inline: true },
        { name: 'Published', value: book.first_publish_year?.toString() || 'Unknown', inline: true },
        { name: 'Pages', value: book.number_of_pages_median?.toString() || 'Unknown', inline: true },
        { name: 'ISBN', value: book.isbn?.[0] || 'N/A', inline: true }
      ).setFooter({ text: 'Powered by Open Library' });
    if (book.cover_i) embed.setThumbnail(`https://covers.openlibrary.org/b/id/${book.cover_i}-L.jpg`);
    return replyEmbed(ctx, embed);
  } catch { return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Failed').setDescription('Could not fetch book information.')); }
}

// ══════════════════════════════════════════════════════════
// 14. MANGA (Jikan)
// ══════════════════════════════════════════════════════════
async function handleManga(ctx, args) {
  const query = args.join(' ').trim();
  if (!query) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Missing Query').setDescription('Usage: `,manga <title>`'));
  try {
    const data = await jsonFetch(`https://api.jikan.moe/v4/manga?q=${encodeURIComponent(query)}&limit=5`);
    if (!data.data?.length) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ No Results').setDescription('No manga found.'));
    const manga = data.data[0];
    const embed = base(COLORS.primary).setTitle(`📚 ${manga.title}`).setURL(manga.url)
      .setDescription(manga.synopsis?.slice(0, 500) + '...' || '*No synopsis*')
      .addFields(
        { name: 'Type', value: manga.type || 'Unknown', inline: true },
        { name: 'Chapters', value: manga.chapters?.toString() || 'Unknown', inline: true },
        { name: 'Volumes', value: manga.volumes?.toString() || 'Unknown', inline: true },
        { name: 'Score', value: manga.score?.toString() || 'N/A', inline: true },
        { name: 'Status', value: manga.status || 'Unknown', inline: true },
        { name: 'Published', value: manga.published?.string || 'Unknown', inline: true }
      ).setFooter({ text: 'Powered by MyAnimeList (Jikan)' });
    if (manga.images?.jpg?.image_url) embed.setThumbnail(manga.images.jpg.image_url);
    return replyEmbed(ctx, embed);
  } catch (err) { console.error('[Manga] Error:', err.message); return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Failed').setDescription('Could not fetch manga information. The API may be rate-limited — try again in a few seconds.')); }
}

// ══════════════════════════════════════════════════════════
// 15. ANIME (Jikan)
// ══════════════════════════════════════════════════════════
async function handleAnime(ctx, args) {
  const query = args.join(' ').trim();
  if (!query) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Missing Query').setDescription('Usage: `,anime <title>`'));
  try {
    const data = await jsonFetch(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(query)}&limit=5`);
    if (!data.data?.length) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ No Results').setDescription('No anime found.'));
    const anime = data.data[0];
    const embed = base(COLORS.primary).setTitle(`📺 ${anime.title}`).setURL(anime.url)
      .setDescription(anime.synopsis?.slice(0, 500) + '...' || '*No synopsis*')
      .addFields(
        { name: 'Type', value: anime.type || 'Unknown', inline: true },
        { name: 'Episodes', value: anime.episodes?.toString() || 'Unknown', inline: true },
        { name: 'Score', value: anime.score?.toString() || 'N/A', inline: true },
        { name: 'Status', value: anime.status || 'Unknown', inline: true },
        { name: 'Aired', value: anime.aired?.string || 'Unknown', inline: true },
        { name: 'Rating', value: anime.rating || 'Unknown', inline: true }
      ).setFooter({ text: 'Powered by MyAnimeList (Jikan)' });
    if (anime.images?.jpg?.image_url) embed.setThumbnail(anime.images.jpg.image_url);
    return replyEmbed(ctx, embed);
  } catch (err) { console.error('[Anime] Error:', err.message); return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Failed').setDescription('Could not fetch anime information. The API may be rate-limited — try again in a few seconds.')); }
}

// ══════════════════════════════════════════════════════════
// 16. CHARACTER (Jikan)
// ══════════════════════════════════════════════════════════
async function handleCharacter(ctx, args) {
  const query = args.join(' ').trim();
  if (!query) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Missing Query').setDescription('Usage: `,character <name>`'));
  try {
    const data = await jsonFetch(`https://api.jikan.moe/v4/characters?q=${encodeURIComponent(query)}&limit=5`);
    if (!data.data?.length) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ No Results').setDescription('No character found.'));
    const char = data.data[0];
    const embed = base(COLORS.primary).setTitle(`👤 ${char.name}`).setURL(char.url)
      .setDescription(char.about?.slice(0, 500) + '...' || '*No description*')
      .addFields(
        { name: 'Kanji', value: char.name_kanji || 'N/A', inline: true },
        { name: 'Favorites', value: char.favorites?.toString() || '0', inline: true },
        { name: 'Nicknames', value: char.nicknames?.join(', ') || 'None', inline: true }
      ).setFooter({ text: 'Powered by MyAnimeList (Jikan)' });
    if (char.images?.jpg?.image_url) embed.setThumbnail(char.images.jpg.image_url);
    return replyEmbed(ctx, embed);
  } catch (err) { console.error('[Character] Error:', err.message); return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Failed').setDescription('Could not fetch character information. The API may be rate-limited — try again in a few seconds.')); }
}

// ══════════════════════════════════════════════════════════
// 17. TONE (Google Perspective)
// ══════════════════════════════════════════════════════════
async function handleTone(ctx, args) {
  const text = args.join(' ').trim();
  if (!text) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Missing Text').setDescription('Usage: `,tone <text>`'));
  const key = API_KEYS.PERSPECTIVE_API_KEY;
  if (!key) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ API Key Missing').setDescription('Add `PERSPECTIVE_API_KEY` to `config/apikeys.js`.\nGet one at https://perspectiveapi.com/'));
  try {
    const body = { comment: { text }, languages: ['en'], requestedAttributes: { TOXICITY: {}, SEVERE_TOXICITY: {}, IDENTITY_ATTACK: {}, INSULT: {}, PROFANITY: {}, THREAT: {} } };
    const res = await fetch(`https://commentanalyzer.googleapis.com/v1alpha1/comments:analyze?key=${key}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const data = await res.json();
    const scores = data.attributeScores || {};
    const fmt = (key) => { const s = scores[key]?.summaryScore?.value; return s !== undefined ? `${(s * 100).toFixed(1)}%` : 'N/A'; };
    const embed = base(COLORS.primary).setTitle('📊 Perspective Analysis')
      .setDescription(`\`\`\`${text.slice(0, 200)}\`\`\``)
      .addFields(
        { name: 'Toxicity', value: fmt('TOXICITY'), inline: true },
        { name: 'Severe Toxicity', value: fmt('SEVERE_TOXICITY'), inline: true },
        { name: 'Identity Attack', value: fmt('IDENTITY_ATTACK'), inline: true },
        { name: 'Insult', value: fmt('INSULT'), inline: true },
        { name: 'Profanity', value: fmt('PROFANITY'), inline: true },
        { name: 'Threat', value: fmt('THREAT'), inline: true }
      ).setFooter({ text: 'Powered by Google Perspective' });
    return replyEmbed(ctx, embed);
  } catch { return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Failed').setDescription('Could not analyze text.')); }
}

// ══════════════════════════════════════════════════════════
// 18. TAGS SYSTEM
// ══════════════════════════════════════════════════════════
function getTagsDb(guildId) {
  const db = getGuildDb(guildId);
  if (!db.data.tags) db.data.tags = {};
  return db.data.tags;
}

async function handleTags(ctx, args) {
  const guildId = ctx.guild.id;
  const tags = getTagsDb(guildId);
  const sub = args[0]?.toLowerCase();
  const isInteraction = !!ctx.deferReply;

  // Display tag
  if (!sub || (!['add','edit','random','rename','reset','search','remove','list','author'].includes(sub))) {
    const name = args[0]?.toLowerCase();
    if (!name) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Missing Tag Name').setDescription('Usage: `,tags <name>` or `,tags add <name> <content>`'));
    const tag = tags[name];
    if (!tag) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Tag Not Found').setDescription(`Tag \`${name}\` does not exist.`));
    tag.uses = (tag.uses || 0) + 1;
    getGuildDb(guildId)._save();
    return replyEmbed(ctx, base(COLORS.primary).setDescription(tag.content).setFooter({ text: `Tag: ${name} • Used ${tag.uses} times` }));
  }

  if (sub === 'add') {
    const name = args[1]?.toLowerCase();
    const content = args.slice(2).join(' ');
    if (!name || !content) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Missing Arguments').setDescription('Usage: `,tags add <name> <content>`'));
    if (tags[name]) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Tag Exists').setDescription(`Tag \`${name}\` already exists. Use \`,tags edit\` to modify it.`));
    tags[name] = { content, authorId: ctx.author?.id || ctx.user.id, createdAt: Date.now(), uses: 0 };
    getGuildDb(guildId)._save();
    return replyEmbed(ctx, base(COLORS.success).setTitle('✅ Tag Added').setDescription(`Tag \`${name}\` has been created.`));
  }

  if (sub === 'edit') {
    const name = args[1]?.toLowerCase();
    const content = args.slice(2).join(' ');
    if (!name || !content) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Missing Arguments').setDescription('Usage: `,tags edit <name> <new content>`'));
    if (!tags[name]) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Tag Not Found').setDescription(`Tag \`${name}\` does not exist.`));
    tags[name].content = content;
    getGuildDb(guildId)._save();
    return replyEmbed(ctx, base(COLORS.success).setTitle('✅ Tag Edited').setDescription(`Tag \`${name}\` has been updated.`));
  }

  if (sub === 'random') {
    const keys = Object.keys(tags);
    if (!keys.length) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ No Tags').setDescription('This server has no tags.'));
    const name = rand(keys);
    tags[name].uses = (tags[name].uses || 0) + 1;
    getGuildDb(guildId)._save();
    return replyEmbed(ctx, base(COLORS.primary).setDescription(tags[name].content).setFooter({ text: `Random Tag: ${name}` }));
  }

  if (sub === 'rename') {
    const oldName = args[1]?.toLowerCase();
    const newName = args[2]?.toLowerCase();
    if (!oldName || !newName) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Missing Arguments').setDescription('Usage: `,tags rename <old> <new>`'));
    if (!tags[oldName]) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Tag Not Found').setDescription(`Tag \`${oldName}\` does not exist.`));
    if (tags[newName]) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Tag Exists').setDescription(`Tag \`${newName}\` already exists.`));
    tags[newName] = tags[oldName]; delete tags[oldName];
    getGuildDb(guildId)._save();
    return replyEmbed(ctx, base(COLORS.success).setTitle('✅ Tag Renamed').setDescription(`\`${oldName}\` → \`${newName}\``));
  }

  if (sub === 'reset') {
    if (!ctx.member.permissions.has(PermissionFlagsBits.ManageGuild)) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Permission Denied').setDescription('You need **Manage Server** permission.'));
    const db = getGuildDb(guildId); db.data.tags = {}; db._save();
    return replyEmbed(ctx, base(COLORS.success).setTitle('✅ Tags Reset').setDescription('All tags have been deleted.'));
  }

  if (sub === 'search') {
    const query = args.slice(1).join(' ').toLowerCase();
    if (!query) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Missing Query').setDescription('Usage: `,tags search <keyword>`'));
    const matches = Object.entries(tags).filter(([name, tag]) => name.includes(query) || tag.content.toLowerCase().includes(query));
    if (!matches.length) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ No Results').setDescription('No tags matching that keyword.'));
    const embed = base(COLORS.primary).setTitle(`🔍 Tag Search: ${query}`)
      .setDescription(matches.slice(0, 20).map(([name, tag]) => `• \`${name}\` — ${tag.content.slice(0, 50)}...`).join('\n'));
    return replyEmbed(ctx, embed);
  }

  if (sub === 'remove') {
    const name = args[1]?.toLowerCase();
    if (!name) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Missing Name').setDescription('Usage: `,tags remove <name>`'));
    if (!tags[name]) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Tag Not Found').setDescription(`Tag \`${name}\` does not exist.`));
    delete tags[name]; getGuildDb(guildId)._save();
    return replyEmbed(ctx, base(COLORS.success).setTitle('✅ Tag Removed').setDescription(`Tag \`${name}\` has been deleted.`));
  }

  if (sub === 'list') {
    const target = isInteraction ? (ctx.options?.getUser?.('user') || ctx.user) : (ctx.mentions?.users?.first() || ctx.author);
    const userTags = Object.entries(tags).filter(([, tag]) => tag.authorId === target.id);
    if (!userTags.length) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ No Tags').setDescription(`${target.username} has no tags.`));
    const embed = base(COLORS.primary).setTitle(`🏷️ Tags by ${target.username}`)
      .setDescription(userTags.map(([name, tag]) => `• \`${name}\` — Used ${tag.uses || 0} times`).join('\n'));
    return replyEmbed(ctx, embed);
  }

  if (sub === 'author') {
    const name = args[1]?.toLowerCase();
    if (!name) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Missing Name').setDescription('Usage: `,tags author <name>`'));
    const tag = tags[name];
    if (!tag) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Tag Not Found').setDescription(`Tag \`${name}\` does not exist.`));
    const author = await ctx.client.users.fetch(tag.authorId).catch(() => null);
    return replyEmbed(ctx, base(COLORS.primary).setTitle(`🏷️ Tag: ${name}`)
      .addFields(
        { name: 'Author', value: author ? `${author.tag} (${author.id})` : 'Unknown', inline: true },
        { name: 'Created', value: new Date(tag.createdAt).toLocaleDateString(), inline: true },
        { name: 'Uses', value: (tag.uses || 0).toString(), inline: true }
      ));
  }
}

// ══════════════════════════════════════════════════════════
// 19. TV SHOW (TVMaze)
// ══════════════════════════════════════════════════════════
async function handleTvshow(ctx, args) {
  const query = args.join(' ').trim();
  if (!query) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Missing Title').setDescription('Usage: `,tvshow <title>`'));
  try {
    const data = await jsonFetch(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(query)}`);
    if (!data?.length) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ No Results').setDescription('No TV show found.'));
    const show = data[0].show;
    const embed = base(COLORS.primary).setTitle(`📺 ${show.name}`).setURL(show.url)
      .setDescription(show.summary?.replace(/<[^>]+>/g, '').slice(0, 500) + '...' || '*No summary*')
      .addFields(
        { name: 'Language', value: show.language || 'Unknown', inline: true },
        { name: 'Genres', value: show.genres?.join(', ') || 'Unknown', inline: true },
        { name: 'Status', value: show.status || 'Unknown', inline: true },
        { name: 'Premiered', value: show.premiered || 'Unknown', inline: true },
        { name: 'Rating', value: show.rating?.average?.toString() || 'N/A', inline: true },
        { name: 'Network', value: show.network?.name || 'Unknown', inline: true }
      ).setFooter({ text: 'Powered by TVMaze' });
    if (show.image?.original) embed.setThumbnail(show.image.original);
    return replyEmbed(ctx, embed);
  } catch { return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Failed').setDescription('Could not fetch TV show information.')); }
}

// ══════════════════════════════════════════════════════════
// 20. GAME (RAWG)
// ══════════════════════════════════════════════════════════
async function handleGame(ctx, args) {
  const query = args.join(' ').trim();
  if (!query) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Missing Title').setDescription('Usage: `,game <title>`'));
  const key = API_KEYS.RAWG_API_KEY;
  if (!key) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ API Key Missing').setDescription('Add `RAWG_API_KEY` to `config/apikeys.js`.\nGet one at https://rawg.io/'));
  try {
    const search = await jsonFetch(`https://api.rawg.io/api/games?key=${key}&search=${encodeURIComponent(query)}&page_size=5`);
    if (!search.results?.length) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ No Results').setDescription('No game found.'));
    const game = search.results[0];
    const embed = base(COLORS.primary).setTitle(`🎮 ${game.name}`).setURL(`https://rawg.io/games/${game.slug}`)
      .addFields(
        { name: 'Released', value: game.released || 'Unknown', inline: true },
        { name: 'Rating', value: game.rating?.toString() || 'N/A', inline: true },
        { name: 'Metacritic', value: game.metacritic?.toString() || 'N/A', inline: true },
        { name: 'Platforms', value: game.platforms?.map(p => p.platform.name).slice(0, 5).join(', ') || 'Unknown', inline: true }
      ).setFooter({ text: 'Powered by RAWG' });
    if (game.background_image) embed.setImage(game.background_image);
    return replyEmbed(ctx, embed);
  } catch { return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Failed').setDescription('Could not fetch game information.')); }
}

// ══════════════════════════════════════════════════════════
// 21. MOVIE (OMDB)
// ══════════════════════════════════════════════════════════
async function handleMovie(ctx, args) {
  const query = args.join(' ').trim();
  if (!query) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Missing Title').setDescription('Usage: `,movie <title>`'));
  const key = API_KEYS.OMDB_API_KEY;
  if (!key) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ API Key Missing').setDescription('Add `OMDB_API_KEY` to `config/apikeys.js`.\nGet one at https://www.omdbapi.com/'));
  try {
    const data = await jsonFetch(`https://www.omdbapi.com/?t=${encodeURIComponent(query)}&apikey=${key}&plot=short`);
    if (data.Response === 'False') return replyEmbed(ctx, base(COLORS.error).setTitle('❌ No Results').setDescription(data.Error || 'Movie not found.'));
    const embed = base(COLORS.primary).setTitle(`🎬 ${data.Title} (${data.Year})`)
      .setDescription(data.Plot || '*No plot available*')
      .addFields(
        { name: 'Genre', value: data.Genre || 'Unknown', inline: true },
        { name: 'Director', value: data.Director || 'Unknown', inline: true },
        { name: 'Actors', value: data.Actors || 'Unknown', inline: true },
        { name: 'Rated', value: data.Rated || 'N/A', inline: true },
        { name: 'Runtime', value: data.Runtime || 'N/A', inline: true },
        { name: 'IMDb Rating', value: data.imdbRating || 'N/A', inline: true }
      ).setFooter({ text: 'Powered by OMDB' });
    if (data.Poster && data.Poster !== 'N/A') embed.setThumbnail(data.Poster);
    return replyEmbed(ctx, embed);
  } catch { return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Failed').setDescription('Could not fetch movie information.')); }
}

// ══════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════
// 22. OCR (OCR.space)
// ══════════════════════════════════════════════════════════
async function handleOcr(ctx, args) {
  const url = await resolveImageUrl(ctx, args);
  if (!url) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Invalid URL').setDescription('Usage: `,ocr <image-url>` or reply to a message with an image.'));
  const key = API_KEYS.OCR_API_KEY;
  if (!key) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ API Key Missing').setDescription('Add `OCR_API_KEY` to `config/apikeys.js`.\nGet one at https://ocr.space/'));
  try {
    const res = await fetch(`https://api.ocr.space/parse/imageurl?apikey=${key}&url=${encodeURIComponent(url)}&language=eng`);
    const data = await res.json();
    const text = data.ParsedResults?.[0]?.ParsedText || 'No text detected.';
    return replyEmbed(ctx, base(COLORS.primary).setTitle('🔍 OCR Results').setDescription(`\`\`\`${text.slice(0, 3900)}\`\`\``).setFooter({ text: 'Powered by OCR.space' }));
  } catch { return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Failed').setDescription('Could not perform OCR.')); }
}
// ══════════════════════════════════════════════════════════
// 23. OCR + TRANSLATE
// ══════════════════════════════════════════════════════════
async function handleOcrtr(ctx, args) {
  const url = await resolveImageUrl(ctx, args);
  const toLang = args.find(a => /^[a-z]{2}(-[A-Z]{2})?$/.test(a)) || 'en';
  if (!url) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Invalid URL').setDescription('Usage: `,ocrtr <image-url> [to-language]` or reply to a message with an image.'));
  const key = API_KEYS.OCR_API_KEY;
  if (!key) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ API Key Missing').setDescription('Add `OCR_API_KEY` to `config/apikeys.js`.'));
  try {
    const ocrRes = await fetch(`https://api.ocr.space/parse/imageurl?apikey=${key}&url=${encodeURIComponent(url)}&language=eng`);
    const ocrData = await ocrRes.json();
    const text = ocrData.ParsedResults?.[0]?.ParsedText || '';
    if (!text) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ No Text').setDescription('No text detected in the image.'));
    const trRes = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${toLang}&dt=t&q=${encodeURIComponent(text)}`);
    const trData = await trRes.json();
    const translated = trData?.[0]?.map(x => x[0]).join('') || text;
    return replyEmbed(ctx, base(COLORS.primary).setTitle('🔍 OCR + Translate')
      .addFields(
        { name: 'Original', value: `\`\`\`${text.slice(0, 1000)}\`\`\``, inline: false },
        { name: `Translated (${toLang})`, value: `\`\`\`${translated.slice(0, 1000)}\`\`\``, inline: false }
      ).setFooter({ text: 'Powered by OCR.space & Google Translate' }));
  } catch { return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Failed').setDescription('Could not process image.')); }
}
// ══════════════════════════════════════════════════════════
// 24. TRANSLATE
// ══════════════════════════════════════════════════════════
async function handleTranslate(ctx, args) {
  let toLang = 'en', fromLang = 'auto', textStart = 0;
  const referenced = ctx.reference || ctx.message?.reference;
  let text = null;
  if (referenced?.messageId) {
    try {
      const refMsg = await ctx.channel.messages.fetch(referenced.messageId);
      text = refMsg.content;
      if (args.length >= 1 && /^[a-z]{2}(-[A-Z]{2})?$/.test(args[0])) {
        toLang = args[0];
      }
    } catch {}
  }
  if (!text) {
    if (args.length >= 3 && /^[a-z]{2}(-[A-Z]{2})?$/.test(args[0]) && /^[a-z]{2}(-[A-Z]{2})?$/.test(args[1])) {
      fromLang = args[0]; toLang = args[1]; textStart = 2;
    } else if (args.length >= 2 && /^[a-z]{2}(-[A-Z]{2})?$/.test(args[0])) {
      toLang = args[0]; textStart = 1;
    }
    text = args.slice(textStart).join(' ');
  }
  if (!text) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Missing Text').setDescription('Usage: `,translate <to-lang> <text>` or reply to a message with `,translate <to-lang>`'));
  try {
    const res = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=${fromLang}&tl=${toLang}&dt=t&q=${encodeURIComponent(text)}`);
    const data = await res.json();
    const translated = data?.[0]?.map(x => x[0]).join('') || text;
    const detected = data?.[2] || fromLang;
    return replyEmbed(ctx, base(COLORS.primary).setTitle('🌐 Translate')
      .addFields(
        { name: `Original (${detected})`, value: text.slice(0, 1024), inline: false },
        { name: `Translated (${toLang})`, value: translated.slice(0, 1024), inline: false }
      ).setFooter({ text: 'Powered by Google Translate' }));
  } catch { return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Failed').setDescription('Could not translate text.')); }
}
// 25. TTS (Text to Speech)
// ══════════════════════════════════════════════════════════
async function handleTts(ctx, args) {
  let speaker = 'en', textStart = 0;
  const voices = ['en','es','fr','de','it','ja','ko','ru','ar','pt','nl','pl','tr','zh'];
  if (voices.includes(args[0]?.toLowerCase())) { speaker = args[0].toLowerCase(); textStart = 1; }
  const text = args.slice(textStart).join(' ');
  if (!text) return replyEmbed(ctx, base(COLORS.error).setTitle('Missing Text').setDescription('Usage: `,tts [language] <text>`\nLanguages: en, es, fr, de, it, ja, ko, ru, ar, pt, nl, pl, tr, zh'));
  try {
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=${speaker}&client=tw-ob`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
    if (!res.ok || res.headers.get('content-type')?.includes('text/html')) throw new Error('Google TTS blocked');
    const buffer = Buffer.from(await res.arrayBuffer());
    const att = new AttachmentBuilder(buffer, { name: 'tts.mp3' });
    return replyEmbed(ctx, base(COLORS.primary).setTitle('TTS').setDescription(`Language: **${speaker}**`), [att]);
  } catch { return replyEmbed(ctx, base(COLORS.error).setTitle('Failed').setDescription('Could not generate TTS. Google may have blocked the request.')); }
}

// ══════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════
// 26. TTS CHANNEL
// ══════════════════════════════════════════════════════════
async function handleTtsChannel(ctx, args) {
  const voices = ['en','es','fr','de','it','ja','ko','ru','ar','pt','nl','pl','tr','zh'];
  let lang = 'en';
  let textArgs = args;
  if (voices.includes(args[0]?.toLowerCase())) {
    lang = args[0].toLowerCase();
    textArgs = args.slice(1);
  }
  const text = textArgs.join(' ').trim();
  if (!text) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Missing Text').setDescription('Usage: `,ttschannel <text>`'));

  const member = ctx.member || ctx.member;
  const voiceChannel = member?.voice?.channel;
  if (!voiceChannel) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Not in VC').setDescription('Join a voice channel first.'));

  // Check ffmpeg
  try { require('ffmpeg-static'); } catch {
    return replyEmbed(ctx, base(COLORS.error).setTitle('❌ ffmpeg Missing').setDescription('Run: `npm install ffmpeg-static`'));
  }
  // Check opus
  try { require('@discordjs/opus') || require('opusscript'); } catch {
    return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Opus Missing').setDescription('Run: `npm install opusscript`'));
  }

  // Check if bot is already in a different VC
  const musicConnection = getMusicVoiceConnection(ctx.guild.id);
  const existing = getDiscordVoiceConnection(ctx.guild.id);
  if ((musicConnection && musicConnection.channelId !== voiceChannel.id) ||
      (existing && existing.joinConfig.channelId !== voiceChannel.id)) {
    return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Already in VC').setDescription('I\'m already in another voice channel. Use `,stop` first.'));
  }

  // Lavalink and @discordjs/voice cannot control the same guild voice
  // session. TTS takes over only after stopping music in this channel.
  if (musicConnection) {
    await leaveMusicVoiceChannel(ctx.guild.id).catch(() => {});
  }

  const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=${lang}&client=tw-ob`;
  console.log(`[TTS] Fetching: ${ttsUrl}`);

  let audioBuffer;
  try {
    const res = await fetch(ttsUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    audioBuffer = Buffer.from(await res.arrayBuffer());
    console.log(`[TTS] Audio fetched: ${audioBuffer.length} bytes`);
  } catch (err) {
    console.error('[TTS] Fetch error:', err);
    return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Failed').setDescription('Could not fetch TTS audio.'));
  }

  const tmpFile = path.join(os.tmpdir(), `kaido_tts_${ctx.guild.id}_${Date.now()}.mp3`);
  try {
    fs.writeFileSync(tmpFile, audioBuffer);
    console.log(`[TTS] Temp file written: ${tmpFile}`);
  } catch (err) {
    return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Failed').setDescription('Could not write temp file.'));
  }

  try {
    const connection = existing || joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: ctx.guild.id,
      adapterCreator: ctx.guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: false,
    });

    await entersState(connection, VoiceConnectionStatus.Ready, 20_000);

    const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
    const resource = createAudioResource(tmpFile);
    connection.subscribe(player);
    player.play(resource);

    console.log('[TTS] Player started');
    // This command is intentionally acknowledged with a reaction instead of
    // creating another message in the channel.
    if (typeof ctx.react === 'function') {
      await ctx.react('✅').catch(() => {});
    } else {
      await replyEmbed(ctx, base(COLORS.success).setTitle('🔊 Speaking')
        .setDescription(`Language: **${lang}**\nSaying: \`${text.slice(0, 100)}\``));
    }

    let disconnectTimer;
    player.on(AudioPlayerStatus.Idle, () => {
       console.log('[TTS] Player idle — disconnecting');
       if (!existing) connection.destroy();
       try { fs.unlinkSync(tmpFile); } catch {}
    });

    player.on('error', err => {
      console.error('[TTS] Player error:', err.message);
       if (!existing) connection.destroy();
      clearTimeout(disconnectTimer);
      try { fs.unlinkSync(tmpFile); } catch {}
    });

    connection.on('error', err => {
      console.error('[TTS] Connection error:', err.message);
       if (!existing) connection.destroy();
      clearTimeout(disconnectTimer);
      try { fs.unlinkSync(tmpFile); } catch {}
    });
  } catch (err) {
    console.error('[TTS] Error:', err);
    try { fs.unlinkSync(tmpFile); } catch {}
    return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Failed').setDescription(`Could not speak in voice channel.\n**Reason:** ${err.message}`));
  }
}
// 27. LEGO (Legofy image)
// ══════════════════════════════════════════════════════════
async function handleLego(ctx, args) {
  const url = await resolveImageUrl(ctx, args);
  if (!url) return replyEmbed(ctx, base(COLORS.error).setTitle('Invalid URL').setDescription('Usage: `,lego <image-url>` or reply to a message with an image.\nSupported: PNG, JPG, GIF, WEBP'));
  try {
    const apiUrl = `https://legoify.vercel.app/api/legoify?url=${encodeURIComponent(url)}`;
    const res = await fetch(apiUrl, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error('API failed');
    const buffer = Buffer.from(await res.arrayBuffer());
    const att = new AttachmentBuilder(buffer, { name: 'lego.png' });
    return replyEmbed(ctx, base(COLORS.primary).setTitle('Legofied').setImage('attachment://lego.png'), [att]);
  } catch {
    return replyEmbed(ctx, base(COLORS.error).setTitle('Failed').setDescription('Could not legofy image. Try a different URL or image format.'));
  }
}
// ══════════════════════════════════════════════════════════
// 28. MAKEGIF (video to GIF)
// ══════════════════════════════════════════════════════════
async function handleMakegif(ctx, args) {
  const url = await resolveImageUrl(ctx, args);
  if (!url) return replyEmbed(ctx, base(COLORS.error).setTitle('Invalid URL').setDescription('Usage: `,makegif <video-url>` or reply to a message with a video.\nSupported: MP4, MOV, WEBM'));
  if (!url.match(/\.(mp4|mov|webm)(\?|$)/i)) {
    return replyEmbed(ctx, base(COLORS.error).setTitle('Invalid File').setDescription('That does not look like a video file. Supported: MP4, MOV, WEBM'));
  }
  return replyEmbed(ctx, base(COLORS.warning).setTitle('MakeGIF')
    .setDescription('Video-to-GIF conversion requires ffmpeg processing.\n\n**To enable:**\n`npm install ffmpeg-static fluent-ffmpeg`\n\n**Usage:** `,makegif <video-url>` or reply to a video with `,makegif`'));
}
// 29. TRANSPARENT (remove background)
// ══════════════════════════════════════════════════════════
async function handleTransparent(ctx, args) {
  const url = await resolveImageUrl(ctx, args);
  if (!url) return replyEmbed(ctx, base(COLORS.error).setTitle('Invalid URL').setDescription('Usage: `,transparent <image-url>` or reply to a message with an image.\nSupported: PNG, JPG, GIF, WEBP'));
  const key = API_KEYS.REMOVEBG_API_KEY;
  if (!key) return replyEmbed(ctx, base(COLORS.error).setTitle('API Key Missing').setDescription('Add `REMOVEBG_API_KEY` to `config/apikeys.js`.\nGet one at https://www.remove.bg/'));
  try {
    const res = await fetch('https://api.remove.bg/v1.0/removebg', {
      method: 'POST',
      headers: {
        'X-Api-Key': key,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ image_url: url }),
      signal: AbortSignal.timeout(20000)
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      let errMsg = `HTTP ${res.status}`;
      try {
        const errJson = JSON.parse(errText);
        errMsg = errJson.errors?.[0]?.title || errJson.error || errMsg;
      } catch {}
      throw new Error(errMsg);
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    const att = new AttachmentBuilder(buffer, { name: 'transparent.png' });
    return replyEmbed(ctx, base(COLORS.primary).setTitle('Background Removed').setImage('attachment://transparent.png'), [att]);
  } catch (err) {
    console.error('Transparent error:', err);
    return replyEmbed(ctx, base(COLORS.error).setTitle('Failed').setDescription(`Could not remove background.\n**Reason:** ${err.message || 'Unknown error'}\n\nMake sure your Remove.bg API key is valid and the image URL is accessible.`));
  }
}
// 30. WOLFRAM
// ══════════════════════════════════════════════════════════
async function handleWolfram(ctx, args) {
  const query = args.join(' ').trim();
  if (!query) return replyEmbed(ctx, base(COLORS.error).setTitle('Missing Query').setDescription('Usage: `,wolfram <query>`'));
  const key = API_KEYS.WOLFRAM_API_KEY;
  if (!key) return replyEmbed(ctx, base(COLORS.error).setTitle('API Key Missing').setDescription('Add `WOLFRAM_API_KEY` to `config/apikeys.js`.\nGet one at https://products.wolframalpha.com/api/'));
  try {
    const data = await jsonFetch(`https://api.wolframalpha.com/v2/query?input=${encodeURIComponent(query)}&format=plaintext&output=JSON&appid=${key}`);
    const pods = data.queryresult?.pods;
    if (!pods?.length) return replyEmbed(ctx, base(COLORS.error).setTitle('No Results').setDescription('WolframAlpha could not answer that query.'));
    const embed = base(COLORS.primary).setTitle(`Wolfram: ${query}`).setFooter({ text: 'Powered by WolframAlpha' });
    for (const pod of pods.slice(0, 4)) {
      const text = pod.subpods?.map(s => s.plaintext).filter(Boolean).join('\n') || 'N/A';
      if (text && text !== 'N/A') embed.addFields({ name: pod.title, value: text.slice(0, 1024), inline: false });
    }
    return replyEmbed(ctx, embed);
  } catch { return replyEmbed(ctx, base(COLORS.error).setTitle('Failed').setDescription('Could not query WolframAlpha.')); }
}

// ══════════════════════════════════════════════════════════
// 31-38. JUUL SYSTEM
// ══════════════════════════════════════════════════════════
function getJuulDb(guildId) {
  const db = getGuildDb(guildId);
  if (!db.data.juul) db.data.juul = { owner: null, flavor: 'Mango', hits: 0, active: true, passes: 0, stolen: 0 };
  return db.data.juul;
}

async function handleJuul(ctx, args) {
  const sub = args[0]?.toLowerCase();
  const guildId = ctx.guild.id;
  const juul = getJuulDb(guildId);
  const isInteraction = !!ctx.deferReply;
  const user = isInteraction ? ctx.user : ctx.author;

  if (sub === 'hit') {
    if (!juul.active) return replyEmbed(ctx, base(COLORS.error).setTitle('Juul Off').setDescription('The server juul is currently turned off.'));
    juul.hits = (juul.hits || 0) + 1;
    getGuildDb(guildId)._save();
    return replyEmbed(ctx, base(COLORS.primary).setTitle('Juul Hit').setDescription(`**${user.username}** takes a hit of **${juul.flavor}** 🌬️\nTotal hits: **${juul.hits}**`));
  }

  if (sub === 'pass') {
    const target = isInteraction ? ctx.options?.getUser?.('user') : ctx.mentions?.users?.first();
    if (!target) return replyEmbed(ctx, base(COLORS.error).setTitle('Missing User').setDescription('Usage: `,juul pass <@user>`'));
    if (!juul.active) return replyEmbed(ctx, base(COLORS.error).setTitle('Juul Off').setDescription('The server juul is currently turned off.'));
    juul.passes = (juul.passes || 0) + 1;
    juul.owner = target.id;
    getGuildDb(guildId)._save();
    return replyEmbed(ctx, base(COLORS.primary).setTitle('Juul Passed').setDescription(`**${user.username}** passes the juul to **${target.username}** 🔄\nFlavor: **${juul.flavor}**`));
  }

  if (sub === 'toggle') {
    if (!ctx.member.permissions.has(PermissionFlagsBits.ManageGuild)) return replyEmbed(ctx, base(COLORS.error).setTitle('Permission Denied').setDescription('You need **Manage Server** permission.'));
    juul.active = !juul.active;
    getGuildDb(guildId)._save();
    return replyEmbed(ctx, base(COLORS.success).setTitle('Juul Toggled').setDescription(`Server juul is now **${juul.active ? 'ON' : 'OFF'}**`));
  }

  if (sub === 'stats') {
    const owner = juul.owner ? await ctx.client.users.fetch(juul.owner).catch(() => null) : null;
    return replyEmbed(ctx, base(COLORS.primary).setTitle('Server Juul Stats')
      .addFields(
        { name: 'Flavor', value: juul.flavor || 'Mango', inline: true },
        { name: 'Status', value: juul.active ? 'On' : 'Off', inline: true },
        { name: 'Owner', value: owner ? owner.username : 'None', inline: true },
        { name: 'Hits', value: (juul.hits || 0).toString(), inline: true },
        { name: 'Passes', value: (juul.passes || 0).toString(), inline: true },
        { name: 'Stolen', value: (juul.stolen || 0).toString(), inline: true }
      ));
  }

  if (sub === 'flavor') {
    if (!ctx.member.permissions.has(PermissionFlagsBits.ManageGuild)) return replyEmbed(ctx, base(COLORS.error).setTitle('Permission Denied').setDescription('You need **Manage Server** permission.'));
    const flavor = args.slice(1).join(' ');
    if (!flavor) return replyEmbed(ctx, base(COLORS.error).setTitle('Missing Flavor').setDescription('Usage: `,juul flavor <flavor>`'));
    juul.flavor = flavor;
    getGuildDb(guildId)._save();
    return replyEmbed(ctx, base(COLORS.success).setTitle('Flavor Changed').setDescription(`Server juul flavor is now **${flavor}**`));
  }

  if (sub === 'steal') {
    if (!juul.active) return replyEmbed(ctx, base(COLORS.error).setTitle('Juul Off').setDescription('The server juul is currently turned off.'));
    const prevOwner = juul.owner ? await ctx.client.users.fetch(juul.owner).catch(() => null) : null;
    juul.owner = user.id;
    juul.stolen = (juul.stolen || 0) + 1;
    getGuildDb(guildId)._save();
    return replyEmbed(ctx, base(COLORS.primary).setTitle('Juul Stolen').setDescription(`**${user.username}** steals the juul${prevOwner ? ` from **${prevOwner.username}**` : ''}! 🏃\nFlavor: **${juul.flavor}**`));
  }

  // Default: share
  if (!juul.active) return replyEmbed(ctx, base(COLORS.error).setTitle('Juul Off').setDescription('The server juul is currently turned off.'));
  return replyEmbed(ctx, base(COLORS.primary).setTitle('Share a Juul').setDescription(`**${user.username}** shares the **${juul.flavor}** juul with everyone! 🌬️`));
}

// ══════════════════════════════════════════════════════════
// 39-50. EXTRA PREMIUM COMMANDS (fillers to reach 50)
// ══════════════════════════════════════════════════════════
async function handleMovieExpand(ctx, args) {
  const query = args.join(' ').trim();
  if (!query) return replyEmbed(ctx, base(COLORS.error).setTitle('Missing Title').setDescription('Usage: `,movieexpand <title>`'));
  return handleMovie(ctx, args);
}

async function handleTtsChannelAlias(ctx, args) { return handleTtsChannel(ctx, args); }
async function handleJuulHit(ctx, args) { return handleJuul(ctx, ['hit', ...args]); }
async function handleJuulPass(ctx, args) {
  const isInteraction = !!ctx.deferReply;
  const target = isInteraction ? ctx.options?.getUser?.('user') : ctx.mentions?.users?.first();
  return handleJuul(ctx, ['pass', target?.id, ...args]);
}
async function handleJuulToggle(ctx, args) { return handleJuul(ctx, ['toggle', ...args]); }
async function handleJuulStats(ctx, args) { return handleJuul(ctx, ['stats', ...args]); }
async function handleJuulFlavor(ctx, args) { return handleJuul(ctx, ['flavor', ...args]); }
async function handleJuulSteal(ctx, args) { return handleJuul(ctx, ['steal', ...args]); }


// ══════════════════════════════════════════════════════════
// 40. EMBEDCODE (copy embed JSON)
// ══════════════════════════════════════════════════════════
async function handleEmbedcode(ctx, args) {
  const input = args[0] || '';
  const linkMatch = input.match(/discord\.com\/channels\/(\d+)\/(\d+)\/(\d+)/);
  let targetMsg = null;
  try {
    if (linkMatch) {
      const [, , channelId, messageId] = linkMatch;
      const ch = await ctx.client.channels.fetch(channelId).catch(() => null);
      if (ch) targetMsg = await ch.messages.fetch(messageId).catch(() => null);
    }
  } catch {}
  if (!targetMsg) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Message Not Found').setDescription('Provide a valid message link.\nUsage: `,embedcode <message-link>`'));
  if (!targetMsg.embeds.length) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ No Embed').setDescription('That message has no embeds.'));
  const embed = targetMsg.embeds[0];
  const code = JSON.stringify(embed.toJSON ? embed.toJSON() : embed.data, null, 2);
  return replyEmbed(ctx, base(COLORS.primary).setTitle('📋 Embed Code')
    .setDescription(`\`\`\`json\n${code.slice(0, 3900)}\n\`\`\``)
    .setFooter({ text: 'Copy this JSON to recreate the embed' }));
}

// ══════════════════════════════════════════════════════════
// 41. RANDOMHEX
// ══════════════════════════════════════════════════════════
async function handleRandomhex(ctx, args) {
  const hex = Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0').toUpperCase();
  const embed = base(COLORS.primary).setTitle('🎨 Random Hex')
    .setDescription(`\`#${hex}\``)
    .setColor(parseInt(hex, 16));
  return replyEmbed(ctx, embed);
}

// ══════════════════════════════════════════════════════════
// 42. CHARINFO
// ══════════════════════════════════════════════════════════
async function handleCharinfo(ctx, args) {
  const text = args.join(' ');
  if (!text) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Missing Characters').setDescription('Usage: `,charinfo <characters>`'));
  const chars = [...text].slice(0, 20);
  const fields = chars.map(c => {
    const cp = c.codePointAt(0);
    const hex = cp.toString(16).toUpperCase().padStart(4, '0');
    return { name: `${c}`, value: `U+${hex} | Dec: ${cp}`, inline: true };
  });
  return replyEmbed(ctx, base(COLORS.primary).setTitle('🔤 Character Info').addFields(fields));
}

// ══════════════════════════════════════════════════════════
// 43. COLOR
// ══════════════════════════════════════════════════════════
async function handleColor(ctx, args) {
  let hex = args[0]?.replace('#', '') || '';
  if (!/^[0-9A-Fa-f]{6}$/.test(hex)) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Invalid Hex').setDescription('Usage: `,color <hex>`\nExample: `,color #5865F2`'));
  hex = hex.toUpperCase();
  const embed = base(COLORS.primary).setTitle(`🎨 Color #${hex}`)
    .setDescription(`Hex: \`#${hex}\`\nRGB: \`${parseInt(hex.slice(0,2),16)}, ${parseInt(hex.slice(2,4),16)}, ${parseInt(hex.slice(4,6),16)}\``)
    .setColor(parseInt(hex, 16));
  return replyEmbed(ctx, embed);
}

// ══════════════════════════════════════════════════════════
// 44. ADDEMOTE
// ══════════════════════════════════════════════════════════
async function handleAddemote(ctx, args) {
  const isInteraction = !!ctx.deferReply;
  const member = isInteraction ? ctx.member : ctx.member;
  if (!member.permissions.has(PermissionFlagsBits.ManageGuildExpressions) && !member.permissions.has(PermissionFlagsBits.CreateGuildExpressions)) {
    return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Permission Denied').setDescription('You need **Manage Expressions** permission.'));
  }
  const input = args[0] || '';
  const match = input.match(/<(a)?:(\w+):(\d+)>/);
  if (!match) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Invalid Emoji').setDescription('Provide a custom emoji.\nUsage: `,addemote <emoji>`'));
  const animated = !!match[1], name = match[2], id = match[3];
  const ext = animated ? 'gif' : 'png';
  const url = `https://cdn.discordapp.com/emojis/${id}.${ext}?size=256`;
  try {
    const emoji = await ctx.guild.emojis.create({ attachment: url, name });
    return replyEmbed(ctx, base(COLORS.success).setTitle('✅ Emoji Added').setDescription(`Added ${emoji} as \`:${emoji.name}:\``));
  } catch (err) {
    return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Failed').setDescription(`Could not add emoji: ${err.message}`));
  }
}

// ══════════════════════════════════════════════════════════
// 45. RPS
// ══════════════════════════════════════════════════════════
async function handleRps(ctx, args) {
  const choice = args[0]?.toLowerCase();
  const valid = ['rock', 'paper', 'scissors'];
  if (!valid.includes(choice)) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Invalid Choice').setDescription('Usage: `,rps <rock|paper|scissors>`'));
  const botChoice = valid[Math.floor(Math.random() * 3)];
  const emojis = { rock: '🪨', paper: '📄', scissors: '✂️' };
  let result;
  if (choice === botChoice) result = "It's a **draw**!";
  else if ((choice === 'rock' && botChoice === 'scissors') || (choice === 'paper' && botChoice === 'rock') || (choice === 'scissors' && botChoice === 'paper')) result = 'You **win**! 🎉';
  else result = 'You **lose**! 😢';
  return replyEmbed(ctx, base(COLORS.primary).setTitle('🎮 Rock Paper Scissors')
    .setDescription(`You: ${emojis[choice]} **${choice}**\nBot: ${emojis[botChoice]} **${botChoice}**\n\n${result}`));
}

// ══════════════════════════════════════════════════════════
// 46. CHOOSE
// ══════════════════════════════════════════════════════════
async function handleChoose(ctx, args) {
  const input = args.join(' ');
  if (!input.includes(',')) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Invalid Format').setDescription('Usage: `,choose <option1>, <option2>, <option3>`'));
  const choices = input.split(',').map(c => c.trim()).filter(c => c);
  if (choices.length < 2) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Not Enough Choices').setDescription('Provide at least 2 choices separated by commas.'));
  const choice = rand(choices);
  return replyEmbed(ctx, base(COLORS.primary).setTitle('🎯 I Choose...').setDescription(`**${choice}**`));
}

// ══════════════════════════════════════════════════════════
// 47. JUMBO
// ══════════════════════════════════════════════════════════
async function handleJumbo(ctx, args) {
  const input = args[0] || '';
  const match = input.match(/<(a)?:(\w+):(\d+)>/);
  if (match) {
    const animated = !!match[1], id = match[3];
    const ext = animated ? 'gif' : 'png';
    const url = `https://cdn.discordapp.com/emojis/${id}.${ext}?size=256`;
    return replyEmbed(ctx, base(COLORS.primary).setTitle('🔍 Jumbo').setImage(url));
  }
  if (input.length > 0) {
    const codePoints = [...input].map(c => c.codePointAt(0).toString(16)).join('-');
    const url = `https://cdn.jsdelivr.net/gh/twitter/twemoji@latest/assets/72x72/${codePoints}.png`;
    return replyEmbed(ctx, base(COLORS.primary).setTitle('🔍 Jumbo').setImage(url));
  }
  return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Invalid Emoji').setDescription('Usage: `,jumbo <emoji>`'));
}

// ══════════════════════════════════════════════════════════
// 48. WOULDRATHER
// ══════════════════════════════════════════════════════════
const WYR_QUESTIONS = [
  "Would you rather be able to fly or be invisible?",
  "Would you rather have unlimited money or unlimited time?",
  "Would you rather be famous or be rich?",
  "Would you rather live in the past or the future?",
  "Would you rather be able to read minds or see the future?",
  "Would you rather never use social media again or never watch TV again?",
  "Would you rather have a pet dragon or a pet unicorn?",
  "Would you rather be the smartest person in the world or the strongest?",
  "Would you rather eat only pizza forever or only burgers forever?",
  "Would you rather have no internet for a month or no phone for a month?"
];
async function handleWouldyourather(ctx, args) {
  const q = rand(WYR_QUESTIONS);
  return replyEmbed(ctx, base(COLORS.primary).setTitle('🤔 Would You Rather?').setDescription(q));
}

// ══════════════════════════════════════════════════════════
// 49. INVITES
// ══════════════════════════════════════════════════════════
async function handleInvites(ctx, args) {
  const isInteraction = !!ctx.deferReply;
  const member = isInteraction ? ctx.member : ctx.member;
  if (!member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Permission Denied').setDescription('You need **Manage Server** permission.'));
  }
  try {
    const invites = await ctx.guild.invites.fetch();
    if (!invites.size) return replyEmbed(ctx, base(COLORS.warning).setTitle('📨 Invites').setDescription('No active invites found.'));
    const list = invites.map(inv => `**${inv.code}** — ${inv.uses} uses | ${inv.inviter?.tag || 'Unknown'}`).slice(0, 20).join('\n');
    return replyEmbed(ctx, base(COLORS.primary).setTitle('📨 Active Invites').setDescription(list));
  } catch (err) {
    return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Failed').setDescription('Could not fetch invites.'));
  }
}

// ══════════════════════════════════════════════════════════
// 50. MAKEMP3
// ══════════════════════════════════════════════════════════
async function handleMakemp3(ctx, args) {
  const url = await resolveImageUrl(ctx, args);
  if (!url) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Invalid URL').setDescription('Usage: `,makemp3 <video-url>` or reply to a video.'));
  return replyEmbed(ctx, base(COLORS.warning).setTitle('MakeMP3')
    .setDescription('Audio extraction requires ffmpeg.\n\n**To enable:**\n`npm install ffmpeg-static fluent-ffmpeg`\n\n**Usage:** `,makemp3 <video-url>`'));
}

// ══════════════════════════════════════════════════════════
// 51. WIKIHOW
// ══════════════════════════════════════════════════════════
async function handleWikihow(ctx, args) {
  const query = args.join(' ').trim();
  if (!query) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Missing Query').setDescription('Usage: `,wikihow <query>`'));
  try {
    const data = await jsonFetch(`https://www.wikihow.com/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=5`);
    const results = data.query?.search;
    if (!results?.length) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ No Results').setDescription('No WikiHow articles found.'));
    const list = results.map((r, i) => `**${i+1}.** [${r.title}](https://www.wikihow.com/${r.title.replace(/ /g, '-')})`).join('\n');
    return replyEmbed(ctx, base(COLORS.primary).setTitle(`📖 WikiHow: ${query}`).setDescription(list));
  } catch {
    return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Failed').setDescription('Could not search WikiHow.'));
  }
}

// ══════════════════════════════════════════════════════════
// 52. GNAMES (guild name history)
// ══════════════════════════════════════════════════════════
async function handleGnames(ctx, args) {
  const guildId = args[0] || ctx.guild.id;
  const db = getGuildDb(guildId);
  const history = db.get('nameHistory', []);
  if (!history.length) return replyEmbed(ctx, base(COLORS.warning).setTitle('📛 Guild Name History').setDescription('No name changes recorded.'));
  const list = history.slice(-20).map((h, i) => `${i+1}. **${h.name}** — <t:${Math.floor(h.time/1000)}:R>`).join('\n');
  return replyEmbed(ctx, base(COLORS.primary).setTitle('📛 Guild Name History').setDescription(list));
}

// ══════════════════════════════════════════════════════════
// 53. CLEARNAMES
// ══════════════════════════════════════════════════════════
async function handleClearnames(ctx, args) {
  const udb = getUserDb(ctx.guild.id, ctx.author.id);
  udb.set('nameHistory', []);
  return replyEmbed(ctx, base(COLORS.success).setTitle('✅ Cleared').setDescription('Your name history has been reset.'));
}

// ══════════════════════════════════════════════════════════
// 54. CLEARGNAMES
// ══════════════════════════════════════════════════════════
async function handleCleargnames(ctx, args) {
  const member = ctx.member || ctx.member;
  if (!member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Permission Denied').setDescription('You need **Manage Server** permission.'));
  }
  const db = getGuildDb(ctx.guild.id);
  db.set('nameHistory', []);
  return replyEmbed(ctx, base(COLORS.success).setTitle('✅ Cleared').setDescription('Guild name history has been reset.'));
}

// ══════════════════════════════════════════════════════════
// 55. BRAINLY
// ══════════════════════════════════════════════════════════
async function handleBrainly(ctx, args) {
  const query = args.join(' ').trim();
  if (!query) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Missing Query').setDescription('Usage: `,brainly <question>`'));
  return replyEmbed(ctx, base(COLORS.primary).setTitle('🧠 Brainly Search')
    .setDescription(`[Search Brainly for "${query}"](https://brainly.com/app/ask?q=${encodeURIComponent(query)})`));
}

// ══════════════════════════════════════════════════════════
// 56. NAMES (user name history)
// ══════════════════════════════════════════════════════════
async function handleNames(ctx, args) {
  const isInteraction = !!ctx.deferReply;
  const target = isInteraction ? (ctx.options?.getUser?.('user') || ctx.user) : (ctx.mentions?.users?.first() || ctx.author);
  const udb = getUserDb(ctx.guild.id, target.id);
  const history = udb.get('nameHistory', []);
  if (!history.length) return replyEmbed(ctx, base(COLORS.warning).setTitle('📛 Name History').setDescription(`${target.username} has no recorded name changes.`));
  const list = history.slice(-20).map((h, i) => `${i+1}. **${h.name}** — <t:${Math.floor(h.time/1000)}:R>`).join('\n');
  return replyEmbed(ctx, base(COLORS.primary).setTitle(`📛 Name History — ${target.username}`).setDescription(list));
}

// ══════════════════════════════════════════════════════════
// 57. SHAZAM
// ══════════════════════════════════════════════════════════
async function handleShazam(ctx, args) {
  const url = await resolveImageUrl(ctx, args);
  if (!url) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Invalid URL').setDescription('Usage: `,shazam <audio-url>` or reply to an audio/video.'));
  const key = API_KEYS.AUDD_API_KEY;
  if (!key) {
    return replyEmbed(ctx, base(COLORS.error).setTitle('❌ API Key Missing')
      .setDescription('Add `AUDD_API_KEY` to `config/apikeys.js`.\nGet one at https://audd.io/'));
  }
  try {
    const form = new FormData();
    form.append('url', url);
    form.append('api_token', key);
    form.append('return', 'apple_music,spotify');
    const res = await fetch('https://api.audd.io/', { method: 'POST', body: form, signal: AbortSignal.timeout(20000) });
    const data = await res.json();
    if (data.status === 'error' || !data.result) throw new Error(data.error?.error_message || 'No match found');
    const r = data.result;
    const embed = base(COLORS.primary).setTitle(`🎵 ${r.title} — ${r.artist}`)
      .addFields(
        { name: 'Album', value: r.album || 'N/A', inline: true },
        { name: 'Release', value: r.release_date || 'N/A', inline: true }
      );
    if (r.apple_music?.url) embed.addFields({ name: 'Apple Music', value: `[Listen](${r.apple_music.url})`, inline: true });
    if (r.spotify?.external_urls?.spotify) embed.addFields({ name: 'Spotify', value: `[Listen](${r.spotify.external_urls.spotify})`, inline: true });
    return replyEmbed(ctx, embed);
  } catch (err) {
    return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Failed').setDescription(`Could not identify song: ${err.message}`));
  }
}

/**
 * funCommands.js PATCH — Apply these 2 changes to your existing file
 * 
 * CHANGE 1: In the handleTopcommands function, replace the entire function with:
 */

// 58. TOPCOMMANDS
const commandUsage = new Map();
async function handleTopcommands(ctx, args) {
  const db = getGuildDb(ctx.guild.id);
  const persisted = db.get('commandUsage', {});
  // Merge persisted + live Map
  const merged = new Map();
  for (const [cmd, count] of Object.entries(persisted)) merged.set(cmd, count);
  for (const [cmd, count] of commandUsage.entries()) merged.set(cmd, (merged.get(cmd) || 0) + count);

  if (!merged.size) return replyEmbed(ctx, base(COLORS.warning).setTitle('📊 Top Commands').setDescription('No command usage recorded yet.'));
  const sorted = [...merged.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
  const list = sorted.map(([cmd, count], i) => `${i+1}. **${cmd}** — ${count} uses`).join('\n');
  return replyEmbed(ctx, base(COLORS.primary).setTitle('📊 Top Commands').setDescription(list));
}


// ══════════════════════════════════════════════════════════
// 59. AFK MENTIONS
// ══════════════════════════════════════════════════════════
async function handleAfkmentions(ctx, args) {
  const udb = getUserDb(ctx.guild.id, ctx.author.id);
  const mentions = udb.get('afkMentions', []);
  if (!mentions.length) return replyEmbed(ctx, base(COLORS.warning).setTitle('📬 AFK Mentions').setDescription('No mentions received while you were AFK.'));
  const list = mentions.slice(-10).map((m, i) => `${i+1}. <@${m.userId}> in <#${m.channelId}>: "${m.content.slice(0, 50)}..." — <t:${Math.floor(m.time/1000)}:R>`).join('\n');
  udb.set('afkMentions', []);
  return replyEmbed(ctx, base(COLORS.primary).setTitle('📬 AFK Mentions').setDescription(list).setFooter({ text: 'Mentions cleared' }));
}

// ══════════════════════════════════════════════════════════
// 60. POLL
// ══════════════════════════════════════════════════════════
function parseDuration(str) {
  const match = str.match(/^(\d+)([smhd])$/i);
  if (!match) return null;
  const num = parseInt(match[1]);
  const unit = match[2].toLowerCase();
  const mult = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return num * mult[unit];
}

async function handlePoll(ctx, args) {
  const timeStr = args[0];
  const question = args.slice(1).join(' ');
  if (!timeStr || !question) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Missing Arguments').setDescription('Usage: `,poll <time> <question>`\nExample: `,poll 5m Should we play games?`'));
  const ms = parseDuration(timeStr);
  if (!ms || ms > 3600000) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Invalid Time').setDescription('Max poll time is 1 hour. Use format like `5m`, `10m`, `30m`.'));
  const embed = base(COLORS.primary).setTitle('📊 Poll').setDescription(`**${question}**\n\nReact with 👍 or 👎\nEnds <t:${Math.floor((Date.now()+ms)/1000)}:R>`);
  const msg = await ctx.channel.send({ embeds: [embed] });
  await msg.react('👍');
  await msg.react('👎');
  setTimeout(async () => {
    const fetched = await msg.fetch().catch(() => null);
    if (!fetched) return;
    const up = fetched.reactions.cache.get('👍')?.count || 0;
    const down = fetched.reactions.cache.get('👎')?.count || 0;
    const result = up > down ? '👍 Yes wins!' : down > up ? '👎 No wins!' : "🤝 It's a tie!";
    const endEmbed = base(COLORS.primary).setTitle('📊 Poll Ended').setDescription(`**${question}**\n\n👍 ${up-1} | 👎 ${down-1}\n\n**${result}**`);
    await msg.edit({ embeds: [endEmbed] });
  }, ms);
}

// ══════════════════════════════════════════════════════════
// 61. CHATGPT (Groq — free tier)
// ══════════════════════════════════════════════════════════
async function handleChatgpt(ctx, args) {
  const isInteraction = !!ctx.deferReply;
  const member = isInteraction ? ctx.member : ctx.member;
  const hasBoosterRole = member.roles.cache.some(r => r.name.toLowerCase() === 'Server Booster');
  const isBooster = member.premiumSince !== null;
  if (!hasBoosterRole && !isBooster && !member.permissions.has(PermissionFlagsBits.Administrator)) {
    return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Permission Denied').setDescription('This command requires the **Server Booster** role or Server Booster status.'));
  }
  const question = args.join(' ').trim();
  if (!question) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Missing Question').setDescription('Usage: `,chatgpt <question>`'));
  const key = API_KEYS.GROQ_API_KEY || API_KEYS.OPENAI_API_KEY;
  if (!key) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ API Key Missing').setDescription('Add `GROQ_API_KEY` to `config/apikeys.js`.\nGet one free at https://console.groq.com/keys'));
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages: [{ role: 'user', content: question }], max_tokens: 1024 }),
      signal: AbortSignal.timeout(30000)
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || data.error);
    const answer = data.choices?.[0]?.message?.content || 'No response.';
    return replyEmbed(ctx, base(COLORS.primary).setTitle('<:openAI:1535771755287937054>').setDescription(answer.slice(0, 4000)));
  } catch (err) {
    return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Failed').setDescription(`Groq error: ${err.message}`));
  }
}

// ══════════════════════════════════════════════════════════
// 62. UWU
// ══════════════════════════════════════════════════════════
async function handleUwu(ctx, args) {
  const text = args.join(' ');
  if (!text) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Missing Text').setDescription('Usage: `,uwu <text>`'));
  const uwu = text
    .replace(/[rl]/g, 'w').replace(/[RL]/g, 'W')
    .replace(/n([aeiou])/g, 'ny$1').replace(/N([aeiouAEIOU])/g, 'Ny$1')
    .replace(/ove/g, 'uv').replace(/OVE/g, 'UV')
    + ' uwu';
  return replyEmbed(ctx, base(COLORS.primary).setTitle('🐱 UwU').setDescription(uwu.slice(0, 2000)));
}

// ══════════════════════════════════════════════════════════
// 63. FREAKY
// ══════════════════════════════════════════════════════════
async function handleFreaky(ctx, args) {
  const text = args.join(' ');
  if (!text) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Missing Text').setDescription('Usage: `,freaky <text>`'));
  const vowels = 'aeiouAEIOU';
  const freaky = [...text].map(c => vowels.includes(c) ? c + c + c : c).join('');
  return replyEmbed(ctx, base(COLORS.primary).setTitle('👅 Freaky').setDescription(freaky.slice(0, 2000)));
}

// ══════════════════════════════════════════════════════════
// 64. QUICKPOLL
// ══════════════════════════════════════════════════════════
async function handleQuickpoll(ctx, args) {
  const msg = ctx.message || ctx;
  let targetMsg = null;
  if (msg.reference?.messageId) {
    try { targetMsg = await msg.channel.messages.fetch(msg.reference.messageId); } catch {}
  }
  if (!targetMsg && args[0]?.match(/^\d+$/)) {
    try { targetMsg = await msg.channel.messages.fetch(args[0]); } catch {}
  }
  if (!targetMsg) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ No Message').setDescription('Reply to a message or provide a message ID.\nUsage: `,quickpoll <message-id>`'));
  await targetMsg.react('⬆️');
  await targetMsg.react('⬇️');
  return replyEmbed(ctx, base(COLORS.success).setTitle('✅ Quick Poll').setDescription('Added up/down reactions.'));
}

// ══════════════════════════════════════════════════════════
// EXPORTS
// ══════════════════════════════════════════════════════════
module.exports = {
  lyrics: handleLyrics,
  duckduckgo: handleDuckDuckGo,
  blacktea: handleBlacktea,
  quote: handleQuote,
  tictactoe: handleTicTacToe,
  giphy: handleGiphy,
  steal: handleSteal,
  duckduckgoimage: handleDuckDuckGoImage,
  reverseimage: handleReverseImage,
  image: handleImage,
  book: handleBook,
  manga: handleManga,
  anime: handleAnime,
  character: handleCharacter,
  tone: handleTone,
  tags: handleTags,
  tvshow: handleTvshow,
  game: handleGame,
  movie: handleMovie,
  movieexpand: handleMovieExpand,
  ocr: handleOcr,
  ocrtr: handleOcrtr,
  translate: handleTranslate,
  tts: handleTts,
  ttschannel: handleTtsChannel,
  lego: handleLego,
  makegif: handleMakegif,
  transparent: handleTransparent,
  wolfram: handleWolfram,
  juul: handleJuul,
  'juul hit': handleJuulHit,
  'juul pass': handleJuulPass,
  'juul toggle': handleJuulToggle,
  'juul stats': handleJuulStats,
  'juul flavor': handleJuulFlavor,
  'juul steal': handleJuulSteal,
  embedcode: handleEmbedcode,
  randomhex: handleRandomhex,
  charinfo: handleCharinfo,
  color: handleColor,
  addemote: handleAddemote,
  rps: handleRps,
  choose: handleChoose,
  jumbo: handleJumbo,
  wouldyourather: handleWouldyourather,
  invites: handleInvites,
  makemp3: handleMakemp3,
  wikihow: handleWikihow,
  gnames: handleGnames,
  clearnames: handleClearnames,
  cleargnames: handleCleargnames,
  brainly: handleBrainly,
  names: handleNames,
  shazam: handleShazam,
  topcommands: handleTopcommands,
  afkmentions: handleAfkmentions,
  poll: handlePoll,
  chatgpt: handleChatgpt,
  uwu: handleUwu,
  freaky: handleFreaky,
  quickpoll: handleQuickpoll,
  commandUsage,
};