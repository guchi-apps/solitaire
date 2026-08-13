import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import {
  serializeGame,
  hasResumableSave,
  loadSavedGame,
  saveGame,
  clearSavedGame,
  applySavedGame,
  getSavedGameSummary,
} from '../js/save.js';
import { installLocalStorageMock } from './helpers/local-storage.js';

const STORAGE_KEY = 'solitaire-save';

function makeCards(count) {
  return Array.from({ length: count }, (_, i) => ({ rank: (i % 13) + 1, suit: 'spades' }));
}

function makeGame(overrides = {}) {
  return {
    stock: makeCards(24),
    waste: [],
    foundations: [[], [], [], []],
    tableau: [
      makeCards(1),
      makeCards(2),
      makeCards(3),
      makeCards(4),
      makeCards(5),
      makeCards(6),
      makeCards(7),
    ],
    moves: 3,
    won: false,
    score: 10,
    vegasCumulativeBase: 0,
    cumulativeVegas: false,
    dealDifficulty: 'normal',
    history: [{ moves: 0 }],
    vegasMode: false,
    getPlayTimeMs: () => 12345,
    restore: function restore(snap) {
      this.stock = snap.stock;
      this.waste = snap.waste;
      this.foundations = snap.foundations;
      this.tableau = snap.tableau;
      this.moves = snap.moves;
      this.won = snap.won;
      this.score = snap.score ?? 0;
    },
    ...overrides,
  };
}

beforeEach(() => {
  installLocalStorageMock();
});

describe('serializeGame', () => {
  it('produces a plain-JSON snapshot of the game state', () => {
    const game = makeGame();
    const data = serializeGame(game);

    assert.equal(data.version, 1);
    assert.equal(typeof data.savedAt, 'number');
    assert.deepEqual(data.stock, game.stock);
    assert.deepEqual(data.tableau, game.tableau);
    assert.equal(data.moves, 3);
    assert.equal(data.won, false);
    assert.equal(data.score, 10);
    assert.equal(data.playTimeMs, 12345);
    assert.equal(data.vegasMode, false);
    assert.equal(data.cumulativeVegas, false);
    assert.equal(data.dealDifficulty, 'normal');
  });

  it('defaults optional fields when missing from the game', () => {
    const game = makeGame({ vegasCumulativeBase: undefined, cumulativeVegas: undefined, dealDifficulty: undefined });
    const data = serializeGame(game);

    assert.equal(data.vegasCumulativeBase, 0);
    assert.equal(data.cumulativeVegas, false);
    assert.equal(data.dealDifficulty, 'normal');
  });

  it('returns a deep clone independent from the source game', () => {
    const game = makeGame();
    const data = serializeGame(game);
    data.tableau[0][0].rank = 99;
    assert.notEqual(game.tableau[0][0].rank, 99);
  });
});

describe('hasResumableSave', () => {
  it('accepts a full 52-card unfinished save', () => {
    const data = serializeGame(makeGame());
    assert.equal(hasResumableSave(data), true);
  });

  it('rejects missing data', () => {
    assert.equal(hasResumableSave(null), false);
    assert.equal(hasResumableSave(undefined), false);
  });

  it('rejects a mismatched save version', () => {
    const data = serializeGame(makeGame());
    data.version = 999;
    assert.equal(hasResumableSave(data), false);
  });

  it('rejects a won game', () => {
    const data = serializeGame(makeGame({ won: true }));
    assert.equal(hasResumableSave(data), false);
  });

  it('rejects a save without exactly 7 tableau piles', () => {
    const data = serializeGame(makeGame());
    data.tableau = data.tableau.slice(0, 6);
    assert.equal(hasResumableSave(data), false);
  });

  it('rejects a save missing cards', () => {
    const data = serializeGame(makeGame());
    data.waste = [];
    data.stock = data.stock.slice(1);
    assert.equal(hasResumableSave(data), false);
  });
});

describe('saveGame / loadSavedGame / clearSavedGame', () => {
  it('persists an unfinished game and reloads it', () => {
    const game = makeGame();
    saveGame(game);

    const raw = localStorage.getItem(STORAGE_KEY);
    assert.ok(raw);

    const loaded = loadSavedGame();
    assert.ok(loaded);
    assert.equal(loaded.moves, 3);
    assert.equal(loaded.playTimeMs, 12345);
  });

  it('clears any existing save instead of persisting a won game', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeGame(makeGame())));
    saveGame(makeGame({ won: true }));
    assert.equal(localStorage.getItem(STORAGE_KEY), null);
  });

  it('loadSavedGame returns null when nothing is stored', () => {
    assert.equal(loadSavedGame(), null);
  });

  it('loadSavedGame returns null for corrupted JSON', () => {
    localStorage.setItem(STORAGE_KEY, '{not json');
    assert.equal(loadSavedGame(), null);
  });

  it('loadSavedGame returns null for a non-resumable save', () => {
    const data = serializeGame(makeGame({ won: true }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    assert.equal(loadSavedGame(), null);
  });

  it('clearSavedGame removes the stored save', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeGame(makeGame())));
    clearSavedGame();
    assert.equal(localStorage.getItem(STORAGE_KEY), null);
  });
});

describe('applySavedGame', () => {
  it('restores game state and metadata from a save', () => {
    const game = makeGame({ vegasMode: true, cumulativeVegas: true, dealDifficulty: 'hard' });
    const saved = serializeGame(makeGame({
      moves: 9,
      score: 42,
      vegasMode: true,
      cumulativeVegas: true,
      dealDifficulty: 'veryHard',
      vegasCumulativeBase: 7,
      history: [{ moves: 1 }, { moves: 2 }],
      getPlayTimeMs: () => 5000,
    }));

    applySavedGame(game, saved);

    assert.equal(game.moves, 9);
    assert.equal(game.score, 42);
    assert.deepEqual(game.history, [{ moves: 1 }, { moves: 2 }]);
    assert.equal(game.playTimeMs, 5000);
    assert.equal(game.playTimeAnchor, null);
    assert.equal(game.vegasMode, true);
    assert.equal(game.cumulativeVegas, true);
    assert.equal(game.dealDifficulty, 'veryHard');
    assert.equal(game.vegasCumulativeBase, 7);
  });

  it('falls back to defaults for missing optional fields', () => {
    const game = makeGame();
    const saved = serializeGame(makeGame());
    delete saved.vegasMode;
    delete saved.cumulativeVegas;
    delete saved.dealDifficulty;
    delete saved.vegasCumulativeBase;

    applySavedGame(game, saved);

    assert.equal(game.vegasMode, false);
    assert.equal(game.cumulativeVegas, false);
    assert.equal(game.dealDifficulty, 'normal');
  });

  it('derives playTimeMs from startTime/savedAt when playTimeMs is absent', () => {
    const game = makeGame();
    const saved = serializeGame(makeGame());
    delete saved.playTimeMs;
    saved.startTime = 1000;
    saved.savedAt = 4500;

    applySavedGame(game, saved);

    assert.equal(game.playTimeMs, 3500);
  });

  it('deep clones history so the game history is independent from the save', () => {
    const game = makeGame();
    const saved = serializeGame(makeGame({ history: [{ moves: 1 }] }));

    applySavedGame(game, saved);
    game.history[0].moves = 99;

    assert.notEqual(saved.history[0].moves, 99);
  });
});

describe('getSavedGameSummary', () => {
  it('reports moves and elapsed seconds from playTimeMs', () => {
    const saved = serializeGame(makeGame({ moves: 7 }));
    saved.playTimeMs = 65999;

    const summary = getSavedGameSummary(saved);

    assert.equal(summary.moves, 7);
    assert.equal(summary.elapsed, 65);
  });

  it('defaults moves to 0 when missing', () => {
    const saved = serializeGame(makeGame());
    delete saved.moves;

    assert.equal(getSavedGameSummary(saved).moves, 0);
  });

  it('falls back to startTime/savedAt when playTimeMs is missing', () => {
    const saved = serializeGame(makeGame());
    delete saved.playTimeMs;
    saved.startTime = 1000;
    saved.savedAt = 4000;

    assert.equal(getSavedGameSummary(saved).elapsed, 3);
  });

  it('returns 0 elapsed when no timing information is available', () => {
    const saved = serializeGame(makeGame());
    delete saved.playTimeMs;

    assert.equal(getSavedGameSummary(saved).elapsed, 0);
  });
});
