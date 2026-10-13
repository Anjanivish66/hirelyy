// Runs automatically every time the server starts.
// It brings an OLD database up to date (new tables / columns) WITHOUT deleting any data,
// and makes sure the admin account from .env exists — so you never get stuck on
// "invalid admin credentials" or "table doesn't exist" because a step was skipped.
const bcrypt = require('bcryptjs');
const pool = require('./db');

async function tableExists(name) {
  const [r] = await pool.query(
    'SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?', [name]);
  return r.length > 0;
}
async function columnExists(table, col) {
  const [r] = await pool.query(
    'SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?', [table, col]);
  return r.length > 0;
}

async function migrate() {
  // users must already exist (created by schema.sql) — if not, tell the user clearly.
  if (!(await tableExists('users'))) {
    throw new Error('Tables not found. Run once:  mysql -u root -p < schema.sql');
  }

  if (!(await tableExists('password_reset_tokens'))) {
    await pool.query(`CREATE TABLE password_reset_tokens (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      token_hash CHAR(64) NOT NULL UNIQUE,
      expires_at DATETIME NOT NULL,
      used_at DATETIME DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_password_reset_user (user_id),
      INDEX idx_password_reset_expiry (expires_at),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`);
  }

  // saved_jobs -> saved
  if (!(await tableExists('saved'))) {
    if (await tableExists('saved_jobs')) {
      await pool.query('RENAME TABLE saved_jobs TO saved');
    } else {
      await pool.query(`CREATE TABLE saved (
        id INT AUTO_INCREMENT PRIMARY KEY,
        seeker_id INT NOT NULL,
        listing_id INT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (seeker_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE,
        UNIQUE KEY uniq_saved (seeker_id, listing_id)
      )`);
    }
  }

  if (!(await columnExists('applications', 'interview_at'))) {
    await pool.query('ALTER TABLE applications ADD COLUMN interview_at DATETIME DEFAULT NULL');
  }

  if (!(await tableExists('application_status_history'))) {
    await pool.query(`CREATE TABLE application_status_history (
      id INT AUTO_INCREMENT PRIMARY KEY,
      application_id INT NOT NULL,
      status ENUM('Applied','Shortlisted','Interview','Selected','Rejected') NOT NULL,
      changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE
    )`);
  }

  if (!(await tableExists('contact_messages'))) {
    await pool.query(`CREATE TABLE contact_messages (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT DEFAULT NULL,
      name VARCHAR(150) NOT NULL,
      email VARCHAR(150) NOT NULL,
      message TEXT NOT NULL,
      status ENUM('New','Read','Replied','Resolved') NOT NULL DEFAULT 'New',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    )`);
  } else {
    await pool.query(`ALTER TABLE contact_messages MODIFY status ENUM('New','Read','Replied','Resolved') NOT NULL DEFAULT 'New'`);
  }

  if (!(await tableExists('contact_replies'))) {
    await pool.query(`CREATE TABLE contact_replies (
      id INT AUTO_INCREMENT PRIMARY KEY,
      message_id INT NOT NULL,
      admin_id INT DEFAULT NULL,
      reply_text TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (message_id) REFERENCES contact_messages(id) ON DELETE CASCADE,
      FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE SET NULL
    )`);
  }

  if (!(await tableExists('reviews'))) {
    await pool.query(`CREATE TABLE reviews (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT DEFAULT NULL,
      name VARCHAR(150) NOT NULL,
      role VARCHAR(30) NOT NULL DEFAULT 'Visitor',
      rating TINYINT NOT NULL,
      review_text TEXT DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    )`);
  }


  if (!(await columnExists('listings', 'approval_status'))) {
    await pool.query("ALTER TABLE listings ADD COLUMN approval_status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'approved'");
  }
  if (!(await columnExists('listings', 'approval_note'))) {
    await pool.query("ALTER TABLE listings ADD COLUMN approval_note VARCHAR(255) DEFAULT NULL");
  }
  if (!(await columnExists('listings', 'approved_at'))) {
    await pool.query("ALTER TABLE listings ADD COLUMN approved_at TIMESTAMP NULL DEFAULT NULL");
  }

  // Make sure the admin account exists and its password matches .env
  const email = (process.env.ADMIN_EMAIL || 'admin@hirely.com').trim();
  const password = process.env.ADMIN_PASSWORD || 'Admin@123';
  const name = process.env.ADMIN_NAME || 'Admin User';
  const hash = await bcrypt.hash(password, 10);
  const [[existing]] = await pool.query('SELECT id, role FROM users WHERE email = ?', [email]);
  if (!existing) {
    await pool.query(`INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'admin')`, [name, email, hash]);
    console.log(`Admin account created: ${email}`);
  } else {
    await pool.query(`UPDATE users SET password_hash = ?, role = 'admin' WHERE id = ?`, [hash, existing.id]);
  }
}

module.exports = migrate;
