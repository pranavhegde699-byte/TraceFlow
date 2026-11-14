import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from api.database import init_db
from api.data_store import DataStore
from api.routers import cases as cases_router
from api.routers import metrics as metrics_router
from api.routers import datasets as datasets_router
from api.routers import analysis as analysis_router
from api.routers import wallets as wallets_router
from api.routers import reports as reports_router
from api.routers import learning as learning_router

# Initialize database tables
init_db()

results_dir = os.environ.get("RESULTS_DIR", "results")
data_store: DataStore = DataStore(results_dir=results_dir)
cases_router.set_store(data_store)
metrics_router.set_store(data_store)

@asynccontextmanager
async def lifespan(app: FastAPI):
    global data_store
    init_db()
    results_dir = os.environ.get("RESULTS_DIR", "results")
    data_store = DataStore(results_dir=results_dir)
    cases_router.set_store(data_store)
    metrics_router.set_store(data_store)
    print("TraceFlow NFT & AML Forensic API initialized.")
    yield

app = FastAPI(
    title="TraceFlow NFT Fraud & AML API",
    description="Production-grade NFT fraud, wash trading, and anti-money laundering investigation platform",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(datasets_router.router)
app.include_router(analysis_router.router)
app.include_router(wallets_router.router)
app.include_router(cases_router.router)
app.include_router(reports_router.router)
app.include_router(metrics_router.router, prefix="/api")
app.include_router(learning_router.router)

@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "version": "1.0.0",
        "platform": "TraceFlow NFT Fraud & AML Platform",
        "active_dataset": datasets_router.get_active_dataset_id(),
        "cases_loaded": len(data_store.clusters) if data_store else 0,
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("api.main:app", host="0.0.0.0", port=8000, reload=True)
