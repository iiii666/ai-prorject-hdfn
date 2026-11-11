# Compatibility entry point: the former analysis-app builder was replaced by the investigation workspace.
from runpy import run_path
from pathlib import Path
run_path(str(Path(__file__).with_name('investigation_browser_smoke.py')),run_name='__main__')
