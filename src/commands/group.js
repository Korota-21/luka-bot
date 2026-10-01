const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  InteractionContextType,
} = require('discord.js');
const groupService = require('../services/groupService');
const subjectService = require('../services/subjectService');
const { UserError } = require('../utils/errors');
const { truncate, formatMentions } = require('../utils/text');

const COLOR = 0x5865f2;
const EPHEMERAL = MessageFlags.Ephemeral;
const NO_PINGS = { parse: [] };

// ---------- تعريف الأمر ----------

const groupOption = (o) =>
  o.setName('group').setDescription('اختر المجموعة').setAutocomplete(true).setRequired(true);

const channelOption = (o) =>
  o
    .setName('channel')
    .setDescription('قناة تذكيرات المهام العامة')
    .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    .setRequired(true);

const userOption = (o) => o.setName('user').setDescription('العضو').setRequired(true);

const data = new SlashCommandBuilder()
  .setName('group')
  .setDescription('إدارة المجموعات (مثل: ترم 2 ماستر)')
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((s) =>
    s
      .setName('create')
      .setDescription('إنشاء مجموعة جديدة')
      .addStringOption((o) =>
        o.setName('name').setDescription('اسم المجموعة').setRequired(true).setMinLength(2).setMaxLength(50)
      )
      .addChannelOption(channelOption)
  )
  .addSubcommand((s) => s.setName('list').setDescription('عرض كل مجموعات السيرفر'))
  .addSubcommand((s) => s.setName('join').setDescription('الانضمام لمجموعة').addStringOption(groupOption))
  .addSubcommand((s) => s.setName('leave').setDescription('مغادرة مجموعة').addStringOption(groupOption))
  .addSubcommand((s) => s.setName('info').setDescription('تفاصيل مجموعة').addStringOption(groupOption))
  .addSubcommand((s) =>
    s
      .setName('set-channel')
      .setDescription('تغيير قناة التذكيرات (للمشرفين)')
      .addStringOption(groupOption)
      .addChannelOption(channelOption)
  )
  .addSubcommand((s) =>
    s
      .setName('promote')
      .setDescription('ترقية عضو إلى مشرف (للمنشئ فقط)')
      .addStringOption(groupOption)
      .addUserOption(userOption)
  )
  .addSubcommand((s) =>
    s
      .setName('demote')
      .setDescription('سحب الإشراف من عضو (للمنشئ فقط)')
      .addStringOption(groupOption)
      .addUserOption(userOption)
  )
  .addSubcommand((s) =>
    s.setName('delete').setDescription('حذف مجموعة مع موادها (للمنشئ فقط)').addStringOption(groupOption)
  );

// ---------- مساعدات ----------

const getGroup = (interaction) =>
  groupService.getGroupOrThrow(interaction.options.getString('group', true), interaction.guildId);

// يتأكد إن البوت يقدر يرسل في القناة المختارة
async function resolveChannel(interaction) {
  const picked = interaction.options.getChannel('channel', true);
  const channel = await interaction.guild.channels.fetch(picked.id).catch(() => null);
  if (!channel) throw new UserError('ما قدرت أوصل لهذي القناة.');

  const me = interaction.guild.members.me ?? (await interaction.guild.members.fetchMe());
  const perms = channel.permissionsFor(me);
  const needed = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.EmbedLinks,
  ];
  if (!perms?.has(needed)) {
    throw new UserError(
      `البوت يحتاج صلاحيات (عرض القناة، إرسال الرسائل، تضمين الروابط) في <#${channel.id}>.`
    );
  }
  return channel;
}

function getTargetUser(interaction) {
  const user = interaction.options.getUser('user', true);
  if (user.bot) throw new UserError('ما تقدر تختار بوت.');
  return user;
}

// ---------- الأوامر الفرعية ----------

const handlers = {
  async create(interaction) {
    const name = interaction.options.getString('name', true);
    const channel = await resolveChannel(interaction);
    const group = await groupService.createGroup({
      guildId: interaction.guildId,
      name,
      userId: interaction.user.id,
      channelId: channel.id,
    });

    const embed = new EmbedBuilder()
      .setColor(COLOR)
      .setTitle(`✅ تم إنشاء المجموعة: ${group.name}`)
      .addFields(
        { name: 'قناة التذكيرات', value: `<#${channel.id}>`, inline: true },
        { name: 'المشرف', value: `<@${interaction.user.id}>`, inline: true }
      )
      .setFooter({ text: 'الخطوة الجاية: أضف المواد بـ /subject add، والزملاء ينضمون بـ /group join' });

    await interaction.reply({ embeds: [embed], allowedMentions: NO_PINGS });
  },

  async list(interaction) {
    const groups = await groupService.listGroupsWithCounts(interaction.guildId);
    if (!groups.length) {
      return interaction.reply({
        content: 'ما فيه مجموعات بعد. ابدأ بـ `/group create`.',
        flags: EPHEMERAL,
      });
    }

    const userId = interaction.user.id;
    const lines = groups
      .slice(0, 25)
      .map(
        (g) =>
          `${g.members.includes(userId) ? '✅' : '▫️'} **${g.name}** — ${g.members.length} عضو • ${g.subjectCount} مادة`
      );
    if (groups.length > 25) lines.push(`... و${groups.length - 25} مجموعات أخرى`);

    const embed = new EmbedBuilder()
      .setColor(COLOR)
      .setTitle('📂 مجموعات السيرفر')
      .setDescription(lines.join('\n'))
      .setFooter({ text: '✅ = أنت عضو فيها' });

    await interaction.reply({ embeds: [embed], flags: EPHEMERAL });
  },

  async join(interaction) {
    const group = await getGroup(interaction);
    await groupService.join(group, interaction.user.id);
    await interaction.reply({
      content: `🎉 <@${interaction.user.id}> انضم إلى **${group.name}**`,
      allowedMentions: NO_PINGS,
    });
  },

  async leave(interaction) {
    const group = await getGroup(interaction);
    await groupService.leave(group, interaction.user.id);
    await interaction.reply({ content: `👋 غادرت **${group.name}**.`, flags: EPHEMERAL });
  },

  async info(interaction) {
    const group = await getGroup(interaction);
    const subjects = await subjectService.listForGroups([group._id]);

    const subjectsText = subjects.length
      ? subjects.map((s) => `• **${s.name}**${s.doctor ? ` — ${s.doctor}` : ''}`).join('\n')
      : '_ما فيه مواد بعد_';

    const embed = new EmbedBuilder()
      .setColor(COLOR)
      .setTitle(`📂 ${group.name}`)
      .addFields(
        { name: 'المنشئ', value: `<@${group.createdBy}>`, inline: true },
        { name: 'قناة التذكيرات', value: `<#${group.reminderChannelId}>`, inline: true },
        { name: 'المشرفون', value: formatMentions(group.admins) },
        { name: `الأعضاء (${group.members.length})`, value: formatMentions(group.members) },
        { name: `المواد (${subjects.length})`, value: truncate(subjectsText, 1024) }
      );

    await interaction.reply({ embeds: [embed], flags: EPHEMERAL, allowedMentions: NO_PINGS });
  },

  async 'set-channel'(interaction) {
    const group = await getGroup(interaction);
    groupService.requireAdmin(group, interaction.user.id);
    const channel = await resolveChannel(interaction);
    await groupService.setChannel(group, interaction.user.id, channel.id);
    await interaction.reply({
      content: `📢 تذكيرات **${group.name}** صارت في <#${channel.id}>.`,
      flags: EPHEMERAL,
    });
  },

  async promote(interaction) {
    const group = await getGroup(interaction);
    const target = getTargetUser(interaction);
    await groupService.promote(group, interaction.user.id, target.id);
    await interaction.reply({
      content: `⭐ <@${target.id}> صار مشرف في **${group.name}**.`,
      allowedMentions: NO_PINGS,
    });
  },

  async demote(interaction) {
    const group = await getGroup(interaction);
    const target = getTargetUser(interaction);
    await groupService.demote(group, interaction.user.id, target.id);
    await interaction.reply({
      content: `<@${target.id}> ما عاد مشرف في **${group.name}**.`,
      allowedMentions: NO_PINGS,
    });
  },

  async delete(interaction) {
    const group = await getGroup(interaction);
    groupService.requireCreator(group, interaction.user.id);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`group:delete-confirm:${group._id}:${interaction.user.id}`)
        .setLabel('نعم، احذف')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`group:delete-cancel:${group._id}:${interaction.user.id}`)
        .setLabel('إلغاء')
        .setStyle(ButtonStyle.Secondary)
    );

    await interaction.reply({
      content: `⚠️ متأكد تبغى تحذف **${group.name}** مع كل مواده ومهامه؟ ما يمكن التراجع.`,
      components: [row],
      flags: EPHEMERAL,
    });
  },
};

// ---------- التنفيذ والـ autocomplete والأزرار ----------

async function execute(interaction) {
  await handlers[interaction.options.getSubcommand()](interaction);
}

async function autocomplete(interaction) {
  const focused = interaction.options.getFocused(true);
  if (focused.name !== 'group') return interaction.respond([]);

  const sub = interaction.options.getSubcommand();
  const filter =
    sub === 'join'
      ? { notMemberId: interaction.user.id }
      : sub === 'info'
        ? {}
        : { memberId: interaction.user.id };

  const groups = await groupService.searchGroups({
    guildId: interaction.guildId,
    query: focused.value,
    ...filter,
  });
  await interaction.respond(groups.map((g) => ({ name: truncate(g.name, 100), value: String(g._id) })));
}

// customId: group:<action>:<groupId>:<ownerUserId>
async function componentHandler(interaction) {
  const [, action, groupId, ownerId] = interaction.customId.split(':');
  if (interaction.user.id !== ownerId) throw new UserError('هذا الزر مو لك.');

  if (action === 'delete-cancel') {
    return interaction.update({ content: 'تم الإلغاء.', components: [] });
  }

  if (action === 'delete-confirm') {
    const group = await groupService.getGroupOrThrow(groupId, interaction.guildId);
    await groupService.deleteGroup(group, interaction.user.id);
    return interaction.update({
      content: `🗑️ تم حذف المجموعة **${group.name}** مع موادها ومهامها.`,
      components: [],
    });
  }
}

module.exports = { data, execute, autocomplete, componentHandler };
