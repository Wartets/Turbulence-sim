# Real-Time Interactive Fluid Dynamics on the Web

This project implements a high-performance, multiphysics Computational Fluid Dynamics (CFD) engine designed for modern web browsers. It utilizes the Lattice Boltzmann Method (LBM) to achieve real-time interactivity by leveraging C++ compiled to WebAssembly (WASM), SIMD vectorization, and multi-threaded execution.

For an in-depth exploration of the mathematical derivations and implementation details, refer to the included technical paper: [Turbulence-sim.pdf](Turbulence-sim.pdf).

## Overview

The simulation framework enables the study of complex fluid behavior at interactive frame rates. Unlike traditional Navier-Stokes solvers, the LBM approaches fluid dynamics from a mesoscopic kinetic theory perspective, making it highly suitable for parallel execution on commodity hardware.

### Physical Models
*   **Turbulence Modeling**: Large Eddy Simulation (LES) using the Smagorinsky subgrid-scale model to resolve high Reynolds number flows.
*   **Thermodynamics**: Advection-diffusion of temperature coupled with the momentum equations via the Boussinesq approximation for buoyancy-driven flows.
*   **Non-Newtonian Rheology**: Implementation of the Ostwald-de Waele power-law model for shear-thinning and shear-thickening fluids.
*   **Multiphase Interactions**: Surface tension and phase separation modeled via the Shan-Chen pseudopotential method.
*   **Porous Media**: Darcy-Brinkman-Forchheimer drag terms for simulating flow through permeable structures.
*   **Stability Enhancements**: Back and Forth Error Compensation and Correction (BFECC) for scalar advection and vorticity confinement to preserve small-scale eddies.

## Technical Architecture

### Physics Core (C++)
*   **Engine**: C++17 implementation of the D2Q9 lattice model.
*   **Optimization**: 128-bit WASM SIMD intrinsics for vectorized collision and streaming steps.
*   **Parallelism**: Multi-threaded domain decomposition using `pthreads` (compiled to Web Workers).
*   **Memory Management**: Direct manipulation of the WASM linear heap to minimize data transfer overhead between the physics engine and JavaScript.

### Rendering Pipeline (WebGL2)
*   **GPU Acceleration**: Field visualization (vorticity, velocity, density, pressure) processed via fragment shaders.
*   **Particle System**: Lagrangian particle tracers (up to 10,000,000) managed entirely on the GPU using Transform Feedback.
*   **Visualization**: Support for multiple HDR colormaps (Turbo, Viridis, Inferno) and post-processing filters (Gaussian blur, edge detection).

## Project Structure

| Directory/File | Description |
| :--- | :--- |
| `src/` | C++ source code for the fluid engine and headers. |
| `web/` | Target directory for compiled WASM, HTML, and JS assets. |
| `main.js` | Simulation orchestration and UI management. |
| `renderer.js` | WebGL2 context and particle system implementation. |
| `shaders.js` | GLSL shader sources for visualization and GPU computing. |
| `launch.bat` | Automated build and development server script for Windows. |
| `Makefile` | Build configuration for Unix-like systems. |
| `Turbulence-sim.pdf` | Comprehensive mathematical and technical documentation. |

## Installation and Deployment

### Prerequisites
*   **Emscripten SDK (emsdk)**: For C++ to WebAssembly compilation.
*   **Python 3**: To serve the application with required security headers (`COOP`/`COEP`).

### Build and Run (Windows)
The `launch.bat` script automates the compilation, asset synchronization, and server initialization.
```cmd
launch.bat
```

### Build and Run (Unix/Linux/macOS)
Use the provided Makefile to compile the engine:
```bash
make build
# Serve the 'web' directory using the provided python script
python3 server.py 8005 web
```

### Important Note on Security Headers
This simulation requires `SharedArrayBuffer` for multithreading. Your web server must provide the following headers for the simulation to initialize:
*   `Cross-Origin-Opener-Policy: same-origin`
*   `Cross-Origin-Embedder-Policy: require-corp`

The included `server.py` and `launch.bat` handle this automatically for local development.

## Usage
*   **Interaction**: Use the mouse or touch input to inject momentum, density, or temperature.
*   **Presets**: Select from various physical configurations (e.g., Molten Gold, Superfluid Helium) via the GUI.
*   **Parameters**: Real-time adjustment of viscosity, gravity, thermal expansion, and resolution.
*   **Shortcuts**:
    *   `Space`: Toggle pause.
    *   `R`: Reset simulation.
    *   `P`: Toggle particle visibility.

## License
Licensed under the [MIT License](LICENSE).
