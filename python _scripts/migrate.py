import csv
import mysql.connector

# Database connection
db_connection = mysql.connector.connect(
    host="localhost",
    user="root",
    password="70631859HADI",
    database="pos_system_db"
)
cursor = db_connection.cursor()

# Path to your CSV file
csv_file_path = 'accounts.csv'

# Read the CSV file and handle BOM
with open(csv_file_path, mode='r', encoding='utf-8-sig') as csvfile:
    reader = csv.DictReader(csvfile)
    for row in reader:
        try:
            # Strip keys to remove hidden BOM and handle nulls
            row = {key.strip(): value.strip() if value else None for key, value in row.items()}

            account_number = row.get('Account Number')
            account_name = row.get('Account Name')
            parent_account_number = row.get('Parent Account Number')

            # Skip rows with missing account numbers
            if not account_number:
                print(f"Skipped invalid row: {row}")
                continue

            # Insert into database
            insert_query = """
            INSERT INTO accounts (accountNumber, accountName, parentNumber)
            VALUES (%s, %s, %s)
            """
            cursor.execute(insert_query, (account_number, account_name, parent_account_number))
            db_connection.commit()
            print(f"Successfully inserted row: {row}")

        except mysql.connector.Error as e:
            print(f"Failed row: {row}, Error: {e}")
        except Exception as e:
            print(f"Unexpected error for row: {row}, Error: {e}")

# Close the database connection
cursor.close()
db_connection.close()
