const Task = require('../models/Task');
const Group = require('../models/Group');
const Subject = require('../models/Subject');
const { UserError } = require('../utils/errors');
const { isObjectId } = require('../utils/text');
const { requireMember } = require('./groupService');
const { canManageTask } = require('../utils/taskPermissions');
const { REMINDER_BEFORE_MS } = require('../constants');

async function getSubjectOrThrow(group, subjectId) {
  if (!isObjectId(subjectId)) throw new UserError('اختر المادة من القائمة المقترحة.');
  const subject = await Subject.findOne({ _id: subjectId, groupId: group._id });
  if (!subject) throw new UserError('هذي المادة غير موجودة في المجموعة.');
  return subject;
}

async function createTask({ group, subject, userId, scope, title, description, dueAt }) {
  requireMember(group, userId);
  if (scope === 'group' && !group.admins.includes(userId)) {
    throw new UserError('المهام الجماعية للمشرفين فقط. تقدر تضيفها كمهمة شخصية (لي فقط).');
  }

  try {
    return await Task.create({
      guildId: group.guildId,
      groupId: group._id,
      subjectId: subject._id,
      title,
      description: description || '',
      scope,
      createdBy: userId,
      dueAt,
      // لو الموعد أقرب من نافذة التذكير، ما نذكّر فوراً (المستخدم يعرفها للتو)
      remindersSent: { sixHours: dueAt.getTime() - Date.now() <= REMINDER_BEFORE_MS },
    });
  } catch (err) {
    if (err.name === 'ValidationError') throw new UserError('عنوان المهمة لازم يكون بين 2 و 100 حرف.');
    throw err;
  }
}

async function attachMessage(taskId, channelId, messageId) {
  await Task.updateOne({ _id: taskId }, { channelId, messageId });
}

// يحمّل المهمة مع مجموعتها ومادتها (للأزرار)
async function loadContext(taskId) {
  if (!isObjectId(taskId)) throw new UserError('هذي المهمة غير صالحة.');
  const task = await Task.findOne({ _id: taskId, deleted: false });
  if (!task) throw new UserError('هذي المهمة محذوفة أو غير موجودة.');

  const [group, subject] = await Promise.all([Group.findById(task.groupId), Subject.findById(task.subjectId)]);
  if (!group) throw new UserError('مجموعة هذي المهمة محذوفة.');
  return { task, group, subject };
}

function assertCanAccess({ task, group }, userId) {
  if (task.scope === 'personal') {
    if (task.createdBy !== userId) throw new UserError('هذي مهمة شخصية لشخص ثاني.');
  } else if (!group.members.includes(userId)) {
    throw new UserError(`لازم تكون عضو في **${group.name}** عشان تتعامل مع مهامها.`);
  }
}

function assertCanManage({ task, group }, userId) {
  if (!canManageTask(task, group, userId)) {
    throw new UserError('التعديل والحذف لمنشئ المهمة ومشرفي المجموعة فقط.');
  }
}

// تعديل المهمة. لو تغيّر الموعد نعيد ضبط التذكيرات عشان ترجع تنرسل بالموعد الجديد
async function updateTask(task, { title, description, dueAt }) {
  const dueChanged = new Date(task.dueAt).getTime() !== dueAt.getTime();
  const set = { title, description };
  if (dueChanged) {
    set.dueAt = dueAt;
    // نعيد ضبط التذكير عشان يرجع يذكّر بالموعد الجديد (إلا لو صار داخل النافذة، والإشعار وصلهم)
    set['remindersSent.sixHours'] = dueAt.getTime() - Date.now() <= REMINDER_BEFORE_MS;
  }

  try {
    const updated = await Task.findOneAndUpdate(
      { _id: task._id, deleted: false },
      { $set: set },
      { new: true, runValidators: true }
    );
    if (!updated) throw new UserError('هذي المهمة محذوفة أو غير موجودة.');
    return { task: updated, dueChanged };
  } catch (err) {
    if (err.name === 'ValidationError') throw new UserError('عنوان المهمة لازم يكون بين 2 و 100 حرف.');
    throw err;
  }
}

// soft delete: تنخفي من كل العروض وتقدر ترجعها من قاعدة البيانات لو انحذفت بالغلط
async function softDelete(taskId) {
  const res = await Task.updateOne({ _id: taskId, deleted: false }, { deleted: true, deletedAt: new Date() });
  if (!res.modifiedCount) throw new UserError('هذي المهمة محذوفة بالفعل.');
}

// إنهاء/تراجع لشخص واحد فقط (ذري، بدون ما نلمس حالة الباقين)
async function setCompleted(taskId, userId, done) {
  const update = done ? { $addToSet: { completedBy: userId } } : { $pull: { completedBy: userId } };
  const task = await Task.findOneAndUpdate({ _id: taskId, deleted: false }, update, { new: true });
  if (!task) throw new UserError('هذي المهمة محذوفة أو غير موجودة.');
  return task;
}

// المهام اللي يشوفها المستخدم: الجماعية في مجموعاته + الشخصية حقته
async function queryTasks({ guildId, userId, groupId, subjectId, status = 'pending', scope = 'all' }) {
  const groups = await Group.find({ guildId, members: userId }).select('_id').lean();
  const groupIds = groups.map((g) => g._id);
  if (!groupIds.length) return [];

  const filter = { deleted: false, groupId: { $in: groupIds } };

  if (scope === 'personal') {
    Object.assign(filter, { scope: 'personal', createdBy: userId });
  } else if (scope === 'group') {
    filter.scope = 'group';
  } else {
    filter.$or = [{ scope: 'group' }, { scope: 'personal', createdBy: userId }];
  }

  if (groupId) {
    if (!isObjectId(groupId) || !groupIds.some((id) => String(id) === groupId)) {
      throw new UserError('اختر مجموعة أنت عضو فيها.');
    }
    filter.groupId = groupId;
  }

  if (subjectId) {
    if (!groupId) throw new UserError('اختر المجموعة أولاً عشان تفلتر بالمادة.');
    if (!isObjectId(subjectId)) throw new UserError('اختر المادة من القائمة المقترحة.');
    filter.subjectId = subjectId;
  }

  if (status === 'pending') filter.completedBy = { $ne: userId };
  if (status === 'done') filter.completedBy = userId;

  const tasks = await Task.find(filter).sort({ dueAt: 1, _id: 1 }).limit(500).lean();

  // المتبقي: الأقرب موعداً أولاً (المتأخرة تطلع فوق طبيعياً)
  // المنتهي: الأحدث أولاً. "الكل": المتبقي ثم المنتهي
  if (status === 'done') return tasks.reverse();
  if (status === 'all') {
    const pending = tasks.filter((t) => !t.completedBy.includes(userId));
    const done = tasks.filter((t) => t.completedBy.includes(userId)).reverse();
    return [...pending, ...done];
  }
  return tasks;
}

// يضيف المجموعة والمادة لكل مهمة (للعرض)
async function hydrate(tasks) {
  const groupIds = [...new Set(tasks.map((t) => String(t.groupId)))];
  const subjectIds = [...new Set(tasks.map((t) => String(t.subjectId)))];

  const [groups, subjects] = await Promise.all([
    Group.find({ _id: { $in: groupIds } }).lean(),
    Subject.find({ _id: { $in: subjectIds } }).lean(),
  ]);
  const groupMap = new Map(groups.map((g) => [String(g._id), g]));
  const subjectMap = new Map(subjects.map((s) => [String(s._id), s]));

  return tasks
    .map((task) => ({
      task,
      group: groupMap.get(String(task.groupId)),
      subject: subjectMap.get(String(task.subjectId)),
    }))
    .filter((ctx) => ctx.group);
}

// المهام اللي دخلت نافذة التذكير ولسا ما انرسل لها
async function findDueForReminder(now = new Date()) {
  return Task.find({
    deleted: false,
    'remindersSent.sixHours': false,
    dueAt: { $gt: now, $lte: new Date(now.getTime() + REMINDER_BEFORE_MS) },
  }).lean();
}

// "نحجز" التذكير بشكل ذري قبل الإرسال عشان ما يتكرر (حتى لو تداخل فحصان)
async function claimReminder(taskId) {
  const res = await Task.updateOne(
    { _id: taskId, deleted: false, 'remindersSent.sixHours': false },
    { $set: { 'remindersSent.sixHours': true } }
  );
  return res.modifiedCount === 1;
}

module.exports = {
  findDueForReminder,
  claimReminder,
  getSubjectOrThrow,
  createTask,
  attachMessage,
  loadContext,
  assertCanAccess,
  setCompleted,
  queryTasks,
  hydrate,
  assertCanManage,
  updateTask,
  softDelete,
};
