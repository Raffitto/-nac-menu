import { parseReviewPortalParams, buildReviewTrackingContext, normalizeBranchFromStore, branchFromHostname } from '../lib/reviewPortalParams';
import { resolveReviewPortalStaff } from '../lib/reviewPortalStaffResolve';
import { getGoogleReviewUrl, GOOGLE_PLACE_IDS } from './reviewGenerator';
import { branchLabel } from './reviewGeneratorMenus';
import { REVIEW_BRANCH_IDS, buildReviewBranchComparison, normalizeReviewBranchId } from './reviewBranchIdentity';
import { CANONICAL_BRANCH_IDS, normalizeBranchId } from '../dashboard/utils/branchIdentity';
import { buildBranchReviewComparison } from '../dashboard/utils/reviewEventMetrics';
import { branchComparisonFromReviewSummary } from '../dashboard/utils/reviewSummaryMap';
import { resolveReviewScope } from '../lib/unifiedReviewTruth';

const people = [['Hamza','rm'],['Farrukh','arm'],['Omar','supervisor'],['Waleed','supervisor'],['Redwan','waiter'],['Nazareth','waiter'],['Yusouf','waiter'],['Khaled','waiter']];
const places = {khobar:'ChIJp_zLEdvpST4RPD2r1GX-ASw',jeddah:'ChIJg_3_793bwxUR6w9WMTA96F8',riyadh:'ChIJWVLeDGEdLz4RNTDq3dMM4nM',hettin:'ChIJ0QpbRgDhLj4ROUIXHjFIVIo'};

describe('Hettin independent review branch',()=>{
 test.each(people)('%s retains correct attribution and destination',(name,role)=>{
   const q=`?store=NAC%20Hettin&s=${encodeURIComponent(name)}&role=${role}`;
   const p=parseReviewPortalParams(q);
   expect(p.normalizedBranch).toBe('hettin');
   expect(buildReviewTrackingContext(p)).toMatchObject({branch_id:'hettin',employee_name:name,employee_role:role});
   expect(getGoogleReviewUrl(p.normalizedBranch)).toBe(`https://search.google.com/local/writereview?placeid=${places.hettin}`);
 });
 test.each(['NAC Hittin','NAC Hettin','NAC Riyadh Hittin','حطين'])('alias %s stays distinct from Riyadh',label=>{
   expect(normalizeBranchFromStore(label)).toBe('hettin'); expect(normalizeReviewBranchId(label)).toBe('hettin');
 });
 test('explicit Hettin never falls through to another branch',()=>{
   expect(parseReviewPortalParams('?store=NAC%20Khobar&branch=hettin&s=Hamza').normalizedBranch).toBe('hettin');
   expect(branchFromHostname('nac-hettin-reviews.netlify.app')).toBe('hettin');
   expect(branchFromHostname('nac-hittin-reviews.netlify.app')).toBe('hettin');
 });
 test.each(['khobar','jeddah','riyadh'])('%s preserves URL, attribution and Google place',branch=>{
   const p=parseReviewPortalParams(`?store=${branch}&s=Existing%20Staff&role=waiter`);
   expect(p.normalizedBranch).toBe(branch);
   expect(buildReviewTrackingContext(p)).toMatchObject({branch_id:branch,employee_name:'Existing Staff',employee_role:'waiter'});
   expect(GOOGLE_PLACE_IDS[branch]).toBe(places[branch]);
 });
 test('Hettin rejects a staff record from another branch',()=>{
   const p=parseReviewPortalParams('?store=hettin&s=Hamza&role=rm');
   expect(resolveReviewPortalStaff(p,[{branch_id:'khobar',url_slug:'Hamza',employee_name:'Wrong Person',role:'waiter'}]).employeeName).toBe('Hamza');
 });
 test('all four review buckets stay independent while preserving established branch identities',()=>{
   expect(CANONICAL_BRANCH_IDS).toEqual(['khobar','riyadh','jeddah','hettin']);
   expect(normalizeBranchId('hettin')).toBe('hettin');
   expect(normalizeBranchId('NAC Riyadh Hittin')).toBe('riyadh');
   expect(REVIEW_BRANCH_IDS).toEqual(['khobar','riyadh','jeddah','hettin']);
   const events=REVIEW_BRANCH_IDS.flatMap((branch_id,i)=>Array.from({length:i+1},(_,n)=>({branch_id,event_type:'qr_scan',employee_name:'Staff',review_session_id:`${branch_id}-${n}`})));
   expect(buildBranchReviewComparison(events).map(r=>r.qr_scans)).toEqual([1,2,3,4]);
   expect(branchComparisonFromReviewSummary({by_branch:REVIEW_BRANCH_IDS.map((branch_id,i)=>({branch_id,qr_scans:i+1}))}).map(r=>r.qr_scans)).toEqual([1,2,3,4]);
   expect(buildReviewBranchComparison([{branch_id:'hettin',qr_scans:5},{branch_id:'riyadh',qr_scans:7}],{qr_scans:0}).map(r=>r.qr_scans)).toEqual([0,7,0,5]);
 });
 test('review filter scopes to Hettin and labels do not become Riyadh',()=>{
   expect(resolveReviewScope({authenticated:true,allBranches:true},'hettin').queryBranch).toBe('hettin');
   expect(branchLabel('hettin',false)).toBe('NAC Hettin');
 });
});
