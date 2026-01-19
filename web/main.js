createFluidEngine().then(Module => {
    const canvas = document.getElementById('simCanvas');
    let engine = null;
    let renderer = null;
    let requestId = null;
    const fpsCounter = document.getElementById('fps-counter');
    let lastTime = 0;
    let frameCount = 0;

    const params = {
        simulation: {
            resolutionScale: 150,
            iterations: 5,
            paused: false,
            dt: 1.5,
            threads: navigator.hardwareConcurrency || 4
        },

        physics: {
            viscosity: 0.8,
            decay: 0.001,
            boundary: 1,
            gravityX: 0,
            gravityY: 0,
            buoyancy: 1.0,
            thermalDiffusivity: 0.001,
            vorticityConfinement: 0.1,
            maxVelocity: 0.57,
        },

        features: {
            enableGravity: false,
            enableBuoyancy: false,
            enableVorticity: true,
        },
        
        visualization: {
            mode: 1, 
            colorScheme: 4, 
            contrast: 1.5,
            brightness: 1.0,
            obstacleColor: '#4d4d4d',
            backgroundColor: '#00020A',
            vorticityBipolar: true,
        },
        
        particles: {
            show: false,
            count: 700000,
            size: 0.5,
            opacity: 0.5,
            color: '#ffffff',
        },

        brush: {
            type: 'combined',
            size: 5,
            falloff: 0.26,
            vortexDirection: 1,
            erase: false,
            velocityStrength: 2,
            densityStrength: 0.8,
            temperatureStrength: 4.0,
        },

        reset: () => { 
            if(engine) engine.reset(); 
            if(renderer) renderer.initParticles(params.particles.count);
        }
    };

    const updateGravity = () => {
        if (!engine) return;
        if (params.features.enableGravity) {
            engine.setGravity(params.physics.gravityX, params.physics.gravityY);
        } else {
            engine.setGravity(0, 0);
        }
    };

    const updateBuoyancy = () => {
        if (!engine) return;
        engine.setBuoyancy(params.features.enableBuoyancy ? params.physics.buoyancy : 0);
    };

    const updateVorticity = () => {
        if (!engine) return;
        engine.setVorticityConfinement(params.features.enableVorticity ? params.physics.vorticityConfinement : 0);
    };

    const gui = new lil.GUI({ title: 'Turbulence Simulation' });
    
    const simFolder = gui.addFolder('Simulation').close();
    simFolder.add(params.simulation, 'resolutionScale', [100, 150, 200, 250, 300, 400, 600, 800]).name('Grid Resolution').onChange(initSimulation);
    simFolder.add(params.simulation, 'iterations', 0, 20, 1).name('Iterations/Frame');
    simFolder.add(params.simulation, 'dt', 0.01, 2.0).name('Time Step (dt)').step(0.01).onChange(t => engine && engine.setDt(t));
    simFolder.add(params.simulation, 'threads', 1, 32, 1).name('CPU Threads').onChange(t => {
        if (engine && typeof engine.setThreadCount === 'function') {
            engine.setThreadCount(t);
        }
    });
    simFolder.add(params.simulation, 'paused').name('Pause');

    const physicsFolder = gui.addFolder('Physics');
    
    physicsFolder.add(params, 'reset').name('Reset Fluid');

    physicsFolder.add(params.physics, 'viscosity', 0.001, 10).name('Viscosity').step(0.001).onChange(v => engine && engine.setViscosity(v));
    physicsFolder.add(params.physics, 'decay', 0.0, 0.05).name('Dissipation').step(0.0001).onChange(d => engine && engine.setDecay(d));
    physicsFolder.add(params.physics, 'boundary', { 
        'Periodic': 0, 
        'Box': 1, 
        'Channel X': 2, 
        'Channel Y': 3,
        'Slip Box': 4,
        'Slip Channel X': 5
    }).name('Boundaries').onChange(b => engine && engine.setBoundaryType(parseInt(b)));
    
    const advancedPhysicsFolder = physicsFolder.addFolder('Advanced').close();
    advancedPhysicsFolder.add(params.physics, 'maxVelocity', 0.01, 1.0).name('Max Velocity (Stability)').step(0.01).onChange(v => engine && engine.setMaxVelocity(v));

    const gravityFolder = physicsFolder.addFolder('Gravity');
    const gravityXController = gravityFolder.add(params.physics, 'gravityX', -10, 10).name('X Component').step(0.01).onChange(updateGravity);
    const gravityYController = gravityFolder.add(params.physics, 'gravityY', -10, 10).name('Y Component').step(0.01).onChange(updateGravity);
    gravityFolder.add(params.features, 'enableGravity').name('Enable').onChange(enabled => {
        gravityXController.enable(enabled);
        gravityYController.enable(enabled);
        updateGravity();
    });

    const vorticityFolder = physicsFolder.addFolder('Vorticity');
    const vorticityController = vorticityFolder.add(params.physics, 'vorticityConfinement', 0, 1.0).name('Strength').step(0.01).onChange(updateVorticity);
    vorticityFolder.add(params.features, 'enableVorticity').name('Enable').onChange(enabled => {
        vorticityController.enable(enabled);
        updateVorticity();
    });

    const buoyancyFolder = physicsFolder.addFolder('Buoyancy').close();
    const buoyancyController = buoyancyFolder.add(params.physics, 'buoyancy', 0, 5.0).name('Strength').step(0.01).onChange(updateBuoyancy);
    buoyancyFolder.add(params.physics, 'thermalDiffusivity', 0.0, 0.05).name('Diffusivity').step(0.0001).onChange(d => engine && engine.setThermalDiffusivity(d));
    buoyancyFolder.add(params.features, 'enableBuoyancy').name('Enable').onChange(enabled => {
        buoyancyController.enable(enabled);
        updateBuoyancy();
    });

    const viewFolder = gui.addFolder('Visualization');
    viewFolder.add(params.visualization, 'mode', { 'Vorticity': 0, 'Velocity': 1, 'Density': 2, 'Temperature': 3 }).name('Field');
    viewFolder.add(params.visualization, 'colorScheme', { 
        'Inferno': 0, 'Magma': 1, 'Plasma': 2, 'Viridis': 3,
        'Turbo': 4, 'Grayscale': 5, 'Ice': 6, 'Cividis': 7, 'Coolwarm': 8
    }).name('Palette');
    viewFolder.add(params.visualization, 'contrast', 0.1, 5.0).name('Contrast').step(0.05);
    viewFolder.add(params.visualization, 'brightness', 0.1, 2.0).name('Brightness').step(0.05);
    viewFolder.addColor(params.visualization, 'obstacleColor').name('Obstacle Color');
    viewFolder.addColor(params.visualization, 'backgroundColor').name('Background Color');
    viewFolder.add(params.visualization, 'vorticityBipolar').name('Bipolar Vorticity');
    
    const particleFolder = viewFolder.addFolder('Particles');
    particleFolder.add(params.particles, 'show').name('Show Particles');
    particleFolder.add(params.particles, 'count', 0, 10000000, 10000).name('Particle Count').onChange(count => {
        if(renderer) renderer.initParticles(count);
    });
    particleFolder.add(params.particles, 'size', 0.01, 1.0).name('Size');
    particleFolder.add(params.particles, 'opacity', 0.0, 1.0).name('Opacity');
    particleFolder.addColor(params.particles, 'color').name('Color');

    const inputFolder = gui.addFolder('Interaction');
    const brushTypeController = inputFolder.add(params.brush, 'type', ['combined', 'velocity', 'density', 'temperature', 'vortex', 'obstacle']).name('Brush Mode');
    inputFolder.add(params.brush, 'size', 1, 100).name('Radius');
    const velocityStrengthController = inputFolder.add(params.brush, 'velocityStrength', 0.01, 10.0).name('Velocity Strength').step(0.01);
    const densityStrengthController = inputFolder.add(params.brush, 'densityStrength', 0.01, 10.0).name('Density Strength').step(0.01);
    const temperatureStrengthController = inputFolder.add(params.brush, 'temperatureStrength', 0.01, 20.0).name('Temperature Strength').step(0.01);
    const falloffController = inputFolder.add(params.brush, 'falloff', 0, 1).name('Edge Falloff').step(0.01);
    const eraseController = inputFolder.add(params.brush, 'erase').name('Eraser');
    const vortexController = inputFolder.add(params.brush, 'vortexDirection', { 'Counter-Clockwise': 1, 'Clockwise': -1 }).name('Vortex Direction');

    const updateBrushUI = () => {
        const type = params.brush.type;

        const isObstacle = type === 'obstacle';
        const isVortex = type === 'vortex';
        const isVelocity = type === 'velocity' || type === 'combined' || type === 'vortex';
        const isDensity = type === 'density' || type === 'combined';
        const isTemperature = type === 'temperature' || type === 'combined';

        velocityStrengthController.show(isVelocity);
        densityStrengthController.show(isDensity);
        temperatureStrengthController.show(isTemperature);
        falloffController.show(!isObstacle);
        vortexController.show(isVortex);

        if(type === 'vortex'){
            velocityStrengthController.name('Vortex Strength');
        } else {
            velocityStrengthController.name('Velocity Strength');
        }

        if (isObstacle) {
            eraseController.name('Remove Obstacle');
        } else {
            eraseController.name('Eraser');
        }
    };
    brushTypeController.onChange(updateBrushUI);

    let simWidth, simHeight;

    function initSimulation() {
        if (requestId) cancelAnimationFrame(requestId);
        if (engine) engine.delete();

        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;

        const aspect = canvas.width / canvas.height;
        const baseRes = parseInt(params.simulation.resolutionScale);
        
        simHeight = baseRes;
        simWidth = Math.round(baseRes * aspect);

        engine = new Module.FluidEngine(simWidth, simHeight);
        
        console.log("FluidEngine instance created.");
        if (engine) {
            const proto = Object.getPrototypeOf(engine);
            const methods = Object.getOwnPropertyNames(proto);
            console.log("Available methods on FluidEngine:", methods.join(", "));
        }

        engine.setViscosity(params.physics.viscosity);
        engine.setDecay(params.physics.decay);
        engine.setDt(params.simulation.dt);
        engine.setBoundaryType(parseInt(params.physics.boundary));
        engine.setThermalDiffusivity(params.physics.thermalDiffusivity);
        engine.setMaxVelocity(params.physics.maxVelocity);
        
        if (typeof engine.setThreadCount === 'function') {
            engine.setThreadCount(params.simulation.threads);
            console.log("Thread count set to " + params.simulation.threads);
        } else {
            console.warn("setThreadCount not available in FluidEngine module. Check console logs for available methods.");
        }
        
        updateGravity();
        updateBuoyancy();
        updateVorticity();
        
        renderer = new Renderer(canvas, simWidth, simHeight);
        renderer.initParticles(params.particles.count);

        updateBrushUI();
        loop();
    }

    let mouse = {
        x: 0, y: 0,
        lastClientX: 0, lastClientY: 0,
        isDragging: false,
        isOver: false
    };

    const handleInput = (clientX, clientY) => {
        const rect = canvas.getBoundingClientRect();
        
        const mx = clientX - rect.left;
        const my = clientY - rect.top;

        const simX = Math.floor((mx / canvas.width) * simWidth);
        const simY = Math.floor(((canvas.height - my) / canvas.height) * simHeight);
        
        const dx = (clientX - mouse.lastClientX);
        const dy = -(clientY - mouse.lastClientY); 

        const brush = params.brush;
        const radius = brush.size;

        if (brush.type === 'obstacle') {
             engine.addObstacle(simX, simY, Math.round(radius), brush.erase);
        } else {
            if (brush.erase) {
                engine.clearRegion(simX, simY, Math.round(radius));
            } else {
                const intRadius = Math.round(radius);

                for(let ry = -intRadius; ry <= intRadius; ry++) {
                    for(let rx = -intRadius; rx <= intRadius; rx++) {
                        const distSq = rx*rx + ry*ry;
                        if(distSq > radius*radius) continue;
                        
                        const cx = Math.max(0, Math.min(simWidth - 1, simX + rx));
                        const cy = Math.max(0, Math.min(simHeight - 1, simY + ry));

                        let falloff = 1.0;
                        if (radius > 0.0) {
                            const dist = Math.sqrt(distSq);
                            const t = 1.0 - Math.min(dist / radius, 1.0);
                            const smoothT = t * t * (3.0 - 2.0 * t);
                            falloff = (1.0 - brush.falloff) + brush.falloff * smoothT;
                        }

                        if (brush.type === 'vortex') {
                            const vortexStrength = params.brush.velocityStrength * falloff * 0.1;
                            engine.addForce(cx, cy, -ry * vortexStrength * brush.vortexDirection, rx * vortexStrength * brush.vortexDirection);
                        }

                        if (brush.type === 'velocity' || brush.type === 'combined') {
                            if (Math.abs(dx) > 0 || Math.abs(dy) > 0) {
                                const strength = params.brush.velocityStrength * falloff;
                                engine.addForce(cx, cy, dx * 0.5 * strength, dy * 0.5 * strength);
                            }
                        } 
                        
                        if (brush.type === 'density' || brush.type === 'combined') {
                            const strength = params.brush.densityStrength * falloff;
                            engine.addDensity(cx, cy, 0.5 * strength);
                        }

                        if (brush.type === 'temperature' || brush.type === 'combined') {
                            const strength = params.brush.temperatureStrength * falloff;
                            engine.addTemperature(cx, cy, 1.0 * strength);
                        }
                    }
                }
            }
        }
        
        mouse.lastClientX = clientX;
        mouse.lastClientY = clientY;
    };

    window.addEventListener('resize', () => {
        setTimeout(initSimulation, 100);
    });

    canvas.addEventListener('mousedown', e => { 
        mouse.isDragging = true; 
        mouse.lastClientX = e.clientX; 
        mouse.lastClientY = e.clientY; 
        handleInput(e.clientX, e.clientY); 
    });

    window.addEventListener('mouseup', () => mouse.isDragging = false);

    canvas.addEventListener('mousemove', e => { 
        const rect = canvas.getBoundingClientRect();
        mouse.x = e.clientX - rect.left;
        mouse.y = e.clientY - rect.top;
        if (mouse.isDragging) handleInput(e.clientX, e.clientY); 
    });

    canvas.addEventListener('mouseenter', () => mouse.isOver = true);
    canvas.addEventListener('mouseleave', () => mouse.isOver = false);
    
    canvas.addEventListener('touchstart', e => { 
        e.preventDefault();
        mouse.isDragging = true; 
        const t = e.touches[0]; 
        mouse.lastClientX = t.clientX; 
        mouse.lastClientY = t.clientY; 
        handleInput(t.clientX, t.clientY);
    }, {passive: false});
    
    canvas.addEventListener('touchmove', e => { 
        e.preventDefault();
        if (mouse.isDragging) {
            const t = e.touches[0];
            const rect = canvas.getBoundingClientRect();
            mouse.x = t.clientX - rect.left;
            mouse.y = t.clientY - rect.top;
            handleInput(t.clientX, t.clientY); 
        }
    }, {passive: false});

    window.addEventListener('touchend', () => mouse.isDragging = false);

    function loop() {
        if(!params.simulation.paused && params.simulation.iterations > 0) {
            engine.step(params.simulation.iterations);
        }

        const uxArray = engine.getVelocityXView();
        const uyArray = engine.getVelocityYView();
        const rhoArray = engine.getDensityView();
        const barrierArray = engine.getBarrierView();
        const dyeArray = engine.getDyeView();
        const tempArray = engine.getTemperatureView();

        if (params.particles.show) {
            renderer.updateParticles(params.simulation.dt);
        }

        renderer.draw(uxArray, uyArray, rhoArray, barrierArray, dyeArray, tempArray, params.visualization);

        if (params.particles.show) {
            renderer.drawParticles(params);
        }

        if (mouse.isOver && !mouse.isDragging) {
            const brush = params.brush;
            const canvasRadius = (brush.size / simWidth) * canvas.width;
            const color = brush.erase ? [1.0, 0.2, 0.2, 0.7] : [1.0, 1.0, 1.0, 0.7];
            renderer.drawBrush(mouse.x, mouse.y, canvasRadius, color);
        }

        const currentTime = performance.now();
        frameCount++;
        if (currentTime > lastTime + 1000) {
            const fps = Math.round((frameCount * 1000) / (currentTime - lastTime));
            fpsCounter.textContent = `FPS: ${fps}`;
            lastTime = currentTime;
            frameCount = 0;
        }

        requestId = requestAnimationFrame(loop);
    }

    initSimulation();
});