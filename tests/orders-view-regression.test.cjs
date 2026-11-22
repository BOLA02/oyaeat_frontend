const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const filename = path.resolve(__dirname, "../components/customer/OrdersView.tsx");
const source = fs.readFileSync(filename, "utf8");
const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function callsNamed(name) {
  const calls = [];
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === name) calls.push(node);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return calls;
}

test("orders loading is stable across ordinary state updates", () => {
  const callbacks = callsNamed("useCallback");
  const load = callbacks.find((call) => call.arguments[0]?.getText(ast).includes('api("/orders/my"'));
  assert.ok(load, "load callback exists");
  assert.equal(load.arguments[1].getText(ast), "[clear]");
  assert.doesNotMatch(source, /\bconst cart = useCart\(\)/);
  assert.doesNotMatch(source, /\bcart\.clear\(\)/);
});

test("orders requests are abortable and the effect cleans up stale work", () => {
  assert.match(source, /new AbortController\(\)/);
  assert.equal((source.match(/signal: controller\.signal/g) || []).length, 3);
  assert.match(source, /requestRef\.current\?\.abort\(\)/);
  assert.match(source, /mountedRef\.current = false/);
  assert.match(source, /removeEventListener\(CUSTOMER_SESSION_EVENT, onSessionChange\)/);
  assert.match(source, /getCustomerId\(getUser\(\)\) !== customerId/);
});

test("success, failure, loading completion, and filtering remain wired", () => {
  assert.match(source, /setOrders\(list\)/);
  assert.match(source, /setError\(e\.message\)/);
  assert.match(source, /setLoading\(false\)/);
  assert.match(source, /<ErrorState[^>]+onRetry=\{load\}/s);
  assert.match(source, /orders\.filter\(isActive\)/);
  assert.match(source, /tab === "all" \? true : tab === "active"/);
  assert.match(source, /list\.slice\(0, shown\)\.map/);
});

test("pending verification is scoped and success consumes its marker once", () => {
  assert.match(source, /const pending = customerId \? getPendingPayment\(customerId\) : null/);
  assert.match(source, /if \(pending\)/);
  assert.match(source, /clearPendingPayment\(pending\.customerId\)/);
  assert.match(source, /clear\(\);\s*clearPendingPayment\(pending\.customerId\)/);
  assert.match(source, /Failed, cancelled and unknown outcomes deliberately retain both cart and marker/);
  assert.match(source, /paidOrder && !controller\.signal\.aborted && getCustomerId\(getUser\(\)\) === customerId/);
});
