# Style Story

Style Story is a Node.js/Express fashion storefront with product details, cart/UPI checkout, admin product management, and order tracking.

## Run locally

1. Install Node.js 20 or later.
2. In this folder run `npm install`.
3. Create a local `.env` file using `.env.example` as a guide. Set a unique admin email/password and a random `SESSION_SECRET` of at least 32 characters.
4. Run `npm start`.
5. Open `http://localhost:3000`. Admin dashboard: `http://localhost:3000/admin`.

## Important before hosting

- Never commit `.env`, passwords, API tokens, customer order details, or real `data/orders.json` / `data/products.json` files. The repository ignores these data files and `.env`.
- Do not use example values for production admin credentials. Set secrets in the hosting provider's environment-variable settings.
- This app currently stores products/orders in local JSON files and uploaded images under `public/uploads`. Serverless hosting (including Vercel functions) does not provide durable writable local storage for these. Before accepting real orders online, move order/product storage to a persistent database and product images to persistent object storage, or use a host with persistent storage.
- UPI checkout creates a pending-payment order. Payment is not automatically verified: confirm payment in the bank/UPI app before changing an order to paid.
- SMS/WhatsApp notifications require valid provider credentials and remain disabled when those environment variables are blank.

## Project structure

- `server.js` — Express API and server
- `public/index.html` — storefront
- `public/product.html` — product page
- `public/admin.html` — admin dashboard
- `public/track.html` — order tracking
- `public/images/` — site images
- `data/` and `public/uploads/` — created/used at runtime; do not commit customer/order data or secrets
