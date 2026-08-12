const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

const LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
const COLORS_ANSI = { DEBUG: '\x1b[36m', INFO: '\x1b[32m', WARN: '\x1b[33m', ERROR: '\x1b[31m', RESET: '\x1b[0m' };

let commandsExecuted = 0;
let errorsLogged = 0;

function formatLine(level, tag, message) {
    const ts = new Date().toISOString();
    return `[${ts}] [${level}] [${tag}] ${message}`;
}

function write(level, tag, message, err = null) {
    const line = formatLine(level, tag, err ? `${message} — ${err.message || err}` : message);
    const color = COLORS_ANSI[level] || '';
    console.log(`${color}${line}${COLORS_ANSI.RESET}`);
    if (level === 'ERROR') errorsLogged++;

    try {
        const file = path.join(LOG_DIR, `${new Date().toISOString().split('T')[0]}.log`);
        fs.appendFileSync(file, line + '\n');
    } catch {}
}

module.exports = {
    debug:   (tag, msg) => write('DEBUG', tag, msg),
    info:    (tag, msg) => write('INFO',  tag, msg),
    warn:    (tag, msg) => write('WARN',  tag, msg),
    error:   (tag, msg, err) => write('ERROR', tag, msg, err),
    command: (user, guild, cmd) => { commandsExecuted++; write('INFO', 'CMD', `${user} in ${guild} → .${cmd}`); },
    getStats: () => ({ commandsExecuted, errorsLogged }),
    resetStats: () => { commandsExecuted = 0; errorsLogged = 0; },
};
