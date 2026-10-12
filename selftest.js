// End-to-end self test: talks to the RUNNING server (real API + real MySQL).
//   1) npm start        (in one terminal)
//   2) npm run selftest (in another terminal)
// It creates its own temporary seeker + recruiter, exercises every feature, then deletes them.
require('dotenv').config();
const BASE = process.env.TEST_BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@hirely.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Admin@123';

let passed = 0, failed = 0;
async function call(method, path, { token, body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  let payload;
  if (form) payload = form;
  else if (body) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(BASE + path, { method, headers, body: payload });
  let data = {};
  try { data = await res.json(); } catch (e) { /* empty */ }
  return { status: res.status, data };
}
async function step(name, fn) {
  try { await fn(); passed++; console.log('  ✅ ' + name); }
  catch (e) { failed++; console.log('  ❌ ' + name + '\n       → ' + e.message); }
}
function expect(cond, msg) { if (!cond) throw new Error(msg); }
function expectStatus(r, code, what) { expect(r.status === code, `${what || 'request'}: expected HTTP ${code}, got ${r.status} ${JSON.stringify(r.data)}`); }

(async () => {
  const stamp = Date.now();
  const seekerEmail = `selftest_seeker_${stamp}@example.com`;
  const recruiterEmail = `selftest_recruiter_${stamp}@example.com`;
  let admin, seeker, recruiter, listingId, internshipId, appId, msgId;

  console.log(`\nHirely self-test against ${BASE}\n`);

  await step('Server is reachable', async () => {
    const r = await call('GET', '/api/listings');
    expectStatus(r, 200, 'GET /api/listings');
  });

  await step('Admin login works', async () => {
    const r = await call('POST', '/api/auth/admin-login', { body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
    expectStatus(r, 200, 'admin-login'); admin = r.data.token; expect(admin, 'no token');
  });
  await step('Admin login rejects a wrong password', async () => {
    const r = await call('POST', '/api/auth/admin-login', { body: { email: ADMIN_EMAIL, password: 'wrong' } });
    expectStatus(r, 401);
  });

  await step('Register recruiter', async () => {
    const r = await call('POST', '/api/auth/register', { body: { name: 'Test HR', email: recruiterEmail, password: 'Password@123', role: 'recruiter', companyName: 'SelfTest Co' } });
    expectStatus(r, 201); recruiter = { token: r.data.token, id: r.data.user.id };
  });
  await step('Register seeker', async () => {
    const r = await call('POST', '/api/auth/register', { body: { name: 'Test Seeker', email: seekerEmail, password: 'Password@123', role: 'seeker' } });
    expectStatus(r, 201); seeker = { token: r.data.token, id: r.data.user.id };
  });
  await step('Seeker + recruiter can log in again', async () => {
    expectStatus(await call('POST', '/api/auth/login', { body: { email: seekerEmail, password: 'Password@123', role: 'seeker' } }), 200, 'seeker login');
    expectStatus(await call('POST', '/api/auth/login', { body: { email: recruiterEmail, password: 'Password@123', role: 'recruiter' } }), 200, 'recruiter login');
  });

  await step('Recruiter publishes a job', async () => {
    const r = await call('POST', '/api/listings', { token: recruiter.token, body: { title: 'SelfTest Developer', listingType: 'job', employmentType: 'Full-time', workMode: 'Remote', category: 'Software', location: 'Remote', salary: '₹5 LPA', experience: '0-1 years', description: 'Test job' } });
    expectStatus(r, 201); listingId = r.data.id;
  });
  await step('Recruiter publishes an internship', async () => {
    const r = await call('POST', '/api/listings', { token: recruiter.token, body: { title: 'SelfTest Intern', listingType: 'internship', employmentType: 'Part-time', workMode: 'Remote', location: 'Remote', salary: '₹10k/month', duration: '2 months', description: 'Test internship' } });
    expectStatus(r, 201); internshipId = r.data.id;
  });
  await step('Admin sees pending approvals and approves the test listings', async () => {
    let r = await call('GET', '/api/admin/pending-approvals?type=job', { token: admin });
    expectStatus(r, 200); expect(r.data.approvals.some(x => x.id === listingId), 'job missing from pending approvals');
    expectStatus(await call('PUT', '/api/admin/pending-approvals/' + listingId, { token: admin, body: { decision: 'approved' } }), 200);
    expectStatus(await call('PUT', '/api/admin/pending-approvals/' + internshipId, { token: admin, body: { decision: 'approved' } }), 200);
    r = await call('GET', '/api/listings?type=job');
    expect(r.data.listings.some(x => x.id === listingId), 'approved job not visible to seekers');
  });
  await step('Recruiter can EDIT the job (title + salary change in DB)', async () => {
    expectStatus(await call('PUT', '/api/listings/' + listingId, { token: recruiter.token, body: { title: 'SelfTest Developer EDITED', salary: '₹7 LPA', location: 'Pune', description: 'Edited desc' } }), 200, 'PUT listing');
    const r = await call('GET', '/api/listings/' + listingId);
    expect(r.data.listing.title === 'SelfTest Developer EDITED', 'title not updated');
    expect(r.data.listing.salary === '₹7 LPA', 'salary not updated');
    expect(r.data.listing.location === 'Pune', 'location not updated');
  });
  await step('Edit of another recruiter\'s listing is blocked', async () => {
    const r = await call('PUT', '/api/listings/' + listingId, { token: seeker.token, body: { title: 'hack' } });
    expect(r.status === 403, 'expected 403, got ' + r.status);
  });

  await step('Admin re-approves the edited job before it becomes live', async () => {
    const r = await call('GET', '/api/admin/pending-approvals?type=job', { token: admin });
    expectStatus(r, 200); expect(r.data.approvals.some(x => x.id === listingId), 'edited job should require approval');
    expectStatus(await call('PUT', '/api/admin/pending-approvals/' + listingId, { token: admin, body: { decision: 'approved' } }), 200);
  });
  await step('Seeker: save job twice → still saved once', async () => {
    expectStatus(await call('POST', '/api/saved', { token: seeker.token, body: { listingId } }), 200, 'save #1');
    expectStatus(await call('POST', '/api/saved', { token: seeker.token, body: { listingId } }), 200, 'save #2');
    const r = await call('GET', '/api/saved', { token: seeker.token });
    expect(r.data.saved.filter(s => s.id === listingId).length === 1, 'job not saved exactly once');
  });
  await step('Seeker: unsave, save again, unsave again (repeat works)', async () => {
    for (let i = 0; i < 2; i++) {
      expectStatus(await call('DELETE', '/api/saved/' + listingId, { token: seeker.token }), 200, 'unsave');
      let r = await call('GET', '/api/saved', { token: seeker.token });
      expect(!r.data.saved.some(s => s.id === listingId), 'still saved after unsave');
      expectStatus(await call('POST', '/api/saved', { token: seeker.token, body: { listingId } }), 200, 'save');
      r = await call('GET', '/api/saved', { token: seeker.token });
      expect(r.data.saved.some(s => s.id === listingId), 'not saved after save');
    }
  });
  await step('Old /api/saved-jobs URL still works', async () => {
    expectStatus(await call('GET', '/api/saved-jobs', { token: seeker.token }), 200);
  });

  await step('Apply WITHOUT resume is rejected (HTTP 400)', async () => {
    const fd = new FormData();
    fd.append('listingId', listingId); fd.append('fullName', 'Test Seeker'); fd.append('email', seekerEmail);
    const r = await call('POST', '/api/applications', { token: seeker.token, form: fd });
    expectStatus(r, 400, 'apply without resume');
  });
  await step('Apply WITH resume succeeds', async () => {
    const fd = new FormData();
    fd.append('listingId', listingId); fd.append('fullName', 'Test Seeker'); fd.append('email', seekerEmail);
    fd.append('institution', 'Test College'); fd.append('experience', '0-1 years'); fd.append('coverNote', 'Hire me');
    fd.append('resume', new Blob(['%PDF-1.4 test resume'], { type: 'application/pdf' }), 'resume.pdf');
    const r = await call('POST', '/api/applications', { token: seeker.token, form: fd });
    expectStatus(r, 201, 'apply'); appId = r.data.id;
  });
  await step('Applying twice is blocked', async () => {
    const fd = new FormData();
    fd.append('listingId', listingId);
    fd.append('resume', new Blob(['x'], { type: 'application/pdf' }), 'resume.pdf');
    expectStatus(await call('POST', '/api/applications', { token: seeker.token, form: fd }), 409);
  });
  await step('Seeker sees the application with history', async () => {
    const r = await call('GET', '/api/applications/mine', { token: seeker.token });
    const a = r.data.applications.find(x => x.id === appId);
    expect(a && a.status === 'Applied', 'application missing / wrong status');
    expect(a.history && a.history.length >= 1, 'no history');
  });

  await step('Recruiter sees applicant + full profile', async () => {
    const r = await call('GET', '/api/applications/listing/' + listingId, { token: recruiter.token });
    expectStatus(r, 200); expect(r.data.applicants.length === 1, 'applicant not listed');
    expectStatus(await call('GET', '/api/applications/' + appId, { token: recruiter.token }), 200, 'applicant profile');
  });
  for (const st of ['Shortlisted', 'Interview', 'Selected', 'Rejected']) {
    await step(`Recruiter sets status → ${st}`, async () => {
      const body = { status: st };
      if (st === 'Interview') body.interviewAt = '2026-12-01T10:30';
      expectStatus(await call('PUT', `/api/applications/${appId}/status`, { token: recruiter.token, body }), 200, 'status');
      const r = await call('GET', '/api/applications/mine', { token: seeker.token });
      const a = r.data.applications.find(x => x.id === appId);
      expect(a.status === st, `seeker sees "${a.status}" instead of "${st}"`);
      if (st === 'Interview') expect(a.interviewAt && a.interviewAt.startsWith('2026-12-01 10:30'), 'interview date not saved: ' + a.interviewAt);
    });
  }
  await step('Admin sets status → Shortlisted (admin dropdown)', async () => {
    expectStatus(await call('PUT', `/api/admin/applications/${appId}/status`, { token: admin, body: { status: 'Shortlisted' } }), 200);
    const r = await call('GET', '/api/admin/applications', { token: admin });
    expect(r.data.applications.find(x => x.id === appId).status === 'Shortlisted', 'admin change not saved');
  });
  await step('Invalid status is rejected', async () => {
    expectStatus(await call('PUT', `/api/applications/${appId}/status`, { token: recruiter.token, body: { status: 'Banana' } }), 400);
  });

  await step('Notifications: clicking one marks ONLY that one read', async () => {
    let r = await call('GET', '/api/notifications', { token: seeker.token });
    const unread = r.data.notifications.filter(n => !n.isRead);
    expect(unread.length >= 2, 'expected at least 2 unread notifications, got ' + unread.length);
    expectStatus(await call('PUT', `/api/notifications/${unread[0].id}/read`, { token: seeker.token }), 200);
    r = await call('GET', '/api/notifications', { token: seeker.token });
    expect(r.data.notifications.find(n => n.id === unread[0].id).isRead === true, 'clicked one still unread');
    expect(r.data.notifications.filter(n => !n.isRead).length === unread.length - 1, 'other notifications were also marked read');
  });

  await step('Review submitted → visible in admin Reports data', async () => {
    expectStatus(await call('POST', '/api/reviews', { token: seeker.token, body: { rating: 5, text: 'selftest review' } }), 201);
    const r = await call('GET', '/api/admin/reviews', { token: admin });
    expectStatus(r, 200);
    expect(r.data.reviews.some(x => x.text === 'selftest review'), 'review not in admin list');
    expect(r.data.total >= 1 && r.data.distribution['5'] >= 1, 'distribution not counted');
  });
  await step('Review without rating is rejected', async () => {
    expectStatus(await call('POST', '/api/reviews', { body: { text: 'no stars' } }), 400);
  });

  await step('Contact Us message reaches admin', async () => {
    expectStatus(await call('POST', '/api/contact', { token: seeker.token, body: { name: 'Test Seeker', email: seekerEmail, message: 'selftest hello' } }), 201);
    const r = await call('GET', '/api/admin/messages', { token: admin });
    const m = r.data.messages.find(x => x.message === 'selftest hello');
    expect(m, 'message not found for admin'); msgId = m.id;
  });
  await step('Admin reply is saved, status = Replied, user notified', async () => {
    const r = await call('POST', `/api/admin/messages/${msgId}/reply`, { token: admin, body: { text: 'selftest reply from team' } });
    expectStatus(r, 200); expect(r.data.notifiedInApp === true, 'user not notified in-app');
    const list = await call('GET', '/api/admin/messages', { token: admin });
    const m = list.data.messages.find(x => x.id === msgId);
    expect(m.status === 'Replied', 'status is ' + m.status);
    expect(m.replies.length === 1 && m.replies[0].text === 'selftest reply from team', 'reply not stored');
    const mine = await call('GET', '/api/contact/mine', { token: seeker.token });
    expect(mine.data.messages.find(x => x.id === msgId).replies.length === 1, 'seeker cannot see the reply');
  });

  await step('Admin dashboard endpoints respond', async () => {
    for (const p of ['/api/admin/stats', '/api/admin/users', '/api/admin/companies', '/api/admin/listings', '/api/admin/category-overview', '/api/admin/overview?range=today', '/api/admin/monthly-overview', '/api/admin/position-overview', '/api/admin/pending-approvals?type=job', '/api/admin/pending-approvals?type=internship']) {
      expectStatus(await call('GET', p, { token: admin }), 200, p);
    }
  });
  await step('Non-admin cannot use admin API', async () => {
    expectStatus(await call('GET', '/api/admin/stats', { token: seeker.token }), 403);
  });

  // ---- cleanup ----
  await step('Cleanup test data', async () => {
    await call('DELETE', '/api/admin/messages/' + msgId, { token: admin });
    const rv = await call('GET', '/api/admin/reviews', { token: admin });
    for (const x of (rv.data.reviews || []).filter(x => x.text === 'selftest review')) await call('DELETE', '/api/admin/reviews/' + x.id, { token: admin });
    await call('DELETE', '/api/admin/users/' + seeker.id, { token: admin });
    await call('DELETE', '/api/admin/companies/' + recruiter.id, { token: admin });
  });

  console.log(`\n${failed === 0 ? '🎉 ALL PASSED' : '⚠️  SOME FAILED'} — ${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
})().catch(e => { console.error('\nCould not run self-test:', e.message, '\nIs the server running (npm start)?'); process.exit(1); });
