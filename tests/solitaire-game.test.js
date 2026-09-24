import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SolitaireGame } from '../js/solitaire-game.js';

const card = (suit, value, faceUp = true) => ({ suit, value, rank: String(value), faceUp });

function makeGame(overrides = {}) {
  const game = new SolitaireGame();
  Object.assign(game, overrides);
  return game;
}

describe('SolitaireGame moveCards', () => {
  it('moves a single card between tableau piles and counts the move', () => {
    const game = makeGame();
    game.tableau[0] = [card('hearts', 5)];
    game.tableau[1] = [card('spades', 6)];
    assert.equal(game.moveCards({ type: 'tableau', index: 0 }, 0, { type: 'tableau', index: 1 }), true);
    assert.equal(game.tableau[0].length, 0);
    assert.equal(game.tableau[1].length, 2);
    assert.equal(game.moves, 1);
  });

  it('moves a whole valid stack and flips the newly exposed card', () => {
    const game = makeGame();
    game.tableau[0] = [card('clubs', 9, false), card('hearts', 5), card('spades', 4)];
    game.tableau[1] = [card('spades', 6)];
    assert.equal(game.moveCards({ type: 'tableau', index: 0 }, 1, { type: 'tableau', index: 1 }), true);
    assert.equal(game.tableau[1].length, 3);
    assert.equal(game.tableau[0][0].faceUp, true);
    assert.equal(game.lastFlip, true);
  });

  it('rejects illegal moves without changing state or history', () => {
    const game = makeGame();
    game.tableau[0] = [card('hearts', 5)];
    game.tableau[1] = [card('diamonds', 6)];
    assert.equal(game.moveCards({ type: 'tableau', index: 0 }, 0, { type: 'tableau', index: 1 }), false);
    assert.equal(game.tableau[0].length, 1);
    assert.equal(game.moves, 0);
    assert.equal(game.history.length, 0);
  });

  it('only places a king on an empty tableau column', () => {
    const game = makeGame();
    game.tableau[0] = [card('hearts', 12)];
    game.tableau[1] = [card('spades', 13)];
    assert.equal(game.moveCards({ type: 'tableau', index: 0 }, 0, { type: 'tableau', index: 2 }), false);
    assert.equal(game.moveCards({ type: 'tableau', index: 1 }, 0, { type: 'tableau', index: 2 }), true);
  });

  it('builds foundations from ace in suit order and rejects stacks', () => {
    const game = makeGame();
    game.tableau[0] = [card('hearts', 2), card('spades', 1)];
    assert.equal(game.moveCards({ type: 'tableau', index: 0 }, 0, { type: 'foundation', index: 0 }), false);
    assert.equal(game.moveCards({ type: 'tableau', index: 0 }, 1, { type: 'foundation', index: 3 }), true);
    assert.equal(game.moveCards({ type: 'tableau', index: 0 }, 0, { type: 'foundation', index: 0 }), false);
  });

  it('sets won when all foundations are complete', () => {
    const game = makeGame();
    const suits = ['hearts', 'diamonds', 'clubs', 'spades'];
    game.foundations = suits.map((s) => Array.from({ length: 12 }, (_, i) => card(s, i + 1)));
    game.waste = [card('spades', 13)];
    game.tableau[0] = [card('hearts', 13)];
    game.tableau[1] = [card('diamonds', 13)];
    game.tableau[2] = [card('clubs', 13)];
    assert.equal(game.moveCards({ type: 'tableau', index: 0 }, 0, { type: 'foundation', index: 0 }), true);
    assert.equal(game.won, false);
    game.moveCards({ type: 'tableau', index: 1 }, 0, { type: 'foundation', index: 1 });
    game.moveCards({ type: 'tableau', index: 2 }, 0, { type: 'foundation', index: 2 });
    game.moveCards({ type: 'waste' }, 0, { type: 'foundation', index: 3 });
    assert.equal(game.won, true);
  });
});

describe('SolitaireGame Vegas scoring', () => {
  it('beginVegasRound charges the entry fee, carrying the stored score when cumulative', () => {
    const game = makeGame({ vegasMode: true });
    game.beginVegasRound({});
    assert.equal(game.score, -52);
    game.beginVegasRound({ cumulativeVegas: true, storedVegasScore: 100 });
    assert.equal(game.score, 48);
    assert.equal(game.vegasCumulativeBase, 100);
  });

  it('beginVegasRound resets score to 0 outside Vegas mode', () => {
    const game = makeGame({ score: 30 });
    game.beginVegasRound({});
    assert.equal(game.score, 0);
  });

  it('awards +5 for a card to foundation and -5 when it is taken back', () => {
    const game = makeGame({ vegasMode: true, score: -52 });
    game.tableau[0] = [card('hearts', 1)];
    game.tableau[1] = [card('spades', 2)];
    game.moveCards({ type: 'tableau', index: 0 }, 0, { type: 'foundation', index: 0 });
    assert.equal(game.score, -47);
    game.moveCards({ type: 'foundation', index: 0 }, 0, { type: 'tableau', index: 1 });
    assert.equal(game.score, -52);
  });

  it('does not change score outside Vegas mode', () => {
    const game = makeGame();
    game.tableau[0] = [card('hearts', 1)];
    game.moveCards({ type: 'tableau', index: 0 }, 0, { type: 'foundation', index: 0 });
    assert.equal(game.score, 0);
  });
});

describe('SolitaireGame drawFromStock', () => {
  it('draws a card face-up to waste', () => {
    const game = makeGame();
    game.stock = [card('hearts', 3, false), card('spades', 4, false)];
    assert.equal(game.drawFromStock(), true);
    assert.equal(game.waste.length, 1);
    assert.equal(game.waste[0].value, 4);
    assert.equal(game.waste[0].faceUp, true);
    assert.equal(game.moves, 1);
  });

  it('recycles waste into stock face-down in normal mode', () => {
    const game = makeGame();
    game.waste = [card('hearts', 3), card('spades', 4)];
    assert.equal(game.drawFromStock(), true);
    assert.equal(game.waste.length, 0);
    assert.deepEqual(game.stock.map((c) => c.value), [4, 3]);
    assert.ok(game.stock.every((c) => !c.faceUp));
  });

  it('refuses to recycle waste in Vegas mode and leaves no history entry', () => {
    const game = makeGame({ vegasMode: true });
    game.waste = [card('hearts', 3)];
    assert.equal(game.drawFromStock(), false);
    assert.equal(game.waste.length, 1);
    assert.equal(game.stock.length, 0);
    assert.equal(game.moves, 0);
    assert.equal(game.history.length, 0);
  });

  it('returns false when both stock and waste are empty', () => {
    const game = makeGame();
    assert.equal(game.drawFromStock(), false);
    assert.equal(game.history.length, 0);
  });
});

describe('SolitaireGame undo', () => {
  it('returns false when there is no history', () => {
    assert.equal(makeGame().undo(), false);
  });

  it('restores piles, moves and score after a move', () => {
    const game = makeGame({ vegasMode: true, score: -52 });
    game.tableau[0] = [card('clubs', 9, false), card('hearts', 1)];
    game.moveCards({ type: 'tableau', index: 0 }, 1, { type: 'foundation', index: 0 });
    assert.equal(game.score, -47);
    assert.equal(game.undo(), true);
    assert.equal(game.score, -52);
    assert.equal(game.moves, 0);
    assert.equal(game.foundations[0].length, 0);
    assert.equal(game.tableau[0].length, 2);
    assert.equal(game.tableau[0][0].faceUp, false);
  });

  it('restores stock and waste after a draw', () => {
    const game = makeGame();
    game.stock = [card('hearts', 3, false)];
    game.drawFromStock();
    game.undo();
    assert.equal(game.stock.length, 1);
    assert.equal(game.stock[0].faceUp, false);
    assert.equal(game.waste.length, 0);
    assert.equal(game.moves, 0);
  });

  it('keeps at most 100 history entries', () => {
    const game = makeGame();
    game.stock = Array.from({ length: 120 }, () => card('hearts', 3, false));
    for (let i = 0; i < 110; i++) game.drawFromStock();
    assert.equal(game.history.length, 100);
  });
});
