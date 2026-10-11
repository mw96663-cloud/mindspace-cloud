
// Mindspace — Gemini SVG Server
// 需要 Node.js 20 或以上

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const PORT = Number(process.env.PORT) || 3000;

// Render 可以另外設定 GEMINI_MODEL 覆蓋預設值
const MODEL =
  process.env.GEMINI_MODEL ||
  "gemini-3.8-flash";

const API_KEY = process.env.GEMINI_API_KEY;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8"
};

function sendJSON(res, status, data) {
  if (res.headersSent || res.destroyed) return;

  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(data));
}

function readJSON(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    let tooLarge = false;

    req.on("data", chunk => {
      body += chunk;

      if (body.length > 12000) {
        tooLarge = true;
        reject(new Error("輸入內容太長"));
        req.destroy();
      }
    });

    req.on("end", () => {
      if (tooLarge) return;
      try {
        resolve(JSON.parse(body || "{}"));
      } catch (_) {
        reject(new Error("無法解析輸入資料"));
      }
    });

    req.on("error", reject);
  });
}

// 僅允許簡單 SVG 圖形，不執行 AI 產生的程式碼
function validateSVG(text) {
  const cleaned = String(text || "")
    .replace(/```(?:svg|xml)?/gi, "")
    .replace(/```/g, "")
    .trim();

  const match = cleaned.match(
    /<svg\b[\s\S]*?<\/svg>/i
  );

  if (!match) {
    throw new Error("Gemini 沒有產生完整 SVG");
  }

  const svg = match[0];

  if (svg.length > 20000) {
    throw new Error("SVG 太複雜，請重新生成");
  }

  const allowedTags = new Set([
    "svg", "g", "circle", "ellipse",
    "rect", "path", "line",
    "polygon", "polyline"
  ]);

  const allowedAttrs = new Set([
    "xmlns", "viewBox", "width", "height",
    "x", "y", "x1", "y1", "x2", "y2",
    "cx", "cy", "r", "rx", "ry",
    "d", "points", "fill", "stroke",
    "stroke-width", "stroke-linecap",
    "stroke-linejoin", "opacity",
    "fill-opacity", "stroke-opacity",
    "transform"
  ]);

  if (
    /<!|<\?|&(?:#|[a-z])/i.test(svg) ||
    /<\s*(script|style|image|use|foreignObject|iframe)\b/i.test(svg) ||
    /(?:javascript:|data:|https?:|url\s*\()/i.test(svg)
  ) {
    throw new Error("SVG 包含不允許的內容");
  }

  const tags = svg.match(/<[^>]*>/g) || [];

  for (const tag of tags) {
    const name = tag.match(
      /^<\s*\/?\s*([a-zA-Z][\w:-]*)/
    );

    if (!name || !allowedTags.has(name[1])) {
      throw new Error("SVG 使用不支援的元素");
    }

    if (/^<\s*\//.test(tag)) continue;

    // 讀取屬性並拒絕不允許的屬性
    const attrs = tag
      .replace(/^<\s*[\w:-]+/, "")
      .replace(/\/?>$/, "");

    const attrPattern =
      /([a-zA-Z][\w:-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;

    let remainder = attrs;
    let m;

    while ((m = attrPattern.exec(attrs)) !== null) {
      if (!allowedAttrs.has(m[1])) {
        throw new Error(
          "SVG 包含不支援的屬性：" + m[1]
        );
      }

      const value = m[3] ?? m[4] ?? "";

      if (/[<>&]/.test(value)) {
        throw new Error("SVG 屬性內容不安全");
      }

      remainder = remainder.replace(m[0], " ");
    }

    if (remainder.trim()) {
      throw new Error("SVG 屬性格式不正確");
    }
  }

  return svg;
}

function makePrompt(idea) {
  return `
你是兒童互動藝術作品 Mindspace 的 SVG 插畫師。

孩子親手創作的黏土角色是主角。
你只創造角色周圍的想像環境。

孩子說：
「${idea}」

請將這段想像轉成一張簡單、童趣的 SVG 插畫。

嚴格要求：
1. 只輸出 SVG 原始碼，不要 Markdown。
2. 根元素必須是：
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 600">
3. 背景透明。
4. 中間保留空間給黏土角色。
5. 圖案主要放在左右兩側與上下方。
6. 使用 10～25 個簡單圖形。
7. 優先使用 circle、ellipse、rect、path、polygon。
8. 不使用漸層、濾鏡、文字、動畫或圖片。
9. 不使用 style、class、id、外部資源或事件屬性。
10. 顏色直接使用 fill="#RRGGBB"。
11. 可以使用 stroke、stroke-width 和 opacity。
12. 請在 5000 字元內完成。
13. 一定要以 </svg> 結尾。

現在直接輸出 SVG。
`;
}

async function callGemini(idea) {
  const endpoint =
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    encodeURIComponent(MODEL) +
    ":generateContent";

  const controller = new AbortController();

  // 單次請求最多 85 秒
  const timeout = setTimeout(
    () => controller.abort(),
    85000
  );

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": API_KEY
      },
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [{
            text: makePrompt(idea)
          }]
        }],
        generationConfig: {
          temperature: 0.6,
          maxOutputTokens: 8192,
          responseMimeType: "text/plain"
        }
      })
    });

    const raw = await response.text();

    let data;
    try {
      data = JSON.parse(raw);
    } catch (_) {
      throw new Error(
        "Gemini 回傳無效 JSON，HTTP " +
        response.status
      );
    }

    if (!response.ok) {
      const error = new Error(
        "Gemini HTTP " + response.status +
        "：" +
        (data.error?.message || "未知錯誤")
      );

      error.httpStatus = response.status;
      throw error;
    }

    const candidate = data.candidates?.[0];

    const text = (
      candidate?.content?.parts || []
    )
      .map(part => part.text || "")
      .join("\n");

    if (!text) {
      throw new Error(
        "Gemini 沒有輸出 SVG。原因：" +
        (candidate?.finishReason || "未知")
      );
    }

    return validateSVG(text);

  } finally {
    clearTimeout(timeout);
  }
}

async function handleGenerate(req, res) {
  if (!API_KEY) {
    return sendJSON(res, 503, {
      ok: false,
      error: "Render 尚未設定 GEMINI_API_KEY"
    });
  }

  let body;
  try {
    body = await readJSON(req);
  } catch (e) {
    return sendJSON(res, 400, {
      ok: false,
      error: e.message
    });
  }

  const idea = String(body.idea || "")
    .trim()
    .slice(0, 500);

  if (idea.length < 2) {
    return sendJSON(res, 400, {
      ok: false,
      error: "請先說出一段想像"
    });
  }

  console.log(
    "開始生成 SVG，模型：", MODEL
  );

  // 第一次失敗時，僅對暫時性錯誤重試
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const svg = await callGemini(idea);

      console.log(
        "SVG 生成成功，長度：", svg.length
      );

      return sendJSON(res, 200, {
        ok: true,
        svg,
        model: MODEL
      });

    } catch (error) {
      console.error(
        "Gemini attempt", attempt,
        error.message
      );

      const retryable =
        error.httpStatus === 429 ||
        error.httpStatus === 503 ||
        error.httpStatus === 504;

      if (retryable && attempt === 1) {
        await new Promise(
          resolve => setTimeout(resolve, 1500)
        );
        continue;
      }

      const message =
        error.name === "AbortError"
          ? "Gemini 等待超過 85 秒。可能是模型處理太久，請稍後再試。"
          : error.message;

      return sendJSON(res, 502, {
        ok: false,
        error: message
      });
    }
  }
}

const server = http.createServer(
  async (req, res) => {
    const url = new URL(
      req.url || "/",
      "http://localhost"
    );

    if (url.pathname === "/api/health") {
      return sendJSON(res, 200, {
        ok: true,
        geminiKeyConfigured: Boolean(API_KEY),
        model: MODEL
      });
    }

    if (url.pathname === "/api/generate-svg") {
      if (req.method !== "POST") {
        return sendJSON(res, 405, {
          ok: false,
          error: "請使用 POST"
        });
      }

      return handleGenerate(req, res);
    }

    if (
      req.method !== "GET" &&
      req.method !== "HEAD"
    ) {
      return sendJSON(res, 405, {
        ok: false,
        error: "Method Not Allowed"
      });
    }

    const allowedFiles = {
      "/": "index.html",
      "/index.html": "index.html",
      "/sketch.js": "sketch.js"
    };

    const filename = allowedFiles[url.pathname];

    if (!filename) {
      return sendJSON(res, 404, {
        ok: false,
        error: "Not Found"
      });
    }

    const file = path.join(__dirname, filename);

    fs.readFile(file, (error, data) => {
      if (error) {
        return sendJSON(res, 404, {
          ok: false,
          error: "找不到網頁檔案"
        });
      }

      res.writeHead(200, {
        "Content-Type":
          MIME[path.extname(file)] ||
          "application/octet-stream"
      });

      res.end(
        req.method === "HEAD" ? undefined : data
      );
    });
  }
);

server.listen(PORT, "0.0.0.0", () => {
  console.log(
    "Mindspace Server 已啟動，Port:", PORT
  );
  console.log("Gemini 模型：", MODEL);
});
