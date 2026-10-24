# Service catalog and booking snapshots (VIS-12)

## Contract and money

`@visit/contracts` is a dependency-free workspace package shared by API repositories,
both HTTP create surfaces, and the Expo editor. It accepts names of 2–120 Unicode
code points, descriptions up to 2,000, and whole durations of 5–1,440 minutes.
Unknown fields and Prisma update-operation objects are rejected. A partial update is
validated again after merging under a service row lock.

Prices are PostgreSQL integers in hundredths, from 0 to 2,000,000,000 inclusive
(maximum 20,000,000 major units). Pilot currencies are **ILS, USD, EUR and GBP**;
each uses two decimal places. The optional unknown price is **both priceMinor and
currency null**; zero is an explicit free price. Setting/clearing only half of the
pair fails. Additional currencies require an explicit exponent-aware contract and
migration; accepting arbitrary three-letter strings would misprice JPY/KWD.

The form parses decimal strings into integer whole/fraction parts. It rejects
negative amounts, exponent notation, comma separators and more than two decimal
places, instead of rounding. SQL constraints also protect direct database writes.

## Editing, archive and deletion

Only current active OWNER/MANAGER members of an approved business can mutate its
catalog. Reads and writes use authorized business scope. Both provider routes use
the same localized editor. The editor preserves drafts on validation or network
failure, disables editing while a mutation is pending, and shows explicit success
or recovery feedback. Identity/business switches remount the editor; a draft is
never transferred to another tenant.

Archive (`active: false`) removes a service from public lists/availability; restore
makes it active again. Delete permanently removes an unreferenced service and its
staff assignments. Any booking history, including cancelled/expired rows, causes
archive instead; the restrictive FK is the final race guard. The UI explains and
confirms these semantics before deletion. Existing held/confirmed appointments
retain their agreed service details even if the service is later archived.

Creating a service can atomically assign existing active staff through the
compatibility create route. With no staff selected, a provider may configure the
catalog first; the editor explicitly says assignments are required before bookings.
Full staff assignment editing belongs to VIS-35.

## Historical records and concurrent changes

A database trigger snapshots service name, duration, integer price and currency
when each booking is first inserted. It locks the service row FOR SHARE and rejects
all later snapshot/service-ID/business-ID changes, including raw database writes.
Snapshot values from a caller are ignored at insertion. The booking API also
rechecks the selected service under the same lock inside its serializable booking
transaction; a concurrent edit/archive results in a conflict rather than silently
changing the selected duration or price.

Customer lists, confirmations/calendar exports, provider lists, daily agenda and
revenue totals read snapshots. Rescheduling retains the reserved duration and
service price rather than adopting the current catalog. Policy/buffer revalidation
and complete rescheduling audit remain VIS-26/38.

Migration `20261025004000_service_history` backfills existing appointment duration
from its persisted start/end interval and existing name/price from the current
catalog. **Previously overwritten historical names/prices cannot be recovered.**
These legacy rows are a best available baseline; the guarantee starts at migration.
Invalid legacy service details fail the constraint migration and require explicit
correction; no destructive normalization is performed.

After service mutations, TanStack Query invalidates catalog, discovery, public
provider details, availability and provider agendas. Booking history does not need
catalog-driven invalidation because its snapshot is immutable.

## Evidence

- `npm test --workspace @visit/api`: shared contract; v1/compatibility rejection;
  edit/null pair rules; snapshot/price preservation; reschedule duration; simulated
  service-edit race; archive/restore/delete and direct SQL constraints. Existing
  tenant authorization and Redis/capacity regressions remain enabled.
- `npm run test:foundation --workspace @visit/mobile`: exact money parsing contract.
- `npm run test:web --workspace @visit/mobile`: create/edit/archive/restore/delete,
  pending/failed mutation and retained draft, original agenda details, tenant-switch
  reset, Hebrew RTL mobile editor and LTR numeric fields, plus booking/auth journeys.
- Storybook catalog: Hebrew, English and empty-state stories with cached isolated
  query fixtures. Storybook resolves web platform modules and uses an invalid API
  origin. Browser-only storage is a platform file so native SecureStore is not
  pulled into web component bundles.
- Native Expo exports validate bundle resolution; actual installed iOS/Android
  interaction remains VIS-2/VIS-43 and is not certified here.
