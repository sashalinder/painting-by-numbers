const MAX_COLORS = 16;
const DESKTOP_GRID_SIZE = 120; // More cells = finer detail on desktop
const MOBILE_GRID_SIZE = 45;  // More cells = much better image recognition; kids tap regions not individual cells
const DESKTOP_DISPLAY_SIZE = 1500;

function getGridSize() {
    return isMobile() ? MOBILE_GRID_SIZE : DESKTOP_GRID_SIZE;
}

let gameState = {
    gridData: [], // 2D array of color indices
    regionData: [], // 2D array to track what contiguous ID a square belongs to
    regionSizes: {}, // Map of region ID to total squares
    regionRepCells: {}, // Map of region ID to one representative cell {x,y} for number display
    colorTotals: [], // Total squares for each color
    colorsCompleted: new Set(), // Track fully completed colors
    palette: [], // Array of RGB colors
    selectedColor: null,
    paintedCells: new Set() // Now we track individual squares painted
};

document.addEventListener('DOMContentLoaded', () => {
    setupUI();
});

function isMobile() {
    return window.matchMedia('(max-width: 768px)').matches
        || window.matchMedia('(max-height: 500px) and (orientation: landscape)').matches;
}

function setupUI() {
    const dropZone = document.getElementById('drop-zone');
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
        if (gameState.gridData.length === 0) {
            alert('Paint something first! 🎨');
            return;
        }
        // Render a clean save: painted cells show their color, unpainted stay white (no numbers)
        const srcCanvas = document.getElementById('paint-canvas');
        const saveCanvas = document.createElement('canvas');
        saveCanvas.width = srcCanvas.width;
        saveCanvas.height = srcCanvas.height;
        const sCtx = saveCanvas.getContext('2d');

        // White background
        sCtx.fillStyle = '#FFFFFF';
        sCtx.fillRect(0, 0, saveCanvas.width, saveCanvas.height);

        const rows = gameState.gridData.length;
        const cols = gameState.gridData[0].length;
        const cellSize = srcCanvas.width / cols;

        // Fill every cell with its color (painted or not — reveal the full picture)
        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                const colorIdx = gameState.gridData[y][x];
                if (colorIdx === -1) continue;
                const c = gameState.palette[colorIdx];
                const isPainted = gameState.paintedCells.has(`${x},${y}`);
                if (isPainted) {
                    sCtx.fillStyle = `rgb(${c.r},${c.g},${c.b})`;
                } else {
                    sCtx.fillStyle = '#F4F7F6';
                }
                sCtx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
            }
        }

        // Draw the same grid borders as the painting canvas
        sCtx.lineWidth = 1;
        sCtx.strokeStyle = '#D1D8DD';
        sCtx.beginPath();
        for (let y = 0; y <= rows; y++) {
            sCtx.moveTo(0, y * cellSize); sCtx.lineTo(cols * cellSize, y * cellSize);
        }
        for (let x = 0; x <= cols; x++) {
            sCtx.moveTo(x * cellSize, 0); sCtx.lineTo(x * cellSize, rows * cellSize);
        }
        sCtx.stroke();

        const link = document.createElement('a');
        link.download = 'my-masterpiece.png';
        link.href = saveCanvas.toDataURL('image/png');
        link.click();
    });

    const canvas = document.getElementById('paint-canvas');
    canvas.addEventListener('click', handleCanvasClick);
    canvas.addEventListener('mousemove', handleCanvasMouseMove);
    canvas.addEventListener('mouseleave', () => {
        canvas.style.cursor = 'crosshair';
    });

    // Touch support for mobile painting
    canvas.addEventListener('touchstart', handleCanvasTouch, { passive: false });

    // Mobile floating palette setup
    setupMobilePalette();
}

function setupMobilePalette() {
    const fab = document.getElementById('mobile-palette-fab');
    const popup = document.getElementById('mobile-palette-popup');
    const overlay = document.getElementById('mobile-palette-overlay');
    const closeBtn = document.getElementById('mobile-palette-close');

    fab.addEventListener('click', () => {
        popup.classList.remove('hidden');
        popup.classList.add('visible');
        overlay.classList.remove('hidden');
        overlay.classList.add('visible');
    });

    function closePalette() {
        popup.classList.add('hidden');
        popup.classList.remove('visible');
        overlay.classList.add('hidden');
        overlay.classList.remove('visible');
    }

    closeBtn.addEventListener('click', closePalette);
    overlay.addEventListener('click', closePalette);
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
    // Also close popup
    document.getElementById('mobile-palette-popup').classList.add('hidden');
    document.getElementById('mobile-palette-popup').classList.remove('visible');
    document.getElementById('mobile-palette-overlay').classList.add('hidden');
    document.getElementById('mobile-palette-overlay').classList.remove('visible');
}

function updateMobileFabColor() {
    const fab = document.getElementById('mobile-palette-fab');
    const preview = fab.querySelector('.fab-swatch-preview');

    if (gameState.selectedColor !== null) {
        const c = gameState.palette[gameState.selectedColor];
        preview.style.backgroundColor = `rgb(${c.r}, ${c.g}, ${c.b})`;
        fab.classList.add('has-color');
    } else {
        fab.classList.remove('has-color');
    }
}

function handleCanvasTouch(e) {
    e.preventDefault();
    const touch = e.touches[0];
    // Create a synthetic click event from the touch
    const clickEvent = new MouseEvent('click', {
        clientX: touch.clientX,
        clientY: touch.clientY
    });
    e.target.dispatchEvent(clickEvent);
}

function handleImage(file) {
    if (!file.type.startsWith('image/')) {
        alert("Please pick a picture file!");
        return;
    }

    document.getElementById('upload-section').classList.add('hidden');
    document.getElementById('workspace-section').classList.remove('hidden');

    if (isMobile()) {
        showMobileFab();
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            setTimeout(() => processImage(img), 50); 
        };
        img.src = e.target.result;
        
        // Populate the floating reference image so kids can see what they are painting!
        const refImage = document.getElementById('reference-image');
        refImage.src = e.target.result;
        refImage.classList.remove('hidden');
    };
    reader.readAsDataURL(file);
}

function processImage(img) {
    const processingCanvas = document.getElementById('processing-canvas');
    const ctx = processingCanvas.getContext('2d');

    const gridSize = getGridSize();
    let cols = gridSize;
    let rows = gridSize;
    if (img.width > img.height) {
        rows = Math.floor(gridSize * (img.height / img.width));
    } else {
        cols = Math.floor(gridSize * (img.width / img.height));
    }

    // Step 1: Sample colors from a larger intermediate canvas for better k-means accuracy
    const sampleScale = 8; // 8x the grid resolution = much richer color data
    const sampleW = cols * sampleScale;
    const sampleH = rows * sampleScale;
    processingCanvas.width = sampleW;
    processingCanvas.height = sampleH;
    ctx.drawImage(img, 0, 0, sampleW, sampleH);
    const sampleData = ctx.getImageData(0, 0, sampleW, sampleH).data;

    // Collect color samples (cap at 4000 for speed)
    let sampleColors = [];
    const totalPx = (sampleW * sampleH);
    const step = Math.max(1, Math.floor(totalPx / 4000));
    for (let i = 0; i < totalPx; i += step) {
        const p = i * 4;
        if (sampleData[p + 3] > 128) {
            sampleColors.push({ r: sampleData[p], g: sampleData[p + 1], b: sampleData[p + 2] });
        }
    }
    if (sampleColors.length === 0) sampleColors.push({ r: 0, g: 0, b: 0 });

    gameState.palette = kMeans(sampleColors, MAX_COLORS);

    // Step 2: Assign each grid cell by finding the MOST COMMON palette color in its entire
    // block (mode) — far more robust than a single center pixel, captures the true dominant
    // color of each region and correctly handles noisy/edge pixels.
    // Cache nearest-palette lookups to avoid redundant computation for repeated colors.
    const nearestColorCache = new Map();
    const cachedNearest = (r, g, b) => {
        const key = (r << 16) | (g << 8) | b;
        let idx = nearestColorCache.get(key);
        if (idx === undefined) {
            idx = findNearestColorIndex(r, g, b, gameState.palette);
            nearestColorCache.set(key, idx);
        }
        return idx;
    };

    const blockW = Math.max(1, Math.floor(sampleW / cols));
    const blockH = Math.max(1, Math.floor(sampleH / rows));

    gameState.gridData = [];
    for (let y = 0; y < rows; y++) {
        let row = [];
        for (let x = 0; x < cols; x++) {
            const startX = x * blockW;
            const startY = y * blockH;
            const endX = Math.min(startX + blockW, sampleW);
            const endY = Math.min(startY + blockH, sampleH);

            // Count which palette color appears most often in this block
            const colorCounts = new Array(gameState.palette.length).fill(0);
            let validPixels = 0;

            for (let py = startY; py < endY; py++) {
                for (let px = startX; px < endX; px++) {
                    const p = (py * sampleW + px) * 4;
                    if (sampleData[p + 3] >= 128) {
                        colorCounts[cachedNearest(sampleData[p], sampleData[p + 1], sampleData[p + 2])]++;
                        validPixels++;
                    }
                }
            }

            if (validPixels === 0) {
                row.push(-1);
            } else {
                let bestColor = 0, bestCount = -1;
                for (let i = 0; i < colorCounts.length; i++) {
                    if (colorCounts[i] > bestCount) { bestCount = colorCounts[i]; bestColor = i; }
                }
                row.push(bestColor);
            }
        }
        gameState.gridData.push(row);
    }

    // Smooth out isolated noise cells — removes single-pixel speckles that break
    // up the silhouette and replaces them with the dominant surrounding color.
    smoothGridData();

    // Calculate regions for cursor dynamic sizing
    calculateRegions();

    drawGameCanvas();
    buildPaletteUI();
}

// Remove isolated noise cells by replacing them with their most common neighbor color.
// Run 2 passes: first pass removes isolated single cells, second pass cleans up any
// new gaps created by the first pass — giving clean silhouette-like region boundaries.
function smoothGridData() {
    const rows = gameState.gridData.length;
    const cols = gameState.gridData[0].length;

    for (let pass = 0; pass < 2; pass++) {
        const newGrid = gameState.gridData.map(row => [...row]);

        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                const curr = gameState.gridData[y][x];
                if (curr === -1) continue;

                // Count colors among 4 direct neighbors
                const neighborCounts = {};
                let sameCount = 0;
                let totalNeighbors = 0;

                const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
                for (const [dx, dy] of dirs) {
                    const nx = x + dx, ny = y + dy;
                    if (nx >= 0 && nx < cols && ny >= 0 && ny < rows) {
                        const nc = gameState.gridData[ny][nx];
                        if (nc !== -1) {
                            neighborCounts[nc] = (neighborCounts[nc] || 0) + 1;
                            totalNeighbors++;
                            if (nc === curr) sameCount++;
                        }
                    }
                }

                // Replace cell if it has 0 or 1 same-color direct neighbors (it's isolated/noise)
                if (sameCount <= 1 && totalNeighbors >= 3) {
                    let bestColor = curr, bestCount = sameCount;
                    for (const colorStr in neighborCounts) {
                        const c = parseInt(colorStr);
                        if (c !== curr && neighborCounts[colorStr] > bestCount) {
                            bestCount = neighborCounts[colorStr];
                            bestColor = c;
                        }
                    }
                    newGrid[y][x] = bestColor;
                }
            }
        }

        gameState.gridData = newGrid;
    }
}

function calculateRegions() {
    const rows = gameState.gridData.length;
    const cols = gameState.gridData[0].length;
    
    gameState.regionData = Array.from({length: rows}, () => Array(cols).fill(-1));
    gameState.regionSizes = {};
    gameState.regionRepCells = {};
    gameState.colorTotals = new Array(MAX_COLORS).fill(0);
    
    let visited = Array.from({length: rows}, () => Array(cols).fill(false));
    let regionId = 0;
    
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            if (gameState.gridData[y][x] !== -1) {
                gameState.colorTotals[gameState.gridData[y][x]]++;
            }
            if (!visited[y][x] && gameState.gridData[y][x] !== -1) {
                let colorIdx = gameState.gridData[y][x];
                let size = 0;
                
                let queue = [{x, y}];
                visited[y][x] = true;
                
                let head = 0;
                while (head < queue.length) {
                    let curr = queue[head++];
                    gameState.regionData[curr.y][curr.x] = regionId;
                    size++;
                    
                    let neighbors = [
                        {x: curr.x + 1, y: curr.y},
                        {x: curr.x - 1, y: curr.y},
                        {x: curr.x, y: curr.y + 1},
                        {x: curr.x, y: curr.y - 1}
                    ];
                    
                    for (let n of neighbors) {
                        if (n.x >= 0 && n.x < cols && n.y >= 0 && n.y < rows) {
                            if (!visited[n.y][n.x] && gameState.gridData[n.y][n.x] === colorIdx) {
                                visited[n.y][n.x] = true;
                                queue.push(n);
                            }
                        }
                    }
                }
                gameState.regionSizes[regionId] = size;

                // Find the cell closest to the center of this region — this is where we draw the number
                let sumX = 0, sumY = 0;
                for (const c of queue) { sumX += c.x; sumY += c.y; }
                const avgX = sumX / queue.length, avgY = sumY / queue.length;
                let bestCell = queue[0], bestDist = Infinity;
                for (const c of queue) {
                    const d = (c.x - avgX) ** 2 + (c.y - avgY) ** 2;
                    if (d < bestDist) { bestDist = d; bestCell = c; }
                }
                gameState.regionRepCells[regionId] = bestCell;

                regionId++;
            }
        }
    }
}

function kMeansInit(colors, k) {
    // k-means++ initialization: spread out initial centroids for reliable convergence
    const centroids = [{ ...colors[Math.floor(Math.random() * colors.length)] }];
    while (centroids.length < k) {
        // Use perceptual distance to nearest existing centroid
        let distances = colors.map(c => {
            let minD = Infinity;
            for (const cent of centroids) {
                const d = colorDistSq(c.r, c.g, c.b, cent.r, cent.g, cent.b);
                if (d < minD) minD = d;
            }
            return minD;
        });
        // Pick next centroid with probability proportional to distance squared
        const total = distances.reduce((a, b) => a + b, 0);
        let r = Math.random() * total;
        let cumulative = 0;
        let chosen = colors.length - 1;
        for (let j = 0; j < distances.length; j++) {
            cumulative += distances[j];
            if (r <= cumulative) { chosen = j; break; }
        }
        centroids.push({ ...colors[chosen] });
    }
    return centroids;
}

function kMeans(colors, k) {
    if (colors.length === 0) return [];
    let centroids = kMeansInit(colors, k);

    let iterations = 20;
    while (iterations-- > 0) {
        let clusters = Array.from({length: k}, () => []);

        for (let c of colors) {
            let bestDist = Infinity;
            let bestIdx = 0;
            for (let i = 0; i < k; i++) {
                let dSq = colorDistSq(c.r, c.g, c.b, centroids[i].r, centroids[i].g, centroids[i].b);
                if (dSq < bestDist) {
                    bestDist = dSq;
                    bestIdx = i;
                }
            }
            clusters[bestIdx].push(c);
        }

        let newCentroids = [];
        for (let i = 0; i < k; i++) {
            if (clusters[i].length > 0) {
                let sumR = 0, sumG = 0, sumB = 0;
                for (let c of clusters[i]) {
                    sumR += c.r; sumG += c.g; sumB += c.b;
                }
                newCentroids.push({
                    r: Math.round(sumR / clusters[i].length),
                    g: Math.round(sumG / clusters[i].length),
                    b: Math.round(sumB / clusters[i].length)
                });
            } else {
                newCentroids.push(centroids[i]);
            }
        }
        centroids = newCentroids;
    }
    return centroids;
}

// Perceptual color distance — weighted by human eye sensitivity (green > red > blue)
function colorDistSq(r1, g1, b1, r2, g2, b2) {
    const dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
    return 2 * dr * dr + 4 * dg * dg + 3 * db * db;
}

function findNearestColorIndex(r, g, b, palette) {
    let bestDist = Infinity;
    let bestIdx = 0;
    for (let i = 0; i < palette.length; i++) {
        let p = palette[i];
        let dSq = colorDistSq(r, g, b, p.r, p.g, p.b);
        if (dSq < bestDist) { bestDist = dSq; bestIdx = i; }
    }
    return bestIdx;
}

function drawGameCanvas() {
    const rows = gameState.gridData.length;
    if(rows === 0) return;
    const cols = gameState.gridData[0].length;
    
    const canvas = document.getElementById('paint-canvas');
    let cellSize;

    if (isMobile()) {
        const isLandscape = window.matchMedia('(orientation: landscape)').matches;
        const reservedH = isLandscape ? 50 : 210;
        const availH = window.innerHeight - reservedH;
        const availW = window.innerWidth - 8;
        const byHeight = Math.floor(availH / rows);
        const byWidth = Math.floor(availW / cols);
        cellSize = Math.max(8, Math.min(byWidth, byHeight)); // 8px minimum — kids tap entire regions (which are many cells), not individual cells
    } else {
        cellSize = Math.max(6, Math.floor(DESKTOP_DISPLAY_SIZE / Math.max(cols, rows)));
    }

    canvas.width = cols * cellSize;
    canvas.height = rows * cellSize;
    
    const ctx = canvas.getContext('2d');
    
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Draw Backgrounds and Fills first!
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            let colorIdx = gameState.gridData[y][x];
            if (colorIdx === -1) continue;
            
            let cellId = `${x},${y}`;
            let isPainted = gameState.paintedCells.has(cellId);
            let isSelected = gameState.selectedColor === colorIdx;
            
            if (isPainted) {
                let c = gameState.palette[colorIdx];
                ctx.fillStyle = `rgb(${c.r}, ${c.g}, ${c.b})`;
            } else if (isSelected) {
                ctx.fillStyle = '#FFF524'; // Glowing yellow highlight!
            } else {
                ctx.fillStyle = '#F4F7F6'; // Blank canvas color
            }
            
            ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
        }
    }
    
    // Only draw the fine cell grid when cells are large enough to see it (≥10px)
    if (cellSize >= 10) {
        ctx.lineWidth = 0.5;
        ctx.strokeStyle = '#E0E6EA';
        ctx.beginPath();
        for (let y = 0; y <= rows; y++) {
            ctx.moveTo(0, y * cellSize);
            ctx.lineTo(cols * cellSize, y * cellSize);
        }
        for (let x = 0; x <= cols; x++) {
            ctx.moveTo(x * cellSize, 0);
            ctx.lineTo(x * cellSize, rows * cellSize);
        }
        ctx.stroke();
    }

    // Draw slightly thicker black boundaries around color groups for structure
    ctx.lineWidth = 1.5; 
    ctx.strokeStyle = '#2F3542';
    ctx.beginPath();
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            let curr = gameState.gridData[y][x];
            if(curr === -1) continue;
            
            if (x === cols - 1 || gameState.gridData[y][x+1] !== curr) {
                ctx.moveTo((x+1)*cellSize, y*cellSize); ctx.lineTo((x+1)*cellSize, (y+1)*cellSize);
            }
            if (y === rows - 1 || gameState.gridData[y+1][x] !== curr) {
                ctx.moveTo(x*cellSize, (y+1)*cellSize); ctx.lineTo((x+1)*cellSize, (y+1)*cellSize);
            }
            if (x === 0 || gameState.gridData[y][x-1] !== curr) {
                 ctx.moveTo(x*cellSize, y*cellSize); ctx.lineTo(x*cellSize, (y+1)*cellSize);
            }
            if (y === 0 || gameState.gridData[y-1][x] !== curr){
                 ctx.moveTo(x*cellSize, y*cellSize); ctx.lineTo((x+1)*cellSize, y*cellSize);
            }
        }
    }
    ctx.stroke();
    
    // Draw ONE number per region (at its center-most cell) — like real paint-by-numbers
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Build a lookup: "x,y" -> regionId for rep cells only
    const repCellMap = {}; // "x,y" -> regionId
    for (const regionId in gameState.regionRepCells) {
        const rc = gameState.regionRepCells[regionId];
        repCellMap[`${rc.x},${rc.y}`] = parseInt(regionId);
    }

    const numSize = Math.max(9, Math.min(cellSize * 0.85, 14));

    for (const key in repCellMap) {
        const regionId = repCellMap[key];
        const [rx, ry] = key.split(',').map(Number);
        const colorIdx = gameState.gridData[ry][rx];
        if (colorIdx === -1) continue;

        const cellId = `${rx},${ry}`;
        if (gameState.paintedCells.has(cellId)) continue;

        const isSelected = gameState.selectedColor === colorIdx;
        if (gameState.selectedColor !== null && !isSelected) continue;

        if (isSelected) {
            ctx.fillStyle = '#FF4757';
            ctx.font = `900 ${Math.max(10, numSize * 1.1)}px 'Nunito'`;
        } else {
            ctx.fillStyle = '#6B7E8F';
            ctx.font = `bold ${numSize}px 'Nunito'`;
        }
        ctx.fillText(colorIdx + 1, rx * cellSize + cellSize / 2, ry * cellSize + cellSize / 2);
    }
}

function buildPaletteUI() {
    const container = document.getElementById('color-palette');
    container.innerHTML = '';

    // Also build mobile palette
    const mobileContainer = document.getElementById('mobile-color-palette');
    if (mobileContainer) mobileContainer.innerHTML = '';

    gameState.palette.forEach((color, index) => {
        let brightness = (color.r * 299 + color.g * 587 + color.b * 114) / 1000;
        let textColor = brightness > 128 ? '#2F3542' : '#FFFFFF';

        function createSwatch() {
            let swatch = document.createElement('div');
            swatch.className = 'color-swatch';
            swatch.style.backgroundColor = `rgb(${color.r}, ${color.g}, ${color.b})`;
            swatch.innerText = index + 1;
            swatch.style.color = textColor;

            if (gameState.colorsCompleted.has(index)) {
                swatch.classList.add('completed');
            }
            if (gameState.selectedColor === index) {
                swatch.classList.add('active');
            }

            swatch.addEventListener('click', () => {
                document.querySelectorAll('.color-swatch').forEach(el => el.classList.remove('active'));
                gameState.selectedColor = index;

                // Mark active on both palettes
                document.querySelectorAll('.color-swatch').forEach(el => {
                    if (el.innerText == String(index + 1)) el.classList.add('active');
                });

                const canvas = document.getElementById('paint-canvas');
                canvas.style.cursor = 'crosshair';

                updateMobileFabColor();
                updateProgressBar();

                // Close mobile popup after selection
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

function updateProgressBar() {
    const bar = document.getElementById('color-progress');
    if (!bar) return;

    if (gameState.selectedColor === null || gameState.gridData.length === 0) {
        bar.classList.add('hidden');
        return;
    }

    const colorIdx = gameState.selectedColor;
    const total = gameState.colorTotals[colorIdx] || 0;
    if (total === 0) return;

    // Count how many cells of this color have been painted
    let painted = 0;
    const rows = gameState.gridData.length;
    const cols = gameState.gridData[0].length;
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            if (gameState.gridData[y][x] === colorIdx && gameState.paintedCells.has(`${x},${y}`)) {
                painted++;
            }
        }
    }

    const pct = Math.round((painted / total) * 100);
    const left = total - painted;

    const c = gameState.palette[colorIdx];
    const colorStr = `rgb(${c.r}, ${c.g}, ${c.b})`;

    document.getElementById('cp-swatch').style.backgroundColor = colorStr;
    document.getElementById('cp-fill').style.backgroundColor = colorStr;
    document.getElementById('cp-fill').style.width = `${pct}%`;
    document.getElementById('cp-name').textContent = `Color ${colorIdx + 1}`;

    if (pct >= 100) {
        document.getElementById('cp-remaining').textContent = 'All done! 🌟';
        document.getElementById('cp-pct').textContent = '🎉';
        // Re-trigger the pop animation
        bar.classList.remove('cp-complete');
        void bar.offsetWidth; // force reflow
        bar.classList.add('cp-complete');
    } else {
        const spotsWord = left === 1 ? 'spot left' : 'spots left';
        document.getElementById('cp-remaining').textContent = `${left} ${spotsWord}`;
        document.getElementById('cp-pct').textContent = `${pct}%`;
        bar.classList.remove('cp-complete');
    }

    bar.classList.remove('hidden');
}

// Check every single square to see if it's painted!
function checkWinCondition() {
    let totalSquares = 0;
    const rows = gameState.gridData.length;
    const cols = gameState.gridData[0].length;
    
    // 1. Check if the currently selected color just finished!
    if (gameState.selectedColor !== null && !gameState.colorsCompleted.has(gameState.selectedColor)) {
        let paintedForColor = 0;
        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                if (gameState.gridData[y][x] === gameState.selectedColor && gameState.paintedCells.has(`${x},${y}`)) {
                    paintedForColor++;
                }
            }
        }
        
        if (paintedForColor >= gameState.colorTotals[gameState.selectedColor]) {
            gameState.colorsCompleted.add(gameState.selectedColor);
            
            // FIREWORKS!
            confetti({
                particleCount: 150,
                spread: 70,
                origin: { y: 0.6 },
                zIndex: 9999
            });
            
            buildPaletteUI(); // Add the checkmark!
        }
    }
    
    // 2. Check complete win overall
    for(let y=0; y<rows; y++){
        for(let x=0; x<cols; x++){
            if(gameState.gridData[y][x] !== -1) totalSquares++;
        }
    }
    
    if (gameState.paintedCells.size >= totalSquares) {
        setTimeout(() => {
            // HUGE FIREWORKS!
            let duration = 3 * 1000;
            let animationEnd = Date.now() + duration;
            let defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 9999 };

            let interval = setInterval(function() {
                let timeLeft = animationEnd - Date.now();
                if (timeLeft <= 0) return clearInterval(interval);
                let particleCount = 50 * (timeLeft / duration);
                confetti(Object.assign({}, defaults, { particleCount, origin: { x: Math.random(), y: Math.random() - 0.2 } }));
            }, 250);
            
            alert("🎉 YAY! You painted every single square! What a beautiful picture! 🎉");
        }, 500);
    }
}

function handleCanvasClick(e) {
    if (gameState.selectedColor === null) {
        alert("Oops! Pick a beautiful paint color from the bottom first!");
        return;
    }
    
    const canvas = document.getElementById('paint-canvas');
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    const clickX = (e.clientX - rect.left) * scaleX;
    const clickY = (e.clientY - rect.top) * scaleY;
    
    const cols = gameState.gridData[0].length;
    const cellSize = canvas.width / cols;
    
    const blockX = Math.floor(clickX / cellSize);
    const blockY = Math.floor(clickY / cellSize);
    
    if(blockY >= 0 && blockY < gameState.gridData.length && blockX >= 0 && blockX < cols) {
        let colorIdx = gameState.gridData[blockY][blockX];
        if (colorIdx !== -1) {
            if (colorIdx === gameState.selectedColor) {
                // Paint the entire connected region automatically!
                let targetRegionId = gameState.regionData[blockY][blockX];
                for (let y = 0; y < gameState.gridData.length; y++) {
                    for (let x = 0; x < cols; x++) {
                        if (gameState.regionData[y][x] === targetRegionId) {
                            gameState.paintedCells.add(`${x},${y}`);
                        }
                    }
                }
                
                // Immediately clear the custom cursor since the area is now painted
                canvas.style.cursor = 'crosshair';
                
                drawGameCanvas();
                updateProgressBar();
                checkWinCondition();
            } else {
                canvas.style.transform = "rotate(3deg)";
                setTimeout(() => canvas.style.transform = "rotate(-3deg)", 100);
                setTimeout(() => canvas.style.transform = "rotate(0deg)", 200);
            }
        }
    }
}

function handleCanvasMouseMove(e) {
    if (gameState.selectedColor === null) return;
    
    const canvas = document.getElementById('paint-canvas');
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    
    const cols = gameState.gridData[0].length;
    const cellSize = canvas.width / cols;
    
    const blockX = Math.floor(x / cellSize);
    const blockY = Math.floor(y / cellSize);
    
    if(blockY >= 0 && blockY < gameState.gridData.length && blockX >= 0 && blockX < cols) {
        let colorIdx = gameState.gridData[blockY][blockX];
        let cellId = `${blockX},${blockY}`;
        
        // Only show custom cursor if we are hovering over the EXACT right color we need to paint, 
        // and it hasn't been painted yet!
        if (colorIdx === gameState.selectedColor && !gameState.paintedCells.has(cellId)) {
            let regionId = gameState.regionData[blockY][blockX];
            let size = gameState.regionSizes[regionId];
            
            let c = gameState.palette[gameState.selectedColor];
            let hexColor = `%23${c.r.toString(16).padStart(2, '0')}${c.g.toString(16).padStart(2, '0')}${c.b.toString(16).padStart(2, '0')}`;
            
            let cursorUrl = "";
            let hotspot = "";
            
            // If the area is big (more than 15 blocks), give them a SPRAY CAN
            if (size > 15) {
                // SVG Spray Can with chosen color spilling out!
                cursorUrl = `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 24 24'><path fill='%232F3542' d='M8 4h8v2H8V4zm-2 4h12v14a2 2 0 01-2 2H8a2 2 0 01-2-2V8zm6 3a3 3 0 100 6 3 3 0 000-6z'/><circle cx='8' cy='4' r='2' fill='${hexColor}'/><path fill='${hexColor}' d='M8 0h2v2H8z'/></svg>`;
                hotspot = "16 0"; // Top middle of the can
            } else {
                // SVG Paint Brush dripping the chosen color!
                cursorUrl = `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 24 24'><path fill='%238B4513' d='M20.71 5.63l-2.34-2.34a2 2 0 00-2.83 0l-3.23 3.23 5.17 5.17 3.23-3.23a2 2 0 000-2.83z'/><path fill='${hexColor}' d='M10.88 7.94L3.8 15.02c-.85.85-.92 2.2-.18 3.12l.74.88c.95 1.14 2.65 1.25 3.73.25l7.98-7.39-5.19-3.94z'/><path fill='${hexColor}' d='M3.46 19.34L2 22l2.66-1.46c-.46-.35-.85-.75-1.2-1.2z'/></svg>`;
                hotspot = "2 22"; // Bottom left tip of the brush
            }
            
            canvas.style.cursor = `url("${cursorUrl}") ${hotspot}, pointer`;
        } else {
            canvas.style.cursor = 'crosshair';
        }
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
        gridData: [],
        regionData: [],
        regionSizes: {},
        regionRepCells: {},
        colorTotals: [],
        colorsCompleted: new Set(),
        palette: [],
        selectedColor: null,
        paintedCells: new Set()
    };
    const canvas = document.getElementById('paint-canvas');
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
}
