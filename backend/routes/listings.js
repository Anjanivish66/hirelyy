const express = require('express');
const pool = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

function timeAgo(dateStr) {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function initials(name) {
  return (name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

// GET /api/listings?type=job|internship&location=&q=
// Public catalog: every Job Seeker account receives the SAME complete set of
// Admin-approved + active Jobs/Internships. There is intentionally NO filter
// by seeker email, user id, saved jobs, or application history here.
router.get('/', async (req, res) => {
  const { type, location, q } = req.query;
  let sql = `SELECT l.*, u.company_name, u.company_industry,
             (SELECT COUNT(*) FROM applications a WHERE a.listing_id = l.id) AS applicant_count
             FROM listings l JOIN users u ON u.id = l.recruiter_id
             WHERE l.status = 'active' AND l.approval_status = 'approved'`;
  const params = [];
  if (type) { sql += ' AND l.listing_type = ?'; params.push(type); }
  if (location) { sql += ' AND l.location LIKE ?'; params.push(`%${location}%`); }
  if (q) { sql += ' AND (l.title LIKE ? OR l.skills LIKE ? OR u.company_name LIKE ?)'; params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  sql += ' ORDER BY l.created_at DESC';

  const [rows] = await pool.query(sql, params);
  const listings = rows.map(r => ({
    id: r.id,
    type: r.listing_type,
    title: r.title,
    company: r.company_name,
    companyInitials: initials(r.company_name),
    industry: r.company_industry,
    location: r.location,
    jobType: r.job_type,
    employmentType: r.employment_type,
    workMode: r.work_mode,
    category: r.category,
    salary: r.salary_text,
    isUnpaid: !!r.is_unpaid,
    experience: r.experience,
    vacancies: r.vacancies,
    duration: r.duration,
    skills: r.skills ? r.skills.split(',').map(s => s.trim()).filter(Boolean) : [],
    description: r.description,
    applicantCount: r.applicant_count,
    postedAgo: timeAgo(r.created_at),
    createdAt: r.created_at
  }));
  res.json({ listings });
});

// GET /api/listings/mine  (recruiter's own listings)
router.get('/mine', requireAuth, requireRole('recruiter'), async (req, res) => {
  const [rows] = await pool.query(
    `SELECT l.*, (SELECT COUNT(*) FROM applications a WHERE a.listing_id = l.id) AS applicant_count
     FROM listings l WHERE l.recruiter_id = ? ORDER BY l.created_at DESC`,
    [req.user.id]
  );
  res.json({ listings: rows.map(r => ({
    id: r.id, type: r.listing_type, title: r.title, jobType: r.job_type,
    employmentType: r.employment_type, workMode: r.work_mode, location: r.location,
    status: r.status, approvalStatus: r.approval_status, approvalNote: r.approval_note, applicantCount: r.applicant_count, createdAt: r.created_at
  })) });
});

// ---- Real-data chart endpoints (recruiter's own listings) ----

function bucketLabels(range) {
  return range === '7days' ? ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'] : ['12am–6am','6am–12pm','12pm–6pm','6pm–12am'];
}

// GET /api/listings/mine/overview?range=today|yesterday|7days|custom&date=YYYY-MM-DD&type=all|jobs|internships
router.get('/mine/overview', requireAuth, requireRole('recruiter'), async (req, res) => {
  const { range = 'today', date, type = 'all' } = req.query;
  const typeFilter = type === 'jobs' ? 'job' : type === 'internships' ? 'internship' : null;
  const ymd = d => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const istParts = value => { const normalized = typeof value === 'string' && !/[zZ]|[+-]\d\d:\d\d$/.test(value) ? value.replace(' ', 'T') + 'Z' : value; const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', weekday: 'short', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(normalized)); const get = t => parts.find(p => p.type === t)?.value; return { weekday: get('weekday'), hour: Number(get('hour')) }; };

  const params = [req.user.id];
  let dateCond;
  if (range === '7days') {
    const start = new Date(); start.setDate(start.getDate() - 6);
    dateCond = 'AND DATE(DATE_ADD(a.applied_at, INTERVAL 330 MINUTE)) >= ?';
    params.push(ymd(start) + ' 00:00:00');
  } else {
    let targetDate = ymd(new Date());
    if (range === 'custom' && date) targetDate = date;
    else if (range === 'yesterday') { const d = new Date(); d.setDate(d.getDate() - 1); targetDate = ymd(d); }
    dateCond = 'AND DATE(DATE_ADD(a.applied_at, INTERVAL 330 MINUTE)) = ?';
    params.push(targetDate);
  }
  let typeCond = '';
  if (typeFilter) { typeCond = 'AND l.listing_type = ?'; params.push(typeFilter); }

  const [rows] = await pool.query(
    `SELECT a.applied_at, a.status FROM applications a JOIN listings l ON l.id = a.listing_id
     WHERE l.recruiter_id = ? ${dateCond} ${typeCond}`,
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

// GET /api/listings/mine/monthly-overview?year=YYYY
router.get('/mine/monthly-overview', requireAuth, requireRole('recruiter'), async (req, res) => {
  const year = parseInt(req.query.year) || new Date().getFullYear();
  const [rows] = await pool.query(
    `SELECT a.applied_at, a.status, l.listing_type FROM applications a JOIN listings l ON l.id = a.listing_id
     WHERE l.recruiter_id = ? AND YEAR(a.applied_at) = ?`,
    [req.user.id, year]
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

// GET /api/listings/mine/position-overview?type=all|jobs|internships
router.get('/mine/position-overview', requireAuth, requireRole('recruiter'), async (req, res) => {
  const { type = 'all' } = req.query;
  const typeFilter = type === 'jobs' ? 'job' : type === 'internships' ? 'internship' : null;
  let sql = `SELECT l.title, l.listing_type,
             (SELECT COUNT(*) FROM applications a WHERE a.listing_id = l.id) AS apps,
             (SELECT COUNT(*) FROM applications a WHERE a.listing_id = l.id AND a.status = 'Shortlisted') AS short
             FROM listings l WHERE l.recruiter_id = ?`;
  const params = [req.user.id];
  if (typeFilter) { sql += ' AND l.listing_type = ?'; params.push(typeFilter); }
  sql += ' ORDER BY l.created_at DESC';
  const [rows] = await pool.query(sql, params);
  res.json({ positions: rows.map(r => ({ position: r.title, type: r.listing_type === 'job' ? 'Job' : 'Internship', apps: r.apps, short: r.short })) });
});

// GET /api/listings/:id
router.get('/:id', async (req, res) => {
  const [[r]] = await pool.query(
    `SELECT l.*, u.company_name, u.company_industry, u.company_about, u.company_hq
     FROM listings l JOIN users u ON u.id = l.recruiter_id WHERE l.id = ?`,
    [req.params.id]
  );
  if (!r) return res.status(404).json({ error: 'Listing not found.' });
  const [[{ cnt }]] = await pool.query('SELECT COUNT(*) AS cnt FROM applications WHERE listing_id = ?', [r.id]);
  res.json({
    listing: {
      id: r.id,
      type: r.listing_type,
      title: r.title,
      company: r.company_name,
      companyInitials: initials(r.company_name),
      industry: r.company_industry,
      companyAbout: r.company_about,
      location: r.location,
      jobType: r.job_type,
      employmentType: r.employment_type,
      workMode: r.work_mode,
      category: r.category,
      salary: r.salary_text,
      isUnpaid: !!r.is_unpaid,
      experience: r.experience,
      vacancies: r.vacancies,
      duration: r.duration,
      skills: r.skills ? r.skills.split(',').map(s => s.trim()).filter(Boolean) : [],
      description: r.description,
      applicantCount: cnt,
      approvalStatus: r.approval_status,
      approvalNote: r.approval_note,
      postedAgo: timeAgo(r.created_at),
      recruiterId: r.recruiter_id
    }
  });
});

// POST /api/listings  (recruiter creates a job/internship)
router.post('/', requireAuth, requireRole('recruiter'), async (req, res) => {
  const {
    title, listingType, employmentType, workMode, category, location,
    salary, isUnpaid, experience, vacancies, duration, skills, description
  } = req.body;
  if (!title || !description) return res.status(400).json({ error: 'Title and description are required.' });

  const type = listingType === 'internship' ? 'internship' : 'job';
  const unpaid = type === 'internship' && !!isUnpaid;
  const salaryText = unpaid ? 'Unpaid' : (salary || '');

  const [result] = await pool.query(
    `INSERT INTO listings (recruiter_id, listing_type, title, job_type, employment_type, work_mode, category, location, salary_text, is_unpaid, experience, vacancies, duration, skills, description, status, approval_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 'pending')`,
    [req.user.id, type, title, employmentType || 'Full-time', employmentType || 'Full-time', workMode || 'On-site',
     category || '', location || '', salaryText, unpaid ? 1 : 0, experience || '',
     vacancies || 1, type === 'internship' ? (duration || '') : '', skills || '', description]
  );
  res.status(201).json({ ok: true, id: result.insertId, approvalStatus: 'pending' });
});

// PUT /api/listings/:id  (recruiter updates own listing)
router.put('/:id', requireAuth, requireRole('recruiter'), async (req, res) => {
  const [[listing]] = await pool.query('SELECT * FROM listings WHERE id = ?', [req.params.id]);
  if (!listing) return res.status(404).json({ error: 'Listing not found.' });
  if (listing.recruiter_id !== req.user.id) return res.status(403).json({ error: 'Not your listing.' });

  const {
    title, employmentType, workMode, category, location, salary, isUnpaid,
    experience, vacancies, duration, skills, description, status
  } = req.body;
  const unpaid = (listing.listing_type === 'internship' && isUnpaid) ? 1 : (isUnpaid === false ? 0 : null);
  const salaryText = isUnpaid === true ? 'Unpaid' : salary;
  const statusOnly = Object.keys(req.body || {}).every(k => k === 'status');
  const approvalSql = statusOnly ? '' : ", approval_status='pending', approval_note=NULL, approved_at=NULL";

  await pool.query(
    `UPDATE listings SET title=COALESCE(?,title), job_type=COALESCE(?,job_type), employment_type=COALESCE(?,employment_type),
     work_mode=COALESCE(?,work_mode), category=COALESCE(?,category),
     location=COALESCE(?,location), salary_text=COALESCE(?,salary_text), is_unpaid=COALESCE(?,is_unpaid), experience=COALESCE(?,experience),
     vacancies=COALESCE(?,vacancies), duration=COALESCE(?,duration), skills=COALESCE(?,skills),
     description=COALESCE(?,description), status=COALESCE(?,status)${approvalSql} WHERE id = ?`,
    [title, employmentType, employmentType, workMode, category, location, salaryText, unpaid, experience, vacancies, duration, skills, description, status, req.params.id]
  );
  res.json({ ok: true });
});

// DELETE /api/listings/:id
router.delete('/:id', requireAuth, requireRole('recruiter'), async (req, res) => {
  const [[listing]] = await pool.query('SELECT * FROM listings WHERE id = ?', [req.params.id]);
  if (!listing) return res.status(404).json({ error: 'Listing not found.' });
  if (listing.recruiter_id !== req.user.id) return res.status(403).json({ error: 'Not your listing.' });
  await pool.query('DELETE FROM listings WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

module.exports = router;
