-- Hirely database schema
-- Run this once against your MySQL server, e.g.:
--   mysql -u root -p < schema.sql
--
-- This DROPS and recreates every Hirely table so you always get a known-good,
-- matching schema — safe to re-run any time (e.g. if a previous run was
-- interrupted or a table ended up with the wrong columns). It only touches
-- tables that belong to this app; it will NOT affect any other database.

CREATE DATABASE IF NOT EXISTS HIRELYDB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE HIRELYDB;

-- Drop in reverse dependency order (children before parents) so foreign
-- keys never block the reset.
DROP TABLE IF EXISTS contact_replies;
DROP TABLE IF EXISTS contact_messages;
DROP TABLE IF EXISTS reviews;
DROP TABLE IF EXISTS application_status_history;
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS saved;
DROP TABLE IF EXISTS saved_jobs;
DROP TABLE IF EXISTS applications;
DROP TABLE IF EXISTS listings;
DROP TABLE IF EXISTS accomplishments;
DROP TABLE IF EXISTS profile_languages;
DROP TABLE IF EXISTS profile_skills;
DROP TABLE IF EXISTS work_experience;
DROP TABLE IF EXISTS education;
DROP TABLE IF EXISTS users;

-- ===== USERS (seekers, recruiters, admins) =====
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  email VARCHAR(150) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('seeker','recruiter','admin') NOT NULL,

  -- seeker profile fields
  headline VARCHAR(200) DEFAULT NULL,
  summary TEXT DEFAULT NULL,
  resume_path VARCHAR(255) DEFAULT NULL,
  resume_name VARCHAR(255) DEFAULT NULL,

  -- recruiter / company profile fields
  company_name VARCHAR(200) DEFAULT NULL,
  company_tagline VARCHAR(255) DEFAULT NULL,
  company_industry VARCHAR(150) DEFAULT NULL,
  company_website VARCHAR(200) DEFAULT NULL,
  company_hq VARCHAR(150) DEFAULT NULL,
  company_vacancies INT DEFAULT NULL,
  company_about TEXT DEFAULT NULL,

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ===== PASSWORD RESET TOKENS =====
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at DATETIME NOT NULL,
  used_at DATETIME DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_password_reset_user (user_id),
  INDEX idx_password_reset_expiry (expires_at),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ===== SEEKER: education entries =====
CREATE TABLE IF NOT EXISTS education (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  degree VARCHAR(200) NOT NULL,
  institution VARCHAR(200) NOT NULL,
  years VARCHAR(50) DEFAULT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ===== SEEKER: work experience entries =====
CREATE TABLE IF NOT EXISTS work_experience (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  title VARCHAR(200) NOT NULL,
  company VARCHAR(200) NOT NULL,
  start_date DATE DEFAULT NULL,
  end_date DATE DEFAULT NULL,
  currently_working TINYINT(1) DEFAULT 0,
  description TEXT DEFAULT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ===== SEEKER: skills =====
CREATE TABLE IF NOT EXISTS profile_skills (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  skill VARCHAR(100) NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ===== SEEKER: languages =====
CREATE TABLE IF NOT EXISTS profile_languages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  language VARCHAR(100) NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ===== SEEKER: accomplishments =====
CREATE TABLE IF NOT EXISTS accomplishments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  text TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ===== LISTINGS (jobs & internships share one table) =====
CREATE TABLE IF NOT EXISTS listings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  recruiter_id INT NOT NULL,
  listing_type ENUM('job','internship') NOT NULL DEFAULT 'job',
  title VARCHAR(200) NOT NULL,
  job_type VARCHAR(50) DEFAULT 'Full-time', -- Employment type: Full-time / Part-time (mirrors employment_type, kept for older UI badges)
  employment_type VARCHAR(50) DEFAULT 'Full-time', -- Full-time / Part-time
  work_mode VARCHAR(50) DEFAULT 'On-site',         -- On-site / Remote / Hybrid
  category VARCHAR(100) DEFAULT NULL,
  location VARCHAR(150) DEFAULT NULL,
  salary_text VARCHAR(100) DEFAULT NULL,   -- e.g. "₹6–9 LPA" or "₹15k/mo" or "Unpaid"
  is_unpaid TINYINT(1) DEFAULT 0,          -- internships only
  experience VARCHAR(100) DEFAULT NULL,    -- e.g. "0–1 years"
  vacancies INT DEFAULT 1,
  duration VARCHAR(50) DEFAULT NULL,       -- for internships, e.g. "3 months"
  skills VARCHAR(500) DEFAULT NULL,        -- comma separated
  description TEXT DEFAULT NULL,
  status ENUM('active','closed') NOT NULL DEFAULT 'active',
  approval_status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  approval_note VARCHAR(255) DEFAULT NULL,
  approved_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (recruiter_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ===== APPLICATIONS =====
CREATE TABLE IF NOT EXISTS applications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  listing_id INT NOT NULL,
  seeker_id INT NOT NULL,
  full_name VARCHAR(150) DEFAULT NULL,
  email VARCHAR(150) DEFAULT NULL,
  institution VARCHAR(200) DEFAULT NULL,
  experience VARCHAR(100) DEFAULT NULL,
  cover_note TEXT DEFAULT NULL,
  resume_path VARCHAR(255) DEFAULT NULL,
  resume_name VARCHAR(255) DEFAULT NULL,
  status ENUM('Applied','Shortlisted','Interview','Selected','Rejected') NOT NULL DEFAULT 'Applied',
  interview_at DATETIME DEFAULT NULL,      -- optional interview date/time set when status = Interview
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE,
  FOREIGN KEY (seeker_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uniq_application (listing_id, seeker_id)
);

-- ===== APPLICATION STATUS HISTORY (powers the dated timeline the job seeker sees) =====
CREATE TABLE IF NOT EXISTS application_status_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  application_id INT NOT NULL,
  status ENUM('Applied','Shortlisted','Interview','Selected','Rejected') NOT NULL,
  changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE
);

-- ===== SAVED (jobs + internships a seeker bookmarked) =====
CREATE TABLE IF NOT EXISTS saved (
  id INT AUTO_INCREMENT PRIMARY KEY,
  seeker_id INT NOT NULL,
  listing_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (seeker_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE,
  UNIQUE KEY uniq_saved (seeker_id, listing_id)
);

-- ===== NOTIFICATIONS =====
CREATE TABLE IF NOT EXISTS notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  icon VARCHAR(10) DEFAULT '🔔',
  title VARCHAR(200) NOT NULL,
  body VARCHAR(400) DEFAULT NULL,
  is_read TINYINT(1) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ===== CONTACT US MESSAGES (connects visitors / seekers / recruiters to admin) =====
CREATE TABLE IF NOT EXISTS contact_messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT DEFAULT NULL,          -- set if the sender was logged in (seeker/recruiter)
  name VARCHAR(150) NOT NULL,
  email VARCHAR(150) NOT NULL,
  message TEXT NOT NULL,
  status ENUM('New','Read','Replied','Resolved') NOT NULL DEFAULT 'New',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- ===== CONTACT US: replies from the Hirely team =====
CREATE TABLE IF NOT EXISTS contact_replies (
  id INT AUTO_INCREMENT PRIMARY KEY,
  message_id INT NOT NULL,
  admin_id INT DEFAULT NULL,
  reply_text TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (message_id) REFERENCES contact_messages(id) ON DELETE CASCADE,
  FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE SET NULL
);

-- ===== RATINGS & REVIEWS (submitted from the home page, shown in Admin -> Reports) =====
CREATE TABLE IF NOT EXISTS reviews (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT DEFAULT NULL,                       -- set when a logged-in seeker/recruiter rated
  name VARCHAR(150) NOT NULL,
  role VARCHAR(30) NOT NULL DEFAULT 'Visitor',    -- Job Seeker / Recruiter / Visitor
  rating TINYINT NOT NULL,
  review_text TEXT DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);
