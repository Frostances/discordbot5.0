// modules/reaction.js — Reaction Triggers, Auto-Reactions, NoSelfReact
const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { getGuildDb } = require('./database');
const { success: mkSuccess, error: mkError, info: mkInfo } = require('../utils/embeds');
const { isAdmin, isBotOwner, isStaffOrAdmin } = require('./helpers');

const COMMON_WORDS = new Set([
  'hey','hi','hello','the','a','an','and','or','but','is','are','was','were',
  'be','been','being','have','has','had','do','does','did','will','would',
  'could','should','may','might','must','shall','can','need','dare','ought',
  'used','to','of','in','for','on','with','at','by','from','as','into',
  'through','during','before','after','above','below','between','under',
  'again','further','then','once','here','there','when','where','why','how',
  'all','each','few','more','most','other','some','such','no','nor','not',
  'only','own','same','so','than','too','very','just','now','also','back',
  'down','off','out','over','up','it','its','itself','he','him','his','himself',
  'she','her','hers','herself','they','them','their','theirs','themselves',
  'we','us','our','ours','ourselves','you','your','yours','yourself','yourselves',
  'i','me','my','mine','myself','what','which','who','whom','this','that',
  'these','those','am','if','because','until','while','about','against',
  'around','beside','beyond','despite','except','inside','outside','upon',
  'within','without','any','both','either','neither','one','two','three',
  'four','five','six','seven','eight','nine','ten','yes','no','ok','okay',
  'lol','lmao','omg','wtf','bruh','nah','yea','yeah','nope','idk','imo',
  'im','dont','cant','wont','isnt','arent','wasnt','werent','hasnt','havent',
  'hadnt','didnt','couldnt','wouldnt','shouldnt','mightnt','mustnt','shant',
  'neednt','darent','oughtnt','thats','whats','wheres','whens','whys','hows',
  'heres','theres','lets','whos','whose','whatever','whichever','whoever',
  'whomever','anything','everything','nothing','something','someone',
  'somebody','anyone','anybody','everyone','everybody','nobody','noone',
  'none','many','much','more','most','few','little','less','least','several',
  'enough','plenty','lot','lots','ton','tons','dozen','hundred','thousand',
  'million','billion','trillion','first','second','third','last','next',
  'previous','other','another','same','different','similar','certain',
  'particular','specific','general','usual','normal','regular','common',
  'popular','famous','known','unknown','new','old','young','ancient',
  'modern','current','present','past','future','early','late','soon','later',
  'never','always','sometimes','often','usually','rarely','seldom','frequently',
  'occasionally','constantly','continuously','repeatedly','daily','weekly',
  'monthly','yearly','hourly','minute','second','moment','instant','while',
  'time','day','week','month','year','today','tomorrow','yesterday','tonight',
  'morning','afternoon','evening','night','midnight','noon','dawn','dusk',
  'sunrise','sunset','spring','summer','autumn','winter','monday','tuesday',
  'wednesday','thursday','friday','saturday','sunday','january','february',
  'march','april','may','june','july','august','september','october',
  'november','december','good','bad','great','nice','fine','well','better',
  'best','worse','worst','big','small','large','tiny','huge','little','long',
  'short','tall','high','low','deep','shallow','wide','narrow','thick','thin',
  'fat','skinny','heavy','light','strong','weak','hard','soft','smooth',
  'rough','sharp','blunt','hot','cold','warm','cool','dry','wet','clean',
  'dirty','fresh','stale','sweet','sour','bitter','salty','spicy','bland',
  'loud','quiet','noisy','silent','bright','dark','dim','colorful','dull',
  'vivid','pale','clear','cloudy','foggy','rainy','sunny','windy','snowy',
  'stormy','calm','wild','tame','free','captive','safe','dangerous','risky',
  'secure','protected','vulnerable','powerful','mighty','feeble','brave',
  'cowardly','bold','timid','confident','shy','proud','humble','arrogant',
  'modest','selfish','generous','greedy','kind','cruel','gentle','harsh',
  'friendly','hostile','polite','rude','respectful','disrespectful','honest',
  'dishonest','loyal','disloyal','faithful','unfaithful','trustworthy',
  'untrustworthy','reliable','unreliable','responsible','irresponsible',
  'careful','careless','cautious','reckless','patient','impatient','calm',
  'angry','furious','mad','happy','sad','joyful','miserable','cheerful',
  'gloomy','excited','bored','interested','uninterested','amused','annoyed',
  'pleased','displeased','satisfied','dissatisfied','content','discontent',
  'grateful','ungrateful','hopeful','hopeless','optimistic','pessimistic',
  'enthusiastic','indifferent','passionate','apathetic','curious','surprised',
  'shocked','amazed','astonished','stunned','confused','puzzled','bewildered',
  'lost','found','aware','unaware','conscious','unconscious','asleep','awake',
  'alive','dead','sick','healthy','ill','well','injured','hurt','wounded',
  'healed','cured','broken','fixed','damaged','repaired','destroyed','built',
  'created','made','produced','manufactured','grown','developed','evolved',
  'changed','transformed','converted','turned','became','remained','stayed',
  'left','went','came','arrived','departed','entered','exited','joined',
  'added','removed','included','excluded','accepted','rejected','approved',
  'denied','allowed','forbidden','permitted','prohibited','encouraged',
  'discouraged','supported','opposed','helped','hindered','assisted','blocked',
  'enabled','disabled','activated','deactivated','started','stopped','began',
  'ended','finished','completed','incomplete','partial','total','full','empty',
  'half','quarter','whole','entire','complete','perfect','imperfect','flawless',
  'flawed','exact','approximate','precise','vague','obvious','hidden','visible',
  'invisible','apparent','real','fake','true','false','correct','incorrect',
  'right','wrong','accurate','inaccurate','valid','invalid','legal','illegal',
  'legitimate','illegitimate','official','unofficial','formal','informal',
  'professional','amateur','expert','novice','beginner','advanced','intermediate',
  'basic','fundamental','essential','necessary','unnecessary','required',
  'optional','mandatory','voluntary','compulsory','free','paid','expensive',
  'cheap','affordable','pricey','costly','valuable','worthless','precious',
  'rich','poor','wealthy','impoverished','prosperous','destitute','lucky',
  'unlucky','fortunate','unfortunate','successful','unsuccessful','victorious',
  'defeated','winning','losing','profitable','unprofitable','beneficial',
  'harmful','useful','useless','helpful','helpless','effective','ineffective',
  'efficient','inefficient','productive','unproductive','active','inactive',
  'busy','idle','working','broken','functional','dysfunctional','operational',
  'inoperable','available','unavailable','accessible','inaccessible','open',
  'closed','locked','unlocked','secured','unsecured','protected','exposed',
  'covered','uncovered','hidden','revealed','secret','public','private',
  'personal','collective','individual','group','team','solo','alone','together',
  'united','divided','connected','disconnected','attached','detached','linked',
  'unlinked','related','unrelated','relevant','irrelevant','appropriate',
  'inappropriate','suitable','unsuitable','fitting','unfitting','proper',
  'improper','decent','indecent','moral','immoral','ethical','unethical',
  'lawful','unlawful','criminal','innocent','guilty','suspected','accused',
  'charged','convicted','acquitted','sentenced','pardoned','forgiven',
  'unforgiven','redeemed','damned','saved','lost','missing','present','absent',
  'existing','nonexistent','imaginary','fictional','factual','theoretical',
  'practical','applied','pure','mixed','combined','separated','joined','split',
  'merged','divided','multiplied','added','subtracted','increased','decreased',
  'reduced','expanded','contracted','grown','shrunk','stretched','compressed',
  'extended','shortened','lengthened','widened','narrowed','deepened',
  'shallowed','heightened','lowered','raised','dropped','lifted','elevated',
  'depressed','promoted','demoted','upgraded','downgraded','improved',
  'worsened','enhanced','diminished','amplified','reduced','magnified',
  'minimized','maximized','optimized','simplified','complicated','clarified',
  'confused','organized','disorganized','ordered','disordered','arranged',
  'disarranged','structured','unstructured','systematic','chaotic','planned',
  'unplanned','prepared','unprepared','ready','unready','set','unset','fixed',
  'unfixed','stable','unstable','steady','unsteady','balanced','unbalanced',
  'equal','unequal','fair','unfair','just','unjust','biased','unbiased',
  'prejudiced','unprejudiced','subjective','objective','partial','impartial',
  'neutral','positive','negative','realistic','idealistic','pragmatic',
  'dogmatic','flexible','rigid','adaptable','inflexible','versatile','limited',
  'broad','wide','tight','loose','strict','lenient','severe','mild','firm',
  'solid','liquid','gas','pointed','edgeless','curved','straight','crooked',
  'bent','twisted','warped','flat','round','square','rectangular','triangular',
  'circular','oval','spherical','cylindrical','cubic','angular','linear',
  'parallel','perpendicular','diagonal','horizontal','vertical','upright',
  'upside','down','sideways','backwards','forwards','ahead','behind','beside',
  'near','far','close','distant','remote','local','global','universal',
  'generic','unique','rare','scarce','abundant','plentiful','sparse','dense',
  'crowded','vacant','occupied','taken','reserved','jon','waddup','wassup',
  'sup','yo','yoo',
]);

function parseEmoji(str) {
  if (!str) return null;
  const customMatch = str.match(/^<(a)?:(\w+):(\d+)>$/);
  if (customMatch) {
    return { id: customMatch[3], name: customMatch[2], animated: !!customMatch[1] };
  }
  const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
  const segments = Array.from(segmenter.segment(str.trim()));
  if (segments.length === 1) {
    return { id: null, name: segments[0].segment, animated: false };
  }
  if (/^[\u{1F1E6}-\u{1F1FF}]{2}$/u.test(str.trim())) {
    return { id: null, name: str.trim(), animated: false };
  }
  return null;
}

function emojiToString(emojiObj) {
  if (emojiObj.id) {
    return `<${emojiObj.animated ? 'a' : ''}:${emojiObj.name}:${emojiObj.id}>`;
  }
  return emojiObj.name;
}

function parseMessageLink(link) {
  const match = link.match(/https?:\/\/discord(?:app)?\.com\/channels\/(\d+)\/(\d+)\/(\d+)/);
  if (!match) return null;
  return { guildId: match[1], channelId: match[2], messageId: match[3] };
}

function hasManageExpressions(member) {
  return member.permissions.has(PermissionFlagsBits.ManageGuildExpressions) ||
         member.permissions.has(PermissionFlagsBits.Administrator);
}

function hasManageMessages(member) {
  return member.permissions.has(PermissionFlagsBits.ManageMessages) ||
         member.permissions.has(PermissionFlagsBits.Administrator);
}

function getReactionTriggers(guildId) {
  const db = getGuildDb(guildId);
  return db.get('reactionTriggers', []);
}

function setReactionTriggers(guildId, triggers) {
  const db = getGuildDb(guildId);
  db.set('reactionTriggers', triggers);
}

function getPreviousReactionTriggers(guildId) {
  const db = getGuildDb(guildId);
  return db.get('previousReactionTriggers', []);
}

function setPreviousReactionTriggers(guildId, triggers) {
  const db = getGuildDb(guildId);
  db.set('previousReactionTriggers', triggers);
}

function getAutoReactionChannels(guildId) {
  const db = getGuildDb(guildId);
  return db.get('autoReactionChannels', {});
}

function setAutoReactionChannels(guildId, channels) {
  const db = getGuildDb(guildId);
  db.set('autoReactionChannels', channels);
}

function getNoSelfReact(guildId) {
  const db = getGuildDb(guildId);
  return db.get('noselfreact', {
    enabled: false,
    bypassStaff: false,
    punishment: 'warn',
    monitoredEmojis: [],
    exempts: { members: [], channels: [], roles: [] }
  });
}

function setNoSelfReact(guildId, data) {
  const db = getGuildDb(guildId);
  db.set('noselfreact', data);
}

async function handleReactionCommand(message, args) {
  if (!hasManageMessages(message.member)) {
    return message.reply({ embeds: [mkError('Permission Denied', 'You need the **Manage Messages** permission.')] });
  }
  const link = args[0];
  const emojiStr = args[1];
  if (!link || !emojiStr) {
    return message.reply({ embeds: [mkError('Missing Arguments', 'Usage: `,reaction <message link> <emoji>`')] });
  }
  const parsed = parseMessageLink(link);
  if (!parsed) {
    return message.reply({ embeds: [mkError('Invalid Link', 'Provide a valid Discord message link.')] });
  }
  const emoji = parseEmoji(emojiStr);
  if (!emoji) {
    return message.reply({ embeds: [mkError('Invalid Emoji', 'Provide a valid emoji.')] });
  }
  try {
    const channel = await message.guild.channels.fetch(parsed.channelId).catch(() => null);
    if (!channel) {
      return message.reply({ embeds: [mkError('Channel Not Found', 'Could not find the channel from the link.')] });
    }
    const targetMsg = await channel.messages.fetch(parsed.messageId).catch(() => null);
    if (!targetMsg) {
      return message.reply({ embeds: [mkError('Message Not Found', 'Could not find the message from the link.')] });
    }
    await targetMsg.react(emojiToString(emoji));
    return message.reply({ embeds: [mkSuccess('Reaction Added', `Reacted to the message with ${emojiToString(emoji)}.`)] });
  } catch (err) {
    return message.reply({ embeds: [mkError('Failed', `Could not react: ${err.message}`)] });
  }
}

async function handleReactionAddCmd(message, args) {
  if (!hasManageExpressions(message.member)) {
    return message.reply({ embeds: [mkError('Permission Denied', 'You need the **Manage Expressions** permission.')] });
  }
  const emojiStr = args[0];
  const trigger = args[1]?.toLowerCase();
  if (!emojiStr || !trigger) {
    return message.reply({ embeds: [mkError('Missing Arguments', 'Usage: `,reaction add <emoji> <trigger>`')] });
  }
  if (COMMON_WORDS.has(trigger) || trigger.length < 2) {
    return message.reply({ embeds: [mkError('Invalid Trigger', 'Common words and very short triggers are not allowed to prevent heavy bot load.')] });
  }
  const emoji = parseEmoji(emojiStr);
  if (!emoji) {
    return message.reply({ embeds: [mkError('Invalid Emoji', 'Provide a valid emoji.')] });
  }
  const triggers = getReactionTriggers(message.guild.id);
  const emojiKey = emojiToString(emoji);
  if (triggers.some(t => t.emoji === emojiKey && t.trigger === trigger)) {
    return message.reply({ embeds: [mkError('Duplicate', 'That reaction trigger already exists.')] });
  }
  triggers.push({ emoji: emojiKey, trigger, authorId: message.author.id, createdAt: Date.now() });
  setReactionTriggers(message.guild.id, triggers);
  return message.reply({ embeds: [mkSuccess('Reaction Trigger Created', `Created reaction trigger **${trigger}** with ${emojiKey}.`)] });
}

async function handleReactionRemove(message, args) {
  if (!hasManageExpressions(message.member)) {
    return message.reply({ embeds: [mkError('Permission Denied', 'You need the **Manage Expressions** permission.')] });
  }
  const emojiStr = args[0];
  const trigger = args[1]?.toLowerCase();
  if (!emojiStr || !trigger) {
    return message.reply({ embeds: [mkError('Missing Arguments', 'Usage: `,reaction remove <emoji> <trigger>`')] });
  }
  const emoji = parseEmoji(emojiStr);
  if (!emoji) {
    return message.reply({ embeds: [mkError('Invalid Emoji', 'Provide a valid emoji.')] });
  }
  const emojiKey = emojiToString(emoji);
  let triggers = getReactionTriggers(message.guild.id);
  const beforeLen = triggers.length;
  triggers = triggers.filter(t => !(t.emoji === emojiKey && t.trigger === trigger));
  if (triggers.length === beforeLen) {
    return message.reply({ embeds: [mkError('Not Found', 'That reaction trigger does not exist.')] });
  }
  setReactionTriggers(message.guild.id, triggers);
  return message.reply({ embeds: [mkSuccess('Reaction Trigger Deleted', `Deleted reaction trigger **${trigger}** with ${emojiKey}.`)] });
}

async function handleReactionRemoveAll(message, args) {
  if (!hasManageExpressions(message.member)) {
    return message.reply({ embeds: [mkError('Permission Denied', 'You need the **Manage Expressions** permission.')] });
  }
  const trigger = args[0]?.toLowerCase();
  if (!trigger) {
    return message.reply({ embeds: [mkError('Missing Arguments', 'Usage: `,reaction removeall <trigger>`')] });
  }
  let triggers = getReactionTriggers(message.guild.id);
  const beforeLen = triggers.length;
  triggers = triggers.filter(t => t.trigger !== trigger);
  if (triggers.length === beforeLen) {
    return message.reply({ embeds: [mkError('Not Found', `No reaction triggers found for **${trigger}**.`)] });
  }
  setReactionTriggers(message.guild.id, triggers);
  return message.reply({ embeds: [mkSuccess('Reaction Triggers Deleted', `Deleted all reaction triggers for **${trigger}**.`)] });
}

async function handleReactionList(message) {
  if (!hasManageExpressions(message.member)) {
    return message.reply({ embeds: [mkError('Permission Denied', 'You need the **Manage Expressions** permission.')] });
  }
  const triggers = getReactionTriggers(message.guild.id);
  if (!triggers.length) {
    return message.reply({ embeds: [mkInfo('Reaction Triggers', 'No reaction triggers configured in this server.')] });
  }
  const grouped = {};
  for (const t of triggers) {
    if (!grouped[t.trigger]) grouped[t.trigger] = [];
    grouped[t.trigger].push(t.emoji);
  }
  let desc = '';
  for (const [word, emojis] of Object.entries(grouped)) {
    desc += `**${word}** — ${emojis.join(' ')}\n`;
  }
  const embed = new EmbedBuilder()
    .setTitle('📋 Reaction Triggers')
    .setDescription(desc)
    .setColor('#5865F2')
    .setFooter({ text: `${triggers.length} total trigger(s)` });
  return message.reply({ embeds: [embed] });
}

async function handleReactionClear(message) {
  if (!hasManageExpressions(message.member)) {
    return message.reply({ embeds: [mkError('Permission Denied', 'You need the **Manage Expressions** permission.')] });
  }
  const triggers = getReactionTriggers(message.guild.id);
  if (!triggers.length) {
    return message.reply({ embeds: [mkInfo('Reaction Triggers', 'No reaction triggers to clear.')] });
  }
  setReactionTriggers(message.guild.id, []);
  return message.reply({ embeds: [mkSuccess('Reaction Triggers Cleared', `Removed **${triggers.length}** reaction trigger(s).`)] });
}

async function handleReactionOwner(message, args) {
  if (!hasManageExpressions(message.member)) {
    return message.reply({ embeds: [mkError('Permission Denied', 'You need the **Manage Expressions** permission.')] });
  }
  const trigger = args[0]?.toLowerCase();
  if (!trigger) {
    return message.reply({ embeds: [mkError('Missing Arguments', 'Usage: `,reaction owner <trigger>`')] });
  }
  const triggers = getReactionTriggers(message.guild.id);
  const match = triggers.find(t => t.trigger === trigger);
  if (!match) {
    return message.reply({ embeds: [mkError('Not Found', `No reaction trigger found for **${trigger}**.`)] });
  }
  const author = await message.guild.members.fetch(match.authorId).catch(() => null);
  const authorTag = author ? author.user.tag : `Unknown (${match.authorId})`;
  return message.reply({ embeds: [mkInfo('Reaction Trigger Author', `Reaction trigger **${trigger}** author is **${authorTag}**.`)] });
}

async function handleReactionMessages(message, args) {
  if (!hasManageExpressions(message.member)) {
    return message.reply({ embeds: [mkError('Permission Denied', 'You need the **Manage Expressions** permission.')] });
  }
  const channelArg = args[0];
  const emojis = args.slice(1);
  if (!channelArg) {
    return message.reply({ embeds: [mkError('Missing Arguments', 'Usage: `,reaction messages <#channel> [emoji1] [emoji2] [emoji3]`')] });
  }
  const channelMatch = channelArg.match(/^<#(\d+)>$/);
  const channelId = channelMatch ? channelMatch[1] : channelArg;
  const channel = message.guild.channels.cache.get(channelId);
  if (!channel) {
    return message.reply({ embeds: [mkError('Channel Not Found', 'Could not find that channel.')] });
  }
  if (!emojis.length) {
    const channels = getAutoReactionChannels(message.guild.id);
    if (!channels[channelId]) {
      return message.reply({ embeds: [mkError('Not Set', 'That channel does not have auto-reactions configured.')] });
    }
    delete channels[channelId];
    setAutoReactionChannels(message.guild.id, channels);
    return message.reply({ embeds: [mkSuccess('Auto Reactions Removed', `Removed auto reactions from <#${channelId}>.`)] });
  }
  const parsedEmojis = [];
  for (const e of emojis.slice(0, 3)) {
    const emoji = parseEmoji(e);
    if (!emoji) {
      return message.reply({ embeds: [mkError('Invalid Emoji', `Could not parse emoji: ${e}`)] });
    }
    parsedEmojis.push(emojiToString(emoji));
  }
  const slowmode = channel.rateLimitPerUser || 0;
  const isImgOnly = channel.name.toLowerCase().includes('imgonly') || channel.name.toLowerCase().includes('image-only') || channel.name.toLowerCase().includes('images-only');
  if (!isImgOnly && slowmode < 60) {
    return message.reply({ embeds: [mkError('Channel Requirement', 'The channel must either be set as **imgonly** or have a slowmode of at least **one minute**.')] });
  }
  const channels = getAutoReactionChannels(message.guild.id);
  channels[channelId] = parsedEmojis;
  setAutoReactionChannels(message.guild.id, channels);
  return message.reply({ embeds: [mkSuccess('Auto Reactions Set', `Set ${parsedEmojis.join(' ')} as auto reactions for <#${channelId}>.`)] });
}

async function handleReactionMessagesList(message) {
  if (!hasManageExpressions(message.member)) {
    return message.reply({ embeds: [mkError('Permission Denied', 'You need the **Manage Expressions** permission.')] });
  }
  const channels = getAutoReactionChannels(message.guild.id);
  const entries = Object.entries(channels);
  if (!entries.length) {
    return message.reply({ embeds: [mkInfo('Auto Reaction Channels', 'No channels have auto-reactions configured.')] });
  }
  let desc = '';
  for (const [chId, emojis] of entries) {
    const ch = message.guild.channels.cache.get(chId);
    const chName = ch ? `<#${chId}>` : `Unknown (${chId})`;
    desc += `${chName} — ${emojis.join(' ')}\n`;
  }
  const embed = new EmbedBuilder()
    .setTitle('📋 Auto Reaction Channels')
    .setDescription(desc)
    .setColor('#5865F2');
  return message.reply({ embeds: [embed] });
}

async function handlePreviousReactAdd(message, args) {
  if (!hasManageExpressions(message.member)) {
    return message.reply({ embeds: [mkError('Permission Denied', 'You need the **Manage Expressions** permission.')] });
  }
  const emojiStr = args[0];
  const trigger = args[1]?.toLowerCase();
  if (!emojiStr || !trigger) {
    return message.reply({ embeds: [mkError('Missing Arguments', 'Usage: `,previousreact add <emoji> <trigger>`')] });
  }
  if (COMMON_WORDS.has(trigger) || trigger.length < 2) {
    return message.reply({ embeds: [mkError('Invalid Trigger', 'Common words and very short triggers are not allowed.')] });
  }
  const emoji = parseEmoji(emojiStr);
  if (!emoji) {
    return message.reply({ embeds: [mkError('Invalid Emoji', 'Provide a valid emoji.')] });
  }
  const triggers = getPreviousReactionTriggers(message.guild.id);
  const emojiKey = emojiToString(emoji);
  if (triggers.some(t => t.emoji === emojiKey && t.trigger === trigger)) {
    return message.reply({ embeds: [mkError('Duplicate', 'That previous reaction trigger already exists.')] });
  }
  triggers.push({ emoji: emojiKey, trigger, authorId: message.author.id, createdAt: Date.now() });
  setPreviousReactionTriggers(message.guild.id, triggers);
  return message.reply({ embeds: [mkSuccess('Previous Reaction Trigger Created', `Created previous reaction trigger **${trigger}** with ${emojiKey}.`)] });
}

async function handlePreviousReactRemove(message, args) {
  if (!hasManageExpressions(message.member)) {
    return message.reply({ embeds: [mkError('Permission Denied', 'You need the **Manage Expressions** permission.')] });
  }
  const emojiStr = args[0];
  const trigger = args[1]?.toLowerCase();
  if (!emojiStr || !trigger) {
    return message.reply({ embeds: [mkError('Missing Arguments', 'Usage: `,previousreact remove <emoji> <trigger>`')] });
  }
  const emoji = parseEmoji(emojiStr);
  if (!emoji) {
    return message.reply({ embeds: [mkError('Invalid Emoji', 'Provide a valid emoji.')] });
  }
  const emojiKey = emojiToString(emoji);
  let triggers = getPreviousReactionTriggers(message.guild.id);
  const beforeLen = triggers.length;
  triggers = triggers.filter(t => !(t.emoji === emojiKey && t.trigger === trigger));
  if (triggers.length === beforeLen) {
    return message.reply({ embeds: [mkError('Not Found', 'That previous reaction trigger does not exist.')] });
  }
  setPreviousReactionTriggers(message.guild.id, triggers);
  return message.reply({ embeds: [mkSuccess('Previous Reaction Trigger Deleted', `Deleted previous reaction trigger **${trigger}** with ${emojiKey}.`)] });
}

async function handlePreviousReactRemoveAll(message, args) {
  if (!hasManageExpressions(message.member)) {
    return message.reply({ embeds: [mkError('Permission Denied', 'You need the **Manage Expressions** permission.')] });
  }
  const trigger = args[0]?.toLowerCase();
  if (!trigger) {
    return message.reply({ embeds: [mkError('Missing Arguments', 'Usage: `,previousreact removeall <trigger>`')] });
  }
  let triggers = getPreviousReactionTriggers(message.guild.id);
  const beforeLen = triggers.length;
  triggers = triggers.filter(t => t.trigger !== trigger);
  if (triggers.length === beforeLen) {
    return message.reply({ embeds: [mkError('Not Found', `No previous reaction triggers found for **${trigger}**.`)] });
  }
  setPreviousReactionTriggers(message.guild.id, triggers);
  return message.reply({ embeds: [mkSuccess('Previous Reaction Triggers Deleted', `Deleted all previous reaction triggers for **${trigger}**.`)] });
}

async function handlePreviousReactList(message) {
  if (!hasManageExpressions(message.member)) {
    return message.reply({ embeds: [mkError('Permission Denied', 'You need the **Manage Expressions** permission.')] });
  }
  const triggers = getPreviousReactionTriggers(message.guild.id);
  if (!triggers.length) {
    return message.reply({ embeds: [mkInfo('Previous Reaction Triggers', 'No previous reaction triggers configured.')] });
  }
  const grouped = {};
  for (const t of triggers) {
    if (!grouped[t.trigger]) grouped[t.trigger] = [];
    grouped[t.trigger].push(t.emoji);
  }
  let desc = '';
  for (const [word, emojis] of Object.entries(grouped)) {
    desc += `**${word}** — ${emojis.join(' ')}\n`;
  }
  const embed = new EmbedBuilder()
    .setTitle('📋 Previous Reaction Triggers')
    .setDescription(desc)
    .setColor('#5865F2')
    .setFooter({ text: `${triggers.length} total trigger(s)` });
  return message.reply({ embeds: [embed] });
}

async function handlePreviousReactClear(message) {
  if (!hasManageExpressions(message.member)) {
    return message.reply({ embeds: [mkError('Permission Denied', 'You need the **Manage Expressions** permission.')] });
  }
  const triggers = getPreviousReactionTriggers(message.guild.id);
  if (!triggers.length) {
    return message.reply({ embeds: [mkInfo('Previous Reaction Triggers', 'No previous reaction triggers to clear.')] });
  }
  setPreviousReactionTriggers(message.guild.id, []);
  return message.reply({ embeds: [mkSuccess('Previous Reaction Triggers Cleared', `Removed **${triggers.length}** previous reaction trigger(s).`)] });
}

async function handlePreviousReactOwner(message, args) {
  if (!hasManageExpressions(message.member)) {
    return message.reply({ embeds: [mkError('Permission Denied', 'You need the **Manage Expressions** permission.')] });
  }
  const trigger = args[0]?.toLowerCase();
  if (!trigger) {
    return message.reply({ embeds: [mkError('Missing Arguments', 'Usage: `,previousreact owner <trigger>`')] });
  }
  const triggers = getPreviousReactionTriggers(message.guild.id);
  const match = triggers.find(t => t.trigger === trigger);
  if (!match) {
    return message.reply({ embeds: [mkError('Not Found', `No previous reaction trigger found for **${trigger}**.`)] });
  }
  const author = await message.guild.members.fetch(match.authorId).catch(() => null);
  const authorTag = author ? author.user.tag : `Unknown (${match.authorId})`;
  return message.reply({ embeds: [mkInfo('Previous Reaction Trigger Author', `Previous reaction trigger **${trigger}** author is **${authorTag}**.`)] });
}

async function handleNoSelfReact(message, args) {
  const sub = args[0]?.toLowerCase();
  const data = getNoSelfReact(message.guild.id);

  if (!sub) {
    const enabled = data.enabled ? '✅ Enabled' : '❌ Disabled';
    const bypass = data.bypassStaff ? '✅ Yes' : '❌ No';
    const punishment = data.punishment || 'warn';
    const emojiCount = data.monitoredEmojis?.length || 0;
    const exemptCount = (data.exempts?.members?.length || 0) + (data.exempts?.channels?.length || 0) + (data.exempts?.roles?.length || 0);
    const embed = new EmbedBuilder()
      .setTitle('🚫 NoSelfReact Status')
      .setColor('#5865F2')
      .addFields(
        { name: 'Status', value: enabled, inline: true },
        { name: 'Staff Bypass', value: bypass, inline: true },
        { name: 'Punishment', value: punishment, inline: true },
        { name: 'Monitored Emojis', value: emojiCount.toString(), inline: true },
        { name: 'Exemptions', value: exemptCount.toString(), inline: true },
      );
    return message.reply({ embeds: [embed] });
  }

  if (sub === 'toggle') {
    if (!isAdmin(message.member)) {
      return message.reply({ embeds: [mkError('Permission Denied', 'You need **Administrator** permission.')] });
    }
    const setting = args[1]?.toLowerCase();
    if (setting === 'on' || setting === 'enable' || setting === 'true') data.enabled = true;
    else if (setting === 'off' || setting === 'disable' || setting === 'false') data.enabled = false;
    else data.enabled = !data.enabled;
    setNoSelfReact(message.guild.id, data);
    return message.reply({ embeds: [mkSuccess('NoSelfReact Toggled', `NoSelfReact is now **${data.enabled ? 'enabled' : 'disabled'}**.`)] });
  }

  if (sub === 'bypass') {
    if (message.guild.ownerId !== message.author.id && !isBotOwner(message.author.id)) {
      return message.reply({ embeds: [mkError('Permission Denied', 'Only the **server owner** can manage bypass settings.')] });
    }
    const setting = args[1]?.toLowerCase();
    if (setting === 'on' || setting === 'enable' || setting === 'true') data.bypassStaff = true;
    else if (setting === 'off' || setting === 'disable' || setting === 'false') data.bypassStaff = false;
    else data.bypassStaff = !data.bypassStaff;
    setNoSelfReact(message.guild.id, data);
    return message.reply({ embeds: [mkSuccess('Bypass Toggled', `Staff bypass is now **${data.bypassStaff ? 'enabled' : 'disabled'}**.`)] });
  }

  if (sub === 'exempt') {
    if (!isAdmin(message.member)) {
      return message.reply({ embeds: [mkError('Permission Denied', 'You need **Administrator** permission.')] });
    }
    const exemptSub = args[1]?.toLowerCase();
    if (exemptSub === 'list') {
      const members = data.exempts?.members || [];
      const channels = data.exempts?.channels || [];
      const roles = data.exempts?.roles || [];
      let desc = '';
      if (members.length) desc += `**Members:**\n${members.map(id => `<@${id}>`).join('\n')}\n\n`;
      if (channels.length) desc += `**Channels:**\n${channels.map(id => `<#${id}>`).join('\n')}\n\n`;
      if (roles.length) desc += `**Roles:**\n${roles.map(id => `<@&${id}>`).join('\n')}\n\n`;
      if (!desc) desc = 'No exemptions configured.';
      const embed = new EmbedBuilder()
        .setTitle('📋 NoSelfReact Exemptions')
        .setDescription(desc)
        .setColor('#5865F2');
      return message.reply({ embeds: [embed] });
    }
    if (exemptSub === 'remove') {
      const targetArg = args[2];
      if (!targetArg) {
        return message.reply({ embeds: [mkError('Missing Target', 'Usage: `,noselfreact exempt remove <@user|#channel|@role>`')] });
      }
      const memberMatch = targetArg.match(/^<@!?(\d+)>$/);
      const channelMatch = targetArg.match(/^<#(\d+)>$/);
      const roleMatch = targetArg.match(/^<@&(\d+)>$/);
      const rawId = targetArg.match(/^\d+$/);
      let removed = false;
      if (memberMatch || rawId) {
        const id = memberMatch ? memberMatch[1] : rawId[0];
        data.exempts.members = (data.exempts.members || []).filter(m => m !== id);
        removed = true;
      } else if (channelMatch || rawId) {
        const id = channelMatch ? channelMatch[1] : rawId[0];
        data.exempts.channels = (data.exempts.channels || []).filter(c => c !== id);
        removed = true;
      } else if (roleMatch || rawId) {
        const id = roleMatch ? roleMatch[1] : rawId[0];
        data.exempts.roles = (data.exempts.roles || []).filter(r => r !== id);
        removed = true;
      }
      if (!removed) {
        return message.reply({ embeds: [mkError('Invalid Target', 'Mention a user, channel, or role.')] });
      }
      setNoSelfReact(message.guild.id, data);
      return message.reply({ embeds: [mkSuccess('Exemption Removed', 'The exemption has been removed.')] });
    }
    const targetArg = args[1];
    if (!targetArg) {
      return message.reply({ embeds: [mkError('Missing Target', 'Usage: `,noselfreact exempt <@user|#channel|@role>`')] });
    }
    const memberMatch = targetArg.match(/^<@!?(\d+)>$/);
    const channelMatch = targetArg.match(/^<#(\d+)>$/);
    const roleMatch = targetArg.match(/^<@&(\d+)>$/);
    const rawId = targetArg.match(/^\d+$/);
    let added = false;
    let type = '';
    if (memberMatch || rawId) {
      const id = memberMatch ? memberMatch[1] : rawId[0];
      if (!data.exempts.members) data.exempts.members = [];
      if (!data.exempts.members.includes(id)) data.exempts.members.push(id);
      added = true; type = 'member';
    } else if (channelMatch || rawId) {
      const id = channelMatch ? channelMatch[1] : rawId[0];
      if (!data.exempts.channels) data.exempts.channels = [];
      if (!data.exempts.channels.includes(id)) data.exempts.channels.push(id);
      added = true; type = 'channel';
    } else if (roleMatch || rawId) {
      const id = roleMatch ? roleMatch[1] : rawId[0];
      if (!data.exempts.roles) data.exempts.roles = [];
      if (!data.exempts.roles.includes(id)) data.exempts.roles.push(id);
      added = true; type = 'role';
    }
    if (!added) {
      return message.reply({ embeds: [mkError('Invalid Target', 'Mention a user, channel, or role.')] });
    }
    setNoSelfReact(message.guild.id, data);
    return message.reply({ embeds: [mkSuccess('Exemption Added', `Added ${type} to NoSelfReact exemptions.`)] });
  }

  if (sub === 'emoji') {
    if (!isAdmin(message.member)) {
      return message.reply({ embeds: [mkError('Permission Denied', 'You need **Administrator** permission.')] });
    }
    const emojiSub = args[1]?.toLowerCase();
    if (emojiSub === 'list') {
      const emojis = data.monitoredEmojis || [];
      if (!emojis.length) {
        return message.reply({ embeds: [mkInfo('Monitored Emojis', 'No emojis are being monitored.')] });
      }
      const embed = new EmbedBuilder()
        .setTitle('📋 Monitored Self-React Emojis')
        .setDescription(emojis.join(' '))
        .setColor('#5865F2');
      return message.reply({ embeds: [embed] });
    }
    const emojiStr = args[1];
    if (!emojiStr) {
      return message.reply({ embeds: [mkError('Missing Emoji', 'Usage: `,noselfreact emoji <emoji>` or `,noselfreact emoji list`')] });
    }
    const emoji = parseEmoji(emojiStr);
    if (!emoji) {
      return message.reply({ embeds: [mkError('Invalid Emoji', 'Provide a valid emoji.')] });
    }
    const emojiKey = emojiToString(emoji);
    if (!data.monitoredEmojis) data.monitoredEmojis = [];
    if (data.monitoredEmojis.includes(emojiKey)) {
      data.monitoredEmojis = data.monitoredEmojis.filter(e => e !== emojiKey);
      setNoSelfReact(message.guild.id, data);
      return message.reply({ embeds: [mkSuccess('Emoji Removed', `Removed ${emojiKey} from monitored self-react emojis.`)] });
    } else {
      data.monitoredEmojis.push(emojiKey);
      setNoSelfReact(message.guild.id, data);
      return message.reply({ embeds: [mkSuccess('Emoji Added', `Added ${emojiKey} to monitored self-react emojis.`)] });
    }
  }

  if (sub === 'punishment') {
    if (!isAdmin(message.member)) {
      return message.reply({ embeds: [mkError('Permission Denied', 'You need **Administrator** permission.')] });
    }
    const punishment = args[1]?.toLowerCase();
    const valid = ['warn', 'kick', 'ban', 'timeout', 'mute', 'jail'];
    if (!punishment || !valid.includes(punishment)) {
      return message.reply({ embeds: [mkError('Invalid Punishment', `Valid punishments: ${valid.join(', ')}`)] });
    }
    data.punishment = punishment;
    setNoSelfReact(message.guild.id, data);
    return message.reply({ embeds: [mkSuccess('Punishment Set', `Default punishment for self-reacts is now **${punishment}**.`)] });
  }

  return message.reply({ embeds: [mkInfo('NoSelfReact Usage',
    '`,noselfreact` — view status\n' +
    '`,noselfreact toggle <on/off>` — toggle monitoring\n' +
    '`,noselfreact bypass <on/off>` — toggle staff bypass (owner only)\n' +
    '`,noselfreact exempt <@user|#channel|@role>` — add exemption\n' +
    '`,noselfreact exempt remove <@user|#channel|@role>` — remove exemption\n' +
    '`,noselfreact exempt list` — list exemptions\n' +
    '`,noselfreact emoji <emoji>` — add/remove monitored emoji\n' +
    '`,noselfreact emoji list` — list monitored emojis\n' +
    '`,noselfreact punishment <warn/kick/ban/timeout/mute/jail>` — set punishment'
  )] });
}

async function onMessageCreate(message) {
  if (message.author.bot || !message.guild) return;
  const guildId = message.guild.id;
  const triggers = getReactionTriggers(guildId);
  const lowerContent = message.content.toLowerCase();
  for (const t of triggers) {
    if (lowerContent.includes(t.trigger)) {
      try { await message.react(t.emoji); } catch {}
    }
  }
  const prevTriggers = getPreviousReactionTriggers(guildId);
  for (const t of prevTriggers) {
    if (lowerContent.includes(t.trigger)) {
      try { await message.react(t.emoji); } catch {}
    }
  }
  const autoChannels = getAutoReactionChannels(guildId);
  const emojis = autoChannels[message.channel.id];
  if (emojis && emojis.length) {
    for (const emoji of emojis) {
      try { await message.react(emoji); } catch {}
    }
  }
}

async function onReactionAdd(reaction, user, client) {
  if (user.bot) return;
  if (reaction.partial) {
    try { await reaction.fetch(); } catch { return; }
  }
  if (reaction.message.partial) {
    try { await reaction.message.fetch(); } catch { return; }
  }
  const message = reaction.message;
  if (!message.guild) return;
  const guildId = message.guild.id;
  const data = getNoSelfReact(guildId);
  if (!data.enabled) return;
  if (message.author.id !== user.id) return;
  const emojiStr = reaction.emoji.id ? `<${reaction.emoji.animated ? 'a' : ''}:${reaction.emoji.name}:${reaction.emoji.id}>` : reaction.emoji.name;
  const monitored = data.monitoredEmojis || [];
  if (!monitored.length) return;
  if (!monitored.includes(emojiStr)) return;
  const member = await message.guild.members.fetch(user.id).catch(() => null);
  if (!member) return;
  if ((data.exempts?.channels || []).includes(message.channel.id)) return;
  if ((data.exempts?.members || []).includes(user.id)) return;
  for (const roleId of (data.exempts?.roles || [])) {
    if (member.roles.cache.has(roleId)) return;
  }
  if (data.bypassStaff && isStaffOrAdmin(member)) return;
  try { await reaction.users.remove(user.id); } catch {}
  const punishment = data.punishment || 'warn';
  try {
    if (punishment === 'warn') {
      const { addWarning } = require('./moderation');
      addWarning(user.id, 'Self-reaction detected', client.user.id);
      await message.channel.send({ embeds: [mkError('Self-React Detected', `<@${user.id}> You have been warned for reacting to your own message.`)] });
    } else if (punishment === 'kick') {
      await member.kick('Self-reaction detected');
      await message.channel.send({ embeds: [mkError('Self-React Detected', `<@${user.id}> has been kicked for reacting to their own message.`)] });
    } else if (punishment === 'ban') {
      await member.ban({ reason: 'Self-reaction detected', deleteMessageDays: 0 });
      await message.channel.send({ embeds: [mkError('Self-React Detected', `<@${user.id}> has been banned for reacting to their own message.`)] });
    } else if (punishment === 'timeout') {
      await member.timeout(10 * 60 * 1000, 'Self-reaction detected');
      await message.channel.send({ embeds: [mkError('Self-React Detected', `<@${user.id}> has been timed out for 10 minutes for reacting to their own message.`)] });
    } else if (punishment === 'mute') {
      const { applyMute } = require('./mute');
      await applyMute(message.guild, member, 10 * 60 * 1000, 'Self-reaction detected', client.user);
      await message.channel.send({ embeds: [mkError('Self-React Detected', `<@${user.id}> has been muted for 10 minutes for reacting to their own message.`)] });
    } else if (punishment === 'jail') {
      const { applyJail } = require('./jail');
      await applyJail(message.guild, member, 10 * 60 * 1000, 'Self-reaction detected', client.user);
      await message.channel.send({ embeds: [mkError('Self-React Detected', `<@${user.id}> has been jailed for 10 minutes for reacting to their own message.`)] });
    }
  } catch (err) {}
}

async function handleReaction(message, command, args) {
  if (command === 'reaction' && args[0]?.toLowerCase() === 'add') {
    return handleReactionAddCmd(message, args.slice(1));
  }
  if (command === 'reaction' && args[0]?.toLowerCase() === 'remove') {
    return handleReactionRemove(message, args.slice(1));
  }
  if (command === 'reaction' && args[0]?.toLowerCase() === 'removeall') {
    return handleReactionRemoveAll(message, args.slice(1));
  }
  if (command === 'reaction' && args[0]?.toLowerCase() === 'delete') {
    return handleReactionRemove(message, args.slice(1));
  }
  if (command === 'reaction' && args[0]?.toLowerCase() === 'deleteall') {
    return handleReactionRemoveAll(message, args.slice(1));
  }
  if (command === 'reaction' && args[0]?.toLowerCase() === 'list') {
    return handleReactionList(message);
  }
  if (command === 'reaction' && args[0]?.toLowerCase() === 'clear') {
    return handleReactionClear(message);
  }
  if (command === 'reaction' && args[0]?.toLowerCase() === 'owner') {
    return handleReactionOwner(message, args.slice(1));
  }
  if (command === 'reaction' && args[0]?.toLowerCase() === 'messages' && args[1]?.toLowerCase() === 'list') {
    return handleReactionMessagesList(message);
  }
  if (command === 'reaction' && args[0]?.toLowerCase() === 'messages') {
    return handleReactionMessages(message, args.slice(1));
  }
  if (command === 'reaction') {
    return handleReactionCommand(message, args);
  }
  if (command === 'previousreact' && args[0]?.toLowerCase() === 'add') {
    return handlePreviousReactAdd(message, args.slice(1));
  }
  if (command === 'previousreact' && args[0]?.toLowerCase() === 'remove') {
    return handlePreviousReactRemove(message, args.slice(1));
  }
  if (command === 'previousreact' && args[0]?.toLowerCase() === 'delete') {
    return handlePreviousReactRemove(message, args.slice(1));
  }
  if (command === 'previousreact' && args[0]?.toLowerCase() === 'removeall') {
    return handlePreviousReactRemoveAll(message, args.slice(1));
  }
  if (command === 'previousreact' && args[0]?.toLowerCase() === 'deleteall') {
    return handlePreviousReactRemoveAll(message, args.slice(1));
  }
  if (command === 'previousreact' && args[0]?.toLowerCase() === 'list') {
    return handlePreviousReactList(message);
  }
  if (command === 'previousreact' && args[0]?.toLowerCase() === 'clear') {
    return handlePreviousReactClear(message);
  }
  if (command === 'previousreact' && args[0]?.toLowerCase() === 'owner') {
    return handlePreviousReactOwner(message, args.slice(1));
  }
  if (command === 'previousreact') {
    return handlePreviousReactList(message);
  }
  if (command === 'noselfreact') {
    return handleNoSelfReact(message, args);
  }
}

module.exports = {
  handleReaction,
  onMessageCreate,
  onReactionAdd,
};