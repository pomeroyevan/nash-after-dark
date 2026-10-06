import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rename, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  localToISO, makeWindow, inWindow, eventRecord, parseCobraPage, fetchCobra,
  extractJSONArray, parseRudys, parseFiveSpot, parseEastsideBowl, parseAmericano,
  parseFlamingo, mergeSource, mergeVerifiedSnapshot, fetchPublic, refresh, saveSnapshot, ADAPTERS
} from '../scripts/refresh-events.mjs';

const CHECKED='2026-10-05T20:00:00.000Z';
const source=id=>ADAPTERS.find(s=>s.id===id);
const window=makeWindow(new Date(CHECKED),45);

test('snapshot replacement retries a transient file lock and keeps scratch outside public output',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'nash-snapshot-'));
  try {
    await mkdir(path.join(root,'public/data'),{recursive:true});
    const destination=path.join(root,'public/data/events.json');
    await writeFile(destination,'{"old":true}');
    let attempts=0;
    await saveSnapshot({events:[]},root,async(from,to)=>{
      assert.equal(path.dirname(from),path.join(root,'.tmp'));
      if(attempts++===0) {
        assert.equal(await readFile(destination,'utf8'),'{"old":true}');
        throw Object.assign(new Error('Simulated temporary lock'),{code:'EPERM'});
      }
      await rename(from,to);
    });
    assert.equal(attempts,2);
    assert.deepEqual(JSON.parse(await readFile(destination,'utf8')),{events:[]});
    assert.deepEqual(await readdir(path.join(root,'public/data')),['events.json']);
  } finally { await rm(root,{recursive:true,force:true}); }
});

test('Windows replacement-denied fallback preserves the previous snapshot before an in-place edit',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'nash-windows-save-'));
  try {
    await mkdir(path.join(root,'public/data'),{recursive:true});
    const destination=path.join(root,'public/data/events.json');
    await writeFile(destination,'{"old":true}');
    await saveSnapshot({events:[]},root,async()=>{throw Object.assign(new Error('Replacement denied'),{code:'EPERM'});},'win32');
    assert.deepEqual(JSON.parse(await readFile(destination,'utf8')),{events:[]});
    const backups=(await readdir(path.join(root,'.tmp'))).filter(name=>name.startsWith('events.previous.'));
    assert.equal(backups.length,1);
    assert.equal(await readFile(path.join(root,'.tmp',backups[0]),'utf8'),'{"old":true}');
    assert.deepEqual(await readdir(path.join(root,'public/data')),['events.json']);
  } finally { await rm(root,{recursive:true,force:true}); }
});
test('Nashville DST conversion, invalid spring clock and ambiguous fall clock',()=>{
  assert.equal(localToISO('2026-10-31T21:00:00').iso,'2026-10-31T21:00:00-05:00');
  assert.equal(localToISO('2026-11-02T21:00:00').iso,'2026-11-02T21:00:00-06:00');
  assert.throws(()=>localToISO('2026-03-08T02:30:00'),/Nonexistent/);
  assert.equal(localToISO('2026-11-01T01:30:00').ambiguous,true);
  assert.throws(()=>makeWindow(new Date(CHECKED),91),/1 to 90/);
});
test('requested dates use Nashville timezone and keep previous evening crossing midnight',()=>{
  const w=makeWindow(new Date('2026-10-06T02:00:00Z'),1);
  assert.equal(w.date,'2026-10-05');
  assert.equal(inWindow({start:'2026-10-04T23:00:00-05:00',end:'2026-10-05T02:00:00-05:00'},w),true);
  assert.equal(inWindow({start:'2026-10-04T21:00:00-05:00'},w),false);
  assert.equal(inWindow({start:'2026-10-06T00:00:00-05:00'},w),false);
});
test('Cobra HTML entities and embedded ticket prices; identical end is unknown',()=>{
  const parsed=parseCobraPage({total:1,total_pages:1,events:[{
    id:100,title:'She&#8217;s Lost Control',start_date:'2026-10-10 22:00:00',
    end_date:'2026-10-10 22:00:00',timezone:'America/Chicago',
    url:'https://cobranashville.com/event/example/',
    description:'<a href="https://eventbrite.com/e/1">Tickets: $10 ADV | $15 DOS</a><p>18 and UP +</p>'
  }]},source('cobra'),CHECKED);
  assert.equal(parsed.events[0].title,'She’s Lost Control');
  assert.equal(parsed.events[0].start,'2026-10-10T22:00:00-05:00');
  assert.equal(parsed.events[0].end,undefined);
  assert.equal(parsed.events[0].ticketUrl,'https://eventbrite.com/e/1');
  assert.match(parsed.events[0].priceText,/\$10/);
});
test('Cobra follows all pages and rejects incomplete snapshots',async()=>{
  let calls=0;
  const req=async url=>{
    calls++;const page=Number(new URL(url).searchParams.get('page'));
    return JSON.stringify({total:2,total_pages:2,events:[{
      id:page,title:'Act '+page,start_date:'2026-10-10 22:00:00',end_date:'2026-10-10 22:00:00',timezone:'America/Chicago'
    }]});
  };
  const result=await fetchCobra(source('cobra'),CHECKED,window,req);
  assert.equal(calls,2);assert.equal(result.events.length,2);
  await assert.rejects(fetchCobra(source('cobra'),CHECKED,window,async()=>JSON.stringify({total:2,total_pages:1,events:[]})),/Incomplete/);
});
test('JSON array scanner does not execute code and handles brackets inside strings',()=>{
  const script='[{"title":"x ] [ \\" y"}]; throw new Error("must not execute")';
  assert.equal(extractJSONArray(script,0)[0].title,'x ] [ " y');
  assert.throws(()=>extractJSONArray('[{"bad":true}',0),/Unterminated/);
});
test('Rudy publisher offset is explicitly normalized and provisional',()=>{
  const html='<script>$("#calendar").fullCalendar({events:'+JSON.stringify([{
    title:"Rudy's Jazz Jam",start:'2026-10-11T21:00:00+00:00',end:'2026-10-11T23:15:00+00:00',
    presale:'12',cover:'12',description:'We have a $10 food or beverage minimum.',eventurl:'https://tunehatch.com/show/1'
  }])+ '});</script>';
  const e=parseRudys(html,source('rudys-jazz-room'),CHECKED).events[0];
  assert.equal(e.start,'2026-10-11T21:00:00-05:00');assert.equal(e.status,'needs_verification');
  assert.match(e.priceText,/\$10 food/);
  assert.throws(()=>parseRudys(html.replaceAll('+00:00','-05:00'),source('rudys-jazz-room'),CHECKED),/convention changed/);
  assert.throws(()=>parseRudys('<html>Loading</html>',source('rudys-jazz-room'),CHECKED),/not found/);
});
test('5 Spot removes cancelled show, skips support pass and flags suspicious morning',()=>{
  const card=(name,when,id,label='Get Tickets')=>'<div class="event-card"><h3 class="event-title">'+name+
    '</h3><div class="event-date-time">'+when+'</div><a href="/shows/'+id+'/">'+label+'</a></div>';
  const html=card('Support Pass','Ongoing Access',1)+
    card('Guthrie','October 7, 2026 @ 6:00 PM',2,'Cancelled')+
    card('Odd source clock','October 18, 2026 @ 6:00 AM',3)+
    card('Motown','October 12, 2026 @ 9:00 PM',4);
  const result=parseFiveSpot(html,source('five-spot'),CHECKED);
  assert.deepEqual(result.removedKeys,['five-spot:2']);
  assert.equal(result.events.length,2);assert.equal(result.events[0].status,'needs_verification');
  assert.equal(result.events[1].start,'2026-10-12T21:00:00-05:00');
});
test('historical Rudy zero-duration records do not break upcoming refresh',()=>{
  const rows=[{title:'Old bad duration',start:'2025-10-15T18:00:00+00:00',end:'2025-10-15T18:00:00+00:00'},
    {title:'Upcoming show',start:'2026-10-11T21:00:00+00:00',end:'2026-10-11T23:15:00+00:00'}];
  const html='<script>$("#calendar").fullCalendar({events:'+JSON.stringify(rows)+'});</script>';
  assert.equal(parseRudys(html,source('rudys-jazz-room'),CHECKED,window).events.length,1);
  const all=parseRudys(html,source('rudys-jazz-room'),CHECKED).events;
  assert.equal(all[0].end,undefined);
});
test('Eastside uses explicit month/year calendar; keeps doors separate and includes next month',()=>{
  const month=(m,y,d)=>'<div class="seetickets-calendar-year-month-container">'+m+' '+y+
    '</div><table class="seetickets-calendar"><tr><td><div class="date-number">'+d+
    '</div><div class="seetickets-calendar-event-container"><div class="seetickets-calendar-event-title"><a href="https://seetickets.us/event/'+m+
    '">Dance Night</a></div><div class="seetickets-calendar-event-date">Show at 9:00PM Doors at 8:00PM</div></div></td></tr></table>';
  const result=parseEastsideBowl(month('October','2026','10')+month('November','2026','07'),source('eastside-bowl'),CHECKED);
  assert.equal(result.events.length,2);
  assert.equal(result.events[0].start,'2026-10-10T21:00:00-05:00');
  assert.equal(result.events[1].start,'2026-11-07T21:00:00-06:00');
  assert.equal(result.events[1].doors,'2026-11-07T20:00:00-06:00');
});
test('Americano chooses visible 7pm rather than erroneous 2pm JSON-LD and does not say free',()=>{
  const html='<script type="application/ld+json">{"startDate":"2026-10-08T14:00:00-05:00","offers":{"price":0}}</script>'+
    '<article class="mec-event-article"><span class="mec-start-date-label">October 8, 2026</span>'+
    '<div class="mec-event-time">7:00 pm - 10:00 pm</div><h4 class="mec-event-title"><a href="/events/jazz/">Jazz Standard</a></h4></article>';
  const e=parseAmericano(html,source('americano-lounge'),CHECKED).events[0];
  assert.equal(e.start,'2026-10-08T19:00:00-05:00');assert.equal(e.end,'2026-10-08T22:00:00-05:00');
  assert.equal(e.status,'needs_verification');assert.equal(e.priceText,undefined);
});
test('Eastside untimed festival outside horizon cannot fail current calendar',()=>{
  const html='<div class="seetickets-calendar-year-month-container">May 2027</div><table class="seetickets-calendar">'+
    '<tr><td><div class="date-number">14</div><div class="seetickets-calendar-event-container">'+
    '<div class="seetickets-calendar-event-title"><a href="https://seetickets.us/festival">Festival</a></div></div></td></tr></table>';
  assert.equal(parseEastsideBowl(html,source('eastside-bowl'),CHECKED,window).events.length,0);
  assert.throws(()=>parseEastsideBowl(html,source('eastside-bowl'),CHECKED),/missing date\/time/);
});
test('standing Wednesday creates only provisional near-term dates; wording changes fail closed',()=>{
  const result=parseFlamingo('<p>WEDNESDAY: THE INVITE | 8:30PM - A CURATED JAM</p>',source('flamingo'),CHECKED,window);
  assert.equal(result.events.length,2);assert.ok(result.events.every(e=>e.status==='needs_verification'));
  assert.throws(()=>parseFlamingo('Wednesday: New Program',source('flamingo'),CHECKED,window),/changed/);
});
test('failed refresh retains every old event and its last-success timestamp',()=>{
  const old=eventRecord(source('cobra'),{key:'1',title:'Known show',start:'2026-10-10T20:00:00'},'2026-10-04T20:00:00Z');
  const prior={sources:[{id:'cobra',lastSuccessAt:'2026-10-04T20:00:00Z'}],events:[old]};
  const merged=mergeSource(prior,source('cobra'),undefined,new Error('HTTP 403'),CHECKED,window);
  assert.equal(merged.events.length,1);assert.equal(merged.events[0].checkedAt,old.checkedAt);
  assert.equal(merged.events[0].stale,true);assert.equal(merged.source.status,'failed');
  assert.equal(merged.source.lastSuccessAt,'2026-10-04T20:00:00Z');
});
test('partial updates retain uncovered events but remove explicit cancellations',()=>{
  const old=id=>eventRecord(source('five-spot'),{key:id,title:'Known '+id,start:'2026-10-10T20:00:00'},CHECKED);
  const result=mergeSource({events:[old('1'),old('2')]},source('five-spot'),
    {complete:false,events:[],removedKeys:['five-spot:2'],message:'partial'},null,CHECKED,window);
  assert.deepEqual(result.events.map(e=>e.id),['five-spot:1']);
});
test('403/429 are not retried; temporary server failure receives one bounded retry',async()=>{
  for(const status of [403,429]){
    let calls=0;await assert.rejects(fetchPublic('https://example.com',{},{
      fetchImpl:async()=>{calls++;return new Response('',{status});},sleep:async()=>{throw new Error('must not sleep');}
    }),new RegExp('HTTP '+status));
    assert.equal(calls,1);
  }
  let calls=0,sleeps=0;
  assert.equal(await fetchPublic('https://example.com',{},{
    fetchImpl:async()=>++calls===1?new Response('',{status:503}):new Response('ok'),
    sleep:async()=>{sleeps++;}
  }),'ok');
  assert.equal(calls,2);assert.equal(sleeps,1);
});
test('inventory records manual sources, never reads personal history, preserves failures',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'nash-refresh-test-'));
  try{
    await mkdir(path.join(root,'public/data'),{recursive:true});
    await mkdir(path.join(root,'data'),{recursive:true});
    await writeFile(path.join(root,'data/personal-history.json'),'not valid JSON; must never be read');
    await writeFile(path.join(root,'public/data/catalog.json'),JSON.stringify({entries:[
      {id:'unresolved-place',name:'Unresolved Place',officialUrl:''}
    ]}));
    const result=await refresh({root,now:new Date(CHECKED),selected:['cobra'],previous:{sources:[],events:[]},
      request:async()=>{throw new Error('offline');}});
    assert.equal(result.sources.find(s=>s.id==='unresolved-place').status,'manual');
    assert.equal(result.sources.find(s=>s.id==='cobra').status,'failed');
    assert.equal(result.events.length,0);
  } finally {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));
    assert.ok(path.basename(root).startsWith('nash-refresh-test-'));
    await rm(root,{recursive:true,force:true});
  }
});
test('inventory excludes private research names while retaining reviewed and adapter coverage',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'nash-refresh-test-'));
  try{
    await mkdir(path.join(root,'public/data'),{recursive:true});
    await mkdir(path.join(root,'research'),{recursive:true});
    await writeFile(path.join(root,'public/data/catalog.json'),JSON.stringify({entries:[
      {id:'reviewed-place',name:'Reviewed Place',officialUrl:'https://example.com/public'},
      {id:'cobra-slc',name:'Reviewed Series',officialUrl:'https://example.com/series'}
    ]}));
    const privateFile=path.join(root,'research/private-matching.json');
    await writeFile(privateFile,JSON.stringify({entries:[
      {id:'private-only',canonical_name:'PRIVATE HISTORY SENTINEL',official_urls:['https://example.com/private']},
      {id:'reviewed-place',canonical_name:'PRIVATE HISTORY SENTINEL for reviewed place'},
      {id:'cobra',canonical_name:'PRIVATE HISTORY SENTINEL for adapter'}
    ]}));
    const options={root,now:new Date(CHECKED),selected:[],previous:{sources:[],events:[]},
      request:async()=>{throw new Error('must not fetch');}};
    const result=await refresh(options);
    assert.equal(result.sources.some(s=>s.id==='private-only'),false);
    assert.doesNotMatch(JSON.stringify(result),/PRIVATE HISTORY SENTINEL|example\.com\/private/);
    const reviewed=result.sources.find(s=>s.id==='reviewed-place');
    assert.equal(reviewed.name,'Reviewed Place');assert.equal(reviewed.status,'manual');
    const covered=result.sources.find(s=>s.id==='cobra-slc');
    assert.equal(covered.name,'Reviewed Series');assert.equal(covered.status,'covered');
    assert.equal(covered.coveredBy,'cobra');
    for(const adapter of ADAPTERS){
      const listed=result.sources.find(s=>s.id===adapter.id);
      assert.equal(listed.name,adapter.name);assert.equal(listed.url,adapter.url);
    }
    // Private files are not inputs to the public collector, even when malformed.
    await writeFile(privateFile,'private malformed JSON must never be read');
    assert.deepEqual(await refresh(options),result);
  }finally{
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));
    assert.ok(path.basename(root).startsWith('nash-refresh-test-'));
    await rm(root,{recursive:true,force:true});
  }
});

test('verified snapshots preserve evidence timestamps, expire, and cannot overwrite live records',()=>{
  const manual={id:'crimewave',name:'Crimewave',url:'https://example.com/crimewave'};
  const oldChecked='2026-10-04T20:00:00Z';
  const snapshot=eventRecord(manual,{key:'oct16',title:'CRIMEWAVE',start:'2026-10-16T21:00:00'},oldChecked);
  const december=eventRecord(manual,{key:'dec5',title:'December party',start:'2026-12-05T20:00:00'},oldChecked);
  const live=eventRecord(source('cobra'),{key:'100',title:'Updated live title',start:'2026-10-10T22:00:00'},CHECKED);
  const base=()=>({sources:[{...manual,status:'manual'},{id:'cobra',status:'ok'}],events:[live]});
  const merged=mergeVerifiedSnapshot(base(),{events:[]},[snapshot,december,{...live,title:'Older snapshot',checkedAt:oldChecked}],null,CHECKED,window);
  assert.equal(merged.events.length,2);
  assert.equal(merged.events.find(e=>e.id===live.id).title,'Updated live title');
  assert.equal(merged.events.find(e=>e.id===snapshot.id).checkedAt,oldChecked);
  assert.equal(merged.sources.find(s=>s.id==='crimewave').status,'partial');
  assert.equal(merged.sources.find(s=>s.id==='crimewave').lastSuccessAt,oldChecked);
  assert.match(merged.sources.find(s=>s.id==='crimewave').message,/No automatic adapter/);
  assert.equal(merged.sources.find(s=>s.id==='cobra').status,'ok');
  const wide=mergeVerifiedSnapshot(base(),{},[december],null,CHECKED,makeWindow(new Date(CHECKED),90));
  assert.ok(wide.events.some(e=>e.id===december.id));
  const expired=mergeVerifiedSnapshot(merged,merged,[snapshot],null,'2026-11-01T20:00:00Z',makeWindow(new Date('2026-11-01T20:00:00Z'),45));
  assert.ok(!expired.events.some(e=>e.id===snapshot.id));
  assert.equal(expired.sources.find(s=>s.id==='crimewave').status,'manual');
});
test('curated day-only verification and omitted Nashville zone work; invalid or missing input retains snapshots',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'nash-refresh-test-'));
  try{
    await mkdir(path.join(root,'data'),{recursive:true});
    await writeFile(path.join(root,'data/personal-history.json'),'private malformed JSON must not be read');
    const file=path.join(root,'data/verified-events.json');
    const event=eventRecord({id:'crimewave',name:'Crimewave',url:'https://example.com/event'},
      {key:'oct16',title:'CRIMEWAVE',start:'2026-10-16T21:00:00'},'2026-10-04');
    delete event.timezone; // Exact format of the public curated research input.
    await writeFile(file,JSON.stringify({events:[event]}));
    const options={root,now:new Date(CHECKED),selected:[],request:async()=>{throw new Error('must not fetch');}};
    const first=await refresh({...options,previous:{sources:[],events:[]}});
    assert.equal(first.events.length,1);assert.equal(first.events[0].checkedAt,event.checkedAt);
    assert.equal(first.events[0].timezone,'America/Chicago');
    assert.equal(first.sources.find(s=>s.id==='crimewave').status,'partial');
    assert.equal(first.sources.find(s=>s.id==='crimewave').lastSuccessAt,'2026-10-04');
    for(const invalid of [{...event,checkedAt:'2026-02-30'},{...event,start:'2026-10-16T21:00:00'},
      {...event,timezone:'America/Los_Angeles'}]){
      await writeFile(file,JSON.stringify({events:[invalid]}));
      const rejected=await refresh({...options,previous:first});
      assert.match(rejected.verifiedSnapshotError,/Invalid verified event schema/);
      assert.equal(rejected.events[0].checkedAt,'2026-10-04');
    }
    await writeFile(file,'{broken');
    const failed=await refresh({...options,previous:first});
    assert.equal(failed.events.length,1);assert.equal(failed.events[0].checkedAt,event.checkedAt);
    assert.equal(failed.events[0].stale,true);assert.equal(failed.events[0].status,'needs_verification');
    assert.equal(failed.sources.find(s=>s.id==='crimewave').status,'failed');
    assert.equal(failed.sources.find(s=>s.id==='crimewave').lastSuccessAt,event.checkedAt);
    // The explicit file path is within the verified temporary test root.
    assert.ok(path.resolve(file).startsWith(path.resolve(root)+path.sep));
    await rm(file);
    const missing=await refresh({...options,previous:first});
    assert.equal(missing.events.length,1);assert.match(missing.verifiedSnapshotError,/missing/);
  }finally{
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));
    assert.ok(path.basename(root).startsWith('nash-refresh-test-'));
    await rm(root,{recursive:true,force:true});
  }
});
