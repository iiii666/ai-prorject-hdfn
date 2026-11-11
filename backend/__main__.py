import os

import uvicorn

from . import config  # noqa: F401 -- load .env before selecting the port

if __name__ == "__main__":
    uvicorn.run(
        "backend.app:app",
        host="127.0.0.1",
        port=int(os.getenv("PORT", "3001")),
        workers=1,
    )
