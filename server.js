
"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { DOMParser, XMLSerializer } =
  require("@xmldom/xmldom");

const PORT = Number(process.env.PORT) || 3000;
const API_KEY = process.env.GEMINI_API_KEY || "";
const MODEL =
  process.env.GEMINI_MODEL || "gemini-3.8-flash";

const sleep = ms =>
  new Promise(resolve => setTimeout(resolve, ms));

function sendJSON(res, status, value) {
  if (res.headersSent || res.destroyed) return;
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(value));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    let finished = false;

    req.on("data", chunk => {
      if (finished) return;
      body += chunk.toString();

      if (body.length > 10000) {
        finished = true;
        reject(new Error("輸入內容過長"));
      }
    });

    req.on("end", () => {
      if (finished) return;
      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        reject(new Error("輸入格式錯誤"));
      }
    });

    req.on("error", reject);
  });
}

// AI 只需要畫簡單、完整的 SVG
function makePrompt(idea) {
  return `
You are the illustrator for Mindspace,
a children's interactive imagination project.

The child's imagination is:

${JSON.stringify(idea)}

Draw a SIMPLE, charming SVG illustration
based on the child's description.

Style:
- Soft pastel colors
- Cute rounded handmade clay illustration
- Simple 2.5D appearance
- Soft highlights and gentle shadows
- Whimsical and playful
- Clearly recognizable objects
- Not photorealistic
- Not complex
- No text or labels in the artwork

Composition:
- SVG viewBox="0 0 800 500"
- Full illustrated background
- 3 to 6 main objects
- Leave some open space near the center
- Add a little depth with overlapping shapes

IMPORTANT:
- Use at most 35 visible shapes total
- Use only svg, g, defs, path, rect,
  circle, ellipse, polygon, linearGradient,
  radialGradient and stop
- Keep paths short and simple
- Prefer circles, ellipses and rounded rectangles
- Use at most 3 gradients
- Do not use filters, masks, CSS, text,
  scripts, images, foreignObject,
  animations, clipPath or external resources
- No Markdown code fences
- No explanation
- Return ONLY a complete SVG
- End with </svg>

The first line must be:
<svg xmlns="http://www.w3.org/2000/svg"
viewBox="0 0 800 500" width="800" height="500">

Create a scene that follows the child's idea.
`;
}

const TAGS = new Set([
  "svg", "g", "defs", "path", "rect",
  "circle", "ellipse", "polygon",
  "linearGradient", "radialGradient", "stop"
]);

const ATTRS = new Set([
  "xmlns", "viewBox", "width", "height",
  "x", "y", "x1", "y1", "x2", "y2",
  "cx", "cy", "r", "rx", "ry",
  "d", "points", "fill", "stroke",
  "stroke-width", "stroke-linecap",
  "stroke-linejoin", "opacity",
  "fill-opacity", "stroke-opacity",
  "transform", "id", "offset",
  "stop-color", "stop-opacity",
  "gradientUnits", "gradientTransform"
]);

function validateSVG(output) {
  const text = String(output || "")
    .replace(/```svg/gi, "")
    .replace(/```xml/gi, "")
    .replace(/```/g, "")
    .trim();

  const start = text.indexOf("<svg");
  const end = text.lastIndexOf("</svg>");

  if (start < 0 || end < 0) {
    throw new Error("AI 沒有回傳完整 SVG");
  }

  const svg = text.slice(
    start, end + "</svg>".length
  );

  if (svg.length > 100000) {
    throw new Error("SVG 過大");
  }

  const errors = [];

  const doc = new DOMParser({
    onError(level, message) {
      if (level === "error" ||
          level === "fatalError") {
        errors.push(message);
      }
    }
  }).parseFromString(svg, "image/svg+xml");

  if (errors.length) {
    throw new Error("SVG XML 格式錯誤");
  }

  const root = doc.documentElement;

  if (!root || root.nodeName !== "svg") {
    throw new Error("SVG 結構錯誤");
  }

  let shapeCount = 0;
  const ids = new Set();
  const refs = [];

  function check(node) {
    if (node.nodeType === 3) {
      if (node.nodeValue.trim()) {
        throw new Error("SVG 含不允許的文字");
      }
      return;
    }

    if (node.nodeType === 8) return;

    if (node.nodeType !== 1) {
      throw new Error("SVG 含不允許的節點");
    }

    if (!TAGS.has(node.nodeName)) {
      throw new Error(
        "SVG 元素不支援：" + node.nodeName
      );
    }

    if ([
      "path", "rect", "circle",
      "ellipse", "polygon"
    ].includes(node.nodeName)) {
      shapeCount++;
    }

    for (let i = 0; i < node.attributes.length; i++) {
      const attr = node.attributes.item(i);
      const name = attr.name;
      const value = attr.value.trim();

      if (!ATTRS.has(name)) {
        throw new Error(
          "SVG 屬性不支援：" + name
        );
      }

      if (name === "xmlns") {
        if (value !==
          "http://www.w3.org/2000/svg") {
          throw new Error("SVG 命名空間錯誤");
        }
        continue;
      }

      if (name === "id") {
        if (!/^[A-Za-z_][\w.-]*$/.test(value)) {
          throw new Error("SVG ID 不合法");
        }
        ids.add(value);
        continue;
      }

      if (/url\s*\(/i.test(value)) {
        const match = value.match(
          /^url\(\s*#([A-Za-z_][\w.-]*)\s*\)$/
        );

        if (!match) {
          throw new Error("SVG 外部引用不允許");
        }

        refs.push(match[1]);
        continue;
      }

      if (
        /[<>"'{};\\]/.test(value) ||
        /javascript:|data:|https?:|@import/i.test(value)
      ) {
        throw new Error("SVG 屬性內容不安全");
      }
    }

    for (
      let child = node.firstChild;
      child;
      child = child.nextSibling
    ) {
      check(child);
    }
  }

  check(root);

  if (shapeCount < 2) {
    throw new Error("SVG 內容不足");
  }

  if (shapeCount > 80) {
    throw new Error("SVG 圖形過多");
  }

  for (const ref of refs) {
    if (!ids.has(ref)) {
      throw new Error("SVG 漸層引用不存在");
    }
  }

  root.setAttribute("width", "800");
  root.setAttribute("height", "500");
  root.setAttribute("viewBox", "0 0 800 500");
  root.setAttribute(
    "xmlns", "http://www.w3.org/2000/svg"
  );

  return new XMLSerializer()
    .serializeToString(doc);
}

async function requestAI(idea) {
  if (!API_KEY) {
    throw new Error(
      "Render 沒有設定 GEMINI_API_KEY"
    );
  }

  const url =
    "https://generativelanguage.googleapis.com" +
    "/v1beta/models/" +
    encodeURIComponent(MODEL) +
    ":generateContent";

  let lastError;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      45000
    );

    try {
      console.log(
        "Gemini SVG attempt:", attempt
      );

      const response = await fetch(url, {
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
            temperature: 0.5,
            maxOutputTokens: 4096
          }
        })
      });

      const raw = await response.text();
      let data;

      try {
        data = JSON.parse(raw);
      } catch {
        throw new Error(
          "Gemini 回傳格式錯誤"
        );
      }

      if (!response.ok) {
        const error = new Error(
          "Gemini HTTP " + response.status +
          "：" +
          (data.error?.message || "未知錯誤")
        );

        error.status = response.status;
        throw error;
      }

      const candidate = data.candidates?.[0];

      const output = (
        candidate?.content?.parts || []
      ).map(p => p.text || "").join("");

      if (!output.trim()) {
        throw new Error(
          "Gemini 沒有輸出內容：" +
          (candidate?.finishReason || "未知原因")
        );
      }

      const svg = validateSVG(output);

      console.log(
        "Gemini SVG success:",
        svg.length, "characters"
      );

      return svg;

    } catch (error) {
      lastError = error;
      console.error(
        "Gemini attempt failed:",
        error.message
      );

      const temporary =
        [429, 500, 502, 503, 504]
          .includes(error.status) ||
        error.name === "AbortError" ||
        error.name === "TimeoutError";

      if (!temporary || attempt === 2) {
        break;
      }

      await sleep(2500 + Math.random() * 1000);

    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError;
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
        version: "mindspace-ai-svg-simple-v1",
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

      let body;

      try {
        body = await readBody(req);
      } catch (error) {
        return sendJSON(res, 400, {
          ok: false,
          error: error.message
        });
      }

      const idea = String(body.idea || "")
        .trim()
        .slice(0, 200);

      if (idea.length < 2) {
        return sendJSON(res, 400, {
          ok: false,
          error: "請輸入至少兩個字"
        });
      }

      try {
        const svg = await requestAI(idea);

        return sendJSON(res, 200, {
          ok: true,
          svg,
          title: idea,
          source: "gemini",
          model: MODEL
        });

      } catch (error) {
        console.error(
          "AI SVG final failure:",
          error.message
        );

        return sendJSON(res, 503, {
          ok: false,
          error: error.message
        });
      }
    }

    if (
      req.method === "GET" &&
      (url.pathname === "/" ||
       url.pathname === "/index.html")
    ) {
      fs.readFile(
        path.join(__dirname, "index.html"),
        (error, data) => {
          if (error) {
            return sendJSON(res, 500, {
              ok: false,
              error: "找不到 index.html"
            });
          }

          res.writeHead(200, {
            "Content-Type":
              "text/html; charset=utf-8",
            "Cache-Control": "no-store"
          });

          res.end(data);
        }
      );

      return;
    }

    sendJSON(res, 404, {
      ok: false,
      error: "Not Found"
    });
  }
);

server.requestTimeout = 120000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(
    "Mindspace AI SVG V1 on port", PORT
  );
  console.log("Gemini model:", MODEL);
});
