require('dotenv').config();
const express = require('express');

// Make async route handlers safe: if a database call throws, the request gets a clean
// JSON error instead of hanging forever (which made buttons look "stuck / not working").
const Layer = require('express/lib/router/layer');
const _handle = Layer.prototype.handle_request;
Layer.prototype.handle_request = function (req, res, next) {
  const fn = this.handle;
  if (fn.length > 3) return next();
  try {
    const out = fn(req, res, next);
    if (out && typeof out.catch === 'function') out.catch(next);
  } catch (err) { next(err); }
};
const cors = require('cors');
const path = require('path');

const authRoutes = require('./routes/auth');
const profileRoutes = require('./routes/profile');
const listingsRoutes = require('./routes/listings');
const applicationsRoutes = require('./routes/applications');
const savedRoutes = require('./routes/saved');
const notificationsRoutes = require('./routes/notifications');
const adminRoutes = require('./routes/admin');
const contactRoutes = require('./routes/contact');
const reviewsRoutes = require('./routes/reviews');

// Safety net: a single failed database call (e.g. wrong .env credentials,
// MySQL not running) should return an error to that one request — it should
// NEVER take down the whole server. Without this, an unhandled promise
// rejection in any route crashes the entire Node process, and every
// subsequent request (even unrelated ones) starts failing with
// "Failed to fetch" until the server is manually restarted.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection (server stays up):', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception (server stays up):', err);
});

const app = express();

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use('/api/auth', authRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/listings', listingsRoutes);
app.use('/api/applications', applicationsRoutes);
app.use('/api/saved', savedRoutes);
app.use('/api/saved-jobs', savedRoutes); // old URL kept so nothing breaks
app.use('/api/notifications', notificationsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/reviews', reviewsRoutes);

// Serve the frontend (same design, now wired to the API above)
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handler (e.g. multer file-type/size errors)
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Something went wrong.' });
});

const PORT = process.env.PORT || 5000;

// Fail fast and clearly if MySQL isn't reachable, instead of the server
// silently accepting requests it can never fulfill.
const pool = require('./db');
const migrate = require('./migrate');
pool.query('SELECT 1')
  .then(() => migrate())
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Hirely server running at http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('\n❌ Server was NOT started (database problem).');
    console.error('   Check backend/.env — DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME.');
    console.error('   Also make sure MySQL is running and you ran: mysql -u root -p < schema.sql\n');
    console.error('   Underlying error:', err.message);
    process.exit(1);
  });

