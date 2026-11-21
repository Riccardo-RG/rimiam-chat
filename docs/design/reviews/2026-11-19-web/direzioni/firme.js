// Use the date of the captured conversation so the comparison stays reproducible.
(() => {
  const referenceMonday = '2026-11-16';
  const zone = { timeZone: 'Europe/Rome' };
  const dayKey = new Intl.DateTimeFormat('sv-SE', { ...zone, dateStyle: 'short' });
  const fullDate = new Intl.DateTimeFormat('it-IT', { ...zone, day: '2-digit', month: '2-digit', year: 'numeric' });
  const weekday = new Intl.DateTimeFormat('it-IT', { ...zone, weekday: 'long' });
  const hour = new Intl.DateTimeFormat('it-IT', { ...zone, hour: '2-digit', minute: '2-digit' });
  const longPauseMs = 2 * 60 * 60 * 1000;
  let previous;
  for (const stamp of document.querySelectorAll('.timeline .sent-at')) {
    const sent = new Date(stamp.dateTime);
    const day = dayKey.format(sent);
    const newDay = !previous || day !== dayKey.format(previous);
    const longPause = previous && sent - previous >= longPauseMs;
    previous = sent;
    if (!newDay && !longPause) continue;

    const row = document.createElement('li');
    row.className = 'time-break';
    const label = document.createElement('time');
    label.dateTime = stamp.dateTime;
    let text = hour.format(sent);
    if (newDay) {
      const date = day >= referenceMonday && day < '2026-11-23' ? weekday.format(sent) : fullDate.format(sent);
      text = date.charAt(0).toUpperCase() + date.slice(1) + ' · ' + text;
    }
    label.textContent = text;
    row.append(label);
    stamp.closest('.turn').before(row);
  }
})();
