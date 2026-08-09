import assert from 'node:assert/strict';
import { buildPublicProfile,isOnboardingComplete,parseArgs,reconcile } from '../functions/scripts/reconcilePublicUsersForOnboarding.js';
assert.equal(isOnboardingComplete({onboardingStep:5}),true);
assert.equal(isOnboardingComplete({ageVerified:true,isAdult:true,onboardingStep:2}),false);
assert.deepEqual(parseArgs(['--apply','--uid','abc','--project=p']),{apply:true,deleteOrphans:false,uid:'abc',project:'p',dryRun:false});
const payload=buildPublicProfile('abcdef',{displayName:'Codex',email:'private@x',birthDate:'x',onboardingStep:5,ageVerified:false},()=>1);
assert.equal(payload.onboardingComplete,true); assert.equal(payload.email,undefined); assert.equal(payload.birthDate,undefined);
function fakeDb(users,publicUsers){let commits=0;const col=(name)=>({get:async()=>({docs:[...(name==='users'?users:publicUsers)].map(([id,data])=>snap(name,id,data))}),doc:(id)=>({id,path:`${name}/${id}`,get:async()=>{const row=(name==='users'?users:publicUsers).find(x=>x[0]===id);return snap(name,id,row?.[1],!!row)}})});const snap=(name,id,data,exists=data!==undefined)=>({id,exists,data:()=>data,ref:{id,path:`${name}/${id}`}});return {collection:col,batch:()=>({set(){},delete(){},commit:async()=>{commits++;}}),get commits(){return commits;}};}
const data=[['done',{displayName:'Done',onboardingStep:5}],['pending',{onboardingComplete:false,ageVerified:true,isAdult:true}]];
const pubs=[['pending',{onboardingComplete:true}],['orphan',{onboardingComplete:true}]];
const dry=fakeDb(data,pubs);const stats=await reconcile({db:dry});assert.equal(dry.commits,0);assert.equal(stats.writes,1);assert.equal(stats.deletes,1);assert.equal(stats.orphanPublicProfiles,1);
const apply=fakeDb(data,pubs);await reconcile({db:apply,apply:true});assert.equal(apply.commits,1);
console.log('PASS reconcilePublicUsersForOnboarding.test');
