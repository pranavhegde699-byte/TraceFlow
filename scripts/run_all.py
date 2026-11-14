"""
run_all.py — Master pipeline runner for TraceFlow AML.
Default behavior: runs the existing pipeline (unchanged).
With --with-learning: also initializes the learning loop (empty case store + registry).
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

# Add project root to path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("run_all")


def init_learning():
    """Create the empty case store, model registry, and required directories."""
    from traceflow.learning.case_store import CaseStore, CASE_STORE_PATH, CASE_STORE_LOG_PATH
    from traceflow.learning.retrain import (
        get_model_registry,
        VERSIONS_DIR,
        FEATURES_PATH,
        SCORES_PATH,
        DATA_DIR,
    )

    logger.info("Initializing learning loop infrastructure...")

    # Create data dir
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    VERSIONS_DIR.mkdir(parents=True, exist_ok=True)

    # Create empty case store if it doesn't exist
    if not CASE_STORE_PATH.exists():
        import polars as pl
        from traceflow.learning.case_store import SCHEMA
        empty_df = pl.DataFrame(schema=SCHEMA)
        empty_df.write_parquet(str(CASE_STORE_PATH))
        logger.info("Created empty case store: %s", CASE_STORE_PATH)
    else:
        logger.info("Case store already exists: %s", CASE_STORE_PATH)

    # Initialize model registry
    reg = get_model_registry()
    logger.info("Model registry initialized with %d entries", len(reg))

    logger.info("Learning loop infrastructure ready.")


def main():
    parser = argparse.ArgumentParser(description="Run TraceFlow Full Pipeline")
    parser.add_argument("--mode", choices=["baseline", "full"], default="full", help="Pipeline execution mode")
    parser.add_argument("--csv", type=str, default=None, help="Path to input CSV")
    parser.add_argument("--out", type=str, default="results", help="Output directory")
    parser.add_argument("--top-cases", type=int, default=20, help="Number of top cases to generate evidence for")
    parser.add_argument("--with-learning", action="store_true", help="Initialize the learning loop (empty case store + registry)")
    args = parser.parse_args()

    # Run the existing pipeline
    logger.info("Running TraceFlow pipeline (mode=%s)", args.mode)

    # Import and delegate to existing pipeline
    from scripts.run_pipeline import main as run_pipeline_main
    sys.argv = ["run_pipeline.py", f"--mode={args.mode}"]
    if args.csv:
        sys.argv.append(f"--csv={args.csv}")
    if args.out:
        sys.argv.append(f"--out={args.out}")
    sys.argv.append(f"--top-cases={args.top_cases}")

    try:
        run_pipeline_main()
    except SystemExit:
        pass

    # Optionally initialize learning loop
    if args.with_learning:
        init_learning()

    logger.info("run_all.py completed successfully.")


if __name__ == "__main__":
    main()
