import { SoundFX } from './sounds.js';
import { saveClearRecord, getTopRankings, formatClearMode, resolveClearMode, resetRankings } from './ranking.js';
import { loadStats, recordGamePlayed, recordGameCleared, formatClearRate, getModeClearRate, getVegasModeStats, resetStats } from './stats.js';
import {
  loadSavedGame,
  saveGame,
  clearSavedGame,
  applySavedGame,
  getSavedGameSummary,
} from './save.js';
import {
  createDealDifficultyControl,
  loadSettings,
  saveSettings,
  loadVegasScore,
  saveVegasScore,
  SETTING_HELP,
  getDealDifficultyValue,
  getDealDifficultyLabel,
  getActiveGameMode,
  hasPendingGameModeChange,
  PENDING_GAME_MODE_NOTICE,
} from './settings.js';
import { APP_VERSION, CHANGELOG, formatChangelogDate } from './changelog.js';
import { initAppUpdate } from './app-update.js';
import { getInstallHelp, shouldShowInstallLink } from './pwa-install.js';
import { selectDealLayout, selectDealLayoutAsync } from './deal-quality.js';
import {
  SUITS,
  cardColor,
  canPlaceOnTableau,
  canPlaceOnFoundation,
  parsePileId,
  pileIdFromInfo,
} from './rules.js';

const SUIT_SYMBOL = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' };

class SolitaireGame {
  constructor() {
    this.clearState();
  }

  clearState() {
    this.stock = [];
    this.waste = [];
    this.foundations = [[], [], [], []];
    this.tableau = [[], [], [], [], [], [], []];
    this.moves = 0;
    this.history = [];
    this.playTimeMs = 0;
    this.playTimeAnchor = null;
    this.won = false;
    this.lastFlip = false;
    this.vegasMode = false;
    this.cumulativeVegas = false;
    this.dealDifficulty = 'normal';
    this.score = 0;
    this.vegasCumulativeBase = 0;
  }

  reset(options = {}) {
    this.clearState();
    this.vegasMode = options.vegasMode ?? false;
    this.cumulativeVegas = options.cumulativeVegas ?? false;
    this.dealDifficulty = options.dealDifficulty ?? 'normal';
    this.score = 0;
    this.deal(options);
  }

  async resetAsync(options = {}) {
    this.clearState();
    this.vegasMode = options.vegasMode ?? false;
    this.cumulativeVegas = options.cumulativeVegas ?? false;
    this.dealDifficulty = options.dealDifficulty ?? 'normal';
    this.score = 0;
    await this.dealAsync(options);
  }

  beginVegasRound(options = {}) {
    if (!this.vegasMode) {
      this.score = 0;
      return;
    }
    const prev = options.cumulativeVegas ? (options.storedVegasScore ?? 0) : 0;
    this.vegasCumulativeBase = prev;
    this.score = prev - 52;
  }

  deal(options = {}) {
    const layout = selectDealLayout({
      vegasMode: options.vegasMode ?? this.vegasMode,
      dealDifficulty: options.dealDifficulty ?? this.dealDifficulty,
    });
    this.applyDealLayout(layout);
  }

  async dealAsync(options = {}) {
    const layout = await selectDealLayoutAsync({
      vegasMode: options.vegasMode ?? this.vegasMode,
      dealDifficulty: options.dealDifficulty ?? this.dealDifficulty,
    });
    this.applyDealLayout(layout);
  }

  applyDealLayout(layout) {
    this.tableau = layout.tableau.map((pile) => pile.map((c) => ({ ...c })));
    this.stock = layout.stock.map((c) => ({ ...c }));
    this.waste = [];
    this.foundations = [[], [], [], []];
  }

  snapshot() {
    return {
      stock: this.stock.map((c) => ({ ...c })),
      waste: this.waste.map((c) => ({ ...c })),
      foundations: this.foundations.map((p) => p.map((c) => ({ ...c }))),
      tableau: this.tableau.map((p) => p.map((c) => ({ ...c }))),
      moves: this.moves,
      won: this.won,
      score: this.score,
    };
  }

  restore(snap) {
    this.stock = snap.stock;
    this.waste = snap.waste;
    this.foundations = snap.foundations;
    this.tableau = snap.tableau;
    this.moves = snap.moves;
    this.won = snap.won;
    this.score = snap.score ?? 0;
  }

  pushHistory() {
    this.history.push(this.snapshot());
    if (this.history.length > 100) this.history.shift();
  }

  undo() {
    if (!this.history.length) return false;
    const snap = this.history.pop();
    this.restore(snap);
    return true;
  }

  drawFromStock() {
    this.pushHistory();
    this.lastFlip = false;
    if (this.stock.length === 0) {
      if (this.waste.length === 0) {
        this.history.pop();
        return false;
      }
      if (this.vegasMode) {
        this.history.pop();
        return false;
      }
      this.stock = this.waste.reverse().map((c) => ({ ...c, faceUp: false }));
      this.waste = [];
    } else {
      const card = this.stock.pop();
      card.faceUp = true;
      this.waste.push(card);
      this.lastFlip = true;
    }
    this.moves++;
    return true;
  }

  getPile(pileInfo) {
    switch (pileInfo.type) {
      case 'stock': return this.stock;
      case 'waste': return this.waste;
      case 'foundation': return this.foundations[pileInfo.index];
      case 'tableau': return this.tableau[pileInfo.index];
      default: return [];
    }
  }

  getMovableStack(pileInfo, cardIndex) {
    const pile = this.getPile(pileInfo);
    if (!pile.length) return null;

    if (pileInfo.type === 'waste') {
      if (cardIndex !== pile.length - 1) return null;
      return [pile[pile.length - 1]];
    }

    if (pileInfo.type === 'foundation') {
      if (cardIndex !== pile.length - 1) return null;
      return [pile[pile.length - 1]];
    }

    if (pileInfo.type === 'tableau') {
      const card = pile[cardIndex];
      if (!card?.faceUp) return null;
      const stack = pile.slice(cardIndex);
      for (let i = 1; i < stack.length; i++) {
        const prev = stack[i - 1];
        const curr = stack[i];
        if (!canPlaceOnTableau(curr, prev)) return null;
      }
      return stack;
    }

    return null;
  }

  canMove(stack, destInfo) {
    if (!stack?.length) return false;
    const card = stack[0];
    const dest = this.getPile(destInfo);

    if (destInfo.type === 'foundation') {
      if (stack.length > 1) return false;
      return canPlaceOnFoundation(card, dest, destInfo.index);
    }

    if (destInfo.type === 'tableau') {
      const top = dest[dest.length - 1] ?? null;
      return canPlaceOnTableau(card, top);
    }

    return false;
  }

  moveCards(fromInfo, cardIndex, toInfo) {
    const stack = this.getMovableStack(fromInfo, cardIndex);
    if (!stack || !this.canMove(stack, toInfo)) return false;

    this.pushHistory();
    const from = this.getPile(fromInfo);
    const to = this.getPile(toInfo);

    from.splice(cardIndex, stack.length);
    to.push(...stack);

    this.lastFlip = false;
    if (fromInfo.type === 'tableau' && from.length) {
      const last = from[from.length - 1];
      if (!last.faceUp) {
        last.faceUp = true;
        this.lastFlip = true;
      }
    }

    this.moves++;
    this.applyVegasScoring(fromInfo, toInfo, stack);
    this.checkWin();
    return true;
  }

  applyVegasScoring(fromInfo, toInfo, stack) {
    if (!this.vegasMode) return;
    if (toInfo.type === 'foundation') {
      this.score += 5 * stack.length;
    }
  }

  findEasyMoveDestination(fromInfo, cardIndex) {
    const stack = this.getMovableStack(fromInfo, cardIndex);
    if (!stack) return null;

    for (let i = 0; i < 4; i++) {
      const dest = { type: 'foundation', index: i };
      if (this.canMove(stack, dest)) return dest;
    }

    let bestTableau = null;
    let bestScore = -Infinity;
    for (let i = 0; i < 7; i++) {
      if (fromInfo.type === 'tableau' && fromInfo.index === i) continue;
      const dest = { type: 'tableau', index: i };
      if (!this.canMove(stack, dest)) continue;
      const score = this.scoreTableauEasyMove(fromInfo, cardIndex, stack, dest);
      if (score > bestScore) {
        bestScore = score;
        bestTableau = dest;
      }
    }

    return bestTableau;
  }

  scoreTableauEasyMove(fromInfo, cardIndex, stack, dest) {
    const destPile = this.getPile(dest);
    let score = 0;

    if (!destPile.length && stack[0].value === 13) score += 100;
    if (fromInfo.type === 'waste') score += 30;
    if (fromInfo.type === 'tableau') {
      const fromPile = this.getPile(fromInfo);
      const below = fromPile[cardIndex - 1];
      if (below && !below.faceUp) score += 80;
    }

    return score - dest.index;
  }

  findEasyMoveSourceToDest(destInfo) {
    if (destInfo.type !== 'tableau' && destInfo.type !== 'foundation') return null;

    if (this.waste.length) {
      const index = this.waste.length - 1;
      const from = { type: 'waste' };
      const stack = this.getMovableStack(from, index);
      if (stack && this.canMove(stack, destInfo)) {
        return { from, index };
      }
    }

    for (let col = 0; col < 7; col++) {
      const pile = this.tableau[col];
      if (!pile.length) continue;
      const from = { type: 'tableau', index: col };
      for (let index = pile.length - 1; index >= 0; index--) {
        if (!pile[index].faceUp) break;
        const stack = this.getMovableStack(from, index);
        if (stack && this.canMove(stack, destInfo)) {
          return { from, index };
        }
      }
    }

    return null;
  }

  autoMoveToFoundation(fromInfo, cardIndex) {
    const stack = this.getMovableStack(fromInfo, cardIndex);
    if (!stack || stack.length !== 1) return false;

    for (let i = 0; i < 4; i++) {
      const dest = { type: 'foundation', index: i };
      if (this.canMove(stack, dest)) {
        return this.moveCards(fromInfo, cardIndex, dest);
      }
    }
    return false;
  }

  findNextFoundationMove() {
    if (this.waste.length) {
      const stack = this.getMovableStack({ type: 'waste' }, this.waste.length - 1);
      if (stack?.length === 1) {
        for (let i = 0; i < 4; i++) {
          const dest = { type: 'foundation', index: i };
          if (this.canMove(stack, dest)) {
            return {
              from: { type: 'waste' },
              index: this.waste.length - 1,
              to: dest,
            };
          }
        }
      }
    }

    for (let col = 0; col < 7; col++) {
      const pile = this.tableau[col];
      if (!pile.length) continue;
      const index = pile.length - 1;
      const stack = this.getMovableStack({ type: 'tableau', index: col }, index);
      if (stack?.length !== 1) continue;
      for (let i = 0; i < 4; i++) {
        const dest = { type: 'foundation', index: i };
        if (this.canMove(stack, dest)) {
          return {
            from: { type: 'tableau', index: col },
            index,
            to: dest,
          };
        }
      }
    }

    return null;
  }

  canAutoComplete() {
    if (this.won || this.stock.length > 0) return false;
    for (const col of this.tableau) {
      for (const card of col) {
        if (!card.faceUp) return false;
      }
    }
    return this.findNextFoundationMove() !== null;
  }

  autoCompleteStep() {
    const move = this.findNextFoundationMove();
    if (!move) return false;
    return this.moveCards(move.from, move.index, move.to);
  }

  checkWin() {
    this.won = this.foundations.every((f) => f.length === 13);
  }

  getPlayTimeMs() {
    return this.playTimeMs + (this.playTimeAnchor != null ? Date.now() - this.playTimeAnchor : 0);
  }

  pausePlayTime() {
    if (this.playTimeAnchor != null) {
      this.playTimeMs += Date.now() - this.playTimeAnchor;
      this.playTimeAnchor = null;
    }
  }

  resumePlayTime() {
    if (this.playTimeAnchor == null && !this.won) {
      this.playTimeAnchor = Date.now();
    }
  }

  elapsedSeconds() {
    return Math.floor(this.getPlayTimeMs() / 1000);
  }
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatClearDate(timestamp) {
  return new Date(timestamp).toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatVegasScore(score) {
  if (score >= 0) return `$${score}`;
  return `-$${Math.abs(score)}`;
}

function getTableauStackOffset() {
  const style = getComputedStyle(document.documentElement);
  return parseFloat(style.getPropertyValue('--card-offset')) || 14;
}

const STOCK_DRAW_DURATION = 340;
const STOCK_DRAW_EASING = 'cubic-bezier(0.33, 1, 0.68, 1)';

function getWasteFanStep() {
  const step = getComputedStyle(document.documentElement).getPropertyValue('--waste-fan-step').trim();
  const parsed = parseFloat(step);
  return Number.isFinite(parsed) ? parsed : 25;
}

function wasteFanTransform(fanIndex, step) {
  return `translateX(calc(-50% + ${(fanIndex - 2) * step}px))`;
}

function computeTableauTops(cards, offset) {
  const tops = [0];
  for (let i = 1; i < cards.length; i++) {
    tops[i] = tops[i - 1] + offset;
  }
  return tops;
}

function formatAvgMoves(clears, totalMoves) {
  if (!clears) return '—';
  return `${Math.round(totalMoves / clears)} 手`;
}

function formatAvgTime(clears, totalSeconds) {
  if (!clears) return '—';
  return formatTime(Math.round(totalSeconds / clears));
}

function fitLayout() {
  const root = document.documentElement;
  const board = document.querySelector('.board');
  const header = document.querySelector('.header');
  const bottomNav = document.querySelector('.bottom-nav');
  const autoCompleteBar = document.getElementById('auto-complete-bar');
  const dealPreparingBar = document.getElementById('deal-preparing-bar');
  const topRow = document.querySelector('.top-row');
  if (!board || !header) return false;

  const viewport = window.visualViewport;
  const viewportWidth = viewport?.width ?? window.innerWidth;
  const viewportHeight = viewport?.height ?? window.innerHeight;
  const isDesktop = viewportWidth >= 480;
  const cols = 7;

  const boardStyle = getComputedStyle(board);
  const boardHorizontalPadding =
    parseFloat(boardStyle.paddingLeft) + parseFloat(boardStyle.paddingRight);
  const boardWidth = Math.max(0, board.getBoundingClientRect().width - boardHorizontalPadding);
  const gap = isDesktop
    ? Math.min(8, Math.max(4, boardWidth * 0.012))
    : Math.min(4, Math.max(2, boardWidth * 0.008));
  const cardWidth = Math.max(32, Math.floor((boardWidth - gap * (cols - 1)) / cols));
  const cardHeight = Math.round(cardWidth * 1.42);

  const safeTop = parseFloat(getComputedStyle(root).getPropertyValue('--safe-top')) || 0;
  const headerHeight = header.getBoundingClientRect().height;
  const bottomNavHeight = bottomNav ? bottomNav.getBoundingClientRect().height : 0;
  const autoCompleteBarHeight =
    autoCompleteBar && !autoCompleteBar.classList.contains('hidden')
      ? autoCompleteBar.getBoundingClientRect().height
      : 0;
  const dealPreparingBarHeight =
    dealPreparingBar && !dealPreparingBar.classList.contains('hidden')
      ? dealPreparingBar.getBoundingClientRect().height
      : 0;
  const topRowHeight = topRow ? topRow.getBoundingClientRect().height : cardHeight + 6;
  const boardPad = parseFloat(boardStyle.paddingTop) + parseFloat(boardStyle.paddingBottom);
  const tableauAvailable =
    viewportHeight -
    headerHeight -
    bottomNavHeight -
    autoCompleteBarHeight -
    dealPreparingBarHeight -
    topRowHeight -
    safeTop -
    boardPad -
    4;

  const maxCardsInColumn = isDesktop ? 13 : 10;
  const remaining = Math.max(0, tableauAvailable - cardHeight);
  const targetRatio = isDesktop ? 0.22 : 0.19;
  let stackOffset = cardHeight * targetRatio;
  stackOffset = Math.max(isDesktop ? 7 : 5, Math.min(stackOffset, cardHeight * 0.28));
  stackOffset = Math.round(stackOffset * 1.5);
  const maxForViewport = remaining / Math.max(1, maxCardsInColumn - 1);
  if (maxForViewport > 0) stackOffset = Math.min(stackOffset, maxForViewport);

  const tableauMinHeight = cardHeight + (maxCardsInColumn - 1) * stackOffset;

  root.style.setProperty('--pile-gap', `${Math.round(gap)}px`);
  root.style.setProperty('--card-width', `${cardWidth}px`);
  root.style.setProperty('--card-height', `${cardHeight}px`);
  root.style.setProperty('--card-offset', `${Math.round(stackOffset)}px`);
  root.style.setProperty('--card-offset-face-up', `${Math.round(stackOffset)}px`);
  root.style.setProperty('--card-offset-face-down', `${Math.round(stackOffset)}px`);
  root.style.setProperty('--card-radius', `${Math.max(3, Math.round(cardWidth * 0.08))}px`);
  root.style.setProperty('--tableau-min-height', `${Math.ceil(tableauMinHeight)}px`);
  document.body.classList.toggle('is-mobile', !isDesktop);
  return true;
}

let layoutFrame = 0;
function scheduleLayoutFit(onDone) {
  cancelAnimationFrame(layoutFrame);
  layoutFrame = requestAnimationFrame(() => {
    fitLayout();
    onDone?.();
  });
}

function createCardEl(card, pileId, index, options = {}) {
  const el = document.createElement('div');
  el.className = `card ${card.faceUp ? 'face-up' : 'face-down'} ${cardColor(card)}`;
  el.dataset.pile = pileId;
  el.dataset.index = String(index);
  el.dataset.suit = card.suit;
  el.dataset.rank = card.rank;

  if (!card.faceUp && options.faceDownLayer != null && options.faceDownLayer % 2 === 1) {
    el.classList.add('face-down-alt');
  }

  if (card.faceUp) {
    const rankEl = document.createElement('span');
    rankEl.className = 'rank';
    rankEl.textContent = card.rank;

    const suitCorner = document.createElement('span');
    suitCorner.className = 'suit-corner';
    suitCorner.textContent = SUIT_SYMBOL[card.suit];

    const suitCenter = document.createElement('span');
    suitCenter.className = 'suit-center';
    suitCenter.textContent = SUIT_SYMBOL[card.suit];
    suitCenter.setAttribute('aria-hidden', 'true');

    el.append(rankEl, suitCorner, suitCenter);
  }

  return el;
}

function buildDealSteps(tableau) {
  const steps = [];
  for (let row = 0; row < 7; row++) {
    for (let col = row; col < 7; col++) {
      steps.push({
        col,
        row,
        card: tableau[col][row],
        faceUp: row === col,
      });
    }
  }
  return steps;
}

function yieldToMain() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
}

function bindClick(element, listener) {
  element?.addEventListener('click', listener);
}

function bindChange(element, listener) {
  element?.addEventListener('change', listener);
}

class SolitaireUI {
  constructor() {
    this.game = new SolitaireGame();
    this.selected = null;
    this.drag = null;
    this.timerId = null;
    this.ignoreClickUntil = 0;
    this.lastTap = null;
    this.animatingStock = false;
    this.animatingDeal = false;
    this.animatingMove = false;
    this.gameStarted = false;
    this.autoCompleting = false;
    this.winRecorded = false;
    this.rankingSort = 'time';

    this.btnRecords = document.getElementById('btn-records');
    this.btnHome = document.getElementById('btn-home');
    this.btnNew = document.getElementById('btn-new');
    this.btnUndo = document.getElementById('btn-undo');
    this.btnRanking = document.getElementById('btn-ranking');
    this.btnSettings = document.getElementById('btn-settings');
    this.btnPlayAgain = document.getElementById('btn-play-again');
    this.btnResume = document.getElementById('btn-resume');
    this.btnStartNew = document.getElementById('btn-start-new');
    this.startResumeLoading = document.getElementById('start-resume-loading');
    this.startResumeHint = document.getElementById('start-resume-hint');
    this.btnStartRecords = document.getElementById('btn-start-records');
    this.btnStartRanking = document.getElementById('btn-start-ranking');
    this.btnStartSettings = document.getElementById('btn-start-settings');
    this.startVersion = document.getElementById('start-version');
    if (this.startVersion) {
      this.startVersion.textContent = `v${APP_VERSION}`;
    }
    this.startInstallLink = document.getElementById('start-install-link');
    this.btnAutoComplete = document.getElementById('btn-auto-complete');
    this.autoCompleteBar = document.getElementById('auto-complete-bar');
    this.dealPreparingBar = document.getElementById('deal-preparing-bar');
    this.btnRankingClose = document.getElementById('btn-ranking-close');
    this.btnRecordsClose = document.getElementById('btn-records-close');
    this.btnRecordsReset = document.getElementById('btn-records-reset');
    this.btnSettingsClose = document.getElementById('btn-settings-close');
    this.btnSettingHelpClose = document.getElementById('btn-setting-help-close');
    this.btnChangelogClose = document.getElementById('btn-changelog-close');
    this.statMoves = document.getElementById('stat-moves');
    this.statTime = document.getElementById('stat-time');
    this.winOverlay = document.getElementById('win-overlay');
    this.newGameOverlay = document.getElementById('new-game-overlay');
    this.btnNewGameConfirm = document.getElementById('btn-new-game-confirm');
    this.btnNewGameCancel = document.getElementById('btn-new-game-cancel');
    this.startOverlay = document.getElementById('start-overlay');
    this.rankingOverlay = document.getElementById('ranking-overlay');
    this.recordsOverlay = document.getElementById('records-overlay');
    this.settingsOverlay = document.getElementById('settings-overlay');
    this.settingHelpOverlay = document.getElementById('setting-help-overlay');
    this.settingHelpTitle = document.getElementById('setting-help-title');
    this.settingHelpBody = document.getElementById('setting-help-body');
    this.installOverlay = document.getElementById('install-overlay');
    this.installTitle = document.getElementById('install-title');
    this.installSteps = document.getElementById('install-steps');
    this.installNote = document.getElementById('install-note');
    this.btnInstallClose = document.getElementById('btn-install-close');
    this.changelogOverlay = document.getElementById('changelog-overlay');
    this.changelogList = document.getElementById('changelog-list');
    this.rankingList = document.getElementById('ranking-list');
    this.rankingEmpty = document.getElementById('ranking-empty');
    this.rankingTabs = document.querySelectorAll('.ranking-tab');
    this.winStats = document.getElementById('win-stats');
    this.recordsByMode = document.getElementById('records-by-mode');
    this.statScore = document.getElementById('stat-score');
    this.statScoreWrap = document.getElementById('stat-score-wrap');
    this.settingSound = document.getElementById('setting-sound');
    this.settingVegas = document.getElementById('setting-vegas');
    this.settingCumulativeVegas = document.getElementById('setting-cumulative-vegas');
    this.settingEasyMove = document.getElementById('setting-easy-move');
    this.settingDealDifficulty = document.getElementById('setting-deal-difficulty');
    this.settingDealDifficultyLabel = document.getElementById('setting-deal-difficulty-label');
    this.dealDifficultyControl = null;
    this.settingCumulativeRow = document.getElementById('setting-cumulative-row');
    this.settingCumulativePanel = document.getElementById('setting-cumulative-panel');
    this.settingsModeNotice = document.getElementById('settings-mode-notice');
    this.settingVegasScoreValue = document.getElementById('setting-vegas-score-value');
    this.btnVegasScoreReset = document.getElementById('btn-vegas-score-reset');
    this.settings = loadSettings();
    this.sounds = new SoundFX();
    this.sounds.enabled = this.settings.soundEnabled;

    this.bindEvents();
    this.bindPageLifecycle();
    this.appUpdate = initAppUpdate(APP_VERSION, {
      canApplyUpdate: () => !this.gameStarted,
    });
    this.startTimer();
    fitLayout();
    this.renderStartScreen();

    window.addEventListener('resize', () => scheduleLayoutFit(() => {
      if (this.gameStarted) this.render();
      else this.renderStartScreen();
    }));
    window.addEventListener('orientationchange', () => {
      setTimeout(() => scheduleLayoutFit(() => {
        if (this.gameStarted) this.render();
        else this.renderStartScreen();
      }), 150);
    });
    window.visualViewport?.addEventListener('resize', () => scheduleLayoutFit(() => {
      if (this.gameStarted) this.render();
      else this.renderStartScreen();
    }));
    window.visualViewport?.addEventListener('scroll', () => scheduleLayoutFit(() => {
      if (this.gameStarted) this.render();
      else this.renderStartScreen();
    }));
  }

  bindEvents() {
    bindClick(this.btnResume, () => this.resumeGame());
    bindClick(this.btnStartNew, () => this.startNewGame());
    bindClick(this.btnStartRecords, () => this.openRecordsOverlay());
    bindClick(this.btnStartRanking, () => this.openRankingOverlay());
    bindClick(this.btnStartSettings, () => this.openSettingsOverlay());
    bindClick(this.startVersion, () => this.openChangelogOverlay());
    bindClick(this.startInstallLink, () => this.openInstallOverlay());
    bindClick(this.btnInstallClose, () => this.closeOverlay(this.installOverlay));
    bindClick(this.btnChangelogClose, () => this.closeOverlay(this.changelogOverlay));
    bindClick(this.btnRecords, () => this.openRecordsOverlay());
    bindClick(this.btnHome, () => this.returnToStartScreen());
    bindClick(this.btnNew, () => {
      if (!this.gameStarted) return;
      this.openOverlay(this.newGameOverlay);
    });
    bindClick(this.btnNewGameConfirm, () => {
      this.closeOverlay(this.newGameOverlay);
      this.newGame();
    });
    bindClick(this.btnNewGameCancel, () => this.closeOverlay(this.newGameOverlay));
    bindClick(this.btnUndo, () => {
      if (!this.gameStarted) return;
      this.undo();
    });
    bindClick(this.btnAutoComplete, () => {
      void this.runAutoComplete();
    });
    bindClick(this.btnRanking, () => this.openRankingOverlay());
    bindClick(this.btnRecordsClose, () => this.closeOverlay(this.recordsOverlay));
    bindClick(this.btnRecordsReset, () => this.resetRecords());
    this.recordsByMode?.addEventListener('click', (e) => {
      const header = e.target.closest('.records-mode-header');
      if (!header) return;
      const expanded = header.getAttribute('aria-expanded') === 'true';
      header.setAttribute('aria-expanded', expanded ? 'false' : 'true');
      header.classList.toggle('is-expanded', !expanded);
      header.parentElement
        ?.querySelector('.records-mode-detail-panel')
        ?.classList.toggle('hidden', expanded);
    });
    bindClick(this.btnSettings, () => this.openSettingsOverlay());
    bindClick(this.btnRankingClose, () => this.closeOverlay(this.rankingOverlay));
    bindClick(this.btnSettingsClose, () => this.closeOverlay(this.settingsOverlay));
    bindClick(this.btnSettingHelpClose, () => this.closeOverlay(this.settingHelpOverlay));
    bindClick(this.btnVegasScoreReset, () => this.resetVegasCumulativeScore());
    this.settingsOverlay?.querySelectorAll('[data-setting-help]').forEach((btn) => {
      btn.addEventListener('click', () => this.openSettingHelp(btn.dataset.settingHelp));
    });
    for (const input of [
      this.settingSound,
      this.settingVegas,
      this.settingCumulativeVegas,
      this.settingEasyMove,
    ]) {
      bindChange(input, () => this.onSettingsChange());
    }
    this.rankingTabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        const sort = tab.dataset.sort;
        if (!sort || sort === this.rankingSort) return;
        this.rankingSort = sort;
        this.rankingTabs.forEach((t) => {
          const active = t.dataset.sort === sort;
          t.classList.toggle('is-active', active);
          t.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        this.renderRanking();
      });
    });
    bindClick(this.btnPlayAgain, () => {
      this.sounds.unlock();
      this.newGame();
    });

    this.board = document.querySelector('.board');
    this.board?.addEventListener('click', (e) => this.onClick(e));
    this.board?.addEventListener('dblclick', (e) => this.onDoubleClick(e));
    this.board?.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    this.board?.addEventListener('pointermove', (e) => this.onPointerMove(e));
    this.board?.addEventListener('pointerup', (e) => this.onPointerUp(e));
    this.board?.addEventListener('pointercancel', (e) => this.onPointerCancel(e));

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.clearSelection();
        this.closeOverlay(this.rankingOverlay);
        this.closeOverlay(this.recordsOverlay);
        this.closeOverlay(this.settingHelpOverlay);
        this.closeOverlay(this.installOverlay);
        this.closeOverlay(this.settingsOverlay);
        this.closeOverlay(this.changelogOverlay);
        this.closeOverlay(this.newGameOverlay);
      }
    });
  }

  bindPageLifecycle() {
    window.addEventListener('pagehide', () => {
      this.game.pausePlayTime();
      this.persistGameSave();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        this.game.pausePlayTime();
        this.persistGameSave();
      } else if (this.gameStarted && !this.game.won && !this.animatingDeal) {
        this.game.resumePlayTime();
      }
    });
  }

  persistGameSave() {
    if (!this.gameStarted || this.game.won || this.autoCompleting) return;
    saveGame(this.game);
  }

  setResumeLoading(loading) {
    this.startResumeLoading?.classList.toggle('hidden', !loading);
    if (loading) {
      this.btnResume?.classList.add('hidden');
      this.startResumeHint?.classList.add('hidden');
    }
  }

  applyResumeState(saved) {
    const canResume = saved != null;

    this.setResumeLoading(false);
    this.btnResume?.classList.toggle('hidden', !canResume);
    this.startResumeHint?.classList.toggle('hidden', !canResume);
    this.btnStartNew?.classList.remove('btn-start-play--secondary');
    this.btnStartNew?.classList.toggle('btn-start-play--solo', !canResume);
    this.btnResume?.classList.toggle('btn-start-play--secondary', canResume);

    if (canResume) {
      const { moves, elapsed } = getSavedGameSummary(saved);
      this.startResumeHint.textContent = `${moves} 手 · ${formatTime(elapsed)}`;
    }
  }

  refreshResumeState() {
    this.setResumeLoading(true);
    requestAnimationFrame(() => {
      try {
        this.applyResumeState(loadSavedGame());
      } catch {
        this.setResumeLoading(false);
      }
    });
  }

  updateStartScreenActions() {
    this.refreshResumeState();
  }

  enterGame() {
    this.gameStarted = true;
    this.startOverlay.classList.add('hidden');
    document.body.classList.remove('on-start-screen');
    this.appUpdate?.applyPendingUpdate();
    this.updateBottomNav();
  }

  returnToStartScreen() {
    if (!this.gameStarted) return;
    if (this.animatingDeal || this.animatingStock || this.animatingMove || this.autoCompleting) return;

    this.game.pausePlayTime();
    this.persistGameSave();
    this.persistVegasScoreIfNeeded();
    this.clearSelection();

    for (const overlay of [
      this.winOverlay,
      this.newGameOverlay,
      this.rankingOverlay,
      this.recordsOverlay,
      this.settingsOverlay,
      this.settingHelpOverlay,
      this.changelogOverlay,
      this.installOverlay,
    ]) {
      this.closeOverlay(overlay);
    }

    this.gameStarted = false;
    this.startOverlay.classList.remove('hidden');
    this.renderStartScreen();
    this.appUpdate?.applyPendingUpdate();
  }

  updateBottomNav() {
    const onStart = !this.gameStarted;
    const dealBusy = this.animatingDeal;
    const busy = dealBusy
      || this.autoCompleting
      || this.animatingStock
      || this.animatingMove;

    this.btnHome.disabled = onStart || busy;
    this.btnNew.disabled = onStart || dealBusy;
    this.btnUndo.disabled = onStart || dealBusy || this.game.history.length === 0;
    this.btnRecords.disabled = onStart;
    this.btnRanking.disabled = onStart;
    this.btnSettings.disabled = onStart;
  }

  resumeGame() {
    if (this.gameStarted) return;

    const saved = loadSavedGame();
    if (!saved) {
      this.updateStartScreenActions();
      return;
    }

    this.sounds.unlock();
    applySavedGame(this.game, saved);
    if (
      this.game.cumulativeVegas &&
      this.game.vegasMode &&
      saved.vegasCumulativeBase == null
    ) {
      this.game.vegasCumulativeBase = loadVegasScore();
    }
    this.winRecorded = false;
    this.winOverlay.classList.add('hidden');
    this.clearSelection();
    this.enterGame();
    this.game.resumePlayTime();
    this.render();
    this.persistGameSave();
  }

  startNewGame() {
    if (this.gameStarted) return;

    clearSavedGame();
    this.sounds.unlock();
    this.winRecorded = false;
    this.enterGame();
    void this.animateNewGame({ reshuffle: false });
  }

  ensureDealDifficultyControl() {
    if (this.dealDifficultyControl) return this.dealDifficultyControl;
    this.dealDifficultyControl = createDealDifficultyControl(this.settingDealDifficulty, {
      onInput: (index) => this.updateDealDifficultyLabel(index),
      onChange: () => this.onSettingsChange(),
    });
    return this.dealDifficultyControl;
  }

  openSettingsOverlay() {
    this.ensureDealDifficultyControl();
    this.syncSettingsForm();
    this.openOverlay(this.settingsOverlay);
  }

  openSettingHelp(key) {
    const help = SETTING_HELP[key];
    if (!help) return;
    this.settingHelpTitle.textContent = help.title;
    this.settingHelpBody.textContent = help.body;
    this.openOverlay(this.settingHelpOverlay);
  }

  openInstallOverlay() {
    const help = getInstallHelp();
    this.installTitle.textContent = help.title;
    this.installSteps.replaceChildren();
    for (const step of help.steps) {
      const item = document.createElement('li');
      item.textContent = step;
      this.installSteps.appendChild(item);
    }
    if (help.note) {
      this.installNote.textContent = help.note;
      this.installNote.classList.remove('hidden');
    } else {
      this.installNote.textContent = '';
      this.installNote.classList.add('hidden');
    }
    this.openOverlay(this.installOverlay);
  }

  openChangelogOverlay() {
    this.renderChangelog();
    this.openOverlay(this.changelogOverlay);
  }

  renderChangelog() {
    this.changelogList.replaceChildren();
    for (const entry of CHANGELOG) {
      const li = document.createElement('li');
      li.className = 'changelog-entry';

      const header = document.createElement('div');
      header.className = 'changelog-entry-header';

      const heading = document.createElement('h3');
      heading.className = 'changelog-version';
      heading.textContent = `v${entry.version}`;
      header.appendChild(heading);

      if (entry.date) {
        const dateEl = document.createElement('span');
        dateEl.className = 'changelog-date';
        dateEl.textContent = formatChangelogDate(entry.date);
        header.appendChild(dateEl);
      }

      if (entry.version === APP_VERSION) {
        const badge = document.createElement('span');
        badge.className = 'changelog-current';
        badge.textContent = '現在';
        header.appendChild(badge);
      }

      const changes = document.createElement('ul');
      changes.className = 'changelog-changes';
      for (const text of entry.changes) {
        const item = document.createElement('li');
        item.textContent = text;
        changes.appendChild(item);
      }

      li.append(header, changes);
      this.changelogList.appendChild(li);
    }
  }

  syncSettingsForm() {
    this.settingSound.checked = this.settings.soundEnabled;
    this.settingVegas.checked = this.settings.vegasMode;
    this.settingCumulativeVegas.checked = this.settings.cumulativeVegas;
    this.settingEasyMove.checked = this.settings.easyMove;
    this.dealDifficultyControl?.setValue(this.settings.dealDifficulty);
    this.updateDealDifficultyLabel(this.dealDifficultyControl?.getIndex() ?? 1);
    this.settingCumulativeRow.classList.toggle('hidden', !this.settings.vegasMode);
    this.updateSettingsModeNotice();
    this.updateVegasScorePanel();
  }

  updateSettingsModeNotice() {
    if (!this.settingsModeNotice) return;
    const show = hasPendingGameModeChange(this.settings, this.game, {
      gameStarted: this.gameStarted,
    });
    this.settingsModeNotice.textContent = PENDING_GAME_MODE_NOTICE;
    this.settingsModeNotice.classList.toggle('hidden', !show);
  }

  updateDealDifficultyLabel(index) {
    if (!this.settingDealDifficultyLabel) return;
    const label = getDealDifficultyLabel(getDealDifficultyValue(index));
    this.settingDealDifficultyLabel.textContent = label;
    this.settingDealDifficulty?.setAttribute('aria-valuetext', label);
  }

  updateVegasScorePanel() {
    const showPanel = this.settings.vegasMode && this.settings.cumulativeVegas;
    this.settingCumulativePanel.classList.toggle('hidden', !showPanel);
    if (!showPanel) return;

    const stored = loadVegasScore();
    this.settingVegasScoreValue.textContent = formatVegasScore(stored);
    this.btnVegasScoreReset.disabled = stored === 0;
  }

  resetVegasCumulativeScore() {
    const stored = loadVegasScore();
    if (stored === 0) return;
    if (!window.confirm('累計ベガスモードの点数をリセットしますか？この操作は元に戻せません。')) return;

    saveVegasScore(0);

    if (
      this.gameStarted &&
      this.game.cumulativeVegas &&
      this.game.vegasMode
    ) {
      const base = this.game.vegasCumulativeBase ?? 0;
      const roundEarnings = this.game.score - (base - 52);
      this.game.score = -52 + roundEarnings;
      this.game.vegasCumulativeBase = 0;
      this.persistVegasScoreIfNeeded();
      this.persistGameSave();
    }

    this.updateVegasScorePanel();
    this.updateScoreDisplay();
  }

  onSettingsChange() {
    this.settings = {
      soundEnabled: this.settingSound.checked,
      vegasMode: this.settingVegas.checked,
      cumulativeVegas: this.settingVegas.checked && this.settingCumulativeVegas.checked,
      dealDifficulty: this.dealDifficultyControl?.getValue() ?? this.settings.dealDifficulty,
      easyMove: this.settingEasyMove.checked,
    };
    if (!this.settings.vegasMode) {
      this.settings.cumulativeVegas = false;
    }
    saveSettings(this.settings);
    this.sounds.enabled = this.settings.soundEnabled;
    this.settingCumulativeRow.classList.toggle('hidden', !this.settings.vegasMode);
    this.settingCumulativeVegas.checked = this.settings.cumulativeVegas;
    this.updateSettingsModeNotice();
    this.updateVegasScorePanel();
    this.updateScoreDisplay();
    if (this.gameStarted) {
      this.render();
    } else {
      this.renderStartScreen();
    }
  }

  getResetOptions() {
    return {
      vegasMode: this.settings.vegasMode,
      cumulativeVegas: this.settings.cumulativeVegas,
      storedVegasScore: loadVegasScore(),
      dealDifficulty: this.settings.dealDifficulty,
    };
  }

  persistVegasScoreIfNeeded() {
    if (this.game.vegasMode && this.game.cumulativeVegas) {
      saveVegasScore(this.game.score);
      this.updateVegasScorePanel();
    }
  }

  updateScoreDisplay() {
    const showVegas = this.gameStarted && this.game.vegasMode;
    if (showVegas) {
      this.statScoreWrap.classList.remove('hidden');
      this.statScore.textContent = formatVegasScore(this.game.score);
    } else {
      this.statScoreWrap.classList.add('hidden');
    }
  }

  openRecordsOverlay() {
    this.renderRecords();
    this.openOverlay(this.recordsOverlay);
  }

  renderRecords() {
    const stats = loadStats();
    const vegasStats = getVegasModeStats(stats);
    this.btnRecordsReset.disabled = stats.gamesPlayed === 0 && stats.gamesCleared === 0;

    this.recordsByMode.replaceChildren();

    const normal = stats.byMode.normal;
    this.recordsByMode.appendChild(this.createRecordsModeGroup({
      mode: 'normal',
      label: formatClearMode('normal'),
      played: normal.played,
      cleared: normal.cleared,
      avgMoves: formatAvgMoves(normal.cleared, normal.totalClearMoves),
      avgTime: formatAvgTime(normal.cleared, normal.totalClearSeconds),
    }));

    this.recordsByMode.appendChild(this.createRecordsModeGroup({
      mode: 'vegas',
      label: 'ベガス',
      played: vegasStats.played,
      cleared: vegasStats.cleared,
      avgMoves: formatAvgMoves(vegasStats.cleared, vegasStats.totalClearMoves),
      avgTime: formatAvgTime(vegasStats.cleared, vegasStats.totalClearSeconds),
    }));
  }

  createRecordsModeGroup({ mode, label, played, cleared, avgMoves, avgTime }) {
    const li = document.createElement('li');
    li.className = 'records-mode-group';

    const header = document.createElement('button');
    header.type = 'button';
    header.className = 'records-mode-header';
    header.setAttribute('aria-expanded', 'false');

    const headerLabel = document.createElement('span');
    headerLabel.className = `records-mode-label records-mode-label--${mode}`;
    headerLabel.textContent = label;

    const headerSummary = document.createElement('span');
    headerSummary.className = 'records-mode-summary';
    headerSummary.textContent =
      `プレイ ${played} · クリア ${cleared} · ${formatClearRate(getModeClearRate(played, cleared))}`;

    const chevron = document.createElement('span');
    chevron.className = 'records-mode-chevron';
    chevron.setAttribute('aria-hidden', 'true');

    header.append(headerLabel, headerSummary, chevron);

    const detailPanel = document.createElement('div');
    detailPanel.className = 'records-mode-detail-panel hidden';

    detailPanel.append(
      this.createRecordsDetailRow('クリア時平均手数', avgMoves),
      this.createRecordsDetailRow('クリア時平均時間', avgTime),
    );

    li.append(header, detailPanel);
    return li;
  }

  createRecordsDetailRow(label, value) {
    const row = document.createElement('div');
    row.className = 'records-detail-row';

    const labelEl = document.createElement('span');
    labelEl.className = 'records-detail-label';
    labelEl.textContent = label;

    const valueEl = document.createElement('span');
    valueEl.className = 'records-detail-value';
    valueEl.textContent = value;

    row.append(labelEl, valueEl);
    return row;
  }

  resetRecords() {
    if (!window.confirm('記録とランキングをすべてリセットしますか？この操作は元に戻せません。')) return;
    resetStats();
    resetRankings();
    this.renderRecords();
  }

  openRankingOverlay() {
    this.renderRanking();
    this.openOverlay(this.rankingOverlay);
  }

  renderRanking() {
    const entries = getTopRankings(this.rankingSort, 10);
    this.rankingList.replaceChildren();

    if (entries.length === 0) {
      this.rankingEmpty.classList.remove('hidden');
      return;
    }

    this.rankingEmpty.classList.add('hidden');
    entries.forEach((entry, index) => {
      const li = document.createElement('li');
      li.className = 'ranking-item';

      const rank = document.createElement('span');
      rank.className = 'ranking-rank';
      rank.textContent = String(index + 1);

      const date = document.createElement('span');
      date.className = 'ranking-date';
      date.textContent = formatClearDate(entry.clearedAt);

      const mode = document.createElement('span');
      mode.className = `ranking-mode ranking-mode--${entry.mode ?? 'normal'}`;
      mode.textContent = formatClearMode(entry.mode);

      const detail = document.createElement('span');
      detail.className = 'ranking-detail';
      detail.textContent = `${formatTime(entry.seconds)} · ${entry.moves} 手`;

      li.append(rank, date, mode, detail);
      this.rankingList.appendChild(li);
    });
  }

  openOverlay(overlay) {
    overlay?.classList.remove('hidden');
  }

  closeOverlay(overlay) {
    overlay?.classList.add('hidden');
  }

  newGame() {
    void this.animateNewGame({ reshuffle: true });
  }

  beginDealPreparing() {
    this.game.pausePlayTime();
    this.clearSelection();
    this.winRecorded = false;
    this.winOverlay.classList.add('hidden');

    this.animatingDeal = true;
    document.body.classList.add('is-deal-animating', 'is-deal-preparing');
    this.autoCompleteBar.classList.add('hidden');
    this.dealPreparingBar?.classList.remove('hidden');

    this.game.moves = 0;
    this.game.playTimeMs = 0;
    this.game.playTimeAnchor = null;
    this.game.won = false;
    this.game.history = [];
    this.game.stock = [];
    this.game.waste = [];
    this.game.foundations = [[], [], [], []];
    this.game.tableau = [[], [], [], [], [], [], []];

    this.renderPreDealBoard();
    this.updateBottomNav();
  }

  endDealPreparing() {
    document.body.classList.remove('is-deal-preparing');
    this.dealPreparingBar?.classList.add('hidden');
  }

  renderPreDealBoard() {
    fitLayout();
    const stockPlaceholder = [{ suit: 'spades', value: 1, faceUp: false }];
    this.renderPile('stock', stockPlaceholder, { stockDisplayCount: 24 });
    this.renderPile('waste', []);
    SUITS.forEach((suit, i) => {
      this.renderPile(`foundation-${i}`, [], { placeholder: true, suit });
    });
    for (let i = 0; i < 7; i++) {
      this.renderPile(`tableau-${i}`, []);
    }
    this.statMoves.textContent = '0 手';
    this.statTime.textContent = '00:00';
    this.updateScoreDisplay();
  }

  async animateNewGame({ reshuffle = true } = {}) {
    if (this.animatingDeal || this.animatingStock || this.autoCompleting) return;

    if (reshuffle) {
      clearSavedGame();
    }

    this.beginDealPreparing();
    await yieldToMain();

    await this.game.resetAsync(this.getResetOptions());
    this.endDealPreparing();

    this.game.beginVegasRound(this.getResetOptions());
    recordGamePlayed(resolveClearMode(getActiveGameMode(this.game)));
    this.updateScoreDisplay();
    this.persistVegasScoreIfNeeded();

    const skipAnim = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (skipAnim) {
      this.game.resumePlayTime();
      this.render();
      this.persistGameSave();
      this.animatingDeal = false;
      document.body.classList.remove('is-deal-animating');
      this.updateBottomNav();
      return;
    }

    this.updateBottomNav();
    this.persistGameSave();

    const steps = buildDealSteps(this.game.tableau);
    const visibleCounts = [0, 0, 0, 0, 0, 0, 0];
    this.renderDealProgress(visibleCounts);

    for (const step of steps) {
      const fromRect = this.getPileCardRect('stock') ?? this.getPileInnerRect('stock');
      const toRect = this.getTableauTargetRect(step.col, step.row);
      if (!fromRect || !toRect) continue;

      await this.playDealAnimation(step.card, fromRect, toRect, { flip: step.faceUp });
      visibleCounts[step.col]++;
      this.renderDealProgress(visibleCounts);
    }

    this.render();
    this.animatingDeal = false;
    document.body.classList.remove('is-deal-animating');
    this.updateBottomNav();
    this.game.resumePlayTime();
    this.persistGameSave();
  }

  undo() {
    if (this.game.undo()) {
      this.clearSelection();
      this.render();
    }
  }

  startTimer() {
    if (this.timerId) clearInterval(this.timerId);
    this.timerId = setInterval(() => {
      if (!this.gameStarted || this.game.won) return;
      this.statTime.textContent = formatTime(this.game.elapsedSeconds());
    }, 1000);
  }

  renderStartScreen() {
    document.body.classList.add('on-start-screen');
    if (this.startVersion) {
      this.startVersion.textContent = `v${APP_VERSION}`;
    }
    this.startInstallLink?.classList.toggle('hidden', !shouldShowInstallLink());
    fitLayout();
    this.renderPile('stock', []);
    this.renderPile('waste', []);
    SUITS.forEach((suit, i) => {
      this.renderPile(`foundation-${i}`, [], { placeholder: true, suit });
    });
    for (let i = 0; i < 7; i++) {
      this.renderPile(`tableau-${i}`, []);
    }
    this.statMoves.textContent = '0 手';
    this.statTime.textContent = '00:00';
    this.updateScoreDisplay();
    this.updateBottomNav();
    this.autoCompleteBar.classList.add('hidden');
    this.refreshResumeState();
    this.appUpdate?.applyPendingUpdate();
  }

  onCardsMoved() {
    if (this.settings.soundEnabled) {
      this.sounds.playPlace();
      if (this.game.lastFlip) this.sounds.playFlip(0.04);
    }
    this.persistVegasScoreIfNeeded();
    this.updateScoreDisplay();
  }

  updateAutoCompleteButton() {
    const show = this.gameStarted && !this.autoCompleting && this.game.canAutoComplete();
    this.autoCompleteBar.classList.toggle('hidden', !show);
    this.btnAutoComplete.disabled = !show;
    if (show) scheduleLayoutFit();
  }

  async runAutoComplete() {
    if (!this.gameStarted || this.autoCompleting || this.animatingDeal || this.animatingStock || this.animatingMove) {
      return;
    }
    if (!this.game.canAutoComplete()) return;

    this.autoCompleting = true;
    this.clearSelection();
    this.updateAutoCompleteButton();

    const delay = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 18;

    while (this.game.canAutoComplete()) {
      const move = this.game.findNextFoundationMove();
      if (!move) break;
      const ok = await this.animateMove(move.from, move.index, move.to);
      if (!ok) break;
      this.updateAutoCompleteButton();
      if (this.game.won) {
        this.showWin();
        break;
      }
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    }

    this.autoCompleting = false;
    this.render();
  }

  clearSelection() {
    this.selected = null;
    document.querySelectorAll('.pile.highlight').forEach((el) => el.classList.remove('highlight'));
  }

  selectCard(pileId, index) {
    const pileInfo = parsePileId(pileId);
    const stack = this.game.getMovableStack(pileInfo, index);
    if (!stack) return false;

    this.clearSelection();
    this.selected = { pileId, index, stack };
    this.highlightValidTargets(stack, pileId);
    return true;
  }

  highlightValidTargets(stack, fromPileId) {
    document.querySelectorAll('.pile[data-pile]').forEach((pileEl) => {
      const destId = pileEl.dataset.pile;
      if (destId === fromPileId || destId === 'stock') return;
      const destInfo = parsePileId(destId);
      if (this.game.canMove(stack, destInfo)) {
        pileEl.classList.add('highlight');
      }
    });
  }

  tryMoveTo(pileId) {
    if (pileId === 'stock') {
      void this.animateDrawFromStock();
      return;
    }

    if (!this.selected) return;

    const fromInfo = parsePileId(this.selected.pileId);
    const toInfo = parsePileId(pileId);
    if (this.game.moveCards(fromInfo, this.selected.index, toInfo)) {
      this.onCardsMoved();
      this.clearSelection();
      this.render();
      if (this.game.won) this.showWin();
    }
  }

  getMoveTargetRect(fromInfo, cardIndex, destInfo) {
    const destPile = this.game.getPile(destInfo);
    if (destInfo.type === 'tableau') {
      return this.getTableauTargetRect(destInfo.index, destPile.length);
    }
    if (destInfo.type === 'foundation') {
      const pileId = `foundation-${destInfo.index}`;
      return this.getPileCardRect(pileId) ?? this.getPileInnerRect(pileId);
    }
    return null;
  }

  hideDestinationCards(destInfo, count) {
    const pileId = pileIdFromInfo(destInfo);
    const cards = document.querySelectorAll(`[data-pile="${pileId}"] .card`);
    for (let i = Math.max(0, cards.length - count); i < cards.length; i++) {
      cards[i].style.visibility = 'hidden';
    }
  }

  playCardMoveAnimation(stack, fromRect, toRect) {
    return new Promise((resolve) => {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        resolve();
        return;
      }

      const duration = this.autoCompleting ? 53 : 160;
      const cardWidth = fromRect.width;
      const cardHeight = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--card-height'));
      const offset = getTableauStackOffset();
      const dx = toRect.left - fromRect.left;
      const dy = toRect.top - fromRect.top;

      const wrapper = document.createElement('div');
      wrapper.className = 'card-move-anim';
      wrapper.style.width = `${cardWidth}px`;
      wrapper.style.height = `${cardHeight + (stack.length - 1) * offset}px`;
      wrapper.style.left = `${fromRect.left}px`;
      wrapper.style.top = `${fromRect.top}px`;

      stack.forEach((card, i) => {
        const el = createCardEl(card, 'anim', i);
        el.style.position = 'absolute';
        el.style.left = '0';
        el.style.top = `${i * offset}px`;
        el.style.width = `${cardWidth}px`;
        el.style.height = `${cardHeight}px`;
        el.style.transform = 'none';
        wrapper.appendChild(el);
      });

      document.body.appendChild(wrapper);

      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        wrapper.remove();
        resolve();
      };

      requestAnimationFrame(() => {
        const animation = wrapper.animate(
          [
            { transform: 'translate(0, -3px)' },
            { transform: `translate(${dx}px, ${dy}px)` },
          ],
          {
            duration,
            easing: 'ease-out',
            fill: 'forwards',
          },
        );

        animation.onfinish = finish;
      });

      setTimeout(finish, duration + 30);
    });
  }

  async animateMove(fromInfo, index, destInfo) {
    const stack = this.game.getMovableStack(fromInfo, index);
    if (!stack || !this.game.canMove(stack, destInfo)) return false;

    const pileId = pileIdFromInfo(fromInfo);
    const fromEl = document.querySelector(`[data-pile="${pileId}"] .card[data-index="${index}"]`);
    const fromRect = fromEl?.getBoundingClientRect() ?? this.getPileCardRect(pileId);
    const skipAnim = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (!this.game.moveCards(fromInfo, index, destInfo)) return false;

    if (skipAnim || !fromRect) {
      this.onCardsMoved();
      this.clearSelection();
      this.render();
      return true;
    }

    this.render();

    const destPileId = pileIdFromInfo(destInfo);
    const destLen = this.game.getPile(destInfo).length;
    const destStartIndex = destLen - stack.length;
    const destEl = document.querySelector(
      `[data-pile="${destPileId}"] .card[data-index="${destStartIndex}"]`
    );
    const toRect = destEl?.getBoundingClientRect()
      ?? this.getMoveTargetRect(fromInfo, index, destInfo);

    if (!toRect) {
      this.onCardsMoved();
      this.clearSelection();
      this.render();
      return true;
    }

    this.hideDestinationCards(destInfo, stack.length);
    await this.playCardMoveAnimation(stack, fromRect, toRect);

    this.onCardsMoved();
    this.clearSelection();
    this.render();
    return true;
  }

  async animateEasyMove(pileId, index) {
    if (!this.settings.easyMove || this.animatingMove) return false;
    const fromInfo = parsePileId(pileId);
    const dest = this.game.findEasyMoveDestination(fromInfo, index);
    if (!dest) return false;
    return this.animateEasyMoveTo(fromInfo, index, dest);
  }

  async animateEasyMoveTo(fromInfo, index, destInfo) {
    if (this.animatingMove) return false;
    this.animatingMove = true;
    document.body.classList.add('is-move-animating');
    try {
      const ok = await this.animateMove(fromInfo, index, destInfo);
      if (ok && this.game.won) this.showWin();
      return ok;
    } finally {
      this.animatingMove = false;
      document.body.classList.remove('is-move-animating');
    }
  }

  async animateEasyMoveToPile(pileId) {
    if (!this.settings.easyMove || this.animatingMove) return false;
    const destInfo = parsePileId(pileId);
    if (!destInfo || (destInfo.type !== 'tableau' && destInfo.type !== 'foundation')) return false;

    const source = this.game.findEasyMoveSourceToDest(destInfo);
    if (!source) return false;
    return this.animateEasyMoveTo(source.from, source.index, destInfo);
  }

  async performQuickMove(pileId, index) {
    if (this.settings.easyMove) {
      return this.animateEasyMove(pileId, index);
    }
    const fromInfo = parsePileId(pileId);
    if (this.game.autoMoveToFoundation(fromInfo, index)) {
      this.onCardsMoved();
      this.clearSelection();
      this.render();
      if (this.game.won) this.showWin();
      return true;
    }
    return false;
  }

  onClick(e) {
    if (!this.gameStarted || this.autoCompleting || this.animatingMove) return;
    if (Date.now() < this.ignoreClickUntil) return;
    if (document.body.classList.contains('is-dragging')) return;

    const cardEl = e.target.closest('.card');
    const pileEl = e.target.closest('.pile');

    if (pileEl?.dataset.pile === 'stock') {
      void this.animateDrawFromStock();
      return;
    }

    if (cardEl) {
      const pileId = cardEl.dataset.pile;
      const index = Number(cardEl.dataset.index);

      if (this.selected?.pileId === pileId && this.selected.index === index) {
        this.clearSelection();
        return;
      }

      if (cardEl.classList.contains('face-up')) {
        if (this.selected) {
          this.tryMoveTo(pileId);
          return;
        }

        if (this.settings.easyMove) {
          void this.animateEasyMove(pileId, index).then((moved) => {
            if (!moved) this.selectCard(pileId, index);
          });
        } else {
          this.selectCard(pileId, index);
        }
        return;
      }

      this.selectCard(pileId, index);
      return;
    }

    if (pileEl && !this.selected && this.settings.easyMove) {
      const destId = pileEl.dataset.pile;
      if (destId.startsWith('tableau-') || destId.startsWith('foundation-')) {
        void this.animateEasyMoveToPile(destId);
        return;
      }
    }

    if (pileEl && this.selected) {
      this.tryMoveTo(pileEl.dataset.pile);
    }
  }

  onDoubleClick(e) {
    if (!this.gameStarted) return;
    const cardEl = e.target.closest('.card');
    if (!cardEl) return;
    e.preventDefault();
    const pileId = cardEl.dataset.pile;
    const index = Number(cardEl.dataset.index);
    void this.performQuickMove(pileId, index);
  }

  onPointerDown(e) {
    if (!this.gameStarted || this.animatingMove) return;
    if (e.button !== 0) return;
    const cardEl = e.target.closest('.card.face-up');
    if (!cardEl) return;

    const pileId = cardEl.dataset.pile;
    const index = Number(cardEl.dataset.index);
    const now = Date.now();
    if (
      this.lastTap &&
      now - this.lastTap.time < 320 &&
      this.lastTap.pileId === pileId &&
      this.lastTap.index === index
    ) {
      this.lastTap = null;
      void this.performQuickMove(pileId, index).then((moved) => {
        if (moved) this.ignoreClickUntil = now + 400;
      });
      return;
    }
    this.lastTap = { time: now, pileId, index };

    this.drag = {
      pointerId: e.pointerId,
      cardEl,
      pileId,
      index,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
      ghost: null,
      targetPile: null,
    };
  }

  beginDrag(clientX, clientY) {
    const pileInfo = parsePileId(this.drag.pileId);
    const stack = this.game.getMovableStack(pileInfo, this.drag.index);
    if (!stack) {
      this.cancelDrag();
      return false;
    }

    this.drag.stack = stack;
    this.drag.ghost = this.createGhost(stack, clientX, clientY);
    document.body.appendChild(this.drag.ghost);
    document.body.classList.add('is-dragging');
    this.board.setPointerCapture(this.drag.pointerId);
    this.selectCard(this.drag.pileId, this.drag.index);
    this.setDragStackOpacity(this.drag.pileId, this.drag.index, '0.3');
    return true;
  }

  setDragStackOpacity(pileId, index, opacity) {
    const cards = document.querySelectorAll(`[data-pile="${pileId}"] .card`);
    for (let i = index; i < cards.length; i++) {
      cards[i].style.opacity = opacity;
    }
  }

  clearDragStackOpacity(pileId, index) {
    const cards = document.querySelectorAll(`[data-pile="${pileId}"] .card`);
    for (let i = index; i < cards.length; i++) {
      cards[i].style.opacity = '';
    }
  }

  updateDragPosition(clientX, clientY) {
    this.drag.ghost.style.left = `${clientX}px`;
    this.drag.ghost.style.top = `${clientY}px`;
    this.updateDropTarget(clientX, clientY);
  }

  updateDropTarget(clientX, clientY) {
    document.querySelectorAll('.pile.highlight').forEach((el) => el.classList.remove('highlight'));
    this.drag.targetPile = null;

    const target = document.elementFromPoint(clientX, clientY)?.closest('.pile[data-pile]');
    if (!target || !this.drag.stack) return;

    const destId = target.dataset.pile;
    if (destId === this.drag.pileId || destId === 'stock') return;

    const destInfo = parsePileId(destId);
    if (this.game.canMove(this.drag.stack, destInfo)) {
      target.classList.add('highlight');
      this.drag.targetPile = destId;
    }
  }

  onPointerMove(e) {
    if (!this.drag || e.pointerId !== this.drag.pointerId) return;

    const dx = e.clientX - this.drag.startX;
    const dy = e.clientY - this.drag.startY;
    if (!this.drag.moved && Math.hypot(dx, dy) < (window.innerWidth < 480 ? 10 : 8)) return;

    e.preventDefault();
    this.drag.moved = true;

    if (!this.drag.ghost && !this.beginDrag(e.clientX, e.clientY)) return;
    if (this.drag.ghost) this.updateDragPosition(e.clientX, e.clientY);
  }

  finishDrag() {
    const { moved, pileId, index, targetPile, cardEl, ghost, pointerId } = this.drag;

    if (this.board.hasPointerCapture(pointerId)) {
      this.board.releasePointerCapture(pointerId);
    }
    document.body.classList.remove('is-dragging');

    if (ghost) ghost.remove();
    if (pileId != null && index != null) this.clearDragStackOpacity(pileId, index);

    if (moved && targetPile) {
      const fromInfo = parsePileId(pileId);
      const toInfo = parsePileId(targetPile);
      if (this.game.moveCards(fromInfo, index, toInfo)) {
        this.onCardsMoved();
        this.clearSelection();
        this.render();
        if (this.game.won) this.showWin();
      } else {
        this.clearSelection();
      }
      this.ignoreClickUntil = Date.now() + 400;
    } else if (!moved && cardEl) {
      this.onClick({ target: cardEl });
      this.ignoreClickUntil = Date.now() + 400;
    } else {
      this.clearSelection();
    }

    this.drag = null;
  }

  onPointerUp(e) {
    if (!this.drag || e.pointerId !== this.drag.pointerId) return;
    if (this.drag.moved && this.drag.ghost) {
      this.updateDropTarget(e.clientX, e.clientY);
    }
    this.finishDrag();
  }

  onPointerCancel(e) {
    if (!this.drag || e.pointerId !== this.drag.pointerId) return;
    this.cancelDrag();
  }

  cancelDrag() {
    if (this.drag?.ghost) this.drag.ghost.remove();
    if (this.drag?.pileId != null && this.drag?.index != null) {
      this.clearDragStackOpacity(this.drag.pileId, this.drag.index);
    }
    if (this.drag?.pointerId != null && this.board?.hasPointerCapture(this.drag.pointerId)) {
      this.board.releasePointerCapture(this.drag.pointerId);
    }
    document.body.classList.remove('is-dragging');
    this.drag = null;
    this.clearSelection();
  }

  getPileCardRect(pileId) {
    const inner = document.querySelector(`[data-pile="${pileId}"] .pile-inner`);
    if (!inner) return null;
    const cards = inner.querySelectorAll('.card');
    const card = cards.length ? cards[cards.length - 1] : null;
    return (card ?? inner).getBoundingClientRect();
  }

  getPileInnerRect(pileId) {
    return document.querySelector(`[data-pile="${pileId}"] .pile-inner`)?.getBoundingClientRect() ?? null;
  }

  getTableauTargetRect(col, rowInColumn) {
    const inner = document.querySelector(`[data-pile="tableau-${col}"] .pile-inner`);
    if (!inner) return null;

    const pileRect = inner.getBoundingClientRect();
    const root = document.documentElement;
    const cardWidth = parseFloat(getComputedStyle(root).getPropertyValue('--card-width'));
    const cardHeight = parseFloat(getComputedStyle(root).getPropertyValue('--card-height'));
    const offset = getTableauStackOffset();

    return {
      left: pileRect.left + (pileRect.width - cardWidth) / 2,
      top: pileRect.top + rowInColumn * offset,
      width: cardWidth,
      height: cardHeight,
    };
  }

  playDealAnimation(card, fromRect, toRect, { flip = false } = {}) {
    return new Promise((resolve) => {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        resolve();
        return;
      }

      const duration = 53;
      const wrapper = document.createElement('div');
      wrapper.className = 'stock-draw-anim deal-anim';
      wrapper.style.width = `${fromRect.width}px`;
      wrapper.style.height = `${fromRect.height}px`;
      wrapper.style.left = `${fromRect.left}px`;
      wrapper.style.top = `${fromRect.top}px`;

      let flipper = null;
      if (flip) {
        flipper = document.createElement('div');
        flipper.className = 'stock-draw-anim-flipper';
        const back = createCardEl({ ...card, faceUp: false }, 'anim', 0);
        const front = createCardEl({ ...card, faceUp: true }, 'anim', 0);
        for (const el of [back, front]) {
          el.style.position = 'absolute';
          el.style.left = '0';
          el.style.top = '0';
          el.style.width = '100%';
          el.style.height = '100%';
        }
        front.classList.add('stock-draw-anim-front');
        flipper.append(back, front);
        wrapper.append(flipper);
      } else {
        const el = createCardEl({ ...card, faceUp: false }, 'anim', 0);
        el.style.position = 'absolute';
        el.style.inset = '0';
        el.style.width = '100%';
        el.style.height = '100%';
        el.style.transform = 'none';
        wrapper.append(el);
      }

      document.body.appendChild(wrapper);

      requestAnimationFrame(() => {
        if (flip) {
          this.sounds.playFlip();
        } else {
          this.sounds.playPlace();
        }
        wrapper.style.transition = `left ${duration}ms cubic-bezier(0.33, 1, 0.68, 1), top ${duration}ms cubic-bezier(0.33, 1, 0.68, 1)`;
        wrapper.style.left = `${toRect.left}px`;
        wrapper.style.top = `${toRect.top}px`;
        if (flip && flipper) {
          flipper.style.transition = `transform ${duration}ms cubic-bezier(0.33, 1, 0.68, 1)`;
          flipper.style.transform = 'rotateY(180deg)';
        }
      });

      setTimeout(() => {
        wrapper.remove();
        resolve();
      }, duration + 10);
    });
  }

  playStockDrawAnimation(card, fromRect, toRect) {
    return new Promise((resolve) => {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        resolve();
        return;
      }

      const wrapper = document.createElement('div');
      wrapper.className = 'stock-draw-anim';
      wrapper.style.width = `${fromRect.width}px`;
      wrapper.style.height = `${fromRect.height}px`;
      wrapper.style.left = `${fromRect.left}px`;
      wrapper.style.top = `${fromRect.top}px`;

      const flipper = document.createElement('div');
      flipper.className = 'stock-draw-anim-flipper';

      const back = createCardEl({ ...card, faceUp: false }, 'anim', 0);
      const front = createCardEl({ ...card, faceUp: true }, 'anim', 0);
      for (const el of [back, front]) {
        el.style.position = 'absolute';
        el.style.left = '0';
        el.style.top = '0';
        el.style.width = '100%';
        el.style.height = '100%';
      }
      front.classList.add('stock-draw-anim-front');

      flipper.append(back, front);
      wrapper.append(flipper);
      document.body.appendChild(wrapper);

      const duration = STOCK_DRAW_DURATION;
      const toLeft = toRect.left + (toRect.width - fromRect.width) / 2;
      const toTop = toRect.top + (toRect.height - fromRect.height) / 2;

      requestAnimationFrame(() => {
        this.sounds.playFlip();
        wrapper.style.transition = `left ${duration}ms ${STOCK_DRAW_EASING}, top ${duration}ms ${STOCK_DRAW_EASING}`;
        flipper.style.transition = `transform ${duration}ms ${STOCK_DRAW_EASING}`;
        wrapper.style.left = `${toLeft}px`;
        wrapper.style.top = `${toTop}px`;
        flipper.style.transform = 'rotateY(180deg)';
      });

      setTimeout(() => {
        wrapper.remove();
        resolve();
      }, duration + 40);
    });
  }

  playStockRecycleAnimation(card, fromRect, toRect) {
    return new Promise((resolve) => {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        resolve();
        return;
      }

      const wrapper = document.createElement('div');
      wrapper.className = 'stock-draw-anim';
      wrapper.style.width = `${fromRect.width}px`;
      wrapper.style.height = `${fromRect.height}px`;
      wrapper.style.left = `${fromRect.left}px`;
      wrapper.style.top = `${fromRect.top}px`;

      const flipper = document.createElement('div');
      flipper.className = 'stock-draw-anim-flipper';
      flipper.style.transform = 'rotateY(180deg)';

      const back = createCardEl({ ...card, faceUp: false }, 'anim', 0);
      const front = createCardEl({ ...card, faceUp: true }, 'anim', 0);
      for (const el of [back, front]) {
        el.style.position = 'absolute';
        el.style.left = '0';
        el.style.top = '0';
        el.style.width = '100%';
        el.style.height = '100%';
      }
      front.classList.add('stock-draw-anim-front');

      flipper.append(back, front);
      wrapper.append(flipper);
      document.body.appendChild(wrapper);

      const duration = STOCK_DRAW_DURATION;
      const toLeft = toRect.left + (toRect.width - fromRect.width) / 2;
      const toTop = toRect.top + (toRect.height - fromRect.height) / 2;

      requestAnimationFrame(() => {
        this.sounds.playFlip();
        wrapper.style.transition = `left ${duration}ms ${STOCK_DRAW_EASING}, top ${duration}ms ${STOCK_DRAW_EASING}`;
        flipper.style.transition = `transform ${duration}ms ${STOCK_DRAW_EASING}`;
        wrapper.style.left = `${toLeft}px`;
        wrapper.style.top = `${toTop}px`;
        flipper.style.transform = 'rotateY(0deg)';
      });

      setTimeout(() => {
        wrapper.remove();
        resolve();
      }, duration + 40);
    });
  }

  async animateDrawFromStock() {
    if (this.animatingStock || this.animatingDeal || this.autoCompleting || this.animatingMove) return false;

    const g = this.game;
    if (g.stock.length === 0 && g.waste.length === 0) return false;
    if (g.stock.length === 0 && g.vegasMode) return false;

    if (g.stock.length === 0) {
      const card = { ...g.waste[g.waste.length - 1] };
      const fromRect = this.getPileCardRect('waste');
      const toRect = this.getPileInnerRect('stock');
      if (!fromRect || !toRect) return false;

      this.animatingStock = true;
      document.body.classList.add('is-stock-animating');

      g.drawFromStock();
      this.clearSelection();

      const skipAnim = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (skipAnim) {
        this.render();
        document.body.classList.remove('is-stock-animating');
        this.animatingStock = false;
        return true;
      }

      this.renderPile('waste', []);
      this.renderPile('stock', [], { stockDisplayCount: g.stock.length });

      await this.playStockRecycleAnimation(card, fromRect, toRect);
      document.body.classList.remove('is-stock-animating');
      this.animatingStock = false;
      this.render();
      return true;
    }

    const card = { ...g.stock[g.stock.length - 1] };
    const fromRect = this.getPileCardRect('stock');
    const toRect = this.getPileCardRect('waste') ?? this.getPileInnerRect('waste');
    if (!fromRect || !toRect) return false;

    const prevWasteLen = g.waste.length;

    this.animatingStock = true;
    document.body.classList.add('is-stock-animating');

    g.drawFromStock();
    this.clearSelection();

    const skipAnim = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (skipAnim) {
      this.render();
      if (g.lastFlip) this.sounds.playFlip();
      document.body.classList.remove('is-stock-animating');
      this.animatingStock = false;
      return true;
    }

    this.renderPile('stock', g.stock);
    this.renderWasteForStockDraw(prevWasteLen);

    await this.playStockDrawAnimation(card, fromRect, toRect);
    document.body.classList.remove('is-stock-animating');
    this.animatingStock = false;
    this.render();
    return true;
  }

  createGhost(stack, x, y) {
    const ghost = document.createElement('div');
    ghost.className = 'drag-ghost';
    const offset = getTableauStackOffset();

    stack.forEach((card, i) => {
      const el = createCardEl(card, 'ghost', i);
      el.style.top = `${i * offset}px`;
      ghost.appendChild(el);
    });

    ghost.style.left = `${x}px`;
    ghost.style.top = `${y}px`;
    return ghost;
  }

  renderTableauPile(pileId, cards, pileEl, offset) {
    const tops = computeTableauTops(cards, offset);
    const cardHeight = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--card-height')) || 62;
    let faceDownLayer = 0;

    cards.forEach((card, i) => {
      const layer = card.faceUp ? null : faceDownLayer++;
      const el = createCardEl(card, pileId, i, { faceDownLayer: layer });
      el.style.top = `${tops[i]}px`;
      pileEl.appendChild(el);
    });

    const pileHeight = cards.length ? tops[cards.length - 1] + cardHeight : cardHeight;
    pileEl.style.minHeight = `${pileHeight}px`;
    const pileOuter = pileEl.closest('.tableau-pile');
    if (pileOuter) pileOuter.style.minHeight = `${pileHeight}px`;
  }

  renderWastePile(pileId, cards, pileEl) {
    const visibleStart = Math.max(0, cards.length - 3);
    const topIndex = cards.length - 1;

    for (let i = visibleStart; i < cards.length; i++) {
      const el = createCardEl(cards[i], pileId, i);
      const depthFromTop = topIndex - i;
      el.style.setProperty('--waste-fan-index', String(2 - depthFromTop));
      if (i !== topIndex) {
        el.classList.add('waste-card-under');
      }
      pileEl.appendChild(el);
    }
  }

  renderWasteForStockDraw(prevWasteLen) {
    const pileId = 'waste';
    const pileEl = document.querySelector(`[data-pile="${pileId}"] .pile-inner`);
    if (!pileEl) return;

    pileEl.innerHTML = '';
    const cards = this.game.waste;
    const newLen = cards.length;
    const topIndex = newLen - 1;
    const step = getWasteFanStep();
    const prevVisibleStart = Math.max(0, prevWasteLen - 3);
    const visibleStart = Math.max(0, newLen - 3);
    const stationaryIndex = prevWasteLen >= 4
      ? prevWasteLen - 4
      : (prevWasteLen >= 3 ? 0 : -1);

    const zForFan = (fanIndex) => (stationaryIndex >= 0 ? 2 : 1) + fanIndex;

    const startShift = (el, fromFan, toFan) => {
      el.classList.add('waste-card-animating');
      el.style.transform = wasteFanTransform(fromFan, step);
      el.style.zIndex = String(zForFan(toFan));
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          el.style.transform = wasteFanTransform(toFan, step);
        });
      });
    };

    if (stationaryIndex >= 0 && stationaryIndex < newLen) {
      const el = createCardEl(cards[stationaryIndex], pileId, stationaryIndex);
      el.classList.add('waste-card-under');
      el.style.transform = wasteFanTransform(0, step);
      el.style.zIndex = '1';
      pileEl.appendChild(el);
    }

    for (let i = visibleStart; i < newLen; i++) {
      if (i === topIndex || i === stationaryIndex) continue;

      const el = createCardEl(cards[i], pileId, i);
      const depthFromTop = topIndex - i;
      const newFanIndex = 2 - depthFromTop;
      el.classList.add('waste-card-under');

      if (i >= prevVisibleStart && i < prevWasteLen) {
        const prevFanIndex = 2 - ((prevWasteLen - 1) - i);
        if (prevFanIndex !== newFanIndex) {
          startShift(el, prevFanIndex, newFanIndex);
          pileEl.appendChild(el);
          continue;
        }
      }

      el.style.setProperty('--waste-fan-index', String(newFanIndex));
      el.style.zIndex = String(zForFan(newFanIndex));
      pileEl.appendChild(el);
    }
  }

  renderPile(pileId, cards, options = {}) {
    const pileEl = document.querySelector(`[data-pile="${pileId}"] .pile-inner`);
    if (!pileEl) return;
    pileEl.innerHTML = '';

    const isTableau = pileId.startsWith('tableau-');
    const stackOffset = isTableau ? getTableauStackOffset() : null;

    if (pileId === 'stock') {
      const count = options.stockDisplayCount ?? cards.length;
      const canRecycle = cards.length === 0
        && this.game.waste.length > 0
        && !this.game.vegasMode;
      const stockPileEl = pileEl.closest('.stock-pile');
      if (stockPileEl) {
        stockPileEl.classList.toggle('stock-pile--recyclable', canRecycle);
        stockPileEl.setAttribute('aria-label', canRecycle ? '山札を戻す' : '山札');
      }
      if (cards.length) {
        const el = createCardEl(cards[cards.length - 1], pileId, cards.length - 1);
        pileEl.appendChild(el);
      } else if (canRecycle) {
        const hint = document.createElement('div');
        hint.className = 'stock-recycle-hint';
        hint.setAttribute('aria-hidden', 'true');
        hint.innerHTML = '<svg class="stock-recycle-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 9.74C4.46 10.97 4 12.43 4 14c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/></svg>';
        pileEl.appendChild(hint);
      }
      const countEl = document.createElement('span');
      countEl.className = 'stock-count';
      countEl.textContent = String(canRecycle ? this.game.waste.length : count);
      pileEl.appendChild(countEl);
      return;
    }

    if (pileId === 'waste') {
      this.renderWastePile(pileId, cards, pileEl);
      return;
    }

    if (isTableau) {
      this.renderTableauPile(pileId, cards, pileEl, stackOffset);
    } else {
      cards.forEach((card, i) => {
        const el = createCardEl(card, pileId, i);
        pileEl.appendChild(el);
      });
    }

    if (options.placeholder && !cards.length) {
      const ph = document.createElement('div');
      ph.className = 'card-placeholder';
      if (options.suit) {
        ph.dataset.suit = options.suit;
        ph.innerHTML = `<span class="suit">${SUIT_SYMBOL[options.suit]}</span>`;
      }
      pileEl.appendChild(ph);
    }
  }

  renderDealProgress(visibleCounts) {
    fitLayout();
    const g = this.game;
    const dealtCount = visibleCounts.reduce((a, b) => a + b, 0);
    const stockDisplayCount = g.stock.length + 28 - dealtCount;

    this.renderPile('stock', g.stock, { stockDisplayCount });
    this.renderPile('waste', []);
    g.foundations.forEach((pile, i) => {
      this.renderPile(`foundation-${i}`, pile, {
        placeholder: true,
        suit: SUITS[i],
      });
    });
    g.tableau.forEach((pile, i) => {
      this.renderPile(`tableau-${i}`, pile.slice(0, visibleCounts[i]));
    });

    this.statMoves.textContent = `${g.moves} 手`;
    this.statTime.textContent = formatTime(g.elapsedSeconds());
    this.updateBottomNav();
  }

  render() {
    fitLayout();
    const g = this.game;
    this.renderPile('stock', g.stock);
    this.renderPile('waste', g.waste);
    g.foundations.forEach((pile, i) => {
      this.renderPile(`foundation-${i}`, pile, {
        placeholder: true,
        suit: SUITS[i],
      });
    });
    g.tableau.forEach((pile, i) => this.renderPile(`tableau-${i}`, pile));

    this.statMoves.textContent = `${g.moves} 手`;
    this.statTime.textContent = formatTime(g.elapsedSeconds());
    this.updateBottomNav();
    this.updateAutoCompleteButton();
    this.updateScoreDisplay();
    this.persistGameSave();
  }

  showWin() {
    this.game.pausePlayTime();
    const secs = this.game.elapsedSeconds();
    if (!this.winRecorded) {
      const mode = resolveClearMode(getActiveGameMode(this.game));
      saveClearRecord({
        clearedAt: Date.now(),
        seconds: secs,
        moves: this.game.moves,
        mode,
      });
      recordGameCleared(mode, { moves: this.game.moves, seconds: secs });
      this.winRecorded = true;
    }
    clearSavedGame();
    this.persistVegasScoreIfNeeded();
    let stats = `${this.game.moves} 手 · ${formatTime(secs)}`;
    if (this.game.vegasMode) {
      stats += ` · ${formatVegasScore(this.game.score)}`;
    }
    this.winStats.textContent = stats;
    this.winOverlay.classList.remove('hidden');
  }
}

new SolitaireUI();
