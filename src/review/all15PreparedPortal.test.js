import React from 'react';
import {render,screen,waitFor,fireEvent,cleanup} from '@testing-library/react';
import ReviewPortal from './ReviewPortal';
import cards from './all15ReleaseCards.json';
import {detectReviewQrMode} from '../lib/reviewPortalParams';
import {resolveRootAppKind} from '../lib/platformMode';
import {fetchReviewPortalStaff} from '../dashboard/utils/unifiedIntelligenceApi';
import * as tracking from '../lib/reviewAnalytics';
jest.mock('../dashboard/utils/unifiedIntelligenceApi',()=>({fetchReviewPortalStaff:jest.fn()}));
jest.mock('../lib/reviewAnalytics',()=>({
 runReviewEventsInsertSelfTest:jest.fn().mockResolvedValue({}),trackReviewQrScan:jest.fn(),trackReviewPageOpen:jest.fn(),trackReviewGenerate:jest.fn(),trackReviewCopy:jest.fn(),trackReviewGoogleClick:jest.fn(),trackReviewLanguageChange:jest.fn(),
}));
beforeEach(()=>{jest.clearAllMocks();jest.spyOn(console,'log').mockImplementation(()=>{});});
afterEach(()=>{cleanup();jest.restoreAllMocks();});
const regressions=[{name:'Existing Staff',role:'waiter',branch_id:'khobar',url:'https://nacmenu.netlify.app/?store=khobar&s=Existing%20Staff&role=waiter',expected_place_id:'ChIJp_zLEdvpST4RPD2r1GX-ASw'},{name:'Existing Staff',role:'waiter',branch_id:'jeddah',url:'https://nacmenu.netlify.app/?store=jeddah&s=Existing%20Staff&role=waiter',expected_place_id:'ChIJg_3_793bwxUR6w9WMTA96F8'}];
test.each([...cards,...regressions])('prepared rendered card URL: $name / $branch_id',async card=>{
 const u=new URL(card.url);
 expect(resolveRootAppKind({pathname:u.pathname,isReviewQr:detectReviewQrMode(u.search,u.hostname)})).toBe('review');
 window.history.replaceState({},'',u.pathname+u.search);
 fetchReviewPortalStaff.mockResolvedValue([
  ...(card.branch_id==='hettin'?[{branch_id:'khobar',url_slug:u.searchParams.get('s'),employee_name:'Wrong branch',role:'waiter'}]:[]),
  {branch_id:card.branch_id,url_slug:u.searchParams.get('s'),employee_name:card.name,role:card.role,active:true},
 ]);
 const view=render(<ReviewPortal/>);
 await waitFor(()=>expect(tracking.trackReviewQrScan).toHaveBeenCalled());
 expect(fetchReviewPortalStaff).toHaveBeenCalledWith(card.branch_id);
 const context={branch_id:card.branch_id,employee_name:card.name,employee_role:card.role};
 expect(tracking.trackReviewQrScan).toHaveBeenCalledWith(expect.objectContaining(context));
 expect(tracking.trackReviewPageOpen).toHaveBeenCalledWith(expect.objectContaining(context));
 const google=screen.getByRole('link',{name:'Google Review'});
 expect(google).toHaveAttribute('href','https://search.google.com/local/writereview?placeid='+card.expected_place_id);
 fireEvent.click(google);
 expect(tracking.trackReviewGoogleClick).toHaveBeenCalledWith(expect.objectContaining(context));
 fireEvent.click(screen.getByRole('button',{name:'Copy'}));
 expect(tracking.trackReviewCopy).toHaveBeenCalledWith(expect.objectContaining(context));
 if(card.branch_id==='hettin'){
  // Database recovery deactivates release-inserted staff. Keep approved routing live:
  // an empty active-staff lookup must still resolve the printed URL to Hettin.
  view.unmount();tracking.trackReviewQrScan.mockClear();tracking.trackReviewGoogleClick.mockClear();
  fetchReviewPortalStaff.mockResolvedValue([]);
  render(<ReviewPortal/>);
  await waitFor(()=>expect(tracking.trackReviewQrScan).toHaveBeenCalled());
  expect(tracking.trackReviewQrScan).toHaveBeenCalledWith(expect.objectContaining(context));
  const recovered=screen.getByRole('link',{name:'Google Review'});
  expect(recovered).toHaveAttribute('href','https://search.google.com/local/writereview?placeid='+card.expected_place_id);
  fireEvent.click(recovered);
  expect(tracking.trackReviewGoogleClick).toHaveBeenCalledWith(expect.objectContaining(context));
 }
});
