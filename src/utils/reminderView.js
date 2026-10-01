const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { truncate, escapeMd, formatMentions } = require('./text');

const COLOR = 0xf59e0b;
const MAX_CONTENT_MENTIONS = 80;

const stamp = (date) => Math.floor(new Date(date).getTime() / 1000);

function taskBlock({ task, group, subject }, pending) {
  const lines = [
    `📌 **${escapeMd(truncate(task.title, 80))}**`,
    `-# 📚 **${escapeMd(subject?.name ?? 'مادة محذوفة')}** ┊ 📂 ${escapeMd(group.name)}`,
    `⏰ <t:${stamp(task.dueAt)}:R> • <t:${stamp(task.dueAt)}:f>`,
  ];
  if (pending) lines.push(`⏳ باقي: ${formatMentions(pending, 10)}`);
  return lines.join('\n');
}

// زر ✅ لكل مهمة (5 أزرار في الصف). where: ch = قناة | dm = رسالة خاصة
function doneRows(items, where) {
  const buttons = items.map(({ ctx }) =>
    new ButtonBuilder()
      .setCustomId(`task:rdone:${ctx.task._id}:${where}`)
      .setLabel(`✅ ${truncate(ctx.task.title, 40)}`)
      .setStyle(ButtonStyle.Success)
  );
  const rows = [];
  for (let i = 0; i < buttons.length; i += 5) {
    rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
  }
  return rows;
}

// تذكير للمهام الجماعية في قناة المجموعة: رسالة وحدة، منشن لكل اللي ما خلصوا
// items: [{ ctx, pending: [userId] }]
function channelReminder(items) {
  const everyone = [...new Set(items.flatMap((i) => i.pending))].slice(0, MAX_CONTENT_MENTIONS);

  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle('⏰ تذكير: مهام تنتهي خلال 6 ساعات')
    .setDescription(truncate(items.map((i) => taskBlock(i.ctx, i.pending)).join('\n\n'), 4096));

  return {
    content: `🔔 ${everyone.map((id) => `<@${id}>`).join(' ')}`,
    embeds: [embed],
    components: doneRows(items, 'ch'),
    allowedMentions: { users: everyone },
  };
}

// تذكير للمهام الشخصية في الخاص
function dmReminder(items) {
  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle('⏰ تذكير: مهام شخصية تنتهي خلال 6 ساعات')
    .setDescription(truncate(items.map((i) => taskBlock(i.ctx)).join('\n\n'), 4096));

  return { embeds: [embed], components: doneRows(items, 'dm') };
}

// لو الخاص مقفل: رسالة في القناة بدون تفاصيل (المهمة شخصية فما نكشفها للكل)
function dmFallback(userId, count) {
  return {
    content:
      `⏰ <@${userId}> عندك ${count === 1 ? 'مهمة شخصية' : `${count} مهام شخصية`} موعدها قريب، ` +
      `بس ما قدرت أرسل لك رسالة خاصة (فعّل الرسائل الخاصة من أعضاء السيرفر). اكتب \`/task list\` لتشوفها.`,
    allowedMentions: { users: [userId] },
  };
}

module.exports = { channelReminder, dmReminder, dmFallback };
