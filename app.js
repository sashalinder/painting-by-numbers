const GRID_SIZE = 50; // Reverted back to the "sweet spot" size from the second version
const MAX_COLORS = 12; 
const DISPLAY_SIZE = 1500; // Giant high res internal size! CSS will cleanly shrink it down to fit the screen bounds.

let gameState = {
    gridData: [], // 2D array of color indices
    regionData: [], // 2D array to track what contiguous ID a square belongs to
    regionSizes: {}, // Map of region ID to total squares
    colorTotals: [], // Total squares for each color
    colorsCompleted: new Set(), // Track fully completed colors
    palette: [], // Array of RGB colors
    selectedColor: null,
    paintedCells: new Set() // Now we track individual squares painted
};

document.addEventListener('DOMContentLoaded', () => {
    setupUI();
});

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
    
    const canvas = document.getElementById('paint-canvas');
    canvas.addEventListener('click', handleCanvasClick);
    canvas.addEventListener('mousemove', handleCanvasMouseMove);
    canvas.addEventListener('mouseleave', () => {
        canvas.style.cursor = 'crosshair';
    });
}

function handleImage(file) {
    if (!file.type.startsWith('image/')) {
        alert("Please pick a picture file!");
        return;
    }

    document.getElementById('upload-section').classList.add('hidden');
    document.getElementById('workspace-section').classList.remove('hidden');

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
    
    let cols = GRID_SIZE;
    let rows = GRID_SIZE;
    if (img.width > img.height) {
        rows = Math.floor(GRID_SIZE * (img.height / img.width));
    } else {
        cols = Math.floor(GRID_SIZE * (img.width / img.height));
    }
    
    processingCanvas.width = cols;
    processingCanvas.height = rows;
    const ctx = processingCanvas.getContext('2d');
    ctx.drawImage(img, 0, 0, cols, rows);
    
    const imageData = ctx.getImageData(0, 0, cols, rows);
    const pixels = imageData.data;
    
    // Sample colors for K-Means to keep the computer brain fast
    let sampleColors = [];
    let totalSolid = 0;
    for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i+3] > 128) totalSolid++;
    }
    
    let sampleRate = Math.min(1.0, 3000 / Math.max(1, totalSolid));
    for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i+3] > 128 && Math.random() <= sampleRate) {
            sampleColors.push({r: pixels[i], g: pixels[i+1], b: pixels[i+2]});
        }
    }
    if(sampleColors.length === 0) sampleColors.push({r:0,g:0,b:0});
    
    gameState.palette = kMeans(sampleColors, MAX_COLORS);
    
    gameState.gridData = [];
    for (let y = 0; y < rows; y++) {
        let row = [];
        for (let x = 0; x < cols; x++) {
            let idx = (y * cols + x) * 4;
            if (pixels[idx+3] < 128) {
                row.push(-1);
            } else {
                row.push(findNearestColorIndex(pixels[idx], pixels[idx+1], pixels[idx+2], gameState.palette));
            }
        }
        gameState.gridData.push(row);
    }
    
    // Calculate regions for cursor dynamic sizing
    calculateRegions();
    
    drawGameCanvas();
    buildPaletteUI();
}

function calculateRegions() {
    const rows = gameState.gridData.length;
    const cols = gameState.gridData[0].length;
    
    gameState.regionData = Array.from({length: rows}, () => Array(cols).fill(-1));
    gameState.regionSizes = {};
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
                regionId++;
            }
        }
    }
}

function kMeans(colors, k) {
    if (colors.length === 0) return [];
    let centroids = [];
    for (let i = 0; i < k; i++) {
        centroids.push(colors[Math.floor(Math.random() * colors.length)]);
    }
    
    let iterations = 12; // slightly more iterations for better colors 
    while (iterations-- > 0) {
        let clusters = Array.from({length: k}, () => []);
        
        for (let c of colors) {
            let bestDist = Infinity;
            let bestIdx = 0;
            for (let i = 0; i < k; i++) {
                let dSq = (c.r - centroids[i].r)**2 + (c.g - centroids[i].g)**2 + (c.b - centroids[i].b)**2;
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
                    r: Math.floor(sumR / clusters[i].length),
                    g: Math.floor(sumG / clusters[i].length),
                    b: Math.floor(sumB / clusters[i].length)
                });
            } else {
                newCentroids.push(centroids[i]); 
            }
        }
        centroids = newCentroids;
    }
    return centroids;
}

function findNearestColorIndex(r, g, b, palette) {
    let bestDist = Infinity;
    let bestIdx = 0;
    for (let i = 0; i < palette.length; i++) {
        let p = palette[i];
        let dSq = (r - p.r)**2 + (g - p.g)**2 + (b - p.b)**2;
        if (dSq < bestDist) { bestDist = dSq; bestIdx = i; }
    }
    return bestIdx;
}

function drawGameCanvas() {
    const rows = gameState.gridData.length;
    if(rows === 0) return;
    const cols = gameState.gridData[0].length;
    
    const canvas = document.getElementById('paint-canvas');
    const cellSize = Math.max(8, Math.floor(DISPLAY_SIZE / Math.max(cols, rows)));
    
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
    
    // Draw crisp, thin cell boundaries so kids can see individual grid squares
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#D1D8DD';
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
    
    // Draw numbers!
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            let colorIdx = gameState.gridData[y][x];
            if (colorIdx === -1) continue;
            
            let cellId = `${x},${y}`;
            if (!gameState.paintedCells.has(cellId)) {
                let isSelected = gameState.selectedColor === colorIdx;
                
                // Still use the magic trick: only show numbers for the target color!
                if (gameState.selectedColor === null || isSelected) {
                    
                    if (isSelected) {
                        ctx.fillStyle = '#FF4757';
                        ctx.font = `900 ${Math.max(12, cellSize * 0.75)}px 'Nunito'`;
                    } else {
                        ctx.fillStyle = '#8B9BAA';
                        ctx.font = `bold ${Math.max(10, cellSize * 0.6)}px 'Nunito'`;
                    }
                    
                    ctx.fillText(colorIdx + 1, x * cellSize + cellSize/2, y * cellSize + cellSize/2);
                }
            }
        }
    }
}

function buildPaletteUI() {
    const container = document.getElementById('color-palette');
    container.innerHTML = '';
    
    gameState.palette.forEach((color, index) => {
        let swatch = document.createElement('div');
        swatch.className = 'color-swatch';
        swatch.style.backgroundColor = `rgb(${color.r}, ${color.g}, ${color.b})`;
        swatch.innerText = index + 1;
        
        if (gameState.colorsCompleted.has(index)) {
            swatch.classList.add('completed');
        }
        
        let brightness = (color.r * 299 + color.g * 587 + color.b * 114) / 1000;
        swatch.style.color = brightness > 128 ? '#2F3542' : '#FFFFFF';
        
        swatch.addEventListener('click', () => {
            document.querySelectorAll('.color-swatch').forEach(el => el.classList.remove('active'));
            swatch.classList.add('active');
            gameState.selectedColor = index;
            
            // Reset cursor immediately if moving fast
            const canvas = document.getElementById('paint-canvas');
            canvas.style.cursor = 'crosshair';

            drawGameCanvas();
        });
        
        container.appendChild(swatch);
    });
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
    gameState = {
        gridData: [],
        regionData: [],
        regionSizes: {},
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
