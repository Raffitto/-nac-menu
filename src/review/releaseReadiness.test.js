import {fetchReviewEventsSummary} from '../lib/intelligenceQueryApi';
import {normalizeBranchId,CANONICAL_BRANCH_IDS} from '../dashboard/utils/branchIdentity';
import {branchPublicName,BRANCH_ROUTE_SLUGS} from '../dashboard/config/branchDisplayConfig';
import {canProfileReadBranch,buildBranchComparisonForProfile,buildReviewBranchComparisonForProfile} from '../lib/rbacIntelligenceScope';
import {aggregateStaffReviewStats} from '../dashboard/utils/staffReviewStats';
import {resolveReviewScope} from '../lib/unifiedReviewTruth';
import {reviewBranchDisplayName} from './reviewBranchIdentity';
import {fetchReviewPortalStaff} from '../dashboard/utils/unifiedIntelligenceApi';
import {supabase} from '../lib/supabase';
jest.mock('../lib/supabase',()=>({supabase:{from:jest.fn()}}));
const network={authenticated:true,allBranches:true};
const scoped={authenticated:true,allBranches:false,branchScope:'khobar'};
test('Hettin review summary reaches RPC as Hettin, never as all-branch query',async()=>{
 const client={rpc:jest.fn().mockResolvedValue({data:{qr_scans:4},error:null})};
 await fetchReviewEventsSummary(client,{branch:'NAC Hettin',hours:37});
 expect(client.rpc).toHaveBeenCalledWith('get_review_events_summary',{p_branch:'hettin',p_hours:37});
});
test('four existing branch identities and strict permissions remain intact',()=>{
 expect(CANONICAL_BRANCH_IDS).toEqual(['khobar','riyadh','jeddah','hettin']);
 // This QR-only release keeps the guest-menu route migration in PR #76.
 expect(BRANCH_ROUTE_SLUGS).toEqual(['khobar','riyadh','jeddah','hettin']);
 expect(normalizeBranchId('hettin')).toBe('hettin');
 expect(normalizeBranchId('NAC Riyadh Hittin')).toBe('riyadh');
 expect(branchPublicName('hettin')).toBe('NAC Hettin');
 expect(canProfileReadBranch(network,'hettin')).toBe(true);
 expect(canProfileReadBranch(scoped,'riyadh')).toBe(false);
 expect(buildBranchComparisonForProfile(network).map(r=>r.branch_id)).toEqual(['khobar','riyadh','jeddah','hettin']);
 expect(buildReviewBranchComparisonForProfile(network).map(r=>r.branch_id)).toEqual(['khobar','riyadh','jeddah','hettin']);
 expect(buildReviewBranchComparisonForProfile(scoped).map(r=>r.branch_id)).toEqual(['khobar']);
 expect(resolveReviewScope(network,'hettin').queryBranch).toBe('hettin');
 expect(resolveReviewScope(scoped,'hettin').queryBranch).toBe('khobar');
 expect(reviewBranchDisplayName('hettin')).toBe('Hettin');
 expect(reviewBranchDisplayName('riyadh')).toBe('Laysen Valley');
});
test('same-named staff in two branches remain separate reporting records',()=>{
 const stats=aggregateStaffReviewStats(['hettin','riyadh'].map(branch_id=>({branch_id,employee_name:'Hamza',employee_role:'rm',event_type:'qr_scan'})));
 expect(stats).toHaveLength(2);expect(stats.map(r=>r.branch).sort()).toEqual(['hettin','riyadh']);expect(stats.every(r=>r.scans===1)).toBe(true);
});
test.each([null,network])('Hettin public/network staff lookup never falls back to Khobar (%j)',async profile=>{
 const query={select:jest.fn(),eq:jest.fn(),order:jest.fn().mockResolvedValue({data:[{branch_id:'hettin',employee_name:'Hamza'},{branch_id:'khobar',employee_name:'Wrong'}],error:null})};query.select.mockReturnValue(query);query.eq.mockReturnValue(query);supabase.from.mockReturnValue(query);
 expect(await fetchReviewPortalStaff('hettin',profile)).toEqual([{branch_id:'hettin',employee_name:'Hamza'}]);
 expect(query.eq).toHaveBeenCalledWith('branch_id','hettin');
});
test('branch-restricted staff cannot request Hettin staff',async()=>{
 supabase.from.mockClear();expect(await fetchReviewPortalStaff('hettin',scoped)).toEqual([]);expect(supabase.from).not.toHaveBeenCalled();
});
