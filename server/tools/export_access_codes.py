import os
import sqlite3
from datetime import datetime


def ensure_directory(path: str) -> None:
    os.makedirs(path, exist_ok=True)


def get_db_connection(db_path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn


def export_access_codes(db_path: str, output_file: str) -> int:
    conn = get_db_connection(db_path)
    try:
        cur = conn.cursor()
        # Detect available columns
        cur.execute("PRAGMA table_info(users)")
        cols = {row[1] for row in cur.fetchall()}
        has_firstname = 'firstname' in cols
        has_lastname = 'lastname' in cols
        has_fullname = 'fullname' in cols
        has_country = 'country_code' in cols
        has_suffix = 'birthdate_suffix' in cols

        select_fields = ["id", "phone", "email", "birthdate", "access_code"]
        if has_country:
            select_fields.append("country_code")
        if has_suffix:
            select_fields.append("birthdate_suffix")
        if has_firstname:
            select_fields.append("firstname")
        if has_lastname:
            select_fields.append("lastname")
        if has_fullname:
            select_fields.append("fullname")

        order_by = []
        if has_lastname:
            order_by.append("lastname")
        if has_firstname:
            order_by.append("firstname")
        order_by.append("id")

        query = f"SELECT {', '.join(select_fields)} FROM users ORDER BY {', '.join(order_by)}"
        cur.execute(query)
        rows = cur.fetchall()
    finally:
        conn.close()

    ensure_directory(os.path.dirname(output_file))

    timestamp = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S UTC")
    lines = []
    lines.append(f"Exported: {timestamp}")
    lines.append("Columns: ID | Name | Phone | Email | Birthdate | Suffix | AccessCode")
    lines.append("-" * 88)

    for r in rows:
        # Name
        firstname = r['firstname'] if 'firstname' in r.keys() else ''
        lastname = r['lastname'] if 'lastname' in r.keys() else ''
        fullname_col = r['fullname'] if 'fullname' in r.keys() else ''
        if firstname or lastname:
            full_name = f"{lastname}, {firstname}".strip(', ')
        elif fullname_col:
            full_name = fullname_col
        else:
            full_name = ''

        # Phone with country code
        country_code = r['country_code'] if 'country_code' in r.keys() else ''
        phone_full = f"{country_code}{r['phone']}".strip()

        # Suffix
        suffix = r['birthdate_suffix'] if 'birthdate_suffix' in r.keys() else ''

        email = r['email'] if r['email'] is not None else ''
        birthdate = r['birthdate'] if r['birthdate'] is not None else ''
        access_code = r['access_code'] if r['access_code'] is not None else ''

        line = f"{r['id']:>4} | {full_name:<30} | {phone_full:<16} | {email:<24} | {birthdate:<12} | {str(suffix):<2} | {access_code}"
        lines.append(line)

    content = "\n".join(lines) + "\n"
    with open(output_file, "w", encoding="utf-8") as f:
        f.write(content)

    return len(rows)


if __name__ == "__main__":
    # Resolve project root relative to this script
    script_dir = os.path.dirname(os.path.abspath(__file__))
    server_dir = os.path.dirname(script_dir)  # server
    project_root = os.path.dirname(server_dir)

    db_path = os.path.join(server_dir, "database.db")
    output_dir = os.path.join(project_root, "admin")
    output_file = os.path.join(output_dir, "access_codes.txt")

    count = export_access_codes(db_path, output_file)
    print(f"Exported {count} users to {output_file}")


