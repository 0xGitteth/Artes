import assert from 'node:assert/strict';
import { PRIVATE_FIELDS,buildPublicProfile,isOnboardingComplete,parseArgs,reconcile } from '../functions/scripts/reconcilePublicUsersForOnboarding.js';
assert.equal(isOnboardingComplete({onboardingStep:5}),true);
assert.equal(isOnboardingComplete({onboardingStep:'5'}),true);
assert.equal(isOnboardingComplete({ageVerified:true,isAdult:true,onboardingStep:2}),false);
assert.deepEqual(parseArgs(['--apply','--uid','abc','--project=p']),{apply:true,deleteOrphans:false,uid:'abc',project:'p',dryRun:false});
const payload=buildPublicProfile('abcdef',{displayName:'Codex',email:'private@x',birthDate:'x',onboardingStep:5,ageVerified:false},()=>1);
assert.equal(payload.onboardingComplete,true); assert.equal(payload.email,undefined); assert.equal(payload.birthDate,undefined);
assert.equal(payload.onboardingStep,5);
assert.ok(['triggerVisibility','authDisplayName','firebaseDisplayName','googleDisplayName'].every(field=>PRIVATE_FIELDS.includes(field)));
const malformed=buildPublicProfile('abcdef',{
  displayName:7,roles:'maker',themes:[null,' portrait ',4],photoURL:{url:'private'},
  headerImage:[],linkedAgencyStatus:{bad:true},quickProfilePreviewMode:42,quickProfilePostIds:'post',
  onboardingStep:'5',
},()=>1);
assert.equal(malformed.displayName,''); assert.deepEqual(malformed.roles,[]); assert.deepEqual(malformed.themes,['portrait']);
assert.equal(malformed.photoURL,undefined); assert.equal(malformed.headerImage,undefined); assert.equal(malformed.linkedAgencyStatus,undefined);
assert.equal(malformed.quickProfilePreviewMode,undefined); assert.equal(malformed.quickProfilePostIds,undefined); assert.equal(malformed.onboardingStep,5);

function fakeDb(users,publicUsers,{failCommit=false}={}){let commits=0,batches=0;const writes=[];const col=(name)=>({get:async()=>({docs:[...(name==='users'?users:publicUsers)].map(([id,data])=>snap(name,id,data))}),doc:(id)=>({id,path:`${name}/${id}`,get:async()=>{const row=(name==='users'?users:publicUsers).find(x=>x[0]===id);return snap(name,id,row?.[1],!!row)}})});const snap=(name,id,data,exists=data!==undefined)=>({id,exists,data:()=>data,ref:{id,path:`${name}/${id}`}});return {collection:col,batch:()=>{const batchId=++batches;return {set(ref,data,options){writes.push({batchId,action:'set',ref,data,options});},delete(ref){writes.push({batchId,action:'delete',ref});},commit:async()=>{commits++;if(failCommit)throw new Error('commit failed');}};},get commits(){return commits;},get batches(){return batches;},writes};}
const data=[['done',{displayName:'Done',onboardingStep:5}],['pending',{onboardingComplete:false,ageVerified:true,isAdult:true}]];
const pubs=[['pending',{onboardingComplete:true}],['orphan',{onboardingComplete:true}]];
const dry=fakeDb(data,pubs);const stats=await reconcile({db:dry});assert.equal(dry.commits,0);assert.equal(stats.writes,1);assert.equal(stats.deletes,1);assert.equal(stats.orphanPublicProfiles,1);
const apply=fakeDb(data,pubs);await reconcile({db:apply,apply:true});assert.equal(apply.commits,1);

const deleteToken=Symbol('delete');
const cleanupDb=fakeDb(
  [['done',{displayName:'Current',onboardingStep:'5',roles:['maker'],themes:[]}]],
  [['done',{displayName:'Old',onboardingStep:5,bio:'stale',photoURL:'stale.jpg',headerImage:'stale.jpg',fansCount:9,createdAt:1,triggerVisibility:{},authDisplayName:'Private',firebaseDisplayName:'Private',googleDisplayName:'Private'}]],
);
await reconcile({db:cleanupDb,apply:true,deleteValue:()=>deleteToken,serverTimestamp:()=>2});
const cleanupWrite=cleanupDb.writes.find(write=>write.action==='set').data;
for(const field of ['bio','photoURL','headerImage','triggerVisibility','authDisplayName','firebaseDisplayName','googleDisplayName']) assert.equal(cleanupWrite[field],deleteToken,`${field} is deleted`);
assert.equal(cleanupWrite.fansCount,undefined,'server-managed counter is not projected or deleted');
assert.equal(cleanupWrite.createdAt,undefined,'server-managed timestamp is preserved');
assert.equal(cleanupWrite.onboardingStep,5,'legacy string step is normalized');

const manyUsers=Array.from({length:400},(_,index)=>[`user${index}`,{displayName:`User ${index}`,onboardingStep:5}]);
const failing=fakeDb(manyUsers,[],{failCommit:true});
await assert.rejects(()=>reconcile({db:failing,apply:true}),/commit failed/);
assert.equal(failing.commits,1,'a failed WriteBatch is not retried');
assert.equal(new Set(failing.writes.map(write=>write.batchId)).size,1,'the failed writes belong to one batch only');
console.log('PASS reconcilePublicUsersForOnboarding.test');
