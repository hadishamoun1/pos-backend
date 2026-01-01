#!/usr/bin/env python3
"""
CSV Import Script for MySQL Database
Imports CSV data into the history_prices table
"""

import csv
import mysql.connector
from datetime import datetime
import sys
import os

# ✅ Database Configuration
DB_CONFIG = {
    'host': 'localhost',
    'user': 'root',
    'password': '70631859HADI',
    'database': 'pos_v1',
    'port': 3306
}

# ✅ CSV File Path
CSV_FILE_PATH = 'Hadi-Export-PriceHistory - 2-last.csv'


def parse_date(date_str):
    """Parse date string to MySQL date format"""
    if not date_str or date_str.strip() == '':
        return None
    
    formats = ['%Y-%m-%d', '%d/%m/%Y', '%m/%d/%Y', '%Y/%m/%d']
    
    for fmt in formats:
        try:
            return datetime.strptime(date_str.strip(), fmt).strftime('%Y-%m-%d')
        except ValueError:
            continue
    
    print(f"Warning: Could not parse date '{date_str}', setting to NULL")
    return None


def parse_number(value):
    """Parse number, return None if empty or invalid"""
    if not value or value.strip() == '':
        return None
    try:
        return float(value.strip())
    except ValueError:
        print(f"Warning: Could not parse number '{value}', setting to NULL")
        return None


def parse_int(value):
    """Parse integer, return None if empty or invalid"""
    if not value or value.strip() == '':
        return None
    try:
        return int(float(value.strip()))
    except ValueError:
        print(f"Warning: Could not parse integer '{value}', setting to NULL")
        return None


def import_csv_to_db():
    """Main function to import CSV data to MySQL database"""
    
    if not os.path.exists(CSV_FILE_PATH):
        print(f"Error: CSV file '{CSV_FILE_PATH}' not found!")
        sys.exit(1)
    
    try:
        connection = mysql.connector.connect(**DB_CONFIG)
        cursor = connection.cursor()
        print("✅ Successfully connected to database")
    except mysql.connector.Error as err:
        print(f"❌ Error connecting to database: {err}")
        sys.exit(1)
    
    # ✅ FIXED: Use backticks OR rename table to history_prices
    insert_query = """
        INSERT INTO `history-prices` (
            customerName, itemNumber, invoiceDate, invoiceNbr,
            itemName, itemBrand, propertyCode, qty, qtyUnit,
            sheet, sqm, itemSalePrice, vat, length, width
        ) VALUES (
            %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
        )
    """
    
    try:
        # ✅ FIXED: utf-8-sig removes BOM character
        with open(CSV_FILE_PATH, 'r', encoding='utf-8-sig') as file:
            csv_reader = csv.DictReader(file)
            
            row_count = 0
            error_count = 0
            
            for row in csv_reader:
                try:
                    data = (
                        row.get('CustomerName', '').strip() or None,
                        row.get('ItemNumber', '').strip() or None,
                        parse_date(row.get('InvoiceDate', '')),
                        row.get('InvoiceNbr', '').strip() or None,
                        row.get('ItemName', '').strip() or None,
                        row.get('ItemBrand', '').strip() or None,
                        row.get('PropertyCode', '').strip() or None,
                        parse_number(row.get('Qty', '')),
                        row.get('QtyUnit', '').strip() or None,
                        parse_int(row.get('Sheet', '')),
                        parse_number(row.get('SQM', '')),
                        parse_number(row.get('ItemSalePrice', '')),
                        parse_number(row.get('VAT', '')),
                        parse_number(row.get('Length', '')),
                        parse_number(row.get('Width', ''))
                    )
                    
                    cursor.execute(insert_query, data)
                    row_count += 1
                    
                    if row_count % 100 == 0:
                        connection.commit()
                        print(f"✅ Imported {row_count} rows...")
                
                except Exception as e:
                    error_count += 1
                    print(f"❌ Error importing row {row_count + 1}: {e}")
                    if row_count < 5:  # Only print first few errors
                        print(f"   Row data: {row}")
            
            connection.commit()
            
            print("\n" + "="*50)
            print(f"✅ Import completed!")
            print(f"   Total rows imported: {row_count}")
            print(f"   Errors: {error_count}")
            print("="*50)
    
    except FileNotFoundError:
        print(f"❌ Error: CSV file '{CSV_FILE_PATH}' not found!")
    except csv.Error as e:
        print(f"❌ Error reading CSV file: {e}")
    except Exception as e:
        print(f"❌ Unexpected error: {e}")
    finally:
        if cursor:
            cursor.close()
        if connection:
            connection.close()
        print("🔌 Database connection closed")


if __name__ == "__main__":
    print("="*50)
    print("CSV Import Script for MySQL Database")
    print("="*50)
    print(f"CSV File: {CSV_FILE_PATH}")
    print(f"Database: {DB_CONFIG['database']}")
    print("="*50)
    
    confirm = input("\nProceed with import? (yes/no): ")
    
    if confirm.lower() in ['yes', 'y']:
        import_csv_to_db()
    else:
        print("Import cancelled.")