import csv
import json
import re
from pathlib import Path

csv_path = Path("event_registration_users.csv")
json_path = Path("event_registration_users.json")

records = []
with csv_path.open(encoding="utf-8") as f:
    reader = csv.reader(f)
    header = next(reader, None)
    for row in reader:
        if not row:
            continue
        row = [item.strip() for item in row]
        if len(row) == 2:
            first, last_phone = row
            match = re.match(r"^([^+]*?)(\+?\d+)$", last_phone)
            if not match:
                raise ValueError(f"Cannot parse row: {row}")
            last = match.group(1).strip().rstrip(',')
            phone = match.group(2)
        else:
            first, last, phone = row[0], row[1], row[2]
        first = first.strip()
        last = last.strip()
        phone = phone.strip()
        if not (first or last or phone):
            continue
        digits = ''.join(ch for ch in phone if ch.isdigit())
        if digits.startswith('234') and len(digits) > 10:
            digits = digits[3:]
        if digits.startswith('0'):
            digits = digits[1:]
        normalized_phone = '+234' + digits
        records.append({
            "first_name": first,
            "last_name": last,
            "phone": normalized_phone
        })

json_path.write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"Updated {json_path} with {len(records)} records from CSV")
print("Sample records:")
for rec in records[:5]:
    print(rec)
