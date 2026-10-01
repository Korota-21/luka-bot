const {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  InteractionContextType,
} = require('discord.js');
const groupService = require('../services/groupService');
const subjectService = require('../services/subjectService');
const { truncate } = require('../utils/text');

const COLOR = 0x57f287;
const EPHEMERAL = MessageFlags.Ephemeral;
const NO_PINGS = { parse: [] };

const groupOption = (o) =>
  o.setName('group').setDescription('اختر المجموعة').setAutocomplete(true).setRequired(true);

const data = new SlashCommandBuilder()
  .setName('subject')
  .setDescription('إدارة المواد داخل المجموعات')
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((s) =>
    s
      .setName('add')
      .setDescription('إضافة مادة لمجموعة (للمشرفين)')
      .addStringOption(groupOption)
      .addStringOption((o) =>
        o.setName('name').setDescription('اسم المادة').setRequired(true).setMinLength(2).setMaxLength(60)
      )
      .addStringOption((o) => o.setName('doctor').setDescription('اسم الدكتور (اختياري)').setMaxLength(60))
  )
  .addSubcommand((s) =>
    s
      .setName('list')
      .setDescription('عرض المواد (بدون اختيار مجموعة يعرض كل مجموعاتك)')
      .addStringOption((o) => groupOption(o).setRequired(false))
  )
  .addSubcommand((s) =>
    s
      .setName('remove')
      .setDescription('حذف مادة (للمشرفين)')
      .addStringOption(groupOption)
      .addStringOption((o) =>
        o.setName('subject').setDescription('اختر المادة').setAutocomplete(true).setRequired(true)
      )
  );

const getGroup = (interaction) =>
  groupService.getGroupOrThrow(interaction.options.getString('group', true), interaction.guildId);

const handlers = {
  async add(interaction) {
    const group = await getGroup(interaction);
    const subject = await subjectService.addSubject({
      group,
      userId: interaction.user.id,
      name: interaction.options.getString('name', true),
      doctor: interaction.options.getString('doctor'),
    });

    await interaction.reply({
      content: `📚 تمت إضافة المادة **${subject.name}** إلى **${group.name}**${subject.doctor ? ` (${subject.doctor})` : ''}.`,
      allowedMentions: NO_PINGS,
    });
  },

  async list(interaction) {
    const groupId = interaction.options.getString('group');
    const groups = groupId
      ? [await groupService.getGroupOrThrow(groupId, interaction.guildId)]
      : await groupService.searchGroups({
          guildId: interaction.guildId,
          memberId: interaction.user.id,
          limit: 25,
        });

    if (!groups.length) {
      return interaction.reply({
        content: 'أنت مو عضو في أي مجموعة. شوف `/group list` وانضم بـ `/group join`.',
        flags: EPHEMERAL,
      });
    }

    const subjects = await subjectService.listForGroups(groups.map((g) => g._id));
    const embed = new EmbedBuilder().setColor(COLOR).setTitle('📚 المواد');

    for (const group of groups) {
      const items = subjects.filter((s) => String(s.groupId) === String(group._id));
      const value = items.length
        ? items.map((s, i) => `${i + 1}. **${s.name}**${s.doctor ? ` — ${s.doctor}` : ''}`).join('\n')
        : '_ما فيه مواد بعد_';
      embed.addFields({ name: truncate(group.name, 256), value: truncate(value, 1024) });
    }

    await interaction.reply({ embeds: [embed], flags: EPHEMERAL });
  },

  async remove(interaction) {
    const group = await getGroup(interaction);
    const { subject, deletedTasks } = await subjectService.removeSubject({
      group,
      userId: interaction.user.id,
      subjectId: interaction.options.getString('subject', true),
    });

    await interaction.reply({
      content: `🗑️ تم حذف المادة **${subject.name}** من **${group.name}**${deletedTasks ? ` مع ${deletedTasks} مهمة` : ''}.`,
      flags: EPHEMERAL,
    });
  },
};

async function execute(interaction) {
  await handlers[interaction.options.getSubcommand()](interaction);
}

async function autocomplete(interaction) {
  const focused = interaction.options.getFocused(true);

  if (focused.name === 'group') {
    const groups = await groupService.searchGroups({
      guildId: interaction.guildId,
      query: focused.value,
      memberId: interaction.user.id,
    });
    return interaction.respond(groups.map((g) => ({ name: truncate(g.name, 100), value: String(g._id) })));
  }

  if (focused.name === 'subject') {
    // المجموعة تتحقق منها (نفس السيرفر) قبل عرض موادها
    const group = await groupService
      .getGroupOrThrow(interaction.options.getString('group'), interaction.guildId)
      .catch(() => null);
    if (!group) return interaction.respond([]);

    const subjects = await subjectService.searchSubjects({ groupId: group._id, query: focused.value });
    return interaction.respond(
      subjects.map((s) => ({ name: truncate(s.name, 100), value: String(s._id) }))
    );
  }

  return interaction.respond([]);
}

module.exports = { data, execute, autocomplete };
