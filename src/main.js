const { app, BrowserWindow, ipcMain, powerMonitor, Tray, Menu, nativeImage, shell } = require('electron');
const { execFile, spawn } = require('child_process');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const POLL_MS = 1000;
const DEFAULT_AWAY_IDLE_MINUTES = 1;
const VIDEO_IDLE_LIMIT_SECONDS = 300;
const DEFAULT_DAY_START_MINUTES = 6 * 60;
const SUPABASE_URL = 'https://mvdstacxmwwiqeavzyld.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable__8oVp9bOjbp6FzAWcVLPPQ__aRK3o7P';
const APP_VERSION = require('../package.json').version;
const UPDATE_RELEASE_URL = 'https://api.github.com/repos/nuri0311/dayglass/releases/latest';
const ACTIVE_DEVICE_TIMEOUT_MS = 90 * 1000;
const HEARTBEAT_MS = 15 * 1000;
const FOCUS_DISTRACTION_LIMIT_SECONDS = 180;
const APP_ICON = path.join(__dirname, 'assets', 'app-icon.png');
const SIZE_PRESETS = {
  compact: { width: 395, height: 218 },
  normal: { width: 395, height: 410 },
  large: { width: 500, height: 610 }
};
const BROWSER_PROCESSES = new Set(['chrome', 'msedge', 'brave', 'firefox', 'opera', 'vivaldi']);
const MERGED_APP_TARGETS = [
  { id: 'kakaotalk', label: 'KakaoTalk', patterns: [/^kakaotalk/i, /^kakao/i] }
];
const LONG_IDLE_APP_PATTERNS = [/^zoom$/i, /^zoom\.exe$/i, /^zoom meetings?$/i];
const VIDEO_SITES = [
  { id: 'youtube', label: 'YouTube', patterns: [/youtube/i, /youtu\.be/i] },
  { id: 'chzzk', label: 'CHZZK', patterns: [/chzzk/i, /\uCE58\uC9C0\uC9C1/i] },
  { id: 'soop', label: 'SOOP', patterns: [/\bsoop\b/i, /\uC232/i, /afreeca/i, /\uC544\uD504\uB9AC\uCE74/i] }
];
const PIP_TITLE_PATTERNS = [
  /picture[\s-]*in[\s-]*picture/i,
  /\bpip\b/i,
  /\uC0AC\uC9C4\s*\uC18D\s*\uC0AC\uC9C4/i
];

let mainWindow;
let tray;
let isQuitting = false;
let currentSize = 'normal';
let usageState = {};
let lastTick = Date.now();
let currentTargetKey = null;
let awayStartAt = null;
let activeAway = null;
let supabase = null;
let syncUser = null;
let isActiveRecorder = true;
let lastHeartbeatAt = 0;
let focusDistractionStartedAt = null;
let focusWarningShown = false;

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.exit(0);
}

function getStorePath() {
  return path.join(app.getPath('userData'), 'usage-state.json');
}

function loadState() {
  try {
    usageState = JSON.parse(fs.readFileSync(getStorePath(), 'utf8'));
  } catch {
    usageState = {};
  }
}

function saveState() {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(getStorePath(), JSON.stringify(usageState, null, 2));
}

function getDayKey(date = new Date()) {
  const dayStartMinutes = getDayStartMinutes();
  const shifted = new Date(date);
  const currentMinutes = shifted.getHours() * 60 + shifted.getMinutes();
  if (currentMinutes < dayStartMinutes) shifted.setDate(shifted.getDate() - 1);
  const yy = String(shifted.getFullYear()).slice(-2);
  const mm = String(shifted.getMonth() + 1).padStart(2, '0');
  const dd = String(shifted.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function getDayLabel() {
  const key = getDayKey();
  return getDayLabelForKey(key);
}

function getDayLabelForKey(key) {
  const [yy, mm, dd] = key.split('-').map(Number);
  const date = new Date(2000 + yy, mm - 1, dd);
  const weekdays = ['\uC77C', '\uC6D4', '\uD654', '\uC218', '\uBAA9', '\uAE08', '\uD1A0'];
  return `${key} (${weekdays[date.getDay()]})`;
}

function ensureDay(key = getDayKey()) {
  usageState[key] ??= {
    apps: {},
    totalIntervals: [],
    totalActiveSeconds: 0,
    firstActiveAt: null,
    lastActiveAt: null,
    clockInAt: null,
    clockOutAt: null,
    updatedAt: null
  };
  return usageState[key];
}

function ensureToday() {
  return ensureDay(getDayKey());
}

function getSettings() {
  usageState.__settings ??= {
    paused: false,
    distractions: {},
    sortMode: 'usage',
    memo: '',
    showSeconds: true,
    dayStartMinutes: DEFAULT_DAY_START_MINUTES,
    awayIdleMinutes: DEFAULT_AWAY_IDLE_MINUTES,
    focusMode: false,
    deviceId: crypto.randomUUID(),
    sync: {
      session: null,
      email: '',
      syncIdLabel: '',
      syncKeyHash: '',
      activeDeviceId: null,
      activeSeenAt: null,
      lastSyncAt: null
    }
  };
  usageState.__settings.distractions ??= {};
  usageState.__settings.sortMode ??= 'usage';
  usageState.__settings.memo ??= '';
  usageState.__settings.showSeconds ??= true;
  usageState.__settings.focusMode ??= false;
  usageState.__settings.deviceId ??= crypto.randomUUID();
  usageState.__settings.sync ??= {};
  usageState.__settings.sync.session ??= null;
  usageState.__settings.sync.email ??= '';
  usageState.__settings.sync.syncIdLabel ??= '';
  usageState.__settings.sync.syncKeyHash ??= '';
  usageState.__settings.sync.activeDeviceId ??= null;
  usageState.__settings.sync.activeSeenAt ??= null;
  usageState.__settings.sync.lastSyncAt ??= null;
  usageState.__settings.dayStartMinutes = normalizeDayStartMinutes(usageState.__settings.dayStartMinutes);
  usageState.__settings.awayIdleMinutes = normalizeAwayIdleMinutes(usageState.__settings.awayIdleMinutes);
  return usageState.__settings;
}

function normalizeDayStartMinutes(value) {
  const minutes = Number(value);
  if (!Number.isFinite(minutes)) return DEFAULT_DAY_START_MINUTES;
  return Math.min(1439, Math.max(0, Math.round(minutes)));
}

function getDayStartMinutes() {
  return normalizeDayStartMinutes(usageState.__settings?.dayStartMinutes);
}

function normalizeAwayIdleMinutes(value) {
  const minutes = Number(value);
  if (!Number.isFinite(minutes)) return DEFAULT_AWAY_IDLE_MINUTES;
  return Math.min(180, Math.max(1, Math.round(minutes)));
}

function getAwayIdleSeconds(settings = getSettings()) {
  return normalizeAwayIdleMinutes(settings.awayIdleMinutes) * 60;
}

function compareVersions(a, b) {
  const left = String(a || '0').split('.').map(Number);
  const right = String(b || '0').split('.').map(Number);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const diff = (left[index] || 0) - (right[index] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

async function checkForUpdate() {
  const response = await fetch(UPDATE_RELEASE_URL, {
    headers: {
      'User-Agent': 'DayGlass-Updater',
      Accept: 'application/vnd.github+json'
    }
  });
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('GitHub Release가 아직 없어요. nuri0311/dayglass 저장소에 최신 릴리즈를 만들어주세요.');
    }
    throw new Error('업데이트 정보를 찾지 못했어요. GitHub Release 상태를 확인해주세요.');
  }
  const release = await response.json();
  const latestVersion = String(release.tag_name || release.name || '').replace(/^v/i, '');
  const setupAsset = (release.assets || []).find((asset) => {
    const name = String(asset.name || '');
    return /^DayGlass[ ._-]+Setup[ ._-]+.*\.exe$/i.test(name);
  });
  const hasUpdate = compareVersions(latestVersion, APP_VERSION) > 0;
  return {
    currentVersion: APP_VERSION,
    latestVersion,
    hasUpdate,
    url: setupAsset?.browser_download_url || '',
    notes: release.body || ''
  };
}

function getUpdateInstallerPath(info) {
  const version = String(info?.latestVersion || info?.version || APP_VERSION).replace(/[^\dA-Za-z._-]/g, '');
  return path.join(app.getPath('userData'), 'updates', `DayGlass Setup ${version || 'latest'}.exe`);
}

async function downloadAndInstallUpdate() {
  const info = await checkForUpdate();
  if (!info.hasUpdate) return { installed: false, ...info };
  if (!/^https?:\/\//.test(info.url || '')) {
    throw new Error('업데이트 설치 파일을 찾지 못했어요. GitHub Release에 DayGlass Setup exe를 올려주세요.');
  }

  const response = await fetch(info.url);
  if (!response.ok) {
    throw new Error('설치 파일을 다운로드하지 못했어요.');
  }

  const installerPath = getUpdateInstallerPath(info);
  fs.mkdirSync(path.dirname(installerPath), { recursive: true });
  fs.writeFileSync(installerPath, Buffer.from(await response.arrayBuffer()));

  const child = spawn(installerPath, ['/S'], {
    detached: true,
    stdio: 'ignore'
  });
  child.unref();
  app.quit();
  return { installed: true, installerPath, ...info };
}

function getSupabase() {
  if (!supabase) {
    supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      },
      realtime: {
        transport: WebSocket
      }
    });
  }
  return supabase;
}

function getSyncStatus() {
  const settings = getSettings();
  return {
    isLoggedIn: Boolean(settings.sync.syncKeyHash || settings.sync.session?.access_token),
    email: settings.sync.syncIdLabel || settings.sync.email || '',
    isActiveRecorder,
    activeDeviceId: settings.sync.activeDeviceId || null,
    deviceId: settings.deviceId,
    lastSyncAt: settings.sync.lastSyncAt || null
  };
}

function getSyncKeyHash(value) {
  return crypto.createHash('sha256').update(String(value || '').trim().toLowerCase()).digest('hex');
}

function toSyncError(error) {
  const details = [
    error?.message,
    error?.details,
    error?.hint,
    error?.code,
    typeof error === 'object' ? JSON.stringify(error) : String(error || '')
  ].filter(Boolean);
  const message = details.join(' / ') || '동기화 실패';
  if (
    message.includes('dayglass_sync_keys') &&
    (message.includes('does not exist') || message.includes('schema cache') || message.includes('PGRST205'))
  ) {
    return new Error('Supabase SQL Editor에서 schema.sql을 먼저 실행해야 해요. dayglass_sync_keys 테이블이 아직 없습니다.');
  }
  if (message.includes('row-level security') || message.includes('permission denied')) {
    return new Error('Supabase 권한 설정이 맞지 않아요. schema.sql 전체를 다시 실행해 주세요.');
  }
  if (message.includes('fetch failed') || message.includes('Failed to fetch')) {
    return new Error('Supabase에 연결하지 못했어요. 인터넷 연결이나 프로젝트 URL/key를 확인해 주세요.');
  }
  return new Error(message.replace(/^Error invoking remote method '[^']+':\s*/i, ''));
}

function getCloudSafeState() {
  const clone = JSON.parse(JSON.stringify(usageState || {}));
  if (clone.__settings) {
    delete clone.__settings.sync?.session;
  }
  return clone;
}

function normalizeInterval(interval) {
  const start = new Date(interval?.start || interval?.startAt || '').getTime();
  const end = new Date(interval?.end || interval?.endAt || '').getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return {
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString()
  };
}

function mergeIntervals(...intervalGroups) {
  const sorted = intervalGroups
    .flat()
    .map(normalizeInterval)
    .filter(Boolean)
    .sort((a, b) => new Date(a.start) - new Date(b.start));
  const merged = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (!last || new Date(interval.start) > new Date(last.end)) {
      merged.push({ ...interval });
    } else if (new Date(interval.end) > new Date(last.end)) {
      last.end = interval.end;
    }
  }
  return merged.slice(-5000);
}

function sumIntervals(intervals = []) {
  return mergeIntervals(intervals).reduce((sum, interval) => {
    return sum + Math.round((new Date(interval.end) - new Date(interval.start)) / 1000);
  }, 0);
}

function addInterval(intervals = [], startAt, endAt) {
  return mergeIntervals(intervals, [{ start: new Date(startAt).toISOString(), end: new Date(endAt).toISOString() }]);
}

function getCountedAppIntervals(apps = {}) {
  return Object.values(apps || {})
    .filter((item) => item.countTotal !== false)
    .map((item) => item.intervals || []);
}

function getDayTotalIntervals(day = {}, apps = day.apps || {}) {
  return mergeIntervals(day.totalIntervals || [], ...getCountedAppIntervals(apps));
}

function getDayTotalSeconds(day = {}, apps = day.apps || {}) {
  const intervals = getDayTotalIntervals(day, apps);
  if (intervals.length) return sumIntervals(intervals);
  return Number(day.totalActiveSeconds || 0);
}

function mergeAppRecords(cloudApp = {}, localApp = {}) {
  const intervals = mergeIntervals(cloudApp.intervals || [], localApp.intervals || []);
  const seconds = intervals.length
    ? sumIntervals(intervals)
    : Math.max(Number(cloudApp.seconds || 0), Number(localApp.seconds || 0));
  return {
    ...cloudApp,
    ...localApp,
    seconds,
    intervals,
    countTotal: cloudApp.countTotal === false || localApp.countTotal === false ? false : true,
    icon: localApp.icon || cloudApp.icon || null,
    lastUsedAt: [cloudApp.lastUsedAt, localApp.lastUsedAt].filter(Boolean).sort().pop() || null
  };
}

function mergeClockOut(cloudDay = {}, localDay = {}) {
  return [cloudDay.clockOutAt, localDay.clockOutAt].filter(Boolean).sort().pop() || null;
}

function mergeStates(cloudState = {}, localState = {}) {
  const merged = JSON.parse(JSON.stringify(cloudState || {}));
  for (const [key, value] of Object.entries(localState || {})) {
    if (key === '__settings') continue;
    if (!/^\d{2}-\d{2}-\d{2}$/.test(key)) {
      merged[key] = value;
      continue;
    }

    const cloudDay = merged[key] || {};
    const localDay = value || {};
    const apps = { ...(cloudDay.apps || {}) };
    for (const [appKey, appValue] of Object.entries(localDay.apps || {})) {
      apps[appKey] = mergeAppRecords(apps[appKey], appValue);
    }

    merged[key] = {
      ...cloudDay,
      ...localDay,
      apps,
      totalIntervals: getDayTotalIntervals(
        { totalIntervals: mergeIntervals(cloudDay.totalIntervals || [], localDay.totalIntervals || []) },
        apps
      ),
      totalActiveSeconds: 0,
      firstActiveAt: [cloudDay.firstActiveAt, localDay.firstActiveAt].filter(Boolean).sort()[0] || null,
      lastActiveAt: [cloudDay.lastActiveAt, localDay.lastActiveAt].filter(Boolean).sort().pop() || null,
      clockInAt: [cloudDay.clockInAt, localDay.clockInAt].filter(Boolean).sort()[0] || null,
      clockOutAt: mergeClockOut(cloudDay, localDay),
      updatedAt: [cloudDay.updatedAt, localDay.updatedAt].filter(Boolean).sort().pop() || null
    };
    merged[key].totalActiveSeconds = getDayTotalSeconds(merged[key], apps);
  }

  merged.__settings = {
    ...(merged.__settings || {}),
    ...getSettings(),
    sync: getSettings().sync
  };
  return merged;
}

async function restoreSupabaseSession() {
  const session = getSettings().sync.session;
  if (!session?.access_token || !session?.refresh_token) return false;
  const { data, error } = await getSupabase().auth.setSession(session);
  if (error || !data.session) return false;
  syncUser = data.user;
  getSettings().sync.session = data.session;
  getSettings().sync.email = data.user?.email || getSettings().sync.email || '';
  saveState();
  return true;
}

async function getCloudRow() {
  const settings = getSettings();
  const keyHash = settings.sync.syncKeyHash;
  const query = getSupabase().from(keyHash ? 'dayglass_sync_keys' : 'dayglass_sync').select('*');
  const { data, error } = keyHash
    ? await query.eq('sync_key_hash', keyHash).maybeSingle()
    : await query.eq('user_id', syncUser.id).maybeSingle();
  if (error) throw error;
  return data;
}

async function upsertCloudState(extra = {}, options = {}) {
  const settings = getSettings();
  if (!syncUser?.id && !settings.sync.syncKeyHash) return;
  if (options.mergeRemote !== false) {
    const existing = await getCloudRow();
    if (existing?.state) {
      usageState = mergeStates(existing.state, usageState);
    }
  }
  const now = new Date().toISOString();
  const row = settings.sync.syncKeyHash ? {
    sync_key_hash: settings.sync.syncKeyHash,
    state: getCloudSafeState(),
    updated_at: now,
    ...extra
  } : {
    user_id: syncUser.id,
    state: getCloudSafeState(),
    updated_at: now,
    ...extra
  };
  const { error } = await getSupabase()
    .from(settings.sync.syncKeyHash ? 'dayglass_sync_keys' : 'dayglass_sync')
    .upsert(row, { onConflict: settings.sync.syncKeyHash ? 'sync_key_hash' : 'user_id' });
  if (error) throw error;
  settings.sync.lastSyncAt = now;
  saveState();
}

async function syncNow() {
  if (!syncUser?.id && !getSettings().sync.syncKeyHash) {
    await restoreSupabaseSession();
  }
  if (!syncUser?.id && !getSettings().sync.syncKeyHash) return getSyncStatus();

  const row = await getCloudRow();
  usageState = mergeStates(row?.state || {}, usageState);
  getSettings().sync.activeDeviceId = row?.active_device_id || null;
  getSettings().sync.activeSeenAt = row?.active_seen_at || null;
  await upsertCloudState({}, { mergeRemote: false });
  mainWindow?.webContents.send('usage:update', getSnapshot());
  return getSyncStatus();
}

async function heartbeatSync() {
  if (!syncUser?.id && !getSettings().sync.syncKeyHash) return;
  const now = Date.now();
  if (now - lastHeartbeatAt < HEARTBEAT_MS) return;
  lastHeartbeatAt = now;

  const row = await getCloudRow();
  const settings = getSettings();
  const activeSeenAt = row?.active_seen_at ? new Date(row.active_seen_at).getTime() : 0;
  const activeDeviceId = row?.active_device_id || null;
  const canClaim = !activeDeviceId || activeDeviceId === settings.deviceId || now - activeSeenAt > ACTIVE_DEVICE_TIMEOUT_MS;
  isActiveRecorder = canClaim;
  settings.sync.activeDeviceId = canClaim ? settings.deviceId : activeDeviceId;
  settings.sync.activeSeenAt = row?.active_seen_at || null;

  if (canClaim) {
    const seenAt = new Date().toISOString();
    await upsertCloudState({ active_device_id: settings.deviceId, active_seen_at: seenAt }, { mergeRemote: false });
    settings.sync.activeSeenAt = seenAt;
  }
  saveState();
}

function minutesToTimeValue(minutes) {
  const safeMinutes = normalizeDayStartMinutes(minutes);
  const hours = Math.floor(safeMinutes / 60);
  const mins = safeMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

function timeValueToMinutes(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || ''));
  if (!match) return DEFAULT_DAY_START_MINUTES;
  const hours = Math.min(23, Math.max(0, Number(match[1])));
  const minutes = Math.min(59, Math.max(0, Number(match[2])));
  return hours * 60 + minutes;
}

function normalizeAppName(name, exe) {
  if (name && name.trim()) return name.trim();
  if (exe) return path.basename(exe, path.extname(exe));
  return 'Unknown App';
}

function normalizeWindowTitle(title, processName) {
  const cleaned = String(title || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  const browserSuffixes = [
    /\s[-–]\sGoogle Chrome$/i,
    /\s[-–]\sChrome$/i,
    /\s[-–]\sMicrosoft Edge$/i,
    /\s[-–]\sBrave$/i,
    /\s[-–]\sMozilla Firefox$/i,
    /\s[-–]\sOpera$/i,
    /\s[-–]\sVivaldi$/i
  ];
  return browserSuffixes.reduce((value, pattern) => value.replace(pattern, ''), cleaned) || processName || cleaned;
}

function slugTitle(title) {
  let hash = 0;
  for (const char of String(title || '')) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash.toString(36);
}

function getMergedApp(appInfo) {
  const processName = appInfo?.processName || '';
  const merged = MERGED_APP_TARGETS.find((target) =>
    target.patterns.some((pattern) => pattern.test(processName))
  );
  if (!merged) return null;

  return {
    key: `app:${merged.id}`,
    name: merged.label,
    processName: appInfo.processName,
    exe: appInfo.exe,
    isVideoSite: false,
    subtitle: appInfo.processName || merged.label
  };
}

function findVideoSite(title) {
  return VIDEO_SITES.find((candidate) => candidate.patterns.some((pattern) => pattern.test(title)));
}

function getBrowserVideoSite(appInfo) {
  const processName = (appInfo?.processName || '').toLowerCase();
  if (!BROWSER_PROCESSES.has(processName)) return null;

  const title = appInfo.title || appInfo.name || '';
  const site = findVideoSite(title);
  if (!site) return null;
  const pageTitle = normalizeWindowTitle(title, appInfo.processName);

  return {
    key: `video:${site.id}:${slugTitle(pageTitle)}`,
    name: site.label,
    processName: appInfo.processName,
    exe: appInfo.exe,
    isVideoSite: true,
    subtitle: pageTitle || `${site.label} in ${appInfo.processName || 'browser'}`
  };
}

function getBrowserPage(appInfo) {
  const processName = (appInfo?.processName || '').toLowerCase();
  if (!BROWSER_PROCESSES.has(processName)) return null;

  const pageTitle = normalizeWindowTitle(appInfo.title || appInfo.name, appInfo.processName);
  if (!pageTitle) return null;

  return {
    key: `page:${processName}:${slugTitle(pageTitle)}`,
    name: pageTitle,
    processName: appInfo.processName,
    exe: appInfo.exe,
    isVideoSite: false,
    subtitle: `${appInfo.processName || 'browser'} page`
  };
}

function getDayGlassApp(appInfo) {
  const processName = (appInfo?.processName || '').toLowerCase();
  const title = appInfo?.title || appInfo?.name || '';
  const isPackagedSelf = appInfo?.exe && path.resolve(appInfo.exe) === path.resolve(process.execPath);
  const isDevSelf = processName === 'electron' && /dayglass/i.test(title);
  const isNamedSelf = /^dayglass/i.test(processName);
  if (!isPackagedSelf && !isDevSelf && !isNamedSelf) return null;

  return {
    key: 'app:dayglass',
    name: 'DayGlass',
    processName: appInfo.processName,
    exe: appInfo.exe,
    icon: APP_ICON,
    isVideoSite: false,
    subtitle: 'DayGlass Usage'
  };
}

function isLongIdleApp(appInfo) {
  const processName = appInfo?.processName || '';
  const exeName = appInfo?.exe ? path.basename(appInfo.exe) : '';
  return LONG_IDLE_APP_PATTERNS.some((pattern) => pattern.test(processName) || pattern.test(exeName));
}

function getUsageTarget(appInfo) {
  const dayGlassApp = getDayGlassApp(appInfo);
  if (dayGlassApp) return dayGlassApp;

  const videoSite = getBrowserVideoSite(appInfo);
  if (videoSite) return videoSite;

  const browserPage = getBrowserPage(appInfo);
  if (browserPage) return browserPage;

  const mergedApp = getMergedApp(appInfo);
  if (mergedApp) return mergedApp;

  return {
    key: appInfo.exe || appInfo.processName || appInfo.name,
    name: appInfo.name,
    processName: appInfo.processName,
    exe: appInfo.exe,
    isVideoSite: false,
    subtitle: appInfo.processName || ''
  };
}

function getPipTarget(windowInfo) {
  const title = windowInfo.title || '';
  const isPip = PIP_TITLE_PATTERNS.some((pattern) => pattern.test(title));
  if (!isPip) return null;

  const site = findVideoSite(title);
  const browser = windowInfo.processName || 'browser';
  const pageTitle = normalizeWindowTitle(title, browser);
  const name = site ? `${site.label} PiP` : `${browser} PiP`;

  return {
    key: site ? `pip:${site.id}:${browser}:${slugTitle(pageTitle)}` : `pip:browser:${browser}:${slugTitle(pageTitle)}`,
    name,
    processName: browser,
    exe: windowInfo.exe,
    icon: null,
    isVideoSite: true,
    isPip: true,
    subtitle: pageTitle || 'PiP overlay, duplicate list time'
  };
}

function runPowerShell(script) {
  const utf8Script = `
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
${script}
`;
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', utf8Script],
      { windowsHide: true, timeout: 5000 },
      (error, stdout) => {
        if (error) return resolve(null);
        try {
          resolve(JSON.parse(stdout));
        } catch {
          resolve(null);
        }
      }
    );
  });
}

function quoteTaskArg(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function getLaunchArgs(extraArgs = []) {
  return [...(app.isPackaged ? [] : [app.getAppPath()]), ...extraArgs];
}

function getLaunchCommand(extraArgs = []) {
  return [process.execPath, ...getLaunchArgs(extraArgs)].map(quoteTaskArg).join(' ');
}

function registerAutoLaunch() {
  try {
    app.setLoginItemSettings({
      openAtLogin: true,
      path: process.execPath,
      args: getLaunchArgs()
    });
  } catch {
    // Startup registration can fail in portable/dev environments.
  }
}

function registerDailyLaunchTask() {
  if (process.platform !== 'win32') return;

  const taskName = 'DayGlass Usage Daily Start';
  execFile(
    'schtasks.exe',
    [
      '/Create',
      '/TN',
      taskName,
      '/SC',
      'DAILY',
      '/ST',
      minutesToTimeValue(getDayStartMinutes()),
      '/TR',
      getLaunchCommand(['--scheduled-start']),
      '/F'
    ],
    { windowsHide: true, timeout: 5000 },
    () => {}
  );
}

async function getForegroundApp() {
  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@
$hwnd = [Win32]::GetForegroundWindow()
$pidValue = 0
[Win32]::GetWindowThreadProcessId($hwnd, [ref]$pidValue) | Out-Null
$p = Get-Process -Id $pidValue -ErrorAction SilentlyContinue
if ($null -eq $p) {
  @{ name = "Unknown App"; exe = ""; pid = 0 } | ConvertTo-Json -Compress
} else {
  @{ name = $p.MainWindowTitle; processName = $p.ProcessName; exe = $p.Path; pid = $p.Id } | ConvertTo-Json -Compress
}
`;
  const result = await runPowerShell(script);
  if (!result) return null;
  return {
    title: result.name || '',
    processName: result.processName || '',
    exe: result.exe || '',
    pid: result.pid || 0,
    name: normalizeAppName(result.name, result.exe || result.processName)
  };
}

async function getBrowserWindows() {
  const script = `
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class Win32Enum {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@
$items = New-Object System.Collections.Generic.List[object]
$callback = [Win32Enum+EnumWindowsProc]{
  param([IntPtr]$hWnd, [IntPtr]$lParam)
  if (-not [Win32Enum]::IsWindowVisible($hWnd)) { return $true }
  $builder = New-Object System.Text.StringBuilder 512
  [Win32Enum]::GetWindowText($hWnd, $builder, $builder.Capacity) | Out-Null
  $title = $builder.ToString()
  if ([string]::IsNullOrWhiteSpace($title)) { return $true }
  $pidValue = 0
  [Win32Enum]::GetWindowThreadProcessId($hWnd, [ref]$pidValue) | Out-Null
  $p = Get-Process -Id $pidValue -ErrorAction SilentlyContinue
  if ($null -ne $p -and @("chrome","msedge","brave","firefox","opera","vivaldi") -contains $p.ProcessName) {
    $items.Add(@{ title = $title; processName = $p.ProcessName; exe = $p.Path; pid = $p.Id }) | Out-Null
  }
  return $true
}
[Win32Enum]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null
$items | ConvertTo-Json -Compress
`;
  const result = await runPowerShell(script);
  if (!result) return [];
  return Array.isArray(result) ? result : [result];
}

async function extractIcon(appInfo) {
  if (!appInfo?.exe || !fs.existsSync(appInfo.exe)) return null;
  const iconDir = path.join(app.getPath('userData'), 'icons');
  const safeName = `${appInfo.processName || path.basename(appInfo.exe)}.png`.replace(/[^\w.-]/g, '_');
  const target = path.join(iconDir, safeName);
  if (fs.existsSync(target)) return target;

  fs.mkdirSync(iconDir, { recursive: true });
  const script = `
Add-Type -AssemblyName System.Drawing
$icon = [System.Drawing.Icon]::ExtractAssociatedIcon('${appInfo.exe.replace(/'/g, "''")}')
$bitmap = $icon.ToBitmap()
$bitmap.Save('${target.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Png)
$bitmap.Dispose()
$icon.Dispose()
@{ ok = $true } | ConvertTo-Json -Compress
`;
  const result = await runPowerShell(script);
  return result?.ok && fs.existsSync(target) ? target : null;
}

function createWindow() {
  const preset = SIZE_PRESETS[currentSize];
  mainWindow = new BrowserWindow({
    ...preset,
    minWidth: 280,
    minHeight: 210,
    transparent: true,
    frame: false,
    hasShadow: false,
    alwaysOnTop: true,
    resizable: true,
    backgroundColor: '#00000000',
    title: 'DayGlass Usage',
    icon: APP_ICON,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.setAlwaysOnTop(true, 'screen-saver');

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    mainWindow.hide();
  });
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  if (tray) return;
  const trayIcon = nativeImage.createFromPath(APP_ICON).resize({ width: 16, height: 16 });
  tray = new Tray(trayIcon);
  tray.setToolTip('DayGlass Usage');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '\uC5F4\uAE30', click: showMainWindow },
    { type: 'separator' },
    {
      label: '\uC885\uB8CC',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]));
  tray.on('click', showMainWindow);
}

function openAwayPrompt(startAt = Date.now(), reason = 'manual') {
  activeAway = { startAt, reason };
  if (!mainWindow || mainWindow.isDestroyed()) return activeAway;
  showMainWindow();
  mainWindow.webContents.send('away:prompt', activeAway);
  return activeAway;
}

function showFocusWarning() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  showMainWindow();
  mainWindow.webContents.send('focus:warning');
}

function getSnapshot() {
  const today = ensureToday();
  return buildDaySnapshot(getDayKey(), today);
}

function buildDaySnapshot(dayKey, day) {
  const settings = getSettings();
  const groupedApps = new Map();
  const totalActiveSeconds = getDayTotalSeconds(day);

  for (const item of Object.values(day.apps || {})) {
    const mergedApp = getMergedApp(item);
    const normalized = mergedApp
      ? { ...item, ...mergedApp, seconds: item.seconds, intervals: item.intervals, icon: item.icon }
      : item;
    normalized.seconds = normalized.intervals?.length ? sumIntervals(normalized.intervals) : normalized.seconds || 0;
    normalized.lastUsedAt ??= day.lastActiveAt || day.updatedAt || null;
    const existing = groupedApps.get(normalized.key);
    if (existing) {
      existing.intervals = mergeIntervals(existing.intervals || [], normalized.intervals || []);
      existing.seconds = existing.intervals.length
        ? sumIntervals(existing.intervals)
        : existing.seconds + normalized.seconds;
      existing.icon ??= normalized.icon;
      existing.isVideoSite = existing.isVideoSite || normalized.isVideoSite;
      existing.isPip = existing.isPip || normalized.isPip;
      existing.isDistracting = existing.isDistracting || normalized.isDistracting;
      if (
        normalized.lastUsedAt &&
        (!existing.lastUsedAt || new Date(normalized.lastUsedAt) > new Date(existing.lastUsedAt))
      ) {
        existing.lastUsedAt = normalized.lastUsedAt;
      }
    } else {
      groupedApps.set(normalized.key, { ...normalized });
    }
  }

  const apps = [...groupedApps.values()]
    .sort((a, b) => {
      if (settings.sortMode === 'recent') {
        return new Date(b.lastUsedAt || 0) - new Date(a.lastUsedAt || 0);
      }
      return b.seconds - a.seconds;
    })
    .map((item) => {
      const oldKeyDistraction = settings.distractions[item.key];
      const isDistracting = Boolean(oldKeyDistraction ?? item.isDistracting);
      return {
        ...item,
        isDistracting,
        icon: item.icon ? `file://${item.icon}` : null
      };
    });
  const distractSeconds = apps
    .filter((item) => item.isDistracting)
    .reduce((sum, item) => sum + item.seconds, 0);
  const focusSeconds = apps
    .filter((item) => !item.isDistracting)
    .reduce((sum, item) => sum + item.seconds, 0);

  return {
    dayKey,
    dateLabel: getDayLabelForKey(dayKey),
    workdaySeconds: getWorkdaySeconds(day, dayKey),
    totalActiveSeconds,
    focusSeconds,
    distractSeconds,
    firstActiveAt: day.firstActiveAt || null,
    lastActiveAt: day.lastActiveAt || null,
    clockInAt: day.clockInAt || null,
    clockOutAt: day.clockOutAt || null,
    clockAction: getClockAction(day),
    apps,
    currentTargetKey,
    idleSeconds: powerMonitor.getSystemIdleTime(),
    idleLimitSeconds: getAwayIdleSeconds(settings),
    awayIdleMinutes: settings.awayIdleMinutes,
    isPaused: Boolean(settings.paused),
    focusMode: Boolean(settings.focusMode),
    sync: getSyncStatus(),
    showSeconds: Boolean(settings.showSeconds),
    dayStartTime: minutesToTimeValue(settings.dayStartMinutes),
    sortMode: settings.sortMode,
    size: currentSize
  };
}

function getClockAction(day) {
  if (!day?.clockInAt) return 'clock-in';
  if (!day.clockOutAt) return 'clock-out';
  return 'undo-clock-out';
}

function isClockOpen(day) {
  return Boolean(day?.clockInAt && !day.clockOutAt);
}

function getWorkdaySeconds(day, dayKey = getDayKey()) {
  const hasManualClock = Boolean(day?.clockInAt);
  const startSource = hasManualClock ? day.clockInAt : day?.firstActiveAt;
  const endSource = hasManualClock
    ? day.clockOutAt || (dayKey === getDayKey() ? new Date().toISOString() : day.lastActiveAt)
    : day?.lastActiveAt;

  if (!startSource || !endSource) return 0;
  const start = new Date(startSource).getTime();
  const end = new Date(endSource).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.round((end - start) / 1000);
}

function getHistory() {
  return Object.entries(usageState)
    .filter(([key, value]) => /^\d{2}-\d{2}-\d{2}$/.test(key) && value?.apps)
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([key, value]) => buildDaySnapshot(key, value));
}

async function addUsage(target, seconds, options = {}) {
  const endAt = Number(options.endAt || Date.now());
  const startAt = Number(options.startAt || endAt - seconds * 1000);
  const nowIso = new Date(endAt).toISOString();
  const { countTotal = true, iconSource = target, dayKey = getDayKey(new Date(startAt)) } = options;
  const today = ensureDay(dayKey);
  const key = target.key;
  today.apps[key] ??= {
    key,
    name: target.name,
    processName: target.processName,
    exe: target.exe,
    icon: target.icon || null,
    isVideoSite: Boolean(target.isVideoSite),
    isPip: Boolean(target.isPip),
    isDistracting: Boolean(target.isVideoSite || target.isPip),
    subtitle: target.subtitle,
    countTotal,
    intervals: [],
    seconds: 0
  };

  today.apps[key].intervals = addInterval(today.apps[key].intervals || [], startAt, endAt);
  today.apps[key].seconds = today.apps[key].intervals.length
    ? sumIntervals(today.apps[key].intervals)
    : today.apps[key].seconds + seconds;
  today.apps[key].name = target.name;
  today.apps[key].subtitle = target.subtitle;
  today.apps[key].icon = target.icon || today.apps[key].icon;
  today.apps[key].isVideoSite = Boolean(target.isVideoSite);
  today.apps[key].isPip = Boolean(target.isPip);
  today.apps[key].isDistracting = Boolean(getSettings().distractions[key] ?? today.apps[key].isDistracting);
  today.apps[key].countTotal = Boolean(countTotal);
  today.apps[key].lastUsedAt = nowIso;
  today.firstActiveAt ??= new Date(startAt).toISOString();
  today.lastActiveAt = nowIso;
  today.updatedAt = nowIso;

  if (countTotal) {
    today.totalIntervals = addInterval(today.totalIntervals || [], startAt, endAt);
    today.totalActiveSeconds = sumIntervals(today.totalIntervals);
  }

  if (!today.apps[key].icon) {
    today.apps[key].icon = await extractIcon(iconSource);
  }
}

function getAwayTiming(entry) {
  const fallbackStartAt = activeAway?.startAt || Date.now();
  let startedAt = Number(entry?.startAt || fallbackStartAt);
  if (!Number.isFinite(startedAt)) startedAt = Date.now();

  let dayKey = getDayKey(new Date(startedAt));
  if (dayKey !== getDayKey()) {
    const clockOutAt = new Date(usageState[dayKey]?.clockOutAt || '').getTime();
    if (Number.isFinite(clockOutAt)) {
      startedAt = clockOutAt;
      dayKey = getDayKey(new Date(clockOutAt));
    }
  }

  return { startedAt, dayKey };
}

async function addAwayUsage(entry) {
  const { startedAt, dayKey } = getAwayTiming(entry);
  const endedAt = Date.now();
  const seconds = Math.max(1, Math.min(86400, Math.round((endedAt - startedAt) / 1000)));
  const label = String(entry?.label || '\uAE30\uD0C0').trim().slice(0, 40) || '\uAE30\uD0C0';
  const isDistracting = Boolean(entry?.isDistracting);
  const key = `away:${label.toLowerCase()}:${isDistracting ? 'off' : 'work'}`;
  await addUsage(
    {
      key,
      name: `\uC790\uB9AC\uBE44\uC6C0: ${label}`,
      processName: 'away',
      exe: '',
      icon: null,
      isVideoSite: false,
      isPip: false,
      isDistracting,
      subtitle: isDistracting ? '\uB534\uC9D3\uC73C\uB85C \uAE30\uB85D' : '\uC77C\uB85C \uAE30\uB85D'
    },
    seconds,
    { countTotal: true, dayKey, startAt: startedAt, endAt: endedAt }
  );
}

function deleteUsageItem(key) {
  const today = ensureToday();
  let didDelete = false;

  for (const [itemKey, item] of Object.entries(today.apps || {})) {
    const mergedApp = getMergedApp(item);
    const normalizedKey = mergedApp?.key || item.key;
    if (itemKey !== key && item.key !== key && normalizedKey !== key) continue;

    delete today.apps[itemKey];
    didDelete = true;
  }

  if (didDelete) {
    today.totalIntervals = mergeIntervals(
      ...Object.values(today.apps || {})
        .filter((item) => item.countTotal !== false)
        .map((item) => item.intervals || [])
    );
    today.totalActiveSeconds = today.totalIntervals.length
      ? sumIntervals(today.totalIntervals)
      : Object.values(today.apps || {})
        .filter((item) => item.countTotal !== false)
        .reduce((sum, item) => sum + Number(item.seconds || 0), 0);
    today.updatedAt = new Date().toISOString();
    delete getSettings().distractions[key];
    saveState();
  }

  return getSnapshot();
}

async function pollUsage() {
  try {
    await heartbeatSync();
  } catch {
    isActiveRecorder = true;
  }

  const now = Date.now();
  const elapsed = Math.max(0, Math.round((now - lastTick) / 1000));
  lastTick = now;

  const idleSeconds = powerMonitor.getSystemIdleTime();
  const settings = getSettings();
  const today = ensureToday();
  const appInfo = await getForegroundApp();
  const target = appInfo ? getUsageTarget(appInfo) : null;
  currentTargetKey = target?.key || null;
  const isVideoForeground = Boolean(target?.isVideoSite);
  const usesLongIdleLimit = isVideoForeground || isLongIdleApp(appInfo);
  const awayIdleLimitSeconds = usesLongIdleLimit
    ? Math.max(getAwayIdleSeconds(settings), VIDEO_IDLE_LIMIT_SECONDS)
    : getAwayIdleSeconds(settings);
  const isActive =
    target &&
    appInfo.name !== 'Unknown App' &&
    idleSeconds < awayIdleLimitSeconds;
  const canTrack = !settings.paused && isClockOpen(today) && isActiveRecorder;

  if (canTrack && idleSeconds >= awayIdleLimitSeconds && !awayStartAt) {
    awayStartAt = Date.now() - idleSeconds * 1000;
    openAwayPrompt(awayStartAt, 'idle');
  }

  if (awayStartAt && idleSeconds < awayIdleLimitSeconds) {
    awayStartAt = null;
  }

  const targetRecord = target ? today.apps[target.key] : null;
  const isDistractingTarget = Boolean(
    target &&
    (settings.distractions[target.key] ?? targetRecord?.isDistracting ?? target.isVideoSite ?? target.isPip)
  );
  if (canTrack && isActive && settings.focusMode && isDistractingTarget) {
    focusDistractionStartedAt ??= now;
    if (!focusWarningShown && now - focusDistractionStartedAt >= FOCUS_DISTRACTION_LIMIT_SECONDS * 1000) {
      focusWarningShown = true;
      showFocusWarning();
    }
  } else {
    focusDistractionStartedAt = null;
    focusWarningShown = false;
  }

  if (canTrack && elapsed > 0 && elapsed < 30) {
    if (isActive) {
      await addUsage(target, elapsed, { countTotal: true, iconSource: appInfo });
    }

    const pipTargets = (await getBrowserWindows())
      .map(getPipTarget)
      .filter(Boolean);

    for (const pipTarget of pipTargets) {
      await addUsage(pipTarget, elapsed, { countTotal: false, iconSource: pipTarget });
    }

    if (isActive || pipTargets.length > 0) {
      saveState();
      if (syncUser?.id || settings.sync.syncKeyHash) {
        upsertCloudState().catch(() => {});
      }
    }
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('usage:update', getSnapshot());
  }
}

ipcMain.handle('usage:get', () => getSnapshot());
ipcMain.handle('usage:history', () => getHistory());
ipcMain.handle('memo:get', () => getSettings().memo || '');

ipcMain.handle('update:check', async () => checkForUpdate());

ipcMain.handle('update:open', async (_event, url) => {
  const target = String(url || '');
  if (!/^https?:\/\//.test(target)) {
    throw new Error('업데이트 다운로드 주소가 없어요.');
  }
  await shell.openExternal(target);
  return true;
});

ipcMain.handle('update:install', async () => downloadAndInstallUpdate());

ipcMain.handle('sync:status', () => getSyncStatus());

ipcMain.handle('sync:connect-id', async (_event, value) => {
  try {
    const syncId = String(value || '').trim();
    if (syncId.length < 4) throw new Error('동기화 아이디는 4글자 이상이어야 해요.');
    const settings = getSettings();
    settings.sync.session = null;
    settings.sync.email = '';
    settings.sync.syncIdLabel = syncId;
    settings.sync.syncKeyHash = getSyncKeyHash(syncId);
    syncUser = null;
    saveState();
    await syncNow();
    return getSyncStatus();
  } catch (error) {
    throw toSyncError(error);
  }
});

ipcMain.handle('sync:sign-up', async (_event, credentials) => {
  const email = String(credentials?.email || '').trim();
  const password = String(credentials?.password || '');
  const { data, error } = await getSupabase().auth.signUp({ email, password });
  if (error) throw new Error(error.message);
  if (data.session) {
    syncUser = data.user;
    const settings = getSettings();
    settings.sync.session = data.session;
    settings.sync.email = data.user?.email || email;
    saveState();
    await syncNow();
  }
  return getSyncStatus();
});

ipcMain.handle('sync:sign-in', async (_event, credentials) => {
  const email = String(credentials?.email || '').trim();
  const password = String(credentials?.password || '');
  const { data, error } = await getSupabase().auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  syncUser = data.user;
  const settings = getSettings();
  settings.sync.session = data.session;
  settings.sync.email = data.user?.email || email;
  saveState();
  await syncNow();
  return getSyncStatus();
});

ipcMain.handle('sync:logout', async () => {
  await getSupabase().auth.signOut();
  syncUser = null;
  isActiveRecorder = true;
  const settings = getSettings();
  settings.sync.session = null;
  settings.sync.email = '';
  settings.sync.syncIdLabel = '';
  settings.sync.syncKeyHash = '';
  settings.sync.activeDeviceId = null;
  settings.sync.activeSeenAt = null;
  saveState();
  return getSyncStatus();
});

ipcMain.handle('sync:now', async () => {
  try {
    return await syncNow();
  } catch (error) {
    throw toSyncError(error);
  }
});

ipcMain.handle('tracking:toggle', () => {
  const settings = getSettings();
  settings.paused = !settings.paused;
  saveState();
  const snapshot = getSnapshot();
  mainWindow?.webContents.send('usage:update', snapshot);
  return snapshot;
});

ipcMain.handle('focus:toggle', () => {
  const settings = getSettings();
  settings.focusMode = !settings.focusMode;
  focusDistractionStartedAt = null;
  focusWarningShown = false;
  saveState();
  const snapshot = getSnapshot();
  mainWindow?.webContents.send('usage:update', snapshot);
  return snapshot;
});

ipcMain.handle('clock:toggle', () => {
  const today = ensureToday();
  const now = new Date().toISOString();

  if (!today.clockInAt) {
    today.clockInAt = now;
    today.clockOutAt = null;
  } else if (!today.clockOutAt) {
    today.clockOutAt = now;
    if (activeAway) {
      openAwayPrompt(new Date(today.clockOutAt).getTime(), activeAway.reason || 'clock-out');
    }
  } else {
    openAwayPrompt(new Date(today.clockOutAt).getTime(), 'clock-undo');
    today.clockOutAt = null;
  }

  today.updatedAt = now;
  saveState();
  const snapshot = getSnapshot();
  mainWindow?.webContents.send('usage:update', snapshot);
  return snapshot;
});

ipcMain.handle('app:set-distraction', (_event, key, isDistracting) => {
  const settings = getSettings();
  settings.distractions[key] = Boolean(isDistracting);
  const today = ensureToday();
  if (today.apps[key]) {
    today.apps[key].isDistracting = Boolean(isDistracting);
  }
  saveState();
  const snapshot = getSnapshot();
  mainWindow?.webContents.send('usage:update', snapshot);
  return snapshot;
});

ipcMain.handle('app:delete', (_event, key) => {
  const snapshot = deleteUsageItem(String(key || ''));
  mainWindow?.webContents.send('usage:update', snapshot);
  return snapshot;
});

ipcMain.handle('app:set-sort-mode', (_event, sortMode) => {
  const settings = getSettings();
  settings.sortMode = sortMode === 'recent' ? 'recent' : 'usage';
  saveState();
  const snapshot = getSnapshot();
  mainWindow?.webContents.send('usage:update', snapshot);
  return snapshot;
});

ipcMain.handle('time:toggle-seconds', () => {
  const settings = getSettings();
  settings.showSeconds = !settings.showSeconds;
  saveState();
  const snapshot = getSnapshot();
  mainWindow?.webContents.send('usage:update', snapshot);
  return snapshot;
});

ipcMain.handle('time:set-day-start', (_event, value) => {
  const settings = getSettings();
  settings.dayStartMinutes = timeValueToMinutes(value);
  saveState();
  registerDailyLaunchTask();
  const snapshot = getSnapshot();
  mainWindow?.webContents.send('usage:update', snapshot);
  return snapshot;
});

ipcMain.handle('time:set-away-idle', (_event, value) => {
  const settings = getSettings();
  settings.awayIdleMinutes = normalizeAwayIdleMinutes(value);
  saveState();
  const snapshot = getSnapshot();
  mainWindow?.webContents.send('usage:update', snapshot);
  return snapshot;
});

ipcMain.handle('away:start', () => {
  const away = openAwayPrompt(Date.now(), 'manual');
  return { snapshot: getSnapshot(), away };
});

ipcMain.handle('away:record', async (_event, entry) => {
  await addAwayUsage(entry);
  activeAway = null;
  awayStartAt = null;
  saveState();
  const snapshot = getSnapshot();
  mainWindow?.webContents.send('usage:update', snapshot);
  return snapshot;
});

ipcMain.handle('away:cancel', () => {
  activeAway = null;
  awayStartAt = null;
  return getSnapshot();
});

ipcMain.handle('memo:set', (_event, text) => {
  const settings = getSettings();
  settings.memo = String(text || '');
  saveState();
  return settings.memo;
});

ipcMain.handle('window:set-opacity', (_event, value) => {
  const opacity = Math.min(1, Math.max(0.35, Number(value)));
  mainWindow?.setOpacity(opacity);
  return opacity;
});

ipcMain.handle('window:set-size', (_event, size) => {
  if (!SIZE_PRESETS[size]) return currentSize;
  currentSize = size;
  mainWindow?.setSize(SIZE_PRESETS[size].width, SIZE_PRESETS[size].height, true);
  return currentSize;
});

ipcMain.handle('window:minimize', () => mainWindow?.minimize());
ipcMain.handle('window:close', () => mainWindow?.close());

app.on('second-instance', (_event, commandLine) => {
  if (commandLine.includes('--scheduled-start')) return;
  showMainWindow();
});

app.whenReady().then(() => {
  app.setName('DayGlass Usage');
  app.setAppUserModelId('dayglass.usage');
  loadState();
  registerAutoLaunch();
  registerDailyLaunchTask();
  createWindow();
  createTray();
  restoreSupabaseSession().then(() => syncNow()).catch(() => {});
  pollUsage();
  setInterval(pollUsage, POLL_MS);
});

app.on('window-all-closed', () => {
  if (process.platform === 'darwin') return;
  if (!tray) app.quit();
});
