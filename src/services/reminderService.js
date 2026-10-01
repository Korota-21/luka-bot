const taskService = require('./taskService');
const reminderView = require('../utils/reminderView');

const CHUNK_SIZE = 10; // مهام في الرسالة الواحدة (صفين أزرار)
let running = false;

function chunks(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

const byDueDate = (a, b) => new Date(a.ctx.task.dueAt) - new Date(b.ctx.task.dueAt);

async function sendChannelBatches(client, batches) {
  for (const [channelId, items] of batches) {
    let channel;
    try {
      channel = await client.channels.fetch(channelId);
    } catch (err) {
      console.warn(`Reminder channel ${channelId} is unavailable: ${err.message}`);
      continue;
    }

    for (const chunk of chunks(items.sort(byDueDate), CHUNK_SIZE)) {
      try {
        await channel.send(reminderView.channelReminder(chunk));
      } catch (err) {
        console.warn(`Failed to send reminder to channel ${channelId}: ${err.message}`);
      }
    }
  }
}

async function sendDmBatches(client, batches) {
  for (const [userId, { items, channelId }] of batches) {
    for (const chunk of chunks(items.sort(byDueDate), CHUNK_SIZE)) {
      try {
        const user = await client.users.fetch(userId);
        await user.send(reminderView.dmReminder(chunk));
      } catch (err) {
        console.warn(`Could not DM user ${userId}: ${err.message}`);
        try {
          const channel = await client.channels.fetch(channelId);
          await channel.send(reminderView.dmFallback(userId, chunk.length));
        } catch (fallbackErr) {
          console.warn(`DM fallback failed for user ${userId}: ${fallbackErr.message}`);
        }
      }
    }
  }
}

// يفحص المهام القريبة ويرسل التذكيرات. آمن للتشغيل المتكرر (كل دقيقة)
async function runCheck(client) {
  if (running) return;
  running = true;

  try {
    const due = await taskService.findDueForReminder(new Date());
    if (!due.length) return;

    // نحجز كل مهمة قبل الإرسال: مرة وحدة فقط حتى لو تكرر الفحص
    const claimed = [];
    for (const task of due) {
      if (await taskService.claimReminder(task._id)) claimed.push(task);
    }
    if (!claimed.length) return;

    const contexts = await taskService.hydrate(claimed);
    const channelBatches = new Map(); // channelId -> [{ ctx, pending }]
    const dmBatches = new Map(); // userId -> { items, channelId }

    for (const ctx of contexts) {
      const { task, group } = ctx;

      if (task.scope === 'group') {
        const pending = group.members.filter((id) => !task.completedBy.includes(id));
        if (!pending.length) continue; // الكل خلّصها
        if (!channelBatches.has(group.reminderChannelId)) channelBatches.set(group.reminderChannelId, []);
        channelBatches.get(group.reminderChannelId).push({ ctx, pending });
      } else {
        if (task.completedBy.includes(task.createdBy)) continue;
        if (!dmBatches.has(task.createdBy)) {
          dmBatches.set(task.createdBy, { items: [], channelId: group.reminderChannelId });
        }
        dmBatches.get(task.createdBy).items.push({ ctx });
      }
    }

    await sendChannelBatches(client, channelBatches);
    await sendDmBatches(client, dmBatches);
    console.log(`Processed reminders for ${claimed.length} task(s)`);
  } catch (err) {
    console.error('Reminder check failed:', err);
  } finally {
    running = false;
  }
}

module.exports = { runCheck };
