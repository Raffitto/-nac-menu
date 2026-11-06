/** Offline, disposable Postgres validation. Never connects to a hosted database.
 * PGLITE_MODULE may point to a locally installed @electric-sql/pglite 0.3.14.
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db=new PGlite();
await db.exec(`create role authenticated; create role anon;
create table review_events(id text primary key,event_type text,branch_id text,employee_name text,employee_role text,created_at timestamptz,review_session_id text,session_id text,metadata jsonb);
create function nac_filter_since(integer) returns timestamptz language sql as $$select '2026-09-30 21:00Z'::timestamptz$$;
create function nac_reviews_allowed_branches() returns text[] language sql as $$select coalesce(nullif(current_setting('test.allowed',true),''),'{khobar,riyadh,hettin,jeddah}')::text[]$$;
create function nac_reviews_normalize_branch_id(text) returns text language sql as $$select lower(trim($1))$$;`);
const old=fs.readFileSync(new URL('../../docs/review-release/rollback-summary.sql',import.meta.url),'utf8');
const proposal=fs.readFileSync(new URL('../../docs/review-release/proposed-summary.sql',import.meta.url),'utf8');
await db.exec(old);
await db.exec('revoke all on function get_review_events_summary(text,integer) from public; grant execute on function get_review_events_summary(text,integer) to authenticated');
const rows=[];
function put(type,session,branch='riyadh',name='Atik',time='2026-10-02T12:00:00Z',metadata={}) {
 rows.push({id:String(rows.length),event_type:type,branch_id:branch,employee_name:name,employee_role:'waiter',created_at:time,review_session_id:session,session_id:null,metadata});
}
put('qr_scan','a');put('google_redirect','a');put('google_redirect','orphan');
for(let i=0;i<36;i++){put('qr_scan',`e-${i}`,'riyadh','Eusuf');if(i<14)put('google_redirect',`e-${i}`,'riyadh','Eusuf');}
for(let i=0;i<3;i++)put('google_redirect',`e-orphan-${i}`,'riyadh','Eusuf');
for(let i=0;i<76;i++)put('review_generate',`interaction-${i}`,'riyadh','Eusuf');
put('qr_scan','a','hettin');put('qr_scan','a','hettin');put('google_redirect','a','hettin');put('google_redirect','a','hettin');
put('qr_scan','old','hettin','Atik','2026-09-30T20:59:00Z');put('google_redirect','old','hettin');
put('qr_scan','synthetic','hettin','TEST','2026-10-02T12:00:00Z',{self_test:true});
put('qr_scan','real','hettin','TEST');
put('qr_scan',null,'jeddah');put('google_redirect',null,'jeddah');
for(let i=0;i<3101;i++)put('qr_scan',`k-${i}`,'khobar');put('google_redirect','k-0','khobar');
await db.query(`insert into review_events select id,event_type,branch_id,employee_name,employee_role,created_at::timestamptz,review_session_id,session_id,metadata from jsonb_to_recordset($1::jsonb) as x(id text,event_type text,branch_id text,employee_name text,employee_role text,created_at text,review_session_id text,session_id text,metadata jsonb)`,[JSON.stringify(rows)]);
const get=async(branch=null)=>(await db.query('select get_review_events_summary($1,999) result',[branch])).rows[0].result;
const before=await get(), acl=(await db.query("select proacl::text from pg_proc where proname='get_review_events_summary'")).rows;
await db.exec(proposal);
assert.deepEqual((await db.query("select proacl::text from pg_proc where proname='get_review_events_summary'")).rows,acl);
const result=await get('riyadh');
assert.equal(result.staff.find(s=>s.name==='Atik').conversion_pct,100);
assert.equal(result.staff.find(s=>s.name==='Atik').unmatched_redirects,1);
assert.equal(result.staff.find(s=>s.name==='Eusuf').qr_visits,36);
assert.equal(result.staff.find(s=>s.name==='Eusuf').converted_visits,14);
assert.equal(result.staff.find(s=>s.name==='Eusuf').conversion_pct,39);
const hettin=await get('hettin');assert.equal(hettin.qr_visits,2);assert.equal(hettin.converted_visits,1);assert.equal(hettin.unmatched_redirects,1);
assert.equal((await get('jeddah')).conversion_pct,null);
assert.equal((await get('khobar')).qr_visits,3101);
await db.exec("set test.allowed='{khobar}'; set role authenticated");
assert.deepEqual((await get()).by_branch.map(b=>b.branch_id),['khobar']);
assert.deepEqual((await get('hettin')).staff,[]);assert.deepEqual((await get('hettin')).by_branch,[]);
await db.exec('reset role; set role anon');await assert.rejects(()=>get(),/permission denied/);
await db.exec('reset role; reset test.allowed');await db.exec(old);
assert.deepEqual(await get(),before);
assert.equal((await db.query('select count(*)::int n from review_events')).rows[0].n,rows.length);
console.log(JSON.stringify({result:'PASS',fixture_rows:rows.length,branch_scope:'PASS',anon_denied:'PASS',grants:'PASS',rollback:'PASS',history_preserved:'PASS',more_than_3000:'PASS'}));
await db.close();
