const { Client, GatewayIntentBits, EmbedBuilder, PermissionsBitField } = require('discord.js');
const fs = require('fs');
const path = require('path');

// Configuration - Replace with your actual values
const BOT_TOKEN = process.env.BOT_TOKEN || 'YOUR_BOT_TOKEN';
const BLACKTEA_ROLE_ID = process.env.BLACKTEA_ROLE_ID || 'BLACKTEA_ROLE_ID';
const UNMUTE_CHANNEL_ID = process.env.UNMUTE_CHANNEL_ID || 'UNMUTE_CHANNEL_ID';
const VC_LOG_CHANNEL_ID = process.env.VC_LOG_CHANNEL_ID || 'VC_LOG_CHANNEL_ID';
const TOP_10_VC_CHANNEL_ID = process.env.TOP_10_VC_CHANNEL_ID || 'TOP_10_VC_CHANNEL_ID';

// Initialize Discord client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessageReactions
    ]
});

// Global variables
let dictionary = [];
let userData = {};
let activeGuessWordGames = new Map();
let voiceTracker = new Map(); // Track voice channel sessions
let leaderboardMessage = null; // Store the leaderboard message for editing

// Swear words list
const swearWords = [
    'fuck', 'shit', 'damn', 'bitch', 'asshole', 'bastard', 'hell', 'crap',
    'piss', 'dick', 'cock', 'pussy', 'slut', 'whore', 'fag', 'nigger',
    'retard', 'gay', 'lesbian', 'stupid', 'idiot', 'moron', 'dumb'
];

// GuessWord categories
const guessWordCategories = {
    clothing: ['shirt', 'pants', 'dress', 'shoes', 'hat', 'jacket', 'socks', 'tie', 'skirt', 'coat', 'jeans', 'sweater', 'boots', 'gloves', 'scarf'],
    animals: ['elephant', 'tiger', 'lion', 'giraffe', 'zebra', 'monkey', 'rabbit', 'horse', 'dog', 'cat', 'bird', 'fish', 'snake', 'bear', 'wolf'],
    celebrities: ['leonardo', 'angelina', 'brad', 'jennifer', 'johnny', 'scarlett', 'robert', 'emma', 'ryan', 'taylor', 'beyonce', 'rihanna', 'drake', 'kanye', 'bieber'],
    food: ['pizza', 'burger', 'pasta', 'chicken', 'steak', 'salad', 'soup', 'bread', 'cheese', 'apple', 'banana', 'orange', 'chocolate', 'cake', 'cookie']
};

// ==================== DATA STORAGE SYSTEM ====================

function loadData() {
    try {
        if (fs.existsSync('data.json')) {
            const data = fs.readFileSync('data.json', 'utf8');
            userData = JSON.parse(data);
        }
    } catch (error) {
        console.error('Error loading data:', error);
        userData = {};
    }
}

function saveData() {
    try {
        fs.writeFileSync('data.json', JSON.stringify(userData, null, 2));
    } catch (error) {
        console.error('Error saving data:', error);
    }
}

function initializeUser(userId) {
    if (!userData[userId]) {
        userData[userId] = {
            guesswordWins: 0,
            swearCount: 0,
            vcTotalMinutes: 0
        };
        saveData();
    }
}

// ==================== DICTIONARY LOADING ====================

function loadDictionary() {
    try {
        if (fs.existsSync('words_alpha.txt')) {
            const words = fs.readFileSync('words_alpha.txt', 'utf8')
                .split('\n')
                .map(word => word.trim().toLowerCase())
                .filter(word => word.length > 2);
            dictionary = words;
            console.log(`Loaded ${dictionary.length} words from dictionary`);
        } else {
            console.error('words_alpha.txt not found! Creating sample dictionary...');
            dictionary = ['apple', 'banana', 'cherry', 'dragon', 'elephant', 'forest', 'guitar', 'house', 'island', 'jungle'];
        }
    } catch (error) {
        console.error('Error loading dictionary:', error);
        dictionary = ['apple', 'banana', 'cherry', 'dragon', 'elephant'];
    }
}

// ==================== GUESSWORD GAME SYSTEM ====================

class GuessWordGame {
    constructor(channelId) {
        this.channelId = channelId;
        this.players = new Map(); // userId -> {lives: 2, hasGuessed: false}
        this.currentPlayerIndex = 0;
        this.playerOrder = [];
        this.usedWords = new Set();
        this.currentLetters = '';
        this.gameActive = false;
        this.turnTimeout = null;
        this.joinPhase = true;
        this.joinTimeout = null;
    }

    addPlayer(userId) {
        if (!this.players.has(userId) && this.joinPhase) {
            this.players.set(userId, { lives: 2, hasGuessed: false });
            this.playerOrder.push(userId);
            return true;
        }
        return false;
    }

    generateLetterGroup() {
        // Use common letter combinations to make it easier
        const commonCombinations = [
            'ing', 'tion', 'er', 'ly', 'ed', 'est', 'and', 'the', 'for', 'are',
            'but', 'not', 'you', 'all', 'can', 'had', 'her', 'was', 'one', 'our',
            'out', 'day', 'get', 'has', 'him', 'his', 'how', 'its', 'may', 'new',
            'now', 'old', 'see', 'two', 'way', 'who', 'boy', 'did', 'man', 'end',
            'act', 'ask', 'big', 'car', 'cut', 'eat', 'far', 'got', 'hit', 'job',
            'let', 'lot', 'put', 'run', 'sat', 'ten', 'try', 'use', 'win', 'yes'
        ];
        
        if (Math.random() < 0.7) { // 70% chance to use common combinations
            return commonCombinations[Math.floor(Math.random() * commonCombinations.length)];
        } else { // 30% chance for random letters
            const letters = 'abcdefghijklmnopqrstuvwxyz';
            let group = '';
            for (let i = 0; i < 3; i++) {
                group += letters[Math.floor(Math.random() * letters.length)];
            }
            return group;
        }
    }

    async startJoinPhase(channel) {
        const embed = new EmbedBuilder()
            .setTitle('🫖 BlackTea Game')
            .setDescription('Waiting for players, react with ✅ to join. The game will begin in 30 seconds.\n\n**GOAL:** You have 10 seconds to say a word containing the given group of 3 letters.\nFailure to do so within the 10 seconds will lose a life.\nEach player has 2 lives to begin with.\n\n**NOTES:** \n• A word can only be used once through the course of the game\n• Get 5 wins to automatically earn the BlackTea Master role!')
            .setColor('#8B4513')
            .setTimestamp();

        const message = await channel.send({ embeds: [embed] });
        await message.react('✅');

        this.joinTimeout = setTimeout(() => {
            this.startGame(channel);
        }, 30000);

        return message;
    }

    async startGame(channel) {
        clearTimeout(this.joinTimeout);
        
        if (this.playerOrder.length === 0) {
            await channel.send('❌ No players joined the game!');
            activeBlackTeaGames.delete(this.channelId);
            return;
        }

        this.joinPhase = false;
        this.gameActive = true;
        this.currentLetters = this.generateLetterGroup();
        
        await channel.send(`🎮 **BlackTea Game Started!**\nPlayers: ${this.playerOrder.map(id => `<@${id}>`).join(', ')}\n\nCurrent letters: **${this.currentLetters.toUpperCase()}**`);
        setTimeout(() => this.processTurn(channel), 1000);
    }

    async processTurn(channel) {
        if (!this.gameActive) return;

        // Check if we need to start a new round
        const alivePlayers = this.playerOrder.filter(id => this.players.get(id).lives > 0);
        if (alivePlayers.length <= 1) {
            this.endGame(channel);
            return;
        }

        // Find next player with lives
        let attempts = 0;
        while (attempts < this.playerOrder.length) {
            const currentPlayerId = this.playerOrder[this.currentPlayerIndex];
            const player = this.players.get(currentPlayerId);

            if (player && player.lives > 0) {
                break;
            }

            this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.playerOrder.length;
            attempts++;
        }

        if (attempts >= this.playerOrder.length) {
            this.endGame(channel);
            return;
        }

        // Generate new letters for each turn
        this.currentLetters = this.generateLetterGroup();

        const currentPlayerId = this.playerOrder[this.currentPlayerIndex];
        const message = await channel.send(`⏰ <@${currentPlayerId}>'s turn! You have 10 seconds to say a word containing **${this.currentLetters.toUpperCase()}**`);
        await message.react('✅');

        // Add countdown reactions for the last 3 seconds
        setTimeout(async () => {
            if (this.gameActive) await message.react('3️⃣');
        }, 7000); // At 7 seconds (3 seconds left)
        
        setTimeout(async () => {
            if (this.gameActive) await message.react('2️⃣');
        }, 8000); // At 8 seconds (2 seconds left)
        
        setTimeout(async () => {
            if (this.gameActive) await message.react('1️⃣');
        }, 9000); // At 9 seconds (1 second left)

        this.turnTimeout = setTimeout(() => {
            this.handleWrongGuess(channel, currentPlayerId, 'Time\'s up!');
        }, 10000);
    }

    async handleGuess(message, word) {
        if (!this.gameActive || this.joinPhase) return;

        const userId = message.author.id;
        const player = this.players.get(userId);

        if (!player || player.lives <= 0) return;
        if (this.playerOrder[this.currentPlayerIndex] !== userId) return;

        clearTimeout(this.turnTimeout);

        if (this.usedWords.has(word.toLowerCase())) {
            this.handleWrongGuess(message.channel, userId, 'Word already used');
            return;
        }

        // Check if word contains the letters in sequence (case insensitive)
        const wordLower = word.toLowerCase();
        const lettersLower = this.currentLetters.toLowerCase();
        
        if (!wordLower.includes(lettersLower)) {
            this.handleWrongGuess(message.channel, userId, `Word doesn't contain ${this.currentLetters.toUpperCase()}`);
            return;
        }

        if (!dictionary.includes(word.toLowerCase())) {
            this.handleWrongGuess(message.channel, userId, 'Invalid word');
            return;
        }

        // Correct guess
        this.usedWords.add(word.toLowerCase());
        message.react('✅');
        
        this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.playerOrder.length;
        setTimeout(() => this.processTurn(message.channel), 1500);
    }

    async handleWrongGuess(channel, userId, reason) {
        clearTimeout(this.turnTimeout);
        const player = this.players.get(userId);
        player.lives--;

        if (player.lives <= 0) {
            await channel.send(`💀 <@${userId}> is eliminated!`);
            this.playerOrder = this.playerOrder.filter(id => id !== userId);
        } else {
            await channel.send(`💔 <@${userId}> lost a life! (${reason}) - Lives remaining: ${player.lives}`);
        }

        const alivePlayers = this.playerOrder.filter(id => this.players.get(id).lives > 0);
        if (alivePlayers.length <= 1) {
            this.endGame(channel);
            return;
        }

        this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.playerOrder.length;
        setTimeout(() => this.processTurn(channel), 1500);
    }

    async endGame(channel) {
        this.gameActive = false;
        clearTimeout(this.turnTimeout);
        clearTimeout(this.joinTimeout);
        
        const winners = this.playerOrder.filter(id => this.players.get(id).lives > 0);
        
        if (winners.length === 1) {
            const winnerId = winners[0];
            initializeUser(winnerId);
            userData[winnerId].blackteaWins++;
            saveData();

            await channel.send(`🏆 **Game Over!** <@${winnerId}> wins the BlackTea game!`);

            // Award role after 5 wins
            if (userData[winnerId].blackteaWins >= 5) {
                try {
                    const guild = channel.guild;
                    const member = await guild.members.fetch(winnerId);
                    const role = guild.roles.cache.get(BLACKTEA_ROLE_ID);
                    if (role && !member.roles.cache.has(BLACKTEA_ROLE_ID)) {
                        await member.roles.add(role);
                        await channel.send(`🎉 <@${winnerId}> earned the BlackTea champion role!`);
                    }
                } catch (error) {
                    console.error('Error awarding role:', error);
                }
            }
        } else {
            await channel.send('🤷 **Game Over!** No winners this time!');
        }

        activeBlackTeaGames.delete(channel.id);
    }
}

// ==================== GUESSWORD GAME SYSTEM ====================

class GuessWordGame {
    constructor(channelId, category) {
        this.channelId = channelId;
        this.category = category;
        this.word = this.selectRandomWord(category);
        this.guessedLetters = new Set();
        this.wrongLetters = [];
        this.gameActive = true;
        this.participants = new Set();
        this.gameTimeout = null;
        this.startTime = Date.now();
    }

    selectRandomWord(category) {
        const words = guessWordCategories[category] || guessWordCategories.animals;
        return words[Math.floor(Math.random() * words.length)].toLowerCase();
    }

    getDisplayWord() {
        return this.word
            .split('')
            .map(letter => this.guessedLetters.has(letter) ? letter.toUpperCase() : '_')
            .join(' ');
    }

    getGameStatus() {
        const timeElapsed = Math.floor((Date.now() - this.startTime) / 1000);
        const timeRemaining = Math.max(0, 30 - timeElapsed);
        
        const embed = new EmbedBuilder()
            .setTitle(`🎯 GuessWord Game - ${this.category.toUpperCase()}`)
            .setDescription(`**Word:** ${this.getDisplayWord()}\n\n**How to play:**\n• Guess letters one by one OR guess the full word\n• First person to guess the complete word wins!\n• Wrong letters: ${this.wrongLetters.join(', ') || 'None'}\n\n⏰ **Time remaining: ${timeRemaining} seconds**`)
            .setColor('#3498db')
            .setFooter({ text: 'Type a single letter or the full word to guess!' });

        return embed;
    }

    async handleGuess(message, guess) {
        if (!this.gameActive) return;

        const userId = message.author.id;
        this.participants.add(userId);
        initializeUser(userId);

        guess = guess.toLowerCase().trim();

        // Check if it's a full word guess
        if (guess.length > 1) {
            if (guess === this.word) {
                // Winner found!
                await this.endGame(message, userId, true);
                return;
            } else {
                // Wrong word guess - no message, just return
                return;
            }
        }

        // Single letter guess
        if (guess.length !== 1 || !/[a-z]/.test(guess)) {
            return; // Invalid input, no message
        }

        if (this.guessedLetters.has(guess) || this.wrongLetters.includes(guess)) {
            return; // Already guessed, no message
        }

        if (this.word.includes(guess)) {
            // Correct letter
            this.guessedLetters.add(guess);
            message.react('✅');
            
            // Check if word is now complete by revealing letters
            if (this.word.split('').every(letter => this.guessedLetters.has(letter))) {
                await this.endGame(message, userId, true);
                return;
            }
            
            await message.channel.send({ embeds: [this.getGameStatus()] });
        } else {
            // Wrong letter - no reaction or message, just update status
            this.wrongLetters.push(guess);
            await message.channel.send({ embeds: [this.getGameStatus()] });
        }
    }

    startTimer(channel) {
        this.gameTimeout = setTimeout(async () => {
            if (this.gameActive) {
                await this.endGame({ channel }, null, false, true);
            }
        }, 30000);
    }

    async endGame(message, winnerId, won, timeOut = false) {
        this.gameActive = false;
        clearTimeout(this.gameTimeout);
        
        if (won && winnerId) {
            userData[winnerId].guesswordWins++;
            saveData();
            
            const winEmbed = new EmbedBuilder()
                .setTitle('🏆 Game Over!')
                .setDescription(`<@${winnerId}> guessed it first!\n\n**The word was: ${this.word.toUpperCase()}**`)
                .setColor('#00ff00');
            
            await message.channel.send({ embeds: [winEmbed] });
        } else if (timeOut) {
            const timeoutEmbed = new EmbedBuilder()
                .setTitle('⏰ Time\'s Up!')
                .setDescription(`No one guessed the word in time!\n\n**The word was: ${this.word.toUpperCase()}**`)
                .setColor('#ff0000');
            
            await message.channel.send({ embeds: [timeoutEmbed] });
        } else {
            await message.channel.send(`💀 **Game Over!** No one guessed the word: **${this.word.toUpperCase()}**`);
        }

        activeGuessWordGames.delete(message.channel.id);
    }
}

// ==================== SWEAR TRACKING SYSTEM ====================

function checkForSwears(message) {
    const content = message.content.toLowerCase();
    const userId = message.author.id;
    
    for (const swear of swearWords) {
        if (content.includes(swear)) {
            initializeUser(userId);
            userData[userId].swearCount++;
            saveData();
            break; // Only count once per message
        }
    }
}

// ==================== UNMUTE LOGGING SYSTEM ====================

const userUnmuteTimers = new Map();

async function handleVoiceStateUpdate(oldState, newState) {
    const userId = newState.id || oldState.id;
    const guild = newState.guild || oldState.guild;
    
    // Check if user joined unmute channel
    if (newState.channel && newState.channel.id === UNMUTE_CHANNEL_ID) {
        // Unmute user if they were server muted
        if (newState.serverMute) {
            try {
                await newState.setMute(false, 'Auto-unmute in designated channel');
                
                // Find a text channel to log to instead of the voice channel
                const logChannel = guild.channels.cache.find(channel => 
                    channel.type === 0 && // text channel
                    channel.permissionsFor(guild.members.me).has(['SendMessages'])
                );
                
                if (logChannel) {
                    await logChannel.send(`🔊 <@${userId}> has been unmuted in ${newState.channel.name}.`);
                }
            } catch (error) {
                console.error('Error unmuting user:', error);
            }
        }
        
        // Set timer to disconnect after 5 seconds
        userUnmuteTimers.set(userId, setTimeout(async () => {
            try {
                const member = guild.members.cache.get(userId);
                if (member && member.voice.channel && member.voice.channel.id === UNMUTE_CHANNEL_ID) {
                    await member.voice.disconnect('Auto-disconnect after 5 seconds in unmute channel');
                }
            } catch (error) {
                console.error('Error disconnecting user:', error);
            }
            userUnmuteTimers.delete(userId);
        }, 5000));
    }
    
    // Clear timer if user leaves unmute channel
    if (oldState.channel && oldState.channel.id === UNMUTE_CHANNEL_ID && 
        (!newState.channel || newState.channel.id !== UNMUTE_CHANNEL_ID)) {
        const timer = userUnmuteTimers.get(userId);
        if (timer) {
            clearTimeout(timer);
            userUnmuteTimers.delete(userId);
        }
    }
}

// ==================== VOICE CHANNEL CREATION LOGGING ====================

const vcCreationCooldowns = new Map(); // channelId -> timestamp of last log

async function handleVCCreation(channel) {
    // Only log voice channels
    if (channel.type !== 2) return; // 2 = voice channel
    
    const channelId = channel.id;
    const currentTime = Date.now();
    
    // Check if this channel creation was already logged recently (50 seconds)
    if (vcCreationCooldowns.has(channelId)) {
        const lastLogTime = vcCreationCooldowns.get(channelId);
        if (currentTime - lastLogTime < 50000) {
            return; // Still on cooldown, don't log
        }
    }
    
    try {
        const logChannel = channel.guild.channels.cache.get(VC_LOG_CHANNEL_ID);
        if (logChannel) {
            // Try to find who created the channel (usually the first person to join)
            const members = channel.members;
            const creator = members.size > 0 ? members.first() : null;
            
            if (creator) {
                await logChannel.send(`🔊 A new VC has been created by <@${creator.id}> | [Click to join](https://discord.com/channels/${channel.guild.id}/${channel.id})`);
            } else {
                await logChannel.send(`🔊 A new VC "${channel.name}" has been created | [Click to join](https://discord.com/channels/${channel.guild.id}/${channel.id})`);
            }
            
            // Set cooldown for this channel
            vcCreationCooldowns.set(channelId, currentTime);
            
            // Clean up old cooldowns (older than 1 minute)
            setTimeout(() => {
                vcCreationCooldowns.delete(channelId);
            }, 60000);
        }
    } catch (error) {
        console.error('Error logging VC creation:', error);
    }
}

// ==================== EVENT HANDLERS ====================



client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // Check for swear words
    checkForSwears(message);

    // Handle game guesses
    const blackTeaGame = activeBlackTeaGames.get(message.channel.id);
    if (blackTeaGame && blackTeaGame.gameActive && !blackTeaGame.joinPhase) {
        const words = message.content.toLowerCase().split(' ');
        for (const word of words) {
            if (word.length > 2 && dictionary.includes(word)) {
                await blackTeaGame.handleGuess(message, word);
                break;
            }
        }
    }

    const guessWordGame = activeGuessWordGames.get(message.channel.id);
    if (guessWordGame && guessWordGame.gameActive) {
        const content = message.content.toLowerCase().trim();
        // Accept single letters or words (but not command messages starting with .)
        if (!content.startsWith('.') && (content.length === 1 || content.length > 1)) {
            await guessWordGame.handleGuess(message, content);
        }
    }

    // Handle commands
    if (!message.content.startsWith('.')) return;

    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    if (command === 'blacktea') {
        if (args[0] === 'help') {
            const helpEmbed = new EmbedBuilder()
                .setTitle('🫖 BlackTea Game Help')
                .setDescription('**Commands:**\n`.blacktea` - Start a new BlackTea game\n`.blacktea stats` - View your BlackTea stats\n`.blacktea stats @user` - View someone else\'s stats\n`.blacktea help` - Show this help message\n\n**How to Play:**\n• React with ✅ to join when a game starts (30 seconds to join)\n• Each player gets 2 lives\n• When it\'s your turn, say a word containing the 3 letters shown\n• You have 10 seconds per turn\n• Words can only be used once per game\n• Last player standing wins!\n• Get 5 wins to earn the champion role!')
                .setColor('#8B4513')
                .setFooter({ text: 'Good luck and have fun!' });
            
            await message.channel.send({ embeds: [helpEmbed] });
        } else if (args[0] === 'stats') {
            const targetUser = message.mentions.users.first() || message.author;
            initializeUser(targetUser.id);
            const stats = userData[targetUser.id];
            
            const embed = new EmbedBuilder()
                .setTitle(`📊 BlackTea Stats for ${targetUser.displayName}`)
                .addFields({ name: 'Wins', value: stats.blackteaWins.toString(), inline: true })
                .setColor('#8B4513')
                .setThumbnail(targetUser.displayAvatarURL());
            
            await message.channel.send({ embeds: [embed] });
        } else {
            if (activeBlackTeaGames.has(message.channel.id)) {
                await message.channel.send('❌ A BlackTea game is already active in this channel!');
                return;
            }

            const game = new BlackTeaGame(message.channel.id);
            activeBlackTeaGames.set(message.channel.id, game);
            await game.startJoinPhase(message.channel);
        }
    }

    if (command === 'guessword') {
        if (args[0] === 'help') {
            const helpEmbed = new EmbedBuilder()
                .setTitle('🎯 GuessWord Game Help')
                .setDescription('**Commands:**\n`.guessword` - Start a random animal word game\n`.guessword [category]` - Start a game with specific category\n`.guessword stats` - View your GuessWord stats\n`.guessword stats @user` - View someone else\'s stats\n`.guessword help` - Show this help message\n\n**Categories:**\n• clothing\n• animals\n• celebrities\n• food\n\n**How to Play:**\n• Guess letters one by one (type: a, b, c, etc.)\n• OR guess the full word directly\n• First person to guess the complete word wins!\n• You have 30 seconds to solve it\n• Game ends when someone wins or time runs out')
                .setColor('#3498db')
                .setFooter({ text: 'Example: .guessword food' });
            
            await message.channel.send({ embeds: [helpEmbed] });
        } else if (args[0] === 'stats') {
            const targetUser = message.mentions.users.first() || message.author;
            initializeUser(targetUser.id);
            const stats = userData[targetUser.id];
            
            const embed = new EmbedBuilder()
                .setTitle(`📊 GuessWord Stats for ${targetUser.displayName}`)
                .addFields({ name: 'Wins', value: stats.guesswordWins.toString(), inline: true })
                .setColor('#3498db')
                .setThumbnail(targetUser.displayAvatarURL());
            
            await message.channel.send({ embeds: [embed] });
        } else {
            if (activeGuessWordGames.has(message.channel.id)) {
                await message.channel.send('❌ A GuessWord game is already active in this channel!');
                return;
            }

            const category = args[0] || 'animals';
            if (!guessWordCategories[category]) {
                await message.channel.send(`❌ Invalid category! Available categories: ${Object.keys(guessWordCategories).join(', ')}`);
                return;
            }

            const game = new GuessWordGame(message.channel.id, category);
            activeGuessWordGames.set(message.channel.id, game);
            
            const startEmbed = new EmbedBuilder()
                .setTitle('🎯 GuessWord Game Started!')
                .setDescription(`**Category: ${category.toUpperCase()}**\n\n**How to Win:**\n• Be the first person to guess the complete word correctly\n• You can guess letters one by one to reveal the word\n• Or guess the full word directly if you think you know it\n• You have 30 seconds to guess the word!\n\n**Ready? Start guessing!**`)
                .setColor('#ffcc00');
            
            await message.channel.send({ embeds: [startEmbed] });
            await message.channel.send({ embeds: [game.getGameStatus()] });
            
            // Start the 30-second timer
            game.startTimer(message.channel);
        }
    }

    if (command === 'swears') {
        const targetUser = message.mentions.users.first() || message.author;
        initializeUser(targetUser.id);
        const stats = userData[targetUser.id];
        
        const embed = new EmbedBuilder()
            .setTitle(`🤬 Swear Stats for ${targetUser.displayName}`)
            .addFields({ name: 'Swear Count', value: stats.swearCount.toString(), inline: true })
            .setColor('#e74c3c')
            .setThumbnail(targetUser.displayAvatarURL());
        
        await message.channel.send({ embeds: [embed] });
    }
});

client.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot) return;

    // Handle BlackTea game joins
    if (reaction.emoji.name === '✅') {
        const blackTeaGame = activeBlackTeaGames.get(reaction.message.channel.id);
        if (blackTeaGame && blackTeaGame.joinPhase) {
            blackTeaGame.addPlayer(user.id); // No join message to reduce chat spam
        }
    }
});

client.on('voiceStateUpdate', async (oldState, newState) => {
    await handleVoiceStateUpdate(oldState, newState);
    await trackVoiceTime(oldState, newState);
});

client.on('channelCreate', async (channel) => {
    await handleVCCreation(channel);
});

// ==================== VOICE CHAT TRACKING SYSTEM ====================

async function trackVoiceTime(oldState, newState) {
    const userId = newState.id || oldState.id;
    
    // User joined a voice channel
    if (!oldState.channel && newState.channel) {
        voiceTracker.set(userId, Date.now());
    }
    
    // User left a voice channel or switched channels
    if (oldState.channel && (!newState.channel || oldState.channel.id !== newState.channel.id)) {
        const joinTime = voiceTracker.get(userId);
        if (joinTime) {
            const timeSpent = Math.floor((Date.now() - joinTime) / 60000); // Convert to minutes
            
            if (timeSpent > 0) { // Only count if they were in for at least 1 minute
                initializeUser(userId);
                userData[userId].vcTotalMinutes += timeSpent;
                saveData();
            }
            
            voiceTracker.delete(userId);
        }
        
        // If switching channels, start tracking the new channel
        if (newState.channel) {
            voiceTracker.set(userId, Date.now());
        }
    }
}

async function updateVoiceLeaderboard() {
    try {
        const channel = client.channels.cache.get(TOP_10_VC_CHANNEL_ID);
        if (!channel) return;

        // Get top 10 users by voice chat time
        const sortedUsers = Object.entries(userData)
            .filter(([userId, data]) => data.vcTotalMinutes > 0)
            .sort((a, b) => b[1].vcTotalMinutes - a[1].vcTotalMinutes)
            .slice(0, 10);

        if (sortedUsers.length === 0) {
            const embed = new EmbedBuilder()
                .setTitle('🎙️ Top 10 Voice Chat Users')
                .setDescription('No voice chat data available yet.')
                .setColor('#7289da')
                .setTimestamp();

            if (leaderboardMessage) {
                await leaderboardMessage.edit({ embeds: [embed] });
            } else {
                leaderboardMessage = await channel.send({ embeds: [embed] });
            }
            return;
        }

        let description = '';
        for (let i = 0; i < sortedUsers.length; i++) {
            const [userId, data] = sortedUsers[i];
            const user = await client.users.fetch(userId).catch(() => null);
            const username = user ? user.displayName || user.username : 'Unknown User';
            
            const hours = Math.floor(data.vcTotalMinutes / 60);
            const minutes = data.vcTotalMinutes % 60;
            
            const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
            const timeDisplay = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
            
            description += `${medal} **${username}** - ${timeDisplay}\n`;
        }

        const embed = new EmbedBuilder()
            .setTitle('🎙️ Top 10 Voice Chat Users')
            .setDescription(description)
            .setColor('#7289da')
            .setFooter({ text: 'Resets every 30 minutes' })
            .setTimestamp();

        if (leaderboardMessage) {
            await leaderboardMessage.edit({ embeds: [embed] });
        } else {
            leaderboardMessage = await channel.send({ embeds: [embed] });
        }
    } catch (error) {
        console.error('Error updating voice leaderboard:', error);
    }
}

// Start 30-minute leaderboard updates
setInterval(updateVoiceLeaderboard, 30 * 60 * 1000); // Every 30 minutes

// Update leaderboard on bot startup
client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);
    loadData();
    loadDictionary();
    
    // Initial leaderboard update
    setTimeout(updateVoiceLeaderboard, 5000); // Wait 5 seconds after bot starts
});

// Login to Discord
client.login(BOT_TOKEN);