/**
 * Interactive command guide.
 *
 * This module owns only the help UI. Commands are flattened into individual
 * browseable entries here; command dispatch and the command registry remain
 * unchanged.
 */

const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
} = require('discord.js');
const { getAll } = require('../handlers/commandRegistry');
const { COLORS } = require('../utils/embeds');

const TIMEOUT = 120_000;
const SMALL_CATEGORY_LIMIT = 2;

const CATEGORY_META = {
    moderation:  { emoji: '🔨', label: 'Moderation' },
    security:    { emoji: '🛡️', label: 'Security' },
    staff:       { emoji: '👮', label: 'Staff' },
    levels:      { emoji: '📊', label: 'Levels' },
    tickets:     { emoji: '🎫', label: 'Tickets' },
    voicemaster: { emoji: '🎙️', label: 'Voice' },
    config:      { emoji: '⚙️', label: 'Config' },
    info:        { emoji: '🔍', label: 'Info' },
    fun:         { emoji: '🎮', label: 'Fun' },
    utility:     { emoji: '🔧', label: 'Utility' },
    reaction:    { emoji: '👍', label: 'Reaction' },
    filter:      { emoji: '🧹', label: 'Filter' },
};

// The old server-management module had a separate autoresponder guide. Keep
// its useful command metadata in this UI as one ordinary help command instead.
const AUTORESPONDER_COMMAND = {
    name: 'autoresponder',
    aliases: ['ar'],
    category: 'utility',
    staffOnly: false,
    description: 'Create and manage automatic responses to trigger phrases.',
    usage: 'autoresponder <action>',
    examples: [',autoresponder add hey-- hello there'],
    subcommands: [
        {
            name: 'add',
            description: 'Create an automatic response for a trigger phrase.',
            aliases: ['ar add'],
            parameters: '<trigger>-- <response> [--include] [--reply]',
            example: ',autoresponder add hey-- hello there',
        },
        {
            name: 'remove',
            description: 'Remove one automatic response.',
            aliases: ['ar remove'],
            parameters: '<trigger>',
            example: ',autoresponder remove hey',
        },
        {
            name: 'update',
            description: 'Replace the response or flags for an existing trigger.',
            aliases: ['ar update'],
            parameters: '<trigger>-- <response> [--include] [--reply]',
            example: ',autoresponder update hey-- hi again',
        },
        {
            name: 'list',
            description: 'View all automatic responses configured in this server.',
            aliases: ['ar list'],
            parameters: 'none',
            example: ',autoresponder list',
        },
        {
            name: 'role add',
            description: 'Add a role when a trigger is used.',
            aliases: ['ar role add'],
            parameters: '<@role> <trigger>',
            example: ',autoresponder role add @Member hey',
        },
        {
            name: 'role remove',
            description: 'Remove a role action from a trigger.',
            aliases: ['ar role remove'],
            parameters: '<@role> <trigger>',
            example: ',autoresponder role remove @Member hey',
        },
        {
            name: 'exclusive',
            description: 'Limit a trigger to one role or channel.',
            aliases: ['ar exclusive'],
            parameters: '<@role|#channel> <trigger>',
            example: ',autoresponder exclusive #welcome hey',
        },
        {
            name: 'reset',
            description: 'Delete every automatic response in this server.',
            aliases: ['ar reset'],
            parameters: 'none',
            example: ',autoresponder reset',
        },
        {
            name: 'variables',
            description: 'View variables available inside automatic responses.',
            aliases: ['ar variables'],
            parameters: 'none',
            example: ',autoresponder variables',
        },
    ],
};

function titleCase(value) {
    return String(value || '')
        .replace(/[_-]+/g, ' ')
        .replace(/\b\w/g, char => char.toUpperCase());
}

function categoryLabel(category) {
    return CATEGORY_META[category]?.label ?? titleCase(category);
}

function categoryEmoji(category) {
    return CATEGORY_META[category]?.emoji ?? '📚';
}

function clip(value, length = 100) {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();
    return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

function applyPrefix(value, prefix) {
    return String(value || '').replace(/^[,.]/, prefix);
}

function stripPrefix(value) {
    return String(value || '').trim().replace(/^[,.!]/, '').toLowerCase();
}

function commandCount(commands) {
    return commands.reduce((total, command) => total + 1 + (command.subcommands?.length || 0), 0);
}

function commandParams(def) {
    if (!def.usage) return 'n/a';
    const usage = String(def.usage).trim();
    const fullName = def.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const fullCommand = new RegExp(`^[,.]?${fullName}(?:\\s+|$)`, 'i');
    const params = fullCommand.test(usage)
        ? usage.replace(fullCommand, '').trim()
        : usage.replace(/^[,.]?\S+\s*/, '').trim();
    return params || 'n/a';
}

function commandSyntax(def, prefix, extra = '') {
    const params = commandParams(def);
    const base = `${prefix}${def.name}${params !== 'n/a' ? ` ${params}` : ''}`;
    return `${base}${extra ? ` ${extra}` : ''}`;
}

function normalizeSubcommand(def, subcommand, prefix) {
    const isObject = typeof subcommand === 'object' && subcommand !== null;
    let usage = String(isObject ? subcommand.name : subcommand || '').trim();
    let description = isObject ? (subcommand.description || '') : '';

    if (!description) {
        const separator = usage.match(/\s+[—–-]\s+/);
        if (separator) {
            const parts = usage.split(separator[0]);
            usage = parts.shift().trim();
            description = parts.join(separator[0]).trim();
        }
    }

    usage = usage.replace(/^[,.]/, '');
    const commandName = def.name.toLowerCase();
    if (usage.toLowerCase().startsWith(`${commandName} `)) {
        usage = usage.slice(def.name.length).trim();
    } else if (usage.toLowerCase() === commandName) {
        usage = '';
    }

    // Some compound registry commands repeat their final action in the
    // subcommand metadata, e.g. "ticket support" + "support add".
    const parentAction = def.name.split(/\s+/).pop().toLowerCase();
    if (usage.toLowerCase().startsWith(`${parentAction} `)) {
        usage = usage.slice(parentAction.length).trim();
    }

    const parameters = isObject && subcommand.parameters
        ? subcommand.parameters
        : usage.match(/(<[^>]+>|\[[^\]]+\]|\|)+/g)?.join(' ') || 'n/a';

    return {
        usage,
        description: description || `Run the ${usage || 'default'} action for this command.`,
        aliases: isObject && subcommand.aliases
            ? Array.isArray(subcommand.aliases) ? subcommand.aliases : [subcommand.aliases]
            : [],
        parameters,
        example: isObject && subcommand.example
            ? subcommand.example
            : `${prefix}${def.name}${usage ? ` ${usage}` : ''}`,
        syntax: `${prefix}${def.name}${usage ? ` ${usage}` : ''}`,
    };
}

function getHelpCommands() {
    const commands = getAll().filter(command => !command.hidden);
    if (!commands.some(command => command.name === AUTORESPONDER_COMMAND.name)) {
        commands.push(AUTORESPONDER_COMMAND);
    }
    return commands;
}

/**
 * Each category keeps a flattened `entries` list. A category with 18 normal
 * and nested commands therefore has 18 pages and displays "18 commands".
 */
function buildCategoryCatalog(commands, prefix) {
    const sourceCategories = new Map();
    for (const command of commands) {
        if (!sourceCategories.has(command.category)) sourceCategories.set(command.category, []);
        sourceCategories.get(command.category).push(command);
    }

    const catalog = [];
    const miscCommands = [];
    const miscSources = [];

    for (const [category, categoryCommands] of sourceCategories) {
        if (categoryCommands.length <= SMALL_CATEGORY_LIMIT) {
            miscCommands.push(...categoryCommands);
            miscSources.push(category);
            continue;
        }
        catalog.push(makeCategory(category, categoryCommands, [category], prefix));
    }

    if (miscCommands.length) {
        catalog.push(makeCategory('misc', miscCommands, miscSources, prefix));
    }
    return catalog;
}

function makeCategory(key, commands, sourceCategories, prefix) {
    const entries = [];
    for (const def of commands) {
        entries.push({
            def,
            subcommand: null,
            searchText: [def.name, ...(def.aliases || [])].join(' ').toLowerCase(),
        });
        for (const subcommand of def.subcommands || []) {
            const normalized = normalizeSubcommand(def, subcommand, prefix);
            entries.push({
                def,
                subcommand: normalized,
                searchText: [
                    def.name,
                    normalized.usage,
                    normalized.syntax,
                    ...normalized.aliases,
                    normalized.description,
                ].join(' ').toLowerCase(),
            });
        }
    }
    return {
        key,
        label: key === 'misc' ? 'Misc' : categoryLabel(key),
        emoji: key === 'misc' ? '📦' : categoryEmoji(key),
        commands,
        entries,
        total: entries.length,
        sourceCategories,
    };
}

function findCategory(catalog, query) {
    const normalized = stripPrefix(query);
    return catalog.find(category =>
        category.key.toLowerCase() === normalized ||
        category.label.toLowerCase() === normalized ||
        category.sourceCategories.some(source => source.toLowerCase() === normalized) ||
        category.entries.some(entry => entry.def.name.toLowerCase() === normalized ||
            entry.def.name.toLowerCase().startsWith(`${normalized} `)),
    );
}

function findEntry(catalog, query) {
    const normalized = stripPrefix(query);
    let fuzzy = null;
    for (const category of catalog) {
        for (const [index, entry] of category.entries.entries()) {
            const exact = entry.searchText.split(/\s+/).includes(normalized) ||
                entry.def.name.toLowerCase() === normalized ||
                entry.subcommand?.syntax.toLowerCase().replace(/^[,.]/, '') === normalized ||
                `${entry.def.name} ${entry.subcommand?.usage || ''}`.trim().toLowerCase() === normalized;
            if (exact) return { category, index, entry };
            if (!fuzzy && entry.searchText.includes(normalized)) fuzzy = { category, index, entry };
        }
    }
    return fuzzy;
}

function findHelpTarget(catalog, query) {
    const entry = findEntry(catalog, query);
    if (entry) return entry;
    const category = findCategory(catalog, query);
    if (!category) return null;
    const normalized = stripPrefix(query);
    const index = category.entries.findIndex(item =>
        item.def.name.toLowerCase() === normalized ||
        item.def.name.toLowerCase().startsWith(`${normalized} `),
    );
    return { category, index: index >= 0 ? index : 0, entry: category.entries[index >= 0 ? index : 0] };
}

function shouldShowHelpForCommand(query, prefix = ',') {
    const catalog = buildCategoryCatalog(getHelpCommands(), prefix);
    const target = findHelpTarget(catalog, query);
    if (!target) return false;
    const normalized = stripPrefix(query);
    const isNamedCategory = catalog.some(category =>
        category.key.toLowerCase() === normalized ||
        category.label.toLowerCase() === normalized ||
        category.sourceCategories.some(source => source.toLowerCase() === normalized),
    );
    const isExactCommand = target.entry &&
        (target.entry.def.name.toLowerCase() === normalized ||
            (target.entry.def.aliases || []).some(alias => alias.toLowerCase() === normalized));
    const isCommandGroup = !isNamedCategory && !isExactCommand &&
        target.category.entries.some(entry => entry.def.name.toLowerCase().startsWith(`${normalized} `));
    return isNamedCategory || isCommandGroup || Boolean(target.entry.def.subcommands?.length);
}

function commandAliases(entry, prefix) {
    const aliases = entry.subcommand?.aliases?.length
        ? entry.subcommand.aliases
        : entry.def.aliases || [];
    return aliases.length ? aliases.map(alias => `${prefix}${alias}`).join(', ') : 'n/a';
}

function buildHomeEmbed(invoker) {
    return new EmbedBuilder()
        .setColor(COLORS.primary)
        .setAuthor({
            name: invoker.displayName ?? invoker.username,
            iconURL: invoker.displayAvatarURL?.({ size: 64 }),
        })
        .setTitle('📚 Command Guide')
        .setDescription('Choose a category below or search for a command. Commands and subcommands are browsed one page at a time.');
}

function buildCommandEmbed({ entry, page, pageCount, category, invoker, prefix }) {
    const { def, subcommand } = entry;
    const syntax = subcommand?.syntax || commandSyntax(def, prefix);
    const parameters = subcommand?.parameters || commandParams(def);
    const example = applyPrefix(subcommand?.example || def.examples?.[0] || syntax, prefix);
    const description = subcommand
        ? subcommand.description
        : (def.description || 'No description available.');

    return new EmbedBuilder()
        .setColor(COLORS.primary)
        .setAuthor({
            name: invoker.displayName ?? invoker.username,
            iconURL: invoker.displayAvatarURL?.({ size: 64 }),
        })
        .setTitle(`${category.emoji} ${syntax}`)
        .setDescription(description)
        .addFields(
            { name: 'Aliases', value: commandAliases(entry, prefix), inline: true },
            { name: 'Parameters', value: parameters || 'n/a', inline: true },
            {
                name: 'Usage',
                value: `\`\`\`\nSyntax:  ${syntax}\nExample: ${example}\n\`\`\``,
                inline: false,
            },
        )
        .setFooter({ text: `Page ${page}/${pageCount} • Module: ${category.label}` });
}

function selectRow(customId, placeholder, options) {
    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(customId)
            .setPlaceholder(placeholder)
            .addOptions(options),
    );
}

function button(customId, label, style = ButtonStyle.Secondary, disabled = false) {
    return new ButtonBuilder()
        .setCustomId(customId)
        .setLabel(label)
        .setStyle(style)
        .setDisabled(disabled);
}

function navRow(page, pageCount) {
    return new ActionRowBuilder().addComponents(
        button('h_prev', 'Prev', ButtonStyle.Primary, page <= 1),
        button('h_next', 'Next', ButtonStyle.Primary, page >= pageCount),
        button('h_search', 'Search'),
        button('h_categories', 'Categories'),
        button('h_close', 'Close', ButtonStyle.Danger),
    );
}

function buildSearchModal(customId) {
    return new ModalBuilder()
        .setCustomId(customId)
        .setTitle('Search command guide')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('h_search_query')
                    .setLabel('Command, subcommand, or category')
                    .setPlaceholder('e.g. autoresponder add, moderation, antinuke')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setMaxLength(100),
            ),
        );
}

function homeComponents(catalog) {
    return [
        selectRow('h_category', 'Browse a command category', catalog.map(category => ({
            label: category.label,
            value: category.key,
            description: `${category.total} command${category.total === 1 ? '' : 's'} in this category`,
            emoji: category.emoji,
        }))),
        new ActionRowBuilder().addComponents(
            button('h_search', 'Search'),
            button('h_close', 'Close', ButtonStyle.Danger),
        ),
    ];
}

async function handleHelp(ctx, args, client, prefix = ',') {
    const isInteraction = !!ctx.deferReply;
    if (isInteraction) {
        try { await ctx.deferReply(); } catch {}
    }

    const invoker = isInteraction ? (ctx.member ?? ctx.user) : ctx.member;
    const authorId = isInteraction ? ctx.user.id : ctx.author.id;
    const allCommands = getHelpCommands();
    const catalog = buildCategoryCatalog(allCommands, prefix);
    const query = args.join(' ').trim();
    const target = query ? findHelpTarget(catalog, query) : null;

    if (query && !target) {
        const message = `<:warn:1528892150698348727> <@${authorId}>: No command or category matching \`${query}\` found.`;
        if (isInteraction) return ctx.editReply({ content: message });
        return ctx.channel.send({ content: message });
    }

    const state = {
        category: target?.category || null,
        page: target?.index || 0,
        mode: target ? 'category' : 'home',
    };

    const render = () => {
        if (state.mode === 'home') {
            return { embeds: [buildHomeEmbed(invoker)], components: homeComponents(catalog) };
        }

        const pageCount = state.category.entries.length;
        state.page = Math.min(Math.max(state.page, 0), pageCount - 1);
        return {
            embeds: [buildCommandEmbed({
                entry: state.category.entries[state.page],
                page: state.page + 1,
                pageCount,
                category: state.category,
                invoker,
                prefix,
            })],
            components: [navRow(state.page + 1, pageCount)],
        };
    };

    let sent;
    try {
        if (isInteraction) {
            await ctx.editReply(render());
            sent = await ctx.fetchReply().catch(() => null);
        } else {
            sent = await ctx.channel.send(render());
        }
    } catch {
        return;
    }
    if (!sent) return;

    const modalId = `h_search_${sent.id}`;
    const modalHandler = async interaction => {
        if (!interaction.isModalSubmit?.() || interaction.customId !== modalId || interaction.user.id !== authorId) return;
        const searchQuery = interaction.fields.getTextInputValue('h_search_query').trim();
        const searchTarget = findHelpTarget(catalog, searchQuery);
        if (!searchTarget) {
            return interaction.reply({
                content: `No command, subcommand, or category matching \`${searchQuery}\` was found.`,
                ephemeral: true,
            }).catch(() => {});
        }
        state.category = searchTarget.category;
        state.page = searchTarget.index;
        state.mode = 'category';
        return interaction.update(render()).catch(() => {});
    };
    client?.on('interactionCreate', modalHandler);

    const collector = sent.createMessageComponentCollector({
        time: TIMEOUT,
        filter: interaction => {
            if (interaction.user.id !== authorId) {
                interaction.reply({ content: '❌ This menu belongs to someone else.', ephemeral: true });
                return false;
            }
            return true;
        },
    });

    collector.on('collect', async interaction => {
        try {
            const id = interaction.customId;
            if (id === 'h_close') {
                collector.stop('closed');
                return interaction.message.delete().catch(() => interaction.update({ components: [] }));
            }
            if (id === 'h_search') {
                return interaction.showModal(buildSearchModal(modalId));
            }
            if (id === 'h_categories') {
                state.mode = 'home';
                state.category = null;
                state.page = 0;
            } else if (id === 'h_category') {
                state.category = catalog.find(category => category.key === interaction.values[0]);
                state.mode = state.category ? 'category' : 'home';
                state.page = 0;
            } else if (id === 'h_prev') {
                state.page = Math.max(0, state.page - 1);
            } else if (id === 'h_next') {
                state.page = Math.min(state.category.entries.length - 1, state.page + 1);
            }
            await interaction.update(render());
        } catch {}
    });

    collector.on('end', (_collected, reason) => {
        client?.off('interactionCreate', modalHandler);
        if (reason !== 'closed') sent.edit({ components: [] }).catch(() => {});
    });
}

module.exports = {
    handleHelp,
    shouldShowHelpForCommand,
};