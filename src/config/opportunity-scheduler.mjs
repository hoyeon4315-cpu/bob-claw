// 4-hour scan cadence with idle windows (no trading during maintenance/quiet hours)
export const SCHEDULE = {
  intervalHours: 4,
  idleWindowsUtc: [
    { startHour: 6, endHour: 8 },   // 06:00–08:00 UTC
    { startHour: 20, endHour: 22 }, // 20:00–22:00 UTC
  ],
  maxIdleOverlapMinutes: 15,
};

export function isIdleWindow(now = new Date()) {
  const hour = now.getUTCHours();
  const minute = now.getUTCMinutes();
  for (const w of SCHEDULE.idleWindowsUtc) {
    if (hour >= w.startHour && hour < w.endHour) return true;
    if (hour === w.endHour && minute <= SCHEDULE.maxIdleOverlapMinutes) return true;
  }
  return false;
}
