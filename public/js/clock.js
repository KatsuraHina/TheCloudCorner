// ─────────────────────────────────────────────────────────────────────────────
//  clock.js — fills the flip-clock date card with today's date
// ─────────────────────────────────────────────────────────────────────────────
const WEEKDAYS = [
  "SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY",
];

function pad(n) {
  return String(n).padStart(2, "0");
}

export function renderDate() {
  const now = new Date();
  const monthEl = document.getElementById("date-month");
  const dayEl = document.getElementById("date-day");
  const weekdayEl = document.getElementById("date-weekday");
  if (!monthEl) return;

  monthEl.textContent = pad(now.getMonth() + 1); // 01–12
  dayEl.textContent = pad(now.getDate());        // 01–31
  weekdayEl.textContent = WEEKDAYS[now.getDay()];
}

// Re-render at the next midnight so the card stays current if the tab is left open.
function scheduleMidnightRefresh() {
  const now = new Date();
  const nextMidnight = new Date(
    now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 2
  );
  setTimeout(() => {
    renderDate();
    scheduleMidnightRefresh();
  }, nextMidnight - now);
}

export function startClock() {
  renderDate();
  scheduleMidnightRefresh();
}
