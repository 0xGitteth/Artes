#!/usr/bin/env node
import { fileURLToPath } from 'node:url';

const BATCH_LIMIT = 400;
export const PRIVATE_FIELDS = ['email','normalizedEmail','legalName','realName','birthDate','dateOfBirth','age','didit','diditStatus','idv','idvStatus','ageVerified','ageVerifiedAt','isAdult','authProvider','providerData','preferences','moderation','support','private'];
const PUBLIC_FIELDS = ['displayName','photoURL','avatar','bio','roles','themes','headerImage','headerPosition','linkedAgencyName','linkedCompanyName','linkedAgencyId','linkedCompanyId','linkedAgencyStatus','linkedCompanyStatus','linkedAgencyLink','linkedCompanyLink','quickProfilePreviewMode','quickProfilePostIds'];
export const isOnboardingComplete = (profile = {}) => profile?.onboardingComplete === true || Number(profile?.onboardingStep || 0) >= 5;
const username = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 20);
export const buildPublicProfile = (uid, user = {}, now = () => new Date()) => {
  const displayName = typeof user.displayName === 'string' ? user.displayName : '';
  const result = { uid, profileId: uid, ownerUid: uid, username: username(user.username) || `${username(displayName) || 'artes'}${uid.slice(0,4)}`.slice(0,20), displayName, displayNameLower: displayName.toLowerCase(), onboardingComplete: true, updatedAt: now() };
  const step = Number(user.onboardingStep);
  if (Number.isInteger(step) && step >= 0 && step <= 10) result.onboardingStep = step;
  for (const field of PUBLIC_FIELDS) if (user[field] !== undefined) result[field] = user[field];
  return result;
};
export const parseArgs = (argv = process.argv.slice(2)) => {
  const out = { apply:false, deleteOrphans:false, uid:null, project:null };
  for (let i=0;i<argv.length;i+=1) { const arg=argv[i]; if(arg==='--apply') out.apply=true; else if(arg==='--delete-orphans') out.deleteOrphans=true; else if(arg==='--uid'||arg==='--project') out[arg.slice(2)]=argv[++i]||null; else if(arg.startsWith('--uid=')) out.uid=arg.slice(6); else if(arg.startsWith('--project=')) out.project=arg.slice(10); else if(arg==='--help'||arg==='-h') out.help=true; else throw new Error(`Onbekende parameter: ${arg}`); }
  return {...out,dryRun:!out.apply};
};
export async function reconcile({ db, apply=false, deleteOrphans=false, uid=null, deleteValue=()=>undefined, serverTimestamp=()=>new Date() }) {
  const stats={privateUsersScanned:0,completedUsers:0,incompleteUsers:0,missingPublicProfiles:0,publicProfilesRestored:0,publicProfilesDeleted:0,orphanPublicProfiles:0,writes:0,deletes:0,errors:0};
  const privateSnaps=uid ? [await db.collection('users').doc(uid).get()].filter(s=>s.exists) : (await db.collection('users').get()).docs;
  const publicSnaps=uid ? [await db.collection('publicUsers').doc(uid).get()].filter(s=>s.exists) : (await db.collection('publicUsers').get()).docs;
  const privateIds=new Set(privateSnaps.map(s=>s.id)); const publicMap=new Map(publicSnaps.map(s=>[s.id,s])); let batch=db.batch(), pending=0;
  const flush=async()=>{if(apply&&pending) await batch.commit(); batch=db.batch(); pending=0;};
  const queue=(action,ref,data)=>{if(apply) action==='set'?batch.set(ref,data,{merge:true}):batch.delete(ref); pending+=1;};
  for(const snap of privateSnaps){stats.privateUsersScanned++; try { const data=snap.data()||{}, pub=publicMap.get(snap.id), ref=db.collection('publicUsers').doc(snap.id); if(isOnboardingComplete(data)){stats.completedUsers++; if(!pub) stats.missingPublicProfiles++; const desired=buildPublicProfile(snap.id,data,serverTimestamp); const cleanup={}; for(const f of PRIVATE_FIELDS) if(pub?.data()?.[f]!==undefined) cleanup[f]=deleteValue(); const current=pub?.data()||{}; const target={...desired}; delete target.updatedAt; const changed=!pub||Object.keys(cleanup).length>0||Object.entries(target).some(([key,value])=>JSON.stringify(current[key])!==JSON.stringify(value)); if(changed){stats.publicProfilesRestored++;stats.writes++;queue('set',ref,{...desired,...cleanup});} } else {stats.incompleteUsers++;if(pub){stats.publicProfilesDeleted++;stats.deletes++;queue('delete',ref);}} if(pending>=BATCH_LIMIT) await flush(); } catch(e){stats.errors++;console.error(`[reconcile] ${snap.id}:`,e.message);} }
  for(const pub of publicSnaps) if(!privateIds.has(pub.id)){stats.orphanPublicProfiles++;if(deleteOrphans){stats.deletes++;queue('delete',pub.ref);if(pending>=BATCH_LIMIT) await flush();}}
  await flush(); return stats;
}
async function main(){const options=parseArgs();if(options.help){console.log('Gebruik: npm run reconcile-public-users -- [--apply] [--uid <uid>] [--project <id>] [--delete-orphans]');return;} const {initializeApp,applicationDefault,cert}=await import('firebase-admin/app');const {getFirestore,FieldValue}=await import('firebase-admin/firestore');const raw=process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;const service=raw?JSON.parse(raw):null;initializeApp({credential:service?cert(service):applicationDefault(),projectId:options.project||service?.project_id||process.env.GOOGLE_CLOUD_PROJECT});const stats=await reconcile({db:getFirestore(),...options,deleteValue:FieldValue.delete,serverTimestamp:FieldValue.serverTimestamp});console.log(options.apply?'APPLY':'DRY RUN',stats);}
if(process.argv[1]===fileURLToPath(import.meta.url)) main().catch(e=>{console.error(e);process.exitCode=1;});
