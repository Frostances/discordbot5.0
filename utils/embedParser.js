/**
 * embedParser.js — Unified Embed + Button Parser
 *
 * Parses embed scripts used by: customembed, invoke, welcome, goodbye, boosts, level-up
 *
 * Format:
 *   {embed}$v{message: text}$v{title: text}$v{description: text}$v{color: hex}
 *   $v{thumbnail: url}$v{image: url}$v{footer: text && iconUrl}$v{author: name && iconUrl && url}
 *   $v{field: Name && Value && inline}$v{timestamp}$v{url: https://...}
 *   $v{button: url && label && emoji && enabled|disabled}
 *
 * Button format:
 *   - If first part starts with 'http' → Link button, url=first part
 *   - If first part is empty → Secondary button (no link)
 *   - label = second part
 *   - emoji = third part (custom :name: or Unicode)
 *   - state = fourth part (enabled/disabled)
 *
 * Returns: { content?: string, embeds: EmbedBuilder[], components: ActionRowBuilder[] }
 */

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

// ══════════════════════════════════════════════════════════
// VARIABLE SUBSTITUTION
// ══════════════════════════════════════════════════════════
function substituteVars(str, vars) {
  if (!str || typeof str !== 'string') return str;
  return str.replace(/\{[^{}]+\}/g, (match) => {
    return vars[match] !== undefined ? vars[match] : match;
  });
}

// ══════════════════════════════════════════════════════════
// RESOLVE EMOJI
// Tries to resolve :name: format or returns as-is
// ══════════════════════════════════════════════════════════
function resolveEmoji(emojiStr, guild) {
  if (!emojiStr) return null;
  const trimmed = emojiStr.trim();

  // Already in Discord format <:name:id> or <a:name:id>
  if (trimmed.startsWith('<:') || trimmed.startsWith('<a:')) {
    const match = trimmed.match(/<(a?):(\w+):(\d+)>/);
    if (match) {
      return { animated: match[1] === 'a', name: match[2], id: match[3] };
    }
    return trimmed;
  }

  // Unicode emoji (single grapheme cluster)
  if ([...trimmed].length === 1 && !trimmed.startsWith(':')) {
    return trimmed;
  }

  // :name: format — try to resolve from guild
  if (trimmed.startsWith(':') && trimmed.endsWith(':')) {
    const name = trimmed.slice(1, -1);
    if (guild) {
      const emoji = guild.emojis.cache.find(e => e.name === name);
      if (emoji) return { id: emoji.id, name: emoji.name, animated: emoji.animated };
    }
    // Can't resolve — return null so button works without emoji
    return null;
  }

  // Raw string — might be Unicode or already resolved
  return trimmed;
}

// ══════════════════════════════════════════════════════════
// PARSE EMBED CODE
// ══════════════════════════════════════════════════════════
function parseEmbedCode(raw, vars = {}, guild = null) {
  const str = substituteVars(raw?.trim?.() || raw || '', vars);

  // Plain text: no embed prefix
  if (!str.startsWith('{embed}')) {
    return { content: str || null, embeds: [], components: [] };
  }

  const parts = str.split('$v').map(p => p.trim()).filter(Boolean);
  const embed = new EmbedBuilder();
  let content = null;
  const components = [];
  const buttons = [];

  for (const part of parts) {
    if (part === '{embed}') continue;
    if (!part.startsWith('{') || !part.endsWith('}')) continue;

    const inner = part.slice(1, -1);
    const colon = inner.indexOf(':');

    // Handle {timestamp} with no colon
    if (colon === -1) {
      if (inner.trim().toLowerCase() === 'timestamp') {
        embed.setTimestamp();
      }
      continue;
    }

    const key = inner.slice(0, colon).trim().toLowerCase();
    const value = inner.slice(colon + 1).trim();

    switch (key) {
      case 'message':
      case 'content':
        content = value || null;
        break;

      case 'color':
        try {
          const colorVal = value.startsWith('#') ? value : '#' + value;
          embed.setColor(colorVal);
        } catch {}
        break;

      case 'thumbnail':
        if (value.startsWith('http')) embed.setThumbnail(value);
        break;

      case 'image':
        if (value.startsWith('http')) embed.setImage(value);
        break;

      case 'title':
        embed.setTitle(value.slice(0, 256));
        break;

      case 'description':
        embed.setDescription(value.slice(0, 4096));
        break;

      case 'url':
        if (value.startsWith('http')) embed.setURL(value);
        break;

      case 'timestamp':
        embed.setTimestamp();
        break;

      case 'footer': {
        const sep = value.includes('&&') ? '&&' : '|';
        const fparts = value.split(sep).map(s => s.trim());
        const [ftext, ficon] = fparts;
        const footerOpts = { text: (ftext || '\u200b').slice(0, 2048) };
        if (ficon?.startsWith('http')) footerOpts.iconURL = ficon;
        try { embed.setFooter(footerOpts); } catch {}
        break;
      }

      case 'author': {
        const sep = value.includes('&&') ? '&&' : '|';
        const aparts = value.split(sep).map(s => s.trim());
        const [aname, aicon, aurl] = aparts;
        const authorOpts = { name: (aname || 'Author').slice(0, 256) };
        if (aicon?.startsWith('http')) authorOpts.iconURL = aicon;
        if (aurl?.startsWith('http')) authorOpts.url = aurl;
        try { embed.setAuthor(authorOpts); } catch {}
        break;
      }

      case 'field': {
        const fparts2 = value.split('&&').map(s => s.trim());
        let fname = fparts2[0] || '';
        let fvalue = fparts2[1] || '';
        let finline = fparts2[2] || '';
        const inlineTruthy = ['true', 'inline', 'yes', '1', 'on'];
        // If no explicit inline flag, check if value ends with an inline keyword
        if (!finline && fvalue) {
          const words = fvalue.split(/\s+/);
          const lastWord = words[words.length - 1]?.toLowerCase();
          if (inlineTruthy.includes(lastWord)) {
            finline = lastWord;
            fvalue = words.slice(0, -1).join(' ');
          }
        }
        if (fname) {
          try {
            const isInline = finline ? inlineTruthy.includes(finline.toLowerCase()) : false;
            embed.addFields({
              name: fname.slice(0, 256),
              value: fvalue.slice(0, 1024),
              inline: isInline,
            });
          } catch (e) { console.error('[EMBED] Field parse error:', e); }
        }
        break;
      }

      case 'button': {
        // {button: url && label && emoji && state}
        // {button: style && label && url && state}  (legacy compat)
        const bparts = value.split('&&').map(s => s.trim());

        let url = '';
        let label = '';
        let emoji = '';
        let state = 'enabled';
        let bstyle = ButtonStyle.Secondary;

        if (bparts.length >= 2) {
          const first = bparts[0];
          const second = bparts[1];
          const third = bparts[2] || '';
          const fourth = bparts[3] || '';

          // Detect format
          const knownStyles = ['link', 'blurple', 'blue', 'primary', 'green', 'success', 'grey', 'gray', 'secondary', 'red', 'danger'];
          const isKnownStyle = knownStyles.includes(first.toLowerCase());
          const isUrl = first.startsWith('http');

          if (isUrl) {
            // Format: url && label && emoji && state
            url = first;
            label = second;
            emoji = third;
            state = fourth || 'enabled';
            bstyle = ButtonStyle.Link;
          } else if (isKnownStyle) {
            // Legacy format: style && label && url && state
            const styleMap = {
              link: ButtonStyle.Link,
              blurple: ButtonStyle.Primary, blue: ButtonStyle.Primary, primary: ButtonStyle.Primary,
              green: ButtonStyle.Success, success: ButtonStyle.Success,
              grey: ButtonStyle.Secondary, gray: ButtonStyle.Secondary, secondary: ButtonStyle.Secondary,
              red: ButtonStyle.Danger, danger: ButtonStyle.Danger,
            };
            bstyle = styleMap[first.toLowerCase()] || ButtonStyle.Link;
            label = second;
            url = third;
            state = fourth || 'enabled';
          } else if (!first) {
            // Empty first part: non-link button
            // Format:  && label && emoji && state
            label = second;
            emoji = third;
            state = fourth || 'enabled';
            bstyle = ButtonStyle.Secondary;
          } else {
            // Unknown first part — treat as URL (might be a link)
            url = first;
            label = second;
            emoji = third;
            state = fourth || 'enabled';
            bstyle = ButtonStyle.Link;
          }
        }

        if (!label) continue;

        const disabled = state.toLowerCase() === 'disabled';
        const btn = new ButtonBuilder()
          .setStyle(bstyle)
          .setLabel(label.slice(0, 80))
          .setDisabled(disabled);

        if (bstyle === ButtonStyle.Link) {
          if (url?.startsWith('http')) {
            btn.setURL(url);
          } else {
            // Link button needs a URL — skip if none
            continue;
          }
        } else {
          // Non-link button needs customId
          const safeLabel = label.slice(0, 20).replace(/\W/g, '_');
          btn.setCustomId('ce_btn_' + safeLabel + '_' + Math.random().toString(36).slice(2, 7));
        }

        // Set emoji if provided
        const resolvedEmoji = resolveEmoji(emoji, guild);
        if (resolvedEmoji) {
          try {
            if (typeof resolvedEmoji === 'string') {
              btn.setEmoji(resolvedEmoji);
            } else {
              btn.setEmoji(resolvedEmoji);
            }
          } catch {}
        }

        buttons.push(btn);
        break;
      }
    }
  }

  // Pack buttons into rows (max 5 per row, max 5 rows = 25 buttons)
  for (let i = 0; i < buttons.length && i < 25; i += 5) {
    components.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
  }

  const embeds = [];
  // Only include embed if it has any data set
  const embedData = embed.data;
  if (embedData && (embedData.title || embedData.description || embedData.color || embedData.thumbnail || embedData.image || embedData.footer || embedData.author || embedData.fields?.length || embedData.timestamp || embedData.url)) {
    embeds.push(embed);
  }

  return { content, embeds, components };
}

// ══════════════════════════════════════════════════════════
// PARSE INVOKE MESSAGE (for invoke system)
// Same as parseEmbedCode but with invoke-specific variable replacement
// ══════════════════════════════════════════════════════════
function replaceInvokeVars(template, vars) {
  if (!template) return template;
  let result = template;

  result = result.replace(/{user\.mention}/gi, vars.userMention || vars.targetMention || '{user.mention}');
  result = result.replace(/{user\.name}/gi, vars.userName || vars.targetName || '{user.name}');
  result = result.replace(/{user\.id}/gi, vars.userId || vars.targetId || '{user.id}');
  result = result.replace(/{user\.avatar}/gi, vars.userAvatar || vars.targetAvatar || '');

  result = result.replace(/{target\.mention}/gi, vars.targetMention || vars.userMention || '{target.mention}');
  result = result.replace(/{target\.name}/gi, vars.targetName || vars.userName || '{target.name}');
  result = result.replace(/{target\.id}/gi, vars.targetId || vars.userId || '{target.id}');
  result = result.replace(/{target\.avatar}/gi, vars.targetAvatar || vars.userAvatar || '');

  const modMention = vars.modMention || vars.moderatorMention || '{mod.mention}';
  const modName = vars.modName || vars.moderatorName || '{mod.name}';
  const modId = vars.modId || vars.moderatorId || '{mod.id}';
  const modIcon = vars.modIcon || vars.moderatorIcon || vars.modAvatar || vars.moderatorAvatar || '';

  result = result.replace(/{mod\.mention}/gi, modMention);
  result = result.replace(/{moderator\.mention}/gi, modMention);
  result = result.replace(/{mod\.name}/gi, modName);
  result = result.replace(/{moderator\.name}/gi, modName);
  result = result.replace(/{mod\.id}/gi, modId);
  result = result.replace(/{moderator\.id}/gi, modId);
  result = result.replace(/{mod\.icon}/gi, modIcon);
  result = result.replace(/{moderator\.icon}/gi, modIcon);
  result = result.replace(/{mod\.avatar}/gi, modIcon);
  result = result.replace(/{moderator\.avatar}/gi, modIcon);

  result = result.replace(/{guild\.name}/gi, vars.guildName || '{guild.name}');
  result = result.replace(/{guild\.id}/gi, vars.guildId || '{guild.id}');
  result = result.replace(/{guild\.icon}/gi, vars.guildIcon || '');
  result = result.replace(/{guild\.count}/gi, vars.guildCount || '{guild.count}');

  result = result.replace(/{reason}/gi, vars.reason || 'No reason provided');
  result = result.replace(/{case\.id}/gi, vars.caseId || '{case.id}');
  result = result.replace(/{duration}/gi, vars.duration || '');
  result = result.replace(/{timestamp}/gi, '');

  return result;
}

function parseInvokeMessage(raw, vars, guild) {
  const text = replaceInvokeVars(raw, vars);
  return parseEmbedCode(text, {}, guild);
}

// ══════════════════════════════════════════════════════════
// BUILD VARS (for welcome/goodbye/boosts/level-up)
// ══════════════════════════════════════════════════════════
function buildWelcomeVars(member, extra = {}) {
  const user = member.user ?? member;
  const guild = member.guild ?? null;
  const memberObj = guild ? member : null;

  let joinPos = '?';
  try {
    if (guild) {
      const sorted = guild.members.cache
        .filter(m => m.joinedTimestamp)
        .sort((a, b) => a.joinedTimestamp - b.joinedTimestamp);
      const idx = sorted.findIndex(m => m.id === user.id);
      if (idx !== -1) joinPos = String(idx + 1);
    }
  } catch {}

  const topRoleObj = memberObj?.roles.cache
    .filter(r => r.id !== guild?.id)
    .sort((a, b) => b.position - a.position)
    .first() ?? null;

  const topRole = topRoleObj ? '<@&' + topRoleObj.id + '>' : 'N/A';
  const topRoleName = topRoleObj?.name ?? 'N/A';
  const userColor = topRoleObj?.hexColor ?? '#000000';

  const sortedRoles = memberObj?.roles.cache
    .filter(r => r.id !== guild?.id)
    .sort((a, b) => b.position - a.position) ?? { map: () => [] };

  const roleList = [...(sortedRoles.values?.() ?? [])].map(r => '<@&' + r.id + '>').join(', ') || 'N/A';
  const roleTextList = [...(sortedRoles.values?.() ?? [])].map(r => r.name).join(', ') || 'N/A';

  const now = new Date();
  const pad = n => String(n).padStart(2, '0');

  const utcD = now.getUTCFullYear() + '-' + pad(now.getUTCMonth() + 1) + '-' + pad(now.getUTCDate());
  const utcT24 = pad(now.getUTCHours()) + ':' + pad(now.getUTCMinutes()) + ':' + pad(now.getUTCSeconds());

  const pstD = now.toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' });
  const pstT12 = now.toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit' });

  const unixNow = Math.floor(now.getTime() / 1000).toString();

  const textChCount = guild?.channels.cache.filter(c => c.type === 0).size ?? 0;
  const voiceChCount = guild?.channels.cache.filter(c => c.type === 2).size ?? 0;

  function ordinal(n) {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  const vars = {
    '{user}': user.discriminator && user.discriminator !== '0'
      ? user.username + '#' + user.discriminator
      : user.username,
    '{user.id}': user.id,
    '{user.mention}': '<@' + user.id + '>',
    '{user.name}': user.username,
    '{user.username}': user.username,
    '{user.tag}': user.discriminator && user.discriminator !== '0' ? user.discriminator : '0',
    '{user.display_name}': memberObj?.displayName ?? user.displayName ?? user.username,
    '{user.avatar}': user.displayAvatarURL?.({ size: 256, extension: 'png' }) ?? '',
    '{user.guild_avatar}': memberObj?.avatarURL?.({ size: 256, extension: 'png' }) ?? user.displayAvatarURL?.({ size: 256, extension: 'png' }) ?? '',
    '{user.display_avatar}': memberObj?.displayAvatarURL?.({ size: 256, extension: 'png' }) ?? user.displayAvatarURL?.({ size: 256, extension: 'png' }) ?? '',
    '{user.join_position}': joinPos,
    '{user.join_position_suffix}': ordinal(parseInt(joinPos) || 0),
    '{user.boost}': memberObj?.premiumSince ? 'Yes' : 'No',
    '{user.boost_since}': memberObj?.premiumSince ? '<t:' + Math.floor(memberObj.premiumSinceTimestamp / 1000) + ':R>' : 'N/A',
    '{user.boost_since_timestamp}': memberObj?.premiumSinceTimestamp ? Math.floor(memberObj.premiumSinceTimestamp / 1000).toString() : 'N/A',
    '{user.color}': userColor,
    '{user.top_role}': topRole,
    '{user.role_list}': roleList,
    '{user.role_text_list}': roleTextList,
    '{user.bot}': user.bot ? 'Yes' : 'No',
    '{user.badges}': 'N/A',
    '{user.badges_icons}': 'N/A',
    '{user.created_at}': '<t:' + Math.floor(user.createdTimestamp / 1000) + ':R>',
    '{user.created_at_timestamp}': Math.floor(user.createdTimestamp / 1000).toString(),
    '{user.joined_at}': memberObj?.joinedTimestamp ? '<t:' + Math.floor(memberObj.joinedTimestamp / 1000) + ':R>' : 'N/A',
    '{user.joined_at_timestamp}': memberObj?.joinedTimestamp ? Math.floor(memberObj.joinedTimestamp / 1000).toString() : 'N/A',

    '{guild.name}': guild?.name ?? '',
    '{guild.id}': guild?.id ?? '',
    '{guild.count}': (guild?.memberCount ?? 0).toString(),
    '{guild.members}': (guild?.memberCount ?? 0).toString(),
    '{guild.shard}': (guild?.shardId ?? 0).toString(),
    '{guild.owner_id}': guild?.ownerId ?? 'N/A',
    '{guild.created_at}': guild ? '<t:' + Math.floor(guild.createdTimestamp / 1000) + ':R>' : 'N/A',
    '{guild.created_at_timestamp}': guild ? Math.floor(guild.createdTimestamp / 1000).toString() : 'N/A',
    '{guild.emoji_count}': (guild?.emojis.cache.size ?? 0).toString(),
    '{guild.role_count}': (guild?.roles.cache.size ?? 0).toString(),
    '{guild.roles_count}': (guild?.roles.cache.size ?? 0).toString(),
    '{guild.boost_count}': (guild?.premiumSubscriptionCount ?? 0).toString(),
    '{guild.boost_tier}': guild?.premiumTier ? 'Level ' + guild.premiumTier : 'No Level',
    '{guild.preferred_locale}': guild?.preferredLocale ?? 'en-US',
    '{guild.key_features}': guild?.features?.length ? guild.features.join(', ') : 'N/A',
    '{guild.icon}': guild?.iconURL({ size: 256, extension: 'png' }) ?? 'N/A',
    '{guild.banner}': guild?.bannerURL({ size: 1024 }) ?? 'N/A',
    '{guild.splash}': guild?.splashURL({ size: 1024 }) ?? 'N/A',
    '{guild.discovery}': guild?.discoverySplashURL?.({ size: 1024 }) ?? 'N/A',
    '{guild.vanity}': guild?.vanityURLCode ? 'discord.gg/' + guild.vanityURLCode : 'None',
    '{guild.max_presences}': (guild?.maximumPresences ?? 0).toString(),
    '{guild.max_members}': (guild?.maximumMembers ?? 0).toString(),
    '{guild.max_video_channel_users}': (guild?.maxVideoChannelUsers ?? 0).toString(),
    '{guild.afk_timeout}': (guild?.afkTimeout ?? 0).toString(),
    '{guild.afk_channel}': guild?.afkChannelId ? '<#' + guild.afkChannelId + '>' : 'N/A',
    '{guild.channels_count}': (guild?.channels.cache.size ?? 0).toString(),
    '{guild.text_channels_count}': textChCount.toString(),
    '{guild.voice_channels_count}': voiceChCount.toString(),
    '{guild.category_channels_count}': (guild?.channels.cache.filter(c => c.type === 4).size ?? 0).toString(),
    '{guild.region}': 'N/A',

    '{date.now}': pstD,
    '{date.now_proper}': now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }),
    '{date.now_short}': pstD,
    '{date.utc_now}': utcD + ' ' + utcT24 + ' UTC',
    '{date.utc_now_proper}': now.toUTCString(),
    '{date.utc_now_short}': utcD,
    '{date.utc_timestamp}': unixNow,

    '{time.now}': pstT12,
    '{time.now_military}': now.toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    '{time.utc_now}': now.toLocaleTimeString('en-US', { timeZone: 'UTC', hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    '{time.utc_now_military}': utcT24,

    '{level}': '0',
    '{level.new_rank}': '0',
    '{level.user_xp}': '0',
    '{boost.count}': memberObj?.premiumSince ? '1' : '0',

    ...extra,
  };

  return vars;
}

function buildChannelVars(channel) {
  if (!channel) return {};
  return {
    '{channel.name}': channel.name,
    '{channel.id}': channel.id,
    '{channel.mention}': '<#' + channel.id + '>',
    '{channel.topic}': channel.topic || 'N/A',
    '{channel.type}': channel.type === 0 ? 'text' : channel.type === 5 ? 'news' : channel.type === 2 ? 'voice' : 'unknown',
    '{channel.category_id}': channel.parentId ?? 'N/A',
    '{channel.category_name}': channel.parent?.name ?? 'N/A',
    '{channel.position}': channel.position?.toString() ?? 'N/A',
    '{channel.slowmode_delay}': (channel.rateLimitPerUser ?? 0).toString(),
  };
}

module.exports = {
  parseEmbedCode,
  parseInvokeMessage,
  substituteVars,
  resolveEmoji,
  buildWelcomeVars,
  buildChannelVars,
};