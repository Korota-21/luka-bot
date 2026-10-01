const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { truncate, escapeMd } = require('./text');
const { canManageTask } = require('./taskPermissions');

const COLORS = { blue: 0x5865f2, green: 0x57f287, yellow: 0xfee75c, red: 0xed4245 };
const SOON_MS = 24 * 60 * 60 * 1000;

const ts = (date, style) => `<t:${Math.floor(new Date(date).getTime() / 1000)}:${style}>`;

// عرض مختصر: كل شي في الوصف بدون fields
// السطر الأول (subtext "-#" يطلع بخط صغير): المادة بالخط العريض ┊ المجموعة
function buildEmbed({ task, group, subject }, metaLine) {
  const lines = [
    `-# 📚 **${escapeMd(subject?.name ?? 'مادة محذوفة')}** ┊ 📂 ${escapeMd(group.name)}`,
    `⏰ ${ts(task.dueAt, 'f')} • ${ts(task.dueAt, 'R')}`,
    metaLine,
  ];
  if (task.description) lines.push(`> ${truncate(task.description.replace(/\s*\n+\s*/g, ' '), 300)}`);
  return new EmbedBuilder().setDescription(lines.join('\n'));
}

const finishedCount = (task, group) => group.members.filter((id) => task.completedBy.includes(id)).length;

const button = (id, label, style) => new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);

// mode: "per" = رسالة شخصية (ephemeral) | "pub" = الرسالة العامة
// يُحفظ داخل customId عشان نعرف أي رسالة نحدّث بعد التعديل أو الحذف
const manageButtons = (task, mode) => [
  button(`task:edit:${task._id}:${mode}`, '✏️ تعديل', ButtonStyle.Primary),
  button(`task:delete:${task._id}:${mode}`, '🗑️ حذف', ButtonStyle.Danger),
];

function pickState({ done, dueAt }) {
  const due = new Date(dueAt).getTime();
  if (done) return { icon: '✅', color: COLORS.green, label: '✅ منتهية' };
  if (due < Date.now()) return { icon: '⚠️', color: COLORS.red, label: '⚠️ متأخرة' };
  if (due - Date.now() < SOON_MS) return { icon: '📌', color: COLORS.yellow, label: '⏳ باقي أقل من يوم' };
  return { icon: '📌', color: COLORS.blue, label: '⏳ باقي' };
}

// رسالة مخصصة لشخص (ephemeral): في /task list وللمهام الشخصية
// زر واحد يتبدل حسب حالة الشخص، وأزرار التعديل والحذف تظهر لمن له صلاحية فقط
function personalView(ctx, userId) {
  const { task, group } = ctx;
  const done = task.completedBy.includes(userId);
  const state = pickState({ done, dueAt: task.dueAt });

  const type =
    task.scope === 'personal' ? '🔒 شخصية' : `👥 جماعية ${finishedCount(task, group)}/${group.members.length}`;

  const embed = buildEmbed(ctx, `${state.label} • ${type}`)
    .setColor(state.color)
    .setTitle(`${state.icon} ${truncate(task.title, 240)}`);

  const row = new ActionRowBuilder().addComponents(
    done
      ? button(`task:toggle:${task._id}`, '↩️ تراجع', ButtonStyle.Secondary)
      : button(`task:toggle:${task._id}`, '✅ تم', ButtonStyle.Success)
  );
  if (task.scope === 'group') {
    row.addComponents(button(`task:who:${task._id}`, '👥 من أنهى؟', ButtonStyle.Secondary));
  }
  if (canManageTask(task, group, userId)) row.addComponents(...manageButtons(task, 'per'));

  return { embeds: [embed], components: [row] };
}

// الرسالة العامة للمهمة الجماعية: واحدة للجميع، فتعرض العدد بدل حالة شخصية
// أزرار التعديل والحذف تظهر للكل، والصلاحية تتحقق عند الضغط
function publicMessage(ctx) {
  const { task, group } = ctx;
  const finished = finishedCount(task, group);
  const total = group.members.length;
  const allDone = total > 0 && finished >= total;
  const state = pickState({ done: allDone, dueAt: task.dueAt });
  const label = allDone ? '✅ أنهاها الكل' : state.label;

  const embed = buildEmbed(ctx, `${label} • 👥 ${finished}/${total} • <@${task.createdBy}>`)
    .setColor(state.color)
    .setTitle(`${state.icon} ${truncate(task.title, 240)}`)
    .setFooter({ text: 'اضغط ✅ تم لما تخلصها' });

  const row = new ActionRowBuilder().addComponents(
    button(`task:done:${task._id}`, '✅ تم', ButtonStyle.Success),
    button(`task:undone:${task._id}`, '↩️ تراجع', ButtonStyle.Secondary),
    button(`task:who:${task._id}`, '👥 من أنهى؟', ButtonStyle.Secondary),
    ...manageButtons(task, 'pub')
  );

  return { embeds: [embed], components: [row] };
}

module.exports = { personalView, publicMessage };
