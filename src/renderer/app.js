const dateLabel = document.querySelector('#dateLabel');
const sessionTime = document.querySelector('#sessionTime');
const workdayTime = document.querySelector('#workdayTime');
const totalTime = document.querySelector('#totalTime');
const focusTime = document.querySelector('#focusTime');
const distractTime = document.querySelector('#distractTime');
const appList = document.querySelector('#appList');
const emptyState = document.querySelector('#emptyState');
const opacitySlider = document.querySelector('#opacitySlider');
const menuBtn = document.querySelector('#menuBtn');
const menuPanel = document.querySelector('#menuPanel');
const appContextMenu = document.querySelector('#appContextMenu');
const deleteAppBtn = document.querySelector('#deleteAppBtn');
const memoBtn = document.querySelector('#memoBtn');
const memoPanel = document.querySelector('#memoPanel');
const memoCloseBtn = document.querySelector('#memoCloseBtn');
const memoText = document.querySelector('#memoText');
const memoClearBtn = document.querySelector('#memoClearBtn');
const memoSaveBtn = document.querySelector('#memoSaveBtn');
const historyBtn = document.querySelector('#historyBtn');
const historyPanel = document.querySelector('#historyPanel');
const historyCloseBtn = document.querySelector('#historyCloseBtn');
const historyDateInput = document.querySelector('#historyDateInput');
const historyDetail = document.querySelector('#historyDetail');
const clockLogBtn = document.querySelector('#clockLogBtn');
const clockPanel = document.querySelector('#clockPanel');
const clockCloseBtn = document.querySelector('#clockCloseBtn');
const clockMonthLabel = document.querySelector('#clockMonthLabel');
const clockCalendar = document.querySelector('#clockCalendar');
const clockBtn = document.querySelector('#clockBtn');
const startDayBtn = document.querySelector('#startDayBtn');
const awayBtn = document.querySelector('#awayBtn');
const syncBtn = document.querySelector('#syncBtn');
const syncPanel = document.querySelector('#syncPanel');
const syncCloseBtn = document.querySelector('#syncCloseBtn');
const syncStatusText = document.querySelector('#syncStatusText');
const syncIdInput = document.querySelector('#syncIdInput');
const syncConnectBtn = document.querySelector('#syncConnectBtn');
const syncNowBtn = document.querySelector('#syncNowBtn');
const syncLogoutBtn = document.querySelector('#syncLogoutBtn');
const updateBtn = document.querySelector('#updateBtn');
const dayStartBtn = document.querySelector('#dayStartBtn');
const dayStartPanel = document.querySelector('#dayStartPanel');
const dayStartCloseBtn = document.querySelector('#dayStartCloseBtn');
const dayStartInput = document.querySelector('#dayStartInput');
const dayStartSaveBtn = document.querySelector('#dayStartSaveBtn');
const awayIdleBtn = document.querySelector('#awayIdleBtn');
const awayIdlePanel = document.querySelector('#awayIdlePanel');
const awayIdleCloseBtn = document.querySelector('#awayIdleCloseBtn');
const awayIdleInput = document.querySelector('#awayIdleInput');
const awayIdleSaveBtn = document.querySelector('#awayIdleSaveBtn');
const awayPanel = document.querySelector('#awayPanel');
const awayCloseBtn = document.querySelector('#awayCloseBtn');
const awayLabelInput = document.querySelector('#awayLabelInput');
const awayDurationInline = document.querySelector('#awayDurationInline');
const awayWorkBtn = document.querySelector('#awayWorkBtn');
const awayOffBtn = document.querySelector('#awayOffBtn');
const awayCancelBtn = document.querySelector('#awayCancelBtn');
const awaySaveBtn = document.querySelector('#awaySaveBtn');
const secondsBtn = document.querySelector('#secondsBtn');
const sizeButtons = [...document.querySelectorAll('[data-size]')];
const sortButtons = [...document.querySelectorAll('[data-sort]')];
let clockMonthDate = new Date();
let awayKind = 'work';
let awayPanelStartAt = Date.now();
let awayDurationTimer = null;
let contextAppKey = null;

function formatTime(seconds) {
  const totalMinutes = Math.floor(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}:${String(minutes).padStart(2, '0')}`;
}

function formatTimeWithSeconds(seconds) {
  const safeSeconds = Math.max(0, Math.floor(seconds || 0));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainingSeconds = safeSeconds % 60;
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
}

function formatClock(value) {
  if (!value) return '--:--';
  const date = new Date(value);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function getWorkRange(day) {
  const start = day.clockInAt || day.firstActiveAt;
  const end = day.clockOutAt || (!day.clockInAt ? day.lastActiveAt : null);
  return `${formatClock(start)} - ${formatClock(end)}`;
}

function getClockLabel(action) {
  if (action === 'clock-out') return '\uD1F4\uADFC';
  if (action === 'undo-clock-out') return '\uD1F4\uADFC\uCDE8\uC18C';
  return '\uCD9C\uADFC';
}

function dayKeyToInputValue(dayKey) {
  const [yy, mm, dd] = dayKey.split('-');
  return `20${yy}-${mm}-${dd}`;
}

function inputValueToDayKey(value) {
  if (!value) return '';
  const [yyyy, mm, dd] = value.split('-');
  return `${yyyy.slice(-2)}-${mm}-${dd}`;
}

function dateToDayKey(date) {
  const yy = String(date.getFullYear()).slice(-2);
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function emptyHistoryDay(dayKey) {
  return {
    dayKey,
    dateLabel: dayKey,
    workdaySeconds: 0,
    totalActiveSeconds: 0,
    focusSeconds: 0,
    distractSeconds: 0,
    firstActiveAt: null,
    lastActiveAt: null,
    clockInAt: null,
    clockOutAt: null,
    clockAction: 'clock-in',
    apps: []
  };
}

function initials(name) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

function getHistoryAppName(app) {
  return app.name || app.processName || 'Unknown App';
}

function getMergedHistoryApps(apps) {
  const grouped = new Map();
  for (const app of apps || []) {
    const name = getHistoryAppName(app);
    const isDistracting = Boolean(app.isDistracting);
    const key = name;
    const existing = grouped.get(key);
    if (existing) {
      existing.seconds += app.seconds || 0;
      existing.distractSeconds += isDistracting ? app.seconds || 0 : 0;
      existing.focusSeconds += isDistracting ? 0 : app.seconds || 0;
      existing.isDistracting = existing.distractSeconds > existing.focusSeconds;
    } else {
      grouped.set(key, {
        name,
        isDistracting,
        seconds: app.seconds || 0,
        distractSeconds: isDistracting ? app.seconds || 0 : 0,
        focusSeconds: isDistracting ? 0 : app.seconds || 0
      });
    }
  }
  return [...grouped.values()].sort((a, b) => b.seconds - a.seconds);
}

function render(snapshot) {
  document.body.dataset.size = snapshot.size;
  document.body.classList.toggle('is-paused', snapshot.isPaused);
  const isBeforeStart = snapshot.clockAction === 'clock-in' && !snapshot.clockInAt;
  document.body.classList.toggle('is-before-start', isBeforeStart);
  if (isBeforeStart) {
    closeMenu();
    historyPanel.hidden = true;
    clockPanel.hidden = true;
    memoPanel.hidden = true;
    syncPanel.hidden = true;
    dayStartPanel.hidden = true;
    awayIdlePanel.hidden = true;
    if (!awayPanel.hidden) {
      closeAwayPanel({ cancel: true });
    }
  }
  const statFormatter = snapshot.showSeconds ? formatTimeWithSeconds : formatTime;

  dateLabel.textContent = snapshot.dateLabel;
  sessionTime.textContent = getWorkRange(snapshot);
  workdayTime.textContent = statFormatter(snapshot.workdaySeconds);
  totalTime.textContent = statFormatter(snapshot.totalActiveSeconds);
  focusTime.textContent = statFormatter(snapshot.focusSeconds);
  distractTime.textContent = statFormatter(snapshot.distractSeconds);
  secondsBtn.textContent = snapshot.showSeconds ? '\uCD08 \uC228\uAE30\uAE30' : '\uCD08 \uBCF4\uAE30';
  clockBtn.textContent = getClockLabel(snapshot.clockAction);
  renderSyncStatus(snapshot.sync);
  dayStartInput.value = snapshot.dayStartTime || '06:00';
  awayIdleInput.value = String(snapshot.awayIdleMinutes || 1);

  appList.innerHTML = '';
  emptyState.hidden = snapshot.apps.length > 0;

  for (const app of snapshot.apps) {
    const li = document.createElement('li');
    li.className = app.isPip
      ? 'app-item pip-item'
      : app.isVideoSite
        ? 'app-item video-item'
        : 'app-item';
    li.classList.toggle('current-item', app.key === snapshot.currentTargetKey);

    const icon = document.createElement('div');
    icon.className = 'app-icon';
    if (app.icon) {
      const img = document.createElement('img');
      img.src = app.icon;
      img.alt = '';
      icon.append(img);
    } else {
      icon.textContent = initials(app.name);
    }

    const meta = document.createElement('div');
    meta.className = 'app-meta';
    const name = document.createElement('strong');
    name.textContent = app.name || app.processName || 'Unknown App';
    const process = document.createElement('span');
    process.textContent = app.subtitle || app.processName || '';
    meta.append(name, process);

    const currentBadge = document.createElement('span');
    currentBadge.className = 'current-badge';
    currentBadge.textContent = '\uC9C0\uAE08';

    const distractToggle = document.createElement('button');
    distractToggle.className = 'distract-toggle';
    distractToggle.classList.toggle('is-distracting', Boolean(app.isDistracting));
    distractToggle.textContent = app.isDistracting ? '\uB534\uC9D3' : '\uC77C';
    distractToggle.addEventListener('click', () => {
      window.dayglass.setDistraction(app.key, !app.isDistracting).then(render);
    });

    const time = document.createElement('time');
    time.textContent = formatTime(app.seconds);

    li.append(icon, meta);
    if (app.key === snapshot.currentTargetKey) {
      li.append(currentBadge);
    }
    li.append(distractToggle, time);
    li.addEventListener('contextmenu', (event) => openAppContextMenu(event, app.key));
    appList.append(li);
  }

  sizeButtons.forEach((button) => {
    button.classList.toggle('active', button.dataset.size === snapshot.size);
  });

  sortButtons.forEach((button) => {
    button.classList.toggle('active', button.dataset.sort === snapshot.sortMode);
  });
}

function closeMenu() {
  menuPanel.hidden = true;
}

function closeAppContextMenu() {
  appContextMenu.hidden = true;
  contextAppKey = null;
}

function renderSyncStatus(sync = {}) {
  if (!sync?.isLoggedIn) {
    syncStatusText.textContent = '\uB85C\uCEEC \uBAA8\uB4DC';
    return;
  }

  const activeText = sync.isActiveRecorder ? '\uAE30\uB85D \uC911' : '\uBCF4\uAE30 \uBAA8\uB4DC';
  syncStatusText.textContent = `${sync.email || '\uB85C\uADF8\uC778'} · ${activeText}`;
}

function handleSyncError(error) {
  syncStatusText.textContent = error?.message || '동기화 실패';
}

function openAppContextMenu(event, key) {
  event.preventDefault();
  contextAppKey = key;
  closeMenu();
  appContextMenu.hidden = false;
  const rect = appContextMenu.getBoundingClientRect();
  const left = Math.min(event.clientX, window.innerWidth - rect.width - 8);
  const top = Math.min(event.clientY, window.innerHeight - rect.height - 8);
  appContextMenu.style.left = `${Math.max(8, left)}px`;
  appContextMenu.style.top = `${Math.max(8, top)}px`;
}

function setAwayKind(kind) {
  awayKind = kind === 'off' ? 'off' : 'work';
  awayWorkBtn.classList.toggle('active', awayKind === 'work');
  awayOffBtn.classList.toggle('active', awayKind === 'off');
}

function formatDurationFromMs(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function updateAwayDuration() {
  awayDurationInline.textContent = `\uC2DC\uC791 ${formatClock(awayPanelStartAt)} · ${formatDurationFromMs(Date.now() - awayPanelStartAt)}`;
}

function openAwayPanel(away = {}) {
  awayPanelStartAt = Number(away.startAt || Date.now());
  awayLabelInput.value = '';
  setAwayKind('work');
  awayPanel.hidden = false;
  window.clearInterval(awayDurationTimer);
  updateAwayDuration();
  awayDurationTimer = window.setInterval(updateAwayDuration, 1000);
  window.setTimeout(() => awayLabelInput.focus(), 20);
}

function closeAwayPanel({ cancel = false } = {}) {
  awayPanel.hidden = true;
  window.clearInterval(awayDurationTimer);
  if (cancel) {
    window.dayglass.cancelAway();
  }
}

function renderHistoryDetail(day) {
  historyDetail.innerHTML = '';
  historyDateInput.value = dayKeyToInputValue(day.dayKey);

  const title = document.createElement('div');
  title.className = 'history-title';
  const titleText = document.createElement('strong');
  titleText.textContent = day.dateLabel;
  titleText.title = 'Click to choose date';
  titleText.addEventListener('click', () => {
    if (historyDateInput.showPicker) {
      historyDateInput.showPicker();
    } else {
      historyDateInput.focus();
      historyDateInput.click();
    }
  });
  const titleRange = document.createElement('span');
  titleRange.textContent = getWorkRange(day);
  title.append(titleText, titleRange);

  const stats = document.createElement('div');
  stats.className = 'history-stats';
  stats.innerHTML = `
    <div><span>근무</span><strong>${formatTimeWithSeconds(day.workdaySeconds)}</strong></div>
    <div><span>사용</span><strong>${formatTimeWithSeconds(day.totalActiveSeconds)}</strong></div>
    <div><span>일</span><strong>${formatTimeWithSeconds(day.focusSeconds)}</strong></div>
    <div><span>딴짓</span><strong>${formatTimeWithSeconds(day.distractSeconds)}</strong></div>
  `;

  const list = document.createElement('ul');
  list.className = 'history-apps';
  for (const app of day.apps.slice(0, 12)) {
    const item = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = app.subtitle || app.name || app.processName || 'Unknown App';
    const time = document.createElement('strong');
    time.textContent = formatTime(app.seconds);
    item.append(name, time);
    list.append(item);
  }

  historyDetail.append(title, stats, list);
}

function renderHistoryDetailV2(day) {
  historyDetail.innerHTML = '';
  historyDateInput.value = dayKeyToInputValue(day.dayKey);

  const title = document.createElement('div');
  title.className = 'history-title';
  const titleText = document.createElement('strong');
  titleText.textContent = day.dateLabel;
  titleText.title = 'Click to choose date';
  titleText.addEventListener('click', () => {
    if (historyDateInput.showPicker) {
      historyDateInput.showPicker();
    } else {
      historyDateInput.focus();
      historyDateInput.click();
    }
  });
  const titleRange = document.createElement('span');
  titleRange.textContent = getWorkRange(day);
  title.append(titleText, titleRange);

  const stats = document.createElement('div');
  stats.className = 'history-stats';
  stats.innerHTML = `
    <div><span>\uADFC\uBB34</span><strong>${formatTimeWithSeconds(day.workdaySeconds)}</strong></div>
    <div><span>\uC0AC\uC6A9</span><strong>${formatTimeWithSeconds(day.totalActiveSeconds)}</strong></div>
    <div><span>\uC77C</span><strong>${formatTimeWithSeconds(day.focusSeconds)}</strong></div>
    <div><span>\uB534\uC9D3</span><strong>${formatTimeWithSeconds(day.distractSeconds)}</strong></div>
  `;

  const list = document.createElement('ul');
  list.className = 'history-apps';
  for (const app of getMergedHistoryApps(day.apps).slice(0, 12)) {
    const item = document.createElement('li');
    const name = document.createElement('span');
    name.className = 'history-app-name';
    name.textContent = app.name;
    const kind = document.createElement('em');
    kind.className = app.isDistracting ? 'history-kind is-off' : 'history-kind';
    kind.textContent = app.isDistracting ? '\uB534\uC9D3' : '\uC77C';
    const time = document.createElement('strong');
    time.textContent = formatTime(app.seconds);
    item.append(name, kind, time);
    list.append(item);
  }

  historyDetail.append(title, stats, list);
}

function renderHistory(days) {
  historyDetail.innerHTML = '';
  window.__dayglassHistoryDays = days;

  if (!days.length) {
    const todayKey = inputValueToDayKey(new Date().toISOString().slice(0, 10));
    renderHistoryDetailV2(emptyHistoryDay(todayKey));
    return;
  }

  renderHistoryDetailV2(days[0]);
}

function renderClockCalendar(days) {
  clockCalendar.innerHTML = '';
  const daysByKey = new Map((days || []).map((day) => [day.dayKey, day]));
  const year = clockMonthDate.getFullYear();
  const month = clockMonthDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);

  clockMonthLabel.textContent = `${year}.${String(month + 1).padStart(2, '0')}`;
  ['\uC77C', '\uC6D4', '\uD654', '\uC218', '\uBAA9', '\uAE08', '\uD1A0'].forEach((label) => {
    const head = document.createElement('div');
    head.className = 'clock-weekday';
    head.textContent = label;
    clockCalendar.append(head);
  });

  for (let index = 0; index < firstDay.getDay(); index += 1) {
    const blank = document.createElement('div');
    blank.className = 'clock-day is-empty';
    clockCalendar.append(blank);
  }

  for (let dayNumber = 1; dayNumber <= lastDay.getDate(); dayNumber += 1) {
    const date = new Date(year, month, dayNumber);
    const day = daysByKey.get(dateToDayKey(date));
    const cell = document.createElement('div');
    cell.className = 'clock-day';

    const number = document.createElement('strong');
    number.textContent = String(dayNumber);
    cell.append(number);

    if (day?.clockInAt || day?.firstActiveAt) {
      const clockIn = document.createElement('span');
      clockIn.className = 'clock-in-text';
      clockIn.textContent = `\uCD9C ${formatClock(day.clockInAt || day.firstActiveAt)}`;
      const clockOut = document.createElement('span');
      clockOut.className = 'clock-out-text';
      clockOut.textContent = `\uD1F4 ${formatClock(day.clockOutAt || day.lastActiveAt)}`;
      cell.append(clockIn, clockOut);
    }

    clockCalendar.append(cell);
  }
}

opacitySlider.addEventListener('input', (event) => {
  window.dayglass.setOpacity(event.target.value);
  document.documentElement.style.setProperty('--panel-opacity', event.target.value);
});

sizeButtons.forEach((button) => {
  button.addEventListener('click', () => window.dayglass.setSize(button.dataset.size));
});

sortButtons.forEach((button) => {
  button.addEventListener('click', () => window.dayglass.setSortMode(button.dataset.sort).then(render));
});

memoBtn.addEventListener('click', () => {
  closeMenu();
  memoPanel.hidden = false;
  window.dayglass.getMemo().then((text) => {
    memoText.value = text;
    memoText.focus();
  });
});

memoCloseBtn.addEventListener('click', () => {
  memoPanel.hidden = true;
});

memoSaveBtn.addEventListener('click', () => {
  window.dayglass.setMemo(memoText.value).then(() => {
    memoPanel.hidden = true;
  });
});

memoClearBtn.addEventListener('click', () => {
  memoText.value = '';
  window.dayglass.setMemo('');
});

memoText.addEventListener('input', () => {
  window.clearTimeout(window.__dayglassMemoTimer);
  window.__dayglassMemoTimer = window.setTimeout(() => {
    window.dayglass.setMemo(memoText.value);
  }, 350);
});

historyBtn.addEventListener('click', () => {
  closeMenu();
  historyPanel.hidden = false;
  window.dayglass.getHistory().then(renderHistory);
});

historyCloseBtn.addEventListener('click', () => {
  historyPanel.hidden = true;
});

historyDateInput.addEventListener('change', () => {
  const dayKey = inputValueToDayKey(historyDateInput.value);
  const days = window.__dayglassHistoryDays || [];
  const day = days.find((candidate) => candidate.dayKey === dayKey) || emptyHistoryDay(dayKey);
  renderHistoryDetailV2(day);
});

clockLogBtn.addEventListener('click', () => {
  closeMenu();
  clockPanel.hidden = false;
  window.dayglass.getHistory().then((days) => {
    window.__dayglassHistoryDays = days;
    const latestDay = days[0]?.dayKey ? new Date(dayKeyToInputValue(days[0].dayKey)) : new Date();
    clockMonthDate = new Date(latestDay.getFullYear(), latestDay.getMonth(), 1);
    renderClockCalendar(days);
  });
});

clockCloseBtn.addEventListener('click', () => {
  clockPanel.hidden = true;
});

function changeClockMonth(offset) {
  clockMonthDate = new Date(clockMonthDate.getFullYear(), clockMonthDate.getMonth() + offset, 1);
  renderClockCalendar(window.__dayglassHistoryDays || []);
}

clockPanel.addEventListener('click', (event) => {
  const navButton = event.target.closest('[data-month-offset]');
  if (!navButton) return;
  event.preventDefault();
  event.stopPropagation();
  changeClockMonth(Number(navButton.dataset.monthOffset));
});

clockBtn.addEventListener('click', () => {
  closeMenu();
  window.dayglass.toggleClock().then(render);
});

startDayBtn.addEventListener('click', () => {
  window.dayglass.toggleClock().then(render);
});

awayBtn.addEventListener('click', () => {
  closeMenu();
  window.dayglass.startAway().then((result) => {
    if (result?.away) {
      openAwayPanel(result.away);
    }
    if (result?.snapshot) {
      render(result.snapshot);
    }
  });
});

syncBtn.addEventListener('click', () => {
  closeMenu();
  syncPanel.hidden = false;
  window.dayglass.getSyncStatus().then((sync) => {
    renderSyncStatus(sync);
    syncIdInput.value = sync.email || '';
  });
  syncIdInput.focus();
});

syncCloseBtn.addEventListener('click', () => {
  syncPanel.hidden = true;
});

syncConnectBtn.addEventListener('click', () => {
  window.dayglass.connectSyncId(syncIdInput.value).then(renderSyncStatus).catch(handleSyncError);
});

syncNowBtn.addEventListener('click', () => {
  window.dayglass.syncNow().then(renderSyncStatus).catch(handleSyncError);
});

syncLogoutBtn.addEventListener('click', () => {
  window.dayglass.logout().then(renderSyncStatus).catch(handleSyncError);
});

updateBtn.addEventListener('click', () => {
  closeMenu();
  window.dayglass.checkUpdate()
    .then((info) => {
      if (!info.hasUpdate) {
        window.alert(`현재 최신 버전이에요. (${info.currentVersion})`);
        return;
      }
      const notes = info.notes ? `\n\n${info.notes}` : '';
      if (window.confirm(`새 버전 ${info.latestVersion}이 있어요. 지금 설치하고 앱을 닫을까요?${notes}`)) {
        window.dayglass.installUpdate()
          .catch((error) => window.alert(error?.message || '자동 설치를 시작하지 못했어요.'));
      }
    })
    .catch((error) => window.alert(error?.message || '업데이트 확인에 실패했어요.'));
});

dayStartBtn.addEventListener('click', () => {
  closeMenu();
  dayStartPanel.hidden = false;
  dayStartInput.focus();
});

dayStartCloseBtn.addEventListener('click', () => {
  dayStartPanel.hidden = true;
});

dayStartSaveBtn.addEventListener('click', () => {
  window.dayglass.setDayStart(dayStartInput.value).then((snapshot) => {
    dayStartPanel.hidden = true;
    render(snapshot);
  });
});

awayIdleBtn.addEventListener('click', () => {
  closeMenu();
  awayIdlePanel.hidden = false;
  awayIdleInput.focus();
});

awayIdleCloseBtn.addEventListener('click', () => {
  awayIdlePanel.hidden = true;
});

awayIdleSaveBtn.addEventListener('click', () => {
  window.dayglass.setAwayIdle(awayIdleInput.value).then((snapshot) => {
    awayIdlePanel.hidden = true;
    render(snapshot);
  });
});

awayWorkBtn.addEventListener('click', () => setAwayKind('work'));
awayOffBtn.addEventListener('click', () => setAwayKind('off'));

awayCloseBtn.addEventListener('click', () => closeAwayPanel({ cancel: true }));
awayCancelBtn.addEventListener('click', () => closeAwayPanel({ cancel: true }));

awaySaveBtn.addEventListener('click', () => {
  const label = awayLabelInput.value.trim() || '\uAE30\uD0C0';
  window.dayglass.recordAway({
    label,
    startAt: awayPanelStartAt,
    isDistracting: awayKind === 'off'
  }).then((snapshot) => {
    awayPanel.hidden = true;
    window.clearInterval(awayDurationTimer);
    render(snapshot);
  });
});

secondsBtn.addEventListener('click', () => {
  closeMenu();
  window.dayglass.toggleSeconds().then(render);
});

deleteAppBtn.addEventListener('click', () => {
  const key = contextAppKey;
  closeAppContextMenu();
  if (!key) return;
  window.dayglass.deleteApp(key).then(render);
});

menuBtn.addEventListener('click', (event) => {
  event.stopPropagation();
  closeAppContextMenu();
  menuPanel.hidden = !menuPanel.hidden;
});
document.addEventListener('click', (event) => {
  if (!menuPanel.hidden && !event.target.closest('.menu-wrap') && !event.target.closest('.menu-panel')) {
    closeMenu();
  }
  if (!appContextMenu.hidden && !event.target.closest('.app-context-menu')) {
    closeAppContextMenu();
  }
});
document.querySelector('#minimizeBtn').addEventListener('click', () => window.dayglass.minimize());
document.querySelector('#closeBtn').addEventListener('click', () => window.dayglass.close());

window.dayglass.getUsage().then(render);
window.dayglass.onUsageUpdate(render);
window.dayglass.onAwayPrompt(openAwayPanel);
