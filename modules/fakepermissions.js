/**
 * fakepermissions.js — Fake Permission System
 * 
 * Fake permissions allow server owners to grant specific Discord permission
 * flags to roles WITHOUT giving them the actual Discord permission.
 * 
 * This prevents rogue moderators from using native Discord features
 * (like mass-banning via scripts) while still allowing them to use
 * bot commands that require those permissions.
 * 
 * Only the server owner can manage fake permissions.
 */

const { PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { getGuildDb } = require('./database');
const logger = require('../utils/logger');

// ══════════════════════════════════════════════════════════
// PERMISSION NAME MAP
// Maps human-readable names (snake_case) to Discord.js PermissionFlagsBits keys (PascalCase)
// ══════════════════════════════════════════════════════════
const PERMISSION_MAP = {
    // Moderation
    'ban_members': 'BanMembers',
    'kick_members': 'KickMembers',
    'moderate_members': 'ModerateMembers',
    'manage_nicknames': 'ManageNicknames',
    'manage_messages': 'ManageMessages',
    'manage_threads': 'ManageThreads',
    'read_message_history': 'ReadMessageHistory',
    'mention_everyone': 'MentionEveryone',
    'mention_here': 'MentionHere',

    // Channels
    'manage_channels': 'ManageChannels',
    'manage_roles': 'ManageRoles',
    'view_audit_log': 'ViewAuditLog',
    'view_guild_insights': 'ViewGuildInsights',

    // Voice
    'move_members': 'MoveMembers',
    'mute_members': 'MuteMembers',
    'deafen_members': 'DeafenMembers',
    'priority_speaker': 'PrioritySpeaker',

    // Server
    'manage_guild': 'ManageGuild',
    'manage_webhooks': 'ManageWebhooks',
    'manage_emojis_and_stickers': 'ManageEmojisAndStickers',
    'manage_events': 'ManageEvents',

    // Expressions
    'create_expressions': 'CreateGuildExpressions',
    'create_events': 'CreateEvents',

    // Misc
    'administrator': 'Administrator',
    'change_nickname': 'ChangeNickname',
};

// All valid fake permission names (snake_case)
const VALID_PERMISSIONS = Object.keys(PERMISSION_MAP);

// ══════════════════════════════════════════════════════════
// HELPER: Get fake permissions for a member
// Returns a Set of permission names the member has via fake perms
// ══════════════════════════════════════════════════════════
function getMemberFakePermissions(member) {
    if (!member || !member.guild) return new Set();
    const db = getGuildDb(member.guild.id);
    const fakePerms = db.get('fakePermissions', {}); // roleId -> [perm1, perm2, ...]

    const perms = new Set();
    for (const [roleId, rolePerms] of Object.entries(fakePerms)) {
        if (member.roles.cache.has(roleId)) {
            for (const p of rolePerms) {
                perms.add(p.toLowerCase());
            }
        }
    }
    return perms;
}

// ══════════════════════════════════════════════════════════
// HELPER: Check if member has a specific fake permission
// ══════════════════════════════════════════════════════════
function hasFakePermission(member, permissionName) {
    const perms = getMemberFakePermissions(member);
    const normalized = permissionName.toLowerCase().trim();

    // Administrator fake perm grants ALL fake perms
    if (perms.has('administrator')) return true;

    return perms.has(normalized);
}

// Alias for moderation.js compatibility
function hasFakePerm(member, permissionName) {
    return hasFakePermission(member, permissionName);
}

// ══════════════════════════════════════════════════════════
// HELPER: Check if member has a permission (fake OR real)
// This is the main function to use in command handlers
// ══════════════════════════════════════════════════════════
function hasPermission(member, permissionName) {
    if (!member) return false;

    // Check fake permission first
    if (hasFakePermission(member, permissionName)) return true;

    // Check real Discord permission
    const flagKey = PERMISSION_MAP[permissionName.toLowerCase()];
    if (flagKey && PermissionFlagsBits[flagKey]) {
        return member.permissions.has(PermissionFlagsBits[flagKey]);
    }

    return false;
}

// ══════════════════════════════════════════════════════════
// COMMAND HANDLER
// ══════════════════════════════════════════════════════════
async function handleFakePermissionsCommand(message, args) {
    const { isAdmin, isBotOwner } = require('./helpers');

    // Only server owner or bot owner can manage fake permissions
    if (!isBotOwner(message.author.id) && message.guild.ownerId !== message.author.id) {
        return message.reply({ 
            embeds: [new EmbedBuilder()
                .setTitle('❌ Access Denied')
                .setDescription('Only the **server owner** can manage fake permissions.')
                .setColor('#ED4245')
            ]
        });
    }

    const db = getGuildDb(message.guild.id);
    const sub = args[0]?.toLowerCase();

    // ── ADD ──
    if (sub === 'add') {
        const role = message.mentions.roles.first();
        if (!role) {
            return message.reply({ 
                embeds: [new EmbedBuilder()
                    .setTitle('❌ Missing Role')
                    .setDescription('Mention a role: `,fakepermissions add @Role ban_members, kick_members`')
                    .setColor('#ED4245')
                ]
            });
        }

        const permsStr = args.slice(1).join(' ');
        const permsToAdd = permsStr.split(/[,\s]+/).map(p => p.trim().toLowerCase()).filter(p => p);

        if (!permsToAdd.length) {
            return message.reply({ 
                embeds: [new EmbedBuilder()
                    .setTitle('❌ Missing Permissions')
                    .setDescription('Provide at least one permission.\nExample: `,fakepermissions add @admin ban_members, kick_members`')
                    .setColor('#ED4245')
                ]
            });
        }

        // Validate permissions
        const invalid = permsToAdd.filter(p => !VALID_PERMISSIONS.includes(p));
        if (invalid.length) {
            return message.reply({ 
                embeds: [new EmbedBuilder()
                    .setTitle('❌ Invalid Permissions')
                    .setDescription(`The following permissions are invalid:\n${invalid.map(p => `\`\`${p}\`\``).join('\n')}\n\nUse \`,fakepermissions permissions\` to see all valid permission names.`)
                    .setColor('#ED4245')
                ]
            });
        }

        // Add permissions
        const fakePerms = db.get('fakePermissions', {});
        if (!fakePerms[role.id]) fakePerms[role.id] = [];

        const added = [];
        const alreadyHad = [];
        for (const perm of permsToAdd) {
            if (!fakePerms[role.id].includes(perm)) {
                fakePerms[role.id].push(perm);
                added.push(perm);
            } else {
                alreadyHad.push(perm);
            }
        }

        db.set('fakePermissions', fakePerms);

        let desc = '';
        if (added.length) desc += `\`\`✅ Added\`\` to <@&${role.id}>:\n${added.map(p => `• \`\`${p}\`\``).join('\n')}\n\n`;
        if (alreadyHad.length) desc += `\`\`⏭️ Already had\`\`:\n${alreadyHad.map(p => `• \`\`${p}\`\``).join('\n')}`;

        return message.reply({ 
            embeds: [new EmbedBuilder()
                .setTitle('🔐 Fake Permissions Updated')
                .setDescription(desc.trim())
                .setColor('#57F287')
            ]
        });
    }

    // ── REMOVE ──
    if (sub === 'remove') {
        const role = message.mentions.roles.first();
        if (!role) {
            return message.reply({ 
                embeds: [new EmbedBuilder()
                    .setTitle('❌ Missing Role')
                    .setDescription('Mention a role: `,fakepermissions remove @Role ban_members, kick_members`')
                    .setColor('#ED4245')
                ]
            });
        }

        const permsStr = args.slice(1).join(' ');
        const permsToRemove = permsStr.split(/[,\s]+/).map(p => p.trim().toLowerCase()).filter(p => p);

        if (!permsToRemove.length) {
            return message.reply({ 
                embeds: [new EmbedBuilder()
                    .setTitle('❌ Missing Permissions')
                    .setDescription('Provide at least one permission.\nExample: `,fakepermissions remove @admin ban_members`')
                    .setColor('#ED4245')
                ]
            });
        }

        const fakePerms = db.get('fakePermissions', {});
        if (!fakePerms[role.id] || !fakePerms[role.id].length) {
            return message.reply({ 
                embeds: [new EmbedBuilder()
                    .setTitle('❌ No Permissions')
                    .setDescription(`<@&${role.id}> has no fake permissions assigned.`)
                    .setColor('#ED4245')
                ]
            });
        }

        const removed = [];
        const notHad = [];
        for (const perm of permsToRemove) {
            const idx = fakePerms[role.id].indexOf(perm);
            if (idx !== -1) {
                fakePerms[role.id].splice(idx, 1);
                removed.push(perm);
            } else {
                notHad.push(perm);
            }
        }

        // Clean up empty arrays
        if (fakePerms[role.id].length === 0) delete fakePerms[role.id];
        db.set('fakePermissions', fakePerms);

        let desc = '';
        if (removed.length) desc += `\`\`✅ Removed\`\` from <@&${role.id}>:\n${removed.map(p => `• \`\`${p}\`\``).join('\n')}\n\n`;
        if (notHad.length) desc += `\`\`⏭️ Not found\`\` on role:\n${notHad.map(p => `• \`\`${p}\`\``).join('\n')}`;

        return message.reply({ 
            embeds: [new EmbedBuilder()
                .setTitle('🔐 Fake Permissions Updated')
                .setDescription(desc.trim())
                .setColor('#57F287')
            ]
        });
    }

    // ── LIST (specific role or all) ──
    if (sub === 'list') {
        const role = message.mentions.roles.first();
        const fakePerms = db.get('fakePermissions', {});

        if (role) {
            // List permissions for specific role
            const rolePerms = fakePerms[role.id] || [];
            if (!rolePerms.length) {
                return message.reply({ 
                    embeds: [new EmbedBuilder()
                        .setTitle(`🔐 Fake Permissions — ${role.name}`)
                        .setDescription(`<@&${role.id}> has no fake permissions assigned.`)
                        .setColor('#5865F2')
                    ]
                });
            }

            return message.reply({ 
                embeds: [new EmbedBuilder()
                    .setTitle(`🔐 Fake Permissions — ${role.name}`)
                    .setDescription(rolePerms.map(p => `• \`\`${p}\`\``).join('\n'))
                    .setColor('#5865F2')
                    .setFooter({ text: `${rolePerms.length} permission(s)` })
                ]
            });
        }

        // List all roles with fake permissions
        const entries = Object.entries(fakePerms).filter(([, perms]) => perms.length > 0);
        if (!entries.length) {
            return message.reply({ 
                embeds: [new EmbedBuilder()
                    .setTitle('🔐 Fake Permissions')
                    .setDescription('No fake permissions have been set up yet.\n\nUse `,fakepermissions add @Role <permission>` to get started.')
                    .setColor('#5865F2')
                ]
            });
        }

        let desc = '';
        for (const [roleId, perms] of entries) {
            const r = message.guild.roles.cache.get(roleId);
            const name = r ? r.name : 'Unknown Role';
            desc += `**${name}** <@&${roleId}>\n${perms.map(p => `• \`\`${p}\`\``).join('\n')}\n\n`;
        }

        return message.reply({ 
            embeds: [new EmbedBuilder()
                .setTitle('🔐 Fake Permissions — All Roles')
                .setDescription(desc.trim())
                .setColor('#5865F2')
            ]
        });
    }

    // ── RESET ──
    if (sub === 'reset') {
        db.set('fakePermissions', {});
        return message.reply({ 
            embeds: [new EmbedBuilder()
                .setTitle('🔐 Fake Permissions Reset')
                .setDescription('All fake permissions have been cleared.')
                .setColor('#57F287')
            ]
        });
    }

    // ── PERMISSIONS (show all valid permission names) ──
    if (sub === 'permissions') {
        const categories = {
            'Moderation': ['ban_members', 'kick_members', 'moderate_members', 'manage_nicknames', 'manage_messages', 'manage_threads', 'read_message_history', 'mention_everyone', 'mention_here'],
            'Channels': ['manage_channels', 'manage_roles', 'view_audit_log', 'view_guild_insights'],
            'Voice': ['move_members', 'mute_members', 'deafen_members', 'priority_speaker'],
            'Server': ['manage_guild', 'manage_webhooks', 'manage_emojis_and_stickers', 'manage_events'],
            'Expressions': ['create_expressions', 'create_events'],
            'Misc': ['administrator', 'change_nickname'],
        };

        let desc = 'Use these permission names with `,fakepermissions add/remove @Role <permission>`\n\n';
        for (const [cat, perms] of Object.entries(categories)) {
            desc += `**${cat}**\n${perms.map(p => `• \`\`${p}\`\``).join('\n')}\n\n`;
        }

        return message.reply({ 
            embeds: [new EmbedBuilder()
                .setTitle('📋 Valid Fake Permissions')
                .setDescription(desc.trim())
                .setColor('#5865F2')
                .setFooter({ text: 'Tip: administrator grants ALL fake permissions' })
            ]
        });
    }

    // ── DEFAULT: Show help ──
    return message.reply({ 
        embeds: [new EmbedBuilder()
            .setTitle('🔐 Fake Permissions')
            .setDescription(
                'Restrict moderators to only use bot commands for moderation.\n\n' +
                '**Commands** (server owner only):\n' +
                '`add` — Grant fake permissions to a role\n' +
                '`remove` — Revoke fake permissions from a role\n' +
                '`list` — View fake permissions (optionally for a specific role)\n' +
                '`reset` — Clear all fake permissions\n' +
                '`permissions` — View all valid permission names\n\n' +
                '**Examples:**\n' +
                '`fakepermissions add @admin ban_members, kick_members`\n' +
                '`fakepermissions remove @admin ban_members`\n' +
                '`fakepermissions list @admin`\n' +
                '`fakepermissions list`\n' +
                '`fakepermissions reset`'
            )
            .setColor('#5865F2')
        ]
    });
}

module.exports = {
    handleFakePermissionsCommand,
    hasFakePermission,
    hasFakePerm,
    hasPermission,
    getMemberFakePermissions,
    PERMISSION_MAP,
    VALID_PERMISSIONS,
};