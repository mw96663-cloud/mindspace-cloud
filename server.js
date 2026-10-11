
"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const PORT = Number(process.env.PORT) || 3000;

const API_KEY = process.env.GEMINI_API_KEY || "";

const PRIMARY_MODEL =
  process.env.GEMINI_MODEL || "gemini-3.8-flash";

const BACKUP_MODEL =
  process.env.GEMINI_BACKUP_MODEL || "";

const MAX_ATTEMPTS = 3;

const REQUEST_TIMEOUT = 35000;

const sleep = ms =>
  new Promise(resolve => setTimeout(resolve, ms));

// ========================================
// 基本工具
// ========================================

function sendJSON(res, status, data) {
  if (res.headersSent || res.destroyed) return;

  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });

  res.end(JSON.stringify(data));
}

function readJSON(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    let settled = false;

    req.on("data", chunk => {
      if (settled) return;

      body += chunk.toString();

      if (body.length > 12000) {
        settled = true;
        reject(new Error("輸入內容過長"));
        req.destroy();
      }
    });

    req.on("end", () => {
      if (settled) return;

      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        reject(new Error("JSON 格式錯誤"));
      }
    });

    req.on("error", reject);
  });
}

function escapeXML(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ========================================
// Mindspace AI 視覺提示詞
// ========================================

function createPrompt(idea) {
  return `
You are the visual art director of MINDSPACE,
an interactive children's imagination installation.

A child describes an imaginary world:

"${idea}"

Create ONE complete, beautiful SVG illustration.

VISUAL ART DIRECTION:

Premium 2.5D handmade polymer clay illustration.

Soft, rounded, sculptural shapes.

Whimsical fantasy environment.

Pastel colors with rich harmonious color variation.

Subtle volumetric highlights.

Soft ambient shadows.

Layered foreground, middle ground and background.

Gentle gradients that create depth.

Beautiful, polished, gallery-quality composition.

The visual appearance should feel like a handcrafted
clay illustration, NOT flat vector clipart.

Avoid simplistic icon-like objects.

Avoid harsh outlines.

Avoid geometric-looking placeholder shapes.

Use detailed overlapping organic shapes
to suggest handmade clay volume.

COMPOSITION:

Canvas size: 1000 x 600.

The central area should remain relatively open
because a child's physical clay character
will be visually placed there later.

Build a rich environment around the center.

Include atmospheric details and beautiful
decorative elements.

Make the environment imaginative and distinctive.

The child's description is the highest priority.

Do not replace unusual imaginary objects with
generic mushrooms, stars or flowers.

SVG TECHNICAL REQUIREMENTS:

Return a single standalone SVG document.

Use:
<svg xmlns="http://www.w3.org/2000/svg"
width="1000"
height="600"
viewBox="0 0 1000 600">

Allowed visual techniques:
- paths
- circles
- ellipses
- rectangles
- polygons
- linear gradients
- radial gradients
- opacity
- transforms
- groups

Do not use:
- JavaScript
- scripts
- CSS imports
- external images
- external fonts
- foreignObject
- animation elements
- external URLs
- event handlers
- embedded HTML

Do not add Markdown fences.

Do not explain the artwork.

Return SVG code only.

The SVG must be complete and end with </svg>.

Create the scene now.
`;
}

// ========================================
// SVG 擷取
// ========================================

function extractSVG(text) {
  if (typeof text !== "string") {
    throw new Error("Gemini 沒有回傳文字");
  }

  const cleaned = text
    .replace(/```svg/gi, "")
    .replace(/```xml/gi, "")
    .replace(/```/g, "")
    .trim();

  const start = cleaned.indexOf("<svg");
  const end = cleaned.lastIndexOf("</svg>");

  if (start === -1 || end === -1) {
    throw new Error(
      "Gemini 回傳內容沒有完整 SVG"
    );
  }

  const svg = cleaned.slice(
    start,
    end + "</svg>".length
  );

  if (svg.length < 150) {
    throw new Error("SVG 內容過短");
  }

  if (svg.length > 350000) {
    throw new Error("SVG 內容過大");
  }

  return svg;
}

// ========================================
// SVG 安全檢查
// ========================================

const ALLOWED_TAGS = new Set([
  "svg",
  "defs",
  "g",
  "path",
  "circle",
  "ellipse",
  "rect",
  "line",
  "polyline",
  "polygon",
  "linearGradient",
  "radialGradient",
  "stop",
  "clipPath"
]);

const ALLOWED_ATTRIBUTES = new Set([
  "xmlns",
  "width",
  "height",
  "viewBox",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "d",
  "points",
  "fill",
  "fill-opacity",
  "fill-rule",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-opacity",
  "opacity",
  "transform",
  "id",
  "offset",
  "stop-color",
  "stop-opacity",
  "gradientUnits",
  "gradientTransform",
  "clip-path",
  "preserveAspectRatio"
]);

function validateSVG(svg) {
  const { DOMParser } = require("@xmldom/xmldom");

  const parseErrors = [];

  const parser = new DOMParser({
    onError(level, message) {
      if (level === "error" || level === "fatalError") {
        parseErrors.push(message);
      }
    }
  });

  const doc = parser.parseFromString(
    svg,
    "image/svg+xml"
  );

  if (parseErrors.length) {
    throw new Error(
      "SVG XML 格式錯誤：" + parseErrors[0]
    );
  }

  const root = doc.documentElement;

  if (!root || root.nodeName !== "svg") {
    throw new Error("SVG 根元素不正確");
  }

  function walk(node) {
    if (node.nodeType === 3) {
      if (node.nodeValue.trim()) {
        throw new Error(
          "SVG 包含不允許的文字內容"
        );
      }
      return;
    }

    if (node.nodeType === 8) {
      // 忽略 XML 註解
      return;
    }

    if (node.nodeType !== 1) {
      throw new Error(
        "SVG 包含不允許的節點"
      );
    }

    const name = node.nodeName;

    if (!ALLOWED_TAGS.has(name)) {
      throw new Error(
        "SVG 包含不允許的元素：" + name
      );
    }

    for (let i = 0; i < node.attributes.length; i++) {
      const attr = node.attributes.item(i);

      if (!ALLOWED_ATTRIBUTES.has(attr.name)) {
        throw new Error(
          "SVG 包含不允許的屬性：" + attr.name
        );
      }

      const value = attr.value;

      if (
        /javascript\s*:/i.test(value) ||
        /data\s*:/i.test(value) ||
        /https?:\/\//i.test(value) &&
          attr.name !== "xmlns"
      ) {
        throw new Error(
          "SVG 包含不安全的外部內容"
        );
      }

      if (
        /url\s*\(/i.test(value) &&
        !/^url\(\s*#[A-Za-z_][\w.-]*\s*\)$/.test(
          value.trim()
        )
      ) {
        throw new Error(
          "SVG 包含不允許的資源引用"
        );
      }
    }

    for (
      let child = node.firstChild;
      child;
      child = child.nextSibling
    ) {
      walk(child);
    }
  }

  walk(root);

  // 將畫布大小固定為 Mindspace 的比例
  root.setAttribute("width", "1000");
  root.setAttribute("height", "600");
  root.setAttribute("viewBox", "0 0 1000 600");
  root.setAttribute(
    "xmlns",
    "http://www.w3.org/2000/svg"
  );

  const { XMLSerializer } =
    require("@xmldom/xmldom");

  return new XMLSerializer()
    .serializeToString(doc);
}

// ========================================
// Gemini 單次請求
// ========================================

async function requestGemini(model, idea) {
  const controller = new AbortController();

  const timer = setTimeout(
    () => controller.abort(),
    REQUEST_TIMEOUT
  );

  try {
    const url =
      "https://generativelanguage.googleapis.com" +
      "/v1beta/models/" +
      encodeURIComponent(model) +
      ":generateContent";

    const response = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": API_KEY
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                text: createPrompt(idea)
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 8192
        }
      })
    });

    const raw = await response.text();

    let data;

    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error(
        "Gemini 回傳內容不是 JSON"
      );
    }

    if (!response.ok) {
      const error = new Error(
        "Gemini HTTP " +
        response.status +
        "：" +
        (
          data.error?.message ||
          "未知錯誤"
        )
      );

      error.status = response.status;

      throw error;
    }

    const candidate = data.candidates?.[0];

    const output = (
      candidate?.content?.parts || []
    )
      .map(part => part.text || "")
      .join("");

    if (!output.trim()) {
      throw new Error(
        "Gemini 沒有回傳 SVG。" +
        "結束原因：" +
        (
          candidate?.finishReason ||
          "未知"
        )
      );
    }

    return output;

  } finally {
    clearTimeout(timer);
  }
}

// ========================================
// 自動重試 + 備用模型
// ========================================

async function generateSVG(idea) {
  if (!API_KEY) {
    throw new Error(
      "Render 尚未設定 GEMINI_API_KEY"
    );
  }

  const models = [PRIMARY_MODEL];

  if (
    BACKUP_MODEL &&
    BACKUP_MODEL !== PRIMARY_MODEL
  ) {
    models.push(BACKUP_MODEL);
  }

  let lastError = null;

  for (const model of models) {
    for (
      let attempt = 1;
      attempt <= MAX_ATTEMPTS;
      attempt++
    ) {
      try {
        console.log(
          "[Gemini] Model:",
          model,
          "Attempt:",
          attempt
        );

        const output = await requestGemini(
          model,
          idea
        );

        const extracted = extractSVG(output);

        const svg = validateSVG(extracted);

        console.log(
          "[Gemini] SVG generated successfully"
        );

        return {
          svg,
          model
        };

      } catch (error) {
        lastError = error;

        console.error(
          "[Gemini] Generation error:",
          error.message
        );

        const temporary =
          [429, 500, 502, 503, 504]
            .includes(error.status) ||
          error.name === "AbortError" ||
          error.name === "TimeoutError";

        if (!temporary) {
          // 例如模型不存在、API Key 錯誤，
          // 或 SVG 本身不合法。
          // 不再無意義地重試相同請求。
          break;
        }

        if (attempt < MAX_ATTEMPTS) {
          const delay =
            2000 * Math.pow(2, attempt - 1) +
            Math.floor(Math.random() * 1000);

          console.log(
            "[Gemini] Waiting",
            delay,
            "ms before retry"
          );

          await sleep(delay);
        }
      }
    }
  }

  throw lastError ||
    new Error("Gemini 無法生成 SVG");
}

// ========================================
// HTTP 伺服器
// ========================================

const server = http.createServer(
  async (req, res) => {
    try {
      const url = new URL(
        req.url || "/",
        "http://localhost"
      );

      // 健康檢查
      if (url.pathname === "/api/health") {
        return sendJSON(res, 200, {
          ok: true,
          geminiKeyConfigured: Boolean(API_KEY),
          model: PRIMARY_MODEL,
          backupModelConfigured:
            Boolean(BACKUP_MODEL),
          version: "mindspace-clay-retry-1"
        });
      }

      // AI SVG 生成
      if (url.pathname === "/api/generate-svg") {
        if (req.method !== "POST") {
          return sendJSON(res, 405, {
            ok: false,
            error: "請使用 POST"
          });
        }

        let body;

        try {
          body = await readJSON(req);
        } catch (error) {
          return sendJSON(res, 400, {
            ok: false,
            error: error.message
          });
        }

        const idea = String(
          body.idea || ""
        ).trim().slice(0, 240);

        if (idea.length < 2) {
          return sendJSON(res, 400, {
            ok: false,
            error: "請至少輸入兩個字"
          });
        }

        try {
          const result = await generateSVG(idea);

          return sendJSON(res, 200, {
            ok: true,
            svg: result.svg,
            title: idea.slice(0, 35),
            model: result.model,
            fallback: false
          });

        } catch (error) {
          console.error(
            "[Mindspace] Final error:",
            error.message
          );

          return sendJSON(res, 503, {
            ok: false,
            error:
              "AI 場景生成失敗：" +
              error.message
          });
        }
      }

      // 網站靜態檔案
      if (req.method !== "GET") {
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

      const filename =
        allowedFiles[url.pathname];

      if (!filename) {
        return sendJSON(res, 404, {
          ok: false,
          error: "Not Found"
        });
      }

      const filepath = path.join(
        __dirname,
        filename
      );

      fs.readFile(filepath, (error, data) => {
        if (error) {
          return sendJSON(res, 404, {
            ok: false,
            error: "找不到檔案：" + filename
          });
        }

        const contentType =
          filename.endsWith(".js")
            ? "application/javascript; charset=utf-8"
            : "text/html; charset=utf-8";

        res.writeHead(200, {
          "Content-Type": contentType,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff"
        });

        res.end(data);
      });

    } catch (error) {
      console.error(
        "[Server] Unexpected error:",
        error
      );

      sendJSON(res, 500, {
        ok: false,
        error: "伺服器內部錯誤"
      });
    }
  }
);

server.requestTimeout = 130000;

server.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      "Mindspace running on port",
      PORT
    );

    console.log(
      "Primary Gemini model:",
      PRIMARY_MODEL
    );

    console.log(
      "Backup model configured:",
      Boolean(BACKUP_MODEL)
    );
  }
);
