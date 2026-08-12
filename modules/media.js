/**
 * media.js — Image manipulation commands (36 commands)
 * Uses ImageMagick 7 (magick) and FFmpeg — both available in Replit runtime.
 *
 * Usage: .media <command> [args]
 * Image source: message attachment, replied-to attachment, URL in args, or @mention avatar.
 */

const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const logger = require('../utils/logger');

// ══════════════════════════════════════════════════════════
// TOOL PATHS (available in Replit's Nix runtime)
// ══════════════════════════════════════════════════════════
const MAGICK = 'magick';
const FFMPEG = 'ffmpeg';

// ══════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════

/** Run a command, reject on non-zero exit. Returns stdout string. */
function run(cmd, args, timeoutMs = 45_000) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { timeout: timeoutMs });
    let out = '', err = '';
    proc.stdout?.on('data', d => { out += d; });
    proc.stderr?.on('data', d => { err += d; });
    proc.on('close', code => {
      if (code === 0) resolve(out.trim());
      else reject(new Error(`${cmd} exit ${code}: ${err.slice(0, 400)}`));
    });
    proc.on('error', reject);
  });
}

/** Download a URL to a temp file; returns the file path. */
async function fetchToTemp(url, ext) {
  const name = `media_${Date.now()}_${Math.random().toString(36).slice(2)}${ext || ''}`;
  const dest = path.join(os.tmpdir(), name);
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} downloading image`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  return dest;
}

/** Create a temporary file path (not yet created). */
function tmpPath(ext) {
  return path.join(os.tmpdir(), `media_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);
}

/** Safe delete — no error if file doesn't exist. */
function safeDelete(...files) {
  for (const f of files) try { fs.unlinkSync(f); } catch {}
}

/** Get image dimensions via magick identify. Returns {w, h}. */
async function getDimensions(file) {
  const out = await run(MAGICK, ['identify', '-format', '%wx%h', `${file}[0]`]);
  const [w, h] = out.trim().split('x').map(Number);
  return { w: w || 256, h: h || 256 };
}

/**
 * Resolve the image URL from a Discord message.
 * Priority: attachment on message > attachment on replied-to > URL in args > mentioned user avatar > author avatar.
 */
async function resolveImageUrl(message, args) {
  // 1. Direct attachment on this message
  const att = message.attachments.first();
  if (att) return att.url;

  // 2. Replied-to message attachment
  const ref = message.reference?.messageId;
  if (ref) {
    const refMsg = await message.channel.messages.fetch(ref).catch(() => null);
    if (refMsg) {
      const refAtt = refMsg.attachments.first();
      if (refAtt) return refAtt.url;
      // Also check embeds in the reply
      const embed = refMsg.embeds.find(e => e.image || e.thumbnail);
      if (embed) return (embed.image || embed.thumbnail).url;
    }
  }

  // 3. URL in args
  const urlArg = args.find(a => /^https?:\/\//i.test(a));
  if (urlArg) return urlArg;

  // 4. Mentioned user avatar
  const mentioned = message.mentions.users.first();
  if (mentioned) return mentioned.displayAvatarURL({ size: 512, extension: 'png' });

  // 5. Author avatar
  return message.author.displayAvatarURL({ size: 512, extension: 'png' });
}

/** Send the result image back to Discord as an attachment. */
async function sendResult(message, filePath, filename, caption) {
  const attachment = new AttachmentBuilder(filePath, { name: filename });
  await message.channel.send({
    content: caption || null,
    files: [attachment],
    reply: { messageReference: message.id, failIfNotExists: false },
  });
}

function errorEmbed(text) {
  return new EmbedBuilder().setColor('#ED4245').setDescription(`❌ ${text}`);
}

// ══════════════════════════════════════════════════════════
// ── STATIC IMAGE FILTERS ──
// ══════════════════════════════════════════════════════════

async function doGrayscale(input, output) {
  await run(MAGICK, [input + '[0]', '-grayscale', 'Rec709Luma', output]);
}

async function doBlur(input, output, strength = 8) {
  const s = Math.min(Math.max(Number(strength) || 8, 1), 40);
  await run(MAGICK, [input + '[0]', '-blur', `0x${s}`, output]);
}

async function doInvert(input, output) {
  await run(MAGICK, [input + '[0]', '-negate', output]);
}

async function doPixelate(input, output) {
  const { w, h } = await getDimensions(input);
  const size = Math.min(w, h, 512);
  await run(MAGICK, [
    input + '[0]',
    '-resize', `${size}x${size}^`, '-gravity', 'Center', '-extent', `${size}x${size}`,
    '-resize', '5%', '-filter', 'point', '-resize', `${size}x${size}!`,
    output,
  ]);
}

async function doDeepFry(input, output) {
  await run(MAGICK, [
    input + '[0]',
    '-modulate', '100,200',
    '-brightness-contrast', '15x65',
    '-unsharp', '0x12',
    '-quality', '5',
    output,
  ]);
}

async function doFisheye(input, output) {
  await run(MAGICK, [
    input + '[0]',
    '-virtual-pixel', 'mirror',
    '-distort', 'Barrel', '0.3 0.0 0.0 0.7',
    output,
  ]);
}

async function doSwirl(input, output, strength = 180) {
  const s = Math.min(Math.max(Number(strength) || 180, -360), 360);
  await run(MAGICK, [input + '[0]', '-swirl', String(s), output]);
}

async function doSpread(input, output, strength = 8) {
  const s = Math.min(Math.max(Number(strength) || 8, 1), 50);
  await run(MAGICK, [input + '[0]', '-spread', String(s), output]);
}

async function doBloom(input, output) {
  // Screen-blend a blurred copy over the original for bloom effect
  await run(MAGICK, [
    input + '[0]',
    '(', '+clone', '-blur', '0x18', ')',
    '-compose', 'Screen', '-composite',
    output,
  ]);
}

async function doNeon(input, output) {
  // Edge-detect, negate, then add colour glow
  await run(MAGICK, [
    input + '[0]',
    '-colorspace', 'Gray',
    '-edge', '2',
    '-negate',
    '-sigmoidal-contrast', '8,50%',
    '-fill', 'cyan', '-tint', '60',
    output,
  ]);
}

async function doMagik(input, output) {
  // Content-aware rescale (liquid rescale)
  const { w, h } = await getDimensions(input);
  const size = Math.min(w, h, 400);
  await run(MAGICK, [
    input + '[0]',
    '-resize', `${size}x${size}^`, '-gravity', 'Center', '-extent', `${size}x${size}`,
    '-liquid-rescale', '50%x100%',
    '-resize', `${size}x${size}!`,
    output,
  ]);
}

async function doZoomBlur(input, output) {
  // Radial zoom blur via multiple scaled composites
  const { w, h } = await getDimensions(input);
  const size = Math.min(w, h, 400);
  await run(MAGICK, [
    input + '[0]',
    '-resize', `${size}x${size}^`, '-gravity', 'Center', '-extent', `${size}x${size}`,
    '-motion-blur', '0x30+270',
    output,
  ]);
}

// ══════════════════════════════════════════════════════════
// ── TEXT OVERLAY COMMANDS ──
// ══════════════════════════════════════════════════════════

async function doCaption(input, output, text) {
  const { w } = await getDimensions(input);
  const size = Math.min(w, 600);
  const fontSize = Math.max(20, Math.floor(size / 16));
  await run(MAGICK, [
    input + '[0]',
    '-resize', `${size}x`,
    '-font', 'DejaVu-Sans-Bold',
    '-pointsize', String(fontSize),
    '-fill', 'white',
    '-stroke', 'black',
    '-strokewidth', '2',
    '-gravity', 'South',
    '-annotate', '+0+10',
    text,
    output,
  ]);
}

async function doMeme(input, output, top, bottom) {
  const { w } = await getDimensions(input);
  const size = Math.min(w, 600);
  const fontSize = Math.max(24, Math.floor(size / 10));
  const args = [
    input + '[0]',
    '-resize', `${size}x`,
    '-font', 'DejaVu-Sans-Bold',
    '-pointsize', String(fontSize),
    '-fill', 'white',
    '-stroke', 'black',
    '-strokewidth', '3',
  ];
  if (top) {
    args.push('-gravity', 'North', '-annotate', '+0+10', top.toUpperCase());
  }
  if (bottom) {
    args.push('-gravity', 'South', '-annotate', '+0+10', bottom.toUpperCase());
  }
  args.push(output);
  await run(MAGICK, args);
}

async function doMotivate(input, output, top, bottom) {
  const { w, h } = await getDimensions(input);
  const size = Math.min(w, h, 400);
  const border = Math.floor(size * 0.07);
  const textH = Math.floor(size * 0.18);
  const total = size + border * 2 + textH;
  const topSize = Math.max(22, Math.floor(size / 10));
  const botSize = Math.max(14, Math.floor(size / 18));

  await run(MAGICK, [
    // black canvas
    '-size', `${total}x${total}`, 'xc:black',
    // place image in centre
    '(', input + '[0]', '-resize', `${size}x${size}^`, '-gravity', 'Center', '-extent', `${size}x${size}`, ')',
    '-gravity', 'North', '-geometry', `+0+${border}`,
    '-composite',
    // white border around image
    '-fill', 'none', '-stroke', 'white', '-strokewidth', '3',
    '-draw', `rectangle ${border - 4},${border - 4} ${size + border + 4},${size + border + 4}`,
    // top text (big)
    '-font', 'DejaVu-Sans-Bold', '-pointsize', String(topSize),
    '-fill', 'white', '-stroke', 'none',
    '-gravity', 'South', '-annotate', `+0+${botSize + 12}`, (top || '').toUpperCase(),
    // bottom text (small italic)
    '-font', 'DejaVu-Sans', '-pointsize', String(botSize),
    '-fill', 'white',
    '-gravity', 'South', '-annotate', '+0+8', bottom || '',
    output,
  ]);
}

async function doSpeechBubble(input, output, text) {
  const { w, h } = await getDimensions(input);
  const size = Math.min(w, 512);
  const bubbleH = Math.floor(size * 0.22);
  const total = Math.floor(size * (h / w)) + bubbleH;
  const fontSize = Math.max(16, Math.floor(size / 18));

  await run(MAGICK, [
    input + '[0]',
    '-resize', `${size}x`,
    // draw white rounded bubble at top
    '-fill', 'white', '-stroke', 'black', '-strokewidth', '2',
    '-draw', `roundrectangle 10,5 ${size - 10},${bubbleH - 10} 12,12`,
    // bubble tail
    '-draw', `polygon ${size / 2 - 12},${bubbleH - 10} ${size / 2 + 12},${bubbleH - 10} ${size / 2},${bubbleH + 8}`,
    // text
    '-font', 'DejaVu-Sans-Bold', '-pointsize', String(fontSize),
    '-fill', 'black', '-stroke', 'none',
    '-gravity', 'North', '-annotate', `+0+${Math.floor(bubbleH * 0.2)}`, text || '...',
    output,
  ]);
}

// ══════════════════════════════════════════════════════════
// ── OVERLAY / TEMPLATE EFFECTS ──
// ══════════════════════════════════════════════════════════

async function doFlag(input, output, variant = 1) {
  const { w, h } = await getDimensions(input);
  const size = Math.min(w, h, 400);

  // Build a horizontal tricolour flag overlay and composite
  const colors = variant === 1
    ? ['#0055A4', '#FFFFFF', '#EF4135'] // France
    : ['#D00C27', '#003DA5', '#FFFFFF']; // Netherlands (alt)

  const stripH = Math.floor(size / 3);

  await run(MAGICK, [
    input + '[0]',
    '-resize', `${size}x${size}^`, '-gravity', 'Center', '-extent', `${size}x${size}`,
    // flag overlay at 60% opacity
    '(',
    '-size', `${size}x${size}`, 'xc:none',
    '-fill', colors[0], '-draw', `rectangle 0,0 ${size},${stripH}`,
    '-fill', colors[1], '-draw', `rectangle 0,${stripH} ${size},${stripH * 2}`,
    '-fill', colors[2], '-draw', `rectangle 0,${stripH * 2} ${size},${size}`,
    '-alpha', 'set', '-channel', 'Alpha', '-evaluate', 'set', '60%',
    ')',
    '-composite',
    output,
  ]);
}

async function doToaster(input, output) {
  // Warm orange-red tones with brightness pulse (simulate toasting)
  await run(MAGICK, [
    input + '[0]',
    '-colorize', '30,0,0', // red tint
    '-modulate', '120,140', // brighter, more saturated
    '-vignette', '0x20+0+0', // dark vignette
    output,
  ]);
}

async function doBillboard(input, output) {
  // Perspective-warp to simulate billboard placement
  const { w, h } = await getDimensions(input);
  const size = Math.min(w, h, 400);

  await run(MAGICK, [
    input + '[0]',
    '-resize', `${size}x${size}^`, '-gravity', 'Center', '-extent', `${size}x${size}`,
    '-distort', 'Perspective',
    `0,0 20,30 ${size},0 ${size - 20},25 ${size},${size} ${size - 10},${size - 15} 0,${size} 15,${size - 20}`,
    '-bordercolor', '#888', '-border', '8',
    output,
  ]);
}

async function doRubiks(input, output) {
  // Tile image 3×3 with per-cell hue shift to mimic rubiks cube face
  const { w, h } = await getDimensions(input);
  const face = Math.min(w, h, 300);
  const cell = Math.floor(face / 3);
  const hues = [0, 30, 60, 120, 180, 210, 270, 300, 340];

  const args = ['-size', `${face}x${face}`, 'xc:white'];

  for (let i = 0; i < 9; i++) {
    const row = Math.floor(i / 3);
    const col = i % 3;
    const x = col * cell;
    const y = row * cell;
    args.push(
      '(',
      input + '[0]',
      '-resize', `${cell}x${cell}!`,
      '-modulate', `100,120,${100 + hues[i]}`,
      ')',
      '-geometry', `+${x}+${y}`,
      '-composite'
    );
  }

  args.push(
    '-fill', 'none', '-stroke', 'black', '-strokewidth', '3',
    '-draw', `rectangle 0,0 ${face - 1},${face - 1}`,
    '-draw', `line ${cell},0 ${cell},${face}`,
    '-draw', `line ${cell * 2},0 ${cell * 2},${face}`,
    '-draw', `line 0,${cell} ${face},${cell}`,
    '-draw', `line 0,${cell * 2} ${face},${cell * 2}`,
    output
  );

  await run(MAGICK, args);
}

async function doTattoo(input, output) {
  // Desaturate, adjust to skin-tone, reduce opacity for tattoo look
  await run(MAGICK, [
    input + '[0]',
    '-grayscale', 'Rec709Luma',
    '-modulate', '80,0',
    '-fill', '#C8A882', '-tint', '40',
    '-negate',
    '-sigmoidal-contrast', '4,40%',
    '-negate',
    output,
  ]);
}

async function doCircuitBoard(input, output) {
  // Green tint + crosshatch grid to mimic PCB look
  const { w, h } = await getDimensions(input);
  const size = Math.min(w, h, 400);
  const gridSpacing = Math.floor(size / 12);

  const drawCmds = [];
  for (let x = 0; x <= size; x += gridSpacing)
    drawCmds.push(`line ${x},0 ${x},${size}`);
  for (let y = 0; y <= size; y += gridSpacing)
    drawCmds.push(`line 0,${y} ${size},${y}`);

  const args = [
    input + '[0]',
    '-resize', `${size}x${size}^`, '-gravity', 'Center', '-extent', `${size}x${size}`,
    '-fill', '#00FF00', '-tint', '50',
    '-fill', 'none', '-stroke', '#00FF0066', '-strokewidth', '1',
  ];
  for (const d of drawCmds) args.push('-draw', d);
  args.push(output);

  await run(MAGICK, args);
}

async function doFortune(input, output) {
  // Oval-cropped image with a decorative border
  const { w, h } = await getDimensions(input);
  const size = Math.min(w, h, 400);
  const rx = Math.floor(size * 0.45);
  const ry = Math.floor(size * 0.35);
  const cx = Math.floor(size / 2);
  const cy = Math.floor(size / 2);

  await run(MAGICK, [
    input + '[0]',
    '-resize', `${size}x${size}^`, '-gravity', 'Center', '-extent', `${size}x${size}`,
    // oval mask
    '(', '+clone', '-alpha', 'extract', '-fill', 'black', '-colorize', '100',
    '-fill', 'white', '-draw', `ellipse ${cx},${cy} ${rx},${ry} 0,360`, ')',
    '-alpha', 'off', '-compose', 'CopyOpacity', '-composite',
    '-fill', 'none', '-stroke', '#D4AF37', '-strokewidth', '5',
    '-draw', `ellipse ${cx},${cy} ${rx},${ry} 0,360`,
    output,
  ]);
}

async function doValentine(input, output) {
  // Red heart-shaped vignette overlay
  const { w, h } = await getDimensions(input);
  const size = Math.min(w, h, 400);
  await run(MAGICK, [
    input + '[0]',
    '-resize', `${size}x${size}^`, '-gravity', 'Center', '-extent', `${size}x${size}`,
    '-fill', '#FF003355', '-draw', `ellipse ${size * 0.32},${size * 0.38} ${size * 0.28},${size * 0.3} 0,360`,
    '-fill', '#FF003355', '-draw', `ellipse ${size * 0.68},${size * 0.38} ${size * 0.28},${size * 0.3} 0,360`,
    '-fill', '#FF003344', '-draw', `polygon ${size * 0.05},${size * 0.42} ${size * 0.5},${size * 0.95} ${size * 0.95},${size * 0.42}`,
    output,
  ]);
}

async function doBook(input, output) {
  // Perspective-warp to simulate open book page
  const { w, h } = await getDimensions(input);
  const size = Math.min(w, h, 400);

  await run(MAGICK, [
    input + '[0]',
    '-resize', `${size}x${size}^`, '-gravity', 'Center', '-extent', `${size}x${size}`,
    '-distort', 'Perspective',
    `0,0 30,15 ${size},0 ${size - 10},10 ${size},${size} ${size},${size - 5} 0,${size} 20,${size - 10}`,
    '-bordercolor', '#F5E6C8', '-border', '12',
    output,
  ]);
}

async function doHeart(input, output, text) {
  // Heart-mask clip + optional text
  const { w, h } = await getDimensions(input);
  const size = Math.min(w, h, 400);
  const cx = size / 2, cy = size * 0.52;
  const r = size * 0.3;

  const args = [
    input + '[0]',
    '-resize', `${size}x${size}^`, '-gravity', 'Center', '-extent', `${size}x${size}`,
    '-fill', '#FF1493AA',
    '-draw', `ellipse ${cx - r * 0.5},${cy - r * 0.2} ${r * 0.52},${r * 0.52} 0,360`,
    '-draw', `ellipse ${cx + r * 0.5},${cy - r * 0.2} ${r * 0.52},${r * 0.52} 0,360`,
    '-draw', `polygon ${cx - r},${cy} ${cx + r},${cy} ${cx},${cy + r * 1.3}`,
  ];

  if (text) {
    const fontSize = Math.max(16, Math.floor(size / 16));
    args.push(
      '-font', 'DejaVu-Sans-Bold', '-pointsize', String(fontSize),
      '-fill', 'white', '-stroke', '#FF1493', '-strokewidth', '2',
      '-gravity', 'South', '-annotate', '+0+10', text
    );
  }

  args.push(output);
  await run(MAGICK, args);
}

// ══════════════════════════════════════════════════════════
// ── GIF ANIMATION EFFECTS ──
// ══════════════════════════════════════════════════════════

/** Generates N frames by calling makeFrame(frameIdx, tmpDir) -> path, then assembles GIF. */
async function makeGif(makeFrame, frameCount, delay, output, optimize = true) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediaframes_'));
  const frames = [];
  try {
    for (let i = 0; i < frameCount; i++) {
      const framePath = await makeFrame(i, tmpDir);
      frames.push(framePath);
    }
    const args = ['-delay', String(delay), '-loop', '0'];
    if (optimize) args.push('-layers', 'optimize');
    args.push(...frames, output);
    await run(MAGICK, args);
  } finally {
    safeDelete(...frames);
    try { fs.rmdirSync(tmpDir); } catch {}
  }
}

async function doSpin(input, output) {
  const { w, h } = await getDimensions(input);
  const size = Math.min(w, h, 280);
  const FRAMES = 16;
  await makeGif(async (i, dir) => {
    const f = path.join(dir, `f${i}.png`);
    await run(MAGICK, [
      input + '[0]',
      '-resize', `${size}x${size}^`, '-gravity', 'Center', '-extent', `${size}x${size}`,
      '-background', 'none', '-rotate', String(i * (360 / FRAMES)),
      '-gravity', 'Center', '-extent', `${size}x${size}`,
      f,
    ]);
    return f;
  }, FRAMES, 6, output);
}

async function doRainbow(input, output) {
  const { w, h } = await getDimensions(input);
  const size = Math.min(w, h, 280);
  const FRAMES = 18;
  await makeGif(async (i, dir) => {
    const f = path.join(dir, `f${i}.png`);
    const hue = 100 + Math.floor((i / FRAMES) * 200);
    await run(MAGICK, [
      input + '[0]',
      '-resize', `${size}x${size}^`, '-gravity', 'Center', '-extent', `${size}x${size}`,
      '-modulate', `100,150,${hue}`,
      f,
    ]);
    return f;
  }, FRAMES, 6, output);
}

async function doZoom(input, output) {
  const { w, h } = await getDimensions(input);
  const size = Math.min(w, h, 280);
  const FRAMES = 15;
  await makeGif(async (i, dir) => {
    const f = path.join(dir, `f${i}.png`);
    const scale = Math.round(100 + i * (80 / FRAMES));
    const cropSize = Math.round(size * (100 / scale));
    await run(MAGICK, [
      input + '[0]',
      '-resize', `${size}x${size}^`, '-gravity', 'Center', '-extent', `${size}x${size}`,
      '-gravity', 'Center', '-crop', `${cropSize}x${cropSize}+0+0`, '+repage',
      '-resize', `${size}x${size}!`,
      f,
    ]);
    return f;
  }, FRAMES, 8, output);
}

async function doWormhole(input, output) {
  const { w, h } = await getDimensions(input);
  const size = Math.min(w, h, 280);
  const FRAMES = 20;
  await makeGif(async (i, dir) => {
    const f = path.join(dir, `f${i}.png`);
    const scale = 100 + Math.round(i * (120 / FRAMES));
    const cropSize = Math.round(size * (100 / scale));
    const angle = i * (360 / FRAMES) * 2;
    await run(MAGICK, [
      input + '[0]',
      '-resize', `${size}x${size}^`, '-gravity', 'Center', '-extent', `${size}x${size}`,
      '-gravity', 'Center', '-crop', `${cropSize}x${cropSize}+0+0`, '+repage',
      '-resize', `${size}x${size}!`,
      '-background', 'none', '-rotate', String(angle),
      '-gravity', 'Center', '-extent', `${size}x${size}`,
      f,
    ]);
    return f;
  }, FRAMES, 5, output);
}

async function doScramble(input, output) {
  const { w, h } = await getDimensions(input);
  const size = Math.min(w, h, 280);
  const FRAMES = 10;
  const CELLS = 4;
  const cell = Math.floor(size / CELLS);

  // Create an array of cell positions and shuffle them per frame
  const positions = [];
  for (let r = 0; r < CELLS; r++)
    for (let c = 0; c < CELLS; c++)
      positions.push({ r, c });

  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  await makeGif(async (i, dir) => {
    const f = path.join(dir, `f${i}.png`);
    const shuffled = shuffle(positions);

    const args = ['-size', `${size}x${size}`, 'xc:black'];
    for (let idx = 0; idx < positions.length; idx++) {
      const { r, c } = positions[idx];
      const { r: tr, c: tc } = shuffled[idx];
      args.push(
        '(',
        input + '[0]',
        '-resize', `${size}x${size}^`, '-gravity', 'Center', '-extent', `${size}x${size}`,
        '-crop', `${cell}x${cell}+${c * cell}+${r * cell}`, '+repage',
        ')',
        '-geometry', `+${tc * cell}+${tr * cell}`,
        '-composite'
      );
    }
    args.push(f);
    await run(MAGICK, args);
    return f;
  }, FRAMES, 10, output, false);
}

async function doGifMagik(input, output) {
  const { w, h } = await getDimensions(input);
  const size = Math.min(w, h, 280);
  const FRAMES = 10;
  await makeGif(async (i, dir) => {
    const f = path.join(dir, `f${i}.png`);
    const pct = 50 + Math.round(i * (45 / FRAMES));
    await run(MAGICK, [
      input + '[0]',
      '-resize', `${size}x${size}^`, '-gravity', 'Center', '-extent', `${size}x${size}`,
      '-liquid-rescale', `${pct}%x100%`,
      '-resize', `${size}x${size}!`,
      f,
    ]);
    return f;
  }, FRAMES, 8, output);
}

// ══════════════════════════════════════════════════════════
// ── VIDEO EFFECTS (FFmpeg) ──
// ══════════════════════════════════════════════════════════

async function doSpeed(input, output, multiplier) {
  const mult = Math.min(Math.max(parseFloat(multiplier) || 2, 0.25), 4);
  const pts = (1 / mult).toFixed(4);
  // atempo only works in 0.5–2 range; chain if needed
  let atempo = '';
  if (mult <= 2 && mult >= 0.5) {
    atempo = `atempo=${mult.toFixed(2)}`;
  } else if (mult > 2) {
    atempo = `atempo=2.0,atempo=${(mult / 2).toFixed(2)}`;
  } else {
    atempo = `atempo=0.5,atempo=${(mult / 0.5).toFixed(2)}`;
  }
  await run(FFMPEG, [
    '-y', '-i', input,
    '-vf', `setpts=${pts}*PTS`,
    '-af', atempo,
    '-preset', 'fast',
    output,
  ]);
}

async function doReverse(input, output) {
  const ext = path.extname(input).toLowerCase();
  if (ext === '.gif') {
    // Reverse a GIF using magick
    await run(MAGICK, [input, '-coalesce', '-reverse', '-layers', 'optimize', output]);
  } else {
    // Reverse video with ffmpeg
    await run(FFMPEG, ['-y', '-i', input, '-vf', 'reverse', '-af', 'areverse', '-preset', 'fast', output]);
  }
}

// ══════════════════════════════════════════════════════════
// MEDIA COMMANDS SET
// ══════════════════════════════════════════════════════════
const MEDIA_COMMANDS = new Set([
  'media',
  'flag', 'gifmagik', 'toaster', 'pixelate', 'billboard', 'bloom',
  'speed', 'motivate', 'rubiks', 'flag2', 'tattoo', 'spin', 'fisheye',
  'magik', 'grayscale', 'blur', 'circuitboard', 'caption', 'neon',
  'scramble', 'deepfry', 'fortune', 'valentine', 'invert', 'swirl',
  'speechbubble', 'heart', 'book', 'reverse', 'meme', 'rainbow',
  'zoom', 'zoomblur', 'spread', 'wormhole',
]);

// ══════════════════════════════════════════════════════════
// MAIN HANDLER
// ══════════════════════════════════════════════════════════
async function handleMediaCommand(message, command, args) {
  // .media with no subcommand → list
  if (command === 'media') {
    const cmds = [...MEDIA_COMMANDS].filter(c => c !== 'media').sort();
    const half = Math.ceil(cmds.length / 2);
    const col1 = cmds.slice(0, half).map(c => `\`.${c}\``).join('\n');
    const col2 = cmds.slice(half).map(c => `\`.${c}\``).join('\n');
    const embed = new EmbedBuilder()
      .setTitle('🖼️ Media Commands')
      .setDescription('Apply effects to images, GIFs, and videos.\nProvide an image via attachment, reply, URL, or @mention.')
      .addFields(
        { name: 'Commands', value: col1, inline: true },
        { name: '\u200B', value: col2, inline: true },
      )
      .setColor('#5865F2')
      .setFooter({ text: 'Usage: .flag | .blur 12 | .meme top | bottom | .caption text' });
    return message.reply({ embeds: [embed] });
  }

  // Show typing indicator for long operations
  await message.channel.sendTyping().catch(() => {});

  let imageUrl;
  try {
    imageUrl = await resolveImageUrl(message, args);
  } catch (e) {
    return message.reply({ embeds: [errorEmbed('Could not find an image. Attach one, reply to a message with an image, or mention a user.')] });
  }

  // Determine if it's a video command
  const isVideoCmd = command === 'speed' || command === 'reverse';

  // Download input
  let inputPath;
  try {
    // FIX: preserve extension from URL for video commands
    if (isVideoCmd) {
      const urlExt = path.extname(imageUrl.split('?')[0]).toLowerCase() || '.mp4';
      inputPath = await fetchToTemp(imageUrl, urlExt);
    } else {
      inputPath = await fetchToTemp(imageUrl, '.png');
    }
  } catch (e) {
    return message.reply({ embeds: [errorEmbed(`Failed to download image: ${e.message}`)] });
  }

  let outputPath;
  let filename;

  try {
    // Determine output format
    const isGifCommand = ['spin', 'rainbow', 'zoom', 'wormhole', 'scramble', 'gifmagik', 'circuitboard'].includes(command);
    const isVideoCommand = ['speed', 'reverse'].includes(command);
    const inputExt = path.extname(inputPath).toLowerCase();

    if (isVideoCommand) {
      const isGifInput = inputExt === '.gif';
      outputPath = tmpPath(isGifInput ? '.gif' : '.mp4');
      filename = `${command}${isGifInput ? '.gif' : '.mp4'}`;
    } else if (isGifCommand) {
      outputPath = tmpPath('.gif');
      filename = `${command}.gif`;
    } else {
      outputPath = tmpPath('.png');
      filename = `${command}.png`;
    }

    // Dispatch to the right function
    switch (command) {
      case 'grayscale': await doGrayscale(inputPath, outputPath); break;
      case 'blur': await doBlur(inputPath, outputPath, args[0]); break;
      case 'invert': await doInvert(inputPath, outputPath); break;
      case 'pixelate': await doPixelate(inputPath, outputPath); break;
      case 'deepfry': await doDeepFry(inputPath, outputPath); break;
      case 'fisheye': await doFisheye(inputPath, outputPath); break;
      case 'swirl': await doSwirl(inputPath, outputPath, args[0]); break;
      case 'spread': await doSpread(inputPath, outputPath, args[0]); break;
      case 'bloom': await doBloom(inputPath, outputPath); break;
      case 'neon': await doNeon(inputPath, outputPath); break;
      case 'magik': await doMagik(inputPath, outputPath); break;
      case 'zoomblur': await doZoomBlur(inputPath, outputPath); break;
      case 'caption': await doCaption(inputPath, outputPath, args.join(' ') || 'caption'); break;
      case 'meme': {
        // args: top | bottom (split by |), or first arg = top, rest = bottom
        const full = args.join(' ');
        const parts = full.includes('|') ? full.split('|') : [full, ''];
        await doMeme(inputPath, outputPath, parts[0]?.trim(), parts[1]?.trim());
        break;
      }
      case 'motivate': {
        const full = args.join(' ');
        const parts = full.includes('|') ? full.split('|') : [full, ''];
        await doMotivate(inputPath, outputPath, parts[0]?.trim(), parts[1]?.trim());
        break;
      }
      case 'speechbubble': await doSpeechBubble(inputPath, outputPath, args.join(' ') || '...'); break;
      case 'heart': await doHeart(inputPath, outputPath, args.join(' ') || null); break;
      case 'flag': await doFlag(inputPath, outputPath, 1); break;
      case 'flag2': await doFlag(inputPath, outputPath, 2); break;
      case 'toaster': await doToaster(inputPath, outputPath); break;
      case 'billboard': await doBillboard(inputPath, outputPath); break;
      case 'rubiks': await doRubiks(inputPath, outputPath); break;
      case 'tattoo': await doTattoo(inputPath, outputPath); break;
      case 'circuitboard': await doCircuitBoard(inputPath, outputPath); break;
      case 'fortune': await doFortune(inputPath, outputPath); break;
      case 'valentine': await doValentine(inputPath, outputPath); break;
      case 'book': await doBook(inputPath, outputPath); break;
      case 'spin': await doSpin(inputPath, outputPath); break;
      case 'rainbow': await doRainbow(inputPath, outputPath); break;
      case 'zoom': await doZoom(inputPath, outputPath); break;
      case 'wormhole': await doWormhole(inputPath, outputPath); break;
      case 'scramble': await doScramble(inputPath, outputPath); break;
      case 'gifmagik': await doGifMagik(inputPath, outputPath); break;
      case 'speed': await doSpeed(inputPath, outputPath, args[0]); break;
      case 'reverse': await doReverse(inputPath, outputPath); break;
      default:
        return message.reply({ embeds: [errorEmbed(`Unknown media command: \`${command}\``)] });
    }

    await sendResult(message, outputPath, filename);

  } catch (err) {
    logger.error('MEDIA', `Command .${command} failed:`, err);
    await message.reply({ embeds: [errorEmbed(`Processing failed: ${err.message?.slice(0, 200) || 'Unknown error'}`)] });
  } finally {
    safeDelete(inputPath, outputPath);
  }
}

module.exports = { handleMediaCommand, MEDIA_COMMANDS };