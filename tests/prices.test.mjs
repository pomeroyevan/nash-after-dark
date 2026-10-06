import test from 'node:test';
import assert from 'node:assert/strict';
import { extractCobraPrice } from '../scripts/price-details.mjs';

test('Cobra admission keeps door markers and drops age/calendar boilerplate', () => {
  assert.equal(extractCobraPrice('<p>@ Tickets: $5 @ Door 21 and UP + Add to calendar</p>'), '$5 @ Door');
  assert.equal(extractCobraPrice('Tickets: $15 ADV | $20 DOS @ 18 and UP + Add to calendar'), '$15 ADV | $20 DOS');
  assert.equal(extractCobraPrice('Tickets: $20 ADV | $25 DOS @ ALL AGES Add to calendar'), '$20 ADV | $25 DOS');
});

test('Cobra admission preserves limited promotions and ticket tiers', () => {
  assert.equal(extractCobraPrice('Ticket Special: $35 for a LIMITED TIME ONLY @ 18 and UP + Add to calendar'), 'Ticket special: $35 for a LIMITED TIME ONLY');
  assert.equal(extractCobraPrice('Tickets: $25 General Admission | $75 VIP @ 18 and UP + Add to calendar'), '$25 General Admission | $75 VIP');
});

test('free admission needs explicit admission evidence, not a default zero', () => {
  assert.equal(extractCobraPrice('FREE @ 21 and UP + Add to calendar'), 'Free admission');
  assert.equal(extractCobraPrice('Free drinks with purchase @ 21 and UP + Add to calendar'), undefined);
  assert.equal(extractCobraPrice('Artist grew up listening to Free. @ 21 and UP'), undefined);
  assert.equal(extractCobraPrice('', 0), undefined);
  assert.equal(extractCobraPrice('', '0'), undefined);
  assert.equal(extractCobraPrice('', '$10'), '$10');
});

test('Cobra admission ignores executable source content and missing amounts', () => {
  assert.equal(extractCobraPrice('<script>Tickets: $50</script><p>@ 21 and UP</p>'), undefined);
  assert.equal(extractCobraPrice('Tickets: see official ticket page @ 18 and UP Add to calendar'), undefined);
});
