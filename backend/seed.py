import asyncio

from . import db


async def main():
    try:
        await db.connect()
        await db.initialize()
        print("MySQL DB 준비 완료", await db.one("SELECT * FROM seed_info"))
        print(
            "주문:", (await db.one("SELECT COUNT(*) count FROM orders"))["count"], "건"
        )
    finally:
        await db.close()


if __name__ == "__main__":
    asyncio.run(main())
