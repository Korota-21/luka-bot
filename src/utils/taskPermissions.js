// مين يقدر يعدّل/يحذف المهمة:
// - الشخصية: منشئها فقط
// - الجماعية: منشئها أو مشرفو المجموعة
function canManageTask(task, group, userId) {
  if (task.scope === 'personal') return task.createdBy === userId;
  return task.createdBy === userId || group.admins.includes(userId);
}

module.exports = { canManageTask };
