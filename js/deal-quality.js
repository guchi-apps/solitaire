import { createDeck, shuffle, canPlaceOnTableau, canPlaceOnFoundation } from './rules.js';

export const VEGAS_ENTRY_FEE = 52;
export const VEGAS_FOUNDATION_REWARD = 5;

export const DEAL_DIFFICULTY_SCORE_TARGETS = {
  easy: 10,
  normal: 0,
  hard: -25,
  veryHard: null,
};

const MAX_SEARCH_ATTEMPTS = 200;
/** 候補をランダム選択したときの見積もり点数の目標標準偏差 */
export const TARGET_SCORE_STDEV = 8;
/** 一様分布で標準偏差 s になる半幅: s * sqrt(3) */
export const SCORE_BAND_HALF_WIDTH = TARGET_SCORE_STDEV * Math.sqrt(3);
const MIN_BAND_CANDIDATES = 2;

function cloneCard(card) {
  return { ...card };
}

function cloneLayout(layout) {
  return {
    stock: layout.stock.map(cloneCard),
    waste: layout.waste.map(cloneCard),
    foundations: layout.foundations.map((pile) => pile.map(cloneCard)),
    tableau: layout.tableau.map((pile) => pile.map(cloneCard)),
  };
}

export function buildLayoutFromDeck(deck) {
  const cards = deck.map(cloneCard);
  const tableau = [[], [], [], [], [], [], []];
  for (let col = 0; col < 7; col++) {
    for (let row = 0; row <= col; row++) {
      const card = cards.pop();
      card.faceUp = row === col;
      tableau[col].push(card);
    }
  }
  return {
    stock: cards.map((c) => ({ ...c, faceUp: false })),
    waste: [],
    foundations: [[], [], [], []],
    tableau,
  };
}

function getPile(state, pileInfo) {
  switch (pileInfo.type) {
    case 'stock': return state.stock;
    case 'waste': return state.waste;
    case 'foundation': return state.foundations[pileInfo.index];
    case 'tableau': return state.tableau[pileInfo.index];
    default: return [];
  }
}

function getMovableStack(state, pileInfo, cardIndex) {
  const pile = getPile(state, pileInfo);
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

function canMove(state, stack, destInfo) {
  if (!stack?.length) return false;
  const card = stack[0];
  const dest = getPile(state, destInfo);

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

function moveCards(state, fromInfo, cardIndex, toInfo) {
  const stack = getMovableStack(state, fromInfo, cardIndex);
  if (!stack || !canMove(state, stack, toInfo)) return false;

  const from = getPile(state, fromInfo);
  const to = getPile(state, toInfo);
  from.splice(cardIndex, stack.length);
  to.push(...stack);

  if (fromInfo.type === 'tableau' && from.length) {
    const last = from[from.length - 1];
    if (!last.faceUp) last.faceUp = true;
  }

  return true;
}

function drawFromStock(state, vegasMode) {
  if (state.stock.length === 0) {
    if (state.waste.length === 0) return false;
    if (vegasMode) return false;
    state.stock = state.waste.reverse().map((c) => ({ ...c, faceUp: false }));
    state.waste = [];
    return true;
  }

  const card = state.stock.pop();
  card.faceUp = true;
  state.waste.push(card);
  return true;
}

function scoreTableauMove(state, fromInfo, cardIndex, destInfo) {
  let score = 0;
  const stack = getMovableStack(state, fromInfo, cardIndex);
  const destPile = getPile(state, destInfo);
  if (!stack) return score;

  if (!destPile.length && stack[0].value === 13) score += 100;
  if (fromInfo.type === 'waste') score += 30;
  if (fromInfo.type === 'tableau') {
    const fromPile = getPile(state, fromInfo);
    const below = fromPile[cardIndex - 1];
    if (below && !below.faceUp) score += 80;
  }

  return score - destInfo.index;
}

function tryFoundationMove(state) {
  if (state.waste.length) {
    const from = { type: 'waste' };
    const index = state.waste.length - 1;
    const stack = getMovableStack(state, from, index);
    if (stack?.length === 1) {
      for (let i = 0; i < 4; i++) {
        const dest = { type: 'foundation', index: i };
        if (canMove(state, stack, dest) && moveCards(state, from, index, dest)) {
          return true;
        }
      }
    }
  }

  for (let col = 0; col < 7; col++) {
    const pile = state.tableau[col];
    if (!pile.length) continue;
    const index = pile.length - 1;
    const from = { type: 'tableau', index: col };
    const stack = getMovableStack(state, from, index);
    if (stack?.length !== 1) continue;
    for (let i = 0; i < 4; i++) {
      const dest = { type: 'foundation', index: i };
      if (canMove(state, stack, dest) && moveCards(state, from, index, dest)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * 場札から場札への移動が「先へ進む手」かを判定する。
 * 裏向きカードをめくる手と、列を空にする手（Kは空列間の往復になるので除く）だけを許可し、
 * 同じ局面へ戻れる往復手でシミュレーターが空転しないようにする。
 */
function isProgressingTableauSource(state, fromInfo, cardIndex, stack) {
  if (cardIndex === 0) return stack[0].value !== 13;
  const below = state.tableau[fromInfo.index][cardIndex - 1];
  return !below.faceUp;
}

function tryTableauMove(state) {
  let best = null;
  let bestScore = -Infinity;

  const trySource = (fromInfo, index) => {
    const stack = getMovableStack(state, fromInfo, index);
    if (!stack) return;
    if (fromInfo.type === 'tableau' && !isProgressingTableauSource(state, fromInfo, index, stack)) return;
    for (let col = 0; col < 7; col++) {
      if (fromInfo.type === 'tableau' && fromInfo.index === col) continue;
      const dest = { type: 'tableau', index: col };
      if (!canMove(state, stack, dest)) continue;
      const score = scoreTableauMove(state, fromInfo, index, dest);
      if (score > bestScore) {
        bestScore = score;
        best = { from: fromInfo, index, dest };
      }
    }
  };

  if (state.waste.length) {
    trySource({ type: 'waste' }, state.waste.length - 1);
  }

  for (let col = 0; col < 7; col++) {
    const pile = state.tableau[col];
    const from = { type: 'tableau', index: col };
    for (let index = pile.length - 1; index >= 0; index--) {
      if (!pile[index].faceUp) break;
      trySource(from, index);
    }
  }

  if (!best) return false;
  return moveCards(state, best.from, best.index, best.dest);
}

/** `stats` を渡すと、消費した手数を `stats.steps` に書き込む（空転していないことの検証用） */
export function countFoundationMoves(layout, vegasMode = false, stats = null) {
  const state = cloneLayout(layout);
  let foundationMoves = 0;
  let stagnantRounds = 0;
  let movedSinceRecycle = true;
  const maxSteps = 3000;
  let steps = 0;

  while (stagnantRounds < 2 && steps < maxSteps) {
    let progressed = false;

    while (tryFoundationMove(state)) {
      foundationMoves++;
      progressed = true;
      steps++;
      movedSinceRecycle = true;
    }

    if (tryTableauMove(state)) {
      progressed = true;
      stagnantRounds = 0;
      movedSinceRecycle = true;
      steps++;
      continue;
    }

    const recycling = state.stock.length === 0 && state.waste.length > 0;
    // 山札を1周させても場札・組札への手が1つも無ければ、これ以上進まない
    if (recycling && !vegasMode && !movedSinceRecycle) break;
    if (drawFromStock(state, vegasMode)) {
      progressed = true;
      stagnantRounds = 0;
      steps++;
      if (recycling) movedSinceRecycle = false;
      continue;
    }

    if (!progressed) stagnantRounds++;
    else stagnantRounds = 0;
  }

  if (stats) stats.steps = steps;
  return foundationMoves;
}

function evaluateShuffledDeal(vegasMode) {
  const deck = shuffle(createDeck());
  const layout = buildLayoutFromDeck(deck);
  const moves = countFoundationMoves(layout, vegasMode);
  return { layout, moves };
}

export function estimateVegasScoreFromFoundationMoves(moves) {
  return VEGAS_FOUNDATION_REWARD * moves - VEGAS_ENTRY_FEE;
}

export function foundationMovesFromVegasScore(score) {
  return (score + VEGAS_ENTRY_FEE) / VEGAS_FOUNDATION_REWARD;
}

export function getDealDifficultyScoreTarget(dealDifficulty) {
  if (dealDifficulty === 'veryHard') return null;
  return DEAL_DIFFICULTY_SCORE_TARGETS[dealDifficulty] ?? DEAL_DIFFICULTY_SCORE_TARGETS.normal;
}

function distinctBandScoreCount(candidates) {
  return new Set(candidates.map((candidate) => estimateVegasScoreFromFoundationMoves(candidate.moves))).size;
}

function isBandSearchComplete(candidates) {
  return candidates.length >= MIN_BAND_CANDIDATES
    && distinctBandScoreCount(candidates) >= 2;
}

function pickLayoutFromBand(candidates) {
  const byScore = new Map();
  for (const candidate of candidates) {
    const score = estimateVegasScoreFromFoundationMoves(candidate.moves);
    if (!byScore.has(score)) byScore.set(score, []);
    byScore.get(score).push(candidate);
  }
  const scoreKeys = [...byScore.keys()];
  const pool = byScore.get(scoreKeys[Math.floor(Math.random() * scoreKeys.length)]);
  return pool[Math.floor(Math.random() * pool.length)].layout;
}

function resolveDealSearchResult({ bandCandidates, best }) {
  if (bandCandidates.length >= MIN_BAND_CANDIDATES) {
    return pickLayoutFromBand(bandCandidates);
  }
  if (bandCandidates.length > 0) {
    return bandCandidates[0].layout;
  }
  return best.layout;
}

function pickDealFromSearch({ scoreTarget, vegasMode }) {
  const bandCandidates = [];
  let best = null;
  let bestScoreDistance = Infinity;

  for (let attempts = 0; attempts < MAX_SEARCH_ATTEMPTS; attempts++) {
    const candidate = evaluateShuffledDeal(vegasMode);
    const estimatedScore = estimateVegasScoreFromFoundationMoves(candidate.moves);
    const scoreDistance = Math.abs(estimatedScore - scoreTarget);

    if (scoreDistance < bestScoreDistance) {
      bestScoreDistance = scoreDistance;
      best = candidate;
    }

    if (scoreDistance <= SCORE_BAND_HALF_WIDTH) {
      bandCandidates.push(candidate);
      if (isBandSearchComplete(bandCandidates)) {
        break;
      }
    }
  }

  return resolveDealSearchResult({ bandCandidates, best });
}

const DEAL_SEARCH_YIELD_EVERY = 4;

function yieldToMain() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

export function selectDealLayout({ vegasMode = false, dealDifficulty = 'normal' } = {}) {
  if (dealDifficulty === 'veryHard') {
    return evaluateShuffledDeal(vegasMode).layout;
  }

  const scoreTarget = getDealDifficultyScoreTarget(dealDifficulty);
  return pickDealFromSearch({ scoreTarget, vegasMode });
}

export async function selectDealLayoutAsync({ vegasMode = false, dealDifficulty = 'normal' } = {}) {
  if (dealDifficulty === 'veryHard') {
    return evaluateShuffledDeal(vegasMode).layout;
  }

  const scoreTarget = getDealDifficultyScoreTarget(dealDifficulty);
  const bandCandidates = [];
  let best = null;
  let bestScoreDistance = Infinity;

  for (let attempts = 0; attempts < MAX_SEARCH_ATTEMPTS; attempts++) {
    const candidate = evaluateShuffledDeal(vegasMode);
    const estimatedScore = estimateVegasScoreFromFoundationMoves(candidate.moves);
    const scoreDistance = Math.abs(estimatedScore - scoreTarget);

    if (scoreDistance < bestScoreDistance) {
      bestScoreDistance = scoreDistance;
      best = candidate;
    }

    if (scoreDistance <= SCORE_BAND_HALF_WIDTH) {
      bandCandidates.push(candidate);
      if (isBandSearchComplete(bandCandidates)) {
        break;
      }
    }

    if (attempts % DEAL_SEARCH_YIELD_EVERY === DEAL_SEARCH_YIELD_EVERY - 1) {
      await yieldToMain();
    }
  }

  return resolveDealSearchResult({ bandCandidates, best });
}
