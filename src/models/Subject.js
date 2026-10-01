const { Schema, model } = require('mongoose');

const subjectSchema = new Schema(
  {
    groupId: { type: Schema.Types.ObjectId, ref: 'Group', required: true },
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 60 },
    doctor: { type: String, trim: true, maxlength: 60, default: null },
    createdBy: { type: String, required: true },
  },
  { timestamps: true }
);

subjectSchema.index({ groupId: 1, name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });

module.exports = model('Subject', subjectSchema);
