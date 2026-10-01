const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
  InteractionContextType,
} = require('discord.js');
const groupService = require('../services/groupService');
const subjectService = require('../services/subjectService');
const taskService = require('../services/taskService');
const taskView = require('../utils/taskView');
const { parseDueDate, suggestDates, formatDueParts, normalizeDigits } = require('../utils/dates');
const { UserError } = require('../utils/errors');
const { truncate, formatMentions } = require('../utils/text');

const EPHEMERAL = MessageFlags.Ephemeral;
const NO_PINGS = { parse: [] };
const PAGE_SIZE = 10;

const STATUS_LABELS = { pending: 'المتبقي', done: 'المنتهي', all: 'الكل' };
const SCOPE_LABELS = { all: 'الكل', personal: 'شخصية', group: 'جماعية' };
// رموز مختصرة داخل customId (حد ديسكورد 100 حرف)
const STATUS_CODES = { pending: 'p', done: 'd', all: 'a' };
const SCOPE_CODES = { all: 'a', personal: 'p', group: 'g' };
const invert = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [v, k]));
const STATUS_BY_CODE = invert(STATUS_CODES);
const SCOPE_BY_CODE = invert(SCOPE_CODES);

// ---------- تعريف الأمر ----------

const data = new SlashCommandBuilder()
  .setName('task')
  .setDescription('إدارة المهام')
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((s) =>
    s
      .setName('add')
      .setDescription('إضافة مهمة جديدة')
      .addStringOption((o) =>
        o.setName('group').setDescription('المجموعة').setAutocomplete(true).setRequired(true)
      )
      .addStringOption((o) =>
        o.setName('subject').setDescription('المادة').setAutocomplete(true).setRequired(true)
      )
      .addStringOption((o) =>
        o.setName('title').setDescription('عنوان المهمة').setRequired(true).setMinLength(2).setMaxLength(100)
      )
      .addStringOption((o) =>
        o
          .setName('scope')
          .setDescription('لمن هذي المهمة؟')
          .setRequired(true)
          .addChoices({ name: 'لي فقط', value: 'personal' }, { name: 'لكل المجموعة', value: 'group' })
      )
      .addStringOption((o) =>
        o
          .setName('date')
          .setDescription('تاريخ التسليم بصيغة YYYY-MM-DD (اختر من القائمة أو اكتبه)')
          .setRequired(true)
          .setAutocomplete(true)
      )
      .addIntegerOption((o) =>
        o.setName('hour').setDescription('الساعة (0-23)').setRequired(true).setMinValue(0).setMaxValue(23)
      )
      .addIntegerOption((o) =>
        o.setName('minute').setDescription('الدقيقة (0-59، الافتراضي 0)').setMinValue(0).setMaxValue(59)
      )
      .addStringOption((o) => o.setName('description').setDescription('تفاصيل (اختياري)').setMaxLength(500))
  )
  .addSubcommand((s) =>
    s
      .setName('list')
      .setDescription('عرض مهامك، كل مهمة برسالة بالترتيب الزمني')
      .addStringOption((o) => o.setName('group').setDescription('فلترة بمجموعة').setAutocomplete(true))
      .addStringOption((o) =>
        o.setName('subject').setDescription('فلترة بمادة (اختر المجموعة أولاً)').setAutocomplete(true)
      )
      .addStringOption((o) =>
        o
          .setName('status')
          .setDescription('الحالة (الافتراضي: المتبقي)')
          .addChoices(
            { name: 'المتبقي', value: 'pending' },
            { name: 'المنتهي', value: 'done' },
            { name: 'الكل', value: 'all' }
          )
      )
      .addStringOption((o) =>
        o
          .setName('scope')
          .setDescription('النوع (الافتراضي: الكل)')
          .addChoices(
            { name: 'الكل', value: 'all' },
            { name: 'شخصية', value: 'personal' },
            { name: 'جماعية', value: 'group' }
          )
      )
  );

// ---------- مساعدات ----------

// تحديث الرسالة العامة للمهمة الجماعية (best effort)
async function refreshPublicMessage(client, ctx) {
  const { task } = ctx;
  if (!task.channelId || !task.messageId) return;
  try {
    const channel = await client.channels.fetch(task.channelId);
    const message = await channel.messages.fetch(task.messageId);
    await message.edit(taskView.publicMessage(ctx));
  } catch (err) {
    console.warn(`Could not refresh public message for task ${task._id}: ${err.message}`);
  }
}

const nextId = (offset, f) =>
  `task:next:${offset}:${STATUS_CODES[f.status]}:${SCOPE_CODES[f.scope]}:${f.groupId ?? '-'}:${f.subjectId ?? '-'}`;

// يرسل صفحة من المهام: كل مهمة برسالة مستقلة (ephemeral) ثم زر "التالي" لو فيه المزيد
async function sendTasks(interaction, tasks, offset, filters) {
  const userId = interaction.user.id;
  const page = tasks.slice(offset, offset + PAGE_SIZE);
  const contexts = await taskService.hydrate(page);

  for (const ctx of contexts) {
    await interaction.followUp({ ...taskView.personalView(ctx, userId), flags: EPHEMERAL });
  }

  const end = offset + page.length;
  if (end < tasks.length) {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(nextId(end, filters))
        .setLabel('عرض التالي ▶️')
        .setStyle(ButtonStyle.Primary)
    );
    await interaction.followUp({
      content: `عرض ${offset + 1}–${end} من ${tasks.length}. باقي ${tasks.length - end}.`,
      components: [row],
      flags: EPHEMERAL,
    });
  }
}

// ---------- الأوامر الفرعية ----------

const handlers = {
  async add(interaction) {
    const userId = interaction.user.id;
    const group = await groupService.getGroupOrThrow(
      interaction.options.getString('group', true),
      interaction.guildId
    );
    const subject = await taskService.getSubjectOrThrow(group, interaction.options.getString('subject', true));
    const dueAt = parseDueDate({
      date: interaction.options.getString('date', true),
      hour: interaction.options.getInteger('hour', true),
      minute: interaction.options.getInteger('minute') ?? 0,
    });
    const scope = interaction.options.getString('scope', true);

    const task = await taskService.createTask({
      group,
      subject,
      userId,
      scope,
      dueAt,
      title: interaction.options.getString('title', true),
      description: interaction.options.getString('description'),
    });
    const ctx = { task, group, subject };

    if (scope === 'group') {
      // رسالة عامة بأزرار، ونحفظ معرّفها عشان نحدّثها لما تتغير الحالة
      await interaction.reply({
        content: `📌 <@${userId}> أضاف مهمة جديدة في **${group.name}**`,
        ...taskView.publicMessage(ctx),
        allowedMentions: NO_PINGS,
      });
      const message = await interaction.fetchReply();
      await taskService.attachMessage(task._id, message.channelId, message.id);
    } else {
      await interaction.reply({ ...taskView.personalView(ctx, userId), flags: EPHEMERAL });
    }
  },

  async list(interaction) {
    await interaction.deferReply({ flags: EPHEMERAL });

    const filters = {
      groupId: interaction.options.getString('group'),
      subjectId: interaction.options.getString('subject'),
      status: interaction.options.getString('status') ?? 'pending',
      scope: interaction.options.getString('scope') ?? 'all',
    };
    const tasks = await taskService.queryTasks({
      guildId: interaction.guildId,
      userId: interaction.user.id,
      ...filters,
    });

    if (!tasks.length) {
      return interaction.editReply('🎉 ما فيه مهام تطابق هذا الفلتر.');
    }

    const end = Math.min(PAGE_SIZE, tasks.length);
    await interaction.editReply(
      `📋 **مهامك** (${STATUS_LABELS[filters.status]} • ${SCOPE_LABELS[filters.scope]}) — ${tasks.length} مهمة، عرض 1–${end}`
    );
    await sendTasks(interaction, tasks, 0, filters);
  },
};

async function execute(interaction) {
  await handlers[interaction.options.getSubcommand()](interaction);
}

// ---------- autocomplete ----------

async function autocomplete(interaction) {
  const focused = interaction.options.getFocused(true);
  const userId = interaction.user.id;

  if (focused.name === 'date') return interaction.respond(suggestDates(focused.value));

  if (focused.name === 'group') {
    const groups = await groupService.searchGroups({
      guildId: interaction.guildId,
      query: focused.value,
      memberId: userId,
    });
    return interaction.respond(groups.map((g) => ({ name: truncate(g.name, 100), value: String(g._id) })));
  }

  if (focused.name === 'subject') {
    const group = await groupService
      .getGroupOrThrow(interaction.options.getString('group'), interaction.guildId)
      .catch(() => null);
    if (!group || !groupService.isMember(group, userId)) return interaction.respond([]);

    const subjects = await subjectService.searchSubjects({ groupId: group._id, query: focused.value });
    return interaction.respond(subjects.map((s) => ({ name: truncate(s.name, 100), value: String(s._id) })));
  }

  return interaction.respond([]);
}

// ---------- الأزرار ----------
// task:done|undone:<id>   (الرسالة العامة)
// task:toggle:<id>        (الرسائل الشخصية)
// task:who:<id>
// task:next:<offset>:<status>:<scope>:<groupId|->:<subjectId|->
// task:edit|delete:<id>:<pub|per>  ->  modal: task:editmodal:<id>:<mode>
// task:delconfirm|delcancel:<id>:<mode>
// task:rdone:<id>:<ch|dm>  (زر ✅ داخل رسالة التذكير)

async function handlePublicButton(interaction, taskId, done) {
  const userId = interaction.user.id;
  const ctx = await taskService.loadContext(taskId);
  taskService.assertCanAccess(ctx, userId);

  ctx.task = await taskService.setCompleted(ctx.task._id, userId, done);
  await interaction.update(taskView.publicMessage(ctx));
  await interaction.followUp({
    content: done ? '✅ سجّلت إنهاءك للمهمة.' : '↩️ رجّعتها لقائمة المتبقي.',
    flags: EPHEMERAL,
  });
}

async function handlePersonalToggle(interaction, taskId) {
  const userId = interaction.user.id;
  const ctx = await taskService.loadContext(taskId);
  taskService.assertCanAccess(ctx, userId);

  const done = !ctx.task.completedBy.includes(userId);
  ctx.task = await taskService.setCompleted(ctx.task._id, userId, done);

  await interaction.update(taskView.personalView(ctx, userId));
  if (ctx.task.scope === 'group') await refreshPublicMessage(interaction.client, ctx);
}

async function showWho(interaction, taskId) {
  const ctx = await taskService.loadContext(taskId);
  taskService.assertCanAccess(ctx, interaction.user.id);
  if (ctx.task.scope !== 'group') throw new UserError('هذي مهمة شخصية.');

  const { task, group } = ctx;
  const done = group.members.filter((id) => task.completedBy.includes(id));
  const pending = group.members.filter((id) => !task.completedBy.includes(id));

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`👥 ${truncate(task.title, 240)}`)
    .addFields(
      { name: `✅ أنهوها (${done.length})`, value: formatMentions(done, 30) },
      { name: `⏳ باقي (${pending.length})`, value: formatMentions(pending, 30) }
    );

  await interaction.reply({ embeds: [embed], flags: EPHEMERAL, allowedMentions: NO_PINGS });
}

async function showNext(interaction, args) {
  const [offsetRaw, statusCode, scopeCode, groupId, subjectId] = args;
  const offset = Number.parseInt(offsetRaw, 10);
  const filters = {
    status: STATUS_BY_CODE[statusCode] ?? 'pending',
    scope: SCOPE_BY_CODE[scopeCode] ?? 'all',
    groupId: groupId === '-' ? null : groupId,
    subjectId: subjectId === '-' ? null : subjectId,
  };

  await interaction.deferUpdate();
  const tasks = await taskService.queryTasks({
    guildId: interaction.guildId,
    userId: interaction.user.id,
    ...filters,
  });

  if (!Number.isInteger(offset) || offset >= tasks.length) {
    return interaction.editReply({ content: 'ما فيه مهام زيادة.', components: [] });
  }

  const end = Math.min(offset + PAGE_SIZE, tasks.length);
  await interaction.editReply({ content: `✅ تم عرض ${offset + 1}–${end} من ${tasks.length}`, components: [] });
  await sendTasks(interaction, tasks, offset, filters);
}

// ---------- التعديل ----------

// إشعار في قناة المهمة الأصلية (best effort)
async function notifyChannel(client, task, content) {
  if (!task.channelId) return;
  try {
    const channel = await client.channels.fetch(task.channelId);
    await channel.send({ content, allowedMentions: NO_PINGS });
  } catch (err) {
    console.warn(`Could not send notice for task ${task._id}: ${err.message}`);
  }
}

function parseTime(value) {
  const match = /^(\d{1,2}):(\d{1,2})$/.exec(normalizeDigits(value.trim()));
  const hour = match ? Number(match[1]) : NaN;
  const minute = match ? Number(match[2]) : NaN;
  if (!match || hour > 23 || minute > 59) {
    throw new UserError('صيغة الوقت غلط. استخدم HH:MM بنظام 24 ساعة، مثل 14:30.');
  }
  return { hour, minute };
}

async function openEditModal(interaction, taskId, mode) {
  const userId = interaction.user.id;
  const ctx = await taskService.loadContext(taskId);
  taskService.assertCanAccess(ctx, userId);
  taskService.assertCanManage(ctx, userId);

  const { task } = ctx;
  const parts = formatDueParts(task.dueAt);

  const field = (id, label, value, { style = TextInputStyle.Short, required = true, max } = {}) => {
    const input = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(required);
    if (max) input.setMaxLength(max);
    if (value) input.setValue(value);
    return new ActionRowBuilder().addComponents(input);
  };

  const modal = new ModalBuilder()
    .setCustomId(`task:editmodal:${task._id}:${mode}`)
    .setTitle('تعديل المهمة')
    .addComponents(
      field('title', 'العنوان', task.title, { max: 100 }),
      field('description', 'التفاصيل (اختياري)', task.description, {
        style: TextInputStyle.Paragraph,
        required: false,
        max: 500,
      }),
      field('date', 'التاريخ (YYYY-MM-DD)', parts.date, { max: 10 }),
      field('time', 'الوقت (HH:MM بنظام 24 ساعة)', parts.time, { max: 5 })
    );

  await interaction.showModal(modal);
}

async function submitEdit(interaction, taskId, mode) {
  const userId = interaction.user.id;
  const ctx = await taskService.loadContext(taskId);
  taskService.assertCanAccess(ctx, userId);
  taskService.assertCanManage(ctx, userId);

  const title = interaction.fields.getTextInputValue('title').trim();
  const description = interaction.fields.getTextInputValue('description').trim();
  const dateText = normalizeDigits(interaction.fields.getTextInputValue('date').trim());
  const { hour, minute } = parseTime(interaction.fields.getTextInputValue('time'));

  // لو الموعد ما تغيّر نخليه كما هو (عشان تعديل العنوان فقط يشتغل حتى لو المهمة متأخرة)
  const original = formatDueParts(ctx.task.dueAt);
  const unchanged = dateText === original.date && hour === original.hour && minute === original.minute;
  const dueAt = unchanged ? new Date(ctx.task.dueAt) : parseDueDate({ date: dateText, hour, minute });

  const { task, dueChanged } = await taskService.updateTask(ctx.task, { title, description, dueAt });
  ctx.task = task;

  if (mode === 'pub' && interaction.isFromMessage()) {
    await interaction.update(taskView.publicMessage(ctx));
    await interaction.followUp({ content: '✏️ تم تعديل المهمة.', flags: EPHEMERAL });
  } else if (interaction.isFromMessage()) {
    await interaction.update(taskView.personalView(ctx, userId));
    if (task.scope === 'group') await refreshPublicMessage(interaction.client, ctx);
  } else {
    await interaction.reply({ content: '✏️ تم تعديل المهمة.', flags: EPHEMERAL });
  }

  // تغيير موعد مهمة جماعية يهم الكل، فنعلن عنه (والتذكير انعاد ضبطه في الخدمة)
  if (dueChanged && task.scope === 'group') {
    const stamp = Math.floor(dueAt.getTime() / 1000);
    await notifyChannel(
      interaction.client,
      task,
      `✏️ <@${userId}> غيّر موعد **${truncate(task.title, 100)}** إلى <t:${stamp}:F> (<t:${stamp}:R>)`
    );
  }
}

// ---------- الحذف (مع تأكيد) ----------

const confirmRow = (taskId, mode) =>
  new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`task:delconfirm:${taskId}:${mode}`)
      .setLabel('نعم، احذف')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`task:delcancel:${taskId}:${mode}`)
      .setLabel('إلغاء')
      .setStyle(ButtonStyle.Secondary)
  );

async function loadManageable(interaction, taskId) {
  const ctx = await taskService.loadContext(taskId);
  taskService.assertCanAccess(ctx, interaction.user.id);
  taskService.assertCanManage(ctx, interaction.user.id);
  return ctx;
}

async function askDelete(interaction, taskId, mode) {
  const { task } = await loadManageable(interaction, taskId);
  const content =
    `⚠️ تحذف المهمة **${truncate(task.title, 100)}**؟` +
    (task.scope === 'group' ? ' بتنحذف عند كل أعضاء المجموعة.' : '');
  const row = confirmRow(task._id, mode);

  if (mode === 'per') {
    // الرسالة شخصية، فنبدّلها بالتأكيد في مكانها
    await interaction.update({ content, embeds: [], components: [row] });
  } else {
    // الرسالة عامة، فالتأكيد يطلع لك لحالك
    await interaction.reply({ content, components: [row], flags: EPHEMERAL });
  }
}

async function confirmDelete(interaction, taskId) {
  const ctx = await loadManageable(interaction, taskId);
  await taskService.softDelete(ctx.task._id);

  await interaction.update({
    content: `🗑️ تم حذف المهمة **${truncate(ctx.task.title, 100)}**.`,
    embeds: [],
    components: [],
  });

  // نقفل الرسالة العامة عشان ما يضغط أحد على أزرارها
  if (ctx.task.channelId && ctx.task.messageId) {
    try {
      const channel = await interaction.client.channels.fetch(ctx.task.channelId);
      const message = await channel.messages.fetch(ctx.task.messageId);
      await message.edit({
        content: `🗑️ ~~${truncate(ctx.task.title, 100)}~~ — تم حذف هذه المهمة.`,
        embeds: [],
        components: [],
      });
    } catch (err) {
      console.warn(`Could not close public message for task ${ctx.task._id}: ${err.message}`);
    }
  }
}

async function cancelDelete(interaction, taskId, mode) {
  if (mode === 'per') {
    const ctx = await taskService.loadContext(taskId);
    taskService.assertCanAccess(ctx, interaction.user.id);
    return interaction.update({ content: null, ...taskView.personalView(ctx, interaction.user.id) });
  }
  return interaction.update({ content: 'تم الإلغاء.', components: [] });
}

// ---------- زر ✅ داخل التذكير ----------

async function handleReminderDone(interaction, taskId, where) {
  const userId = interaction.user.id;
  const ctx = await taskService.loadContext(taskId);
  taskService.assertCanAccess(ctx, userId);
  ctx.task = await taskService.setCompleted(ctx.task._id, userId, true);

  if (where === 'dm') {
    // الرسالة لك لحالك: نعطّل الزر ونكمل
    const rows = interaction.message.components.map((row) => {
      const builder = ActionRowBuilder.from(row.toJSON());
      for (const component of builder.components) {
        if (component.data.custom_id === interaction.customId) {
          component.setDisabled(true).setStyle(ButtonStyle.Secondary).setLabel('✅ تم');
        }
      }
      return builder;
    });
    await interaction.update({ components: rows });
  } else {
    // رسالة القناة مشتركة، فنرد عليك لحالك ونخلي الزر للباقين
    await interaction.reply({
      content: `✅ سجّلت إنهاءك لـ **${truncate(ctx.task.title, 100)}**.`,
      flags: EPHEMERAL,
    });
  }

  if (ctx.task.scope === 'group') await refreshPublicMessage(interaction.client, ctx);
}

async function componentHandler(interaction) {
  const [, action, ...args] = interaction.customId.split(':');

  switch (action) {
    case 'done':
    case 'undone':
      return handlePublicButton(interaction, args[0], action === 'done');
    case 'toggle':
      return handlePersonalToggle(interaction, args[0]);
    case 'who':
      return showWho(interaction, args[0]);
    case 'next':
      return showNext(interaction, args);
    case 'rdone':
      return handleReminderDone(interaction, args[0], args[1]);
    case 'edit':
      return openEditModal(interaction, args[0], args[1]);
    case 'editmodal':
      return submitEdit(interaction, args[0], args[1]);
    case 'delete':
      return askDelete(interaction, args[0], args[1]);
    case 'delconfirm':
      return confirmDelete(interaction, args[0]);
    case 'delcancel':
      return cancelDelete(interaction, args[0], args[1]);
    default:
      throw new UserError('هذا الزر لم يعد فعّال.');
  }
}

module.exports = { data, execute, autocomplete, componentHandler };
