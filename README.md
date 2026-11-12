# Ember Restaurant POS

A restaurant branch-service foundation with cashier, kitchen and management screens. Requires Node.js 24.12 or newer. Built-in SQLite is experimental in Node 24.12; production runtime selection remains a release task.

## Run

```sh
npm start
```

Open http://localhost:3000 and create the restaurant owner account from the server computer. There are no default credentials. The digital menu board is at http://localhost:3000/?display=1 and operations at http://localhost:3000/operations.html.

## Menu and orders

Sign in as owner, click **Manage menu** (or **Operations → Menu**), and complete **Add menu item**. Enter the item name, choose or type a category, enter the PKR price, optionally add a description and badge, then select availability and submit. Use the Deals category for combos. Optionally upload a JPG, PNG or WebP image up to 2 MB and review its preview before saving. Photos are stored in SQLite with the menu and appear in the POS, cart, and digital menu board. New dishes without photos use a local neutral illustration. Uploaded images on Render Free are temporary and are lost with the ephemeral database. Owners can also change prices and availability in the menu table.

Cashiers can type whole quantities from 1–999, use the plus/minus buttons, or click **Remove** on an unsubmitted order line. Enter or leaving the quantity box applies the value and updates totals. These controls do not void finalized sales.

Owners can create cashier/kitchen accounts, configure a demonstration tax rate, and view sales and audit records. Kitchen staff see the live ticket queue. Orders and staff are stored in `data/ember.sqlite`, outside the web root. Browser storage contains only draft-order information, not the sales ledger. Old prototype browser-only orders are not imported.

## Status and deployment

For a disposable Render Free review demo, set `DEMO_BOOTSTRAP=1` and configure `INITIAL_RESTAURANT`, `INITIAL_NAME`, `INITIAL_EMAIL`, and `INITIAL_PASSWORD` in Render environment variables. The password must contain 12–200 characters. Startup creates the owner and sample menu only when the database has no accounts; it never resets an existing password. Missing or invalid setup values stop startup rather than expose incomplete setup. Keep these environment variables for the life of the free demo so the account can be recreated after the ephemeral database is lost. Do not commit their values. Set `HOST=0.0.0.0`, `COOKIE_SECURE=1`, and `DATA_DIR=/tmp/ember-data`; let Render supply `PORT`. The data directory is temporary, not a persistent disk. This mode does not make data durable or provide cloud synchronization.

This is **not yet a commercial release**. The agreed target is a Pakistan-focused cloud subscription with offline branch operation. See `PRODUCT.md` for the architecture, feature status and release gates. Cloud sync, subscriptions, inventory, table-check management, shifts, refunds, fiscal integration and direct printer integration remain unimplemented. Payments are recorded manually; cards are not processed. Browser printing produces an internal sales receipt, not a verified fiscal invoice. Sample photography loads from Unsplash and fonts from Google Fonts; local asset storage is required for fully offline displays.

Runtime configuration: `PORT` (3000), `HOST` (127.0.0.1), `DATA_DIR` (`data`), `COOKIE_SECURE` (`1` behind HTTPS). Keep the service on loopback during development. Production LAN/cloud deployment needs HTTPS and hardened service management. Complete initial setup before exposing the service through a proxy. Do not publish the database or copy a live SQLite main file without accounting for its WAL; use a consistent backup procedure.

Run `npm test` for calculation, persistence, authorization, menu creation, quantity validation, order idempotency, tenant scoping and HTTP tests. Payable amounts are computed on the server in integer paisa. The original pure model calculation remains only as a prototype regression test.


## Inventory, staffing and attendance

Owners can open **Operations > Inventory** to add stock items with units and low-stock thresholds. Receive stock, record usage/wastage, or enter a physical count with a reason. History records the staff member, change and balance; physical counts reject stale balances and repeated movement requests do not apply twice. Stock is manually maintained; sales do not yet consume ingredient recipes.

**Operations > Staffing** maintains names, job titles, optional phone numbers and active status for employees, including workers without a POS login. Existing POS accounts receive linked employee profiles automatically. **Staff accounts** still manages sign-in creation separately; marking a profile inactive does not revoke its POS login.

**Attendance** is available to every signed-in user from the POS header. Staff see and clock only their own profile; owners can clock the team, including employees without logins. One open session per employee is enforced. Owners must clock someone out before deactivating their profile. Reports filter up to 93 days, clip overnight sessions to Pakistan date boundaries, show gross elapsed time, and export CSV. They do not calculate breaks, payroll, lateness, absence, leave or scheduled shifts. Existing records are not retroactively editable through this UI.

Inventory, employee and attendance records use the same SQLite database. On Render Free, these records are temporary and are lost if the database is cleared. Browser visual verification of these new modules is pending; automated tests cover API permissions, precision, duplicate stock requests and attendance transitions/date boundaries.


## Order now, pay later

All service types (dine-in, takeaway and delivery) support **Send to kitchen · Pay later**. Confirming places an unpaid order in the kitchen immediately. Later, open **Orders > Unpaid**, identify the table/customer or order number, select **Collect payment**, choose cash or external card, and confirm receipt of the full amount. **Pay now** remains available when placing a new order.

Kitchen status and payment status are independent: an order can be prepared, ready or served while still unpaid. Settling it updates the same order and never creates another kitchen ticket. Prices and tax stay as recorded at placement. Unpaid orders remain accessible even after more than 200 subsequent orders. Print bill labels unpaid orders clearly; paid orders show the payment method and time. Reports include collected payments grouped by payment date in Pakistan time, excluding unpaid bills. Existing paid records migrate automatically without being reset to unpaid.

Payments remain manually recorded, not processed by a gateway. Partial payments and refunds are not part of this workflow. Automated tests cover all service types, duplicate payment attempts, migration, report timing and permissions; browser visual verification of this workflow is pending.

### Edit an unpaid order

Open **Orders & payments → Unpaid → Collect payment → Edit order**. Add or remove items, type quantities, and change the table/customer or kitchen note, then choose **Save and return to payment**. This works for dine-in, takeaway and delivery. Existing items keep their original prices and the order retains its tax rate; added items use current menu prices. At least one item must remain.

Item or note changes return the same ticket to the kitchen queue with a change summary. Communicate changes to staff if preparation has started. Edits are audited, paid orders cannot be edited, and stale payment or kitchen actions are rejected until refreshed. Automated coverage includes edits, permissions, price preservation, concurrent revisions and settlement; browser visual verification remains pending.
