import { selectDealLayout, selectDealLayoutAsync } from './deal-quality.js';
import { canPlaceOnTableau, canPlaceOnFoundation } from './rules.js';

export class SolitaireGame {
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
    if (fromInfo.type === 'foundation') {
      this.score -= 5 * stack.length;
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
