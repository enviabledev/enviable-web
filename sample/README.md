# Sample CSV files for /admin/historical-load

These files show the exact format the historical-load handlers expect.
Copy one, replace the example rows with your real data, and upload it
through the dry-run/commit flow on `/admin/historical-load`.

The backend validates strictly: missing fields, unknown SKUs, in-file
duplicates, and against-DB duplicates all fail the dry-run, and any
error rejects the whole commit (all-or-nothing). Run a dry-run first;
the commit button stays disabled until a dry-run with zero errors
lands.

## `historical-units.csv`

Columns (header row required, exact spelling, in this order):

| Column             | Required | Notes                                                                                                            |
| ------------------ | -------- | ---------------------------------------------------------------------------------------------------------------- |
| `productVariantSku`| yes      | Must match an existing `ProductVariant.supplierSkuCode` exactly. Unknown SKUs fail the dry-run.                  |
| `engineNumber`     | yes      | Must be unique across the file AND across the existing `Unit` table. Duplicates fail the dry-run.                |
| `chassisNumber`    | yes      | Same uniqueness rule as `engineNumber`.                                                                          |

Effect of a successful commit: each row creates one `Unit` (status
`IN_WAREHOUSE_CKD`) under the parent `Shipment` you select on the
upload form, with a paired `RECEIPT` `StockMovement` attributed to
your user id. The shipment id is passed in the URL, not in the CSV.

## `historical-spare-parts.csv`

Columns (header row required, exact spelling, in this order):

| Column     | Required | Notes                                                                                       |
| ---------- | -------- | ------------------------------------------------------------------------------------------- |
| `sku`      | yes      | Unique key. If the sku exists, `quantityOnHand` is incremented; otherwise a new row is created. |
| `name`     | yes      | Display name. Updated on existing rows alongside the quantity increment.                    |
| `quantity` | yes      | Positive integer. Non-integer or non-positive values fail the dry-run.                      |

Effect of a successful commit: each row upserts a `SparePart` and
writes a paired `RECEIPT` `SparePartMovement` for the loaded quantity,
attributed to your user id.

## Notes on the example SKUs

`historical-units.csv` uses the three seeded `ProductVariant` SKUs
(`GSP-G-YELLOW`, `GSP-ECO-GREEN`, `ZSP-G-YELLOW`) so the file dry-runs
cleanly against a freshly-seeded database. Replace them with your real
variant SKUs.

`historical-spare-parts.csv` uses placeholder SKUs (`SP-AIR-FILTER-001`,
etc.). The first run creates these as new spare parts; re-running the
same file would add to their `quantityOnHand` rather than duplicating
rows.
