const { Schema, model } = require('mongoose');

const groupSchema = new Schema(
  {
    guildId: { type: String, required: true },
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 50 },
    createdBy: { type: String, required: true },
    reminderChannelId: { type: String, required: true },
    admins: { type: [String], default: [] }, // المنشئ + اللي يرقّيهم
    members: { type: [String], default: [] }, // المشرفون دايماً أعضاء
  },
  { timestamps: true }
);

// الاسم فريد داخل السيرفر (بدون حساسية لحالة الأحرف)
groupSchema.index({ guildId: 1, name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });
groupSchema.index({ guildId: 1, members: 1 });

module.exports = model('Group', groupSchema);
