# Hirely — Full-Stack Job Portal

This is the **Hirely** UI turned into a fully working website: the original design
(HTML/CSS) is untouched, and it's now backed by a real **Node.js + Express API**
and a **MySQL database**, with working authentication, job/internship postings,
applications, saved jobs, notifications, and an admin panel.

```
hirely/
├── backend/
│   ├── public/            ← the frontend (original design + js/app.js)
│   │   ├── index.html
│   │   └── js/app.js      ← wires the UI to the real API
│   ├── routes/             ← Express route handlers (REST API)
│   ├── middleware/         ← JWT auth + file upload (resumes)
│   ├── uploads/resumes/    ← uploaded resumes get stored here
│   ├── db.js                ← MySQL connection pool
│   ├── schema.sql           ← database schema (run this once)
│   ├── seed.js               ← creates an admin account + sample data
│   ├── server.js             ← Express app entry point
│   ├── package.json
│   ├── .env                  ← already configured (DB_PASSWORD=root123)
│   └── .env.example
└── README.md (this file)
```

The backend serves both the API (`/api/...`) **and** the frontend (`/`), so you
only run one server and open one URL.

---

## Setup

This project ships with `backend/.env` **already filled in**, assuming your
MySQL root password is `root123` (as you provided). If that's correct, you
can skip straight to step 5. If your MySQL root password is different, open
`backend/.env` and change the `DB_PASSWORD` line first.

## 1. Prerequisites

- **Node.js** 18+ and npm
- **MySQL** (or MariaDB) 8+/10+, running locally or reachable over the network

## 2. Set up the database

Log into MySQL and run the schema file. This creates a `HIRELYDB` database and
all the tables it needs:

```bash
mysql -u root -p < backend/schema.sql
```

(You can also open `backend/schema.sql` in a MySQL GUI like MySQL Workbench or
TablePlus and run it there.)

## 3. Configure the backend

`backend/.env` is **already created and filled in** for you, assuming MySQL
root password `root123`:

```
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=root123
DB_NAME=HIRELYDB

PORT=5000
JWT_SECRET=change_this_to_a_long_random_string

ADMIN_EMAIL=admin@hirely.com
ADMIN_PASSWORD=Admin@123
```

If your MySQL root password is different, open `backend/.env` and change
`DB_PASSWORD` before continuing. (`backend/.env.example` is kept as a
template/reference — the app itself only reads `.env`.)

## 4. Install dependencies

```bash
npm install
```

## 5. Seed the database

This creates the admin account (from your `.env`) plus a demo recruiter,
demo seeker, and two sample listings so the app isn't empty on first run:

```bash
npm run seed
```

You'll see login credentials printed in the terminal, for example:

```
Admin:     admin@hirely.com / Admin@123   (use the Admin login page)
Recruiter: hr@nimbuslabs.com / Password@123
Seeker:    priya.nair@email.com / Password@123
```

## 6. Run it

```bash
npm start
```

Then open **http://localhost:5000** in your browser. That's it — the whole
site (job seeker, recruiter, and admin experiences) is live and backed by
your MySQL database.

For development with auto-restart on file changes:

```bash
npm run dev
```

---

## Opening in VS Code

1. Unzip this project and open the `hirely` folder in VS Code.
2. Open a terminal in VS Code (`` Ctrl+` ``), `cd backend`.
3. Follow steps 2–6 above.
4. (Optional) Install the "MySQL" or "Database Client" extension in VS Code if
   you want to browse the `HIRELYDB` database's tables from the editor.

---

## What's real and database-backed

The project is designed so the hiring workflow and Admin analytics use the real MySQL database:

- Registration, login, role-based access, bcrypt passwords and JWT sessions
- Jobs/internships, applications, saved listings and notifications
- Recruiter application status changes and interview dates
- Contact Us messages and Admin replies
- Ratings and reviews inside Admin Reports
- Admin dashboard statistics and reports
- **Application Overview** for Today / Yesterday / Last 7 Days / Custom Date from `applications.applied_at`
- **Monthly Overview (Jan–Dec)** from the real application records for the selected year
- **Position Breakdown** from real listings and application counts
- **Application Distribution** and **Shortlisted Distribution** from real job/internship application counts
- **Pending Approvals** for newly submitted jobs/internships; Admin can approve or reject them, and approval makes the listing visible to seekers

New or edited recruiter listings are submitted as **Pending Approval**. An Admin approval changes them to **Approved / Active** and sends the recruiter an in-app notification. Rejection keeps them unavailable to seekers and can include an Admin reason.

## API overview

All endpoints are under `/api`. Authenticated requests send
`Authorization: Bearer <token>` (the token you get back from login/register).

| Area | Endpoints |
|---|---|
| Auth | `POST /api/auth/register`, `/login`, `/admin-login`, `GET /me` |
| Profile (seeker) | `GET/PUT /api/profile`, `POST /skills`, `/languages`, `/education`, `/work-experience`, `/resume` |
| Company (recruiter) | `GET/PUT /api/profile/company` |
| Listings | `GET /api/listings`, `GET /:id`, `POST /`, `PUT /:id`, `DELETE /:id`, `GET /mine` |
| Applications | `POST /api/applications`, `GET /mine` (with dated history), `GET /listing/:id`, `GET /:id`, `PUT /:id/status` `{status, interviewAt?}` |
| Contact Us | `POST /api/contact`, `GET /api/contact/mine` |
| Reviews | `POST /api/reviews` |
| Saved | `GET/POST /api/saved`, `DELETE /:listingId` (old `/api/saved-jobs` URL still works) |
| Notifications | `GET /api/notifications`, `PUT /read-all`, `PUT /:id/read` |
| Admin | `GET /api/admin/stats`, `/users`, `/companies`, `/listings`, `/applications`; `GET/PUT /pending-approvals`; `GET /messages`, `POST /messages/:id/reply`; `GET /reviews`, `DELETE /reviews/:id` |

## Troubleshooting

- **"Can't connect to MySQL" / server won't start** — check `DB_HOST`/`DB_USER`/`DB_PASSWORD` in
  `.env`, and that MySQL is actually running (`mysqladmin -u root -p ping`).
  As of this version, the server checks the database connection *before*
  starting and will print a clear error and exit if it can't connect — it
  will not start in a broken state.
- **"Access denied for user"** — your `.env` password doesn't match your
  MySQL root (or app user) password.
- **Login/Register says "Invalid email or password" for an account you just
  registered, or "Failed to fetch"** — almost always means the server isn't
  actually running at that moment. The terminal running `npm start` must stay
  open the entire time you're using the site — if you close it, close VS
  Code, or your PC sleeps, the server stops and the page can no longer reach
  it. Restart it (`npm start`) and try again.
- **You have more than one extracted copy of this zip** (e.g.
  `hirely-fullstack`, `hirely-fullstack (1)`, `(2)`...) — each copy has its
  own separate `.env`, `node_modules`, and is a completely independent
  project. Running commands in one while editing `.env` in another is a
  common source of confusion. Pick **one** folder, delete/ignore the rest,
  and always open that same one in VS Code.
- **A previous run left the database in a broken/incomplete state** — just
  re-run `mysql -u root -p < schema.sql`. It drops and recreates every Hirely
  table, so it always leaves you with a known-good schema — safe to run as
  many times as you need (this does clear existing data in those tables,
  which is expected for a reset).
- **Port 5000 already in use** — change `PORT` in `.env`.
- **Resume uploads not showing** — make sure `backend/uploads/resumes/`
  exists and is writable (it's created automatically on first upload).



---

## What changed in this version

- **Status dropdown** (recruiter applicants table, recruiter applicant profile, admin All Applications) always offers
  `Shortlisted · Interview · Selected · Rejected`. Choosing *Interview* asks for an optional interview date/time.
- **Seeker Application Status** keeps the timeline card, now with real dates (Applied time, Shortlisted date,
  "Scheduled <interview date>", Selected / Rejected) from the new `application_status_history` table.
- **Ratings & Reviews** moved into **Admin → Reports** (Rating Distribution, Rating Breakdown, All Reviews). The home-page
  "Rate Hirely" box now saves to the new `reviews` table.
- **Contact Us**: admin **Messages → Reply** saves the reply (`contact_replies`), marks the message *Replied* and notifies
  the sender in-app if they have a Hirely account (same email). Others can be emailed via the "open in email app" button.
- **Saved**: table renamed `saved_jobs` → `saved`, API is `/api/saved`.

**Important:** re-run `mysql -u root -p < backend/schema.sql` — it adds the new tables/columns (and resets data).


---

## Update 2 — fixes

- **Auto-setup on start:** `npm start` now runs `migrate.js`, which adds any missing tables/columns (no data loss) and
  creates/refreshes the admin account from `.env` (`ADMIN_EMAIL` / `ADMIN_PASSWORD`). Admin login and Saved no longer
  break if `schema.sql` / `npm run seed` was skipped or an older database is used.
- **Saved:** save/unsave works from the listing page *and* directly on listing cards; button state always follows the database.
- **Resume is required** to apply (frontend blocks the step, backend rejects with 400). Step 2 must be filled before step 3.
- **Edit listing:** recruiter → Post a Job → *Your Listings* → **✎ Edit** (loads the form, **Save Changes** updates MySQL).
- **Notifications:** clicking a notification marks just that one as read (saved in DB).
- Server no longer hangs when a database call fails — buttons get a proper error message instead.


---

## Check that EVERYTHING works on your machine (real API + real MySQL)

```
cd backend
npm start            # terminal 1 (keep it open)
npm run selftest     # terminal 2
```

`selftest` creates a temporary seeker + recruiter and checks: admin login, register/login, publish + **edit** listing,
**save/unsave repeatedly**, **apply blocked without resume**, apply with resume, all 4 status changes (recruiter + admin),
interview date, **notification click = read**, ratings → admin Reports, Contact Us → admin **reply**, admin endpoints.
Each line prints ✅ or ❌ with the reason; it deletes its test data at the end.
