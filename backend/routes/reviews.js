const express = require('express');
const jwt = require('jsonwebtoken');
const pool = require('../db');

const router = express.Router();

// POST /api/reviews  { rating: 1-5, text?, name? }
// Public. If the sender is logged in (seeker/recruiter) the review is tied to their
// account and a second submission updates their existing review instead of adding another.
router.post('/', async (req, res) => {
  try {
    const rating = parseInt(req.body.rating, 10);
    if (!(rating >= 1 && rating <= 5)) return res.status(400).json({ error: 'Please select a star rating (1–5).' });
    const text = (req.body.text || '').trim().slice(0, 1000) || null;

    let user = null;
    const header = req.headers.authorization || '';
    if (header.startsWith('Bearer ')) {
      try {
        const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET);
        const [[u]] = await pool.query('SELECT id, name, role, company_name FROM users WHERE id = ?', [payload.id]);
        user = u || null;
      } catch (e) { /* treat as visitor */ }
    }

    if (user && user.role !== 'admin') {
      const name = user.role === 'recruiter' ? (user.company_name || user.name) : user.name;
      const role = user.role === 'recruiter' ? 'Recruiter' : 'Job Seeker';
      const [[existing]] = await pool.query('SELECT id FROM reviews WHERE user_id = ?', [user.id]);
      if (existing) {
        await pool.query('UPDATE reviews SET rating = ?, review_text = ?, name = ?, role = ? WHERE id = ?', [rating, text, name, role, existing.id]);
      } else {
        await pool.query('INSERT INTO reviews (user_id, name, role, rating, review_text) VALUES (?, ?, ?, ?, ?)', [user.id, name, role, rating, text]);
      }
    } else {
      const name = (req.body.name || '').trim().slice(0, 100) || 'Visitor';
      await pool.query('INSERT INTO reviews (user_id, name, role, rating, review_text) VALUES (NULL, ?, ?, ?, ?)', [name, 'Visitor', rating, text]);
    }

    // Let every admin know in their notifications bell.
    const [admins] = await pool.query(`SELECT id FROM users WHERE role = 'admin'`);
    for (const a of admins) {
      await pool.query(
        `INSERT INTO notifications (user_id, icon, title, body) VALUES (?, '⭐', 'New rating received', ?)`,
        [a.id, `${rating}-star rating${text ? ': "' + text.slice(0, 80) + (text.length > 80 ? '…' : '') + '"' : ''}`]
      );
    }
    res.status(201).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not save your rating. Please try again.' });
  }
});

module.exports = router;
