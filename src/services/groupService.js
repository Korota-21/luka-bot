const Group = require('../models/Group');
const Subject = require('../models/Subject');
const Task = require('../models/Task');
const { UserError } = require('../utils/errors');
const { escapeRegex, isObjectId } = require('../utils/text');

const isDuplicateKey = (err) => err?.code === 11000;

// ---------- القراءة والتحقق ----------

async function getGroupOrThrow(groupId, guildId) {
  if (!isObjectId(groupId)) throw new UserError('اختر المجموعة من القائمة المقترحة.');
  const group = await Group.findOne({ _id: groupId, guildId });
  if (!group) throw new UserError('هذي المجموعة غير موجودة.');
  return group;
}

const isMember = (group, userId) => group.members.includes(userId);

function requireMember(group, userId) {
  if (!isMember(group, userId)) {
    throw new UserError(`لازم تكون عضو في **${group.name}** أولاً (\`/group join\`).`);
  }
}

function requireAdmin(group, userId) {
  if (!group.admins.includes(userId)) {
    throw new UserError('هذا الأمر للمشرفين فقط.');
  }
}

function requireCreator(group, userId) {
  if (group.createdBy !== userId) {
    throw new UserError('هذا الأمر لمنشئ المجموعة فقط.');
  }
}

// للـ autocomplete: memberId = مجموعات أنا فيها، notMemberId = مجموعات ما انضممت لها
async function searchGroups({ guildId, query = '', memberId, notMemberId, limit = 25 }) {
  const filter = { guildId };
  if (query) filter.name = { $regex: escapeRegex(query), $options: 'i' };
  if (memberId) filter.members = memberId;
  if (notMemberId) filter.members = { $ne: notMemberId };
  return Group.find(filter).sort({ name: 1 }).limit(limit).lean();
}

async function listGroupsWithCounts(guildId) {
  const groups = await Group.find({ guildId }).sort({ name: 1 }).lean();
  if (!groups.length) return [];

  const counts = await Subject.aggregate([
    { $match: { groupId: { $in: groups.map((g) => g._id) } } },
    { $group: { _id: '$groupId', count: { $sum: 1 } } },
  ]);
  const byGroup = new Map(counts.map((c) => [String(c._id), c.count]));
  return groups.map((g) => ({ ...g, subjectCount: byGroup.get(String(g._id)) ?? 0 }));
}

// ---------- التعديل ----------

async function createGroup({ guildId, name, userId, channelId }) {
  try {
    return await Group.create({
      guildId,
      name,
      createdBy: userId,
      reminderChannelId: channelId,
      admins: [userId],
      members: [userId],
    });
  } catch (err) {
    if (isDuplicateKey(err)) throw new UserError('فيه مجموعة بنفس الاسم في السيرفر.');
    if (err.name === 'ValidationError') throw new UserError('اسم المجموعة لازم يكون بين 2 و 50 حرف.');
    throw err;
  }
}

async function join(group, userId) {
  if (isMember(group, userId)) throw new UserError('أنت عضو في هذي المجموعة بالفعل.');
  await Group.updateOne({ _id: group._id }, { $addToSet: { members: userId } });
}

async function leave(group, userId) {
  requireMember(group, userId);
  if (group.createdBy === userId) {
    throw new UserError('أنت منشئ المجموعة وما تقدر تغادرها. تقدر تحذفها بـ `/group delete`.');
  }
  await Group.updateOne({ _id: group._id }, { $pull: { members: userId, admins: userId } });
}

async function setChannel(group, actorId, channelId) {
  requireAdmin(group, actorId);
  await Group.updateOne({ _id: group._id }, { reminderChannelId: channelId });
}

async function promote(group, actorId, targetId) {
  requireCreator(group, actorId);
  if (!isMember(group, targetId)) throw new UserError('هذا الشخص مو عضو في المجموعة.');
  if (group.admins.includes(targetId)) throw new UserError('هذا الشخص مشرف بالفعل.');
  await Group.updateOne({ _id: group._id }, { $addToSet: { admins: targetId } });
}

async function demote(group, actorId, targetId) {
  requireCreator(group, actorId);
  if (targetId === group.createdBy) throw new UserError('ما تقدر تسحب صلاحيات المنشئ.');
  if (!group.admins.includes(targetId)) throw new UserError('هذا الشخص مو مشرف أصلاً.');
  await Group.updateOne({ _id: group._id }, { $pull: { admins: targetId } });
}

async function deleteGroup(group, actorId) {
  requireCreator(group, actorId);
  await Task.deleteMany({ groupId: group._id });
  await Subject.deleteMany({ groupId: group._id });
  await Group.deleteOne({ _id: group._id });
}

module.exports = {
  getGroupOrThrow,
  isMember,
  requireMember,
  requireAdmin,
  requireCreator,
  searchGroups,
  listGroupsWithCounts,
  createGroup,
  join,
  leave,
  setChannel,
  promote,
  demote,
  deleteGroup,
};
