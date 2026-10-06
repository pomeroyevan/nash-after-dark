import test from 'node:test';
import assert from 'node:assert/strict';
import {MTG_ADAPTERS,fetchMtg,parseTnlgICS,parseGamePointPage} from '../scripts/mtg-sources.mjs';
import {eventRecord,makeWindow} from '../scripts/refresh-events.mjs';
const CHECKED='2026-10-06T01:00:00.000Z',window=makeWindow(new Date(CHECKED),90);
const source=id=>MTG_ADAPTERS.find(s=>s.id===id);
const event=(title,id,start='2026-10-12 18:00:00')=>({id,title,start_date:start,end_date:start.slice(0,11)+'22:00:00',timezone:'America/Chicago',url:'https://gamepointcafe.com/event/'+id});
const ics=entries=>'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nX-WR-TIMEZONE:America/Chicago\r\n'+entries.map(e=>'BEGIN:VEVENT\r\n'+e.join('\r\n')+'\r\nEND:VEVENT').join('\r\n')+'\r\nEND:VCALENDAR';

test('Game Point traverses all pages and excludes other games and beer-only drafts',async()=>{
  const pages=[{total:3,total_pages:2,events:[event('Magic Monday Draft',1),event('Draft beer tasting',2)]},{total:3,total_pages:2,events:[event('Magic Casual Commander',3,'2026-11-02 18:30:00')]}];
  const seen=[];
  const result=await fetchMtg(source('game-point'),CHECKED,window,async url=>{const page=+new URL(url).searchParams.get('page');seen.push(page);return JSON.stringify(pages[page-1]);},eventRecord);
  assert.deepEqual(seen,[1,2]);assert.equal(result.rawCount,3);assert.equal(result.events.length,2);assert.equal(result.events[1].start,'2026-11-02T18:30:00-06:00');
});
test('Game Point rejects repeated or incomplete pagination instead of replacing history',async()=>{
  const payload={total:2,total_pages:2,events:[event('Magic Commander',1)]};
  await assert.rejects(()=>fetchMtg(source('game-point'),CHECKED,window,async()=>JSON.stringify(payload),eventRecord),/repeated/);
  payload.total_pages=1;
  await assert.rejects(()=>fetchMtg(source('game-point'),CHECKED,window,async()=>JSON.stringify(payload),eventRecord),/incomplete/);
});
test('Game Point cancelled listings remove prior keys and preserve meaningful draft constraints',()=>{
  const draft=event('Magic Monday: Draft and a Draft',1);draft.description='$30 (plus tax). Six people minimum for the draft.';
  const result=parseGamePointPage({total:2,total_pages:1,events:[draft,event('CANCELED Magic Commander',2)]},source('game-point'),CHECKED,eventRecord);
  assert.deepEqual(result.removedKeys,['game-point:2']);assert.match(result.events[0].priceText,/Six people minimum/);assert.match(result.events[0].priceText,/30 plus tax/);
  assert.throws(()=>parseGamePointPage({events:[]},source('game-point'),CHECKED,eventRecord),/schema/);
});
test('Game Point does not invent suggested spend, included products or draft time from unrelated signals',()=>{
  const commander=event('Magic Commander',1);commander.description='No entry fee. Food purchases optional.';
  const draft=event('Magic Draft',2);draft.description='$40 (plus tax). Eight people minimum.';
  const rcq=event('RCQ - Pioneer',3);rcq.description='Magic: The Gathering Regional Championship Qualifier';
  const prerelease=event('Star Trek Prerelease',4);prerelease.categories=[{name:'Magic the Gathering'}];
  const r=parseGamePointPage({events:[commander,draft,rcq,prerelease],total:4,total_pages:1},source('game-point'),CHECKED,eventRecord);
  assert.equal(r.events.length,4);assert.equal(r.events[0].priceText,'No entry fee.');assert.equal(r.events[1].priceText,'$40 plus tax. Eight people minimum.');
});
test('TNLG requires Magic evidence and parses both comma and and separated session times',()=>{
  const body=ics([
    ['UID:beer','SUMMARY:Draft Beer Tasting','DTSTART:20261031T190000Z'],
    ['UID:football','SUMMARY:Sports Draft','DTSTART:20261031T190000Z'],
    ['UID:magic','SUMMARY:Magic Prerelease','DTSTART;VALUE=DATE:20261107','DTEND;VALUE=DATE:20261108','DESCRIPTION:Saturday - 11:30 am and 5 pm']]);
  const result=parseTnlgICS(body,source('next-level-games'),CHECKED,window,eventRecord);
  assert.equal(result.events.length,2);assert.equal(result.events[1].start,'2026-11-07T17:00:00-06:00');
  const changed=body.replace('and 5 pm',' / 5 pm');
  const unsupported=parseTnlgICS(changed,source('next-level-games'),CHECKED,window,eventRecord);
  assert.equal(unsupported.complete,false);assert.equal(unsupported.events.length,0);
});
test('TNLG converts UTC to Nashville, unfolds descriptions, and excludes non-Magic tournaments',()=>{
  const body=ics([
    ['UID:one','SUMMARY:TNLG All Leylines\' Eve','DTSTART:20261031T190000Z','DTEND:20261031T230000Z','DESCRIPTION:Halloween Draft event\,\n cost $20 to enter'],
    ['UID:two','SUMMARY:Flesh and Blood 1K Draft','DTSTART:20261031T190000Z'],
    ['UID:three','SUMMARY:Riftbound Draft','DTSTART:20261031T190000Z']]);
  const result=parseTnlgICS(body,source('next-level-games'),CHECKED,window,eventRecord);
  assert.equal(result.events.length,1);assert.equal(result.events[0].start,'2026-10-31T14:00:00-05:00');assert.equal(result.events[0].end,'2026-10-31T18:00:00-05:00');assert.match(result.events[0].priceText,/20/);
});
test('TNLG date-only prerelease has five explicit sessions, never a fictional midnight start',()=>{
  const body=ics([['UID:prerelease','SUMMARY:Magic Star Trek Prerelease Weekend','DTSTART;VALUE=DATE:20261106','DTEND;VALUE=DATE:20261109','DESCRIPTION:EVENT TIMES\\nFriday - 7:00 pm\\nSaturday - 11:30 am\, 5:00 pm\\nSunday - 11:30 am\, 5:00 pm\\nEntry for each event will be $35.']]);
  const result=parseTnlgICS(body,source('next-level-games'),CHECKED,window,eventRecord);
  assert.equal(result.events.length,5);assert.equal(result.events[0].start,'2026-11-06T19:00:00-06:00');assert.equal(result.events[4].start,'2026-11-08T17:00:00-06:00');assert.equal(result.events[0].end,undefined);assert.match(result.events[0].priceText,/35/);
});
test('TNLG incomplete times and recurrence stay partial, cancellations are excluded',()=>{
  const body=ics([
    ['UID:unknown','SUMMARY:Magic Draft','DTSTART;VALUE=DATE:20261114','DTEND;VALUE=DATE:20261115'],
    ['UID:repeat','SUMMARY:Commander','DTSTART;TZID=America/Chicago:20261009T190000','RRULE:FREQ=WEEKLY;COUNT=4'],
    ['UID:cancel','SUMMARY:Magic Draft','DTSTART:20261114T200000Z','STATUS:CANCELLED']]);
  const result=parseTnlgICS(body,source('next-level-games'),CHECKED,window,eventRecord);
  assert.equal(result.events.length,0);assert.equal(result.complete,false);assert.match(result.message,/2 recurring\/date-only/);assert.equal(result.removedKeys.length,1);
});
test('TNLG floating timestamps fail closed; named timezones and timed release descriptions work',()=>{
  assert.throws(()=>parseTnlgICS(ics([['UID:floating','SUMMARY:Magic Draft','DTSTART:20261114T140000']]),source('next-level-games'),CHECKED,window,eventRecord),/floating timezone/);
  const result=parseTnlgICS(ics([['UID:release','SUMMARY:TNLG Release Draft - Star Trek','DTSTART;VALUE=DATE:20261114','DTEND;VALUE=DATE:20261115','DESCRIPTION:Entry is $25 and start time is 2pm']]),source('next-level-games'),CHECKED,window,eventRecord);
  assert.equal(result.events[0].start,'2026-11-14T14:00:00-06:00');
});
