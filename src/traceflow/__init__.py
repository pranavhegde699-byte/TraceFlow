import sys
from pathlib import Path

# Add project root to sys.path so traceflow is importable
_root = Path(__file__).resolve().parent.parent
if str(_root) not in sys.path:
    sys.path.insert(0, str(_root))

import traceflow
# Alias submodules
sys.modules[__name__] = traceflow
