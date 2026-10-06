import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBasementPage, fetchBasementEast, makeWindow, mergeSource, mergeVerifiedSnapshot } from '../scripts/refresh-events.mjs';

const source={id:'basement-east',name:'The Basement East',url:'https://www.thebasementnashville.com/basement-east-events/'};
const checked='2026-10-06T02:00:00.000Z', window=makeWindow(new Date(checked),90);
const card=({id=14329134,title='SOLD OUT! Greta Van Fleet',month='Oct',day='10',year='2026',zone='CDT',venue='The Basement East',show='8:30 pm',slug='greta-van-fleet-2'}={})=>`<div class="tw-section">
  <div class="date-wrapper"><div class="date-month">${month}</div><div class="date-day">${day}</div><div class="date-year">${year}</div></div>
  <div class="tw-name"><a href="https://www.thebasementnashville.com/tm-event/${slug}/">${title}</a></div>
  <span class="tw-venue-name">${venue}</span><span class="tw-event-time">Show: ${show}</span><span class="tw-event-timezone">${zone}</span>
  <span class="tw-event-door-time">7:00 pm</span><div class="tw-age-restriction">All Ages</div>
  <a class="tw-buy-tix-btn" href="https://www.ticketweb.com/event/show-the-basement-east-tickets/${id}">ON SALE FRI. SEPTEMBER 25th @ 12pm</a>
</div>`;
const page=(cards,current=1,total=1,next)=>`<div class="tw-plugin-upcoming-event-list">${cards}</div><div class="tm-paginate">
  <span class="page-numbers current">${current}</span>${Array.from({length:total},(_,i)=>`<a class="page-numbers">${i+1}</a>`).join('')}
  ${next===false?'':current<total?`<a class="next page-numbers" href="${next||source.url+'page/'+(current+1)+'/'}">Next</a>`:''}</div>
  <aside><div class="tw-section">Just Announced unrelated sidebar</div></aside>`;

test('Basement East keeps sold-out shows, official ticket IDs, show/doors distinction and music category',()=>{
  const parsed=parseBasementPage(page(card()),source,checked);
  assert.equal(parsed.events.length,1);
  const event=parsed.events[0];
  assert.equal(event.id,'basement-east:14329134');
  assert.equal(event.start,'2026-10-10T20:30:00-05:00');
  assert.equal(event.doors,'2026-10-10T19:00:00-05:00');
  assert.equal(event.title,'SOLD OUT! Greta Van Fleet');
  assert.ok(event.tags.includes('music'));
  assert.match(event.notes.join(' '),/sold out/);
  assert.match(event.notes.join(' '),/All Ages/);
  assert.equal(event.priceText,undefined);
});

test('Basement East rejects empty shells, wrong venue, malformed clock and timezone changes',()=>{
  assert.throws(()=>parseBasementPage('<div>Loading...</div>',source,checked),/cards missing/);
  assert.throws(()=>parseBasementPage(page(card({venue:'The Basement'})),source,checked),/venue scope/);
  assert.throws(()=>parseBasementPage(page(card({show:'20:30 pm'})),source,checked),/invalid display time/);
  assert.throws(()=>parseBasementPage(page(card({zone:'CST'})),source,checked),/timezone disagrees/);
  assert.throws(()=>parseBasementPage(page(card(),1,2,false),source,checked),/next link/);
});

test('Basement East reads every page before horizon filtering and deduplicates overlapping cards',async()=>{
  const calls=[];
  const result=await fetchBasementEast(source,checked,window,async url=>{
    calls.push(url);
    return calls.length===1?page(card()+card({id:1,month:'Oct',day:'03',slug:'past'}),1,2):
      page(card()+card({id:2,month:'Dec',day:'05',zone:'CST',slug:'the-emo-night-tour-5',title:'The Emo Night Tour'})+
        card({id:3,month:'Feb',day:'03',year:'2027',zone:'CST',slug:'far-future'}),2,2);
  });
  assert.equal(calls.length,2);
  assert.deepEqual(result.events.map(e=>e.id),['basement-east:14329134','basement-east:2']);
  assert.equal(result.events[1].start,'2026-12-05T20:30:00-06:00');
  assert.equal(result.complete,true);
});

test('Basement East pagination failures retain last-good records with original check time',async()=>{
  const prior=parseBasementPage(page(card()),source,'2026-10-04').events[0];
  let calls=0,error;
  try{await fetchBasementEast(source,checked,window,async()=>{if(++calls===2)throw new Error('HTTP 429');return page(card(),1,2);});}
  catch(e){error=e;}
  assert.match(error.message,/429/);
  const merged=mergeSource({events:[prior],sources:[{id:source.id,lastSuccessAt:'2026-10-04'}]},source,null,error,checked,window);
  assert.equal(merged.source.status,'failed');
  assert.equal(merged.events[0].checkedAt,'2026-10-04');
  assert.equal(merged.events[0].stale,true);
  await assert.rejects(()=>fetchBasementEast(source,checked,window,async()=>page(card(),1,2)),/pagination changed/);
  await assert.rejects(()=>fetchBasementEast(source,checked,window,async()=>page(card(),1,2,'https://example.com/private')),/escaped/);
});

test('live Basement listing replaces a curated duplicate without merging different dates or venues',()=>{
  const live=parseBasementPage(page(card()),source,checked).events[0];
  const manual={...live,id:'curated-greta',sourceId:'artist-greta',checkedAt:'2026-10-04',title:'Greta Van Fleet',tags:['rock'],priceText:'Old price'};
  const otherDate={...manual,id:'curated-greta-next',start:'2026-10-17T20:30:00-05:00'};
  const otherVenue={...manual,id:'curated-greta-elsewhere',venueId:'different-venue'};
  const merged=mergeVerifiedSnapshot({events:[live],sources:[]},{events:[],sources:[]},[manual,otherDate,otherVenue],null,checked,window);
  assert.deepEqual(merged.events.map(e=>e.id),[live.id,otherDate.id,otherVenue.id]);
  assert.deepEqual(merged.events[0].tags,['music','rock']);
  assert.equal(merged.events[0].title,'SOLD OUT! Greta Van Fleet');
  assert.equal(merged.events[0].priceText,undefined);
  assert.equal(merged.events[0].checkedAt,checked);
  const stale=mergeVerifiedSnapshot({events:[{...live,stale:true}],sources:[]},{events:[],sources:[]},[manual],null,checked,window);
  assert.equal(stale.events.length,2);
});

test('manual/live dedupe preserves event identity in query parameters',()=>{
  const live={...parseBasementPage(page(card()),source,checked).events[0],url:'https://calendar.google.com/calendar/event?eid=first',ticketUrl:undefined};
  const same={...live,id:'manual-same',sourceId:'manual',tags:['rock']};
  const distinct={...same,id:'manual-distinct',url:'https://calendar.google.com/calendar/event?eid=second'};
  const merged=mergeVerifiedSnapshot({events:[live],sources:[]},{events:[],sources:[]},[same,distinct],null,checked,window);
  assert.deepEqual(merged.events.map(e=>e.id),[live.id,distinct.id]);
  assert.ok(merged.events[0].tags.includes('rock'));
});
