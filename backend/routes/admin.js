const express = require('express');
const pool = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { nextAllowedStatuses } = require('../utils/applicationStatus');
const { changeApplicationStatus } = require('../utils/changeStatus');

const router = express.Router();
router.use(requireAuth, requireRole('admin'));

function initials(name) {
  return (name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

// GET /api/admin/stats
router.get('/stats', async (req, res) => {
  const [[{ totalUsers }]] = await pool.query(`SELECT COUNT(*) AS totalUsers FROM users WHERE role IN ('seeker','recruiter')`);
  const [[{ activeJobs }]] = await pool.query(`SELECT COUNT(*) AS activeJobs FROM listings WHERE listing_type='job' AND status='active'`);
  const [[{ activeInternships }]] = await pool.query(`SELECT COUNT(*) AS activeInternships FROM listings WHERE listing_type='internship' AND status='active'`);
  const [[{ totalApplications }]] = await pool.query(`SELECT COUNT(*) AS totalApplications FROM applications`);
  const [[{ shortlisted }]] = await pool.query(`SELECT COUNT(*) AS shortlisted FROM applications WHERE status='Shortlisted'`);
  const [[{ interviews }]] = await pool.query(`SELECT COUNT(*) AS interviews FROM applications WHERE status='Interview'`);
  const [[{ selected }]] = await pool.query(`SELECT COUNT(*) AS selected FROM applications WHERE status='Selected'`);
  const [[{ rejected }]] = await pool.query(`SELECT COUNT(*) AS rejected FROM applications WHERE status='Rejected'`);
  res.json({ stats: { totalUsers, activeJobs, activeInternships, totalApplications, shortlisted, interviews, selected, rejected } });
});

// GET /api/admin/users  (seekers only, for the Manage Users screen)
router.get('/users', async (req, res) => {
  const [rows] = await pool.query(
    `SELECT id, name, email, role, created_at FROM users WHERE role = 'seeker' ORDER BY created_at DESC`
  );
  res.json({ users: rows });
});

router.delete('/users/:id', async (req, res) => {
  await pool.query(`DELETE FROM users WHERE id = ? AND role = 'seeker'`, [req.params.id]);
  res.json({ ok: true });
});

// GET /api/admin/users/:id/profile  (a seeker's real "My Profile" page, for the admin's View Profile action)
router.get('/users/:id/profile', async (req, res) => {
  const uid = req.params.id;
  const [[user]] = await pool.query(`SELECT * FROM users WHERE id = ? AND role = 'seeker'`, [uid]);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  const [education] = await pool.query('SELECT * FROM education WHERE user_id = ?', [uid]);
  const [workExperience] = await pool.query('SELECT * FROM work_experience WHERE user_id = ? ORDER BY start_date DESC', [uid]);
  const [skillsRows] = await pool.query('SELECT skill FROM profile_skills WHERE user_id = ?', [uid]);
  const [langRows] = await pool.query('SELECT language FROM profile_languages WHERE user_id = ?', [uid]);
  const [accRows] = await pool.query('SELECT text FROM accomplishments WHERE user_id = ?', [uid]);
  const [[{ appCount }]] = await pool.query('SELECT COUNT(*) AS appCount FROM applications WHERE seeker_id = ?', [uid]);

  res.json({
    profile: {
      name: user.name,
      initials: initials(user.name),
      email: user.email,
      headline: user.headline,
      summary: user.summary,
      resumeName: user.resume_name,
      resumePath: user.resume_path ? `/uploads/resumes/${user.resume_path}` : null,
      joinedAt: user.created_at,
      applicationCount: appCount,
      education,
      workExperience,
      skills: skillsRows.map(r => r.skill),
      languages: langRows.map(r => r.language),
      accomplishments: accRows.map(r => r.text)
    }
  });
});

// GET /api/admin/companies (recruiters, for Manage Companies screen)
router.get('/companies', async (req, res) => {
  const [rows] = await pool.query(
    `SELECT id, company_name, name, email, created_at FROM users WHERE role = 'recruiter' ORDER BY created_at DESC`
  );
  res.json({ companies: rows });
});

router.delete('/companies/:id', async (req, res) => {
  await pool.query(`DELETE FROM users WHERE id = ? AND role = 'recruiter'`, [req.params.id]);
  res.json({ ok: true });
});

// GET /api/admin/companies/:id/profile  (a recruiter's real Company Profile page)
router.get('/companies/:id/profile', async (req, res) => {
  const [[user]] = await pool.query(`SELECT * FROM users WHERE id = ? AND role = 'recruiter'`, [req.params.id]);
  if (!user) return res.status(404).json({ error: 'Company not found.' });
  const [[{ listingCount }]] = await pool.query('SELECT COUNT(*) AS listingCount FROM listings WHERE recruiter_id = ?', [req.params.id]);

  res.json({
    profile: {
      contactName: user.name,
      initials: initials(user.company_name || user.name),
      email: user.email,
      name: user.company_name,
      tagline: user.company_tagline,
      industry: user.company_industry,
      website: user.company_website,
      headquarters: user.company_hq,
      vacancies: user.company_vacancies,
      about: user.company_about,
      joinedAt: user.created_at,
      listingCount
    }
  });
});

// GET /api/admin/listings?type=job|internship
router.get('/listings', async (req, res) => {
  const { type } = req.query;
  let sql = `SELECT l.*, u.company_name FROM listings l JOIN users u ON u.id = l.recruiter_id`;
  const params = [];
  if (type) { sql += ' WHERE l.listing_type = ?'; params.push(type); }
  sql += ' ORDER BY l.created_at DESC';
  const [rows] = await pool.query(sql, params);
  res.json({ listings: rows });
});

router.delete('/listings/:id', async (req, res) => {
  await pool.query('DELETE FROM listings WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

router.put('/listings/:id/status', async (req, res) => {
  const { status } = req.body; // 'active' | 'closed'
  await pool.query('UPDATE listings SET status = ? WHERE id = ?', [status, req.params.id]);
  res.json({ ok: true });
});

// ---- Real-data chart endpoints (platform-wide, across all recruiters) ----

function bucketLabels(range) {
  return range === '7days' ? ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'] : ['12am–6am','6am–12pm','12pm–6pm','6pm–12am'];
}

// GET /api/admin/overview?range=today|yesterday|7days|custom&date=YYYY-MM-DD&type=all|jobs|internships
router.get('/overview', async (req, res) => {
  const { range = 'today', date, type = 'all' } = req.query;
  const typeFilter = type === 'jobs' ? 'job' : type === 'internships' ? 'internship' : null;
  const ymd = d => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const istParts = value => { const normalized = typeof value === 'string' && !/[zZ]|[+-]\d\d:\d\d$/.test(value) ? value.replace(' ', 'T') + 'Z' : value; const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', weekday: 'short', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(normalized)); const get = t => parts.find(p => p.type === t)?.value; return { weekday: get('weekday'), hour: Number(get('hour')) }; };

  const params = [];
  let dateCond;
  if (range === '7days') {
    const start = new Date(); start.setDate(start.getDate() - 6);
    dateCond = 'WHERE DATE(DATE_ADD(a.applied_at, INTERVAL 330 MINUTE)) >= ?';
    params.push(ymd(start) + ' 00:00:00');
  } else {
    let targetDate = ymd(new Date());
    if (range === 'custom' && date) targetDate = date;
    else if (range === 'yesterday') { const d = new Date(); d.setDate(d.getDate() - 1); targetDate = ymd(d); }
    dateCond = 'WHERE DATE(DATE_ADD(a.applied_at, INTERVAL 330 MINUTE)) = ?';
    params.push(targetDate);
  }
  let typeCond = '';
  if (typeFilter) { typeCond = 'AND l.listing_type = ?'; params.push(typeFilter); }

  const [rows] = await pool.query(
    `SELECT a.applied_at, a.status FROM applications a JOIN listings l ON l.id = a.listing_id ${dateCond} ${typeCond}`,
    params
  );

  const labels = bucketLabels(range);
  const buckets = labels.map(() => ({ apps: 0, short: 0 }));
  rows.forEach(r => {
    const d = new Date(r.applied_at);
    const ist = istParts(r.applied_at);
    const weekdayIndex = ({ Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 })[ist.weekday] ?? 0;
    const idx = range === '7days' ? weekdayIndex : (ist.hour < 6 ? 0 : ist.hour < 12 ? 1 : ist.hour < 18 ? 2 : 3);
    buckets[idx].apps++;
    if (r.status === 'Shortlisted') buckets[idx].short++;
  });
  res.json({ labels, apps: buckets.map(b => b.apps), short: buckets.map(b => b.short) });
});

// GET /api/admin/monthly-overview?year=YYYY
router.get('/monthly-overview', async (req, res) => {
  const year = parseInt(req.query.year) || new Date().getFullYear();
  const [rows] = await pool.query(
    `SELECT a.applied_at, a.status, l.listing_type FROM applications a JOIN listings l ON l.id = a.listing_id
     WHERE YEAR(a.applied_at) = ?`,
    [year]
  );
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const months = monthNames.map(m => ({ month: m, jobApps: 0, jobShort: 0, internApps: 0, internShort: 0 }));
  rows.forEach(r => {
    const bucket = months[new Date(r.applied_at).getMonth()];
    if (r.listing_type === 'job') { bucket.jobApps++; if (r.status === 'Shortlisted') bucket.jobShort++; }
    else { bucket.internApps++; if (r.status === 'Shortlisted') bucket.internShort++; }
  });
  res.json({ months, year });
});

// GET /api/admin/position-overview?type=all|jobs|internships
router.get('/position-overview', async (req, res) => {
  const { type = 'all' } = req.query;
  const typeFilter = type === 'jobs' ? 'job' : type === 'internships' ? 'internship' : null;
  let sql = `SELECT l.title, l.listing_type,
             (SELECT COUNT(*) FROM applications a WHERE a.listing_id = l.id) AS apps,
             (SELECT COUNT(*) FROM applications a WHERE a.listing_id = l.id AND a.status = 'Shortlisted') AS short
             FROM listings l WHERE l.approval_status = 'approved'`;
  const params = [];
  if (typeFilter) { sql += ' AND l.listing_type = ?'; params.push(typeFilter); }
  sql += ' ORDER BY l.created_at DESC';
  const [rows] = await pool.query(sql, params);
  res.json({ positions: rows.map(r => ({ position: r.title, type: r.listing_type === 'job' ? 'Job' : 'Internship', apps: r.apps, short: r.short })) });
});

// GET /api/admin/pending-approvals?type=job|internship
router.get('/pending-approvals', async (req, res) => {
  const type = req.query.type;
  const params = [];
  let sql = `SELECT l.id, l.title, l.listing_type, l.location, l.job_type, l.salary_text,
                    l.created_at, l.approval_status, l.approval_note,
                    u.company_name, u.name AS recruiter_name
             FROM listings l JOIN users u ON u.id = l.recruiter_id
             WHERE l.approval_status = 'pending'`;
  if (type === 'job' || type === 'internship') { sql += ' AND l.listing_type = ?'; params.push(type); }
  sql += ' ORDER BY l.created_at ASC';
  const [rows] = await pool.query(sql, params);
  res.json({ approvals: rows });
});

// PUT /api/admin/pending-approvals/:id  { decision: approved|rejected, note? }
router.put('/pending-approvals/:id', async (req, res) => {
  const decision = req.body.decision;
  const note = (req.body.note || '').trim() || null;
  if (!['approved', 'rejected'].includes(decision)) return res.status(400).json({ error: 'Decision must be approved or rejected.' });
  const [[listing]] = await pool.query('SELECT id, recruiter_id, title FROM listings WHERE id = ?', [req.params.id]);
  if (!listing) return res.status(404).json({ error: 'Listing not found.' });
  await pool.query(
    `UPDATE listings SET approval_status = ?, approval_note = ?, approved_at = ?, status = ? WHERE id = ?`,
    [decision, note, decision === 'approved' ? new Date() : null, decision === 'approved' ? 'active' : 'closed', listing.id]
  );
  const icon = decision === 'approved' ? '✅' : '❌';
  const title = decision === 'approved' ? 'Listing approved' : 'Listing rejected';
  const body = decision === 'approved' ? `${listing.title} is now live on Hirely.` : `${listing.title} was rejected${note ? `: ${note}` : '.'}`;
  await pool.query('INSERT INTO notifications (user_id, icon, title, body) VALUES (?, ?, ?, ?)', [listing.recruiter_id, icon, title, body]);
  res.json({ ok: true, approvalStatus: decision });
});

// GET /api/admin/applications
router.get('/applications', async (req, res) => {
  const [rows] = await pool.query(
    `SELECT a.id, a.status, a.interview_at, u.name AS applicant_name, l.title AS listing_title, c.company_name
     FROM applications a
     JOIN users u ON u.id = a.seeker_id
     JOIN listings l ON l.id = a.listing_id
     JOIN users c ON c.id = l.recruiter_id
     ORDER BY a.applied_at DESC`
  );
  res.json({ applications: rows.map(r => ({ ...r, nextStatuses: nextAllowedStatuses(r.status) })) });
});

// PUT /api/admin/applications/:id/status  { status, interviewAt? }
router.put('/applications/:id/status', async (req, res) => {
  try {
    const { status, interviewAt } = req.body;
    const result = await changeApplicationStatus(req.params.id, status, interviewAt);
    if (result.error) return res.status(result.code).json({ error: result.error });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not update the status.' });
  }
});

// ---- Real-data category breakdown (Reports page) ----

// GET /api/admin/category-overview
router.get('/category-overview', async (req, res) => {
  const [rows] = await pool.query(
    `SELECT COALESCE(NULLIF(l.category, ''), 'Uncategorized') AS category, COUNT(a.id) AS apps
     FROM listings l LEFT JOIN applications a ON a.listing_id = l.id
     WHERE l.approval_status = 'approved'
     GROUP BY category ORDER BY apps DESC LIMIT 6`
  );
  res.json({ categories: rows });
});

// ---- Contact Us messages (visitors / seekers / recruiters -> admin) ----

// GET /api/admin/messages  (each message includes the team's replies)
router.get('/messages', async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM contact_messages ORDER BY created_at DESC');
  const ids = rows.map(r => r.id);
  let replies = [];
  if (ids.length) {
    [replies] = await pool.query(
      `SELECT r.message_id, r.reply_text, r.created_at, u.name AS admin_name
       FROM contact_replies r LEFT JOIN users u ON u.id = r.admin_id
       WHERE r.message_id IN (?) ORDER BY r.created_at ASC, r.id ASC`,
      [ids]
    );
  }
  res.json({ messages: rows.map(m => ({
    ...m,
    replies: replies.filter(r => r.message_id === m.id).map(r => ({ text: r.reply_text, at: r.created_at, admin: r.admin_name }))
  })) });
});

// POST /api/admin/messages/:id/reply  { text }
router.post('/messages/:id/reply', async (req, res) => {
  try {
    const text = (req.body.text || '').trim();
    if (!text) return res.status(400).json({ error: 'Please write a reply first.' });
    const [[msg]] = await pool.query('SELECT * FROM contact_messages WHERE id = ?', [req.params.id]);
    if (!msg) return res.status(404).json({ error: 'Message not found.' });

    await pool.query('INSERT INTO contact_replies (message_id, admin_id, reply_text) VALUES (?, ?, ?)', [msg.id, req.user.id, text]);
    await pool.query(`UPDATE contact_messages SET status = 'Replied' WHERE id = ? AND status <> 'Resolved'`, [msg.id]);

    // If the sender has a Hirely account (logged in when sending, or same email), notify them in-app.
    let targetId = msg.user_id;
    if (!targetId) {
      const [[u]] = await pool.query('SELECT id FROM users WHERE email = ?', [msg.email]);
      if (u) targetId = u.id;
    }
    if (targetId) {
      await pool.query(
        `INSERT INTO notifications (user_id, icon, title, body) VALUES (?, '💬', 'Hirely team replied to your message', ?)`,
        [targetId, text.slice(0, 380)]
      );
    }
    res.json({ ok: true, notifiedInApp: !!targetId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not send the reply.' });
  }
});

// PUT /api/admin/messages/:id/status  { status: 'New'|'Read'|'Replied'|'Resolved' }
router.put('/messages/:id/status', async (req, res) => {
  const { status } = req.body;
  if (!['New', 'Read', 'Replied', 'Resolved'].includes(status)) return res.status(400).json({ error: 'Invalid status.' });
  await pool.query('UPDATE contact_messages SET status = ? WHERE id = ?', [status, req.params.id]);
  res.json({ ok: true });
});

// DELETE /api/admin/messages/:id
router.delete('/messages/:id', async (req, res) => {
  await pool.query('DELETE FROM contact_messages WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

// ---- Ratings & Reviews (shown inside Reports) ----

// GET /api/admin/reviews
router.get('/reviews', async (req, res) => {
  const [rows] = await pool.query('SELECT id, name, role, rating, review_text, created_at FROM reviews ORDER BY created_at DESC');
  const distribution = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  let sum = 0;
  rows.forEach(r => { distribution[r.rating] = (distribution[r.rating] || 0) + 1; sum += r.rating; });
  res.json({
    total: rows.length,
    average: rows.length ? Math.round((sum / rows.length) * 10) / 10 : 0,
    distribution,
    reviews: rows.map(r => ({ id: r.id, name: r.name, role: r.role, rating: r.rating, text: r.review_text, createdAt: r.created_at }))
  });
});

// DELETE /api/admin/reviews/:id
router.delete('/reviews/:id', async (req, res) => {
  await pool.query('DELETE FROM reviews WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

module.exports = router;
