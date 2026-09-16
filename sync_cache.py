import pyodbc
import psycopg2
import os
import time
from pathlib import Path
from psycopg2.extras import execute_values
from dotenv import load_dotenv
from datetime import datetime, date

# Uses backend .env to load credentials, ODBC and postgres
env_path = Path(__file__).resolve().parent / '.env'
load_dotenv(dotenv_path=env_path)
dsn = os.getenv("Chempax_DSN")
user = os.getenv("Chempax_user")
pw = os.getenv("Chempax_pw")

# parse date
def safe_date(val):
    if not val:
        return None
    if isinstance(val, (datetime, date)):
        return val.strftime('%Y-%m-%d')
    try:
        # Handles string dates if returned as 'YYYY-MM-DD' or similar
        return str(val).strip()
    except Exception:
        return None

# Connect to Chempax with ODBC
live_conn = pyodbc.connect(f"DSN={dsn};UID={user};PWD={pw}", timeout=30)
live_cursor = live_conn.cursor()

# Postgres connection
pg_conn = psycopg2.connect(
    dbname=os.getenv("pg_db"),
    user=os.getenv("pg_user"),
    password=os.getenv("pg_password"),
    host=os.getenv("pg_host", "localhost"),
    port=os.getenv("pg_port", "5432")
)
pg_cursor = pg_conn.cursor()

try:
    start_time = time.perf_counter()
    
    # Pull open lines from Chempax
    odbc_query = """
        SELECT
            t."ORDER-NUM" AS OrderNum,
            t."SEQ-NUM" AS SeqNum,
            t."CUST-KEY" AS OrderCustKey,
            c."CUST-KEY" AS CustKey,
            c."CUST-NAME" AS CustName,
            t."PRODUCT-CODE" AS ProductCode,
            t."QUANTITY-ORDERED" AS QtyOrdered,
            t."SHIP-DATE" AS ShipDate,
            t."ORDER-STATUS" AS OrderStatus,
            t."GROSS-PRICE" AS GrossPrice,
            t."PRODUCT-KEY" AS ProductKey,
            p."Product-name" AS ProductName,
            pkg."OLD-PRODUCT-NUMBER" AS OldProductNumber,
            pkg."OH-PACKAGES" AS OnHandPKG,
            h."DELIVERY-TYPE" AS DeliveryType
        FROM PUB."ORDER-TRL" t
        LEFT OUTER JOIN PUB."ORDER-HDR" h
            ON t."ORDER-NUM" = h."ORDER-NUM"
        LEFT OUTER JOIN PUB."CUST" c
            ON t."CUST-KEY" = c."CUST-KEY"
        LEFT OUTER JOIN PUB."PRODUCT" p
            ON t."PRODUCT-KEY" = p."Product-key"
        LEFT OUTER JOIN PUB."PROD-PKG" pkg
            ON t."PRODUCT-KEY" = pkg."PRODUCT-KEY"
           AND t."PACKAGING-KEY" = pkg."PACKAGING-KEY"
        WHERE t."ORDER-NUM" IS NOT NULL
          AND t."ORDER-STATUS" NOT IN ('Closed', 'Cancelled')
    """
    live_cursor.execute(odbc_query)
    rows = live_cursor.fetchall()

    records = []
    for row in rows:
        records.append((
            int(row[0]),                  # orderNumber
            int(row[1]),                  # SeqNum
            str(row[2] or '').strip(),    # OrderCustKey
            str(row[3] or '').strip(),    # CustKey
            str(row[4] or '').strip(),    # CustName
            str(row[5] or '').strip(),    # ProductCode
            int(row[6] or 0),             # QtyOrdered
            safe_date(row[7]),            # ShipDate
            str(row[8] or '').strip(),    # OrderStatus
            int(row[9] or 0),             # GrossPrice
            str(row[10] or '').strip(),   # ProductKey
            str(row[11] or '').strip(),   # ProductName
            str(row[12] or '').strip(),   # OldProductNumber
            int(row[13] or 0),            # OnHandPKG
            str(row[14] or '').strip()    # DeliveryType
        ))

    # Checks to make sure extra columns exist before making changes
    pg_cursor.execute("""
        ALTER TABLE orders 
        ADD COLUMN IF NOT EXISTS "AllocatedQty" NUMERIC DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "QtyAvailable" NUMERIC DEFAULT 0;
    """)

    # Used to clear out orders once they close
    pg_cursor.execute('TRUNCATE TABLE orders;')

    # Insert new records into table
    insert_query = """
        INSERT INTO orders (
            "orderNumber", 
            "SeqNum", 
            "OrderCustKey", 
            "CustKey", 
            "CustName", 
            "ProductCode", 
            "QtyOrdered", 
            "ShipDate", 
            "OrderStatus", 
            "GrossPrice", 
            "ProductKey", 
            "ProductName", 
            "OldProductNumber",
            "OnHandPKG",
            "DeliveryType"
        )
        VALUES %s;
    """
    execute_values(pg_cursor, insert_query, records, page_size=10000)

    # Calculates stock allocation
    allocation_query = """
        WITH ProductAllocations AS (
            SELECT 
                "OldProductNumber",
                SUM(COALESCE("QtyOrdered", 0)) AS total_allocated
            FROM orders
            WHERE COALESCE("OrderStatus", '') NOT IN ('Closed', 'Cancelled')
            GROUP BY "OldProductNumber"
        )
        UPDATE orders o
        SET 
            "AllocatedQty" = pa.total_allocated,
            "QtyAvailable" = GREATEST(0, COALESCE(o."OnHandPKG", 0) - pa.total_allocated)
        FROM ProductAllocations pa
        WHERE o."OldProductNumber" = pa."OldProductNumber"
          AND COALESCE(o."OrderStatus", '') NOT IN ('Closed', 'Cancelled');
    """
    pg_cursor.execute(allocation_query)

    # Reconfigure table to consider partial and regular orders
    view_query = """
        CREATE OR REPLACE VIEW v_open_orders_fulfillable AS
        WITH RegularOrderShortages AS (
            SELECT DISTINCT "orderNumber"
            FROM orders
            WHERE COALESCE("OrderStatus", '') NOT IN ('Closed', 'Cancelled')
              AND LOWER(TRIM(COALESCE("DeliveryType", ''))) != 'partial'
              AND COALESCE("QtyAvailable", 0) < COALESCE("QtyOrdered", 0)
        )
        SELECT o.*
        FROM orders o
        LEFT JOIN RegularOrderShortages ros ON o."orderNumber" = ros."orderNumber"
        WHERE COALESCE(o."OrderStatus", '') NOT IN ('Closed', 'Cancelled')
          AND ros."orderNumber" IS NULL
          AND NOT (
            LOWER(TRIM(COALESCE(o."DeliveryType", ''))) = 'partial' 
            AND COALESCE(o."QtyAvailable", 0) < COALESCE(o."QtyOrdered", 0)
          );
    """
    pg_cursor.execute(view_query)

    # Commit the transaction
    pg_conn.commit()
    
    end_time = time.perf_counter()
    elapsed_seconds = round(end_time - start_time, 2)
    
    print(f"Successfully cached {len(records):,} records into PostgreSQL in {elapsed_seconds} seconds.")

except Exception as e:
    pg_conn.rollback()
    print("Error syncing cache:", e)

finally:
    live_cursor.close()
    live_conn.close()
    pg_cursor.close()
    pg_conn.close()