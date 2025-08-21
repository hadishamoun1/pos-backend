import csv
import mysql.connector

# Database connection
db_connection = mysql.connector.connect(
    host="localhost",
    user="root",
    password="70631859HADI",
    database="new_schema"
)
cursor = db_connection.cursor()

# Path to your CSV file
csv_file_path = 'accounts.csv'

# Read the CSV file and handle BOM
with open(csv_file_path, mode='r', encoding='utf-8-sig') as csvfile:
    reader = csv.DictReader(csvfile)
    for row in reader:
        try:
            # Clean up the row keys and values
            row = {key.strip(): value.strip() if value else None for key, value in row.items()}

            account_number = row.get('Account Number')
            account_name = row.get('Account name')
            parent_account_number = row.get('Parent Account Number')
            arabic_account_name = row.get('Arabic Account Name')

            # Validate that accountName is not null
            if not account_name:
                print(f"Skipped row due to missing account name: {row}")
                continue

            # Log the row being inserted
            print(f"Processing row: {row}")

            # Insert into database
            insert_query = """
            INSERT INTO accounts (accountNumber, accountName, parentNumber, arabicAccountName)
            VALUES (%s, %s, %s, %s)
            """
            print(f"Executing query: {insert_query} with values ({account_number}, {account_name}, {parent_account_number}, {arabic_account_name})")

            cursor.execute(insert_query, (account_number, account_name, parent_account_number, arabic_account_name))
            db_connection.commit()
            print(f"Successfully inserted row: {row}")

        except mysql.connector.Error as e:
            print(f"Failed row: {row}, Error: {e}")
        except Exception as e:
            print(f"Unexpected error for row: {row}, Error: {e}")

# Close the database connection
cursor.close()
db_connection.close()
