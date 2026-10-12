// Status rules.
// Every application starts as "Applied". From there the recruiter (or admin)
// can set it to any of the four review statuses from the dropdown:
//   Shortlisted · Interview · Selected · Rejected
const ALL_STATUSES = ['Applied', 'Shortlisted', 'Interview', 'Selected', 'Rejected'];
const SETTABLE_STATUSES = ['Shortlisted', 'Interview', 'Selected', 'Rejected'];

// Options shown in the dropdown. If the application is still "Applied" that
// value is included first (as the current/placeholder value).
function nextAllowedStatuses(current) {
  return current === 'Applied' ? ['Applied', ...SETTABLE_STATUSES] : [...SETTABLE_STATUSES];
}

function isTransitionAllowed(current, next) {
  return SETTABLE_STATUSES.includes(next);
}

module.exports = { ALL_STATUSES, SETTABLE_STATUSES, nextAllowedStatuses, isTransitionAllowed };
