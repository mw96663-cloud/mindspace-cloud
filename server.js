
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8"
};

const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(
    new URL(req.url, "http://localhost:3000").pathname
  );

  const requestedFile = pathname === "/"
    ? "index.html"
    : pathname.slice(1);

  const filePath = path.resolve(root, requestedFile);

  if (!filePath.startsWith(root + path.sep) || !fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end("Not Found");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(500);
      res.end("Server Error");
      return;
    }

    res.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream"
    });
    res.end(data);
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Mindspace 已啟動，埠號：${PORT}`);
});
