import assert from "node:assert/strict";
import test from "node:test";
import { filenameOf } from "../src/gmail/mime.js";

test("filenameOf extracts unquoted filename without trailing content-type", () => {
  const headers = {
    "content-disposition": "attachment; filename=LDWK_1234_Grp1.PDF",
    "content-type": "application/pdf; name=LDWK_1234_Grp1.PDF",
  };
  assert.equal(filenameOf(headers), "LDWK_1234_Grp1.PDF");
});

test("filenameOf extracts quoted filename preserving spaces", () => {
  const headers = {
    "content-disposition": 'attachment; filename="HDFC Statement Oct 2026.pdf"',
  };
  assert.equal(filenameOf(headers), "HDFC Statement Oct 2026.pdf");
});

test("filenameOf extracts unquoted name from content-type if disposition is missing", () => {
  const headers = {
    "content-type": "application/pdf; name=statement.pdf",
  };
  assert.equal(filenameOf(headers), "statement.pdf");
});
