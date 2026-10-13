/* =========================================================================
   Hirely — live frontend logic
   This file loads AFTER the page's original inline script, so it can safely
   override functions like go(), signIn(), openJobApplicants(), etc. to call
   the real backend instead of using hardcoded demo data. The visual design
   (HTML/CSS) is untouched — this only supplies real, dynamic behaviour.
   ========================================================================= */

/* ---------------------------- Core state -------------------------------- */
let authToken = localStorage.getItem('hirely_token') || null;
let currentUser = JSON.parse(localStorage.getItem('hirely_user') || 'null');
let currentListingId = null;   // listing currently open on job-detail / internship-detail
let currentListingType = null; // 'job' | 'internship'
let currentApplyListing = null; // { id, title, company, type } while in apply flow
let currentApplyResumeFile = null;
let currentViewedListingId = null; // for view-applicants -> job-applicants flow
let currentApplicationId = null;   // for applicant-profile status updates
// Shared state for the live Admin chart filters.
var appOverviewState = window.appOverviewState = window.appOverviewState || {};
var adminRangeState = window.adminRangeState = window.adminRangeState || {};

function saveSession(token, user) {
  authToken = token;
  currentUser = user;
  localStorage.setItem('hirely_token', token);
  localStorage.setItem('hirely_user', JSON.stringify(user));
}
function clearSession() {
  authToken = null;
  currentUser = null;
  localStorage.removeItem('hirely_token');
  localStorage.removeItem('hirely_user');
}
function initials(name) {
  return (name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}
function alertMsg(msg) { alert(msg); }

/* ============================ TOAST (real-time action confirmations) ============================ */
function toast(msg, kind) {
  let box = document.getElementById('hirelyToastBox');
  if (!box) {
    box = document.createElement('div');
    box.id = 'hirelyToastBox';
    box.style.cssText = 'position:fixed;top:18px;right:18px;z-index:99999;display:flex;flex-direction:column;gap:10px;align-items:flex-end;';
    document.body.appendChild(box);
  }
  const el = document.createElement('div');
  const bg = kind === 'error' ? '#fee2e2' : '#dcfce7';
  const border = kind === 'error' ? '#fca5a5' : '#86efac';
  const color = kind === 'error' ? '#991b1b' : '#166534';
  el.textContent = msg;
  el.style.cssText = `background:${bg};border:1px solid ${border};color:${color};padding:12px 18px;border-radius:10px;font-size:13.5px;font-weight:600;box-shadow:0 8px 24px rgba(0,0,0,0.12);max-width:340px;opacity:0;transform:translateY(-8px);transition:all .25s ease;`;
  box.appendChild(el);
  requestAnimationFrame(() => { el.style.opacity = '1'; el.style.transform = 'translateY(0)'; });
  setTimeout(() => {
    el.style.opacity = '0'; el.style.transform = 'translateY(-8px)';
    setTimeout(() => el.remove(), 250);
  }, 3200);
}

function escapeHtml(str) {
  return (str || '').toString().replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

/* ------------------------------ API helper ------------------------------- */
async function api(path, method = 'GET', body = null, isForm = false) {
  const headers = {};
  if (authToken) headers['Authorization'] = 'Bearer ' + authToken;
  const opts = { method, headers };
  if (body !== null) {
    if (isForm) {
      opts.body = body; // FormData - browser sets content-type
    } else {
      headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
  }
  const res = await fetch(path, opts);
  let data = {};
  try { data = await res.json(); } catch (e) { /* no body */ }

  if (res.status === 401) {
    clearSession();
    alertMsg(data.error || 'Please log in to continue.');
    window.go('home');
    throw new Error(data.error || 'Not authenticated');
  }
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

/* --------------------------- Sidebar / user sync -------------------------- */
function updateSidebarUserInfo() {
  if (!currentUser) return;
  document.querySelectorAll('.screen.active .side-user').forEach(su => {
    const av = su.querySelector('.av'), nm = su.querySelector('.nm'), rl = su.querySelector('.rl');
    const label = currentUser.role === 'recruiter' ? (currentUser.companyName || currentUser.name) : currentUser.name;
    if (av) av.textContent = initials(label);
    if (nm) nm.textContent = label;
    if (rl) rl.textContent = currentUser.role === 'recruiter' ? 'Recruiter' : currentUser.role === 'admin' ? 'Administrator' : 'Job Seeker';
  });
}

/* ================================ AUTH =================================== */

async function handleRegister() {
  const role = typeof currentRole !== 'undefined' ? currentRole : 'seeker';
  const name = document.getElementById('regFullName').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const password = document.getElementById('regPasswordInput').value;
  const companyName = role === 'recruiter' ? document.getElementById('regCompanyName').value.trim() : undefined;

  if (!name || !email || !password) return alertMsg('Please fill in your name, email and password.');
  if (role === 'recruiter' && !companyName) return alertMsg('Please enter your company name.');

  try {
    const data = await api('/api/auth/register', 'POST', { name, email, password, role, companyName });
    saveSession(data.token, data.user);
    toast('Account created — welcome to Hirely! 🎉');
    afterLogin(data.user);
  } catch (e) { alertMsg(e.message); }
}

// Overrides the original demo signIn() which just navigated without checking anything.
window.signIn = async function () {
  const role = typeof currentRole !== 'undefined' ? currentRole : 'seeker';
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('lgPasswordInput').value;
  if (!email || !password) return alertMsg('Please enter your email and password.');
  try {
    const data = await api('/api/auth/login', 'POST', { email, password, role });
    saveSession(data.token, data.user);
    toast('Login successful!');
    afterLogin(data.user);
  } catch (e) { alertMsg(e.message); }
};

async function handleAdminLogin() {
  const email = document.getElementById('adminLoginEmail').value.trim();
  const password = document.getElementById('adminLoginPassword').value;
  if (!email || !password) return alertMsg('Please enter the admin email and password.');
  try {
    const data = await api('/api/auth/admin-login', 'POST', { email, password });
    saveSession(data.token, data.user);
    toast('Login successful!');
    window.go('admin-dashboard');
  } catch (e) { alertMsg(e.message); }
}

function afterLogin(user) {
  // Job Seekers always browse the global approved catalog. Their email/account
  // must never restrict which approved Jobs or Internships they can see.
  if (user.role === 'recruiter') window.go('recruiter-dashboard');
  else window.go('seeker-dashboard');
}

/* ============================ NAVIGATION (go) ============================= */

// Overrides the original go() to add real data loading per screen, while
// keeping the exact same screen-toggle / scroll / sidebar-close behaviour.
window.go = function (id) {
  document.querySelectorAll('.screen').forEach(el => el.classList.toggle('active', el.dataset.screen === id));
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (typeof closeAllSidebars === 'function') closeAllSidebars();

  if (id === 'home' && currentUser) clearSession();

  if (id === 'post-job' && !window.__keepEdit) cancelEditListing(false);
  updateSidebarUserInfo();
  onScreenChange(id);
};

function onScreenChange(id) {
  switch (id) {
    case 'seeker-dashboard': loadSeekerDashboard(); break;
    case 'seeker-profile': loadSeekerProfile(); break;
    case 'browse-jobs': loadListings('job', 'jobResultsList'); break;
    case 'browse-internships': loadListings('internship', 'internshipResultsList'); break;
    case 'saved-jobs': loadSavedJobs(); break;
    case 'status-tracking': loadMyApplications(); break;
    case 'notifications-seeker': loadNotifications('notifListSeeker'); break;
    case 'notifications-recruiter': loadNotifications('notifListRecruiter'); break;
    case 'notifications-admin': loadNotifications('notifListAdmin'); break;
    case 'recruiter-dashboard': loadRecruiterDashboard(); break;
    case 'post-job': loadMyListings(); break;
    case 'view-applicants': loadViewApplicants(); break;
    case 'company-profile': loadCompanyProfile(); break;
    case 'admin-dashboard': loadAdminStats(); refreshAdminDashboardCharts(); break;
    case 'admin-analytics': refreshAdminReportsCharts(); break;
    case 'admin-users': loadAdminUsers(); break;
    case 'admin-companies': loadAdminCompanies(); break;
    case 'admin-jobs': loadAdminListings('job', 'ajTableBody'); loadAdminPendingApprovals('job', 'ajPendingBody'); break;
    case 'admin-internships': loadAdminListings('internship', 'aiTableBody'); loadAdminPendingApprovals('internship', 'aiPendingBody'); break;
    case 'admin-applications': loadAdminApplications(); break;
    case 'admin-messages': loadAdminMessages(); break;
    case 'browse-jobs-preview': loadPublicJobsPreview(); break;
    case 'home': loadHomeRecentRoles(); break;
  }
}

/* ============================ LISTINGS (browse) ============================ */

let savedIds = new Set();
async function refreshSavedIds() {
  savedIds = new Set();
  if (currentUser && currentUser.role === 'seeker') {
    try { const { saved } = await api('/api/saved'); saved.forEach(x => savedIds.add(x.id)); } catch (e) { /* ignore */ }
  }
}
function saveBtnLabel(isSaved) { return isSaved ? '✅ Saved' : '🔖 Save'; }

// Save / unsave straight from a listing card. Works repeatedly: the button always reflects the database.
async function toggleSaveFromCard(id, btn) {
  if (!currentUser || currentUser.role !== 'seeker') return alertMsg('Please log in as a job seeker to save listings.');
  if (btn.dataset.busy) return;
  btn.dataset.busy = '1';
  try {
    if (savedIds.has(id)) { await api('/api/saved/' + id, 'DELETE'); savedIds.delete(id); toast('Removed from Saved.'); }
    else { await api('/api/saved', 'POST', { listingId: id }); savedIds.add(id); toast('Saved! Find it in the Saved tab. 🔖'); }
    btn.textContent = saveBtnLabel(savedIds.has(id));
  } catch (e) { alertMsg(e.message); }
  finally { delete btn.dataset.busy; }
}

function listingCardHtml(l) {
  const openFn = l.type === 'internship' ? 'openListingDetail' : 'openListingDetail';
  const payLine = l.type === 'internship'
    ? `${escapeHtml(l.company || 'Company')} · ${escapeHtml(l.location || 'Remote')} · ${escapeHtml(l.duration || l.jobType || '')}`
    : `${escapeHtml(l.company || 'Company')} · ${escapeHtml(l.location || 'Remote')} · ${escapeHtml(l.jobType || 'Full-time')} · Posted ${escapeHtml(l.postedAgo || '')}`;
  return `<div class="job-list-card" onclick="${openFn}(${l.id}, '${l.type}')">
    <div class="co-logo">${escapeHtml(l.companyInitials || '??')}</div>
    <div class="info"><div class="title">${escapeHtml(l.title)}</div><div class="meta">${payLine}</div></div>
    <div class="pay">${escapeHtml(l.salary || '')}</div>
    ${currentUser && currentUser.role === 'seeker' ? `<button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();toggleSaveFromCard(${l.id}, this)">${saveBtnLabel(savedIds.has(l.id))}</button>` : ''}
  </div>`;
}

async function loadListings(type, containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = '<p style="color:var(--ink-soft);font-size:13px;">Loading…</p>';
  try {
    await refreshSavedIds();
    const q = new URLSearchParams({ type }).toString();
    const { listings } = await api('/api/listings?' + q);
    el.innerHTML = listings.length
      ? listings.map(listingCardHtml).join('')
      : `<p style="color:var(--ink-soft);font-size:13px;">No ${type === 'job' ? 'jobs' : 'internships'} found yet. Check back soon!</p>`;
  } catch (e) {
    el.innerHTML = `<p style="color:var(--red);font-size:13px;">${escapeHtml(e.message)}</p>`;
  }
}

function searchJobs() {
  const q = document.getElementById('jobSearchInput').value.trim();
  loadListingsSearch('job', 'jobResultsList', q);
}

function getJobFilterState() {
  const checked = id => !!document.getElementById(id)?.checked;
  return {
    location: document.getElementById('jobFilterLocation')?.value.trim() || '',
    fullTime: checked('jobFilterFullTime'),
    partTime: checked('jobFilterPartTime'),
    remote: checked('jobFilterRemote'),
    hybrid: checked('jobFilterHybrid'),
    experience: document.getElementById('jobFilterExperience')?.value || 'Any experience',
    salary: document.getElementById('jobFilterSalary')?.value || 'Any salary'
  };
}

function salaryNumbers(value) {
  const nums = String(value || '').replace(/,/g, '').match(/\d+(?:\.\d+)?/g);
  return nums ? nums.map(Number) : [];
}

function matchesSalaryRange(listing, range) {
  if (!range || range === 'Any salary') return true;
  const nums = salaryNumbers(listing.salary);
  if (!nums.length) return false;
  const max = Math.max(...nums);
  const min = Math.min(...nums);
  const salaryLpa = Math.max(min, max);
  if (range.includes('0 – ₹3')) return salaryLpa <= 3;
  if (range.includes('₹3 – ₹6')) return max >= 3 && min <= 6;
  if (range.includes('₹6 – ₹10')) return max >= 6 && min <= 10;
  if (range.includes('₹10 – ₹15')) return max >= 10 && min <= 15;
  if (range.includes('₹15 – ₹25')) return max >= 15 && min <= 25;
  if (range.includes('₹25 LPA+')) return max >= 25;
  return true;
}

function matchesJobFilters(listing, f) {
  if (f.location && !String(listing.location || '').toLowerCase().includes(f.location.toLowerCase())) return false;
  // Employment type selections are OR within their group; work modes are OR
  // within their group. If both groups are selected, they must BOTH match.
  const employmentChecks = [];
  if (f.fullTime) employmentChecks.push(String(listing.employmentType || listing.jobType || '').toLowerCase().includes('full'));
  if (f.partTime) employmentChecks.push(String(listing.employmentType || listing.jobType || '').toLowerCase().includes('part'));
  if (employmentChecks.length && !employmentChecks.some(Boolean)) return false;
  const modeChecks = [];
  if (f.remote) modeChecks.push(String(listing.workMode || '').toLowerCase().includes('remote'));
  if (f.hybrid) modeChecks.push(String(listing.workMode || '').toLowerCase().includes('hybrid'));
  if (modeChecks.length && !modeChecks.some(Boolean)) return false;
  if (f.experience !== 'Any experience') {
    const exp = String(listing.experience || '').toLowerCase();
    if (f.experience === 'Fresher' && !(/fresh|0|entry|no experience/.test(exp))) return false;
    if (f.experience === '1–3 years' && !(/1\s*[–-]\s*3|1\s*to\s*3|1-3/.test(exp))) return false;
    if (f.experience === '3–5 years' && !(/3\s*[–-]\s*5|3\s*to\s*5|3-5/.test(exp))) return false;
    if (f.experience === '5+ years' && !(/5\s*\+|5\s*years|5\s*and/.test(exp))) return false;
  }
  return matchesSalaryRange(listing, f.salary);
}

async function applyJobFilters() {
  const f = getJobFilterState();
  const q = document.getElementById('jobSearchInput')?.value.trim() || '';
  const el = document.getElementById('jobResultsList');
  if (!el) return;
  el.innerHTML = '<p style="color:var(--ink-soft);font-size:13px;">Applying filters…</p>';
  try {
    await refreshSavedIds();
    // Fetch the live approved listings, then apply the selected UI filters to the real API response.
    const params = new URLSearchParams({ type: 'job' });
    if (q) params.set('q', q);
    const { listings } = await api('/api/listings?' + params.toString());
    const filtered = listings.filter(l => matchesJobFilters(l, f));
    el.innerHTML = filtered.length
      ? filtered.map(listingCardHtml).join('')
      : '<p style="color:var(--ink-soft);font-size:13px;">No jobs match the selected filters.</p>';
  } catch (e) {
    el.innerHTML = `<p style="color:var(--red);font-size:13px;">${escapeHtml(e.message)}</p>`;
  }
}

async function searchInternships() {
  const q = document.getElementById('internshipSearchInput')?.value.trim() || '';
  const employmentType = document.getElementById('internshipEmploymentFilter')?.value || '';
  const workMode = document.getElementById('internshipWorkModeFilter')?.value || '';
  const el = document.getElementById('internshipResultsList');
  if (!el) return;
  el.innerHTML = '<p style="color:var(--ink-soft);font-size:13px;">Searching…</p>';
  try {
    await refreshSavedIds();
    const params = new URLSearchParams({ type: 'internship' });
    if (q) params.set('q', q);
    const { listings } = await api('/api/listings?' + params.toString());
    const filtered = listings.filter(l => {
      if (employmentType && String(l.employmentType || '').toLowerCase() !== employmentType.toLowerCase()) return false;
      if (workMode && String(l.workMode || '').toLowerCase() !== workMode.toLowerCase()) return false;
      return true;
    });
    el.innerHTML = filtered.length
      ? filtered.map(listingCardHtml).join('')
      : '<p style="color:var(--ink-soft);font-size:13px;">No internships match the selected filters.</p>';
  } catch (e) {
    el.innerHTML = `<p style="color:var(--red);font-size:13px;">${escapeHtml(e.message)}</p>`;
  }
}
async function loadListingsSearch(type, containerId, q) {
  const el = document.getElementById(containerId);
  el.innerHTML = '<p style="color:var(--ink-soft);font-size:13px;">Searching…</p>';
  try {
    await refreshSavedIds();
    const params = new URLSearchParams({ type });
    if (q) params.set('q', q);
    const { listings } = await api('/api/listings?' + params.toString());
    el.innerHTML = listings.length
      ? listings.map(listingCardHtml).join('')
      : `<p style="color:var(--ink-soft);font-size:13px;">No results for "${escapeHtml(q)}".</p>`;
  } catch (e) {
    el.innerHTML = `<p style="color:var(--red);font-size:13px;">${escapeHtml(e.message)}</p>`;
  }
}

/* --------------------------- Listing detail view --------------------------- */

async function openListingDetail(id, type) {
  try {
    const { listing } = await api('/api/listings/' + id);
    currentListingId = id;
    currentListingType = listing.type;
    let saved = false;
    if (currentUser && currentUser.role === 'seeker') {
      try {
        const { saved: savedList } = await api('/api/saved');
        saved = savedList.some(s => s.id === listing.id);
      } catch (e) { /* ignore */ }
    }
    renderListingDetail(listing, saved);
    window.go(listing.type === 'internship' ? 'internship-detail' : 'job-detail');
  } catch (e) {
    alertMsg(e.message);
  }
}

function jdFactsHtml(rows) {
  return `<div class="jd-facts" style="margin:12px 0;">${rows.map(r => `<div class="jd-fact-row">${r}</div>`).join('')}</div>`;
}
function jdListHtml(title, items) {
  if (!items || !items.length) return '';
  return `<h4 style="margin:12px 0 6px;font-size:13px;">${title}</h4><ul style="margin:0 0 0 18px;padding:0;font-size:12.5px;color:var(--ink-soft);">${items.map(i => `<li style="margin-bottom:4px;">${escapeHtml(i)}</li>`).join('')}</ul>`;
}

function renderListingDetail(l, saved) {
  const wrapId = l.type === 'internship' ? 'internshipDetailBody' : 'jobDetailBody';
  const wrap = document.getElementById(wrapId);
  if (!wrap) return;
  const isInternship = l.type === 'internship';
  const descLines = (l.description || '').split('\n').map(s => s.trim()).filter(Boolean);
  const summaryPara = descLines[0] || l.description || 'No description provided.';
  const bulletLines = descLines.length > 1 ? descLines.slice(1) : [];

  const factsMain = isInternship
    ? [
        `<span class="jd-fact-ico">⏱</span>${escapeHtml(l.duration || 'Duration not specified')}`,
        `<span class="jd-fact-ico">📅</span>${escapeHtml(l.experience || 'Any experience level')}`,
        `<span class="jd-fact-ico">👥</span>${l.vacancies || 1} vacancy(ies)`,
        `<span class="jd-fact-ico">📍</span>${escapeHtml(l.location || 'Remote')}`,
        `<span class="jd-fact-ico">₹</span>${escapeHtml(l.salary || 'Not disclosed')}`,
        `<span class="jd-fact-ico">◈</span>${escapeHtml((l.skills || []).join(', ') || 'Not specified')}`
      ]
    : [
        `<span class="jd-fact-ico">⏱</span>${escapeHtml(l.jobType || 'Full-time')}`,
        `<span class="jd-fact-ico">📅</span>${escapeHtml(l.experience || 'Any experience level')}`,
        `<span class="jd-fact-ico">👥</span>${l.vacancies || 1} vacancy(ies)`,
        `<span class="jd-fact-ico">📍</span>${escapeHtml(l.location || 'Remote')}`,
        `<span class="jd-fact-ico">₹</span>${escapeHtml(l.salary || 'Not disclosed')}`,
        `<span class="jd-fact-ico">◈</span>${escapeHtml((l.skills || []).join(', ') || 'Not specified')}`
      ];

  wrap.innerHTML = `
    <div class="detail-top">
      <div style="display:flex;gap:14px;align-items:flex-start;">
        <div class="co-logo" style="width:52px;height:52px;font-size:16px;">${escapeHtml(l.companyInitials || '??')}</div>
        <div>
          <h2 style="margin-bottom:2px;">${escapeHtml(l.title)}</h2>
          <p style="margin:0 0 6px;color:var(--ink-soft);">${escapeHtml(l.company || 'Company')}</p>
          <div class="jd-meta-row"><span>${l.applicantCount || 0} applicants</span><span>Posted ${escapeHtml(l.postedAgo || 'recently')}</span></div>
        </div>
      </div>
      <span class="jd-badge-type">${escapeHtml(isInternship ? 'Internship' : (l.jobType || 'Full-time'))}</span>
    </div>
    <div style="display:flex;gap:10px;margin-bottom:6px;">
      <button class="btn btn-ghost" id="detailSaveBtn" onclick="toggleSaveListing()">${saved ? '✅ Saved' : '🔖 Save'}</button>
      <button class="btn btn-primary" onclick="startApply(${l.id}, '${l.type}')">Apply Now</button>
    </div>

    <div class="jd-block">
      <div class="jd-highlight-box">
        <h4>${isInternship ? 'Internship' : 'Job'} highlights</h4>
        <p>${escapeHtml(summaryPara.slice(0, 220))}</p>
      </div>
      ${jdFactsHtml(factsMain)}
      <div class="jd-section">
        <h4>${isInternship ? 'About the Internship' : 'Job Summary'}</h4>
        <p>${escapeHtml(summaryPara)}</p>
        ${jdListHtml('Details', bulletLines)}
        <h4>Skills</h4>
        <div style="display:flex;flex-wrap:wrap;gap:8px;">
          ${(l.skills && l.skills.length ? l.skills : ['Not specified']).map(s => `<span class="tag-chip">${escapeHtml(s)}</span>`).join('')}
        </div>
      </div>
      <p class="jd-disclaimer">Disclaimer: This ${isInternship ? 'internship' : 'job'} posting is managed by the recruiter on Hirely. Role details and availability are subject to change — please confirm the latest information with the company before applying.</p>
    </div>

    <div class="jd-block">
      <h3 class="jd-block-title">About Company</h3>
      <div class="jd-facts">
        <div class="jd-fact-row"><span class="jd-fact-label">Role</span>${escapeHtml(l.title)}</div>
        <div class="jd-fact-row"><span class="jd-fact-label">Employment type</span>${escapeHtml(isInternship ? ('Internship, ' + (l.duration || '')) : (l.jobType || 'Full-time'))}</div>
        <div class="jd-fact-row"><span class="jd-fact-label">Industry</span>${escapeHtml(l.industry || 'Not specified')}</div>
      </div>
      <div class="jd-section">
        <h4>About Company</h4>
        <p>${escapeHtml(l.companyAbout || (l.company ? l.company + ' has not added a company description yet.' : 'No description provided.'))}</p>
        <p style="font-size:12.5px;"><strong style="color:var(--ink);">Company Name</strong> — ${escapeHtml(l.company || '')}</p>
      </div>
    </div>

    <div class="jd-block">
      <h3 class="jd-block-title">${isInternship ? 'Stipend' : 'Salary'}</h3>
      <div class="jd-salary-box">
        <div style="font-size:13px;color:var(--ink-soft);">${escapeHtml(l.title)} at ${escapeHtml(l.company || 'this company')} typically pays</div>
        <div class="range">${escapeHtml(l.salary || 'Not disclosed')}</div>
      </div>
      <p style="font-size:11.5px;color:var(--ink-soft);">As entered by the recruiter — may vary by experience and negotiation.</p>
    </div>
  `;
}

async function toggleSaveListing() {
  if (!currentUser || currentUser.role !== 'seeker') return alertMsg('Please log in as a job seeker to save listings.');
  const btn = document.getElementById('detailSaveBtn');
  if (btn.dataset.busy) return;
  btn.dataset.busy = '1';
  try {
    // Ask the database what the current state is, so repeated clicks never get out of sync.
    await refreshSavedIds();
    if (savedIds.has(currentListingId)) {
      await api('/api/saved/' + currentListingId, 'DELETE');
      savedIds.delete(currentListingId);
      btn.textContent = '🔖 Save';
      toast('Removed from Saved.');
    } else {
      await api('/api/saved', 'POST', { listingId: currentListingId });
      savedIds.add(currentListingId);
      btn.textContent = '✅ Saved';
      toast('Saved! Find it in the Saved tab. 🔖');
    }
  } catch (e) { alertMsg(e.message); }
  finally { delete btn.dataset.busy; }
}

/* ================================ SAVED ================================ */

async function loadSavedJobs() {
  const list = document.getElementById('savedJobsList');
  const empty = document.getElementById('noSavedJobs');
  if (!list) return;
  try {
    const { saved } = await api('/api/saved');
    list.innerHTML = saved.map(s => `
      <div class="job-list-card" id="saved-${s.id}">
        <div class="co-logo">${escapeHtml(s.companyInitials || '??')}</div>
        <div class="info"><div class="title" onclick="openListingDetail(${s.id}, '${s.type}')" style="cursor:pointer;">${escapeHtml(s.title)}</div><div class="meta">${escapeHtml(s.company || '')} · ${escapeHtml(s.location || 'Remote')} · ${escapeHtml(s.jobType || '')}</div></div>
        <div style="display:flex;gap:8px;"><button class="btn btn-primary btn-sm" onclick="startApply(${s.id}, '${s.type}')">Apply</button><button class="btn btn-ghost btn-sm" onclick="unsaveJob(${s.id})">🔖 Unsave</button></div>
      </div>`).join('');
    empty.style.display = saved.length ? 'none' : 'block';
  } catch (e) { alertMsg(e.message); }
}

// Overrides original unsaveJob(elementId) which only removed the DOM node.
window.unsaveJob = async function (listingId) {
  try {
    await api('/api/saved/' + listingId, 'DELETE');
    const el = document.getElementById('saved-' + listingId);
    if (el) el.remove();
    const list = document.getElementById('savedJobsList');
    const empty = document.getElementById('noSavedJobs');
    if (list && empty) empty.style.display = list.children.length ? 'none' : 'block';
  } catch (e) { alertMsg(e.message); }
};

/* ================================ APPLY FLOW ================================ */

async function startApply(listingId, type) {
  if (!currentUser || currentUser.role !== 'seeker') {
    alertMsg('Please log in as a job seeker to apply.');
    return window.go('choose-role');
  }
  try {
    const { listing } = await api('/api/listings/' + listingId);
    currentApplyListing = { id: listing.id, title: listing.title, company: listing.company, type: listing.type };
    currentApplyResumeFile = null;
    const fileInput = document.getElementById('applyResumeInput'); if (fileInput) fileInput.value = '';
    document.getElementById('applyHeading').textContent = `Apply — ${listing.title}, ${listing.company}`;
    document.getElementById('applyFullName').value = currentUser.name || '';
    document.getElementById('applyEmail').value = currentUser.email || '';
    document.getElementById('applyInstitution').value = '';
    document.getElementById('applyExperience').value = '';
    document.getElementById('applyCoverNote').value = '';
    window.go('apply-job');
  } catch (e) { alertMsg(e.message); }
}

let profileResumeName = null;

// Step 2 -> Step 3: the next step only opens once this step is filled in.
async function goToDocUpload() {
  if (!currentApplyListing) return alertMsg('Please choose a listing to apply to first.');
  const name = document.getElementById('applyFullName').value.trim();
  const email = document.getElementById('applyEmail').value.trim();
  const institution = document.getElementById('applyInstitution').value.trim();
  const experience = document.getElementById('applyExperience').value.trim();
  const note = document.getElementById('applyCoverNote').value.trim();
  if (!name) return alertMsg('Please enter your full name.');
  if (!/^\S+@\S+\.\S+$/.test(email)) return alertMsg('Please enter a valid email address.');
  if (!institution) return alertMsg('Please enter your institution.');
  if (!experience) return alertMsg('Please enter your experience (e.g. 0–1 years).');
  if (!note) return alertMsg('Please tell us briefly why you are a good fit.');

  profileResumeName = null;
  try { const { profile } = await api('/api/profile'); profileResumeName = profile.resumeName || null; } catch (e) { /* ignore */ }
  updateResumeUi();
  window.go('doc-upload');
}

// Submit stays disabled until a resume exists (uploaded now, or already on the profile).
function updateResumeUi() {
  const nameEl = document.getElementById('applyResumeFileName');
  const noteEl = document.getElementById('applyResumeFileNote');
  const badge = document.getElementById('applyResumeBadge');
  const submit = document.getElementById('submitApplicationBtn');
  let ready = false;
  if (currentApplyResumeFile) {
    nameEl.textContent = currentApplyResumeFile.name;
    noteEl.textContent = (currentApplyResumeFile.size / 1024).toFixed(0) + ' KB · selected for this application';
    ready = true;
  } else if (profileResumeName) {
    nameEl.textContent = profileResumeName;
    noteEl.textContent = 'From your profile — upload a different file to replace it for this application';
    ready = true;
  } else {
    nameEl.textContent = 'No resume selected';
    noteEl.textContent = 'Upload your resume (PDF or DOCX) to continue';
  }
  badge.textContent = ready ? 'Ready' : 'Required';
  badge.className = 'badge ' + (ready ? 'b-green' : 'b-red');
  submit.disabled = !ready;
  submit.style.opacity = ready ? '1' : '.5';
  submit.style.cursor = ready ? 'pointer' : 'not-allowed';
}

function onApplyResumeChosen(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  const ext = file.name.split('.').pop().toLowerCase();
  if (!['pdf', 'doc', 'docx'].includes(ext)) { input.value = ''; return alertMsg('Only PDF or DOCX files are allowed.'); }
  if (file.size > 10 * 1024 * 1024) { input.value = ''; return alertMsg('File is too large (max 10 MB).'); }
  currentApplyResumeFile = file;
  updateResumeUi();
}

async function submitApplication() {
  if (!currentApplyListing) return alertMsg('Please start your application from a job listing.');
  if (!currentApplyResumeFile && !profileResumeName) return alertMsg('Please upload your resume before submitting.');
  const btn = document.getElementById('submitApplicationBtn');
  btn.disabled = true;
  btn.textContent = 'Submitting…';
  try {
    const fd = new FormData();
    fd.append('listingId', currentApplyListing.id);
    fd.append('fullName', document.getElementById('applyFullName').value.trim());
    fd.append('email', document.getElementById('applyEmail').value.trim());
    fd.append('institution', document.getElementById('applyInstitution').value.trim());
    fd.append('experience', document.getElementById('applyExperience').value.trim());
    fd.append('coverNote', document.getElementById('applyCoverNote').value.trim());
    if (currentApplyResumeFile) fd.append('resume', currentApplyResumeFile);

    await api('/api/applications', 'POST', fd, true);
    currentApplyListing = null;
    currentApplyResumeFile = null;
    toast('Application submitted successfully! 🎉');
    window.go('status-tracking');
  } catch (e) {
    alertMsg(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Submit application →';
  }
}

/* ============================ STATUS TRACKING ============================ */

const STATUS_STEPS = ['Applied', 'Shortlisted', 'Interview', 'Selected'];

function parseDbDate(v) {
  if (!v) return null;
  const d = new Date(String(v).replace(' ', 'T'));
  return isNaN(d.getTime()) ? null : d;
}
function fmtDate(v) {
  const d = parseDbDate(v);
  return d ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
}
function fmtDateTime(v) {
  const d = parseDbDate(v);
  return d ? fmtDate(v) + ', ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
}

// Same look for every status: dotted timeline with real dates from the database.
function ticketHtml(app) {
  const at = {};
  (app.history || []).forEach(h => { at[h.status] = h.at; });
  const rejected = app.status === 'Rejected';
  const selected = app.status === 'Selected';

  let reached;
  if (rejected) {
    const idxs = (app.history || []).filter(h => h.status !== 'Rejected').map(h => STATUS_STEPS.indexOf(h.status)).filter(i => i >= 0);
    reached = idxs.length ? Math.max(...idxs) : 0;
  } else {
    reached = Math.max(0, STATUS_STEPS.indexOf(app.status));
  }
  const finished = rejected || selected;

  const item = (cls, dot, title, sub) =>
    `<div class="tl-item ${cls}"><div class="tl-dot">${dot}</div><div><div class="tl-title" ${cls ? '' : 'style="color:var(--ink-soft)"'}>${title}</div>${sub ? `<div class="tl-time">${sub}</div>` : ''}</div></div>`;

  const subFor = (step) => {
    if (step === 'Applied') return fmtDateTime(at.Applied || app.appliedAt);
    if (step === 'Interview') {
      if (app.interviewAt) return 'Scheduled ' + fmtDateTime(app.interviewAt);
      return at.Interview ? 'Moved to interview · ' + fmtDate(at.Interview) : '';
    }
    return at[step] ? fmtDate(at[step]) : '';
  };

  let html = '';
  for (let i = 0; i < 3; i++) {
    const step = STATUS_STEPS[i];
    let cls = '', dot = '';
    if (i < reached || (finished && i <= reached)) { cls = 'done'; dot = '✓'; }
    else if (i === reached && !finished) { cls = 'active'; dot = ''; }
    html += item(cls, dot, step, (cls || at[step]) ? subFor(step) : '');
  }
  if (selected) html += item('done', '✓', 'Selected', fmtDate(at.Selected));
  else if (rejected) html += item('rejected', '✕', 'Rejected', fmtDate(at.Rejected));
  else html += item('', '', 'Selected / Rejected', '');

  return `<div class="ticket">
    <div class="ticket-top"><div><div class="ticket-id">${escapeHtml(app.ticketId)}</div><div class="ticket-sub">${escapeHtml(app.title)} · ${escapeHtml(app.company)} · Applied ${fmtDate(app.appliedAt)}</div></div><div class="stamp st-${escapeHtml(app.status.toLowerCase())}">${escapeHtml(app.status)}</div></div>
    <div class="timeline">${html}</div>
  </div>`;
}

async function loadMyApplications() {
  const wrap = document.getElementById('ticketWrap');
  const empty = document.getElementById('noApplicationsNote');
  if (!wrap) return;
  try {
    const { applications } = await api('/api/applications/mine');
    wrap.innerHTML = applications.map(ticketHtml).join('');
    empty.style.display = applications.length ? 'none' : 'block';
  } catch (e) { alertMsg(e.message); }
}

/* ============================ NOTIFICATIONS ============================ */

function notifItemHtml(n) {
  return `<div class="notif-item ${n.isRead ? '' : 'notif-unread'}" data-nid="${n.id}" style="cursor:pointer;" onclick="markNotificationRead(${n.id}, this)"><div class="notif-ico">${n.icon || '🔔'}</div><div class="notif-body"><div class="nt">${escapeHtml(n.title)}</div><div class="ns">${escapeHtml(n.body || '')}</div></div><div class="notif-side"><span class="notif-time">${escapeHtml(n.timeAgo)}</span>${n.isRead ? '' : '<span class="notif-dot"></span>'}</div></div>`;
}

// Clicking one notification marks only that one as read (saved in the database).
async function markNotificationRead(id, el) {
  if (!el.classList.contains('notif-unread')) return;
  try {
    await api('/api/notifications/' + id + '/read', 'PUT');
    el.classList.remove('notif-unread');
    const dot = el.querySelector('.notif-dot');
    if (dot) dot.remove();
  } catch (e) { alertMsg(e.message); }
}

async function loadNotifications(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  try {
    const { notifications } = await api('/api/notifications');
    el.innerHTML = notifications.length
      ? notifications.map(notifItemHtml).join('')
      : '<p style="color:var(--ink-soft);font-size:13px;">No notifications yet.</p>';
  } catch (e) { alertMsg(e.message); }
}

// Overrides original markAllRead(btn) which only edited classes locally.
window.markAllRead = async function (btn) {
  try {
    await api('/api/notifications/read-all', 'PUT');
    const screenEl = btn.closest('.screen');
    if (screenEl) {
      screenEl.querySelectorAll('.notif-item.notif-unread').forEach(item => {
        item.classList.remove('notif-unread');
        const dot = item.querySelector('.notif-dot');
        if (dot) dot.remove();
      });
    }
  } catch (e) { alertMsg(e.message); }
};

/* ============================ SEEKER DASHBOARD ============================ */

async function loadSeekerDashboard() {
  if (!currentUser) return;
  document.getElementById('sdName').textContent = (currentUser.name || '').split(' ')[0] || 'there';
  try {
    const [{ applications }, { saved }, { profile }] = await Promise.all([
      api('/api/applications/mine'),
      api('/api/saved'),
      api('/api/profile')
    ]);
    document.getElementById('sdTotalApps').textContent = applications.length;
    document.getElementById('sdShortlisted').textContent = applications.filter(a => a.status === 'Shortlisted').length;
    document.getElementById('sdSelected').textContent = applications.filter(a => a.status === 'Selected').length;
    document.getElementById('sdSaved').textContent = saved.length;

    let filled = 0, total = 5;
    if (profile.headline) filled++;
    if (profile.summary) filled++;
    if (profile.education && profile.education.length) filled++;
    if (profile.skills && profile.skills.length) filled++;
    if (profile.resumeName) filled++;
    const pct = Math.round((filled / total) * 100);
    document.getElementById('sdProfileBar').style.width = pct + '%';
    document.getElementById('sdProfilePct').textContent = pct + '%';

    const recent = applications.slice(0, 5);
    document.getElementById('sdRecentApplications').innerHTML = recent.length
      ? recent.map(a => `<div class="list-row" onclick="go('status-tracking')"><div style="display:flex;align-items:center;gap:12px;"><div class="row-icon">${escapeHtml(initials(a.company))}</div><div><div class="lt">${escapeHtml(a.title)}</div><div class="ls">${escapeHtml(a.company)} · Applied ${new Date(a.appliedAt).toLocaleDateString()}</div></div></div><span class="badge">${escapeHtml(a.status)}</span></div>`).join('')
      : '<p style="color:var(--ink-soft);font-size:13px;">No applications yet — browse jobs to get started.</p>';
  } catch (e) { alertMsg(e.message); }
}

/* ============================ SEEKER PROFILE ============================ */

let seekerProfileCache = null;

async function loadSeekerProfile() {
  try {
    const { profile } = await api('/api/profile');
    seekerProfileCache = profile;
    document.getElementById('spAvatar').firstChild.textContent = initials(profile.name);
    document.getElementById('spName').value = profile.name || '';
    document.getElementById('spHeadline').value = profile.headline || '';
    document.getElementById('spSummary').value = profile.summary || '';

    document.getElementById('spEducationList').innerHTML = profile.education.length
      ? profile.education.map(e => `<div class="edu-entry" style="margin-bottom:10px;"><input value="${escapeHtml(e.degree)}" readonly><input value="${escapeHtml(e.institution)}" readonly><input value="${escapeHtml(e.years || '')}" readonly><div style="display:flex;gap:8px;margin-top:6px;"><button class="btn btn-secondary btn-sm" onclick="editEducation(${e.id})">Edit</button><button class="btn btn-secondary btn-sm" onclick="deleteEducation(${e.id})">Delete</button></div></div>`).join('')
      : '<p style="color:var(--ink-soft);font-size:13px;">No education added yet.</p>';

    document.getElementById('spWorkExperienceList').innerHTML = profile.workExperience.length
      ? profile.workExperience.map(w => `<div class="work-exp-entry" style="margin-bottom:10px;"><strong>${escapeHtml(w.title)}</strong> — ${escapeHtml(w.company)}<p style="margin:6px 0 0;font-size:12.5px;color:var(--ink-soft);">${escapeHtml(w.description || '')}</p><div style="display:flex;gap:8px;margin-top:6px;"><button class="btn btn-secondary btn-sm" onclick="editWorkExperience(${w.id})">Edit</button><button class="btn btn-secondary btn-sm" onclick="deleteWorkExperience(${w.id})">Delete</button></div></div>`).join('')
      : '<p style="color:var(--ink-soft);font-size:13px;">No work experience added yet.</p>';

    document.getElementById('spAccomplishmentsList').innerHTML = profile.accomplishments.length
      ? profile.accomplishments.map(a => `<div class="accomplishment-item"><span class="dot-ico">●</span><span style="flex:1;">${escapeHtml(a.text)}</span><button class="btn btn-secondary btn-sm" onclick="editAccomplishment(${a.id})">Edit</button><button class="btn btn-secondary btn-sm" onclick="deleteAccomplishment(${a.id})">Delete</button></div>`).join('')
      : '<p style="color:var(--ink-soft);font-size:13px;">No accomplishments added yet.</p>';

    renderChipList('spSkillsList', profile.skills, removeSkill);
    renderChipList('spLanguagesList', profile.languages, removeLanguage);

    if (profile.resumeName) {
      document.getElementById('spResumeName').textContent = profile.resumeName;
      document.getElementById('spResumeNote').textContent = 'Uploaded to your profile';
    } else {
      document.getElementById('spResumeName').textContent = 'No resume uploaded yet';
      document.getElementById('spResumeNote').textContent = '\u00A0';
    }
  } catch (e) { alertMsg(e.message); }
}

function renderChipList(containerId, items, removeFn) {
  const el = document.getElementById(containerId);
  el.innerHTML = (items || []).map(s => `<span class="chip">${escapeHtml(s)} <button onclick="${removeFn.name}('${escapeHtml(s).replace(/'/g, "\\'")}')">×</button></span>`).join('')
    || '<span style="color:var(--ink-soft);font-size:12.5px;">None added yet.</span>';
}

async function saveSeekerProfile() {
  try {
    await api('/api/profile', 'PUT', {
      name: document.getElementById('spName').value.trim(),
      headline: document.getElementById('spHeadline').value.trim(),
      summary: document.getElementById('spSummary').value.trim()
    });
    const label = document.getElementById('spName').value.trim();
    currentUser.name = label;
    saveSession(authToken, currentUser);
    alertMsg('Profile saved.');
    updateSidebarUserInfo();
  } catch (e) { alertMsg(e.message); }
}

async function addSkill() {
  const input = document.getElementById('spSkillInput');
  const skill = input.value.trim();
  if (!skill) return;
  try {
    await api('/api/profile/skills', 'POST', { skill });
    input.value = '';
    loadSeekerProfile();
  } catch (e) { alertMsg(e.message); }
}
async function removeSkill(skill) {
  try { await api('/api/profile/skills/' + encodeURIComponent(skill), 'DELETE'); loadSeekerProfile(); }
  catch (e) { alertMsg(e.message); }
}
async function addLanguage() {
  const input = document.getElementById('spLanguageInput');
  const language = input.value.trim();
  if (!language) return;
  try {
    await api('/api/profile/languages', 'POST', { language });
    input.value = '';
    loadSeekerProfile();
  } catch (e) { alertMsg(e.message); }
}
async function removeLanguage(language) {
  try { await api('/api/profile/languages/' + encodeURIComponent(language), 'DELETE'); loadSeekerProfile(); }
  catch (e) { alertMsg(e.message); }
}
async function addEducation() {
  const degree = prompt('Degree (e.g. B.Sc. Computer Science)');
  if (!degree) return;
  const institution = prompt('Institution');
  if (!institution) return;
  const years = prompt('Years (e.g. 2023 – 2026)') || '';
  try { await api('/api/profile/education', 'POST', { degree, institution, years }); loadSeekerProfile(); }
  catch (e) { alertMsg(e.message); }
}
async function addWorkExperience() {
  const title = prompt('Job / internship title');
  if (!title) return;
  const company = prompt('Company name');
  if (!company) return;
  const description = prompt('Brief description of what you did') || '';
  try { await api('/api/profile/work-experience', 'POST', { title, company, description }); loadSeekerProfile(); }
  catch (e) { alertMsg(e.message); }
}
async function addAccomplishment() {
  const text = prompt('Describe your accomplishment');
  if (!text || !text.trim()) return;
  try { await api('/api/profile/accomplishments', 'POST', { text: text.trim() }); await loadSeekerProfile(); }
  catch (e) { alertMsg(e.message); }
}
async function editAccomplishment(id) {
  const item = (seekerProfileCache?.accomplishments || []).find(a => Number(a.id) === Number(id));
  const text = prompt('Edit accomplishment', item?.text || '');
  if (text === null || !text.trim()) return;
  try { await api('/api/profile/accomplishments/' + id, 'PUT', { text: text.trim() }); await loadSeekerProfile(); }
  catch (e) { alertMsg(e.message); }
}
async function deleteAccomplishment(id) {
  if (!confirm('Delete this accomplishment?')) return;
  try { await api('/api/profile/accomplishments/' + id, 'DELETE'); await loadSeekerProfile(); }
  catch (e) { alertMsg(e.message); }
}
async function editEducation(id) {
  const e = (seekerProfileCache?.education || []).find(x => Number(x.id) === Number(id)); if (!e) return;
  const degree = prompt('Degree', e.degree || ''); if (degree === null || !degree.trim()) return;
  const institution = prompt('Institution', e.institution || ''); if (institution === null || !institution.trim()) return;
  const years = prompt('Years', e.years || ''); if (years === null) return;
  try { await api('/api/profile/education/' + id, 'PUT', { degree: degree.trim(), institution: institution.trim(), years: years.trim() }); await loadSeekerProfile(); }
  catch (err) { alertMsg(err.message); }
}
async function deleteEducation(id) {
  if (!confirm('Delete this education entry?')) return;
  try { await api('/api/profile/education/' + id, 'DELETE'); await loadSeekerProfile(); }
  catch (e) { alertMsg(e.message); }
}
async function editWorkExperience(id) {
  const w = (seekerProfileCache?.workExperience || []).find(x => Number(x.id) === Number(id)); if (!w) return;
  const title = prompt('Job / internship title', w.title || ''); if (title === null || !title.trim()) return;
  const company = prompt('Company', w.company || ''); if (company === null || !company.trim()) return;
  const description = prompt('Description', w.description || ''); if (description === null) return;
  try { await api('/api/profile/work-experience/' + id, 'PUT', { title: title.trim(), company: company.trim(), startDate: w.start_date || null, endDate: w.end_date || null, currentlyWorking: !!w.currently_working, description: description.trim() }); await loadSeekerProfile(); }
  catch (e) { alertMsg(e.message); }
}
async function deleteWorkExperience(id) {
  if (!confirm('Delete this work experience?')) return;
  try { await api('/api/profile/work-experience/' + id, 'DELETE'); await loadSeekerProfile(); }
  catch (e) { alertMsg(e.message); }
}

async function uploadProfileResume(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  try {
    const fd = new FormData();
    fd.append('resume', file);
    await api('/api/profile/resume', 'POST', fd, true);
    loadSeekerProfile();
  } catch (e) { alertMsg(e.message); }
}

/* ============================ COMPANY PROFILE ============================ */

async function loadCompanyProfile() {
  try {
    const { company } = await api('/api/profile/company');
    document.getElementById('cpAvatar').firstChild.textContent = initials(company.name);
    document.getElementById('cpName').value = company.name || '';
    document.getElementById('cpTagline').value = company.tagline || '';
    document.getElementById('cpIndustry').value = company.industry || '';
    document.getElementById('cpVacancies').value = company.vacancies || '';
    document.getElementById('cpWebsite').value = company.website || '';
    document.getElementById('cpHq').value = company.headquarters || '';
    document.getElementById('cpAbout').value = company.about || '';
  } catch (e) { alertMsg(e.message); }
}

async function saveCompanyProfile() {
  try {
    await api('/api/profile/company', 'PUT', {
      name: document.getElementById('cpName').value.trim(),
      tagline: document.getElementById('cpTagline').value.trim(),
      industry: document.getElementById('cpIndustry').value.trim(),
      vacancies: parseInt(document.getElementById('cpVacancies').value) || null,
      website: document.getElementById('cpWebsite').value.trim(),
      headquarters: document.getElementById('cpHq').value.trim(),
      about: document.getElementById('cpAbout').value.trim()
    });
    currentUser.companyName = document.getElementById('cpName').value.trim();
    saveSession(authToken, currentUser);
    updateSidebarUserInfo();
    alertMsg('Company profile saved.');
  } catch (e) { alertMsg(e.message); }
}

/* ============================ RECRUITER DASHBOARD ============================ */

async function loadRecruiterDashboard() {
  if (!currentUser) return;
  document.getElementById('rdCompanyName').textContent = currentUser.companyName || currentUser.name || 'there';
  try {
    const [{ listings }] = await Promise.all([api('/api/listings/mine')]);
    const activeJobs = listings.filter(l => l.type === 'job' && l.status === 'active' && l.approvalStatus === 'approved').length;
    const activeInternships = listings.filter(l => l.type === 'internship' && l.status === 'active' && l.approvalStatus === 'approved').length;

    let allApplicants = [];
    for (const l of listings) {
      try {
        const { applicants } = await api('/api/applications/listing/' + l.id);
        allApplicants = allApplicants.concat(applicants);
      } catch (e) { /* not owner or none */ }
    }
    document.getElementById('rdActiveJobs').textContent = activeJobs;
    document.getElementById('rdActiveInternships').textContent = activeInternships;
    document.getElementById('rdTotalApplicants').textContent = allApplicants.length;
    document.getElementById('rdSelected').textContent = allApplicants.filter(a => a.status === 'Selected').length;
    document.getElementById('rdShortlisted').textContent = allApplicants.filter(a => a.status === 'Shortlisted').length;
    document.getElementById('rdInterviews').textContent = allApplicants.filter(a => a.status === 'Interview').length;
    document.getElementById('rdRejected').textContent = allApplicants.filter(a => a.status === 'Rejected').length;

    document.getElementById('rdRecentListings').innerHTML = listings.slice(0, 5).map(l => `
      <div class="list-row" onclick="go('view-applicants')"><div><div class="lt">${escapeHtml(l.title)} <span class="badge ${l.type === 'job' ? 'b-blue' : 'b-amber'}" style="margin-left:6px;">${l.type === 'job' ? 'Job' : 'Internship'}</span></div><div class="ls">${escapeHtml(l.location || '')} · ${new Date(l.createdAt).toLocaleDateString()}</div></div><span class="badge ${l.approvalStatus === 'approved' && l.status === 'active' ? 'b-green' : l.approvalStatus === 'pending' ? 'b-amber' : 'b-red'}">${l.approvalStatus === 'approved' && l.status === 'active' ? 'Active' : l.approvalStatus === 'pending' ? 'Pending Approval' : l.approvalStatus === 'rejected' ? 'Rejected' : 'Closed'}</span></div>
    `).join('') || '<p style="color:var(--ink-soft);font-size:13px;">No listings posted yet.</p>';

    document.getElementById('rdRecentApplications').innerHTML = allApplicants.slice(0, 5).map(a => `
      <div class="list-row"><div style="display:flex;align-items:center;gap:12px;"><div class="row-icon">${escapeHtml(initials(a.name))}</div><div><div class="lt">${escapeHtml(a.name)}</div><div class="ls">Applied ${new Date(a.appliedAt).toLocaleDateString()}</div></div></div></div>
    `).join('') || '<p style="color:var(--ink-soft);font-size:13px;">No applications yet.</p>';

    refreshRecruiterCharts();
  } catch (e) { alertMsg(e.message); }
}

/* ============================ PUBLIC PREVIEW (pre-login) ============================ */

async function loadHomeRecentRoles() {
  const grid = document.getElementById('rolesGrid');
  if (!grid) return;
  try {
    const { listings } = await api('/api/listings?type=job');
    const recent = (listings || []);
    if (!recent.length) return;
    const pages = [];
    for (let i = 0; i < recent.length; i += 6) {
      pages.push(recent.slice(i, i + 6).map(l => ({
        n: l.title,
        c: `${l.company || 'Company'}`
      })));
    }
    if (pages.length) {
      rolesPages = pages;
      currentRolesPage = 0;
      renderRolesPage(0);
      const dots = document.getElementById('rolesDots');
      if (dots) dots.innerHTML = pages.map((_, i) => `<span class="${i === 0 ? 'active' : ''}" onclick="renderRolesPage(${i})"></span>`).join('');
    }
  } catch (e) {
    // Keep the original role cards as a safe fallback when the API is unavailable.
  }
}
window.loadHomeRecentRoles = loadHomeRecentRoles;

async function loadPublicJobsPreview() {
  const wrap = document.getElementById('publicJobsPreviewList');
  if (!wrap) return;
  try {
    const { listings } = await api('/api/listings?type=job');
    const active = listings.filter(l => !l.status || l.status === 'active');
    wrap.innerHTML = active.length ? active.map(l => `
      <div class="job-list-card" role="button" tabindex="0" style="cursor:pointer;" onclick="go('register')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();go('register')}"><div class="co-logo">${escapeHtml(initials(l.company))}</div><div class="info"><div class="title">${escapeHtml(l.title)}</div><div class="meta">${escapeHtml(l.company || '')} · ${escapeHtml(l.location || '')} · ${escapeHtml(l.employmentType || l.jobType || '')}</div></div><div class="pay">${escapeHtml(l.salary || '')}</div></div>
    `).join('') : '<p style="color:var(--ink-soft);">No open roles right now — check back soon!</p>';
  } catch (e) { wrap.innerHTML = '<p style="color:var(--ink-soft);">Could not load listings.</p>'; }
}

/* ============================ POST JOB / MY LISTINGS ============================ */

function onListingTypeChange() {
  const isInternship = document.getElementById('pjListingType').value === 'internship';
  document.getElementById('pjDurationField').style.display = isInternship ? 'block' : 'none';
  document.getElementById('pjUnpaidWrap').style.display = isInternship ? 'flex' : 'none';
  document.getElementById('pjSalaryLabel').textContent = isInternship ? 'Stipend Range' : 'Salary Range';
  document.getElementById('pjSalary').placeholder = isInternship ? '₹15,000/month' : '₹6–9 LPA';
  if (!isInternship) {
    document.getElementById('pjUnpaid').checked = false;
    onUnpaidChange();
  }
}

function onUnpaidChange() {
  const unpaid = document.getElementById('pjUnpaid').checked;
  const salaryInput = document.getElementById('pjSalary');
  salaryInput.disabled = unpaid;
  salaryInput.value = unpaid ? 'Unpaid' : (salaryInput.value === 'Unpaid' ? '' : salaryInput.value);
}

let editingListingId = null;

function resetListingForm() {
  ['pjTitle','pjCategory','pjLocation','pjSalary','pjExperience','pjDescription'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('pjListingType').value = 'job';
  document.getElementById('pjListingType').disabled = false;
  document.getElementById('pjEmploymentType').value = 'Full-time';
  document.getElementById('pjWorkMode').value = 'On-site';
  document.getElementById('pjUnpaid').checked = false;
  onListingTypeChange();
  document.getElementById('pjSalary').disabled = false;
}

function setListingFormMode(editing) {
  document.getElementById('pjHeading').textContent = editing ? 'Edit Listing' : 'Post a Job or Internship';
  document.getElementById('pjPublishBtn').textContent = editing ? 'Save Changes' : 'Publish Listing';
  document.getElementById('pjCancelBtn').textContent = editing ? 'Cancel editing' : 'Cancel';
}

function cancelEditListing(navigate) {
  const wasEditing = editingListingId !== null;
  editingListingId = null;
  if (wasEditing || navigate) resetListingForm();
  setListingFormMode(false);
  if (navigate) window.go('recruiter-dashboard');
}

// Recruiter clicks "Edit" on one of their listings: load it into the form, then Save Changes updates it in MySQL.
async function startEditListing(id) {
  try {
    const { listing: l } = await api('/api/listings/' + id);
    window.__keepEdit = true; window.go('post-job'); window.__keepEdit = false;
    editingListingId = id;
    document.getElementById('pjTitle').value = l.title || '';
    document.getElementById('pjListingType').value = l.type;
    document.getElementById('pjListingType').disabled = true; // a job can't be turned into an internship
    onListingTypeChange();
    document.getElementById('pjEmploymentType').value = l.employmentType || 'Full-time';
    document.getElementById('pjWorkMode').value = l.workMode || 'On-site';
    document.getElementById('pjCategory').value = l.category || '';
    document.getElementById('pjLocation').value = l.location || '';
    document.getElementById('pjExperience').value = l.experience || '';
    document.getElementById('pjDescription').value = l.description || '';
    if (l.type === 'internship') {
      document.getElementById('pjDuration').value = l.duration || '1 month';
      document.getElementById('pjUnpaid').checked = !!l.isUnpaid;
    }
    document.getElementById('pjSalary').value = l.isUnpaid ? 'Unpaid' : (l.salary || '');
    onUnpaidChange();
    if (l.isUnpaid) document.getElementById('pjSalary').value = 'Unpaid';
    setListingFormMode(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (e) { alertMsg(e.message); }
}

async function publishListing() {
  const title = document.getElementById('pjTitle').value.trim();
  const description = document.getElementById('pjDescription').value.trim();
  const listingType = document.getElementById('pjListingType').value;
  const isUnpaid = document.getElementById('pjUnpaid').checked;
  const salary = document.getElementById('pjSalary').value.trim();
  if (!title || !description) return alertMsg('Please fill in at least a title and description.');
  if (listingType !== 'internship' && !salary) return alertMsg('Please enter a salary range.');
  if (listingType === 'internship' && !isUnpaid && !salary) return alertMsg('Please enter a stipend range, or mark this internship as unpaid.');
  const editing = editingListingId !== null;
  const btn = document.getElementById('pjPublishBtn');
  btn.disabled = true; btn.textContent = editing ? 'Saving…' : 'Publishing…';
  const payload = {
    title,
    listingType,
    employmentType: document.getElementById('pjEmploymentType').value,
    workMode: document.getElementById('pjWorkMode').value,
    category: document.getElementById('pjCategory').value.trim(),
    location: document.getElementById('pjLocation').value.trim(),
    salary,
    isUnpaid,
    experience: document.getElementById('pjExperience').value.trim(),
    duration: listingType === 'internship' ? document.getElementById('pjDuration').value : null,
    description
  };
  try {
    if (editing) {
      await api('/api/listings/' + editingListingId, 'PUT', payload);
      toast('Listing updated successfully! ✅');
      cancelEditListing(false);
      loadMyListings();
    } else {
      await api('/api/listings', 'POST', payload);
      resetListingForm();
      loadMyListings();
      toast('Listing published successfully! 🎉');
      go('recruiter-dashboard');
    }
  } catch (e) { alertMsg(e.message); }
  finally { btn.disabled = false; btn.textContent = editingListingId !== null ? 'Save Changes' : 'Publish Listing'; }
}

async function loadMyListings() {
  const wrap = document.getElementById('myListingsWrap');
  if (!wrap) return;
  try {
    const { listings } = await api('/api/listings/mine');
    wrap.innerHTML = listings.length ? listings.map(l => `
      <div class="job-list-card">
        <div class="co-logo">${escapeHtml(initials(l.title))}</div>
        <div class="info"><div class="title">${escapeHtml(l.title)} <span class="badge ${l.type === 'job' ? 'b-blue' : 'b-amber'}" style="margin-left:6px;">${l.type === 'job' ? 'Job' : 'Internship'}</span></div><div class="meta">${escapeHtml(l.location || '')} · ${escapeHtml(l.jobType || '')} · ${l.applicantCount} applicants</div></div>
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="badge ${l.approvalStatus === 'pending' ? 'b-amber' : l.approvalStatus === 'approved' && l.status === 'active' ? 'b-green' : 'b-red'}">${l.approvalStatus === 'pending' ? 'Pending Approval' : l.approvalStatus === 'approved' && l.status === 'active' ? 'Active' : l.approvalStatus === 'rejected' ? 'Rejected' : 'Closed'}</span>
          <button class="btn btn-primary btn-sm" onclick="event.stopPropagation();startEditListing(${l.id})">✎ Edit</button>
          <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();toggleListingStatus(${l.id}, '${l.status}')">${l.status === 'active' ? 'Close' : 'Reopen'}</button>
          <button class="btn btn-danger btn-sm" onclick="event.stopPropagation();deleteListing(${l.id})">Delete</button>
        </div>
      </div>`).join('') : '<p style="color:var(--ink-soft);font-size:13px;">You haven\'t posted any listings yet.</p>';
  } catch (e) { alertMsg(e.message); }
}

async function toggleListingStatus(id, currentStatus) {
  try {
    await api('/api/listings/' + id, 'PUT', { status: currentStatus === 'active' ? 'closed' : 'active' });
    loadMyListings();
  } catch (e) { alertMsg(e.message); }
}
async function deleteListing(id) {
  if (!confirm('Delete this listing? This cannot be undone.')) return;
  try { await api('/api/listings/' + id, 'DELETE'); loadMyListings(); }
  catch (e) { alertMsg(e.message); }
}

/* ============================ VIEW APPLICANTS (recruiter) ============================ */

async function loadViewApplicants() {
  const tbody = document.getElementById('vaTableBody');
  if (!tbody) return;
  try {
    const { listings } = await api('/api/listings/mine');
    tbody.innerHTML = listings.length ? listings.map(l => `
      <tr>
        <td><strong>${escapeHtml(l.title)}</strong></td>
        <td><span class="badge ${l.type === 'job' ? 'b-blue' : 'b-amber'}">${l.type === 'job' ? 'Job' : 'Internship'}</span></td>
        <td>${escapeHtml(l.location || '')}</td>
        <td>${l.applicantCount}</td>
        <td><button class="btn btn-ghost btn-sm" onclick="openJobApplicants(${l.id})">View Applicants</button></td>
      </tr>`).join('') : '<tr><td colspan="5" style="color:var(--ink-soft);">No listings yet — post one to start receiving applicants.</td></tr>';
  } catch (e) { alertMsg(e.message); }
}

function jaStatusClass(status) {
  if (status === 'Selected') return 'b-green';
  if (status === 'Rejected') return 'b-red';
  if (status === 'Applied') return 'b-blue';
  return 'b-amber';
}


/* ============================ STATUS DROPDOWN (recruiter + admin) ============================
   Options are always: Shortlisted · Interview · Selected · Rejected.
   Choosing "Interview" asks for an (optional) interview date/time first.            */

const SETTABLE_STATUSES = ['Shortlisted', 'Interview', 'Selected', 'Rejected'];

function statusSelectHtml(current, handlerCall, extraStyle) {
  const placeholder = current === 'Applied' ? '<option value="Applied" selected disabled>Applied</option>' : '';
  const opts = SETTABLE_STATUSES.map(s => `<option value="${s}" ${s === current ? 'selected' : ''}>${s}</option>`).join('');
  return `<select style="border-radius:8px;padding:4px 8px;font-size:12px;${extraStyle || ''}" onchange="${handlerCall}">${placeholder}${opts}</select>`;
}

let pendingModalCancel = null;
const _origCloseHmModal = window.closeHmModal;
window.closeHmModal = function () {
  if (pendingModalCancel) { const c = pendingModalCancel; pendingModalCancel = null; c(); }
  _origCloseHmModal();
};

function askInterviewDate(onConfirm, onCancel) {
  pendingModalCancel = onCancel;
  openHmModal(`
    <h3>Schedule interview</h3>
    <p style="font-size:13px;">Pick the interview date &amp; time — the applicant will see it on their Application Status page. You can also skip the date.</p>
    <div class="field"><label>Interview date &amp; time</label><input type="datetime-local" id="interviewAtInput"></div>
    <div style="display:flex;gap:10px;margin-top:14px;">
      <button class="btn btn-primary" id="interviewConfirmBtn">Confirm</button>
      <button class="btn btn-ghost" id="interviewSkipBtn">Skip date</button>
    </div>`);
  document.getElementById('interviewConfirmBtn').onclick = () => {
    const v = document.getElementById('interviewAtInput').value;
    if (!v) return alertMsg('Please choose a date and time, or press "Skip date".');
    pendingModalCancel = null; _origCloseHmModal(); onConfirm(v);
  };
  document.getElementById('interviewSkipBtn').onclick = () => { pendingModalCancel = null; _origCloseHmModal(); onConfirm(null); };
}

// kind: 'inline' (recruiter applicants table: a=listingId, b=applicationId),
//       'profile' (recruiter applicant profile: a=listingId, b=applicationId),
//       'admin'   (admin all applications: a=applicationId)
async function pickStatus(sel, kind, a, b) {
  const status = sel.value;
  const refresh = () => {
    if (kind === 'inline') return openJobApplicants(a);
    if (kind === 'profile') return openApplicantProfile(a, b);
    return loadAdminApplications();
  };
  const run = async (interviewAt) => {
    try {
      const url = kind === 'admin' ? '/api/admin/applications/' + a + '/status' : '/api/applications/' + b + '/status';
      await api(url, 'PUT', { status, interviewAt });
      toast('Status updated to "' + status + '".');
    } catch (e) { alertMsg(e.message); }
    refresh();
  };
  if (status === 'Interview') askInterviewDate(run, refresh);
  else run(null);
}

// Overrides original demo version (used a hardcoded jobApplicantsData object).
window.openJobApplicants = async function (listingId) {
  try {
    const { listingTitle, applicants } = await api('/api/applications/listing/' + listingId);
    currentViewedListingId = listingId;
    document.getElementById('jaHeading').textContent = 'Applicants — ' + listingTitle;
    document.getElementById('jaTableBody').innerHTML = applicants.length ? applicants.map(a => {
      const when = a.status === 'Interview' && a.interviewAt ? `<div style="font-size:11px;color:var(--ink-soft);margin-top:3px;">📅 ${escapeHtml(fmtDateTime(a.interviewAt))}</div>` : '';
      return `
      <tr>
        <td>${escapeHtml(a.name)}</td>
        <td><a style="color:var(--primary);font-weight:600;cursor:pointer;" onclick="openApplicantProfile(${listingId}, ${a.id})">View</a></td>
        <td>${statusSelectHtml(a.status, `pickStatus(this, 'inline', ${listingId}, ${a.id})`)}${when}</td>
        <td><button class="btn btn-ghost btn-sm" onclick="openApplicantProfile(${listingId}, ${a.id})">View Profile</button></td>
      </tr>`;
    }).join('') : '<tr><td colspan="4" style="color:var(--ink-soft);">No applicants yet.</td></tr>';
    window.go('job-applicants');
  } catch (e) { alertMsg(e.message); }
};

// Overrides original demo version (used the hardcoded jobApplicantsData object).
window.openApplicantProfile = async function (listingId, applicationId) {
  try {
    const { applicant } = await api('/api/applications/' + applicationId);
    currentApplicationId = applicationId;
    currentViewedListingId = listingId;
    document.getElementById('apAvatar').textContent = applicant.initials;
    document.getElementById('apName').textContent = applicant.name;
    document.getElementById('apHeadline').textContent = applicant.headline;
    const badge = document.getElementById('apStatusBadge');
    badge.textContent = applicant.status;
    badge.className = 'badge ' + jaStatusClass(applicant.status);
    const statusSelect = document.getElementById('apStatusSelect');
    statusSelect.innerHTML = (applicant.status === 'Applied' ? '<option value="Applied" selected disabled>Applied</option>' : '') +
      SETTABLE_STATUSES.map(s => `<option value="${s}" ${s === applicant.status ? 'selected' : ''}>${s}</option>`).join('');
    statusSelect.disabled = false;
    statusSelect.onchange = function () { pickStatus(this, 'profile', listingId, applicationId); };
    document.getElementById('apSummary').textContent = applicant.summary;
    document.getElementById('apEducation').textContent = applicant.education;
    document.getElementById('apSkills').innerHTML = applicant.skills.map(s => `<span class="chip">${escapeHtml(s)}</span>`).join('') || '<span style="color:var(--ink-soft);font-size:12.5px;">None listed.</span>';
    document.getElementById('apAccomplishments').innerHTML = applicant.accomplishments.length
      ? applicant.accomplishments.map(x => `<div class="accomplishment-item"><span class="dot-ico">●</span>${escapeHtml(x)}</div>`).join('')
      : '<p style="margin:0;">No accomplishments added.</p>';
    document.getElementById('apWorkExperience').innerHTML = applicant.workExperience.length
      ? applicant.workExperience.map(w => `<div class="accomplishment-item" style="display:block;"><strong>${escapeHtml(w.title)}</strong> — ${escapeHtml(w.company)}<br><span style="font-size:11.5px;color:var(--ink-soft);">${escapeHtml(w.duration)}</span><p style="margin:6px 0 0;">${escapeHtml(w.description || '')}</p></div>`).join('')
      : '<p style="margin:0;">No work experience added.</p>';
    document.getElementById('apLanguages').innerHTML = applicant.languages.map(l => `<span class="chip">${escapeHtml(l)}</span>`).join('') || '<span style="color:var(--ink-soft);font-size:12.5px;">None listed.</span>';
    document.getElementById('apResumeName').textContent = applicant.resumeName;
    document.getElementById('apResumeLink').setAttribute('href', applicant.resumePath || '#');
    window.go('applicant-profile');
  } catch (e) { alertMsg(e.message); }
};

async function loadAdminStats() {
  try {
    const { stats } = await api('/api/admin/stats');
    const map = {
      adTotalUsers: stats.totalUsers,
      adActiveJobs: stats.activeJobs,
      adActiveInternships: stats.activeInternships,
      adTotalApplications: stats.totalApplications,
      adShortlisted: stats.shortlisted,
      adInterviews: stats.interviews,
      adSelected: stats.selected,
      adRejected: stats.rejected
    };
    Object.entries(map).forEach(([id, value]) => {
      const el = document.getElementById(id);
      if (el) el.textContent = Number(value || 0);
    });
    await Promise.all([
      renderAdminRecentListings(),
      renderAdminPendingApprovalsDashboard(),
      renderAdminBreakdownAndFeed(),
      renderAdminNewMessagesCount()
    ]);
  } catch (e) {
    console.error('Admin dashboard load failed:', e);
    alertMsg(e.message || 'Unable to load Admin Dashboard.');
  }
}
window.loadAdminStats = loadAdminStats;

async function loadAdminUsers() {
  const tbody = document.getElementById('auTableBody');
  try {
    const { users } = await api('/api/admin/users');
    tbody.innerHTML = users.length ? users.map(u => `
      <tr>
        <td>${escapeHtml(u.name)}</td>
        <td><span class="badge b-blue">Job Seeker</span></td>
        <td>${escapeHtml(u.email)}</td>
        <td>${new Date(u.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</td>
        <td style="display:flex;gap:8px;">
          <button class="btn btn-ghost btn-sm" onclick="adminViewUser(${u.id})">View Profile</button>
          <button class="btn btn-danger btn-sm" onclick="adminDeleteUser(${u.id})">Remove</button>
        </td>
      </tr>`).join('') : '<tr><td colspan="5" style="color:var(--ink-soft);">No users yet.</td></tr>';
  } catch (e) { alertMsg(e.message); }
}
async function adminViewUser(id) {
  try {
    const { profile: p } = await api('/api/admin/users/' + id + '/profile');
    const esc = escapeHtml;
    const joined = p.joinedAt ? new Date(p.joinedAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '—';
    const educationHtml = p.education && p.education.length
      ? p.education.map(ed => `
          <div style="margin-bottom:16px;">
            <p class="hm-profile-edu-degree">${esc(ed.degree || 'Education')}</p>
            <p class="hm-profile-edu-meta">${esc(ed.institution || '')}${ed.year ? ' · ' + esc(String(ed.year)) : ''}</p>
          </div>`).join('')
      : '<p class="hm-profile-work-empty">No education added.</p>';
    const skillsHtml = p.skills && p.skills.length
      ? `<div class="hm-profile-chips">${p.skills.map(s => `<span class="chip">${esc(s)}</span>`).join('')}</div>`
      : '<p class="hm-profile-work-empty">No skills added.</p>';
    const accomplishmentsHtml = p.accomplishments && p.accomplishments.length
      ? p.accomplishments.map(x => `<div class="hm-profile-accomplishment"><span class="hm-profile-dot">●</span><span>${esc(x)}</span></div>`).join('')
      : '<p class="hm-profile-work-empty">No accomplishments added.</p>';
    const workHtml = p.workExperience && p.workExperience.length
      ? p.workExperience.map(w => `
          <div style="padding:12px 0;border-bottom:1px solid var(--line);">
            <p style="margin:0;font-size:16px;font-weight:800;">${esc(w.title || 'Work Experience')}</p>
            <p style="margin:3px 0;color:var(--ink-soft);font-size:14px;">${esc(w.company || '')}${w.duration ? ' · ' + esc(w.duration) : ''}</p>
            ${w.description ? `<p style="margin:7px 0 0;color:var(--ink-soft);font-size:14px;line-height:1.5;">${esc(w.description)}</p>` : ''}
          </div>`).join('')
      : '<p class="hm-profile-work-empty">No work experience added.</p>';
    const languagesHtml = p.languages && p.languages.length
      ? `<div class="hm-profile-chips">${p.languages.map(l => `<span class="chip">${esc(l)}</span>`).join('')}</div>`
      : '';
    const resumeHtml = p.resumePath
      ? `<div class="hm-profile-section"><a class="btn btn-ghost btn-sm" href="${esc(p.resumePath)}" target="_blank" rel="noopener">View Resume${p.resumeName ? ' — ' + esc(p.resumeName) : ''}</a></div>`
      : '';

    openHmModal(`
      <div class="hm-profile-head">
        <div class="hm-profile-avatar">${esc(p.initials || hmInitials(p.name || 'User'))}</div>
        <div>
          <h3 class="hm-profile-name">${esc(p.name || 'User')}</h3>
          <p class="hm-profile-headline">${esc(p.headline || 'Job Seeker')}</p>
        </div>
      </div>

      <div class="hm-profile-row"><span class="k">Email</span><span class="v">${esc(p.email || '—')}</span></div>
      <div class="hm-profile-row"><span class="k">Role</span><span class="v"><span class="badge b-blue">Job Seeker</span></span></div>
      <div class="hm-profile-row"><span class="k">Joined</span><span class="v">${joined}</span></div>
      <div class="hm-profile-row"><span class="k">Account Status</span><span class="v"><span class="badge b-green">Active</span></span></div>

      <div class="hm-profile-section">
        <h4>Profile Summary</h4>
        <p class="hm-profile-summary">${esc(p.summary || 'No profile summary added.')}</p>
      </div>

      <div class="hm-profile-section">
        <h4>Education</h4>
        ${educationHtml}
      </div>

      <div class="hm-profile-section">
        <h4>Skills</h4>
        ${skillsHtml}
      </div>

      <div class="hm-profile-section">
        <h4>Accomplishments</h4>
        ${accomplishmentsHtml}
      </div>

      <div class="hm-profile-section">
        <h4>Work Experience</h4>
        ${workHtml}
      </div>

      ${languagesHtml ? `<div class="hm-profile-section"><h4>Languages</h4>${languagesHtml}</div>` : ''}
      ${resumeHtml}
    `);
  } catch (e) { alertMsg(e.message); }
}
async function adminDeleteUser(id) {
  if (!confirm('Remove this user account? This cannot be undone.')) return;
  try { await api('/api/admin/users/' + id, 'DELETE'); loadAdminUsers(); loadAdminStats(); }
  catch (e) { alertMsg(e.message); }
}

async function loadAdminCompanies() {
  const tbody = document.getElementById('acTableBody');
  try {
    const { companies } = await api('/api/admin/companies');
    tbody.innerHTML = companies.length ? companies.map(c => `
      <tr>
        <td>${escapeHtml(c.company_name || c.name)}</td>
        <td><span class="badge b-purple">Recruiter</span></td>
        <td>${escapeHtml(c.email)}</td>
        <td>${new Date(c.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</td>
        <td style="display:flex;gap:8px;">
          <button class="btn btn-ghost btn-sm" onclick="adminViewCompany(${c.id})">View Company</button>
          <button class="btn btn-danger btn-sm" onclick="adminDeleteCompany(${c.id})">Remove</button>
        </td>
      </tr>`).join('') : '<tr><td colspan="5" style="color:var(--ink-soft);">No companies yet.</td></tr>';
  } catch (e) { alertMsg(e.message); }
}
async function adminViewCompany(id) {
  try {
    const { profile: p } = await api('/api/admin/companies/' + id + '/profile');
    const joined = p.joinedAt ? new Date(p.joinedAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '—';
    const vacancies = (p.vacancies !== null && p.vacancies !== undefined && String(p.vacancies).trim() !== '') ? p.vacancies : p.listingCount;
    const website = p.website ? escapeHtml(p.website) : '—';
    openHmModal(`
      <div class="hm-company-head">
        <div class="hm-company-avatar">${escapeHtml(p.initials || 'CO')}</div>
        <div>
          <h3 class="hm-company-name">${escapeHtml(p.name || p.contactName || 'Company')}</h3>
          <span class="hm-company-role">Recruiter</span>
        </div>
      </div>
      <div class="hm-company-rows">
        <div class="hm-company-row"><span class="k">Contact Email</span><span class="v">${escapeHtml(p.email || '—')}</span></div>
        <div class="hm-company-row"><span class="k">Joined</span><span class="v">${joined}</span></div>
        <div class="hm-company-row"><span class="k">Account Status</span><span class="v"><span class="hm-company-status">Active</span></span></div>
        <div class="hm-company-row"><span class="k">Industry</span><span class="v">${escapeHtml(p.industry || '—')}</span></div>
        <div class="hm-company-row"><span class="k">Vacancies</span><span class="v">${escapeHtml(vacancies)}</span></div>
        <div class="hm-company-row"><span class="k">Website</span><span class="v">${website}</span></div>
        <div class="hm-company-row"><span class="k">Headquarters</span><span class="v">${escapeHtml(p.headquarters || '—')}</span></div>
      </div>
      <div class="hm-profile-section">
        <h4>About the Company</h4>
        <p class="hm-company-about">${escapeHtml(p.about || 'No company description added.')}</p>
      </div>
    `);
  } catch (e) { alertMsg(e.message); }
}
async function adminDeleteCompany(id) {
  if (!confirm('Remove this company account? This will also remove their listings. Cannot be undone.')) return;
  try { await api('/api/admin/companies/' + id, 'DELETE'); loadAdminCompanies(); loadAdminStats(); }
  catch (e) { alertMsg(e.message); }
}

/* ============================ CONTACT US (connects everyone to admin) ============================ */

async function submitContactMessage() {
  const name = document.getElementById('ctName').value.trim();
  const email = document.getElementById('ctEmail').value.trim();
  const message = document.getElementById('ctMessage').value.trim();
  if (!name || !email || !message) return alertMsg('Please fill in your name, email and message.');
  const btn = document.getElementById('ctSendBtn');
  btn.disabled = true; btn.textContent = 'Sending…';
  try {
    await api('/api/contact', 'POST', { name, email, message });
    document.getElementById('ctName').value = '';
    document.getElementById('ctEmail').value = '';
    document.getElementById('ctMessage').value = '';
    toast('Message sent — our team will get back to you soon!');
  } catch (e) { alertMsg(e.message); }
  finally { btn.disabled = false; btn.textContent = 'Send Message'; }
}

let adminMessagesCache = {};

async function loadAdminMessages() {
  const tbody = document.getElementById('amTableBody');
  try {
    const { messages } = await api('/api/admin/messages');
    adminMessagesCache = {};
    messages.forEach(m => { adminMessagesCache[m.id] = m; });
    tbody.innerHTML = messages.length ? messages.map(m => `
      <tr>
        <td>${escapeHtml(m.name)}</td>
        <td>${escapeHtml(m.email)}</td>
        <td style="max-width:260px;">${escapeHtml(m.message)}${m.replies.length ? `<div style="font-size:11px;color:var(--green);margin-top:4px;">↩ ${m.replies.length} repl${m.replies.length > 1 ? 'ies' : 'y'} sent</div>` : ''}</td>
        <td>${new Date(m.created_at.replace(' ', 'T')).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
        <td>
          <select style="border-radius:8px;padding:4px 8px;font-size:12px;" onchange="adminMessageStatus(${m.id}, this.value)">
            ${['New','Read','Replied','Resolved'].map(st => `<option value="${st}" ${st === m.status ? 'selected' : ''}>${st}</option>`).join('')}
          </select>
        </td>
        <td style="white-space:nowrap;"><button class="btn btn-primary btn-sm" onclick="openReplyModal(${m.id})">Reply</button> <button class="btn btn-danger btn-sm" onclick="adminDeleteMessage(${m.id})">Delete</button></td>
      </tr>`).join('') : '<tr><td colspan="6" style="color:var(--ink-soft);">No messages yet.</td></tr>';
  } catch (e) { alertMsg(e.message); }
}

function openReplyModal(id) {
  const m = adminMessagesCache[id];
  if (!m) return;
  const thread = m.replies.map(r => `<div class="reply-bubble"><small>${escapeHtml(r.admin || 'Hirely team')} · ${escapeHtml(fmtDateTime(r.at))}</small>${escapeHtml(r.text)}</div>`).join('');
  openHmModal(`
    <h3 style="margin-bottom:2px;">Reply to ${escapeHtml(m.name)}</h3>
    <p style="margin:0 0 12px;font-size:12.5px;">${escapeHtml(m.email)}</p>
    <div class="msg-orig">${escapeHtml(m.message)}</div>
    ${thread ? `<div class="reply-thread">${thread}</div>` : ''}
    <div class="field" style="margin-top:14px;"><label>Your reply</label><textarea id="replyText" rows="4" placeholder="Write your reply…"></textarea></div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;">
      <button class="btn btn-primary" id="replySendBtn" onclick="sendReply(${id})">Send reply</button>
      <button class="btn btn-ghost" onclick="emailReply(${id})">✉ Also open in email app</button>
    </div>`);
}

async function sendReply(id) {
  const text = document.getElementById('replyText').value.trim();
  if (!text) return alertMsg('Please write a reply first.');
  const btn = document.getElementById('replySendBtn');
  btn.disabled = true; btn.textContent = 'Sending…';
  try {
    const r = await api('/api/admin/messages/' + id + '/reply', 'POST', { text });
    closeHmModal();
    toast(r.notifiedInApp ? 'Reply sent — the user was notified in-app.' : 'Reply saved. This sender has no Hirely account — use "Open in email app" to email it.');
    loadAdminMessages();
  } catch (e) { alertMsg(e.message); btn.disabled = false; btn.textContent = 'Send reply'; }
}

function emailReply(id) {
  const m = adminMessagesCache[id];
  const text = document.getElementById('replyText').value.trim();
  if (!m) return;
  if (!text) return alertMsg('Write your reply first, then open it in your email app.');
  window.location.href = 'mailto:' + encodeURIComponent(m.email) + '?subject=' + encodeURIComponent('Re: your message to Hirely') +
    '&body=' + encodeURIComponent(text + '\n\n— Hirely Team\n\n> ' + m.message);
}

async function adminMessageStatus(id, status) {
  try { await api('/api/admin/messages/' + id + '/status', 'PUT', { status }); toast('Message marked as ' + status + '.'); loadAdminMessages(); }
  catch (e) { alertMsg(e.message); }
}

async function adminDeleteMessage(id) {
  if (!confirm('Delete this message?')) return;
  try { await api('/api/admin/messages/' + id, 'DELETE'); loadAdminMessages(); }
  catch (e) { alertMsg(e.message); }
}

async function loadAdminPendingApprovals(type, tbodyId) {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;
  const countEl = document.getElementById(tbodyId + 'Count');
  try {
    const { approvals } = await api('/api/admin/pending-approvals?type=' + type);
    if (countEl) countEl.textContent = `${approvals.length} pending`;
    tbody.innerHTML = approvals.length ? approvals.map(a => `
      <tr>
        <td><strong>${escapeHtml(a.title)}</strong><div style="font-size:11px;color:var(--ink-soft);">${a.listing_type === 'job' ? 'Job' : 'Internship'}</div></td>
        <td>${escapeHtml(a.company_name || a.recruiter_name || '')}</td>
        <td>${escapeHtml(a.location || '')}</td>
        <td>${escapeHtml(fmtDate(a.created_at))}</td>
        <td style="display:flex;gap:7px;align-items:center;">
          <button class="btn btn-primary btn-sm" onclick="approveAdminListing(${a.id}, 'approved', '${type}')">Approve</button>
          <button class="btn btn-danger btn-sm" onclick="approveAdminListing(${a.id}, 'rejected', '${type}')">Reject</button>
        </td>
      </tr>`).join('') : '<tr><td colspan="5" style="color:var(--ink-soft);">No pending approvals.</td></tr>';
  } catch (e) { if (countEl) countEl.textContent = 'Unable to load'; }
}

async function approveAdminListing(id, decision, type) {
  let note = '';
  if (decision === 'rejected') {
    note = prompt('Optional reason for rejection:') || '';
  }
  try {
    await api('/api/admin/pending-approvals/' + id, 'PUT', { decision, note });
    toast(decision === 'approved' ? 'Listing approved and published.' : 'Listing rejected.');
    loadAdminPendingApprovals(type, type === 'job' ? 'ajPendingBody' : 'aiPendingBody');
    loadAdminListings(type, type === 'job' ? 'ajTableBody' : 'aiTableBody');
    loadAdminStats();
    renderAdminPendingApprovalsDashboard();
    renderAdminRecentListings();
  } catch (e) { alertMsg(e.message); }
}
window.loadAdminPendingApprovals = loadAdminPendingApprovals;
window.approveAdminListing = approveAdminListing;

async function loadAdminListings(type, tbodyId) {
  const tbody = document.getElementById(tbodyId);
  try {
    const { listings } = await api('/api/admin/listings?type=' + type);
    if (type === 'job') {
      tbody.innerHTML = listings.length ? listings.map(l => `
        <tr>
          <td>${escapeHtml(l.title)}</td><td>${escapeHtml(l.company_name)}</td><td>${escapeHtml(l.location || '')}</td>
          <td><span class="badge b-blue">${escapeHtml(l.job_type || 'Full-time')}</span></td>
          <td><span class="badge ${l.approval_status === 'pending' ? 'b-amber' : l.approval_status === 'approved' && l.status === 'active' ? 'b-green' : 'b-red'}">${l.approval_status === 'pending' ? 'Pending Approval' : l.approval_status === 'approved' && l.status === 'active' ? 'Approved / Active' : l.approval_status === 'rejected' ? 'Rejected' : 'Closed'}</span></td>
          <td style="display:flex;gap:8px;"><button class="btn btn-ghost btn-sm" onclick="adminViewListing(${l.id})">View Job</button><button class="btn btn-danger btn-sm" onclick="adminDeleteListing(${l.id}, '${type}')">Remove</button></td>
        </tr>`).join('') : '<tr><td colspan="6" style="color:var(--ink-soft);">No jobs posted yet.</td></tr>';
    } else {
      tbody.innerHTML = listings.length ? listings.map(l => `
        <tr>
          <td>${escapeHtml(l.title)}</td><td>${escapeHtml(l.company_name)}</td><td>${escapeHtml(l.duration || '')}</td><td>${escapeHtml(l.location || '')}</td>
          <td><span class="badge b-purple">${escapeHtml(l.job_type || 'Internship')}</span></td>
          <td><span class="badge ${l.approval_status === 'pending' ? 'b-amber' : l.approval_status === 'approved' && l.status === 'active' ? 'b-green' : 'b-red'}">${l.approval_status === 'pending' ? 'Pending Approval' : l.approval_status === 'approved' && l.status === 'active' ? 'Approved / Active' : l.approval_status === 'rejected' ? 'Rejected' : 'Closed'}</span></td>
          <td style="display:flex;gap:8px;"><button class="btn btn-ghost btn-sm" onclick="adminViewListing(${l.id})">View Internship</button><button class="btn btn-danger btn-sm" onclick="adminDeleteListing(${l.id}, '${type}')">Remove</button></td>
        </tr>`).join('') : '<tr><td colspan="7" style="color:var(--ink-soft);">No internships posted yet.</td></tr>';
    }
  } catch (e) { alertMsg(e.message); }
}
async function adminViewListing(id) {
  try {
    const { listing } = await api('/api/listings/' + id);
    openHmModal(`
      <h3 style="margin-bottom:2px;">${escapeHtml(listing.title)}</h3>
      <p style="margin:0 0 12px;color:var(--ink-soft);">${escapeHtml(listing.company)}</p>
      <div class="hm-modal-row"><span class="k">Location</span><span class="v">${escapeHtml(listing.location || '')}</span></div>
      <div class="hm-modal-row"><span class="k">Type</span><span class="v">${escapeHtml(listing.jobType || '')}</span></div>
      <div class="hm-modal-row"><span class="k">Experience</span><span class="v">${escapeHtml(listing.experience || '')}</span></div>
      <div class="hm-modal-row"><span class="k">Salary</span><span class="v">${escapeHtml(listing.salary || '')}</span></div>
      <h4 style="margin:16px 0 6px;font-size:13px;">Description</h4>
      <p style="margin:0;font-size:12.5px;color:var(--ink-soft);">${escapeHtml(listing.description || '')}</p>
    `);
  } catch (e) { alertMsg(e.message); }
}
async function adminDeleteListing(id, type) {
  if (!confirm('Remove this listing? This cannot be undone.')) return;
  try {
    await api('/api/admin/listings/' + id, 'DELETE');
    loadAdminListings(type, type === 'job' ? 'ajTableBody' : 'aiTableBody');
    loadAdminStats();
  } catch (e) { alertMsg(e.message); }
}

async function loadAdminApplications() {
  const tbody = document.getElementById('aaTableBody');
  try {
    const { applications } = await api('/api/admin/applications');
    tbody.innerHTML = applications.length ? applications.map(a => {
      const when = a.status === 'Interview' && a.interview_at ? `<div style="font-size:11px;color:var(--ink-soft);margin-top:3px;">📅 ${escapeHtml(fmtDateTime(a.interview_at))}</div>` : '';
      return `<tr><td>${escapeHtml(a.applicant_name)}</td><td>${escapeHtml(a.listing_title)}</td><td>${escapeHtml(a.company_name)}</td>
      <td>${statusSelectHtml(a.status, `pickStatus(this, 'admin', ${a.id})`)}${when}</td></tr>`;
    }).join('') : '<tr><td colspan="4" style="color:var(--ink-soft);">No applications yet.</td></tr>';
  } catch (e) { alertMsg(e.message); }
}

/* ============================ REAL CHARTS (Monthly Overview etc.) ============================
   The original page's chart functions (refreshRecChart, renderRecOverviewTable,
   renderRecMonthlyChart, renderAdminOverviewBars, renderAppOverviewTable) drew
   from hardcoded mock arrays (REC_MONTHLY_OVERVIEW, ADMIN_POSITIONS, etc).
   These overrides replace them with the same rendering (same DOM, same CSS
   classes, same bar/table/legend markup) driven by real MySQL data instead.
   The tab-click handlers (setRecTypeFilter, setRecRange, setAdminOverviewRange,
   setAppOverviewType) are untouched — they already call these functions by
   name, so overriding the functions here is enough; the existing UI (active
   tab styling, date pickers) keeps working exactly as before. */

function drawGroupedBars(containerId, pctId, labels, apps, short) {
  const grid = document.getElementById(containerId);
  if (!grid) return;
  const max = Math.max(...apps, ...short, 1) * 1.15;
  grid.innerHTML = labels.map((lbl, i) => {
    const ah = Math.round((apps[i] || 0) / max * 100);
    const sh = Math.round((short[i] || 0) / max * 100);
    return `<div class="gbar-col"><div class="gbar-pair"><div class="gbar" style="background:var(--primary);height:${ah}%"></div><div class="gbar green" style="height:${sh}%"></div></div><div class="gl">${escapeHtml(lbl)}</div></div>`;
  }).join('');
  if (typeof renderChartPct === 'function') {
    renderChartPct(pctId, apps.reduce((a, b) => a + b, 0), short.reduce((a, b) => a + b, 0));
  }
}

function positionTableHtml(positions, filter, totalLabel) {
  const filtered = positions.filter(p => filter === 'all' || (filter === 'jobs' ? p.type === 'Job' : p.type === 'Internship'));
  const totalApps = filtered.reduce((s, p) => s + p.apps, 0);
  const totalShort = filtered.reduce((s, p) => s + p.short, 0);
  const rows = filtered.map(p => `
    <tr>
      <td><strong>${escapeHtml(p.position)}</strong></td>
      <td><span class="badge ${p.type === 'Job' ? 'b-blue' : 'b-amber'}">${p.type}</span></td>
      <td style="text-align:right;">${p.apps}</td>
      <td style="text-align:right;">${p.short}</td>
    </tr>`).join('');
  const emptyRow = filtered.length ? '' : `<tr><td colspan="4" style="color:var(--ink-soft);">No listings yet.</td></tr>`;
  return `
    <table style="width:100%;border-collapse:collapse;font-size:12.5px;">
      <thead><tr><th>Position</th><th>Type</th><th style="text-align:right;">Applications</th><th style="text-align:right;">Shortlisted</th></tr></thead>
      <tbody>
        ${rows}${emptyRow}
        <tr style="background:var(--bg);font-weight:700;">
          <td>${totalLabel}</td>
          <td><span class="badge" style="background:#eef1fb;color:var(--primary);">${filter === 'all' ? 'All' : filter === 'jobs' ? 'Jobs' : 'Internships'}</span></td>
          <td style="text-align:right;">${totalApps}</td>
          <td style="text-align:right;">${totalShort}</td>
        </tr>
      </tbody>
    </table>`;
}

// ---- Recruiter dashboard charts ----

window.refreshRecChart = async function () {
  if (!currentUser || currentUser.role !== 'recruiter') return;
  const range = typeof currentRecRange !== 'undefined' ? currentRecRange : 'today';
  const type = typeof recTypeFilter !== 'undefined' ? recTypeFilter : 'all';
  const params = new URLSearchParams({ range, type });
  if (range === 'custom') {
    const dateInput = document.getElementById('recCustomDate');
    if (dateInput && dateInput.value) params.set('date', dateInput.value);
  }
  try {
    const data = await api('/api/listings/mine/overview?' + params.toString());
    drawGroupedBars('recBarChart', 'recAppPct', data.labels, data.apps, data.short);
  } catch (e) { /* silent - chart just won't update */ }
};

window.renderRecOverviewTable = async function () {
  const wrap = document.getElementById('recAppOverviewTableWrap');
  if (!wrap || !currentUser || currentUser.role !== 'recruiter') return;
  const type = typeof recTypeFilter !== 'undefined' ? recTypeFilter : 'all';
  try {
    const { positions } = await api('/api/listings/mine/position-overview?type=' + type);
    wrap.innerHTML = `<div style="margin-top:6px;">${positionTableHtml(positions, type, type === 'all' ? 'Total' : type === 'jobs' ? 'Total Jobs' : 'Total Internships')}</div>`;
  } catch (e) { /* silent */ }
};

window.renderRecMonthlyChart = async function () {
  const wrap = document.getElementById('recMonthlyChartWrap');
  if (!wrap || !currentUser || currentUser.role !== 'recruiter') return;
  try {
    const { months } = await api('/api/listings/mine/monthly-overview');
    const type = typeof recTypeFilter !== 'undefined' ? recTypeFilter : 'all';
    wrap.innerHTML = monthlyStackChartHtml(months, type);
  } catch (e) { /* silent */ }
};

// ---- Admin dashboard + Reports charts ----

window.renderAdminOverviewBars = async function (chartId) {
  if (!currentUser || currentUser.role !== 'admin') return;
  const range = (typeof adminRangeState !== 'undefined' && adminRangeState[chartId]) || 'today';
  const type = (typeof appOverviewState !== 'undefined' && appOverviewState[chartId]) || 'all';
  const params = new URLSearchParams({ range, type });
  if (range === 'custom') {
    const dateInput = document.getElementById(chartId + 'CustomDate');
    if (dateInput && dateInput.value) params.set('date', dateInput.value);
  }
  try {
    const data = await api('/api/admin/overview?' + params.toString());
    drawGroupedBars(chartId, chartId + 'Pct', data.labels, data.apps, data.short);
  } catch (e) { /* silent */ }
};

window.renderAppOverviewTable = async function (containerId, chartId) {
  const wrap = document.getElementById(containerId);
  if (!wrap || !currentUser || currentUser.role !== 'admin') return;
  const type = (typeof appOverviewState !== 'undefined' && appOverviewState[chartId]) || 'all';
  try {
    const [{ months }, { positions }] = await Promise.all([
      api('/api/admin/monthly-overview'),
      api('/api/admin/position-overview?type=' + type)
    ]);
    wrap.innerHTML = `
      <div style="margin-top:10px;">
        <div style="font-weight:700;font-size:12px;color:var(--ink-soft);text-transform:uppercase;letter-spacing:.3px;margin-bottom:2px;">Monthly Overview (Jan – Dec)</div>
        <div style="margin-bottom:14px;">${monthlyStackChartHtml(months, type)}</div>
        <div style="font-weight:700;font-size:12px;color:var(--ink-soft);text-transform:uppercase;letter-spacing:.3px;margin-bottom:6px;">Position Breakdown</div>
        ${positionTableHtml(positions, type, 'Total')}
      </div>`;
  } catch (e) { /* silent */ }
};

// Trigger a real refresh of every chart on a given dashboard screen (called
// from onScreenChange below, since the page's own initial calls at script
// load time run before this file loads and still use the original mocks).
function refreshRecruiterCharts() {
  if (typeof refreshRecChart === 'function') refreshRecChart();
  if (typeof renderRecOverviewTable === 'function') renderRecOverviewTable();
  if (typeof renderRecMonthlyChart === 'function') renderRecMonthlyChart();
  renderRecDonuts();
}
async function refreshAdminDashboardCharts() {
  if (typeof renderAdminOverviewBars === 'function') renderAdminOverviewBars('dashAppChart');
  if (typeof renderAppOverviewTable === 'function') renderAppOverviewTable('dashAppOverviewTableWrap', 'dashAppChart');
  renderAdminBreakdownAndFeed();
  renderAdminRecentListings();
  renderAdminNewMessagesCount();
}
function refreshAdminReportsCharts() {
  loadAdminReviews();
  if (typeof renderAdminOverviewBars === 'function') renderAdminOverviewBars('reportsAppChart');
  if (typeof renderAppOverviewTable === 'function') renderAppOverviewTable('reportsAppOverviewTableWrap', 'reportsAppChart');
  renderReportsDonuts();
  renderReportsCategoryAndPerListing();
}

/* ---- Shared donut painter (real job-vs-internship split, no fake percentages) ---- */
function paintDonut(prefix, jobs, interns, colorA, colorB) {
  const donut = document.getElementById(prefix + 'Donut');
  if (!donut) return;
  const total = jobs + interns;
  const jobPct = total ? (jobs / total * 100) : 0;
  document.getElementById(prefix + 'Total').textContent = total;
  donut.style.background = `conic-gradient(${colorA} 0% ${jobPct}%, ${colorB} ${jobPct}% 100%)`;
  document.getElementById(prefix + 'JobsVal').textContent = `${jobs} (${total ? jobPct.toFixed(1) : '0'}%)`;
  document.getElementById(prefix + 'InternVal').textContent = `${interns} (${total ? (100 - jobPct).toFixed(1) : '0'}%)`;
}

async function renderRecDonuts() {
  if (!document.getElementById('rdAppDonut')) return;
  try {
    const { positions } = await api('/api/listings/mine/position-overview?type=all');
    const jobApps = positions.filter(p => p.type === 'Job').reduce((s, p) => s + p.apps, 0);
    const internApps = positions.filter(p => p.type === 'Internship').reduce((s, p) => s + p.apps, 0);
    const jobShort = positions.filter(p => p.type === 'Job').reduce((s, p) => s + p.short, 0);
    const internShort = positions.filter(p => p.type === 'Internship').reduce((s, p) => s + p.short, 0);
    paintDonut('rdApp', jobApps, internApps, 'var(--primary)', 'var(--amber)');
    paintDonut('rdShort', jobShort, internShort, 'var(--green)', 'var(--purple)');
  } catch (e) { /* silent */ }
}

async function renderReportsDonuts() {
  if (!document.getElementById('repAppDonut')) return;
  try {
    const { positions } = await api('/api/admin/position-overview?type=all');
    const jobApps = positions.filter(p => p.type === 'Job').reduce((s, p) => s + p.apps, 0);
    const internApps = positions.filter(p => p.type === 'Internship').reduce((s, p) => s + p.apps, 0);
    const jobShort = positions.filter(p => p.type === 'Job').reduce((s, p) => s + p.short, 0);
    const internShort = positions.filter(p => p.type === 'Internship').reduce((s, p) => s + p.short, 0);
    paintDonut('repApp', jobApps, internApps, 'var(--primary)', 'var(--amber)');
    paintDonut('repShort', jobShort, internShort, 'var(--green)', 'var(--purple)');
  } catch (e) { /* silent */ }
}

async function renderReportsCategoryAndPerListing() {
  try {
    const [{ categories }, { positions }] = await Promise.all([
      api('/api/admin/category-overview'),
      api('/api/admin/position-overview?type=all')
    ]);
    const catWrap = document.getElementById('repCategoryChart');
    if (catWrap) {
      const max = Math.max(1, ...categories.map(c => c.apps));
      catWrap.innerHTML = categories.length ? categories.map(c => `
        <div class="bar-col"><div class="bv">${c.apps}</div><div class="bar" style="height:${Math.max(4, c.apps / max * 100)}%"></div><div class="bl">${escapeHtml(c.category)}</div></div>
      `).join('') : '<p style="color:var(--ink-soft);font-size:12.5px;">No applications yet.</p>';
    }
    const listWrap = document.getElementById('repPerListingChart');
    if (listWrap) {
      const top = [...positions].sort((a, b) => b.apps - a.apps).slice(0, 5);
      const max = Math.max(1, ...top.map(p => p.apps));
      listWrap.innerHTML = top.length ? top.map(p => `
        <div class="hbar-row"><div class="hbar-label">${escapeHtml(p.position)}</div><div class="hbar-track"><div class="hbar-fill" style="width:${Math.max(4, p.apps / max * 100)}%"></div></div><div class="hbar-val">${p.apps}</div></div>
      `).join('') : '<p style="color:var(--ink-soft);font-size:12.5px;">No applications yet.</p>';
    }
  } catch (e) { /* silent */ }
}

async function renderAdminBreakdownAndFeed() {
  try {
    const { stats } = await api('/api/admin/stats');
    const applied = Math.max(0, stats.totalApplications - stats.shortlisted - stats.interviews - stats.selected - stats.rejected);
    const total = Math.max(1, stats.totalApplications);
    const parts = [
      { label: 'Applied', val: applied, color: 'var(--primary)', badge: 'b-blue' },
      { label: 'Shortlisted', val: stats.shortlisted, color: 'var(--amber)', badge: 'b-amber' },
      { label: 'Interview', val: stats.interviews, color: 'var(--purple)', badge: 'b-purple' },
      { label: 'Selected', val: stats.selected, color: 'var(--green)', badge: 'b-green' },
      { label: 'Rejected', val: stats.rejected, color: 'var(--red)', badge: 'b-red' }
    ];
    const segBar = document.getElementById('adBreakdownSegBar');
    if (segBar) segBar.innerHTML = parts.map(p => `<div style="width:${(p.val / total * 100).toFixed(1)}%;background:${p.color};"></div>`).join('');
    const rows = document.getElementById('adBreakdownRows');
    if (rows) rows.innerHTML = parts.map(p => `<div class="breakdown-row"><div class="bl"><span class="legend-dot" style="background:${p.color};"></span>${p.label}</div><span class="badge ${p.badge}">${stats.totalApplications ? (p.val / total * 100).toFixed(0) : 0}%</span></div>`).join('');

    const { applications } = await api('/api/admin/applications');
    const feed = document.getElementById('adNewApplicationsFeed');
    if (feed) {
      const recent = applications.slice(0, 4);
      feed.innerHTML = recent.length ? recent.map(a => `
        <div class="feed-row"><div class="feed-avatar">${escapeHtml(initials(a.applicant_name))}</div><div><div class="fname">${escapeHtml(a.applicant_name)}</div><div class="frole">Applied for ${escapeHtml(a.listing_title)}</div></div></div>
      `).join('') : '<p style="color:var(--ink-soft);font-size:12.5px;">No applications yet.</p>';
    }
  } catch (e) { /* silent */ }
}

async function renderAdminPendingApprovalsDashboard() {
  const tbody = document.getElementById('adPendingApprovalsBody');
  const countEl = document.getElementById('adPendingApprovalsCount');
  if (!tbody) return;
  try {
    const { approvals } = await api('/api/admin/pending-approvals');
    const pending = approvals || [];
    if (countEl) countEl.textContent = `${pending.length} pending`;
    tbody.innerHTML = pending.length ? pending.slice(0, 8).map(a => `
      <tr>
        <td><strong>${escapeHtml(a.title)}</strong><div style="font-size:11px;color:var(--ink-soft);">${a.listing_type === 'job' ? 'Job' : 'Internship'}</div></td>
        <td>${escapeHtml(a.company_name || a.recruiter_name || '')}</td>
        <td>${escapeHtml(a.location || '')}</td>
        <td>${escapeHtml(fmtDate(a.created_at))}</td>
        <td style="display:flex;gap:7px;align-items:center;">
          <button class="btn btn-primary btn-sm" onclick="approveAdminListing(${a.id}, 'approved', '${a.listing_type}')">Approve</button>
          <button class="btn btn-danger btn-sm" onclick="approveAdminListing(${a.id}, 'rejected', '${a.listing_type}')">Reject</button>
        </td>
      </tr>`).join('') : '<tr><td colspan="5" style="color:var(--ink-soft);">No pending approvals.</td></tr>';
  } catch (e) {
    if (countEl) countEl.textContent = 'Unable to load';
    if (tbody) tbody.innerHTML = `<tr><td colspan="5" style="color:var(--red);">${escapeHtml(e.message || 'Unable to load pending approvals.')}</td></tr>`;
  }
}
window.renderAdminPendingApprovalsDashboard = renderAdminPendingApprovalsDashboard;

async function renderAdminRecentListings() {
  const tbody = document.getElementById('adRecentListingsBody');
  if (!tbody) return;
  try {
    const { listings } = await api('/api/admin/listings');
    const recent = listings.filter(l => l.approval_status === 'approved' && l.status === 'active').slice(0, 5);
    tbody.innerHTML = recent.length ? recent.map(l => `
      <tr>
        <td>${escapeHtml(l.title)}</td>
        <td><span class="badge ${l.listing_type === 'job' ? 'b-blue' : 'b-amber'}">${l.listing_type === 'job' ? 'Job' : 'Internship'}</span></td>
        <td>${escapeHtml(l.company_name)}</td>
        <td>${new Date(l.created_at).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
        <td style="display:flex;gap:8px;">
          <button class="btn btn-ghost btn-sm" onclick="go('${l.listing_type === 'job' ? 'admin-jobs' : 'admin-internships'}')">View</button>
          <button class="btn ${l.status === 'active' ? 'btn-danger' : 'btn-primary'} btn-sm" onclick="adminToggleListingStatus(${l.id}, '${l.status}')">${l.status === 'active' ? 'Close' : 'Reopen'}</button>
        </td>
      </tr>`).join('') : '<tr><td colspan="5" style="color:var(--ink-soft);">No listings yet.</td></tr>';
  } catch (e) { /* silent */ }
}

async function adminToggleListingStatus(id, currentStatus) {
  try {
    await api('/api/admin/listings/' + id + '/status', 'PUT', { status: currentStatus === 'active' ? 'closed' : 'active' });
    toast('Listing status updated.');
    renderAdminRecentListings();
  } catch (e) { alertMsg(e.message); }
}

async function renderAdminNewMessagesCount() {
  const el = document.getElementById('adNewMessagesCount');
  if (!el) return;
  try {
    const { messages } = await api('/api/admin/messages');
    el.textContent = messages.filter(m => m.status === 'New').length;
  } catch (e) { /* silent */ }
}

/* ============================ LIVE ADMIN FILTER HANDLERS ============================ */
// These replace the old inline demo handlers. Every chart redraw is fetched from MySQL.
window.setAdminOverviewRange = function(chartId, range, el) {
  const tabs = document.getElementById(chartId + 'RangeTabs');
  const dateInput = document.getElementById(chartId + 'CustomDate');
  if (!tabs || !dateInput) return;
  if (range === 'custom') {
    tabs.querySelectorAll('button').forEach(b => b.classList.remove('active'));
    if (el) el.classList.add('active');
    dateInput.classList.add('show');
    try { dateInput.showPicker(); } catch (e) { dateInput.focus(); }
    return;
  }
  if (range === 'custom-date') {
    tabs.querySelectorAll('button').forEach(b => b.classList.remove('active'));
    const customBtn = tabs.querySelectorAll('button')[3];
    if (customBtn) customBtn.classList.add('active');
    dateInput.classList.add('show');
    if (!dateInput.value) return;
    if (typeof adminRangeState !== 'undefined') adminRangeState[chartId] = 'custom';
    renderAdminOverviewBars(chartId);
    return;
  }
  dateInput.classList.remove('show');
  tabs.querySelectorAll('button').forEach(b => b.classList.remove('active'));
  if (el) el.classList.add('active');
  if (typeof adminRangeState !== 'undefined') adminRangeState[chartId] = range;
  renderAdminOverviewBars(chartId);
};

window.setAppOverviewType = function(chartId, type, el) {
  if (typeof appOverviewState !== 'undefined') appOverviewState[chartId] = type;
  const wrap = el && el.closest('.range-tabs');
  if (wrap) wrap.querySelectorAll('button').forEach(b => b.classList.remove('active'));
  if (el) el.classList.add('active');
  renderAdminOverviewBars(chartId);
  if (chartId === 'dashAppChart') renderAppOverviewTable('dashAppOverviewTableWrap', chartId);
  if (chartId === 'reportsAppChart') renderAppOverviewTable('reportsAppOverviewTableWrap', chartId);
};

/* ============================ INIT ============================ */

document.addEventListener('DOMContentLoaded', () => {
  // Home starts visible, so load approved recent listings immediately.
  loadHomeRecentRoles();
  // Session (authToken/currentUser) is already restored from localStorage above.
});

/* ============================ RATINGS & REVIEWS ============================ */

// Overrides the demo submitHomeReview() that only showed a thank-you message.
window.submitHomeReview = async function () {
  const thanks = document.getElementById('homeRateThanks');
  const rating = document.querySelectorAll('#homeRateStars span').length
    ? Array.from(document.querySelectorAll('#homeRateStars span')).filter(sp => sp.textContent === '★').length : 0;
  if (!rating) { if (thanks) thanks.textContent = 'Please select a star rating first.'; return; }
  const textEl = document.getElementById('homeReviewText');
  const nameEl = document.getElementById('homeReviewName');
  try {
    await api('/api/reviews', 'POST', { rating, text: textEl ? textEl.value.trim() : '', name: nameEl ? nameEl.value.trim() : '' });
    if (thanks) thanks.textContent = `Thanks for your ${rating}-star review!`;
    if (textEl) textEl.value = '';
    if (nameEl) nameEl.value = '';
    document.querySelectorAll('#homeRateStars span').forEach(sp => { sp.textContent = '☆'; sp.style.color = '#D8DEEA'; });
    if (typeof homeSelectedRating !== 'undefined') homeSelectedRating = 0;
  } catch (e) { if (thanks) thanks.textContent = e.message; }
};

const STAR_COLORS = { 5: 'var(--green)', 4: 'var(--primary)', 3: 'var(--amber)', 2: '#F5A623', 1: 'var(--red)' };
const STAR_PILLS = { 5: 'b-green', 4: 'b-blue', 3: 'b-amber', 2: 'b-purple', 1: 'b-red' };
const starsText = n => '★'.repeat(n) + '☆'.repeat(5 - n);

async function loadAdminReviews() {
  const bars = document.getElementById('ratingDistBars');
  if (!bars) return;
  try {
    const data = await api('/api/admin/reviews');
    const max = Math.max(1, ...Object.values(data.distribution));
    bars.innerHTML = [5, 4, 3, 2, 1].map(n => {
      const v = data.distribution[n] || 0;
      return `<div class="rating-bar-col"><div class="rv">${v}</div><div class="rb" style="height:${Math.max(2, (v / max) * 140)}px;background:${STAR_COLORS[n]};"></div><div class="rl">${'★'.repeat(n)}</div></div>`;
    }).join('');
    document.getElementById('ratingDistSub').textContent = `Based on ${data.total} total rating${data.total === 1 ? '' : 's'}`;
    document.getElementById('ratingBreakdownSub').textContent = `⭐ Average Rating: ${data.average} / 5 · 👥 Total Ratings: ${data.total}`;
    document.getElementById('ratingBreakdownRows').innerHTML = [5, 4, 3, 2, 1].map(n => {
      const v = data.distribution[n] || 0;
      return `<div class="rating-row"><span class="stars-line" style="color:#F5A623;">${'⭐'.repeat(n)}</span><span class="badge ${STAR_PILLS[n]}" style="font-size:12.5px;padding:6px 14px;">${v} user${v === 1 ? '' : 's'}</span></div>`;
    }).join('');
    document.getElementById('allReviewsList').innerHTML = data.reviews.length ? data.reviews.map(r => `
      <div class="review-item">
        <div class="review-ico">⭐</div>
        <div class="review-body">
          <div class="review-head"><div><span class="review-name">${escapeHtml(r.name)}</span><span class="review-stars">${starsText(r.rating)}</span></div><span class="review-role">${escapeHtml(r.role)}</span></div>
          <p class="review-text">${r.text ? escapeHtml(r.text) : '<em>No written review.</em>'}</p>
          <div style="font-size:11px;color:var(--ink-soft);margin-top:4px;">${escapeHtml(fmtDate(r.createdAt))} · <a style="color:var(--red);cursor:pointer;" onclick="adminDeleteReview(${r.id})">Delete</a></div>
        </div>
      </div>`).join('') : '<p style="color:var(--ink-soft);font-size:13px;">No reviews yet.</p>';
  } catch (e) { /* silent: reports page still works without reviews */ }
}

async function adminDeleteReview(id) {
  if (!confirm('Delete this review?')) return;
  try { await api('/api/admin/reviews/' + id, 'DELETE'); loadAdminReviews(); }
  catch (e) { alertMsg(e.message); }
}


/* ======================== FORGOT / RESET PASSWORD ======================== */
let pendingResetToken = new URLSearchParams(window.location.search).get('resetToken') || '';

async function handleForgotPassword() {
  const emailEl = document.getElementById('forgotEmail');
  const resultEl = document.getElementById('forgotResult');
  const btn = document.getElementById('forgotSubmitBtn');
  if (!emailEl) return;
  const email = emailEl.value.trim();
  if (!email) return alertMsg('Please enter your registered email address.');

  btn.disabled = true;
  btn.textContent = 'Generating reset link…';
  try {
    const data = await api('/api/auth/forgot-password', 'POST', { email });
    resultEl.style.display = 'block';
    if (data.resetUrl) {
      pendingResetToken = data.resetToken;
      resultEl.innerHTML = '<strong>Reset link generated.</strong><br>This link is valid for 1 hour. <button type="button" class="btn btn-primary" style="margin-top:10px;padding:9px 14px;" onclick="openGeneratedResetLink()">Open Reset Link</button>';
      window.__hirelyResetUrl = data.resetUrl;
    } else {
      resultEl.textContent = data.message || 'If an account exists for this email, a reset link has been generated.';
    }
  } catch (e) {
    resultEl.style.display = 'block';
    resultEl.style.background = '#fff1f2';
    resultEl.style.borderColor = '#fecdd3';
    resultEl.textContent = e.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Send reset link';
  }
}

function openGeneratedResetLink() {
  const url = window.__hirelyResetUrl;
  if (url) {
    const token = new URL(url).searchParams.get('resetToken');
    pendingResetToken = token || pendingResetToken;
  }
  if (!pendingResetToken) return alertMsg('Reset token is missing. Please request a new reset link.');
  window.history.replaceState({}, document.title, window.location.pathname);
  window.go('reset-password');
}

async function handleResetPassword() {
  const password = document.getElementById('resetPasswordInput')?.value || '';
  const confirm = document.getElementById('resetPasswordConfirm')?.value || '';
  const resultEl = document.getElementById('resetResult');
  if (!pendingResetToken) return alertMsg('Reset token is missing or invalid. Please request a new reset link.');
  if (!password || password.length < 6) return alertMsg('Password must be at least 6 characters.');
  if (password !== confirm) return alertMsg('Passwords do not match.');

  try {
    const data = await api('/api/auth/reset-password', 'POST', { token: pendingResetToken, password });
    resultEl.style.display = 'block';
    resultEl.style.background = '#ecfdf5';
    resultEl.style.borderColor = '#bbf7d0';
    resultEl.textContent = data.message || 'Password reset successfully.';
    pendingResetToken = '';
    setTimeout(() => window.go('login'), 900);
  } catch (e) {
    resultEl.style.display = 'block';
    resultEl.style.background = '#fff1f2';
    resultEl.style.borderColor = '#fecdd3';
    resultEl.textContent = e.message;
  }
}

const __hirelyOriginalGo = window.go;
window.go = function(id) {
  __hirelyOriginalGo(id);
  if (id === 'reset-password') {
    const tokenFromUrl = new URLSearchParams(window.location.search).get('resetToken');
    if (tokenFromUrl) pendingResetToken = tokenFromUrl;
  }
};

// If a reset link is opened directly, show the reset screen automatically.
if (pendingResetToken) {
  setTimeout(() => window.go('reset-password'), 0);
}


/* HIRELY navigation fix: keep SPA screens in browser history and provide safe Back links. */
(function () {
  if (window.__hirelyBackNavigationInstalled) return;
  window.__hirelyBackNavigationInstalled = true;
  var originalGoWithScreenLoading = window.go;
  var handlingPopState = false;
  var initialScreen = document.querySelector('.screen.active')?.dataset.screen || 'home';
  try { history.replaceState({ hirelyScreen: initialScreen, hirely: true }, '', location.pathname + location.search + (location.hash || '')); } catch (_) {}

  window.go = function (id) {
    if (!handlingPopState) {
      try { history.pushState({ hirelyScreen: id, hirely: true }, '', location.pathname + location.search + '#' + id); } catch (_) {}
    }
    return originalGoWithScreenLoading(id);
  };

  window.addEventListener('popstate', function (event) {
    var target = event.state && event.state.hirelyScreen;
    if (!target || !document.querySelector('.screen[data-screen="' + target + '"]')) target = 'home';
    handlingPopState = true;
    try { originalGoWithScreenLoading(target); }
    finally { handlingPopState = false; }
  });

  window.hirelyBack = function () {
    var state = history.state;
    if (state && state.hirely) {
      history.back();
    } else {
      window.go('home');
    }
  };

  function addBackLink(screenName, label) {
    var screen = document.querySelector('.screen[data-screen="' + screenName + '"]');
    if (!screen || screen.querySelector('.hirely-back-link')) return;
    var link = document.createElement('button');
    link.type = 'button';
    link.className = 'hirely-back-link';
    link.innerHTML = '<span aria-hidden="true">&#8592;</span> ' + label;
    link.addEventListener('click', window.hirelyBack);
    var shell = screen.querySelector('.role-select-shell, .lg-formside, .lg-shell') || screen;
    shell.appendChild(link);
  }

  function addAuthBackLink(screenName) {
    var screen = document.querySelector('.screen[data-screen="' + screenName + '"]');
    if (!screen || screen.querySelector('.hirely-auth-back-link')) return;
    var brand = screen.querySelector('.lg-brand');
    if (!brand) return;
    var link = document.createElement('button');
    link.type = 'button';
    link.className = 'hirely-back-link hirely-auth-back-link';
    link.setAttribute('aria-label', 'Back');
    link.innerHTML = '<span aria-hidden="true">&#8592;</span><span class="hirely-auth-back-label">Back</span>';
    link.addEventListener('click', window.hirelyBack);
    brand.appendChild(link);
  }

  function installBackLinks() {
    addBackLink('choose-role', 'Back');
    addBackLink('choose-role-register', 'Back');
    addAuthBackLink('login');
    addAuthBackLink('register');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installBackLinks);
  else installBackLinks();
  var style = document.createElement('style');
  style.textContent = '.hirely-back-link{display:flex;align-items:center;gap:8px;margin:24px auto 20px;padding:8px 0;border:0;background:transparent;color:#4b68dc;text-decoration:underline;font:inherit;font-size:16px;cursor:pointer}.hirely-back-link span{font-size:24px;line-height:1}.role-select-shell>.hirely-back-link{justify-content:center}.hirely-back-link:focus-visible{outline:2px solid #4b68dc;outline-offset:4px}.hirely-auth-back-link{position:absolute;top:12px;left:18px;z-index:5;margin:0;padding:4px 0;gap:5px;color:#111;text-decoration:none;font-family:Arial,sans-serif;font-size:13px;font-weight:500}.hirely-auth-back-link span:first-child{font-size:20px;line-height:1}.hirely-auth-back-link .hirely-auth-back-label{font-size:13px;line-height:1}.lg-brand{position:relative}';
  document.head.appendChild(style);
})();
