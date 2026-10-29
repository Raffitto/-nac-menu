jest.mock('../lib/supabase',()=>({supabase:{from:jest.fn()}}));
jest.mock('../lib/analytics',()=>({getMenuSessionIdOptional:()=>null}));
import {supabase} from '../lib/supabase';
import {insertReviewEvent} from '../lib/reviewAnalytics';
import {parseReviewPortalParams,buildReviewTrackingContext} from '../lib/reviewPortalParams';

test('all Hettin staff interactions submit distinct, correctly scoped payloads and dedupe independently',async()=>{
 const insert=jest.fn().mockResolvedValue({error:null});
 supabase.from.mockReturnValue({insert}); sessionStorage.clear();
 const staff=[['Hamza','rm'],['Farrukh','arm'],['Omar','supervisor'],['Waleed','supervisor'],['Redwan','waiter'],['Nazareth','waiter'],['Yusouf','waiter'],['Khaled','waiter']];
 for(const [name,role] of staff){
   const ctx=buildReviewTrackingContext(parseReviewPortalParams(`?store=NAC%20Hettin&s=${name}&role=${role}`));
   for(const event_type of ['qr_scan','review_page_open','review_copy','review_google_click']) await insertReviewEvent({...ctx,event_type});
   expect(insert.mock.calls.slice(-4).every(([p])=>p.branch_id==='hettin'&&p.employee_name===name&&p.employee_role===role)).toBe(true);
   const result=await insertReviewEvent({...ctx,event_type:'qr_scan'});
   expect(result.deduped).toBe(true);
 }
 expect(insert).toHaveBeenCalledTimes(32);
 await insertReviewEvent({branch_id:'riyadh',employee_name:'Hamza',employee_role:'rm',event_type:'qr_scan'});
 expect(insert).toHaveBeenCalledTimes(33);
 expect(insert.mock.calls[32][0].branch_id).toBe('riyadh');
});
