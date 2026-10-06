/** Official MTG calendars only; no account data or third-party event inference. */
import ical from 'node-ical';
import { load } from 'cheerio';

export const TNLG_CALENDAR = '6926fa9c1cc0bdcf989061a1f0286a50bfd6cf85882bbcfab65956f8100c4e65@group.calendar.google.com';
export const MTG_ADAPTERS = [
  {id:'game-point',name:'Game Point Cafe',url:'https://gamepointcafe.com/events/category/game-gathering/magic-the-gathering/',type:'mtg',format:'tribe'},
  {id:'next-level-games',name:'The Next Level Games',url:'https://tnlgnashville.com/pages/tnlg-event-page',type:'mtg',format:'ics',feed:'https://calendar.google.com/calendar/ical/'+encodeURIComponent(TNLG_CALENDAR)+'/public/basic.ics'}
];
const plain = value => load(String(value??'').replace(/<br\s*\/?\s*>/gi,' ')).text().replace(/\s+/g,' ').trim();
const fmt = new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
const local = date => {const p=Object.fromEntries(fmt.formatToParts(date).map(x=>[x.type,x.value]));return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;};
const content = value => plain(typeof value==='object'?value?.val:value);
const requested = value => /\b(commander|c?edh|draft|prerelease|pre-release|rcq|regional championship|win.a.box|\d+k)\b/i.test(value);
const otherGame = value => /\b(pok[eé]mon|lorcana|riftbound|gundam|digimon|union arena|dragon ball|one piece|yu.gi.oh|beyblade|flesh and blood|fab)\b/i.test(value);
const magicIdentity = value => /\b(magic(?::? the gathering)?|mtg|commander|c?edh|rcq|regional championship qualifier|all leylines)\b/i.test(value);
const tags = title => ['mtg','magic: the gathering','tabletop',...['commander','draft','prerelease','rcq'].filter(t=>new RegExp(t,'i').test(title)),...(/rcq|championship|win.a.box|\d+k/i.test(title)?['tournament']:[])];
const inRange=(event,window)=>event.start.slice(0,10)>=window.date&&event.start.slice(0,10)<window.endDate;

export function parseGamePointPage(payload,source,checkedAt,eventRecord) {
  if(!payload||!Array.isArray(payload.events)||!Number.isInteger(payload.total)||!Number.isInteger(payload.total_pages))throw new Error('Game Point API schema changed');
  const events=[],removedKeys=[];
  for(const e of payload.events){
    if(!e.id||!e.title)throw new Error('Game Point event missing identity');
    const title=plain(e.title);
    const description=plain(e.description);
    const categoryText=(e.categories||[]).map(c=>c.name||'').join(' ');
    if(!magicIdentity(title+' '+description+' '+categoryText)||otherGame(title)||!requested(title))continue;
    if(/cancelled|canceled/i.test(title)||['cancelled','canceled'].includes(e.event_status)) {removedKeys.push(source.id+':'+e.id);continue;}
    if(!e.start_date||e.timezone!=='America/Chicago')throw new Error('Game Point event missing Nashville timezone/start');
    let priceText=plain(e.cost)||undefined;
    if(/never a fee|no (?:entry )?fee/i.test(description))priceText='No entry fee.';
    const spend=description.match(/suggest you plan to spend (\$\d+(?:\.\d+)?) on food and drink/i)?.[1];
    if(spend)priceText=(priceText||'')+' Venue suggests '+spend+' food/drink spend.';
    const taxedCost=description.match(/(\$\d+(?:\.\d+)?)\s*\(plus tax\)/i)?.[1];
    if(taxedCost)priceText=taxedCost+' plus tax.';
    const notes=[];
    const minimum=description.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|\d+) people minimum/i)?.[0];
    if(minimum)priceText=(priceText||'')+' '+minimum+'.';
    const gather=description.match(/gathering at (\d{1,2}(?::\d{2})?\s*[ap]m)/i)?.[1];
    const aim=description.match(/started as close to (\d{1,2}(?::\d{2})?\s*[ap]m)/i)?.[1];
    if(gather)priceText=(priceText||'')+' Gather at '+gather+'.';
    if(aim)priceText=(priceText||'')+' Draft aims to start around '+aim+'.';
    if(/isn[’']t Wizard Play sanctioned/i.test(description))priceText=(priceText||'')+' Not WPN-sanctioned.';
    events.push(eventRecord(source,{key:String(e.id),title,start:e.start_date,end:e.end_date>e.start_date?e.end_date:undefined,url:e.url,priceText,tags:tags(title),notes},checkedAt));
  }
  return {events,removedKeys,total:payload.total,totalPages:payload.total_pages,rawIds:payload.events.map(e=>e.id)};
}

const clock=value=>{const m=value.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);if(!m||+m[1]<1||+m[1]>12||+(m[2]||0)>59)throw new Error('Invalid TNLG session time');return String(+m[1]%12+(m[3].toLowerCase()==='pm'?12:0)).padStart(2,'0')+':'+(m[2]||'00')+':00';};
const dateAdd=(date,n)=>{const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
// node-ical represents DATE values at midnight in the host timezone. Retain their civil date.
const civil=date=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
/** A DATE-only ICS item is not a midnight event. Accept only explicit session clocks in its description. */
export function tnlgSessions(event) {
  const description=content(event.description);
  if(event.datetype!=='date')return [{start:local(event.start),end:event.end>event.start?local(event.end):undefined}];
  const date=civil(event.start),endDate=event.end?civil(event.end):dateAdd(date,1);
  const days=Math.round((new Date(endDate)-new Date(date))/86400000);
  if(days<1||days>7)throw new Error('TNLG all-day date span requires manual review');
  const weekdays=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const sessions=[];
  for(let offset=0;offset<days;offset++){
    const day=dateAdd(date,offset),weekday=weekdays[new Date(day+'T12:00:00Z').getUTCDay()];
    const clocks=description.match(new RegExp('\\b'+weekday+'\\s*[-–:]\\s*(\\d{1,2}(?::\\d{2})?\\s*[ap]m(?:(?:\\s*,\\s*|\\s+(?:and|&)\\s+)\\d{1,2}(?::\\d{2})?\\s*[ap]m)*)([^.]*?)(?=\\b(?:'+weekdays.join('|')+')\\s*[-–:]|Entry|$)','i'));
    if(clocks){
      if(/\d{1,2}(?::\d{2})?\s*[ap]m/i.test(clocks[2]))throw new Error('Unsupported TNLG session separator');
      for(const value of clocks[1].split(/\s*,\s*|\s+(?:and|&)\s+/i))sessions.push({start:day+'T'+clock(value)});
    }
  }
  if(sessions.length)return sessions;
  const start=description.match(/\bstart time (?:is\s*)?(\d{1,2}(?::\d{2})?\s*[ap]m)\b/i)?.[1];
  if(days===1&&start)return [{start:date+'T'+clock(start)}];
  throw new Error('TNLG date-only Magic item has no verified session times; manual review required');
}

export function parseTnlgICS(body,source,checkedAt,window,eventRecord) {
  if(!body.includes('BEGIN:VCALENDAR')||!body.includes('END:VCALENDAR'))throw new Error('TNLG response is not a complete iCalendar');
  const parsed=ical.sync.parseICS(body),events=[],removedKeys=[],manualTitles=[];let rawCount=0,unsupported=0;
  for(const item of Object.values(parsed)){
    if(item.type!=='VEVENT')continue;
    rawCount++;
    const title=content(item.summary),description=content(item.description);
    const knownMagicTitle=/^TNLG Release Draft - Star Trek$/i.test(title);
    if(otherGame(title)||!requested(title+' '+description)||(!magicIdentity(title+' '+description)&&!knownMagicTitle))continue;
    if(!item.uid||!(item.start instanceof Date)||!Number.isFinite(+item.start))throw new Error('TNLG Magic item missing identity/date');
    if(item.datetype!=='date'){
      if(!item.start.tz||(item.end&&!item.end.tz))throw new Error('TNLG timed Magic item has an unsupported floating timezone');
      for(const time of [item.start,item.end].filter(Boolean))try {new Intl.DateTimeFormat('en-US',{timeZone:time.tz});}catch{throw new Error('TNLG Magic item has an unsupported named timezone');}
    }
    const date=item.datetype==='date'?civil(item.start):local(item.start).slice(0,10);
    // Never silently treat the DTSTART of a recurring item as the whole series.
    if(item.rrule||item.recurrences){unsupported++;manualTitles.push(title);continue;}
    if(date>=window.endDate||(item.end||item.start)<new Date(window.start))continue;
    if(item.status==='CANCELLED'||/cancelled|canceled/i.test(title)){
      try {for(const session of tnlgSessions(item))removedKeys.push(source.id+':'+item.uid+':'+session.start);}catch{unsupported++;}
      continue;
    }
    let sessions;
    try{sessions=tnlgSessions(item);}catch{unsupported++;manualTitles.push(title);continue;}
    const price=description.match(/(?:Entry(?: for each event)?(?: will be| is)?|cost)\s*(\$\d+(?:\.\d{2})?)/i)?.[1];
    for(const session of sessions){
      const url=new URL('https://calendar.google.com/calendar/event');
      url.searchParams.set('eid',Buffer.from(item.uid+' '+TNLG_CALENDAR).toString('base64url'));
      const publicTitle=/all leylines/i.test(title)?title+' — Halloween Draft':title;
      const event=eventRecord(source,{key:item.uid+':'+session.start,title:publicTitle,...session,url:url.href,priceText:price?price+' entry; recheck availability.':undefined,tags:tags(publicTitle),notes:item.datetype==='date'?['Calendar date block expanded only from explicit session times in the organizer description.']:undefined},checkedAt);
      if(inRange(event,window))events.push(event);
    }
  }
  if(rawCount===0)throw new Error('TNLG calendar contains no recognizable events');
  return {events,removedKeys,rawCount,complete:unsupported===0,message:'Official major-events iCalendar checked; '+(unsupported?unsupported+' recurring/date-only Magic item(s) need manual review'+(manualTitles.length?': '+manualTitles.slice(0,5).join('; '):'')+'.':'explicit dated Magic sessions parsed. Weekly flyer is a separate manual source.')};
}

export async function fetchMtg(source,checkedAt,window,request,eventRecord) {
  if(source.format==='ics')return parseTnlgICS(await request(source.feed),source,checkedAt,window,eventRecord);
  if(source.format!=='tribe')throw new Error('Unsupported MTG adapter format');
  const events=[],removedKeys=[],seenIds=new Set();let expectedTotal,expectedPages;
  for(let page=1;page<=30;page++){
    const url=new URL('/wp-json/tribe/events/v1/events','https://gamepointcafe.com/');
    Object.entries({start_date:window.date,end_date:window.endDate,per_page:50,page}).forEach(([key,value])=>url.searchParams.set(key,String(value)));
    const parsed=parseGamePointPage(JSON.parse(await request(url.href)),source,checkedAt,eventRecord);
    expectedTotal??=parsed.total;expectedPages??=parsed.totalPages;
    if(parsed.total!==expectedTotal||parsed.totalPages!==expectedPages)throw new Error('Game Point pagination changed during fetch');
    for(const id of parsed.rawIds){if(seenIds.has(id))throw new Error('Game Point pagination repeated an event');seenIds.add(id);}
    events.push(...parsed.events);removedKeys.push(...parsed.removedKeys);
    if(page>=parsed.totalPages){
      if(seenIds.size!==expectedTotal)throw new Error('Game Point pagination incomplete');
      return {events:events.filter(e=>inRange(e,window)),removedKeys,rawCount:seenIds.size,complete:true,message:'All '+page+' official API page(s) checked; dated MTG Commander/draft/prerelease/tournament listings only.'};
    }
  }
  throw new Error('Game Point exceeded bounded 30-page limit');
}
