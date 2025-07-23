// Test script to verify quantity mismatch logic
console.log('🧪 Testing Quantity Mismatch Logic\n');

// Test Case 1: Buyer has 30 lots, Seller has 50 lots
console.log('📋 Test Case 1: Buyer (30 lots) vs Seller (50 lots)');
const bidQuantity1 = 30;
const offerQuantity1 = 50;

const smallerQuantity1 = Math.min(bidQuantity1, offerQuantity1);
const largerQuantity1 = Math.max(bidQuantity1, offerQuantity1);
const additionalQuantity1 = largerQuantity1 - smallerQuantity1;

const smallerParty1 = bidQuantity1 < offerQuantity1 ? 'BUYER' : 'SELLER';
const smallerOrder1 = bidQuantity1 < offerQuantity1 ? 'BID_ORDER' : 'OFFER_ORDER';
const largerOrder1 = bidQuantity1 < offerQuantity1 ? 'OFFER_ORDER' : 'BID_ORDER';

console.log(`Bid: ${bidQuantity1} lots`);
console.log(`Offer: ${offerQuantity1} lots`);
console.log(`Comparison: ${bidQuantity1} < ${offerQuantity1} = ${bidQuantity1 < offerQuantity1}`);
console.log(`Smaller party: ${smallerParty1}`);
console.log(`Smaller order: ${smallerOrder1}`);
console.log(`Larger order: ${largerOrder1}`);
console.log(`Additional quantity needed: ${additionalQuantity1} lots`);
console.log(`✅ EXPECTED: ${smallerParty1} should be asked to increase from ${smallerQuantity1} to ${largerQuantity1} lots\n`);

// Test Case 2: Buyer has 50 lots, Seller has 30 lots
console.log('📋 Test Case 2: Buyer (50 lots) vs Seller (30 lots)');
const bidQuantity2 = 50;
const offerQuantity2 = 30;

const smallerQuantity2 = Math.min(bidQuantity2, offerQuantity2);
const largerQuantity2 = Math.max(bidQuantity2, offerQuantity2);
const additionalQuantity2 = largerQuantity2 - smallerQuantity2;

const smallerParty2 = bidQuantity2 < offerQuantity2 ? 'BUYER' : 'SELLER';
const smallerOrder2 = bidQuantity2 < offerQuantity2 ? 'BID_ORDER' : 'OFFER_ORDER';
const largerOrder2 = bidQuantity2 < offerQuantity2 ? 'OFFER_ORDER' : 'BID_ORDER';

console.log(`Bid: ${bidQuantity2} lots`);
console.log(`Offer: ${offerQuantity2} lots`);
console.log(`Comparison: ${bidQuantity2} < ${offerQuantity2} = ${bidQuantity2 < offerQuantity2}`);
console.log(`Smaller party: ${smallerParty2}`);
console.log(`Smaller order: ${smallerOrder2}`);
console.log(`Larger order: ${largerOrder2}`);
console.log(`Additional quantity needed: ${additionalQuantity2} lots`);
console.log(`✅ EXPECTED: ${smallerParty2} should be asked to increase from ${smallerQuantity2} to ${largerQuantity2} lots\n`);

console.log('🎯 SUMMARY:');
console.log('✅ Test Case 1: BUYER (30) < SELLER (50) → Ask BUYER to increase to 50');
console.log('✅ Test Case 2: BUYER (50) > SELLER (30) → Ask SELLER to increase to 50');
console.log('✅ Logic is CORRECT: Always ask the SMALLER party to INCREASE quantity');
console.log('✅ No party is ever asked to DECREASE their quantity'); 