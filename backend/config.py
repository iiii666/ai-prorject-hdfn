import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env", override=False)


def model():
    return os.getenv("OPENAI_MODEL") or "gpt-4.1-mini"
