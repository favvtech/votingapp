import os
from typing import List
from flask import Flask, jsonify
from flask_cors import CORS
import requests


def create_app() -> Flask:
    app = Flask(__name__)
    CORS(app)

    @app.get("/api/hero-images")
    def hero_images():
        access_key = os.getenv("UNSPLASH_ACCESS_KEY")
        if not access_key:
            # Return empty array; frontend will fallback to public images
            return jsonify([])

        try:
            params = {
                "query": "award ceremony",
                "per_page": 20,
                "orientation": "landscape",
            }
            headers = {"Accept-Version": "v1"}
            resp = requests.get(
                "https://api.unsplash.com/search/photos",
                params=params,
                headers=headers,
                timeout=10,
                auth=(access_key, ""),
            )
            resp.raise_for_status()
            data = resp.json()
            results = data.get("results", [])
            urls: List[str] = []
            for it in results:
                urls.append(it.get("urls", {}).get("regular"))
                if len(urls) == 4:
                    break
            # Filter Nones
            urls = [u for u in urls if u]
            return jsonify(urls)
        except Exception:
            return jsonify([])

    return app


app = create_app()

if __name__ == "__main__":
    app.run(debug=True)


