const express = require('express');
const pool = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

function initials(name) {
  return (name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

// GET /api/saved  -> every job/internship this seeker saved
router.get('/', requireAuth, requireRole('seeker'), async (req, res) => {
  const [rows] = await pool.query(
    `SELECT l.*, u.company_name FROM saved s
     JOIN listings l ON l.id = s.listing_id
     JOIN users u ON u.id = l.recruiter_id
     WHERE s.seeker_id = ? ORDER BY s.created_at DESC`,
    [req.user.id]
  );
  res.json({ saved: rows.map(r => ({
    id: r.id, type: r.listing_type, title: r.title, company: r.company_name,
    companyInitials: initials(r.company_name), location: r.location, jobType: r.job_type,
    salary: r.salary_text, status: r.status
  })) });
});

// POST /api/saved  { listingId }   (saving twice is fine — it just stays saved)
router.post('/', requireAuth, requireRole('seeker'), async (req, res) => {
  const listingId = parseInt(req.body.listingId, 10);
  if (!listingId) return res.status(400).json({ error: 'listingId is required.' });
  const [[listing]] = await pool.query('SELECT id FROM listings WHERE id = ?', [listingId]);
  if (!listing) return res.status(404).json({ error: 'This listing no longer exists.' });
  await pool.query('INSERT IGNORE INTO saved (seeker_id, listing_id) VALUES (?, ?)', [req.user.id, listingId]);
  res.json({ ok: true, saved: true });
});

// DELETE /api/saved/:listingId
router.delete('/:listingId', requireAuth, requireRole('seeker'), async (req, res) => {
  await pool.query('DELETE FROM saved WHERE seeker_id = ? AND listing_id = ?', [req.user.id, req.params.listingId]);
  res.json({ ok: true, saved: false });
});

module.exports = router;
