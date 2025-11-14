import csv
import json
import openpyxl
from pathlib import Path

wb = openpyxl.load_workbook("Event Registration Form.xlsx")
ws = wb.active
rows = list(ws.iter_rows(values_only=True))
if not rows:
    raise SystemExit("No data found in workbook")
header = rows[0]

column_map = {}
for idx, title in enumerate(header):
    if isinstance(title, str):
        normalized = title.strip().lower()
        column_map[normalized] = idx

try:
    first_idx = column_map["first name"]
    last_idx = column_map["last name (surname)"]
    phone_idx = column_map["phone number"]
except KeyError as exc:
    raise SystemExit(f"Missing expected column: {exc}")

records = []
for row in rows[1:]:
    if not row:
        continue
    first = (row[first_idx] or "").strip()
    last = (row[last_idx] or "").strip()
    phone_raw = str(row[phone_idx] or "").strip()
    if not (first or last or phone_raw):
        continue
    digits = "".join(ch for ch in phone_raw if ch.isdigit())
    if digits.startswith("234") and len(digits) > 10:
        digits = digits[3:]
    if digits.startswith("0"):
        digits = digits[1:]
    normalized_phone = "+234" + digits
    records.append({
        "first_name": first,
        "last_name": last,
        "phone": normalized_phone
    })

output_json = Path("event_registration_users.json")
output_csv = Path("event_registration_users.csv")

output_json.write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")

with output_csv.open("w", newline="", encoding="utf-8") as csv_file:
    writer = csv.writer(csv_file)
    writer.writerow(["first_name", "last_name", "phone"])
    for record in records:
        writer.writerow([record["first_name"], record["last_name"], record["phone"]])

print(f"Exported {len(records)} records to {output_json} and {output_csv}")
