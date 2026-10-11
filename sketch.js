// =======================================
// Mindspace Simple V2
// 語音辨識 → Gemini → SVG → p5.js
// =======================================

const W = 800;
const H = 450;

let worldImage = null;
let loading = false;

let recognition = null;
let isListening = false;
let isGenerating = false;

let ideaInput;
let micButton;
let generateButton;
let statusText;
let modelInfo;

let activeObjectURL = null;


// =======================================
// p5.js 初始化
// =======================================

function setup() {

  const canvas = createCanvas(W, H);

  canvas.parent("canvas-container");

  pixelDensity(1);

  ideaInput = document.getElementById("idea-input");
  micButton = document.getElementById("mic-button");
  generateButton = document.getElementById("generate-button");
  statusText = document.getElementById("status");
  modelInfo = document.getElementById("model-info");

  micButton.addEventListener("click", toggleSpeech);

  generateButton.addEventListener("click", generateWorld);

  setupSpeechRecognition();

  checkServer();

}


// =======================================
// p5.js 畫面
// =======================================

function draw() {

  background(235, 228, 250);

  if (worldImage) {

    image(
      worldImage,
      0,
      0,
      width,
      height
    );

  } else {

    fill(90, 75, 130);
    noStroke();

    textAlign(CENTER, CENTER);
    textSize(25);

    text(
      "你的想像世界即將出現",
      width / 2,
      height / 2 - 15
    );

    textSize(15);

    text(
      "請說出你的想像，或輸入文字後按下生成",
      width / 2,
      height / 2 + 25
    );

  }

  if (loading) {

    fill(0, 0, 0, 110);
    noStroke();

    rect(0, 0, width, height);

    fill(255);
    textAlign(CENTER, CENTER);
    textSize(23);

    text(
      "Gemini 正在創造世界...",
      width / 2,
      height / 2
    );

  }

}


// =======================================
// 狀態訊息
// =======================================

function setStatus(message, isError = false) {

  statusText.textContent = message;

  statusText.classList.toggle(
    "error",
    isError
  );

}


// =======================================
// 伺服器檢查
// =======================================

async function checkServer() {

  try {

    const response = await fetch(
      "/api/health",
      { cache: "no-store" }
    );

    if (!response.ok) {
      throw new Error("無法連線至伺服器");
    }

    const data = await response.json();

    if (!data.hasApiKey) {

      setStatus(
        "❌ Render 尚未設定 GEMINI_API_KEY",
        true
      );

      return;
    }

    modelInfo.textContent =
      "版本：" + data.version +
      "｜模型：" + data.primaryModel;

  } catch (error) {

    setStatus(
      "❌ 伺服器連線失敗：" + error.message,
      true
    );

  }

}


// =======================================
// 中文語音辨識
// =======================================

function setupSpeechRecognition() {

  const SpeechRecognition =
    window.SpeechRecognition ||
    window.webkitSpeechRecognition;

  if (!SpeechRecognition) {

    micButton.disabled = true;

    setStatus(
      "此瀏覽器不支援語音辨識，請使用支援的 Chrome 瀏覽器。",
      true
    );

    return;
  }

  recognition = new SpeechRecognition();

  recognition.lang = "zh-TW";

  // 顯示完整辨識結果
  recognition.interimResults = true;

  // 持續辨識直到手動停止
  recognition.continuous = true;

  // 不錄製或儲存音檔
  let confirmedText = "";

  recognition.onstart = () => {

    isListening = true;

    confirmedText = "";

    micButton.textContent =
      "⏹ 停止辨識並生成";

    micButton.classList.add("listening");

    setStatus("🎤 正在聆聽，請說出你的想像...");

  };

  recognition.onresult = (event) => {

    let interimText = "";

    for (
      let i = event.resultIndex;
      i < event.results.length;
      i++
    ) {

      const result = event.results[i];

      const transcript =
        result[0].transcript.trim();

      if (result.isFinal) {

        confirmedText += transcript + "，";

      } else {

        interimText += transcript;

      }

    }

    // 顯示目前辨識到的內容
    ideaInput.value =
      confirmedText + interimText;

  };

  recognition.onerror = (event) => {

    console.error(
      "Speech recognition error:",
      event.error
    );

    if (event.error !== "no-speech") {

      setStatus(
        "❌ 語音辨識失敗：" + event.error,
        true
      );

    }

  };

  recognition.onend = () => {

    const shouldGenerate = isGenerating;

    isListening = false;

    micButton.textContent =
      "🎤 開始語音辨識";

    micButton.classList.remove("listening");

    if (shouldGenerate) {

      isGenerating = false;

      generateWorld();

    }

  };

}


// =======================================
// 語音按鈕
// =======================================

function toggleSpeech() {

  if (!recognition) {
    return;
  }

  if (loading) {
    return;
  }

  if (!isListening) {

    isGenerating = false;

    try {

      recognition.start();

    } catch (error) {

      setStatus(
        "❌ 無法啟動麥克風：" + error.message,
        true
      );

    }

  } else {

    isGenerating = true;

    recognition.stop();

    setStatus(
      "語音辨識完成，準備生成世界..."
    );

  }

}


// =======================================
// SVG 格式檢查
// =======================================

function validateSVG(svgText) {

  if (
    typeof svgText !== "string" ||
    !svgText.trim()
  ) {

    throw new Error(
      "伺服器沒有回傳 SVG 內容"
    );

  }

  const parser = new DOMParser();

  const documentSVG = parser.parseFromString(
    svgText,
    "image/svg+xml"
  );

  const parseError =
    documentSVG.querySelector("parsererror");

  if (parseError) {

    throw new Error(
      "Gemini 回傳的 SVG XML 格式不正確"
    );

  }

  const root = documentSVG.documentElement;

  if (
    !root ||
    root.localName.toLowerCase() !== "svg"
  ) {

    throw new Error(
      "AI 回傳內容不是 SVG"
    );

  }

  // 避免將可執行內容放入圖片
  const forbidden =
    /<script\b|<foreignObject\b|<iframe\b|<image\b|<use\b|<!DOCTYPE|<!ENTITY|\bon[a-z]+\s*=|(?:href|src)\s*=/i;

  if (forbidden.test(svgText)) {

    throw new Error(
      "SVG 包含不允許的元素或屬性"
    );

  }

  return svgText;

}


// =======================================
// 將 SVG 載入 p5.js
// =======================================

function loadSVGToP5(svgText) {

  return new Promise((resolve, reject) => {

    let url = null;

    try {

      const validSVG = validateSVG(svgText);

      const blob = new Blob(
        [validSVG],
        {
          type: "image/svg+xml;charset=utf-8"
        }
      );

      url = URL.createObjectURL(blob);

      loadImage(

        url,

        (img) => {

          // 載入完成才釋放網址
          URL.revokeObjectURL(url);

          resolve(img);

        },

        (error) => {

          URL.revokeObjectURL(url);

          reject(
            new Error(
              "p5.js 無法載入 SVG 圖片"
            )
          );

        }

      );

    } catch (error) {

      if (url) {
        URL.revokeObjectURL(url);
      }

      reject(error);

    }

  });

}


// =======================================
// Gemini 生成世界
// =======================================

async function generateWorld() {

  if (loading) {
    return;
  }

  const idea = ideaInput.value.trim();

  if (!idea) {

    setStatus(
      "請先說出或輸入想像的世界",
      true
    );

    return;
  }

  loading = true;

  generateButton.disabled = true;
  micButton.disabled = true;

  setStatus(
    "✨ 正在請 Gemini 生成 SVG 背景..."
  );

  try {

    const controller = new AbortController();

    const timeout = setTimeout(
      () => controller.abort(),
      90000
    );

    let response;

    try {

      response = await fetch(
        "/api/generate-svg",
        {
          method: "POST",

          headers: {
            "Content-Type": "application/json"
          },

          body: JSON.stringify({
            idea
          }),

          signal: controller.signal
        }
      );

    } finally {

      clearTimeout(timeout);

    }

    const data = await response.json();

    if (!response.ok || !data.ok) {

      const details =
        Array.isArray(data.details)
          ? data.details.join("；")
          : "";

      throw new Error(
        (data.error || "AI 生成失敗") +
        (details ? "：" + details : "")
      );

    }

    setStatus(
      "SVG 已收到，正在載入 p5.js..."
    );

    const newImage = await loadSVGToP5(
      data.svg
    );

    worldImage = newImage;

    modelInfo.textContent =
      "成功使用模型：" + data.model;

    setStatus(
      "✅ 成功！Gemini SVG 已顯示在 p5.js 畫布中。"
    );

  } catch (error) {

    console.error(
      "Mindspace generation error:",
      error
    );

    let message = error.message;

    if (error.name === "AbortError") {

      message =
        "等待 AI 超過 90 秒，請檢查 Render Logs。";

    }

    setStatus(
      "❌ " + message,
      true
    );

  } finally {

    loading = false;

    generateButton.disabled = false;

    micButton.disabled = !recognition;

  }

}
