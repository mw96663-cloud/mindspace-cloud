
// Mindspace — Node.js 伺服器
// Node.js 18 以上

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = __dirname;

const PORT =
  Number(process.env.PORT) || 3000;

const MODEL =
  process.env.GEMINI_MODEL ||
  "gemini-2.5-flash";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};


// ========================
// 1. 回傳 JSON
// ========================

function json(res, code, data) {
  res.writeHead(code, {
    "Content-Type":
      "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });

  res.end(JSON.stringify(data));
}


// ========================
// 2. 讀取前端請求
// ========================

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;

      if (body.length > 20000) {
        reject(new Error("輸入過長"));
        req.destroy();
      }
    });

    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch (_) {
        reject(
          new Error("請求資料不是有效 JSON")
        );
      }
    });

    req.on("error", reject);
  });
}


// ========================
// 3. 檢查 Gemini SVG
// ========================

function extractSvg(raw) {
  const text = String(raw || "")
    .replace(/```(?:svg|xml)?/gi, "")
    .replace(/```/g, "")
    .trim();

  const match = text.match(
    /<svg\b[\s\S]*?<\/svg>/i
  );

  if (!match) {
    throw new Error(
      "AI 沒有回傳有效 SVG，請再試一次"
    );
  }

  let svg = match[0];

  // 禁止腳本、外部圖片與事件
  if (
    /<\s*(script|foreignObject|image|use|animate|set|iframe|style)\b/i.test(svg) ||
    /\bon[a-z]+\s*=/i.test(svg) ||
    /(?:href|src)\s*=/i.test(svg) ||
    /url\s*\(/i.test(svg) ||
    /<!|<\?/i.test(svg)
  ) {
    throw new Error(
      "AI 回傳了不安全的 SVG，請再試一次"
    );
  }

  const allowed = new Set([
    "svg",
    "g",
    "path",
    "circle",
    "ellipse",
    "rect",
    "line",
    "polyline",
    "polygon",
    "defs",
    "lineargradient",
    "radialgradient",
    "stop"
  ]);

  for (
    const m of svg.matchAll(
      /<\s*\/?\s*([a-z][\w:-]*)\b/gi
    )
  ) {
    if (!allowed.has(m[1].toLowerCase())) {
      throw new Error(
        "SVG 含有不支援的元素"
      );
    }
  }

  if (
    !/^<svg\b/i.test(svg) ||
    svg.length > 40000
  ) {
    throw new Error(
      "SVG 格式不正確或過大"
    );
  }

  return svg;
}


// ========================
// 4. 呼叫 Gemini API
// ========================

async function generate(req, res) {
  let body;

  try {
    body = await readBody(req);
  } catch (error) {
    return json(res, 400, {
      ok: false,
      error: error.message
    });
  }

  const idea = String(body.idea || "")
    .trim()
    .slice(0, 700);

  if (idea.length < 2) {
    return json(res, 400, {
      ok: false,
      error: "請先說出一段想像"
    });
  }

  const key = process.env.GEMINI_API_KEY;

  if (!key) {
    return json(res, 503, {
      ok: false,
      error:
        "Render 尚未設定 GEMINI_API_KEY"
    });
  }

  const prompt = `
你是兒童互動藝術作品 Mindspace 的場景插畫師。

孩子親手捏的黏土角色才是主角。
你只生成配角場景、自然物件、魔法光點、
植物、山丘、星星等。

孩子的想像：
${idea}

請只輸出一個完整的 SVG，
不要 Markdown，也不要說明文字。

SVG 規格：
- viewBox="0 0 1000 600"
- xmlns="http://www.w3.org/2000/svg"
- 背景透明
- 不要大面積實心背景
- 中央區域留空給實體黏土角色
- 使用柔和、童趣的色彩
- 可以使用漸層與幾何圖形

只允許以下元素：
svg、g、path、circle、ellipse、
rect、line、polyline、polygon、
defs、linearGradient、
radialGradient、stop。

禁止：
script、image、foreignObject、
style、文字、外部連結、
動畫、事件屬性。

輸出長度少於 12000 字元。
`;

  try {
    const controller =
      new AbortController();

    const timeout = setTimeout(
      () => controller.abort(),
      45000
    );

    let response;

    try {
      response = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/" +
        encodeURIComponent(MODEL) +
        ":generateContent",
        {
          method: "POST",
          signal: controller.signal,

          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": key
          },

          body: JSON.stringify({
            contents: [
              {
                parts: [
                  { text: prompt }
                ]
              }
            ],

            generationConfig: {
              temperature: 0.9,
              maxOutputTokens: 8192
            }
          })
        }
      );

    } finally {
      clearTimeout(timeout);
    }

    // 不直接 response.json()
    // 避免空白回應造成 JSON 錯誤
    const raw = await response.text();

    let data;

    try {
      data = JSON.parse(raw);
    } catch (_) {
      throw new Error(
        `Gemini 回傳非 JSON（HTTP ${response.status}）`
      );
    }

    if (!response.ok) {
      throw new Error(
        `Gemini HTTP ${response.status}：` +
        (
          data.error?.message ||
          "請確認 API Key、模型與額度"
        )
      );
    }

    const result = (
      data.candidates?.[0]?.content?.parts ||
      []
    )
      .map((p) => p.text || "")
      .join("\n");

    const svg = extractSvg(result);

    return json(res, 200, {
      ok: true,
      svg
    });

  } catch (error) {
    console.error(
      "Gemini error:",
      error.message
    );

    return json(res, 502, {
      ok: false,
      error:
        error.name === "AbortError"
          ? "Gemini 回應逾時，請再試一次"
          : error.message
    });
  }
}


// ========================
// 5. 建立伺服器
// ========================

const server = http.createServer(
  async (req, res) => {
    const url = new URL(
      req.url || "/",
      "http://localhost"
    );

    // 健康檢查
    if (url.pathname === "/api/health") {
      return json(res, 200, {
        ok: true,
        geminiKeyConfigured:
          Boolean(process.env.GEMINI_API_KEY)
      });
    }

    // Gemini SVG API
    if (
      url.pathname === "/api/generate-svg"
    ) {
      if (req.method !== "POST") {
        return json(res, 405, {
          ok: false,
          error: "請使用 POST"
        });
      }

      return generate(req, res);
    }

    // 靜態檔案
    if (
      req.method !== "GET" &&
      req.method !== "HEAD"
    ) {
      return json(res, 405, {
        ok: false,
        error: "不支援此方法"
      });
    }

    const files = {
      "/": "index.html",
      "/index.html": "index.html",
      "/sketch.js": "sketch.js"
    };

    const filename = files[url.pathname];

    if (!filename) {
      return json(res, 404, {
        ok: false,
        error: "Not Found"
      });
    }

    const filepath =
      path.join(ROOT, filename);

    fs.readFile(
      filepath,
      (error, data) => {
        if (error) {
          return json(res, 404, {
            ok: false,
            error: "檔案不存在"
          });
        }

        res.writeHead(200, {
          "Content-Type":
            MIME[path.extname(filepath)] ||
            "application/octet-stream"
        });

        res.end(
          req.method === "HEAD"
            ? undefined
            : data
        );
      }
    );
  }
);


// ========================
// 6. 啟動
// ========================

server.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `Mindspace 已啟動，埠號：${PORT}`
    );
  }
);
