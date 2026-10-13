const express = require('express');
const pool = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const upload = require('../middleware/upload');

const router = express.Router();

// GET /api/profile  (seeker's own full profile)
router.get('/', requireAuth, requireRole('seeker'), async (req, res) => {
  const uid = req.user.id;
  const [[user]] = await pool.query('SELECT * FROM users WHERE id = ?', [uid]);
  const [education] = await pool.query('SELECT * FROM education WHERE user_id = ?', [uid]);
  const [workExperience] = await pool.query('SELECT * FROM work_experience WHERE user_id = ? ORDER BY start_date DESC', [uid]);
  const [skillsRows] = await pool.query('SELECT skill FROM profile_skills WHERE user_id = ?', [uid]);
  const [langRows] = await pool.query('SELECT language FROM profile_languages WHERE user_id = ?', [uid]);
  const [accRows] = await pool.query('SELECT id, text FROM accomplishments WHERE user_id = ? ORDER BY id', [uid]);

  res.json({
    profile: {
      name: user.name,
      email: user.email,
      headline: user.headline,
      summary: user.summary,
      resumeName: user.resume_name,
      resumePath: user.resume_path ? `/uploads/resumes/${user.resume_path}` : null,
      education,
      workExperience,
      skills: skillsRows.map(r => r.skill),
      languages: langRows.map(r => r.language),
      accomplishments: accRows.map(r => ({ id: r.id, text: r.text }))
    }
  });
});

// PUT /api/profile  (update basic fields: name, headline, summary)
router.put('/', requireAuth, requireRole('seeker'), async (req, res) => {
  const { name, headline, summary } = req.body;
  await pool.query('UPDATE users SET name = COALESCE(?, name), headline = ?, summary = ? WHERE id = ?', [
    name || null, headline || '', summary || '', req.user.id
  ]);
  res.json({ ok: true });
});

// POST /api/profile/skills  { skill }
router.post('/skills', requireAuth, requireRole('seeker'), async (req, res) => {
  const { skill } = req.body;
  if (!skill) return res.status(400).json({ error: 'Skill is required.' });
  await pool.query('INSERT INTO profile_skills (user_id, skill) VALUES (?, ?)', [req.user.id, skill.trim()]);
  res.json({ ok: true });
});

// DELETE /api/profile/skills/:skill
router.delete('/skills/:skill', requireAuth, requireRole('seeker'), async (req, res) => {
  await pool.query('DELETE FROM profile_skills WHERE user_id = ? AND skill = ?', [req.user.id, req.params.skill]);
  res.json({ ok: true });
});

// POST /api/profile/languages { language }
router.post('/languages', requireAuth, requireRole('seeker'), async (req, res) => {
  const { language } = req.body;
  if (!language) return res.status(400).json({ error: 'Language is required.' });
  await pool.query('INSERT INTO profile_languages (user_id, language) VALUES (?, ?)', [req.user.id, language.trim()]);
  res.json({ ok: true });
});

// DELETE /api/profile/languages/:language
router.delete('/languages/:language', requireAuth, requireRole('seeker'), async (req, res) => {
  await pool.query('DELETE FROM profile_languages WHERE user_id = ? AND language = ?', [req.user.id, req.params.language]);
  res.json({ ok: true });
});

// POST /api/profile/education { degree, institution, years }
router.post('/education', requireAuth, requireRole('seeker'), async (req, res) => {
  const { degree, institution, years } = req.body;
  if (!degree || !institution) return res.status(400).json({ error: 'Degree and institution are required.' });
  await pool.query('INSERT INTO education (user_id, degree, institution, years) VALUES (?, ?, ?, ?)', [
    req.user.id, degree, institution, years || ''
  ]);
  res.json({ ok: true });
});

// Update/delete education entries (owner-only)
router.put('/education/:id', requireAuth, requireRole('seeker'), async (req, res) => {
  const { degree, institution, years } = req.body;
  if (!degree || !institution) return res.status(400).json({ error: 'Degree and institution are required.' });
  const [result] = await pool.query('UPDATE education SET degree = ?, institution = ?, years = ? WHERE id = ? AND user_id = ?', [degree, institution, years || '', req.params.id, req.user.id]);
  if (!result.affectedRows) return res.status(404).json({ error: 'Education entry not found.' });
  res.json({ ok: true });
});
router.delete('/education/:id', requireAuth, requireRole('seeker'), async (req, res) => {
  const [result] = await pool.query('DELETE FROM education WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!result.affectedRows) return res.status(404).json({ error: 'Education entry not found.' });
  res.json({ ok: true });
});

// POST /api/profile/work-experience
router.post('/work-experience', requireAuth, requireRole('seeker'), async (req, res) => {
  const { title, company, startDate, endDate, currentlyWorking, description } = req.body;
  if (!title || !company) return res.status(400).json({ error: 'Title and company are required.' });
  await pool.query(
    `INSERT INTO work_experience (user_id, title, company, start_date, end_date, currently_working, description)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [req.user.id, title, company, startDate || null, currentlyWorking ? null : (endDate || null), currentlyWorking ? 1 : 0, description || '']
  );
  res.json({ ok: true });
});

// Update/delete work experience entries (owner-only)
router.put('/work-experience/:id', requireAuth, requireRole('seeker'), async (req, res) => {
  const { title, company, startDate, endDate, currentlyWorking, description } = req.body;
  if (!title || !company) return res.status(400).json({ error: 'Title and company are required.' });
  const [result] = await pool.query(`UPDATE work_experience SET title = ?, company = ?, start_date = ?, end_date = ?, currently_working = ?, description = ? WHERE id = ? AND user_id = ?`, [title, company, startDate || null, currentlyWorking ? null : (endDate || null), currentlyWorking ? 1 : 0, description || '', req.params.id, req.user.id]);
  if (!result.affectedRows) return res.status(404).json({ error: 'Work experience entry not found.' });
  res.json({ ok: true });
});
router.delete('/work-experience/:id', requireAuth, requireRole('seeker'), async (req, res) => {
  const [result] = await pool.query('DELETE FROM work_experience WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!result.affectedRows) return res.status(404).json({ error: 'Work experience entry not found.' });
  res.json({ ok: true });
});

// Accomplishments
router.post('/accomplishments', requireAuth, requireRole('seeker'), async (req, res) => {
  const text = String(req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Accomplishment is required.' });
  await pool.query('INSERT INTO accomplishments (user_id, text) VALUES (?, ?)', [req.user.id, text]);
  res.json({ ok: true });
});
router.put('/accomplishments/:id', requireAuth, requireRole('seeker'), async (req, res) => {
  const text = String(req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Accomplishment is required.' });
  const [result] = await pool.query('UPDATE accomplishments SET text = ? WHERE id = ? AND user_id = ?', [text, req.params.id, req.user.id]);
  if (!result.affectedRows) return res.status(404).json({ error: 'Accomplishment not found.' });
  res.json({ ok: true });
});
router.delete('/accomplishments/:id', requireAuth, requireRole('seeker'), async (req, res) => {
  const [result] = await pool.query('DELETE FROM accomplishments WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!result.affectedRows) return res.status(404).json({ error: 'Accomplishment not found.' });
  res.json({ ok: true });
});

// POST /api/profile/resume  (multipart form field: resume)
router.post('/resume', requireAuth, requireRole('seeker'), upload.single('resume'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
  await pool.query('UPDATE users SET resume_path = ?, resume_name = ? WHERE id = ?', [
    req.file.filename, req.file.originalname, req.user.id
  ]);
  res.json({ ok: true, resumeName: req.file.originalname, resumePath: `/uploads/resumes/${req.file.filename}` });
});

// ---- Company profile (recruiter) ----

// GET /api/profile/company
router.get('/company', requireAuth, requireRole('recruiter'), async (req, res) => {
  const [[user]] = await pool.query('SELECT * FROM users WHERE id = ?', [req.user.id]);
  res.json({
    company: {
      name: user.company_name,
      tagline: user.company_tagline,
      industry: user.company_industry,
      website: user.company_website,
      headquarters: user.company_hq,
      vacancies: user.company_vacancies,
      about: user.company_about
    }
  });
});

// PUT /api/profile/company
router.put('/company', requireAuth, requireRole('recruiter'), async (req, res) => {
  const { name, tagline, industry, website, headquarters, vacancies, about } = req.body;
  await pool.query(
    `UPDATE users SET company_name = COALESCE(?, company_name), company_tagline = ?, company_industry = ?,
     company_website = ?, company_hq = ?, company_vacancies = ?, company_about = ? WHERE id = ?`,
    [name || null, tagline || '', industry || '', website || '', headquarters || '', vacancies || null, about || '', req.user.id]
  );
  res.json({ ok: true });
});

module.exports = router;
