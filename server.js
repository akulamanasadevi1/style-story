require("dotenv").config();
const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const webpush = require("web-push");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, "data");
// When DATA_DIR points to Render's persistent disk, keep uploaded product photos there too.
const UPLOAD_DIR = process.env.DATA_DIR ? path.join(DATA_DIR, "uploads") : path.join(PUBLIC_DIR, "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const uploadStorage = multer.diskStorage({ destination: (_req, _file, cb) => cb(null, UPLOAD_DIR), filename: (_req, file, cb) => { const ext = (path.extname(file.originalname || "").toLowerCase().match(/^\.(jpg|jpeg|png|webp|gif)$/) || [".jpg"])[0]; cb(null, Date.now() + "-" + crypto.randomBytes(5).toString("hex") + ext); } });
const imageUpload = multer({ storage: uploadStorage, limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: (_req, file, cb) => { if (!/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) return cb(new Error("Please choose a JPG, PNG, WEBP or GIF image.")); cb(null, true); } });
const PRODUCTS_FILE = path.join(DATA_DIR, "products.json");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");
const PUSH_SUBSCRIPTIONS_FILE = path.join(DATA_DIR, "push-subscriptions.json");
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:admin@style-story.example";
const pushConfigured = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
if (pushConfigured) webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
const SESSION_COOKIE = "style_story_admin";
const SESSION_SECRET = process.env.SESSION_SECRET || "";
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const SHOP_NAME = process.env.SHOP_NAME || "Style Story";
const SHOP_UPI_ID = process.env.SHOP_UPI_ID || "akulamanasadevi@ybl";
const SHOP_CONTACT_NUMBER = process.env.SHOP_CONTACT_NUMBER || "7989599101";
const WA_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN || "";
const WA_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || "";
const WA_ADMIN_NUMBER = (process.env.ADMIN_WHATSAPP_NUMBER || "").replace(/\\D/g, "");
const WA_TEMPLATE_NAME = process.env.WHATSAPP_TEMPLATE_NAME || "";
const WA_TEMPLATE_LANGUAGE = process.env.WHATSAPP_TEMPLATE_LANGUAGE || "en_US";
const WA_GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || "v23.0";
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || "";
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || "";
const TWILIO_FROM_NUMBER = process.env.TWILIO_FROM_NUMBER || "";
const ADMIN_SMS_NUMBER = process.env.ADMIN_SMS_NUMBER || "";

fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(PRODUCTS_FILE)) fs.writeFileSync(PRODUCTS_FILE, "[]\n");
if (!fs.existsSync(ORDERS_FILE)) fs.writeFileSync(ORDERS_FILE, "[]\n");
if (!fs.existsSync(PUSH_SUBSCRIPTIONS_FILE)) fs.writeFileSync(PUSH_SUBSCRIPTIONS_FILE, "[]\\n");

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(PUBLIC_DIR, { extensions: ["html"] }));
// Serve uploaded product images from the persistent disk when DATA_DIR is configured.
app.use("/uploads", express.static(UPLOAD_DIR, { fallthrough: true }));

function readJson(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.error("Could not read", path.basename(file), err.message);
    return [];
  }
}
function writeJson(file, data) {
  const temp = file + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(data, null, 2) + "\n", "utf8");
  fs.renameSync(temp, file);
}
// Keep older product records compatible: some earlier versions used productId/product_id/sku.
// Assign and persist a stable ID only when a record has no usable identifier.
function readProducts() {
  const products = readJson(PRODUCTS_FILE);
  let changed = false;
  const normalized = products.map(product => {
    const existingId = product.id ?? product.productId ?? product.product_id ?? product.sku;
    if (existingId !== undefined && existingId !== null && String(existingId).trim()) {
      const id = String(existingId).trim();
      if (product.id !== id) { changed = true; return { ...product, id }; }
      return product;
    }
    changed = true;
    return { ...product, id: crypto.randomUUID() };
  });
  if (changed) writeJson(PRODUCTS_FILE, normalized);
  return normalized;
}
function safeEqual(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
function sign(value) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("hex");
}
function makeSession() {
  const payload = Buffer.from(JSON.stringify({ email: ADMIN_EMAIL, exp: Date.now() + 8 * 60 * 60 * 1000 })).toString("base64url");
  return payload + "." + sign(payload);
}
function isAdmin(req) {
  if (!SESSION_SECRET || SESSION_SECRET.length < 32) return false;
  const token = req.headers.cookie?.split(";").map(s => s.trim()).find(s => s.startsWith(SESSION_COOKIE + "="))?.slice(SESSION_COOKIE.length + 1);
  if (!token) return false;
  const [payload, signature] = decodeURIComponent(token).split(".");
  if (!payload || !signature || !safeEqual(signature, sign(payload))) return false;
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return session.email === ADMIN_EMAIL && session.exp > Date.now();
  } catch { return false; }
}
function requireAdmin(req, res, next) {
  if (!isAdmin(req)) return res.status(401).json({ error: "Admin login required. Please sign in again." });
  next();
}

function normalizeSmsNumber(value) {
  const raw = String(value || '').trim();
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  if (raw.startsWith('+')) return '+' + digits;
  if (digits.length === 10) return '+91' + digits;
  if (digits.length === 12 && digits.startsWith('91')) return '+' + digits;
  return '+' + digits;
}

async function sendSms(toNumber, body, label = 'SMS') {
  const to = normalizeSmsNumber(toNumber);
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER || !to) {
    console.log(`[${label}] Not configured or invalid recipient; message skipped.`);
    return { sent: false, reason: 'not_configured' };
  }
  const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(TWILIO_ACCOUNT_SID)}/Messages.json`;
  const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
  const form = new URLSearchParams({ To: to, From: TWILIO_FROM_NUMBER, Body: body });
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error(`[${label}] Twilio send failed:`, response.status, data.message || JSON.stringify(data));
      return { sent: false, reason: 'provider_error' };
    }
    console.log(`[${label}] SMS accepted by Twilio. Message SID:`, data.sid || '');
    return { sent: true, sid: data.sid };
  } catch (err) {
    console.error(`[${label}] Send error:`, err.message);
    return { sent: false, reason: 'network_error' };
  }
}

async function sendAdminSmsAlert(order) {
  if (!ADMIN_SMS_NUMBER) {
    console.log('[Admin SMS] ADMIN_SMS_NUMBER not configured; admin alert skipped.');
    return { sent: false, reason: 'not_configured' };
  }
  const body = `Style Story: New order ${order.id}. Customer: ${order.customerName}. Total: INR ${Number(order.total).toFixed(2)}. Verify payment separately in your UPI/bank app.`;
  return sendSms(ADMIN_SMS_NUMBER, body, 'Admin SMS');
}

async function sendCustomerOrderSms(order) {
  const body = `Style Story: Hi ${order.customerName}, we received your order ${order.id} for INR ${Number(order.total).toFixed(2)}. Payment is pending verification. We will text you after payment is verified. Thank you!`;
  return sendSms(order.phone, body, 'Customer order SMS');
}

async function sendCustomerStatusSms(order, status) {
  const messages = {
    PAID: `Style Story: Payment for order ${order.id} (INR ${Number(order.total).toFixed(2)}) has been verified. Thank you, ${order.customerName}!`,
    PROCESSING: `Style Story: Your order ${order.id} is being prepared. We will notify you when it ships.`,
    SHIPPED: `Style Story: Good news ${order.customerName}! Your order ${order.id} has been shipped. Please contact ${SHOP_CONTACT_NUMBER} for help.`,
    DELIVERED: `Style Story: Your order ${order.id} is marked delivered. Thank you for shopping with us! For help, call ${SHOP_CONTACT_NUMBER}.`,
    CANCELLED: `Style Story: Your order ${order.id} has been cancelled. If you need help, call ${SHOP_CONTACT_NUMBER}.`
  };
  if (!messages[status]) return { sent: false, reason: 'no_message_for_status' };
  return sendSms(order.phone, messages[status], `Customer ${status} SMS`);
}

async function sendWhatsAppOrderAlert(order) {
  if (!WA_ACCESS_TOKEN || !WA_PHONE_NUMBER_ID || !WA_ADMIN_NUMBER || !WA_TEMPLATE_NAME) {
    console.log("[WhatsApp] Not configured; order saved, WhatsApp alert skipped.");
    return { sent: false, reason: "not_configured" };
  }
  try {
    const response = await fetch(`https://graph.facebook.com/${WA_GRAPH_VERSION}/${WA_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${WA_ACCESS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: WA_ADMIN_NUMBER,
        type: "template",
        template: {
          name: WA_TEMPLATE_NAME,
          language: { code: WA_TEMPLATE_LANGUAGE },
          components: [{
            type: "body",
            parameters: [
              { type: "text", text: String(order.id).slice(0, 200) },
              { type: "text", text: String(order.customerName).slice(0, 200) },
              { type: "text", text: `₹${Number(order.total).toFixed(2)}` }
            ]
          }]
        }
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error("[WhatsApp] Send failed:", response.status, JSON.stringify(data));
      return { sent: false, reason: "api_error" };
    }
    console.log("[WhatsApp] Order alert accepted by Meta for", order.id);
    return { sent: true };
  } catch (err) {
    console.error("[WhatsApp] Send error:", err.message);
    return { sent: false, reason: "network_error" };
  }
}

function cleanText(value, max = 1000) {
  return String(value ?? "").trim().slice(0, max);
}
function validImageUrl(value) {
  try {
    const u = new URL(value);
    return ["https:", "http:"].includes(u.protocol);
  } catch { return false; }
}

app.get("/api/push/public-key", (_req, res) => {
  res.json({ enabled: pushConfigured, publicKey: pushConfigured ? VAPID_PUBLIC_KEY : "" });
});
app.post("/api/admin/push/subscribe", requireAdmin, (req, res) => {
  if (!pushConfigured) return res.status(503).json({ error: "Push notifications are not configured yet. Add VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in Render environment variables." });
  const subscription = req.body?.subscription;
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    return res.status(400).json({ error: "Invalid browser push subscription." });
  }
  const subscriptions = readJson(PUSH_SUBSCRIPTIONS_FILE).filter(item => item.endpoint !== subscription.endpoint);
  subscriptions.push({ ...subscription, savedAt: new Date().toISOString() });
  writeJson(PUSH_SUBSCRIPTIONS_FILE, subscriptions);
  res.json({ ok: true });
});
async function sendAdminPushAlert(order) {
  if (!pushConfigured) {
    console.log("[Push] VAPID keys not configured; browser push skipped.");
    return;
  }
  const subscriptions = readJson(PUSH_SUBSCRIPTIONS_FILE);
  if (!subscriptions.length) {
    console.log("[Push] No admin devices subscribed yet.");
    return;
  }
  const payload = JSON.stringify({
    title: "New Style Story order!",
    body: `${order.customerName} · ₹${Number(order.total).toFixed(2)} · ${order.id}`,
    url: "/admin"
  });
  const results = await Promise.allSettled(subscriptions.map(subscription =>
    webpush.sendNotification(subscription, payload).catch(async err => {
      if (err.statusCode === 404 || err.statusCode === 410) {
        const current = readJson(PUSH_SUBSCRIPTIONS_FILE).filter(item => item.endpoint !== subscription.endpoint);
        writeJson(PUSH_SUBSCRIPTIONS_FILE, current);
      }
      throw err;
    })
  ));
  const sent = results.filter(result => result.status === "fulfilled").length;
  console.log(`[Push] Order ${order.id}: delivered to ${sent}/${subscriptions.length} subscribed device(s).`);
}
app.get("/api/config", (req, res) => res.json({
  shopName: SHOP_NAME,
  contactNumber: SHOP_CONTACT_NUMBER,
  upiId: SHOP_UPI_ID
}));

app.get("/api/products", (req, res) => {
  const products = readProducts().filter(p => p.active !== false);
  const paidStatuses = new Set(["PAID", "PROCESSING", "SHIPPED", "DELIVERED"]);
  const sales = new Map();
  for (const order of readJson(ORDERS_FILE)) {
    if (!paidStatuses.has(order.status)) continue;
    for (const item of order.items || []) {
      const id = String(item.id ?? item.productId ?? "");
      if (id) sales.set(id, (sales.get(id) || 0) + Math.max(0, Number(item.quantity) || 0));
    }
  }
  res.json(products.map(product => ({ ...product, soldCount: sales.get(String(product.id)) || 0 })));
});

app.post("/api/admin/login", (req, res) => {
  const email = cleanText(req.body.email, 200).toLowerCase();
  const password = String(req.body.password || "");
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD || !SESSION_SECRET || SESSION_SECRET.length < 32) {
    return res.status(500).json({ error: "Admin setup incomplete. Check ADMIN_EMAIL, ADMIN_PASSWORD and SESSION_SECRET in .env." });
  }
  if (!safeEqual(email, ADMIN_EMAIL) || !safeEqual(password, ADMIN_PASSWORD)) {
    return res.status(401).json({ error: "Email or password is incorrect." });
  }
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=${encodeURIComponent(makeSession())}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800`);
  res.json({ ok: true });
});
app.post("/api/admin/logout", (req, res) => {
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
  res.json({ ok: true });
});
app.get("/api/admin/me", (req, res) => res.json({ authenticated: isAdmin(req) }));
app.get("/api/admin/products", requireAdmin, (req, res) => res.json(readProducts()));
app.post("/api/admin/products", requireAdmin, (req, res, next) => imageUpload.single("image")(req, res, err => { if (err) return res.status(400).json({ error: err.message || "Image upload failed." }); next(); }), (req, res) => {
  const name = cleanText(req.body.name, 120);
  const description = cleanText(req.body.description, 1500);
  const price = Number(req.body.price);
  const stock = Math.max(0, Math.floor(Number(req.body.stock || 0)));
  const imageUrl = req.file ? "/uploads/" + req.file.filename : cleanText(req.body.imageUrl, 1000);
  const category = cleanText(req.body.category, 80) || "Clothing";
  const sizes = Array.isArray(req.body.sizes) ? req.body.sizes.map(s => cleanText(s, 12)).filter(Boolean).slice(0, 12) : cleanText(req.body.sizes, 100).split(",").map(s => s.trim()).filter(Boolean).slice(0, 12);
  if (!name) return res.status(400).json({ error: "Please enter a product name." });
  if (!Number.isFinite(price) || price <= 0) return res.status(400).json({ error: "Price must be greater than ₹0." });
  if (!imageUrl || (!imageUrl.startsWith("/uploads/") && !validImageUrl(imageUrl))) return res.status(400).json({ error: "Please upload a product image." });
  const products = readProducts();
  const product = { id: crypto.randomUUID(), name, description, price: Math.round(price * 100) / 100, imageUrl, category, sizes, stock, active: true, createdAt: new Date().toISOString() };
  products.unshift(product);
  writeJson(PRODUCTS_FILE, products);
  res.status(201).json(product);
});
app.post("/api/admin/products/:id/image", requireAdmin, (req, res, next) => imageUpload.single("image")(req, res, err => { if (err) return res.status(400).json({ error: err.message || "Image upload failed." }); next(); }), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Choose a product image first." });
  const products = readProducts();
  const index = products.findIndex(p => String(p.id) === String(req.params.id));
  if (index < 0) return res.status(404).json({ error: "Product not found." });
  const imageUrl = "/uploads/" + req.file.filename;
  products[index] = { ...products[index], imageUrl };
  writeJson(PRODUCTS_FILE, products);
  res.json({ imageUrl });
});

app.put("/api/admin/products/:id", requireAdmin, (req, res) => {
  const products = readProducts();
  const index = products.findIndex(p => String(p.id) === String(req.params.id));
  if (index < 0) return res.status(404).json({ error: "Product not found." });
  const old = products[index];
  const name = cleanText(req.body.name ?? old.name, 120);
  const price = Number(req.body.price ?? old.price);
  const imageUrl = cleanText(req.body.imageUrl ?? old.imageUrl, 1000);
  if (!name || !Number.isFinite(price) || price <= 0 || !(imageUrl.startsWith("/uploads/") || validImageUrl(imageUrl))) return res.status(400).json({ error: "Check product name, price and image URL." });
  products[index] = { ...old, name, description: cleanText(req.body.description ?? old.description, 1500), price: Math.round(price * 100) / 100, imageUrl, category: cleanText(req.body.category ?? old.category, 80), sizes: Array.isArray(req.body.sizes) ? req.body.sizes : old.sizes, stock: Math.max(0, Math.floor(Number(req.body.stock ?? old.stock))) };
  writeJson(PRODUCTS_FILE, products);
  res.json(products[index]);
});
app.delete("/api/admin/products/:id", requireAdmin, (req, res) => {
  const products = readProducts();
  const updated = products.filter(p => p.id !== req.params.id);
  if (updated.length === products.length) return res.status(404).json({ error: "Product not found." });
  writeJson(PRODUCTS_FILE, updated);
  res.json({ ok: true });
});

app.post("/api/checkout/upi-order", (req, res) => {
  const customerName = cleanText(req.body.customerName, 120);
  const phone = String(req.body.phone || "").replace(/\D/g, "");
  const address = cleanText(req.body.address, 500);
  const pincode = String(req.body.pincode || "").replace(/\D/g, "");
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (!customerName || !phone || !address || !items.length || !pincode) return res.status(400).json({ error: "Please enter your name, mobile number, delivery address, PIN code and at least one product." });
  if (!/^[6-9]\d{9}$/.test(phone)) return res.status(400).json({ error: "Enter a valid 10-digit Indian mobile number starting with 6, 7, 8 or 9." });
  if (!/^[1-9]\d{5}$/.test(pincode)) return res.status(400).json({ error: "Enter a valid 6-digit Indian PIN code." });
  const products = readProducts();
  let total = 0;
  const orderItems = [];
  for (const item of items) {
    const submittedId = item?.id ?? item?.productId ?? item?.product_id ?? item?.sku;
    const product = products.find(p => String(p.id) === String(submittedId) && p.active !== false);
    const qty = Math.max(1, Math.min(10, Math.floor(Number(item.quantity || 1))));
    if (!product) return res.status(400).json({ error: "A product in your bag no longer matches the current store list. Please remove that item, refresh the store, add it again, and retry checkout.", unavailableProductId: String(submittedId ?? "missing-id") });
    if (product.stock < qty) return res.status(400).json({ error: `Only ${product.stock} unit(s) left for ${product.name}.` });
    total += product.price * qty;
    orderItems.push({ id: product.id, name: product.name, price: product.price, imageUrl: product.imageUrl, category: product.category, quantity: qty, size: cleanText(item.size, 20) });
  }
  const order = {
    id: "SS-" + Date.now().toString(36).toUpperCase() + "-" + crypto.randomBytes(2).toString("hex").toUpperCase(),
    customerName, phone, address, pincode, items: orderItems, total: Math.round(total * 100) / 100,
    status: "PENDING_PAYMENT", createdAt: new Date().toISOString()
  };
  const orders = readJson(ORDERS_FILE);
  orders.unshift(order);
  writeJson(ORDERS_FILE, orders);
  sendAdminPushAlert(order).catch(err => console.error("[Push] Order alert error:", err.message));
  sendCustomerOrderSms(order).catch(err => console.error("[Customer order SMS] Alert error:", err.message));
  sendAdminSmsAlert(order).catch(err => console.error("[Admin SMS] Alert error:", err.message));
  sendWhatsAppOrderAlert(order).catch(err => console.error("[WhatsApp] Alert error:", err.message));
  const params = new URLSearchParams({ pa: SHOP_UPI_ID, pn: SHOP_NAME, am: order.total.toFixed(2), cu: "INR", tn: `Order ${order.id}` });
  res.status(201).json({ order, upiLink: `upi://pay?${params.toString()}` });
});
app.post("/api/track-order", (req, res) => {
  const orderId = cleanText(req.body.orderId, 100);
  const phone = String(req.body.phone || "").replace(/\\D/g, "");
  if (!orderId || phone.length < 10) return res.status(400).json({ error: "Enter your order ID and registered mobile number." });
  const order = readJson(ORDERS_FILE).find(o => {
    const savedPhone = String(o.phone || "").replace(/\\D/g, "");
    return o.id === orderId && savedPhone.slice(-10) === phone.slice(-10);
  });
  if (!order) return res.status(404).json({ error: "We could not find an order matching those details. Please check your order ID and phone number." });
  res.json({
    id: order.id,
    status: order.status,
    total: order.total,
    createdAt: order.createdAt,
    items: (order.items || []).map(item => ({ name: item.name, quantity: item.quantity, size: item.size || "" }))
  });
});
app.get("/api/orders/:id/status", (req, res) => {
  const order = readJson(ORDERS_FILE).find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: "Order not found." });
  res.json({ id: order.id, status: order.status });
});
app.get("/api/admin/orders", requireAdmin, (req, res) => res.json(readJson(ORDERS_FILE)));
app.patch("/api/admin/orders/:id", requireAdmin, (req, res) => {
  const allowed = ["PENDING_PAYMENT", "PAID", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED"];
  const status = cleanText(req.body.status, 40);
  if (!allowed.includes(status)) return res.status(400).json({ error: "Invalid order status." });
  const orders = readJson(ORDERS_FILE);
  const order = orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: "Order not found." });
  const previousStatus = order.status;
  order.status = status;
  order.updatedAt = new Date().toISOString();
  writeJson(ORDERS_FILE, orders);
  if (previousStatus !== status) {
    sendCustomerStatusSms(order, status).catch(err => console.error("[Customer status SMS] Alert error:", err.message));
  }
  res.json(order);
});
app.get("/admin", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "admin.html")));
app.get("*", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "index.html")));

app.listen(PORT, () => {
  console.log(`${SHOP_NAME} running on http://localhost:${PORT}`);
  console.log("Product/order data is stored locally in the data/ folder.");
  if (!SESSION_SECRET || SESSION_SECRET.length < 32) console.warn("WARNING: SESSION_SECRET must be at least 32 characters. Set it in .env.");
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) console.warn("WARNING: Set ADMIN_EMAIL and ADMIN_PASSWORD in .env before admin login.");
});
