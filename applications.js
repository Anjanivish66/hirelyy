const express = require('express');
const pool = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const upload = require('../middleware/upload');
const { nextAllowedStatuses } = require('../utils/applicationStatus');
const { changeApplicationStatus } = require('../utils/changeStatus');

const router = express.Router();

function initials(name) {
  return (name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

// POST /api/applications  (seeker applies to a listing) - multipart, field "resume" optional
router.post('/', requireAuth, requireRole('seeker'), upload.single('resume'), async (req, res) => {
  try {
    const { listingId, fullName, email, institution, experience, coverNote } = req.body;
    if (!listingId) return res.status(400).json({ error: 'listingId is required.' });

    const [[listing]] = await pool.query('SELECT * FROM listings WHERE id = ?', [listingId]);
    if (!listing) return res.status(404).json({ error: 'Listing not found.' });

    const [[existing]] = await pool.query('SELECT id FROM applications WHERE listing_id = ? AND seeker_id = ?', [listingId, req.user.id]);
    if (existing) return res.status(409).json({ error: 'You have already applied to this listing.' });

    // fall back to profile resume if none uploaded for this application
    let resumePath = req.file ? req.file.filename : null;
    let resumeName = req.file ? req.file.originalname : null;
    if (!resumePath) {
      const [[user]] = await pool.query('SELECT resume_path, resume_name FROM users WHERE id = ?', [req.user.id]);
      resumePath = user.resume_path;
      resumeName = user.resume_name;
    }

    if (!resumePath) {
      return res.status(400).json({ error: 'Please upload your resume before submitting your application.' });
    }

    const [result] = await pool.query(
      `INSERT INTO applications (listing_id, seeker_id, full_name, email, institution, experience, cover_note, resume_path, resume_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [listingId, req.user.id, fullName || req.user.name, email || req.user.email, institution || '', experience || '', coverNote || '', resumePath, resumeName]
    );

    await pool.query(
      `INSERT INTO application_status_history (application_id, status) VALUES (?, 'Applied')`,
      [result.insertId]
    );

    await pool.query(
      `INSERT INTO notifications (user_id, icon, title, body) VALUES (?, '✅', 'Application submitted successfully', ?)`,
      [req.user.id, `Your application for ${listing.title} was submitted.`]
    );
    await pool.query(
      `INSERT INTO notifications (user_id, icon, title, body) VALUES (?, '📥', 'New application received', ?)`,
      [listing.recruiter_id, `${req.user.name} applied for ${listing.title}.`]
    );

    res.status(201).json({ ok: true, id: result.insertId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not submit application.' });
  }
});

// GET /api/applications/mine  (seeker's own applications, for status tracking)
router.get('/mine', requireAuth, requireRole('seeker'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT a.*, l.title, l.listing_type, l.job_type, u.company_name
       FROM applications a
       JOIN listings l ON l.id = a.listing_id
       JOIN users u ON u.id = l.recruiter_id
       WHERE a.seeker_id = ? ORDER BY a.applied_at DESC`,
      [req.user.id]
    );
    const ids = rows.map(r => r.id);
    let historyRows = [];
    if (ids.length) {
      [historyRows] = await pool.query(
        'SELECT application_id, status, changed_at FROM application_status_history WHERE application_id IN (?) ORDER BY changed_at ASC, id ASC',
        [ids]
      );
    }
    const historyByApp = {};
    historyRows.forEach(h => { (historyByApp[h.application_id] = historyByApp[h.application_id] || []).push({ status: h.status, at: h.changed_at }); });

    res.json({ applications: rows.map(r => {
      const history = historyByApp[r.id] && historyByApp[r.id].length
        ? historyByApp[r.id]
        : [{ status: 'Applied', at: r.applied_at }];
      return {
        id: r.id,
        ticketId: `APP-${new Date(r.applied_at).getFullYear()}-${String(r.id).padStart(4, '0')}`,
        title: r.title,
        type: r.listing_type,
        company: r.company_name,
        status: r.status,
        interviewAt: r.interview_at,
        history,
        appliedAt: r.applied_at,
        updatedAt: r.updated_at
      };
    }) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load your applications.' });
  }
});

// GET /api/applications/listing/:listingId  (recruiter: applicants for one of their listings)
router.get('/listing/:listingId', requireAuth, requireRole('recruiter'), async (req, res) => {
  const [[listing]] = await pool.query('SELECT * FROM listings WHERE id = ?', [req.params.listingId]);
  if (!listing) return res.status(404).json({ error: 'Listing not found.' });
  if (listing.recruiter_id !== req.user.id) return res.status(403).json({ error: 'Not your listing.' });

  const [rows] = await pool.query(
    `SELECT a.*, u.name AS seeker_name FROM applications a JOIN users u ON u.id = a.seeker_id
     WHERE a.listing_id = ? ORDER BY a.applied_at DESC`,
    [req.params.listingId]
  );
  res.json({
    listingTitle: listing.title,
    applicants: rows.map(r => ({
      id: r.id,
      seekerId: r.seeker_id,
      name: r.seeker_name,
      status: r.status,
      nextStatuses: nextAllowedStatuses(r.status),
      interviewAt: r.interview_at,
      resumeName: r.resume_name,
      appliedAt: r.applied_at
    }))
  });
});

// GET /api/applications/:id  (recruiter: full applicant profile for one application)
router.get('/:id', requireAuth, requireRole('recruiter'), async (req, res) => {
  const [[app]] = await pool.query(
    `SELECT a.*, l.title AS listing_title, l.recruiter_id FROM applications a
     JOIN listings l ON l.id = a.listing_id WHERE a.id = ?`,
    [req.params.id]
  );
  if (!app) return res.status(404).json({ error: 'Application not found.' });
  if (app.recruiter_id !== req.user.id) return res.status(403).json({ error: 'Not your listing.' });

  const uid = app.seeker_id;
  const [[user]] = await pool.query('SELECT * FROM users WHERE id = ?', [uid]);
  const [education] = await pool.query('SELECT * FROM education WHERE user_id = ?', [uid]);
  const [workExperience] = await pool.query('SELECT * FROM work_experience WHERE user_id = ?', [uid]);
  const [skillsRows] = await pool.query('SELECT skill FROM profile_skills WHERE user_id = ?', [uid]);
  const [langRows] = await pool.query('SELECT language FROM profile_languages WHERE user_id = ?', [uid]);
  const [accRows] = await pool.query('SELECT text FROM accomplishments WHERE user_id = ?', [uid]);

  res.json({
    applicant: {
      name: user.name,
      initials: initials(user.name),
      headline: `Applied for — ${app.listing_title}`,
      status: app.status,
      nextStatuses: nextAllowedStatuses(app.status),
      summary: user.summary || app.cover_note || 'No summary provided.',
      education: education.map(e => `${e.degree}, ${e.institution} (${e.years || ''})`).join(' · ') || 'Not provided.',
      skills: skillsRows.map(r => r.skill),
      accomplishments: accRows.map(r => r.text),
      workExperience: workExperience.map(w => ({
        title: w.title, company: w.company,
        duration: `${w.start_date || ''} – ${w.currently_working ? 'Present' : (w.end_date || '')}`,
        description: w.description
      })),
      languages: langRows.map(r => r.language),
      resumeName: app.resume_name || 'No resume uploaded.',
      resumePath: app.resume_path ? `/uploads/resumes/${app.resume_path}` : null
    }
  });
});

// PUT /api/applications/:id/status  { status, interviewAt? }
router.put('/:id/status', requireAuth, requireRole('recruiter'), async (req, res) => {
  try {
    const { status, interviewAt } = req.body;
    const [[app]] = await pool.query(
      `SELECT l.recruiter_id FROM applications a JOIN listings l ON l.id = a.listing_id WHERE a.id = ?`,
      [req.params.id]
    );
    if (!app) return res.status(404).json({ error: 'Application not found.' });
    if (app.recruiter_id !== req.user.id) return res.status(403).json({ error: 'Not your listing.' });

    const result = await changeApplicationStatus(req.params.id, status, interviewAt);
    if (result.error) return res.status(result.code).json({ error: result.error });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not update the status.' });
  }
});

module.exports = router;
