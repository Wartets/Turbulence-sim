# Architecture: Turbulence C++ Simulator

## 1. Overview
This project is a **client-side, high-performance web application**. It uses C++ for the physics engine, compiled to WebAssembly (Wasm) via Emscripten. This allows the simulation to run locally in the user's browser with near-native speed, communicating directly with WebGL for visualization without server round-trips.

*   **Core Physics:** C++17 (Navier-Stokes Solver).
*   **Compilation:** Emscripten (C++ $\to$ `.wasm` + `.js` glue).
*   **Rendering:** WebGL 2.0 (via JavaScript Canvas API).
*   **Interface:** HTML5/CSS3 (Minimalist).
*   **Runtime:** Local Browser (launched via Python/Node simple HTTP server).

## 2. Design Principles
1.  **Zero Latency:** The simulation step happens in the browser's main thread (or web worker). The UI updates synchronously with the physics.
2.  **Shared Memory:** JavaScript accesses the C++ memory heap directly (views) to upload texture data to the GPU, avoiding expensive object serialization.
3.  **Minimal Files:** The entire project consists of less than 10 source files.

## 3. Tech Stack & Dependencies
*   **Compiler:** `emcc` (Emscripten SDK).
*   **Languages:**
    *   **C++:** 90% of the logic (Physics, Memory Management, Solver).
    *   **GLSL:** 5% (Shaders for coloring vorticity/velocity).
    *   **JavaScript:** 5% (Boilerplate to initialize Wasm and context).
*   **No Docker:** Runs on any machine with `emcc` and a browser.

## 4. File Structure (Max 10 Files)

We will use a flat, simple structure.

``text
/project-root
│
├── Makefile             # One-command build script
├── README.md            # Documentation and Launch instructions
│
├── src/
│   ├── engine.cpp       # CORE: The Navier-Stokes solver & Emscripten bindings
│   └── engine.h         # Headers, Constants, and Data Structures
│
├── web/
│   ├── index.html       # The GUI container
│   ├── style.css        # Minimal layout
│   ├── main.js          # Entry point, Loop management, UI Event listeners
│   ├── renderer.js      # WebGL setup and Texture management
│   └── shaders.js       # GLSL Vertex and Fragment shaders (as strings)
``

*(Note: The build process will generate `engine.js` and `engine.wasm` into the `web/` folder, but these are build artifacts, not source files.)*

## 5. Module Descriptions

### A. The Physics Engine (`src/engine.cpp`, `src/engine.h`)
**Role:** The heavy lifter.
**Paradigm:** We will use the **Lattice Boltzmann Method (LBM)** (D2Q9 model) or a **Stable Fluids** (Semi-Lagrangian) approach. LBM is preferred for interactive turbulence as it is inherently parallelizable and handles complex boundaries well.

*   **Data:** Stores flattened 1D arrays representing 2D grids (Velocity X, Velocity Y, Density/Pressure, Curl).
*   **Solver:**
    *   `init(width, height, viscosity)`: Allocates memory.
    *   `step(dt)`: Performs collision and streaming steps (Navier-Stokes approximation).
    *   `interact(x, y, force_x, force_y)`: Applies user mouse forces.
*   **Bindings (EMSCRIPTEN_BINDINGS):** Exposes the C++ class methods to JavaScript and, crucially, provides functions to get memory pointers (`getVelocityBufferPointer()`) so JS can read data without copying.

### B. The Frontend (`web/index.html`, `web/style.css`)
**Role:** Container and Controls.
*   Contains a full-screen `<canvas>`.
*   A minimal overlay dashboard (HTML) for parameter tuning (Viscosity, Reynolds Number, Color Map selection).

### C. The Bridge & Loop (`web/main.js`)
**Role:** Orchestration.
1.  Loads the `engine.wasm` module.
2.  Instantiates the C++ `FluidSolver` class.
3.  Sets up the `requestAnimationFrame` loop.
4.  **The Loop:**
    *   Call C++: `solver.step()`
    *   Get Pointer: `ptr = solver.getOutputPtr()`
    *   Call JS: `renderer.draw(ptr)`
5.  Handles Mouse/Touch events and passes coordinates to C++.

### D. The Renderer (`web/renderer.js`, `web/shaders.js`)
**Role:** Visualization.
Instead of drawing pixel-by-pixel (slow), we use WebGL 2.0.
1.  **Texture:** Creates a texture where the raw bytes from the C++ memory are uploaded.
2.  **Shaders (`shaders.js`):**
    *   *Vertex Shader:* Simple quad rendering.
    *   *Fragment Shader:* Takes the raw velocity/density data and applies a colormap (e.g., Jet, Magma, Viridis) to visualize Vorticity or Velocity magnitude. This happens on the GPU.

## 6. Data Flow

``mermaid
graph TD
    User[User Input] -->|Mouse/Params| JS[main.js]
    JS -->|Function Call| CPP[C++ Engine (Wasm)]
    CPP -->|Physics Step| MEM[C++ Linear Memory]
    MEM -->|Direct View (Float32Array)| JS
    JS -->|glTexImage2D| GPU[WebGL Texture]
    GPU -->|Fragment Shader| Screen[Canvas]
``

## 7. Build & Run Workflow

**1. Compilation (via Makefile):**
``bash
# Example command inside Makefile
emcc src/engine.cpp -O3 -s WASM=1 -s ALLOW_MEMORY_GROWTH=1 -s MODULARIZE=1 -s 'EXPORT_NAME="createFluidEngine"' --bind -o web/engine.js
``
*   `-O3`: Max optimization.
*   `--bind`: Enables Embind for easy C++ class mapping to JS.

**2. Execution:**
Since Wasm cannot load over the `file://` protocol due to CORS security:
``bash
# Launch generic python server
python3 -m http.server 8000
# Open browser to localhost:8000/web
``

## 8. Why this fits your needs
*   **Power & Precision:** C++ allows you to use `double` or `float` arrays and optimize cache locality manually.
*   **Instant Feedback:** The simulation runs at the screen refresh rate (60-144Hz) because no data travels over the network.
*   **Simplicity:** No frameworks (React/Vue/Docker). Just raw C++ and standard Web APIs.
*   **File Count:** Only 9 source files. Clean and maintainable.