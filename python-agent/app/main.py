import os

from fastapi import FastAPI

from app.handlers import a2a_handler, health_handler

app = FastAPI(title="Compliance Risk Auditor", version="1.0.0")

app.add_api_route("/health", health_handler, methods=["GET"])
app.add_api_route("/a2a", a2a_handler, methods=["POST"])


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=int(os.getenv("PORT", "3300")))
