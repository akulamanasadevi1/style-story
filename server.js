require("dotenv").config();
const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const { createClient } = require("@supabase/supabase-js");
const webpush = require("web-push");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const SUPABASE_URL = (process.env.SUPABASE_URL || "").trim().replace(/\/$/, "");
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "product-images";
const supabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
const imageUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: (_req, file, cb) => { if (!/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) return cb(new Error("Please choose a JPG, PNG, WEBP or GIF image.")); cb(null, true); } });
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
const VAPID_PUBLIC_KEY = (process.env.VAPID_PUBLIC_KEY || "").trim();
const VAPID_PRIVATE_KEY = (process.env.VAPID_PRIVATE_KEY || "").trim();
const VAPID_SUBJECT = (process.env.VAPID_SUBJECT || "mailto:admin@style-story.onrender.com").trim();
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(PUBLIC_DIR, { extensions: ["html"] }));
function requireSupabase(req, res, next) {
  if (!supabase) return res.status(503).json({ error: "Database is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Render Environment." });
  next();
}
async function readRecords(table) {
  const { data, error } = await supabase.from(table).select("id,data,created_at").order("created_at", { ascending: false });
  if (error) {
    console.error("[SUPABASE_READ_ERROR]", JSON.stringify({ table, message: error.message, code: error.code, details: error.details, hint: error.hint, status: error.status }));
    throw error;
  }
  return (data || []).map(row => row.data).filter(Boolean);
}
async function saveRecord(table, record) {
  const { error } = await supabase.from(table).upsert({ id: String(record.id), data: record, created_at: record.createdAt || new Date().toISOString() }, { onConflict: "id" });
  if (error) {
    console.error("[SUPABASE_WRITE_ERROR]", JSON.stringify({ table, message: error.message, code: error.code, details: error.details, hint: error.hint, status: error.status }));
    throw error;
  }
}
async function deleteRecord(table, id) {
  const { error } = await supabase.from(table).delete().eq("id", String(id));
  if (error) throw error;
}
async function readProducts() {
  const products = await readRecords("products");
  const normalized = [];
  // Keep the product's originally listed selling price as the customer price.
  // Give each product a different higher comparison price for a varied discount.
  const discounts = [15, 18, 20, 22, 25, 28, 30, 32, 35];
  const autoDiscountsUsedEarlier = [12, 15, 18, 20, 23, 25, 26, 29, 30, 32, 35, 38, 40];
  for (const source of products) {
    let product = { ...source, id: String(source.id ?? source.productId ?? source.product_id ?? source.sku ?? crypto.randomUUID()) };
    const price = Number(product.price);
    const mrp = Number(product.compareAtPrice);
    if (!Number.isFinite(price) || price <= 0) {
      normalized.push(product);
      continue;
    }
    // One-time recovery: earlier automatic-offer code lowered price but retained
    // the previous selling price in compareAtPrice. Restore that selling price.
    let basePrice = Number(product.offerBasePrice);
    if (!Number.isFinite(basePrice) || basePrice <= 0) {
      const looksLikeEarlierAutoOffer = Number.isFinite(mrp) && mrp > price &&
        autoDiscountsUsedEarlier.some(d => Math.abs(price / mrp - (1 - d / 100)) < 0.006);
      basePrice = looksLikeEarlierAutoOffer ? mrp : price;
    }
    basePrice = Math.round(basePrice * 100) / 100;
    let hash = 0;
    for (const char of String(product.id || product.name || "style")) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    const discount = discounts[hash % discounts.length];
    const originalPrice = Math.ceil((basePrice / (1 - discount / 100)) / 10) * 10;
    if (Number(product.offerBasePrice) !== basePrice || price !== basePrice || Number(product.compareAtPrice) !== originalPrice) {
      product = { ...product, price: basePrice, compareAtPrice: originalPrice, offerBasePrice: basePrice };
      await saveRecord("products", product);
      console.log("[AUTO_OFFER] Kept selling price ₹" + basePrice + " and set " + discount + "% offer for product", product.id);
    }
    normalized.push(product);
  }
  return normalized;
}
async function uploadProductImage(file) {
  if (!file || !file.buffer) throw new Error("Choose a product image first.");
  const ext = (path.extname(file.originalname || "").toLowerCase().match(/^\.(jpg|jpeg|png|webp|gif)$/) || [".jpg"])[0];
  const objectPath = Date.now() + "-" + crypto.randomBytes(8).toString("hex") + ext;
  const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(objectPath, file.buffer, { contentType: file.mimetype, upsert: false, cacheControl: "3600" });
  if (error) throw error;
  return supabase.storage.from(STORAGE_BUCKET).getPublicUrl(objectPath).data.publicUrl;
}
function asyncRoute(handler) { return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next); }
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

app.get("/api/push/public-key", (req, res) => {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return res.status(503).json({ error: "Push notifications are not configured on the server yet." });
  res.json({ publicKey: VAPID_PUBLIC_KEY });
});
app.post("/api/admin/push-subscription", requireAdmin, requireSupabase, asyncRoute(async (req, res) => {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return res.status(503).json({ error: "Push notifications are not configured on the server yet." });
  const subscription = req.body?.subscription;
  if (!subscription || typeof subscription.endpoint !== "string" || !subscription.keys?.p256dh || !subscription.keys?.auth) return res.status(400).json({ error: "Invalid push subscription." });
  const { error } = await supabase.from("admin_push_subscriptions").upsert({ endpoint: subscription.endpoint, subscription, created_at: new Date().toISOString() }, { onConflict: "endpoint" });
  if (error) throw error;
  res.json({ ok: true });
}));
app.delete("/api/admin/push-subscription", requireAdmin, requireSupabase, asyncRoute(async (req, res) => {
  const endpoint = cleanText(req.body?.endpoint, 3000);
  if (!endpoint) return res.status(400).json({ error: "Subscription endpoint is required." });
  const { error } = await supabase.from("admin_push_subscriptions").delete().eq("endpoint", endpoint);
  if (error) throw error;
  res.json({ ok: true });
}));
async function sendWebPushOrderAlert(order) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !supabase) {
    console.log("[Web Push] Not configured; push alert skipped.");
    return { sent: false, reason: "not_configured" };
  }
  const { data, error } = await supabase.from("admin_push_subscriptions").select("endpoint,subscription");
  if (error) {
    console.error("[Web Push] Subscription read failed:", error.message);
    return { sent: false, reason: "database_error" };
  }
  const payload = JSON.stringify({
    title: "New Style Story order",
    body: order.customerName + " · ₹" + Number(order.total || 0).toLocaleString("en-IN") + " · " + order.id,
    url: "/admin.html",
    tag: String(order.id)
  });
  const results = await Promise.allSettled((data || []).map(async row => {
    try {
      await webpush.sendNotification(row.subscription, payload, { TTL: 60 * 60 });
      return true;
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        await supabase.from("admin_push_subscriptions").delete().eq("endpoint", row.endpoint);
      }
      console.error("[Web Push] Send failed:", err.statusCode || "", err.message);
      throw err;
    }
  }));
  const sent = results.filter(r => r.status === "fulfilled").length;
  console.log("[Web Push] Order", order.id, "sent to", sent, "of", results.length, "subscription(s).");
  return { sent: sent > 0, count: sent };
}
app.get("/api/config", (req, res) => res.json({
  shopName: SHOP_NAME,
  contactEmail: (process.env.SHOP_CONTACT_EMAIL || "manasadevi508@gmail.com").trim(),
  contactNumber: SHOP_CONTACT_NUMBER,
  upiId: SHOP_UPI_ID
}));

app.get("/api/products", requireSupabase, asyncRoute(async (req, res) => {
  const products = (await readProducts()).filter(p => p.active !== false);
  const paidStatuses = new Set(["PAID", "PROCESSING", "SHIPPED", "DELIVERED"]);
  const sales = new Map();
  for (const order of await readRecords("orders")) {
    if (!paidStatuses.has(order.status)) continue;
    for (const item of order.items || []) {
      const id = String(item.id ?? item.productId ?? "");
      if (id) sales.set(id, (sales.get(id) || 0) + Math.max(0, Number(item.quantity) || 0));
    }
  }
  res.json(products.map(product => ({ ...product, soldCount: sales.get(String(product.id)) || 0 })));
}));

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
app.get("/api/admin/products", requireAdmin, requireSupabase, asyncRoute(async (req, res) => res.json(await readProducts())));
app.post("/api/admin/products", requireAdmin, requireSupabase, (req, res, next) => imageUpload.single("image")(req, res, err => { if (err) return res.status(400).json({ error: err.message || "Image upload failed." }); next(); }), asyncRoute(async (req, res) => {
  const name = cleanText(req.body.name, 120);
  const description = cleanText(req.body.description, 1500);
  const price = Number(req.body.price);
  const stock = Math.max(0, Math.floor(Number(req.body.stock || 0)));
  let imageUrl = cleanText(req.body.imageUrl, 1000);
  if (req.file) imageUrl = await uploadProductImage(req.file);
  const category = cleanText(req.body.category, 80) || "Clothing";
  const sizes = Array.isArray(req.body.sizes) ? req.body.sizes.map(s => cleanText(s, 12)).filter(Boolean).slice(0, 12) : cleanText(req.body.sizes, 100).split(",").map(s => s.trim()).filter(Boolean).slice(0, 12);
  if (!name) return res.status(400).json({ error: "Please enter a product name." });
  if (!Number.isFinite(price) || price <= 0) return res.status(400).json({ error: "Price must be greater than ₹0." });
  if (!imageUrl || !validImageUrl(imageUrl)) return res.status(400).json({ error: "Please upload a product image." });
  const compareAtPrice = Number(req.body.compareAtPrice || 0);
  if (compareAtPrice > 0 && (!Number.isFinite(compareAtPrice) || compareAtPrice <= price)) return res.status(400).json({ error: "Original price must be greater than the offer price." });
  const product = { id: crypto.randomUUID(), name, description, price: Math.round(price * 100) / 100, ...(compareAtPrice > price ? { compareAtPrice: Math.round(compareAtPrice * 100) / 100 } : {}), imageUrl, category, sizes, stock, active: true, createdAt: new Date().toISOString() };
  await saveRecord("products", product);
  res.status(201).json(product);
}));
app.post("/api/admin/products/:id/image", requireAdmin, requireSupabase, (req, res, next) => imageUpload.single("image")(req, res, err => { if (err) return res.status(400).json({ error: err.message || "Image upload failed." }); next(); }), asyncRoute(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Choose a product image first." });
  const products = await readProducts();
  const index = products.findIndex(p => String(p.id) === String(req.params.id));
  if (index < 0) return res.status(404).json({ error: "Product not found." });
  const imageUrl = await uploadProductImage(req.file);
  products[index] = { ...products[index], imageUrl };
  await saveRecord("products", products[index]);
  res.json({ imageUrl });
}));

app.put("/api/admin/products/:id", requireAdmin, requireSupabase, asyncRoute(async (req, res) => {
  const products = await readProducts();
  const index = products.findIndex(p => String(p.id) === String(req.params.id));
  if (index < 0) return res.status(404).json({ error: "Product not found." });
  const old = products[index];
  const name = cleanText(req.body.name ?? old.name, 120);
  const price = Number(req.body.price ?? old.price);
  const imageUrl = cleanText(req.body.imageUrl ?? old.imageUrl, 1000);
  if (!name || !Number.isFinite(price) || price <= 0 || !(imageUrl.startsWith("/uploads/") || validImageUrl(imageUrl))) return res.status(400).json({ error: "Check product name, price and image URL." });
  const compareAtPrice = Number(req.body.compareAtPrice ?? old.compareAtPrice ?? 0);
  if (compareAtPrice > 0 && (!Number.isFinite(compareAtPrice) || compareAtPrice <= price)) return res.status(400).json({ error: "Original price must be greater than the offer price." });
  products[index] = { ...old, name, description: cleanText(req.body.description ?? old.description, 1500), price: Math.round(price * 100) / 100, ...(compareAtPrice > price ? { compareAtPrice: Math.round(compareAtPrice * 100) / 100 } : { compareAtPrice: null }), imageUrl, category: cleanText(req.body.category ?? old.category, 80), sizes: Array.isArray(req.body.sizes) ? req.body.sizes : old.sizes, stock: Math.max(0, Math.floor(Number(req.body.stock ?? old.stock))) };
  await saveRecord("products", products[index]);
  res.json(products[index]);
}));
app.delete("/api/admin/products/:id", requireAdmin, requireSupabase, asyncRoute(async (req, res) => {
  const products = await readProducts();
  const product = products.find(p => String(p.id) === String(req.params.id));
  if (!product) return res.status(404).json({ error: "Product not found." });
  await deleteRecord("products", req.params.id);
  res.json({ ok: true });
}));

app.post("/api/checkout/upi-order", requireSupabase, asyncRoute(async (req, res) => {
  const customerName = cleanText(req.body.customerName, 120);
  const phone = String(req.body.phone || "").replace(/\D/g, "");
  const address = cleanText(req.body.address, 500);
  const pincode = String(req.body.pincode || "").replace(/\D/g, "");
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (!customerName || !phone || !address || !items.length || !pincode) return res.status(400).json({ error: "Please enter your name, mobile number, delivery address, PIN code and at least one product." });
  if (!/^[6-9]\d{9}$/.test(phone)) return res.status(400).json({ error: "Enter a valid 10-digit Indian mobile number starting with 6, 7, 8 or 9." });
  if (!/^[1-9]\d{5}$/.test(pincode)) return res.status(400).json({ error: "Enter a valid 6-digit Indian PIN code." });
  const products = await readProducts();
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
  const shipping = 100;
  const subtotal = Math.round(total * 100) / 100;
  const orderTotal = Math.round((subtotal + shipping) * 100) / 100;
  const order = {
    id: "SS-" + Date.now().toString(36).toUpperCase() + "-" + crypto.randomBytes(2).toString("hex").toUpperCase(),
    customerName, phone, address, pincode, items: orderItems, subtotal, shipping, total: orderTotal,
    paymentStatus: "PENDING", status: "PENDING_PAYMENT", createdAt: new Date().toISOString()
  };
  await saveRecord("orders", order);
  sendWebPushOrderAlert(order).catch(err => console.error("[Web Push] Order alert error:", err.message));
  sendCustomerOrderSms(order).catch(err => console.error("[Customer order SMS] Alert error:", err.message));
  sendAdminSmsAlert(order).catch(err => console.error("[Admin SMS] Alert error:", err.message));
  sendWhatsAppOrderAlert(order).catch(err => console.error("[WhatsApp] Alert error:", err.message));
  const params = new URLSearchParams({ pa: SHOP_UPI_ID, pn: SHOP_NAME, am: order.total.toFixed(2), cu: "INR", tn: `Order ${order.id}` });
  res.status(201).json({ order, upiLink: `upi://pay?${params.toString()}` });
}));
app.post("/api/track-order", requireSupabase, asyncRoute(async (req, res) => {
  const phone = String(req.body.phone || "").replace(/\D/g, "");
  if (!/^[6-9]\d{9}$/.test(phone)) return res.status(400).json({ error: "Enter your registered 10-digit Indian mobile number." });
  const orders = (await readRecords("orders"))
    .filter(o => String(o.phone || "").replace(/\D/g, "").slice(-10) === phone)
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
    .map(order => ({
      id: order.id,
      status: order.status,
      paymentStatus: order.paymentStatus || (order.status === "PENDING_PAYMENT" ? "PENDING" : ["PAID", "PROCESSING", "SHIPPED", "DELIVERED"].includes(order.status) ? "PAID" : "PENDING"),
      subtotal: Number(order.subtotal ?? order.total ?? 0),
      shipping: Number(order.shipping ?? 0),
      total: Number(order.total || 0),
      createdAt: order.createdAt,
      items: (order.items || []).map(item => ({ name: item.name, quantity: item.quantity, size: item.size || "" }))
    }));
  if (!orders.length) return res.status(404).json({ error: "No orders found for this mobile number. Please check the number used at checkout." });
  res.json({ orders });
}));
app.get("/api/orders/:id/status", requireSupabase, asyncRoute(async (req, res) => {
  const order = (await readRecords("orders")).find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: "Order not found." });
  res.json({ id: order.id, status: order.status });
}));
app.get("/api/admin/orders", requireAdmin, requireSupabase, asyncRoute(async (req, res) => res.json(await readRecords("orders"))));
app.patch("/api/admin/orders/:id", requireAdmin, requireSupabase, asyncRoute(async (req, res) => {
  const allowed = ["PENDING_PAYMENT", "PAID", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED"];
  const status = cleanText(req.body.status, 40);
  if (!allowed.includes(status)) return res.status(400).json({ error: "Invalid order status." });
  const orders = await readRecords("orders");
  const order = orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: "Order not found." });
  const previousStatus = order.status;
  order.status = status;
  if (["PAID", "PROCESSING", "SHIPPED", "DELIVERED"].includes(status)) order.paymentStatus = "PAID";
  else if (status === "PENDING_PAYMENT") order.paymentStatus = "PENDING";
  order.updatedAt = new Date().toISOString();
  await saveRecord("orders", order);
  if (previousStatus !== status) {
    sendCustomerStatusSms(order, status).catch(err => console.error("[Customer status SMS] Alert error:", err.message));
  }
  res.json(order);
}));
app.get("/admin", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "admin.html")));
app.get("*", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "index.html")));

// STYLE_STORY_ERROR_LOGGING: surface actionable server errors in Render Runtime Logs.
app.use((err, req, res, next) => {
  console.error("[STYLE_STORY_ERROR_LOGGING]", JSON.stringify({
    method: req.method,
    path: req.path,
    message: err && err.message ? err.message : String(err),
    code: err && err.code,
    details: err && err.details,
    hint: err && err.hint,
    status: err && err.status
  }));
  if (res.headersSent) return next(err);
  if (req.path.startsWith("/api/admin/")) {
    return res.status(500).json({
      error: "Admin request failed. See diagnostic fields below.",
      diagnostic: err && err.message ? err.message : String(err),
      code: err && err.code ? err.code : undefined,
      details: err && err.details ? err.details : undefined,
      hint: err && err.hint ? err.hint : undefined
    });
  }
  res.status(500).json({ error: "Internal server error. Check Render Runtime Logs for STYLE_STORY_ERROR_LOGGING." });
});

app.listen(PORT, () => {
  console.log(`${SHOP_NAME} running on http://localhost:${PORT}`);
  console.log("[SUPABASE_CONFIG]", JSON.stringify({ urlPresent: Boolean(SUPABASE_URL), serviceRoleKeyPresent: Boolean(SUPABASE_SERVICE_ROLE_KEY), serviceRoleKeyLength: SUPABASE_SERVICE_ROLE_KEY.length, bucket: STORAGE_BUCKET }));
  console.log(supabase ? "Supabase client initialized; database connection will be checked on first request." : "WARNING: Supabase is not configured; database routes will be unavailable.");
  if (!SESSION_SECRET || SESSION_SECRET.length < 32) console.warn("WARNING: SESSION_SECRET must be at least 32 characters. Set it in .env.");
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) console.warn("WARNING: Set ADMIN_EMAIL and ADMIN_PASSWORD in .env before admin login.");
  if (!supabase) console.warn("WARNING: Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Render Environment.");
});
