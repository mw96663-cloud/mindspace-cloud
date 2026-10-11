
// Mindspace — p5.js 互動舞台

let particles = [];
let t = 0;
let immersive = false;

let sceneImage = null;

let speech = null;
let listening = false;
let generating = false;

let finalText = "";
let lastInterim = "";
let silenceTimer = null;
let speechStarted = false;

const SILENCE_MS = 2400;


// ========================
// 1. 初始化
// ========================

function setup() {
  createCanvas(windowWidth, windowHeight);

  pixelDensity(
    Math.min(window.devicePixelRatio || 1, 2)
  );

  colorMode(HSB, 360, 100, 100, 100);

  initParticles();
  initSpeech();
}


function initParticles() {
  particles = [];

  for (let i = 0; i < 100; i++) {
    particles.push({
      x: random(width),
      y: random(height),
      r: random(1, 4),
      speed: random(0.3, 1.5),
      phase: random(TWO_PI)
    });
  }
}


// ========================
// 2. 每一幀畫面
// ========================

function draw() {
  t += 0.008;

  drawWorld();

  // 顯示 Gemini 生成的 SVG
  if (sceneImage) {
    push();

    imageMode(CENTER);
    tint(255, 245);

    const ratio = Math.min(
      width / 1000,
      height / 600
    );

    image(
      sceneImage,
      width / 2,
      height / 2,
      1000 * ratio,
      600 * ratio
    );

    pop();
  }

  drawParticles();
  drawTitle();
}


// ========================
// 3. 夢境背景
// ========================

function drawWorld() {
  // 深藍到青綠漸層
  for (let y = 0; y < height; y += 3) {
    let k = y / height;

    let c = lerpColor(
      color(222, 70, 18),
      color(177, 72, 46),
      k
    );

    stroke(c);
    line(0, y, width, y);
  }

  noStroke();

  // 遠方光暈
  for (let i = 0; i < 7; i++) {
    let x = width * (0.15 + i * 0.12);

    let y = height * (
      0.35 + sin(t + i) * 0.08
    );

    fill(185 + i * 8, 55, 85, 5);

    circle(
      x,
      y,
      height * (
        0.4 + sin(t + i) * 0.05
      )
    );
  }

  // 地平線光波
  noFill();

  for (let j = 0; j < 4; j++) {
    stroke(
      180 + j * 12,
      40,
      90,
      25 - j * 4
    );

    strokeWeight(1.5);
    beginShape();

    for (let x = 0; x <= width; x += 12) {
      let y =
        height * 0.72 +
        sin(x * 0.008 + t * 2 + j) * 16 +
        sin(x * 0.018 - t + j) * 7 +
        j * 15;

      vertex(x, y);
    }

    endShape();
  }
}


// ========================
// 4. 漂浮粒子
// ========================

function drawParticles() {
  noStroke();

  for (let p of particles) {
    p.y -= p.speed;

    p.x += sin(t + p.phase) * 0.4;

    if (p.y < -10) {
      p.y = height + 10;
      p.x = random(width);
    }

    let alpha =
      35 + 35 * sin(t * 2 + p.phase);

    fill(
      180 + 35 * sin(p.phase),
      30,
      100,
      alpha
    );

    circle(p.x, p.y, p.r * 2);
  }
}


// ========================
// 5. 標題
// ========================

function drawTitle() {
  fill(0, 0, 100, 95);
  noStroke();

  textAlign(LEFT, TOP);
  textStyle(NORMAL);

  textSize(
    constrain(width * 0.018, 18, 30)
  );

  text("M I N D S P A C E", 30, 26);

  fill(0, 0, 100, 75);

  textSize(
    constrain(width * 0.009, 12, 16)
  );

  text(
    "讓想像慢慢長出自己的世界",
    32,
    66
  );
}


// ========================
// 6. 畫面尺寸
// ========================

function mousePressed() {
  immersive = true;
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  initParticles();
}


// ========================
// 7. 狀態文字
// ========================

function setStatus(message) {
  document.getElementById("status").textContent =
    message;
}

function setTranscript(message) {
  document.getElementById("transcript").textContent =
    message;
}

function updateButton() {
  const btn =
    document.getElementById("micButton");

  btn.disabled = generating;

  if (generating) {
    btn.textContent = "✨ 正在生成世界…";
  } else if (listening) {
    btn.textContent = "⏹ 結束說話並生成";
  } else {
    btn.textContent = "🎤 開始說出想像";
  }
}


// ========================
// 8. 語音辨識
// ========================

function initSpeech() {
  const btn =
    document.getElementById("micButton");

  const Recognition =
    window.SpeechRecognition ||
    window.webkitSpeechRecognition;

  if (!Recognition) {
    btn.disabled = true;

    setStatus(
      "瀏覽器不支援語音辨識，請使用桌面版 Chrome 或 Edge。"
    );

    return;
  }

  speech = new Recognition();

  speech.lang = "zh-TW";
  speech.continuous = true;
  speech.interimResults = true;

  speech.onstart = () => {
    listening = true;
    speechStarted = true;

    setStatus(
      "正在聽你說話… 說完停頓約 2 秒就會生成"
    );

    updateButton();
  };

  speech.onresult = (event) => {
    let interim = "";

    for (
      let i = event.resultIndex;
      i < event.results.length;
      i++
    ) {
      const piece =
        event.results[i][0].transcript;

      if (event.results[i].isFinal) {
        finalText += piece + " ";
      } else {
        interim += piece;
      }
    }

    lastInterim = interim;

    setTranscript(
      (finalText + " " + interim).trim()
    );

    clearTimeout(silenceTimer);

    if (
      (finalText + interim).trim().length >= 2
    ) {
      silenceTimer = setTimeout(
        finishSpeech,
        SILENCE_MS
      );
    }
  };

  speech.onerror = (event) => {
    clearTimeout(silenceTimer);

    if (event.error === "no-speech") {
      setStatus("沒有聽到聲音，請再試一次");
    } else if (event.error === "not-allowed") {
      setStatus("請允許瀏覽器使用麥克風");
    } else {
      setStatus(
        "語音辨識失敗：" + event.error
      );
    }

    listening = false;
    updateButton();
  };

  speech.onend = () => {
    listening = false;
    updateButton();

    if (
      !generating &&
      speechStarted &&
      (finalText + lastInterim).trim().length >= 2
    ) {
      finishSpeech();
    }
  };

  btn.addEventListener("click", () => {
    if (generating) return;

    if (listening) {
      finishSpeech();
      return;
    }

    finalText = "";
    lastInterim = "";
    speechStarted = false;

    setTranscript("");

    try {
      speech.start();
    } catch (error) {
      setStatus(
        "無法啟動麥克風：" + error.message
      );
    }
  });
}


// ========================
// 9. 結束語音並生成
// ========================

function finishSpeech() {
  clearTimeout(silenceTimer);

  if (generating) return;

  const idea = (
    finalText + " " + lastInterim
  ).trim();

  speechStarted = false;

  if (listening && speech) {
    try {
      speech.stop();
    } catch (_) {}
  }

  listening = false;

  if (idea.length < 2) {
    setStatus("請先說出一段想像");
    updateButton();
    return;
  }

  generateScene(idea);
}


// ========================
// 10. 呼叫 Gemini
// ========================

async function generateScene(idea) {
  generating = true;
  updateButton();

  setStatus(
    "Gemini 正在把你的想像變成場景…"
  );

  try {
    const response = await fetch(
      "/api/generate-svg",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ idea })
      }
    );

    // 先讀取文字，避免空回應直接解析失敗
    const raw = await response.text();

    let data;

    try {
      data = JSON.parse(raw);
    } catch (_) {
      throw new Error(
        "伺服器沒有回傳有效 JSON，請確認新版 server.js 已部署"
      );
    }

    if (!response.ok || !data.ok) {
      throw new Error(
        data.error ||
        `伺服器錯誤 HTTP ${response.status}`
      );
    }

    // 將 SVG 轉成圖片
    const svgBlob = new Blob(
      [data.svg],
      {
        type: "image/svg+xml;charset=utf-8"
      }
    );

    const url =
      URL.createObjectURL(svgBlob);

    try {
      const img = await new Promise(
        (resolve, reject) => {
          loadImage(
            url,
            resolve,
            () => reject(
              new Error("SVG 無法載入")
            )
          );
        }
      );

      sceneImage = img;
    } finally {
      URL.revokeObjectURL(url);
    }

    setStatus(
      "✨ 想像世界生成完成！可以繼續說新的想法"
    );

  } catch (error) {
    setStatus(
      "目前無法生成：" + error.message
    );

    console.error(error);

  } finally {
    generating = false;
    updateButton();
  }
}
