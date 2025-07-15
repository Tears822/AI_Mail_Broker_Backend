// Test script for NLP parsing
const testMessages = [
  "buy 100 dec25 wheat at 150",
  "sell 50 jan26 gold for 2000", 
  "I want to buy 100 wheat dec25 at 150",
  "looking to sell 50 gold jan26 at 2000",
  "buy 1,000 wheat dec25 at 150",
  "bid 150 for 100 wheat dec25",
  "offer 2000 for 50 gold jan26",
  "wheat dec25: buy 100 at 150",
  "buy wheat dec25 100 150",
  "sell me 100 wheat dec25 at 150"
];

console.log('🧪 Testing NLP Regex Patterns');
console.log('=' * 50);

testMessages.forEach((message, index) => {
  console.log(`\nTest ${index + 1}: "${message}"`);
  // We'll implement the actual parsing test when the backend is working
});

console.log('\n✅ Test script created - run with node test-nlp.js after backend setup'); 