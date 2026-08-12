# Overview

This is a comprehensive Discord bot built with Node.js and Discord.js that provides interactive games, moderation features, and staff management for Discord servers. The bot includes a word-guessing game (GuessWord), swear tracking system with leaderboards, voice channel monitoring with time tracking, staff role configuration, and warning system with automatic expiration. All user data is persistently stored in JSON format, and the bot uses a large English dictionary (369,652 words) for word-based games. The bot is fully functional and currently running as "Kaido#4086".

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Running the Bot
- Requires a `BOT_TOKEN` secret set in Replit Secrets (the Discord bot token)
- Run via the **Discord Bot** workflow (`node index.js`)
- Music system uses Lavalink — node details are hardcoded in `modules/musicManager.js` (edit the `NODES` array to change)

## Core Bot Framework
- **Discord.js v14**: Primary framework for Discord API interactions
- **Event-driven architecture**: Bot responds to Discord events (messages, voice state changes, reactions)
- **Single-file monolithic design**: All functionality contained in `index.js` for simplicity
- **Environment variable configuration**: Bot token stored as `BOT_TOKEN` in Replit Secrets

## Game Systems
- **GuessWord Game**: Single-letter guessing game with category support
  - Four predefined categories: clothing, animals, celebrities, food
  - First-to-guess-correctly wins format
  - Visual progress display with underscores
  - 30-second timer per game

## Data Management
- **JSON-based persistence**: All user data stored in `data.json`
- **In-memory caching**: User data loaded into memory at startup for performance
- **Synchronous file operations**: Simple read/write operations for data consistency
- **Dictionary loading**: Large word list loaded from `words_alpha.txt` file

## Moderation Features
- **Swear word detection**: Predefined list of inappropriate words with automatic tracking
- **Swear leaderboards**: Top 10 users by swear count with medal rankings
- **Voice channel monitoring**: Automatic logging of VC creation with clickable channel links
- **Voice time tracking**: Comprehensive tracking with 30-minute leaderboard updates
- **Automatic unmute system**: Users joining specific channel get unmuted and auto-disconnected after 5 seconds
- **Staff management system**: Role-based permissions with admin-only configuration
- **Warning system**: Staff-only warnings with 2-week auto-expiration and DM notifications

## Command System
- **Prefix-based commands**: Uses dot (.) prefix for all bot commands
- **Parameter support**: Commands accept user mentions and category parameters
- **Stats tracking**: Comprehensive statistics for all game types per user
- **Role-based permissions**: Staff commands restricted to configured staff roles
- **Admin privileges**: Special admin user (ID: 889906903554072647) for staff configuration

## Staff & Warning Systems
- **Staff Configuration**: Admin-only `.staff set @role` and `.staff list` commands
- **Warning Management**: Staff-only `.warn @user reason` with automatic tracking
- **Warning Expiration**: Automatic 2-week expiration with DM notifications
- **Warning Viewing**: `.warn list` for personal warnings, `.warn list @user` for staff
- **Persistent Storage**: All warnings and staff roles survive bot restarts

# External Dependencies

## Core Dependencies
- **discord.js**: Discord API wrapper library for bot functionality
- **Node.js File System (fs)**: Built-in module for JSON data persistence
- **Node.js Path**: Built-in module for file path management

## Data Sources
- **words_alpha.txt**: Large English dictionary file (300k+ words) for BlackTea game
- **data.json**: User data storage file for statistics and tracking

## Discord API Integration
- **Guild Intents**: Requires permissions for messages, voice states, and reactions
- **Role Management**: Bot needs permission to assign roles for BlackTea winners
- **Channel Management**: Bot sends logs to specific configured channels

## Environment Configuration
- **BOT_TOKEN**: Discord bot authentication token
- **BLACKTEA_ROLE_ID**: Role ID awarded to BlackTea game winners
- **UNMUTE_CHANNEL_ID**: Channel ID for automatic unmute functionality
- **VC_LOG_CHANNEL_ID**: Channel ID for voice channel join logging