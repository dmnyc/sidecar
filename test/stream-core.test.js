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
