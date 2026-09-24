const STORAGE_KEY = 'solitaire-save';
const SAVE_VERSION = 1;

function countCards(state) {
  const foundationCount = state.foundations.reduce((sum, pile) => sum + pile.length, 0);
  const tableauCount = state.tableau.reduce((sum, pile) => sum + pile.length, 0);
  return state.stock.length + state.waste.length + foundationCount + tableauCount;
}

function resolvePlayTimeMs(saved) {
  if (Number.isFinite(saved.playTimeMs)) return Math.max(0, saved.playTimeMs);
  if (saved.startTime && saved.savedAt) {
    return Math.max(0, saved.savedAt - saved.startTime);
  }
  return 0;
}

export function serializeGame(game) {
  return JSON.parse(JSON.stringify({
    version: SAVE_VERSION,
    savedAt: Date.now(),
    stock: game.stock,
    waste: game.waste,
    foundations: game.foundations,
    tableau: game.tableau,
    moves: game.moves,
    won: game.won,
    score: game.score,
    vegasCumulativeBase: game.vegasCumulativeBase ?? 0,
    cumulativeVegas: game.cumulativeVegas ?? false,
    dealDifficulty: game.dealDifficulty ?? 'normal',
    history: game.history,
    playTimeMs: game.getPlayTimeMs(),
    vegasMode: game.vegasMode,
  }));
}

export function hasResumableSave(data) {
  if (!data || data.version !== SAVE_VERSION) return false;
  if (data.won) return false;
  if (!Array.isArray(data.tableau) || data.tableau.length !== 7) return false;
  if (countCards(data) !== 52) return false;
  return true;
}

export function loadSavedGame() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return hasResumableSave(data) ? data : null;
  } catch {
    return null;
  }
}

export function saveGame(game) {
  if (game.won) {
    clearSavedGame();
    return;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeGame(game)));
  } catch {
    // 容量超過・保存禁止でもゲームの進行を止めない
  }
}

export function clearSavedGame() {
  localStorage.removeItem(STORAGE_KEY);
}

export function applySavedGame(game, saved) {
  game.restore(saved);
  game.history = JSON.parse(JSON.stringify(saved.history ?? []));
  game.playTimeMs = resolvePlayTimeMs(saved);
  game.playTimeAnchor = null;
  game.vegasMode = saved.vegasMode ?? false;
  game.cumulativeVegas = saved.cumulativeVegas ?? false;
  game.dealDifficulty = saved.dealDifficulty ?? 'normal';
  if (saved.vegasCumulativeBase != null && Number.isFinite(saved.vegasCumulativeBase)) {
    game.vegasCumulativeBase = saved.vegasCumulativeBase;
  }
}

export function getSavedGameSummary(saved) {
  return {
    moves: saved.moves ?? 0,
    elapsed: Math.floor(resolvePlayTimeMs(saved) / 1000),
  };
}
