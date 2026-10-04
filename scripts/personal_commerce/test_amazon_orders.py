"""Entirely synthetic fixtures: no identifiers or names from real exports."""
import csv
import io
import json
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile

from amazon_orders import (HISTORY, REFUNDS, RETURNS, REPLACEMENTS, FILES,
                           ImportErrorCode, decode_csv, identity, load_export,
                           normalize, number, write_private_json)


def row(**changes):
    value = {"Order ID": "FAKE-ORDER-A", "ASIN": "FAKE-SKU-A",
             "Order Date": "2026-09-01T16:00:00Z", "Product Name": "架空洗剤 400ml",
             "Original Quantity": "1", "Currency": "JPY", "Order Status": "Closed",
             "Shipment Status": "Shipped", "Unit Price": "1,000",
             "Billing Address": "PRIVATE ADDRESS", "Payment Method Type": "PRIVATE CARD"}
    value.update(changes)
    return value


def convert(rows, returns=None, refunds=None, replacements=None):
    tables = {HISTORY: rows, RETURNS: returns or [], REFUNDS: refunds or [],
              REPLACEMENTS: replacements or []}
    return normalize(tables, {n: identity("synthetic", n) for n in FILES}, "fixture-account")


class AmazonOrdersTests(unittest.TestCase):
    def test_timezone_and_minimal_output(self):
        out = convert([row()])
        self.assertEqual(out["orders"][0]["orderedOn"], "2026-09-02")
        self.assertEqual(out["summary"]["accepted"], 1)
        payload = json.dumps(out)
        self.assertNotIn("PRIVATE", payload)
        self.assertNotIn("Billing Address", payload)
        self.assertIsNone(out["orders"][0]["lines"][0]["amountMinor"])

    def test_two_units_not_two_purchases(self):
        out = convert([row(**{"Original Quantity": "2"})])
        self.assertEqual(out["summary"]["orders"], 1)
        self.assertEqual(out["orders"][0]["lines"][0]["quantity"], 2)

    def test_malformed_timezone_is_not_normalized_into_a_purchase_date(self):
        for timestamp in ("2026-09-01T00:00:00+09:99", "2026-09-01T00:00:00-01:60",
                          "2026-09-01T00:00:00+24:00", "2026-09-01T00:00:00+09:00:99"):
            with self.subTest(timestamp=timestamp):
                out = convert([row(**{"Order Date": timestamp})])
                self.assertEqual(out["summary"]["accepted"], 0)
                self.assertEqual(out["summary"]["needsReview"], 1)
                self.assertIsNone(out["orders"][0]["orderedOn"])
                self.assertIn("invalid_order_date", out["orders"][0]["lines"][0]["reasonCodes"])

    def test_valid_offsets_and_fractional_seconds(self):
        for timestamp, expected in (("2026-09-01T23:30:00.123456-03:00", "2026-09-02"),
                                    ("2026-09-01T00:30:00+09:00", "2026-09-01")):
            out = convert([row(**{"Order Date": timestamp})])
            self.assertEqual(out["summary"]["accepted"], 1)
            self.assertEqual(out["orders"][0]["orderedOn"], expected)

    def test_quantity_preserves_node_json_integer_precision(self):
        out = convert([row(**{"Original Quantity": str(2**53 - 1)})])
        self.assertEqual(out["orders"][0]["lines"][0]["quantity"], 2**53 - 1)
        for quantity in (str(2**53), "9" * 5000):
            out = convert([row(**{"Original Quantity": quantity})])
            self.assertEqual(out["summary"]["needsReview"], 1)
            self.assertIsNone(out["orders"][0]["lines"][0]["quantity"])
            self.assertIn("invalid_quantity", out["orders"][0]["lines"][0]["reasonCodes"])

    def test_multiple_products(self):
        out = convert([row(), row(ASIN="FAKE-SKU-B")])
        self.assertEqual(out["summary"]["accepted"], 2)
        self.assertEqual(len(out["orders"]), 1)

    def test_cancelled_does_not_cancel_other_line(self):
        out = convert([row(), row(ASIN="FAKE-SKU-B", **{"Order Status": "Cancelled",
                                "Original Quantity": "0", "Shipment Status": "Not Available"})])
        self.assertEqual(out["summary"]["excluded"], 1)
        self.assertEqual(out["orders"][0]["status"], "ordered")

    def test_zero_quantity_not_imputed(self):
        out = convert([row(**{"Original Quantity": "0"})])
        self.assertEqual(out["summary"]["needsReview"], 1)
        self.assertIsNone(out["orders"][0]["lines"][0]["quantity"])

    def test_unshipped_authorized_review(self):
        out = convert([row(**{"Order Status": "Authorized", "Shipment Status": "Paid"})])
        self.assertEqual(out["summary"]["needsReview"], 1)

    def test_return_does_not_guess_which_product(self):
        out = convert([row(), row(ASIN="FAKE-SKU-B")], returns=[{"Order ID": "FAKE-ORDER-A"}])
        self.assertEqual(out["summary"]["needsReview"], 2)
        self.assertTrue(all(not x["cycleEligibleAfterProductMatch"] for x in out["orders"][0]["lines"]))

    def test_refund_review(self):
        self.assertEqual(convert([row()], refunds=[{"Order ID": "FAKE-ORDER-A"}])["summary"]["needsReview"], 1)

    def test_replacement_excluded(self):
        out = convert([row()], replacements=[{"Order ID": "FAKE-ORIGINAL",
                                              "Replacement Order ID": "FAKE-ORDER-A"}])
        self.assertEqual(out["summary"]["excluded"], 1)
        self.assertEqual(out["orders"][0]["replacementOfOrderKeys"],
                         [identity("order", "amazon", "fixture-account", "FAKE-ORIGINAL")])

    def test_duplicate_asin_not_merged(self):
        out = convert([row(), row()])
        self.assertEqual(out["summary"]["needsReview"], 2)
        self.assertEqual(out["summary"]["lines"], 2)

    def test_inconsistent_dates_review_whole_order(self):
        out = convert([row(), row(ASIN="FAKE-SKU-B", **{"Order Date": "2026-09-08T00:00:00Z"})])
        self.assertEqual(out["summary"]["needsReview"], 2)
        self.assertIsNone(out["orders"][0]["orderedOn"])

    def test_invalid_quantity_date_and_currency(self):
        for changes in ({"Original Quantity": "NaN"}, {"Original Quantity": "1.5"},
                        {"Order Date": "2026-09-01"}, {"Currency": "USD"}, {"ASIN": ""}):
            self.assertEqual(convert([row(**changes)])["summary"]["needsReview"], 1)

    def test_repeat_and_reorder_keep_order_and_match_keys(self):
        a, b = row(), row(**{"Order ID": "FAKE-ORDER-B"})
        first, repeat = convert([a, b]), convert([b, a])
        for left, right in zip(first["orders"], repeat["orders"]):
            self.assertEqual(left["orderKey"], right["orderKey"])
            self.assertEqual(left["lines"][0]["lineMatchKey"], right["lines"][0]["lineMatchKey"])
        self.assertEqual(first["orders"][0]["orderKey"],
                         identity("order", "amazon", "fixture-account", "FAKE-ORDER-A"))
        # Source row refs may change, but hints never become final line IDs.
        self.assertNotIn("externalLineId", first["orders"][0]["lines"][0])

    def test_missing_related_files_fail_closed(self):
        out = normalize({HISTORY: [row()]}, {HISTORY: "synthetic-hash"}, "fixture-account")
        self.assertEqual(out["summary"]["needsReview"], 1)

    def test_missing_order_id_stops_import(self):
        with self.assertRaisesRegex(ImportErrorCode, "MISSING_ORDER_ID"):
            convert([row(**{"Order ID": ""})])

    def test_csv_quotes_bom_and_newlines(self):
        r = row(**{"Product Name": '架空,商品\n"詰替"'})
        buffer = io.StringIO()
        writer = csv.DictWriter(buffer, fieldnames=list(r))
        writer.writeheader()
        writer.writerow(r)
        self.assertEqual(decode_csv(("\ufeff" + buffer.getvalue()).encode(), HISTORY), [r])

    def test_bad_headers_width_and_numbers(self):
        for data in (b"x,x\n1,2\n", b"Order ID\n1\n"):
            with self.assertRaises(ImportErrorCode):
                decode_csv(data, HISTORY)
        for value in ("NaN", "Infinity", "-1", "1,2", "1e3"):
            with self.assertRaises(ValueError):
                number(value)

    def test_zip_only_reads_allowed_csvs_and_private_output(self):
        with tempfile.TemporaryDirectory() as d:
            archive, output = Path(d) / "export.zip", Path(d) / "out.json"
            buffer = io.StringIO()
            writer = csv.DictWriter(buffer, fieldnames=list(row()))
            writer.writeheader()
            writer.writerow(row())
            with ZipFile(archive, "w") as z:
                z.writestr(HISTORY, buffer.getvalue())
                z.writestr("../../evil.txt", "never extracted")
                z.writestr("Your Amazon Orders/Digital Content Orders.csv", "not parsed")
            tables, hashes = load_export(archive)
            self.assertEqual(set(tables), {HISTORY})
            self.assertEqual(len(hashes[HISTORY]), 64)
            write_private_json(output, convert([row()]))
            self.assertEqual(output.stat().st_mode & 0o777, 0o600)
            with self.assertRaises(FileExistsError):
                write_private_json(output, {})


if __name__ == "__main__":
    unittest.main()
