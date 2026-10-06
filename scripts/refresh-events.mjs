/**
 * Public Nashville calendar refresh. No account, browser-cookie, or personal-history access.
 * Node >=22, cheerio. Run: node scripts/refresh-events.mjs [--days=45] [--dry-run]
 * Optional --sources=cobra,rudys-jazz-room limits network calls; other sources retain data.
 * "confirmed" means a dated official listing, not guaranteed operation/ticket availability.
 */
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { load } from 'cheerio';
import { MTG_ADAPTERS, fetchMtg } from './mtg-sources.mjs';

export const ZONE = 'America/Chicago';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MONTHS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
const text = value => load(String(value ?? '')).text().replace(/\s+/g, ' ').trim();
const cleanUrl = (value, base) => {
  if (!value) return undefined;
  try { const u = new URL(value, base); return ['https:','http:'].includes(u.protocol) ? u.href : undefined; }
  catch { return undefined; }
};
const digest = value => createHash('sha256').update(value).digest('hex').slice(0, 20);
const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZONE, year:'numeric', month:'2-digit', day:'2-digit',
  hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23'
});
export function localParts(date = new Date()) {
  const p = Object.fromEntries(dateFormatter.formatToParts(date).map(x => [x.type,x.value]));
  return { date: p.year+'-'+p.month+'-'+p.day, time:p.hour+':'+p.minute+':'+p.second };
}
export function addDays(date, days) {
  const d = new Date(date+'T12:00:00Z'); d.setUTCDate(d.getUTCDate()+days);
  return d.toISOString().slice(0,10);
}
/** Match both legal Nashville offsets to the IANA timezone, including DST transitions. */
export function localToISO(value) {
  const local = value.replace(' ', 'T').slice(0,19);
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/.test(local)) throw new Error('Invalid local timestamp: '+value);
  const options = ['-05:00','-06:00'].filter(offset => {
    const d = new Date(local+offset);
    if (!Number.isFinite(+d)) return false;
    const p = localParts(d); return p.date+'T'+p.time === local;
  });
  if (!options.length) throw new Error('Nonexistent/invalid Nashville wall time: '+local);
  return { iso:local+options[0], ambiguous:options.length>1 };
}
function clock(value) {
  const m = text(value).match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  if (!m || +m[1]<1 || +m[1]>12 || +(m[2]||0)>59) throw new Error('Missing/invalid display time: '+value);
  const h = +m[1]%12 + (m[3].toLowerCase()==='pm'?12:0);
  return String(h).padStart(2,'0')+':'+(m[2]||'00')+':00';
}
function humanDate(value) {
  const m = text(value).match(/\b([A-Za-z]+)\s+(\d{1,2}),?\s+(20\d{2})\b/);
  const month = m ? MONTHS.indexOf(m[1].slice(0,3).toLowerCase())+1 : 0;
  if (!month) throw new Error('Missing explicit date/year: '+value);
  return m[3]+'-'+String(month).padStart(2,'0')+'-'+m[2].padStart(2,'0');
}
const tagsFor = value => {
  const s = text(value).toLowerCase();
  return ['jazz','blues','funk','soul','disco','goth','darkwave','punk','emo','house','techno','dance','jam','comedy','karaoke']
    .filter(tag => new RegExp('\\b'+tag+'\\b').test(s));
};
export function eventRecord(source, raw, checkedAt) {
  if (!raw.title || !raw.start) throw new Error('Event missing title/start');
  const start = localToISO(raw.start);
  const end = raw.end ? localToISO(raw.end) : null;
  if (end && +new Date(end.iso)<=+new Date(start.iso)) throw new Error('Event end must follow start');
  const url = cleanUrl(raw.url,source.url)||source.url;
  const record = {
    id:source.id+':'+(raw.key || digest(url+'|'+raw.title+'|'+start.iso)),
    title:text(raw.title), venueId:source.id, venueName:source.name,
    start:start.iso, timezone:ZONE, url, tags:raw.tags||tagsFor(raw.title),
    status:raw.status || 'confirmed', sourceId:source.id, checkedAt
  };
  if (end) record.end=end.iso;
  if (raw.ticketUrl) record.ticketUrl=cleanUrl(raw.ticketUrl,source.url);
  if (raw.priceText) record.priceText=text(raw.priceText);
  if (raw.notes) record.notes=raw.notes;
  if (raw.room) record.room=raw.room;
  if (raw.doors) record.doors=localToISO(raw.doors).iso;
  if (start.ambiguous || end?.ambiguous) {
    record.status='needs_verification';
    record.notes=[...(record.notes||[]),'Clock occurs twice at daylight-saving change; chosen first occurrence needs verification.'];
  }
  return record;
}
function batch(events, count, extras={}) {
  if (!Number.isInteger(count) || count<1) throw new Error('No recognizable event records; possible layout change or empty response.');
  return { events, rawCount:count, complete:true, message:'Dated official listings parsed.', ...extras };
}
export function parseCobraPage(payload, source, checkedAt) {
  if (!payload || !Array.isArray(payload.events) || !Number.isInteger(payload.total) ||
      !Number.isInteger(payload.total_pages)) throw new Error('Cobra API schema changed');
  const events=payload.events.map(e=>{
    if (!e.id || !e.title || !e.start_date || e.timezone!==ZONE) throw new Error('Unexpected Cobra event schema/timezone');
    const $=load(e.description||'');
    const ticket=$('a[href]').map((_,a)=>$(a).attr('href')).get().find(u=>/eventbrite|ticket/i.test(u));
    const desc=text(e.description);
    return eventRecord(source,{
      key:String(e.id),title:e.title,start:e.start_date,
      end:e.end_date>e.start_date ? e.end_date:undefined, url:e.url,
      ticketUrl:ticket,priceText:desc.match(/(?:Tickets?|TICKETS?):?\s*([^@]+?)(?=\s+(?:18|21|All)\s|Add to calendar|$)/i)?.[1]||e.cost,
      tags:tagsFor(e.title),room:/front bar/i.test(e.title)?'Front Bar':'Venue'
    },checkedAt);
  });
  return {events,total:payload.total,totalPages:payload.total_pages};
}
/** Read JSON data only. Never eval the website's JavaScript. */
export function extractJSONArray(script, opening) {
  if (script[opening]!=='[') throw new Error('Expected JSON array');
  let depth=0, quoted=false, escaped=false;
  for (let i=opening;i<script.length;i++) {
    const c=script[i];
    if (quoted) { if(escaped) escaped=false; else if(c==='\\') escaped=true; else if(c==='"') quoted=false; continue; }
    if(c==='"') quoted=true;
    else if(c==='[') depth++;
    else if(c===']' && --depth===0) return JSON.parse(script.slice(opening,i+1));
  }
  throw new Error('Unterminated calendar JSON');
}
export function parseRudys(html, source, checkedAt, window) {
  const $=load(html); let raw;
  $('script').each((_,el)=>{
    const script=$(el).text();
    if (!/fullCalendar/.test(script)) return;
    const match=/\bevents\s*:\s*(\[)/.exec(script);
    if(match) raw=extractJSONArray(script,match.index+match[0].length-1);
  });
  if(!Array.isArray(raw)) throw new Error('Active Rudy FullCalendar JSON array not found');
  const relevant=window?raw.filter(e=>typeof e.start==='string'&&e.start.slice(0,10)>=addDays(window.date,-1)&&e.start.slice(0,10)<window.endDate):raw;
  const events=relevant.map(e=>{
    if(!e.title || !e.start || !e.end) throw new Error('Rudy calendar schema changed');
    // Verified 2026-10-04: source +00:00 is a publisher error, displayed clocks are Central.
    // Keep this exception visible and provisional; do not silently reinterpret other offsets.
    if(!/\+00:00$/.test(e.start)||!/\+00:00$/.test(e.end)) throw new Error('Rudy offset convention changed; recheck visible clock times.');
    const price=[e.presale ? '$'+e.presale+' advance':null,e.cover?'$'+e.cover+' door':null].filter(Boolean).join(' / ');
    const minimum=text(e.description).match(/\$\d+(?:\.\d+)?\s+food or beverage minimum/i)?.[0];
    return eventRecord(source,{title:e.title,start:e.start.slice(0,19),end:e.end>e.start?e.end.slice(0,19):undefined,
      url:e.eventurl||source.url,ticketUrl:e.eventurl,priceText:[price,minimum].filter(Boolean).join('; '),
      tags:tagsFor(e.title+' jazz'),status:'needs_verification',
      notes:['Publisher raw timestamps end +00:00 but venue displays these clocks as Central. Local clocks retained; verify intended time.',
        'Raw start: '+e.start+'; raw end: '+e.end,
        ...(e.end<=e.start?['End time is invalid/identical in source and is omitted.']:[])]
    },checkedAt);
  });
  return batch(events,raw.length,{message:'Inline dated calendar parsed. Known publisher offset defect flagged on each event.'});
}
export function parseFiveSpot(html, source, checkedAt) {
  const $=load(html), events=[], removedKeys=[];
  const cards=$('.event-card');
  cards.each((_,node)=>{
    const el=$(node), title=el.find('.event-title').text().trim();
    const when=el.find('.event-date-time').text().trim();
    // Support passes have no event date; not evening events.
    if(!when || /ongoing access/i.test(when)) return;
    const href=el.find('a[href*="/shows/"]').first().attr('href');
    const key=href?.match(/\/shows\/(\d+)/)?.[1];
    if(!title || !key) {
      if(/cancelled|canceled/i.test(el.text())) return;
      throw new Error('5 Spot card missing identity/link');
    }
    if(/cancelled|canceled/i.test(el.text())) {removedKeys.push(source.id+':'+key); return;}
    const start=humanDate(when)+'T'+clock(when.split('@').at(-1));
    const suspicious=clock(when.split('@').at(-1)).slice(0,2)<'10';
    events.push(eventRecord(source,{key,title,start,url:href,
      priceText:/free show/i.test(el.text())?'Free show':undefined,
      status:suspicious?'needs_verification':'confirmed',
      notes:suspicious?['Unusually early source time; check venue detail before planning.']:undefined
    },checkedAt));
  });
  return batch(events,cards.length,{complete:false,removedKeys,
    message:'Visible official calendar cards parsed. Future horizon beyond loaded cards is not guaranteed.'});
}
export function parseEastsideBowl(html, source, checkedAt, window) {
  const $=load(html), events=[], details=new Map();
  $('.seetickets-list-event-container').each((_,n)=>{
    const el=$(n), url=el.find('.title a').attr('href');
    if(url) details.set(cleanUrl(url,source.url),{priceText:el.find('.price').text(),tags:tagsFor(el.find('.genre').text())});
  });
  let count=0, months=[];
  $('.seetickets-calendar-year-month-container').each((_,heading)=>{
    const h=$(heading), m=h.text().match(/([A-Za-z]+)\s+(20\d{2})/);
    if(!m) throw new Error('Eastside calendar lost month/year');
    const month=MONTHS.indexOf(m[1].slice(0,3).toLowerCase())+1;
    if(!month) throw new Error('Unrecognized Eastside month');
    months.push(m[0]);
    h.next('table.seetickets-calendar').find('td').each((_,cell)=>{
      const day=$(cell).find('.date-number').first().text().trim();
      $(cell).find('.seetickets-calendar-event-container').each((_,n)=>{
        count++;
        const el=$(n), link=el.find('.seetickets-calendar-event-title a').first();
        const title=link.text().trim(), url=cleanUrl(link.attr('href'),source.url);
        if(/event passed|cancelled|canceled/i.test(el.text())) return;
        const date=m[2]+'-'+String(month).padStart(2,'0')+'-'+day.padStart(2,'0');
        if(window&&(date<addDays(window.date,-1)||date>=window.endDate))return;
        const display=el.find('.seetickets-calendar-event-date').text();
        const show=display.match(/Show at\s*(\d{1,2}(?::\d{2})?\s*[AP]M)/i)?.[1];
        const door=display.match(/Doors at\s*(\d{1,2}(?::\d{2})?\s*[AP]M)/i)?.[1];
        if(!show || !day || !url) throw new Error('Eastside show missing date/time/link');
        const extra=details.get(url)||{};
        events.push(eventRecord(source,{key:digest(url+'|'+date),title,start:date+'T'+clock(show),url,ticketUrl:url,
          doors:door?date+'T'+clock(door):undefined,...extra,
          room:/The [’']58/i.test(title)?"The '58":undefined},checkedAt));
      });
    });
  });
  return batch(events,count,{complete:false,
    message:'Official month tables parsed ('+months.join(', ')+'). Ticket list pagination not needed for these tables; unrendered months remain unchecked.'});
}
export function parseAmericano(html, source, checkedAt) {
  const $=load(html),events=[], cards=$('.mec-event-article');
  cards.each((_,n)=>{
    const el=$(n), title=el.find('.mec-event-title a').text().trim(), url=el.find('.mec-event-title a').attr('href');
    const date=humanDate(el.find('.mec-start-date-label,.mec-event-date').first().text());
    const times=el.find('.mec-event-time').text().match(/\d{1,2}(?::\d{2})?\s*(?:am|pm)/gi);
    if(!times||times.length!==2) throw new Error('Americano visible time range changed');
    const start=date+'T'+clock(times[0]); let end=date+'T'+clock(times[1]);
    if(end<=start) end=addDays(date,1)+'T'+clock(times[1]);
    events.push(eventRecord(source,{title,start,end,url,status:'needs_verification',
      notes:['Uses visible calendar clock; known JSON-LD clock and recurrence conflicts require date-specific verification.',
        'Admission not established; plugin price=0 is not proof of free admission.']},checkedAt));
  });
  return batch(events,cards.length,{complete:false,message:'Visible dates/times parsed; JSON-LD timestamps intentionally ignored due to verified source conflict.'});
}
export function parseBourbon(payload, source, checkedAt) {
  if(!Array.isArray(payload)) throw new Error('Bourbon calendar did not return an array');
  const events=payload.map(e=>{
    if(!e.titleText||!e.start||!e.event_id) throw new Error('Bourbon event schema changed');
    return eventRecord(source,{key:String(e.event_id),title:e.titleText,start:e.start,
      url:e.url,notes:['End time omitted: visible late-set duration conflicts with reservation metadata.']},checkedAt);
  });
  return batch(events,payload.length);
}
export function parseFlamingo(html,source,checkedAt,window) {
  const body=text(html);
  if(!/WEDNESDAY\s*:\s*THE INVITE\s*\|\s*8:30PM/i.test(body)) throw new Error('Flamingo Wednesday wording/time changed; manual recheck needed.');
  const events=[];
  // Short provisional horizon, because undated recurring copy does not confirm future dates.
  for(let i=0;i<Math.min(window.days,14);i++){
    const date=addDays(window.date,i);
    if(new Date(date+'T12:00:00Z').getUTCDay()!==3) continue;
    events.push(eventRecord(source,{title:'The Invite — curated jam (standing schedule)',start:date+'T20:30:00',
      status:'needs_verification',url:source.url,tags:['jam','live music'],
      notes:['Generated from an undated Wednesday schedule; lineup and operation on this date are not confirmed.']},checkedAt));
  }
  return batch(events,1,{complete:false,message:'Standing Wednesday schedule only; provisional dates limited to 14 days.'});
}

/** The chronological venue list is server-rendered; the calendar's sidebar is not a full schedule. */
export function parseBasementPage(html,source,checkedAt,pageUrl=source.url) {
  const $=load(html), cards=$('.tw-plugin-upcoming-event-list .tw-section'),events=[],removedKeys=[];
  if(!cards.length)throw new Error('Basement East chronological event cards missing; refusing an empty snapshot');
  cards.each((_,node)=>{
    const el=$(node), link=el.find('.tw-name a').first(),title=text(link.text());
    const url=cleanUrl(link.attr('href'),source.url);
    const venue=text(el.find('.tw-venue-name').first().text());
    if(venue!=='The Basement East')throw new Error('Basement East venue scope changed: '+venue);
    const date=humanDate([el.find('.date-month').first().text(),el.find('.date-day').first().text(),el.find('.date-year').first().text()].join(' '));
    const ticketLink=el.find('.tw-buy-tix-btn').first(),ticketUrl=cleanUrl(ticketLink.attr('href'),source.url);
    const key=ticketUrl?.match(/\/tickets\/(\d+)/)?.[1]||ticketUrl?.match(/-tickets\/(\d+)/)?.[1]||digest(url+'|'+date);
    if(!title||!url||!new URL(url).pathname.startsWith('/tm-event/'))throw new Error('Basement East event missing title/detail URL');
    if(/\bcancel(?:led|ed)\b/i.test(title+' '+ticketLink.text())){removedKeys.push(source.id+':'+key);return;}
    // Grouped multi-date cards need explicit handling, never silently take their first clock.
    if(el.find('.tw-event-time').length!==1)throw new Error('Basement East grouped event clocks need manual verification');
    const start=date+'T'+clock(el.find('.tw-event-time').text());
    const zone=text(el.find('.tw-event-timezone').first().text());
    const iso=localToISO(start).iso;
    if(!['CDT','CST'].includes(zone)||(zone==='CDT'&&!iso.endsWith('-05:00'))||(zone==='CST'&&!iso.endsWith('-06:00')))
      throw new Error('Basement East timezone disagrees with Nashville date: '+date+' '+zone);
    const door=text(el.find('.tw-event-door-time').first().text());
    const age=text(el.find('.tw-age-restriction').first().text());
    const soldOut=/sold\s*out/i.test(title+' '+ticketLink.text());
    const notes=[...(age?['Age restriction: '+age+'.']:[]),...(soldOut?['Venue lists this show as sold out; do not assume ticket availability.']:[])];
    events.push(eventRecord(source,{key,title,start,url,ticketUrl,
      doors:door?date+'T'+clock(door):undefined,priceText:text(el.find('.tw-price').first().text())||undefined,
      tags:[...new Set(['music',...tagsFor(title)])],notes},checkedAt));
  });
  const nav=$('.tm-paginate'),currentText=nav.find('.current').text().trim();
  const currentPage=currentText?Number(currentText):1;
  const pageNumbers=nav.find('.page-numbers').map((_,node)=>Number($(node).text().trim())).get().filter(n=>Number.isInteger(n)&&n>0);
  const totalPages=Math.max(currentPage,...pageNumbers);
  const next=nav.find('a.next').attr('href'),nextUrl=next?cleanUrl(next,pageUrl):null;
  if(!Number.isInteger(currentPage)||currentPage<1||currentPage>50||totalPages>50)throw new Error('Basement East pagination schema/limit changed');
  if((currentPage<totalPages)!==Boolean(nextUrl))throw new Error('Basement East pagination next link missing or inconsistent');
  return {events,removedKeys,rawCount:cards.length,currentPage,totalPages,nextUrl};
}

export async function fetchBasementEast(source,checkedAt,window,request=fetchPublic) {
  const events=new Map(),removedKeys=[],seenPages=new Set();let nextUrl=source.url,expectedPages;
  for(let page=1;page<=50;page++){
    const url=new URL(nextUrl),expected=page===1?'/basement-east-events/':'/basement-east-events/page/'+page+'/';
    if(url.origin!==new URL(source.url).origin||url.pathname!==expected||url.search||url.hash)
      throw new Error('Basement East pagination escaped the expected public venue path');
    const parsed=parseBasementPage(await request(url.href),source,checkedAt,url.href);
    expectedPages??=parsed.totalPages;
    if(parsed.currentPage!==page||parsed.totalPages!==expectedPages)throw new Error('Basement East pagination changed during fetch; retaining previous snapshot');
    const signature=parsed.events.map(e=>e.id).join('|')+'|'+parsed.removedKeys.join('|');
    if(seenPages.has(signature))throw new Error('Basement East pagination repeated a page');
    seenPages.add(signature);
    for(const event of parsed.events){
      const prior=events.get(event.id);
      if(prior&&(prior.start!==event.start||prior.title!==event.title))throw new Error('Basement East event changed during pagination');
      events.set(event.id,event);
    }
    removedKeys.push(...parsed.removedKeys);
    if(!parsed.nextUrl)return {events:[...events.values()].filter(e=>inWindow(e,window)),removedKeys,rawCount:events.size,complete:true,
      message:'All '+page+' official chronological venue page(s) fetched, including sold-out shows; sidebar excluded.'};
    nextUrl=parsed.nextUrl;
  }
  throw new Error('Basement East pagination exceeded bounded 50-page limit');
}

export const ADAPTERS = [
  {id:'cobra',name:'Cobra Nashville',url:'https://cobranashville.com/',type:'cobra'},
  {id:'rudys-jazz-room',name:"Rudy's Jazz Room",url:'https://www.rudysjazzroom.com/calendar',parse:parseRudys},
  {id:'five-spot',name:'The 5 Spot',url:'https://the5spotnashville.com/',parse:parseFiveSpot},
  {id:'eastside-bowl',name:'Eastside Bowl',url:'https://shows.eastsidebowl.com/',parse:parseEastsideBowl},
  {id:'flamingo',name:'Flamingo Cocktail Club',url:'https://www.flamingococktailclub.com/events',parse:parseFlamingo},
  {id:'americano-lounge',name:'Americano Lounge',url:'https://www.americanolounge.com/calendar/',parse:parseAmericano},
  {id:'bourbon-street',name:'Bourbon Street Blues and Boogie Bar',url:'https://www.bourbonstreetbluesandboogiebar.com/schedule',type:'bourbon'},
  {id:'basement-east',name:'The Basement East',url:'https://www.thebasementnashville.com/basement-east-events/',type:'basement-east'},
  ...MTG_ADAPTERS
];
const COVERED = {
  'cobra-slc':'cobra','another-night-another-dream':'cobra','cobra-bloodrave':'cobra','bloodrave':'cobra','blood-rave':'cobra',
  'rudys-sunday-jazz-jam':'rudys-jazz-room','five-spot-funk-night':'five-spot'
};
export function makeWindow(now=new Date(), days=45) {
  if(!Number.isInteger(days)||days<1||days>90) throw new Error('days must be an integer from 1 to 90');
  const date=localParts(now).date, endDate=addDays(date,days);
  return {date,endDate,days,start:localToISO(date+'T00:00:00').iso,end:localToISO(endDate+'T00:00:00').iso};
}
export function inWindow(event, window) {
  const start=+new Date(event.start), end=event.end?+new Date(event.end):start;
  return Number.isFinite(start)&&Number.isFinite(end)&&end>=+new Date(window.start)&&start<+new Date(window.end);
}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function fetchPublic(url, options={}, dependencies={}) {
  const fetchImpl=dependencies.fetchImpl||fetch, sleep=dependencies.sleep||delay;
  const { timeoutMs=20000, ...request }=options;
  for(let attempt=0;attempt<2;attempt++){
    try {
      const response=await fetchImpl(url,{
        ...request,signal:AbortSignal.timeout(timeoutMs),
        headers:{'User-Agent':'NashvilleGuide/1.0 (public calendar refresh)','Accept':'text/html,application/json',...request.headers}
      });
      if([401,403,429].includes(response.status)) {
        const error=new Error('HTTP '+response.status+'; stopped without bypass/retry');
        error.noRetry=true; error.retryAfter=response.headers?.get('retry-after'); throw error;
      }
      if(!response.ok) {
        const error=new Error('HTTP '+response.status); error.noRetry=response.status<500; throw error;
      }
      const body=await response.text();
      if(/captcha|verify you are human|just a moment/i.test(body.slice(0,6000))&&!/<article|event-card|fullCalendar/i.test(body)) {
        const error=new Error('Access challenge detected; manual verification required'); error.noRetry=true; throw error;
      }
      if(body.length>15_000_000) throw new Error('Calendar exceeds 15 MB safety limit');
      return body;
    } catch(error) {
      if(error.noRetry||attempt===1) throw error;
      await sleep(1200); // One bounded retry for network/server failures; never for access challenges.
    }
  }
}
export async function fetchCobra(source, checkedAt, window, request=fetchPublic) {
  const events=[],seenPages=new Set(); let expectedTotal=null,expectedPages=null;
  for(let page=1;page<=50;page++){
    const url=new URL('/wp-json/tribe/events/v1/events','https://cobranashville.com/');
    Object.entries({start_date:addDays(window.date,-1),end_date:window.endDate,per_page:50,page}).forEach(([k,v])=>url.searchParams.set(k,String(v)));
    const payload=JSON.parse(await request(url.href));
    const parsed=parseCobraPage(payload,source,checkedAt);
    if(expectedTotal===null){expectedTotal=parsed.total;expectedPages=parsed.totalPages;}
    if(parsed.total!==expectedTotal||parsed.totalPages!==expectedPages) throw new Error('Cobra pagination changed during fetch; retaining previous snapshot');
    const signature=parsed.events.map(e=>e.id).join('|');
    if(signature&&seenPages.has(signature)) throw new Error('Cobra pagination repeated a page');
    seenPages.add(signature); events.push(...parsed.events);
    if(page>=parsed.totalPages) {
      if(events.length!==expectedTotal) throw new Error('Incomplete Cobra pagination');
      return {events,rawCount:events.length,complete:true,message:'All '+page+' public API page(s) fetched.'};
    }
  }
  throw new Error('Cobra pagination exceeded bounded 50-page limit');
}
export async function runAdapter(source, checkedAt, window, request=fetchPublic) {
  if(source.type==='cobra') return fetchCobra(source,checkedAt,window,request);
  if(source.type==='basement-east') return fetchBasementEast(source,checkedAt,window,request);
  if(source.type==='mtg') return fetchMtg(source,checkedAt,window,request,eventRecord);
  if(source.type==='bourbon'){
    const body=await request('https://www.bourbonstreetbluesandboogiebar.com/schedule/calendarEvents',{
      method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({flt_startdt:addDays(window.date,-1),flt_enddt:window.endDate,filter_viewalleve:'Y'}).toString()
    });
    return parseBourbon(JSON.parse(body),source,checkedAt);
  }
  return source.parse(await request(source.url),source,checkedAt,window);
}
/** Merge per source. Failed/partial fetches must not erase last-known records. */
export function mergeSource(previous, source, result, error, checkedAt, window) {
  const old=(previous.events||[]).filter(e=>e.sourceId===source.id);
  const oldSource=(previous.sources||[]).find(s=>s.id===source.id);
  if(error) return {
    source:{id:source.id,name:source.name,url:source.url,status:'failed',
      lastSuccessAt:oldSource?.lastSuccessAt||null,lastAttemptAt:checkedAt,
      message:error.message+'; retained '+old.length+' last-known event(s).'},
    events:old.map(e=>({...e,status:'needs_verification',stale:true}))
  };
  const fresh=result.events.filter(e=>inWindow(e,window));
  const byId=new Map((result.complete?[]:old.filter(e=>inWindow(e,window))).map(e=>[e.id,{...e,status:'needs_verification',stale:true}]));
  for(const id of result.removedKeys||[]) byId.delete(id);
  for(const event of fresh) byId.set(event.id,event);
  return {
    source:{id:source.id,name:source.name,url:source.url,status:result.complete?'ok':'partial',
      lastSuccessAt:checkedAt,lastAttemptAt:checkedAt,message:result.message+' '+fresh.length+' event(s) in requested horizon.'},
    events:[...byId.values()]
  };
}
async function readJSON(file, fallback) {
  try {return JSON.parse(await readFile(file,'utf8'));}
  catch(error){if(error.code==='ENOENT')return fallback;throw error;}
}
const VERIFIED_PROVENANCE='verified-snapshot';
function occurrenceLinks(event) {
  return [event.url,event.ticketUrl].filter(Boolean).map(value=>{
    const url=cleanUrl(value);if(!url)return null;
    // Query parameters may carry event identity (Google Calendar eid, event.php?id).
    const parsed=new URL(url);parsed.hash='';
    return event.venueId+'|'+(+new Date(event.start))+'|'+parsed.href.replace(/\/$/,'');
  }).filter(Boolean);
}
function validCheckedAt(value) {
  // Public research may establish only the day. Keep that precision verbatim.
  if(typeof value!=='string'||!Number.isFinite(+new Date(value)))return false;
  if(/^\d{4}-\d\d-\d\d$/.test(value))return new Date(value).toISOString().slice(0,10)===value;
  return /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value);
}
function validateVerifiedEvents(data) {
  if(!data||!Array.isArray(data.events))throw new Error('Verified snapshot must contain an events array');
  const ids=new Set();
  for(const event of data.events){
    if(!event||['id','title','venueId','venueName','sourceId','url','start','checkedAt'].some(k=>typeof event[k]!=='string'||!event[k])||
      (event.timezone!==undefined&&event.timezone!==ZONE)||!Array.isArray(event.tags)||!['confirmed','needs_verification'].includes(event.status)||
      !cleanUrl(event.url)||!validCheckedAt(event.checkedAt)||
      !/[+-]\d\d:\d\d$/.test(event.start)||!Number.isFinite(+new Date(event.start))||
      (event.end&&(!/[+-]\d\d:\d\d$/.test(event.end)||!(+new Date(event.end)>+new Date(event.start)))))
      throw new Error('Invalid verified event schema: '+(event?.id||'unknown'));
    if(ids.has(event.id))throw new Error('Duplicate verified event id: '+event.id);
    ids.add(event.id);
  }
  return data.events.map(event=>({...event,timezone:event.timezone??ZONE}));
}
/** Dated manual evidence is not a fresh network check. Live records always win on ID. */
export function mergeVerifiedSnapshot(result, previous, verified, error, checkedAt, window) {
  const retained=(previous.events||[]).filter(e=>e.provenance===VERIFIED_PROVENANCE);
  const incoming=(error?retained:verified).filter(e=>inWindow(e,window));
  const byId=new Map(result.events.filter(e=>e.provenance!==VERIFIED_PROVENANCE).map(e=>[e.id,e]));
  const liveLinks=new Map([...byId.values()].filter(e=>!e.stale).flatMap(e=>occurrenceLinks(e).map(link=>[link,e])));
  const sourceIds=new Set([...retained,...incoming].map(e=>e.sourceId));
  for(const event of incoming){
    const liveMatch=occurrenceLinks(event).map(link=>liveLinks.get(link)).find(Boolean);
    if(liveMatch){
      // Reviewed genre/activity labels remain useful; live dates, title, price,
      // status and ticket availability must never be overwritten by old evidence.
      liveMatch.tags=[...new Set([...(liveMatch.tags||[]),...(event.tags||[])])];
      continue;
    }
    if(byId.has(event.id))continue;
    byId.set(event.id,{...event,provenance:VERIFIED_PROVENANCE,
      ...(error?{status:'needs_verification',stale:true}:{}),
      notes:[...(event.notes||[]).filter(n=>n!=='Dated official snapshot; not automatically reverified.'),
        'Dated official snapshot; not automatically reverified.']});
  }
  for(const id of sourceIds){
    // Automatic-source health still describes its adapter, not this supplementary file.
    if(ADAPTERS.some(source=>source.id===id))continue;
    const snapshots=[...byId.values()].filter(e=>e.sourceId===id&&e.provenance===VERIFIED_PROVENANCE);
    let source=result.sources.find(s=>s.id===id);
    const example=snapshots[0]||retained.find(e=>e.sourceId===id);
    if(!source&&example){source={id,name:example.venueName,url:example.url};result.sources.push(source);}
    if(!source)continue;
    const oldSource=(previous.sources||[]).find(s=>s.id===id);
    const latest=snapshots.map(e=>e.checkedAt).sort((a,b)=>+new Date(b)-+new Date(a))[0];
    Object.assign(source,{status:error?'failed':snapshots.length?'partial':'manual',
      lastSuccessAt:error?(oldSource?.lastSuccessAt||latest||null):(latest||null),lastAttemptAt:checkedAt,
      message:error?'Verified snapshot could not be read: '+error.message+'; retained '+snapshots.length+' dated snapshot(s) in the requested horizon. No automatic adapter.':
        snapshots.length+' dated official snapshot(s) in the requested horizon; not automatically reverified. No automatic adapter.'});
  }
  return {...result,events:[...byId.values()]};
}
export async function sourceInventory(root=ROOT) {
  const catalog=await readJSON(path.join(root,'public/data/catalog.json'),{entries:[]});
  const map=new Map();
  for(const entry of Array.isArray(catalog)?catalog:catalog.entries||[]){
    if(entry.id) map.set(entry.id,{id:entry.id,name:entry.name||entry.id,url:entry.officialUrl||''});
  }
  // Private research can contain personal matching notes. Only reviewed catalog
  // entries and explicit public adapters may introduce source names here.
  for(const adapter of ADAPTERS)map.set(adapter.id,{id:adapter.id,name:adapter.name,url:adapter.url});
  return [...map.values()];
}
export async function refresh({
  root=ROOT,now=new Date(),days=45,selected,previous,request=fetchPublic,onProgress=()=>{}
}={}) {
  const checkedAt=now.toISOString(),window=makeWindow(now,days);
  previous ??= await readJSON(path.join(root,'public/data/events.json'),{sources:[],events:[]});
  const sources=[],events=[];
  const inventory=await sourceInventory(root);
  for(const source of inventory){
    const adapter=ADAPTERS.find(a=>a.id===source.id), coveredBy=COVERED[source.id];
    if(!adapter||selected&&!selected.includes(source.id)){
      const oldSource=(previous.sources||[]).find(s=>s.id===source.id);
      const old=(previous.events||[]).filter(e=>e.sourceId===source.id);
      sources.push({id:source.id,name:source.name,url:source.url,
        status:coveredBy?'covered':adapter?(oldSource?.status||'manual'):'manual',lastSuccessAt:oldSource?.lastSuccessAt||null,
        ...(coveredBy?{coveredBy}:{}),
        message:coveredBy?'Check actual dated listings through '+coveredBy+'.':
          adapter?'Not requested in this limited refresh; previous events retained.':
          'Manual verification required; no tested automatic schedule adapter. An empty event list is not proof of no events.'});
      events.push(...old); continue;
    }
    onProgress('Checking '+source.name);
    let result,error;
    try{result=await runAdapter(adapter,checkedAt,window,request);}
    catch(e){error=e;}
    const merged=mergeSource(previous,source,result,error,checkedAt,window);
    sources.push(merged.source);events.push(...merged.events);
    onProgress(source.name+': '+merged.source.status+' — '+merged.source.message);
  }
  // Preserve unknown/removed source snapshots for audit rather than silently erasing them.
  for(const source of previous.sources||[]){
    if(sources.some(s=>s.id===source.id))continue;
    sources.push({...source,status:'manual',message:'Source absent from current inventory; last-known events retained for review.'});
    events.push(...(previous.events||[]).filter(e=>e.sourceId===source.id));
  }
  let verified=[],verifiedError;
  try{
    const data=await readJSON(path.join(root,'data/verified-events.json'),null);
    if(data===null&&(previous.events||[]).some(e=>e.provenance===VERIFIED_PROVENANCE))
      throw new Error('Previously used verified-events.json is missing');
    verified=validateVerifiedEvents(data||{events:[]});
  }catch(error){verifiedError=error;}
  const result=mergeVerifiedSnapshot({checkedAt,timezone:ZONE,window:{start:window.start,end:window.end},
    sources,events:[...new Map(events.map(e=>[e.id,e])).values()]},previous,verified,verifiedError,checkedAt,window);
  if(verifiedError){result.verifiedSnapshotError=verifiedError.message;onProgress('Verified snapshot: '+verifiedError.message);}
  result.events.sort((a,b)=>+new Date(a.start)-+new Date(b.start));
  return result;
}
export async function saveSnapshot(result,root=ROOT,renameFile=rename,platform=process.platform) {
  const directory=path.join(root,'public/data'); await mkdir(directory,{recursive:true});
  const scratch=path.join(root,'.tmp'); await mkdir(scratch,{recursive:true});
  const destination=path.join(directory,'events.json'),temporary=path.join(scratch,'events.'+process.pid+'.tmp');
  const serialized=JSON.stringify(result,null,2)+'\n';
  await writeFile(temporary,serialized,'utf8');
  // Windows/OneDrive scanners can hold the destination briefly. Preserve the
  // previous snapshot and keep incomplete files outside the published directory.
  for(let attempt=0;;attempt++) {
    try { await renameFile(temporary,destination); return; }
    catch(error) {
      if(!['EPERM','EBUSY','EACCES'].includes(error.code))throw error;
      if(attempt>=5) {
        // Some Windows workspace ACLs allow editing but deny replacing a file.
        // Keep both incoming and previous snapshots outside public, then edit the
        // existing file. Build/JSON validation must succeed before publication.
        if(platform!=='win32'||!['EPERM','EACCES'].includes(error.code))throw error;
        const previous=await readFile(destination,'utf8');
        JSON.parse(previous);
        await writeFile(path.join(scratch,'events.previous.'+Date.now()+'.json'),previous,'utf8');
        await writeFile(destination,serialized,'utf8');
        JSON.parse(await readFile(destination,'utf8'));
        return;
      }
      await new Promise(resolve=>setTimeout(resolve,Math.min(100*2**attempt,1000)));
    }
  }
}
async function main(){
  const args=process.argv.slice(2),daysArg=args.find(a=>a.startsWith('--days=')),
    sourcesArg=args.find(a=>a.startsWith('--sources='));
  const allowed=args.every(a=>a==='--dry-run'||a.startsWith('--days=')||a.startsWith('--sources='));
  if(!allowed)throw new Error('Options: --days=1..90 --sources=id,id --dry-run');
  const selected=sourcesArg?.slice(10).split(',').filter(Boolean);
  if(selected?.some(id=>!ADAPTERS.some(s=>s.id===id)))throw new Error('Unknown automatic source in --sources');
  const result=await refresh({days:daysArg?Number(daysArg.slice(7)):45,selected,onProgress:message=>console.error(message)});
  if(!args.includes('--dry-run'))await saveSnapshot(result);
  console.log(JSON.stringify({checkedAt:result.checkedAt,eventCount:result.events.length,
    sources:result.sources.map(({id,status,message})=>({id,status,message})),written:!args.includes('--dry-run')},null,2));
  // Source failure is reported in data and exit code, even when other sources work.
  if(result.verifiedSnapshotError||result.sources.some(s=>s.status==='failed'))process.exitCode=2;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
}
