class ParticleSystem {
    constructor(count, width, height) {
        this.width = width;
        this.height = height;
        this.count = 0;
        this.positions = new Float32Array(0);
        this.setCount(count);
    }

    _resetParticle(i, barrierArray, simWidth, simHeight) {
        let x, y, gx, gy, idx;
        do {
            x = Math.random() * this.width;
            y = Math.random() * this.height;
            if (simWidth > 0 && simHeight > 0) {
                gx = Math.floor((x / this.width) * simWidth);
                gy = Math.floor(((this.height - y) / this.height) * simHeight);
                idx = gy * simWidth + gx;
            } else {
                idx = -1;
            }
        } while (barrierArray && simWidth > 0 && barrierArray[idx]);

        this.positions[i * 2] = x;
        this.positions[i * 2 + 1] = y;
    }

    setCount(newCount, barrierArray, simWidth, simHeight) {
        if (this.count === newCount) return;

        const oldPositions = this.positions;
        const oldCount = this.count;

        this.positions = new Float32Array(newCount * 2);
        this.count = newCount;
        
        const copyCount = Math.min(oldCount, newCount);
        if (oldPositions && copyCount > 0) {
            this.positions.set(oldPositions.subarray(0, copyCount * 2));
        }

        if (newCount > oldCount) {
            for (let i = oldCount; i < newCount; i++) {
                this._resetParticle(i, barrierArray, simWidth, simHeight);
            }
        }
    }

    reset(barrierArray, simWidth, simHeight) {
        for (let i = 0; i < this.count; i++) {
            this._resetParticle(i, barrierArray, simWidth, simHeight);
        }
    }

    update(ux, uy, barrierArray, simWidth, simHeight, dt) {
        const scaleX = this.width / simWidth;
        const scaleY = this.height / simHeight;

        for (let i = 0; i < this.count; i++) {
            let x = this.positions[i * 2];
            let y = this.positions[i * 2 + 1];

            let gx = (x / this.width) * simWidth;
            let gy = ((this.height - y) / this.height) * simHeight;

            let ix = Math.floor(gx);
            let iy = Math.floor(gy);

            if (ix < 0 || ix >= simWidth - 1 || iy < 0 || iy >= simHeight - 1 || (barrierArray && barrierArray[iy * simWidth + ix])) {
                this._resetParticle(i, barrierArray, simWidth, simHeight);
                continue;
            }

            let fx = gx - ix;
            let fy = gy - iy;

            let idx1 = iy * simWidth + ix;
            let idx2 = iy * simWidth + (ix + 1);
            let idx3 = (iy + 1) * simWidth + ix;
            let idx4 = (iy + 1) * simWidth + (ix + 1);

            let vx = (1-fx)*(1-fy)*ux[idx1] + fx*(1-fy)*ux[idx2] + (1-fx)*fy*ux[idx3] + fx*fy*ux[idx4];
            let vy = (1-fx)*(1-fy)*uy[idx1] + fx*(1-fy)*uy[idx2] + (1-fx)*fy*uy[idx3] + fx*fy*uy[idx4];

            x += vx * dt * scaleX;
            y -= vy * dt * scaleY; 

            if (x < 0) x += this.width;
            if (x > this.width) x -= this.width;
            if (y < 0) y += this.height;
            if (y > this.height) y -= this.height;

            this.positions[i * 2] = x;
            this.positions[i * 2 + 1] = y;
        }
    }
}

createFluidEngine().then(Module => {
    const canvas = document.getElementById('simCanvas');
    let engine = null;
    let renderer = null;
    let particles = null;
    let requestId = null;

    const params = {
        resolutionScale: 300,
        iterations: 2,
        paused: false,
        
        viscosity: 0.8,
        decay: 0.001,
        dt: 0.5,
        gravityX: 0,
        gravityY: 0,
        boundary: 0,
        
        mode: 1, 
        colorScheme: 4, 
        contrast: 1.5,
        brightness: 1.0,
        obstacleColor: '#4d4d4d',
        
        showParticles: false,
        particleCount: 20000,

        brushSize: 5,
        brushStrength: 0.8,
        brushType: 'combined', 
        eraseMode: false,

        reset: () => { 
            if(engine) engine.reset(); 
            if(particles) {
                const barrierArray = engine.getBarrierView();
                particles.reset(barrierArray, simWidth, simHeight);
            }
        }
    };

    const gui = new lil.GUI({ title: 'Turbulence Lab Pro' });
    
    const simFolder = gui.addFolder('Simulation').close();
    simFolder.add(params, 'resolutionScale', [100, 150, 200, 300, 400, 600, 800]).name('Grid Resolution').onChange(initSimulation);
    simFolder.add(params, 'iterations', 0, 20, 1).name('Iterations/Frame');
    simFolder.add(params, 'paused').name('Pause');

    const physicsFolder = gui.addFolder('Physics');
    physicsFolder.add(params, 'viscosity', 0.001, 10).name('Viscosity').onChange(v => engine && engine.setViscosity(v));
    physicsFolder.add(params, 'decay', 0.0, 0.05).name('Dissipation').onChange(d => engine && engine.setDecay(d));
    physicsFolder.add(params, 'dt', 0.01, 2.0).name('Time Step (dt)').onChange(t => engine && engine.setDt(t));
    const updateGravity = () => engine && engine.setGravity(params.gravityX, params.gravityY);
    physicsFolder.add(params, 'gravityX', -10, 10).name('Gravity X').onChange(updateGravity);
    physicsFolder.add(params, 'gravityY', -10, 10).name('Gravity Y').onChange(updateGravity);
    physicsFolder.add(params, 'boundary', { 
        'Periodic': 0, 
        'Box': 1, 
        'Channel X': 2, 
        'Channel Y': 3,
        'Slip Box': 4,
        'Slip Channel X': 5
    }).name('Boundaries').onChange(b => engine && engine.setBoundaryType(parseInt(b)));
    
    physicsFolder.add(params, 'reset').name('Reset Fluid');

    const viewFolder = gui.addFolder('Visualization');
    viewFolder.add(params, 'mode', { 'Vorticity': 0, 'Velocity': 1, 'Density': 2 }).name('Field');
    viewFolder.add(params, 'colorScheme', { 
        'Inferno': 0, 'Magma': 1, 'Plasma': 2, 'Viridis': 3,
        'Turbo': 4, 'Grayscale': 5, 'Ice': 6
    }).name('Palette');
    viewFolder.add(params, 'contrast', 0.1, 5.0).name('Contrast');
    viewFolder.add(params, 'brightness', 0.1, 2.0).name('Brightness');
    viewFolder.addColor(params, 'obstacleColor').name('Obstacle Color');
    viewFolder.add(params, 'showParticles').name('Show Particles');
    viewFolder.add(params, 'particleCount', 0, 50000, 1000).name('Particle Count').onChange(count => {
        if (particles && engine) {
            const barrierArray = engine.getBarrierView();
            particles.setCount(count, barrierArray, simWidth, simHeight);
        }
    });

    const inputFolder = gui.addFolder('Interaction');
    inputFolder.add(params, 'brushType', ['combined', 'velocity', 'density', 'vortex', 'obstacle']).name('Brush Mode');
    inputFolder.add(params, 'brushSize', 1, 100).name('Radius');
    inputFolder.add(params, 'brushStrength', 0.01, 10.0).name('Strength');
    inputFolder.add(params, 'eraseMode').name('Eraser');

    let simWidth, simHeight;

    function initSimulation() {
        if (requestId) cancelAnimationFrame(requestId);
        if (engine) engine.delete();

        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;

        const aspect = canvas.width / canvas.height;
        const baseRes = parseInt(params.resolutionScale);
        
        simHeight = baseRes;
        simWidth = Math.round(baseRes * aspect);

        engine = new Module.FluidEngine(simWidth, simHeight);
        engine.setViscosity(params.viscosity);
        engine.setDecay(params.decay);
        engine.setDt(params.dt);
        engine.setGravity(params.gravityX, params.gravityY);
        engine.setBoundaryType(parseInt(params.boundary));
        
        renderer = new Renderer(canvas, simWidth, simHeight);
        
        particles = new ParticleSystem(params.particleCount, canvas.width, canvas.height);
        const barrierArray = engine.getBarrierView();
        particles.reset(barrierArray, simWidth, simHeight);

        loop();
    }

    let isDragging = false;
    let lastX = 0, lastY = 0;

    const handleInput = (x, y) => {
        const rect = canvas.getBoundingClientRect();
        
        const mx = x - rect.left;
        const my = y - rect.top;

        const simX = Math.floor((mx / canvas.width) * simWidth);
        const simY = Math.floor(((canvas.height - my) / canvas.height) * simHeight);
        
        const dx = (x - lastX);
        const dy = -(y - lastY); 

        const radius = params.brushSize;

        if (params.brushType === 'obstacle') {
             engine.addObstacle(simX, simY, radius, params.eraseMode);
        } else {
            if (params.eraseMode) {
                engine.clearRegion(simX, simY, radius);
            } else {
                for(let ry = -radius; ry <= radius; ry++) {
                    for(let rx = -radius; rx <= radius; rx++) {
                        if(rx*rx + ry*ry > radius*radius) continue;
                        
                        const cx = Math.max(0, Math.min(simWidth - 1, simX + rx));
                        const cy = Math.max(0, Math.min(simHeight - 1, simY + ry));

                        const strength = params.brushStrength;

                        if (params.brushType === 'vortex') {
                            const vortexStrength = strength * 0.1;
                            engine.addForce(cx, cy, -ry * vortexStrength, rx * vortexStrength);
                        }

                        if (params.brushType === 'velocity' || params.brushType === 'combined') {
                            if (Math.abs(dx) > 0 || Math.abs(dy) > 0) {
                                engine.addForce(cx, cy, dx * 0.5 * strength, dy * 0.5 * strength);
                            }
                        } 
                        
                        if (params.brushType === 'density' || params.brushType === 'combined') {
                            engine.addDensity(cx, cy, 0.5 * strength);
                        }
                    }
                }
            }
        }
        
        lastX = x;
        lastY = y;
    };

    window.addEventListener('resize', () => {
        setTimeout(initSimulation, 100);
    });

    canvas.addEventListener('mousedown', e => { isDragging = true; lastX = e.clientX; lastY = e.clientY; handleInput(e.clientX, e.clientY); });
    window.addEventListener('mouseup', () => isDragging = false);
    canvas.addEventListener('mousemove', e => { if (isDragging) handleInput(e.clientX, e.clientY); });
    
    canvas.addEventListener('touchstart', e => { 
        isDragging = true; 
        const t = e.touches[0]; 
        lastX = t.clientX; 
        lastY = t.clientY; 
        handleInput(t.clientX, t.clientY);
    }, {passive: false});
    
    canvas.addEventListener('touchmove', e => { 
        e.preventDefault();
        if (isDragging) {
            const t = e.touches[0];
            handleInput(t.clientX, t.clientY); 
        }
    }, {passive: false});

    window.addEventListener('touchend', () => isDragging = false);

    function loop() {
        if(!params.paused && params.iterations > 0) {
            engine.step(params.iterations);
        }

        const uxArray = engine.getVelocityXView();
        const uyArray = engine.getVelocityYView();
        const rhoArray = engine.getDensityView();
        const barrierArray = engine.getBarrierView();

        if (params.showParticles) {
            particles.update(uxArray, uyArray, barrierArray, simWidth, simHeight, params.dt);
        }

        renderer.draw(uxArray, uyArray, rhoArray, barrierArray, params);

        if (params.showParticles) {
            renderer.drawParticles(particles.positions, particles.count);
        }

        requestId = requestAnimationFrame(loop);
    }

    initSimulation();
});