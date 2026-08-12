// ══════════════════════════════════════════════════════════
// ECONOMY SHOP MODULE
// ══════════════════════════════════════════════════════════

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getEconomy, getUserEconomy, isEconomyEnabled, addCredits, removeCredits, formatNumber, getDefaultShopItems, COLORS } = require('./economy');
const { err, ok, info } = require('../utils/embeds');

// ══════════════════════════════════════════════════════════
// SHOP
// ══════════════════════════════════════════════════════════

async function handleShop(message) {
  if (!isEconomyEnabled(message.guild.id)) return message.reply(err('Economy is not enabled.'));
  const guildId = message.guild.id;
  const ec = getEconomy(guildId);
  const items = ec.shop || getDefaultShopItems();

  const embed = new EmbedBuilder()
    .setColor(COLORS.gold)
    .setTitle('🛍️ Economy Shop')
    .setDescription('Spend your Credits on cosmetic items!\n\nUse `,buy <item_id>` to purchase.')
    .setFooter({ text: `Use ,inventory to view your items` });

  const fields = items.map(item => ({
    name: `${item.emoji} ${item.name} (\`${item.id}\`)`,
    value: `**${item.description}**\nType: \`${item.type}\` | Price: **${formatNumber(item.price)}** Credits`,
    inline: false,
  }));

  embed.addFields(fields);
  return message.reply({ embeds: [embed] });
}

// ══════════════════════════════════════════════════════════
// BUY
// ══════════════════════════════════════════════════════════

async function handleBuy(message, args) {
  if (!isEconomyEnabled(message.guild.id)) return message.reply(err('Economy is not enabled.'));
  const guildId = message.guild.id;
  const userId = message.author.id;
  const user = getUserEconomy(guildId, userId);
  const ec = getEconomy(guildId);
  const items = ec.shop || getDefaultShopItems();

  const itemId = args[0]?.toLowerCase();
  if (!itemId) return message.reply(err('Usage: `,buy <item_id>`\nUse `,shop` to see available items.'));

  const item = items.find(i => i.id.toLowerCase() === itemId);
  if (!item) return message.reply(err(`Item \`${itemId}\` not found. Use \`,shop\` to see available items.`));
  if (user.inventory.includes(item.id)) return message.reply(err(`You already own **${item.name}**!`));
  if (user.credits < item.price) return message.reply(err(`You don't have enough Credits!\n**${item.name}** costs **${formatNumber(item.price)}** Credits.\nYour balance: **${formatNumber(user.credits)}**`));

  removeCredits(guildId, userId, item.price, 'shop_purchase');
  user.inventory.push(item.id);
  user.stats.shopPurchases++;
  saveEconomy(guildId, ec);

  const embed = new EmbedBuilder()
    .setColor(COLORS.success)
    .setTitle('🛍️ Purchase Successful!')
    .setDescription(`You bought **${item.emoji} ${item.name}** for **${formatNumber(item.price)}** Credits!\n\n💰 New Balance: **${formatNumber(user.credits)}**`)
    .setFooter({ text: `Use ,use ${item.id} to equip it!` });

  return message.reply({ embeds: [embed] });
}

// ══════════════════════════════════════════════════════════
// INVENTORY
// ══════════════════════════════════════════════════════════

async function handleInventory(message, args) {
  if (!isEconomyEnabled(message.guild.id)) return message.reply(err('Economy is not enabled.'));
  const guildId = message.guild.id;
  const target = message.mentions.users.first() || message.author;
  const user = getUserEconomy(guildId, target.id);
  const ec = getEconomy(guildId);
  const items = ec.shop || getDefaultShopItems();

  if (!user.inventory.length) {
    return message.reply({ embeds: [new EmbedBuilder().setColor(COLORS.muted).setTitle('🎒 Inventory').setDescription(`${target.id === message.author.id ? 'Your' : `${target.username}'s`} inventory is empty.\n\nUse \`,shop\` to buy items!`)] });
  }

  const ownedItems = user.inventory.map(id => {
    const item = items.find(i => i.id === id) || { name: 'Unknown', emoji: '❓', type: 'unknown', id };
    const equipped = Object.values(user.equipped).includes(id) ? ' ✅' : '';
    return `${item.emoji} **${item.name}**${equipped} (\`${item.id}\`) — ${item.type}`;
  });

  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle(`🎒 ${target.username}'s Inventory`)
    .setDescription(ownedItems.join('\n'))
    .setFooter({ text: 'Use ,use <item_id> to equip an item' })
    .setTimestamp();

  return message.reply({ embeds: [embed] });
}

// ══════════════════════════════════════════════════════════
// USE / EQUIP
// ══════════════════════════════════════════════════════════

async function handleUse(message, args) {
  if (!isEconomyEnabled(message.guild.id)) return message.reply(err('Economy is not enabled.'));
  const guildId = message.guild.id;
  const userId = message.author.id;
  const user = getUserEconomy(guildId, userId);
  const ec = getEconomy(guildId);
  const items = ec.shop || getDefaultShopItems();

  const itemId = args[0]?.toLowerCase();
  if (!itemId) return message.reply(err('Usage: `,use <item_id>`\nUse `,inventory` to see your items.'));

  const item = items.find(i => i.id.toLowerCase() === itemId);
  if (!item) return message.reply(err(`Item \`${itemId}\` not found.`));
  if (!user.inventory.includes(item.id)) return message.reply(err(`You don't own **${item.name}**! Buy it from the shop first.`));

  // Unequip previous item of same type
  if (user.equipped[item.type]) {
    const prevId = user.equipped[item.type];
    const prevItem = items.find(i => i.id === prevId);
    user.equipped[item.type] = item.id;
    saveEconomy(guildId, ec);

    const embed = new EmbedBuilder()
      .setColor(COLORS.success)
      .setTitle('🎖️ Item Equipped')
      .setDescription(`You equipped **${item.emoji} ${item.name}**!\n\n${prevItem ? `Replaced **${prevItem.emoji} ${prevItem.name}**.` : ''}`);
    return message.reply({ embeds: [embed] });
  }

  user.equipped[item.type] = item.id;
  saveEconomy(guildId, ec);

  const embed = new EmbedBuilder()
    .setColor(COLORS.success)
    .setTitle('🎖️ Item Equipped')
    .setDescription(`You equipped **${item.emoji} ${item.name}**!`);
  return message.reply({ embeds: [embed] });
}

// ══════════════════════════════════════════════════════════
// EXPORTS
// ══════════════════════════════════════════════════════════

module.exports = {
  handleShop,
  handleBuy,
  handleInventory,
  handleUse,
};