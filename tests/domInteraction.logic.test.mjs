import assert from 'node:assert/strict';
import {
  INTERACTIVE_DESCENDANT_SELECTOR,
  isInteractiveElement,
  shouldIgnoreTileActivation,
} from '../src/utils/domInteraction.js';

const makeTarget = (closestElement) => ({
  closest: () => closestElement,
});

const nestedButton = { id: 'nested-button' };
const tile = {
  id: 'tile',
  contains: (element) => element === nestedButton || element === tile,
};
const outsideButton = { id: 'outside-button' };
const outsideTile = {
  id: 'outside-tile',
  contains: () => false,
};

assert.ok(INTERACTIVE_DESCENDANT_SELECTOR.includes('button'));
assert.ok(INTERACTIVE_DESCENDANT_SELECTOR.includes('a[href]'));
assert.ok(INTERACTIVE_DESCENDANT_SELECTOR.includes('[role="menuitem"]'));
assert.ok(INTERACTIVE_DESCENDANT_SELECTOR.includes('[data-no-tile-activate="true"]'));
assert.equal(isInteractiveElement(makeTarget(nestedButton)), true);
assert.equal(isInteractiveElement(makeTarget(null)), false);
assert.equal(shouldIgnoreTileActivation(makeTarget(nestedButton), tile), true);
assert.equal(shouldIgnoreTileActivation(makeTarget(tile), tile), false);
assert.equal(shouldIgnoreTileActivation(makeTarget(outsideButton), outsideTile), false);
assert.equal(shouldIgnoreTileActivation(null, tile), false);

console.log('domInteraction logic tests passed');
