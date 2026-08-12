const { error: logError } = require('../utils/logger');
const { error: errEmbed } = require('../utils/embeds');

const FRIENDLY = {
    MissingPermissions:   'I am missing the required permissions to do that.',
    MissingAccess:        'I don\'t have access to that channel.',
    UnknownMessage:       'That message no longer exists.',
    UnknownChannel:       'That channel no longer exists.',
    UnknownMember:        'That member is no longer in this server.',
    UnknownUser:          'That user doesn\'t exist.',
    UnknownRole:          'That role doesn\'t exist.',
    InvalidFormBody:      'Invalid data was sent. Please check your input.',
    RateLimited:          'I am being rate limited. Please wait a moment.',
};

async function handleCommandError(context, err) {
    const isInteraction = !!context.reply && !!context.deferReply;
    const code = err.code?.toString() || err.constructor?.name;

    const friendlyMsg = FRIENDLY[code] || FRIENDLY[err.message] || 'Something went wrong. Please try again.';

    logError('CMD', `Error in command: ${err.message || err}`, err);

    try {
        const embed = errEmbed('Error', friendlyMsg);
        if (isInteraction) {
            if (context.deferred || context.replied) await context.editReply({ embeds: [embed] });
            else await context.reply({ embeds: [embed], ephemeral: true });
        } else {
            await context.reply({ embeds: [embed] });
        }
    } catch {}
}

function attachGlobalHandlers(client) {
    process.on('unhandledRejection', (reason) => {
        logError('PROCESS', 'Unhandled rejection', reason instanceof Error ? reason : new Error(String(reason)));
    });

    process.on('uncaughtException', (err) => {
        logError('PROCESS', 'Uncaught exception', err);
    });

    client.on('error', (err) => {
        logError('CLIENT', 'Discord client error', err);
    });

    client.on('warn', (msg) => {
        logError('CLIENT', `Discord warning: ${msg}`);
    });
}

module.exports = { handleCommandError, attachGlobalHandlers };
