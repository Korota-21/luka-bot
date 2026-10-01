const Subject = require('../models/Subject');
const Task = require('../models/Task');
const { UserError } = require('../utils/errors');
const { escapeRegex, isObjectId } = require('../utils/text');
const { requireAdmin } = require('./groupService');

async function addSubject({ group, userId, name, doctor }) {
  requireAdmin(group, userId);
  try {
    return await Subject.create({
      groupId: group._id,
      name,
      doctor: doctor || null,
      createdBy: userId,
    });
  } catch (err) {
    if (err?.code === 11000) throw new UserError('هذي المادة موجودة بالفعل في المجموعة.');
    if (err.name === 'ValidationError') throw new UserError('اسم المادة لازم يكون بين 2 و 60 حرف.');
    throw err;
  }
}

// المواد بترتيب الإضافة
async function listForGroups(groupIds) {
  return Subject.find({ groupId: { $in: groupIds } }).sort({ createdAt: 1 }).lean();
}

async function searchSubjects({ groupId, query = '', limit = 25 }) {
  const filter = { groupId };
  if (query) filter.name = { $regex: escapeRegex(query), $options: 'i' };
  return Subject.find(filter).sort({ createdAt: 1 }).limit(limit).lean();
}

async function removeSubject({ group, userId, subjectId }) {
  requireAdmin(group, userId);
  if (!isObjectId(subjectId)) throw new UserError('اختر المادة من القائمة المقترحة.');
  const subject = await Subject.findOneAndDelete({ _id: subjectId, groupId: group._id });
  if (!subject) throw new UserError('هذي المادة غير موجودة في المجموعة.');
  const { deletedCount } = await Task.deleteMany({ subjectId: subject._id });
  return { subject, deletedTasks: deletedCount };
}

module.exports = { addSubject, listForGroups, searchSubjects, removeSubject };
