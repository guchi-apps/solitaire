import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildLayoutFromDeck,
  countFoundationMoves,
  selectDealLayout,
  estimateVegasScoreFromFoundationMoves,
  foundationMovesFromVegasScore,
  getDealDifficultyScoreTarget,
  DEAL_DIFFICULTY_SCORE_TARGETS,
  SCORE_BAND_HALF_WIDTH,
} from '../js/deal-quality.js';
import { createDeck, shuffle } from '../js/rules.js';

describe('countFoundationMoves', () => {
  it('counts foundation placements during simulated play', () => {
    const deck = createDeck();
    const layout = buildLayoutFromDeck(deck);
    const moves = countFoundationMoves(layout, true);
    assert.equal(typeof moves, 'number');
    assert.ok(moves >= 0);
  });

  it('does not spin on reversible tableau moves (stays under the step cap)', () => {
    for (const vegas of [false, true]) {
      let capped = 0;
      for (let i = 0; i < 100; i++) {
        const layout = buildLayoutFromDeck(shuffle(createDeck()));
        const stats = {};
        countFoundationMoves(layout, vegas, stats);
        if (stats.steps >= 3000) capped++;
      }
      assert.equal(capped, 0, `vegas=${vegas}: ${capped}/100 deals hit the step cap`);
    }
  });

  it('does not shuttle a king between empty columns', () => {
    const king = { suit: 'spades', value: 13, faceUp: true };
    const layout = {
      stock: [],
      waste: [],
      foundations: [[], [], [], []],
      tableau: [[king], [], [], [], [], [], []],
    };
    const stats = {};
    countFoundationMoves(layout, true, stats);
    assert.ok(stats.steps < 10, `steps=${stats.steps}`);
  });
});

describe('deal difficulty scoring', () => {
  it('maps vegas score targets to foundation moves', () => {
    assert.equal(estimateVegasScoreFromFoundationMoves(12), 8);
    assert.equal(estimateVegasScoreFromFoundationMoves(10.4), 0);
    assert.equal(estimateVegasScoreFromFoundationMoves(5), -27);
    assert.equal(foundationMovesFromVegasScore(10), 12.4);
    assert.equal(foundationMovesFromVegasScore(0), 10.4);
    assert.equal(foundationMovesFromVegasScore(-25), 5.4);
  });

  it('exposes configured score targets', () => {
    assert.equal(getDealDifficultyScoreTarget('easy'), DEAL_DIFFICULTY_SCORE_TARGETS.easy);
    assert.equal(getDealDifficultyScoreTarget('normal'), 0);
    assert.equal(getDealDifficultyScoreTarget('hard'), -25);
    assert.equal(getDealDifficultyScoreTarget('veryHard'), null);
  });

  it('uses a score band sized for roughly target stdev 8', () => {
    assert.ok(SCORE_BAND_HALF_WIDTH > 13);
    assert.ok(SCORE_BAND_HALF_WIDTH < 15);
  });
});

describe('selectDealLayout', () => {
  it('returns a valid layout for very hard mode', () => {
    const layout = selectDealLayout({ vegasMode: true, dealDifficulty: 'veryHard' });
    assert.ok(layout.tableau.length === 7);
    assert.ok(layout.stock.length === 24);
  });

  it('targets higher estimated scores for easy than hard', () => {
    const easyLayout = selectDealLayout({ vegasMode: true, dealDifficulty: 'easy' });
    const hardLayout = selectDealLayout({ vegasMode: true, dealDifficulty: 'hard' });
    const easyScore = estimateVegasScoreFromFoundationMoves(countFoundationMoves(easyLayout, true));
    const hardScore = estimateVegasScoreFromFoundationMoves(countFoundationMoves(hardLayout, true));
    assert.ok(easyScore > hardScore);
  });

  it('varies hard deals within the score band', () => {
    const scores = new Set();
    for (let i = 0; i < 8; i++) {
      const layout = selectDealLayout({ vegasMode: true, dealDifficulty: 'hard' });
      scores.add(estimateVegasScoreFromFoundationMoves(countFoundationMoves(layout, true)));
    }
    assert.ok(scores.size > 1);
  });
});
