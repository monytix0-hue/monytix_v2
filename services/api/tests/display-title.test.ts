import assert from "node:assert/strict";
import test from "node:test";
import { displayTransactionTitle, formatDisplayAmount } from "../src/live/displayTitle.js";

test("display titles strip channel prefixes, entities, and terminal VPAs", () => {
  assert.equal(
    displayTransactionTitle("CARD / us: &#160; American Express Banking Corp"),
    "American Express",
  );
  assert.equal(displayTransactionTitle("UPI / 0807@pty"), "UPI payment (@pty)");
  assert.equal(displayTransactionTitle("UPI / la08@oksbi"), "UPI payment (@oksbi)");
  assert.equal(displayTransactionTitle("UPI / Swiggy"), "Swiggy");
  assert.equal(displayTransactionTitle("OTHER / unauthorised and fraudulent calls"), "Transaction");
  assert.equal(displayTransactionTitle("support you in every step of the way"), "Transaction");
  assert.equal(displayTransactionTitle("your HDFC Bank account ending in 6544"), "Transaction");
});

test("display amounts keep two decimal places", () => {
  assert.equal(formatDisplayAmount("2076.0000"), "2076.00");
  assert.equal(formatDisplayAmount(27), "27.00");
});
