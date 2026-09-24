const STORAGE_KEY = 'solitaire-settings';
const VEGAS_SCORE_KEY = 'solitaire-vegas-score';

export const DEAL_DIFFICULTY_OPTIONS = [
  { value: 'easy', label: 'やさしい' },
  { value: 'normal', label: '通常' },
  { value: 'hard', label: '難しい' },
  { value: 'veryHard', label: 'とても難しい' },
];

const VALID_DEAL_DIFFICULTIES = new Set(DEAL_DIFFICULTY_OPTIONS.map((o) => o.value));

const LEGACY_DEAL_DIFFICULTY = {
  random: 'veryHard',
};

export const DEFAULT_SETTINGS = {
  soundEnabled: true,
  vegasMode: false,
  cumulativeVegas: false,
  dealDifficulty: 'normal',
  easyMove: false,
};

export const SETTING_HELP = {
  sound: {
    title: 'サウンド',
    body: 'カードの移動やめくりなど、ゲーム中の効果音をオン・オフします。',
  },
  vegas: {
    title: 'ベガスモード',
    body: '山札は1回のみめくれます。組札にカードを置くと+$5、組札からカードを戻すと-$5、1ゲームの開始時に-$52されます。変更は次のゲームから反映されます。',
  },
  cumulativeVegas: {
    title: '累計ベガスモード',
    body: 'ベガスモードのスコアをゲームをまたいで累計します。設定画面から累計スコアをリセットできます。ゲームモードを変更しても累計スコアは保持されます。変更は次のゲームから反映されます。',
  },
  dealDifficulty: {
    title: '配札の難易度',
    body: '新しいゲーム開始時の配札を選びます。やさしい・通常・難しいはシミュレーションで見積もった1ゲームのベガス点数（開始時-$52、組札へ+$5）に近い配札を選びます。とても難しいは完全なランダム配札です。ベガス・ノーマルどちらのモードにも適用されます。変更は次のゲームから反映されます。',
  },
  easyMove: {
    title: '簡単移動',
    body: '移動可能なカードをタップするだけで、自動的に移動先へ送ります。場札をタップすると、その場所へ置けるカードを自動で探して移動します。',
  },
};

export function normalizeDealDifficulty(value) {
  if (VALID_DEAL_DIFFICULTIES.has(value)) return value;
  if (value in LEGACY_DEAL_DIFFICULTY) return LEGACY_DEAL_DIFFICULTY[value];
  return DEFAULT_SETTINGS.dealDifficulty;
}

export function getDealDifficultyIndex(value) {
  const index = DEAL_DIFFICULTY_OPTIONS.findIndex(
    (option) => option.value === normalizeDealDifficulty(value),
  );
  return index >= 0 ? index : 1;
}

export function getDealDifficultyValue(index) {
  const option = DEAL_DIFFICULTY_OPTIONS[Number(index)];
  return option?.value ?? DEFAULT_SETTINGS.dealDifficulty;
}

export function getDealDifficultyLabel(value) {
  const option = DEAL_DIFFICULTY_OPTIONS.find(
    (item) => item.value === normalizeDealDifficulty(value),
  );
  return option?.label ?? DEAL_DIFFICULTY_OPTIONS[1].label;
}

export function getActiveGameMode(game) {
  return {
    vegasMode: Boolean(game?.vegasMode),
    cumulativeVegas: Boolean(game?.cumulativeVegas),
    dealDifficulty: normalizeDealDifficulty(game?.dealDifficulty),
  };
}

export function hasPendingGameModeChange(settings, game, { gameStarted = false } = {}) {
  if (!gameStarted || !game) return false;
  const active = getActiveGameMode(game);
  return (
    settings.vegasMode !== active.vegasMode
    || settings.cumulativeVegas !== active.cumulativeVegas
    || normalizeDealDifficulty(settings.dealDifficulty) !== active.dealDifficulty
  );
}

export const PENDING_GAME_MODE_NOTICE = 'ゲームモードの変更は、次のゲームから適用されます。';

export function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    parsed.dealDifficulty = normalizeDealDifficulty(parsed.dealDifficulty);
    return parsed;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function loadVegasScore() {
  try {
    const raw = localStorage.getItem(VEGAS_SCORE_KEY);
    if (raw == null) return 0;
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

export function saveVegasScore(score) {
  localStorage.setItem(VEGAS_SCORE_KEY, String(score));
}

export function getDealDifficultyThumbPercent(index, maxIndex = DEAL_DIFFICULTY_OPTIONS.length - 1) {
  if (maxIndex <= 0) return 50;
  const clamped = Math.max(0, Math.min(maxIndex, Number(index)));
  return ((clamped + 0.5) / (maxIndex + 1)) * 100;
}

export function getDealDifficultyIndexFromRatio(ratio, maxIndex = DEAL_DIFFICULTY_OPTIONS.length - 1) {
  if (maxIndex <= 0) return 0;
  const clampedRatio = Math.max(0, Math.min(1, ratio));
  return Math.max(0, Math.min(maxIndex, Math.floor(clampedRatio * (maxIndex + 1))));
}

export function createDealDifficultyControl(root, { onInput, onChange } = {}) {
  if (!root) return null;

  const track = root.querySelector('.setting-difficulty-track');
  const thumb = root.querySelector('.setting-difficulty-thumb');
  const fill = root.querySelector('.setting-difficulty-fill');
  const ticks = [...root.querySelectorAll('.setting-difficulty-tick')];
  if (!track || !thumb || !fill) return null;

  const maxIndex = DEAL_DIFFICULTY_OPTIONS.length - 1;
  let index = 1;
  let dragging = false;

  const updateVisual = (nextIndex) => {
    const pct = getDealDifficultyThumbPercent(nextIndex, maxIndex);
    thumb.style.left = `${pct}%`;
    fill.style.width = `${pct}%`;
    root.setAttribute('aria-valuenow', String(nextIndex));
    root.setAttribute(
      'aria-valuetext',
      getDealDifficultyLabel(getDealDifficultyValue(nextIndex)),
    );
    ticks.forEach((tick, tickIndex) => {
      tick.classList.toggle('is-active', tickIndex === nextIndex);
    });
  };

  const setIndex = (nextIndex, { save = false } = {}) => {
    const clamped = Math.max(0, Math.min(maxIndex, Number(nextIndex)));
    index = clamped;
    updateVisual(index);
    onInput?.(index);
    if (save) onChange?.(index);
    return index;
  };

  const indexFromClientX = (clientX) => {
    const rect = track.getBoundingClientRect();
    if (rect.width <= 0) return index;
    const ratio = (clientX - rect.left) / rect.width;
    return getDealDifficultyIndexFromRatio(ratio, maxIndex);
  };

  track.addEventListener('pointerdown', (event) => {
    dragging = true;
    track.setPointerCapture(event.pointerId);
    setIndex(indexFromClientX(event.clientX));
  });

  track.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    setIndex(indexFromClientX(event.clientX));
  });

  const finishDrag = (event) => {
    if (!dragging) return;
    dragging = false;
    if (track.hasPointerCapture(event.pointerId)) {
      track.releasePointerCapture(event.pointerId);
    }
    setIndex(indexFromClientX(event.clientX), { save: true });
  };

  track.addEventListener('pointerup', finishDrag);
  track.addEventListener('pointercancel', (event) => {
    if (!dragging) return;
    dragging = false;
    if (track.hasPointerCapture(event.pointerId)) {
      track.releasePointerCapture(event.pointerId);
    }
    onChange?.(index);
  });

  ticks.forEach((tick) => {
    tick.addEventListener('click', () => {
      setIndex(tick.dataset.index, { save: true });
    });
  });

  root.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      event.preventDefault();
      setIndex(index - 1, { save: true });
    }
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      event.preventDefault();
      setIndex(index + 1, { save: true });
    }
  });

  return {
    getIndex: () => index,
    getValue: () => getDealDifficultyValue(index),
    setValue(value) {
      setIndex(getDealDifficultyIndex(value));
    },
  };
}
