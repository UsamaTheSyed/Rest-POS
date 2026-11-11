# Ember Restaurant POS

A restaurant branch-service foundation with cashier, kitchen and management screens. Requires Node.js 24.12 or newer. Built-in SQLite is experimental in Node 24.12; production runtime selection remains a release task.

## Run

```sh
npm start
```

Open http://localhost:3000 and create the restaurant owner account from the server computer. There are no default credentials. The digital menu board is at http://localhost:3000/?display=1 and operations at http://localhost:3000/operations.html.

## Menu and orders

Sign in as owner, click **Manage menu** (or **Operations → Menu**), and complete **Add menu item**. Enter the item name, choose or type a category, enter the PKR price, optionally add a description and badge, then select availability and submit. Use the Deals category for combos. New dishes use a local neutral illustration. Owners can also change prices and availability in the menu table.

Cashiers can type whole quantities from 1–999, use the plus/minus buttons, or click **Remove** on an unsubmitted order line. Enter or leaving the quantity box applies the value and updates totals. These controls do not void finalized sales.

Owners can create cashier/kitchen accounts, configure a demonstration tax rate, and view sales and audit records. Kitchen staff see the live ticket queue. Orders and staff are stored in `data/ember.sqlite`, outside the web root. Browser storage contains only draft-order information, not the sales ledger. Old prototype browser-only orders are not imported.

## Status and deployment

For a disposable Render Free review demo, set `DEMO_BOOTSTRAP=1` and configure `INITIAL_RESTAURANT`, `INITIAL_NAME`, `INITIAL_EMAIL`, and `INITIAL_PASSWORD` in Render environment variables. The password must contain 12–200 characters. Startup creates the owner and sample menu only when the database has no accounts; it never resets an existing password. Missing or invalid setup values stop startup rather than expose incomplete setup. Keep these environment variables for the life of the free demo so the account can be recreated after the ephemeral database is lost. Do not commit their values. Set `HOST=0.0.0.0`, `COOKIE_SECURE=1`, and `DATA_DIR=/tmp/ember-data`; let Render supply `PORT`. The data directory is temporary, not a persistent disk. This mode does not make data durable or provide cloud synchronization.

This is **not yet a commercial release**. The agreed target is a Pakistan-focused cloud subscription with offline branch operation. See `PRODUCT.md` for the architecture, feature status and release gates. Cloud sync, subscriptions, inventory, table-check management, shifts, refunds, fiscal integration and direct printer integration remain unimplemented. Payments are recorded manually; cards are not processed. Browser printing produces an internal sales receipt, not a verified fiscal invoice. Sample photography loads from Unsplash and fonts from Google Fonts; local asset storage is required for fully offline displays.

Runtime configuration: `PORT` (3000), `HOST` (127.0.0.1), `DATA_DIR` (`data`), `COOKIE_SECURE` (`1` behind HTTPS). Keep the service on loopback during development. Production LAN/cloud deployment needs HTTPS and hardened service management. Complete initial setup before exposing the service through a proxy. Do not publish the database or copy a live SQLite main file without accounting for its WAL; use a consistent backup procedure.

Run `npm test` for calculation, persistence, authorization, menu creation, quantity validation, order idempotency, tenant scoping and HTTP tests. Payable amounts are computed on the server in integer paisa. The original pure model calculation remains only as a prototype regression test.
