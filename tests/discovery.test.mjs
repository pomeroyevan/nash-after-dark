import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesFilter } from '../src/model.ts';

test('MTG discovery covers named formats and qualifiers with Magic context', () => {
  for (const [tags, title] of [
    [[], 'Magic: The Gathering prerelease'],
    [[], 'Magic the Gathering booster draft'],
    [[], 'MTG Commander night'],
    [['commander'], 'Open tables'],
    [[], 'cEDH tournament'],
    [[], 'RCQ Nashville'],
    [[], 'Regional Championship Qualifier'],
    [['magic-the-gathering'], 'Regional tournament'],
    [['mtg', 'draft'], 'Friday at the tables'],
    [['magic', 'pre-release'], 'New set celebration'],
  ]) assert.equal(matchesFilter(tags, title, 'mtg'), true, title);
});

test('MTG discovery does not mistake sports, other games, or artist names for Magic', () => {
  for (const [tags, title] of [
    [['sports'], 'NFL Draft party'],
    [['tournament'], 'Chess tournament'],
    [['prerelease', 'pokemon'], 'Pokemon prerelease'],
    [['concert'], 'Commander Cody live'],
    [['music'], 'Magic City concert'],
    [['draft'], 'Draft beer night'],
  ]) assert.equal(matchesFilter(tags, title, 'mtg'), false, title);
});

test('Everything includes concerts and MTG while selected music and dancing categories remain distinct', () => {
  assert.equal(matchesFilter(['concert', 'rock'], 'Greta Van Fleet', 'all'), true);
  assert.equal(matchesFilter(['concert', 'rock'], 'Greta Van Fleet', 'music'), true);
  assert.equal(matchesFilter(['concert', 'rock'], 'Greta Van Fleet', 'dancing'), false);
  assert.equal(matchesFilter(['mtg', 'commander'], 'Open tables', 'all'), true);
  assert.equal(matchesFilter(['mtg', 'commander'], 'Open tables', 'music'), false);
});
