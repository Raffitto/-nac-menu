import {parseReviewPortalParams,buildReviewTrackingContext} from '../lib/reviewPortalParams';
import {getGoogleReviewUrl} from './reviewGenerator';

const staff=[
 ['Hamza','rm','hettin'],['Farrukh','arm','hettin'],['Omar','supervisor','hettin'],['Waleed','supervisor','hettin'],
 ['Redwan','waiter','hettin'],['Nazareth','waiter','hettin'],['Yusouf','waiter','hettin'],['Khaled','waiter','hettin'],
 ['Sopon','waiter','riyadh'],['Ali','waiter','riyadh'],['Saud','waiter','riyadh'],['Arif','waiter','riyadh'],
 ['Joanitah','waiter','riyadh'],['Patrick','waiter','riyadh'],['Suraj','waiter','riyadh'],
];
test.each(staff)('print roster: %s / %s remains scoped to %s',(name,role,branch)=>{
 const store=branch==='hettin'?'NAC Hettin':'riyadh';
 const identity=branch==='riyadh'?name.toLowerCase():name;
 const params=parseReviewPortalParams(`?store=${encodeURIComponent(store)}&s=${encodeURIComponent(identity)}&role=${role}`);
 expect(params.normalizedBranch).toBe(branch);
 expect(buildReviewTrackingContext(params)).toMatchObject({branch_id:branch,employee_name:name,employee_role:role});
 expect(getGoogleReviewUrl(branch)).toBe('https://search.google.com/local/writereview?placeid='+(
   branch==='hettin'?'ChIJ0QpbRgDhLj4ROUIXHjFIVIo':'ChIJWVLeDGEdLz4RNTDq3dMM4nM'
 ));
});
