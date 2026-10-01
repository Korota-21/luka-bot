const { DateTime } = require('luxon');
const config = require('../config');
const { UserError } = require('./errors');

// luxon: weekday 1 = الإثنين ... 7 = الأحد
const ARABIC_DAYS = ['الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت', 'الأحد'];

// يحوّل الأرقام العربية (٠-٩) والفارسية (۰-۹) إلى أرقام إنجليزية
const normalizeDigits = (s) =>
  s
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));

// يبني موعد التسليم بتوقيت config.timezone ويرجّعه كـ Date (UTC عند التخزين)
function parseDueDate({ date, hour, minute = 0 }) {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(normalizeDigits(date.trim()));
  if (!match) {
    throw new UserError('صيغة التاريخ غلط. استخدم YYYY-MM-DD مثل 2026-10-15، أو اختر من القائمة المقترحة.');
  }

  const due = DateTime.fromObject(
    { year: +match[1], month: +match[2], day: +match[3], hour, minute },
    { zone: config.timezone }
  );
  if (!due.isValid) throw new UserError('هذا التاريخ غير صحيح.');
  if (due.toMillis() <= Date.now()) throw new UserError('الموعد لازم يكون في المستقبل.');

  return due.toUTC().toJSDate();
}

// يفكك موعد مخزن (UTC) إلى تاريخ ووقت بتوقيت config.timezone (للـ Modal)
function formatDueParts(date) {
  const due = DateTime.fromJSDate(new Date(date)).setZone(config.timezone).setLocale('en');
  return { date: due.toFormat('yyyy-MM-dd'), time: due.toFormat('HH:mm'), hour: due.hour, minute: due.minute };
}

// اقتراحات autocomplete: الأيام الـ 25 الجاية
function suggestDates(query = '', days = 25) {
  const today = DateTime.now().setZone(config.timezone).setLocale('en').startOf('day');
  const q = normalizeDigits(query.trim());
  const out = [];

  for (let i = 0; i < days; i++) {
    const day = today.plus({ days: i });
    const iso = day.toFormat('yyyy-MM-dd');
    const prefix = i === 0 ? 'اليوم، ' : i === 1 ? 'غداً، ' : '';
    const label = `${iso} — ${prefix}${ARABIC_DAYS[day.weekday - 1]}`;
    if (!q || label.includes(q)) out.push({ name: label, value: iso });
  }
  return out;
}

module.exports = { parseDueDate, suggestDates, formatDueParts, normalizeDigits };
