# Ember Restaurant POS

A restaurant branch-service foundation with cashier, kitchen and management screens. Requires Node.js 24.12 or newer. Built-in SQLite is experimental in Node 24.12; production runtime selection remains a release task.

## Run

```sh
npm ci
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

## Customer table ordering and WhatsApp bot

Install dependencies with `npm ci` before starting. Render **Build Command** must now be `npm ci`; **Start Command** stays `npm start`.

### Table QR ordering

1. Set `PUBLIC_BASE_URL` in Render to the full deployed HTTPS URL (for example `https://your-pos.onrender.com`), then redeploy.
2. Open **Operations → Customer orders** as owner. Create a table with a label such as **Table 04**.
3. Use **Print table cards**, or open its QR image. Test each printed code on a phone before placing it on the table.
4. Customers scan without signing in, select quantities, add notes, and send a request. The table is assigned by the server; customers cannot select another table by editing the submitted JSON.
5. Owners/cashiers open **Customer orders**, click **Refresh requests**, verify the request and **Accept and send to kitchen** or **Reject**. Acceptance creates one unpaid POS order. Collect payment through the existing POS flow later.

A table link is shareable, not proof that the customer is physically present. Staff acceptance is required. Disable a code to invalidate printed/shared copies. Public menus expose only available products and their restaurant's images, not staff accounts or other orders. Requests have a rate limit and a pending-queue limit. Public request retries and staff acceptance are idempotent. If prices or availability change before acceptance, reject the request and ask the customer to resubmit with the updated menu.

### Automated WhatsApp bot setup

This is a command-based Cloud API bot, not an AI/free-text assistant or a wa.me link. One business phone number is mapped to one restaurant per deployment. No live Meta account is configured by the code change.

Configure these variables privately in Render (never commit tokens):

| Variable | Value |
| --- | --- |
| `WHATSAPP_RESTAURANT_ID` | Restaurant ID shown in **Customer orders** |
| `WHATSAPP_PHONE_NUMBER_ID` | Meta Cloud API business phone number ID, not the phone number itself |
| `WHATSAPP_ACCESS_TOKEN` | Valid server-side access token authorized to send messages for that phone number |
| `WHATSAPP_APP_SECRET` | Meta app secret used to verify webhook signatures |
| `WHATSAPP_VERIFY_TOKEN` | A long random secret you choose and enter identically in Meta webhook setup |
| `WHATSAPP_API_VERSION` | Supported Graph API version selected for your Meta app, in `vNN.N` format |

In your Meta app's WhatsApp configuration, set the HTTPS callback to `https://YOUR-HOST/webhooks/whatsapp`, use your verification token, and subscribe to **messages** events. Follow Meta's account and phone-number onboarding requirements. The endpoint verifies the challenge and checks signed event bodies before processing them. Setup reference: [Meta's webhook verification documentation](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/webhooks/start/).

Test with the allowed recipient/test number in your Meta account before enabling your business number:

```text
MENU
ORDER 1x2, 3x1 | Delivery | Ali | Full delivery address
CONFIRM
STATUS 1
```

Use actual item IDs returned by `MENU`. `MENU 2` shows the next page. Use `Takeaway` for pickup, or `Dine-in` and include the table in the last field. The bot quotes the total including tax; `CONFIRM` submits a staff-review request, and `CANCEL` clears the draft. Drafts expire after 30 minutes. `STATUS <request number>` checks acceptance only for requests belonging to that sender. Accepted requests become unpaid POS orders; staff can edit and collect payment as usual. Rejection/acceptance notifications are not pushed automatically: customers use STATUS or contact staff.

Inbound message IDs and replies are stored for retry handling. A failed Meta send returns an error so webhook delivery can retry without duplicating the order request. In the rare case Meta accepts a reply but the network loses the response, a reply may appear twice; the order request remains deduplicated. No outgoing promotional/template messages, payment collection, natural-language interpretation, or multiple WhatsApp business-number routing is implemented.

**Review-demo limitation:** the existing Render Free `/tmp` database is ephemeral. A reset loses table links, requests, message deduplication, and orders; old printed QR codes stop working. Use durable storage before using this with real restaurant customers. The automated tests cover the local API and mocked Meta delivery; actual phone scanning and live Meta delivery still need verification. Browser automation timed out during this change.
