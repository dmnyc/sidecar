const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Directory, httpsUrl, parse } = require('../stream-core.js');
const event = (time=1000,status='live') => ({kind:30311,id:String(time),pubkey:'a'.repeat(64),created_at:time,tags:[['d','test'],['status',status],['streaming','https://example.com/live.m3u8']]});
test('newer ended announcement removes previously live listing',()=>{const d=new Directory();d.accept(event(),1000);assert.equal(d.live(1000).length,1);d.accept(event(1001,'ended'),1001);assert.equal(d.live(1001).length,0);d.accept(event(),1001);assert.equal(d.live(1001).length,0);});
test('a stream expires without updates',()=>{const d=new Directory();d.accept(event(),1000);assert.equal(d.live(4601).length,0);});
test('rejects unsafe playback URLs and malformed events',()=>{for(const u of ['javascript:alert(1)','http://example.com','https://user:pass@example.com','file:///tmp/a'])assert.equal(httpsUrl(u),null);assert.equal(parse({...event(),tags:null}),null);assert.equal(parse(event(5000),1000),null);});
test('newer same-address update replaces stream URL and deduplicates relays',()=>{const d=new Directory();d.accept(event(),1000);d.accept(event(),1000);const e=event(1001);e.tags[2][1]='https://example.com/new.m3u8';d.accept(e,1001);assert.equal(d.live(1001).length,1);assert.equal(d.live(1001)[0].url,'https://example.com/new.m3u8');});

test('profile destination uses declared host rather than announcement publisher',()=>{const e=event();e.tags.push(['p','b'.repeat(64),'','host']);assert.equal(parse(e,1000).host,'b'.repeat(64));});

test('capitalized Host participant identifies the streamer',()=>{const e=event();e.tags.push(['p','b'.repeat(64),'','Host']);assert.equal(parse(e,1000).host,'b'.repeat(64));});

test('viewer counts distinguish missing data from a reported zero',()=>{assert.equal(parse(event(),1000).viewers,null);for(const [value,expected] of [['0',0],['123',123],['-1',null],['unknown',null],['9007199254740992',null]]){const e=event();e.tags.push(['current_participants',value]);assert.equal(parse(e,1000).viewers,expected);}});

test('unnamed stream participants get stable cocktail aliases rather than public keys',()=>{
 const {cocktailName}=require('../stream-core');
 const key='a'.repeat(64),name=cocktailName(key);
 assert.equal(name,cocktailName(key));
 assert.match(name,/^[A-Za-z-]+ [A-Za-z]+$/);
 assert.ok(!name.includes('npub'));
 const names=new Set(Array.from({length:100},(_,i)=>cocktailName(i.toString(16).padStart(64,'0'))));
 assert.ok(names.size>70);
});

test('stream metadata retains description, categories, and a valid actual start',()=>{
 const e=event();e.tags.push(['summary','A station\nwith music'],['starts','100'],['t','music']);
 const item=parse(e,1000);assert.equal(item.starts,100);assert.equal(item.summary,'A station\nwith music');assert.deepEqual(item.categories,['music']);
 for(const start of ['','-1','1001','not a date','9007199254740992']){e.tags=e.tags.filter(t=>t[0]!=='starts');e.tags.push(['starts',start]);assert.equal(parse(e,1000).starts,null);}
});
test('runtime uses days for long-running streams and omits unknown starts',()=>{
 const {runtime}=require('../stream-core');assert.equal(runtime(null),null);assert.equal(runtime(200,100),null);
 assert.deepEqual(runtime(1,1+367*86400+2*3600+14*60),{days:367,hours:2,minutes:14});
});
