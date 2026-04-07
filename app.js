const MAX_COLORS     = 16;
const GRID_W_DESKTOP = 160; // cells wide on desktop — fine enough to follow actual silhouette curves
const GRID_W_MOBILE  = 80;  // cells wide on mobile

let gameState = {
    quantPixels:      [],  // [y][x] → palette color index (Int16Array rows)
    regionLabel:      [],  // [y][x] → region ID (Int32Array rows)
    regionColor:      {},  // region ID → palette color index
    regionActualColor:{},  // region ID → {r,g,b} true average color from original image
    regionSizes:      {},  // region ID → cell count (post-merge)
    regionRepCells:   {},  // region ID → {x,y} in grid coords for number placement
    colorTotals:      [],  // palette index → total cell count
    colorsCompleted:  new Set(),
    palette:          [],
    selectedColor:    null,
    paintedRegions:   new Set(),
    workW: 0,
    workH: 0,
    S:     10,  // display scale: pixels per grid cell (computed dynamically)
    cellData: null, // Uint8ClampedArray — per-cell actual RGBA from original image
};

document.addEventListener('DOMContentLoaded', () => {
    setupUI();
});

function isMobile() {
    return window.matchMedia('(max-width: 768px)').matches
        || window.matchMedia('(max-height: 500px) and (orientation: landscape)').matches;
}

function setupUI() {
    const dropZone   = document.getElementById('drop-zone');
    const imageInput = document.getElementById('image-input');

    dropZone.addEventListener('click', () => imageInput.click());

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.style.borderColor = 'var(--primary-color)';
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.style.borderColor = 'var(--secondary-color)';
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.style.borderColor = 'var(--secondary-color)';
        if (e.dataTransfer.files.length) handleImage(e.dataTransfer.files[0]);
    });

    imageInput.addEventListener('change', (e) => {
        if (e.target.files.length) handleImage(e.target.files[0]);
    });

    document.getElementById('reset-button').addEventListener('click', resetGame);

    document.getElementById('download-button').addEventListener('click', () => {
        if (!gameState.paintedRegions.size) {
            alert('Paint something first! 🎨');
            return;
        }
        const { quantPixels, regionLabel, workW, workH, palette, paintedRegions, regionActualColor, S } = gameState;
        const canvasW = workW * S;
        const canvasH = workH * S;

        const saveCanvas    = document.createElement('canvas');
        saveCanvas.width    = canvasW;
        saveCanvas.height   = canvasH;
        const sCtx    = saveCanvas.getContext('2d');
        const imgData = sCtx.createImageData(canvasW, canvasH);
        const pix     = imgData.data;

        const sp = (dx, dy, r, g, b) => {
            const i = (dy * canvasW + dx) * 4;
            pix[i] = r; pix[i+1] = g; pix[i+2] = b; pix[i+3] = 255;
        };

        const cellData = gameState.cellData;

        // Pass 1: fill blocks
        for (let wy = 0; wy < workH; wy++) {
            for (let wx = 0; wx < workW; wx++) {
                const ci  = quantPixels[wy][wx];
                if (ci < 0) continue;
                const rid = regionLabel[wy][wx];
                let r, g, b;
                if (paintedRegions.has(rid)) {
                    const p  = (wy * workW + wx) * 4;
                    r = cellData ? cellData[p]   : (regionActualColor[rid] || palette[ci]).r;
                    g = cellData ? cellData[p+1] : (regionActualColor[rid] || palette[ci]).g;
                    b = cellData ? cellData[p+2] : (regionActualColor[rid] || palette[ci]).b;
                } else {
                    const p  = (wy * workW + wx) * 4;
                    const cr = cellData ? cellData[p]   : 220;
                    const cg = cellData ? cellData[p+1] : 220;
                    const cb = cellData ? cellData[p+2] : 220;
                    const gray = cr * 0.299 + cg * 0.587 + cb * 0.114;
                    const shade = Math.round(255 - (255 - gray) * 0.15);
                    r = shade; g = shade; b = shade;
                }
                for (let sy = 0; sy < S; sy++)
                    for (let sx = 0; sx < S; sx++)
                        sp(wx*S+sx, wy*S+sy, r, g, b);
            }
        }

        // Pass 2: 2px coloring-book borders (one pixel each side of boundary)
        for (let wy = 0; wy < workH; wy++) {
            for (let wx = 0; wx < workW; wx++) {
                const ci = quantPixels[wy][wx];
                if (wx + 1 < workW && quantPixels[wy][wx+1] !== ci) {
                    for (let sy = 0; sy < S; sy++) {
                        sp(wx*S + S - 1, wy*S+sy, 50, 50, 50);
                        sp((wx+1)*S,     wy*S+sy, 50, 50, 50);
                    }
                }
                if (wy + 1 < workH && quantPixels[wy+1][wx] !== ci) {
                    for (let sx = 0; sx < S; sx++) {
                        sp(wx*S+sx, wy*S + S - 1, 50, 50, 50);
                        sp(wx*S+sx, (wy+1)*S,     50, 50, 50);
                    }
                }
            }
        }
        for (let d = 0; d < canvasW; d++) { sp(d, 0, 30, 30, 30); sp(d, canvasH-1, 30, 30, 30); }
        for (let d = 0; d < canvasH; d++) { sp(0, d, 30, 30, 30); sp(canvasW-1, d, 30, 30, 30); }

        sCtx.putImageData(imgData, 0, 0);

        const link      = document.createElement('a');
        link.download   = 'my-masterpiece.png';
        link.href       = saveCanvas.toDataURL('image/png');
        link.click();
    });

    const canvas = document.getElementById('paint-canvas');
    canvas.addEventListener('click',      handleCanvasClick);
    canvas.addEventListener('mousemove',  handleCanvasMouseMove);
    canvas.addEventListener('mouseleave', () => { canvas.style.cursor = 'crosshair'; });
    canvas.addEventListener('touchstart', handleCanvasTouch, { passive: false });

    setupMobilePalette();
}

function setupMobilePalette() {
    const fab      = document.getElementById('mobile-palette-fab');
    const popup    = document.getElementById('mobile-palette-popup');
    const overlay  = document.getElementById('mobile-palette-overlay');
    const closeBtn = document.getElementById('mobile-palette-close');

    fab.addEventListener('click', () => {
        popup.classList.remove('hidden');
        popup.classList.add('visible');
        overlay.classList.remove('hidden');
        overlay.classList.add('visible');
    });

    function closePalette() {
        popup.classList.add('hidden');   popup.classList.remove('visible');
        overlay.classList.add('hidden'); overlay.classList.remove('visible');
    }
    closeBtn.addEventListener('click', closePalette);
    overlay.addEventListener('click',  closePalette);
}

function showMobileFab() {
    const fab = document.getElementById('mobile-palette-fab');
    fab.classList.remove('hidden');
    fab.classList.add('visible');
}

function hideMobileFab() {
    const fab = document.getElementById('mobile-palette-fab');
    fab.classList.add('hidden');
    fab.classList.remove('visible');
    document.getElementById('mobile-palette-popup').classList.add('hidden');
    document.getElementById('mobile-palette-popup').classList.remove('visible');
    document.getElementById('mobile-palette-overlay').classList.add('hidden');
    document.getElementById('mobile-palette-overlay').classList.remove('visible');
}

function updateMobileFabColor() {
    const fab     = document.getElementById('mobile-palette-fab');
    const preview = fab.querySelector('.fab-swatch-preview');
    if (gameState.selectedColor !== null) {
        const c = gameState.palette[gameState.selectedColor];
        preview.style.backgroundColor = `rgb(${c.r},${c.g},${c.b})`;
        fab.classList.add('has-color');
    } else {
        fab.classList.remove('has-color');
    }
}

function handleCanvasTouch(e) {
    e.preventDefault();
    const touch      = e.touches[0];
    const clickEvent = new MouseEvent('click', { clientX: touch.clientX, clientY: touch.clientY });
    e.target.dispatchEvent(clickEvent);
}

function handleImage(file) {
    if (!file.type.startsWith('image/')) {
        alert("Please pick a picture file!");
        return;
    }
    document.getElementById('upload-section').classList.add('hidden');
    document.getElementById('workspace-section').classList.remove('hidden');
    if (isMobile()) showMobileFab();

    const reader = new FileReader();
    reader.onload = (e) => {
        const img    = new Image();
        img.onload   = () => { setTimeout(() => processImage(img), 50); };
        img.src      = e.target.result;
        const refImg = document.getElementById('reference-image');
        refImg.src   = e.target.result;
        refImg.classList.remove('hidden');
    };
    reader.readAsDataURL(file);
}

// ─────────────────────────────────────────────────────────────────────────────
// processImage — grid mosaic approach
//   • Image is downsampled to a small grid (80×N desktop, 40×N mobile)
//   • Each grid cell = hardware-averaged block of original pixels → accurate color
//   • Connected same-color cells form regions → BFS on the tiny grid is fast
//   • Display scale S fills the available screen width automatically
// ─────────────────────────────────────────────────────────────────────────────
function processImage(img) {
    const processingCanvas = document.getElementById('processing-canvas');
    const ctx = processingCanvas.getContext('2d', { willReadFrequently: true });

    const mobile      = isMobile();
    const isLandscape = window.matchMedia('(max-height: 500px) and (orientation: landscape)').matches;
    const minRegion   = mobile ? 60 : 120; // cells — larger regions absorb small same-color fragments

    // Available screen area
    let availW, availH;
    if (mobile && !isLandscape) {
        availH = window.innerHeight - 210;
        availW = window.innerWidth  - 8;
    } else if (mobile && isLandscape) {
        availH = window.innerHeight - 50;
        availW = window.innerWidth  - 8;
    } else {
        availW = Math.min(window.innerWidth  - 60, 1400);
        availH = Math.min(window.innerHeight - 150, 900);
    }

    // Grid size: fixed cell count, aspect ratio preserved
    const imgAspect = img.width / img.height;
    let workW = mobile ? GRID_W_MOBILE : GRID_W_DESKTOP;
    let workH = Math.round(workW / imgAspect);

    // Display scale: fill available width, minimum 6px per cell
    let S = Math.max(6, Math.floor(availW / workW));

    // Clamp height — reduce grid rows if canvas would be too tall
    if (workH * S > availH) {
        workH = Math.floor(availH / S);
        workW = Math.round(workH * imgAspect);
        S = Math.max(6, Math.floor(availW / workW));
    }
    workW = Math.max(10, workW);
    workH = Math.max(10, workH);

    // ── 1. Grid-resolution draw (for display tinted grayscale + regionActualColor) ──
    processingCanvas.width  = workW;
    processingCanvas.height = workH;
    ctx.drawImage(img, 0, 0, workW, workH);
    const pixelData     = ctx.getImageData(0, 0, workW, workH).data;
    const origPixelData = pixelData;

    // ── 2. High-res draw for edge-accurate quantisation ──
    // Each grid cell is sampled at superScale×superScale sub-pixels.
    // The palette colour that wins the MAJORITY VOTE is assigned to the cell.
    // This prevents boundary cells (cat/background edge) from getting a blended
    // average colour that maps to the wrong palette entry.
    const superScale = 4;
    const hiW = workW * superScale, hiH = workH * superScale;
    processingCanvas.width  = hiW;
    processingCanvas.height = hiH;
    ctx.drawImage(img, 0, 0, hiW, hiH);
    const hiPixelData = ctx.getImageData(0, 0, hiW, hiH).data;

    const totalPx = workW * workH;

    // Sample colors for palette building (from grid-res — fast)
    const step         = Math.max(1, Math.floor(totalPx / 8000));
    const sampleColors = [];
    for (let i = 0; i < totalPx; i += step) {
        const p = i * 4;
        if (pixelData[p + 3] > 128)
            sampleColors.push({ r: pixelData[p], g: pixelData[p+1], b: pixelData[p+2] });
    }
    if (sampleColors.length === 0) sampleColors.push({ r: 128, g: 128, b: 128 });

    // Build palette: median cut gives deterministic coverage, k-means snaps centroids
    const mcPalette  = medianCut(sampleColors, MAX_COLORS);
    const rawPalette = kMeans(sampleColors, MAX_COLORS, mcPalette);

    // ── Merge perceptually similar palette colours ──
    // Without this, the palette contains e.g. 5 shades of beige that create
    // confusing micro-regions within the cat.  By merging colours within
    // RGB distance 35 we get fewer, visually distinct palette entries →
    // larger, cleaner regions that are easy for kids to tap.
    const palette = mergeSimilarPaletteColors(rawPalette, 20);

    // Per-pixel nearest-palette assignment with cache
    const nearestCache = new Map();
    const cachedNearest = (r, g, b) => {
        const key = (r << 16) | (g << 8) | b;
        let idx   = nearestCache.get(key);
        if (idx === undefined) {
            idx = findNearestColorIndex(r, g, b, palette);
            nearestCache.set(key, idx);
        }
        return idx;
    };

    // ── 3. Majority-vote quantisation ──
    // For each grid cell, check superScale×superScale sub-pixels in the hi-res image.
    // Assign the palette colour that appears most often → sharp silhouette edges.
    const quantPixels = [];
    const subCount    = superScale * superScale;
    const votes       = new Int32Array(palette.length);
    for (let y = 0; y < workH; y++) {
        const row = new Int16Array(workW);
        for (let x = 0; x < workW; x++) {
            votes.fill(0);
            let transparent = 0;
            for (let sy = 0; sy < superScale; sy++) {
                for (let sx = 0; sx < superScale; sx++) {
                    const hx = x * superScale + sx;
                    const hy = y * superScale + sy;
                    const hp = (hy * hiW + hx) * 4;
                    if (hiPixelData[hp + 3] < 128) { transparent++; continue; }
                    votes[cachedNearest(hiPixelData[hp], hiPixelData[hp+1], hiPixelData[hp+2])]++;
                }
            }
            if (transparent > subCount / 2) { row[x] = -1; continue; }
            let bestCI = 0, bestV = votes[0];
            for (let i = 1; i < palette.length; i++) {
                if (votes[i] > bestV) { bestV = votes[i]; bestCI = i; }
            }
            row[x] = bestCI;
        }
        quantPixels.push(row);
    }

    // Label connected regions via BFS (4-connectivity)
    const { regionLabel, regionColor, regionSizes, regionCells } =
        labelRegions(quantPixels, workW, workH);

    // Merge regions that are too small to tap comfortably
    mergeSmallPixelRegions(quantPixels, regionLabel, regionColor, regionSizes, regionCells, workW, workH, minRegion);

    // Compact palette — drop colours with zero pixels after merging
    const usedSet = new Set();
    for (let y = 0; y < workH; y++)
        for (let x = 0; x < workW; x++)
            if (quantPixels[y][x] >= 0) usedSet.add(quantPixels[y][x]);

    const oldToNew      = {};
    const compactPalette = [];
    palette.forEach((color, i) => {
        if (usedSet.has(i)) { oldToNew[i] = compactPalette.length; compactPalette.push(color); }
    });
    for (let y = 0; y < workH; y++)
        for (let x = 0; x < workW; x++)
            if (quantPixels[y][x] >= 0) quantPixels[y][x] = oldToNew[quantPixels[y][x]];
    for (const rid in regionColor)
        if (regionColor[rid] >= 0 && oldToNew[regionColor[rid]] !== undefined)
            regionColor[rid] = oldToNew[regionColor[rid]];

    // Compute colorTotals and per-region centroids from final pixel data
    const colorTotals   = new Array(compactPalette.length).fill(0);
    const regionRepCells = {};
    const finalSizes    = {};
    const repAccum      = {}; // rid → {sumX, sumY, count}

    for (let y = 0; y < workH; y++) {
        for (let x = 0; x < workW; x++) {
            const ci  = quantPixels[y][x];
            const rid = regionLabel[y][x];
            if (ci < 0 || rid < 0) continue;
            colorTotals[ci]++;
            finalSizes[rid] = (finalSizes[rid] || 0) + 1;
            if (!repAccum[rid]) repAccum[rid] = { sumX: 0, sumY: 0, count: 0, cells: [] };
            repAccum[rid].sumX += x;
            repAccum[rid].sumY += y;
            repAccum[rid].count++;
            repAccum[rid].cells.push({ x, y });
        }
    }

    for (const ridStr in repAccum) {
        const { sumX, sumY, count, cells } = repAccum[ridStr];
        const avgX = sumX / count, avgY = sumY / count;
        let best = cells[0], bestDist = Infinity;
        for (const c of cells) {
            const d = (c.x - avgX) ** 2 + (c.y - avgY) ** 2;
            if (d < bestDist) { bestDist = d; best = c; }
        }
        regionRepCells[ridStr] = best;
    }

    // Compute per-region actual colour from the ORIGINAL (unblurred) pixels.
    // When a region is painted, this colour is used — not the muted centroid from
    // quantisation — so the fully-painted canvas looks faithful to the source photo.
    const regionActualColor = {};
    const colorAccum        = {};
    for (let y = 0; y < workH; y++) {
        for (let x = 0; x < workW; x++) {
            const rid = regionLabel[y][x];
            if (rid < 0) continue;
            if (!colorAccum[rid]) colorAccum[rid] = { r: 0, g: 0, b: 0, n: 0 };
            const p = (y * workW + x) * 4;
            colorAccum[rid].r += origPixelData[p];
            colorAccum[rid].g += origPixelData[p + 1];
            colorAccum[rid].b += origPixelData[p + 2];
            colorAccum[rid].n++;
        }
    }
    for (const rid in colorAccum) {
        const { r, g, b, n } = colorAccum[rid];
        regionActualColor[rid] = { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) };
    }

    gameState.quantPixels      = quantPixels;
    gameState.regionLabel      = regionLabel;
    gameState.regionColor      = regionColor;
    gameState.regionActualColor= regionActualColor;
    gameState.regionSizes      = finalSizes;
    gameState.regionRepCells   = regionRepCells;
    gameState.colorTotals      = colorTotals;
    gameState.palette          = compactPalette;
    gameState.workW            = workW;
    gameState.workH            = workH;
    gameState.S                = S;
    gameState.cellData         = pixelData;
    gameState.paintedRegions   = new Set();
    gameState.selectedColor    = null;
    gameState.colorsCompleted  = new Set();

    drawGameCanvas();
    buildPaletteUI();
}

// ─── Merge perceptually similar palette colours ─────────────────────────────
// Eliminates near-duplicate entries (e.g. five shades of beige → one beige)
// so quantisation produces larger, cleaner regions for kids to paint.
function mergeSimilarPaletteColors(palette, threshold) {
    const colors = palette.map(c => ({ ...c }));
    const alive  = new Array(colors.length).fill(true);
    // parent[i] = canonical index for colour i
    const parent = colors.map((_, i) => i);

    const find = (i) => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };

    // Greedily merge closest pairs below threshold
    let changed = true;
    while (changed) {
        changed = false;
        for (let i = 0; i < colors.length; i++) {
            if (!alive[i]) continue;
            for (let j = i + 1; j < colors.length; j++) {
                if (!alive[j]) continue;
                const lab_i = rgbToLab(colors[i].r, colors[i].g, colors[i].b);
                const lab_j = rgbToLab(colors[j].r, colors[j].g, colors[j].b);
                const dL = lab_i[0]-lab_j[0], da = lab_i[1]-lab_j[1], dbb = lab_i[2]-lab_j[2];
                if (Math.sqrt(dL*dL + da*da + dbb*dbb) < threshold) {
                    // Average in LAB, convert back to RGB
                    const merged = labToRgb(
                        (lab_i[0]+lab_j[0])/2, (lab_i[1]+lab_j[1])/2, (lab_i[2]+lab_j[2])/2);
                    colors[i].r = merged.r; colors[i].g = merged.g; colors[i].b = merged.b;
                    alive[j] = false;
                    parent[j] = i;
                    changed = true;
                }
            }
        }
    }
    // Compact into new palette
    const compacted  = [];
    const oldToNew   = {};
    for (let i = 0; i < colors.length; i++) {
        if (alive[i]) { oldToNew[i] = compacted.length; compacted.push(colors[i]); }
    }
    return compacted;
}

// ─── BFS region labelling ────────────────────────────────────────────────────
function labelRegions(quantPixels, workW, workH) {
    const regionLabel = Array.from({ length: workH }, () => new Int32Array(workW).fill(-1));
    const regionColor = {};
    const regionSizes = {};
    const regionCells = {};
    let nextId        = 0;

    for (let sy = 0; sy < workH; sy++) {
        for (let sx = 0; sx < workW; sx++) {
            if (regionLabel[sy][sx] !== -1) continue;
            const color = quantPixels[sy][sx];
            if (color < 0) continue;

            const rid   = nextId++;
            const cells = [];
            const queue = [{ x: sx, y: sy }];
            regionLabel[sy][sx] = rid;
            let head = 0;

            while (head < queue.length) {
                const { x, y } = queue[head++];
                cells.push({ x, y });
                for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
                    const nx = x + dx, ny = y + dy;
                    if (nx >= 0 && nx < workW && ny >= 0 && ny < workH
                        && regionLabel[ny][nx] === -1
                        && quantPixels[ny][nx] === color) {
                        regionLabel[ny][nx] = rid;
                        queue.push({ x: nx, y: ny });
                    }
                }
            }
            regionColor[rid] = color;
            regionSizes[rid] = cells.length;
            regionCells[rid] = cells;
        }
    }
    return { regionLabel, regionColor, regionSizes, regionCells };
}

// ─── Merge pixel-level regions that are too small to tap ────────────────────
function mergeSmallPixelRegions(quantPixels, regionLabel, regionColor, regionSizes, regionCells, workW, workH, minSize) {
    for (let pass = 0; pass < 30; pass++) {
        const smallIds = Object.keys(regionSizes)
            .map(Number)
            .filter(rid => regionSizes[rid] > 0 && regionSizes[rid] < minSize);

        if (smallIds.length === 0) break;
        let changed = false;

        for (const rid of smallIds) {
            const cells = regionCells[rid];
            if (!cells || regionSizes[rid] === 0 || regionSizes[rid] >= minSize) continue;

            // Count border pixels shared with each neighbouring region
            const borderCount = {};
            for (const { x, y } of cells) {
                for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
                    const nx = x + dx, ny = y + dy;
                    if (nx >= 0 && nx < workW && ny >= 0 && ny < workH) {
                        const nid = regionLabel[ny][nx];
                        if (nid >= 0 && nid !== rid && regionSizes[nid] > 0)
                            borderCount[nid] = (borderCount[nid] || 0) + 1;
                    }
                }
            }

            let bestNid = -1, bestCount = 0;
            for (const [nidStr, cnt] of Object.entries(borderCount)) {
                const nid = Number(nidStr);
                if (cnt > bestCount) { bestCount = cnt; bestNid = nid; }
            }
            if (bestNid < 0) continue;

            // Absorb this region into bestNid
            const bestColor = regionColor[bestNid];
            for (const { x, y } of cells) {
                quantPixels[y][x] = bestColor;
                regionLabel[y][x] = bestNid;
            }
            if (!regionCells[bestNid]) regionCells[bestNid] = [];
            for (const c of cells) regionCells[bestNid].push(c);
            regionSizes[bestNid] += cells.length;
            regionSizes[rid]      = 0;
            regionCells[rid]      = [];
            changed               = true;
        }
        if (!changed) break;
    }
}

// ─── Render the paint-by-numbers canvas ─────────────────────────────────────
function drawGameCanvas() {
    const { quantPixels, regionLabel, workW, workH, palette, paintedRegions, regionActualColor, S } = gameState;
    if (!quantPixels.length || !S) return;
    const canvasW = workW * S;
    const canvasH = workH * S;

    const canvas  = document.getElementById('paint-canvas');
    canvas.width  = canvasW;
    canvas.height = canvasH;

    const ctx     = canvas.getContext('2d');
    const imgData = ctx.createImageData(canvasW, canvasH);
    const pix     = imgData.data; // Uint8ClampedArray

    // Inline helper — set one display pixel
    const sp = (dx, dy, r, g, b) => {
        const i = (dy * canvasW + dx) * 4;
        pix[i] = r; pix[i+1] = g; pix[i+2] = b; pix[i+3] = 255;
    };

    const { cellData } = gameState;

    // Pass 1 — fill each cell's S×S block
    for (let wy = 0; wy < workH; wy++) {
        for (let wx = 0; wx < workW; wx++) {
            const ci  = quantPixels[wy][wx];
            if (ci < 0) continue;
            const rid = regionLabel[wy][wx];
            let r, g, b;
            if (paintedRegions.has(rid)) {
                // Painted: each cell shows its OWN original colour (not region avg)
                // → fully-painted canvas = pixelated version of original photo
                const p  = (wy * workW + wx) * 4;
                r = cellData ? cellData[p]   : (regionActualColor[rid] || palette[ci]).r;
                g = cellData ? cellData[p+1] : (regionActualColor[rid] || palette[ci]).g;
                b = cellData ? cellData[p+2] : (regionActualColor[rid] || palette[ci]).b;
            } else {
                // Unpainted: mostly white with very subtle grey shadows (15%).
                // Just enough to see the subject's form (stripes, eyes, shadows)
                // without revealing colour — like a faint pencil sketch.
                const p  = (wy * workW + wx) * 4;
                const cr = cellData ? cellData[p]   : 220;
                const cg = cellData ? cellData[p+1] : 220;
                const cb = cellData ? cellData[p+2] : 220;
                const gray = cr * 0.299 + cg * 0.587 + cb * 0.114;
                const shade = Math.round(255 - (255 - gray) * 0.15);
                r = shade; g = shade; b = shade;
            }
            for (let sy = 0; sy < S; sy++)
                for (let sx = 0; sx < S; sx++)
                    sp(wx*S+sx, wy*S+sy, r, g, b);
        }
    }

    // Pass 2 — 2px coloring-book borders: one pixel on each side of every region boundary
    for (let wy = 0; wy < workH; wy++) {
        for (let wx = 0; wx < workW; wx++) {
            const ci = quantPixels[wy][wx];
            if (wx + 1 < workW && quantPixels[wy][wx+1] !== ci) {
                // Right edge of left cell + left edge of right cell = 2px centred on boundary
                for (let sy = 0; sy < S; sy++) {
                    sp(wx*S + S - 1, wy*S+sy, 50, 50, 50);
                    sp((wx+1)*S,     wy*S+sy, 50, 50, 50);
                }
            }
            if (wy + 1 < workH && quantPixels[wy+1][wx] !== ci) {
                // Bottom edge of top cell + top edge of bottom cell = 2px centred on boundary
                for (let sx = 0; sx < S; sx++) {
                    sp(wx*S+sx, wy*S + S - 1, 50, 50, 50);
                    sp(wx*S+sx, (wy+1)*S,     50, 50, 50);
                }
            }
        }
    }

    // Canvas border
    for (let d = 0; d < canvasW; d++) { sp(d, 0, 30, 30, 30); sp(d, canvasH-1, 30, 30, 30); }
    for (let d = 0; d < canvasH; d++) { sp(0, d, 30, 30, 30); sp(canvasW-1, d, 30, 30, 30); }

    ctx.putImageData(imgData, 0, 0);

    // Draw region numbers at each region's representative cell
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';

    for (const ridStr in gameState.regionRepCells) {
        const rid             = parseInt(ridStr);
        const { x: wx, y: wy } = gameState.regionRepCells[rid];
        const ci              = quantPixels[wy][wx];
        if (ci < 0 || paintedRegions.has(rid)) continue;

        const regionSize = gameState.regionSizes[rid] || 1;
        const numSize    = Math.max(11, Math.min(Math.sqrt(regionSize) * S * 0.45, 28));
        const cx         = wx * S + Math.floor(S / 2);
        const cy         = wy * S + Math.floor(S / 2);
        const isSelected = gameState.selectedColor === ci;

        // White halo for all states — makes numbers readable on any background
        ctx.strokeStyle = 'rgba(255,255,255,0.95)';
        ctx.lineWidth   = 3.5;

        if (isSelected) {
            ctx.font = `900 ${Math.round(numSize * 1.2)}px 'Nunito'`;
            ctx.strokeText(ci + 1, cx, cy);
            ctx.fillStyle = '#FF4757';
        } else if (gameState.selectedColor !== null) {
            ctx.font = `bold ${Math.round(numSize)}px 'Nunito'`;
            ctx.strokeText(ci + 1, cx, cy);
            ctx.fillStyle = 'rgba(80,100,120,0.4)';
        } else {
            ctx.font = `bold ${Math.round(numSize)}px 'Nunito'`;
            ctx.strokeText(ci + 1, cx, cy);
            ctx.fillStyle = '#1a1a2e';
        }
        ctx.fillText(ci + 1, cx, cy);
    }
}

// ─── Colour palette UI ───────────────────────────────────────────────────────
function buildPaletteUI() {
    const container       = document.getElementById('color-palette');
    container.innerHTML   = '';
    const mobileContainer = document.getElementById('mobile-color-palette');
    if (mobileContainer) mobileContainer.innerHTML = '';

    gameState.palette.forEach((color, index) => {
        const brightness = (color.r * 299 + color.g * 587 + color.b * 114) / 1000;
        const textColor  = brightness > 128 ? '#2F3542' : '#FFFFFF';

        function createSwatch() {
            const swatch          = document.createElement('div');
            swatch.className      = 'color-swatch';
            swatch.style.backgroundColor = `rgb(${color.r},${color.g},${color.b})`;
            swatch.innerText      = index + 1;
            swatch.style.color    = textColor;

            if (gameState.colorsCompleted.has(index)) swatch.classList.add('completed');
            if (gameState.selectedColor === index)    swatch.classList.add('active');

            swatch.addEventListener('click', () => {
                document.querySelectorAll('.color-swatch').forEach(el => el.classList.remove('active'));
                gameState.selectedColor = index;
                document.querySelectorAll('.color-swatch').forEach(el => {
                    if (el.innerText == String(index + 1)) el.classList.add('active');
                });
                document.getElementById('paint-canvas').style.cursor = 'crosshair';
                updateMobileFabColor();
                updateProgressBar();
                if (isMobile()) {
                    document.getElementById('mobile-palette-popup').classList.add('hidden');
                    document.getElementById('mobile-palette-popup').classList.remove('visible');
                    document.getElementById('mobile-palette-overlay').classList.add('hidden');
                    document.getElementById('mobile-palette-overlay').classList.remove('visible');
                }
                drawGameCanvas();
            });
            return swatch;
        }

        container.appendChild(createSwatch());
        if (mobileContainer) mobileContainer.appendChild(createSwatch());
    });
}

// ─── Progress bar ────────────────────────────────────────────────────────────
function updateProgressBar() {
    const bar = document.getElementById('color-progress');
    if (!bar) return;

    if (gameState.selectedColor === null || !gameState.quantPixels.length) {
        bar.classList.add('hidden');
        return;
    }

    const colorIdx = gameState.selectedColor;
    const total    = gameState.colorTotals[colorIdx] || 0;
    if (total === 0) return;

    // Count painted pixels for this color (sum sizes of painted regions with this color)
    let painted = 0;
    for (const ridStr in gameState.regionColor) {
        const rid = parseInt(ridStr);
        if (gameState.regionColor[rid] === colorIdx && gameState.paintedRegions.has(rid))
            painted += gameState.regionSizes[rid] || 0;
    }

    const pct  = Math.round((painted / total) * 100);
    const left = total - painted;
    const c    = gameState.palette[colorIdx];
    const cs   = `rgb(${c.r},${c.g},${c.b})`;

    document.getElementById('cp-swatch').style.backgroundColor = cs;
    document.getElementById('cp-fill').style.backgroundColor   = cs;
    document.getElementById('cp-fill').style.width             = `${pct}%`;
    document.getElementById('cp-name').textContent             = `Color ${colorIdx + 1}`;

    if (pct >= 100) {
        document.getElementById('cp-remaining').textContent = 'All done! 🌟';
        document.getElementById('cp-pct').textContent       = '🎉';
        bar.classList.remove('cp-complete');
        void bar.offsetWidth;
        bar.classList.add('cp-complete');
    } else {
        document.getElementById('cp-remaining').textContent = `${left} pixels left`;
        document.getElementById('cp-pct').textContent       = `${pct}%`;
        bar.classList.remove('cp-complete');
    }
    bar.classList.remove('hidden');
}

// ─── Win condition ───────────────────────────────────────────────────────────
function checkWinCondition() {
    const colorIdx = gameState.selectedColor;

    // Check if the just-painted colour is now complete
    if (colorIdx !== null && !gameState.colorsCompleted.has(colorIdx)) {
        let painted = 0;
        for (const ridStr in gameState.regionColor) {
            const rid = parseInt(ridStr);
            if (gameState.regionColor[rid] === colorIdx && gameState.paintedRegions.has(rid))
                painted += gameState.regionSizes[rid] || 0;
        }
        if (painted >= (gameState.colorTotals[colorIdx] || 0)) {
            gameState.colorsCompleted.add(colorIdx);
            confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 }, zIndex: 9999 });
            buildPaletteUI();
        }
    }

    // Check full win
    const totalRegions   = Object.keys(gameState.regionSizes).filter(r => gameState.regionSizes[r] > 0).length;
    if (gameState.paintedRegions.size >= totalRegions) {
        setTimeout(() => {
            const duration     = 3000;
            const animationEnd = Date.now() + duration;
            const defaults     = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 9999 };
            const interval     = setInterval(() => {
                const timeLeft = animationEnd - Date.now();
                if (timeLeft <= 0) return clearInterval(interval);
                confetti(Object.assign({}, defaults, {
                    particleCount: 50 * (timeLeft / duration),
                    origin: { x: Math.random(), y: Math.random() - 0.2 }
                }));
            }, 250);
            alert("🎉 YAY! You painted every single square! What a beautiful picture! 🎉");
        }, 500);
    }
}

// ─── Canvas interaction ──────────────────────────────────────────────────────
function handleCanvasClick(e) {
    if (gameState.selectedColor === null) {
        alert("Oops! Pick a beautiful paint color from the bottom first!");
        return;
    }
    if (!gameState.quantPixels.length) return;

    const canvas  = document.getElementById('paint-canvas');
    const rect    = canvas.getBoundingClientRect();
    const clickX  = (e.clientX - rect.left)  * (canvas.width  / rect.width);
    const clickY  = (e.clientY - rect.top)   * (canvas.height / rect.height);
    const S       = gameState.S || 10;
    const wx      = Math.floor(clickX / S);
    const wy      = Math.floor(clickY / S);

    if (wx < 0 || wx >= gameState.workW || wy < 0 || wy >= gameState.workH) return;

    const ci  = gameState.quantPixels[wy][wx];
    if (ci < 0) return;
    const rid = gameState.regionLabel[wy][wx];
    if (rid < 0) return;

    if (ci === gameState.selectedColor) {
        gameState.paintedRegions.add(rid);
        canvas.style.cursor = 'crosshair';
        drawGameCanvas();
        updateProgressBar();
        checkWinCondition();
    } else {
        canvas.style.transform = "rotate(3deg)";
        setTimeout(() => canvas.style.transform = "rotate(-3deg)", 100);
        setTimeout(() => canvas.style.transform = "rotate(0deg)",  200);
    }
}

function handleCanvasMouseMove(e) {
    if (gameState.selectedColor === null || !gameState.quantPixels.length) return;

    const canvas = document.getElementById('paint-canvas');
    const rect   = canvas.getBoundingClientRect();
    const clickX = (e.clientX - rect.left)  * (canvas.width  / rect.width);
    const clickY = (e.clientY - rect.top)   * (canvas.height / rect.height);
    const S      = gameState.S || 10;
    const wx     = Math.floor(clickX / S);
    const wy     = Math.floor(clickY / S);

    if (wx < 0 || wx >= gameState.workW || wy < 0 || wy >= gameState.workH) {
        canvas.style.cursor = 'crosshair'; return;
    }

    const ci  = gameState.quantPixels[wy][wx];
    const rid = gameState.regionLabel[wy][wx];

    if (ci === gameState.selectedColor && !gameState.paintedRegions.has(rid)) {
        const size     = gameState.regionSizes[rid] || 0;
        const c        = gameState.palette[gameState.selectedColor];
        const hex      = `%23${c.r.toString(16).padStart(2,'0')}${c.g.toString(16).padStart(2,'0')}${c.b.toString(16).padStart(2,'0')}`;
        let cursorUrl, hotspot;
        if (size > 300) {
            cursorUrl = `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 24 24'><path fill='%232F3542' d='M8 4h8v2H8V4zm-2 4h12v14a2 2 0 01-2 2H8a2 2 0 01-2-2V8zm6 3a3 3 0 100 6 3 3 0 000-6z'/><circle cx='8' cy='4' r='2' fill='${hex}'/><path fill='${hex}' d='M8 0h2v2H8z'/></svg>`;
            hotspot   = "16 0";
        } else {
            cursorUrl = `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 24 24'><path fill='%238B4513' d='M20.71 5.63l-2.34-2.34a2 2 0 00-2.83 0l-3.23 3.23 5.17 5.17 3.23-3.23a2 2 0 000-2.83z'/><path fill='${hex}' d='M10.88 7.94L3.8 15.02c-.85.85-.92 2.2-.18 3.12l.74.88c.95 1.14 2.65 1.25 3.73.25l7.98-7.39-5.19-3.94z'/><path fill='${hex}' d='M3.46 19.34L2 22l2.66-1.46c-.46-.35-.85-.75-1.2-1.2z'/></svg>`;
            hotspot   = "2 22";
        }
        canvas.style.cursor = `url("${cursorUrl}") ${hotspot}, pointer`;
    } else {
        canvas.style.cursor = 'crosshair';
    }
}

function resetGame() {
    document.getElementById('workspace-section').classList.add('hidden');
    document.getElementById('upload-section').classList.remove('hidden');
    document.getElementById('color-progress').classList.add('hidden');
    hideMobileFab();
    gameState = {
        quantPixels: [], regionLabel: [], regionColor: {}, regionActualColor: {},
        regionSizes: {}, regionRepCells: {}, colorTotals: [], colorsCompleted: new Set(),
        palette: [], selectedColor: null, paintedRegions: new Set(), workW: 0, workH: 0, S: 10, cellData: null,
    };
    const canvas = document.getElementById('paint-canvas');
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
}

// ─── Median Cut quantisation ─────────────────────────────────────────────────
function medianCut(colors, k) {
    if (colors.length === 0) return [];
    k = Math.min(k, colors.length);
    let boxes = [colors.slice()];

    while (boxes.length < k) {
        let bigIdx = 0, bigVol = -1;
        for (let i = 0; i < boxes.length; i++) {
            if (boxes[i].length < 2) continue;
            const v = _boxVolume(boxes[i]);
            if (v > bigVol) { bigVol = v; bigIdx = i; }
        }
        if (bigVol <= 0) break;

        const box = boxes[bigIdx];
        let minR=255,maxR=0, minG=255,maxG=0, minB=255,maxB=0;
        for (const c of box) {
            if (c.r<minR) minR=c.r; if (c.r>maxR) maxR=c.r;
            if (c.g<minG) minG=c.g; if (c.g>maxG) maxG=c.g;
            if (c.b<minB) minB=c.b; if (c.b>maxB) maxB=c.b;
        }
        const wR=(maxR-minR)*1.414, wG=(maxG-minG)*2.0, wB=(maxB-minB)*1.732;
        let ch = 'r';
        if (wG >= wR && wG >= wB) ch = 'g';
        else if (wB >= wR) ch = 'b';

        box.sort((a, b) => a[ch] - b[ch]);
        const mid = Math.floor(box.length / 2);
        boxes.splice(bigIdx, 1, box.slice(0, mid), box.slice(mid));
    }

    return boxes.map(box => {
        let sR=0,sG=0,sB=0;
        for (const c of box) { sR+=c.r; sG+=c.g; sB+=c.b; }
        return { r: Math.round(sR/box.length), g: Math.round(sG/box.length), b: Math.round(sB/box.length) };
    });
}

function _boxVolume(box) {
    let minR=255,maxR=0, minG=255,maxG=0, minB=255,maxB=0;
    for (const c of box) {
        if (c.r<minR) minR=c.r; if (c.r>maxR) maxR=c.r;
        if (c.g<minG) minG=c.g; if (c.g>maxG) maxG=c.g;
        if (c.b<minB) minB=c.b; if (c.b>maxB) maxB=c.b;
    }
    return (maxR-minR+1)*(maxG-minG+1)*(maxB-minB+1);
}

// ─── k-means++ initialisation ────────────────────────────────────────────────
function kMeansInit(colors, k) {
    const centroids = [{ ...colors[Math.floor(Math.random() * colors.length)] }];
    while (centroids.length < k) {
        const dists = colors.map(c => {
            let min = Infinity;
            for (const ct of centroids) {
                const d = colorDistSq(c.r, c.g, c.b, ct.r, ct.g, ct.b);
                if (d < min) min = d;
            }
            return min;
        });
        const total = dists.reduce((a, b) => a + b, 0);
        let r = Math.random() * total, cum = 0, chosen = colors.length - 1;
        for (let j = 0; j < dists.length; j++) {
            cum += dists[j];
            if (r <= cum) { chosen = j; break; }
        }
        centroids.push({ ...colors[chosen] });
    }
    return centroids;
}

// ─── k-means refinement ──────────────────────────────────────────────────────
function kMeans(colors, k, initialCentroids) {
    if (colors.length === 0) return [];
    let centroids = initialCentroids ? initialCentroids.map(c => ({ ...c })) : kMeansInit(colors, k);
    const iters   = initialCentroids ? 15 : 20;

    for (let iter = 0; iter < iters; iter++) {
        // Accumulate in LAB space for perceptually correct centroids
        const sL = new Float64Array(k), sA = new Float64Array(k), sB_ = new Float64Array(k);
        const cnt = new Int32Array(k);
        for (const c of colors) {
            let best = Infinity, bi = 0;
            for (let i = 0; i < k; i++) {
                const d = colorDistSq(c.r, c.g, c.b, centroids[i].r, centroids[i].g, centroids[i].b);
                if (d < best) { best = d; bi = i; }
            }
            const lab = rgbToLab(c.r, c.g, c.b);
            sL[bi] += lab[0]; sA[bi] += lab[1]; sB_[bi] += lab[2]; cnt[bi]++;
        }
        for (let i = 0; i < k; i++) {
            if (cnt[i] > 0)
                centroids[i] = labToRgb(sL[i]/cnt[i], sA[i]/cnt[i], sB_[i]/cnt[i]);
        }
    }
    return centroids;
}

// ─── CIELAB colour space ─────────────────────────────────────────────────────
// Perceptual distance: equal ΔE = equal perceived difference.
// RGB is bad at this — pale cream and pale blue look very different to humans
// but are close in RGB, causing wrong region merges.

const _labCache = new Map();

function rgbToLab(r, g, b) {
    const key = (r << 16) | (g << 8) | b;
    const cached = _labCache.get(key);
    if (cached) return cached;

    // sRGB → linear
    let rl = r / 255, gl = g / 255, bl = b / 255;
    rl = rl > 0.04045 ? ((rl + 0.055) / 1.055) ** 2.4 : rl / 12.92;
    gl = gl > 0.04045 ? ((gl + 0.055) / 1.055) ** 2.4 : gl / 12.92;
    bl = bl > 0.04045 ? ((bl + 0.055) / 1.055) ** 2.4 : bl / 12.92;

    // Linear RGB → XYZ (D65)
    const x = (0.4124564 * rl + 0.3575761 * gl + 0.1804375 * bl) / 0.95047;
    const y = (0.2126729 * rl + 0.7151522 * gl + 0.0721750 * bl);
    const z = (0.0193339 * rl + 0.1191920 * gl + 0.9503041 * bl) / 1.08883;

    // XYZ → LAB
    const f = t => t > 0.008856 ? t ** (1/3) : 7.787 * t + 16/116;
    const fx = f(x), fy = f(y), fz = f(z);

    const result = [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
    _labCache.set(key, result);
    return result;
}

function labToRgb(L, a, bLab) {
    // LAB → XYZ
    const fy = (L + 16) / 116;
    const fx = a / 500 + fy;
    const fz = fy - bLab / 200;

    const finv = t => t > 0.206893 ? t * t * t : (t - 16/116) / 7.787;
    const x = 0.95047 * finv(fx);
    const y = finv(fy);
    const z = 1.08883 * finv(fz);

    // XYZ → linear RGB
    let rl =  3.2404542 * x - 1.5371385 * y - 0.4985314 * z;
    let gl = -0.9692660 * x + 1.8760108 * y + 0.0415560 * z;
    let bl =  0.0556434 * x - 0.2040259 * y + 1.0572252 * z;

    // Linear → sRGB
    const gamma = c => c > 0.0031308 ? 1.055 * c ** (1/2.4) - 0.055 : 12.92 * c;
    return {
        r: Math.max(0, Math.min(255, Math.round(gamma(rl) * 255))),
        g: Math.max(0, Math.min(255, Math.round(gamma(gl) * 255))),
        b: Math.max(0, Math.min(255, Math.round(gamma(bl) * 255))),
    };
}

function colorDistSq(r1, g1, b1, r2, g2, b2) {
    const lab1 = rgbToLab(r1, g1, b1);
    const lab2 = rgbToLab(r2, g2, b2);
    const dL = lab1[0] - lab2[0], da = lab1[1] - lab2[1], db = lab1[2] - lab2[2];
    return dL * dL + da * da + db * db;
}

function findNearestColorIndex(r, g, b, palette) {
    let best = Infinity, idx = 0;
    for (let i = 0; i < palette.length; i++) {
        const d = colorDistSq(r, g, b, palette[i].r, palette[i].g, palette[i].b);
        if (d < best) { best = d; idx = i; }
    }
    return idx;
}
