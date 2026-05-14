const durationLabel = document.querySelector('#awayDuration');
const labelInput = document.querySelector('#awayLabelInput');
const workBtn = document.querySelector('#awayWorkBtn');
const offBtn = document.querySelector('#awayOffBtn');
const closeBtn = document.querySelector('#awayCloseBtn');
const cancelBtn = document.querySelector('#awayCancelBtn');
const saveBtn = document.querySelector('#awaySaveBtn');

let startAt = Date.now();
let kind = 'work';

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function renderDuration() {
  durationLabel.textContent = formatDuration(Date.now() - startAt);
}

function setKind(nextKind) {
  kind = nextKind === 'off' ? 'off' : 'work';
  workBtn.classList.toggle('active', kind === 'work');
  offBtn.classList.toggle('active', kind === 'off');
}

function cancel() {
  window.dayglass.cancelAway();
}

window.dayglass.onAwayPrompt((away) => {
  startAt = Number(away?.startAt || Date.now());
  labelInput.value = '기타';
  setKind('work');
  renderDuration();
  setTimeout(() => labelInput.focus(), 30);
});

workBtn.addEventListener('click', () => setKind('work'));
offBtn.addEventListener('click', () => setKind('off'));
closeBtn.addEventListener('click', cancel);
cancelBtn.addEventListener('click', cancel);
saveBtn.addEventListener('click', () => {
  window.dayglass.recordAway({
    startAt,
    label: labelInput.value.trim() || '기타',
    isDistracting: kind === 'off'
  });
});

setInterval(renderDuration, 1000);
renderDuration();
