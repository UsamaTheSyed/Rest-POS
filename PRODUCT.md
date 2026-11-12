# Ember commercial product specification

## Agreed product

Sell a restaurant POS subscription in Pakistan, with cloud management and continued restaurant operation during internet outages. Support independent restaurants first, with a path to multi-branch chains. Digital menu/deal boards are part of the product, not a separate demo.

**Current release status: engineering foundation, not approved for commercial deployment.** The first implementation is the local branch service. Cloud synchronization, subscription billing, fiscal integrations, direct printer drivers and the remaining operations modules below are not delivered.

## Deployment architecture

- Restaurant LAN: a branch service on an always-on local computer owns orders, payment records, shifts and kitchen state. Tills, kitchen displays and TV boards connect to it. Internet failure must not stop local ordering. Failure of the branch computer itself is a separate recovery scenario; UPS and backup/restore procedures are required.
- Cloud control plane: tenant onboarding, subscriptions, branch/device enrollment, central menu management, owner dashboards and reporting. Restaurants must never be able to read another tenant's records.
- Cloud database: managed PostgreSQL with per-tenant authorization, automated backups and tested restoration. Images and backups belong in private object storage with controlled access.
- Synchronization: transactional outbox on the branch, signed device identity, immutable event IDs, retry with backoff, acknowledgments and deduplicated cloud inbox. Sales remain branch-authoritative; cloud menu updates use explicit versions. Never overwrite a locally finalized receipt with cloud state.
- Network outages: continue orders and local printing, show sync backlog and last successful upload, and reconcile automatically on reconnect. Cloud subscription interruptions need an explicit business grace policy rather than abruptly disabling a busy restaurant.
- Deployment must use HTTPS, managed secret storage, monitored services, signed updates and support diagnostics with customer consent. No production credentials belong in the repository.

## Feature scope and acceptance gates

| Module | Required behavior before sale | Current state |
|---|---|---|
| Restaurant onboarding | Branding, location, currency, province, fiscal registration, tax profile, menu import, opening balances | Owner setup and restaurant name only |
| Staff | Granular roles, account disable/reset, manager approvals, individual sessions, audited sensitive operations | Owner/cashier/kitchen access, account creation, employee profiles, clock-in/out and attendance CSV |
| Catalog | Categories, sizes, modifiers, optional extras, recipes, availability, item images, combo definitions and scheduled deals | Item creation with custom categories, price and availability edits |
| Counter POS | Fast touch/keyboard entry, held orders, notes, cash change, split tender, discounts with approvals, delivery details | Paid or unpaid orders, deferred settlement, notes and outstanding bills |
| Table service | Floor plan, open checks, waiter assignment, course firing, table transfer/merge and split bills | Table reference only |
| Kitchen | Station routing, new-ticket alert, preparation timers, item completion, recall and reprint | Queue → preparing → ready → served |
| Payments | Cash, external card, supported wallet/bank integrations, reversals, payment reconciliation | Manual cash/card payment recording at placement or later settlement |
| Receipts | Configurable 80/58mm layouts, kitchen tickets, fiscal receipt references, direct printer adapters, durable print queue and reprint audit | Browser-print internal receipt |
| Voids/refunds | Manager approval, original-sale link, reason codes, partial/full refund, append-only ledger, correct tax adjustment | Not implemented |
| Shifts | Opening float, cash in/out, drawer counts, expected vs actual, variance approvals and shift closing | Not implemented |
| Inventory | Ingredient units, recipes/modifiers, stock movements, wastage, counts, low stock and cost snapshots | Manual stock ledger, units, usage/wastage, counts and low-stock thresholds; recipes and costing pending |
| Purchasing | Suppliers, purchase orders, goods receipt, supplier returns, costs and payable tracking | Not implemented |
| Customers | Optional profile, consent, loyalty ledger, discounts and customer history | Customer reference only |
| Reporting | Sales by payment/item/category/staff/shift, cost of goods, profit, refunds, cash reconciliation, CSV export | Daily collected payments by payment date in Pakistan time |
| TV displays | Branded menu boards, deals, schedules, sold-out updates, local media, device pairing and order-ready board | Menu/deal board with 15-second refresh; external media |
| Cloud SaaS | Tenant onboarding, subscriptions, branch isolation, plan limits, cloud dashboard and device enrollment | Not implemented |
| Offline operation | No external runtime assets, durable local transactions, tested WAN outage, sync replay and conflict handling | Local database-backed transactions; cloud sync absent |
| Reliability/support | Backup, restore drills, signed updates, monitoring, incident recovery, data export/deletion and support tooling | Automated database and API tests only |

## Pakistan localization and fiscal work

- Store money as integer paisa; display PKR. Store timestamps in UTC; reports use Asia/Karachi. Add Urdu/RTL receipt and UI support after font/printer verification.
- Do not assume one tax rate or fiscal API applies across Pakistan. Build jurisdiction-specific, versioned tax profiles, inclusive/exclusive pricing and payment-method-specific rules where applicable. Snapshot the applied profile and amounts on each invoice.
- Determine the first pilot restaurant's province, registration and applicable regime before choosing the fiscal adapter. FBR's digital invoicing guidance discusses integration through licensed integrators for notified registered persons. KPRA separately publishes restaurant RIMS APIs. A configurable rate is not fiscal integration or certification.
- Fiscal submissions require durable status tracking, authority references/QR data, rejection handling, retries, reconciliations and correct handling of cancellations/credit notes. Never label a locally generated number as an authority-verified invoice.
- Payment integrations require the merchant's provider agreement and sandbox credentials. Never collect or store card PAN/CVV in this application.

Primary references reviewed:

- https://www.fbr.gov.pk/faqs/173967/173969
- https://posregistration.kpra.gov.pk/docs
- https://reg.pra.punjab.gov.pk/ptms/SOP/Download/Rules/Restaurant%20services%20Rules%2009-10-2012.pdf (historical rules; current applicability must be checked for the pilot)

## Delivery sequence

1. Finish and validate branch operations: catalog CRUD/modifiers, table checks, shift ledger, split tender, manager-approved refunds, kitchen routing and local asset storage.
2. Inventory, purchasing, cost accounting and operational reports, with transaction-level stock movement tests.
3. Durable print service, paired display devices, backup/restore and installer/service management on the selected restaurant hardware.
4. Cloud tenant control plane, enrollment and synchronization; prove replay safety, tenant isolation and offline continuity under network failures.
5. Fiscal and payment provider adapters using sandbox accounts and the pilot restaurant's registration requirements.
6. Pilot with real restaurant staff and hardware. Fix observed operational issues before commercial release.

## Release evidence required

- Complete order lifecycle exercised for dine-in, takeaway and delivery; printer disconnect/recovery tested with real hardware.
- Concurrent tills never duplicate a sale or overwrite kitchen state. Repeated payment submissions return one sale.
- WAN disconnection, server restart and sync retries do not lose or double-record sales; full reconciliation demonstrated.
- Refunds, tax, discounts, cash drawer and stock ledgers balance against known scenarios.
- Tenant isolation and role escalation tests, credential recovery, session revocation and security review pass.
- Backup restoration demonstrated on a replacement device, not merely a successful backup command.
- Fiscal/provider sandbox acceptance followed by authorized production onboarding.
- Restaurant owner accepts day-end reports, training material and support process during a supervised pilot.

## Customer ordering implementation

Table-specific QR menus and a command-based WhatsApp Cloud API bot feed staff-reviewed customer requests. Accepting a request creates an unpaid kitchen/POS order with idempotent retries. Owners manage table codes; owners and cashiers accept/reject requests. WhatsApp requires deployment secrets and Meta onboarding; live delivery is not yet verified. This version supports one WhatsApp business number per deployment, manual request refresh and customer-initiated status checks. Public table codes do not verify physical presence. Durable storage, live device tests and operational acceptance are required before commercial use.
