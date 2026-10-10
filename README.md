# Style Story — Admin product edit fix

## What changed
- Admin product cards now show **Edit** and **Delete** buttons.
- Edit fills the form with the saved product details; you can update name, description, price, category, sizes, stock, and optionally replace the photo.
- **Update product** saves changes to the existing product instead of creating a duplicate.
- Cancel edit returns the form to Add product mode.
- Product/order JSON data is intentionally not included in this ZIP so your existing store data is not overwritten.

## Install safely
1. Stop the currently running server with Ctrl+C.
2. Extract this ZIP into a new folder.
3. Copy your existing `.env`, `data/products.json`, `data/orders.json`, and `public/uploads` from your working project into this folder. Back them up first.
4. Open CMD in the new folder and run `npm install` then `npm start`.
5. Open `http://localhost:3000/admin` and hard-refresh with Ctrl+Shift+R.
6. Log in, find a product under **Your products**, click **Edit**, change a field, then click **Update product**.

Do not delete your old project folder until you have confirmed the new folder works with your existing products and orders.
