"""Offline Amazon export normalizer. No network or database writes (Python 3.11+)."""
import argparse
import csv
import hashlib
import io
import json
import os
import re
from collections import Counter, defaultdict
from datetime import datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from zoneinfo import ZoneInfo
from zipfile import ZipFile, BadZipFile

VERSION = "amazon-csv-v1"
HISTORY = "Your Amazon Orders/Order History.csv"
REFUNDS = "Your Returns & Refunds/Refund Details.csv"
RETURNS = "Your Returns & Refunds/Returns Status.csv"
REPLACEMENTS = "Your Returns & Refunds/Replacement Orders.csv"
FILES = (HISTORY, REFUNDS, RETURNS, REPLACEMENTS)
REQUIRED = {
    HISTORY: {"Order ID", "ASIN", "Order Date", "Product Name", "Original Quantity",
              "Currency", "Order Status", "Shipment Status"},
    REFUNDS: {"Order ID"}, RETURNS: {"Order ID"},
    REPLACEMENTS: {"Order ID", "Replacement Order ID"},
}
MAX_FILE_BYTES = 16 * 1024 * 1024


class ImportErrorCode(ValueError):
    """Errors contain only fixed codes, never CSV values."""


def identity(*parts):
    data = json.dumps(["v1", *parts], ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(data.encode("utf-8")).hexdigest()


def text(value):
    value = (value or "").strip()
    return None if value in ("", "Not Available", "Not Applicable") else value


def number(value):
    value = text(value)
    if value is None:
        return None
    # Amazon's export uses comma grouping; reject malformed grouping/NaN/Infinity.
    if not re.fullmatch(r"(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?", value):
        raise ValueError("INVALID_NUMBER")
    try:
        result = Decimal(value.replace(",", ""))
    except InvalidOperation:
        raise ValueError("INVALID_NUMBER") from None
    if not result.is_finite() or result < 0:
        raise ValueError("INVALID_NUMBER")
    return result


def decode_csv(data, name):
    try:
        reader = csv.DictReader(io.StringIO(data.decode("utf-8-sig")), strict=True)
        headers = reader.fieldnames or []
        if len(headers) != len(set(headers)) or not REQUIRED[name].issubset(headers):
            raise ImportErrorCode("INVALID_HEADERS")
        rows = list(reader)
        if any(None in row or any(v is None for v in row.values()) for row in rows):
            raise ImportErrorCode("INVALID_ROW_WIDTH")
        return rows
    except (UnicodeError, csv.Error):
        raise ImportErrorCode("INVALID_CSV") from None


def load_export(path):
    """Read only four CSVs; never extract PDFs/photos or arbitrary ZIP paths."""
    blobs = {}
    if path.is_dir():
        for name in FILES:
            p = path / name
            if p.exists():
                if p.stat().st_size > MAX_FILE_BYTES:
                    raise ImportErrorCode("FILE_TOO_LARGE")
                blobs[name] = p.read_bytes()
    else:
        with ZipFile(path) as archive:
            for name in FILES:
                entries = [x for x in archive.infolist() if x.filename == name]
                if len(entries) > 1:
                    raise ImportErrorCode("DUPLICATE_ZIP_ENTRY")
                if entries:
                    if entries[0].file_size > MAX_FILE_BYTES:
                        raise ImportErrorCode("FILE_TOO_LARGE")
                    blobs[name] = archive.read(entries[0])
    if HISTORY not in blobs:
        raise ImportErrorCode("MISSING_ORDER_HISTORY")
    tables = {n: decode_csv(b, n) for n, b in blobs.items()}
    hashes = {n: hashlib.sha256(b).hexdigest() for n, b in blobs.items()}
    return tables, hashes


def normalize(tables, hashes, account_key):
    """Return import proposals, NOT Firestore documents or authoritative stock."""
    if not account_key or not account_key.strip():
        raise ImportErrorCode("MISSING_ACCOUNT_KEY")
    rows = tables[HISTORY]
    if any(not text(r.get("Order ID")) for r in rows):
        raise ImportErrorCode("MISSING_ORDER_ID")
    if any(not text(r.get("Order ID")) for n in (RETURNS, REFUNDS)
           for r in tables.get(n, [])):
        raise ImportErrorCode("INVALID_RETURN_LINK")
    return_orders = {text(r.get("Order ID")) for n in (RETURNS, REFUNDS)
                     for r in tables.get(n, [])}
    replacements = defaultdict(set)
    for r in tables.get(REPLACEMENTS, []):
        original, replacement = text(r.get("Order ID")), text(r.get("Replacement Order ID"))
        if not original or not replacement:
            raise ImportErrorCode("INVALID_REPLACEMENT_LINK")
        replacements[replacement].add(original)
    missing_related = [n for n in (REFUNDS, RETURNS, REPLACEMENTS) if n not in tables]
    source_id = identity("amazon_csv", account_key, hashes[HISTORY])
    groups = defaultdict(list)
    for row_number, row in enumerate(rows, 2):
        groups[text(row["Order ID"])].append((row_number, row))
    orders, all_lines = [], []
    for external_id, group in sorted(groups.items()):
        order_key = identity("order", "amazon", account_key, external_id)
        sku_counts = Counter(text(r["ASIN"]) for _, r in group)
        dates, order_lines = set(), []
        for row_number, row in group:
            reasons = []
            asin, name = text(row["ASIN"]), text(row["Product Name"])
            ordered_on, original_timestamp = None, text(row["Order Date"])
            try:
                dt = datetime.fromisoformat(original_timestamp.replace("Z", "+00:00"))
                if dt.tzinfo is None or dt.utcoffset() is None:
                    raise ValueError()
                ordered_on = dt.astimezone(ZoneInfo("Asia/Tokyo")).date().isoformat()
                dates.add(ordered_on)
            except (ValueError, AttributeError, OverflowError):
                reasons.append("invalid_order_date")
            try:
                q = number(row["Original Quantity"])
                if q is None or q != q.to_integral_value():
                    raise ValueError()
                quantity = int(q) if q > 0 else None
                if q == 0:
                    reasons.append("zero_quantity")
            except ValueError:
                quantity = None
                reasons.append("invalid_quantity")
            if not asin or not name:
                reasons.append("missing_product")
            if sku_counts[asin] > 1:
                reasons.append("ambiguous_same_asin_rows")
            if missing_related:
                reasons.append("missing_return_or_replacement_files")
            if external_id in return_orders:
                reasons.append("return_or_refund_requires_review")
            if external_id in replacements:
                reasons.append("replacement_not_purchase")
            raw_status, shipment = row["Order Status"], row["Shipment Status"]
            status = "unknown"
            if raw_status == "Cancelled":
                status = "cancelled"
                reasons.append("cancelled")
            elif raw_status == "Closed" and shipment == "Shipped" and quantity:
                status = "ordered"
            else:
                reasons.append("unconfirmed_order_or_shipment")
            currency = text(row["Currency"])
            # Price field semantics vary in this export. Keep amount unknown; never
            # copy order totals or multiply unit price into a fabricated line amount.
            if currency != "JPY":
                reasons.append("unsupported_currency")
                currency = None
            excluded = raw_status == "Cancelled" or external_id in replacements
            disposition = "excluded" if excluded else ("needs_review" if reasons else "accepted")
            if disposition != "accepted" and status != "cancelled":
                status = "unknown"
            line = {
                "sourceLineRef": f"{HISTORY}:row:{row_number}",
                "orderKey": order_key, "sourceId": source_id,
                "orderedOn": ordered_on, "rawProductName": name,
                "quantity": quantity, "amountMinor": None, "currency": currency,
                "status": status, "disposition": disposition,
                "reasonCodes": sorted(set(reasons)),
                "warnings": ["price_semantics_unverified"],
                "productId": None, "matchMethod": "unmatched",
                "identifiers": {"merchantSku": f"amazon:{account_key}:{asin}"} if asin else {},
                # A matching hint, never an externalLineId or a final document ID.
                "lineMatchKey": identity("amazon_csv_line_hint", order_key, asin) if asin else None,
                "fieldOrigins": {k: {"kind": "source", "sourceId": source_id}
                                 for k in ("rawProductName", "quantity", "currency", "status")},
                "orderDateEvidence": original_timestamp if ordered_on else None,
                "cycleEligibleAfterProductMatch": disposition == "accepted",
            }
            order_lines.append(line)
        if len(dates) != 1 or any(x["orderedOn"] is None for x in order_lines):
            for line in order_lines:
                line["reasonCodes"] = sorted(set(line["reasonCodes"] + ["inconsistent_order_dates"]))
                if line["disposition"] == "accepted":
                    line.update(disposition="needs_review", status="unknown",
                                cycleEligibleAfterProductMatch=False)
        # A cancelled line must not cancel other products in the same order.
        statuses = {x["status"] for x in order_lines}
        order_status = "cancelled" if statuses == {"cancelled"} else (
            "ordered" if "ordered" in statuses else "unknown")
        orders.append({
            "orderKey": order_key, "merchant": "amazon", "merchantAccountKey": account_key,
            "externalOrderId": external_id, "orderedOn": next(iter(dates)) if len(dates) == 1 else None,
            "dateTimezone": "Asia/Tokyo", "orderDateBasis": "csv_order_date",
            "sourceId": source_id, "identityStatus": "confirmed", "status": order_status,
            "fieldOrigins": {"orderedOn": {"kind": "source", "sourceId": source_id}},
            "replacementOfOrderKeys": sorted(identity("order", "amazon", account_key, x)
                                             for x in replacements.get(external_id, set())),
            "lines": order_lines,
        })
        all_lines.extend(order_lines)
    dispositions = Counter(x["disposition"] for x in all_lines)
    reason_counts = Counter(r for x in all_lines for r in x["reasonCodes"])
    known_orders = set(groups)
    summary = {
        "orders": len(orders), "lines": len(all_lines),
        "accepted": dispositions["accepted"], "excluded": dispositions["excluded"],
        "needsReview": dispositions["needs_review"],
        "reasonCounts": dict(sorted(reason_counts.items())),
        "unknownPrices": len(all_lines), "missingRelatedFiles": missing_related,
        "orphanReturnOrderCount": len(return_orders - known_orders - {None}),
        "replacementLinks": sum(len(v) for v in replacements.values()),
        "orphanReplacementOrderCount": len(set(replacements) - known_orders),
    }
    return {"contractVersion": VERSION, "summary": summary,
            "importBatchKey": identity("amazon_csv_batch", account_key,
                                       sorted(hashes.items())),
            "source": {"provider": "amazon_csv", "accountKey": account_key,
                       "sourceId": source_id, "fileHashes": hashes,
                       "extractionVersion": VERSION}, "orders": orders}


def write_private_json(path, result):
    # Explicit opt-in, refuse overwrite. Output contains private purchase history.
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as out:
        json.dump(result, out, ensure_ascii=False, indent=2, allow_nan=False)
        out.write("\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="Amazon ZIP or extracted export directory")
    parser.add_argument("--account-key", required=True, help="Internal merchant account UUID (not email)")
    parser.add_argument("--output", type=Path, help="Optional PRIVATE normalized JSON; never commit")
    args = parser.parse_args()
    try:
        tables, hashes = load_export(args.input)
        result = normalize(tables, hashes, args.account_key)
        if args.output:
            write_private_json(args.output, result)
        print(json.dumps(result["summary"], ensure_ascii=False, indent=2))
    except ImportErrorCode as e:
        parser.exit(2, f"{e}\n")
    except (OSError, BadZipFile, RuntimeError, ValueError):
        parser.exit(2, "IMPORT_IO_OR_FORMAT_ERROR\n")


if __name__ == "__main__":
    main()
