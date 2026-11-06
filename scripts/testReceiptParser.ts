import { ReceiptParser } from '../src/services/ocr/ReceiptParser';
import { SAMPLE_ITALIAN_RECEIPTS } from '../src/services/ocr/sampleReceipts';

declare const process: any;

console.log('====================================================');
console.log('🧪 TESTING QUOTA ITALIAN RECEIPT PARSER (OCR ENGINE)');
console.log('====================================================\n');

let allPassed = true;

SAMPLE_ITALIAN_RECEIPTS.forEach((receipt, index) => {
  console.log(`[TEST ${index + 1}] Parsing receipt: "${receipt.name}" (${receipt.city})`);
  const parsed = ReceiptParser.parse(receipt.rawLines);

  console.log(`  🏢 Ristorante: ${parsed.merchantName}`);
  console.log(`  🧾 P.IVA: ${parsed.vatNumber || 'N/D'}`);
  console.log(`  🍽️ Voci estratte: ${parsed.items.length}`);
  console.log(`  🥖 Coperto Rilevato: €${parsed.copertoTotal.toFixed(2)} (${parsed.copertoCount} persone)`);
  console.log(`  💶 Subtotale: €${parsed.subtotal.toFixed(2)}`);
  console.log(`  🏛️ IVA (Tax): €${parsed.vatAmount.toFixed(2)}`);
  console.log(`  💰 Totale Complessivo: €${parsed.total.toFixed(2)}`);

  // Assertions
  if (parsed.items.length === 0) {
    console.error('  ❌ FAILED: No items extracted!');
    allPassed = false;
  } else if (parsed.total <= 0) {
    console.error('  ❌ FAILED: Grand total not parsed!');
    allPassed = false;
  } else if (receipt.id === 'trattoria_roma' && parsed.copertoTotal !== 10.0) {
    console.error(`  ❌ FAILED: Coperto total expected 10.00, got ${parsed.copertoTotal}`);
    allPassed = false;
  } else {
    console.log('  ✅ PASSED!\n');
  }
});

if (allPassed) {
  console.log('🎉 ALL ITALIAN FISCAL RECEIPT TEST SUITES PASSED SUCCESSFULLY!');
} else {
  process.exit(1);
}
