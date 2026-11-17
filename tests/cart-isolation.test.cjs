const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
function loadTypeScriptModule(relativePath) {
  const filename = path.join(root, relativePath);
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
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
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

const cart = loadTypeScriptModule("lib/cartStorage.ts");
const customer = loadTypeScriptModule("lib/customer.ts");
const meal = (id, restaurantId = 10, quantity = 1) => ({
  menuItemId: id,
  name: `Meal ${id}`,
  price: 1000,
  quantity,
  restaurantId,
  restaurantName: `Restaurant ${restaurantId}`,
});

function installBrowser(storage = new MemoryStorage()) {
  global.localStorage = storage;
  global.sessionStorage = new MemoryStorage();
  global.window = new EventTarget();
  return storage;
}

test("Customer A's cart is invisible to Customer B and restores for A", () => {
  const storage = installBrowser();
  cart.writeCart(storage, cart.customerCartKey(101), [meal(1)]);
  customer.saveCustomerSession({ token: "a", user: { id: 101 } });
  assert.deepEqual(cart.readCart(storage, cart.cartIdentityForUser(customer.getUser()).key), [meal(1)]);

  customer.clearSession();
  customer.saveCustomerSession({ token: "b", user: { id: 202 } });
  assert.deepEqual(cart.readCart(storage, cart.cartIdentityForUser(customer.getUser()).key), []);
  cart.writeCart(storage, cart.customerCartKey(202), [meal(2, 20)]);

  customer.clearSession();
  customer.saveCustomerSession({ token: "a2", user: { id: 101 } });
  assert.deepEqual(cart.readCart(storage, cart.cartIdentityForUser(customer.getUser()).key), [meal(1)]);
});

test("email/password and Google flows share the same stable customer-ID identity", () => {
  const storage = installBrowser();
  // Both AuthForm paths call saveCustomerSession with the API's user.id.
  customer.saveCustomerSession({ token: "email-token", user: { id: 77 } });
  assert.equal(cart.cartIdentityForUser(customer.getUser()).key, cart.customerCartKey(77));
  customer.saveCustomerSession({ token: "google-token", user: { id: 88 } });
  assert.equal(cart.cartIdentityForUser(customer.getUser()).key, cart.customerCartKey(88));
});

test("guest cart works before login and safely merges only compatible carts", () => {
  const storage = installBrowser();
  cart.writeCart(storage, cart.GUEST_CART_KEY, [meal(1, 10, 2)]);
  cart.writeCart(storage, cart.customerCartKey(101), [meal(1, 10, 3), meal(2, 10)]);
  assert.deepEqual(cart.mergeGuestCartIntoCustomer(storage, 101), { merged: true, reason: "merged" });
  assert.deepEqual(cart.readCart(storage, cart.customerCartKey(101)), [meal(1, 10, 5), meal(2, 10)]);
  assert.deepEqual(cart.readCart(storage, cart.GUEST_CART_KEY), []);
});

test("a restaurant conflict preserves the guest cart instead of overwriting a customer cart", () => {
  const storage = installBrowser();
  cart.writeCart(storage, cart.GUEST_CART_KEY, [meal(1, 10)]);
  cart.writeCart(storage, cart.customerCartKey(101), [meal(2, 20)]);
  assert.deepEqual(cart.mergeGuestCartIntoCustomer(storage, 101), { merged: false, reason: "restaurant-conflict" });
  assert.deepEqual(cart.readCart(storage, cart.GUEST_CART_KEY), [meal(1, 10)]);
  assert.deepEqual(cart.readCart(storage, cart.customerCartKey(101)), [meal(2, 20)]);
});

test("refresh and session expiry select the current account or guest identity without exposing prior items", () => {
  const storage = installBrowser();
  cart.writeCart(storage, cart.customerCartKey(101), [meal(1)]);
  customer.saveCustomerSession({ token: "a", user: { id: 101 } });
  // A refresh derives the key again from the persisted current session.
  assert.equal(cart.cartIdentityForUser(customer.getUser()).key, cart.customerCartKey(101));
  customer.clearSession(); // Same path used by api() after a 401.
  assert.equal(cart.cartIdentityForUser(customer.getUser()).key, cart.GUEST_CART_KEY);
  assert.deepEqual(cart.readCart(storage, cart.GUEST_CART_KEY), []);
});

test("independent tabs can update only their active customer key", () => {
  const storage = new MemoryStorage();
  cart.writeCart(storage, cart.customerCartKey(101), [meal(1)]);
  cart.writeCart(storage, cart.customerCartKey(202), [meal(2, 20)]);
  // A storage event for A's key must not require reading or writing B's key.
  assert.deepEqual(cart.readCart(storage, cart.customerCartKey(202)), [meal(2, 20)]);
  cart.writeCart(storage, cart.customerCartKey(101), [meal(1, 10, 2)]);
  assert.deepEqual(cart.readCart(storage, cart.customerCartKey(202)), [meal(2, 20)]);
});

test("reorder-style replacement, quantity updates, removal, and clear preserve cart rules", () => {
  const first = meal(1);
  const reordered = [meal(3), meal(4)];
  assert.equal(cart.addCartItem([first], { ...meal(2), quantity: undefined }).added, true);
  assert.equal(cart.addCartItem([first], { ...meal(2, 20), quantity: undefined }).added, false);
  assert.deepEqual(cart.decrementCartItem([meal(3, 10, 2)], 3), [meal(3, 10, 1)]);
  assert.deepEqual(cart.removeCartItem(reordered, 3), [meal(4)]);
  const storage = installBrowser();
  cart.writeCart(storage, cart.customerCartKey(101), reordered); // Same replacement used by reorder.
  cart.writeCart(storage, cart.customerCartKey(101), []); // Same clear used after cash checkout.
  assert.deepEqual(cart.readCart(storage, cart.customerCartKey(101)), []);
});

test("legacy customer_cart migrates only to guest and never auto-assigns to an authenticated account", () => {
  const storage = installBrowser();
  cart.writeCart(storage, cart.LEGACY_CART_KEY, [meal(9)]);
  // An authenticated customer never reads or migrates the ambiguous legacy key.
  assert.deepEqual(cart.readCart(storage, cart.cartIdentityForUser({ id: 101 }).key), []);
  assert.equal(cart.migrateLegacyCartToGuest(storage), true);
  assert.deepEqual(cart.readCart(storage, cart.GUEST_CART_KEY), [meal(9)]);
  assert.deepEqual(cart.mergeGuestCartIntoCustomer(storage, 101), { merged: false, reason: "legacy" });
  assert.deepEqual(cart.readCart(storage, cart.customerCartKey(101)), []);
});

test("legacy migration preserves both an existing guest cart and the ambiguous legacy cart", () => {
  const storage = installBrowser();
  cart.writeCart(storage, cart.GUEST_CART_KEY, [meal(1, 10)]);
  cart.writeCart(storage, cart.LEGACY_CART_KEY, [meal(2, 20)]);
  assert.equal(cart.migrateLegacyCartToGuest(storage), true);
  assert.deepEqual(cart.readCart(storage, cart.GUEST_CART_KEY), [meal(1, 10)]);
  assert.deepEqual(cart.readCart(storage, cart.LEGACY_GUEST_CART_KEY), [meal(2, 20)]);
  assert.deepEqual(cart.readCart(storage, cart.LEGACY_CART_KEY), []);
  assert.deepEqual(cart.mergeGuestCartIntoCustomer(storage, 101), { merged: false, reason: "legacy" });
});

test("a pending payment marker belongs only to its customer", () => {
  const storage = installBrowser();
  global.sessionStorage = storage;
  customer.savePendingPayment({ customerId: "101", orderId: "501", reference: "ref-101" });
  assert.equal(customer.hasPendingPayment("202"), false);
  customer.clearPendingPayment("202");
  assert.equal(customer.hasPendingPayment("101"), true);
  customer.clearPendingPayment("101");
  assert.equal(customer.hasPendingPayment("101"), false);
});
