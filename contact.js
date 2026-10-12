const express = require('express');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// POST /api/contact  (public — works whether or not the sender is logged in)
router.post('/', async (req, res) => {
  try {
    const { name, email, message } = req.body;
    if (!name || !email || !message) {
      return res.status(400).json({ error: 'Name, email and message are required.' });
    }

    // If a logged-in user sent this, link it to their account.
    let userId = null;
    const header = req.headers.authorization || '';
    if (header.startsWith('Bearer ')) {
      try {
        const jwt = require('jsonwebtoken');
        const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET);
        userId = payload.id;
      } catch (e) { /* not logged in / bad token - still allow the message */ }
    }

    const [result] = await pool.query(
      'INSERT INTO contact_messages (user_id, name, email, message) VALUES (?, ?, ?, ?)',
      [userId, name.trim(), email.trim(), message.trim()]
    );

    // Notify every admin so it shows up in their notifications bell too.
    const [admins] = await pool.query(`SELECT id FROM users WHERE role = 'admin'`);
    for (const a of admins) {
      await pool.query(
        `INSERT INTO notifications (user_id, icon, title, body) VALUES (?, '✉️', 'New contact message', ?)`,
        [a.id, `${name.trim()} sent a message: "${message.trim().slice(0, 80)}${message.trim().length > 80 ? '…' : ''}"`]
      );
    }

    res.status(201).json({ ok: true, id: result.insertId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not send your message. Please try again.' });
  }
});

// GET /api/contact/mine  (logged-in user: their own messages + the team's replies)
router.get('/mine', requireAuth, async (req, res) => {
  try {
    const [msgs] = await pool.query(
      'SELECT id, message, status, created_at FROM contact_messages WHERE user_id = ? OR email = ? ORDER BY created_at DESC',
      [req.user.id, req.user.email]
    );
    const ids = msgs.map(m => m.id);
    let replies = [];
    if (ids.length) {
      [replies] = await pool.query('SELECT message_id, reply_text, created_at FROM contact_replies WHERE message_id IN (?) ORDER BY created_at ASC, id ASC', [ids]);
    }
    res.json({ messages: msgs.map(m => ({
      id: m.id, message: m.message, status: m.status, createdAt: m.created_at,
      replies: replies.filter(r => r.message_id === m.id).map(r => ({ text: r.reply_text, at: r.created_at }))
    })) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load your messages.' });
  }
});

module.exports = router;
