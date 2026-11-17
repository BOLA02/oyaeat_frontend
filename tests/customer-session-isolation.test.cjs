const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
function loadTypeScriptModule(relativePath) {
  const filename = path.join(root, relativePath);
  const output = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded._compile(output, filename);
  return loaded.exports;
}

class MemoryStorage {
  values = new Map();
  constructor(copy) { if (copy) this.values = new Map(copy.values); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

const customer = loadTypeScriptModule("lib/customer.ts");
const cart = loadTypeScriptModule("lib/cartStorage.ts");
const sharedLocal = new MemoryStorage();
const meal = (id, restaurantId) => ({ menuItemId: id, name: `Meal ${id}`, price: 1000, quantity: 1, restaurantId, restaurantName: `Restaurant ${restaurantId}` });

const resetSharedLocal = () => sharedLocal.values.clear();

function openTab(session = new MemoryStorage()) {
  global.localStorage = sharedLocal;
  global.sessionStorage = session;
  global.window = Object.assign(new EventTarget(), { location: { href: "" }, setTimeout, clearTimeout });
  return session;
}

test("explicit logout revokes only the captured token and keeps its cart", async () => {
  resetSharedLocal();
  const tabA = openTab();
  customer.saveCustomerSession({ token: "email-a", user: { id: 101 } });
  cart.writeCart(sharedLocal, cart.customerCartKey(101), [meal(1, 10)]);
  const tabB = openTab();
  customer.saveCustomerSession({ token: "google-b", user: { id: 202 } });
  openTab(tabA);
  let request;
  global.fetch = async (url, opts) => {
    request = { url, opts };
    return { ok: true, status: 200, json: async () => ({ success: true }) };
  };
  await customer.logoutCustomer();
  assert.equal(request.url.endsWith("/customer/auth/logout"), true);
  assert.equal(request.opts.method, "POST");
  assert.equal(request.opts.headers.Authorization, "Bearer email-a");
  assert.equal(customer.getUser(), null);
  assert.deepEqual(cart.readCart(sharedLocal, cart.customerCartKey(101)), [meal(1, 10)]);
  openTab(tabB);
  assert.equal(customer.getUser().id, 202);
  global.fetch = async (_url, opts) => {
    assert.equal(opts.headers.Authorization, "Bearer google-b");
    return { ok: true, status: 200, json: async () => ({ success: true }) };
  };
  await customer.logoutCustomer(); // Google sessions use the identical logout path.
  openTab(tabA);
  assert.equal(customer.getUser(), null);
  openTab(tabB);
  assert.equal(customer.getUser(), null);
});

test("logout clears locally on network failure, timeout, and expired tokens", async () => {
  resetSharedLocal();
  const tab = openTab();
  customer.saveCustomerSession({ token: "network", user: { id: 101 } });
  global.fetch = async () => { throw new Error("offline"); };
  await customer.logoutCustomer();
  assert.equal(customer.getUser(), null);

  customer.saveCustomerSession({ token: "timeout", user: { id: 101 } });
  window.setTimeout = (fn) => { fn(); return 1; };
  global.fetch = async (_url, opts) => {
    assert.equal(opts.signal.aborted, true);
    throw new Error("aborted");
  };
  await customer.logoutCustomer();
  assert.equal(customer.getUser(), null);

  openTab(tab);
  customer.saveCustomerSession({ token: "expired", user: { id: 101 } });
  global.fetch = async () => ({ ok: false, status: 401, json: async () => ({ message: "Expired" }) });
  await customer.logoutCustomer();
  assert.equal(customer.getUser(), null);
});

test("an in-flight logout cannot revoke or clear a newer login in the same tab", async () => {
  resetSharedLocal();
  openTab();
  customer.saveCustomerSession({ token: "old-a", user: { id: 101 } });
  let completeLogout;
  let logoutAuthorization;
  global.fetch = async (_url, opts) => {
    logoutAuthorization = opts.headers.Authorization;
    return new Promise((resolve) => { completeLogout = resolve; });
  };
  const logout = customer.logoutCustomer();
  customer.saveCustomerSession({ token: "new-b", user: { id: 202 } });
  completeLogout({ ok: true, status: 200, json: async () => ({ success: true }) });
  await logout;
  assert.equal(logoutAuthorization, "Bearer old-a");
  assert.equal(customer.getToken(), "new-b");
  assert.equal(customer.getUser().id, 202);
});

test("password rotation updates only the original tab session and future requests", async () => {
  resetSharedLocal();
  const tabA = openTab();
  customer.saveCustomerSession({ token: "old-a", user: { id: 101, firstName: "A" } });
  const snapshot = customer.customerSessionSnapshot();
  assert.equal(customer.applyCustomerProfileUpdate(snapshot, { id: 101, firstName: "Updated" }, "new-a"), true);
  assert.equal(customer.getToken(), "new-a");
  assert.equal(customer.getUser().firstName, "Updated");
  let auth;
  global.fetch = async (_url, opts) => {
    auth = opts.headers.Authorization;
    return { ok: true, status: 200, json: async () => ({ success: true, data: {} }) };
  };
  await customer.api("/orders/my", { auth: true });
  assert.equal(auth, "Bearer new-a");

  const profileSnapshot = customer.customerSessionSnapshot();
  assert.equal(customer.applyCustomerProfileUpdate(profileSnapshot, { id: 101, firstName: "Profile only" }), true);
  assert.equal(customer.getToken(), "new-a");
  openTab(tabA);
  assert.equal(customer.getToken(), "new-a"); // Refresh keeps the rotated session in this tab.

  const staleSnapshot = customer.customerSessionSnapshot();
  customer.saveCustomerSession({ token: "b", user: { id: 202 } });
  assert.equal(customer.applyCustomerProfileUpdate(staleSnapshot, { id: 101 }, "late-a"), false);
  assert.equal(customer.getToken(), "b");
});

test("payment callback uses configured-compatible current frontend origin", () => {
  assert.equal(
    customer.customerPaymentCallbackUrl("https://preview.oyaeat.example/"),
    "https://preview.oyaeat.example/customer/dashboard/orders",
  );
});

test("email and Google logins stay isolated in separate tabs and survive refresh", async () => {
  resetSharedLocal();
  const tabA = openTab();
  customer.saveCustomerSession({ token: "email-a", user: { id: 101, firstName: "A" } });
  cart.writeCart(sharedLocal, cart.customerCartKey(101), [meal(1, 10)]);

  const tabB = openTab();
  global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ success: true, data: { token: "google-b", user: { id: 202, firstName: "B" } } }) });
  const google = await customer.authenticateCustomerWithGoogle("google-id-token");
  customer.saveCustomerSession(google.data);
  cart.writeCart(sharedLocal, cart.customerCartKey(202), [meal(2, 20)]);
  assert.equal(customer.getUser().id, 202);
  assert.equal(customer.getToken(), "google-b");
  assert.deepEqual(cart.readCart(sharedLocal, cart.customerCartKey(customer.getUser().id)), [meal(2, 20)]);

  openTab(tabA); // Tab A refreshes: its tab storage remains the source of truth.
  assert.equal(customer.getUser().id, 101);
  assert.equal(customer.getToken(), "email-a");
  assert.deepEqual(cart.readCart(sharedLocal, cart.customerCartKey(customer.getUser().id)), [meal(1, 10)]);

  openTab(tabB); // Tab B refreshes independently.
  assert.equal(customer.getUser().id, 202);
  assert.equal(customer.getToken(), "google-b");
});

test("logout and expiry in one tab do not change another tab or its requests", async () => {
  resetSharedLocal();
  const tabA = openTab();
  customer.saveCustomerSession({ token: "a", user: { id: 101 } });
  const tabB = openTab();
  customer.saveCustomerSession({ token: "b", user: { id: 202 } });

  openTab(tabA);
  customer.clearSession();
  assert.equal(customer.getUser(), null);
  openTab(tabB);
  assert.equal(customer.getUser().id, 202);

  const headers = [];
  global.fetch = async (_url, opts) => {
    headers.push(opts.headers.Authorization);
    return { ok: true, status: 200, json: async () => ({ success: true, data: { orders: [] } }) };
  };
  await customer.api("/orders/my", { auth: true });
  assert.deepEqual(headers, ["Bearer b"]);

  openTab(tabA);
  customer.saveCustomerSession({ token: "expired-a", user: { id: 101 } });
  global.fetch = async () => ({ ok: false, status: 401, json: async () => ({ message: "Expired" }) });
  await assert.rejects(() => customer.api("/orders/my", { auth: true }));
  assert.equal(customer.getUser(), null);
  openTab(tabB);
  assert.equal(customer.getUser().id, 202);
});

test("stale authenticated responses cannot cross an account change", async () => {
  resetSharedLocal();
  const tab = openTab();
  customer.saveCustomerSession({ token: "a", user: { id: 101 } });
  let resolveFetch;
  global.fetch = () => new Promise((resolve) => { resolveFetch = resolve; });
  const request = customer.api("/customer/addresses", { auth: true });
  customer.saveCustomerSession({ token: "b", user: { id: 202 } });
  resolveFetch({ ok: true, status: 200, json: async () => ({ success: true, data: { addresses: ["A only"] } }) });
  await assert.rejects(request, customer.CustomerSessionChangedError);
  assert.equal(customer.getUser().id, 202);
});

test("guest merging, pending payments, and a duplicated tab preserve customer ownership", () => {
  resetSharedLocal();
  const tabA = openTab();
  cart.writeCart(sharedLocal, cart.GUEST_CART_KEY, [meal(3, 30)]);
  customer.saveCustomerSession({ token: "a", user: { id: 101 } });
  assert.deepEqual(cart.mergeGuestCartIntoCustomer(sharedLocal, 101), { merged: true, reason: "merged" });
  customer.savePendingPayment({ customerId: "101", orderId: "501", reference: "ref-101" });

  // Browser tab duplication starts with a copy of sessionStorage. It may begin
  // as A, but changing the duplicate to B must not change the source tab.
  const duplicatedTab = new MemoryStorage(tabA);
  openTab(duplicatedTab);
  assert.equal(customer.getUser().id, 101);
  customer.saveCustomerSession({ token: "b", user: { id: 202 } });
  customer.savePendingPayment({ customerId: "202", orderId: "502", reference: "ref-202" });
  assert.equal(customer.hasPendingPayment(202), true);
  customer.clearPendingPayment(202);
  // The copied A marker is never consumed by B's current customer ID.
  assert.equal(customer.hasPendingPayment(101), true);
  cart.writeCart(sharedLocal, cart.customerCartKey(202), [meal(4, 40)]);

  openTab(tabA);
  assert.equal(customer.getUser().id, 101);
  assert.equal(customer.hasPendingPayment(101), true);
  assert.deepEqual(cart.readCart(sharedLocal, cart.customerCartKey(101)), [meal(3, 30)]);
  assert.deepEqual(cart.readCart(sharedLocal, cart.customerCartKey(202)), [meal(4, 40)]);
});
