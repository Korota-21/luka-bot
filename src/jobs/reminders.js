const cron = require('node-cron');
const { runCheck } = require('../services/reminderService');

// فحص كل دقيقة من الداتابيس (بدل setTimeout لكل مهمة) فما يضيع شي لو أعاد البوت التشغيل
function startReminderJob(client) {
  runCheck(client); // فحص فوري عند التشغيل يلتقط اللي فات أثناء التوقف
  cron.schedule('* * * * *', () => runCheck(client));
  console.log('Reminder job started (runs every minute)');
}

module.exports = { startReminderJob };
