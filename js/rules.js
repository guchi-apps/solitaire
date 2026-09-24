export const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

const RED_SUITS = new Set(['hearts', 'diamonds']);

export function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (let i = 0; i < RANKS.length; i++) {
      deck.push({ suit, rank: RANKS[i], value: i + 1, faceUp: false });
    }
  }
  return deck;
}

export function shuffle(deck) {
  const arr = [...deck];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function cardColor(card) {
  return RED_SUITS.has(card.suit) ? 'red' : 'black';
}

export function canPlaceOnTableau(card, targetCard) {
  if (!targetCard) return card.value === 13;
  if (cardColor(card) === cardColor(targetCard)) return false;
  return card.value === targetCard.value - 1;
}

export function canPlaceOnFoundation(card, foundation, foundationIndex) {
  if (card.suit !== SUITS[foundationIndex]) return false;
  if (!foundation.length) return card.value === 1;
  const top = foundation[foundation.length - 1];
  return card.value === top.value + 1;
}

export function parsePileId(id) {
  if (id === 'stock') return { type: 'stock' };
  if (id === 'waste') return { type: 'waste' };
  if (id.startsWith('foundation-')) return { type: 'foundation', index: Number(id.split('-')[1]) };
  if (id.startsWith('tableau-')) return { type: 'tableau', index: Number(id.split('-')[1]) };
  return null;
}

export function pileIdFromInfo(info) {
  if (info.type === 'stock') return 'stock';
  if (info.type === 'waste') return 'waste';
  if (info.type === 'foundation') return `foundation-${info.index}`;
  if (info.type === 'tableau') return `tableau-${info.index}`;
  return '';
}

/** 盤面（stock / waste / foundations / tableau を持つオブジェクト）から山を引く */
export function getPile(state, pileInfo) {
  switch (pileInfo.type) {
    case 'stock': return state.stock;
    case 'waste': return state.waste;
    case 'foundation': return state.foundations[pileInfo.index];
    case 'tableau': return state.tableau[pileInfo.index];
    default: return [];
  }
}

export function getMovableStack(state, pileInfo, cardIndex) {
  const pile = getPile(state, pileInfo);
  if (!pile.length) return null;

  if (pileInfo.type === 'waste' || pileInfo.type === 'foundation') {
    if (cardIndex !== pile.length - 1) return null;
    return [pile[pile.length - 1]];
  }

  if (pileInfo.type === 'tableau') {
    const card = pile[cardIndex];
    if (!card?.faceUp) return null;
    const stack = pile.slice(cardIndex);
    for (let i = 1; i < stack.length; i++) {
      if (!canPlaceOnTableau(stack[i], stack[i - 1])) return null;
    }
    return stack;
  }

  return null;
}

export function canMove(state, stack, destInfo) {
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

/**
 * 検証済みの移動を盤面へ適用する。場札の移動元で裏向きカードが現れたらめくり、めくったかを返す。
 */
export function applyMove(state, fromInfo, cardIndex, toInfo, stack) {
  const from = getPile(state, fromInfo);
  const to = getPile(state, toInfo);
  from.splice(cardIndex, stack.length);
  to.push(...stack);

  if (fromInfo.type === 'tableau' && from.length) {
    const last = from[from.length - 1];
    if (!last.faceUp) {
      last.faceUp = true;
      return true;
    }
  }
  return false;
}

/** 場札への移動先の優先度（「簡単移動」とシミュレーターで共通） */
export function scoreTableauMove(state, fromInfo, cardIndex, stack, destInfo) {
  const destPile = getPile(state, destInfo);
  let score = 0;

  if (!destPile.length && stack[0].value === 13) score += 100;
  if (fromInfo.type === 'waste') score += 30;
  if (fromInfo.type === 'tableau') {
    const below = getPile(state, fromInfo)[cardIndex - 1];
    if (below && !below.faceUp) score += 80;
  }

  return score - destInfo.index;
}
