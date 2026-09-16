from fastapi import FastAPI, Query, BackgroundTasks, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import psycopg2
from psycopg2.extras import RealDictCursor
import os
import math
from pathlib import Path
from dotenv import load_dotenv
import subprocess

env_path = Path(__file__).resolve().parent / '.env'
load_dotenv(dotenv_path=env_path)

print("--- DEBUG ENV VARS ---")
print("pg_db:", os.getenv("pg_db"))
print("pg_user:", os.getenv("pg_user"))
print("pg_password exists?:", os.getenv("pg_password") is not None)
print("----------------------")

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/api/run-sync")
def run_sync_script(background_tasks: BackgroundTasks):
    background_tasks.add_task(subprocess.run, ["python", "sync_cache.py"])
    print("Running sync...")
    return {"status": "Sync triggered successfully!"}


@app.get("/orders")
def get_orders(page: int = Query(1, ge=1), limit: int = Query(15, ge=1)):
    offset = (page - 1) * limit
    
    try:
        conn = psycopg2.connect(
            dbname=os.getenv("pg_db"),
            user=os.getenv("pg_user"),
            password=os.getenv("pg_password"),
            host=os.getenv("pg_host", "localhost"),
            port=os.getenv("pg_port", "5432")
        )
        cursor = conn.cursor(cursor_factory=RealDictCursor)

       
        cursor.execute("""
            SELECT COUNT(*) FROM v_open_orders_fulfillable
            WHERE "OrderStatus" NOT IN ('Closed', 'Cancelled')
              AND CAST("ShipDate" AS DATE) < CURRENT_DATE;
        """)
        total_count = cursor.fetchone()['count']

        
        cursor.execute("""
            SELECT * FROM v_open_orders_fulfillable 
            WHERE "OrderStatus" NOT IN ('Closed', 'Cancelled')
              AND CAST("ShipDate" AS DATE) < CURRENT_DATE
            ORDER BY "ShipDate" ASC NULLS LAST, "orderNumber" ASC
            LIMIT %s OFFSET %s;
        """, (limit, offset))

        orders = cursor.fetchall()
        cursor.close()
        conn.close()

        total_pages = math.ceil(total_count / limit) if total_count > 0 else 1

        return {
            "data": orders,
            "total": total_count,
            "page": page,
            "totalPages": total_pages
        }

    except Exception as e:
        print("Error fetching orders:", e)
        raise HTTPException(status_code=500, detail="Internal server error")
