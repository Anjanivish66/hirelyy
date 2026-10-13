const pool = require('../db');
const { isTransitionAllowed } = require('./applicationStatus');

const ICONS = { Shortlisted: '⭐', Interview: '📅', Selected: '🎉', Rejected: '❌', Applied: '📥' };

// Accepts "2026-08-22T14:30" (from <input type="datetime-local">) and returns a
// MySQL DATETIME string, or null if empty / invalid.
function toMysqlDateTime(value) {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  const p = n => String(n).padStart(2, '0');
  // value has no timezone, so keep exactly what the recruiter typed
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:00`;
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:00`;
}

// Shared by the recruiter and admin status endpoints.
// Returns { ok: true } or { error, code }.
async function changeApplicationStatus(applicationId, status, interviewAt) {
  const [[app]] = await pool.query(
    `SELECT a.*, l.title FROM applications a JOIN listings l ON l.id = a.listing_id WHERE a.id = ?`,
    [applicationId]
  );
  if (!app) return { error: 'Application not found.', code: 404 };
  if (!isTransitionAllowed(app.status, status)) {
    return { error: 'Please choose one of: Shortlisted, Interview, Selected or Rejected.', code: 400 };
  }

  const when = status === 'Interview' ? toMysqlDateTime(interviewAt) : null;

  if (status === app.status && !(status === 'Interview' && when)) {
    return { ok: true, unchanged: true };
  }

  await pool.query(
    'UPDATE applications SET status = ?, interview_at = ? WHERE id = ?',
    [status, status === 'Interview' ? when : app.interview_at, applicationId]
  );
  if (status !== app.status) {
    await pool.query('INSERT INTO application_status_history (application_id, status) VALUES (?, ?)', [applicationId, status]);
  }

  let body = `Your application for ${app.title} is now "${status}".`;
  if (status === 'Interview' && when) {
    body = `Your interview for ${app.title} is scheduled for ${when.slice(0, 16).replace('T', ' ')}.`;
  }
  await pool.query(
    'INSERT INTO notifications (user_id, icon, title, body) VALUES (?, ?, ?, ?)',
    [app.seeker_id, ICONS[status] || '🔔', `Application ${status.toLowerCase()}`, body]
  );
  return { ok: true };
}

module.exports = { changeApplicationStatus, toMysqlDateTime };
