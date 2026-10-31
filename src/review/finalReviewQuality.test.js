import fs from 'fs';
import {sanitizeReviewPunctuation} from './reviewRoleProfiles';
import {generateHumanizedReview,resetReviewDiversityState} from './reviewGeneratorEngine';
import {mockSeededMathRandom} from './reviewGeneratorTestSeed';
it('checks English and Arabic suggestions across all four branches for repeated words and the Farrukh fragment',()=>{
 resetReviewDiversityState();const spy=mockSeededMathRandom(0x4e414304),samples=[];
 try{for(const branchId of ['khobar','riyadh','hettin','jeddah'])for(const language of ['en','ar'])for(const role of ['arm','waiter','supervisor'])for(let i=0;i<40;i++){
  const text=generateHumanizedReview({branchId,language,role,staffName:role==='arm'?'Farrukh':'Ali',scanTime:new Date('2026-10-31T20:00:00+03:00')});
  expect(text).not.toMatch(/\b(the mains|the prawns|sharing plates|sliders|the eggs) was\b/i);
  expect(text).not.toMatch(/(الباستا|السلطة|القهوة|الأطباق الرئيسية) كان ممتاز/);
  expect(text).not.toMatch(/دعم الفريق واضح/);
  expect(text).not.toMatch(/\bthe\s+the\b/i);expect(text).not.toMatch(/on the floor,\s*staff worked well/i);
  expect(text).not.toMatch(/(?:^|[^\p{L}])([\p{L}]{2,})\s+\1(?=$|[^\p{L}])/iu);
  if(i===0)samples.push({branchId,language,role,text});
 }
 if(process.env.NAC_QUALITY_PATH) fs.writeFileSync(process.env.NAC_QUALITY_PATH,JSON.stringify(samples,null,2));
 }finally{spy.mockRestore();}
});

it('removes repeated adjacent English and Arabic words without changing the remaining sentence',()=>{
 expect(sanitizeReviewPunctuation('Loved the the chicken.')).toBe('Loved the chicken.');
 expect(sanitizeReviewPunctuation('كان كان الطعام ممتازاً.')).toBe('كان الطعام ممتازاً.');
});
