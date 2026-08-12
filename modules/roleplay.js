/**
 * roleplay.js — All roleplay/reaction GIF commands
 * GIF source: nekos.best (primary) and waifu.pics (fallback)
 * Both are free, no API key required.
 * 
 * CUSTOM GIFS: Add a `customGif` property to any action in the ACTIONS map below.
 * If `customGif` is set, that URL will be used instead of fetching from the API.
 * If `customGif` is not set or is empty, the bot falls back to the API as usual.
 */

const { EmbedBuilder } = require('discord.js');
const { COLORS } = require('../utils/embeds');
const { getGuildDb } = require('./database');
const logger = require('../utils/logger');

function ordinal(n) {
    const s = ['th','st','nd','rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

// ══════════════════════════════════════════════════════════
// ACTION MAP
// api: 'nekos' = https://nekos.best/api/v2/{type}
// api: 'waifu' = https://api.waifu.pics/sfw/{type}
// 
// OPTIONAL: Add `customGif: 'https://...'` to any action to use a custom GIF.
// The bot will use the custom GIF URL instead of fetching from the API.
// ══════════════════════════════════════════════════════════
const ACTIONS = {
    // ── EXAMPLES WITH CUSTOM GIFS (replace URLs with your own) ──
    hug: {
        api: 'nekos',
        type: 'hug',
        label: 'hugged',
        emoji: '🤗',
        target: true,
        color: '#FF69B4',
        customGif: 'https://i.pinimg.com/originals/cc/87/b3/cc87b317f7648475ad722210969fc89b.gif' // ← UNCOMMENT AND SET YOUR URL
    },
    kiss: {
        api: 'nekos',
        type: 'kiss',
        label: 'kissed',
        emoji: '💋',
        target: true,
        color: '#FF1493',
        customGif: 'https://animesher.com/orig/1/167/1673/16736/animesher.com_gif-couple-kiss-1673657.gif'
    },
    pat: {
        api: 'nekos',
        type: 'pat',
        label: 'patted',
        emoji: '🫶',
        target: true,
        color: '#ADD8E6',
        customGif: 'https://animesher.com/orig/1/192/1921/19214/animesher.com_cutie-anime-gif-pat-1921416.gif'
    },
    cuddle: {
        api: 'nekos',
        type: 'cuddle',
        label: 'cuddled',
        emoji: '🥰',
        target: true,
        color: '#FFB6C1',
        customGif: 'https://media1.giphy.com/media/v1.Y2lkPTZjMDliOTUyOGJvZmk5eHMxNmdyc2d6Yjg4dGx2dnFzcTFtb3B4Znk0NHgxOWZ1bCZlcD12MV9naWZzX3NlYXJjaCZjdD1n/WynnqxhdFEPYY/giphy.gif'
    },
    slap: {
        api: 'nekos',
        type: 'slap',
        label: 'slapped',
        emoji: '👋',
        target: true,
        color: '#ED4245',
        customGif: 'https://i.imgflip.com/6itaqb.gif'
    },
    bite: {
        api: 'waifu',
        type: 'bite',
        label: 'bit',
        emoji: '😈',
        target: true,
        color: '#8B0000',
        customGif: 'https://i.pinimg.com/originals/ca/eb/32/caeb32ef58807c7563460d96a3f7ecc9.gif'
    },
    wave: {
        api: 'nekos',
        type: 'wave',
        label: 'waved at',
        emoji: '👋',
        target: false,
        color: '#5865F2',
        customGif: 'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExeWl3dDFzcmduczZ4aWM3MHE2Mmk0dHVyOGF6c2l5Mmw2Y3pld2I5dSZlcD12MV9naWZzX3NlYXJjaCZjdD1n/VUC9YdLSnKuJy/giphy.gif'
    },
    dance: {
        api: 'nekos',
        type: 'dance',
        label: 'danced',
        emoji: '💃',
        target: false,
        color: '#FF69B4',
        customGif: 'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExd3p5M2V5aGZiYjk3cDFweXo1N2hxaGtud2IwN2hpcHhudTNzcmlmbCZlcD12MV9naWZzX3NlYXJjaCZjdD1n/cFyNMDlBU1jXsJZvIu/giphy.gif'
    },
    cry: {
        api: 'nekos',
        type: 'cry',
        label: 'cried',
        emoji: '😢',
        target: false,
        color: '#6495ED',
        customGif: 'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExYWRramptcm5id25qMTd0d21oYzJqYnl5MGVjMnhmazFuYzhjdmR4dCZlcD12MV9naWZzX3NlYXJjaCZjdD1n/ShPv5tt0EM396/giphy.gif'
    },
    smile: {
        api: 'nekos',
        type: 'smile',
        label: 'smiled',
        emoji: '😊',
        target: false,
        color: '#FFD700',
        customGif: 'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExdGd4emNpNXcxMHBuZjVtZmdwamczNDR0Nmw0Mmo2aDQ5cWM5dnl0aSZlcD12MV9naWZzX3NlYXJjaCZjdD1n/rFfmUWVMOyKVG/giphy.gif'
    },
    wink: {
        api: 'nekos',
        type: 'wink',
        label: 'winked at',
        emoji: '😉',
        target: true,
        color: '#FFA500',
        customGif: 'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExdG9nZXJjMjNxd3MxYnl1dThubXVzMmw3bjkwb2RrMTEyNHQwd2hsOCZlcD12MV9naWZzX3NlYXJjaCZjdD1n/ErZ8hv5eO92JW/giphy.gif'
    },
    poke: {
        api: 'nekos',
        type: 'poke',
        label: 'poked',
        emoji: '👉',
        target: true,
        color: '#57F287',
        customGif: 'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExZnIzemVpbHUzNnY1cGp6c2t0b3N4Zzk1cXJ4aTNubTF1MDFuZnQwbSZlcD12MV9naWZzX3NlYXJjaCZjdD1n/6ITiRKIryP3MI/giphy.gif'
    },
    nom: {
        api: 'waifu',
        type: 'nom',
        label: 'nommed',
        emoji: '😋',
        target: true,
        color: '#FF8C00',
        customGif: 'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExNXV6cjhrY2VtbjUycnZxcHF2MnpwZWw4Y3FuNDM4eWVtZWdjcjB5ZSZlcD12MV9naWZzX3NlYXJjaCZjdD1n/qpZ4jZN2cMkgg/giphy.gif'
    },
    lick: {
        api: 'waifu',
        type: 'lick',
        label: 'licked',
        emoji: '👅',
        target: true,
        color: '#FF69B4',
        customGif: 'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExY3g1enVybWR5cnFkMWJhbXd0dWMzbXFuZzJmcGxoYjAwNzR0enZjMiZlcD12MV9naWZzX3NlYXJjaCZjdD1n/UhSNkDdbsXzlm/giphy.gif'
    },
    blush: {
        api: 'nekos',
        type: 'blush',
        label: 'blushed',
        emoji: '😊',
        target: false,
        color: '#FFB6C1',
        customGif: 'https://nekos.best/api/v2/blush/104b50d2-b6c5-4e81-b497-26af3abe1764.gif'
    },
    happy: {
        api: 'nekos',
        type: 'happy',
        label: 'is happy',
        emoji: '😄',
        target: false,
        color: '#FFD700',
        customGif: 'https://nekos.best/api/v2/happy/cdf7c52c-42de-449d-8888-a01b5fd8dcf4.gif'
    },
    smug: {
        api: 'nekos',
        type: 'smug',
        label: 'is smug',
        emoji: '😏',
        target: false,
        color: '#9B59B6',
        customGif: 'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExb3FuZnNiY2Q0N2FnNmVjYXV2d21mbHc1ZW9zOHFmbmtpM3JxcmpiZSZlcD12MV9naWZzX3NlYXJjaCZjdD1n/RCWahfIC5IPew/giphy.gif'
    },
    punch: {
        api: 'nekos',
        type: 'punch',
        label: 'punched',
        emoji: '👊',
        target: true,
        color: '#ED4245',
        customGif: 'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExbWYzano4YmphNG4zcnEyMGcycGpmejZybnZid2Ztb2d2aTdnMTM3NiZlcD12MV9naWZzX3NlYXJjaCZjdD1n/xUO4t2gkWBxDi/giphy.gif'
    },
    tickle: {
        api: 'nekos',
        type: 'tickle',
        label: 'tickled',
        emoji: '😂',
        target: true,
        color: '#57F287',
        customGif: 'https://nekos.best/api/v2/tickle/1381df6d-0140-4409-a828-727e3fb89def.gif'
    },
    sleep: {
        api: 'nekos',
        type: 'sleep',
        label: 'fell asleep',
        emoji: '😴',
        target: false,
        color: '#7289DA',
        customGif: 'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExa28zcDl4M2RpeGZ6c2YwbGNpY3JzaGI0azhxYW56ZXdzbGs1bm9zOCZlcD12MV9naWZzX3NlYXJjaCZjdD1n/ugkYkq2ZjLqBa/giphy.gif'
    },
    facepalm: {
        api: 'nekos',
        type: 'facepalm',
        label: 'facepalmed',
        emoji: '🤦',
        target: false,
        color: '#95A5A6',
        customGif: 'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExamdta2EybmQ4a2JtanFibnZiODdsbG9odG5seWh0OHJzZHFmbHB1NyZlcD12MV9naWZzX3NlYXJjaCZjdD1n/g1ENyDU0VekgM/giphy.gif'
    },
    shrug: {
        api: 'nekos',
        type: 'shrug',
        label: 'shrugged',
        emoji: '🤷',
        target: false,
        color: '#95A5A6',
        customGif: 'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExc3U1ejF4ajRsMzR1d2p0eWJzYW5yZ2t3eGxtdTI4aGowZ3Q0YXgxbyZlcD12MV9naWZzX3NlYXJjaCZjdD1n/whVFYT0dktw0SyvW7X/giphy.gif'
    },
    yawn: {
        api: 'nekos',
        type: 'yawn',
        label: 'yawned',
        emoji: '😪',
        target: false,
        color: '#7289DA',
        customGif: 'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExa28zcDl4M2RpeGZ6c2YwbGNpY3JzaGI0azhxYW56ZXdzbGs1bm9zOCZlcD12MV9naWZzX3NlYXJjaCZjdD1n/iQHDtnUZ7gxI4/giphy.gif'
    },
    feed: {
        api: 'nekos',
        type: 'feed',
        label: 'fed',
        emoji: '🍱',
        target: true,
        color: '#FF8C00',
        customGif: 'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExZTd4NHR2eXR2Y2J5ZnBueDUyODVnb3hlNXJjbjl0NWduajd4Y3F5MSZlcD12MV9naWZzX3NlYXJjaCZjdD1n/hvOIUUOg8jNKI8W1iv/giphy.gif'
    },
    highfive: {
        api: 'nekos',
        type: 'highfive',
        label: 'high-fived',
        emoji: '🙌',
        target: true,
        color: '#57F287',
        customGif: 'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExcXpxbHRwaGtqcDJiaHY2ZTVkOGM1YWgxdThmZ2MzOXJmZ2F1NmQ3MSZlcD12MV9naWZzX3NlYXJjaCZjdD1n/2KLrMRGB4n7AklNQxn/giphy.gif'
    },
    handshake: {
        api: 'nekos',
        type: 'handshake',
        label: 'handshook',
        emoji: '🤝',
        target: true,
        color: '#5865F2',
        customGif: 'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExNmM0eXk5bmY1NG8xcHJmbHBsZW05ZGNiazc3ZTVpMHhlMWo4ZndpdyZlcD12MV9naWZzX3NlYXJjaCZjdD1n/d1E2VyhFsxawRbeo/giphy.gif'
    },
    nod: {
        api: 'nekos',
        type: 'nod',
        label: 'nodded at',
        emoji: '👍',
        target: false,
        color: '#57F287',
        customGif: 'https://nekos.best/api/v2/nod/2ce46f2a-3e4b-4568-99be-1bbe21083a44.gif'
    },
    nope: {
        api: 'nekos',
        type: 'nope',
        label: 'said nope',
        emoji: '❌',
        target: false,
        color: '#ED4245',
        customGif: 'https://i.pinimg.com/originals/32/32/60/3232602b8d5a7fc4e38d8c9d3ca911d8.gif'
    },
    stare: {
        api: 'nekos',
        type: 'stare',
        label: 'stared at',
        emoji: '👀',
        target: true,
        color: '#2F3136',
        customGif: 'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExM3c3ZWNvOWExdTFhMHk4eHU5NjlyZThweGl0dTRjazM5amJxbTU5YiZlcD12MV9naWZzX3NlYXJjaCZjdD1n/5f3S9RinLwLUI3sWcm/giphy.gif'
    },
    think: {
        api: 'nekos',
        type: 'think',
        label: 'is thinking',
        emoji: '🤔',
        target: false,
        color: '#9B59B6',
        customGif: 'https://nekos.best/api/v2/think/7693e4aa-ba96-4f4c-9383-8cec73858750.gif'
    },
    thumbsup: {
        api: 'nekos',
        type: 'thumbsup',
        label: 'gave a thumbs up',
        emoji: '👍',
        target: true,
        color: '#57F287',
        customGif: 'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExbHFlM2o2MzZlMTY3bmNob2Jzdmk4NnJqcHZ1eWpoa2trbWtrOGhvayZlcD12MV9naWZzX3NlYXJjaCZjdD1n/26vaTNUAnJOP1xalq/giphy.gif'
    },
    laugh: {
        api: 'nekos',
        type: 'laugh',
        label: 'laughed',
        emoji: '😂',
        target: false,
        color: '#FFD700',
        customGif: 'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExcG9jNmY0aTF3N2pkOWJtOGpieTM5Z3QzZDF3a2k3OGM4b2szY3pkZyZlcD12MV9naWZzX3NlYXJjaCZjdD1n/Yb0sZcOCQdG36/giphy.gif'
    },
    pout: {
        api: 'nekos',
        type: 'pout',
        label: 'is pouting',
        emoji: '😤',
        target: false,
        color: '#E67E22',
        customGif: 'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExbHZpZWRmazhvbWNmbXJjZHltYXk4NWl5MDV1bTVsbjQ5cWdxMmh6biZlcD12MV9naWZzX3NlYXJjaCZjdD1n/Tl45tTeIPOz4vj4qYw/giphy.gif'
    },
    run: {
        api: 'nekos',
        type: 'run',
        label: 'ran',
        emoji: '🏃',
        target: false,
        color: '#57F287',
        customGif: 'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExM2ZxZmJyMGZoYjNmMjV3cnBucGJpdmJwcDQ1ZTVlY2NkeDJlbXo2ZyZlcD12MV9naWZzX3NlYXJjaCZjdD1n/uZqjgJ0sh1HX2/giphy.gif'
    },
    yeet: {
        api: 'waifu',
        type: 'yeet',
        label: 'yeeted',
        emoji: '🚀',
        target: true,
        color: '#E67E22',
        customGif: 'https://nekos.best/api/v2/yeet/a7884aab-df95-4b18-8247-604b5dc27309.gif'
    },
    bully: {
        api: 'waifu',
        type: 'bully',
        label: 'bullied',
        emoji: '😤',
        target: true,
        color: '#ED4245',
        customGif: 'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExdWM1cThxMHp3czB6c2pjMzl0aTcyczg5d256cHE3bmI3NTc4aHBpZCZlcD12MV9naWZzX3NlYXJjaCZjdD1n/jR3xYgVqd0B2Qb6QoE/giphy.gif'
    },
    bonk: {
        api: 'waifu',
        type: 'bonk',
        label: 'bonked',
        emoji: '🔨',
        target: true,
        color: '#E67E22',
        customGif: 'https://nekos.best/api/v2/bonk/981dee7f-494e-4c34-b96e-1a7cd63bbd9c.gif'
    },
    glomp: {
        api: 'waifu',
        type: 'glomp',
        label: 'glomped',
        emoji: '🤗',
        target: true,
        color: '#FF69B4',
        customGif: 'https://i.pinimg.com/originals/1c/91/4f/1c914fc50a261eb6678978e475bfeb3f.gif'
    },
    cringe: {
        api: 'waifu',
        type: 'cringe',
        label: 'cringed',
        emoji: '😬',
        target: false,
        color: '#95A5A6',
        customGif: 'https://i.pinimg.com/originals/08/03/58/08035897f5dfbf24add1a88aeeedb5ae.gif'
    },
    // Aliases mapping to existing types
    nuzzle: {
        api: 'nekos',
        type: 'cuddle',
        label: 'nuzzled',
        emoji: '🥰',
        target: true,
        color: '#FFB6C1',
        customGif: 'https://media0.giphy.com/media/v1.Y2lkPTZjMDliOTUyZ3NqYmp5cGRjMXB0b3JieGtvb3ZidGN2c211ajBicms1c3VlZjh0aiZlcD12MV9naWZzX3NlYXJjaCZjdD1n/f82EqBTeCEgcU/source.gif'
    },
    clap: {
        api: 'nekos',
        type: 'highfive',
        label: 'clapped',
        emoji: '👏',
        target: false,
        color: '#57F287',
        customGif: 'https://nekos.best/api/v2/clap/bda7ae6f-6b61-4965-adb6-98371e305d4a.gif'
    },
    yay: {
        api: 'nekos',
        type: 'happy',
        label: 'is excited',
        emoji: '🎉',
        target: false,
        color: '#FFD700',
        customGif: 'https://i.pinimg.com/originals/9b/98/57/9b985780e9bfc401da318073e02865f8.gif'
    },
    yes: {
        api: 'nekos',
        type: 'nod',
        label: 'said yes',
        emoji: '✅',
        target: false,
        color: '#57F287',
        customGif: 'https://i.pinimg.com/originals/a5/47/b8/a547b84341559d09e53892765aee8876.gif'
    },
    sad: {
        api: 'nekos',
        type: 'cry',
        label: 'is sad',
        emoji: '😢',
        target: false,
        color: '#6495ED',
        customGif: 'https://i.pinimg.com/originals/54/d7/30/54d7302c08408339574b95b9a911c51a.gif'
    },
    angry: {
        api: 'waifu',
        type: 'slap',
        label: 'is angry',
        emoji: '😠',
        target: false,
        color: '#ED4245',
        customGif: 'https://nekos.best/api/v2/angry/8168f8f5-55c0-4d47-9d9f-0974ad0f7a77.gif'
    },
    shy: {
        api: 'nekos',
        type: 'blush',
        label: 'is shy',
        emoji: '🥺',
        target: false,
        color: '#FFB6C1',
        customGif: 'https://media0.giphy.com/media/v1.Y2lkPTZjMDliOTUyY3VmcjgzOW5qcmNtajNtMGU3OGc0M3E5Y3A1OG1oNnJpMjJlMXlubiZlcD12MV9naWZzX3NlYXJjaCZjdD1n/vIIbrC80HHN7O/source.gif'
    },
    sip: {
        api: 'nekos',
        type: 'sleep',
        label: 'is sipping',
        emoji: '☕',
        target: false,
        color: '#8B4513',
        customGif: 'https://nekos.best/api/v2/sip/bb51f25d-f6fb-4e0f-9fe5-63471995ef5c.gif'
    },
    peek: {
        api: 'nekos',
        type: 'lurk',
        label: 'is peeking',
        emoji: '👀',
        target: false,
        color: '#2F3136',
        customGif: 'https://www.pinterest.com/pin/720716746599673093/'
    },
    bleh: {
        api: 'waifu',
        type: 'lick',
        label: 'went bleh',
        emoji: '😛',
        target: false,
        color: '#57F287',
        customGif: 'https://nekos.best/api/v2/bleh/032f1bed-402d-46e0-b414-c36a6ca2b49c.gif'
    },
    brofist: {
        api: 'nekos',
        type: 'handshake',
        label: 'brofisted',
        emoji: '👊',
        target: true,
        color: '#E67E22',
        customGif: 'https://tenor.com/search/brofist-anime-gifs'
    },
    celebrate: {
        api: 'nekos',
        type: 'happy',
        label: 'celebrated',
        emoji: '🎉',
        target: false,
        color: '#FFD700',
        customGif: 'https://nekos.best/api/v2/happy/cdf7c52c-42de-449d-8888-a01b5fd8dcf4.gif'
    },
    cheers: {
        api: 'nekos',
        type: 'highfive',
        label: 'cheered',
        emoji: '🥂',
        target: true,
        color: '#FFD700',
        customGif: 'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExZW0ydDdvcm8wczdqeHpuZ254Y2RzZWpuMWRxYTZmdzF1dDRteGR1aiZlcD12MV9naWZzX3NlYXJjaCZjdD1n/DpEezfOVrKPSNsCA1g/giphy.gif'
    },
    confused: {
        api: 'nekos',
        type: 'think',
        label: 'is confused',
        emoji: '❓',
        target: false,
        color: '#9B59B6',
        customGif: 'https://nekos.best/api/v2/confused/80327bb1-a3b1-44d3-b530-dc98d037545a.gif'
    },
    cool: {
        api: 'nekos',
        type: 'smug',
        label: 'is cool',
        emoji: '😎',
        target: false,
        color: '#3498DB',
        customGif: 'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExd3FtbGVoejhxZzZzdHRnOGxucHk4MzA4ZDRpdnh1MWFwZXgzd3ZpbyZlcD12MV9naWZzX3NlYXJjaCZjdD1n/mCDXo3yYjTXgGCGXIY/giphy.gif'
    },
    drool: {
        api: 'waifu',
        type: 'nom',
        label: 'is drooling',
        emoji: '🤤',
        target: false,
        color: '#95A5A6',
        customGif: 'https://memes.co.in/gif/anime-girl-drooling-gif/5275'
    },
    love: {
        api: 'nekos',
        type: 'kiss',
        label: 'loves',
        emoji: '❤️',
        target: true,
        color: '#ED4245',
        customGif: 'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExZW9yMG1henRmMGs3Y3ZsZTY0YXhobWkwNnVrd3hlcGdqMjlod2YzNiZlcD12MV9naWZzX3NlYXJjaCZjdD1n/bMLGNRoAy0Yko/giphy.gif'
    },
    mad: {
        api: 'nekos',
        type: 'slap',
        label: 'is mad',
        emoji: '😡',
        target: false,
        color: '#ED4245',
        customGif: 'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExazZ5aWwzYndsZXB3MzNpdDVyaDkybHN1amM4a2c1OGdpajhrYXQ5cCZlcD12MV9naWZzX3NlYXJjaCZjdD1n/uXsPodwDXnitq/giphy.gif'
    },
    nervous: {
        api: 'waifu',
        type: 'cringe',
        label: 'is nervous',
        emoji: '😰',
        target: false,
        color: '#95A5A6',
        customGif: 'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExaXM3MzM1ejY3dWFjem0yMWRhZ2NpZXI1b2oydmZzZjV6dXBsc2YzZSZlcD12MV9naWZzX3NlYXJjaCZjdD1n/3o7bugi24hokjYq0Le/giphy.gif'
    },
    nyah: {
        api: 'waifu',
        type: 'lick',
        label: 'went nyah~',
        emoji: '😼',
        target: false,
        color: '#FF69B4',
        customGif: 'https://media.tenor.com/agReLT91Aw8AAAAM/nyan-nya.gif'
    },
    scared: {
        api: 'waifu',
        type: 'cringe',
        label: 'is scared',
        emoji: '😱',
        target: false,
        color: '#2F3136',
        customGif: 'https://i.pinimg.com/originals/7c/2c/c9/7c2cc9cc2d4632825f2671f31522fef4.gif'
    },
    sigh: {
        api: 'nekos',
        type: 'cry',
        label: 'sighed',
        emoji: '😮‍💨',
        target: false,
        color: '#6495ED',
        customGif: 'https://media.tenor.com/0AOiFgMsBWcAAAAM/sigh.gif'
    },
    slowclap: {
        api: 'nekos',
        type: 'highfive',
        label: 'slow-clapped',
        emoji: '👏',
        target: false,
        color: '#95A5A6',
        customGif: 'https://i.gifer.com/embedded/download/7ddb.gif'
    },
    smack: {
        api: 'nekos',
        type: 'slap',
        label: 'smacked',
        emoji: '💥',
        target: true,
        color: '#ED4245',
        customGif: 'https://i.pinimg.com/originals/2f/0f/82/2f0f82e4fb0dee8efd75bee975496eab.gif'
    },
    sneeze: {
        api: 'nekos',
        type: 'yawn',
        label: 'sneezed',
        emoji: '🤧',
        target: false,
        color: '#95A5A6',
        customGif: 'https://in.pinterest.com/pin/kon-animated-gif--48273027239475113/'
    },
    sorry: {
        api: 'nekos',
        type: 'cry',
        label: 'apologized to',
        emoji: '🙏',
        target: true,
        color: '#6495ED',
        customGif: 'https://64.media.tumblr.com/f194027e4c629ecf3c64389c107e446d/16cce8d067d81d42-b8/s540x810/f75916f483a3ba2de666b9fa0e117456bc67c91f.gif'
    },
    surprised: {
        api: 'nekos',
        type: 'bored',
        label: 'is surprised',
        emoji: '😲',
        target: false,
        color: '#FFD700',
        customGif: 'https://i.pinimg.com/originals/12/30/8c/12308c918f4caa0069995e2f54352846.gif'
    },
    sweat: {
        api: 'waifu',
        type: 'cringe',
        label: 'is sweating',
        emoji: '😰',
        target: false,
        color: '#95A5A6',
        customGif: 'https://media.japanesewithanime.com/uploads/sweating-profusely-sagara-sousuke-full-metal-panic-09.gif'
    },
    tired: {
        api: 'nekos',
        type: 'sleep',
        label: 'is tired',
        emoji: '😴',
        target: false,
        color: '#7289DA',
        customGif: 'https://i.pinimg.com/originals/9c/ef/52/9cef52ce27ab97e0fa9cfac1cdc1007f.gif'
    },
    woah: {
        api: 'waifu',
        type: 'cringe',
        label: 'said woah',
        emoji: '😲',
        target: false,
        color: '#FFD700',
        customGif: 'https://media1.giphy.com/media/v1.Y2lkPTZjMDliOTUyNTc1anNhd2ltMHIwb3VveWpseWM4cWMzd2tmejlvd3VtMXd5amcyZiZlcD12MV9naWZzX3NlYXJjaCZjdD1n/PR7J3rrNCrFE4/200.gif'
    },
    lurk: {
        api: 'nekos',
        type: 'lurk',
        label: 'is lurking',
        emoji: '👀',
        target: false,
        color: '#2F3136',
        customGif: 'https://nekos.best/api/v2/lurk/6ccf8ab3-862d-4def-88cd-d47476e99ab0.gif'
    },
    sulk: {
        api: 'nekos',
        type: 'pout',
        label: 'is sulking',
        emoji: '😒',
        target: false,
        color: '#95A5A6',
        customGif: 'https://i.pinimg.com/originals/9e/29/61/9e29614354a9b8c224b130e9332490b3.gif'
    },
    bored: {
        api: 'nekos',
        type: 'bored',
        label: 'is bored',
        emoji: '🥱',
        target: false,
        color: '#95A5A6',
        customGif: 'https://giffiles.alphacoders.com/219/219891.gif'
    }
};
// ══════════════════════════════════════════════════════════
// MESSAGE TEMPLATES — varied per action
// ══════════════════════════════════════════════════════════
const PAIR_TEMPLATES = {
    hug: [
        (a, t, o) => `Aww~ **${a}** wrapped **${t}** in a warm hug for the **${o}** time! 🤗`,
        (a, t, o) => `Woahh.. **${a}** hugged **${t}** for the **${o}** time! Can they ever stop? 🥺`,
        (a, t, o) => `**${a}** squeezed **${t}** tightly — that's hug #**${o}**! 💕`,
    ],
    kiss: [
        (a, t, o) => `Mwah! **${a}** kissed **${t}** for the **${o}** time! 💋`,
        (a, t, o) => `**${a}** planted a kiss on **${t}** — smooch #**${o}**! 😘`,
        (a, t, o) => `Oooh~ **${a}** kissed **${t}** again! That's **${o}** now! 💕`,
    ],
    pat: [
        (a, t, o) => `**${a}** gave **${t}** a gentle pat — for the **${o}** time! Good boi~ 🫶`,
        (a, t, o) => `Headpat #**${o}**! **${a}** patted **${t}** again~ ✨`,
        (a, t, o) => `**${a}** patted **${t}** on the head for the **${o}** time! So wholesome 🌸`,
    ],
    slap: [
        (a, t, o) => `**${a}** SLAPPED **${t}** for the **${o}** time!! That's gotta hurt 💢`,
        (a, t, o) => `SMACK! **${a}** slapped **${t}** — hit #**${o}**! 👋`,
        (a, t, o) => `**${t}** just got slapped by **${a}** for the **${o}** time. Oof. 💥`,
    ],
    cuddle: [
        (a, t, o) => `**${a}** cuddled up with **${t}** for the **${o}** time! So cozy 🥰`,
        (a, t, o) => `Cuddle #**${o}**! **${a}** and **${t}** are getting close~ 💕`,
        (a, t, o) => `**${a}** snuggled **${t}** again — that's **${o}** times now! 🤗`,
    ],
    bite: [
        (a, t, o) => `**${a}** bit **${t}** for the **${o}** time! Chomp chomp 😈`,
        (a, t, o) => `NOM! **${a}** bit **${t}** again — bite #**${o}**! 🦷`,
        (a, t, o) => `**${t}** got bitten by **${a}** for the **${o}** time. Ouch! 😬`,
    ],
    punch: [
        (a, t, o) => `**${a}** punched **${t}** for the **${o}** time! POW! 👊`,
        (a, t, o) => `BAM! That's punch #**${o}** from **${a}** on **${t}**! 💥`,
        (a, t, o) => `**${t}** took a hit from **${a}** for the **${o}** time. Ow 😵`,
    ],
    poke: [
        (a, t, o) => `**${a}** poked **${t}** for the **${o}** time! STOP THAT 👉`,
        (a, t, o) => `Poke #**${o}**! **${a}** just won't leave **${t}** alone 😆`,
        (a, t, o) => `**${t}** got poked by **${a}** again — **${o}** times total! 😤`,
    ],
    tickle: [
        (a, t, o) => `**${a}** tickled **${t}** for the **${o}** time! HAHA STOP 😂`,
        (a, t, o) => `Tickle #**${o}**! **${t}** can't escape **${a}**'s fingers 🤣`,
        (a, t, o) => `**${a}** is tickling **${t}** again — **${o}** times and counting! 😹`,
    ],
    wink: [
        (a, t, o) => `**${a}** winked at **${t}** for the **${o}** time~ 😉`,
        (a, t, o) => `Wink #**${o}**! Is **${a}** flirting with **${t}** again? 👀`,
        (a, t, o) => `**${t}** got winked at by **${a}** — **${o}** times now! 😏`,
    ],
    nom: [
        (a, t, o) => `**${a}** nommed **${t}** for the **${o}** time! Om nom nom 😋`,
        (a, t, o) => `NOM #**${o}**! **${a}** decided **${t}** looks tasty again 😈`,
        (a, t, o) => `**${t}** got nommed by **${a}** for the **${o}** time~ 🍴`,
    ],
    lick: [
        (a, t, o) => `**${a}** licked **${t}** for the **${o}** time! Eww~ 👅`,
        (a, t, o) => `Lick #**${o}**! **${a}** really likes the taste of **${t}** apparently 😳`,
        (a, t, o) => `**${t}** got licked by **${a}** again — **${o}** times! 😅`,
    ],
    bonk: [
        (a, t, o) => `**${a}** bonked **${t}** for the **${o}** time! Go to horny jail 🔨`,
        (a, t, o) => `BONK #**${o}**! **${a}** smacked **${t}** with the bonk hammer! 💥`,
        (a, t, o) => `**${t}** got bonked by **${a}** for the **${o}** time. Deserved. 😤`,
    ],
    glomp: [
        (a, t, o) => `**${a}** GLOMPED **${t}** for the **${o}** time! They never saw it coming 🤗`,
        (a, t, o) => `GLOMP #**${o}**! **${a}** tackled **${t}** with love! 💕`,
        (a, t, o) => `**${t}** got glomped by **${a}** again — **${o}** times! 🥰`,
    ],
    bully: [
        (a, t, o) => `**${a}** bullied **${t}** for the **${o}** time! Not cool 😤`,
        (a, t, o) => `Bully incident #**${o}**! **${a}** is picking on **${t}** again 😡`,
        (a, t, o) => `**${t}** got bullied by **${a}** for the **${o}** time. Stop it! 🛑`,
    ],
    yeet: [
        (a, t, o) => `**${a}** YEETED **${t}** for the **${o}** time! TO THE MOON 🚀`,
        (a, t, o) => `YEET #**${o}**! **${t}** is airborne thanks to **${a}**! ✈️`,
        (a, t, o) => `**${t}** got yeeted by **${a}** again — **${o}** times! 😂`,
    ],
    feed: [
        (a, t, o) => `**${a}** fed **${t}** for the **${o}** time! Eat up~ 🍱`,
        (a, t, o) => `Meal #**${o}**! **${a}** is taking care of **${t}** again 🥺`,
        (a, t, o) => `**${t}** got fed by **${a}** for the **${o}** time~ 🍜`,
    ],
    highfive: [
        (a, t, o) => `**${a}** high-fived **${t}** for the **${o}** time! YEAH! 🙌`,
        (a, t, o) => `High-five #**${o}**! **${a}** and **${t}** are vibing~ ✨`,
        (a, t, o) => `**${a}** and **${t}** slapped hands for the **${o}** time! 👋`,
    ],
    handshake: [
        (a, t, o) => `**${a}** shook hands with **${t}** for the **${o}** time! Very professional 🤝`,
        (a, t, o) => `Handshake #**${o}**! **${a}** and **${t}** keep it formal 😂`,
        (a, t, o) => `**${a}** and **${t}** did the handshake for the **${o}** time~ 🤝`,
    ],
    stare: [
        (a, t, o) => `**${a}** stared at **${t}** for the **${o}** time... creepy 👀`,
        (a, t, o) => `Stare #**${o}**! **${a}** can't stop looking at **${t}** 😳`,
        (a, t, o) => `**${t}** is being stared at by **${a}** again — **${o}** times! 👁️`,
    ],
    thumbsup: [
        (a, t, o) => `**${a}** gave **${t}** a thumbs up for the **${o}** time! 👍`,
        (a, t, o) => `Approval #**${o}**! **${a}** approves of **${t}** once again 😎`,
        (a, t, o) => `**${t}** got a thumbs up from **${a}** — **${o}** times! 👍`,
    ],
    sorry: [
        (a, t, o) => `**${a}** apologized to **${t}** for the **${o}** time... learn from it 🙏`,
        (a, t, o) => `Apology #**${o}**! **${a}** said sorry to **${t}** again 😔`,
        (a, t, o) => `**${a}** is apologizing to **${t}** for the **${o}** time~ 🥺`,
    ],
    smack: [
        (a, t, o) => `**${a}** smacked **${t}** for the **${o}** time! WHAP 💥`,
        (a, t, o) => `Smack #**${o}**! **${t}** took another hit from **${a}** 😵`,
        (a, t, o) => `**${t}** got smacked by **${a}** for the **${o}** time. OOF 💢`,
    ],
    nuzzle: [
        (a, t, o) => `**${a}** nuzzled **${t}** for the **${o}** time! So soft~ 🥰`,
        (a, t, o) => `Nuzzle #**${o}**! **${a}** and **${t}** are adorable 💕`,
        (a, t, o) => `**${a}** nuzzled up to **${t}** again — **${o}** times! 🌸`,
    ],
    brofist: [
        (a, t, o) => `**${a}** brofisted **${t}** for the **${o}** time! BRO 👊`,
        (a, t, o) => `Brofist #**${o}**! **${a}** and **${t}** are true bros 😤`,
        (a, t, o) => `**${a}** and **${t}** did the brofist for the **${o}** time~ 🤜🤛`,
    ],
    cheers: [
        (a, t, o) => `**${a}** cheered with **${t}** for the **${o}** time! Bottoms up 🥂`,
        (a, t, o) => `Cheers #**${o}**! **${a}** and **${t}** are celebrating again 🎉`,
        (a, t, o) => `**${a}** raised a glass with **${t}** for the **${o}** time~ 🥂`,
    ],
    love: [
        (a, t, o) => `**${a}** showered **${t}** with love for the **${o}** time! 💕`,
        (a, t, o) => `Love declaration #**${o}**! **${a}** loves **${t}** so much ❤️`,
        (a, t, o) => `**${a}** expressed love to **${t}** again — **${o}** times! 💖`,
    ],
    wink: [
        (a, t, o) => `**${a}** winked at **${t}** for the **${o}** time~ 😉`,
        (a, t, o) => `Wink #**${o}**! Is **${a}** flirting with **${t}** again? 👀`,
        (a, t, o) => `**${t}** got winked at by **${a}** — **${o}** times now! 😏`,
    ],
};

// Fallback pair templates for actions not specifically defined
function defaultPairTemplate(a, t, o, action) {
    const templates = [
        () => `**${a}** ${action.label} **${t}** for the **${o}** time! ${action.emoji}`,
        () => `Woahh.. **${a}** ${action.label} **${t}** for the **${o}** time! ${action.emoji}`,
        () => `That's **${o}**! **${a}** ${action.label} **${t}** again ${action.emoji}`,
    ];
    return pick(templates)();
}

// Solo action templates (no target)
const SOLO_TEMPLATES = {
    dance: [
        (a) => `**${a}** is busting some moves! 💃`,
        (a) => `Look at **${a}** go! Get it! 🎶`,
        (a) => `**${a}** hit the dancefloor! 🕺`,
    ],
    cry: [
        (a) => `**${a}** is crying... someone give them a hug 😢`,
        (a) => `**${a}** burst into tears 😭`,
        (a) => `Someone comfort **${a}**, they're crying! 💧`,
    ],
    smile: [
        (a) => `**${a}** is smiling! That made my day ☀️`,
        (a) => `Look at that smile from **${a}**! 😊`,
        (a) => `**${a}** is all smiles today~ 🌸`,
    ],
    blush: [
        (a) => `**${a}** is blushing! How cute 😊`,
        (a) => `Aww, **${a}** turned red! 🍎`,
        (a) => `**${a}** is blushing so hard right now~ 💕`,
    ],
    happy: [
        (a) => `**${a}** is absolutely happy right now! 😄`,
        (a) => `**${a}** is full of joy! 🎉`,
        (a) => `Nothing can stop **${a}** from being happy! ✨`,
    ],
    laugh: [
        (a) => `**${a}** is DYING of laughter 😂`,
        (a) => `HAHAHA **${a}** can't stop laughing! 🤣`,
        (a) => `**${a}** is laughing way too hard 😹`,
    ],
    sleep: [
        (a) => `**${a}** fell asleep... zzz 😴`,
        (a) => `**${a}** is out cold 💤`,
        (a) => `Shh, **${a}** is sleeping~ 😪`,
    ],
    wave: [
        (a) => `**${a}** is waving! 👋`,
        (a) => `Hey! **${a}** waved at everyone~ 👋`,
        (a) => `**${a}** says hi! 🙌`,
    ],
};

function buildMessage(action, actionName, authorName, targetName, count) {
    if (action.target && targetName) {
        const o = ordinal(count);
        const templates = PAIR_TEMPLATES[actionName];
        if (templates) {
            return pick(templates)(authorName, targetName, o);
        }
        return defaultPairTemplate(authorName, targetName, o, action);
    } else {
        const templates = SOLO_TEMPLATES[actionName];
        if (templates) {
            return pick(templates)(authorName);
        }
        // Default solo message
        return `**${authorName}** ${action.label}! ${action.emoji}`;
    }
}

// ══════════════════════════════════════════════════════════
// SELF-ACTION MESSAGES
// ══════════════════════════════════════════════════════════
const SELF_MESSAGES = {
    hug: `You can't hug yourself... go touch grass 🌿`,
    kiss: `Kissing yourself? Bold move. Maybe try a mirror instead 💋`,
    slap: `Self-slapping? That's a new level of commitment 🤦`,
    pat: `You can't pat yourself on the head. Well, you can, but it's sad 😔`,
    cuddle: `Cuddling yourself? That's called sleeping 😴`,
    bite: `Biting yourself? That's just self-harm 😬`,
    punch: `Don't punch yourself, you'll regret it 🤕`,
    bonk: `You can't bonk yourself! Go to horny jail alone I guess 🔨`,
    poke: `Stop poking yourself. Weirdo 👉`,
    tickle: `You can't tickle yourself effectively. Science fact 🧪`,
    yeet: `You tried to yeet yourself into another dimension 🚀`,
};

function getSelfMessage(actionName) {
    return SELF_MESSAGES[actionName] || `You can't do that to yourself... go touch grass 🌿`;
}

// All command names (for dispatch & registration)
const ROLEPLAY_COMMANDS = new Set(Object.keys(ACTIONS));

// ══════════════════════════════════════════════════════════
// COOLDOWN — 3 seconds per user
// ══════════════════════════════════════════════════════════
const cooldowns = new Map();
const COOLDOWN_MS = 3000;

function checkCooldown(userId) {
    const last = cooldowns.get(userId);
    if (last && Date.now() - last < COOLDOWN_MS) {
        return Math.ceil((COOLDOWN_MS - (Date.now() - last)) / 1000);
    }
    return 0;
}

// ══════════════════════════════════════════════════════════
// GIF FETCHER
// ══════════════════════════════════════════════════════════
async function fetchGif(api, type) {
    try {
        if (api === 'nekos') {
            const res = await fetch(`https://nekos.best/api/v2/${type}`);
            if (!res.ok) throw new Error(`nekos.best ${res.status}`);
            const data = await res.json();
            return data.results?.[0]?.url || null;
        }
        if (api === 'waifu') {
            const res = await fetch(`https://api.waifu.pics/sfw/${type}`);
            if (!res.ok) throw new Error(`waifu.pics ${res.status}`);
            const data = await res.json();
            return data.url || null;
        }
    } catch (err) {
        logger.error('ROLEPLAY', `GIF fetch failed (${api}/${type})`, err);
        return null;
    }
}

// ══════════════════════════════════════════════════════════
// EMBED BUILDER
// ══════════════════════════════════════════════════════════
function buildRoleplayEmbed(action, actionName, authorName, authorAvatar, targetName, gifUrl, count) {
    const message = buildMessage(action, actionName, authorName, targetName, count);
    const color = action.color || COLORS.primary;

    const embed = new EmbedBuilder()
    .setAuthor({ name: authorName, iconURL: authorAvatar || undefined })
    .setDescription(`${action.emoji} ${message}`)
    .setColor(color);

    if (gifUrl) embed.setImage(gifUrl);

    if (action.target && targetName && count > 0) {
        embed.setFooter({
            text: `${count} time${count !== 1 ? 's' : ''} ${action.label} together`
        });
    }

    return embed;
}

// ══════════════════════════════════════════════════════════
// MAIN HANDLER (prefix & slash compatible)
// ══════════════════════════════════════════════════════════
async function handleRoleplay(ctx, actionName, targetUser, customImageUrl) {
    const isInteraction = !!ctx.deferReply;
    const authorId = isInteraction ? ctx.user.id : ctx.author.id;
    const authorName = isInteraction ? ctx.user.username : ctx.author.username;
    const authorAvatar = isInteraction
        ? ctx.user.displayAvatarURL({ dynamic: true })
        : ctx.author.displayAvatarURL({ dynamic: true });

    // Cooldown check
    const wait = checkCooldown(authorId);
    if (wait > 0) {
        const msg = `⏳ Wait **${wait}s** before using another roleplay command.`;
        if (isInteraction) return ctx.reply({ content: msg, ephemeral: true });
        return ctx.reply({ content: msg });
    }
    cooldowns.set(authorId, Date.now());

    const action = ACTIONS[actionName];
    if (!action) {
        const msg = `❌ Unknown roleplay action: \`${actionName}\``;
        if (isInteraction) return ctx.reply({ content: msg, ephemeral: true });
        return ctx.reply({ content: msg });
    }

    // Self-action check
    if (action.target && targetUser && targetUser.id === authorId) {
        const msg = getSelfMessage(actionName);
        if (isInteraction) return ctx.reply({ content: msg, ephemeral: true });
        return ctx.reply({ content: msg });
    }

    // Defer for slash interactions
    if (isInteraction) await ctx.deferReply();

    // ── Pair counter (only for targeted actions with a real user) ──
    let count = 0;
    if (action.target && targetUser && targetUser.id !== authorId) {
        const guildId = isInteraction ? ctx.guildId : ctx.guild?.id;
        if (guildId) {
            const db = getGuildDb(guildId);
            const rpCounts = db.get('rpCounts', {});
            const key = `${authorId}:${targetUser.id}:${actionName}`;
            rpCounts[key] = (rpCounts[key] || 0) + 1;
            count = rpCounts[key];
            db.set('rpCounts', rpCounts);
        }
    }

    // ── GIF RESOLUTION (priority: customGif > customImageUrl from args > API fetch) ──
    let gifUrl = null;

    // 1. Check if this action has a customGif configured in the ACTIONS map
    if (action.customGif && action.customGif.startsWith('http')) {
        gifUrl = action.customGif;
    }
    // 2. If no customGif, check if user passed a custom image URL in the command args
    else if (customImageUrl && customImageUrl.startsWith('http')) {
        gifUrl = customImageUrl;
    }
    // 3. Otherwise, fetch from the API
    else {
        gifUrl = await fetchGif(action.api, action.type);
    }

    const targetName = targetUser?.username || null;
    const embed = buildRoleplayEmbed(action, actionName, authorName, authorAvatar, targetName, gifUrl, count);

    const content = action.target && targetUser ? `<@${targetUser.id}>` : undefined;
    const payload = { embeds: [embed], ...(content ? { content } : {}) };

    if (isInteraction) return ctx.editReply(payload);
    return ctx.channel.send(payload);
}

module.exports = { handleRoleplay, ROLEPLAY_COMMANDS };