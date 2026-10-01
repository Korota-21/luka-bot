const fs = require('node:fs');
const path = require('node:path');

// يقرأ كل ملفات الأوامر من مجلد commands
// كل ملف لازم يصدّر { data, execute } وممكن يضيف autocomplete و componentHandler
function loadCommands() {
  const dir = path.join(__dirname, '..', 'commands');
  const commands = new Map();

  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    const command = require(path.join(dir, file));
    if (!command.data || !command.execute) {
      console.warn(`Skipping ${file}: missing "data" or "execute"`);
      continue;
    }
    commands.set(command.data.name, command);
  }
  return commands;
}

module.exports = { loadCommands };
