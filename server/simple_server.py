import json
import os
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError


class Handler(BaseHTTPRequestHandler):
    def _set_cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):  # noqa: N802
        self.send_response(204)
        self._set_cors()
        self.end_headers()

    def do_GET(self):  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path == "/api/hero-images":
            self.handle_hero_images()
            return

        # fallback 404
        self.send_response(404)
        self._set_cors()
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b"{}")

    def handle_hero_images(self):
        access_key = os.getenv("UNSPLASH_ACCESS_KEY")
        urls = []
        if access_key:
            try:
                # Use Unsplash API with header Authorization: Client-ID <key>
                api_url = (
                    "https://api.unsplash.com/search/photos?query=award%20ceremony&per_page=20&orientation=landscape"
                )
                req = Request(api_url)
                req.add_header("Accept-Version", "v1")
                req.add_header("Authorization", f"Client-ID {access_key}")
                with urlopen(req, timeout=10) as resp:  # nosec - controlled URL
                    data = json.loads(resp.read().decode("utf-8"))
                    for it in data.get("results", []):
                        u = it.get("urls", {}).get("regular")
                        if u:
                            urls.append(u)
                        if len(urls) == 4:
                            break
            except (URLError, HTTPError, TimeoutError, json.JSONDecodeError):
                urls = []

        # Respond
        self.send_response(200)
        self._set_cors()
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(urls).encode("utf-8"))


def run():
    addr = ("127.0.0.1", 5000)
    httpd = HTTPServer(addr, Handler)
    print(f"Simple server running at http://{addr[0]}:{addr[1]}")
    httpd.serve_forever()


if __name__ == "__main__":
    run()


