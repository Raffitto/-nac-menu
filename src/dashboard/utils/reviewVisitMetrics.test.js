import { reviewVisitMetrics, visitConversionPct } from './reviewVisitMetrics';
import { computeReviewKpis, buildBranchReviewComparison } from './reviewEventMetrics';
import { aggregateStaffReviewStats } from './staffReviewStats';
const scan = (id='a',extra={}) => ({event_type:'qr_scan',branch_id:'hettin',employee_name:'Farrukh',review_session_id:id,created_at:'2026-10-02T12:00:00Z',...extra});
const google = (id='a',extra={}) => ({...scan(id),event_type:'google_redirect',created_at:'2026-10-02T12:01:00Z',...extra});
it('one visit converts once even after repeated clicks and duplicate event delivery',()=>{
 const events=[scan(),google('a',{id:'delivery'}),google('a',{id:'delivery'}),google('a',{id:'second-click'})];
 expect(reviewVisitMetrics(events)).toMatchObject({qr_visits:1,converted_visits:1,raw_google_redirects:2,conversion_pct:100});
});
it('Atik uses matching scans only, and retains his scan-less second session diagnostically',()=>{
 expect(reviewVisitMetrics([scan(),google(),google('orphan')])).toMatchObject({qr_visits:1,converted_visits:1,unmatched_redirects:1,raw_google_redirects:2,conversion_pct:100});
});
it('separate visits in one browser remain separate and do not use menu IDs in place of different review IDs',()=>{
 const e=[scan('a',{session_id:'browser'}),scan('b',{session_id:'browser'}),google('b',{session_id:'browser'})];
 expect(reviewVisitMetrics(e)).toMatchObject({qr_visits:2,converted_visits:1,conversion_pct:50});
});
it('isolates employees and branches, including same names',()=>{
 const events=[scan(),google('a',{employee_name:'Omar'}),google('a',{branch_id:'riyadh'})];
 expect(reviewVisitMetrics(events)).toMatchObject({converted_visits:0,unmatched_redirects:2});
});
it('missing identifiers or invalid timestamp qualify no invented visit, and make conversion unavailable',()=>{
 expect(reviewVisitMetrics([scan(null),google(null)])).toMatchObject({qr_visits:0,unidentifiable_scans:1,conversion_pct:null});
 expect(reviewVisitMetrics([scan(),google(),scan('b',{created_at:null})]).conversion_pct).toBeNull();
 expect(reviewVisitMetrics([scan(null,{session_id:'menu'}),google(null,{session_id:'menu'})]).conversion_pct).toBe(100);
 expect(reviewVisitMetrics([scan('menu'),google(null,{session_id:'menu'})]).converted_visits).toBe(0);
});
it('a redirect before a scan or outside its reporting cohort cannot convert it',()=>{
 const earlier=google('a',{created_at:'2026-10-01T23:59:00Z'});
 expect(reviewVisitMetrics([scan(),earlier]).conversion_pct).toBe(0);
 const all=[scan('a',{created_at:'2026-09-30T23:59:00Z'}),google('a')];
 const period=all.filter(e=>e.created_at >= '2026-10-01T00:00:00Z');
 expect(reviewVisitMetrics(period)).toMatchObject({qr_visits:0,converted_visits:0,unmatched_redirects:1,conversion_pct:null});
});
it('excludes only explicit synthetic markers and never a legitimate employee named TEST',()=>{
 const events=[scan('s',{metadata:{self_test:true}}),google('s',{metadata:{self_test:'true'}}),scan('t',{employee_name:'TEST'}),google('t',{employee_name:'TEST'})];
 expect(reviewVisitMetrics(events)).toMatchObject({qr_visits:1,converted_visits:1,conversion_pct:100});
});
it('zero visits is N/A and invalid ratios are rejected rather than capped',()=>{
 expect(reviewVisitMetrics([]).conversion_pct).toBeNull();
 expect(visitConversionPct(2,1)).toBeNull();
});
it('performance, staff and branch metrics agree for complete event pages above 3000',()=>{
 const events=Array.from({length:1601},(_,i)=>[scan(String(i),{branch_id:['hettin','riyadh','jeddah','khobar'][i%4]}),google(String(i),{branch_id:['hettin','riyadh','jeddah','khobar'][i%4]})]).flat();
 const kpis=computeReviewKpis(events), staff=aggregateStaffReviewStats(events), branches=buildBranchReviewComparison(events);
 expect(kpis.qr_visits).toBe(1601);
 expect(kpis.converted_visits).toBe(1601);
 expect(staff.reduce((n,s)=>n+s.scans,0)).toBe(1601);
 expect(branches.reduce((n,b)=>n+b.qr_scans,0)).toBe(1601);
 expect(staff.every(s=>s.conversion_pct===100)).toBe(true);
});
