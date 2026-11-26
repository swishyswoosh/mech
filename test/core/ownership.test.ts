import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ResourceArbiter} from '../../core/ownership.ts';
import {commands} from '../../core/commands.ts';

test('acknowledged scoped stops release only their matching owner',()=>{
 const arbiter=new ResourceArbiter();
 arbiter.accept(commands.stopAnimation());
 assert.ok(arbiter.conflicts(commands.head(10)), 'unknown sources remain reserved');
 arbiter.clear();
 arbiter.accept(commands.animation(7));
 assert.ok(arbiter.conflicts(commands.audio(1609)));
 arbiter.accept(commands.stopAudio());
 assert.ok(arbiter.conflicts(commands.audio(1609)), 'audio stop cannot release animation');
 arbiter.accept(commands.stopAnimation());
 assert.equal(arbiter.conflicts(commands.audio(1609)),undefined);
 arbiter.accept(commands.audio(1609));
 arbiter.accept(commands.stopAudio());
 assert.equal(arbiter.conflicts(commands.animation(7)),undefined);
});
