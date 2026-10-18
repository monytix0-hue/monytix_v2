import { parseTransactionFromEmail } from "../services/api/src/gmail/alertParser.js";

const sampleEmail = `
Dear Customer,
Your A/C ending 4321 has been debited by INR 350.00 on 18-Oct-2026 10:45:12
via UPI ref 429182736451 to Swiggy.
Avail Bal: INR 12,450.00.
`;

const result = parseTransactionFromEmail(sampleEmail);
console.log("Parsed Transaction Result:", JSON.stringify(result, null, 2));
