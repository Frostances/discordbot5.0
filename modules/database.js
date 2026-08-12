const fs = require('fs');
const path = require('path');

const DB_DIR = path.join(__dirname, '..', 'db');
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const cache = new Map();

function getGuildDb(guildId) {
    if (cache.has(guildId)) return cache.get(guildId);
    const file = path.join(DB_DIR, `${guildId}.json`);
    let data = {};
    if (fs.existsSync(file)) {
        try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
    }
    const db = {
        data,
        _file: file,
        get(key, def = null) {
            return key in this.data ? this.data[key] : def;
        },
        set(key, value) {
            this.data[key] = value;
            this._save();
        },
        push(key, value) {
            if (!Array.isArray(this.data[key])) this.data[key] = [];
            this.data[key].push(value);
            this._save();
        },
        _save() {
            fs.writeFileSync(this._file, JSON.stringify(this.data, null, 2));
        }
    };
    cache.set(guildId, db);
    return db;
}

function getUserDb(guildId, userId) {
    const db = getGuildDb(guildId);
    if (!db.data.users) db.data.users = {};
    if (!db.data.users[userId]) {
        db.data.users[userId] = {
            xp: 0, level: 0, balance: 0, bank: 0,
            warnings: [], inventory: [],
            lastDaily: null, lastWeekly: null, lastWork: null, lastCrime: null
        };
    }
    return {
        data: db.data.users[userId],
        save() { db._save(); }
    };
}

module.exports = { getGuildDb, getUserDb };
