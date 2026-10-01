const { Schema, model } = require('mongoose');

const taskSchema = new Schema(
  {
    guildId: { type: String, required: true },
    groupId: { type: Schema.Types.ObjectId, ref: 'Group', required: true },
    subjectId: { type: Schema.Types.ObjectId, ref: 'Subject', required: true },

    title: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
    description: { type: String, trim: true, maxlength: 500, default: '' },

    // personal: تخص المنشئ فقط | group: لكل أعضاء المجموعة
    scope: { type: String, enum: ['personal', 'group'], required: true },
    createdBy: { type: String, required: true },

    dueAt: { type: Date, required: true }, // UTC

    // "المنتهية" تُحسب لكل شخص على حدة
    completedBy: { type: [String], default: [] },

    // تُستخدم في مرحلة التذكيرات
    remindersSent: {
      sixHours: { type: Boolean, default: false },
    },

    // الرسالة العامة للمهام الجماعية (عشان نقدر نحدّثها)
    channelId: { type: String, default: null },
    messageId: { type: String, default: null },

    // soft delete
    deleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

taskSchema.index({ groupId: 1, deleted: 1, dueAt: 1 });
taskSchema.index({ createdBy: 1, deleted: 1, dueAt: 1 });
taskSchema.index({ subjectId: 1 });
taskSchema.index({ deleted: 1, 'remindersSent.sixHours': 1, dueAt: 1 });

module.exports = model('Task', taskSchema);
