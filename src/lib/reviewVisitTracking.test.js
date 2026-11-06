jest.mock('./supabase',()=>({supabase:{from:jest.fn()}}));
jest.mock('./analytics',()=>({getMenuSessionIdOptional:()=>null}));
import {supabase} from './supabase';
import {insertReviewEvent} from './reviewAnalytics';
import {parseReviewPortalParams,buildReviewTrackingContext} from './reviewPortalParams';
beforeEach(()=>sessionStorage.clear());
it('a failed scan insert is retryable; successful duplicate delivery is suppressed',async()=>{
 const insert=jest.fn().mockResolvedValueOnce({error:new Error('offline')}).mockResolvedValue({error:null});
 supabase.from.mockReturnValue({insert});
 const ctx={branch_id:'hettin',employee_name:'Farrukh',review_session_id:'visit-a',event_type:'qr_scan'};
 await insertReviewEvent(ctx); await insertReviewEvent(ctx);
 expect(insert).toHaveBeenCalledTimes(2);
 expect((await insertReviewEvent(ctx)).deduped).toBe(true);
});
it('explicit visits in the same browser retain compatible IDs and repeated clicks remain raw events',async()=>{
 const insert=jest.fn().mockResolvedValue({error:null});supabase.from.mockReturnValue({insert});
 for(const review_session_id of ['a','b']) for(const event_type of ['qr_scan','google_redirect','google_redirect']) await insertReviewEvent({branch_id:'riyadh',employee_name:'Atik',review_session_id,event_type});
 expect(insert.mock.calls.map(([p])=>p.review_session_id)).toEqual(['a','a','a','b','b','b']);
});
it('explicit acceptance tests are marked synthetic; ordinary card visits are not',()=>{
 const ordinary=buildReviewTrackingContext(parseReviewPortalParams('?store=hettin&s=Farrukh&role=arm'));
 const synthetic=buildReviewTrackingContext(parseReviewPortalParams('?store=hettin&s=Farrukh&role=arm&self_test=1'));
 expect(ordinary.metadata).toBeUndefined();expect(synthetic.metadata).toEqual({self_test:true});
});
it('a fresh loaded module gets a new visit while each document keeps one stable ID',()=>{
 let first, second;
 jest.isolateModules(()=>{const {getReviewSessionId}=require('./reviewAnalytics');first=getReviewSessionId();expect(getReviewSessionId()).toBe(first);});
 jest.isolateModules(()=>{second=require('./reviewAnalytics').getReviewSessionId();});
 expect(second).not.toBe(first);
});
