const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// يمنع أسماء المواد/المجموعات من كسر تنسيق markdown
const escapeMd = (s) => s.replace(/([\\*_~`|>])/g, '\\$1');

const truncate = (s, max) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

const isObjectId = (s) => typeof s === 'string' && /^[a-f\d]{24}$/i.test(s);

// منشنات داخل Embed (ما ترسل إشعارات)
function formatMentions(ids, max = 20) {
  if (!ids.length) return '—';
  const shown = ids.slice(0, max).map((id) => `<@${id}>`).join(' ');
  return ids.length > max ? `${shown} +${ids.length - max}` : shown;
}

module.exports = { escapeRegex, escapeMd, truncate, isObjectId, formatMentions };
