const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

function signToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, name: user.name, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

function publicUser(u) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    headline: u.headline,
    companyName: u.company_name
  };
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, role, companyName } = req.body;
    if (!name || !email || !password || !role) {
      return res.status(400).json({ error: 'Name, email, password and role are required.' });
    }
    if (!['seeker', 'recruiter'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role.' });
    }
    if (role === 'recruiter' && !companyName) {
      return res.status(400).json({ error: 'Company name is required for recruiters.' });
    }

    const [existing] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
    if (existing.length) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    const hash = await bcrypt.hash(password, 10);
    const [result] = await pool.query(
      `INSERT INTO users (name, email, password_hash, role, headline, company_name)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [name, email, hash, role, role === 'seeker' ? '' : null, role === 'recruiter' ? companyName : null]
    );

    const [[user]] = await pool.query('SELECT * FROM users WHERE id = ?', [result.insertId]);

    await pool.query(
      `INSERT INTO notifications (user_id, icon, title, body) VALUES (?, '👋', 'Welcome to Hirely', ?)`,
      [user.id, role === 'seeker' ? 'Complete your profile to get noticed by recruiters.' : 'Post your first job or internship to start receiving applications.']
    );

    const token = signToken(user);
    res.status(201).json({ token, user: publicUser(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Registration failed.' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const email = (req.body.email || '').trim();
    const { password, role } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });

    const [[user]] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
    if (!user) return res.status(401).json({ error: 'Invalid email or password.' });
    if (role && user.role !== role) {
      return res.status(401).json({ error: `No ${role} account found with this email.` });
    }
    if (user.role === 'admin') return res.status(401).json({ error: 'Please use the admin login page.' });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid email or password.' });

    const token = signToken(user);
    res.json({ token, user: publicUser(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed.' });
  }
});



// POST /api/auth/forgot-password
// Creates a one-time, 1-hour reset token. The token is stored hashed in MySQL.
// In this local/demo build the reset URL is returned to the browser so the
// feature works without requiring an external SMTP account.
router.post('/forgot-password', async (req, res) => {
  try {
    const email = (req.body.email || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ error: 'Email address is required.' });

    const [[user]] = await pool.query('SELECT id, email FROM users WHERE LOWER(email) = ?', [email]);
    // Do not reveal whether an account exists.
    if (!user) return res.json({ message: 'If an account exists for this email, a reset link has been generated.' });

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    await pool.query('DELETE FROM password_reset_tokens WHERE user_id = ? OR expires_at < NOW()', [user.id]);
    await pool.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
       VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 1 HOUR))`,
      [user.id, tokenHash]
    );

    const base = `${req.protocol}://${req.get('host')}`;
    const resetUrl = `${base}/?resetToken=${encodeURIComponent(rawToken)}`;
    res.json({
      message: 'Reset link generated. It expires in 1 hour.',
      resetUrl,
      resetToken: rawToken,
      expiresInMinutes: 60
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not generate a password reset link.' });
  }
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res) => {
  try {
    const token = (req.body.token || '').trim();
    const password = req.body.password || '';
    if (!token || !password) return res.status(400).json({ error: 'Reset token and new password are required.' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const [[row]] = await pool.query(
      `SELECT id, user_id FROM password_reset_tokens
       WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW() LIMIT 1`,
      [tokenHash]
    );
    if (!row) return res.status(400).json({ error: 'This reset link is invalid or has expired.' });

    const hash = await bcrypt.hash(password, 10);
    await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [hash, row.user_id]);
    await pool.query('UPDATE password_reset_tokens SET used_at = NOW() WHERE id = ?', [row.id]);
    // Revoke any other outstanding reset links for the same user.
    await pool.query('DELETE FROM password_reset_tokens WHERE user_id = ?', [row.user_id]);

    res.json({ message: 'Password reset successfully. You can now log in with your new password.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Password reset failed.' });
  }
});

// POST /api/auth/admin-login
router.post('/admin-login', async (req, res) => {
  try {
    const email = (req.body.email || '').trim();
    const password = req.body.password || '';
    if (!email || !password) return res.status(400).json({ error: 'Please enter the admin email and password.' });
    const [[user]] = await pool.query(`SELECT * FROM users WHERE email = ? AND role = 'admin'`, [email]);
    if (!user) return res.status(401).json({ error: 'Invalid admin credentials.' });
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid admin credentials.' });
    const token = signToken(user);
    res.json({ token, user: publicUser(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Admin login failed.' });
  }
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req, res) => {
  const [[user]] = await pool.query('SELECT * FROM users WHERE id = ?', [req.user.id]);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  res.json({ user: publicUser(user) });
});

module.exports = router;
