require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('./db');

async function upsertUser({ name, email, password, role, companyName }) {
  const [[existing]] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
  if (existing) return existing.id;
  const hash = await bcrypt.hash(password, 10);
  const [result] = await pool.query(
    `INSERT INTO users (name, email, password_hash, role, headline, company_name, company_about, company_industry)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [name, email, hash, role,
     role === 'seeker' ? 'Final-year CS student' : null,
     role === 'recruiter' ? companyName : null,
     role === 'recruiter' ? `${companyName} is a growing technology company building great products.` : null,
     role === 'recruiter' ? 'Information Technology' : null]
  );
  return result.insertId;
}

async function seed() {
  console.log('Seeding Hirely database...');

  // Admin
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@hirely.com';
  const adminId = await upsertUser({
    name: process.env.ADMIN_NAME || 'Admin User',
    email: adminEmail,
    password: process.env.ADMIN_PASSWORD || 'Admin@123',
    role: 'admin'
  });
  console.log(`Admin ready: ${adminEmail} (id ${adminId})`);

  // Sample recruiter + seeker so the app isn't empty on first run
  const recruiterId = await upsertUser({
    name: 'Nimbus HR', email: 'hr@nimbuslabs.com', password: 'Password@123', role: 'recruiter', companyName: 'Nimbus Labs'
  });
  const seekerId = await upsertUser({
    name: 'Priya Nair', email: 'priya.nair@email.com', password: 'Password@123', role: 'seeker'
  });

  const [[listingCount]] = await pool.query('SELECT COUNT(*) AS c FROM listings');
  if (listingCount.c === 0) {
    await pool.query(
      `INSERT INTO listings (recruiter_id, listing_type, title, job_type, category, location, salary_text, experience, vacancies, skills, description, approval_status, approved_at)
       VALUES (?, 'job', 'Frontend Developer', 'Full-time', 'Software', 'Remote', '₹6–9 LPA', '2–4 years', 2,
       'React,JavaScript,HTML,CSS,Redux,REST APIs',
       'We are looking for a skilled Frontend Developer to join our team. You will build user-facing features and responsive interfaces using modern web technologies.', 'approved', NOW())`,
      [recruiterId]
    );
    await pool.query(
      `INSERT INTO listings (recruiter_id, listing_type, title, job_type, category, location, salary_text, experience, vacancies, duration, skills, description, approval_status, approved_at)
       VALUES (?, 'internship', 'Web Development Intern', 'Internship', 'Software', 'Remote', '₹12,000/month', '0–1 years', 1, '2 months',
       'HTML/CSS,JavaScript,Node.js',
       'Assist the engineering team in building and testing internal tools using React and Node.js.', 'approved', NOW())`,
      [recruiterId]
    );
    console.log('Sample listings created.');
  }

  console.log('\nSeed complete. You can log in with:');
  console.log(`  Admin:     ${adminEmail} / ${process.env.ADMIN_PASSWORD || 'Admin@123'}  (use the Admin login page)`);
  console.log(`  Recruiter: hr@nimbuslabs.com / Password@123`);
  console.log(`  Seeker:    priya.nair@email.com / Password@123`);

  process.exit(0);
}

seed().catch(err => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
