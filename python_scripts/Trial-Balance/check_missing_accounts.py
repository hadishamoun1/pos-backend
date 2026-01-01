"""
Check Missing Accounts - Generate Report with Fuzzy Matching
"""

import mysql.connector
import csv

DB_CONFIG = {
    'host': 'localhost',
    'port': 3306,
    'database': 'pos_v3',
    'user': 'root',
    'password': '70631859HADI'
}

CSV_FILE_PATH = 'last-trial.csv'

def extract_account_number(account_number_with_prefix):
    parts = account_number_with_prefix.split('-')
    return parts[1].strip() if len(parts) > 1 else account_number_with_prefix.strip()

def find_supplier_fuzzy(cursor, account_description):
    """Try multiple matching strategies for suppliers"""
    clean_name = account_description.strip()
    
    # Strategy 1: Exact match on supplierName
    cursor.execute("""
        SELECT id, supplierName, firstName FROM suppliers 
        WHERE TRIM(LOWER(supplierName)) = TRIM(LOWER(%s))
        LIMIT 1
    """, (clean_name,))
    result = cursor.fetchone()
    if result:
        return ('exact_name', result)
    
    # Strategy 2: Partial match on supplierName (either way)
    cursor.execute("""
        SELECT id, supplierName, firstName FROM suppliers 
        WHERE TRIM(LOWER(supplierName)) LIKE CONCAT('%%', TRIM(LOWER(%s)), '%%')
        OR TRIM(LOWER(%s)) LIKE CONCAT('%%', TRIM(LOWER(supplierName)), '%%')
        LIMIT 1
    """, (clean_name, clean_name))
    result = cursor.fetchone()
    if result:
        return ('partial_name', result)
    
    # Strategy 3: Match on firstName
    cursor.execute("""
        SELECT id, supplierName, firstName FROM suppliers 
        WHERE firstName IS NOT NULL 
        AND (TRIM(LOWER(firstName)) LIKE CONCAT('%%', TRIM(LOWER(%s)), '%%')
        OR TRIM(LOWER(%s)) LIKE CONCAT('%%', TRIM(LOWER(firstName)), '%%'))
        LIMIT 1
    """, (clean_name, clean_name))
    result = cursor.fetchone()
    if result:
        return ('first_name', result)
    
    # Strategy 4: Match on combined firstName + supplierName
    cursor.execute("""
        SELECT id, supplierName, firstName FROM suppliers 
        WHERE TRIM(LOWER(CONCAT(IFNULL(firstName, ''), ' ', supplierName))) LIKE CONCAT('%%', TRIM(LOWER(%s)), '%%')
        OR TRIM(LOWER(%s)) LIKE CONCAT('%%', TRIM(LOWER(CONCAT(IFNULL(firstName, ''), ' ', supplierName))), '%%')
        LIMIT 1
    """, (clean_name, clean_name))
    result = cursor.fetchone()
    if result:
        return ('combined', result)
    
    return (None, None)

def find_customer_fuzzy(cursor, account_description):
    """Try multiple matching strategies for customers"""
    clean_name = account_description.strip()
    
    # Strategy 1: Exact match on customerName
    cursor.execute("""
        SELECT id, customerName, firstName FROM customers 
        WHERE TRIM(LOWER(customerName)) = TRIM(LOWER(%s))
        LIMIT 1
    """, (clean_name,))
    result = cursor.fetchone()
    if result:
        return ('exact_name', result)
    
    # Strategy 2: Partial match on customerName (either way)
    cursor.execute("""
        SELECT id, customerName, firstName FROM customers 
        WHERE TRIM(LOWER(customerName)) LIKE CONCAT('%%', TRIM(LOWER(%s)), '%%')
        OR TRIM(LOWER(%s)) LIKE CONCAT('%%', TRIM(LOWER(customerName)), '%%')
        LIMIT 1
    """, (clean_name, clean_name))
    result = cursor.fetchone()
    if result:
        return ('partial_name', result)
    
    # Strategy 3: Match on firstName
    cursor.execute("""
        SELECT id, customerName, firstName FROM customers 
        WHERE firstName IS NOT NULL 
        AND (TRIM(LOWER(firstName)) LIKE CONCAT('%%', TRIM(LOWER(%s)), '%%')
        OR TRIM(LOWER(%s)) LIKE CONCAT('%%', TRIM(LOWER(firstName)), '%%'))
        LIMIT 1
    """, (clean_name, clean_name))
    result = cursor.fetchone()
    if result:
        return ('first_name', result)
    
    # Strategy 4: Match on combined firstName + customerName
    cursor.execute("""
        SELECT id, customerName, firstName FROM customers 
        WHERE TRIM(LOWER(CONCAT(IFNULL(firstName, ''), ' ', customerName))) LIKE CONCAT('%%', TRIM(LOWER(%s)), '%%')
        OR TRIM(LOWER(%s)) LIKE CONCAT('%%', TRIM(LOWER(CONCAT(IFNULL(firstName, ''), ' ', customerName))), '%%')
        LIMIT 1
    """, (clean_name, clean_name))
    result = cursor.fetchone()
    if result:
        return ('combined', result)
    
    return (None, None)

def check_missing_accounts():
    print("=" * 80)
    print("CHECKING MISSING ACCOUNTS WITH FUZZY MATCHING")
    print("=" * 80)
    
    conn = mysql.connector.connect(**DB_CONFIG)
    cursor = conn.cursor()
    
    try:
        # Read CSV
        with open(CSV_FILE_PATH, 'r', encoding='utf-8') as file:
            csv_reader = csv.DictReader(file)
            rows = list(csv_reader)
        
        print(f"✓ Read {len(rows)} rows from CSV\n")
        
        missing_suppliers = []
        missing_customers = []
        missing_accounts = []
        found_suppliers = []
        found_customers = []
        
        for idx, row in enumerate(rows, start=1):
            account_number_full = row['AccountNumber'].strip()
            account_number = extract_account_number(account_number_full)
            account_description = row['AccountDescription'].strip()
            main_account = row['MainAccount'].strip()
            
            if main_account == '401':
                # Check supplier with fuzzy matching
                match_type, result = find_supplier_fuzzy(cursor, account_description)
                
                if result:
                    found_suppliers.append({
                        'row': idx,
                        'accountNumber': account_number,
                        'csvName': account_description,
                        'dbName': result[1],
                        'dbFirstName': result[2],
                        'matchType': match_type
                    })
                else:
                    missing_suppliers.append({
                        'row': idx,
                        'accountNumber': account_number,
                        'name': account_description
                    })
            
            elif main_account == '411':
                # Check customer with fuzzy matching
                match_type, result = find_customer_fuzzy(cursor, account_description)
                
                if result:
                    found_customers.append({
                        'row': idx,
                        'accountNumber': account_number,
                        'csvName': account_description,
                        'dbName': result[1],
                        'dbFirstName': result[2],
                        'matchType': match_type
                    })
                else:
                    missing_customers.append({
                        'row': idx,
                        'accountNumber': account_number,
                        'name': account_description
                    })
            
            else:
                # Check account
                cursor.execute("""
                    SELECT id FROM accounts WHERE accountNumber = %s LIMIT 1
                """, (account_number,))
                
                if not cursor.fetchone():
                    missing_accounts.append({
                        'row': idx,
                        'accountNumber': account_number,
                        'name': account_description
                    })
        
        # Print report
        print("\n" + "=" * 80)
        print("FUZZY MATCHING RESULTS")
        print("=" * 80)
        
        print(f"\n✅ FOUND SUPPLIERS WITH FUZZY MATCHING ({len(found_suppliers)}):")
        print("-" * 80)
        match_types = {}
        for s in found_suppliers[:10]:
            match_type = s['matchType']
            match_types[match_type] = match_types.get(match_type, 0) + 1
            print(f"  Row {s['row']:4d} | {s['accountNumber']:15s}")
            print(f"    CSV: {s['csvName']}")
            print(f"    DB:  {s['dbFirstName'] or ''} {s['dbName']}")
            print(f"    Match: {match_type}")
            print()
        
        if len(found_suppliers) > 10:
            print(f"  ... and {len(found_suppliers) - 10} more")
        
        print(f"\n✅ FOUND CUSTOMERS WITH FUZZY MATCHING ({len(found_customers)}):")
        print("-" * 80)
        for c in found_customers[:10]:
            match_type = c['matchType']
            match_types[match_type] = match_types.get(match_type, 0) + 1
            print(f"  Row {c['row']:4d} | {c['accountNumber']:15s}")
            print(f"    CSV: {c['csvName']}")
            print(f"    DB:  {c['dbFirstName'] or ''} {c['dbName']}")
            print(f"    Match: {match_type}")
            print()
        
        if len(found_customers) > 10:
            print(f"  ... and {len(found_customers) - 10} more")
        
        print("\nMatch Type Breakdown:")
        for match_type, count in match_types.items():
            print(f"  {match_type}: {count}")
        
        # Print missing accounts
        if missing_suppliers:
            print(f"\n❌ STILL MISSING SUPPLIERS ({len(missing_suppliers)}):")
            print("-" * 80)
            for s in missing_suppliers[:20]:
                print(f"  Row {s['row']:4d} | {s['accountNumber']:15s} | {s['name']}")
            if len(missing_suppliers) > 20:
                print(f"  ... and {len(missing_suppliers) - 20} more")
        
        if missing_customers:
            print(f"\n❌ STILL MISSING CUSTOMERS ({len(missing_customers)}):")
            print("-" * 80)
            for c in missing_customers[:20]:
                print(f"  Row {c['row']:4d} | {c['accountNumber']:15s} | {c['name']}")
            if len(missing_customers) > 20:
                print(f"  ... and {len(missing_customers) - 20} more")
        
        if missing_accounts:
            print(f"\n❌ MISSING ACCOUNTS ({len(missing_accounts)}):")
            print("-" * 80)
            for a in missing_accounts[:20]:
                print(f"  Row {a['row']:4d} | {a['accountNumber']:15s} | {a['name']}")
            if len(missing_accounts) > 20:
                print(f"  ... and {len(missing_accounts) - 20} more")
        
        print("\n" + "=" * 80)
        print("SUMMARY")
        print("=" * 80)
        print(f"Total CSV rows: {len(rows)}")
        print(f"Found suppliers (fuzzy): {len(found_suppliers)}")
        print(f"Found customers (fuzzy): {len(found_customers)}")
        print(f"Still missing suppliers: {len(missing_suppliers)}")
        print(f"Still missing customers: {len(missing_customers)}")
        print(f"Missing accounts: {len(missing_accounts)}")
        print(f"TOTAL STILL MISSING: {len(missing_suppliers) + len(missing_customers) + len(missing_accounts)}")
        print("=" * 80)
        
        # Save to file
        with open('fuzzy_match_report.txt', 'w', encoding='utf-8') as f:
            f.write("FOUND SUPPLIERS (FUZZY MATCH)\n")
            f.write("=" * 80 + "\n")
            for s in found_suppliers:
                f.write(f"Row {s['row']} | {s['accountNumber']} | Match: {s['matchType']}\n")
                f.write(f"  CSV: {s['csvName']}\n")
                f.write(f"  DB:  {s['dbFirstName'] or ''} {s['dbName']}\n\n")
            
            f.write("\n\nFOUND CUSTOMERS (FUZZY MATCH)\n")
            f.write("=" * 80 + "\n")
            for c in found_customers:
                f.write(f"Row {c['row']} | {c['accountNumber']} | Match: {c['matchType']}\n")
                f.write(f"  CSV: {c['csvName']}\n")
                f.write(f"  DB:  {c['dbFirstName'] or ''} {c['dbName']}\n\n")
            
            f.write("\n\nSTILL MISSING SUPPLIERS\n")
            f.write("=" * 80 + "\n")
            for s in missing_suppliers:
                f.write(f"Row {s['row']} | {s['accountNumber']} | {s['name']}\n")
            
            f.write("\n\nSTILL MISSING CUSTOMERS\n")
            f.write("=" * 80 + "\n")
            for c in missing_customers:
                f.write(f"Row {c['row']} | {c['accountNumber']} | {c['name']}\n")
            
            f.write("\n\nMISSING ACCOUNTS\n")
            f.write("=" * 80 + "\n")
            for a in missing_accounts:
                f.write(f"Row {a['row']} | {a['accountNumber']} | {a['name']}\n")
        
        print("\n✓ Report saved to: fuzzy_match_report.txt")
        
    finally:
        cursor.close()
        conn.close()

if __name__ == '__main__':
    check_missing_accounts()