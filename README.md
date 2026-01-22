# Navier-Stokes Turbulence Simulation

## Abstract
This project implements a high-performance Computational Fluid Dynamics (CFD) solver based on the Lattice Boltzmann Method (LBM). Written in C++17 and compiled to WebAssembly (Wasm) via Emscripten, the simulation runs within a standard web browser while leveraging hardware acceleration features including multithreading (Web Workers) and SIMD (Single Instruction, Multiple Data) vectorization. The rendering pipeline utilizes WebGL 2.0 to visualize macroscopic fluid variables and Lagrangian particle trajectories in real-time.

## Physical Model

### Lattice Boltzmann Method (D2Q9)
The simulation utilizes the D2Q9 discrete velocity model, which operates on a two-dimensional grid where distributions propagate in nine directions (center, four cardinal, four diagonal). The evolution of the particle distribution function $f_i(\vec{x}, t)$ is governed by the lattice Boltzmann equation with the Bhatnagar-Gross-Krook (BGK) collision operator:

$$ f_i(\vec{x} + \vec{c}_i \Delta t, t + \Delta t) = f_i(\vec{x}, t) - \frac{1}{\tau} [f_i(\vec{x}, t) - f_i^{eq}(\vec{x}, t)] + F_i $$

Where:
*   $\vec{c}_i$ are the discrete lattice velocities.
*   $\tau$ is the dimensionless relaxation time, related to kinematic viscosity $\nu$ by $\nu = c_s^2 (\tau - 0.5)$, where $c_s$ is the speed of sound in the lattice.
*   $f_i^{eq}$ is the local equilibrium distribution function.

The macroscopic density $\rho$ and velocity $\vec{u}$ are obtained via the zeroth and first moments of the distribution function:

$$ \rho = \sum_{i=0}^8 f_i, \quad \rho \vec{u} = \sum_{i=0}^8 f_i \vec{c}_i $$

### Turbulence Modeling (Large Eddy Simulation)
To simulate high Reynolds number flows on a coarse grid, the Smagorinsky sub-grid scale (SGS) model is implemented. This model introduces an eddy viscosity $\nu_t$ to account for unresolved scales of motion:

$$ \nu_{total} = \nu_0 + (C_s \Delta)^2 |\bar{S}| $$

Where $C_s$ is the Smagorinsky constant, $\Delta$ is the filter width (grid spacing), and $|\bar{S}|$ is the magnitude of the strain rate tensor calculated locally from the non-equilibrium moments of the distribution function.

### Vorticity Confinement
To mitigate numerical dissipation inherent in grid-based methods, a vorticity confinement force is applied. This force amplifies the rotational motion at small scales:

$$ \vec{F}_{conf} = \epsilon h (\nabla \times \vec{\omega}) \times \frac{\vec{\omega}}{|\vec{\omega}|} $$

Where $\vec{\omega} = \nabla \times \vec{u}$ is the vorticity vector and $\epsilon$ controls the confinement strength.

### Thermodynamics and Rheology
*   **Thermal Advection-Diffusion:** Temperature is treated as a passive scalar advected by the velocity field using a finite-difference scheme. Buoyancy is coupled to the momentum equation via the Boussinesq approximation.
*   **Non-Newtonian Fluid:** The simulation supports a Power-Law fluid model where viscosity adapts dynamically based on the local shear rate, defined by the flow behavior index $n$ and consistency index $k$.

## Numerical Implementation

### Core Engine
The computational core is written in C++ (`engine.cpp`). Key optimization techniques include:

1.  **SIMD Vectorization:** The collision and streaming steps utilize `wasm_simd128` intrinsics. This allows the processor to perform operations on four floating-point numbers simultaneously (128-bit registers), significantly increasing throughput for the heavy algebraic operations in the LBM collision step.
2.  **Multithreading:** The domain is decomposed into horizontal stripes. Work is distributed across a thread pool utilizing `std::thread`, which Emscripten compiles to Web Workers sharing memory via `SharedArrayBuffer`. Synchronization is handled via atomic barriers and condition variables.

### WebGL Rendering
The visualization engine (`renderer.js`) bypasses the HTML Canvas 2D API for direct GPU rendering.
*   **Field Visualization:** Macroscopic variables (velocity, density, curl) are transferred from Wasm memory to floating-point textures (`R32F`). A fragment shader maps these values to color palettes (e.g., Viridis, Magma, Turbo).
*   **Particle System:** 700,000+ Lagrangian particles are simulated entirely on the GPU. A compute-shader-like approach (using fragment shaders and ping-pong framebuffers) updates particle positions based on the velocity texture.

## Building and Running

### Prerequisites
*   **Emscripten SDK (EMSDK):** Required to compile C++ to WebAssembly.
*   **Python 3:** Required to run the local development server.

### Compilation
The project includes a build script `launch.bat` (Windows) and a `Makefile` (Linux/macOS). These scripts handle the compilation of the C++ source code using `emcc`.

**Compiler Flags Used:**
*   `-O3 -ffast-math`: Aggressive optimization.
*   `-msimd128`: Enable WebAssembly SIMD instructions.
*   `-pthread`: Enable POSIX threads support (requires SharedArrayBuffer).
*   `-s PTHREAD_POOL_SIZE=navigator.hardwareConcurrency`: Dynamic thread pool sizing.

**Windows:**
Execute the batch file in the root directory:
```cmd
launch.bat
```
This script will:
1.  Check for EMSDK and Python environment variables.
2.  Compile `src/engine.cpp` to `web/engine.js` and `web/engine.wasm`.
3.  Launch a Python HTTP server on port 8005.

**Linux / macOS:**
```bash
make build
# To serve:
python3 server.py 8005 web
```

### Server Configuration
Due to the use of `SharedArrayBuffer` for multithreading, the web server must serve the application with specific security headers to enable a "Cross-Origin Isolated" environment. The included python server script handles this automatically:

*   `Cross-Origin-Opener-Policy: same-origin`
*   `Cross-Origin-Embedder-Policy: require-corp`

## Project Structure

*   **src/**
    *   `engine.cpp`: Main LBM solver implementation, threading logic, and SIMD intrinsics.
    *   `engine.h`: Class definitions and Emscripten bindings.
*   **web/** (Output Directory)
    *   `engine.js` / `engine.wasm`: Compiled binaries.
    *   `index.html`: Entry point.
    *   `main.js`: Orchestrates the simulation loop, UI, and input handling.
    *   `renderer.js`: WebGL context management and draw calls.
    *   `shaders.js`: GLSL shader source code.
    *   `style.css`: Layout and styling.
*   `launch.bat`: Build and serve automation script.