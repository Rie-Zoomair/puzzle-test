let uploadImg = null;
let capture = null;
let offscreen;

let activeSource = "upload";
const SINGLE_WIDTH = 400;
const CANVAS_HEIGHT = 565;

let needsUpdate = true;
let tilesNeedRebuild = false;
let frameSkip = 10;

let imageInput;
let contrastSlider, pixelSizeSlider, tileSizeSlider, ditherMode, shuffleBtn;
let uploadRadio, webcamRadio, downloadBtn;


let undoStack = [];
let redoStack = [];
let showSelectionGrid = true;

let tiles = [];
let cols, rows;
let hoveredTile = null;
let selectedTile = null;

let isSelecting = false;
let selectionStart = null;
let selectionEnd = null;

function setup() {
  let cnv = createCanvas(SINGLE_WIDTH * 2, CANVAS_HEIGHT);
  cnv.parent('canvas-holder');
  offscreen = createGraphics(SINGLE_WIDTH, CANVAS_HEIGHT);

  // UI elements
  imageInput = select('#imageInput');
  contrastSlider = select('#contrastSlider');
  pixelSizeSlider = select('#pixelSizeSlider');
  tileSizeSlider = select('#tileSizeSlider');
  ditherMode = select('#ditherMode');
  shuffleBtn = select('#shuffleBtn');
  uploadRadio = select('#uploadRadio');
  webcamRadio = select('#webcamRadio');
  downloadBtn = select('#downloadBtn');

  // Button logic
  uploadRadio.mousePressed(() => {
    activeSource = "upload";
    uploadRadio.addClass('active');
    webcamRadio.removeClass('active');
    stopWebcam();
    if (uploadImg) {
      needsUpdate = true;
      tilesNeedRebuild = true;
    }
  });
  
  
  webcamRadio.mousePressed(() => {
    activeSource = "webcam";
    webcamRadio.addClass('active');
    uploadRadio.removeClass('active');
    startWebcam();
    needsUpdate = true;
    tilesNeedRebuild = true;
  });
  
  imageInput.changed(onFileUploaded);
  contrastSlider.input(() => needsUpdate = true);
  pixelSizeSlider.input(() => needsUpdate = true);
  tileSizeSlider.input(() => {
    needsUpdate = true;
    tilesNeedRebuild = true;
  });
  ditherMode.changed(() => needsUpdate = true);
  shuffleBtn.mousePressed(shuffleTiles);
  downloadBtn.mousePressed(downloadHighResOutput);

  background(50);

  window.addEventListener('keydown', (event) => {
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const cmdOrCtrl = isMac ? event.metaKey : event.ctrlKey;
  
    // Undo/Redo
    if (cmdOrCtrl && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) {
        redo();
      } else {
        undo();
      }
    }
  
    // Toggle selection grid
    if (event.key.toLowerCase() === 'w') {
      showSelectionGrid = !showSelectionGrid;
    }
    // Download with 'S'
    if (event.key.toLowerCase() === 's') {
      event.preventDefault();
      downloadHighResOutput();
    }

    // Shuffle with Spacebar
    if (event.code === 'Space') {
      event.preventDefault();
      shuffleTiles();
  }
  });
  
}

function draw() {
  background(30);

  let sourceImg = getCurrentSourceImage();
  if (sourceImg) {
      drawSourceCover(sourceImg, SINGLE_WIDTH, CANVAS_HEIGHT, 0, 0);    
  }

  if (activeSource === "webcam" && capture && frameCount % frameSkip === 0) {
    let snap = getCurrentSourceImage();
    performDithering(snap);
  }

  if (needsUpdate && sourceImg) {
    performDithering(sourceImg);
    needsUpdate = false;
  }

  if (tilesNeedRebuild) {
    createTilesFromDithered(offscreen);
    tilesNeedRebuild = false;
  }

  drawTiles();
}

class Tile {
  constructor(homeX, homeY, w, h) {
    this.homeX = homeX;
    this.homeY = homeY;
    this.gridX = homeX;
    this.gridY = homeY;
    this.w = w;
    this.h = h;
    this.isActive = false;
    this.isEmpty = false;
    this.isDistorted = false;
    this.rotation = 0;
    this.scale = 1;
    this.isInverted = false;
    this.isMirrored = false;


  }

  getScreenX() {
    return SINGLE_WIDTH + this.gridX * this.w;
  }

  getScreenY() {
    return this.gridY * this.h;
  }

  draw(buffer) {
    if (this.isEmpty) return;
  
    push();
    translate(this.getScreenX() + this.w / 2, this.getScreenY() + this.h / 2);
  
    // REMOVE:
    // if (this.isMirrored) scale(-1, 1);
    // if (this.isInverted) drawingContext.filter = 'invert(1)';
  
    image(
      buffer,
      -this.w / 2,
      -this.h / 2,
      this.w,
      this.h,
      this.homeX * this.w,
      this.homeY * this.h,
      this.w,
      this.h
    );
  
    pop();
  
    // REMOVE:
    // if (this.isInverted) drawingContext.filter = 'none';
  
    if (this.isActive && showSelectionGrid) {
      noFill();
      stroke(0, 150, 255);
      strokeWeight(2);
      rect(this.getScreenX(), this.getScreenY(), this.w, this.h);
      noStroke();
    }    
  }
  
  
  

  contains(mx, my) {
    return mx > this.getScreenX() &&
           mx < this.getScreenX() + this.w &&
           my > this.getScreenY() &&
           my < this.getScreenY() + this.h;
  }

  intersectsSelection(selX, selY, selW, selH) {
    return !(
      this.getScreenX() + this.w < selX ||
      this.getScreenX() > selX + selW ||
      this.getScreenY() + this.h < selY ||
      this.getScreenY() > selY + selH
    );
  }  
}


function createTilesFromDithered(buffer) {
  tiles = [];

  let tileMultiplier = int(tileSizeSlider.value());
  cols = tileMultiplier * 4;
  let tileW = buffer.width / cols;
  let tileH = tileW * 1.41; // enforce A4 ratio on tile itself
  rows = floor(buffer.height / tileH);

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      let tile = new Tile(x, y, tileW, tileH);
      tiles.push(tile);
    }
  }
}

function drawSourceCover(img, targetW, targetH, x, y) {
  const imgAspect = img.width / img.height;
  const targetAspect = targetW / targetH;

  let srcW, srcH;
  if (imgAspect > targetAspect) {
    srcH = img.height;
    srcW = srcH * targetAspect;
  } else {
    srcW = img.width;
    srcH = srcW / targetAspect;
  }

  let sx = (img.width - srcW) / 2;
  let sy = (img.height - srcH) / 2;

  image(img, x, y, targetW, targetH, sx, sy, srcW, srcH);
}

function drawSourceCoverToOffscreen(img) {
  const gfx = offscreen;
  const imgAspect = img.width / img.height;
  const canvasAspect = gfx.width / gfx.height;

  let srcW, srcH;
  if (imgAspect > canvasAspect) {
    srcH = img.height;
    srcW = srcH * canvasAspect;
  } else {
    srcW = img.width;
    srcH = srcW / canvasAspect;
  }

  let sx = (img.width - srcW) / 2;
  let sy = (img.height - srcH) / 2;

  gfx.image(img, 0, 0, gfx.width, gfx.height, sx, sy, srcW, srcH);
}


function drawTiles() {
  hoveredTile = null;

  // Step 1: Find hovered tile
  for (let t of tiles) {
    if (t.contains(mouseX, mouseY)) {
      hoveredTile = t;
    }
  }

  // Step 2: Draw all tiles
  for (let t of tiles) {
    t.draw(offscreen);
  }

  // Step 3: Visual indicators

  // ➤ A. Show hover (before drag)
  if (hoveredTile && !selectedTile && !isSelecting) {
    noFill();
    stroke(255, 255, 0); // yellow
    strokeWeight(2);
    rect(hoveredTile.getScreenX(), hoveredTile.getScreenY(), hoveredTile.w, hoveredTile.h);
    noStroke();
  }

  // ➤ B. Show drop target (while dragging)
  if (hoveredTile && selectedTile && hoveredTile !== selectedTile) {
    noFill();
    stroke(0, 255, 0); // green
    strokeWeight(2);
    drawingContext.setLineDash([5, 5]);
    rect(hoveredTile.getScreenX(), hoveredTile.getScreenY(), hoveredTile.w, hoveredTile.h);
    drawingContext.setLineDash([]);
    noStroke();
  }

  // ➤ C. Show selected (dragged) tile
  if (selectedTile) {
    noFill();
    stroke(255, 255, 0); // yellow
    strokeWeight(2);
    rect(selectedTile.getScreenX(), selectedTile.getScreenY(), selectedTile.w, selectedTile.h);
    noStroke();
  }

  // ➤ D. Show selection area
  if (isSelecting && selectionStart && selectionEnd) {
    const x = min(selectionStart.x, selectionEnd.x);
    const y = min(selectionStart.y, selectionEnd.y);
    const w = abs(selectionEnd.x - selectionStart.x);
    const h = abs(selectionEnd.y - selectionStart.y);
    noFill();
    stroke(0, 255, 255); // cyan
    strokeWeight(2);
    rect(x, y, w, h);
    noStroke();
  }
}



function mousePressed() {
  if (keyIsDown(SHIFT)) {
    isSelecting = true;
    selectionStart = createVector(mouseX, mouseY);
    selectionEnd = null;
  } else {
    for (let t of tiles) {
      if (t.contains(mouseX, mouseY)) {
        selectedTile = t;
        break;
      }
    }
  }
}

function mouseDragged() {
  if (isSelecting && selectionStart) {
    selectionEnd = createVector(mouseX, mouseY);
  }
}

function mouseReleased() {
  if (isSelecting && selectionStart && selectionEnd) {
    const x = min(selectionStart.x, selectionEnd.x);
    const y = min(selectionStart.y, selectionEnd.y);
    const w = abs(selectionEnd.x - selectionStart.x);
    const h = abs(selectionEnd.y - selectionStart.y);

    for (let t of tiles) {
      t.isActive = t.intersectsSelection(x, y, w, h);
    }

    isSelecting = false;
    selectionStart = null;
    selectionEnd = null;
  } else if (selectedTile) {
    snapshotTiles();
    for (let t of tiles) {
      if (t.contains(mouseX, mouseY) && t !== selectedTile) {
        let tempX = t.gridX;
        let tempY = t.gridY;
        t.gridX = selectedTile.gridX;
        t.gridY = selectedTile.gridY;
        selectedTile.gridX = tempX;
        selectedTile.gridY = tempY;
        break;
      }
    }
    selectedTile = null;
  }
}

function shuffleTiles() {
  snapshotTiles();
  const activeTiles = tiles.filter(t => t.isActive);
  const gridPos = activeTiles.map(t => ({ x: t.gridX, y: t.gridY }));
  shuffleArray(gridPos);
  for (let i = 0; i < activeTiles.length; i++) {
    activeTiles[i].gridX = gridPos[i].x;
    activeTiles[i].gridY = gridPos[i].y;
  }
}

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    let j = floor(random(i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function getCurrentSourceImage() {
  if (activeSource === "upload") return uploadImg;
  if (activeSource === "webcam" && capture) {
    return getWebcamSnapshot();
  }
  return null;
}


function startWebcam() {
  if (!capture) {
    capture = createCapture({ video: true, audio: false }, (stream) => {
      console.log("Webcam stream ready");
    }, (err) => {
      console.error("Webcam error:", err);
    });
    capture.size(SINGLE_WIDTH, CANVAS_HEIGHT);
    capture.hide();
  }
}


function stopWebcam() {
  if (capture) {
    capture.remove();
    capture = null;
  }
}

function onFileUploaded() {
  let file = imageInput.elt.files[0];
  if (!file) return;
  let imgURL = URL.createObjectURL(file);
  loadImage(imgURL, (img) => {
    uploadImg = img;
    if (activeSource === "upload") {
      needsUpdate = true;
      tilesNeedRebuild = true;
    }
  });
}

function performDithering(srcImage) {
  offscreen.push();
  offscreen.clear();
  offscreen.clear();
  drawSourceCoverToOffscreen(srcImage);  
  offscreen.loadPixels();
  let contrastVal = int(contrastSlider.value());
  applyContrast(offscreen, contrastVal);
  offscreen.updatePixels();
  let pixSize = int(pixelSizeSlider.value());
  if (pixSize > 1) {
    offscreen.loadPixels();
    pixelateBlockAverage(offscreen, pixSize);
    offscreen.updatePixels();
  }
  offscreen.loadPixels();
  let mode = ditherMode.value();
  if (mode === 'atkinson') {
    doAtkinsonDither(offscreen);
  } else {
    doOrderedBayer8x8(offscreen);
  }
  offscreen.updatePixels();
  offscreen.pop();
}

function drawSourceCoverToBuffer(gfx, img) {
  const imgAspect = img.width / img.height;
  const canvasAspect = gfx.width / gfx.height;

  let srcW, srcH;
  if (imgAspect > canvasAspect) {
    srcH = img.height;
    srcW = srcH * canvasAspect;
  } else {
    srcW = img.width;
    srcH = srcW / canvasAspect;
  }

  let sx = (img.width - srcW) / 2;
  let sy = (img.height - srcH) / 2;

  gfx.image(img, 0, 0, gfx.width, gfx.height, sx, sy, srcW, srcH);
}


// -------------------- DITHERING HELPERS --------------------

function applyContrast(gfx, contrastVal) {
  let d = gfx.pixelDensity();
  let total = gfx.width * gfx.height * 4 * d * d;
  let factor = (259 * (contrastVal + 255)) / (255 * (259 - contrastVal));
  for (let i = 0; i < total; i += 4) {
    let r = gfx.pixels[i];
    let g = gfx.pixels[i + 1];
    let b = gfx.pixels[i + 2];
    r = factor * (r - 128) + 128;
    g = factor * (g - 128) + 128;
    b = factor * (b - 128) + 128;
    gfx.pixels[i] = constrain(r, 0, 255);
    gfx.pixels[i + 1] = constrain(g, 0, 255);
    gfx.pixels[i + 2] = constrain(b, 0, 255);
  }
}

function pixelateBlockAverage(gfx, pixelSize) {
  let w = gfx.width;
  let h = gfx.height;
  let d = gfx.pixelDensity();
  for (let startY = 0; startY < h * d; startY += pixelSize) {
    for (let startX = 0; startX < w * d; startX += pixelSize) {
      let sum = 0, count = 0;
      for (let dy = 0; dy < pixelSize; dy++) {
        for (let dx = 0; dx < pixelSize; dx++) {
          let x = startX + dx, y = startY + dy;
          if (x < w * d && y < h * d) {
            let idx = 4 * (y * w * d + x);
            let val = (gfx.pixels[idx] + gfx.pixels[idx + 1] + gfx.pixels[idx + 2]) / 3;
            sum += val;
            count++;
          }
        }
      }
      let avg = sum / count;
      for (let dy = 0; dy < pixelSize; dy++) {
        for (let dx = 0; dx < pixelSize; dx++) {
          let x = startX + dx, y = startY + dy;
          if (x < w * d && y < h * d) {
            let idx = 4 * (y * w * d + x);
            gfx.pixels[idx] = gfx.pixels[idx + 1] = gfx.pixels[idx + 2] = avg;
          }
        }
      }
    }
  }
}

function doAtkinsonDither(gfx) {
  let w = gfx.width, h = gfx.height, d = gfx.pixelDensity();
  let tw = w * d, th = h * d, threshold = 128;
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      let idx = 4 * (y * tw + x);
      let val = (gfx.pixels[idx] + gfx.pixels[idx + 1] + gfx.pixels[idx + 2]) / 3;
      let newVal = (val < threshold) ? 0 : 255;
      let err = val - newVal;
      gfx.pixels[idx] = gfx.pixels[idx + 1] = gfx.pixels[idx + 2] = newVal;
      distributeError(gfx, x + 1, y, err, 1 / 8, tw, th);
      distributeError(gfx, x + 2, y, err, 1 / 8, tw, th);
      distributeError(gfx, x - 1, y + 1, err, 1 / 8, tw, th);
      distributeError(gfx, x, y + 1, err, 1 / 8, tw, th);
      distributeError(gfx, x + 1, y + 1, err, 1 / 8, tw, th);
      distributeError(gfx, x, y + 2, err, 1 / 8, tw, th);
    }
  }
}

function doOrderedBayer8x8(gfx) {
  const bayer = [
    [0, 32, 8, 40, 2, 34, 10, 42],
    [48, 16, 56, 24, 50, 18, 58, 26],
    [12, 44, 4, 36, 14, 46, 6, 38],
    [60, 28, 52, 20, 62, 30, 54, 22],
    [3, 35, 11, 43, 1, 33, 9, 41],
    [51, 19, 59, 27, 49, 17, 57, 25],
    [15, 47, 7, 39, 13, 45, 5, 37],
    [63, 31, 55, 23, 61, 29, 53, 21]
  ];
  let w = gfx.width, h = gfx.height, d = gfx.pixelDensity();
  let tw = w * d, th = h * d;
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      let idx = 4 * (y * tw + x);
      let gray = (gfx.pixels[idx] + gfx.pixels[idx + 1] + gfx.pixels[idx + 2]) / 3;
      let threshold = bayer[y % 8][x % 8] * 4;
      let out = (gray < threshold) ? 0 : 255;
      gfx.pixels[idx] = gfx.pixels[idx + 1] = gfx.pixels[idx + 2] = out;
    }
  }
}

function distributeError(gfx, x, y, err, fraction, tw, th) {
  if (x < 0 || x >= tw || y < 0 || y >= th) return;
  let idx = 4 * (y * tw + x);
  let val = (gfx.pixels[idx] + gfx.pixels[idx + 1] + gfx.pixels[idx + 2]) / 3 + err * fraction;
  gfx.pixels[idx] = gfx.pixels[idx + 1] = gfx.pixels[idx + 2] = val;
}

function snapshotTiles() {
  const snapshot = tiles.map(t => ({
    gridX: t.gridX,
    gridY: t.gridY,
    isActive: t.isActive
  }));
  undoStack.push(snapshot);
  redoStack = []; // clear redo stack
}

function getWebcamSnapshot() {
  let gfx = createGraphics(SINGLE_WIDTH, CANVAS_HEIGHT);
  
  const imgAspect = capture.width / capture.height;
  const canvasAspect = gfx.width / gfx.height;

  let srcW, srcH;
  if (imgAspect > canvasAspect) {
    srcH = capture.height;
    srcW = srcH * canvasAspect;
  } else {
    srcW = capture.width;
    srcH = srcW / canvasAspect;
  }

  let sx = (capture.width - srcW) / 2;
  let sy = (capture.height - srcH) / 2;

  gfx.image(capture, 0, 0, gfx.width, gfx.height, sx, sy, srcW, srcH);
  return gfx.get(); // return cropped snapshot
}


function restoreTiles(snapshot) {
  for (let i = 0; i < tiles.length; i++) {
    tiles[i].gridX = snapshot[i].gridX;
    tiles[i].gridY = snapshot[i].gridY;
    tiles[i].isActive = snapshot[i].isActive;
  }
}

function undo() {
  if (undoStack.length > 0) {
    let currentState = tiles.map(t => ({
      gridX: t.gridX,
      gridY: t.gridY,
      isActive: t.isActive
    }));
    redoStack.push(currentState);
    let prevState = undoStack.pop();
    restoreTiles(prevState);
  }
}

function redo() {
  if (redoStack.length > 0) {
    let currentState = tiles.map(t => ({
      gridX: t.gridX,
      gridY: t.gridY,
      isActive: t.isActive
    }));
    undoStack.push(currentState);
    let nextState = redoStack.pop();
    restoreTiles(nextState);
  }
}


function downloadHighResOutput() {
  const scaleFactor = 6;
  const outputW = SINGLE_WIDTH * scaleFactor;
  const outputH = CANVAS_HEIGHT * scaleFactor;

  let highRes = createGraphics(outputW, outputH);
  highRes.pixelDensity(1);

  for (let t of tiles) {
    if (t.isEmpty) continue;

    let tw = outputW / cols;
    let th = tw * 1.41;

    let sx = t.homeX * offscreen.width / cols;
    let sy = t.homeY * offscreen.height / rows;
    let sw = offscreen.width / cols;
    let sh = offscreen.height / rows;

    let dx = t.gridX * tw;
    let dy = t.gridY * th;

    highRes.push();
    highRes.translate(dx + tw / 2, dy + th / 2);
    highRes.image(
      offscreen,
      -tw / 2, -th / 2, tw, th,
      sx, sy, sw, sh
    );
    highRes.pop();
  }

  // Create a temporary canvas and draw the high-res buffer onto it
  let tempCanvas = document.createElement('canvas');
  tempCanvas.width = outputW;
  tempCanvas.height = outputH;
  let ctx = tempCanvas.getContext('2d');
  ctx.drawImage(highRes.elt, 0, 0);

  // Convert canvas to blob and trigger download
  tempCanvas.toBlob(function(blob) {
    let a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'identity_output.png';
    a.click();
    URL.revokeObjectURL(a.href);
  });
}
